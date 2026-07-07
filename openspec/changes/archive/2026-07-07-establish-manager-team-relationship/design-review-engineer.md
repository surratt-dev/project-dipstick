# Design Review — Establish Manager/Team Relationship
**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Date:** 2026-07-06
**Documents reviewed:** design.md, proposal.md, specs/manager-team-association/spec.md, specs/first-access/spec.md, tasks.md

---

## Summary

The design is well-reasoned on authorization policy and the audit trail requirements carry over correctly from TEAM-005. The phased migration plan is sensible. However, several claims about existing infrastructure do not match the actual codebase, and a few implementation gaps would surface mid-sprint without warning if this review does not name them explicitly. I've also identified one database schema conflict that will block TEAM-006 implementation until it is resolved.

Nothing here changes the scope or the authorization decisions. These are implementation-layer findings that need concrete answers before the sprint starts.

---

## Finding 1: SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, ACTION-005 do not exist in the backend

**Priority: High — scope framing risk**

The proposal states: "these endpoints already model EM authorization in the API contract; the `team_memberships` row written by TEAM-006 is the key that makes the authorization checks pass."

This is inaccurate as a description of the code. The backend routes directory contains `teams.ts`, `sessions.ts`, `auth.ts`, `join-links.ts`, and `health.ts`. There are no session history endpoints, no trend endpoints, and no action item read endpoints. The API contract spec may model EM access for these endpoints, but the implementations do not exist. Phase 3 is a full backend build — six new route handlers, new database queries, new serialization logic, and new shared types — not an authorization unlock on existing code.

The distinction matters for sprint planning and for the attribution boundary requirement. A developer who reads "the authorization checks already pass once the membership row exists" and reaches for a general-purpose session history query will miss that the EM-facing serialization path needs to be purpose-built to enforce the attribution boundary. The vote attribution constraint cannot be retrofitted onto a query that was written for participant views.

**Required before Phase 3 begins:** The proposal should explicitly state that SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, and ACTION-005 are net-new endpoint implementations, not authorization unlocks on existing routes.

---

## Finding 2: TEAM-003 (`GET /api/v1/teams/:teamId`) does not exist; the current response type is a flat array

**Priority: High — shared type boundary change**

The proposal references `GET /api/v1/teams/:teamId` (TEAM-003) with a response shape that includes separate `members` and `engineeringManagers` arrays. Neither the endpoint nor the response shape exists in the current code.

The current backend exposes `GET /api/v1/teams/:teamId/members`, and `TeamMembersResponse` in `packages/shared/src/types/team.ts` has a single flat `members: TeamMember[]` array. Both the endpoint and the type need to change to support Decision 7's labeled sections requirement.

Two approaches are possible:

- **Option A:** Change `TeamMembersResponse` to `{ participants: TeamMember[]; engineeringManagers: TeamMember[]; ... }` — clean separation, type-safe, requires updating the backend endpoint and the `MemberManagement` component.
- **Option B:** Keep the flat `members` array and filter by `role` client-side — works but is fragile. A developer who adds a new role category to `team_memberships` gets silent rendering bugs in the UI.

Option A is the right call. The backend already knows the role at query time. Sending a flat list and expecting the client to segment it correctly introduces a dependency between the frontend's rendering logic and the database schema that the type system cannot enforce.

The shared type change must be coordinated: `TeamMembersResponse` in `@dipstick/shared`, the backend route query and response serialization, and the `MemberManagement` component all change together. The type change is a compile-time boundary — if the backend ships without it, the CI build fails. That is the correct behavior.

---

## Finding 3: Audit table schema conflict between TEAM-005 and TEAM-006

**Priority: Blocking — must resolve before TEAM-006 implementation**

TEAM-005 writes to the `role_change_audit` table with columns `(actor_user_id, actor_global_role, actor_ip, subject_user_id, team_id, from_role, to_role)`.

The TEAM-006 spec requires an audit record with `operation = 'establish_manager_team_relationship'` as a named field, plus `target_user_id` (not `subject_user_id`). The `from_role`/`to_role` columns don't map to the TEAM-006 use case — there is no "from role" for a user who had no prior membership.

