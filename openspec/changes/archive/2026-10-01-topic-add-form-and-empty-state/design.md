## Context

The Topic Management screen (`packages/frontend/src/pages/TopicManagementPage.tsx`, route `/team/:teamId/topics`, spec `topic-management-screen`) was built up across #51–#54: remove, restore, reorder, and the team-definition editor. Two gaps remain against `requirements/use cases/08 - Topic Management - Use Cases.md` (exploration-notes.md §0):

- **Add Custom Topic (TOPIC-003)** has no frontend. The backend `POST /api/v1/teams/:teamId/topics` shipped under #50 (`topics.ts` ~L262–L340, L699–L820; spec `add-custom-topic`). It takes `{ name, prompt, voteType, firstSessionDescription? }`, returns `201 { topicId, name, prompt, voteType, displayOrder, isDefault: false, createdAt }` (no description echoed), and fails with `403 NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER`, `404 TEAM_NOT_FOUND`, `409 TOPIC_CUSTOMIZATION_LOCKED`, or `422 VALIDATION_FAILED` with `error.field`. It rejects application administrators (#176). It does not trim `firstSessionDescription` and does not check name uniqueness.
- **The empty active list** renders `<p data-testid="active-topics-empty">No active topics.</p>` (~L1065) and nothing else.

Current page state that this change leans on:
- `loadTopics()` (full-screen error on failure) is called after a write in exactly two places: Remove success (~L627) and Restore success (~L678). Reorder save patches from its response (~L801–L812), and stale-order recovery and definition-save recovery already use the quiet `fetchAllTopics()` helper (~L524).
- Reason constants already exist: `LOCKED_BY_DRAFT_REASON` (~L98), `DEFINITION_DIALOG_OPEN_REASON` (~L112), `DEFINITION_LOCKS_ACTIONS_REASON` (~L113).
- TOPIC-002 (`content.ts` ~L668) already returns `canEditAnnotations = decision.actorGlobalRole === "facilitator"`, and `archived[]` entries already carry `prompt` and `isDefault`.

Settled before this proposal (exploration revision 2, sections 7–9): every C/V/O item from Priya's and Marcus's reviews. Human items: **H1** neutral empty-state copy naming no specific support channel; **H2** handoffs stay drafts for a human to file; **H3** Priya's hands-on check is a pre-ship item.

## Goals / Non-Goals

**Goals:**
- A facilitator can add a custom topic from the screen on an unlocked team, with copy that never promises in-session display the system cannot deliver.
- Protect the baseline: custom topics are visibly custom, and an accidental retype of an archived topic is caught before it splits a trend.
- An honest, small empty state for the rare zero-active-topics case.
- Make "no post-write refetch can destroy local state" true for the whole page, so a dirty add form needs no new lock-out.

**Non-Goals:**
- Editing existing topics (vote type especially: it would break trend continuity).
- Fixing #176 (admin add), #184 (archive race, TOPIC-003 hardening), #187, #188, #175.
- Reading or fixing `defaultTopicsNotActive`; a "restore the default set" endpoint; recovery for teams provisioned with zero topics.
- Fuzzy/near-duplicate matching; creator attribution on rows; a soft name-length limit.
- Any session-side display of custom topics or their descriptions.

## Decisions

### Decision 1: `canAddTopics` is a separate TOPIC-002 flag, not a reuse of `canEditAnnotations`

`canAddTopics = decision.actorGlobalRole === "facilitator"`, computed beside `canEditAnnotations`. Today the two values are identical, but the rules diverge on purpose: when #176 lands, administrators may add topics (FR-8.2) while they still may not edit team definitions (FR-8.7). Reusing one flag would force that fix to split it under pressure. The spec requirement states in its own text that `false` for administrators is **temporary, pending #176**, so archiving does not merge a defect into the living spec as a product rule.

The flag is presentation only; TOPIC-003 enforces independently. Gating rule: the add control renders iff `!isCustomizationLocked && canAddTopics`. There is no disabled or teaser variant anywhere, and administrators see no explanation outside the empty state (row 5 is the one place they do).

The frontend reads the flag as `data.canAddTopics === true`, with a comment, so a missing field (frontend-first deploy, see Migration Plan) fails closed and a later refactor to `!!` or a default cannot silently change that. One component test asserts a response without the field shows no add control.

