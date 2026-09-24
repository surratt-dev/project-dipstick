import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";

const mockDbConnect = vi.fn();

vi.mock("../../db.js", () => ({
  db: { connect: () => mockDbConnect() },
}));

import { withAuditTransaction, TRANSACTIONAL_AUDIT_STATEMENT_TIMEOUT_MS } from "../audit-write-transaction.js";
import { AuditWriteError } from "../errors.js";

/** Matches teams.test.ts's makeMockClient shape. */
function makeMockClient(queryImpl?: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>) {
  return {
    query: vi.fn(queryImpl ?? (() => Promise.resolve({ rows: [] }))),
    release: vi.fn(),
  };
}

describe("withAuditTransaction (auth-events-audit-log-coverage, design.md Decision D2/D3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs BEGIN, domainWrite, SET LOCAL statement_timeout, auditInsert, COMMIT, then releases the client", async () => {
    const client = makeMockClient();
    mockDbConnect.mockResolvedValueOnce(client);

    const domainWrite = vi.fn().mockResolvedValue("domain-result");
    const auditInsert = vi.fn().mockResolvedValue(undefined);

    const result = await withAuditTransaction(domainWrite, auditInsert);

    expect(result).toBe("domain-result");
    expect(domainWrite).toHaveBeenCalledWith(client);
    expect(auditInsert).toHaveBeenCalledWith(client, "domain-result");

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls[0]).toBe("BEGIN");
    expect(String(calls[1])).toContain(`SET LOCAL statement_timeout = ${TRANSACTIONAL_AUDIT_STATEMENT_TIMEOUT_MS}`);
    expect(calls[2]).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("wraps a failed db.connect() as AuditWriteError and attempts no ROLLBACK (no transaction was opened)", async () => {
    const connectErr = new Error("pool exhausted");
    mockDbConnect.mockRejectedValueOnce(connectErr);

    const domainWrite = vi.fn();
    const auditInsert = vi.fn();

    await expect(withAuditTransaction(domainWrite, auditInsert)).rejects.toBeInstanceOf(AuditWriteError);
    expect(domainWrite).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it("propagates a domainWrite failure unwrapped and rolls back", async () => {
    const client = makeMockClient();
    mockDbConnect.mockResolvedValueOnce(client);

    const domainErr = new Error("upsert failed");
    const domainWrite = vi.fn().mockRejectedValue(domainErr);
    const auditInsert = vi.fn();

    await expect(withAuditTransaction(domainWrite, auditInsert)).rejects.toBe(domainErr);
    expect(auditInsert).not.toHaveBeenCalled();

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("wraps an auditInsert failure as AuditWriteError, rolls back, and rethrows the wrapped error (not the raw one)", async () => {
    const client = makeMockClient();
    mockDbConnect.mockResolvedValueOnce(client);

    const rawAuditErr = new Error("constraint violation");
    const domainWrite = vi.fn().mockResolvedValue("domain-result");
    const auditInsert = vi.fn().mockRejectedValue(rawAuditErr);

    let caught: unknown;
    try {
      await withAuditTransaction(domainWrite, auditInsert);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AuditWriteError);
    expect((caught as AuditWriteError).causeClass).toBe("Error");

    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls).toContain("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  // task 1.4: proves the specific bug this helper exists to fix -- a hung
  // audit INSERT is cancelled by Postgres's own statement_timeout (simulated
  // here as the mocked INSERT call rejecting, the same observable behavior a
  // real statement_timeout cancellation produces), so the subsequent
  // ROLLBACK is issued promptly rather than queuing behind a still-pending
  // query on the same connection.
  it("a simulated statement_timeout cancellation on the audit INSERT results in a prompt ROLLBACK, not an indefinitely hung connection", async () => {
    const statementTimeoutErr = Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    });

    const client = makeMockClient((sql) => {
      if (typeof sql === "string" && sql.startsWith("INSERT INTO audit_log")) {
        return Promise.reject(statementTimeoutErr);
      }
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    const domainWrite = vi.fn().mockResolvedValue("domain-result");
    const auditInsert = vi.fn(async (c: PoolClient) => {
      await (c as unknown as typeof client).query("INSERT INTO audit_log (...) VALUES (...)");
    });

    let caught: unknown;
    try {
      await withAuditTransaction(domainWrite, auditInsert);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AuditWriteError);

    // The INSERT's rejection (the simulated statement_timeout cancellation)
    // must have already resolved -- via the mocked client.query rejecting --
    // before ROLLBACK is ever issued. This is the observable proof that the
    // connection's command slot was freed rather than left occupied by an
    // abandoned query.
    const calls = client.query.mock.calls.map((c) => c[0]);
    const insertIndex = calls.findIndex((c) => typeof c === "string" && c.startsWith("INSERT INTO audit_log"));
    const rollbackIndex = calls.indexOf("ROLLBACK");
    expect(insertIndex).toBeGreaterThanOrEqual(0);
    expect(rollbackIndex).toBeGreaterThan(insertIndex);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("lets auditInsert no-op (no INSERT issued) and still commits the domain write alone", async () => {
    const client = makeMockClient();
    mockDbConnect.mockResolvedValueOnce(client);

    const domainWrite = vi.fn().mockResolvedValue("domain-result");
    const auditInsert = vi.fn().mockResolvedValue(undefined); // no-op, issues no query

    const result = await withAuditTransaction(domainWrite, auditInsert);

    expect(result).toBe("domain-result");
    const calls = client.query.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(["BEGIN", expect.stringContaining("SET LOCAL statement_timeout"), "COMMIT"]);
  });

  it("swallows a ROLLBACK failure (connection already lost) and still rethrows the original error", async () => {
    const client = makeMockClient((sql) => {
      if (sql === "ROLLBACK") return Promise.reject(new Error("connection terminated"));
      return Promise.resolve({ rows: [] });
    });
    mockDbConnect.mockResolvedValueOnce(client);

    const domainErr = new Error("upsert failed");
    const domainWrite = vi.fn().mockRejectedValue(domainErr);
    const auditInsert = vi.fn();

    await expect(withAuditTransaction(domainWrite, auditInsert)).rejects.toBe(domainErr);
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
