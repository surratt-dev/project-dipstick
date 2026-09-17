# BA Review: OIDC Error Log Sanitization — Exploration Notes

**Reviewed by:** Marcus Delgado (Business Analyst)
**Date:** 2026-09-17
**Source reviewed:** `openspec/changes/oidc-error-log-sanitization/exploration-notes.md`

## Overall assessment

This is unusually strong exploration work — Devon didn't reason from the library's
public docs, pulled the installed code and verified behavior against a real pino
instance. That's the kind of evidence I want a requirement to trace back to. Finding 1
and Finding 2's *diagnosis* are specific enough to build from directly: exact classes,
exact fields, exact code paths, reproduced empirically. I have no notes on those.

Where this isn't yet requirements-ready is the "what to build" section (the numbered
list item 4 and the "Open questions" section at the end). Several of the load-bearing
decisions are presented as options rather than resolved, and if I write a proposal
against options, the implementation team will be right back in my inbox asking "which
one did you mean." Four things need to be pinned down before this becomes a proposal.
I've suggested concrete rewrites for each below.

## Multi-provider check

This passes, and I want to say explicitly why, since it's the constraint I was asked
to weight most heavily: the notes key the fix off **error class** (`ResponseBodyError`,
`AuthorizationResponseError`, `OperationProcessingError`/`ClientError`), which is
spec-defined behavior from oauth4webapi, not provider-defined behavior. That's the
right axis — it doesn't degrade when a second IdP is added, because the classes don't
change, only which provider happens to trigger them. The notes also correctly reject
`AADSTS`-prefix string matching as a viable design and point to `error-handler.ts`'s
"categorize, don't relay" pattern as the precedent to follow. Good.

One gap I'd add to the requirement, not because the notes got it wrong but because
they stopped one step short: **the requirement should state that onboarding any new
OIDC provider includes re-verifying this sanitization behavior against that provider's
actual error responses** (via a fixture or contract test), not just "the code is
written to be provider-agnostic." Provider-agnostic *design* and provider-verified
*behavior* are different claims, and the exploration only established the first one
(the sample `error_description` in Finding 2 is an Entra AADSTS string — the design
being generic doesn't mean it's been proven generic). This should be an explicit
acceptance condition on this change, or an explicit note that it's deferred to
whichever future change adds the second provider — either is fine, but it needs to be
a decision, not silence.

## Clarifications needed before this becomes a proposal

### 1. Scope boundary: `handleCallback()` only, or all OIDC-library call sites?

**Vague as written:** "Open questions" frames this as a choice for "the design stage"
to settle, but this is a scope decision, and scope decisions belong in the proposal,
not left open for whoever picks up the design doc. As written, two engineers could read
this and reasonably build different things — one patches the catch block at
`routes/auth.ts:331`, another builds a shared wrapper used everywhere `openid-client`
is called. That's exactly the kind of ambiguity that turns into a scope dispute during
implementation review, and I'd rather resolve it now than referee it later.

The notes themselves supply the argument for the broader scope — Devon already names
`refreshToken()` and `getEndSessionUrl()` as other call sites that can throw the same
error classes. If the risk is "any `err` from this library reaching a logger," a fix
scoped to one catch block doesn't close the risk the issue was opened for; it just
closes the one call site someone happened to look at.

**Suggested rewrite (acceptance condition):**
> The sanitization behavior MUST apply to every code path where an error thrown by
> `openid-client`/`oauth4webapi` reaches `request.log.error` or equivalent, not only
> `handleCallback()`. At minimum this includes `handleCallback()`, `refreshToken()`,
> and `getEndSessionUrl()` in `packages/backend/src/auth/oidc-client.ts`. Implementation
> MUST be a single shared function/wrapper, not duplicated per call site — duplication
> is how the next call site gets missed.

If there's a reason to scope this narrower for the first release (e.g. the other call
sites are lower-risk or out of scope for other reasons), that's a legitimate call — but
it should be stated as a decision with a reason, not left as an open question.

### 2. `error_description`: dropped, or captured at a debug level?

