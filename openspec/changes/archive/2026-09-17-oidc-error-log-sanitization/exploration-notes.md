# Exploration Notes: OIDC Error Log Sanitization (Issue #2)

**Explored by:** Devon Calloway (Internal Champion / Subject Matter Expert persona)
**Date:** 2026-09-17
**Mode:** opsx:explore (investigation only — no code changes)

## Framing

This is a "must resolve before first production deployment" security item, not a design
question about the ritual itself. My usual lens — does this protect the no-manager rule,
the simultaneous reveal, the facilitator-from-another-team constraint — doesn't apply
directly here. What *does* apply is the same instinct: don't take the vendor's (or in
this case, the library's) word for it. The issue says the error content "has not been
audited." So audit it, with evidence, not assumption. I pulled the actual installed
code and ran it against the actual logger rather than reasoning from the library's
public docs.

I also kept the multi-provider requirement in view throughout, since it's a standing
constraint on this project: Entra is the first IdP, not the only one the app is
required to support (`requirements/use cases/01 - Identity and Access - Use Cases.md`
explicitly declines to name a protocol/provider — "an implementation concern"). A
sanitization design that only accounts for Entra's error shapes is a design that will
quietly stop working the day a second provider is onboarded.

**Revision note (2026-09-17):** These notes were reviewed by the Facilitator (Priya
Nair, `explore-review-facilitator.md`) and BA (Marcus Delgado, `explore-review-ba.md`)
personas. Both reviews confirmed the core diagnosis (Findings 1 and 2) without changes.
I've folded their feedback into the "required action" list and replaced the old "open
questions" section below with resolved decisions plus a shorter list of what's
genuinely still open — see "Resolution of review feedback" near the end. Where I pushed
back on a suggestion, I've said why inline rather than silently dropping it.

## What's installed

- `openid-client@6.8.4` (`packages/backend/package.json`, confirmed installed version
  in `node_modules/openid-client/package.json`)
- `oauth4webapi@3.8.6` — openid-client v6 is a thin wrapper around this package; nearly
  all the actual protocol logic (including every error thrown during token exchange
  and ID token validation) lives in oauth4webapi, not openid-client itself.
- No CHANGELOG is bundled in either package's npm tarball, so "review changelogs" (as
  the issue requests) isn't directly possible from installed files. I instead read the
  shipped `build/index.js` source directly and verified behavior empirically against
  the app's actual pino version — stronger evidence than changelog prose would have
  been anyway, since it reflects exactly what's running.

## The actual code path

`packages/backend/src/auth/oidc-client.ts::handleCallback()` calls
`client.authorizationCodeGrant(oidc, callbackUrl, {...})` and returns whatever it
resolves with, uncaught. Any error thrown during that call propagates unmodified up
through `packages/backend/src/routes/auth.ts` to the catch block at line 331, which
does:

```ts
request.log.error({ err, correlationId, sourceIp: request.ip, event: "auth.callback_error" });
```

No serializer override for `err` exists anywhere in the app (`packages/backend/src/app.ts`
only customizes the `req` serializer, to redact join tokens from URLs). So whatever
pino's *default* error serializer does with `err` is exactly what reaches the log
output. That default is `pino-std-serializers`' `err.js` (`node_modules/pino/pino.js`:
`defaultErrorSerializer = stdSerializers.err`).

## Finding 1 — error *messages* are safe by construction (confirms the issue's hope)

Every error oauth4webapi throws during token exchange and ID token validation uses a
static, generic message string — never string-interpolated with a claim value, nonce,
or token fragment. Examples straight from `node_modules/oauth4webapi/build/index.js`:

```
'unexpected ID Token "nonce" claim value'
'unexpected JWT "aud" (audience) claim value'
'too much time has elapsed since the last End-User authentication'
'JWT signature verification failed'
'Invalid JWT'
```

I grepped every `OPE(...)` throw site (87 of them) — the pattern is uniform. The actual
sensitive data (decoded claims, expected nonce, raw JWT compact string, signature
bytes, key material) is passed as a *third argument* that becomes `err.cause`, never
folded into `message`. openid-client's own `errorHandler()` (`build/index.js:118`)
re-wraps most of these into `ClientError` with messages that are *more* generic still
("unexpected JWT claim value encountered" — it collapses "nonce"/"aud"/etc. distinctions
away entirely).

