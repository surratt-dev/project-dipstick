// ---------------------------------------------------------------------------
// Default-topic maintenance (#216): the fixed limits and the pure validators.
//
// design.md E4. Pure on purpose (no database, no config): the writer module
// (default-topic-maintenance.ts) re-exports everything here, and the CI-time
// template invariants checker (routes/__tests__/helpers/template-invariants.ts)
// imports it directly so the "every default row passes the field validation"
// invariant uses the same code the endpoints do.
//
// The plain-text rule is a narrow denylist, not a content filter and not the
// XSS control: the control is that every consumer renders template text as
// text (design E4a).
// ---------------------------------------------------------------------------

import type { AuditEventName } from "../auth/audit-logger.js";

/**
 * The five maintenance audit operations (lives here, in the pure module, so test files
 * that must not load db.js can select the rows; re-exported by default-topic-maintenance.ts).
 * Selected with `operation = ANY($n)`, never LIKE.
 */
export const MAINTENANCE_AUDIT_OPERATIONS = [
  "topic.default_added",
  "topic.default_edited",
  "topic.default_archived",
  "topic.default_restored",
  "topic.default_reordered",
] as const satisfies readonly AuditEventName[];

export type MaintenanceOperation = (typeof MAINTENANCE_AUDIT_OPERATIONS)[number];

export const MAX_ACTIVE_DEFAULTS = 15;
export const MIN_ACTIVE_DEFAULTS = 1;
export const NAME_MAX = 60;
export const PROMPT_MAX = 400;
export const DESCRIPTION_MAX = 800;

export const DEFAULT_LIMITS = {
  minActive: MIN_ACTIVE_DEFAULTS,
  maxActive: MAX_ACTIVE_DEFAULTS,
  nameMax: NAME_MAX,
  promptMax: PROMPT_MAX,
  descriptionMax: DESCRIPTION_MAX,
} as const;

export type TextField = "name" | "prompt" | "firstSessionDescription";

export const TEXT_FIELD_MAX: Record<TextField, number> = {
  name: NAME_MAX,
  prompt: PROMPT_MAX,
  firstSessionDescription: DESCRIPTION_MAX,
};

export const VOTE_TYPES = ["finger", "roman", "modified_roman"] as const;
export type DefaultVoteType = (typeof VOTE_TYPES)[number];

/**
 * Every typed failure the maintenance path can raise. The HTTP status and
 * category for each live in the route layer (routes/admin-default-topics.ts);
 * the writer and the validators only name the failure.
 */
export type MaintenanceErrorCode =
  | "DEFAULT_FIELD_REQUIRED"
  | "DEFAULT_FIELD_TOO_LONG"
  | "PROMPT_FORMAT_INVALID"
  | "DEFAULT_VOTE_TYPE_INVALID"
  | "DEFAULT_VOTE_TYPE_IMMUTABLE"
  | "DEFAULT_NAME_DUPLICATE"
  | "INVALID_HISTORY_LIMIT"
  | "TEMPLATE_AT_CAPACITY"
  | "LAST_ACTIVE_DEFAULT"
  | "REORDER_ID_MISMATCH"
  | "INVALID_DEFAULT_ORDER"
  | "DEFAULT_TOPIC_NOT_FOUND"
  | "DEFAULT_ARCHIVED"
  | "DEFAULT_ALREADY_ARCHIVED"
  | "DEFAULT_ALREADY_ACTIVE"
  | "DEFAULT_MAINTENANCE_BUSY";

export interface MaintenanceErrorDetail {
  field?: string;
  max?: number;
  conflictingTopicId?: string;
  conflictingName?: string;
}

/**
 * A typed, expected failure. The message is a fixed string chosen by the
 * route layer; nothing here ever carries the rejected value.
 */
export class MaintenanceError extends Error {
  readonly code: MaintenanceErrorCode;
  readonly detail: MaintenanceErrorDetail;
  constructor(code: MaintenanceErrorCode, detail: MaintenanceErrorDetail = {}) {
    super(code);
    this.name = "MaintenanceError";
    this.code = code;
    this.detail = detail;
  }
}