**Vague as written:** Devon states a personal instinct ("drop it... but this is a call
for whoever owns log retention/access policy") and correctly declines to decide it
unilaterally. I agree that's not Devon's call — but it can't be nobody's call either.
As written, the proposal has no acceptance criterion here at all, just a flagged
question. I'd rather the proposal name a default and let whoever owns log policy veto
it than ship a design doc with a hole in it.

**Suggested rewrite (acceptance condition):**
> By default, `error_description` and the raw `cause` object from `ResponseBodyError`,
> `AuthorizationResponseError`, and `WWWAuthenticateChallengeError` MUST NOT appear in
> production logs. The OAuth `error` code (e.g. `invalid_grant`) MUST still be logged,
> since it is a fixed spec-defined enum, not free text.
>
> [OPEN — needs decision from log retention/access policy owner before implementation
> starts]: should `error_description` instead be captured at a separate, explicitly
> non-production or short-retention debug log level? If yes, name that log level/sink
> and its retention policy here. If this isn't resolved before implementation, default
> to "drop entirely" and treat debug-level capture as a follow-up, not a blocker.

This gives the implementation team a concrete instruction either way, instead of a
stalled question.

### 3. "Allowlist which fields of `err` get logged" — allowlist isn't named

**Vague as written:** Point 4 of the "required action" list says the fix should
"explicitly allowlist which fields of `err` get logged, rather than trusting pino's
default." That's the right mechanism, but it doesn't say what's on the list. This is
the same pattern I flag on outlier-detection thresholds elsewhere in this project —
"configurable, not a magic number buried in code" only works if someone writes down
the starting value. Right now an engineer implementing this has to invent the
allowlist themselves, which means five different engineers could invent five different
lists.

**Suggested rewrite (acceptance condition):**
> The logged representation of any error from the OIDC library MUST be constructed
> from an explicit allowlist, not the default serializer. Starting allowlist, per the
> classes identified in exploration:
> - Always: `name`/`type`, `message`, `code` (if present), `correlationId`,
>   `sourceIp`, `event` (existing fields already logged alongside `err`)
> - `stack`: include only outside production, or per existing stack-trace logging
>   policy elsewhere in the app (state which policy this follows)
> - `error` (OAuth error code): include, per item 2 above
> - `error_description`, `cause`, and any claim/nonce/JWT-bearing field: excluded by
>   default, per item 2 above
>
> This allowlist MUST be enforced by a single function (see item 1 — one shared
> wrapper), not re-implemented per call site.

### 4. Regression test — named as "worth it," not committed as a requirement

**Vague as written:** "Worth a regression test that fails loudly if a future
openid-client/oauth4webapi bump changes an error class's field enumerability" is
listed under "open questions," phrased as a suggestion. Given that Finding 2's own
analysis says the *current* safety of the `OperationProcessingError` family is
"incidental... none of those three are guarded by a test" — this isn't a nice-to-have,
it's the thing that turns an incidental safety property into a structural one, which
is exactly what item 4 in the findings says the fix needs to do. Leaving it as a
question undercuts the fix.

**Suggested rewrite (acceptance condition):**
> A regression test MUST assert, against the actual installed `openid-client`/
> `oauth4webapi` versions, that logging a representative instance of each of
> `OperationProcessingError`, `ResponseBodyError`, `AuthorizationResponseError`, and
> `WWWAuthenticateChallengeError` (constructed with a fake nonce/claims/
> error_description containing a recognizable marker string, e.g. `"CANARY_TOKEN"`)
> produces logged JSON that does NOT contain that marker string, and DOES contain the
> fields required by item 3's allowlist. This test MUST fail (not silently pass) if a
> dependency bump changes field shape or enumerability — i.e. it tests the actual
> sanitization function's output, not the library's current incidental behavior.

## Smaller items — not blocking, but should be carried into the proposal explicitly rather than dropped

- **`WWWAuthenticateChallengeError`** is described as "far less likely to fire on this
  code path" but not "impossible," and the notes don't state whether it's in scope.
  Given item 1 above (shared wrapper covering all call sites), I'd default to including
  it for consistency rather than carving out an exception for one of the three classes
  that share the same leak pattern — but the proposal should say so explicitly rather
  than let it fall out of the allowlist by omission.
- **`package.json` caret range (`^6.8.4`)** — Devon correctly flags this as a
  dependency-policy concern, not a blocker for this change. Agreed it shouldn't block,
  but I'd like the proposal to say explicitly "out of scope for this change, flagged to
  [dependency policy owner]" rather than let it quietly disappear between exploration
  and proposal. Traceability cuts both ways — I want a record of why something *didn't*
  make it into scope, not just what did.

## What's already proposal-ready as-is

- Findings 1 and 2's diagnosis (exact classes, exact fields, exact code paths,
  empirically verified) — no changes needed, this is exactly the level of evidence I
  want a requirement to cite.
- The "categorize, don't relay" framing borrowed from `error-handler.ts`, and the
  rejection of string-matching on `AADSTS`-style prefixes — this is the right
  provider-agnostic design principle and should be stated as a hard requirement in the
  proposal, not just a design preference: *"Sanitization logic MUST key off error
  class/type, and MUST NOT pattern-match against provider-specific message content or
  prefixes (e.g. AADSTS)."*
