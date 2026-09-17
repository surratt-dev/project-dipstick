# BA Review: OIDC Error Log Sanitization — Proposal Stage

**Reviewed by:** Marcus Delgado (Business Analyst)
**Date:** 2026-09-17
**Sources reviewed:** `proposal.md`, `design.md`, `tasks.md`, `specs/auth-error-handling/spec.md`
**Prior review:** `explore-review-ba.md` (exploration stage)

## Overall assessment

This is a well-built proposal. All four items I flagged as blocking at the exploration
stage — scope boundary across call sites, a decision (not a silent question) on
`error_description`, a named allowlist, and a committed regression test — are now
explicit acceptance conditions in the delta spec, with task-level traceability in
`tasks.md`. The multi-provider constraint is threaded through consistently: it's in the
diagnosis (Why), the mechanism description (What Changes), the delta spec's requirement
text ("remains correct for identity providers added after the application's initial
provider"), design D7, and a named follow-up task (6.2) rather than an implicit
assumption. I have no notes on that axis — this is the discipline I asked for at
exploration and it's here.

Two gaps remain before this is fully implementable without the team coming back to ask
"did you mean to include this." Both are capability/scope-naming problems, not design
problems — the design decisions themselves are sound, they're just not fully reflected
back up into the proposal and spec that are supposed to be the source of truth.

## Blocking-before-implementation items

### 1. `MissingClaimError` is designed and tasked, but not in scope per the requirement's own text

`design.md` D3 (case 3) and `tasks.md` (1.4, 3.7) both build explicit sanitization
handling for `MissingClaimError` — this application's own error class
(`packages/backend/src/auth/errors.ts`), not a class `openid-client`/`oauth4webapi`
throws. I confirmed it's a legitimate inclusion: `MissingClaimError` is thrown during ID
token validation inside `handleCallback()` and caught by the *same* `/auth/callback`
catch block (`routes/auth.ts:334`) that logs `ResponseBodyError` etc. via
`request.log.error({ err, ... })` today — so it genuinely reaches the same logging
boundary this change is closing.

The problem is that neither `proposal.md`'s "What Changes" list nor the delta spec's
ADDED requirement text say so. The requirement opens with: *"The application SHALL
sanitize any error thrown by the OIDC client library (`openid-client`/`oauth4webapi`)"*
— `MissingClaimError` is explicitly *not* that; it's application code. As written, an
implementer reading `proposal.md` and `specs/auth-error-handling/spec.md` alone (the
documents of record) would have no reason to build case 3 at all, and no scenario
exercises it — the closest scenario ("Token/claim validation failure is sanitized
structurally") names only `OperationProcessingError`/`ClientError`. Only a reader who
also opens `design.md` would know it's intended.

**Why this matters beyond pedantry:** if the requirement's stated scope is "errors from
the OIDC client library" and `MissingClaimError` is included anyway, that's either (a) a
scope expansion that should be stated and justified, or (b) evidence the requirement
text is drawn one class too narrowly and should instead be scoped to "errors reaching
this catch block" or similar. Either is fine — but it should be a decision on the page,
not something that only shows up in `design.md` and `tasks.md`.

**Suggested fix:** Add a fifth scenario to the delta spec:

> #### Scenario: Application-level claim validation error is sanitized consistently
> - **WHEN** the application's own `MissingClaimError` is thrown during ID token claim
>   validation and reaches the same logging call site as OIDC client library errors
> - **THEN** it is passed through the same sanitization function, allowlisting `type`,
>   `message`, `stack`, and `claim` (claim name only), consistent with its existing
>   claim-name-only discipline in `error-handler.ts`

And broaden the requirement's opening sentence (or add one clause) to cover it: e.g.
"...sanitize any error thrown by the OIDC client library, or by this application's own
auth error classes reaching the same log call site (e.g. `MissingClaimError`)..." Also
add it to `proposal.md`'s "What Changes" bullet that currently only names `error_description`
handling for the three library classes.

### 2. `getEndSessionUrl()`'s new fallback behavior has no acceptance scenario

`design.md` D4 is explicit and honest that this is a real behavior change, not pure
logging: today an uncaught error here reaches Fastify's default handler (a 500); after
this change, it degrades to `reply.send({ redirectUrl: "/" })`, meaning IdP-side
logout silently doesn't complete. `proposal.md`'s Impact section mentions the `try/catch`
is added but doesn't state the resulting behavior change, and — more importantly — the
delta spec has no scenario for it at all. The closest scenario ("Sanitization applies
uniformly...") only asserts that logging is consistent across call sites; it says
nothing about what the user or caller observes when `getEndSessionUrl()` throws.

This is exactly the kind of externally-observable change I want captured as a testable
condition, not left to a design-doc paragraph and task 5.1's one-time manual walkthrough.
Per `requirements/use cases/01 - Identity and Access - Use Cases.md` (line 415), "at
minimum, the application's own session must be invalidated" on logout — this design
satisfies that (local session is already destroyed earlier in the handler), so there's
no conflict with the use case. But the spec should say so explicitly rather than rely on
me having traced it back myself.

**Suggested fix:** Add a scenario:

> #### Scenario: IdP end-session URL construction failure degrades gracefully
> - **WHEN** `getEndSessionUrl()` throws during `/auth/logout` after the local session has
>   already been destroyed
> - **THEN** the error is sanitized and logged via the shared wrapper, and the response
>   falls back to `{ redirectUrl: "/" }` rather than propagating an uncaught error;
>   IdP-side (single) logout is not completed in this case, consistent with the
>   requirement that only the application's own session invalidation is guaranteed

## Non-blocking notes

- **`ClientError` isn't named in `proposal.md`'s "What Changes."** Unlike
  `MissingClaimError`, this one *is* squarely inside the stated scope — `ClientError` is
  an `openid-client`-exported class (confirmed in `exploration-notes.md:82`) — so there's
  no scope ambiguity, just an incomplete list. Add it alongside
  `OperationProcessingError` wherever the proposal enumerates classes, so a reader of
  `proposal.md` alone gets the complete picture without cross-referencing `design.md`.
- **"OAuth error code" phrasing risk.** The delta spec's requirement text says "the OAuth
  `error` code (e.g. `invalid_grant`) SHALL be preserved," but design D3 case 1 also
  allowlists a *separate* field called `code` (oauth4webapi's internal error-kind
  constant, e.g. `RESPONSE_BODY_ERROR`) for a different reason (it's an enum, not free
  text). Two different allowlisted fields both plausibly answer to "the error code" in
  conversation. Not a defect — design.md disambiguates it correctly in a parenthetical —
  but I'd like the delta spec's scenario text to name both fields explicitly
  (`error` and `code`) rather than only `error`, so an implementer working from the spec
  alone doesn't have to guess whether `code` is meant to be included or redacted.
- **Fail-closed requirement wording is slightly looser than the design that satisfies
  it.** The requirement text says an unrecognized class "SHALL be redacted at least as
  aggressive as the most conservative recognized case" — "most conservative recognized
  case" isn't itself pinned to a concrete field list anywhere in the spec (it's only
  concrete in `design.md` D3 case 4: `message` and `stack` both redacted, which is in
  fact more aggressive than any recognized case, not just tied with it). The paired
  scenario ("Unrecognized error class fails closed") is more concrete ("redacts the
  message and all provider- or library-supplied fields") and is good enough to build
  from — I'm flagging the requirement summary sentence only because it's the kind of
  language that reads fine until two engineers interpret "most conservative" differently
  in a future edit. Not blocking.

## What's already implementation-ready as-is

- The three-call-site scope (`handleCallback`, `refreshToken`, `getEndSessionUrl`), the
  named allowlist per class, the `"[redacted]"` marker discipline, the fail-closed
  default with a distinct `unrecognized_class` log signal, and the regression-test
  obligation (design D6, tasks 3.1–3.7) — all four of my exploration-stage blockers are
  now explicit, concrete, and traceable to a task.
- The provider-agnostic dispatch-by-class requirement, and the explicit rejection of
  provider-string matching (no `AADSTS` parsing) — stated as a hard SHALL in the delta
  spec, not just a design preference.
- The multi-provider re-verification gap (D7) is handled correctly: named as a decision
  that's deliberately deferred, with an owner (whichever change onboards provider #2) and
  a task (6.2) carrying it forward — not silently assumed covered.
- The user-facing error page non-regression scenario and its corresponding task (4.1),
  which verifies against the real redirect path rather than by code inspection.
- The named, explicit deferrals in section 6 of `tasks.md` (debug-level capture,
  dependency caret range) — this is exactly the "record why something didn't make scope"
  traceability I care about, and it's done consistently here.
