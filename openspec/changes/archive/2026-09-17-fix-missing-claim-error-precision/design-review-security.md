# Security Review: fix-missing-claim-error-precision

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Artifacts reviewed:** `proposal.md`, `design.md`, `tasks.md` (referenced), current state of `packages/backend/src/routes/auth.ts`, `packages/backend/src/auth/errors.ts`, `packages/backend/src/auth/error-handler.ts`, `openspec/specs/first-access/spec.md`
**Verdict: Approved. No security concerns.**

## Scope confirmed

I verified the design's factual claims against the code rather than taking them on faith:

- `auth.ts:194-196` does throw `MissingClaimError("sub")` in the null-claims branch today — this is the mislabeling described. The `sub`-empty (`:197-198`) and `iss`-empty (`:200-201`) branches are separate `if` blocks, unchanged by this proposal.
- `error-handler.ts`'s `mapAuthError` branches only on `err instanceof MissingClaimError`; it does not read `err.claim`. The generic message ("the identity provider did not return a valid identity token") is identical regardless of which claim name is attached. Confirmed no diff is needed or proposed here.
- `MissingClaimError` (`errors.ts`) takes an unvalidated `claim: string` and is documented as carrying "the claim name — never the claim value." This has not changed and is not proposed to change.
- A null claims object short-circuits before the `iss` check is reached, so `missingClaim: "iss"` from a null-claims failure is structurally unreachable, not just unlikely. The design's claim that no `iss` variant decision is needed holds.

## Assessment against my usual review criteria

**Authentication flow:** Unaffected. This changes a string literal attached to an already-thrown error, on an already-rejected authentication attempt. The `if (!claims)` rejection still fires before `resolveOrCreateAccount`, before any session or account write — same as today. No new code path, no change to when authentication is accepted or rejected.

**Information exposure:** This is the one place I looked hardest, since audit-label precision is exactly the kind of "cosmetic" change that quietly grows a side channel. It does not, here. `"id_token"` is no more revealing than `"sub"` — both are claim/token-shape labels, not claim values, and both were already visible to the same audience (whoever reads `auth.failure` audit events, not the end user). The user-facing redirect message stays the generic string in `error-handler.ts`, untouched. No new information reaches the unauthenticated caller as a result of this change.

**Audit logging integrity:** This is a net positive for the property I care about most in an audit trail — that it says what actually happened. Today, a caller presenting a token with `claims() === null` produces an `auth.failure` event claiming `missingClaim: "sub"`, which is simply false: no claims object existed to inspect for a `sub` field. An operator triaging a wave of these events would be looking for "why is `sub` missing" when the real question is "why is the ID token producing no claims at all" (malformed token, provider misconfiguration, library version mismatch) — a different investigation. Correcting the label to `"id_token"` makes the audit event an accurate record of the failure mode, which is the whole job of an audit event. I have no objection to the label choice itself.

**Authorization:** Not implicated. No endpoint, no data access boundary, no role mapping is touched.

**Multi-provider IdP impact:** Per project context, Entra is the primary but not the only supported OIDC provider. I checked whether this fix is Entra-specific or provider-coupled: it is not. `tokens.claims()` returning `null` is a property of the `openid-client`-style token set, not of any specific IdP's claims shape, and the fix doesn't touch provider configuration, discovery, or token validation logic at all — only the label on an already-existing rejection. No provider-specific regression risk.

## Deferred or implicit security decisions

I looked specifically for this, per the review request. I found none to flag:

- The design explicitly declines to make this a `mapAuthError`/user-facing change, and states the reason: keeping the generic sign-in message is "a deliberate information-exposure discipline (it doesn't leak which specific validation failed)." That's the correct call, and I'd have flagged it as a finding if the proposal had gone the other way and started differentiating user-facing messages by claim name. It didn't, and `tasks.md` (1.2, 4.3) puts a verification step on that boundary staying closed. Good.
- Nothing here is deferred to a future change. The proposal and design both note this was queued (issue #7) rather than dropped from an earlier change (`auth-audit-correlation-fields`), and this change closes it out rather than re-deferring it.
- No new dependency, no new claim being trusted, no change to signature/expiry/audience/issuer validation — those all remain exactly as implemented before this change, out of scope, and correctly not touched.

## One observation, not a blocking finding

The proposal's audit-consumer grep (`missingClaim` outside `node_modules`/`dist`) found no dashboard, alert, or runbook keyed on the literal string `"sub"` vs `"id_token"`. I have no reason to doubt that grep, but I'll note for the record: a grep only catches consumers that live in this repository. If there's an external SIEM rule or alert query keyed on `missingClaim: "sub"` as a signal (e.g., "phantom-account risk" alerting), it would silently stop firing for the null-claims case after this ships, with no error — just quieter than before. This is a process note for whoever owns audit log consumption outside this repo, not something I'm asking this change to solve; a one-branch diagnostic fix is not the place to go build an audit-schema-consumer registry. Worth a one-line mention in the PR description so it's visible to anyone who does own external alerting on this field.

## Summary

This is exactly what the proposal and design claim it is: a one-branch, one-string-literal diagnostic correction with no authentication, authorization, or data-exposure surface. I reviewed it as carefully as I would a larger change specifically because "just a log label" is the kind of framing I've seen used to wave through changes that deserved more scrutiny — this one earns the pass on its own merits. No changes requested.
