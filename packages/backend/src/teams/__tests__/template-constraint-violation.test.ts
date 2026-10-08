import { describe, it, expect, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { DatabaseError } from "pg";
import {
  isTemplateConstraintViolation,
  logTemplateConstraintViolation,
  registerTemplateConstraintErrorHandler,
  TEMPLATE_CONSTRAINT_VIOLATION_MESSAGE,
} from "../template-constraint-violation.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 2.2, design.md D5: a template
// constraint violation stays a 500, is logged with the
// template_constraint_violation marker, and its body never names the
// constraint; every other error keeps Fastify's default response.
// ---------------------------------------------------------------------------

function dbError(code: string, constraint: string | undefined, message: string): DatabaseError {
  const err = new DatabaseError(message, message.length, "error");
  err.code = code;
  if (constraint !== undefined) err.constraint = constraint;
  return err;
}

function templateViolation(table = "sessions"): DatabaseError {
  return dbError(
    "23514",
    `${table}_not_template_team`,
    `new row for relation "${table}" violates check constraint "${table}_not_template_team"`,
  );
}

interface LogLine {
  level: number;
  [key: string]: unknown;
}

/** An app with one route that throws `err`, optionally with the narrow handler, collecting its log lines. */
async function appThrowing(err: unknown, withHandler: boolean): Promise<{ app: FastifyInstance; lines: LogLine[] }> {
  const lines: LogLine[] = [];
  const app = Fastify({
    logger: { level: "info", stream: { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) } },
  });
  if (withHandler) registerTemplateConstraintErrorHandler(app);
  await app.register(async (child) => {
    child.post("/api/v1/teams/:teamId/sessions/__probe", async () => {
      throw err;
    });
  });
  await app.ready();
  return { app, lines };
}

function markerLines(lines: LogLine[]): LogLine[] {
  return lines.filter((l) => l["template_constraint_violation"] === true);
}

describe("isTemplateConstraintViolation (#214 D5)", () => {
  it.each(["sessions", "team_memberships", "join_links"])("is true for a 23514 on %s_not_template_team", (table) => {
    expect(isTemplateConstraintViolation(templateViolation(table))).toBe(true);
  });

  it.each([
    ["a different CHECK (23514)", dbError("23514", "sessions_abandoned_has_timestamp", "violates check")],
    ["a unique violation", dbError("23505", "sessions_team_active_unique", "duplicate key")],
    ["a 23514 with no constraint field", dbError("23514", undefined, 'violates check constraint "sessions_not_template_team"')],
    ["a plain Error whose message names the constraint", new Error('violates check constraint "sessions_not_template_team"')],
    ["a plain object with matching fields", { code: "23514", constraint: "sessions_not_template_team" }],
    ["undefined", undefined],
  ])("is false for %s (matched on fields, never message text)", (_label, err) => {
    expect(isTemplateConstraintViolation(err)).toBe(false);
  });
});

describe("logTemplateConstraintViolation (#214 D5)", () => {
  it("writes the marker with the route and constraint name, and nothing else from the error", () => {
    const log = { error: vi.fn() };
    logTemplateConstraintViolation(log as never, templateViolation("join_links"), "GET /auth/callback", "corr-9");
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error.mock.calls[0]![0]).toEqual({
      template_constraint_violation: true,
      route: "GET /auth/callback",
      constraint: "join_links_not_template_team",
      correlationId: "corr-9",
    });
  });
});

describe("the narrow error handler registered by registerRoutes (#214 D5)", () => {
  it("answers a simulated template 23514 with a fixed 500 that does not name the constraint, logged with the marker", async () => {
    const { app, lines } = await appThrowing(templateViolation(), true);
    const res = await app.inject({ method: "POST", url: "/api/v1/teams/x/sessions/__probe" });

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("_not_template_team");
    expect(res.body).not.toContain("violates");
    const body = res.json() as { error: { category: string; message: string; correlationId: string } };
    expect(body.error).toMatchObject({ category: "internal_error", message: TEMPLATE_CONSTRAINT_VIOLATION_MESSAGE });

    const markers = markerLines(lines);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      route: "POST /api/v1/teams/:teamId/sessions/__probe",
      constraint: "sessions_not_template_team",
      correlationId: body.error.correlationId,
    });
    await app.close();
  });

  it.each([
    ["a different 23514", () => dbError("23514", "sessions_abandoned_has_timestamp", "violates check constraint x")],
    ["an unrelated thrown error", () => new Error("something unrelated broke")],
    ["an error with a statusCode", () => Object.assign(new Error("teapot"), { statusCode: 418 })],
  ])("%s: no marker, and the same response as without the handler (before this change)", async (_label, make) => {
    const withHandler = await appThrowing(make(), true);
    const without = await appThrowing(make(), false);
    const a = await withHandler.app.inject({ method: "POST", url: "/api/v1/teams/x/sessions/__probe" });
    const b = await without.app.inject({ method: "POST", url: "/api/v1/teams/x/sessions/__probe" });

    expect(a.statusCode).toBe(b.statusCode);
    expect(a.body).toBe(b.body);
    expect(a.headers["content-type"]).toBe(b.headers["content-type"]);
    expect(markerLines(withHandler.lines)).toHaveLength(0);
    await withHandler.app.close();
    await without.app.close();
  });
});
