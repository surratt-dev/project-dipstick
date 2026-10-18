## Context

The Topic Management screen keeps a local reorder draft: `draftOrder: string[] | null` (null means clean), derived against `savedOrder` computed from `data.active` only (`TopicManagementPage.tsx`, `savedOrder` memo). `moveTopic` applies a pure helper from `topicOrder.ts`, stores `null` when the result equals the saved order, clears confirmation and error, sets the announcement and queues focus. Save PUTs `{ orderedTopicIds: draftOrder }`. No backend change is needed. Frontend runtime deps today: react, react-dom, react-router-dom, the shared package; all styling is inline.

## Goals / Non-Goals

**Goals:** drag a topic by a handle to a new position; identical draft semantics to the buttons; buttons untouched.
**Non-Goals:** see proposal Out of scope.

## Decisions

### Decision 1: Hand-built Pointer Events, no new dependency

**Native HTML5 drag-and-drop is excluded** as the only mechanism (no touch in most mobile browsers, no keyboard story). That also rules out libraries built on it as unverified for immediate-touch drag.

**Candidates, measured 2026-10-17** (npm registry metadata; `npm audit` on a scratch install; esbuild minified + gzip -9 of a bundle importing the main drag/sortable entry points, react external). These are spike numbers from a throwaway project, not the real app build, and tree-shaking in the real app may differ. Treat sizes as approximate.

