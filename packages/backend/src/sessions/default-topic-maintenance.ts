import type { FastifyBaseLogger } from "fastify";
import type { PoolClient } from "pg";
import { db } from "../db.js";
import { emitAuditEvent } from "../auth/audit-logger.js";
import { withAuditTransaction } from "../auth/audit-write-transaction.js";
import { lockTeamTopics } from "./session-topic-snapshot.js";
import { DEFAULT_TOPICS_TEAM_ID } from "./default-topics.js";
import {
  DEFAULT_LIMITS,
  MAX_ACTIVE_DEFAULTS,
  MAINTENANCE_AUDIT_OPERATIONS,
  MIN_ACTIVE_DEFAULTS,
  MaintenanceError,
  type MaintenanceOperation,
  findDefaultRowViolation,
  nameKey,
  type DefaultVoteType,
  type TextField,
} from "./default-topic-validation.js";

export * from "./default-topic-validation.js";

// ---------------------------------------------------------------------------
// Default-topic maintenance writer -- admin-default-topic-maintenance (#216)
// design.md E3/E5/E6.
//
// THE ONLY non-migration code that writes the sentinel template's `topics`
// rows (copyCanonicalDefaults only reads them). Every write is one
// transaction on withAuditTransaction under lockTeamTopics(SENTINEL), with a
// fresh re-read inside the lock, exactly one audit_log row (or none for a
// no-op), and a post-write invariant backstop scoped to what the operation
// produced. The writer throws typed errors only (MaintenanceError,
// BackstopError, AuditWriteError, or a raw pg error); the HTTP mapping lives
// in routes/admin-default-topics.ts.
//
// It never reads or writes a real team's topics, session_topics or sessions
// (live-session isolation, design E8), and takes the advisory lock on the
// sentinel id only. The structural test template-writer-structural.test.ts
// enforces that no other production file writes the sentinel's topics.
// ---------------------------------------------------------------------------

/** The scope statement every write response carries, verbatim. */
export const SCOPE_STATEMENT = "Applies to teams created from now on. Existing teams keep their current topics.";

/** The rename notice, verbatim (design E5). */
export const RENAME_NOTICE =
  "Renamed. Existing teams' topics are not renamed, and name-based matching for existing teams (restoring a default topic, and the defaultTopicsNotActive list) will no longer pair them with this default.";

const LOCK_TIMEOUT = "3s";
const STATEMENT_TIMEOUT = "10s";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateRow {
  id: string;
  name: string;
  prompt: string;
  vote_type: string;
  display_order: number;
  status: "active" | "archived";
  is_default: boolean;
  first_session_description: string | null;
}

export interface MaintenanceActor {
  userId: string;
  role: string;
  ip: string;
}

export interface MaintenanceContext {
  log: FastifyBaseLogger;
  correlationId: string;
}

export type MaintenanceWrite =
  | {
      kind: "add";
      input: { name: string; prompt: string; firstSessionDescription: string; voteType: DefaultVoteType };
    }
  | {
      kind: "edit";
      topicId: string;
      /** Already validated and trimmed; only the keys the caller supplied. */
      fields: Partial<Record<TextField, string>>;
      /** Already validated; compared with the stored value inside the lock. */
      voteType?: DefaultVoteType;
    }
  | { kind: "archive"; topicId: string }
  | { kind: "restore"; topicId: string }
  | { kind: "reorder"; order: string[] };

export interface TemplateDefaultView {
  id: string;
  name: string;
  prompt: string;
  voteType: string;
  firstSessionDescription: string | null;
  status: "active" | "archived";
  displayOrder: number | null;
  lastChangedAt: string | null;
  lastChangedBy: { userId: string; displayName: string } | null;
}

export interface TemplateList {
  defaults: TemplateDefaultView[];
  limits: typeof DEFAULT_LIMITS;
  orderLastChangedAt: string | null;
}

export interface MaintenanceWriteResult {
  unchanged: boolean;
  operation: MaintenanceOperation;
  /** Present for add, edit, archive and restore. */
  changedTopicId?: string;
  /** True when the edit changed the name. */
  renamed: boolean;
  /** null when the post-commit list read failed after the write committed. */
  list: TemplateList | null;
}

/** Thrown when the post-write backstop (design E6) finds the operation produced a bad state. */
export class BackstopError extends Error {
  readonly invariant: string;
  constructor(invariant: string) {
    super(`default topic invariant violated: ${invariant}`);
    this.name = "BackstopError";
    this.invariant = invariant;
  }
}

