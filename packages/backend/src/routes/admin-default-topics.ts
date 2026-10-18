import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db.js";
import { AuditWriteError } from "../auth/errors.js";
import { isApplicationAdmin } from "../auth/role-map.js";
import { recordMaintenanceDenial } from "../auth/default-maintenance-denial-audit.js";
import type { SessionData } from "../auth/session-store.js";
import { applyTimingFloor } from "../content/timing-oracle.js";
import {
  BackstopError,
  MAX_ACTIVE_DEFAULTS,
  MaintenanceError,
  RENAME_NOTICE,
  SCOPE_STATEMENT,
  parseHistoryLimit,
  readTemplateHistory,
  readTemplateList,
  validateTextField,
  validateVoteType,
  writeTemplateTopics,
  type MaintenanceErrorCode,
  type MaintenanceWrite,
  type TextField,
} from "../sessions/default-topic-maintenance.js";
import { DEFAULT_TOPICS_TEAM_ID } from "../sessions/default-topics.js";
import { buildErrorEnvelope, type ErrorCategory, type ErrorEnvelope } from "./error-envelope.js";
import type { TopicWriteDenialContext } from "./topic-write-context.js";
import { enforceTopicWriteRateLimit } from "./topic-write-rate-limit.js";
import { isCanonicalUuid } from "./uuid.js";

// ---------------------------------------------------------------------------
// /api/v1/admin/default-topics -- admin-default-topic-maintenance (#216)
// design.md E1/E2/E3/E4/E7.
//
// Seven routes, application_admin only, that maintain the sentinel template
// (the default topic set copied into NEW teams). No route takes a team id.
// This file never writes SQL: every template write goes through
// sessions/default-topic-maintenance.ts, the one sanctioned writer.
//
// Check order for every route, stopping at the first failure (E2):
//   1. session authentication (authMiddleware, 401);
//   2. live role read, 403 DEFAULT_MAINTENANCE_ADMIN_ONLY (all seven routes,
//      reads included; fail-open bounded denial audit);
//   2a. body media type must be application/json on the body-carrying routes
//       (415). Fastify's built-in parser accepts text/plain, so this is
//       checked here rather than relied on;
//   3. non-canonical :topicId, 404 DEFAULT_TOPIC_NOT_FOUND, no query;
//   4. the shared topic-write rate limit (the five write routes only);
//   5. body and field validation, 422, before any database work;
//   6. one transaction in the writer.
// applyTimingFloor runs on every return.
// ---------------------------------------------------------------------------

const BASE = "/api/v1/admin/default-topics";
const BODY_LIMIT = 16 * 1024;

/**
 * CSRF control for every mutating route in the family (security read S-A). Archive and restore take
 * no body, so no media-type check protects them; SameSite=Strict alone is site-scoped, not
 * origin-scoped. A request carrying a custom header cannot be sent cross-origin without a CORS
 * preflight, and the preflight is only granted to the allow-listed origin (app.ts allowedHeaders
 * includes this header). No such convention existed in the app; this is the first.
 */
export const MUTATION_CONTROL_HEADER = "x-requested-with";
export const MUTATION_CONTROL_VALUE = "dipstick";
const MUTATION_CONTROL_MESSAGE = "This request must be sent by the Dipstick client (missing or wrong X-Requested-With header).";

const NOT_ADMIN_MESSAGE = "Only an application administrator can maintain the default topics.";
const GENERIC_FAILURE_MESSAGE = "Something went wrong updating the default topics. Try again.";
const BUSY_MESSAGE = "Another change to the default topics is in progress. Try again in a moment.";
const BUSY_RETRY_AFTER_SECONDS = 3;
const MISMATCH_MESSAGE = "The default topics changed while you were editing. Reload the list and try again.";

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  prompt: "prompt",
  firstSessionDescription: "first-session description",
  voteType: "vote type",
  body: "request body",
};

interface ErrorRow {
  status: number;
  category: ErrorCategory;
  message: (detail: { field?: string | undefined; max?: number | undefined }) => string;
}

const label = (field?: string): string => FIELD_LABELS[field ?? ""] ?? "value";

