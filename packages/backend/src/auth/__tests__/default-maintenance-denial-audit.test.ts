import { describe, it, expect, vi, beforeEach } from "vitest";

// admin-default-topic-maintenance (#216): the parameterized denial-audit seam, DB- and Redis-free.
// The limiter and the row writer are mocked; the seam's own branching is real: the fail-open
// row, the suppressed-count sampling (1, 2, 4, 8, ...), and the once-per-window limiter-error event.

const m = vi.hoisted(() => ({
  admit: vi.fn(),
  write: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("../audit-logger.js", () => ({ emitAuditEvent: (...a: unknown[]) => m.emit(...a) }));
vi.mock("../fail-open-topic-audit.js", () => ({ writeFailOpenTopicAuditRow: (...a: unknown[]) => m.write(...a) }));
vi.mock("../denial-audit-limiter.js", () => ({
  admitDenialAudit: (...a: unknown[]) => m.admit(...a),
  DENIAL_AUDIT_LIMIT: { limit: 10, windowMs: 60_000 },
}));

import { ADMIN_DEFAULT_TOPICS_FAMILY, recordMaintenanceDenial, resetLimiterErrorMemory } from "../default-maintenance-denial-audit.js";

const log = {} as never;
const params = {
  log,
  actorUserId: "u1",
  actorGlobalRole: "facilitator",
  actorIp: "203.0.113.1",
  method: "PATCH",
  routeTemplate: "/api/v1/admin/default-topics/:topicId",
  correlationId: "corr",
};
const events = () => m.emit.mock.calls.map((c) => ({ event: c[1] as string, fields: c[2] as Record<string, unknown> }));

beforeEach(() => {
  vi.clearAllMocks();
  resetLimiterErrorMemory();
  m.write.mockResolvedValue({ rowWritten: true, actorRoles: ["facilitator"] });
  m.admit.mockResolvedValue({ allowed: true });
});

describe("an admitted denial", () => {
  it("writes one fail-open row with team_id null and the route TEMPLATE (never the raw URL), then emits the denial event", async () => {
    await recordMaintenanceDenial(params);
    expect(m.write).toHaveBeenCalledTimes(1);
    expect(m.write.mock.calls[0]![0]).toMatchObject({
      operation: "topic.default_maintenance_denied",
      endpoint: "PATCH /api/v1/admin/default-topics/:topicId",
      httpStatus: 403,
      reason: "DEFAULT_MAINTENANCE_ADMIN_ONLY",
      actorUserId: "u1",
      actorGlobalRole: "facilitator",
      teamId: null,
      extraMetadata: { correlation_id: "corr" },
    });
    expect(events()).toEqual([
      {
        event: "topic.default_maintenance_denied",
        fields: expect.objectContaining({ rowWritten: true, actorRoles: ["facilitator"], correlationId: "corr", httpStatus: 403 }),
      },
    ]);
  });

  it("a lost row (writer says rowWritten false) still emits the event, and a caller with no users row is stored as unknown by the writer", async () => {
    m.write.mockResolvedValue({ rowWritten: false, actorRoles: null });
    await recordMaintenanceDenial({ ...params, actorGlobalRole: null });
    expect(events()[0]!.fields).toMatchObject({ rowWritten: false, actorGlobalRole: "unknown" });
    expect(m.write.mock.calls[0]![0].actorGlobalRole).toBeNull();
  });
});

describe("beyond the bound: no row, log-only suppression event sampled at 1, 2, 4, 8", () => {
  it("logs the running suppressed count only at powers of two and never writes a row", async () => {
    const logged: unknown[] = [];
    for (let over = 1; over <= 9; over++) {
      m.emit.mockClear();
      m.admit.mockResolvedValue({ allowed: false, reason: "limit", count: 10 + over, firstSuppressed: over === 1 });
      await recordMaintenanceDenial(params);
      for (const e of events()) logged.push(e.fields["suppressedCount"]);
    }
    expect(logged).toEqual([1, 2, 4, 8]);
    expect(m.write).not.toHaveBeenCalled();
  });

  it("the event carries the route family and reason, never the raw URL", async () => {
    m.admit.mockResolvedValue({ allowed: false, reason: "limit", count: 11, firstSuppressed: true });
    await recordMaintenanceDenial(params);
    expect(events()[0]).toEqual({
      event: "topic.denial_audit_suppressed",
      fields: { actorUserId: "u1", family: ADMIN_DEFAULT_TOPICS_FAMILY, reason: "limit", suppressedCount: 1 },
    });
  });
});

describe("limiter store errors", () => {
  it("writes no row and logs one limiter_error event per actor per window", async () => {
    m.admit.mockResolvedValue({ allowed: false, reason: "limiter_error" });
    await recordMaintenanceDenial({ ...params, nowMs: 1_000 });
    await recordMaintenanceDenial({ ...params, nowMs: 30_000 });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toEqual({
      event: "topic.denial_audit_suppressed",
      fields: { actorUserId: "u1", family: ADMIN_DEFAULT_TOPICS_FAMILY, reason: "limiter_error" },
    });
    await recordMaintenanceDenial({ ...params, nowMs: 61_001 }); // next window
    await recordMaintenanceDenial({ ...params, actorUserId: "u2", nowMs: 61_002 }); // another actor
    expect(events()).toHaveLength(3);
    expect(m.write).not.toHaveBeenCalled();
  });

  it("a limiter call that throws is treated as a store error", async () => {
    m.admit.mockRejectedValue(new Error("redis down"));
    await recordMaintenanceDenial({ ...params, nowMs: 5 });
    expect(events()[0]!.fields).toMatchObject({ reason: "limiter_error" });
    expect(m.write).not.toHaveBeenCalled();
  });

  it("a limiter module that cannot be imported is also a store error, never a throw", async () => {
    vi.resetModules();
    vi.doMock("../denial-audit-limiter.js", () => {
      throw new Error("limiter module unavailable");
    });
    const fresh = await import("../default-maintenance-denial-audit.js");
    fresh.resetLimiterErrorMemory();
    await expect(fresh.recordMaintenanceDenial({ ...params, nowMs: 1 })).resolves.toBeUndefined();
    expect(events().some((e) => e.fields["reason"] === "limiter_error")).toBe(true);
    vi.doUnmock("../denial-audit-limiter.js");
  });
});