So: `err.message` and `err.stack` — the two fields pino always includes — carry nothing
token-adjacent. Good, and this matches what `MissingClaimError` already does correctly
in the app's own code (`packages/backend/src/auth/errors.ts` — carries the claim name,
never the value, exactly the same discipline).

## Finding 2 — but `err.cause` sometimes *does* carry token content, and whether it leaks depends on an easy-to-miss enumerability distinction

This is the part I don't think the issue author anticipated, and it's the actual crux
of the investigation.

For `OperationProcessingError` (nonce mismatch, claim mismatches, signature failures,
timestamp checks, the "Invalid JWT" case where `cause` is literally the raw JWT compact
string) — the class sets `cause` via the *native* `Error(message, { cause })`
constructor pattern:

```js
export class OperationProcessingError extends Error {
    constructor(message, options) {
        super(message, options);   // <-- cause set here
        ...
    }
}
```

Per the ECMAScript Error-cause spec, this installs `cause` as a **non-enumerable**
own property. I verified this directly:

```
own enumerable keys: []
cause enumerable? { ..., enumerable: false, ... }
```

pino's default serializer (`pino-std-serializers/lib/err.js`) only pulls in `cause`
if it passes `isErrorLike()` (has a string `.message`) — a plain object of claims, or a
raw JWT string, never does — and otherwise walks `for...in` to copy extra fields, which
skips non-enumerable ones entirely. I confirmed with a real `pino()` instance and a
reconstructed `OperationProcessingError` carrying `{ expected: <nonce>, claims: { sub,
email, nonce } }` as cause: **none of it appeared in the logged JSON.** Only
`type`, `message`, `stack`, `code`, `name`.

So for the whole `OperationProcessingError` family — which covers nonce mismatch,
audience/issuer mismatch, expired/not-yet-valid token, and signature verification
failure, i.e. most of what the issue names explicitly — the current setup is
**already safe**, but *incidentally* safe: it depends on (a) Node's native Error-cause
being non-enumerable, (b) pino's default serializer's specific `isErrorLike` +
`for...in` logic, and (c) nobody in this codebase ever explicitly reading `err.cause`
and logging it separately. None of those three are guarded by a test. All three could
silently stop being true — a pino major bump that changes serializer behavior, a
custom `err-with-cause` serializer added later for better debugging (it exists in the
same `pino-std-serializers` package already, one config line away), or a future
engineer adding `causeSummary: err.cause` to the log call to help debug a support
ticket.

**But `ResponseBodyError` and `AuthorizationResponseError` are a different story, and
they leak today.** These classes don't rely on the native `cause` mechanism — they
declare `cause`, `error`, `error_description` etc. as ordinary class fields and assign
them explicitly in the constructor:

```js
export class ResponseBodyError extends Error {
    cause; code; error; status; error_description; response;
    constructor(message, options) {
        super(message, options);
        this.cause = options.cause;                       // plain assignment — enumerable
        this.error = options.cause.error;                  // enumerable
        this.status = options.response.status;
        this.error_description = options.cause.error_description;  // enumerable
        ...
    }
}
```

Plain `this.x = y` assignments are enumerable by default — unlike the special-cased
native `cause`. I verified this end-to-end with the real pino instance and a
`ResponseBodyError` shaped exactly like what oauth4webapi constructs at
`checkOAuthBodyError()` (which is called at line 1214 of oauth4webapi's source
specifically for the **Token Endpoint** — i.e., directly inside the token-exchange step
`handleCallback()` performs). The logged output included:

```json
"cause": {"error":"invalid_grant","error_description":"AADSTS70008: ...user=jane.doe@contoso.com token=abcxyz"},
"error": "invalid_grant",
"error_description": "AADSTS70008: ...user=jane.doe@contoso.com token=abcxyz"
```