**Parity is a test, not a promise (security review S1).** Today `canAddTopics === true` holds, among callers TOPIC-002 admits, exactly when TOPIC-003's 403 checks pass, but only because two different helpers (`checkStandingFacilitatorOrAdminAuthorization` for TOPIC-002, `checkStandingFacilitatorAuthorization` for TOPIC-003) happen to agree. The spec's "same change as #176" sentence becomes a control through one table-driven backend test: for each caller class (non-member facilitator, member facilitator, `application_admin`, `application_admin` who is also a member, engineer, engineering manager), call TOPIC-002 and TOPIC-003 against an unlocked team and assert `canAddTopics === (POST status !== 403)`, where a TOPIC-002 rejection counts as "no flag" and must coincide with a POST 403. A #176 fix that touches one side fails it. A shared `canAddCustomTopic(globalRole)` predicate (security S2) is deliberately not introduced now; the natural moment is the #176 fix.

*Alternative rejected:* gating on `canEditAnnotations` (option A in exploration §2.3).

### Decision 2: Loose dirty-form policy, made safe by quiet refetch on Remove and Restore

A dirty-but-idle add form disables nothing. Only *submitting* gates other controls. This is safe only if no other action's post-write refetch can unmount the screen and lose typed text. Today two can: Remove and Restore success call `loadTopics()`, whose failure path calls `setError(...)`. Both move to `fetchAllTopics()`; on failure they show an inline `role="alert"` that says the write succeeded ("Archived '<name>', but the list couldn't be refreshed. Reload the page to see it." / "Restored '<name>', but the list couldn't be refreshed. Reload the page to see it.") and leave the rest of the screen, including any open add form, rendered. `loadTopics()` remains only for the initial load and team change.

This is Marcus's stated condition for accepting the loose policy (bounded, reuses an established helper, testable with one failure scenario per site), and it removes the hazard for whatever control is added next rather than adding a fourth lock-out system.

