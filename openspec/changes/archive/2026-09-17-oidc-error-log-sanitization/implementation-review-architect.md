# Architecture Review — oidc-error-log-sanitization

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Implementation vs. `design.md` (D1–D10), boundary/consistency check
**Verdict: Approved.** The implementation matches the design record precisely, including
every field-name and branch-order detail D3 calls out. No architectural concerns.

## What I checked

- `design.md` (D1–D10, Risks, Migration Plan) against the actual diff.
- `packages/backend/src/auth/oidc-error-sanitizer.ts` (new), its test file, `routes/auth.ts`,
  `auth/middleware.ts`, `auth/audit-logger.ts`, `routes/__tests__/auth.test.ts`,
  `auth/__tests__/middleware.test.ts`.
- `tasks.md` completion state and `specs/auth-error-handling/spec.md`'s delta requirement
  wording, to confirm the shipped behavior and the documented contract agree.
- Ran the three new/touched test files directly: 59/59 pass. Ran `tsc -p tsconfig.build.json
  --noEmit` (the actual build config): clean. `tsc --noEmit -p .` (the looser IDE config) shows
  117 pre-existing errors on `main` before this change and a handful more inside the new test
  file of the same class (`noUncheckedIndexedAccess`-style strictness, a `Response`-shaped
  Fastify reply mock) — consistent with pre-existing patterns elsewhere in the test suite
  (`middleware.test.ts:202`, `auth.test.ts:388` have the identical `Response` mismatch already).
  Not a regression introduced by this change; not gating.
- Confirmed `oauth4webapi: 3.8.6` is present in `packages/backend/package.json` `dependencies`
  (D8) and that `OperationProcessingError` is imported directly from `oauth4webapi` in the
  sanitizer, not re-exported through `openid-client`.

## D1 — Explicit per-call-site invocation, not a global serializer

Confirmed. `sanitizeOidcError` is invoked explicitly at all three sites (`auth.ts:336` callback
catch, `auth.ts:439` logout catch, `middleware.ts:133` refresh catch). No `err`-key serializer
was added to `app.ts`. Grep-able by construction, as intended — a future fourth call site has an
obvious pattern to copy.

## D2 — Plain object literal, opt-in fields only

Confirmed. Every branch in `oidc-error-sanitizer.ts` builds a fresh object literal; none spread
or clone `err`. `REDACTED` is a literal `"[redacted]"` string constant, matching the design's
"not `isErrorLike`, so pino doesn't recurse into it" reasoning.

## D3 — Dispatch order, five branches, fail-closed default

This is where I looked hardest, since it's the part of the design most likely to drift under
implementation pressure, and the actual code matches it exactly:

- **1a** (`ResponseBodyError | AuthorizationResponseError`): `errorClass, message, stack, code,
  error, error_description: REDACTED, cause: REDACTED` — matches.