/** Length in Unicode code points (never UTF-16 units). */
export function codePointLength(s: string): number {
  return [...s].length;
}

/** The name-uniqueness key: trim, lowercase, no locale, no normalization. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
const NEWLINE = /\n/g;
const HTML_TAG_LIKE = /<[A-Za-z/!]/;
const HTML_ENTITY = /&(?:[A-Za-z][A-Za-z0-9]*|#[0-9]+|#[xX][0-9A-Fa-f]+);/;
const URL_LIKE = /https?:\/\/|www\./i;
const MARKDOWN_LINK = /\]\(/;
const LINE_SEPARATORS = /[\u2028\u2029]/;

/**
 * True when `value` (already trimmed) is plain text under design E4. The
 * description may contain `\n` and no other Cc/Cf character; name and prompt
 * may contain none.
 */
export function isPlainText(field: TextField, value: string): boolean {
  if (LONE_SURROGATE.test(value)) return false;
  const probe = field === "firstSessionDescription" ? value.replace(NEWLINE, "") : value;
  if (CONTROL_OR_FORMAT.test(probe)) return false;
  // U+2028/U+2029 are Zl/Zp, not Cc/Cf: rejected for every field (only \n is allowed, in the description).
  if (LINE_SEPARATORS.test(value)) return false;
  if (HTML_TAG_LIKE.test(value)) return false;
  if (HTML_ENTITY.test(value)) return false;
  if (URL_LIKE.test(value)) return false;
  if (MARKDOWN_LINK.test(value)) return false;
  return true;
}

/**
 * Validates one text field and returns the stored (trimmed) value. Order:
 * required, length, format. Throws MaintenanceError carrying the field name
 * and, for length, the maximum; never the value.
 */
export function validateTextField(field: TextField, raw: unknown): string {
  if (typeof raw !== "string") throw new MaintenanceError("DEFAULT_FIELD_REQUIRED", { field });
  const value = raw.trim();
  if (value.length === 0) throw new MaintenanceError("DEFAULT_FIELD_REQUIRED", { field });
  const max = TEXT_FIELD_MAX[field];
  if (codePointLength(value) > max) throw new MaintenanceError("DEFAULT_FIELD_TOO_LONG", { field, max });
  if (!isPlainText(field, value)) throw new MaintenanceError("PROMPT_FORMAT_INVALID", { field });
  return value;
}

export function isDefaultVoteType(value: unknown): value is DefaultVoteType {
  return typeof value === "string" && (VOTE_TYPES as readonly string[]).includes(value);
}

export function validateVoteType(raw: unknown): DefaultVoteType {
  if (raw === undefined || raw === null) throw new MaintenanceError("DEFAULT_FIELD_REQUIRED", { field: "voteType" });
  if (!isDefaultVoteType(raw)) throw new MaintenanceError("DEFAULT_VOTE_TYPE_INVALID", { field: "voteType" });
  return raw;
}

export interface ValidatableDefault {
  name: string;
  prompt: string;
  vote_type: string;
  first_session_description: string | null;
}

/**
 * Validates a stored default row against the E4 limits. Returns the first
 * failing field's code and field, or null. Used by the post-write backstop
 * and by the invariants checker. Stored values are compared as stored (they
 * were trimmed on the way in); a seed row with surrounding whitespace is
 * judged on its trimmed form.
 */
export function findDefaultRowViolation(row: ValidatableDefault): { code: MaintenanceErrorCode; field: string } | null {
  const checks: Array<[TextField, string | null]> = [
    ["name", row.name],
    ["prompt", row.prompt],
    ["firstSessionDescription", row.first_session_description],
  ];
  for (const [field, value] of checks) {
    try {
      validateTextField(field, value);
    } catch (err) {
      if (err instanceof MaintenanceError) return { code: err.code, field };
      throw err;
    }
  }
  if (!isDefaultVoteType(row.vote_type)) return { code: "DEFAULT_VOTE_TYPE_INVALID", field: "voteType" };
  return null;
}
