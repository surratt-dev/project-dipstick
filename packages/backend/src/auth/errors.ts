/**
 * Thrown when a required OIDC claim is absent or contains an empty string.
 *
 * Carries the claim name — never the claim value — so catch blocks can emit
 * structured audit events identifying the missing claim without any risk of
 * logging PII.
 */
export class MissingClaimError extends Error {
  /**
   * The name of the missing or empty claim, e.g. "sub" or "iss". Also used
   * as "id_token" to denote that the claims object itself was null (no
   * claims to inspect), rather than a specific absent claim.
   */
  readonly claim: string;

  constructor(claim: string) {
    super(`Missing or empty required OIDC claim: ${claim}`);
    this.name = "MissingClaimError";
    this.claim = claim;
  }
}

/**
 * Thrown by `withAuditTransaction` (audit-write-transaction.ts) when either
 * (a) the audit `INSERT` inside the transactional group's transaction fails,
 * or (b) acquiring that transaction's database connection (`db.connect()`)
 * fails before the transaction ever begins.
 *
 * auth-events-audit-log-coverage, design.md Decision D7: both failure modes
 * are, from an incident responder's perspective, "this application's own
 * database infrastructure, not the IdP" -- distinguishing them from a raw
 * OIDC-library error so `mapAuthError`/`sanitizeOidcError` don't misattribute
 * them to a sign-in failure.
 *
 * `message` is always the static string below -- never derived from the
 * underlying database error, which could in principle echo back query
 * content -- so it is always safe to log in full, unlike a genuine IdP
 * error's message. `causeClass` (e.g. "DatabaseError") gives an operator a
 * bit more diagnostic value without that risk.
 */
export class AuditWriteError extends Error {
  readonly causeClass: string;

  constructor(cause: unknown) {
    super("Audit log write failed");
    this.name = "AuditWriteError";
    this.causeClass = cause instanceof Error ? cause.constructor.name : typeof cause;
  }
}
