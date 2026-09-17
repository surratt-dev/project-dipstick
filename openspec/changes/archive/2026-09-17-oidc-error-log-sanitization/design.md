## Context

Today, every place `openid-client`/`oauth4webapi` can throw falls into one of three
states, not two — this was corrected during design review after a direct read of
`middleware.ts` showed the original two-state framing didn't match the code:

1. `handleCallback()`'s catch block (`auth.ts:334`) logs the raw `err` object with no
   serializer override.
2. `refreshToken()`'s catch block (`middleware.ts`'s `refreshSessionTokens`, ~line 103)
   *does* catch, but only ever inspects `err` for a revocation heuristic and then discards
   it — `err` never reaches a `log.error`/`log.warn` call at all today, so an unrecognized
   OIDC failure during token refresh currently produces zero log output to search on (see
   D9).
3. The `getEndSessionUrl()` call at `packages/backend/src/routes/auth.ts:426` doesn't
   catch at all.

`app.ts` registers no `err` serializer (only `req`, to redact join tokens from URLs), so
whatever pino's default `err` serializer (`pino-std-serializers`) does with the raw error
is exactly what reaches the log output for state 1 today.

`exploration-notes.md` establishes, by direct source audit of the installed
`openid-client@6.8.4`/`oauth4webapi@3.8.6` and empirical testing against a real `pino()`
instance, two facts that drive this design:

1. `err.message`/`err.stack` never carry token, claim, or nonce content across all 87
   `OPE(...)` throw sites in `oauth4webapi` — messages are static strings.
2. `err.cause` and related fields differ by *how the class sets them*. The
   `OperationProcessingError`/`ClientError` family uses the native
   `Error(message, { cause })` constructor form, which the ECMAScript spec makes
   non-enumerable — currently kept out of logs only because pino's default serializer's
   `for...in` walk skips non-enumerable properties. `ResponseBodyError`,
   `AuthorizationResponseError`, and `WWWAuthenticateChallengeError` instead assign
   `cause`, `error`, `error_description` as ordinary `this.x = y` class fields, which are
   enumerable by default and **do** reach the log today, unredacted, verbatim,
   IdP-controlled free text.

This design makes the safety of case 1 structural (not dependent on pino defaults) and
closes the active leak in case 2, using a mechanism that stays correct as this project
takes on IdPs beyond Entra.

## Goals / Non-Goals

**Goals:**
- Make "no OIDC-library error content reaches a log unsanitized" a structural property,
  enforced by one shared function, not an emergent property of pino's default serializer
  behavior.
- Keep the mechanism provider-agnostic by construction: dispatch on the stable,
  spec-defined error *classes* `oauth4webapi`/`openid-client` export, never on
  provider-specific string content (no `AADSTS` parsing or equivalent).
- Apply the wrapper uniformly at all three call sites named in the proposal, including
  adding the missing `try/catch` around `getEndSessionUrl()`.
- Make what's withheld visible (`"[redacted]"` markers) and make an unrecognized error
  shape loud (a distinct log event) rather than either silently omitting fields or
  silently falling through to raw logging.
- Verify, by exercising real code paths, that (a) the sanitized log output never contains
  the canary content injected into a representative instance of each error class, and
  (b) the user-facing `/auth/error` page is unaffected.

**Non-Goals:**
- Debug-level capture of `error_description` at a separate log level/retention policy —
  deferred pending sign-off from whoever owns log policy; if unresolved by
  implementation, the default (drop entirely) stands and this becomes a follow-up change.