full and unredacted, as structured top-level fields on the logged `err` object. This
class is thrown whenever the IdP's token endpoint responds with an HTTP 4xx and a JSON
`{error, error_description}` body during code exchange — e.g. an expired/reused
authorization code, a replay attempt, a misconfigured client. `AuthorizationResponseError`
follows the identical pattern for the case where the IdP redirects back to `/auth/callback`
with `?error=...&error_description=...` in the query string (also inside
`authorizationCodeGrant()`'s processing, so also reachable from `handleCallback()`).
`WWWAuthenticateChallengeError` has the same structural pattern but is far less likely
to fire on this code path (it's for resource-request challenges, not the callback
exchange).

Crucially: openid-client's `errorHandler()` explicitly special-cases these three classes
to **rethrow them unmodified**:

```js
if (err instanceof ClientError ||
    err instanceof oauth.ResponseBodyError ||
    err instanceof oauth.AuthorizationResponseError ||
    err instanceof oauth.WWWAuthenticateChallengeError) {
    throw err;
}
```

So there's no openid-client-level normalization protecting the app here — whatever the
IdP put in `error_description` reaches `request.log.error` verbatim.

## Why this matters more, not less, because of the multi-provider requirement

`error_description` content is IdP-defined, not OIDC-spec-defined. The spec only
requires it be a human-readable ASCII string; it says nothing about what it may
contain. Entra's AADSTS-prefixed messages are relatively disciplined and rarely
include full token values, but "relatively disciplined" is doing a lot of work in that
sentence — Microsoft's own guidance treats AADSTS text as free-form/diagnostic, not a
security boundary, and it has changed shape across product changes before. Other
providers this project is required to eventually support have no equivalent editorial
discipline at all — some generic/self-hosted OIDC servers are considerably more verbose
in error responses (echoing back partial request parameters, client identifiers, or in
misconfigured deployments, more than that). The current code applies **zero
provider-aware handling** — it just logs `err` and lets whatever the specific class
happens to expose flow through. A sanitization design that only reasons about Entra's
AADSTS format would pass code review today and quietly become inadequate the day a
second IdP is added, which is explicitly the trajectory this system is on.

This is the same shape of risk I keep flagging in every review: something that "happens
to be fine" for the one provider in front of us but isn't structurally guaranteed to
stay fine. The nonce/claims/JWT safety in Finding 1 is *accidentally* robust because of
a JS engine implementation detail; the `error_description` leak in Finding 2 is
*actively* happening today and provider-shape-dependent in how bad it can get.

## Where this leaves the "required action" list from the issue

1. **Installed version identified**: `openid-client@6.8.4`, `oauth4webapi@3.8.6`. Done.
2. **Reviewed source for error message content during token validation failures**:
   Done via direct source inspection (no bundled changelog available) — see Finding 1.
3. **Confirmed whether messages include raw JWT/claim/auth-code content**:
   - `err.message` / `err.stack`: never. Confirmed by source audit across all 87 throw
     sites.
   - `err.cause` for the `OperationProcessingError` family (nonce, claims, signature,
     timestamp checks): present in the object but not currently reaching logs, due to
     non-enumerability — confirmed empirically, but this is incidental, not
     structural.
   - `err.error_description` / `err.cause` / `err.error` for `ResponseBodyError` and
     `AuthorizationResponseError` (IdP-returned OAuth errors during code exchange or
     callback redirect): **confirmed leaking today**, verbatim, unredacted, as
     structured JSON fields. This is IdP-controlled content, not library-controlled,
     which is exactly the multi-provider exposure the issue's spirit anticipates even
     though its explicit examples (nonce mismatch) turned out to be the safer half of
     the picture.
4. **A sanitizing wrapper is needed** — but the shape of it should probably be
   different from what "strip token content from a message string" suggests. The
   message strings were never the problem. What's needed is something that:
   - Handles the `OperationProcessingError`/`ClientError` family in a way that doesn't
     quietly depend on serializer/enumerability incidental behavior — make the safety
     structural (e.g. explicitly allowlist which fields of `err` get logged, rather
     than trusting pino's default to keep excluding `cause`).
   - Explicitly handles `ResponseBodyError` / `AuthorizationResponseError` /
     `WWWAuthenticateChallengeError` by name — these need the IdP-supplied
     `error`/`error_description` either dropped or truncated/redacted before logging,
     since that content is untrusted and provider-shape-dependent. The OAuth `error`
     code itself (`invalid_grant`, `access_denied`, etc.) is a fixed enum from the
     spec and safe to keep; `error_description` is the free-text risk and should
     probably not be logged at all, or only logged with a strict allowlist/redaction
     pass, given it's explicitly IdP-defined content this project cannot control
     across providers.
   - Is provider-agnostic by construction — keyed off error *class* (which is
     stable/spec-defined via oauth4webapi, not provider-defined), not off string
     matching against Entra-specific prefixes like `AADSTS`. `error-handler.ts`
     already sets a good precedent here (keyword-matches on `message` to categorize,
     but never echoes the raw message back to the user) — the new wrapper should
     follow the same "categorize, don't relay" discipline for what goes into the
     *log*, not just what goes into the redirect.
   - **Applies as a single shared wrapper across every call site that can throw these
     error classes**, not just `handleCallback()`'s catch block — see "Scope boundary"
     under Resolution of review feedback below.
   - **Marks what it withholds rather than silently omitting it** — a dropped field
     should appear in the logged object as `"[redacted]"` (or an equivalent explicit
     marker), not disappear. An operator seeing a field silently missing can't tell the
     difference between "withheld on purpose" and "logging broke." (Facilitator review,
     Observation 3.)
   - **Fails closed on an error class it doesn't recognize.** If a future error type
     (a new oauth4webapi release, or a second IdP's client library that doesn't go
     through oauth4webapi at all) reaches the wrapper without a matching case, the
     wrapper must redact aggressively by default and emit a loud, distinct signal (e.g.
     a separate `event: "oidc_error_sanitizer.unrecognized_class"` log line) rather than
     falling through to logging the raw object. An allowlist that fails open on an
     unrecognized shape reintroduces exactly the leak this change exists to close, and
     given the multi-provider trajectory, an unrecognized shape is a *when*, not an
     *if*. (Facilitator review, Observation 2.)

## Resolution of review feedback

The BA review is right that "open questions" left several load-bearing decisions as
options, and that's not proposal-ready — an options list just becomes a scope dispute
during implementation. Resolving each below as a decision (with reasoning), or, where
resolving it now would mean guessing at something outside this investigation's
authority, naming it as an explicit deferred decision with an owner and a default.

### Scope boundary: all call sites, one shared wrapper (resolved)

Adopting the BA's recommendation. The risk this change exists to close is "any `err`
from `openid-client`/`oauth4webapi` reaching a logger unsanitized," not "the specific
catch block the issue's author happened to look at." I already named `refreshToken()`
and `getEndSessionUrl()` in `packages/backend/src/auth/oidc-client.ts` as other call
sites that go through the same library and can throw the same error classes — leaving
them out doesn't close the risk, it just closes the one path someone tested.
**Acceptance condition:** the sanitization behavior applies to every code path where an
error from `openid-client`/`oauth4webapi` reaches `request.log.error` or equivalent, via
a single shared function — not duplicated per call site. At minimum: `handleCallback()`,
`refreshToken()`, `getEndSessionUrl()`.

### `error_description`: drop by default; debug-capture is a pending, non-blocking decision (resolved)

Adopting the BA's rewrite. My original framing left this as a question for "whoever
owns log retention/access policy" with no fallback if that person never weighs in —
that's a hole, not a deferral. **Acceptance condition:** by default, `error_description`
and the raw `cause` object from `ResponseBodyError`, `AuthorizationResponseError`, and
`WWWAuthenticateChallengeError` MUST NOT appear in production logs. The OAuth `error`
code (e.g. `invalid_grant`) MUST still be logged — it's a fixed spec-defined enum, not
free text, and per Finding 2 that's the one piece of `error_description`'s neighborhood
that's actually safe by construction across providers.
**Open, non-blocking:** should `error_description` also be captured at a separate,
explicitly non-production or short-retention debug log level? Whoever owns log
retention/access policy should sign off on this before implementation if possible; if
that doesn't happen in time, the default above ("drop entirely") stands and debug-level
capture becomes a follow-up change, not a blocker for this one.

### Allowlist fields (resolved — starting list)

The "explicitly allowlist which fields of `err` get logged" instruction in item 4 above
needed the list actually named, or five engineers would invent five different lists.
Starting allowlist, enforced by the one shared wrapper:
- Always: `name`/`type`, `message`, `code` (if present) — none of these carry
  token/claim content per Finding 1 — plus the existing `correlationId`, `sourceIp`,
  `event` fields already logged alongside `err`.
- `error` (the OAuth error code, e.g. `invalid_grant`): include — fixed enum, safe
  across providers.
- `stack`: include only outside production, or per whatever stack-trace logging policy
  already governs the rest of the app — the proposal should state which policy this
  follows rather than introduce a new one.
- `error_description`, `cause` (structured or raw), and any claim/nonce/JWT-bearing
  field: excluded by default, replaced with an explicit `"[redacted]"` marker (not
  omitted) per the fail-closed/marker decisions above.

This is a starting point for the design stage to finalize with whoever owns log
policy, not a final spec — but it's enough that implementation doesn't start from a
blank page.

### Regression test (resolved — now a required acceptance condition)

Adopting the BA's rewrite, and agreeing with the framing: Finding 2 already established
that the current safety of the `OperationProcessingError` family is incidental, not
structural, and none of it is guarded by a test today. Leaving the test as a "worth it"
suggestion undercuts the whole point of the fix, which is to make the safety structural.
**Acceptance condition:** a regression test MUST assert, against the actual installed
`openid-client`/`oauth4webapi` versions, that logging a representative instance of each
of `OperationProcessingError`, `ResponseBodyError`, `AuthorizationResponseError`, and
`WWWAuthenticateChallengeError` — constructed with a fake nonce/claims/error_description
containing a recognizable marker string (e.g. `"CANARY_TOKEN"`) — produces logged JSON
that does NOT contain that marker string, and DOES contain the allowlisted fields above.
The test must exercise the sanitization function's actual output, not the library's
current incidental behavior, so it fails loudly if a dependency bump changes field shape
or enumerability.

### `WWWAuthenticateChallengeError` and the `^6.8.4` caret range (carried forward, not dropped)

- `WWWAuthenticateChallengeError`: in scope, covered by the same shared wrapper as the
  other two structurally-identical classes, for consistency — no carve-out. It's
  unlikely to fire on the callback path today but shares the exact leak pattern, and
  excluding just this one class by omission is the kind of gap that's easy to miss
  later.
- `package.json` pins `openid-client` at `^6.8.4` — flagged to whoever owns dependency
  policy that a minor/patch bump could change error-shape behavior with no
  change-review trigger on that file. Explicitly out of scope for this change; not
  blocking; recorded here so it doesn't quietly disappear between exploration and
  proposal.

### Multi-provider re-verification (new acceptance condition, from BA review)

The BA review is right that I established provider-agnostic *design* (keying off error
class, not provider-specific string matching) but not provider-verified *behavior* —
the only empirical sample in Finding 2 is an Entra AADSTS string. **Acceptance
condition:** onboarding any new OIDC provider includes re-verifying this sanitization
behavior against that provider's actual error responses (via a fixture or contract
test), not just relying on "the code is written to be provider-agnostic." This should
be either satisfied by this change (e.g. the regression test above using synthetic
errors rather than a real IdP is not sufficient proof for a *second* real provider) or
explicitly carried as a task on whichever future change adds the second provider — but
it needs to be a stated decision, not silence. I'd rather this land as a note in this
change's proposal than wait for the second-provider change to rediscover it.

### Diagnostic value for the operator (resolved, with one pushback)

The Facilitator review is right that every finding so far is framed as "does X leak,"
never "what does the operator staring at this log line at 2am actually need." Accepting
the principle and the two concrete mechanisms above (OAuth `error` code always kept;
`"[redacted]"` markers so the operator knows sanitization ran rather than assuming
logging broke) as the primary way this gets addressed.

**Where I'm pushing back:** the Facilitator review specifically suggests that the
AADSTS-prefixed *number* (not the full description) is what operators actually
pattern-match on for Entra, and floats it as something worth keeping. I don't want that
built into the sanitizer. Parsing or extracting a provider-specific error-code format
out of `error_description` is exactly the kind of Entra-shaped special case this
investigation spent most of its effort arguing against — the moment the wrapper knows
what an AADSTS code looks like, it's no longer provider-agnostic by construction, and a
second IdP with a differently-shaped code embedded in its description either gets no
equivalent treatment or triggers a second special case, and the pattern repeats per
provider. The debug-level capture path (open, non-blocking, above) is the right release
valve for this specific need — a human who needs the AADSTS number for Entra-specific
triage can get it from the debug channel once that's resolved, without the production
sanitizer having to know Entra's error-code grammar. Design stage should still do what
the Facilitator asks — enumerate the diagnostic questions an operator would ask during a
real login-failure incident and check the sanitized shape against that list — I just
don't want the answer to be "teach the sanitizer a provider's string format."

### User-facing error page: explicit verification required (resolved)

Agreeing fully with the Facilitator review's Observation 5. My one sentence about
`error-handler.ts` never echoing raw messages to the user was reassurance, not
verification — asserted in passing rather than exercised the way Findings 1 and 2 were.
**Acceptance condition:** implementation must explicitly verify, by exercising the
actual `/auth/callback` error-redirect path the same way Findings 1/2 exercised the log
path (not by reasoning about the code), that tightening what reaches the log has zero
effect on what reaches the frontend error page. Treat "operator reading the log" and
"user looking at the error page" as two separate success criteria with two separate
verification steps in the proposal, since the log fix and the user-facing categorization
function sit in adjacent code and it would be an easy, unnoticed mistake for someone
"hardening" one to change the other.

### Onboarding note at the wrapper itself (resolved)

Accepting the Facilitator review's Observation 6. The enumerability distinction in
Finding 2 — that Node's native `Error(message, { cause })` sets a non-enumerable `cause`
while a plain `this.cause = x` assignment doesn't — is genuinely non-obvious, and the
regression test above catches drift in the *existing* classes but doesn't tell a future
engineer what to check when oauth4webapi adds a new error class, or a second IdP's
library doesn't go through oauth4webapi at all. **Acceptance condition:** the wrapper's
implementation carries a short comment (or adjacent doc note) stating the invariant it
depends on and a checklist for what to verify before trusting a new error class or
library, so the next engineer extends the scheme instead of rediscovering the leak from
scratch.

### End-to-end validation walkthrough (accepted as an implementation-stage acceptance condition)

Accepting the Facilitator review's closing question. Before this is called done, someone
should deliberately trigger a realistic failure (e.g. an expired/reused authorization
code) against a test IdP and confirm, as a single walkthrough: (a) the log still gives
an operator enough to diagnose the failure category, (b) the user sees a sane error
page, (c) nothing sensitive is present in either. Unit tests on the sanitization
function and the regression test above are necessary but not sufficient — they don't
catch a sanitized shape that's *technically* leak-free but useless for triage, which is
exactly the gap Observation 1 raises.

## Remaining open questions for the design/security-review stage

Everything above is now a decision or an explicitly-scoped deferral. What's genuinely
still open, and legitimately belongs at the design stage rather than being decided here:

- Debug-level capture of `error_description`: whether to build it, which log
  sink/level, and its retention policy — pending sign-off from whoever owns log
  retention/access policy. Non-blocking; "drop entirely" is the default if this isn't
  resolved before implementation starts.
- Final sign-off on the allowlist above from whoever owns log policy — the list here is
  a starting point drawn from the classes identified in this exploration, not a
  guaranteed-final spec.
- Whether the multi-provider re-verification acceptance condition is satisfied within
  this change (would require testing against a second real or simulated provider) or
  deferred to the change that adds the second provider — needs an explicit choice in
  the proposal, not left implicit.
