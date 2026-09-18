# Exploration Notes — Issue #7: MissingClaimError precision on null claims

**Explored by:** Devon Calloway (Internal Champion / Principal Engineer), acting as SME consult, not implementer.
**Date:** 2026-09-17
**Trigger:** Team lead asked me to explore this use case via `opsx:explore` ahead of a proposal.

---

## What this actually is

`packages/backend/src/routes/auth.ts`, in the `/auth/callback` handler, does this today:

```ts
const claims = tokens.claims();
if (!claims) {
  throw new MissingClaimError("sub");   // <- imprecise
}
if (!claims.sub) {
  throw new MissingClaimError("sub");
}
if (!claims.iss) {
  throw new MissingClaimError("iss");
}
```

When `tokens.claims()` returns `null`, the entire ID token claims object never existed — there was nothing to inspect for a `sub` at all. Naming it `MissingClaimError("sub")` tells whoever reads the resulting `auth.failure` audit event (`missingClaim: "sub"`) a specific, wrong story: "a token came back but was missing its subject." The true story is "no ID token claims came back at all." The fix is one line: throw `MissingClaimError("id_token")` in the null branch instead. `MissingClaimError` already accepts an arbitrary string for `claim`, `mapAuthError` treats all instances of the class identically (generic user-facing message, no branching on the claim name), and no other part of the system pattern-matches on the specific string value — I checked (see "What I verified" below). This is exactly what it's billed as: a diagnostic clarity fix with zero behavioral, security, or correctness surface.

I want to be honest about my own role here before going further: this is not a ritual-mechanics change. Nothing about the no-manager rule, facilitator-from-another-team, simultaneous reveal, or individual-performance-surfacing lives anywhere near this code path. My four load-bearing constraints are untouched. So most of this note is me doing due diligence on a small thing, not raising alarms about a big one — and per my own stated concern about not wanting to be the escalation path for every edge case, I want to model here what "the docs should be enough, but let's make sure they actually are" looks like, rather than rubber-stamping.

**No facilitator/participant-facing surface.** This callback is the same OIDC login path facilitators and participants use to sign into the Health Check app itself, but this change touches only the diagnostic label attached to a specific failure mode after the fact. `mapAuthError` — the only place claim identity could reach a human — is untouched and confirmed unchanged (see "What I verified" below), so a facilitator or participant hitting this failure sees the same generic sign-in error before and after this change. Stating that here as a one-line note, per the facilitator's review of this exploration, so it doesn't need re-deriving from the `mapAuthError` verification later.

---

## Why I still care, even though it's outside my four constraints