- Any parsing, extraction, or special-casing of a specific provider's error-description
  grammar (e.g. Entra's `AADSTS` code prefix). Explicitly rejected in exploration — the
  moment the wrapper knows one provider's error-code shape, it stops being
  provider-agnostic by construction.
- Changing `openid-client`'s `^6.8.4` dependency pin, or any dependency-policy change.
  Flagged separately to whoever owns that policy. (Declaring `oauth4webapi` as an
  explicit direct dependency at its already-resolved version — D8 — is dependency
  *hygiene*, not a pin change or a policy change, and is in scope.)
- Changing `emitAuditEvent` call sites' existing field sets — they already avoid logging
  raw `err` objects and are out of scope here.
- A global pino `err`-key serializer override in `app.ts` (see Decision D1 for why this
  was considered and rejected).

## Decisions

### D1: Explicit per-call-site wrapper invocation, not a global pino serializer

**Decision:** A new pure function, `sanitizeOidcError(err: unknown, log: FastifyBaseLogger): Record<string, unknown>`,
exported from a new module `packages/backend/src/auth/oidc-error-sanitizer.ts`. Every
call site passes its return value into the `err` field of its own `log.error(...)` call
(e.g. `request.log.error({ err: sanitizeOidcError(err, request.log), correlationId, sourceIp, event: "auth.callback_error" })`),
rather than registering a global serializer for the `err` key in `app.ts`.

**Alternatives considered:**
- *Global `err` serializer in `app.ts`, dispatching on `instanceof` internally.* Rejected
  for three reasons: (a) `getEndSessionUrl()` has no `try/catch` today — a serializer
  change alone can't fix a missing catch block, so call-site changes are required
  regardless of this choice; (b) a global override changes serialization for *every*
  error logged anywhere in the app under the `err` key, not just OIDC errors — a much
  larger blast radius than this change's reviewed scope; (c) an explicit call-site
  invocation is grep-able (`sanitizeOidcError` appears at every place it's needed),
  which directly serves the onboarding goal from Finding 2 — a future engineer adding a
  4th call site that can throw these errors sees the pattern already in use nearby,
  rather than needing to know an invisible global serializer exists.

### D2: The wrapper returns a plain object, not a modified `Error`

**Decision:** `sanitizeOidcError` returns a plain `Record<string, unknown>` built as an
explicit object literal per error-class branch (opt-in fields only), never a mutated
clone of the original error and never `{ ...err, cause: undefined }`-style subtraction.

**Rationale:** Source-verified (`node_modules/pino-std-serializers/lib/err.js`) that
pino's default `err` serializer applies to *any* value under the `err` key with a string
`.message` (`isErrorLike`), re-running its own `for...in` walk over whatever we pass in.
Since every field our object exposes is already deliberately non-sensitive (redacted
fields are literal `"[redacted]"` strings, which are not `isErrorLike` and so are copied
through as-is, never recursed into), this second pass is inert — but the regression test
(D6) asserts the *final* JSON output, not the wrapper's return value, precisely because
this interaction with pino internals is exactly the kind of thing Finding 2 warned
against trusting from reasoning alone.

An "opt-in fields only" object literal (vs. "start from `err` and delete the bad parts")
is deliberate: a future engineer extending a branch has to explicitly add a field to
expose it, rather than remember to explicitly delete a new field the library might add
in a future version. This is the same "allowlist over denylist" reasoning that makes the
whole design closed-by-default.

### D3: Dispatch by `instanceof`, fixed branch order, five cases plus fail-closed default

```
1a. ResponseBodyError | AuthorizationResponseError
    → { errorClass, message, stack, code, error, error_description: "[redacted]", cause: "[redacted]" }
    (`code` here is oauth4webapi's fixed internal error-kind constant, e.g. RESPONSE_BODY_ERROR —
    not the OAuth `error` field — both are enums, both safe.)
1b. WWWAuthenticateChallengeError
    → { errorClass, message, stack, code, cause: "[redacted]" }
    (this class has no `error`/`error_description` fields at all — verified directly
    against `oauth4webapi/build/index.js`'s class definition, which declares only `cause`,
    `code`, `response`/`status`. It was originally grouped with 1a under a shared shape
    that redacted `error_description` as if the field existed on all three classes; split
    out here so the allowlist reflects only fields that are actually present on the
    instance, per D2's "opt-in fields only" discipline — not so an already-absent field
    needs a redaction marker.)
2. OperationProcessingError | ClientError
   → { errorClass, message, stack, code, cause: "[redacted]" }
3. MissingClaimError (this app's own class, packages/backend/src/auth/errors.ts)
   → { errorClass, message, stack, claim }  (claim name only, per its existing discipline)
4. Any other Error
   → { errorClass, message: "[redacted]", stack: "[redacted]", unrecognized: true }
   plus a separate, immediate `log.error({ event: "oidc_error_sanitizer.unrecognized_class", errorClass })`
   emitted by the wrapper itself.
5. Non-Error thrown value
   → { errorClass: typeof err, message: "[redacted]", unrecognized: true } + same signal event.
```

**Field naming: `errorClass`, not `type`.** The class-name field is deliberately named
`errorClass` rather than `type`, and this is a correction from an earlier draft that used
`type`. Verified against the installed `pino-std-serializers/lib/err.js`: pino's default
`err` serializer unconditionally recomputes a `type` key from `err.constructor.name`
*before* copying any of the wrapper's own fields, and only copies a key from the input
object when that key is `undefined` on the pre-seeded result. Since `sanitizeOidcError`
returns a plain object literal (D2), `.constructor` is the global `Object`, so pino would
silently overwrite a field named `type` with the literal string `"Object"` on every single
branch — including the two recognized-error branches whose entire purpose is to keep the
class name visible for triage. `errorClass` sits outside pino's reserved computation and
survives the second serializer pass untouched. D6's test (3.5) asserts this against real
serialized JSON output specifically so this class of interaction is caught by CI, not
rediscovered as a confusing test failure.

Branch 4/5 (fail-closed) is intentionally more conservative than Finding 1 would strictly
require (Finding 1 showed *known* oauth4webapi classes never put sensitive content in
`message`; an *unrecognized* class carries no such guarantee) — redacting `message` too
is the deliberate cost of failing closed.

Emitting the `unrecognized_class` signal from inside the wrapper (rather than requiring
each call site to check a flag and emit it themselves) keeps the "one shared function"
property real: call sites get the loud-signal behavior automatically, and can't forget
it the way they could if it were three copies of the same `if (result.unrecognized)`
check.

### D4: `getEndSessionUrl()` gains a `try/catch` it doesn't have today

**Decision:** Wrap the `/auth/logout` handler's `getEndSessionUrl(idToken, getAppOrigin())`
call in a `try/catch`. On error: sanitize and log via the same wrapper, then fall back to
`return reply.send({ redirectUrl: "/" })` — the same graceful-degradation shape the
handler already uses two branches above (when the IdP has no `end_session_endpoint`) and
for the `idToken` decrypt failure just above that.

**Trade-off called out explicitly:** this is a small behavior change beyond pure logging
— previously an error here would propagate uncaught to Fastify's default error handler
(likely a 500); now the user's local session is already destroyed (that happens earlier
in the handler) and they get a same-origin redirect instead of an error page, at the cost
of not completing IdP-side logout. This mirrors the existing fallback pattern in the same
function rather than inventing a new one.

**Addendum (from security review Finding 4): emit a distinct audit event on this path.**
Verified by direct read (`auth.ts:411-426`) that `auth.session_invalidated` is emitted at
line 418, *before* `getEndSessionUrl()` is called at line 426 — so extending that existing
event with an `idpLogoutCompleted` field isn't viable without restructuring the handler to
delay its emission. Instead, the new `catch` block emits a distinct
`auth.idp_logout_failed` audit event (fields: `userId`, `sessionId`), in addition to the
sanitized `log.error` call, before falling back to the same-origin redirect. Rationale:
every other security-relevant outcome in this handler already goes through the structured
audit log, and D4 widens an existing silent-degradation condition (a dangling IdP-side SSO
session — already possible today, statically, when an IdP has no `end_session_endpoint`
configured) into one reachable by *any* runtime failure of `getEndSessionUrl()`, including
a transient network blip. Without an audit event, that condition is only discoverable by
grepping error logs for shape; with one, it's queryable at scale the same way every other
auth outcome in this file already is. This is a net-new event, not a change to an existing
event's field set (the Non-Goals section's "no change to `emitAuditEvent` call sites'
existing field sets" still holds — this adds a call site, it doesn't modify one).

### D5: Stack traces are included unconditionally, not gated on `NODE_ENV`

**Decision:** `stack` is always part of the allowlist for branches 1–3.

**Rationale:** There's no existing precedent to follow — a repo-wide grep found no other
place in the backend that currently makes a production/non-production distinction for
`.stack` logging, so "follow the existing policy" (exploration's original framing) had no
existing policy to point to; this is a decision this design makes explicitly rather than
inventing an implicit one. Stack frames from `oauth4webapi`/`openid-client` internals are
file paths, line numbers, and function names — the same trust tier as `message`, which
Finding 1 already established never carries token/claim content across all 87 throw
sites. There's no reason to withhold this specific diagnostic value.

### D6: Regression test asserts final serialized JSON, against real library instances, via a real `pino()`

**Decision:** New test file `packages/backend/src/auth/__tests__/oidc-error-sanitizer.test.ts`.
For each of the five recognized error classes — `ResponseBodyError`,
`AuthorizationResponseError`, `WWWAuthenticateChallengeError`, `OperationProcessingError`,
and `ClientError` (the latter two share case 2's branch and allowlist, but each gets its
own constructed instance and assertion per task 3.2, since `ClientError` is directly
constructible from `openid-client` and is independently named in the spec scenario — see
BA review finding 1) — construct a real instance directly from the installed
`oauth4webapi`/`openid-client` packages (not a hand-rolled mock shaped like one), with a
canary string (`"CANARY_TOKEN_<uuid>"`) injected into every `cause`/`error_description`-
bearing constructor argument. Run each through `sanitizeOidcError`, log the result through
a real `pino()` instance configured the same way `app.ts` configures its logger, capture
the emitted line, `JSON.parse` it, and assert: the canary string does not appear anywhere
in the serialized text, the allowlisted fields (`errorClass`, `message`, `code`, `error`
where applicable) do appear with their real values, and — separately from the
canary-absence check — that fields withheld by redaction appear as the literal string
`"[redacted]"` rather than being absent from the object (proving masking, not deletion;
see BA review finding 2). A further case constructs an unrecognized `Error` subclass and
asserts both the `unrecognized: true` shape and the separate
`oidc_error_sanitizer.unrecognized_class` log line; another constructs a non-`Error`
thrown value (case 5) and asserts the same shape with `errorClass` derived from `typeof
err` (BA review finding 3).

**Rationale:** This is what converts Finding 2's manual, one-time empirical verification
into a permanent, CI-enforced guarantee — it fails loudly if a future `oauth4webapi`/
`openid-client` bump changes field shape, enumerability, or pino's own serializer
behavior changes underneath the pinned version.

### D7: Multi-provider verification is satisfied here via synthetic canaries, with a named follow-up task

Per exploration's resolution: this change's regression test (D6) uses synthetic error
instances shaped like real library output, which is sufficient proof that the mechanism
is provider-agnostic *by construction* (it dispatches on library-level classes, never
provider strings). It is **not** proof that a specific second real IdP's actual error
responses map cleanly onto these same four classes. `tasks.md` carries an explicit task
for whichever future change onboards a second provider: re-run an equivalent canary
assertion against that provider's real error responses before considering that
provider's auth path production-ready.

**Scope of the guarantee, stated precisely (per design review Finding 3):** "provider-
agnostic by construction" means: no dispatch-logic change is required for a provider
integrated through the *same* OIDC client library (`openid-client`/`oauth4webapi`) this
application already uses — verified here by reading every redacted-field's constructor
call site and confirming each `message` is a static string literal never built from
IdP-supplied content, and that the `error` field kept visible in case 1a is read via a
fixed-shape extraction (`options.cause.error` / `.get('error')`), never free text. It does
**not** mean "any provider, however integrated." A provider requiring a different client
library entirely — one that doesn't throw these four `oauth4webapi` classes at all — is
explicitly out of scope for this guarantee and is exactly the scenario task 6.2's
follow-up exists to verify. `specs/auth-error-handling/spec.md`'s added requirement is
worded to state this boundary explicitly, rather than as an unqualified claim, so it
doesn't read as a stronger guarantee in isolation than this section states.

### D8: Declare `oauth4webapi` as an explicit, pinned direct dependency

**Decision:** Add `"oauth4webapi": "3.8.6"` (exact pin, matching the version currently
resolved via `openid-client@6.8.4`'s own `^3.8.5` range, and the version the regression
tests construct real instances against) to `packages/backend/package.json`'s
`dependencies`. Import `OperationProcessingError` directly from `oauth4webapi` in the
sanitizer module, rather than relying on it being reachable via `openid-client`.

**Rationale:** D3 case 2's dispatch requires `instanceof OperationProcessingError`.
`openid-client` re-exports `AuthorizationResponseError`, `ResponseBodyError`, and
`WWWAuthenticateChallengeError` but not `OperationProcessingError` (verified against
`node_modules/openid-client/build/index.js:16`). Today the import resolves only because
npm hoists `oauth4webapi` to the workspace root as a transitive dependency of
`openid-client`; `packages/backend/package.json` doesn't declare it. This matters
specifically because `getEndSessionUrl()` → `buildEndSessionUrl()` → `resolveEndpoint()`
→ `validateEndpoint()` is synchronous and bypasses `openid-client`'s `errorHandler()`
entirely (verified independently by both design reviewers) — it's the one call site that
can throw a raw, unwrapped `OperationProcessingError` (a missing or malformed
`end_session_endpoint`, or an insecure-protocol check), and therefore the one call site
where a broken hoist would matter. The failure mode if the import were ever wrong is
fail-safe, not fail-open: a mismatched `instanceof` just routes into the D3 case 4/5
fail-closed branch, so this is a diagnostic-quality risk (this specific, informative
case degrading into a generic "unrecognized class" signal), not a confidentiality risk.
But a design whose entire premise is making error handling *structural* rather than
*incidental* (D2) shouldn't itself depend on an undeclared, incidental dependency
resolution path.

This is dependency **hygiene**, not a version or policy change: the resolved version
(`3.8.6`) is unchanged and already installed; `openid-client`'s own `^6.8.4` pin is
untouched (still out of scope, per Non-Goals). `openid-client`'s own `^3.8.5` range on
`oauth4webapi` remains a separate, pre-existing caret-range concern — folded into task
6.3's existing follow-up alongside `openid-client`'s own caret range, since both describe
the same underlying risk ("a minor/patch bump could shift error-shape behavior with no
change-review trigger on this package's `package.json` alone").

Task 3.2's `OperationProcessingError` regression case is updated to specifically exercise
the `buildEndSessionUrl()`-reachable path (simulate discovered issuer metadata with no
`end_session_endpoint`) rather than an arbitrary synthetic construction, so the test
proves the call site that actually needs this works, not just that the class exists
somewhere in the test file.

### D9: `refreshSessionTokens` gains a new log line — the fail-closed signal needs a call site that can actually log it

**Decision:** Add a new `log.error` call in `middleware.ts`'s `refreshSessionTokens`,
routed through `sanitizeOidcError`, immediately after the retry loop exhausts and before
`transient_failure` is returned (task 2.2 carries the exact placement and field set).

**Why this needed an explicit decision rather than an assumption:** verified by direct
read (`middleware.ts:103-134`, matching design review §2) that `err` is inspected for the
`isRevocation` heuristic and then discarded — it never reaches any logging call today.
Read literally, the previous drafting of task 2.2 ("route any error logging of `err`
through `sanitizeOidcError`") was satisfiable by doing nothing, since there was no
existing error logging of `err` at this call site to route. That's the wrong outcome for
this change specifically: D3 case 4/5 (fail-closed, loud signal on an unrecognized error
class) is this design's answer to "what happens when the sanitizer sees a shape it
doesn't recognize," and it can only be loud if something actually calls the wrapper and
logs the result. Token refresh is the one path where an unrecognized OIDC error currently
produces *zero* log output — not even an unsanitized one — while still silently tearing
the session down via `transient_failure`, and it's a background/unattended path, unlike
`/auth/callback` where the user at least sees the `/auth/error` page.

**Alternative considered and rejected:** call `sanitizeOidcError` at this call site purely
for consistency, but discard its return value (no new log line). This would satisfy the
old task 2.2 wording literally while defeating D3 case 4/5's purpose at the one call site
that needs it most — rejected on the same reasoning as design review §2's option (a),
which recommended against it.

This is a deliberate, small scope addition beyond "route existing logging calls through
the wrapper" — recorded here explicitly, and reflected in the revised task 2.2, rather
than left for an implementer to infer from ambiguous task wording.

### D10: Fix the `isRevocation` misclassification inline, as an explicit in-scope correction

**Decision:** Fix `middleware.ts`'s `isRevocation` check — currently
`err.message.includes("invalid_grant")` or `("code" in err && err.code ===
"invalid_grant")` — to instead check `err instanceof ResponseBodyError && err.error ===
"invalid_grant"`, reading the same `error` field D3 case 1a already treats as the
trustworthy, spec-defined OAuth enum.

**Rationale:** Verified by direct read of `oauth4webapi`'s `ResponseBodyError` (the class
`refreshTokenGrant()` throws when the IdP's token endpoint responds
`{error: "invalid_grant", ...}` to a revoked refresh token): `.message` is always the
fixed generic string `"server responded with an error in the response body"` — it never
contains `"invalid_grant"` — and `.code` is always the fixed internal enum
`"OAUTH_RESPONSE_BODY_ERROR"`, never the OAuth error code. `isRevocation` checks exactly
the two fields that, per this design's own D3 taxonomy (`code` = internal enum, `error` =
OAuth code), are structurally guaranteed never to carry `"invalid_grant"`, and never
inspects `.error`, which does. Net effect today: a genuinely revoked refresh token falls
through to the `transient_failure` path — two retries, 5 seconds apart — before the
session is torn down with an incorrect `failureType: "transient"` audit record instead of
`"revoked"`.

This bug is pre-existing and not introduced by this change. It is fixed here, in this
change, as an explicit decision rather than deferred to a follow-up, for three reasons:
(1) task 2.2 already requires reading and touching this exact `catch` block; (2) this
design is the first change to closely audit this exact error taxonomy, and it now
documents the `code`/`error` distinction precisely enough that leaving the check
unexamined would read as an oversight rather than a deliberate deferral; (3) the fix is
one line, low-risk, reads a field (`error`) this change's own D3 already establishes as
safe to log and therefore safe to branch on, and doesn't touch the sanitizer, the
allowlists, or any other call site — it doesn't expand this change's blast radius beyond
the one `catch` block task 2.2 already scopes in.

**Explicitly not scope creep:** this doesn't change what this change is *about* (log
sanitization) — it corrects a classification check that reads a field this change's own
design already establishes as trustworthy. Task 2.2 isolates it as a single, revertible
line, distinct from the logging changes in the same task, so it can be reviewed or
reverted independently if a reviewer disagrees it belongs here.

## Risks / Trade-offs

- **A future call site (a hypothetical 4th `oidc-client.ts` consumer) forgets to route
  through `sanitizeOidcError`.** → Mitigated by: the wrapper's onboarding code comment
  (documenting the enumerability invariant and a checklist), the grep-able convention
  from D1, and code review. Not fully solved by this change — a lint rule enforcing "no
  direct `request.log.error({ err })` where `err` may originate from `oidc-client.ts`
  without going through the wrapper" is a reasonable future hardening step, out of scope
  here.
- **The sanitized plain object still passes through pino's default `err` serializer**
  (since anything with a string `.message` is `isErrorLike`). → Mitigated by: D2's
  "opt-in fields only" construction (nothing sensitive is ever a property of the
  returned object in the first place), the `errorClass` field naming (D3) that avoids
  pino's reserved `type` recomputation, and D6's test asserting the actual final JSON,
  not an intermediate shape.
- **Fail-closed default (D3, branch 4/5) reduces diagnostic detail if a future,
  legitimately benign new error class appears** (e.g. a new `oauth4webapi` minor-version
  error subtype). → Mitigated by: the distinct `unrecognized_class` signal event makes
  this visible immediately rather than silently degrading; this is a deliberate
  safety-over-completeness trade-off already decided in exploration, not an oversight.
- **`getEndSessionUrl()`'s new `try/catch` (D4) changes production behavior for that one
  failure path**, not just its logging. → Mitigated by: it reuses an existing fallback
  shape already present two branches away in the same handler; called out explicitly
  here and in `tasks.md` so it isn't mistaken for a pure logging change during review; the
  new `auth.idp_logout_failed` audit event (D4 addendum) makes the resulting
  dangling-IdP-session condition queryable rather than merely grep-able.
- **Multi-provider re-verification (D7) isn't fully closed by this change**, and the
  guarantee this change does make is narrower than "any provider" — it covers only
  providers integrated through the same client library (`openid-client`/`oauth4webapi`).
  → Mitigated by: an explicit, named task (6.2) carried into whichever future change adds
  a second provider; the scope boundary is now stated explicitly in this document and in
  the delta spec requirement itself, rather than left to be inferred or assumed already
  covered (design review Finding 3).
- **`oauth4webapi` becoming a declared direct dependency (D8) doesn't, by itself, guard
  against `openid-client`'s own `^3.8.5` range on it drifting to a version with different
  error shapes.** → Mitigated by: D6's regression suite runs against the actually-
  installed version and fails loudly on a shape change; task 6.3's follow-up flags both
  caret ranges (`openid-client`'s `^6.8.4` and its own `^3.8.5` on `oauth4webapi`) to
  whoever owns dependency policy, since a bump to either can shift behavior with no
  change-review trigger on this package's `package.json` alone.
- **D9's new log line and D10's `isRevocation` fix are both real behavior changes to
  `refreshSessionTokens`, beyond adding a wrapper call.** → D9 adds log volume (one new
  `log.error` per exhausted-retry token refresh failure) where there was none before —
  acceptable since this is precisely the fail-closed signal D3 exists to surface, and it
  only fires on failure, not on the (default) success path. D10 changes the
  `failureType` audit field from `"transient"` to `"revoked"` for genuinely revoked
  refresh tokens, and removes ~10 seconds of retry latency (2 retries × 5s) for that same
  case — this is a correctness fix, not a new failure mode, and only affects the
  already-broken misclassification path.

## Migration Plan

No data migration. Standard backend deploy. The change is additive to logging behavior
and localized to auth error paths. Externally-observable behavior changes:
- `/auth/logout` degrades to a same-origin redirect instead of a 500 when
  `getEndSessionUrl()` throws (D4), now paired with a new `auth.idp_logout_failed` audit
  event on that path.
- A revoked refresh token is now classified and audited as `failureType: "revoked"`
  (previously misclassified as `"transient"`) and no longer incurs ~10s of retry delay
  before the session is torn down (D10).
- Token refresh failures that fall through to the fail-closed unrecognized-error branch
  now produce a `log.error` line where previously they produced none (D9).

Rollback is a plain revert — no schema, session format,
or token-storage changes are involved.

## Open Questions

- Debug-level capture of `error_description`: whether to build it, which log sink/level,
  retention policy — pending sign-off from whoever owns log retention/access policy.
  Non-blocking; "drop entirely" is the default if unresolved before implementation
  starts.
- Final sign-off on the field allowlist (D3) from whoever owns log policy — this design
  is a considered starting point, not a guaranteed-final spec from that owner's
  perspective. **Non-blocking:** this change ships with D3's allowlist as the default and
  does not wait on that sign-off to merge (see `tasks.md` 6.4); if sign-off later requires
  changes, that's a fast-follow amendment, not a gate on this change.
- Whether the D7 follow-up task (re-verification against a real second provider) should
  block that future provider's launch or merely be strongly recommended — left for that
  future change's own proposal to decide, since it depends on which provider and what
  that change's own risk tolerance is.
