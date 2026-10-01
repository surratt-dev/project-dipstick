# Design Review — Full Stack Engineer

**Reviewer:** Marcus Oyelaran (Senior Full Stack Engineer)
**Change:** `topic-add-form-and-empty-state` (issue #55)
**Artifacts reviewed:** `design.md`, `proposal.md`, `specs/topic-management-screen/spec.md`, `specs/topic-customization-lock/spec.md`, `tasks.md` (skimmed)
**Code checked:** `packages/frontend/src/pages/TopicManagementPage.tsx` (1414 lines), `packages/frontend/src/pages/__tests__/TopicManagementPage*.test.tsx`, `packages/frontend/src/App.tsx`, `packages/backend/src/routes/topics.ts` (TOPIC-003 at L699–L835, validator at L256–L330, envelope at L59), `packages/backend/src/routes/content.ts` (TOPIC-002 at L511–L700), `packages/shared/src/types/topic.ts`

## Verdict

**Implementable. Approve with conditions.** The boundaries are right: `canAddTopics` is a presentation-only flag beside `canEditAnnotations`, TOPIC-003's contract is untouched, and turning Remove/Restore into quiet refetches is the right structural fix. It is not a fourth lock-out system. Most of the design's claims about the code are accurate. Two correctness holes need closing before implementation. Both sit in the window between "the server committed" and "the screen knows it" (S1, S2). One claim about existing Remove behaviour is wrong (S4). The page should not grow by another ~500 lines inline (S6).

---

## Claims verified against source

| Design claim | Status |
|---|---|
| `loadTopics()` is called after a write only at Remove success (L627) and Restore success (L678) | **Correct.** Both call `setRemoveState/RestoreState({status:"idle"})` and then `await loadTopics()`. |
| Reorder save patches from its response; stale recovery and definition-failure recovery use `fetchAllTopics()` (L524) | **Correct.** `saveOrder` patches `data.active` (L801–L812). `reloadAfterStale` and `refetchAfterAnnotationFailure` both call `fetchAllTopics()`, which never calls `setError`. |
| Reason constants at ~L98/L112/L113 | **Correct.** |
| Empty list renders `<p data-testid="active-topics-empty">No active topics.</p>` (~L1065) | **Correct.** |
| TOPIC-002 computes `canEditAnnotations = decision.actorGlobalRole === "facilitator"` (L668); archived entries carry `prompt` and `isDefault` | **Correct.** `canAddTopics` is a one-line addition beside it. |
| POST body `{ name, prompt, voteType, firstSessionDescription? }`; 201 `{ topicId, name, prompt, voteType, displayOrder, isDefault:false, createdAt }`, no description echoed | **Correct** (L826–L834). |
| Error cascade 403 `NOT_A_FACILITATOR`/`FACILITATOR_IS_TEAM_MEMBER` → 404 `TEAM_NOT_FOUND` → 409 `TOPIC_CUSTOMIZATION_LOCKED` → 422 `VALIDATION_FAILED` + `error.field` | **Correct.** The envelope is `{ error: { category, code?, field?, message, correlationId } }` (`buildErrorEnvelope`, L59). |
| Server trims name/prompt but not `firstSessionDescription`; no uniqueness check | **Correct.** The validator checks the *trimmed* name/prompt length (≤100/≤500) and the *raw* description length (≤500). The client's trim-then-send keeps every case at or under the server's limits. |
| Administrators are rejected by TOPIC-003 (#176) | **Correct.** `checkStandingFacilitatorAuthorization` requires `globalRole === "facilitator"`, so an admin gets `403 NOT_A_FACILITATOR`. |
| Converting Remove/Restore to the quiet refetch won't break existing tests | **Correct.** The existing success tests use a three-mock sequence (initial GET, write, refresh GET) and still pass. Nothing asserts `topic-management-error` after a write. The fallback in Decision 2 should not be needed. |
| "A stale second Remove surfaces the server's `422 TOPIC_ALREADY_ARCHIVED` through the existing Remove failure path" (Decision 2; spec L305 "with the server's `error.message`") | **Incorrect.** See S4. |
| "Focus the archived row's heading" / "Custom tag inside the row heading so it is part of the accessible name" | **No such element exists.** Active and archived rows render the name in a bold `<div>`. See S5. |

---

## Should fix before implementation

### S1. The add's interlock drops before the post-201 refetch lands, which reopens the stale-draft hazard the design itself names

Decision 6 says: on 201, "close and reset the form, `fetchAllTopics()`…". If the form leaves the `submitting` phase before that refetch settles, every interlock in the "add submitting" row lifts during the round trip. A facilitator who clicks a move in that window gets a `draftOrder` built from the *old* `savedOrder`. When the refetch lands, `data.active` gains the new topic, but `displayedTopics` is built from `draftOrder`. The new topic is then invisible, and the next `PUT /topics/order` is missing an id, so the server returns `TOPIC_ORDER_STALE`. Decision 3 calls exactly this hazard a correctness rule.

**Fix:** keep `phase: "submitting"` (Submit reads "Adding…", the other controls stay disabled) until the post-201 refetch settles. Only then close the form, set the screen message, and queue focus. The same applies to the 409 path's refetch. The cost is one `await` placed before the `setAddForm(null)`.

**Same window, already in the code:** Remove and Restore set their dialog to `idle` *before* `await loadTopics()`. A move made during that refetch leaves an archived id in `draftOrder`. You are editing both call sites in task 2.1 anyway, so keep the dialog in `submitting` until `fetchAllTopics()` settles. That is a two-line change inside the task's existing scope, not new scope. If the team prefers not to fix it here, record it as a known gap.

### S2. Any exception after a 201 must not reach the "couldn't be added, try again" branch

Every existing handler on the page wraps the whole fetch in one `try { … } catch { network error }`. If the add handler copies that shape, a throw *after* the 201 lands in the catch and shows "The topic couldn't be added. Try again." to someone whose topic was created. A throw can come from `res.json()`, from `setData`, or from focus code. Retrying then creates a duplicate, which is the outcome Decision 6 is written to prevent. Structure the handler so the `try/catch` around `fetch()` covers only the request. Once `res.status === 201`, every later path goes to the "Added …" / "Added …, but the list couldn't be refreshed" messages. Add one test: a 201 whose body fails to parse still says the topic was added.

Related, and cheap: a network error or 5xx is ambiguous about whether the row was committed. On that path, run a quiet `fetchAllTopics()` and apply it if it succeeds. The retry's duplicate check then sees a topic that was in fact created. This needs no copy change and no new UI.

### S3. The server's 422 messages are developer copy and should not be shown to facilitators as-is

The spec says to show `error.message` on the field. The validator's messages are API-contract text: "name is required, must be non-empty after trimming, and at most 100 characters.", "voteType is required and must be one of 'finger', 'roman', 'modified_roman'.", "firstSessionDescription must be a string of at most 500 characters." Client validation makes these rare, but a rare path still needs a usable message. Showing the internal field name `firstSessionDescription` under a field labelled "Description" is exactly the copy problem Priya's review exists to catch.

**Fix:** map `error.field` to the field (as designed), but show client-owned copy for each field: the existing "Enter a topic name." / "Enter a prompt." / "Choose a vote type.", plus a length message for name, prompt, and description. Fall back to the server message only at form level for an unknown field. This changes one sentence in the "Submitting validates…" requirement. Route the new strings through Priya's copy pass.

### S4. Existing Remove failure handling does not surface the server's 422 message

`submitArchive`'s `!res.ok` branch (L605–L611) shows the fixed string "Unable to archive this topic." and only reads `body.error` for 409. So the design's statement that a stale second Remove "surfaces the server's `422 TOPIC_ALREADY_ARCHIVED`", and the delta spec's "with the server's `error.message`" (spec L305), are not what the code does. Either:
- (a) change that branch to `body?.error?.message ?? "Unable to archive this topic."`, using the `.json().catch(() => null)` pattern Restore already uses. That is one line, makes the spec true, and needs one test. Or
- (b) reword the design and spec to "reported through the existing Remove failure handling", with no claim about the server message.

I prefer (a): the server's message is better than the generic one. Either way, add it explicitly to task 2.1 or 2.2 so it doesn't land as an unplanned edit.

### S5. Rows need real heading elements; the focus targets must be named precisely

Several requirements depend on a "row heading": the Custom tag in the accessible name, focus to the new row's heading, focus to the archived row's heading, and the `getByRole("heading", { name: /Custom/ })` query in task 3.4. Today the row title is `<div style={{ fontWeight: "bold" }}>`. That is not a heading, and a `div`'s text does not give the `<li>` an accessible name. State in Decision 8 that the row title becomes an `<h3>` (active and archived), with `tabIndex={-1}`, and with the Custom tag as a child. The page outline then becomes h1 → h2 section → h3 row, which is correct.

Two other focus targets are ambiguous:
- "Show archived topics (n)" focuses "its heading". The Archived `h2` wraps the toggle `<button>`, so the natural target is that button, not the `h2`. Say so.
- "Active Topics (n)" becomes a focus target with `tabIndex={-1}`. If the add trigger sits *inside* the `h2`, the heading's accessible name becomes "Active Topics (12) Add custom topic". Put the trigger in a flex row *beside* the `h2`, not inside it.

All post-render focus moves (new row after refetch, archived row after expand, heading after 409) need a `useLayoutEffect` keyed on a pending-focus ref, because the target doesn't exist at click time. The page already does this for move buttons (`pendingFocus`, L462/L720). Generalise it into one `pendingFocusId` that resolves via `document.getElementById`, rather than adding a second ref map next to `moveButtonRefs`.

### S6. Extract the add form and its pure logic; don't grow the page past ~1900 lines

`TopicManagementPage.tsx` is 1414 lines with four subcomponents defined in the file. This change adds a form with seven phases and states, a duplicate checker, a five-row empty state, a message region, and a new interlock row: easily another 400–500 lines. Recommended split, following the precedent `topicOrder.ts` already set:

- **`pages/addCustomTopic.ts` (pure, no React):** `isAddFormDirty(values)`, `validateAddForm(values) → fieldErrors`, `findDuplicate(values, active, archived) → { kind, topic } | null`, `buildAddTopicRequest(values): AddCustomTopicRequest`, `activeEmptyStateVariant(locked, archivedCount, canAdd) → 1..5`. Unit-test these in `__tests__/addCustomTopic.test.ts`. The duplicate edge cases (archived wins, first in display order, internal whitespace, `toLowerCase()` with no locale) and all five empty-state rows become fast table tests rather than full-page renders.
- **`components/AddCustomTopicForm.tsx` (presentational, controlled):** props are the form state, `submitDisabledReason`, and callbacks (`onChange`, `onSubmit`, `onCancel`, `onDiscard`, `onKeepEditing`, `onShowArchived`, `onAddAnyway`). It owns no fetch and no interlock logic.
- **`ActiveTopicsEmptyState`:** a small component, same file or a sibling.
- **Keep in the page:** the `addForm` state, the submit handler, the interlock derivations, and the screen-message state, because they are coupled to `data`, `draftOrder`, `annotationEditor`, `removeState`, and `beforeunload`. Moving them into a hook would just thread ten setters through a parameter list. That is incidental complexity.
- **Tests:** put the add flow in `TopicManagementPage.add.test.tsx` and the empty state in `TopicManagementPage.empty.test.tsx`, matching the existing per-feature `.reorder` / `.annotation` split. Don't append to the 600-line base test file.

This is a structural requirement, not a style preference. Amend tasks 4.1/4.3/5.2/7.1 to name these files so the implementer doesn't have to rediscover it.

---

## Minor / consider

- **M1. Concurrent quiet refetches use last-write-wins.** Sending an add closes a clean definition editor. If that editor had `refetchOnClose`, `closeCleanAnnotationEditor()` starts `refetchAfterAnnotationFailure()` in parallel with the POST. That GET was issued *before* the insert. If it resolves *after* the post-201 refetch, `setData` replaces the newer list with an older one, and the new topic disappears until reload. The window is narrow, and the fix is cheap: a monotonically increasing request counter checked before every `setData` from `fetchAllTopics()` (latest-issued wins). Alternatively, await that refetch before sending the POST.
- **M2. How disabled reasons are shown.** The existing pattern is mixed. Remove/Restore put only `DEFINITION_LOCKS_ACTIONS_REASON` in `title`. `LOCKED_BY_DRAFT_REASON` appears as a visible `<p data-testid="reorder-locked-reason">`. Move buttons have no `title` at all. "Takes precedence over every other reason" has to apply to both the visible paragraph and the `title`. Specify one visible `add-submitting-reason` line under the heading, with `title` on each control, and suppress the other reason paragraphs while it shows. Otherwise tests will assert different things in different places.
- **M3. Team change does not reset local state.** `/team/:teamId/topics` is not keyed on `teamId` in `App.tsx`, so a `teamId` change reruns `loadTopics()` but keeps `addForm`, `draftOrder`, and `annotationEditor`. With an add form open, values typed for team A could be POSTed to team B. The bug predates this change and is rarely reachable (no in-app link goes from one team's topics page to another's), but the add form makes the consequence a write. Fix it with `<TopicManagementPage key={teamId} />` (one line) or a reset effect.
- **M4. Shared types.** `AddCustomTopicResponse.voteType` and the request's `voteType` should use `VoteType`, not a repeated string union. The backend's `ValidatedAddCustomTopicBody` and `VALID_VOTE_TYPES` should adopt it in the same task. Type the validator's `field` as `keyof AddCustomTopicRequest` rather than `string`, so the frontend's field map and the backend's validator share one compile-time contract. There is no shared error-envelope type today. Don't invent one in this change; a local `{ error?: { code?: string; field?: string; message?: string } }` matches the page's existing casts.
- **M5. Missing-flag handling.** The migration plan relies on "missing `canAddTopics` is treated as `false`". Write the gate as `data.canAddTopics === true` and add a comment, so a later refactor to `!!` or an optional default doesn't silently change the frontend-first deploy behaviour.
- **M6. Non-JSON error bodies.** A proxy 502 or 504 returns HTML, and `res.json()` throws. Use the `.json().catch(() => null)` pattern Restore and the definition save already use, so a 5xx reaches "The topic couldn't be added. Try again." rather than the catch-all branch (see S2 for why the branches must stay separate).
- **M7. A prompt-only archived match points at a row that doesn't show the prompt.** Archived rows render the name, definition, and provenance, but not the prompt. When only the prompt matched, the facilitator is sent to "Codebase Health" with no visible reason it matched. Either show the prompt on archived rows (one line; `prompt` is already in the payload), or have the warning say "a topic that asks the same question". This is a copy decision for Priya, but flag it before the copy review rather than after.
- **M8. Clearing the screen message touches four existing handlers.** `moveTopic`, `startRemove`, `startRestore`, and `openAnnotationEditor` must each clear it. Use one `clearScreenMessage()` call rather than four inline `setScreenMessage(null)` calls, and add one test for each clearing event; they are easy to miss in review. The new region sits beside three existing message surfaces (`reorder-save-confirmation`, `reorder-save-error`, `definition-refetch-error`). That is acceptable for this change, but it is the "should the screen get simpler?" debt Rachel noted.

---

## Summary

The design is implementable and its boundaries are clean. Most claims about the code hold (call sites, error codes, response shape, flag placement). The Remove/Restore quiet-refetch conversion is safe against the existing tests.

- **S1/S2:** keep the add's interlock up until the post-201 refetch settles, and never send a post-201 exception to "try again". Both are duplicate and stale-draft holes in the commit-to-screen window.
- **S3:** do not show the 422 validator's developer messages to users.
- **S4:** the existing Remove handler does not show the server's 422 message. Fix it in one line or correct the text.
- **S5:** row titles must become real `<h3>` headings for the accessible name and focus targets to exist.
- **S6:** extract `addCustomTopic.ts`, `AddCustomTopicForm.tsx`, and the empty state, with per-feature test files. Keep state and interlocks in the page.
- **M1–M8** are low-cost hardening items (refetch ordering, reason display, team-key reset, `VoteType` reuse, non-JSON bodies).