*Alternative (named fallback):* Marcus's strict policy, where a dirty add form disables moves, Remove, Restore, and definition edit. If implementation shows the Remove/Restore conversion can't be done cleanly (for example, a test suite that depends on the full-screen path in a way that can't be updated), the implementer stops and raises it; the fallback is strict, never "loose with the hole left open".

On a failed refetch the lists are left as last loaded; the screen does not move the row locally. That is honest (the alert already says reload), and a stale follow-up action, such as a second Remove of the same topic, surfaces the server's `422 TOPIC_ALREADY_ARCHIVED` through the Remove failure path. That last clause was not true of the code (engineer review S4): `submitArchive`'s `!res.ok` branch shows the fixed "Unable to archive this topic." and reads `body.error` only for 409. Task 2.1 changes that branch to parse with `.json().catch(() => null)` (the pattern Restore already uses) and show `body?.error?.message ?? "Unable to archive this topic."`, so the spec's "with the server's `error.message`" is made true rather than reworded.

**The dialog stays submitting until the refetch settles (engineer review S1).** Today Remove and Restore set their dialog to `idle` *before* `await loadTopics()`. A move made during that refetch builds `draftOrder` from the old saved order and can carry an archived id into the next `PUT /topics/order`. Since both call sites are edited here anyway, each keeps its dialog in `submitting` (which already disables moves, Save order, and definition edit through the "remove/restore dialog open" row of Decision 3) until `fetchAllTopics()` settles, then closes it. Two lines; no new interlock.

Existing reorder and definition interlocks are unchanged. Their living-spec rationale ("the post-Remove/Restore refetch could replace the screen") becomes partly historical once that refetch is quiet. The interlocks stay deliberately: a successful refetch still replaces the lists and saved order under a dirty draft, so they still protect drafts. The rationale sentences are left as written rather than restated through MODIFIED blocks that would copy two long requirements to change one clause each (propose review I3).

### Decision 3: Interlock matrix

```
Busy state ↓ / control →   moves  SaveOrder  Remove  Restore  DefEdit  AddTrigger  AddSubmit  AddFields
reorder dirty/saving         –       –         ✕       ✕        ✕        –           ✕          –
definition dirty/saving      ✕       –         ✕       ✕        –        –           ✕          –
remove/restore dialog open   ✕       ✕         –       –        ✕        –           ✕          –
add submitting               ✕       ✕         ✕       ✕        ✕        n/a         ✕          ✕ (read-only)
add form open, clean         –       –         –       –        –        n/a         –          –
add form open, dirty         –       –         –       –        –        n/a         –          –
```

Submit's reason, in precedence order: `LOCKED_BY_DRAFT_REASON` → `DEFINITION_LOCKS_ACTIONS_REASON` → `DEFINITION_DIALOG_OPEN_REASON` (the same precedence the definition editor already uses). The submit-while-reorder-dirty block is a correctness rule: `displayedTopics` is built from `draftOrder`, so a new topic would be invisible and the next `PUT /topics/order` would answer stale `409`. During "add submitting" every other affected control uses one new constant, `ADD_TOPIC_SUBMITTING_REASON = "Wait for the new topic to finish saving."` No control invents its own string. While an add is in flight, that reason takes precedence over every other reason on the controls it disables. "Add anyway" / "Add as a new topic anyway" send the request, so they are gated exactly like Submit.

Sending the add request closes any open definition editor that has no unsaved changes, matching the existing rule for a move or an opened Remove/Restore confirmation. Without it, a clean editor that was already open would keep a live textarea and Save during the in-flight add (propose review I1). A dirty editor cannot be open at that moment, because it already disables Submit.

The trigger and fields stay usable during other busy states because opening and typing can't corrupt anything.

**"Add submitting" lasts until the screen knows the outcome (engineer review S1).** The phase begins when the request is sent and ends only after any refetch that outcome triggers has settled: the post-`201` refetch, the post-`409` refetch, and the post-network/`5xx` refetch (Decision 6). If the interlocks lifted on the response, a move made during the refetch would build a draft from the old saved order, the new topic would be invisible under `draftOrder`, and the next order save would go stale: the hazard this matrix exists to prevent. Submit reads "Adding…" for the whole phase.

**How the reasons are shown (engineer review M2).** While an add is in flight the screen shows one visible line, `data-testid="add-submitting-reason"`, reading "Wait for the new topic to finish saving.", directly under the Active Topics heading row, and every control it disables carries the same text in `title`. While that line is shown the other visible reason paragraphs (`reorder-locked-reason` and the definition equivalents) are suppressed, so "takes precedence" holds for both the visible text and `title`, and tests assert one place.

### Decision 4: Form state and dirtiness

One local union, e.g. `addForm: null | { phase: "editing" | "confirmingDiscard" | "warningDuplicate" | "submitting"; values; fieldErrors; formError?; duplicate? }`, so only one form exists by construction. **Dirty** = name, prompt, or description non-empty after trimming, or a vote type selected. `beforeunload`'s condition becomes `isDirty || annotationDirty || addDirty`. In-app navigation is not intercepted (the screen's existing rule).

The union also records which control opened the form (heading trigger or empty-state action), because Cancel and Discard return focus there. Opened from the empty state, the form takes the place of the empty state's actions and the empty-state message stays above it. Cancel on a clean form closes it and returns focus to the opening control. Cancel on a dirty form switches to an inline "Discard this topic?" with [Discard] and [Keep editing]. This deliberately differs from the definition editor (no cancel confirm): a new topic is several fields of composed handoff text; a definition is one field being amended. Draft preservation on collapse was rejected as hidden state that is harder to reason about and test.

### Decision 5: Validation, then duplicate check, then request

