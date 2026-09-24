# Implementation Security Review: `inline-team-creation`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** `packages/backend/src/routes/facilitator-sessions.ts` (`POST /api/v1/teams`), `packages/backend/src/auth/audit-logger.ts`, `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts`, `packages/backend/migrations/11_teams_name_unique_normalized.sql`, `packages/shared/src/types/session-creation.ts`, `openspec/changes/inline-team-creation/specs/session-creation/spec.md`
**Baseline:** `design.md` decisions D3, D4, D6, D8, D9; my own design-phase review at `design-review-security.md` (F1–F4)

**Verdict:** Implementation delivers on the design as specified. No findings that block sign-off. Two observations below (both informational) worth a one-line note in the record, not a re-open.

---

## D8 — check ordering / non-facilitator name-existence probing

`facilitator-sessions.ts:437-510`: the handler resolves the actor's `global_role` first, rejects any non-`facilitator` with `403` at lines 459-480, and only then trims/validates the name (482-493) and runs the normalized-uniqueness pre-check (500-510). A non-facilitator caller's request never reaches the collision query — the `403` path returns before that `db.query` call exists in the control flow at all, not just before its result is used. This matches D8 exactly: authenticate → authorize → validate → check uniqueness, with authorization strictly ahead of any name-dependent branch.

Verified in the inline comment block at lines 408-417, which names D8 explicitly and warns against a future "shared validate-the-body helper" refactor inverting the order — good, this is exactly the kind of durable warning D8's own text asked for.

**Test coverage is real, not just per-case.** `facilitator-sessions.test.ts:646-680` ("non-facilitator rejection is byte-identical whether the submitted name collides or not") submits two requests under an `engineer` role — one with a name guaranteed fresh, one with a name that would collide — and asserts the two `403` bodies are structurally identical (all fields but the per-request `correlationId`) and that `mockDbQuery` was called exactly twice in both cases (actor lookup + audit insert only). This is the comparative test the design asked for, not two independent single-case assertions that could each pass while still leaking a timing/shape difference between the two scenarios. This directly satisfies the task's ask and closes F4 from my design review.

## D6 — no `team_memberships` row for the creating facilitator

Read the full handler body (`facilitator-sessions.ts:437-612`): the only `INSERT` statements present are `INSERT INTO teams`, `INSERT INTO topics`, `INSERT INTO sessions`, and `INSERT INTO audit_log` (twice — once on the `403` denial path, once inside the success transaction). There is no `INSERT INTO team_memberships` anywhere in this function, and `teams.created_by_user_id` is populated as ordinary attribution, not as a membership grant.

The regression test at `facilitator-sessions.test.ts:591-615` carries the inline comment I asked for in F2 — it names D6, states the facilitator-from-another-team conflict this prevents, and marks itself security-critical so a future refactor can't silently weaken it without that being a visible, deliberate decision. This matches the codebase's existing convention (`sessions_team_active_unique`, TEAM-006 rate-limit comments) that D6's own text and my F2 both called for. Closed as specified.

## Audit logging asymmetry (403 audited, 409 not) — D3 / F1

`403` non-facilitator rejection writes `team.creation_denied_role` via both a direct `INSERT INTO audit_log` (460-465) and `emitAuditEvent` (467-471), before the response is sent — matches `session.draft_denied_membership_conflict`'s established pattern and closes F1.

The `409` collision path — both the pre-check branch (500-510) and the in-transaction race branch caught via `TeamNameCollisionSignal` (538-541, 585-591) — writes no audit row in either case. I read this as implementing the design's documented asymmetry (D3: "audit the check that gates access, not the check that gates data shape") correctly, and I agree with that reasoning as stated at design time.

One gap: I did not find a test that directly asserts *absence* of an audit call on the `409` path (`facilitator-sessions.test.ts:697-731` asserts the `409` response shape but not that no `audit_log` insert or `emitAuditEvent` call occurred). In practice this is indirectly protected — `mockCollisionPrecheck` only stubs two `db.query` calls, so a stray third call for an audit insert would hit an unstubbed mock and most likely fail the test anyway — but that protection is incidental, not an explicit assertion of the documented design decision. This is a nice-to-have, not a finding: it doesn't change my sign-off, but I'd add `expect(mockEmitAuditEvent).not.toHaveBeenCalled()` (or equivalent) to the two 409 tests the next time that file is touched, so the asymmetry itself is what's under test rather than something a reader has to infer from mock call counts.

## D4 — normalized uniqueness, `23505` handling

`migrations/11_teams_name_unique_normalized.sql` is additive-only (new functional unique index, old exact-match constraint untouched, clean down-migration) — as designed. The handler's `23505` handling (526-542) matches on `err.code === "23505"` scoped to the `teams` INSERT specifically via the `TeamNameCollisionSignal` marker, not a blanket transaction-wide catch — this correctly implements engineer-review Finding 1's requirement to not depend on which of the two live constraints reports first for an exact-duplicate race. Test coverage exercises both the `teams_name_unique` and `teams_name_unique_normalized` constraint-name cases (test file 737-800) and confirms a `23505` from an unrelated statement (`topics_team_order`) is not mistaken for a name collision (832-860) — this is exactly the scoping guarantee I'd want verified, not just asserted in a comment.

## Multi-IdP / no Entra-specific assumption

`POST /api/v1/teams` introduces no authentication logic of its own. It reads `users.global_role` (already IdP-agnostic, written by `account-resolver.ts` from the mapped role claim regardless of provider) and relies on the existing global session/auth middleware. Nothing in this handler, `audit-logger.ts`'s new event names, or the shared response types special-cases Entra or any specific provider. Consistent with the project's standing multi-provider requirement and with what I confirmed at design time — no change here.

## D9 — rate limiting (deferred)

No rate limiting is present on `POST /api/v1/teams`, matching D9's stated, reasoned deferral (facilitator role is scarce and IdP-managed; abuse requires an already-compromised facilitator credential). Nothing in the implementation changes that calculus — the route did not land in `teams.ts` (it's in `facilitator-sessions.ts`, per D3), so TEAM-006's rate-limit infrastructure was never a low-cost reuse option here. No new finding; I'd revisit this decision under the same conditions D9 already names (route relocation, or facilitator role becoming less scarce), not before.

---

## Summary for sign-off

All four design decisions I was asked to verify (D3 audit asymmetry, D4 constraint handling, D6 facilitator-neutrality, D8 check ordering) are implemented as specified, with test coverage that proves the properties rather than just exercising the code paths — the D8 identical-rejection test and the D6 security-critical-commented regression test are both exactly what I asked for at design time. No blocking findings. One minor suggestion (explicit "no audit call" assertions on the two 409 tests) noted above for the next time this file is touched — not a condition of sign-off.
