# Tasks review: Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Artifact:** `tasks.md` (read with `proposal.md` and `design.md`)
**Focus:** whether the task order respects architectural dependencies, so that no task assumes something not yet built
**Verdict:** **Approve with conditions.** The large-scale order is right. Six tasks depend on work that comes later in the list, and two tasks are too big to verify on their own. All of the fixes are reorders or splits. None changes scope.

---

## 1. What the ordering gets right

- **Contract before consumers.** Section 1 (shared types, `canAddTopics`, parity test) comes before any frontend task that reads the flag. The fixture updates are in the same task as the type change (1.2), so `typecheck` stays green between tasks. The server stays authoritative, and the flag stays presentation-only.
- **Quiet refetch (section 2) comes before the add form (sections 4–6).** This is the dependency that matters most. Decision 2's loose dirty-form policy is safe only once no post-write refetch can unmount the screen. Building the form before the hole is closed would mean a window where the loose policy is unsafe. The order prevents that.
- **Row headings and ids (3.1) come before every focus move that targets them** (5.2, 5.3, 7.2).
- **The parity test (1.4) sits with the flag it guards**, not in the verification section. That is the right place for a drift control.
- **The human items are kept out of the apply checklist.** One exception is task 0.2 (see C6).

---

## 2. Forward dependencies (must fix)

### C1. The screen message region is built in 5.3 but used in 2.1
Task 2.1 sends the Remove/Restore refetch-failure alerts to "the screen message region (task 5.3)". As written, the implementer has two bad options: build the region early, outside its own task, or put in a temporary sink and rework it later.

**Fix:** add a new task **2.0, "Screen message region"**: one region under the Active Topics heading, `role="status"`/`role="alert"`, newest message wins, and one `clearScreenMessage()` helper called from the four existing handlers (`moveTopic`, `startRemove`, `startRestore`, `openAnnotationEditor`). Give it its own tests, one per existing clearing event. Task 4.2 then adds "opening the add form" as the fifth clearing event, and 5.3 keeps only the POST handler and its outcomes.

### C2. Task 2.2 tests an add form that doesn't exist yet
"One that a team change discards an open add form" can't be written until section 4. The `key={teamId}` reset is real in 2.1, but the add form isn't.

**Fix:** in 2.2, test the reset with state that already exists. A dirty reorder draft or an open definition editor should not survive a `teamId` change. Move the add-form variant to 6.3, where the spec scenario for it can be checked.

### C3. The empty-state entry point is used in 4.2 and 4.4 but built in 7.1
Task 4.2 says "Opened from the empty state, the form takes the place of the empty-state actions", and 4.4 tests "focus on clean Cancel … from the empty state, including message-above-form placement". `ActiveTopicsEmptyState` is created in 7.1. The 5.4 scenario "Added '<name>'." (the only-active-topic variant) has the same problem: it is reached by opening the form from the empty state.

**Fix:** keep 4.2 and 4.4 to the heading trigger. Move these items to section 7:
- the empty-state "Add custom topic" wiring
- placement under the message
- return of focus to the empty-state control
- the empty-state "Added '<name>'." scenario

The form-state union can still record "opened from: heading | empty state" in 4.1, because the union's shape belongs there. Alternatively, move section 7 ahead of section 4 with the "Add custom topic" action left unwired, and wire it in 4.2. Either works; pick one and state it.

### C4. The "add submitting" interlock comes after the submit handler that needs it
Task 5.3 sends the POST and keeps "submitting" open until the refetch settles. Task 5.4 tests "moves locked until the post-`201` refetch settles". The code that disables moves, Save order, Remove, Restore, and definition edit while an add is in flight is in 6.2. So the 5.4 test can't pass at the end of section 5. Worse, for the span of section 5 the handler has exactly the hazard Decision 3 exists to prevent: a draft built from the old saved order during the refetch.