/** Design E3/E4: every typed outcome and its status, category and fixed message. Never echoes a value. */
const ERROR_TABLE: Record<MaintenanceErrorCode, ErrorRow> = {
  DEFAULT_FIELD_REQUIRED: { status: 422, category: "invalid_request", message: (d) => `The ${label(d.field)} is required.` },
  DEFAULT_FIELD_TOO_LONG: {
    status: 422,
    category: "invalid_request",
    message: (d) => `The ${label(d.field)} must be at most ${d.max} characters.`,
  },
  PROMPT_FORMAT_INVALID: {
    status: 422,
    category: "invalid_request",
    message: (d) =>
      `The ${label(d.field)} must be plain text: no HTML, HTML entities, links, or control or invisible characters.`,
  },
  DEFAULT_VOTE_TYPE_INVALID: {
    status: 422,
    category: "invalid_request",
    message: () => "The vote type must be one of finger, roman, modified_roman.",
  },
  DEFAULT_VOTE_TYPE_IMMUTABLE: {
    status: 422,
    category: "invalid_request",
    message: () => "The vote type of a default topic cannot be changed after it is created.",
  },
  DEFAULT_NAME_DUPLICATE: {
    status: 409,
    category: "precondition_failed",
    message: () => "Another active default topic already has this name.",
  },
  INVALID_HISTORY_LIMIT: {
    status: 422,
    category: "invalid_request",
    message: () => "The limit must be a whole number of at least 1.",
  },
  TEMPLATE_AT_CAPACITY: {
    status: 409,
    category: "precondition_failed",
    message: () => `The default topic set already has the maximum of ${MAX_ACTIVE_DEFAULTS} active topics. Archive one first.`,
  },
  LAST_ACTIVE_DEFAULT: {
    status: 409,
    category: "precondition_failed",
    message: () => "The last active default topic cannot be archived.",
  },
  REORDER_ID_MISMATCH: { status: 409, category: "precondition_failed", message: () => MISMATCH_MESSAGE },
  INVALID_DEFAULT_ORDER: {
    status: 422,
    category: "invalid_request",
    message: () => "The order must list each active default topic id exactly once.",
  },
  DEFAULT_TOPIC_NOT_FOUND: { status: 404, category: "not_found", message: () => "Default topic not found." },
  DEFAULT_ARCHIVED: {
    status: 409,
    category: "precondition_failed",
    message: () => "This default topic is archived. Restore it first.",
  },
  DEFAULT_ALREADY_ARCHIVED: {
    status: 422,
    category: "invalid_request",
    message: () => "This default topic is already archived.",
  },
  DEFAULT_ALREADY_ACTIVE: {
    status: 422,
    category: "invalid_request",
    message: () => "This default topic is already active.",
  },
  DEFAULT_MAINTENANCE_BUSY: { status: 503, category: "service_unavailable", message: () => BUSY_MESSAGE },
};

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

