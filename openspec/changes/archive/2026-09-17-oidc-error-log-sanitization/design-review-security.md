# Security Review: OIDC Error Log Sanitization — Design

**Reviewer:** Tomás Ferreira (Senior Application Security Analyst)
**Reviewed:** `design.md`, `proposal.md`, `specs/auth-error-handling/spec.md`, `tasks.md`, `exploration-notes.md`
**Method:** Not reasoning from the design document's prose alone. I pulled the installed
`oauth4webapi@3.8.6`/`openid-client@6.8.4`/`pino-std-serializers` source myself and traced
all three call sites (`handleCallback`, `refreshToken`, `getEndSessionUrl`) against it,
the same discipline the exploration phase used and that I expect from any change closing
a finding I raised.

**Verdict:** This is a well-reasoned design and closes the residual risk I flagged in
`archive/2026-07-05-first-access/implementation-review-security.md` §1 — a real,
verbatim, unredacted `error_description` leak, confirmed still present in the current
`auth.ts` catch block I re-read as part of this review. The class-based dispatch
architecture is sound and I verified its central claims independently rather than taking
them on faith. I found one concrete defect that will silently undermine the design's own
diagnostic goal (not a confidentiality leak), one dependency-hygiene gap that happens to
sit on the one call site most likely to exercise it, one place where spec language
overclaims what the design itself admits, and one audit-logging gap consistent with a
pattern I flag on every review. None of these are reasons to block moving to
implementation, but all four should be resolved before this ships, and one is
implementation-critical enough that I'd fail an implementation review that shipped without
addressing it.

---

## Finding 1 (Should fix — verified defect): D2's "inert" claim is false for the `type` field

D2 states: *"the wrapper returns a plain object... this second pass is inert."* I checked
this against the actual installed `pino-std-serializers/lib/err.js` rather than trusting
the claim, since Finding 2 in `exploration-notes.md` explicitly warns against exactly this
kind of untested assumption about pino internals — and it's the same code D2 cites as its
own evidence.

`err.js`'s `errSerializer` does this unconditionally, before it ever looks at what fields
already exist on the object you hand it:

```js
_err.type = toString.call(err.constructor) === '[object Function]'
  ? err.constructor.name
  : err.name
```

`sanitizeOidcError` returns a plain object literal (`{ type: "ResponseBodyError", ... }`
per D3). A plain object literal's `.constructor` is the global `Object`, so
`err.constructor.name` is `"Object"` — **not** the class name the wrapper deliberately
computed. Because `_err.type` is set before the `for...in` copy loop runs, and that loop
only copies a key when `_err[key] === undefined`, the wrapper's own `type` property is
silently discarded. `message` and `stack` are fine — `messageWithCauses`/`stackWithCauses`
read `err.message`/`err.stack` directly off whatever object they're given, so those two
fields pass through correctly (I traced this too). `type` is the one field affected, and
it's affected in every single branch, including the two recognized-error branches whose
entire purpose is to keep `type` visible for triage.

This is **not a leak** — the failure mode is that every log line will show `type: "Object"`
instead of `"ResponseBodyError"` / `"ClientError"` / etc., which is a loss of diagnostic
value, not an exposure of anything new. But it directly undercuts one of this change's own
stated goals (making an operator's triage experience *better*, not just safer), and it will
make the regression test's own assertion — tasks.md 3.5, "allowlisted fields (`type`,
`message`, `code`, `error` where applicable) are present with their real, non-redacted
values" — either fail as written, or get silently "fixed" by an implementer who redefines
"real value" to mean `"Object"` without noticing that's not what was intended. Given D6's
whole premise is "assert against final JSON, not the intermediate shape, because pino
internals bite people who only reason about them," this is exactly the kind of bite D6
exists to catch — I'd rather flag it now than have it discovered as a confusing test
failure during implementation.

**Recommendation:** rename the field the wrapper uses to carry the class name to something
outside pino's reserved computation — e.g. `errorClass` instead of `type` — so it survives
the serializer's `for...in` pass untouched. Cheaper than logging under a non-`err` key
(which would sidestep `errSerializer` entirely but changes whatever downstream
log-query/dashboard convention currently expects an `err`-keyed error object).

---

## Finding 2 (Should verify before implementation): `OperationProcessingError` isn't re-exported by `openid-client`, and the one call site most likely to throw it raw is exactly the one this change adds handling to