**Fix:** split 6.2.
- **6.2a (move into section 5, before 5.3):** "add submitting" disables the other controls with `ADD_TOPIC_SUBMITTING_REASON`. This covers the precedence rule, the single `add-submitting-reason` line, suppressing the other reasons, and closing a clean definition editor when the request is sent.
- **6.2b (stays in section 6):** other busy states gate Submit and the "Add anyway" actions, with the existing reason strings in order.

The rule: the interlock that protects a write lands in the same task as the write, or in the task before it.

### C5. The `fetchAllTopics()` request counter (2.1) needs a return contract the design doesn't define
This one is about an unstated decision, not order. Today `fetchAllTopics()` returns `GetAllTopicsResponse | null`, and every caller treats `null` as "refresh failed". If the counter in 2.1 drops a superseded response by returning `null`, then:
- an older Remove/Restore/add refetch that loses to a newer one shows a false "couldn't be refreshed. Reload the page" alert;
- after a `201` whose refetch was superseded, the screen shows the refetch-failure variant even though the newer refetch brought the topic in.

**Fix:** task 2.1 must say what a superseded call returns, as a value separate from failure (for example `{ status: "ok" | "failed" | "superseded" }`, or apply-inside-helper with a returned outcome). It must also say what each caller does with "superseded": close its dialog or leave "submitting", and show no failure message. Add one test to 2.2 where a superseded refetch shows no failure alert. Every existing quiet-refetch caller (stale-order reload, `refetchAfterAnnotationFailure`) inherits this, so it has to be decided once, in 2.1, before section 5 builds on it.

### C6. Task 0.2 is a human gate inside the apply checklist
"Confirm with the team lead that the handoffs are filed" is a human action that agents are explicitly told not to perform. As a checkbox at the top of the apply list, it either blocks the apply phase forever or gets ticked by an agent that cannot honestly tick it.

**Fix:** move 0.2 to "Pre-ship (human items)", where H2 already says the same thing. Task 8.1's "cite the handoff path or its issue number" already handles either state.

---

## 3. Tasks to split (verifiability)

### S1. Task 5.3 is three tasks
As written, 5.3 covers the region, the handler shape, the 201 path, 201 plus refetch failure, 403/404, 422 mapping, 409 with its refetch and refetch-failure variant, and network/5xx with a refetch. That is the single largest piece of new behaviour in the change, and it would land as one unverifiable diff. After C1 moves the region out, split the rest:
- **5.3a** Handler skeleton: `try/catch` wraps `fetch()` only, the post-`201` "always ends in Added …" rule, envelope parsing with `.json().catch(() => null)`, and the "Adding…" / read-only phase.
- **5.3b** The success paths: `201`, then `201` + refetch failure, focus by `topicId` with the heading as fallback.
- **5.3c** The failure paths: 403/404, 422 field mapping, 409 with refetch, network/5xx with refetch, Submit re-enabled.

Split 5.4's test list along the same lines, so each sub-task finishes green.

### S2. Generalising `pendingFocusId` (in 4.2) should be its own refactor before the form
The current mechanism (`pendingFocus` + `moveButtonRefs` + `FOCUS_FALLBACKS`, ~L462/L720) finds move buttons through a ref map and walks a fallback list that skips disabled buttons. Move buttons have no element ids. "One `pendingFocusId` resolved with `document.getElementById`" therefore needs either ids on move buttons plus a fallback list of ids, or two mechanisms (the outcome Decision 8 rejects). That is a refactor of shipped reorder behaviour, so it should land alone, in section 3 next to the h3 ids, with the existing reorder focus tests as its regression net. It doesn't belong in a task about trigger placement.

---

## 4. Smaller order and completeness gaps