async function send(
  reply: FastifyReply,
  startTime: number,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<FastifyReply> {
  await applyTimingFloor(startTime);
  for (const [k, v] of Object.entries(headers)) reply.header(k, v);
  return reply.code(status).send(body);
}

function withExtras(envelope: ErrorEnvelope, extras: Record<string, unknown>): ErrorEnvelope {
  return { error: { ...envelope.error, ...extras } };
}

async function sendMaintenanceError(
  request: FastifyRequest,
  reply: FastifyReply,
  startTime: number,
  err: unknown,
): Promise<FastifyReply> {
  if (err instanceof MaintenanceError) {
    const row = ERROR_TABLE[err.code];
    const { field, max, conflictingTopicId, conflictingName } = err.detail;
    let envelope = buildErrorEnvelope(row.category, row.message({ field, max }), err.code, field);
    const extras: Record<string, unknown> = {};
    if (max !== undefined) extras["max"] = max;
    if (conflictingTopicId !== undefined) extras["conflictingTopicId"] = conflictingTopicId;
    if (conflictingName !== undefined) extras["conflictingName"] = conflictingName;
    if (err.code === "REORDER_ID_MISMATCH") {
      // The list to reload. Read after the failed transaction rolled back.
      const list = await readTemplateList().catch(() => null);
      if (list) extras["current"] = list.defaults.filter((d) => d.status === "active");
    }
    if (Object.keys(extras).length > 0) envelope = withExtras(envelope, extras);
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (err.code === "DEFAULT_MAINTENANCE_BUSY") {
      headers["Retry-After"] = String(BUSY_RETRY_AFTER_SECONDS);
      request.log.warn({ correlationId: envelope.error.correlationId }, "default topic maintenance busy");
    }
    return send(reply, startTime, row.status, envelope, headers);
  }

  // Everything else is the generic 500. The raw error is logged, never sent.
  const envelope = buildErrorEnvelope("internal_error", GENERIC_FAILURE_MESSAGE, "DEFAULT_MAINTENANCE_FAILED");
  const correlationId = envelope.error.correlationId;
  if (err instanceof BackstopError) {
    request.log.error({ invariant: err.invariant, correlationId }, "default topic maintenance invariant backstop failed");
  } else if (err instanceof AuditWriteError) {
    request.log.error({ err, correlationId }, "default topic maintenance audit write failed");
  } else if ((err as { code?: unknown } | null)?.code === "23505") {
    request.log.error(
      { constraint: (err as { constraint?: string }).constraint, correlationId },
      "default topic maintenance unique violation",
    );
  } else {
    request.log.error({ err, correlationId }, "default topic maintenance failed");
  }
  return send(reply, startTime, 500, envelope, { "Cache-Control": "no-store" });
}

// ---------------------------------------------------------------------------
// Authorization (design E2 step 2): live role, application_admin only
// ---------------------------------------------------------------------------

/**
 * The administrator the plugin's preParsing hook admitted, by request. The role is read ONCE per
 * request, before the body is parsed (Fastify's lifecycle is onRequest, preParsing, body parse,
 * preValidation, handler), so a non-admin always gets the envelope 403 with the timing floor and
 * the denial audit row, whatever the body (oversize, malformed, wrong media type).
 */
const admittedAdmin = new WeakMap<FastifyRequest, string>();

async function admitAdminOrRefuse(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const startTime = Date.now();
  reply.header("Cache-Control", "no-store");
  const session = request.session as unknown as SessionData;
  let globalRole: string | null;
  try {
    const result = await db.query<{ global_role: string }>(`SELECT global_role FROM users WHERE id = $1`, [session.userId]);
    globalRole = result.rows[0]?.global_role ?? null;
  } catch (err) {
    // Fail closed, with the generic envelope and no driver text.
    await sendMaintenanceError(request, reply, startTime, err);
    return false;
  }
  if (isApplicationAdmin(globalRole)) {
    // After the role check, so a non-admin still gets the 403 first. The received value is not echoed.
    if (request.method !== "GET" && request.headers[MUTATION_CONTROL_HEADER] !== MUTATION_CONTROL_VALUE) {
      await send(
        reply,
        startTime,
        403,
        buildErrorEnvelope("forbidden", MUTATION_CONTROL_MESSAGE, "MUTATION_CONTROL_HEADER_REQUIRED"),
        { "Cache-Control": "no-store" },
      );
      return false;
    }
    admittedAdmin.set(request, session.userId);
    return true;
  }

  const envelope = buildErrorEnvelope("forbidden", NOT_ADMIN_MESSAGE, "DEFAULT_MAINTENANCE_ADMIN_ONLY");
  await recordMaintenanceDenial({
    log: request.log,
    actorUserId: session.userId,
    actorGlobalRole: globalRole,
    actorIp: request.ip,
    method: request.method,
    routeTemplate: request.routeOptions?.url ?? BASE,
    correlationId: envelope.error.correlationId,
  });
  await send(reply, startTime, 403, envelope, { "Cache-Control": "no-store" });
  return false;
}

function routeTemplateOf(request: FastifyRequest, fallback: string): string {
  return request.routeOptions?.url ?? fallback;
}

function isJsonContentType(request: FastifyRequest): boolean {
  const header = request.headers["content-type"];
  if (header === undefined) return true; // no body media type declared: nothing to refuse
  return header.split(";")[0]!.trim().toLowerCase() === "application/json";
}

// ---------------------------------------------------------------------------
// Request parsing (validation, step 5): pure, before any database work
// ---------------------------------------------------------------------------

function asObject(body: unknown, allowAbsent: boolean): Record<string, unknown> {
  if (body === undefined || body === null) {
    if (allowAbsent) return {};
    throw new MaintenanceError("DEFAULT_FIELD_REQUIRED", { field: "body" });
  }
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new MaintenanceError("DEFAULT_FIELD_REQUIRED", { field: "body" });
  }
  return body as Record<string, unknown>;
}

function parseAdd(body: unknown): MaintenanceWrite {
  const b = asObject(body, false);
  // Explicit picking: the body is never spread.
  const name = validateTextField("name", b["name"]);
  const prompt = validateTextField("prompt", b["prompt"]);
  const firstSessionDescription = validateTextField("firstSessionDescription", b["firstSessionDescription"]);
  const voteType = validateVoteType(b["voteType"]);
  return { kind: "add", input: { name, prompt, firstSessionDescription, voteType } };
}

const EDITABLE_FIELDS: readonly TextField[] = ["name", "prompt", "firstSessionDescription"];

