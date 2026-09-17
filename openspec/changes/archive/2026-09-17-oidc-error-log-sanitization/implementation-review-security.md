# Security Review: OIDC Error Log Sanitization — Implementation

**Reviewer:** Tomás Ferreira (Senior Application Security Analyst)
**Reviewed:** `oidc-error-sanitizer.ts`, `oidc-error-sanitizer.test.ts`, `routes/auth.ts`,
`auth/middleware.ts`, `auth/errors.ts`, `auth/error-handler.ts`, `app.ts` (logger config),
`package.json` (backend), `specs/auth-error-handling/spec.md`, `tasks.md`.
**Method:** Read the implementation directly rather than trusting `design.md`'s account of
it, the same discipline I used for the design review. Ran the sanitizer's own test suite
and the full backend suite (422 tests, 26 files) against the actual installed
`openid-client@6.8.4`/`oauth4webapi@3.8.6`, not just read the assertions.

**Verdict: PASS. The residual risk from `archive/2026-07-05-first-access/implementation-review-security.md` §1 is closed for real, not just on paper.** A verbatim, IdP-controlled `error_description` no longer reaches the log at any of the three call sites I named in the design review, and I verified this against real constructed instances of the library's own error classes, not mocks. All four findings from my design review were addressed as agreed. No new findings block this from shipping.

---

## Verification of my design-review findings

### Finding 1 (`type` → `"Object"` collision) — RESOLVED, verified structurally

`oidc-error-sanitizer.ts` uses `errorClass`, not `type`, in every branch. I re-ran the
`pino-std-serializers` trace from my design review against this implementation: the
sanitizer's return value is a plain object literal, so pino's default `err` serializer
still recomputes `type` as `"Object"` on top of it — but `errorClass` sits outside that
computation and survives. The `MissingClaimError` test (`oidc-error-sanitizer.test.ts:193`)
asserts the exact key set including `type`, with a comment correctly attributing that key
to pino, not the sanitizer. This is the right fix and it's asserted against real serialized
JSON, not reasoned about.

### Finding 2 (`OperationProcessingError` import / `getEndSessionUrl()` raw-throw path) — RESOLVED

`oauth4webapi` is now a direct dependency (`packages/backend/package.json:26`, pinned
`3.8.6`), imported directly in the sanitizer (`oidc-error-sanitizer.ts:8`) rather than
relying on hoisting through `openid-client`. More importantly, the regression test
(`oidc-error-sanitizer.test.ts:141-177`) does not construct a synthetic
`OperationProcessingError` — it drives the actual `buildEndSessionUrl()` call with a
`Configuration` carrying a malformed `end_session_endpoint` and catches the real thrown
error, asserting `toBeInstanceOf(OperationProcessingError)` before sanitizing it. This is
exactly the call-site-specific verification I asked for, not a generic construction that
would pass even if the import were wrong. I ran this test; it passes against the installed
package versions.

### Finding 3 (spec.md overclaiming the multi-provider guarantee) — RESOLVED

`specs/auth-error-handling/spec.md`'s "OIDC library error sanitization" requirement now
reads: *"This mechanism SHALL remain correct... for identity providers... integrated
through the same OIDC client library... a provider integrated through a different client
library is outside this guarantee and requires the verification named in the corresponding
design record."* This matches D7's own more careful framing rather than the unqualified
claim I flagged. A future engineer reading the requirement in isolation now sees the
boundary stated, not just implied by a design doc they may never open. Good.

### Finding 4 (no audit event on `getEndSessionUrl()` failure) — RESOLVED

`auth.ts:437-448`: the catch block emits both the sanitized `log.error` (`event:
"auth.idp_logout_error"`) and a distinct `emitAuditEvent(request.log, "auth.idp_logout_failed", { userId, sessionId })` before falling back to `{ redirectUrl: "/" }`. The dangling-IdP-session condition I was concerned about is now queryable at scale, matching every other security-relevant outcome in this file. Confirmed this is a genuinely new call site, not a relabeling of the pre-existing "no `end_session_endpoint`" `log.warn` branch two lines above it (`auth.ts:433-435`), which correctly remains a plain warning since that condition isn't new.

---

## Core questions from this review's charge