`packages/backend/package.json` depends on `openid-client` only — `oauth4webapi` is not a
direct dependency, just a transitive one (confirmed a single top-level install exists at
`node_modules/oauth4webapi`, no duplicate nested copies, so today's hoisting works). I
checked what `openid-client` actually re-exports:

```js
export { AuthorizationResponseError, ResponseBodyError, WWWAuthenticateChallengeError, } from 'oauth4webapi';
```

`OperationProcessingError` is **not** in that list. For `handleCallback()` and
`refreshToken()`, this doesn't matter in practice — both go through
`client.authorizationCodeGrant()`/`client.refreshTokenGrant()`, which route every failure
through `openid-client`'s internal `errorHandler()`. I read that function: it rewraps the
entire `OperationProcessingError` family into openid-client's own (correctly exported)
`ClientError` before the error ever reaches application code — so `instanceof ClientError`
alone is sufficient for those two call sites, and D3 case 2's inclusion of
`OperationProcessingError` there is defensive, not load-bearing.

`getEndSessionUrl()` is different. It calls `client.buildEndSessionUrl()`, which is
**synchronous** and never touches `errorHandler()` at all. I traced its internals
(`resolveEndpoint()` → `validateEndpoint()`): a missing or malformed `end_session_endpoint`
in the discovered issuer metadata (`MISSING_SERVER_METADATA`/`INVALID_SERVER_METADATA`,
or an insecure-protocol check) throws a **raw, unwrapped `oauth4webapi` `OperationProcessingError`
directly** — no `ClientError` wrapping. This is precisely the call site D4 adds the new
`try/catch` around. For the sanitizer's `instanceof OperationProcessingError` check to
match here, it has to import that class from `oauth4webapi` directly, which today would
have to rely on hoisting through an undeclared transitive dependency — it works, until a
lockfile change, a package-manager switch, or a version bump breaks the hoist silently.

The failure mode if this import is ever wrong is fail-safe, not fail-open — a mismatched
`instanceof` just routes into the fail-closed unrecognized branch (Finding 5 below confirms
this is genuinely conservative). So this isn't a confidentiality risk. But it means a
routine, non-attacker-driven condition (an IdP metadata change or misconfiguration) would
look like a recurring `oidc_error_sanitizer.unrecognized_class` signal instead of the
specific, informative case-2 shape the design intends for exactly this scenario —
degrading the diagnostic value D4 is supposed to add at the one call site that previously
had *no* handling at all.

**Recommendation:** add `oauth4webapi` as an explicit direct dependency of
`packages/backend`, pinned to whatever range `openid-client@6.8.4` itself bundles, purely
for import-hygiene (this is a "secrets/dependencies shouldn't require discipline to stay
correct" pattern, not a new finding). Also worth having tasks.md 3.2's
"construct a real `OperationProcessingError` instance" case specifically exercise the
`buildEndSessionUrl()`-reachable path (e.g. simulate metadata with no
`end_session_endpoint`) rather than an arbitrary synthetic construction — that proves the
call site that actually needs this works, not just that the class exists somewhere in the
test file.

---

## Finding 3 (Should tighten before merge): spec.md's multi-provider language overclaims relative to design.md's own D7

`proposal.md`'s Why section and the spec delta's added requirement both state the
mechanism "remains correct for identity providers added after the application's initial
provider with **no change to the sanitization logic itself**" — phrased as an unconditional
guarantee. `design.md`'s own D7 is more careful and, I think, more honest: *"sufficient
proof that the mechanism is provider-agnostic by construction... It is **not** proof that a
specific second real IdP's actual error responses map cleanly onto these same four
classes."*

These two are in tension, and the spec is the artifact most likely to be read in isolation
by whoever picks up the second-provider work later — if they trust the requirement text as
written, they have no reason to go looking for D7 or tasks.md 6.2 at all. That's a direct
risk to the exact follow-up this design is careful to name elsewhere. This is the same
"internal is not a lower-risk category, it's a different-risk category" instinct I keep
coming back to: a guarantee that's true for "any provider going through
`openid-client`/`oauth4webapi`" reads, unqualified, as true for "any provider," and nothing
in the requirement text marks that boundary.

I also verified the underlying class-based-dispatch claim is real, not just asserted —
I read the actual constructor call sites for all three redacted-field classes and confirmed
every `message` is a static string literal, never built from IdP-supplied content, and that
the `error` field kept visible in case 1 is read via a fixed-shape extraction
(`options.cause.error` / `.get('error')`), not free text. So the mechanism is
provider-agnostic by construction in the sense the design claims. What's unverified is
narrower and exactly what D7 says: a provider integrated through a *different* client
library entirely. `proposal.md`'s Impact narrative names this specific scenario ("a second
IdP's client library not going through oauth4webapi at all is a realistic way an
unrecognized shape reaches this wrapper") — but `design.md`'s own Risks/Trade-offs section
only says D7 "isn't fully closed," without restating that concrete mechanism. I'd rather
see the sharper framing from proposal.md carried into design.md's own risk register, and
the spec requirement reworded to state the boundary explicitly — something like: no
dispatch-logic change is required for a provider integrated through the same OIDC client
library; a provider requiring a different client library is out of scope for this
guarantee and requires the verification named in D7.

---

## Finding 4 (Recommend, not blocking): getEndSessionUrl() failure has no audit trail, and widens a pre-existing silent condition

D4's fallback logs the sanitized error via `log.error` only — there's no `emitAuditEvent`
call on this path. Every other security-relevant outcome in this same file
(`auth.session_invalidated`, `auth.token_refresh_failure`, `auth.failure`,
`auth.first_access_created`) goes through the structured audit log. This one won't.

The pre-existing "IdP has no `end_session_endpoint`" branch already degrades silently today
(a `log.warn`, no audit event) — that's not new. What D4 does is widen the set of
circumstances under which "the user believes they logged out, but the IdP-side session is
still alive" can happen, from a static, deploy-time-known condition to *any* runtime
failure of `getEndSessionUrl()` — including a transient network blip or a temporarily
misbehaving IdP — with no way for anyone to query how often it's happening. On a
shared/kiosk device, a dangling IdP SSO session is exactly the kind of "session behaved
unexpectedly" scenario I look for in every review, and right now this design makes that
condition strictly harder to detect at scale (searching error logs by shape) than trivial
(one audit event field). I'd also note the same collapse happens client-side: the frontend
previously got a 500 on this failure path and now gets an indistinguishable-from-success
200 with `{ redirectUrl: "/" }` — there's no signal left anywhere, user-facing or
operator-facing, that IdP-side logout didn't complete.

This is a net improvement over today (an uncaught 500 with an unsanitized log line is worse
on every axis), so I'm not blocking on it. But since this exact code path is already being
touched, I'd rather this land now than as a second change later: extend
`auth.session_invalidated` with an `idpLogoutCompleted: boolean` field (both `userId` and
`sessionId` are already in scope at this point in the handler), or emit a distinct
`auth.idp_logout_failed` event alongside the sanitized `log.error`.

---

## Finding 5 (Confirmed — fail-closed is real, not just labeled that way)

I traced all three call sites end-to-end against the actual library internals rather than
trusting D3's branch list. Every error that can realistically reach the wrapper from
`handleCallback()`, `refreshToken()`, or `getEndSessionUrl()` is either one of the four
explicitly recognized classes or a generic `Error`/`TypeError`/`DOMException`-derived
wrapper that correctly falls into the conservative default (case 4/5 is the *only* branch
that also redacts `message`, which is the right asymmetry — an unrecognized shape carries
no guarantee the way Finding 1 in exploration established for the known classes). The one
place this fails-safe-not-leaks depends on getting an implementation detail right is
Finding 2 above (the `OperationProcessingError` import), and I confirmed that a wrong
import degrades into over-redaction, not exposure. I did not find a path where an
unrecognized error's sensitive content could reach the log with `message` left
unredacted. This part of the design holds up under direct verification.

## Finding 6 (Confirmed — the `"[redacted]"` marker doesn't create a side channel)

Which fields get the literal marker is determined entirely by error **class** (D3's fixed
branch list), never by the withheld value's length, presence, or content — the marker
string itself is a fixed literal, not a truncation or hash of the original. There's no
version of this design where the *shape* of a redacted log line tells you anything about
the *value* that was withheld beyond what the already-visible `type`/`code`/OAuth `error`
enum already discloses on purpose. One cosmetic (non-security) note: because D2 builds the
object as opt-in fields regardless of whether the source field was actually populated on
that specific error instance, `error_description: "[redacted]"` will appear even when the
IdP didn't send an `error_description` at all — so the marker sometimes means "withheld"
and sometimes means "was never there to withhold," which slightly muddies the "operator can
tell purposeful redaction from broken logging" goal exploration's Finding 2 resolution set
out to satisfy. Not worth blocking on.

---

## Summary

| # | Finding | Severity | Blocking? |
|---|---|---|---|
| 1 | `type` field silently becomes `"Object"` after pino's default `err` serializer re-processes the sanitized return value | Should fix | No, but will surface as a confusing test failure if not addressed before implementation |
| 2 | `OperationProcessingError` isn't re-exported by `openid-client`; `getEndSessionUrl()` is the one call site that can throw it raw, and the import path relies on an undeclared transitive dependency | Should verify | No — fails safe, not open |
| 3 | spec.md's multi-provider requirement language is stronger than design.md's own D7 caveat | Should tighten | No |
| 4 | No structured audit event on IdP end-session failure; widens an existing silent-degradation condition | Recommend | No |
| 5 | Fail-closed default verified structurally sound across all three real call sites | N/A (confirms design) | — |
| 6 | Redaction marker verified to carry no structural/length side channel | N/A (confirms design) | — |

None of these block moving from design to implementation. Findings 1 and 2 should be
resolved as part of implementation (both are concrete enough to fold into tasks.md's
existing module/test tasks rather than needing new ones); Finding 3 is a wording fix to
spec.md; Finding 4 is a low-cost addition I'd like to see land in this change rather than
be deferred. This change closes the residual risk from the first-access review's §1 as
intended, and the class-based, provider-agnostic dispatch architecture is sound.