// ---------------------------------------------------------------------------
// Row reads (inside the lock)
// ---------------------------------------------------------------------------

async function readTemplateRows(client: PoolClient): Promise<TemplateRow[]> {
  const result = await client.query<TemplateRow>(
    `SELECT id, name, prompt, vote_type, display_order, status, is_default, first_session_description
       FROM topics WHERE team_id = $1 ORDER BY display_order, id`,
    [DEFAULT_TOPICS_TEAM_ID],
  );
  return result.rows;
}

function activeDefaults(rows: readonly TemplateRow[]): TemplateRow[] {
  return rows.filter((r) => r.is_default && r.status === "active");
}

// ---------------------------------------------------------------------------
// Dense normalization (design E5): active defaults renumbered 1..N by
// negate-then-set, so a pre-existing gap is repaired by normal use and the
// partial unique index topics_team_active_order never sees an intermediate
// collision.
// ---------------------------------------------------------------------------

interface Renumbered {
  topicId: string;
  from: number;
  to: number;
}

async function setActivePositions(client: PoolClient, orderedIds: readonly string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const phase1 = await client.query(
    `UPDATE topics t
        SET display_order = -v.pos, updated_at = now()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS v(id, pos)
      WHERE t.id = v.id AND t.team_id = $1 AND t.status = 'active'`,
    [DEFAULT_TOPICS_TEAM_ID, orderedIds],
  );
  if (phase1.rowCount !== orderedIds.length) throw new BackstopError("position write touched an unexpected row count");
  const phase2 = await client.query(
    `UPDATE topics SET display_order = -display_order, updated_at = now()
      WHERE team_id = $1 AND status = 'active' AND display_order < 0`,
    [DEFAULT_TOPICS_TEAM_ID],
  );
  if (phase2.rowCount !== orderedIds.length) throw new BackstopError("position write touched an unexpected row count");
}

/**
 * The single dense-normalization helper. Takes the desired order of the
 * active defaults; renumbers 1..N only when the stored positions are not
 * already exactly that. Returns the rows whose position changed.
 */
async function normalizeActive(
  client: PoolClient,
  desired: ReadonlyArray<{ id: string; display_order: number }>,
): Promise<Renumbered[]> {
  const changed: Renumbered[] = [];
  desired.forEach((row, i) => {
    if (row.display_order !== i + 1) changed.push({ topicId: row.id, from: row.display_order, to: i + 1 });
  });
  if (changed.length === 0) return [];
  await setActivePositions(
    client,
    desired.map((r) => r.id),
  );
  return changed;
}

// ---------------------------------------------------------------------------
// Operations. Each returns { unchanged: true } or the audit payload.
// ---------------------------------------------------------------------------

interface OpEffect {
  unchanged: false;
  operation: MaintenanceOperation;
  topicId?: string;
  changedFields: string[];
  before: unknown;
  after: unknown;
  renamed?: boolean;
  /** Rows inserted or edited by this operation: re-validated by the backstop. */
  validateIds: string[];
  /**
   * True for the operations that renumber the active set (add, archive,
   * restore, reorder): only they are held to "positions exactly 1..N". An
   * edit does not touch positions, so pre-existing damage never blocks it.
   */
  checkPositions: boolean;
}
type OpOutcome = { unchanged: true; topicId?: string } | OpEffect;

function requireDefault(rows: readonly TemplateRow[], topicId: string): TemplateRow {
  const row = rows.find((r) => r.id === topicId && r.is_default);
  if (!row) throw new MaintenanceError("DEFAULT_TOPIC_NOT_FOUND");
  return row;
}

function findNameConflict(rows: readonly TemplateRow[], name: string, exceptId?: string): TemplateRow | undefined {
  const key = nameKey(name);
  return activeDefaults(rows).find((r) => r.id !== exceptId && nameKey(r.name) === key);
}

