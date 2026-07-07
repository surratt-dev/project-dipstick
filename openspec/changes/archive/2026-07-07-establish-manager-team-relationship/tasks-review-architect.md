# Tasks Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** establish-manager-team-relationship
**Source documents:** tasks.md, design.md, proposal.md

---

## Summary

The task ordering reflects the correct high-level phasing from design.md — prerequisite decisions before global role mechanism, global role mechanism before TEAM-006, TEAM-006 before EM read-only views, views before team administration UI. That structure is sound.

What the tasks list does not do is make the internal dependencies within and between those phases explicit. Several tasks assume infrastructure that no preceding task builds. The result is a task list that will produce integration failures and scope surprises when implementation begins — not because the design is wrong, but because the translation from design decisions to ordered implementation tasks left out the load-bearing steps. I have identified five issues that I consider blocking before this task list is handed to an implementation team, and three additional gaps that will cause friction if not addressed.

---

## Blocking Issues

### B1. No task creates the `audit_log` table before task 3.6 requires it

Task 3.6 reads: "Implement audit trail: write audit log entry in same transaction as `team_memberships` write; roll back both if audit write fails."

That task depends on the `audit_log` table existing. The table does not exist. Decision 9 in design.md is explicit: this change creates the table as a new database migration, migrates TEAM-005's writes from `role_change_audit` to `audit_log`, drops `role_change_audit`, updates the `AuditEventName` union in `packages/backend/src/auth/audit-logger.ts`, and updates the TEAM-005 tests in `teams.test.ts` (including test "4.4" which checks positional parameters `[1]` through `[6]`). None of these are present in the task list as discrete tasks.

If an implementor picks up task 3.6 without recognizing this prerequisite, they will either invent an ad-hoc audit destination (recreating the problem Decision 9 solved) or block midway and require scope renegotiation. Neither is acceptable.

**Required additions, to be inserted before task 3.1:**
- Create the `audit_log` database migration per the schema in Decision 9
- In the same migration: migrate TEAM-005 writes from `role_change_audit` to `audit_log` and drop `role_change_audit`
- Update `AuditEventName` in `packages/backend/src/auth/audit-logger.ts` to include `"team.manager_established"`
- Update TEAM-005 tests in `teams.test.ts` to match the new `audit_log` schema; specifically, test "4.4" checking positional parameters `[1]` through `[6]` must be corrected before any new code that touches the audit path is merged

These tasks must complete and pass CI before task 3.6 begins. Design.md states this explicitly: "Tests for TEAM-005 audit behavior in `teams.test.ts` (including test '4.4') must be updated to match the new schema before TEAM-006 implementation begins."

---

### B2. No tasks implement TEAM-003 and the `TeamMembersResponse` shape change before Phase 4 UI depends on them

Tasks 6.1 through 6.4 update the team administration view to display `participants` and `engineeringManagers` in separate labeled sections. Those tasks assume a `TeamMembersResponse` with `{ participants: TeamMember[]; engineeringManagers: TeamMember[]; canAssignRoles: boolean; canAssociateManagers: boolean }`. That type does not exist. The current type in `packages/shared/src/types/team.ts` has a single flat `members: TeamMember[]` array.

Decision 12 in design.md is unambiguous on the ordering: "The `TeamMembersResponse` type change must be implemented in Phase 2 (alongside TEAM-006), not Phase 4 (team administration view)." The rationale is also stated: once TEAM-006 ships to production, an EM appears in `team_memberships`. The current query (`WHERE removed_at IS NULL`, no role filter) pulls the EM into the flat `members` array, and `MemberManagement` renders a role selector with "promote to EM" — a no-op that produces a misleading confirmation. This is a correctness bug that will be reported before Phase 4 even begins.

The tasks list has no task for:
- Implementing `GET /api/v1/teams/:teamId` (TEAM-003) as a net-new route handler — the current backend exposes `GET /api/v1/teams/:teamId/members`, not TEAM-003
- Updating `TeamMembersResponse` in `@dipstick/shared`
- Adding `canAssociateManagers` flag to the response (Decision 10)
- Updating the backend route handler query and response serialization
- Updating `MemberManagement` to consume the new shape

Decision 12 requires these to ship together as an atomic change: the type change, the backend handler, and the component update. CI enforces this because it is a compile-time boundary — the backend cannot ship without the updated shared type, and the component cannot render correctly without the split arrays.