function parseEdit(topicId: string, body: unknown): MaintenanceWrite {
  const b = asObject(body, true);
  const fields: Partial<Record<TextField, string>> = {};
  for (const field of EDITABLE_FIELDS) {
    if (b[field] !== undefined) fields[field] = validateTextField(field, b[field]);
  }
  const voteType = b["voteType"] !== undefined ? validateVoteType(b["voteType"]) : undefined;
  return { kind: "edit", topicId, fields, ...(voteType !== undefined ? { voteType } : {}) };
}

function parseReorder(body: unknown): MaintenanceWrite {
  const invalid = () => new MaintenanceError("INVALID_DEFAULT_ORDER");
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw invalid();
  const order = (body as Record<string, unknown>)["order"];
  if (!Array.isArray(order)) throw invalid();
  // Length first: nothing per-element runs on an over-long array.
  if (order.length > MAX_ACTIVE_DEFAULTS || order.length === 0) throw invalid();
  const ids: string[] = [];
  for (const id of order) {
    if (!isCanonicalUuid(id)) throw invalid();
    ids.push(id.toLowerCase());
  }
  if (new Set(ids).size !== ids.length) throw invalid();
  return { kind: "reorder", order: ids };
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

export async function adminDefaultTopicRoutes(app: FastifyInstance): Promise<void> {
  // Role check BEFORE the body is read (security review M1). authMiddleware (onRequest) has
  // already answered 401; this answers 403 / generic 500 for the whole family.
  app.addHook("preParsing", async (request, reply, payload) => {
    if (!(await admitAdminOrRefuse(request, reply))) return reply as never;
    return payload;
  });

  // JSON bodies: Fastify's parser answers 400 to an EMPTY body with a JSON content type, which
  // breaks scripted archive/restore calls (those routes take no body). Tolerate an empty body
  // (it parses to undefined); any other parse failure is a 400 mapped to the envelope below.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.trim() === "") return done(null, undefined);
    if (text.includes('"__proto__"')) return done(Object.assign(new Error("invalid JSON"), { statusCode: 400, code: "INVALID_JSON_BODY" }));
    try {
      done(null, JSON.parse(text));
    } catch {
      done(Object.assign(new Error("invalid JSON"), { statusCode: 400, code: "INVALID_JSON_BODY" }));
    }
  });

  // Parser-level failures (admins only reach them) in the house envelope, with the timing floor and
  // no parser text. Anything else is the generic 500.
  app.setErrorHandler(async (err, request, reply) => {
    const startTime = Date.now();
    const code = (err as { code?: string }).code;
    const headers = { "Cache-Control": "no-store" };
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return send(reply, startTime, 413, buildErrorEnvelope("invalid_request", "The request body is too large.", "BODY_TOO_LARGE"), headers);
    }
    if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      return send(reply, startTime, 415, buildErrorEnvelope("invalid_request", "The request body must be application/json.", "UNSUPPORTED_MEDIA_TYPE"), headers);
    }
    if (code === "INVALID_JSON_BODY" || (typeof code === "string" && code.startsWith("FST_ERR_CTP_"))) {
      return send(reply, startTime, 400, buildErrorEnvelope("invalid_request", "The request body is not valid JSON.", "INVALID_JSON_BODY"), headers);
    }
    return sendMaintenanceError(request, reply, startTime, err);
  });

  /**
   * One write route's whole cascade. `parse` runs validation (step 5);
   * `bodyCarrying` routes also refuse a non-JSON media type (step 2a).
   */
  async function handleWrite(
    request: FastifyRequest,
    reply: FastifyReply,
    spec: {
      method: string;
      template: string;
      attemptedOperation: string;
      bodyCarrying: boolean;
      successStatus: 200 | 201;
      parse: (request: FastifyRequest, topicId: string | undefined) => MaintenanceWrite;
    },
  ): Promise<FastifyReply> {
    // Set once, first, so every exit carries it.
    reply.header("Cache-Control", "no-store");
    const startTime = Date.now();
    const template = routeTemplateOf(request, spec.template);

    const adminId = admittedAdmin.get(request);
    if (adminId === undefined) return reply; // unreachable: the preParsing hook refused already
    const auth = { userId: adminId };

    if (spec.bodyCarrying && !isJsonContentType(request)) {
      return send(
        reply,
        startTime,
        415,
        buildErrorEnvelope("invalid_request", "The request body must be application/json.", "UNSUPPORTED_MEDIA_TYPE"),
      );
    }

    const rawTopicId = (request.params as { topicId?: string }).topicId;
    let topicId: string | undefined;
    if (rawTopicId !== undefined) {
      if (!isCanonicalUuid(rawTopicId)) return sendMaintenanceError(request, reply, startTime, new MaintenanceError("DEFAULT_TOPIC_NOT_FOUND"));
      topicId = rawTopicId.toLowerCase();
    }

    const writeCtx: TopicWriteDenialContext = {
      actorUserId: auth.userId,
      actorGlobalRole: "application_admin",
      // The sentinel: the limiter's breach row carries it (team_verified stays false).
      teamId: DEFAULT_TOPICS_TEAM_ID,
      endpoint: `${spec.method} ${template}`,
      attemptedOperation: spec.attemptedOperation,
    };
    if ((await enforceTopicWriteRateLimit(request, reply, writeCtx, startTime)) === "rejected") return reply;

    let op: MaintenanceWrite;
    try {
      op = spec.parse(request, topicId);
    } catch (err) {
      return sendMaintenanceError(request, reply, startTime, err);
    }

    let result;
    try {
      result = await writeTemplateTopics(
        op,
        { userId: auth.userId, role: "application_admin", ip: request.ip },
        { log: request.log, correlationId: request.id },
      );
    } catch (err) {
      return sendMaintenanceError(request, reply, startTime, err);
    }

    // The write is committed. If the post-commit list read failed, say so rather than a 5xx that
    // would invite a retry of a change that already happened.
    const body = {
      ...(result.list ?? { listUnavailable: true }),
      scope: SCOPE_STATEMENT,
      ...(result.renamed ? { notice: RENAME_NOTICE } : {}),
      ...(result.changedTopicId !== undefined ? { changedTopicId: result.changedTopicId } : {}),
      ...(result.unchanged ? { unchanged: true } : {}),
    };
    return send(reply, startTime, spec.successStatus, body);
  }

  async function handleRead(
    request: FastifyRequest,
    reply: FastifyReply,
    template: string,
    run: () => Promise<unknown>,
  ): Promise<FastifyReply> {
    reply.header("Cache-Control", "no-store");
    const startTime = Date.now();
    if (!admittedAdmin.has(request)) return reply; // unreachable: the preParsing hook refused already
    void template;
    try {
      return send(reply, startTime, 200, await run());
    } catch (err) {
      return sendMaintenanceError(request, reply, startTime, err);
    }
  }

  // Registered before the :topicId routes. `order` and `history` are static
  // segments, so they never collide with a topic id.
  app.get(BASE, async (request, reply) => handleRead(request, reply, BASE, () => readTemplateList()));

  app.get(`${BASE}/history`, async (request, reply) =>
    handleRead(request, reply, `${BASE}/history`, async () => {
      const limit = parseHistoryLimit((request.query as Record<string, unknown> | undefined)?.["limit"]);
      return { history: await readTemplateHistory(limit) };
    }),
  );

  app.post(BASE, { bodyLimit: BODY_LIMIT }, async (request, reply) =>
    handleWrite(request, reply, {
      method: "POST",
      template: BASE,
      attemptedOperation: "topic.default_added",
      bodyCarrying: true,
      successStatus: 201,
      parse: (req) => parseAdd(req.body),
    }),
  );

  app.put(`${BASE}/order`, { bodyLimit: BODY_LIMIT }, async (request, reply) =>
    handleWrite(request, reply, {
      method: "PUT",
      template: `${BASE}/order`,
      attemptedOperation: "topic.default_reordered",
      bodyCarrying: true,
      successStatus: 200,
      parse: (req) => parseReorder(req.body),
    }),
  );

  app.patch(`${BASE}/:topicId`, { bodyLimit: BODY_LIMIT }, async (request, reply) =>
    handleWrite(request, reply, {
      method: "PATCH",
      template: `${BASE}/:topicId`,
      attemptedOperation: "topic.default_edited",
      bodyCarrying: true,
      successStatus: 200,
      parse: (req, topicId) => parseEdit(topicId as string, req.body),
    }),
  );

  app.post(`${BASE}/:topicId/archive`, { bodyLimit: BODY_LIMIT }, async (request, reply) =>
    handleWrite(request, reply, {
      method: "POST",
      template: `${BASE}/:topicId/archive`,
      attemptedOperation: "topic.default_archived",
      bodyCarrying: false,
      successStatus: 200,
      parse: (_req, topicId) => ({ kind: "archive", topicId: topicId as string }),
    }),
  );

  app.post(`${BASE}/:topicId/restore`, { bodyLimit: BODY_LIMIT }, async (request, reply) =>
    handleWrite(request, reply, {
      method: "POST",
      template: `${BASE}/:topicId/restore`,
      attemptedOperation: "topic.default_restored",
      bodyCarrying: false,
      successStatus: 200,
      parse: (_req, topicId) => ({ kind: "restore", topicId: topicId as string }),
    }),
  );
}
