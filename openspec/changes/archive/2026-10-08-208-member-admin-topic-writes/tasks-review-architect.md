# Tasks Review: Architect — 208-member-admin-topic-writes (#208)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Artifact:** `tasks.md` (read with `proposal.md` and `design.md`)
**Focus:** Does the task order respect architectural dependencies? Does any task assume something not yet built?
**Verdict:** **Approve with changes.** The design is sound and the scope is tight. The task *content* is right. The *order* plus the "every section ends green" rule cannot both hold: sections 1, 2, 3 and 4.1 do not compile or pass on their own. Two other tasks reference things that come later or that happen outside the PR. All fixes are reorders or merges. No new work.

I checked the claims below against the code on this branch (`audit-logger.ts`, `content.ts`, `fail-open-audit-write.ts`, `helpers/real-db.ts`, `topic-002-admin-audit-integration.test.ts`, `TopicManagementPage.test.tsx`).

---

## Blocking: the "each section ends green" rule fails for sections 1 to 4

The preamble says: "Every section must end with the full backend (unit **and** real-Postgres integration) and frontend suites green." With the current order, that is impossible for four sections in a row.

### A1. Section 1 cannot compile without section 2

Task 1.1 removes `"admin.topic_config_denied"` from the `AuditEventName` union. `content.ts` still uses that name in three places until section 2 runs:

- `content.ts:235`: `type Topic002AdminOperation = "admin.topic_config_accessed" | "admin.topic_config_denied";`
- `content.ts:873`: `operation: "admin.topic_config_denied"` (passed to the insert, whose `operation` is typed `AuditEventName` through `fail-open-audit-write.ts:36`)
- `content.ts:884`: `emitAuditEvent(request.log, "admin.topic_config_denied", …)`

So after 1.1, `tsc` fails. Section 1 assumes section 2 is already done. This is the dependency inverted: the producer (`content.ts`) has to stop emitting the name before the registry (`audit-logger.ts`) can drop it.

**Fix:** Do task 1.1 after 2.1–2.2 (move it into section 2 as the last step, or renumber section 1 to follow section 2). Tasks 1.2 and 1.3 only change comments and can stay where they are.

### A2. Section 2 cannot pass tests without section 3, and section 3 cannot pass without 4.1

- Task 2.1 deletes the exported `ADMIN_IS_TEAM_MANAGER_MESSAGE` / `ADMIN_MEMBERSHIP_NOT_ADMITTED_MESSAGE`. `content.test.ts` imports them (task 3.3 removes those imports). After section 2, the unit suite does not compile.
- Task 2.2 removes the deny branch. The existing "engineering_manager membership gets 403" unit test (3.1), the parity test's `{ get: 403; post: 201 }` row (3.4) and the real-Postgres EM-member case (4.1, `topic-002-admin-audit-integration.test.ts:122`) all still expect `403`. After section 2 they fail. After section 3 the integration suite still fails until 4.1.

This is not a code dependency problem. The behaviour change and the tests that pin it are one atomic unit, and the plan splits them across three sections, each of which claims to be green.

**Fix (pick one, and say which in the preamble):**

1. **Recommended: one vertical slice.** Merge into one section, "TOPIC-002 admin arm revert", in this order:
   1. Convert and update the tests first: 3.1, 3.2, 3.3, 3.4, 4.1, 4.2. They go red for the right reason (they expect `200` and get `403`). This is the cheapest proof that the tests actually exercise the change.
   2. Code: 2.1, 2.2, 2.3, 2.4, then 1.1 (A1).
   3. Comments: 1.2, 1.3, 2.5, 2.6, 3.5.
   4. Gate: full backend unit + integration green.
2. Keep the sections, but change the preamble to "sections 1–3 and task 4.1 are one commit; the suites are green at the end of that group", so no one tries to verify green mid-group.

Either way, the standing constraint "no fail-closed test on the TOPIC-002 admin arm is deleted without a replacement" is easier to check when the test conversion and the code deletion are in the same diff.

### A3. Task 4.1 is before 4.4, but 4.4 changes how 4.1 seeds data

Task 4.4 extends `Fixture.member` with a `role` parameter and says to "drop the local `membership()` helper in `topic-002-admin-audit-integration.test.ts` (~L82), or keep it only for the `removed_at` case." That is the file task 4.1 (and 4.2) edits. If 4.1 is done first, it is written against the local helper and then rewritten in 4.4.

