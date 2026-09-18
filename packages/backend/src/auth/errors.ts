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
