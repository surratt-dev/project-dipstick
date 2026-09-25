# Task Ordering & Coverage Review — Solution Architect (Ingrid Sollenberger)

Scope of this review: task **ordering** (does any task assume something not yet built?) and task **coverage** (is anything decided in design.md left without a corresponding task?). I am not re-litigating D1–D7 or the wrap_up/D7-scope calls — those are settled. This is a dependency-graph read of `tasks.md` as currently sequenced.

## Verdict

The ordering is sound at the section level: no task in sections 2–6 assumes work from a later section. One real coverage gap found in section 5 (existing tests, not new ones), plus two minor sequencing suggestions that are not blocking. Details below.

## Section 5 — helper before call sites before tests: order is correct

5.1 (helper) → 5.2/5.3 (call sites) → 5.4/5.5/5.6 (tests) is the right dependency order — you cannot route a call site through a helper that doesn't exist yet, and a route-level test (5.5/5.6) needs the call site it's exercising (5.2/5.3) to already call the helper, or it isn't testing what it claims to. This is implementation-then-test rather than TDD ordering, but that's a process style choice, not a dependency violation — nothing here is architecturally out of order.

5.2 and 5.3 are correctly independent of each other (both depend only on 5.1, not on each other), so their relative order doesn't matter and isn't a problem.

**No hidden dependency on frontend work (sections 1–4) found.** I traced this specifically because it was flagged as a risk to check:
- Section 2's Start Session control calls `POST /api/v1/sessions/:sessionId/start`, an endpoint untouched by this change (pre-existing, shipped by `pre-session-action-item-review`).
- Section 3's navigate link routes to `/session/:sessionId`, a client-side route rendered by `SessionLobbyPage` — also pre-existing and untouched by this change's frontend work.
- Section 5 is entirely about the *join-link redemption redirect* (`GET /api/join/:token` and `executeJoinFlow`), a different code path from both of the above.

Sections 2–4 and section 5 are genuinely parallelizable; the document's ordering (frontend sections before the backend section) reflects no real dependency, so it's a fine ordering to keep as-is but not one that needs enforcing.

## Coverage gap: existing tests that encode the old single-status query

I checked the current test files, not just the new task list. Both `packages/backend/src/routes/__tests__/join-links.test.ts` (lines 369–438) and `packages/backend/src/routes/__tests__/auth.test.ts` (`executeJoinFlow` tests around lines 1211–1280) contain **pre-existing** tests that mock the current `status = 'active'` query directly — e.g. `join-links.test.ts`'s `"should join team and redirect when authenticated"` (line 369) mocks a third query call returning `{ rows: [] }` ("no active session") and asserts a `/team/team-1` redirect, and `"should redirect to active session if one exists"` (line 411) mocks that same call returning `{ rows: [{ id: "session-abc" }] }`.

Once 5.1's shared helper replaces the `status = 'active'` check with the seven-status bucket logic (D4), the query shape these mocks encode will very likely change (at minimum, it needs to select `status`, not just `id`, to bucket correctly). That means these **pre-existing** tests are load-bearing on the old query shape and will need to be updated to keep passing — not just have new cases added alongside them.

Tasks 5.4–5.6 as written only describe *new* coverage (unit-test the helper; route-level test for a `lobby`/`pre_session` case). Nothing in section 5 explicitly assigns "update the existing mocks/assertions in `join-links.test.ts` and `auth.test.ts` that assume the old query shape." Task 6.3 ("run the full test suite, confirm no regression") will *catch* this as a failure, but catching a failure during verification is not the same as it being covered by an implementation task — as written, whoever picks up section 5 could reasonably interpret 5.2/5.3 as "only touch these two lines" and be surprised in 6.3 when unrelated-looking tests in the same files break.

**Recommendation:** fold "update the existing tests in `join-links.test.ts` (~line 369, ~line 411) and `auth.test.ts` (~lines 1211–1280) whose mocks assume the single `status = 'active'` query shape" explicitly into 5.2/5.3 (or as an explicit 5.2a/5.3a), rather than leaving it implicit in 6.3's regression check. This is a coverage note, not a reordering — it doesn't change section 5's sequencing, just closes a gap where "replace the call site" could be read as excluding its own file's existing test suite.

## Task 6.4 — sequencing is correct

6.4 (the first-time-joiner end-to-end trace) depends on section 5 being implemented: before the routing fix, a `lobby`/`pre_session` join wouldn't even redirect to `/session/:sessionId` (it would redirect to `/team/:teamId` under the current `active`-only rule), so there'd be nothing meaningful to trace yet. Placing 6.4 in section 6, after section 5, is correct.

6.4 does **not** depend on sections 2–4 (the `DraftSessionHost` Start Session control and navigate link) — the `lobby`/`pre_session` session it needs can already be produced today via the pre-existing "Open the room" flow (`draft → lobby`, shipped by `session-creation-existing-team`), so 6.4 isn't blocked on this change's own frontend work. Nor does 6.4 block 2–4 in the other direction — it's a read-only trace against the database/WebSocket, not a fix, so nothing downstream depends on its outcome except the *decision* of whether to file/adjust the D7 follow-up.

6.4's relative position after 6.1–6.3 is not a hard dependency (it doesn't need 6.1's manual facilitator walk or 6.2/6.3 to have run first), so it could run in parallel with them if useful for scheduling, but there's no correctness reason it must move earlier. No change needed.

## Minor, non-blocking suggestions

- Consider running 6.3 (automated test suites) before 6.1/6.2 (manual walkthroughs) rather than after — catching a regression via the suite is cheaper than discovering it manually. This is a scheduling preference, not a dependency fix; I'm noting it, not requiring it.
- Section 5's tests (5.4–5.6) are listed after both call-site changes (5.2, 5.3) rather than interleaved (helper → unit test → call site 1 → route test 1 → call site 2 → route test 2). Both orderings are valid; the current one just means a broken call site isn't caught until all of 5.2–5.6 are done rather than immediately after each site. Not a defect, just worth knowing if whoever implements this wants tighter feedback loops.

## Summary

- Section 5 internal ordering: correct.
- No hidden dependency between sections 1–4 and section 5 in either direction: confirmed.
- Task 6.4 sequencing: correct, and correctly scoped as read-only/non-blocking relative to 2–4.
- One real coverage gap: sections 5.2/5.3 (or a new subtask) should explicitly own updating the pre-existing tests in `join-links.test.ts` and `auth.test.ts` that encode the old single-status query shape, rather than leaving that discovery to 6.3's regression run.