The four things I protect are about the ritual staying honest as a *conversation*. But there's an adjacent thing I care about that isn't on that list explicitly: whether the tool's records can be trusted once the ritual is over. Session history, topic definitions, trend data — the whole pitch I made to the VP was that this stuff survives me because it's *recorded accurately*. An operator reading `auth.failure` audit events is a much smaller stage than a facilitator reading a trend dashboard, but it's the same species of claim: the tool's own account of what happened should match what happened. A misleading `missingClaim` value is a paper cut, not a wound, but it's the same kind of paper cut that, left unaddressed enough times, teaches people not to trust the tool's diagnostics — and that erodes the "the tool is honest infrastructure" property I actually do care about structurally. That's the frame I'm using to evaluate this, not "is this a security bug" (it isn't, and everyone before me already confirmed that three times over — see history below).

---

## What I verified myself (not just taking the brief's word for it)

1. **`MissingClaimError` (`packages/backend/src/auth/errors.ts`)** — `claim: string`, no validation, no enum. `"id_token"` is exactly as valid as `"sub"` or `"iss"`. Confirmed.
2. **`mapAuthError` (`packages/backend/src/auth/error-handler.ts`)** — branches on `err instanceof MissingClaimError`, full stop. Never inspects `err.claim`. The user-facing message and category are identical regardless of which claim name is carried. Confirmed — no changes needed there, as the brief says.
3. **The catch block in `auth.ts`** — `auditFields.missingClaim = err.claim` is the only place the claim name reaches the audit trail. No other transformation, no allowlist.
4. **No downstream consumer keys on the specific string.** I grepped the whole repo (outside `node_modules`/`dist`) for `missingClaim` — the only live references are the `auth.ts` emit site, the three `auth.test.ts` assertions, and prose in `openspec/specs/first-access/spec.md` and various archived change docs. No dashboard, alert rule, or runbook exists yet that pattern-matches on `"sub"` vs `"id_token"`. So there's no hidden consumer this would silently break. If such a consumer existed, this would need a comms step; it doesn't, so it doesn't.
5. **This has already been triaged twice before and correctly deferred, not dropped.** The precision note originates in `openspec/changes/archive/2026-07-05-first-access/implementation-review-architect.md` (the "MissingClaimError usage" section). It was then explicitly scoped *out* of a later change, `auth-audit-correlation-fields` (see that change's `proposal.md`, `design-review-security.md`, `explore-review-ba.md`, `tasks.md`) — correctly, since that change was about adding `sourceIp`/`correlationId` fields (issue #4), not claim-name precision. That review chain is worth reading if anyone re-litigates whether this is "real": the security reviewer on that change explicitly called it "an operational-clarity issue, not a security one" and correct to scope out at the time. Nobody dropped this on the floor — it was deliberately queued. This exploration is that queue coming due. Good — this is what disciplined scope management is supposed to look like, and I want to name that it worked.

---

## The one thing the brief didn't mention: spec drift

This is the actual finding of this exploration, and it's the reason I'm not just saying "trivial, go implement."

`openspec/specs/first-access/spec.md`, under "Requirement: Missing claims rejection," currently has this scenario:

> **Scenario: Missing sub claim**
> **WHEN** the ID token claims object is null, or `claims.sub` is absent or is an empty string
> **THEN** a `MissingClaimError("sub")` is thrown; ... the `auth.failure` audit event includes `missingClaim: "sub"` ...

This scenario text bakes in the *current, imprecise* behavior as spec. If the code changes to throw `MissingClaimError("id_token")` on null claims and the test changes to match, but this scenario text is left alone, the spec becomes wrong the moment the fix ships — not eventually, immediately. That's a spec/implementation divergence introduced by the very change meant to fix a divergence between behavior and operator understanding. I'd find that a little embarrassing if it shipped that way, and it's an easy miss because the brief (correctly, for the code) named `auth.ts`, `errors.ts`, `error-handler.ts`, and `auth.test.ts` — but `spec.md` isn't code, so it's easy for a change scoped as "just a diagnostic fix" to walk past it.

**What I'd want to see in the proposal:** split the existing "Missing sub claim" scenario into two. Here's the exact current text from `openspec/specs/first-access/spec.md` (lines 94–96), for reference, since I don't want the proposal author reconstructing this from memory:

> #### Scenario: Missing sub claim
> - **WHEN** the ID token claims object is null, or `claims.sub` is absent or is an empty string
> - **THEN** a `MissingClaimError("sub")` is thrown; authentication is rejected; no account is created; no session is established; the user is redirected to the error page with a generic message; the `auth.failure` audit event includes `missingClaim: "sub"` and no claim values

That splits into:
- **Scenario: Null claims object** — `claims()` returns `null` → `MissingClaimError("id_token")` is thrown; authentication is rejected; no account is created; no session is established; the user is redirected to the error page with a generic message; the `auth.failure` audit event includes `missingClaim: "id_token"` and no claim values.
- **Scenario: Missing or empty sub claim** — claims object exists but `sub` is absent/empty → `MissingClaimError("sub")` is thrown; same rejection behavior; the `auth.failure` audit event includes `missingClaim: "sub"` and no claim values.

I checked whether this split silently drops anything: the *original* scenario text names exactly one audit field (`missingClaim`) plus the blanket assurance "and no claim values" — it does not enumerate `sourceIp`, `correlationId`, or `failureCategory`, even though I confirmed in `auth.ts` (lines 347–351) that the real `auth.failure` event carries all of those alongside `missingClaim`. So the original scenario was already abstracting over the full field list, and the two-way split preserves that same level of abstraction — it's not dropping detail the original had, because the original never itemized `sourceIp`/`correlationId` in prose (those are governed by `auth-audit-correlation-fields`, not by this requirement). Both new scenarios keep the "and no claim values" phrasing so the PII-safety guarantee stays visible in both.

This isn't scope creep — it's the same fix, just also applied to the one artifact in the repo that currently asserts the wrong behavior in prose. Leaving spec.md stale would be worse than not fixing the code at all, because then the spec actively lies about what the audit trail says, rather than just being imprecise about a claim name.

**The `iss` scenario is untouched, and here's why that's provably correct, not just likely.** In `auth.ts` (lines 193–201):

```ts
const claims = tokens.claims();
if (!claims) {
  throw new MissingClaimError("sub");   // becomes "id_token"
}
if (!claims.sub) {
  throw new MissingClaimError("sub");
}
if (!claims.iss) {
  throw new MissingClaimError("iss");
}
```

The null-claims branch `throw`s immediately, so control never falls through to the `iss` check when `claims` is null — a null claims object can never today, or after this fix, produce `missingClaim: "iss"`. The existing "Missing iss claim" scenario (spec.md lines 98–100) is therefore unaffected by this change and needs no edit. Stating this here so nobody "fixes" a non-problem by adding a redundant null-claims/iss scenario.

I'd also flag: `spec.md`'s "Known Limitations / Open Issues" section currently lists `#7` under **Open Issues** (line 212) as:

> - **#7** — [Clarity] MissingClaimError("sub") is misleading when the entire claims object is null

That entry should move to **Resolved** (section starts line 216), matching the exact pattern already used there for `#2` and `#3`:

> - **#2** — closed (oidc-error-log-sanitization) — [Security] Audit OIDC library error messages for potential token content leakage in logs
> - **#3** — closed (audit-logger-transport-filtering) — [Security] Audit logger level fix does not cover transport-level log filtering

So the new line reads: `- **#7** — closed (fix-missing-claim-error-precision) — [Clarity] MissingClaimError("sub") is misleading when the entire claims object is null`

---

## Test change, precisely

The test file is `packages/backend/src/routes/__tests__/auth.test.ts` (not `auth.test.ts` at the routes root — noting the exact path since it's easy to mistype). It already has a dedicated test, `it("rejects authentication when claims() returns null", ...)` (line 665), whose assertion at line 688 currently reads `expect(auditFields.missingClaim).toBeDefined()` — deliberately loose, presumably because whoever wrote it anticipated this value might change. Referencing the test by its description string rather than a line number, since line numbers drift and the string won't. That one assertion tightens to `expect(auditFields.missingClaim).toBe("id_token")`. The two sibling tests (`sub` empty string → `"sub"` at line 624, `iss` empty string → `"iss"` at line 661) are unaffected — I want to be explicit that this is a one-assertion change, not a rewrite of that describe block, so nobody scope-creeps the test file while they're in there.

---

## What could go wrong if this drifts

Being honest, the blast radius here if someone gets sloppy is small, but the failure modes I'd watch for in review:

- **Someone "fixes" it by making `mapAuthError` or the frontend branch on `err.claim === "id_token"` to show a different user message.** Don't. The brief is explicit that `mapAuthError` needs no changes, and I verified why: the user-facing message is deliberately generic across all `MissingClaimError` cases so as not to leak which specific validation failed (that's a mild information-exposure discipline already baked into `error-handler.ts` — no need to reopen it for a clarity-only fix on the *operator-facing* side).
- **Spec.md gets left behind** — covered above, this is the actual risk worth naming.
- **Someone treats this as license to also touch the two archived-and-closed adjacent items** (`missingClaim` field additions for other events — issue #4, already closed; `session.destroy()` test coverage — issue #6, already closed per recent commits) just because they're nearby in the same file. They're closed, they're unrelated, don't reopen them under this change's diff. Keep this to the null-claims branch, the one test assertion, and the spec.md scenario split.

---

## Recommendation

Proceed to proposal. Scope: `packages/backend/src/routes/auth.ts` (one branch), `packages/backend/src/routes/__tests__/auth.test.ts` (one assertion), `openspec/specs/first-access/spec.md` (split one scenario into two + move #7 from Open Issues to Resolved).

**Design: not required.** No architectural surface, no new abstractions, no cross-cutting decision — confirmed by the code walkthrough above. This is a proposal, a spec delta, and a task list, then implementation.

I don't need to be consulted again on this one; the acceptance criteria below, plus the exact quotes and line references above, should be sufficient for the team to close it without looping me back in.

### Acceptance criteria

1. **Given** `tokens.claims()` returns `null` in `/auth/callback`, **when** the callback handler processes the response, **then** a `MissingClaimError("id_token")` is thrown (not `MissingClaimError("sub")`).
2. **Given** the same null-claims condition, **when** the resulting `auth.failure` audit event is recorded, **then** `auditFields.missingClaim` equals `"id_token"`.
3. **Given** a non-null claims object with an absent or empty-string `sub`, **when** the callback handler processes the response, **then** behavior is unchanged: `MissingClaimError("sub")` is thrown and `auditFields.missingClaim` equals `"sub"`.
4. **Given** a non-null claims object with an absent or empty-string `iss`, **when** the callback handler processes the response, **then** behavior is unchanged: `MissingClaimError("iss")` is thrown and `auditFields.missingClaim` equals `"iss"` — unaffected because the null-claims branch short-circuits before this check is ever reached (see the `iss`-scenario note above).
5. `mapAuthError` (`packages/backend/src/auth/error-handler.ts`) and the user-facing redirect message are unchanged — no branching on `err.claim` is introduced anywhere in this change.
6. `packages/backend/src/routes/__tests__/auth.test.ts`'s test `it("rejects authentication when claims() returns null", ...)` is updated so its assertion reads `expect(auditFields.missingClaim).toBe("id_token")`. No other test in that describe block changes.
7. `openspec/specs/first-access/spec.md`'s "Missing sub claim" scenario is replaced by two scenarios ("Null claims object" and "Missing or empty sub claim"), using the exact text drafted above, which preserves the original's "and no claim values" phrasing without itemizing `sourceIp`/`correlationId` (neither did the original).
8. `spec.md`'s Known Limitations / Open Issues section moves `#7` from Open to Resolved, using the exact format confirmed against `#2`/`#3` above: `- **#7** — closed (fix-missing-claim-error-precision) — [Clarity] MissingClaimError("sub") is misleading when the entire claims object is null`.
9. No changes to `error-handler.ts` behavior, and no reopening of issue `#4` or `#6` scope (both already closed, per recent commits, and unrelated to this diff).
