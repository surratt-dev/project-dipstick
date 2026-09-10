# Task Ordering Review — `websocket-staleness-signal`

Reviewer: Ingrid Sollenberger (Solution Architect). Scope of this pass: does `tasks.md`'s ordering respect architectural dependencies — does any task assume something not yet built, and are the new Group 0 and tasks 1.14/1.15 correctly sequenced. I have not reviewed copy, visual design, or ritual/domain content; that is out of scope for me by design.

## 1. Group 0 sequencing — correct, one wording nit

Group 0 → Group 1 is the right shape: no dependencies on Group 0's side, and Group 1's header correctly declares the reverse dependency. Task 1.10's fallback-code import and the exception 1.9's grep must allow both genuinely require `0.1`'s relocation to exist first, so blocking Group 1 on Group 0 is necessary and sufficient.

**Nit, non-blocking:** Group 1's dependency blurb calls out only tasks 1.9 and 1.10 as needing the relocated constants. Tasks 1.4, 1.11, 1.12, and 1.14 also reference `STALE_SIGNAL_CLOSE_CODE` / `REAUTH_GRACE_EXPIRED_CLOSE_CODE` directly and equally depend on them being importable shared symbols. This doesn't change the actual sequencing (the whole group is already gated on Group 0), but the blurb undersells how pervasive the dependency is. Suggest widening the callout to "tasks 1.4, 1.9, 1.10, 1.11, 1.12, and 1.14 all reference these as importable shared symbols" so a future editor doesn't assume the other tasks are exempt.

**Separate observation, not a defect:** task 1.9's grep is written and presumably first passes *before* task 1.10 exists — at that point there is no close-code comparison in the file at all, so the "exactly one named exception is allowed" branch of the rule is vacuously true rather than actually exercised. This resolves itself because task 7.1 explicitly re-runs the same grep as a final-sweep check, by which point 1.10's exception exists to validate against. I don't think this needs a task change, but flagging it so it's understood as intentional (a standing regression test added early, meaningfully validated late) rather than an ordering mistake.

## 2. Missing implementation task for D1c's sticky-state guards — sequencing gap ahead of 1.14/1.15

This is my main finding. Tasks 1.14 and 1.15 are *test-only* tasks for Decision D1c's guard mechanism:

- 1.14 asserts a `reauth_required` message followed by a `STALE_SIGNAL_CLOSE_CODE` close does not revert `state` away from `reauth-required`.
- 1.15 asserts a pending retry timer from a prior `unknown-reconnecting` episode is synchronously cancelled the instant `reauth-required` is entered, and never fires `connect()` afterward.

But nothing in tasks 1.1–1.13 commits to *building* the mechanism these tests exercise. Task 1.10 (the only task that implements `reauth-required` detection) only describes recognizing the signal, bypassing the timing floor, and not calling `computeRetryDelay`/entering the retry loop. It says nothing about:

- an entry guard that checks `state === "reauth-required"` first, before any other close/error branching (closes Race A),
- synchronously clearing any pending retry `setTimeout` on transition into `reauth-required` (closes Race B),
- never calling `connect()` again once this state is entered.

Compare this to how the other design-review-driven decisions were incorporated: D1d, D1e, D1f, and D1g (tasks 1.1b, 1.1c, 1.1a, 1.1d) each pair the *implementation* requirement with its test in one task description. D1c is the odd one out — design.md's own D1c section states the decision and the mechanism in full, but tasks.md never converts "the decision" into "the implementation task," only into "the test task." As written, an implementer could pass 1.10 without building any of D1c's guards, then hit 1.14/1.15 as the first place the gap surfaces — which is late enough that it risks being treated as a bug-fix afterthought rather than a named part of the design it actually is.

**Suggested fix:** add an explicit implementation task, e.g. `1.10a`, immediately after 1.10 and before 1.11, mirroring the 1.1a–1.1d pattern:

> `1.10a` **Sticky-state guard implementation (design.md Decision D1c):** on transition into `reauth-required` (via either signal), synchronously clear any pending retry `setTimeout` before it can fire. In the close/error handler, check `state === "reauth-required"` first and return immediately for any subsequent close/error of any code — including the socket's own expected 4001 close arriving after the message already transitioned state. No `connect()` call is made by this hook instance once `reauth-required` is entered.

Then 1.14/1.15 correctly become "test task for 1.10a," the same relationship 1.6/1.6a have to 1.5. This also gives Group 7's task 7.2 hard gate something concrete to point back to when it lists 1.14/1.15 as disclosure-boundary tests.

## 3. Group 2's stated dependency is incomplete — task 2.1 actually needs Groups 3 and 4

Group 2's header reads "Depends on: Group 1," and Group 2 is sequenced immediately after Group 1, ahead of Groups 3 and 4. But task 2.1 reads:

> "Confirm (code review, checked explicitly, not assumed) that `ConnectionStatusBanner.tsx` (Group 3) and the grid-marker treatment (Group 4) both import `useConnectionHealth` directly..."