**Does the fail-closed default genuinely fail closed for any error class not explicitly
allowlisted, with no bypass path?** Yes. I traced the branch structure in
`oidc-error-sanitizer.ts:48-105`: five `instanceof`/class checks, each returning early:
`ResponseBodyError`/`AuthorizationResponseError`, `WWWAuthenticateChallengeError`,
`OperationProcessingError`/`ClientError`, `MissingClaimError`, and then unconditional
fallthrough to the redact-everything branch for anything else (`Error` subclass or non-
`Error` thrown value). There is no `default: return { ...err }` path, no early return that
skips the redaction, and no branch that echoes an unknown field. The fallthrough branch
itself has no exception carve-out — it always redacts `message`/`stack` and always emits
the `unrecognized_class` signal first. I could not construct a case where an error reaches
a caller's `log.error` call without going through one of these five branches, because every
call site (`auth.ts:336`, `auth.ts:439`, `middleware.ts:133`) routes exclusively through
`sanitizeOidcError(err, log)` — none of them logs `err` directly.

**Are redacted fields actually redacted in all cases, with no leakage through stack traces,
error messages, or `JSON.stringify`/pino behavior on nested objects?** Yes, verified two
ways. First, by source: every redacted field (`error_description`, `cause`) is set to the
literal string `"[redacted]"` in the object literal — never spread from `err`, never a
truncation or transformation of the original value (this closes off the same class of
side-channel my design review's Finding 6 already checked for in the design; the
implementation preserves that property). Second, and more importantly, by execution: the
test suite constructs real instances with a random UUID canary injected into every
`cause`/`error_description`-bearing constructor argument, runs them through a real `pino()`
instance configured the way `app.ts` configures its logger, and asserts on the **raw
serialized text** (`raw.not.toContain(CANARY)`) — not just the pre-serialization object. I
ran this suite myself; all 9 cases pass. This is the discipline that catches what reasoning
alone would miss (per my own design-review Finding 1, which was exactly this kind of bug —
a field that looked safe at the object-literal level but wasn't after pino's second pass).
Stack traces are included per D5 — I confirmed (as in the design review) that
`stack`/`message` are never built from IdP-supplied content for any of the five real
classes, so their inclusion doesn't reintroduce the leak the redacted fields close.

**Is the `"[redacted]"`-marker approach free of information leakage via structure/length in
the real implementation?** Yes. The marker is a fixed literal string, applied identically
regardless of the withheld value's length, presence, or content — confirmed both by reading
the object-literal construction (no conditional formatting based on the source field) and
by the `WWWAuthenticateChallengeError` test case, which correctly asserts the field is
**absent** (`not.toHaveProperty`) rather than marked `"[redacted]"`, since that class
genuinely has no `error`/`error_description` field — proving the marker means "withheld,"
not "this key exists on every error class." No regression on this point from the design.

**Does the `isRevocation` fix correctly use `err.error === "invalid_grant"` rather than the
old broken check?** Yes — `middleware.ts:111`: `err instanceof ResponseBodyError &&
err.error === "invalid_grant"`, exactly as D10 specified, and the old
`err.message.includes(...)`/`err.code === "invalid_grant"` checks are gone, not left as a
secondary path. The test at `middleware.test.ts:171-215` constructs a real `ResponseBodyError`
with `cause: { error: "invalid_grant", ... }` and asserts `failureType: "revoked"` with
`retryCount: 0` (no retry delay) — proving the fix's behavior, not just its presence. I also
checked for the inverse case: a generic `Error` whose `.message` merely contains the string
`"invalid_grant"` must **not** be classified as revocation (that was the exact
pre-existing bug). The D9/D10 test at `middleware.test.ts:217-269` uses `new Error("network
blip")` — not a string-matching adversarial case, but combined with the `instanceof
ResponseBodyError` gate in the source (which a generic `Error` categorically fails), the
fix is structurally incapable of the old false-positive-via-substring-match failure mode,
independent of what message text is used. I'd call this adequately proven by source
inspection plus the existing positive-case test, though a test explicitly named for the old
false-negative (an `Error` whose message contains `"invalid_grant"` verbatim, asserting it
lands in `transient_failure` rather than `revoked`) would have made the regression harder to
accidentally reintroduce. Not blocking — the `instanceof` gate makes the old bug class
structurally unreachable, not just empirically absent in the one case tested.

**Is there any path where a raw library error could still reach `request.log.error`
unsanitized — checking all call sites, not just the ones `design.md` named?** I did my own
independent sweep rather than trusting the design's list. `grep` across
`packages/backend/src` for every `log.error`/`log.warn` call:

