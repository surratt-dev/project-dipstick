# BA Review: Tasks for topic-add-form-and-empty-state (#55)

**Reviewer:** Marcus Delgado (Senior Business Analyst)
**Date:** 2026-10-01
**Reviewed:** `tasks.md`, checked against `proposal.md`, `specs/topic-management-screen/spec.md` (13 ADDED requirements, 67 scenarios), and `specs/topic-customization-lock/spec.md` (1 ADDED requirement, 4 scenarios)
**Question asked:** Do the tasks cover every capability in the proposal, and does every ADDED requirement and scenario trace to at least one task?

---

## Overall read

Coverage is very good. Every proposal capability has a home, and every ADDED requirement traces to an implementing task and a test task. The test tasks mostly use "one test per scenario in requirement X", and that catches the scenarios on their own. Tasks 9.3 (every exact string verbatim in the component and in a test) and 1.4 (the parity test) are the two safety nets I most wanted, and both are present.

Nothing from the requirements is lost outright. What I found is smaller:

- **one task that contradicts the approved copy** (9.2),
- **forward references** where a test task needs something a later task builds,
- **a handful of stated behaviours that no test task names**. They sit inside requirements whose scenarios don't cover them, so "one per scenario" misses them.

None of this needs a new feature or a new task section. Every fix is a phrase added to an existing task.

Severity: **High** = an implementer following the task literally will produce a wrong result or a failed check. **Medium** = a stated requirement with no test that would catch a regression. **Low** = ordering or wording hygiene.

---

## 1. Findings