The proposal acknowledges this: "the audit trail destination must be confirmed before any TEAM-006 implementation task begins: if TEAM-005 writes audit records to a database table, this change must use that table (or create an `audit_log` table as a schema change in this change's scope)."

My recommendation: create an `audit_log` table as a schema change in this change's scope. A general-purpose audit table with `(id, actor_user_id, actor_global_role, actor_ip, target_user_id, team_id, operation, timestamp, metadata JSONB)` handles both TEAM-005 and TEAM-006 without schema gymnastics. Migrate TEAM-005's writes to this table simultaneously, remove `role_change_audit`, and update the structured-log counterpart in `audit-logger.ts`.

If the team prefers to extend `role_change_audit` instead (adding `operation`, renaming `subject_user_id` to `target_user_id`, making `from_role`/`to_role` nullable), that works but creates a single table serving two different shapes with nullable columns — not ideal.

**This is a blocking decision.** The migration must be written before the TEAM-006 handler, and the TEAM-005 tests in `teams.test.ts` verify the audit INSERT column layout precisely (test "4.4" checks positional parameters `[1]` through `[6]`). Those tests will need to be updated to match the new schema.

**Also required:** `AuditEventName` in `packages/backend/src/auth/audit-logger.ts` needs a new union member for the TEAM-006 event. The current type is:
```
| "team.role_changed"
```
Add `"team.manager_established"` (or equivalent). This is a minor change but it must be coordinated with the audit table decision — the event name and the `operation` column value should be consistent.

---

## Finding 4: `canAssignRoles` flag does not distinguish TEAM-005 from TEAM-006 authorization

**Priority: Medium — UI correctness**

The current `TeamMembersResponse` includes `canAssignRoles: boolean`. The authorization logic for TEAM-005 permits both Application Admins and Engineering Managers who have EM membership on the specific team. TEAM-006 is admin-only.

If the frontend renders the "Associate Manager" control (TEAM-006 trigger) based on `canAssignRoles`, it will display that control to EMs who cannot actually call TEAM-006 — they will see the UI affordance, attempt the operation, and receive a 403. That is a worse experience than not showing the control at all.

A separate `canAssociateManagers: boolean` flag is needed in the response type. This flag evaluates `global_role = 'application_admin'` only, not the EM-membership condition. The backend computes it server-side per request, same pattern as `canAssignRoles`. The escalation message (task 4.1, 4.2) renders only when this flag is false. The shared type `TeamMembersResponse` needs updating.

---

## Finding 5: Idempotency 201 vs. 200 implementation — use xmax, not SELECT-before-INSERT

**Priority: Medium — correctness under concurrency**

The spec requires 201 for create-new and 200 for update-existing, with identical response bodies. The naive implementation — `SELECT` to check existence, then `INSERT` or `UPDATE` — has a race condition identical to the one TEAM-005 solved with `SELECT FOR UPDATE`. Two concurrent admin calls for the same EM/team combination could both see "no row" and both attempt INSERT, with one failing.

The correct implementation is PostgreSQL's `ON CONFLICT DO UPDATE ... RETURNING` combined with `xmax` inspection:

```sql
INSERT INTO team_memberships (user_id, team_id, role)
VALUES ($1, $2, 'engineering_manager')
ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL
DO UPDATE SET role = 'engineering_manager'
RETURNING id, (xmax = 0) AS is_new_row
```

`xmax = 0` is true for freshly inserted rows and false for updated rows. This derives 201 vs. 200 from the upsert result atomically, without a separate SELECT. Note that `xmax` is a PostgreSQL-specific internal — document this in a code comment so the next engineer who reads it understands why.

The `ON CONFLICT` target depends on whether `(user_id, team_id)` has a unique constraint in `team_memberships` with `removed_at IS NULL`. Looking at the database-migrations spec, the schema includes `team_memberships` but I could not confirm whether the constraint exists in the migration files from this review. If it does not, a `WHERE removed_at IS NULL` partial unique constraint migration is needed as a prerequisite.

---

## Finding 6: Vote attribution boundary requires a purpose-built EM serialization path, not a filtered participant path