| Call site | Source of `err` | Sanitized? |
|---|---|---|
| `auth.ts:335` (`auth.callback_error`) | `handleCallback` (OIDC token exchange) | Yes, `sanitizeOidcError` |
| `auth.ts:438` (`auth.idp_logout_error`) | `getEndSessionUrl` | Yes, `sanitizeOidcError` |
| `middleware.ts:132` (`auth.token_refresh_error`) | `refreshOidcToken` | Yes, `sanitizeOidcError` |
| `oidc-error-sanitizer.ts:90` (`unrecognized_class` signal) | Only `errorClass` (string), never `err` itself | N/A — never carries raw error content |
| `index.ts:10` | Fastify `app.listen()` startup failure | Not an OIDC error path (bind/port failure); out of scope |
| `realtime/websocket-routes.ts:134,155,267,311` | Redis publish/audit-write failures | Not OIDC-derived; out of scope per design's Non-Goals |
| `realtime/origin-check.ts:52`, `action-items.ts:351` | Origin/validation warnings | Not OIDC-derived; out of scope |

`oidc-client.ts`, the module that wraps `openid-client` calls, contains no `catch`/`log`
calls of its own (confirmed by grep) — it lets errors propagate to the three call sites
above, all of which are covered. I found no fourth call site that constructs or catches an
OIDC-library error and logs it outside `sanitizeOidcError`. This matches D1's stated
grep-able-convention goal in practice, not just in intent.

**Does the regression suite use real instances constructed the way the real libraries
construct them, or loosely-typed mocks?** Real instances throughout, and I ran the suite
myself rather than trusting the test file's own assertions.
`ResponseBodyError`/`AuthorizationResponseError`/`WWWAuthenticateChallengeError` are all
constructed via their actual `openid-client`-exported constructors with realistic
constructor-argument shapes (the `AuthorizationResponseError` test correctly notes it
*must* use a real `URLSearchParams` for `cause`, not a plain object, because the real
constructor calls `.get()` on it — a mock would have hidden this and the test comment shows
the author verified this by hitting the real constructor's behavior, not by guessing).
`OperationProcessingError` is obtained by driving the actual `buildEndSessionUrl()` code
path, not constructed directly. `ClientError` is constructed via its real native
`Error(message, { cause })` constructor form. Nothing in this file is a hand-rolled object
shaped like an error class — every fixture is `instanceof`-checked against the real class
before being sanitized, and I confirmed those assertions pass. This is exactly what D6 and
my own design review demanded, and it's been delivered, not just claimed.

---

## Additional checks I ran that weren't explicitly asked for

- **No global `err` serializer was introduced in `app.ts`** (would have widened blast
  radius beyond D1's intent) — confirmed; `app.ts`'s only serializer is still `req`, for
  join-token redaction in URLs, unrelated to this change.
- **`mapAuthError` (`error-handler.ts`), which builds the user-facing `/auth/error` page
  message, was not touched by this change and remains safe** — it returns only fixed canned
  strings per category, never echoes `err.message` to the client. Out of this change's
  scope, but I checked it since it shares the same catch block, and a user-facing leak
  would have been a more severe finding than a log leak.
- **`MissingClaimError` (`errors.ts`) is unchanged and still carries only the claim name,
  never a claim value** — consistent with my original first-access review.
- **Ran the full backend suite** (422 tests / 26 files, including
  `oidc-error-sanitizer.test.ts` and `middleware.test.ts`) — all pass against the actually-
  installed library versions, not a pinned mock snapshot.

---

## Outstanding items (non-blocking, already tracked)

Consistent with my design review: tasks 6.2 (multi-provider re-verification follow-up,
filed as issue #122) and 6.3 (caret-range dependency-policy flag, filed as issue #123) are
correctly deferred rather than solved here — they require future work this change
correctly scopes out. Task 6.4 (D3 allowlist sign-off from whoever owns log policy) is
non-blocking by design and doesn't affect the confidentiality guarantee this review is
scoped to.

One minor, non-blocking observation for a future test-hardening pass: the `isRevocation`
test coverage proves the fix via the `instanceof` gate rather than via an explicit
adversarial fixture (a generic `Error` whose message contains `"invalid_grant"` as a
substring, asserting it does *not* trigger revocation). The structural fix makes this
unreachable regardless, but an explicit negative-case test would make that guarantee
visible in the test file itself rather than requiring a reviewer to re-derive it from the
`instanceof` check, the way I just did.

## Conclusion

This implementation closes the residual risk I flagged in the first-access review. The
class-based, fail-closed sanitization mechanism is real, uniformly applied at every call
site I could find (not just the ones the design named), and verified against actual
installed library behavior rather than assumed from reasoning about the library's source.
All four design-review findings were resolved as agreed, with evidence, not just
assertion. No blocking issues. Cleared for production.
