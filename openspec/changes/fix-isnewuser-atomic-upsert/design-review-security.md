# Security Review: fix-isnewuser-atomic-upsert (Design)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** `openspec/changes/fix-isnewuser-atomic-upsert/design.md` and `proposal.md`, verified against `packages/backend/src/auth/account-resolver.ts` and `packages/backend/src/routes/auth.ts` as shipped on this branch.
**Verdict:** No objection. Approve with one clarification requested on the proposal's "no observable behavior change" claim (Finding 1) and one note for the record (Finding 2). Neither blocks this change.

---

## Summary

This is a narrow, well-scoped concurrency fix to how a boolean is derived, not a change to authentication, authorization, or data access logic. I read both target files in full. The design's technical claims about `xmax`, the absence of a PgBouncer-style pooler in front of `db.ts`, and the zero-diff requirement on `auth.ts` all check out against the actual code. My focus, per my usual concerns on this codebase's OIDC integration and audit logging, follows below.

## Findings

### Finding 1 (Informational — request wording fix, not a blocking issue): The "no observable behavior change" claim is not quite accurate for the race scenario itself

The proposal states: *"No scenario's observable behavior changes — the fix is internal to how `isNewUser` is computed, not what it means or who consumes it."* That's true for every scenario except the one this change exists to fix.

Today, two concurrent callbacks racing for the same brand-new identity both read zero rows and **both** get `isNewUser = true`. Downstream, that means both callbacks currently emit `auth.first_access_created` and both set `isFirstAccess: true` on their respective `auth.success` events. After this change, exactly one of the two racing callbacks will have performed the `INSERT` (`xmax = 0`) and the other will have performed the `DO UPDATE` (`xmax != 0`) — so one gets `isNewUser = true` and the other gets `false`. That is a change in the audit trail's content in this specific scenario: today it over-reports (duplicate `first_access_created`), after the fix it reports exactly once per account.

This is a **desirable** change from where I sit — it's the correct audit fidelity, not a regression — but it is a real, if narrow, behavioral difference, and the design/proposal should say so rather than asserting no observable difference anywhere. The Known Limitations text in `first-access/spec.md` today explicitly relies on "a duplicate is detectable by correlation ID" as the safety argument for the old behavior; the replacement text (task 3.2) should say plainly that the fix eliminates the duplicate-firing case, not just that the mechanism changed internally. This is a documentation-accuracy request, not a design objection — I'd flag it in review, not block on it.

**Recommendation:** Tighten the proposal/spec language so it doesn't overclaim "no observable behavior change" when the one behavior this whole change targets is, correctly, changing.

### Finding 2 (Informational): No new information-disclosure or timing surface

I checked this specifically because collapsing a SELECT + upsert into a single upsert is exactly the kind of change that can quietly introduce a timing oracle (e.g., "does this identity already exist" becoming inferable from response latency). It doesn't here:

- `isNewUser` was already returned to the caller before this change; nothing new is exposed. `xmax` itself never leaves the database — it's consumed server-side into a boolean in the same `RETURNING` clause, exactly as already shipped and reviewed in `teams.ts` (TEAM-006).
- If anything, going from two round trips to one *reduces* the timing surface between "existing account" and "new account" paths, since there's no longer a separate SELECT round trip whose latency profile could differ from the upsert's.
- This code path only runs after a valid, signed ID token has been exchanged (`packages/backend/src/routes/auth.ts:113-137` validates `sub`/`iss` presence before `resolveOrCreateAccount` is ever called), so there's no unauthenticated attacker in a position to probe this timing anyway.

No action needed; recording this because it's exactly the class of change I check reflexively on identity-provider integration code.

### Confirmed: no touch to claims validation or token trust boundary

`mapRoleClaimToGlobalRole` and the allowlist validation (`account-resolver.ts:64-86`), and the `sub`/`iss` presence checks in `auth.ts:121-137`, are outside the diff this change makes. The design and tasks.md both scope the change to the SELECT/upsert swap and comment replacement only. I have no concerns about claim trust or token validation being affected here — they aren't touched.

### Confirmed: no interaction with issues #2, #4, #5

I checked each against the actual code, not just the design's assertion:

- **#4** (`auth.success` / `auth.session_created` missing `sourceIp`/`correlationId`): confirmed still present as described — `auth.ts:215-225` shows `auth.session_created` carrying only `userId`/`sessionId` and `auth.success` carrying `userId`/`oidcSubject`/`oidcIssuer`/`isFirstAccess`, no `sourceIp` or `correlationId` on either. This change doesn't touch `auth.ts` at all (confirmed zero-diff, per task 1.4's acceptance gate), so it neither fixes nor worsens #4. Don't let this PR's merge read as having addressed #4 — it hasn't.
- **#5** (`executeJoinFlow` hardcoding `"callback"` as `sourceIp`): the current code (`auth.ts:468-533`) takes `sourceIp` as a required parameter sourced from `request.ip` at the call site and threads it through correctly — this looks already resolved independent of this change, and this change doesn't touch `executeJoinFlow` or anything upstream of it either way.
- **#2** (OIDC library error-message token leakage): unrelated file, unrelated code path; not touched.

This change is orthogonal to all three. That's the correct scope — I'd object if it tried to bundle any of them in.

### Audit logging: ordering and completeness unaffected structurally

The call site in `auth.ts` (lines 144-185) calls `resolveOrCreateAccount` once and branches on `user.isNewUser` after it returns, exactly as today. The internal collapse from two DB round trips to one doesn't change when or how many audit events are emitted relative to other events in the callback — it only changes, correctly, what `isNewUser` evaluates to under the race (Finding 1). I have no ordering concerns.

### Test rewrite requirement (Decision 2 / task 2.3) is the right bar

I want to flag support, not just findings: requiring the rewritten concurrency test to prove `isNewUser` is derived per-call from the mocked `is_new_user` value — rather than merely asserting a reduced call count — is exactly the kind of test discipline that prevents a security-relevant fix from being "fixed" on paper while silently regressing later. This is the same failure mode I'd flag if I saw it missing, so I'm noting it's present and correctly specified.

---

## What I did not review

Per my scope, I did not evaluate the domain/UX rationale for why `isNewUser` exists or is consumed, only the security-relevant mechanics of how it's computed and what it touches. I have no findings on `ResolvedUser`'s shape, the role-mapping logic, or session handling — none of that is in this diff.