**Required additions, to be inserted in the Phase 2 section (before Phase 3 begins and certainly before Phase 4):**
- Implement `GET /api/v1/teams/:teamId` (TEAM-003) with `participants` / `engineeringManagers` split in the response
- Update `TeamMembersResponse` in `@dipstick/shared` to the shape specified in Decision 12
- Add `canAssociateManagers` boolean to the response, computed server-side per Decision 10
- Update `MemberManagement` component to consume `participants` and `engineeringManagers` arrays
- Write a test confirming that after a successful TEAM-006 call, the target user appears in `engineeringManagers` and not in `members`

These tasks must be in Phase 2, not Phase 4. Phase 4 tasks 6.1–6.4 then become rendering changes against already-available data rather than tasks that silently depend on a data model that has not been built.

---

### B3. Task 3.3 (xmax idempotency) depends on a database constraint that may not exist

Task 3.3 reads: "Implement idempotent behavior: 201 on create-new, 200 on update-existing, identical response body in both cases."

Decision 3 specifies the implementation: PostgreSQL `ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL DO UPDATE`. That `ON CONFLICT` clause requires a partial unique constraint on `(user_id, team_id) WHERE removed_at IS NULL` in `team_memberships`. Decision 3 states: "If this constraint does not exist in the migration files, add it as a prerequisite migration for TEAM-006."

The tasks list has no task to verify whether this constraint exists or to add it if it does not. If the constraint is absent, the `ON CONFLICT` syntax will fail at runtime, not at compile time. An implementor will write task 3.3, write the corresponding test in task 3.9, observe test failures that are not obviously caused by a missing schema constraint, and lose time diagnosing the wrong layer.

**Required addition, to be inserted before task 3.1:**
- Verify that `team_memberships` has a partial unique constraint on `(user_id, team_id) WHERE removed_at IS NULL`; if absent, add it as a prerequisite migration

This task is a prerequisite to task 3.3 and the idempotency tests in task 3.9.

---

### B4. The Phase 1 → Phase 2 gate has no corresponding task; it will be treated as advisory

Task 2.4 reads: "Verify the end-to-end path: user signs in → `global_role = 'engineering_manager'` is set → TEAM-006 precondition is satisfied."

Design.md states: "Phase 2 does not begin until this test passes." This is a hard gate. Decision 2 repeats it: "The end-to-end path... must be tested before TEAM-006 implementation begins. Teams must not be promised EM history access until this test passes."

A task that says "verify X" does not by itself communicate that the subsequent section is blocked until this verification is green. In a task list without explicit phase labeling, tasks 3.1 onward will be picked up in parallel with tasks 2.x unless the gate is made explicit. The risk is real: TEAM-006 implementation begins before the IdP claim mapping is verified, the end-to-end test does not exist yet, and the TEAM-006 tests from task 3.9 substitute for the missing Phase 1 verification by using seeded `global_role` values directly — bypassing the IdP flow entirely.

**Required change:**
- Add an explicit gate task between section 2 and section 3: "Phase 1 gate: tasks 3.x do not begin until task 2.4 passes in CI. Confirm test exists and is green before any TEAM-006 implementation begins."

If this change does not make it into the task list, add it to the phase header comment so that whoever assigns tasks has a visible blocking condition.

---

### B5. No task implements EM access audit records for Phase 3 endpoints, despite this being a Decision 11 requirement

Decision 11 in design.md states: "Every EM access to a session history, trend data, or action item endpoint that returns data must generate an audit record in `audit_log`. Required fields: caller identity, team ID, session identifier where applicable, timestamp."

Tasks 5.1 through 5.10 cover the implementation of the Phase 3 endpoints but contain no task for writing audit records on EM access. The atomicity requirement from Decision 9 extends to these endpoints as well — the audit record must accompany the data access event. There is no task that implements this, no task that tests it, and no task that has the security analyst verify it before Phase 3 ships.

This is a security control requirement, not an implementation detail. Its absence from the task list means it will not be built unless someone discovers the gap during code review. At that point it becomes unplanned scope in an already-in-progress phase.

**Required additions in section 5:**
- Implement `audit_log` writes for every Phase 3 endpoint that returns data to an EM caller (SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, ACTION-005), per the field requirements in Decision 11
- For bulk reads (trend view covering multiple sessions): log team ID and date range, not per-session rows
- Write tests: EM access to a history endpoint produces an audit record; EM access attempt that returns 403 does not produce a record