async function opAdd(
  client: PoolClient,
  rows: TemplateRow[],
  op: Extract<MaintenanceWrite, { kind: "add" }>,
): Promise<OpOutcome> {
  const { name, prompt, firstSessionDescription, voteType } = op.input;
  const active = activeDefaults(rows);
  if (active.length >= MAX_ACTIVE_DEFAULTS) throw new MaintenanceError("TEMPLATE_AT_CAPACITY");
  if (findNameConflict(rows, name)) throw new MaintenanceError("DEFAULT_NAME_DUPLICATE", { field: "name" });

  // MAX over every active template row (not the count): on a gapped template
  // the count would collide with the unique index.
  const position = Math.max(0, ...rows.filter((r) => r.status === "active").map((r) => r.display_order)) + 1;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO topics
       (team_id, name, prompt, vote_type, display_order, status, is_default, first_session_description)
     VALUES ($1, $2, $3, $4::vote_type, $5, 'active', true, $6)
     RETURNING id`,
    [DEFAULT_TOPICS_TEAM_ID, name, prompt, voteType, position, firstSessionDescription],
  );
  const id = (inserted.rows[0] as { id: string }).id;

  const before = activeDefaults(rows);
  const renumbered = await normalizeActive(client, [...before, { id, display_order: position }]);
  const finalPosition = before.length + 1;

  return {
    unchanged: false,
    operation: "topic.default_added",
    topicId: id,
    changedFields: ["name", "prompt", "firstSessionDescription"],
    before: null,
    after: {
      name,
      prompt,
      firstSessionDescription,
      voteType,
      status: "active",
      displayOrder: finalPosition,
      ...(renumbered.length > 0 ? { renumbered: renumbered.filter((r) => r.topicId !== id) } : {}),
    },
    validateIds: [id],
    checkPositions: true,
  };
}

async function opEdit(
  client: PoolClient,
  rows: TemplateRow[],
  op: Extract<MaintenanceWrite, { kind: "edit" }>,
): Promise<OpOutcome> {
  const row = requireDefault(rows, op.topicId);
  if (row.status === "archived") throw new MaintenanceError("DEFAULT_ARCHIVED");
  if (op.voteType !== undefined && op.voteType !== row.vote_type) {
    throw new MaintenanceError("DEFAULT_VOTE_TYPE_IMMUTABLE", { field: "voteType" });
  }

  const stored: Record<TextField, string | null> = {
    name: row.name,
    prompt: row.prompt,
    firstSessionDescription: row.first_session_description,
  };
  const changedFields = (Object.keys(op.fields) as TextField[]).filter(
    (f) => op.fields[f] !== undefined && op.fields[f] !== stored[f],
  );
  if (changedFields.length === 0) return { unchanged: true, topicId: row.id };

  const newName = op.fields.name;
  if (changedFields.includes("name") && newName !== undefined && findNameConflict(rows, newName, row.id)) {
    throw new MaintenanceError("DEFAULT_NAME_DUPLICATE", { field: "name" });
  }

  const next = {
    name: changedFields.includes("name") ? (op.fields.name as string) : row.name,
    prompt: changedFields.includes("prompt") ? (op.fields.prompt as string) : row.prompt,
    firstSessionDescription: changedFields.includes("firstSessionDescription")
      ? (op.fields.firstSessionDescription as string)
      : row.first_session_description,
  };
  await client.query(
    `UPDATE topics SET name = $3, prompt = $4, first_session_description = $5, updated_at = now()
      WHERE id = $1 AND team_id = $2`,
    [row.id, DEFAULT_TOPICS_TEAM_ID, next.name, next.prompt, next.firstSessionDescription],
  );

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const f of changedFields) {
    before[f] = stored[f];
    after[f] = op.fields[f];
  }
  return {
    unchanged: false,
    operation: "topic.default_edited",
    topicId: row.id,
    changedFields,
    before,
    after,
    renamed: changedFields.includes("name"),
    validateIds: [row.id],
    checkPositions: false,
  };
}

async function opArchive(
  client: PoolClient,
  rows: TemplateRow[],
  op: Extract<MaintenanceWrite, { kind: "archive" }>,
  actor: MaintenanceActor,
): Promise<OpOutcome> {
  const row = requireDefault(rows, op.topicId);
  if (row.status === "archived") throw new MaintenanceError("DEFAULT_ALREADY_ARCHIVED");
  const active = activeDefaults(rows);
  if (active.length <= MIN_ACTIVE_DEFAULTS) throw new MaintenanceError("LAST_ACTIVE_DEFAULT");

  await client.query(
    `UPDATE topics SET status = 'archived', archived_at = now(), archived_by = $3, updated_at = now()
      WHERE id = $1 AND team_id = $2`,
    [row.id, DEFAULT_TOPICS_TEAM_ID, actor.userId],
  );
  const renumbered = await normalizeActive(
    client,
    active.filter((r) => r.id !== row.id),
  );
  return {
    unchanged: false,
    operation: "topic.default_archived",
    topicId: row.id,
    changedFields: ["status", "displayOrder"],
    before: { status: "active", displayOrder: row.display_order },
    after: { status: "archived", displayOrder: null, renumbered },
    validateIds: [],
    checkPositions: true,
  };
}

async function opRestore(
  client: PoolClient,
  rows: TemplateRow[],
  op: Extract<MaintenanceWrite, { kind: "restore" }>,
  actor: MaintenanceActor,
): Promise<OpOutcome> {
  const row = requireDefault(rows, op.topicId);
  if (row.status === "active") throw new MaintenanceError("DEFAULT_ALREADY_ACTIVE");
  const active = activeDefaults(rows);
  if (active.length >= MAX_ACTIVE_DEFAULTS) throw new MaintenanceError("TEMPLATE_AT_CAPACITY");
  const conflict = findNameConflict(rows, row.name);
  if (conflict) {
    throw new MaintenanceError("DEFAULT_NAME_DUPLICATE", {
      field: "name",
      conflictingTopicId: conflict.id,
      conflictingName: conflict.name,
    });
  }

  const position = Math.max(0, ...rows.filter((r) => r.status === "active").map((r) => r.display_order)) + 1;
  await client.query(
    `UPDATE topics SET status = 'active', display_order = $3, restored_at = now(), restored_by = $4, updated_at = now()
      WHERE id = $1 AND team_id = $2`,
    [row.id, DEFAULT_TOPICS_TEAM_ID, position, actor.userId],
  );
  const renumbered = await normalizeActive(client, [...active, { id: row.id, display_order: position }]);
  return {
    unchanged: false,
    operation: "topic.default_restored",
    topicId: row.id,
    changedFields: ["status", "displayOrder"],
    before: { status: "archived", displayOrder: null },
    after: {
      status: "active",
      displayOrder: active.length + 1,
      ...(renumbered.length > 0 ? { renumbered: renumbered.filter((r) => r.topicId !== row.id) } : {}),
    },
    validateIds: [],
    checkPositions: true,
  };
}

async function opReorder(
  client: PoolClient,
  rows: TemplateRow[],
  op: Extract<MaintenanceWrite, { kind: "reorder" }>,
): Promise<OpOutcome> {
  const active = activeDefaults(rows);
  const activeIds = new Set(active.map((r) => r.id));
  const given = new Set(op.order);
  if (given.size !== op.order.length) throw new MaintenanceError("INVALID_DEFAULT_ORDER");
  if (op.order.length !== activeIds.size || op.order.some((id) => !activeIds.has(id))) {
    throw new MaintenanceError("REORDER_ID_MISMATCH");
  }

  const current = active.map((r) => r.id);
  const sameOrder = current.every((id, i) => id === op.order[i]);
  const dense = active.every((r, i) => r.display_order === i + 1);
  if (sameOrder && dense) return { unchanged: true };

  await setActivePositions(client, op.order);
  return {
    unchanged: false,
    operation: "topic.default_reordered",
    changedFields: ["order"],
    before: current,
    after: [...op.order],
    validateIds: [],
    checkPositions: true,
  };
}

// ---------------------------------------------------------------------------
// Post-write invariant backstop (design E6)
// ---------------------------------------------------------------------------

async function runBackstop(client: PoolClient, effect: OpEffect): Promise<void> {
  const rows = await readTemplateRows(client);
  const active = activeDefaults(rows).sort((a, b) => a.display_order - b.display_order);
  if (active.length < MIN_ACTIVE_DEFAULTS) throw new BackstopError("at least one active default");
  if (active.length > MAX_ACTIVE_DEFAULTS) throw new BackstopError("at most 15 active defaults");
  if (effect.checkPositions && active.some((r, i) => r.display_order !== i + 1)) {
    throw new BackstopError("active positions are exactly 1..N");
  }
  for (const id of effect.validateIds) {
    const row = rows.find((r) => r.id === id);
    if (!row || findDefaultRowViolation(row) !== null) throw new BackstopError("touched rows pass field validation");
  }
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

function sqlstateOf(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Runs one maintenance write. Throws MaintenanceError for every expected
 * rejection (including a lock or statement timeout, as
 * DEFAULT_MAINTENANCE_BUSY); BackstopError, AuditWriteError and raw database
 * errors propagate for the route's generic 500.
 *
 * After COMMIT it reads the refreshed list with readTemplateList (the same
 * function the GET uses) and emits the identifiers-only `info` event: a write
 * that rolled back therefore never logs.
 */
export async function writeTemplateTopics(
  op: MaintenanceWrite,
  actor: MaintenanceActor,
  ctx: MaintenanceContext,
): Promise<MaintenanceWriteResult> {
  let outcome: OpOutcome;
  try {
    outcome = await withAuditTransaction<OpOutcome>(
      async (client) => {
        // Transaction-scoped. withAuditTransaction's own statement_timeout
        // covers only the audit INSERT; without these a stuck transaction
        // would block every maintenance write indefinitely.
        await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
        await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
        await lockTeamTopics(client, DEFAULT_TOPICS_TEAM_ID);
        const rows = await readTemplateRows(client);

        let result: OpOutcome;
        switch (op.kind) {
          case "add":
            result = await opAdd(client, rows, op);
            break;
          case "edit":
            result = await opEdit(client, rows, op);
            break;
          case "archive":
            result = await opArchive(client, rows, op, actor);
            break;
          case "restore":
            result = await opRestore(client, rows, op, actor);
            break;
          case "reorder":
            result = await opReorder(client, rows, op);
            break;
        }
        if (!result.unchanged) await runBackstop(client, result);
        return result;
      },
      async (client, result) => {
        if (result.unchanged) return;
        const metadata: Record<string, unknown> = {
          ...(result.topicId !== undefined ? { topicId: result.topicId } : {}),
          operation: result.operation,
          changedFields: result.changedFields,
          before: result.before,
          after: result.after,
        };
        await client.query(
          `INSERT INTO audit_log
             (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [actor.userId, actor.role, actor.ip, result.operation, DEFAULT_TOPICS_TEAM_ID, JSON.stringify(metadata)],
        );
      },
    );
  } catch (err) {
    const code = sqlstateOf(err);
    if (!(err instanceof MaintenanceError) && (code === "55P03" || code === "57014")) {
      throw new MaintenanceError("DEFAULT_MAINTENANCE_BUSY");
    }
    throw err;
  }

  // Committed: a failing read must not turn the write into an error (a retry would hit a duplicate).
  const list = await readTemplateList().catch((err: unknown) => {
    ctx.log.error({ err, correlationId: ctx.correlationId }, "default topic list read after commit failed");
    return null;
  });

  if (outcome.unchanged) {
    return { unchanged: true, operation: noOpOperation(op), renamed: false, list, ...(outcome.topicId ? { changedTopicId: outcome.topicId } : {}) };
  }

  // After commit; a failure to log can never turn the committed write into a 5xx.
  try {
    emitAuditEvent(ctx.log, outcome.operation, {
      operation: outcome.operation,
      ...(outcome.topicId !== undefined ? { topicId: outcome.topicId } : {}),
      changedFields: outcome.changedFields,
      actorUserId: actor.userId,
      actorGlobalRole: actor.role,
      actorIp: actor.ip,
      correlationId: ctx.correlationId,
    });
  } catch (err) {
    ctx.log.error({ err, correlationId: ctx.correlationId }, "default topic maintenance event emit failed");
  }

  return {
    unchanged: false,
    operation: outcome.operation,
    renamed: outcome.renamed === true,
    list,
    ...(outcome.topicId !== undefined ? { changedTopicId: outcome.topicId } : {}),
  };
}

