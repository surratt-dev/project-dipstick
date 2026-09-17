## Why

`handleCallback()`'s catch block (`packages/backend/src/routes/auth.ts:334`) logs the raw
error thrown by `openid-client`/`oauth4webapi` with no serializer override. For
`ResponseBodyError` and `AuthorizationResponseError` — thrown whenever the IdP's token
endpoint or callback redirect returns an OAuth error — the IdP-supplied
`error_description` free-text field reaches production logs today, verbatim and
unredacted, as a structured JSON field (`packages/backend/src/auth/oidc-client.ts` audit,
2026-09-17). This is a "must resolve before first production deployment" item (issue #2)
and already violates the `auth-error-handling` capability's standing requirement that
"Logs SHALL NOT include user credentials, tokens, or sensitive values" — that requirement
exists today as a stated policy with no structural enforcement for this code path.

The exposure is not Entra-specific and gets worse, not better, as this project takes on
more identity providers: `error_description` is IdP-defined free text, not
OIDC-spec-defined, and `requirements/use cases/01 - Identity and Access - Use Cases.md`
is explicit that Entra is not the only IdP this application is required to support.
Entra's AADSTS-prefixed messages are relatively disciplined; nothing guarantees the same
of a future provider, and some generic/self-hosted OIDC servers are considerably more
verbose. A fix that reasons about Entra's error shapes specifically would pass review
today and quietly stop protecting the app the day a second IdP is onboarded — the
sanitization has to be keyed off the stable, spec-defined error *classes* `oauth4webapi`
throws, not provider-specific string matching.

Separately, and less urgently: the `OperationProcessingError` family (nonce mismatch,
claim/audience/issuer mismatches, signature failures) is *currently* safe, but only
because Node's native `Error(message, { cause })` happens to install `cause` as a
non-enumerable property that pino's default serializer skips. Nothing in the codebase
guards that behavior with a test, and it depends on three separate implementation
details (see `exploration-notes.md`, Finding 2) staying true across a pino bump, a future
custom `err-with-cause` serializer, or a future engineer logging `err.cause` directly to
help debug a ticket. This change makes that safety structural instead of incidental.

## What Changes

- Add a single shared sanitizing wrapper for any error surfaced by
  `openid-client`/`oauth4webapi` before it reaches a logger. The wrapper keys its
  handling off error *class* (stable and spec-defined via `oauth4webapi`), never off
  provider-specific string matching (e.g. no `AADSTS`-prefix parsing) — the same
  "categorize, don't relay" discipline the existing `error-handler.ts` already applies to
  the user-facing redirect. This covers `ResponseBodyError`, `AuthorizationResponseError`,
  `WWWAuthenticateChallengeError`, `OperationProcessingError`, and `ClientError` from the
  OIDC client library, as well as this application's own `MissingClaimError`
  (`packages/backend/src/auth/errors.ts`) — thrown during ID token claim validation inside
  `handleCallback()` — since it reaches the same `/auth/callback` catch block and logging
  call site as the library-thrown classes, even though it is application code rather than
  library code.
- Apply the wrapper at every call site that can surface an `openid-client`/`oauth4webapi`
  error to a logger, not only the one catch block the originating issue named:
  `handleCallback()` (`auth.ts`'s `/auth/callback` catch block), `refreshToken()`
  (`middleware.ts`'s `refreshSessionTokens`), and `getEndSessionUrl()` (`auth.ts`'s
  `/auth/logout` handler — currently un-try/caught, so an error there reaches Fastify's
  default error handler unsanitized; this change adds the missing error handling as part
  of closing that path).
- Drop `error_description` and the raw `cause` object from logs by default for
  `ResponseBodyError`, `AuthorizationResponseError`, and `WWWAuthenticateChallengeError`.
  Keep the OAuth `error` code (e.g. `invalid_grant`) — it is a fixed, spec-defined enum,
  not free text, and safe across providers.
- Apply an explicit named-field allowlist per error class (starting list in
  `exploration-notes.md`) rather than relying on pino's default serializer behavior to
  keep unlisted fields out. Withheld fields appear in the logged object as an explicit
  `"[redacted]"` marker — never silently omitted — so an operator can tell "withheld on
  purpose" from "logging broke."
- Fail closed on any error class the wrapper doesn't recognize: redact aggressively by
  default and emit a distinct log signal (e.g.
  `event: "oidc_error_sanitizer.unrecognized_class"`), rather than falling through to
  logging the raw object. This matters specifically because of the multi-provider
  trajectory — a second IdP's client library not going through `oauth4webapi` at all is a
  realistic way an unrecognized shape reaches this wrapper.
- Add a regression test suite that constructs a representative instance of each of
  `OperationProcessingError`, `ResponseBodyError`, `AuthorizationResponseError`, and
  `WWWAuthenticateChallengeError` — each carrying a recognizable canary string (e.g.
  `"CANARY_TOKEN"`) in its sensitive fields — against the actual installed
  `openid-client@6.8.4`/`oauth4webapi@3.8.6` versions, and asserts the canary never
  appears in the sanitized log output while the allowlisted fields do. This is what makes
  the `OperationProcessingError` family's safety structural instead of incidental.
- Explicitly verify, by exercising the real `/auth/callback` error-redirect path (not by
  code inspection), that tightening what reaches the log has no effect on what reaches
  the user-facing `/auth/error` page — these are adjacent code paths and an easy,
  unnoticed place to introduce a regression while "hardening" the other.
- Document the wrapper's onboarding invariant in a code comment at the wrapper itself:
  the native-`Error(message, {cause})`-is-non-enumerable vs. plain-field-assignment
  distinction from Finding 2, and a checklist for what to verify before trusting a new
  error class or a second IdP's client library.
- Incidentally fix a pre-existing misclassification bug in `middleware.ts`'s
  `refreshSessionTokens`, surfaced while touching this catch block to wire in the new
  sanitized log line: `isRevocation` currently checks `err.message`/`err.code`, fields
  that can never carry the OAuth `invalid_grant` code for a `ResponseBodyError` (see
  design D10). Today this means a genuinely revoked refresh token is misclassified as a
  transient failure — two retries, 5 seconds apart, and an audit record reading
  `failureType: "transient"`. This change corrects the check to read `err.error` instead
  — the same spec-defined OAuth enum this change already establishes as safe to log — so
  a revoked refresh token is now classified and audited as `failureType: "revoked"`, with
  no retry delay.
- Explicitly out of scope for this change (carried forward as named deferrals, not
  silently dropped): debug-level capture of `error_description` at a separate,
  non-production log level (pending sign-off from whoever owns log retention/access
  policy — defaults to "not built" if unresolved); re-pinning `openid-client`'s `^6.8.4`
  caret range (flagged to whoever owns dependency policy).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auth-error-handling`: the existing "Authentication event logging" requirement states
  logs SHALL NOT include credentials, tokens, or sensitive values, but has no structural
  mechanism enforcing that for errors raised by the OIDC library and logged via
  `request.log.error`. This change adds a requirement specifying the sanitizing-wrapper
  mechanism itself (per-class allowlist, explicit redaction markers, fail-closed default,
  regression test obligation) as the enforcement mechanism, and clarifies that this
  applies to every call site where an OIDC-library error can reach a logger, not only
  audit events emitted via `emitAuditEvent`.

## Impact

- `packages/backend/src/auth/oidc-client.ts` — no functional change to the OIDC calls
  themselves; consumers of `handleCallback()`, `refreshToken()`, `getEndSessionUrl()`
  gain a required sanitization step before any error they throw reaches a logger.
- `packages/backend/src/routes/auth.ts` — `/auth/callback` catch block (line ~334) routes
  `err` through the new wrapper before `request.log.error`; `/auth/logout` (line ~426)
  gains a try/catch around `getEndSessionUrl()` it currently lacks.
- `packages/backend/src/auth/middleware.ts` — `refreshSessionTokens`'s catch block
  (line ~103) routes `err` through the new wrapper before any future/existing logging of
  it.
- New module for the shared sanitizing wrapper (exact location decided at design stage),
  plus its regression test suite.
- No change to `packages/backend/src/auth/error-handler.ts`'s user-facing categorization
  logic — this change adds verification that it stays unaffected, not modifications to
  it.
- No API, schema, or dependency version changes. No change to `emitAuditEvent` call
  sites' existing field sets.