- **1b** (`WWWAuthenticateChallengeError`, separate branch): `errorClass, message, stack, code,
  cause: REDACTED` — no `error`/`error_description` keys at all. Matches the design's explicit
  correction (this class doesn't have those fields, so nothing to redact). The test file asserts
  their *absence* (`not.toHaveProperty`), not redacted-presence — correctly distinguishing "field
  doesn't exist" from "field exists and is withheld," which is exactly the distinction D3 cared
  about.
- **2** (`OperationProcessingError | ClientError`): `errorClass, message, stack, code, cause:
  REDACTED` — matches, and both classes land in the same branch as designed.
- **3** (`MissingClaimError`): `errorClass, message, stack, claim` — matches, claim-name-only
  discipline preserved.
- **4/5** (fail-closed default): `message`/`stack` redacted (or omitted for non-Error),
  `unrecognized: true`, plus the wrapper's own `log.error({ event:
  "oidc_error_sanitizer.unrecognized_class", errorClass })` call emitted *from inside* the
  function, not left to each call site. Matches D3's stated rationale for keeping this
  "impossible to forget" at every call site.

**Field naming (`errorClass`, not `type`):** confirmed on every branch. D6's own reasoning (pino
recomputes `type` from `.constructor.name`, always `"Object"` for a plain literal) is verified
directly by the test file's assertion at `oidc-error-sanitizer.test.ts:193`, which asserts the
*final* key set includes both `errorClass` (ours) and `type` (pino's, `"Object"`) as separate
keys — this is the regression check D3 says is necessary, and it's actually there, not just
described.

## D4 — `getEndSessionUrl()` try/catch, plus the audit-event addendum

Confirmed in `auth.ts:427–449`. The `try/catch` wraps exactly the call the design names; on
error it sanitizes and logs (`auth.idp_logout_failed` event via `log.error`), emits the new
`auth.idp_logout_failed` **audit** event with `userId`/`sessionId` (distinct from the
`log.error`'s own `event: "auth.idp_logout_error"` field — two different signals, matching the
design's framing of "sanitized log call" + "audit event" as separate outputs), then falls back
to `reply.send({ redirectUrl: "/" })`. This is the same fallback shape already used two branches
above in the same handler (no `end_session_endpoint` case), as D4 requires. `audit-logger.ts`
declares `auth.idp_logout_failed` in `AuditEventName` with a comment citing this exact design
decision by name — good practice, and it means the next engineer who greps for the event name
lands on the rationale, not just the type.

`auth.test.ts`'s `"degrades gracefully when getEndSessionUrl() throws"` test (line 1274) asserts
all four parts of task 4.2 in one place: fallback response, prior session destruction, sanitizer
routing, and the distinct audit event. This is a faithful CI-enforced encoding of D4, not just a
happy-path smoke test.

## D5 — Stack traces unconditional

Confirmed — `stack` appears unconditionally in branches 1a/1b/2/3, no `NODE_ENV` gate anywhere in
the sanitizer or its call sites.

## D6 — Regression test methodology

Confirmed, and this is the part of the implementation I'd call out as exceeding the median bar
for this codebase, not just meeting it: every recognized class is constructed as a **real**
instance from the installed `openid-client`/`oauth4webapi` packages (not hand-rolled mocks),
canaries are injected into the actual sensitive constructor arguments, results are pushed through
a **real** `pino()` instance configured the way `app.ts` configures its own logger, and assertions
run against the parsed JSON output — not the wrapper's return value. The
`AuthorizationResponseError` test correctly uses a real `URLSearchParams` for `cause` (the design
document itself flags this as a trap — a plain object literal throws at construction time — and
the test avoids it). The `OperationProcessingError` case doesn't construct the class arbitrarily;
it drives the actual `buildEndSessionUrl()`-reachable code path with a malformed
`end_session_endpoint`, which is exactly what D8's rationale says is the one call site that
matters for this class. 9/9 tests pass.

## D7 — Multi-provider scope boundary

Not implementation-testable by construction (that's the point of D7), but the delta spec's added
requirement (`specs/auth-error-handling/spec.md:33`) states the boundary in the same terms as the
design: correct for any provider reachable through the same `openid-client`/`oauth4webapi`
library, explicitly out of scope for a provider requiring a different client library. Consistent
with [[project_oidc_multi_provider]] — this change doesn't hardcode Entra-specific behavior
anywhere I found (no `AADSTS` parsing, no provider-name branches), and the dispatch is entirely
on library-exported classes. Task 6.2 (GitHub issue #122) carries the re-verification-on-real-
second-provider follow-up forward, as D7 requires.

## D8 — `oauth4webapi` as an explicit direct dependency

Confirmed: `"oauth4webapi": "3.8.6"` in `packages/backend/package.json` dependencies, exact pin,
matching the version the tests construct instances against. `OperationProcessingError` is
imported directly from `oauth4webapi` in the sanitizer module (not via `openid-client`'s
re-exports), which is the actual point of this decision — the import no longer depends on npm's
hoisting behavior.

## D9 — New log line in `refreshSessionTokens`

Confirmed at `middleware.ts:132–139`. Placement matches design exactly: after the retry loop
exhausts (the `else` branch of `if (retries <= REFRESH_MAX_RETRIES)`), before the
`transient_failure` audit event and return. Field set (`err: sanitizeOidcError(...)`, `userId`,
`sessionId`, `source`, `event: "auth.token_refresh_error"`, `retryCount`) matches task 2.2b.
`middleware.test.ts`'s "D9/D10" test (line 217) specifically asserts this fires **exactly once**,
not once per retry — the design's own concern (this log line existing at all, and not being
duplicated across retries) is directly encoded as an assertion, not just implied by the code
structure.

## D10 — `isRevocation` fix

Confirmed at `middleware.ts:111`: `err instanceof ResponseBodyError && err.error ===
"invalid_grant"`. The old `.message.includes(...)` / `.code === "invalid_grant"` check is gone
entirely — not left as a secondary check, not commented out, just replaced, matching "fix inline"
rather than "add alongside." The inline comment at lines 106–110 states the *why* (both old fields
are structurally incapable of carrying this value) rather than just what changed, consistent with
this repo's comment discipline elsewhere. `middleware.test.ts`'s revocation test (line 171) now
constructs a real `ResponseBodyError` rather than a generic `Error` with a matching message string
— which is itself a meaningful test change, since the old test would have passed against the
pre-fix code too (it directly demonstrates the pre-existing bug is closed, not just that the new
code path is reachable).

## Boundary and consistency observations

- **Scope discipline held.** I read the full diff, not just the listed files (`git status`
  against `main`: `package-lock.json`, `package.json`, the sanitizer + its test, `middleware.ts` +
  its test, `audit-logger.ts`, `routes/auth.ts` + its test). Nothing outside what `tasks.md`
  scopes. No `emitAuditEvent` call site's existing field set was changed (Non-Goals honored) —
  `auth.idp_logout_failed` is a new call site, not a modified one, as D4's addendum is careful to
  state.
- **Error handling style matches the surrounding codebase.** The `try/catch` shape in
  `/auth/logout`, the pattern of sanitizing at the `log.error` call boundary while still passing
  the raw `err` to `mapAuthError()` for user-facing categorization (`auth.ts:333`), and the
  audit-then-redirect sequencing all follow the same shape already used elsewhere in this file
  (e.g. the callback handler's existing catch block). No new error-handling idiom was introduced.
- **Logging conventions match.** Structured fields (`event`, `correlationId`, `sourceIp`),
  `emitAuditEvent`'s existing `AuditEventName` union pattern with an inline rationale comment per
  event — the new `auth.idp_logout_failed` entry follows the exact documentation style already
  used for every other event in that file (e.g. `team.access_grant_mismatch`,
  `session.token_refresh_failed_live`).
- **Test structure matches.** `vi.mock` + hoisted mock functions, `describe`/`it` nesting, the
  `buildApp()`/`setupValidCallbackMocks()` helper pattern in `auth.test.ts` — the new tests extend
  existing helpers rather than introducing a parallel test-setup convention.
- **The one real behavior change (D4) is well-isolated and audited**, not just logged — my
  standing concern from the persona's "operability as a first-class requirement" lens is whether
  a silent-degradation path is discoverable before a user complains. It is: the new
  `auth.idp_logout_failed` audit event makes the dangling-IdP-session condition queryable, exactly
  as D4's addendum promises.
- **D9/D10 behavior changes (log volume increase, `failureType` reclassification, retry-latency
  removal for revoked tokens) are correctly called out in `design.md`'s Migration Plan** as
  externally-observable changes, and are exercised by tests, not just asserted in prose.

## Minor, non-blocking notes

- `tsc --noEmit -p .` (the loose/IDE tsconfig, not the build config) reports a few errors inside
  the new sanitizer test file (an `ErrorOptions`-typed `cause` option not recognizing `code`, a
  couple of `Object is possibly undefined` on array-index access). These are the same class of
  pre-existing noise already present across dozens of other test files under this same tsconfig
  on `main` (117 errors before this change) — including the identical `Response`-shaped Fastify
  mock mismatch already present in `middleware.test.ts` and `auth.test.ts` before this change
  touched them. `tsc -p tsconfig.build.json` (the actual build gate) is clean. Not a defect
  introduced by this change; flagging only so it isn't mistaken for something this PR should have
  caught.
- The onboarding comment block at the top of `oidc-error-sanitizer.ts` is genuinely useful and
  matches task 1.6's five sub-points precisely — worth using as a model for future modules with
  similar "don't trust the class definition alone, verify against real output" caveats.

## Conclusion

Every D1–D10 decision is implemented as specified, with no scope drift, no boundary violations,
and no deviation between what `design.md` promises and what the code/tests actually do. The
regression suite (D6) is the strongest part of this change — it tests against real library
instances and real serialized log output rather than reasoning about the library's internals,
which is precisely the discipline `exploration-notes.md` Finding 2 called for. Approved.
