import { afterEach, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { SENTINEL_TEAM_ID, resetTopicWriteBudget } from "./real-db.js";
import type { Fixture } from "./real-db.js";
import type { Mods } from "./real-db.js";
import { acquireTemplateLock } from "./template-lock.js";

// ---------------------------------------------------------------------------
// Shared harness for the zero-topic-team-recovery (#200) assign-defaults real-
// database tests: a full app that logs to memory (so audit events can be read
// back), a zero-active-topic team builder, and a reader for the template's
// current canonical defaults. Not a *.test.ts file, so vitest never collects
// it.
//
// Any test that compares a result with the template, or changes the template,
// must hold the template lock (helpers/template-lock.ts) for the whole file:
// other files archive and swap template rows.
// ---------------------------------------------------------------------------

export const ASSIGN_PATH = (teamId: string) => `/api/v1/teams/${teamId}/topics/assign-defaults`;
export const ASSIGN_ENDPOINT = "POST /api/v1/teams/:teamId/topics/assign-defaults";

export type LogLine = Record<string, unknown> & { event?: string; level?: number; msg?: string };

export interface LoggedApp {
  app: FastifyInstance;
  lines: LogLine[];
  /** Structured audit events (emitAuditEvent) by name. */
  events(name: string): LogLine[];
}

/** The whole HTTP route table, authenticated as userId, logging to memory. */
export async function buildLoggedApp(mods: Mods, userId: string): Promise<LoggedApp> {
  await resetTopicWriteBudget(userId);
  await resetDenialAuditBudget(mods, userId);
  const lines: LogLine[] = [];
  const app = Fastify({
    logger: {
      level: "info",
      stream: {
        write(chunk: string) {
          try {
            lines.push(JSON.parse(chunk) as LogLine);
          } catch {
            /* not a JSON log line */
          }
        },
      },
    },
  });
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as Record<string, unknown>).session = { userId };
  });
  await mods.registerRoutes(app);
  await app.ready();
  return { app, lines, events: (name) => lines.filter((l) => l.event === name) };
}

/** Clears the per-actor denial-audit window (a distinct Redis key from the topic-write budget). */
export async function resetDenialAuditBudget(mods: Mods, ...userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const { denialAuditKey } = await import("../../../auth/denial-audit-limiter.js");
  await mods.redis.del(...userIds.map(denialAuditKey));
}

export interface TemplateDefault {
  name: string;
  prompt: string;
  vote_type: string;
  first_session_description: string | null;
}

/** The template's active canonical defaults, in the order the copy numbers them. */
export async function templateDefaults(mods: Mods): Promise<TemplateDefault[]> {
  return (
    await mods.db.query<TemplateDefault>(
      `SELECT name, prompt, vote_type, first_session_description
         FROM topics
        WHERE team_id = $1 AND is_default = true AND status = 'active'
        ORDER BY display_order, id`,
      [SENTINEL_TEAM_ID],
    )
  ).rows;
}

export interface TeamTopicRow extends TemplateDefault {
  id: string;
  display_order: number;
  status: string;
  is_default: boolean;
  team_annotation: string | null;
  annotation_updated_by: string | null;
  annotation_updated_at: Date | null;
}

export async function teamTopicRows(mods: Mods, teamId: string): Promise<TeamTopicRow[]> {
  return (
    await mods.db.query<TeamTopicRow>(
      `SELECT id, name, prompt, vote_type, first_session_description, display_order, status, is_default,
              team_annotation, annotation_updated_by, annotation_updated_at
         FROM topics WHERE team_id = $1 ORDER BY status, display_order, id`,
      [teamId],
    )
  ).rows;
}

export async function activeCount(mods: Mods, teamId: string): Promise<number> {
  return (
    await mods.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM topics WHERE team_id = $1 AND status = 'active'`,
      [teamId],
    )
  ).rows[0]!.n;
}

export interface AuditRow {
  operation: string;
  actor_user_id: string;
  actor_global_role: string;
  actor_ip: string | null;
  team_id: string | null;
  actor_roles: string[] | null;
  metadata: Record<string, unknown>;
}

export async function auditRows(mods: Mods, filter: { teamId?: string; actorUserId?: string; operation: string }): Promise<AuditRow[]> {
  return (
    await mods.db.query<AuditRow>(
      `SELECT operation, actor_user_id, actor_global_role, host(actor_ip) AS actor_ip, team_id,
              actor_roles::text[] AS actor_roles, metadata
         FROM audit_log
        WHERE operation = $1
          AND ($2::uuid IS NULL OR team_id = $2::uuid)
          AND ($3::uuid IS NULL OR actor_user_id = $3::uuid)
        ORDER BY "timestamp"`,
      [filter.operation, filter.teamId ?? null, filter.actorUserId ?? null],
    )
  ).rows;
}

/** A team with no topics at all (the zero-active state), created by a fresh facilitator. */
export async function zeroTopicTeam(
  fx: Fixture,
  opts: { unlocked?: boolean; archived?: number } = {},
): Promise<{ teamId: string; owner: string }> {
  const owner = await fx.user("facilitator");
  const teamId = await fx.team(owner);
  for (let i = 0; i < (opts.archived ?? 0); i += 1) {
    await fx.topic(teamId, { displayOrder: i + 1, status: "archived", name: `Archived ${i + 1} ${teamId.slice(-4)}` });
  }
  if (opts.unlocked) await fx.unlock(teamId, owner);
  return { teamId, owner };
}

/**
 * Holds the template lock for the duration of each test, not the whole file.
 * Several files already hold it file-wide; adding more file-wide holders
 * would queue past the 10 s default hook timeout of the others, so the new
 * (#200) files take it per test and wait up to a minute for it. Call it FIRST
 * in the describe block: afterEach hooks run in reverse registration order,
 * so a restore registered later still runs before the lock is released.
 */
export function holdTemplateLockPerTest(): void {
  let release: (() => Promise<void>) | undefined;
  beforeEach(async () => {
    release = await acquireTemplateLock();
  }, 60_000);
  afterEach(async () => {
    await release?.();
    release = undefined;
  });
}