**Priority: High — attribution boundary enforcement**

Decision 5 says the attribution boundary is "a testable acceptance criterion, not documentation." That is correct, and I want to add the implementation constraint that the test suite must verify it at the API layer, not only through QA with an EM-role account.

The acceptance criterion ("a QA reviewer cannot determine any individual participant's vote") is necessary but not sufficient as the sole enforcement gate. The right implementation is:

1. EM-facing session history queries must never SELECT `voter_id` from the `votes` table. Aggregate by `vote_value` only.
2. The response serialization for EM-facing endpoints must not include any field that can be cross-referenced to identify a voter — this includes participant display names, userIds in session_participants rows, and vote timestamps fine-grained enough to enable correlation attacks.
3. A unit test at the route handler level must assert that the JSON response body for an EM session history request contains no `userId`, `voter_id`, `voterId`, `displayName` (when applied to vote rows), or equivalent field.

The QA acceptance criterion handles the rendered view. The unit test handles the serialization layer. Both are required. A serialization layer test can be run in CI on every PR; the QA criterion cannot. If the unit test is not written, a refactor that adds `voter_id` to the aggregate query response will pass CI and wait to be caught in QA.

---

## Finding 7: Action item body text attribution — Q8 resolution is incomplete

**Priority: Medium — implementation ambiguity**

The proposal resolves Q8: `ownerDisplayName` is visible to EMs. Fine. But the spec notes: "Action item text that attributes a concern to a named engineer is attribution-adjacent and must be reviewed before EM-facing display."

The Q8 resolution covers the assignee field only. It does not specify whether action item body text (the title/description of the action item itself) is shown to EMs by default, hidden by default, or subject to some review mechanism. A developer implementing ACTION-004 for EM callers needs a concrete answer: do we include the `description` field in the EM response body or not?

If the answer is "yes, include it" — the spec's "attribution-adjacent" note is just a warning, not a constraint, and action item text is fully visible to EMs. If the answer is "no, not until reviewed" — there needs to be a `reviewed_for_em_display` flag on `action_items` or equivalent, and a workflow for facilitators to mark items as safe. That is a non-trivial scope addition.

This must be resolved explicitly before task 5.6 is started. A developer who reaches task 5.6 without this answer will either ship with full body text visible (possibly violating the attribution intent) or ship with no body text visible (making action items useless to EMs). Neither outcome is acceptable.

---

## Finding 8: `manager-team-association` spec has two PENDING markers that block specific tasks

**Priority: Medium — spec hygiene before implementation**

The spec file at `specs/manager-team-association/spec.md` still contains:

1. The authorized actor line: `[PENDING Q2 RESOLUTION — BA and security analyst must align...]` — the proposal resolves this as Application Admin, but the spec text has not been updated.
2. The action item assignee line: `[PENDING Q8 RESOLUTION — must be decided explicitly before the action item view is designed]` — the proposal resolves this as `ownerDisplayName` visible, but the spec text has not been updated.

Tasks 3.1 (implement TEAM-006 with correct authorization) and 5.6 (implement EM action item endpoint) depend on these resolutions being in the spec, not only in the proposal. The spec is the implementation reference. A developer starting task 3.1 who reads the spec's PENDING marker has no ground to stand on.

These PENDING markers must be replaced with the decided text before implementation of those tasks begins. The design acknowledges this requirement explicitly — I'm flagging it as a concrete pre-sprint action item because it is easy to miss in the setup phase.

---

## Finding 9: First-access global_role mechanism — genuinely blocking, genuinely unresolved

**Priority: Blocking — no code starts until resolved**

The proposal does not select a global_role mechanism. It describes Options A, B, and C, names the decision owners, and defers. This is correct — it is not the proposal's decision to make unilaterally. But I want to be explicit about what this means for the implementation:

Phase 1 of the migration plan and task 2.2 both sit behind this gate. Phases 2, 3, and 4 also sit behind it — any TEAM-006 implementation without a working global_role path produces an endpoint that always returns 409. That is not just a Phase 1 dependency; it is a dependency for every integration test in the system.