---

## Additional Gaps

### G1. Rate limiting on TEAM-006 is required before Phase 2 ships; no task exists for it

Design.md Q6 states: "Rate limiting on TEAM-006 is required... The threshold must be specified in the spec before Phase 2 implementation begins." The Risks section names the scenario explicitly: bulk TEAM-006 calls under a compromised admin account would grant historical data access across many teams before the compromise is detected.

There is no task for specifying the rate limit threshold, no task for implementing it, and no task for testing it. Q6 is listed as requiring BA and security analyst input before Phase 2 — that work needs to produce a task.

**Required addition in section 3:** Implement rate limiting on `POST /api/v1/teams/:teamId/managers` at the threshold agreed in Q6 resolution.

---

### G2. The threat model session is a Phase 0 → Phase 2 gate; it is absent from task section 1

Design.md Phase 0 states: "Threat modeling session must be completed before Phase 2 begins." The required scenarios are named: TEAM-006 as an access escalation vector, EM account compromise, IdP claim manipulation, and retroactive historical data exposure under Decision 6. This session was committed to at the initial architecture review.

Task section 1 (Prerequisite Decisions) gates implementation on five decisions. None of those tasks represents the threat modeling session. This is a process dependency, not a code change, but it is a blocking condition for Phase 2 and it needs to appear in the task list as a named deliverable with an owner.

**Required addition in section 1:** Conduct threat modeling session covering the four scenarios named in design.md Phase 0; session must be complete before Phase 2 begins.

---

### G3. Phase 2 rollback script is required before Phase 2 ships; no task exists for it

Design.md states: "Phase 2 rollback: the `audit_log` migration replaces `role_change_audit`. Rolling back Phase 2 requires restoring `role_change_audit` and its data from backup or a reverse migration. This must be scripted before Phase 2 ships."

There is no task for this. A rollback script that does not exist before deployment is not a rollback plan.

**Required addition:** Write and validate the Phase 2 rollback migration (restoring `role_change_audit`, reversing `audit_log` creation) before Phase 2 ships to production.

---

## Ordering Summary

The following shows the correct ordering for the tasks that are currently present or need to be added:

| Phase | Required before it begins | Key tasks missing from current list |
|---|---|---|
| Phase 0 (Prerequisite decisions) | Nothing | Threat model session gate (G2) |
| Phase 1 (Global role mechanism) | Phase 0 complete | None — section 2 is adequate |
| Phase 2 (TEAM-006 + shared type) | Phase 1 test green (B4 gate) | audit_log migration (B1), TEAM-005 migration (B1), TEAM-003 + TeamMembersResponse + MemberManagement (B2), partial unique constraint (B3), rate limiting (G1), rollback script (G3) |
| Phase 3 (EM read-only views) | Security analyst atomicity verification | EM access audit records (B5) |
| Phase 4 (Team admin view) | Phase 2 complete (TeamMembersResponse shape available) | None — sections 6 and 7 are adequate given B2 is resolved |

The Phase 4 UI tasks (6.1–6.4) are currently the most exposed to the upstream gaps. They read correctly in isolation — they describe rendering logic — but they implicitly depend on a data shape (TEAM-003's `participants`/`engineeringManagers` split) that no Phase 2 task currently builds. Resolve B2 and those tasks become straightforward.

---

## What Is Correct

For completeness: the following are well-ordered and do not require changes.

- Section 1 prerequisite decisions correctly gate all implementation work
- Tasks 2.1–2.5 correctly sequence the IdP claim mapping work
- Tasks 3.1–3.9 correctly decompose TEAM-006 once the prerequisites I have flagged are in place
- Section 4 (escalation path) is conditional on Q2 resolution, which is resolved, and the ordering is correct
- Tasks 5.1–5.10 correctly sequence the EM read-only backend build once the audit infrastructure is in place
- Tasks 7.1–7.3 (access model statement) have no architectural dependencies beyond Phase 4; they can proceed in parallel with 6.x
- Section 8 (out-of-scope documentation) is independent and correctly scoped
- Section 9 (end-to-end verification) is correctly positioned as the final section

The gaps I have identified are additions and insertions, not restructurings. The skeleton is sound. The missing tasks are the ones that the design decisions made explicit but the task translation left out.

---

*Review complete. These findings should be addressed before the task list is handed to the implementation team.*