function noOpOperation(op: MaintenanceWrite): MaintenanceOperation {
  switch (op.kind) {
    case "add":
      return "topic.default_added";
    case "edit":
      return "topic.default_edited";
    case "archive":
      return "topic.default_archived";
    case "restore":
      return "topic.default_restored";
    case "reorder":
      return "topic.default_reordered";
  }
}

// ---------------------------------------------------------------------------
// Reads: the list (with derived lastChangedAt/By) and the history
// ---------------------------------------------------------------------------

/** audit_log columns for one maintenance row, as selected by the two reads. */
interface LastChangeRow {
  topic_id: string;
  at: Date;
  actor_user_id: string;
  display_name: string | null;
}

/**
 * The full template list: active defaults by position, then archived ones.
 * lastChangedAt/By come from ONE DISTINCT ON query over the latest
 * added/edited/archived/restored audit row per topicId (reorders never count);
 * orderLastChangedAt from the latest reorder row. The sentinel's other audit
 * rows are few, so the unindexed metadata->>'topicId' sort is fine here.
 */
export async function readTemplateList(): Promise<TemplateList> {
  const rowsResult = await db.query<TemplateRow>(
    `SELECT id, name, prompt, vote_type, display_order, status, is_default, first_session_description
       FROM topics WHERE team_id = $1 AND is_default = true
      ORDER BY (status = 'active') DESC,
               CASE WHEN status = 'active' THEN display_order END ASC,
               archived_at DESC NULLS LAST, id`,
    [DEFAULT_TOPICS_TEAM_ID],
  );
  const changeOps = MAINTENANCE_AUDIT_OPERATIONS.filter((o) => o !== "topic.default_reordered");
  const changes = await db.query<LastChangeRow>(
    `SELECT DISTINCT ON (a.metadata->>'topicId')
            a.metadata->>'topicId' AS topic_id, a."timestamp" AS at, a.actor_user_id, u.display_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.team_id = $1 AND a.operation = ANY($2::text[])
      ORDER BY a.metadata->>'topicId', a."timestamp" DESC, a.id DESC`,
    [DEFAULT_TOPICS_TEAM_ID, changeOps],
  );
  const reorder = await db.query<{ at: Date }>(
    `SELECT "timestamp" AS at FROM audit_log
      WHERE team_id = $1 AND operation = 'topic.default_reordered'
      ORDER BY "timestamp" DESC, id DESC LIMIT 1`,
    [DEFAULT_TOPICS_TEAM_ID],
  );
  const lastByTopic = new Map(changes.rows.map((c) => [c.topic_id, c]));

  const defaults: TemplateDefaultView[] = rowsResult.rows.map((r) => {
    const change = lastByTopic.get(r.id);
    return {
      id: r.id,
      name: r.name,
      prompt: r.prompt,
      voteType: r.vote_type,
      firstSessionDescription: r.first_session_description,
      status: r.status,
      // From status, never the stored column: an archived row keeps a stale number.
      displayOrder: r.status === "active" ? r.display_order : null,
      lastChangedAt: change ? change.at.toISOString() : null,
      lastChangedBy: change
        ? { userId: change.actor_user_id, displayName: change.display_name ?? "" }
        : null,
    };
  });
  const orderRow = reorder.rows[0];
  return {
    defaults,
    limits: DEFAULT_LIMITS,
    orderLastChangedAt: orderRow ? orderRow.at.toISOString() : null,
  };
}