If the chosen path is Option A (IdP role claims), the `resolveOrCreateAccount` function in `account-resolver.ts` needs modification: the claims interface needs a role claim field, and the upsert needs to SET `global_role` conditionally on the claim value. The claim name must be a configuration value. The audit trail for the assignment — currently undefined for this path — needs to emit an audit event.

If Option B (bootstrap endpoint), a new route in a new file (`packages/backend/src/routes/admin.ts` or similar) needs to be written with admin-only authorization before any EM can be designated. Security analyst review is required before this ships.

Either way, the `first-access` delta spec currently has no decided text — it describes all three options as equally valid. The spec must be updated with the chosen option before any implementation begins.

I do not advocate for a specific option here; that is not my call. I am flagging that "resolved" in the proposal means "we will resolve this" and the code clock does not start until the decision is documented in the spec.

---

## Finding 10: GET /api/v1/teams/:teamId/members returns EMs in the flat `members` array today — access model statement surfaces an inconsistency

**Priority: Low — UX consistency**

After TEAM-006 is called for a team, the EM appears in `team_memberships` with `role = 'engineering_manager'` and `removed_at IS NULL`. The current `GET /api/v1/teams/:teamId/members` query selects `WHERE removed_at IS NULL` with no role filter. The EM is returned in the flat `members` array.

The `MemberManagement` component renders every member in the same `<ul>` with a role selector. If TEAM-006 is implemented before Finding 2's type change (the split into `participants` and `engineeringManagers` arrays), the EM appears in the member list with a role selector offering "promote to EM" — which is a no-op since they already are. The component will submit a PATCH that returns a no-op 200 and show a confirmation message. Not a data integrity problem, but confusing UX that will be reported as a bug.

The ordering of work matters: the `TeamMembersResponse` type change (Finding 2) should be implemented as part of Phase 2 (TEAM-006 endpoint), not Phase 4 (team administration view). The labeled sections are the acceptance criterion for Phase 4, but the type boundary change needs to be in place before Phase 2 ships to production, or the interim state produces the confusing behavior described above.

---

## Summary Table

| # | Finding | Priority | Blocking? |
|---|---------|----------|-----------|
| 1 | SESSION-007/008, TREND/ACTION endpoints are net-new, not authorization unlocks | High | Scope framing |
| 2 | TEAM-003 does not exist; `TeamMembersResponse` is a flat array requiring shared type change | High | Phase 4 |
| 3 | Audit table schema conflict (`role_change_audit` vs. TEAM-006 spec fields) | High | Blocking TEAM-006 |
| 4 | `canAssignRoles` does not distinguish TEAM-005 vs. TEAM-006 authorization | Medium | UI correctness |
| 5 | Idempotency 201/200 — use `xmax`, not SELECT-before-INSERT | Medium | Correctness |
| 6 | Attribution boundary needs API-layer unit test, not only QA acceptance criterion | High | CI enforcement |
| 7 | Action item body text attribution — Q8 resolution covers assignee only, not body text | Medium | Task 5.6 |
| 8 | Spec PENDING markers not updated with proposal resolutions | Medium | Pre-sprint hygiene |
| 9 | Global_role mechanism unresolved — genuinely blocking, not a formality | Blocking | All phases |
| 10 | EM appears in flat member list before type change ships — interim UX inconsistency | Low | Ordering |

---

## What I am not raising

The authorization policy decisions (admin-only actor, full historical access, no date boundary) are sound and I have no objection to them. The transaction semantics from TEAM-005 (begin/lock/write/audit/commit pattern) carry over cleanly to TEAM-006 — the team-level `SELECT FOR UPDATE` lock from TEAM-005 is not needed for TEAM-006 since there is no zero-participant guard, but the transactional audit write is non-negotiable and the existing pattern handles it correctly.

The session participation enforcement (dual check on `global_role` AND `team_memberships.role`) is already implemented correctly in `sessions.ts`. TEAM-006 does not require changes there — it just creates the row that makes the second check relevant for EMs who were previously participants.

The ROLE_LABELS vocabulary mapping in `TeamPage.tsx` and `MemberManagement.tsx` is the right pattern. The EM-facing views should follow the same convention: no raw database enum values in any UI-facing string.