This cannot be confirmed until `ConnectionStatusBanner.tsx` and the grid-marker component actually exist — i.e., until Groups 3 and 4 are done. As written, an implementer following the stated dependency graph could reasonably attempt Group 2 right after Group 1 and find task 2.1 unactionable.

Task 2.2 (the PR-description note pointing issues #33/#32 at the module) has no such dependency — it only needs Group 1's module to exist and can be written any time after.

**Suggested fix:** either (a) change Group 2's header to "Depends on: Group 1 (task 2.2); Groups 1, 3, 4 (task 2.1)" and move 2.1 to after Group 4 in document order, or (b) split 2.1 out into Group 4's own closing task list (it's really a Group-4/Group-3 cross-check) and leave 2.2 as the sole remaining Group 2 task, executable right after Group 1. Either resolves the mismatch between the stated single-group dependency and the task's actual prerequisites.

## 4. Group 4's row-fixture needs appear to precede Group 5, which is declared to come after Group 4

This is the one I'd want engineering to confirm explicitly rather than assume away.

Proposal.md and design.md are both explicit that **no readiness-grid rendering surface exists yet in the frontend** — "readiness grid" is currently a backend-only concept (`vote_readiness_update`, `evaluateSessionSubscriberAccess`). The only place tasks.md introduces an actual multi-row rendering surface for the frontend to test against is task 5.2: "wiring the same hook and the grid-marker treatment to a **stub participant-row list**."

But several Group 4 tests assume exactly that kind of multi-row surface already exists, and Group 4 is declared to depend only on Group 1:

- 4.2 / 4.2a reason about "the grid's existing four states" and a specific row's composed rendering (`disconnected_voted` + marker together).
- 4.6 asserts "existing per-row content (locked-in counts, per-row states) remains at its last-known values" during a frozen mid-vote row — this requires a fixture with rows that have locked-in counts and per-row state to begin with.
- 4.10 asserts facilitator-level `reauth-required` supersedes "the grid," again implying a grid of rows to supersede.

If these tests are meant to run against the same "stub participant-row list" task 5.2 builds, then Group 4 has an undeclared dependency on part of Group 5 — and Group 5's own header ("Depends on: Groups 3, 4") would make that circular: 5.2 can't be built until 4.x is "done," but 4.2/4.2a/4.6/4.10 can't be verified until something like 5.2 exists.

The more likely intended reading — consistent with 1.1a's precedent of building a small, hand-rolled, test-only double before the tests that need it — is that Group 4 is expected to construct its **own** minimal, unit-test-local row fixture (independent of task 5.2's host-level stub, which exists to exercise the real dev-server/E2E path per D9, not to unit-test the marker component). If that's correct, tasks.md should say so explicitly, the same way it named 1.1a as a prerequisite fixture task before 1.4 and friends. Right now this is implicit, and "stub participant-row list" appearing in both contexts (implicitly needed by 4.x, explicitly built in 5.2) invites exactly the kind of quiet conflation this change's own design philosophy (explicit over implicit) argues against.

**Suggested fix:** add an explicit fixture task, e.g. `4.0a`, before 4.2: "Build a minimal, test-local four-state row fixture (`connected+not-locked-in`, `connected+locked-in`, `disconnected_voted`, `disconnected_no_vote`) with per-row content (locked-in counts) sufficient for tasks 4.2, 4.2a, 4.4–4.6, 4.10 — independent of task 5.2's host-level stub, which serves dev-server/E2E verification, not unit testing." This closes the apparent inversion and matches the precedent already set by 1.1a.

## 5. Open question, not a defect: no task captures applying 6.2's final visual styling

Task 4.7 gates: "do not ship final visual styling ahead of task 6.2's mock sign-off," and 6.2 gates the sign-off itself. I don't see a task anywhere in Groups 4–7 that captures the follow-up work of *actually applying* the final visual register once 6.2 closes — 4.7 only says implementation may proceed with placeholder styling until then, not what happens after. This may be intentionally left as a small follow-up not worth a numbered task, or it may be a gap. Worth a quick confirmation from whoever owns closing out Group 6 so it isn't lost between "gate closed" and "shipped."

## Summary of suggested changes, in priority order

1. **(Most actionable)** Insert `1.10a` implementing D1c's sticky-state guards (entry check, synchronous timer clear, no further `connect()`), positioned between 1.10 and 1.11, so 1.14/1.15 have a corresponding implementation task rather than testing unbuilt behavior.
2. Correct Group 2's dependency header and/or resequence task 2.1 to after Group 4 (or fold it into Group 4's closing checks); leave 2.2 where it is or move it independently.
3. Confirm whether Group 4's composition/freeze/supersession tests (4.2, 4.2a, 4.6, 4.10) rely on task 5.2's stub row list (in which case Group 4's dependency header is incomplete and there's a real inversion against Group 5) or need their own local fixture (in which case add an explicit `4.0a` fixture task, mirroring 1.1a).
4. Minor wording fix to Group 1's dependency blurb to list all tasks that reference the Group-0 constants, not just 1.9/1.10.
5. Confirm whether a follow-up task for applying 6.2's final visual styling is intentionally omitted or should be added.