| # | Sev | Task | Issue | Suggested fix |
|---|---|---|---|---|
| T1 | **High** | 9.2 | **The session grep contradicts the approved description copy.** 9.2 allows one exception, the locked empty state's "its sessions can't run". The spec's exact Description helper text is "Engineers won't see this during sessions. …" (spec L66, L78), and I approved that wording (C1). Read literally, 9.2 fails on correct code. Worse, it invites someone to "fix" the copy that is doing the most honest work in the form. | Add the description helper to the allowed exceptions. Restate the check as the spec's rule: no string may **state or imply that something will appear in a session**. A string that says something will *not* appear is allowed. |
| T2 | Medium | 2.2 | **The headline Remove-refetch scenario loses its point.** The scenario "A refetch failure after Remove stays inline and keeps the add form" (spec L345) asserts that a **dirty add form survives**. That is the whole reason section 2 exists ("a dirty add form locks nothing" is only safe because of it). 2.2 tests only "the inline message and that the screen is not replaced", and it runs before the add form exists (sections 4–5). The requirement also says reorder and definition drafts survive (L343), and no task tests that. | Add a test, in `TopicManagementPage.add.test.tsx` after 5.3 or as a 5.4 item: a dirty add form plus a Remove whose refetch fails, then assert the form and its values are intact. Optionally add one assertion that a dirty reorder draft survives the same failure. |
| T3 | Medium | 6.1 / 6.3 | **Focus after Discard isn't assigned.** The spec says "Discard SHALL close and reset the form and return focus to the control that opened it" (L266; also R2, L25). Task 4.2 handles focus only for *clean* Cancel, and 6.1 says nothing about focus. 6.3's "discard confirm both paths" doesn't say focus is asserted. | 6.1: "Discard closes, resets, and focuses the opener (same `pendingFocusId` path as clean Cancel)." 6.3: assert focus after Discard from both the heading trigger and the empty-state action. |
| T4 | Medium | 6.3 | **The "Add anyway" gating has no test.** 6.2 gates "Add anyway" / "Add as a new topic anyway" like Submit (spec L289, proposal I2, which closes the hole "from the other side"). The spec gives this no scenario, so "one test per ✕ cell" won't produce one. Also untested: the single visible in-flight reason that suppresses the others (L291), and the add trigger and fields staying usable during busy states (L293). | 6.3: add one test that "Add anyway" is disabled with "Save or discard your order changes first." while the reorder draft is dirty. Add one that only `add-submitting-reason` is visible while the add is in flight, with another reason also applicable. Add one that the heading trigger opens the form while a reorder draft is dirty. |
| T5 | Medium | 5.4 | **Stated outcomes with no scenario, and so no named test:** (a) the `422` with no field or an unknown field → "The topic couldn't be added. Check each field and try again." (L93); (b) `404 TEAM_NOT_FOUND` and `403 NOT_A_FACILITATOR` → form-level alert (only `FACILITATOR_IS_TEAM_MEMBER` has a scenario); (c) "A form-level alert SHALL be cleared by the next Submit" (L172); (d) a 409 whose refetch reports the team **unlocked**, so the control stays (L169, my O1 race case). | Add (a)–(d) to the 5.4 list. (b) can be one table-driven test across the three codes. |
| T6 | Low | 4.4 | **Two assertions in the R2 scenarios aren't listed.** "Opening the form focuses Name **and hides the trigger**" (L45–49): 4.4 lists focus but not the hidden trigger. "An administrator sees … **no explanation**" (L21): 4.4 lists "absent for `canAddTopics: false`" but not "no message about adding topics outside the empty state". | Add both assertions to 4.4. |
| T7 | Low | 2.2 | **The team-change test runs too early, and half of it is missing.** "A team change discards the open add form" sits in 2.2, before the form exists (sections 4–5). The scenario also asserts "no add request is sent for either team" (L43). | Move the test to `TopicManagementPage.add.test.tsx` (it can still verify 2.1's `key={teamId}`) and assert no POST was made. |
| T8 | Low | 2.1, 4.2, 4.4, 5.4 | **Forward references in the task order.** 2.1 writes its messages "in the screen message region (task 5.3)", which doesn't exist yet. 4.2/4.4 and 5.4 test opening from the empty state and the "Added '<name>'." empty-state flow, but `ActiveTopicsEmptyState` arrives in 7.1. An agent working top to bottom will either stall or build a throwaway version. | Either move the region's construction (the first half of 5.3) ahead of 2.1, and 7.1–7.2 ahead of 4.2, or add one line under section 0: "Sections are grouped by concern, not build order. Build 5.3's region before 2.1 and 7.1 before 4.4." |
| T9 | Low | 5.3 | **The 409 branch says "quiet refetch" twice:** "→ quiet refetch, then form closes, …, focus to heading, quiet refetch, refetch-failure variant". It could be read as two refetches. The spec has one (L169). | Delete the second "quiet refetch". |
| T10 | Low | 4.3 | **Field order isn't stated.** The spec says "in this order" (Name, Prompt, Vote type, Description, L58). It matters because "focus the first failing field in form order" (L93) depends on it. | Add "in spec order" to 4.3. The blank-fields scenario then tests it indirectly. |
| T11 | Low | 0.2 | **A human-only action is an apply-phase checkbox.** "Confirm with the team lead that handoffs are filed" can't be completed by an agent, and it duplicates H2 in the pre-ship list. An apply agent may block on it or tick it falsely. | Reword it as "Check `proposal.md` for recorded issue numbers. If they are absent, note it in the PR description and continue." Leave the filing itself in Pre-ship. |

---

## 2. Traceability: proposal capability → tasks

| Proposal capability | Tasks | Status |
|---|---|---|
| Inline add form: gating, placement, fields, copy | 4.1–4.4 | Covered (T6, T10) |
| Client validation; `422` field mapping | 5.1, 5.3, 5.4 | Covered (T5a) |
| Duplicate check (exact, archived-first, override persistence) | 5.2, 5.4 | Covered |
| Submit outcomes (201, 201+refetch fail, 403/404, 409, network/5xx) | 5.3, 5.4 | Covered (T5b–d, T9) |
| One screen message region, roles, lifetime | 5.3, 5.4 | Covered (T8 ordering) |
| Dirty Cancel / Discard / `beforeunload` | 6.1, 6.3 | Covered (T3) |
| Interlocks (3 gating Submit, 5 in-flight, clean editor closes, idle locks nothing) | 6.2, 6.3 | Covered (T4) |
| Quiet refetch after Remove/Restore | 2.1, 2.2 | Covered (T2) |
| "Custom" tag; whitespace description; focusable row `h3` | 3.1, 3.3, 3.4 | Covered |
| "Active Topics (n)" | 3.2, 3.4, 7.4 | Covered |
| Five-row empty state, neutral locked copy, #176 note | 7.1, 7.2, 7.4 | Covered |
| `canAddTopics` on TOPIC-002 (temporary, #176, not `canEditAnnotations`) | 1.2, 1.3, 1.4, 8.2 | Covered |
| Shared types `AddCustomTopicRequest/Response` | 1.1 | Covered |
| Screen does not read `defaultTopicsNotActive` | 7.3, 7.4 | Covered |
| Extraction (`addCustomTopic.ts`, `AddCustomTopicForm.tsx`, `ActiveTopicsEmptyState`); `key={teamId}` | 4.1, 7.1, 2.1 | Covered |
| Use-case and REST-contract doc notes | 8.1, 8.2 | Covered |
| "No copy implies in-session display" | 9.2 | **Contradicted as written (T1)** |
| Human items (H2, H3, copy review, #175, #176, scope hold) | Pre-ship list | Recorded, not tasked (correct) |

## 3. Traceability: ADDED requirement → tasks

| Requirement (spec) | Impl | Test | Scenarios covered | Gaps |
|---|---|---|---|---|
| Lock spec: `canAddTopics` flag | 1.2 | 1.3, 1.4 | 4/4 | none |
| Add control gating, no teaser | 4.2 | 4.4 | 3/3 | T6 (admin "no explanation") |
| Heading count, trigger placement, inline open | 3.2, 4.2, 2.1 | 3.4, 4.4, 2.2 | 6/6 | T6 (trigger hidden), T7 |
| Form fields and copy | 4.3 | 4.4, 9.3 | 4/4 | T10, T1 |
| Client validation and `422` mapping | 5.1, 5.3 | 5.4 | 3/3 | T5a |
| Duplicate check | 5.2 | 5.4 | 8/8 | none |
| Submit outcomes | 5.3 | 5.4 | 15/15 | T5b–d |
| Screen message region | 5.3 | 5.4 | 2/2 | T8 (order) |
| Discard / `beforeunload` | 6.1 | 6.3 | 3/3 | T3 |
| Interlocks | 6.2 | 6.3 | 11/11 | T4 |
| Remove/Restore quiet refetch | 2.1 | 2.2 | 4/4 nominally | **T2** (add-form survival not asserted) |
| Custom tag | 3.1, 3.3 | 3.4 | 4/4 | none |
| Empty state decision table | 7.1, 7.2 | 7.4 | 7/7 | none |
| Does not read `defaultTopicsNotActive` | 7.3 | 7.4 | 1/1 | none |

---

## 4. Verdict

**Approve with targeted edits.** T1 must be fixed before apply, because it is the one place where following the task would damage approved copy. T2–T5 are tests for behaviour the spec already states, so they add no scope (Rachel's condition 4 holds). T6–T11 are wording and ordering fixes that can be made in the same pass.