- **1.1: shared barrel export.** `packages/shared/src/index.ts` uses a named export list. `AddCustomTopicRequest` and `AddCustomTopicResponse` must be added there, or 1.1's backend handler typing and 4.1's frontend imports won't resolve. Name it in 1.1.
- **1.2: one fixture file is missing.** `backend/src/routes/__tests__/topic-annotation-integration.test.ts` reads the TOPIC-002 response. It probably isn't a typed fixture, but it should be named or explicitly cleared.
- **1.4: a better home for the parity test.** It calls two routers (`content.ts`, `topics.ts`). A small cross-route test file is the more honest location than `content.test.ts`. Its successful POST rows also create topics on the shared team. That's harmless, but say so in a comment so a later uniqueness check doesn't make the test fail for an unclear reason.
- **2.1: `key={teamId}` needs a wrapper.** `App.tsx` renders `<TopicManagementPage />` inside a `<Route element>` and has no `teamId` in scope. The one-line fix is really a small route wrapper that reads `useParams`. Name it and say where its test goes (`App.test.tsx` or the page suite).
- **3.1 / 3.2: changing headings can break existing queries.** Making row titles `<h3>` and changing the Active heading's text alters the accessible tree that the reorder and annotation suites query. I found no existing query by heading name. Still, 3.4 should say "existing suites pass, with any heading-role queries updated", not leave it implied.
- **4.2: Active-heading focusability belongs earlier.** `tabIndex={-1}` on the Active Topics heading is a prerequisite of the outcome focus moves, not of the trigger. Folding it into 3.2, which edits that heading anyway, keeps section 3 as "page structure" and section 4 as "form".
- **7.2: shared expand-and-focus helper.** 5.2 ("Show it in Archived topics") and 7.2 ("Show archived topics (n)") both set `showArchived` and queue focus. Whichever is built first should create a small `expandArchivedAndFocus(targetId)` helper, and the second reuses it. Otherwise the two diverge.

---

## 5. Suggested order

```
0.1                       validate
1.1 → 1.2 → 1.3 → 1.4     contract, flag, parity
2.0 (new)                 screen message region + clearScreenMessage (existing 4 events)
2.1 → 2.2                 quiet refetch, superseded-vs-failed contract (C5), key={teamId} wrapper
3.1 → 3.1b (new)          h3 ids → pendingFocusId refactor (S2)
3.2 → 3.3 → 3.4           heading count + focusable heading, descriptions, tests
4.1 → 4.2 → 4.3 → 4.4     pure logic, heading trigger only (C3), fields
6.1                       dirty / discard / beforeunload
5.1 → 5.2                 validation, duplicate check
6.2a (moved)              add-submitting disables others (C4)
5.3a → 5.3b → 5.3c → 5.4  handler, success, failures (S1)
6.2b → 6.3                Submit gated by others; interlock tests
7.1 → 7.2 → 7.3 → 7.4     empty state, incl. empty-state form entry (C3)
8.x, 9.x                  docs, verification
```

Putting 6.1 before 5.x is optional. It removes nothing, but it means the discard and `beforeunload` path exists before the first real submission.

---

## 6. Out of my lane, noted only

The server stays the enforcement point throughout: TOPIC-003's 403/409 checks are unchanged, and the flag fails closed. I have no access-control objection to the order. The deferred shared `canAddCustomTopic` predicate is acceptable given the parity test. It should be a stated deliverable of the #176 fix, not a hope.

---

## Summary

- The large-scale order is sound: the contract and flag come first, the quiet refetch comes before the loose-policy form, and the row ids come before the focus moves.
- **C1:** the screen message region is used in 2.1 but built in 5.3. Move it to a new task 2.0.
- **C2/C3:** 2.2 and 4.2/4.4/5.4 rely on the add form or the empty state before they exist. Move those parts to 6.3 and section 7.
- **C4:** the "add submitting" interlock (6.2) comes after the handler it protects (5.3). Split 6.2 and land its first half before 5.3.
- **C5:** the 2.1 refetch counter needs a "superseded" result separate from "failed", or callers show false reload alerts.
- **C6:** task 0.2 is a human gate. Move it to pre-ship.
- **S1/S2:** split 5.3 into three tasks, and split the `pendingFocusId` refactor out of 4.2 into section 3.
- **Minor:** shared `index.ts` export, the route wrapper `key={teamId}` needs, a home for the cross-route parity test, and heading-query regressions.