| Candidate | License | Last release | gzip (approx) | Verdict |
|---|---|---|---|---|
| `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0 | MIT | 2024-12-05 | ~16 kB | Under 20 kB but **last release about 22 months ago; fails the 12-month rule** |
| `@hello-pangea/dnd` 18.0.1 | Apache-2.0 | 2025-02-09 | ~33 kB | **Fails 12-month rule and the 20 kB ceiling**; pulls redux, react-redux |
| `@dnd-kit/react` 0.5.1 | MIT | 2026-10-15 | ~39 kB | **Over the 20 kB ceiling**; pre-1.0 API |
| `@atlaskit/pragmatic-drag-and-drop` 4.0.0 (+ auto-scroll) | Apache-2.0 | 2026-09-24 | ~10 kB | License, recency and size pass. **Built on native HTML5 DnD**, so immediate touch drag from a handle and our Escape/no-live-preview semantics are unverified. Not tested on a device. |

`npm audit` reported zero advisories for the scratch install at measurement time. Maintenance health beyond release dates (issue responsiveness, bus factor) is **unverified**. Real-device behavior of every candidate is **unverified**.

**Decision: hand-built.** No candidate meets all constraints with a verified touch story, and the one that comes closest (Pragmatic, ~10 kB) leans on the mechanism we ruled out as sole path. With touch and auto-scroll out of this release (Decision 8), the owned surface is small: pointerdown on the handle (primary button only), a drag threshold (`DRAG_THRESHOLD_PX`), pointermove hit-testing against row midpoints, `touch-action: none` on the handle only, and cancel on Escape, `pointercancel` (including lost capture), window blur, release outside the list, and the mid-drag transitions below.

**Effort and fallback (Rachel's request).** Estimate, revised after engineering review: the hook is on the order of 200 to 250 lines (pointer capture, per-move measurement, cleanup, self hit-test and drop validation are in scope), with the pure hit-test functions in `topicOrder.ts` (no separate module), plus about 200 lines of tests; the shared-path refactor is about 30 lines. Budget two to three engineer-days including the laptop check and review, against buttons-only as the status quo (which costs nothing and works). The earlier "about 150 lines" figure is withdrawn and must not anchor the overrun rule, which is stated in days, not lines: if the work passes four days, or any cancel case beyond the listed set turns out to be needed, stop. Land the shared-path refactor (tasks sections 0 and 1, which are safe on their own), leave drag unshipped, and note it on #181. Do not respond to an overrun by adding scope or by adopting a library without reopening this decision; Pragmatic is the first library to spike, and dnd-kit needs my sign-off on the 12-month rule. If Decision 1 is reopened, any dependency must also enter the lockfile (pinned) and the project's automated advisory scan; a point-in-time `npm audit` is not sufficient (security review S-6). The maintenance burden is the honest cost: the team owns the pointer code. I accept that for a single flat list and would not accept it if touch and auto-scroll were added on top, which is a second reason they are out.

**Module split.** Two files, so the tests have a clean target:

- Pure, in `topicOrder.ts` (numbers and arrays only, no DOM): `computeDropSlot(rects, y)`, `slotToFinalIndex(from, slot)`, `moveToIndex(items, from, to)`.
- `useTopicDrag` in its own file: owns pointer state, listeners and measurement, and reports `onDrop(topicId, slot, rowCount)` or `onCancel(topicId)` (every cancel except unmount, including `enabled` going false and an imperative `cancel()`), and exposes `draggedTopicId`, `dropSlot`, `isDragging`, `containerRef`, `registerRow` and `getHandleProps` (interface fixed in tasks 2.2). It has no live region, no focus handling and no keyboard sensor. The page's existing rules own those.

**Pointer model (the listener contract; not left to the implementer).**

- Pointerdown on the handle, primary button only. The hook calls `setPointerCapture(pointerId)` on the handle inside try/catch; if it throws (`InvalidStateError`, or the method is absent) the drag does not start and nothing changes. The active `pointerId` is stored; events from any other pointer are ignored.
- `pointermove`, `pointerup`, `pointercancel` and `lostpointercapture` are handled on the capturing element. `keydown` (Escape), window `blur`, `contextmenu` and a window/document `scroll` listener are attached only while a drag is active ("pending" counts as active for cleanup) and removed on every exit path.
- A right click or context menu while dragging cancels the drag.
- While a drag is active the list gets `user-select: none` (mouse drags otherwise select text across rows; `touch-action: none` does not prevent that). It is removed on every exit path.
- Drop-line state (`dropSlot`) lives in the hook, not the page, and is set only when the slot value changes, so a `pointermove` does not re-render the 2,100-line page.
- **Measurement.** Row rects are measured with `getBoundingClientRect()` on every `pointermove`, on `scroll`, and again at `pointerup`. Rows are tall and variable-height (definition text, inline editor, Remove confirmation, escalation and alert blocks), and layout can change mid-drag without closing the gate (a rate-limit message, the "Saved." status). Per-move measurement is cheap for 25 rows and is the simplest correct choice. The slot committed on drop is computed from fresh rects at `pointerup`, never from the last drop line shown.
- **Release outside the list.** With pointer capture, `pointerup` fires on the handle wherever the pointer is, so the hook tests the final coordinates against the list container's rect itself. Outside the rect cancels; over the archived section, the Save bar or any non-list target also cancels and never drops at the nearest end.
- **Unmount.** If the page unmounts mid-drag (route change, the `key={teamId}` remount, anything else), the hook's effect cleanup removes every listener, releases capture and clears `user-select`, and calls neither `onDrop` nor `onCancel`. Unmount is part of the cancel set.

### Decision 2: One draft path, and one meaning for the drop index

**Index semantics (settled).** Two quantities exist and they are not interchangeable:

- the **slot** `k`, 0..N: the gap in which the line is shown, counted with the dragged row still in the list (slot 0 is above the first row, slot N is below the last). This is what the hit-test produces and what the hook reports.
- the **final index** `to`, 0..N-1: where the topic sits after removal and re-insertion. This is what `moveTo(items, from, to)` takes.

The hook always emits the **slot**. `slotToFinalIndex(from, slot)` converts it: `slot > from ? slot - 1 : slot`. Slots `from` and `from + 1` both convert to `from`, which `moveTo` returns as the same array, so adjacent-gap drops are no-ops by identity. `computeDropSlot(rects, y)` returns the number of rows whose vertical midpoint is less than or equal to `y` (a pointer exactly on a midpoint is "below it", matching the spec). It is a pure function over `{top, bottom}` pairs and is exported and tested alone. Required test: table-driven over every `(from, slot)` pair for lists of 2, 3 and 5 items, including both adjacent-gap no-ops and both ends, asserting the resulting order against a hand-written expectation, not against the implementation.

**Shared path.** Add `moveToIndex(items, from, to)` in `topicOrder.ts` over the existing private `moveTo` (returns the input array itself for a no-op). Extract `applyNewOrder(next, topicId, focusIds)` from `moveTopic`; `focusIds` is the ordered focus-target list (`moveTopic` passes the one for the clicked action from `FOCUS_FALLBACKS`, the drop handler passes the `FOCUS_FALLBACKS.up` list), so the button path's focus is reproduced exactly. The announcement is computed inside `applyNewOrder` from `next` and `topicId` with the existing template (engineering review: a third `announcement` parameter would let the two paths diverge; removing it makes divergence impossible by construction). Steps: no-op identity check, `clearScreenMessage`, `closeCleanAnnotationEditor`, clear the saved-definition marker (`setAnnotationSavedTopicId((saved) => saved === topicId ? null : saved)`; keep this), `setDraftOrder(arraysEqual(next, savedOrder) ? null : next)`, clear confirmation and error, reset `saveState` from "error", set announcement, queue focus. `moveTopic` and the drop handler both call it. Position numbers stay `index + 1`. `draftOrder` and displayed numbers are unchanged until drop.

**Drop handler (no stale closures, validated input).** The page computes `next` at drop time from the current `draftOrder ?? savedOrder`, never from a value captured at drag start; the hook holds `onDrop` in a ref (latest-callback pattern) so the callback it calls is the one from the latest render. Before applying, the drop handler validates, and treats any failure as a cancel (no draft change, no announcement, cancel focus path):

1. the dragged `topicId` is present in the current `displayedOrder`;
2. `slot` is an integer with `0 <= slot <= displayedOrder.length`;
3. the number of measured rows equals `displayedOrder.length`;
4. the gate (`dragAllowed`, Decision 4) is still true.

The index comes from DOM geometry and is not trusted. This validation is also the enforcement for refetch-under-drag (see Decision 5), which the proposal had left unspecified.

### Decision 3: Archived-ID index mapping (verified against the code)

The exploration notes worried that `draftOrder` might carry archived IDs. **It does not.** `savedOrder = data.active.map(topicId)`; `displayedTopics` is built from `displayedOrder` by lookup in `data.active`; archived topics render in a separate collapsed section (`archived-topics-heading`) and are never in the list the drop index addresses; Save sends `draftOrder` (active IDs only); and the server does **not** ignore archived IDs: it compares the submitted set to the team's active set, so an archived ID in the payload yields `409 TOPIC_ORDER_STALE` (backend evidence under Decision 9). The earlier draft of this sentence said the server "ignores archived rows"; that was wrong and is corrected here. The client never sends archived IDs. So the drop slot (position among rendered active rows) maps directly to an index into `displayedOrder`, with no translation. Archived rows get no handle and are not drop targets because they are in a different list, so a drop onto them is "outside the list" and cancels. The required test with archived topics present asserts the Save payload contains active IDs only and in the right order.

### Decision 4: Availability gate (settled: parity with the buttons)

The exploration notes said drag is available if and only if the Move controls are enabled, and also that it is disabled while a definition editor or add form is open. In the code these differ: `movesDisabled = isTopicDialogOpen || isSaving || isStale || annotationBusy || addSubmitting`, where `annotationBusy` is only a dirty or saving editor and `addSubmitting` is only an in-flight add. An open clean editor or an open unsubmitted add form does not disable the buttons.

An earlier draft of this proposal made drag strictly narrower than the buttons. That is rejected: it would be a new rule for the page, it contradicts "a second way to produce the same draft", and it forced new reason copy for a transient state. **Settled: drag is available if and only if `reorderEnabled && !movesDisabled`.** Buttons stay exactly as they are. A drop through `applyNewOrder` closes a clean annotation editor exactly as a button move does (that is existing behavior), and a dirty editor already disables both. The locked and under-two cases render no handle at all. When reorder is offered but `movesDisabled`, the handle is rendered dimmed with a not-allowed cursor and no handlers, the same inertness the disabled buttons show, and no new copy is added: each cause has its own on-screen treatment. This resolves the exec's copy-review request by removing the copy.

**Gate placement (settled; engineering review M1).** `TopicManagementPage` returns early for `loading`, `error` and `!data`, and `reorderEnabled` / `movesDisabled` are currently computed after those returns, but `useTopicDrag` and the cancel-on-gate-change effect are hooks and must be called above them. Decision: extract the gate into one pure function, `computeReorderGate({ data, removeState, restoreState, saveState, annotationBusy, addSubmitting })`, returning `{ reorderEnabled, movesDisabled, dragAllowed }` with `dragAllowed = reorderEnabled && !movesDisabled`. It tolerates `data == null` (everything false). The page calls it once, above the early returns (all its inputs, `removeState`, `restoreState`, `saveState`, `annotationBusy`, `addSubmitting`, are already state or memos declared above them), and the existing post-return `reorderEnabled` and `movesDisabled` constants are deleted and replaced by the same values, so there is **one definition** of the gate and the handle styling, the hook's `enabled` parameter and the buttons all read it. The dialog derivations (`dialogState`, `restoreDialogState`) move into the function. Rejected: moving the list into a child component mounted only when `data` exists (cleaner boundary, but a larger diff on a 2,100-line file for no behavioral gain). Required tests: unit tests of `computeReorderGate`, one assertion per cause of `movesDisabled`, and a page test that the handle is inert for each cause, so a later edit to the gate cannot drift from the buttons.

### Decision 5: Mid-drag transitions cancel

An effect watches `dragAllowed`. If a drag is active and it becomes false (page goes stale, a save begins, a Remove or Restore dialog opens, an editor becomes dirty), the drag is cancelled and the draft is untouched. Escape and the other transient listeners exist only while a drag is active and are removed on cancel, so a dialog opened mid-drag receives Escape alone. A second effect cancels the drag when `savedOrder` changes identity (any refetch replaces `data.active`), so a drag never outlives the list it was started on; the drop-path validation in Decision 2 is the backstop if a refetch lands between the last effect and the drop. The cancel set is therefore: Escape, `pointercancel`, `lostpointercapture`, window blur, `contextmenu`, release outside the list, `setPointerCapture` failure, gate false, refetch, and unmount (the last without focus handling or callbacks).

Test note (engineering review S5): the Restore dialog is opened from the archived section, so a mouse user cannot open a dialog mid-drag. Test the gate transition by flipping the gate inputs, not by driving a dialog with the mouse. The stale and saving transitions (async completion of an earlier request, `beforeunload`) are the live cases.

### Decision 6: Focus and announcement

The page's existing `queueFocus` + `useLayoutEffect` (needed because keyed `<li>` moves blur focus) is reused, with ids built from the topic id, so focus follows the topic and not the index. After a committed drop, `queueFocus` uses `FOCUS_FALLBACKS.up` mapped through `moveButtonId`, which is Move up, then Move to top, Move down, Move to bottom: the first enabled one. A topic dropped at position 1 lands on Move down. Cancel uses the same queue for the dragged row, with `moveButtonId(topicId, a)` over the same `FOCUS_FALLBACKS.up` order and `activeRowHeadingId(topicId)` (the row heading, `tabIndex=-1`) appended as the last fallback, so the target is fixed and never invented by the implementer. Focus after a pointer drop is programmatic focus on a Move button: `:focus-visible` normally shows no ring after pointer input, and the existing layout effect's `focus()` may scroll. This is existing behavior reused unchanged; the laptop check records whether the dropped row stays in view and whether a ring appears (tasks 5.1), and `preventScroll` is a follow-up only if it does not. The announcement is the existing template at `TopicManagementPage.tsx` (the `setMoveAnnouncement` call in the move handler): `${name} moved to position ${n} of ${N}`; the drop path goes through `applyNewOrder` so it cannot diverge, and the test compares against the button path's output. It goes through the single `reorder-announcement` live region once per committed drop, and never at drag start, while dragging, or on cancel. The drag hook adds no live region.

### Decision 7: Stale-conflict behavior (verified, unchanged)

Server `409 TOPIC_ORDER_STALE` sets `saveState = "stale"`. The facilitator sees, in a `role="alert"`, "The topic list was changed elsewhere since you opened this page." The draft remains on screen but Save order and all moves (and so drag, via the gate) are disabled. Two buttons resolve it: Reload, and Discard, both of which refetch `/topics/all`, replace the list with the server's order, and drop the draft. So **the draft is not kept**: the facilitator's arrangement is lost after a stale conflict. That is poor for a long, deliberate drag, but it is identical for buttons and is independent of how the draft was made, so it is a separate issue (proposal out of scope), not this change. Drag adds no new conflict scenario. Note what "stale" means on the server (Decision 9): `TOPIC_ORDER_STALE` is raised only when the submitted ID set differs from the team's current active set. There is no version or timestamp token, so two facilitators reordering the same set concurrently are both accepted and the later commit wins (backend test 5.7 documents this as intended). Drag makes long deliberate drafts more likely, so this overwrite is slightly more probable, but it affects ordering only and both writes are audited with `previous_order` and `new_order`. Not changed here.

### Decision 8: Laptop-first scope; touch deferred; no auto-scroll

The motivating case is a facilitator at a laptop the day before. Rachel recommended a laptop-first release with touch as a follow-up. I accept it. The use case does name tablets, but it names them for the buttons ("usable on desktop and tablet"), and the buttons already serve tablets completely; the drag the use case lists first is a convenience for long moves, and #181's intent (a drag gesture for the long-distance move) is met for the people who do that at a laptop. Honest framing: **#181 ships mouse, trackpad and pen drag; touch drag is a follow-up (new issue to be opened at merge) that is taken up only if a team asks.** The handle is built on Pointer Events with `touch-action: none` on the handle only, which costs nothing and keeps the follow-up small, but touch drag is not verified and no document may claim it. Two-device checking, 44 px targets, long-press and context-menu suppression, and orientation handling belong to that follow-up, not here.

**Auto-scroll is cut, but wheel and trackpad scrolling during a drag must work.** The earlier claim that a 25-topic list "barely overflows" was optimistic: rows carry definitions and can easily be 150 to 250 px, so even the default set of about 11 topics exceeds a laptop viewport, and the motivating gesture (position 9 to 2) may need a scroll mid-drag. Pointer capture does not block wheel scrolling, so this works natively provided hit-testing uses live rects, which is why measurement is per move and on `scroll` (Decision 1). It is verified manually at the laptop check, which now includes a long drag with a wheel or trackpad scroll in the middle. R-NOSCROLL records the deliberate absence of edge-driven auto-scroll only. One drop line between rows, rendered without animation; the dragged row dims in place and stays visible. Under `prefers-reduced-motion: reduce` there is no transition on rows or the drop line and the line snaps between slots. The handle has a grip icon, a grab cursor and the tooltip "Drag to reorder" (a desktop aid), and is at the leading edge while Remove is at the trailing edge.

### Decision 9: Server-side guarantees the drag relies on (inspected, with evidence)

Drag changes only how the client builds `orderedTopicIds`; the client is assumed hostile (anyone can send any body with curl). This decision records what the backend actually does, from reading `packages/backend/src/routes/topics.ts` (the `PUT /api/v1/teams/:teamId/topics/order` handler, TOPIC-006) and its tests, as of the branch base `000c068`. Where the backend lacks a guarantee, it says so. No backend change is part of this change (R-NOBACKEND).

Check order in the handler: non-canonical team id 404, then identity/role 403, then the topic-write rate limit, then team existence (404; the template team is also denied), then the customization lock (409), then body validation (422), then, inside a per-team advisory lock, set equality against the active set (409), then no-op (200, nothing written), then a two-phase renumber and the audit row in one transaction.

| Property (security review) | What the backend does | Evidence |
|---|---|---|
| **S-1 Authentication** | Global `authMiddleware` `onRequest` hook returns 401 for a missing, expired or terminated session before any route code. Not reorder-specific. | `auth/middleware.ts` (401 responses); tests in `auth/__tests__/middleware.test.ts` |
| **S-1 Role: non-facilitator** | `checkReorderTopicsAuthorization` returns `403 NOT_A_FACILITATOR`, before team lookup and before the lock. | `routes/__tests__/topics.test.ts`: "a non-facilitator against a nonexistent team receives 403 NOT_A_FACILITATOR, before team or lock" |
| **S-1 Facilitator who is a team member** | `403 FACILITATOR_IS_TEAM_MEMBER`. | `topics.test.ts`: "a facilitator who is a team member receives 403 FACILITATOR_IS_TEAM_MEMBER" |
| **S-1 Admin without membership** | Admitted, and the audit row records `actor_global_role: application_admin`. | `routes/__tests__/topic-write-member-admin-integration.test.ts` (the `reorder` case of the write matrix, real Postgres) |
| **S-1 Lock** | `409 TOPIC_CUSTOMIZATION_LOCKED` before body validation; writes a `topic.write_denied_locked` audit row with `attempted_operation: topic.reordered`. | `topics.test.ts`: "a locked team with an empty-array body receives 409 TOPIC_CUSTOMIZATION_LOCKED, not 422" and "the lock denial writes topic.write_denied_locked with attempted_operation topic.reordered and no order payload" |
| **S-1 Actor identity** | Audit actor comes from `session.userId` (the validated session), never from the body. | handler source (`session.userId`); `topics-integration.test.ts` 5.10 asserts `actor_user_id` equals the session user |
| **S-1 Rate limit** | Shared topic-write limiter, after the 403 and before team lookup, so it does not leak team existence. | `topic-write-rate-limit-placement-integration.test.ts` |
| **S-2 Payload shape** | 422 `INVALID_TOPIC_ORDER` unless a non-array object body has an `orderedTopicIds` array of 1 to 200 canonical UUIDs with no duplicates (case-insensitive, lowercased). The cap is checked before per-entry work. Messages never echo submitted values. | `validateReorderTopicsBody`; `topics.test.ts` "body validation" block incl. "the 422 message never echoes a submitted value" |
| **S-2 Set equality** | The submitted set must equal the team's active set, compared in memory against a team-scoped read. Missing, extra, unknown, **archived** or **another team's** IDs all fail the same comparison: `409 TOPIC_ORDER_STALE`, rollback, no audit row. Submitted IDs are never looked up individually, so the response cannot reveal whether an ID exists in another team. | handler source; `topics.test.ts` "missing, extra, and unknown IDs all return an identical 409 TOPIC_ORDER_STALE body and roll back" (asserts identical bodies and that no submitted ID is echoed); `topics-integration.test.ts` 5.2 (200 valid-looking foreign UUIDs return 409) |
| **S-2 Archived rows untouched** | Update statements are scoped `team_id = $1 AND status = 'active'`. | `topics-integration.test.ts` 5.1 "archived rows are not modified by a reorder" |
| **S-3 Concurrency** | Per-team advisory lock serializes writers. **There is no staleness token.** "Stale" means only that the ID set changed; a same-set reorder is always accepted and the later commit wins. | handler source; `topics-integration.test.ts` 5.7 "two reorders of the same set both succeed and the later commit wins; audit rows chain" |
| **Audit on success** | Exactly one `topic.reordered` row in the same transaction, with `previous_order` and `new_order` (IDs only, no names). No-op writes none. | `topics-integration.test.ts` 5.10 (exactly one row, correct actor and metadata) and 5.3 (no-op writes no audit row) |

**Gaps stated plainly (none introduced or widened by this change; none fixed by it):**

1. **No staleness token (S-3).** The security review asked me to confirm the token is server-derived and that omitting it is rejected. There is no token to omit. The only concurrency control is the advisory lock plus ID-set equality. Concurrent same-set reorders by two facilitators silently overwrite each other (documented as intended by test 5.7, and both writes are audited with before and after). Integrity impact is ordering only. Recommend the team decide whether to track a version-token follow-up; this change does not depend on it.
2. **Denied attempts other than the lock are not audited (S-4.2).** A reorder rejected with 403, 404 or 422, or with a stale 409, writes no `audit_log` row and emits no event; `topics.test.ts` asserts this explicitly ("a 403/404/422 writes no audit row and emits no event"; the stale-409 test asserts no audit insert). Only the lock denial and the template-team denial are audited. This is existing and tested as intended behavior; I found no stated rationale specific to the reorder 403 (the comments in `auth/audit-logger.ts` that justify unaudited denials concern pollable read endpoints). It does mean a script probing this endpoint as a non-facilitator leaves no durable trace. Not a drag concern; flagged for the security owner to accept or open an issue.
3. **Test gap, minor (S-2).** No backend test submits a real topic ID belonging to a *different existing team*, or an archived ID from the same team, as the payload; the tests use random UUIDs. The handler's behavior for them is identical by construction (it never looks IDs up individually), and the "extra ID" variants exercise the same branch, but there is no test that names either case. A one-line test would close it.

Client-side corollary: because the server rejects anything but the exact active set, a draft that is wrong in any way the client cannot see (a topic archived by someone else) fails safely with the existing stale flow rather than corrupting data.

## Risks / Trade-offs

1. **Hand-built surface that jsdom cannot test** (geometry, touch, scroll). Mitigation: unit-test pure functions and the hit-test math with injected rects; integration-test draft semantics by invoking the drop handler; mandatory manual device check recorded in tasks. A passing synthetic event is not "tested".
2. **Buttons rot** if someone "simplifies" the row. Mitigation: spec requirement and a failing test (R-BTN).
3. **Draft loss on stale/navigation.** Accepted, unchanged (Decision 7).
4. **Page size.** 2,100+ line component; the hook file contains the new mechanics so the page only gains wiring.
5. **Numbers**: threshold, handle size and dim opacity are named provisional constants in the spec; the 25-topic assumption is delegated to the team lead. The 20 kB ceiling is moot while no dependency is added and applies only if Decision 1 is reopened.
6. **Security-sensitive surface:** no new endpoint, credential, data flow or audit change; client gating is presentational and the server checks in Decision 9 are authoritative. Constraints on the new client code: no `dangerouslySetInnerHTML` or string-built HTML or `aria-label` for topic names (names reach the drop line, the tooltip and the live region only as React text nodes, as the existing announcement does); no `console` logging of drag state or topic names, including temporary debug statements; no new third-party code. A dependency would add supply-chain exposure (Decision 1), which is part of why none is added. Threat model: this change touches only the existing client-state-tampering and request-forgery surfaces, both of which already assume a hostile client; no new trust boundary, no WebSocket impact. If a living threat model exists, add one line referencing #181 under "facilitator topic management" (tasks 6.4).
7. **Deferred, tracked rather than implicit:** touch drag (follow-up issue; when taken up it needs security re-review of `touch-action`, long-press and context-menu suppression, and unintended-drop gestures); a staleness token and denied-attempt audit (Decision 9 gaps, owner is the security owner, not this change); the real-device behavior of every candidate library (only relevant if Decision 1 reopens).

## Open Questions

- None blocking. The accessibility confirmation owner is the implementing developer, verified by the PR reviewer (tasks 6.5). The 25-topic assumption is delegated to the team lead.

## Design review disposition

Reviews: engineering (Marcus Oyelaran, `design-review-engineer.md`) and security (Tomás Ferreira, `design-review-security.md`). Disposition by Ingrid Sollenberger.

### Accepted and changed

| Finding | Disposition | Where |
|---|---|---|
| Eng M1 hook placement vs early returns | Accepted, option 1: pure `computeReorderGate` called above the early returns, single definition, per-cause tests | Decision 4; tasks 1.3, 3.1 |
| Eng M2 slot vs final index | Accepted: hook emits slot 0..N, `slotToFinalIndex` converts, table-driven (from, slot) test | Decision 2; tasks 1.1, 2.3 |
| Eng M3 row geometry, auto-scroll claim | Accepted: per-move and on-scroll measurement, fresh rects at pointerup, "barely overflows" claim withdrawn, wheel scroll mid-drag verified manually | Decisions 1, 8; tasks 5.1 |
| Eng S1 pointer capture, selection, outside release, unmount, refetch, capture failure, contextmenu | Accepted in full as the listener contract | Decisions 1, 2, 5; spec R-UNMOUNT, R-REFETCH |
| Eng S2 stale closures | Accepted: ref for `onDrop`, `next` computed at drop from current state | Decision 2 |
| Eng S3 focus after pointer drop | Accepted as an observation: existing effect reused, laptop check records ring and scroll | Decision 6; tasks 5.1 |
| Eng S4 test strategy | Accepted: pure hit-test, PointerEvent polyfill and capture stubs as a task, page-level test with mocked rects, property-style equivalence | Risk 1; tasks 2.1, 2.4, 3.3 |
| Eng S5 dialog mid-drag | Accepted: test by flipping gate inputs | Decision 5 |
| Eng estimate | Accepted: 200 to 250 lines, overrun rule in days | Decision 1 |
| Eng pure hit-test split | Accepted | Decision 1 |
| Eng minor: drop `announcement` parameter | Accepted: computed inside `applyNewOrder` | Decision 2; tasks 1.2 |
| Eng minor: drop line is hook-local, updated on slot change only | Accepted | Decision 1 |
| Eng minor: cancel focus target id | Accepted with a variant (see rejected) | Decision 6 |
| Sec S-1 authz evidence | Done: file and test cited; no gap found in authn, role, lock | Decision 9 |
| Sec S-2 payload contract | Done: contract recorded, and the incorrect "server ignores archived rows" sentence corrected (archived IDs yield 409) | Decisions 3, 9 |
| Sec S-3 staleness token | Verified: **there is no token**; stated plainly as a gap that is not this change's to fix | Decisions 7, 9 |
| Sec S-4 audit wording | Concrete wording and tests: one `topic.reordered` row per Save, zero after cancel, no-op, Discard; actor from session; denied-attempt coverage stated with its gap | Decision 9; spec R-AUDIT; tasks 0.1, 5.3 |
| Sec S-5 listener removal, unmount, capture failure, validation, escaping | Accepted: unmount in the cancel set, drop-path validation, no raw HTML, no console logging | Decisions 1, 2, 5; Risk 6 |
| Sec S-6 tracked deferrals | Accepted as Risk 7 | Risks |
| Sec S-7 threat model | Accepted: one-line reference, conditional on a threat model existing | Risk 6; tasks 6.4 |
| Sec condition 4 dependency intake | Accepted | Decision 1 |

### Rejected or deferred, with rationale

- **Eng M1 option 2 (child component for the drag-bearing list).** Rejected. It achieves the same hook placement with a larger diff on a 2,100-line file and a new component boundary for state the page already owns. The pure gate function gets the single-definition benefit at a fraction of the change.
- **Eng minor: use the row heading as the cancel focus target.** Partly rejected. The spec (R-CANCEL, R-FOCUS, already reviewed by BA and facilitator personas) puts focus on a move control, matching the commit path, which keeps one behavior to learn and test. The heading is kept as the last fallback so the id is specified.
- **Eng S3 `focus({ preventScroll: true })`.** Not adopted. It would change existing button-move behavior for a side effect not yet observed. Revisit only if the laptop check shows the dropped row leaving the viewport.
- **Eng minor: `aria-hidden` handle with a tooltip is invisible to screen-reader users.** Acknowledged, no change. The buttons are the accessible path by design (WCAG 2.2 2.5.7), already recorded.
- **Sec S-3 "reject a client that omits the staleness token".** Not applicable: no token exists. Adding one is a backend and API change, out of scope for a frontend-only change (R-NOBACKEND). Recorded as a gap for the security owner.
- **Sec S-4.2 audit denied 403 and stale attempts.** Not adopted here. It is a backend behavior change on an unchanged endpoint, independent of drag, and the existing tests assert the current behavior on purpose. Recorded as a gap for the security owner to accept or open an issue.
- **Auto-scroll.** Still cut (Decision 8). The review showed the justification was wrong, not the cut: wheel scrolling mid-drag covers the case at no cost, and edge auto-scroll would be a second owned mechanism.
- **Backend closure of the two small test gaps** (real other-team ID, archived ID in payload). Not done in this change; noted in Decision 9 as a one-line test each.

### Unresolved items carried to the caller

1. No staleness token; same-set concurrent reorders are last-write-wins (Decision 9 gap 1).
2. Non-lock denied reorder attempts leave no audit row (Decision 9 gap 2).
Neither blocks this change or is widened by it; both need an owner decision outside it.
