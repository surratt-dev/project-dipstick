import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type * as DefaultTopicsModule from "../../sessions/default-topics.js";
import type * as AnomaliesModule from "../../sessions/template-anomalies.js";
import { probeInfra, requireInfraOrThrow, loadModules, Fixture } from "./helpers/real-db.js";
import type { Mods } from "./helpers/real-db.js";

// ---------------------------------------------------------------------------
// harden-team-creation-topic-copy (#215) tasks.md 4.4 (generic copy failure)
// and 6.7 (failing anomaly check). vi.mock is file-wide, so these live apart
// from the integration tests. The mocks delegate to the real implementation
// unless a per-test flag is set (design.md 6.4: no production seam added).
// Neither test mutates the template, so no template lock is needed.
// ---------------------------------------------------------------------------

const flags = vi.hoisted(() => ({ failCopy: false, failAnomalyRead: false }));

vi.mock("../../sessions/default-topics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DefaultTopicsModule>();
  return {
    ...actual,
    copyCanonicalDefaults: vi.fn(async (...args: Parameters<typeof actual.copyCanonicalDefaults>) => {
      if (flags.failCopy) throw new Error("simulated copy failure SELECT secret_sql_text");
      return actual.copyCanonicalDefaults(...args);
    }),
  };
});

vi.mock("../../sessions/template-anomalies.js", async (importOriginal) => {
  const actual = await importOriginal<typeof AnomaliesModule>();
  return {
    ...actual,
    readTemplateTopicFacts: vi.fn(async (...args: Parameters<typeof actual.readTemplateTopicFacts>) => {
      if (flags.failAnomalyRead) throw new Error("simulated check failure with row text: Production Code");
      return actual.readTemplateTopicFacts(...args);
    }),
  };
});

const infraUp = await probeInfra();
requireInfraOrThrow(infraUp, "team-creation-failure-paths.test.ts");

interface LogLine {
  level: number;
  msg?: string;
  [key: string]: unknown;
}

describe.skipIf(!infraUp)("team creation failure paths (#215 4.4, 6.7)", () => {
  let mods: Mods;
  let fx: Fixture;
  let facilitatorId: string;
  let app: FastifyInstance;
  let lines: LogLine[];

  beforeAll(async () => {
    mods = await loadModules();
    fx = new Fixture(mods.db);
    facilitatorId = await fx.user("facilitator");
  });

  afterAll(async () => {
    await fx?.cleanup();
    await mods?.redis.quit();
  });

  afterEach(async () => {
    flags.failCopy = false;
    flags.failAnomalyRead = false;
    await app?.close();
  });

  async function build(): Promise<void> {
    lines = [];
    app = Fastify({
      logger: { level: "info", stream: { write: (line: string) => void lines.push(JSON.parse(line) as LogLine) } },
    });
    app.decorateRequest("session", null);
    app.addHook("onRequest", async (request) => {
      (request as unknown as Record<string, unknown>).session = { userId: facilitatorId };
    });
    app.register(mods.facilitatorSessionRoutes);
    await app.ready();
  }

  it("4.4: a generic topic-copy failure is a fixed 500 and persists no team", async () => {
    await build();
    flags.failCopy = true;
    const name = `Copy Failure ${randomUUID()}`;
    const res = await app.inject({ method: "POST", url: "/api/v1/teams", payload: { name } });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.category).toBe("internal_error");
    expect(res.body).not.toContain("secret_sql_text");
    expect(res.body).not.toContain("simulated");
    expect((await mods.db.query(`SELECT 1 FROM teams WHERE name = $1`, [name])).rowCount).toBe(0);
    expect(lines.some((l) => l.level >= 50 && l.msg === "team creation failed")).toBe(true);
  });

  it("6.7: a throwing anomaly check still yields 201, one template_anomaly_check_failed warn with no row text, and no template_anomaly entry", async () => {
    await build();
    flags.failAnomalyRead = true;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/teams",
      payload: { name: `Check Failure ${randomUUID()}` },
    });

    expect(res.statusCode).toBe(201);
    fx.track(res.json().teamId as string);
    const failed = lines.filter((l) => l.msg === "template_anomaly_check_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.level).toBe(40);
    const text = JSON.stringify(failed[0]);
    expect(text).not.toContain("Production Code");
    expect(text).not.toContain("simulated");
    expect(lines.filter((l) => l.msg === "template_anomaly")).toHaveLength(0);
  });
});