Order on Submit: required fields → duplicate check → request.
- **Required:** blank (after trim) name or prompt, or no vote type → no request, a message per failing field, focus on the first failing field, values kept. The vote-type radio group has no default; a preselected Finger is how a team ends up with a scale it never chose.
- **Lengths:** `maxLength` 100 / 500 / 500, matching the server. A counter reading "n / limit" appears from 80% of each limit; it is not a live region (per-keystroke announcements are noise) and is wired into the field's `aria-describedby`. No invented soft limit.
- **Duplicate:** normalise with `trim().toLowerCase()` (no locale argument, no other normalisation; internal whitespace compared as typed). Compare name with every active and archived `name`, and prompt with every active and archived `prompt`, using the lists the screen last loaded: it is a hint, not an authoritative check. Archived match wins over active when both match, because it is the one that protects the trend. With several matches of the winning kind, the first in that list's display order is named and focused. "Add anyway" / "Add as a new topic anyway" sends the request unchanged; the server doesn't enforce uniqueness. The override is remembered in form state and cleared when Name or Prompt is edited, so a retry after a network failure doesn't re-ask. "Show it in Archived topics" expands Archived and focuses that row's heading (`tabIndex={-1}`), leaving the form open with its values: no second restore path. Editing Name or Prompt dismisses the warning.
- Prompt is included (against Marcus's "name only") because the case that matters is retyping a removed default, and people retype the *question*, not labels like "Production Code — Adding Features". Exact match on prompt is the same code path and test shape as name. Fuzzy matching is a different feature and is deferred.
- **Server 422:** `error.field` in {`name`, `prompt`, `voteType`, `firstSessionDescription`} → a **client-owned** message on that field and focus it; otherwise a fixed form-level message. This screen is the first consumer of `error.field`. The validator's `error.message` is API-contract text ("firstSessionDescription must be a string of at most 500 characters.") and is never shown to facilitators (engineer review S3). Field messages: Name "Enter a topic name of up to 100 characters.", Prompt "Enter a prompt of up to 500 characters.", Vote type "Choose a vote type." (the existing client message), Description "Keep the description to 500 characters or fewer."; unknown or absent field: "The topic couldn't be added. Check each field and try again." These strings join Priya's copy pass. Client validation and `maxLength` make this path rare; it exists for client/server drift.
- **Payload:** name and prompt trimmed; description trimmed and sent as `null` when empty (the server doesn't trim it). Row rendering skips whitespace-only descriptions already stored.

### Decision 6: Outcomes

Messages shown after the form has closed, and the Remove/Restore refetch-failure alerts, go in **one screen message region** directly under the Active Topics heading: `role="status"` for success, `role="alert"` otherwise, at most one message, newest wins. Lifetime is an enumerated list, not "the next action": until the add form is opened, a move is made, a Remove/Restore confirmation opens, a definition editor opens, another message replaces it, or the facilitator leaves. Focusing a field does not clear it. The Active Topics heading gets `tabIndex={-1}` so outcomes can focus it.

**Handler shape (engineer review S2, M6; security review S3.4).** The `try/catch` that maps to "The topic couldn't be added. Try again." wraps `fetch()` only. Once `res.status === 201` is known, every later path (body parse, `setData`, refetch, focus) can only end in an "Added '<name>' …" message, using the trimmed name the form sent, so a post-commit exception never invites a retry that creates a duplicate. Error bodies are parsed with `.json().catch(() => null)`; the server's `error.message` is rendered (403/404 only) when the body parsed as the error envelope with a string `message`; any other non-2xx body, including a proxy's HTML 502, takes the network/5xx path with fixed copy. Sequence for every outcome: response → (refetch, if the outcome has one) → leave "submitting", close or re-enable the form, set the screen message, queue focus.

- **201:** `fetchAllTopics()`, then close and reset the form, then status "Added '<name>' to the end of the list. Use the move buttons to change where it falls." (or "Added '<name>'." when it is the only active topic), focus the new row's heading found by the `topicId` from the 201, falling back to the Active Topics heading if that id is not in the refreshed list or the `201` body could not be read. We refetch rather than building a row from the 201 because the 201 lacks `firstSessionDescription` and annotation fields.
- **201 + refetch failure:** alert "Added '<name>', but the list couldn't be refreshed. Reload the page to see it." Form stays closed, lists as last loaded, focus to the Active Topics heading. This is the case most likely to produce duplicate topics, so the message must say the write happened. `role="alert"` rather than status because the user has to act (reload).
- **403 `NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER`, 404 `TEAM_NOT_FOUND`:** form open, values kept, form-level `role="alert"` with the server's `error.message`, mirroring the definition-save 403 handling.
- **409 `TOPIC_CUSTOMIZATION_LOCKED`:** quiet refetch (still "submitting"); then the form closes and its values are discarded; alert "Topics can't be added to this team right now." in the screen region; focus to the Active Topics heading; and the gating rule applies to whatever the refetch reports (locked: control gone and lock notice shown; unlocked, after a race: control back). If the refetch fails, the alert reads "Topics can't be added to this team right now. Reload the page to see the current state." and the screen stays rendered. Losing the values is acceptable: the state is only reachable through a data fix or race, and the alert has been shown.
- **Network / 5xx (or unparseable error body):** form open, values kept, "The topic couldn't be added. Try again." Because this outcome is ambiguous about whether the row was committed, the screen first runs a quiet `fetchAllTopics()` (still "submitting") and applies it if it succeeds, so a retry's duplicate check sees a topic that was in fact created; a refetch failure changes nothing. No copy change, no new UI.

On every failure that leaves the form open (403, 404, 422, network, 5xx), Submit returns to "Submit", enabled subject only to the interlocks, and every field is editable again. The form-level alert clears on the next Submit.

No outcome copy mentions sessions (#175 blocks "it will appear in the next session" for every topic).

### Decision 7: Empty state is a pure function of three flags

| `isCustomizationLocked` | `archived.length` | `canAddTopics` | Content |
|---|---|---|---|
| true | any | any | "This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics." No actions. |
| false | > 0 | true | "This team has no active topics." + [Show archived topics (n)] + [Add custom topic] |
| false | > 0 | false | "This team has no active topics." + [Show archived topics (n)] |
| false | 0 | true | "This team has no active topics." + [Add custom topic] |
| false | 0 | false | "This team has no active topics. Topics can't be added from this account yet." No actions. |

Row 1 is H1's neutral copy: it names a human group, not an application role or a channel, because the only fix today is a database operation (`handoffs/zero-topic-team-recovery-path.md`). If a real support channel is later chosen, the copy changes with that handoff. Row 1 does not repeat the lock notice's first-session explanation: a team with no topics can't complete a first session. The lock notice is left unchanged; its "shown read-only below" sentence sits above an empty-state that explains the absence, which reads as consistent rather than contradictory.

"Show archived topics (n)" expands Archived and moves focus to the Archived section's show/hide toggle button (the Archived `h2` wraps that button, so the button, not the `h2`, is the focus target; engineer review S5); it adds no inline Restore. "Add custom topic" opens the same form; the heading trigger is hidden while the empty state shows, so there is one entry point. Rows 1 and 2's causes can't be reached through the UI; all five rows are component-tested against mocked TOPIC-002 responses. No illustration: the state is rare and should be small. The heading reads "Active Topics (0)".

Rows 3 and 5 exist only because of #176. When #176 is fixed they become unreachable for every caller TOPIC-002 admits, and the fix removes them in the same change (the spec says so), so a dead row does not outlive its defect.

Rows 4 and 5 (and row 1 when nothing is archived) are also where BRD FR-8.6 [HARD] ("defaults visible and restorable for any team at any time") is not met: a team with zero archived topics has no in-app way to see or restore the defaults. That is a stated deviation in the proposal, tracked by `handoffs/zero-topic-team-recovery-path.md` and `handoffs/default-topics-not-active-name-join.md`; this change adds no restore-defaults action (Executive review C2).

### Decision 8: Custom tag and heading count

Rows where `isDefault === false` (active and archived) render a text tag "Custom" inside the row heading so it is part of the accessible name. Default rows have no tag. The rule is unconditional (also on locked teams). The Active heading becomes "Active Topics ({active.length})".

**Row headings become real headings (engineer review S5).** Today a row's title is a bold `<div>`, which is neither a heading nor an accessible name, so "the row's heading" did not exist as a focus or query target. Every active and archived row title becomes an `<h3>` with `tabIndex={-1}` and an `id` derived from the `topicId`, with the "Custom" tag as a child. The page outline becomes h1 → h2 section → h3 row. The "Add custom topic" trigger sits in a flex row *beside* the Active Topics `h2`, not inside it, so the heading's accessible name stays "Active Topics (n)".

**Focus after render.** Every post-render focus move (new row after the `201` refetch, archived row after "Show it in Archived topics", Active heading after `409` or a refetch failure, Archived toggle from the empty state) goes through one `pendingFocusId` resolved in a `useLayoutEffect` with `document.getElementById`, generalising the existing move-button `pendingFocus` mechanism (~L462/L720) rather than adding a second ref map. Focus targets are looked up by element id built from `topicId`, never by a `querySelector` selector built from a topic name; if a selector is ever built from `topicId` it uses `CSS.escape`, because `topicId` format is not validated on these routes (#184) (security review S3.2).

**Text sinks (security review S3.1, S3.3).** Outcome messages, duplicate warnings, and headings are plain strings rendered as React text, never through an HTML-setting API or into `document.title` or an `aria-*` value assembled from markup, continuing the page's "never `dangerouslySetInnerHTML`" rule (~L177). One component test adds a topic named `<img src=x onerror=alert(1)>` and asserts it appears as literal text in the success message and the new row's heading, with no `img` element created.

### Decision 9: Shared types

`AddCustomTopicRequest { name; prompt; voteType; firstSessionDescription?: string | null }` and `AddCustomTopicResponse { topicId; name; prompt; voteType; displayOrder; isDefault: false; createdAt }` with a comment that the response deliberately omits `firstSessionDescription`. TOPIC-003's handler adopts them without behaviour change. `GetAllTopicsResponse` gains `canAddTopics: boolean`.

`voteType` on both types is the existing `VoteType`, not a repeated string union, and the backend's `ValidatedAddCustomTopicBody` / `VALID_VOTE_TYPES` adopt it in the same task. The validator's `field` is typed `keyof AddCustomTopicRequest`, so the frontend's field map and the backend validator share one compile-time contract (engineer review M4). No shared error-envelope type is invented; the page keeps its local `{ error?: { code?: string; field?: string; message?: string } }` cast.

### Decision 10: Code structure — extract the form and its pure logic

`TopicManagementPage.tsx` is already 1414 lines with four in-file subcomponents; this change would add 400–500 more. Following the `topicOrder.ts` precedent (engineer review S6):

- `packages/frontend/src/pages/addCustomTopic.ts` (pure, no React): `isAddFormDirty`, `validateAddForm`, `findDuplicate(values, active, archived)`, `buildAddTopicRequest`, `fieldErrorForServerField`, `activeEmptyStateVariant(locked, archivedCount, canAdd) → 1..5`. Unit-tested in `__tests__/addCustomTopic.test.ts` as table tests (duplicate edge cases, all five empty-state rows, payload trimming, 422 field mapping).
- `packages/frontend/src/components/AddCustomTopicForm.tsx`: presentational and controlled; props are the form state, `submitDisabledReason`, and callbacks. It owns no fetch and no interlock logic.
- `ActiveTopicsEmptyState`: small presentational component, sibling of the form.
- **Stays in the page:** the `addForm` state, the submit handler, interlock derivations, and the screen-message state, because they couple to `data`, `draftOrder`, `annotationEditor`, the Remove/Restore dialogs, and `beforeunload`. A hook would only thread a dozen setters through a parameter list.
- Page tests go in `TopicManagementPage.add.test.tsx` and `TopicManagementPage.empty.test.tsx`, matching the existing per-feature split.

This is a structure decision with no behaviour of its own, so it has no spec delta.

### Decision 11: Refetch ordering and team change

- **Latest-issued refetch wins (engineer review M1).** Sending an add closes a clean definition editor, which may start its own `refetchAfterAnnotationFailure()` GET in parallel with the POST. If that older GET resolves after the post-`201` refetch, it would overwrite the newer list and hide the new topic. `fetchAllTopics()` increments a request counter and applies a response only if it is still the latest issued. One helper change; it also protects the existing quiet refetches.
- **Superseded is not failed (tasks review C5).** Today `fetchAllTopics()` returns `GetAllTopicsResponse | null`, and every caller reads `null` as "refresh failed". With the counter, a dropped response must not look like a failure, or an older refetch that loses the race shows a false "couldn't be refreshed. Reload the page" alert. The helper returns a discriminated outcome, `{ status: "ok"; data } | { status: "failed" } | { status: "superseded" }`, and callers apply `data` only on `"ok"`. On `"superseded"` a caller applies nothing, shows no refetch-failure message, and finishes its own non-list steps as on success (Remove/Restore close their dialog; the stale-order reload and `refetchAfterAnnotationFailure` clear nothing and report nothing); the later refetch's caller owns the lists and any failure message. The add flow's post-`201` refetch is in practice never superseded (the clean editor's refetch it can race is issued before the POST, and "add submitting" disables every control that could issue a newer one), but its result is still defined: the form closes, the general "Added '<name>' to the end of the list. …" status message is shown, and focus moves to the Active Topics heading, because the refreshed list that would locate the new row is not this call's to read. Spec sentences and one scenario record the user-visible part.
- **A team change resets local state (engineer review M3).** The route is not keyed on `teamId`, so a `teamId` change reruns `loadTopics()` but keeps `addForm`, `draftOrder`, and `annotationEditor`. With the add form that becomes a write: values typed for team A could be POSTed to team B. The page is rendered as `<TopicManagementPage key={teamId} />` in `App.tsx`. The defect predates this change and is rarely reachable, but this change is what makes its consequence a write, so the one-line fix belongs here.
- **Screen-message clearing (engineer review M8).** The four existing handlers that must clear the screen message (`moveTopic`, `startRemove`, `startRestore`, `openAnnotationEditor`) and opening the add form each call one `clearScreenMessage()` helper, with one test per clearing event.

## Risks / Trade-offs

- [Admin dead-end until #176] → No control, no message; flag text marks it temporary. #176 flips one expression.
- [Duplicate topics after a 201 whose refetch fails] → The failure message says the topic was added (Decision 6).
- [A same-named custom topic corrupts `defaultTopicsNotActive`] → The screen doesn't read it; the duplicate check reduces collisions but is bypassable, so the backend fix is a handoff.
- [Custom description never reaches a session] → Honest label and helper text; defect and real fix are handoffs. Neither the description nor a team definition is promised in-session (#175).
- [Interlock regressions on an already busy page] → Every ✕ cell involving an add control has a scenario in both directions, plus negative scenarios for the clean/dirty rows.
- [Remove/Restore behaviour change] → User-visible differences: on refetch failure (inline instead of full-screen), the confirmation stays in its submitting state until the refetch settles, and a failed Remove shows the server's message when one parses. Covered by one test each.
- [409 lock loses typed values] → Accepted (Decision 6).
- [Bypassable duplicate warning] → Intentional; bypass is one deliberate click, never an accident.
- [Commit-to-screen window] → The add, Remove, and Restore busy states each last until their refetch settles (Decisions 2, 3), and a post-`201` exception can only produce an "Added …" message (Decision 6).
- [Flag/endpoint drift when #176 is fixed] → Parity test across caller classes (Decision 1). Drift toward "UI says yes, server says no" would otherwise invite loosening the server.
- [Duplicate check moving server-side later] → Today it is client-side against this team's TOPIC-002 lists and the server has no uniqueness check, so there is no cross-team oracle. Any future server-side or fuzzy check must filter by `team_id` in the query itself and needs a security review (security review D9).

**Security items deliberately not absorbed (security review §5–§8; Executive "no scope growth").** Recorded here so they are explicit rather than implicit; none changes this design:
- **Rate limiting on TOPIC-003 (D3)** and **403 denials not audited on topic endpoints (D4):** pre-existing, consistent across the topic endpoints; belong to #184's hardening pass. The add form raises the practical reach of an unthrottled endpoint, which is an argument for #184's priority, not for absorbing it.
- **Sentinel/template team protected only by the lock (D5, #188):** the flag stays a pure function of role (spec G1); no `teamId === DEFAULT_TOPICS_TEAM_ID` special case (security S4 declined). A human adds a comment on #188 that the add form now exists and the sentinel team is protected only by the lock.
- **Unicode bidi / zero-width characters in names and prompts (D7):** a spoofing concern for #184 or the first change that shows custom topics in session; not here.
- **`defaultTopicsNotActive` exposes template-team topic IDs (D8):** appended to `handoffs/default-topics-not-active-name-join.md` (an existing draft; no new handoff).
- **Creator record (§5):** `audit_log`'s `topic.custom_added` row is the interim source of who added a topic; noted in `handoffs/custom-topic-creator-attribution.md`.

## Migration Plan

No schema change. Deploy backend and frontend together or backend first: the frontend treats a missing `canAddTopics` as `false` (no add control), so a frontend-first deploy degrades to today's behaviour. Rollback is a code revert.

## Open Questions

- **H1 (settled for now):** neutral copy as above. If an organization-specific channel is ever named, it is updated through `handoffs/zero-topic-team-recovery-path.md`.
- **H2:** handoff issue numbers are TBD; the human files them. The in-session description defect is filed before approval, and the zero-topic recovery handoff is filed alongside it (Executive condition 2).
- **H3:** Priya's 15-minute hands-on check is scheduled by a human before ship.
- **H4 (human decision, copy review):** a prompt-only archived match names a row that does not display its prompt (archived rows show name, definition, provenance), so the facilitator sees no reason it matched (engineer review M7). Options: (a) show the prompt on archived rows (`prompt` is already in the payload), or (b) word the archived warning so it covers a matching question. This design keeps the current copy and display; Priya decides in the copy review, and either answer is a copy/display tweak with no structural effect.
- **H5 (human decision, product):** `checkTeamExists` deliberately does not filter `deactivated_at`, so the form can add topics to a deactivated, unlocked team (security review D6). Inherited from TOPIC-003; this design does not change it. A human confirms that is intended for the UI path, or files it against TOPIC-003.
- **H6 (human action):** comment on #188 that the add form now exists and the template team is protected only by the customization lock; comment on #184 that 403 denials on topic endpoints are unaudited and that names accept bidi/zero-width characters (security D4, D5, D7).

## Review disposition (design stage)

Reviewed by Marcus Oyelaran (Senior Full Stack Engineer, approve with conditions) and Tomás Ferreira (Application Security, approve with conditions; S1 required). The Executive's "no scope growth" condition holds: every accepted item is a correctness or hardening fix on behaviour this change already introduces or edits, or a test. No new control, endpoint, empty-state row, or handoff was added; out-of-scope findings are recorded above and in existing handoffs.

**Accepted (design, and delta specs where behaviour changed):**
- **Eng S1.** "Add submitting" lasts until the outcome's refetch settles (201, 409, network/5xx); Remove/Restore dialogs stay submitting until their refetch settles. Spec: outcome sequencing, a new in-flight scenario, and a Remove/Restore sentence + scenario. (Decisions 2, 3, 6)
- **Eng S2, M6; Sec S3.4.** `try/catch` covers `fetch()` only; post-`201` paths can only say "Added …" (new scenario for an unreadable `201` body). Error bodies parsed with `.json().catch(() => null)`; server `error.message` only from a parsed envelope; non-JSON bodies take the network/5xx path. Network/5xx runs a quiet refetch before re-enabling. (Decision 6)
- **Eng S4 option (a).** Remove's `!res.ok` branch shows the parsed server message, making the existing spec sentence true; added to task 2.1. (Decision 2)
- **Eng S5.** Row titles become `<h3 tabIndex={-1}>`; trigger beside the `h2`; "Show archived topics (n)" focuses the Archived toggle button; one `pendingFocusId`. Spec: row heading level, focus targets. (Decisions 7, 8)
- **Eng S6.** `addCustomTopic.ts`, `AddCustomTopicForm.tsx`, `ActiveTopicsEmptyState`, per-feature test files; tasks name them. No spec delta. (Decision 10)
- **Eng M1, M3, M8.** Latest-issued refetch wins; `key={teamId}` reset (spec sentence + scenario for the add form); one `clearScreenMessage()`. (Decision 11)
- **Eng M2.** One visible `add-submitting-reason` line plus `title` on each control; other visible reasons suppressed while it shows. (Decision 3)
- **Eng M4, M5; Sec "=== true".** `VoteType` reuse, `field: keyof AddCustomTopicRequest`; `canAddTopics === true` with a missing-field test. (Decisions 1, 9)
- **Sec S1 (required).** Table-driven `canAddTopics` ⇔ POST-not-403 parity test across six caller classes; spec scenario added to `topic-customization-lock`. (Decision 1, task 1.3)
- **Sec S3.1–S3.3.** Plain-text sinks; id-based focus by `topicId`, `CSS.escape` if a selector is built; XSS regression test. (Decision 8)
- **Sec D8, §5 attribution.** Notes appended to the two existing handoff drafts.

**Accepted with modification:**
- **Eng S3.** Client-owned per-field copy for server `422`s, as asked, but the unknown-field fallback is also fixed copy rather than the server message, because the validator's messages are developer text at form level too (and Sec S3.4 prefers fixed copy wherever the server body isn't the right user message). New strings go to Priya's copy pass. Spec sentence changed. (Decision 5)

**Declined / deferred (not absorbed):**
- **Sec S2** (shared `canAddCustomTopic` predicate): deferred to the #176 fix; the parity test covers drift meanwhile.
- **Sec S4** (flag `false` on the template team): declined to keep the flag a pure function of role; #188 owns the server guard (H6).
- **Sec D3, D4, D7** (rate limit, 403 auditing, Unicode bidi): #184 or later; recorded under Risks and H6.
- **Eng M7** and **Sec D6**: product/copy decisions, raised as H4 and H5 rather than decided here.

**Checked, no change:** engineer's claims table (call sites, error cascade, response shape, trim behaviour, admin rejection, existing tests surviving the quiet-refetch conversion) confirmed the design's other code claims; the Decision 2 strict-policy fallback is retained but not expected to be needed. Security §3 (duplicate check team-scoped, nonexistent team), §4 CSRF, and §5 success/lock auditing need no change.