export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 200;

/** Parses the `limit` query value: absent 50, 1..200 as given, above 200 clamped, else 422. */
export function parseHistoryLimit(raw: unknown): number {
  if (raw === undefined) return HISTORY_DEFAULT_LIMIT;
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw)) throw new MaintenanceError("INVALID_HISTORY_LIMIT");
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new MaintenanceError("INVALID_HISTORY_LIMIT");
  return Math.min(n, HISTORY_MAX_LIMIT);
}

export interface HistoryEntry {
  id: string;
  operation: string;
  at: string;
  actor: { userId: string; displayName: string };
  topicId: string | null;
  changedFields: string[];
  before: unknown;
  after: unknown;
}

/** Newest-first maintenance audit rows; ties by id descending. Excludes every other operation. */
export async function readTemplateHistory(limit: number): Promise<HistoryEntry[]> {
  const result = await db.query<{
    id: string;
    operation: string;
    at: Date;
    actor_user_id: string;
    display_name: string | null;
    metadata: { topicId?: string; changedFields?: string[]; before?: unknown; after?: unknown } | null;
  }>(
    `SELECT a.id, a.operation, a."timestamp" AS at, a.actor_user_id, u.display_name, a.metadata
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.team_id = $1 AND a.operation = ANY($2::text[])
      ORDER BY a."timestamp" DESC, a.id DESC
      LIMIT $3`,
    [DEFAULT_TOPICS_TEAM_ID, [...MAINTENANCE_AUDIT_OPERATIONS], limit],
  );
  return result.rows.map((r) => ({
    id: r.id,
    operation: r.operation,
    at: r.at.toISOString(),
    actor: { userId: r.actor_user_id, displayName: r.display_name ?? "" },
    topicId: r.metadata?.topicId ?? null,
    changedFields: r.metadata?.changedFields ?? [],
    before: r.metadata?.before ?? null,
    after: r.metadata?.after ?? null,
  }));
}