**Fix:** Move 4.4 to the top of section 4, or before the slice in A2, since it is a pure test-helper extension with a default argument and breaks no caller. Then 4.1, 4.2 and the new 4.5 file all use the extended fixture. Decide in the task whether the local helper stays for `removed_at` (it is used at L241 with `removed = true`; `Fixture.member` has no `removed` option). I suggest keeping the local helper only for that one case, so 4.4 is not widened further.

---

## Non-blocking ordering issues

### A4. Task 8.2 depends on spec sync, which happens after the PR, not before it

Task 8.2 runs "after sync" and its expected result includes `openspec/specs`. Task 8.1 edits main-spec Purpose paragraphs "at sync/archive time". Both depend on the sync step, which in this workflow happens at archive, after the PR (8.4) is merged. Section 8 currently reads as pre-PR verification and would block the PR on something that cannot happen yet.

**Fix:** Split 8.2:

- **8.2a (pre-PR):** run the same grep over `requirements docs packages` only. This proves the code and docs are clean before review.
- **8.2b (at archive):** after sync and 8.1, run it over `openspec/specs`.

Move 8.1 and 8.2b into a short "At archive" section after 8.4, so the PR checklist only contains what can be done before the PR.

### A5. Task 5.2 is a whole-change check placed mid-plan

5.2 (`git diff main` on the helper and `topics.ts`) checks a standing constraint across the whole change. Placed in section 5, it passes even if a later section breaks the constraint. Move it into section 8 next to 8.3, or make it part of the final gate. 5.1 can stay where it is; it has no dependencies.

### A6. Section 3.6 and 4.6 are "confirm" tasks: run them at the end of the slice

3.6 (regression pins) and 4.6 (`topic-annotation-integration.test.ts`) are only meaningful after the code change. Inside the slice in A2 they belong at the gate, not between test conversions. This is wording, not a real dependency risk.

---

## Ordering that is correct (no change)

- **Section 5 (write-wrapper comments) and section 6 (frontend)** have no build dependency on sections 1–4. I checked the frontend: `TopicManagementPage.test.tsx:178` uses a literal message string, not an import from the backend, so 6.2 does not break when the backend constants go. Sections 5 and 6 can run in any order relative to the backend slice.
- **Task 4.5 (new 12-case write matrix)** depends only on 4.4 and on write behaviour that does not change. With A3 applied it can run before or after the TOPIC-002 slice. Running it **before** the slice is better: it pins the "writes are unchanged" claim (design D5) against unchanged code, so any later failure points at this change.
- **Section 7 (requirements and docs)** depends on nothing in code. 7.1 (08b) has to exist before 8.4 links to it; that order holds.
- **Task 2.3 widening `adminAudit.membershipRole` to `string | null`** is consistent with the source: `readActiveMembershipRole` (`team-content-access-helper.ts:275`) already feeds a raw string into the predicate, so removing the predicate and widening the type is one step with no intermediate state.
- The design's handler order (D3) and the fail-closed position of the membership and role-set reads are unchanged by the tasks. Good: the revert does not move any audit write relative to the timing floor.

---

## Minor

- **Cross-reference drift:** proposal disposition BA F5 says "test added to task 6.4"; the manager-admin write-controls test is **6.5**. Fix the proposal reference.
- **Task 1.2** says the `membership_role` set is "`null | "participant" | "engineering_manager"` today". Per D2 the set is open. Add "or any future enum value, recorded raw" so the comment does not read as an allow-list, which is the exact regression D2 warns about.

---

## Suggested order (summary)

| Step | Tasks | Gate |
|---|---|---|
| 1 | 4.4 (fixture `role` parameter) | green |
| 2 | 4.5 (write matrix against unchanged write code) | green |
| 3 | TOPIC-002 slice: tests 3.1–3.4, 4.1, 4.2 → code 2.1–2.4, 1.1 → comments 1.2, 1.3, 2.5, 2.6, 3.5 → confirm 3.6, 4.6 | green (first gate inside the slice) |
| 4 | 5.1 (write-wrapper comments) | green |
| 5 | 6.1–6.5 (frontend) | green |
| 6 | 7.1–7.8 (requirements and docs) | n/a |
| 7 | 5.2, 8.2a, 8.3, 8.4 (pre-PR verification and PR) | green |
| 8 | At archive: 8.1, 8.2b | grep clean |

No task needs new scope. A1 and A2 must be fixed before implementation starts. Otherwise the first `tsc` run will fail, and the implementer will be tempted to "fix" it in whatever way compiles.
