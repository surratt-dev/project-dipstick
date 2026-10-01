# Exploration Notes: topic-add-form-and-empty-state (#55, re-scoped)

**Explored by:** Devon Calloway (Internal Champion / founding advisor)
**Date:** 2026-10-01 (revision 2, after Facilitator and BA review)
**Mode:** `opsx:explore`. These notes record my thinking. They are not a proposal. Revision 2 settles the forks the reviewers asked to have settled before the proposal (section 7), and turns the "e.g." strings into exact copy where I can stand behind the words.

**Reviews addressed:** `explore-review-facilitator.md` (Priya Nair), `explore-review-ba.md` (Marcus Delgado). Section 8 records what I took, what I declined and why. Follow-up issues the reviewers asked for are drafted under `handoffs/` for a human to file. I have not filed anything.

---

## 0. What this change is (after re-scope)

The Topic Management screen already exists (`packages/frontend/src/pages/TopicManagementPage.tsx`, route `/team/:teamId/topics`, spec `openspec/specs/topic-management-screen/spec.md`). #51 through #54 built it up piece by piece. Two gaps remain against `requirements/use cases/08 - Topic Management - Use Cases.md`:

- **(a)** Add Custom Topic (TOPIC-003) has no frontend form. The backend `POST /api/v1/teams/:teamId/topics` shipped under #50.
- **(b)** The empty active-topics state just says "No active topics." The use case wants "a prompt to re-add topics or add a custom one."

```
TopicManagementPage (after this change)
┌───────────────────────────────────────────┐
│ ← Team   Topic Management                 │
│ [lock notice, if locked]                  │
│ Active Topics (12)        [Add custom topic]   ← trigger in heading row (7.6)
│   ┌ inline add form (when open) ────────┐ │   ← opens under the heading
│   └──────────────────────────────────────┘ │
│   ORDER_COPY / locked-reason lines        │
│   ┌ row: name [Custom] / prompt / vote ─┐ │   ← Custom tag (2.5)
│   │ Our team's definition [Edit]        │ │
│   │ description                          │ │
│   │ [Top][Up][Down][Bottom] [Remove]     │ │
│   └──────────────────────────────────────┘ │
│   <empty state, derived from flags>       │   ← (b), decision table 3.1
│   [reorder save bar]                      │
│ Archived Topics (n) ▼                     │
│   rows [Custom] with [Restore]            │
└───────────────────────────────────────────┘
```

---

## 1. Why this matters to the ritual

One of the properties I've cared about from the start is **topic flexibility within guardrails**: a team can adapt the topic set, but the defaults stay visible and easy to get back to. Without an add form, half of that promise isn't kept. A team can only shrink or reshuffle the canonical twelve topics. It can't add the one thing that's specific to its own context, like an on-call rotation, a legacy system, or a partner integration. Today a facilitator would have to curl an API to do that. In practice, that means nobody will.

Priya's point (review O1) sharpens who this form is for. The trigger is almost always a live moment ("the thing that's actually killing us is the partner integration"), but the topic gets typed in days later, often by a different facilitator. So the form is a **between-sessions handoff tool**. It is never used while a session is running, which means a slightly richer form here costs nothing in the room. That's why I'm comfortable adding inline vote-type guidance (7.2) and a duplicate check (7.4) without worrying about chrome.

Constraints that hold and must not loosen:

| Constraint | How it shows up in this change |
|---|---|
| **First-session lock** (the first session runs on the canonical set) | No add affordance at all on a locked team. No disabled button that invites a click: the lock notice already explains why. The server answers 409 anyway. Stated as a negative scenario in the spec. |
| **Facilitator from another team** | TOPIC-003 rejects a facilitator who is a member of the team (`FACILITATOR_IS_TEAM_MEMBER`). The form must never be the thing that softens that. A 403 in the form follows the existing definition-save 403 precedent (7.8). |
| **No-manager rule** | EMs never reach TOPIC-002 (it rejects them), so they never see this screen. No change needed. Don't add a path that leaks topic config to EMs (#187: TOPIC-001 already does). |
| **Engineers can't add** (use case AC) | Verified: TOPIC-002 admits only `global_role = 'facilitator'` who is not an active team member, or `application_admin` (`content.ts` ~L511-L520). Engineers get a 403 before the screen renders, so the AC is met by the existing route guard. The proposal cites this plus the existing TOPIC-002 authorization test. |
| **Defaults stay visible and restorable** | Custom topics are visibly custom. The empty state points back to Archived, not just to "add your own". The duplicate check points back to an archived topic before letting someone recreate it. |
| **The app should fade into the background** | This page already carries three interlock systems. The add form adds a fourth busy state *only while submitting*. A dirty-but-idle form locks nothing (7.1). |

---

## 2. Gap (a): Add Custom Topic. What the backend actually accepts

From `packages/backend/src/routes/topics.ts` (~L262-L340, L699-L820) and `openspec/specs/add-custom-topic/spec.md`:

**Request** (`POST /api/v1/teams/:teamId/topics`)

| Field | Rule (server) | Use case wording |
|---|---|---|
| `name` | required, trimmed, 1..100 | "topic name (required)" ✅ |
| `prompt` | required, trimmed, 1..500 | "topic prompt (required, distinct from the name)" ✅ see 2.2 |
| `voteType` | `finger` \| `roman` \| `modified_roman` | Finger / Roman / Modified Roman ✅ |
| `firstSessionDescription` | optional, ≤500, **not trimmed**, `null` allowed | "topic description (optional)" ⚠️ see 2.1 |

**Response 201:** `{ topicId, name, prompt, voteType, displayOrder, isDefault: false, createdAt }`. No shared type exists for it. The response doesn't echo `firstSessionDescription`. The frontend refetches TOPIC-002 (quietly, 7.1) rather than building a row from the 201.

**Errors:** `403 NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER`, `404 TEAM_NOT_FOUND`, `409 TOPIC_CUSTOMIZATION_LOCKED`, `422 VALIDATION_FAILED` with `error.field`. This form is the first consumer of `error.field`.

**Read side (TOPIC-002):** `active[]` exposes `name`, `isDefault`, `firstSessionDescription`; `archived[]` exposes `isDefault`. Apart from the `canAddTopics` flag (2.3), no backend read change is needed.

### 2.1 Finding (important): "description" is really `first_session_description`, and a custom topic's description will never show in a session

- The column is `topics.first_session_description`. The 12 seeded defaults use it for a first-session orientation paragraph.
- `facilitator-sessions.ts` ~L1274 sends it to participants **only when `sessions.is_first_session` is true**.
- A custom topic can only be added after the first session (lock). So **a custom topic's description can never reach a participant.** It only renders on the management screen.
- Use case "View Topics During a Live Session", step 5, says a description is shown in session if it exists. For custom topics that never holds.

The topic that most needs orientation in the room (the unfamiliar, team-invented one) is the only kind that can never get it. Priya put it better than I did: **a custom topic's first appearance is effectively a first session for that topic.**

**Correction from review (Priya, O2):** my option 2 ("add a team definition to explain it during sessions") has the same hole. Team definitions reach the room only through the `session_topics.topic_annotation` snapshot, and that is pending #175. So neither field reaches participants today. The form copy must not promise in-session display for *either* field.

**Decision (C1, with Marcus as owner of the wording per his review):** option 1 (honest label) plus an option 2 hint worded so it doesn't promise display. Exact strings in 7.3. The in-session gap and the real fix (first-appearance orientation) are drafted as issues in `handoffs/` so they are tracked defects against UC step 5, not a note in this file. The proposal must cite the filed issue numbers.

Also: the server doesn't trim the field, so `"   "` is stored as-is and the page renders a whitespace-only div. The form sends `null` when the trimmed value is empty, and the row renderer skips whitespace-only descriptions already stored.

### 2.2 Clarification: "prompt distinct from the name" means a separate field, not that the values must differ

The archived design (`2026-09-29-topic-customization-lock-and-add-custom-topic/design.md` L8, proposal L15) shows "distinct from" was a documentation fix: `name` became its own field. The server doesn't compare them. **Negative requirement for the spec:** no client-side rule requires name and prompt to differ.

Field guidance, grounded in `requirements/voting mechanics.md` ("The facilitator will state the prompt, the vote type and the meaning of the vote"):
- **Name** is the short label on this screen and in trend views (seeds: "Project Trend").
- **Prompt** is the question the facilitator reads aloud and people vote on.
- **Vote type** decides what the trend line can say. Exact copy in 7.2.

On Priya's Q2 (which field do participants see most prominently): I checked, and there is no participant topic display in the frontend yet. The session snapshot carries both `topic_name` and `topic_prompt` (`facilitator-sessions.ts` ~L1198). The voting mechanics doc says the facilitator *states the prompt*, so the helper text above follows the ritual, not a screen. When the participant view is built, it should show the prompt prominently. That belongs in that change, not here.

### 2.3 Finding: application admins see the screen but TOPIC-003 rejects them (#176)

```
                    TOPIC-002 view   Remove/Restore/Reorder   Definition (007)   Add (003)
Standing facilitator     ✅                 ✅                      ✅              ✅
Application admin        ✅                 ✅                      ❌ (by design)  ❌ (#176 BUG)
Engineer / EM            ❌ (403)            –                       –               –
```

**Decision (C2):** option B. Add a `canAddTopics` presentation flag to TOPIC-002, today `actorGlobalRole === 'facilitator'`. Don't absorb #176. Option A (reuse `canEditAnnotations`) stays rejected because the two rules diverge on purpose once #176 lands.

Gating rule: the add control renders **if and only if** `isCustomizationLocked === false && canAddTopics === true`. No disabled or teaser variant anywhere.

| Caller reaching TOPIC-002 | `canAddTopics` (this change) | After #176 |
|---|---|---|
| Standing facilitator, not a team member | true | true |
| Application admin | **false (temporary, FR-8.2 defect #176)** | true |

Marcus is right that the words "temporary" and "#176" must sit **in the spec requirement text itself**, not only in design.md. Otherwise archive merges a bug into the living spec as a product rule.

Admins see nothing in place of the button (Priya Q6). No explanatory note: it would just invite a duplicate bug report against #176.

### 2.4 Interlocks with the existing page

Existing rules (spec L446, `TopicManagementPage.tsx` ~L981-L1007):
- Reorder draft dirty/saving → Remove, Restore, definition edit disabled.
- Definition dirty/saving → moves, Remove, Restore disabled.
- Remove/Restore dialog open → moves, Save order, definition edit disabled.

Hazards specific to adding a topic:

1. **Add while the reorder draft is dirty makes the new topic invisible.** `displayedTopics` is built from `draftOrder.flatMap(...)`, so a topic not in the draft isn't rendered, and the later `PUT /topics/order` would miss the new id (stale 409). **Submit must be disabled while the draft is dirty or saving**, with `LOCKED_BY_DRAFT_REASON`. This is a bug, not a style choice.
2. **Add success → `loadTopics()` → failure replaces the whole screen.** Resolved by 7.1: the add path uses the quiet refetch.
3. **Add while a Remove/Restore dialog is open.** Submit disabled, reusing `DEFINITION_DIALOG_OPEN_REASON` (its text, "Finish or cancel the open remove or restore first.", already says exactly the right thing).
4. **The reverse direction** (what a dirty add form locks): decided in 7.1.
5. **`beforeunload`** arms when the add form is dirty (definition of dirty in 7.1). In-app navigation is not intercepted, consistent with the screen's existing guard (spec ~L236).
6. **Placement, focus and outcome copy:** 7.6 and 7.7.
7. **Reorder after add** works naturally. The new row appears last.

Final matrix. Every cell is ✕ (disabled) or – (unaffected). No "?".

```
Busy state ↓ / control →   moves  SaveOrder  Remove  Restore  DefEdit  AddTrigger  AddSubmit  AddFields
reorder dirty/saving         –       –         ✕       ✕        ✕        –           ✕          –
definition dirty/saving      ✕       –         ✕       ✕        –        –           ✕          –
remove/restore dialog open   ✕       ✕         –       –        ✕        –           ✕          –
add submitting               ✕       ✕         ✕       ✕        ✕        n/a         ✕          ✕ (read-only)
add form open, clean         –       –         –       –        –        n/a         –          –
add form open, dirty         –       –         –       –        –        n/a         –          –
```

Why the trigger and fields stay usable during other busy states: opening the form and typing can't corrupt anything. Only *submitting* triggers a refetch that interacts with drafts, so only Submit is gated. A facilitator can type a topic while an order change is pending, then save the order, then submit. Nothing is lost and nothing is blocked that doesn't need to be.

Disabled-reason copy: reuse `LOCKED_BY_DRAFT_REASON`, `DEFINITION_LOCKS_ACTIONS_REASON` and `DEFINITION_DIALOG_OPEN_REASON` for Submit. During "add submitting" the other controls need one new constant: `ADD_TOPIC_SUBMITTING_REASON = "Wait for the new topic to finish saving."` No control invents its own string.

Spec scenarios: one per ✕ cell that involves an add control, in both directions. That's 8 (3 for Submit gated by others, 5 for "add submitting" disabling others), plus two negative scenarios for the clean and dirty rows ("a dirty add form does not disable moves/Remove/Restore/definition edit").

### 2.5 Finding: custom topics aren't visually distinguished today

Active and archived rows where `isDefault === false` show a text tag reading exactly **"Custom"**, included in the row's accessible name (not colour or icon only). Default rows show no tag: the baseline shouldn't look decorated. The rule is unconditional (it also applies on locked teams, even though a locked team can't have custom topics yet).

### 2.6 Finding: name collisions with default topics break `defaultTopicsNotActive`

`GET /topics/all` computes `defaultTopicsNotActive` with `LEFT JOIN topics t ON t.team_id = $1 AND t.name = dt.name` (content.ts ~L640). There's no uniqueness constraint on `(team_id, name)` and TOPIC-003 doesn't check names, so a same-named custom topic produces wrong or duplicated rows.

**Decision (C5):** this change **does not read `defaultTopicsNotActive`**, and the proposal says so in those words. The join fix is out of scope and drafted as a sibling issue under #184 in `handoffs/`. The duplicate check in 7.4 reduces how often the collision happens, but it is a warning, so the backend fix is still needed.

### 2.7 Related issues: out of scope, but they touch this change

- **#176:** see 2.3.
- **#188:** no new exposure from the UI. TOPIC-003 is already in #188's "check at the same time" note.
- **#184:** the hardening items cover TOPIC-003. Submit is disabled while submitting (no double-post). #184 item 1 is one way a team reaches zero active topics (3.1).
- **#187:** not touched. This screen reads TOPIC-002 only.
- **#175:** the postcondition "It will appear in the next session run" is blocked on #175 for every topic. Copy says nothing about sessions at all (7.7). Recorded in the proposal as a known deviation from the use case postcondition, blocked on #175.

---

## 3. Gap (b): the empty active-topics state

### 3.1 When can the active list actually be empty?

The use case trigger ("all have been removed") **can't happen through the UI**: TOPIC-004 has a last-active-topic guard (`409 TOPIC_LAST_ACTIVE`). Real ways to get there:

1. **The #184 race:** two concurrent archives both pass the COUNT guard. Unlocked, with archived topics.
2. **Provisioning gap:** I checked `POST /api/v1/teams` (`facilitator-sessions.ts` ~L598). It copies topics with `INSERT ... SELECT ... FROM topics WHERE team_id = <template> AND is_default = true`. If the template team has no rows, that statement copies **zero rows and succeeds**. The team and its first (lobby) session are committed with no topics. The team is locked and has nothing archived. So this case is reachable from a configuration error, not just theoretical.
3. Manual or support data fixes.

**There is no in-app recovery for case 2.** No endpoint copies template topics onto an existing team, and admins have no button for it. Copy must not name a role that has no button (Marcus C6, Priya O5). The recovery path is drafted as a follow-up in `handoffs/`.

Decision table on observable flags only:

| `isCustomizationLocked` | `archived.length` | `canAddTopics` | Empty-state content (exact) |
|---|---|---|---|
| true | any | any | "This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics." No actions. |
| false | > 0 | true | "This team has no active topics." + [Show archived topics (n)] + [Add custom topic] |
| false | > 0 | false | "This team has no active topics." + [Show archived topics (n)] |
| false | 0 | true | "This team has no active topics." + [Add custom topic] |
| false | 0 | false | "This team has no active topics. Topics can't be added from this account yet." No actions. |

Notes on the copy:
- Row 1 names a human channel, not an application role. "The people who run this application for your organization" is honest for an on-premises deployment where the fix is a database operation. If the organization has a real support channel, the copy should name it (human decision H1).
- Row 1 doesn't repeat the lock notice's "after the first session" explanation, because a team with no topics can't complete a first session. The proposal should confirm the lock notice and empty state don't contradict each other on screen.
- Row 5 is reachable only by an admin (until #176) on a race-emptied team with nothing archived, which is effectively impossible. The copy is deliberately plain and doesn't mention #176.

Conditions:
- "Show archived topics (n)" expands the Archived section and moves focus to its heading. No inline Restore buttons: one restore path, one dialog, one set of interlocks.
- "Add custom topic" in the empty state opens the same form as the heading trigger. While the empty state is shown, the heading trigger is hidden, so there's one entry point on screen.
- After a successful restore or add, the list replaces the empty state without a full-screen reload (quiet refetch, 7.1).
- **Testing (V10):** cases 1 and 2 can't be reached through the UI. All five rows are covered by component tests with a mocked TOPIC-002 response. That is the stated test approach, not an omission.

Because this state is rare, keep it small. No onboarding illustration.

### 3.2 What "re-add topics" points to

- The Archived section (collapsed by default), via "Show archived topics (n)".
- **Not `defaultTopicsNotActive`.** Its `topicId` can fall back to the template team's id (content.ts ~L700), which TOPIC-005 would 404 on, and there's no endpoint to copy a template topic onto a team. A "restore the default set" button is a separate future change with a backend endpoint. I'd love one, but not here.

### 3.3 Interaction with existing state when empty

With 0 active topics the save bar and definition editor don't exist. The empty state only interacts with the Restore dialog and the add form. Both now use quiet refetch, so neither can wipe the other.

---

## 4. Risks if the design drifts

- **The form becomes a general topic editor.** Editing an existing topic's vote type would break trend continuity. This form creates new topics only (Non-Goal). The form says so up front (7.2).
- **"Add" shows on locked teams as a disabled teaser.** Don't. A greyed-out button is a standing invitation to ask for an exception.
- **The description label misleads facilitators** (2.1).
- **Custom topics indistinguishable from defaults** (2.5).
- **Interlock regressions.** Test the matrix in 2.4, not just the happy path.
- **Admin dead-end** (2.3).
- **Duplicate trend histories.** A removed default retyped as a new custom topic splits its trend. The duplicate check (7.4) is the guard. It's a warning, so it can be bypassed on purpose, but not by accident.
- **Duplicate topics from a failed refetch.** If a 201 is followed by a refetch failure and the screen shows a generic error, the facilitator resubmits. Covered in 7.7.

---

## 5. Open questions (revision 2)

Most of revision 1's questions are now decided (section 7). What remains needs a human, and is listed plainly in section 9.

---

## 6. Suggested scope line

**In:** inline add form (name, prompt, vote type with no default and inline scale explanations, optional description with honest labelling) on unlocked teams where `canAddTopics` is true. Client-side required-field validation. 422 `error.field` mapping with values kept. Duplicate name/prompt check against active and archived topics (non-blocking). Append, quiet refetch, status message, focus on the new row. Quiet refetch also for the Remove and Restore success paths (7.1). "Custom" tag on active and archived rows. Active topic count in the heading. Add-related interlocks per the 2.4 matrix. `beforeunload` for a dirty form. Discard confirmation on Cancel. Empty-state decision table. `canAddTopics` flag on TOPIC-002. Shared `AddCustomTopicRequest` / `AddCustomTopicResponse` types (the response type documents that it omits `firstSessionDescription`).

**Out:** #176, #184, #187, #188, #175. Showing custom-topic orientation in session (handoff). The `defaultTopicsNotActive` join fix (handoff). Creator attribution on rows (handoff). A recovery path for teams with no topics (handoff). A "restore default set" endpoint. Editing existing topics. A global topic library. Fuzzy or near-duplicate matching.

---

## 7. Decisions (revision 2)

### 7.1 Dirty add-form policy (C3): loose, with quiet refetch on the add, Remove and Restore success paths

The reviewers disagree. Priya backs loose with quiet refetch. Marcus recommends strict *unless* I can show that moving all post-write refetches to the quiet path is in scope and testable. I went and counted, because that condition is checkable.

**What the code actually does** (`TopicManagementPage.tsx`):
- `loadTopics()` (the full-screen-error path) is called after a write in exactly **two** places: Remove success (~L627) and Restore success (~L678).
- Reorder save already avoids a refetch and patches `data` from the response (~L801-L812, comment: "No refetch: that would ... bring back loadTopics()'s full-page error path").
- Stale-order recovery already uses `fetchAllTopics()` (~L749-L762).
- Definition save already uses the quiet path (topic-annotation Task 8.0).

So "quiet refetch everywhere" is not a rewrite of four shipped flows. Two of the four already do it. The change is two call sites, Remove and Restore, moving from `loadTopics()` to the existing `fetchAllTopics()` helper with an inline `role="alert"` line on failure ("Archived '<name>', but the list couldn't be refreshed. Reload the page to see it." and the Restore equivalent), the same shape as the add path in 7.7. The write succeeded, so the message says so. That meets Marcus's condition: it's bounded, it reuses an established helper, and it's testable with one failure scenario per site.

**The decision:**
- A dirty-but-idle add form locks nothing (matrix rows "add form open, clean/dirty").
- The add success path, Remove success path and Restore success path all refetch with `fetchAllTopics()`. On refetch failure each reports inline and leaves the rest of the screen, including any typed add form, untouched.
- `loadTopics()` remains only for the initial load and team change.
- If the proposal review finds the Remove/Restore conversion can't be done cleanly, the fallback is Marcus's strict policy (dirty add form disables moves, Remove, Restore, definition edit), not "loose with the hole left open." Losing typed text silently is the one outcome I won't accept.

**Why this is the persona-consistent call:** the page already has three lock-out systems. A fourth that triggers on *typing* would mean a facilitator who starts writing a topic suddenly finds Remove and the move buttons greyed out for reasons unrelated to what they're doing. That's the app feeling like a state machine, which is the thing I worried about in section 1. Strict also leaves the underlying hazard (a full-screen error path that destroys drafts) in place for the next control someone adds. Fixing the cause is better than adding a fourth guard against it. The existing guards for reorder and definition drafts stay exactly as they are; I'm not proposing to relax any shipped interlock.

**Definition of dirty:** Name, Prompt or Description non-empty after trimming, or a vote type selected.

**Cancel on a dirty form (Priya O7, Marcus V4):** Cancel asks inline, inside the form (no modal): "Discard this topic?" with [Discard] and [Keep editing]. A clean form closes without asking. This deliberately differs from the definition editor, which doesn't confirm on cancel. The difference is justified: a new topic is three or four fields of composed text written for a handoff, and a definition is one field being amended. I rejected draft preservation on collapse (Priya's alternative) because hidden state that reappears later is harder to reason about and test than an explicit question.

### 7.2 Vote type: no default, inline meaning, and an up-front "can't change later" note

Both reviewers agree, and it's right for the ritual: a preselected Finger is how a team ends up with a scale it never chose. The control is a radio group with **no default selection**. Submitting without one sends no request and shows "Choose a vote type."

Exact option copy (label from `VOTE_TYPE_LABELS`, explanation from `requirements/voting mechanics.md`):
- **Finger Voting:** "Everyone shows 1 to 4 fingers, where 1 is poor and 4 is good. There's no middle option, so people have to lean one way."
- **Roman Voting:** "Thumbs up or thumbs down. Use it for yes-or-no questions."
- **Modified Roman Voting:** "Thumbs up, sideways, or down. Use it for whether something is getting better, staying the same, or getting worse."

Group helper text, shown above the options: **"You can't change the vote type after the topic is created. Changing it later means removing this topic and adding a new one, which starts a new trend."**

### 7.3 Description field (C1)

- Label: **"Description (optional, shown on this screen only)"**
- Helper: **"Engineers won't see this during sessions. Use it as a note for whoever facilitates this team. A team definition is the place to explain what this topic means for your team."**
- Trimmed; empty after trimming is sent as `null`. Whitespace-only stored values aren't rendered.

I declined Marcus's helper sentence "To explain this topic in sessions, add a team definition after you create it." It promises in-session display that #175 doesn't deliver yet. Priya caught this (O2).

Name helper: **"A short label for this screen and trend views."** Prompt helper: **"The question you'll read aloud for people to vote on."**

### 7.4 Duplicate check (C4): name or prompt, exact after normalising, non-blocking, on submit

Marcus recommends name only, with prompt deferred. Priya wants name and prompt. I'm taking **both, with exact matching only**, and deferring fuzzy matching.

Why prompt is in: the case that matters most is a team retyping a removed default. Default *names* are labels like "Production Code — Adding Features" that nobody retypes from memory. What people remember and retype is the *question*: "Is the test suite effective?" A name-only check misses the very case that splits a trend history. The use case's own open note is about duplicate prompts. Exact match on a normalised prompt is the same code path and the same test shape as the name check, so it's not "a different feature." Near-duplicate or fuzzy matching *is* a different feature. That part is deferred, not dropped.

Rule:
- Normalise by trimming and case-folding. No other normalisation.
- On Submit, after required-field validation passes: if the normalised name equals any active or archived topic's normalised name, **or** the normalised prompt equals any active or archived topic's normalised prompt, send no request. Show an inline warning in the form.
- Active match: **"This team already has an active topic called '<existing name>'. Two topics with the same name or question can confuse people during the vote."** [Add anyway]
- Archived match: **"This team has an archived topic called '<existing name>'. Restoring it keeps its history in one trend."** [Show it in Archived topics] (primary) [Add as a new topic anyway]
- If both an active and an archived topic match, show the archived message. It's the one that protects the trend.
- "Show it in Archived topics" expands Archived and focuses that row. The add form stays open with its values. There's no new restore path.
- "Add anyway" / "Add as a new topic anyway" sends the request unchanged. The server doesn't enforce uniqueness.
- The check runs on submit, not on blur: simpler and testable.
- The warning dismisses itself if the user edits the matching field.

### 7.5 Client-side validation (V1)

- Name, Prompt and Vote type are marked required. Description is marked optional.
- Submit with a blank name or prompt (whitespace-only counts as blank) sends no request. It shows an inline error on each failing field ("Enter a topic name." / "Enter a prompt." / "Choose a vote type."), moves focus to the first failing field, and keeps all values.
- `maxLength`: name 100, prompt 500, description 500. A visible character counter appears once a field reaches 80% of its limit. I'm not adding a softer suggested name length (Priya Q5): there's no participant voting card yet to measure against, so any number would be invented. Revisit when that view exists.
- Server 422 with `error.field` in {`name`, `prompt`, `voteType`, `firstSessionDescription`}: show `error.message` on that field and focus it. No field or an unknown field: show it at form level. Values are kept either way.

### 7.6 Placement and discoverability (Priya O6, Marcus V4)

- The "Add custom topic" trigger sits in the Active Topics heading row, so it's visible without scrolling past twelve rows on the first visit after unlock.
- The heading shows the active count, "Active Topics (12)", matching the existing "Archived Topics (n)". It's a quiet count, not a warning (Priya Q4). Long lists are how sessions overrun, and a count lets facilitators notice that without the app nagging.
- The form opens inline directly under the heading. No modal, no route change. One form at a time; the trigger is hidden while the form is open.
- On open, focus moves to Name. On Cancel, focus returns to the trigger.

### 7.7 Submit outcomes (V6)

- **In flight:** Submit reads "Adding…" and is disabled; fields are read-only; other controls are disabled per the matrix.
- **201:** the form closes and resets. Quiet refetch. A `role="status"` line reads exactly **"Added '<name>' to the end of the list. Use the move buttons to change where it falls."** If it's the only active topic (no move buttons), just **"Added '<name>'."** Focus moves to the new row's heading. The message stays until the next action on the screen (matches "Order saved.").
  - I declined Marcus's clause "It will be included in sessions created from now on." It's a promise blocked on #175. The copy says nothing about sessions.
- **201 then refetch failure:** the topic was created, so the message must say so and must not invite a resubmit: **"Added '<name>', but the list couldn't be refreshed. Reload the page to see it."** The form stays closed. Marcus caught this one, and it's the case most likely to create duplicate topics.
- **403 (either code), 404:** the form stays open with values. Form-level `role="alert"` shows the server message. Mirrors the existing definition-save 403 handling (screen spec ~L281).
- **409 `TOPIC_CUSTOMIZATION_LOCKED`:** form-level alert **"Topics can't be added to this team right now."**, then a quiet refetch, so the lock notice appears and the add control disappears per the gating rule.
- **Network or 5xx:** the form stays open with values. Form-level alert **"The topic couldn't be added. Try again."** Submit re-enabled (use case: "The Facilitator can retry").

### 7.8 Shared types (Q6)

In scope: `AddCustomTopicRequest` / `AddCustomTopicResponse` in `packages/shared/src/types/topic.ts`.

---

## 8. Review response log

| Item | Source | Disposition |
|---|---|---|
| Option-2 hint has the #175 hole too | Priya O2 | **Accepted.** 2.1, 7.3. |
| First-appearance orientation as the real fix | Priya O2 | **Accepted as a follow-up.** `handoffs/custom-topic-first-appearance-orientation.md`. |
| Vote type: inline meaning, no default, "can't change" note | Priya O3, Marcus V2 | **Accepted.** 7.2 with exact strings. |
| Duplicate check in scope, offers "Show in Archived" | Priya O4, Marcus C4/V7 | **Accepted, with name + prompt exact match** (Priya's scope, Marcus's precision). Marcus's "prompt deferred" declined, rationale in 7.4. Fuzzy matching deferred. |
| Small, honest empty state | Priya O5, Marcus V9 | **Accepted.** Decision table with exact copy, 3.1. |
| Add trigger visible without scrolling | Priya O6 | **Accepted.** 7.6. |
| Dirty-form policy | Priya O7 (loose), Marcus C3 (strict) | **Loose + quiet refetch**, after showing Marcus's own condition is met (2 call sites, not 4 flows). Strict is the named fallback. 7.1. |
| Discard guard on dirty Cancel | Priya O7, Marcus V4 | **Accepted as a confirm.** Draft preservation on collapse declined, 7.1. |
| Success copy mentions reordering | Priya O8 | **Accepted.** 7.7. |
| Success copy "included in sessions created from now on" | Marcus V6 | **Declined.** It promises something #175 blocks. 7.7. |
| Helper "add a team definition to explain it in sessions" | Marcus V3 | **Declined.** Same #175 problem. 7.3. |
| Review final field labels | Priya Q1 | **Accepted.** Priya reviews the 7.2/7.3/7.4/7.7 strings before specs are approved. |
| Which field participants see | Priya Q2 | **Answered.** No participant topic view exists yet; the ritual has the facilitator read the prompt. 2.2. |
| Creator/created-at on custom rows | Priya Q3 | **Follow-up.** `topics` has no `created_by` column, so attribution needs a migration and a TOPIC-003 write change, which is too much for this change. `handoffs/custom-topic-creator-attribution.md`. |
| Active topic count | Priya Q4 | **Accepted.** Heading count, 7.6. |
| Soft name-length counter | Priya Q5 | **Partly accepted.** 80% counter on all fields; no invented soft limit. 7.5. |
| Admin sees nothing | Priya Q6 | **Accepted.** 2.3. |
| 15-minute hands-on check | Priya #9 | **Accepted** as a pre-ship task in the proposal. Scheduling it is a human item (H3). |
| C1 owner and wording | Marcus | **Accepted** Marcus as owner; strings in 7.3 (amended per Priya). |
| C2 `canAddTopics`, "temporary, #176" in spec text | Marcus C2/V5 | **Accepted.** 2.3. |
| C5 join fix out of scope, sibling issue | Marcus | **Accepted.** `handoffs/default-topics-not-active-name-join.md`. |
| C6 recovery copy must not name a role with no button | Marcus, Priya O5 | **Accepted.** 3.1, plus the finding that the provisioning gap is reachable. `handoffs/zero-topic-team-recovery-path.md`. Real support channel is H1. |
| C7 Engineers can't add | Marcus | **Verified** against `content.ts`. 1. |
| C8 403 precedent | Marcus | **Accepted.** 7.7. |
| V1 client validation | Marcus | **Accepted.** 7.5. |
| V4 principles → conditions | Marcus | **Accepted.** "Keep it small" is now the 2.4 matrix rows plus 7.6. |
| V8 matrix with no "?" + dirty definition + new reason constant | Marcus | **Accepted.** 2.4. |
| V10 test approach for unreachable states | Marcus | **Accepted.** 3.1. |
| V11 shared types | Marcus | **Accepted.** 7.8. |
| V12 testable Custom tag | Marcus | **Accepted.** 2.5. |
| Use case trigger wording ("all have been removed") | Marcus traceability | **Follow-up.** `handoffs/use-case-empty-state-trigger-wording.md`. |
| In-session description gap as a tracked defect | Marcus C1 | **Accepted.** `handoffs/custom-topic-description-never-shown-in-session.md`. The proposal cites the filed number. |

---

## 9. Needs a human decision

- **H1. Real recovery channel for a team with no topics.** The empty-state copy (3.1 row 1) currently says "Ask the people who run this application for your organization…" If there is an actual support channel or contact to name, someone who knows the deployment has to supply it. The copy is honest as written, so this doesn't block the proposal, but it should be settled before the spec is approved.
- **H2. File the six drafted issues in `handoffs/`** and put the numbers in the proposal. The in-session description gap must be filed before the proposal is approved (Marcus C1).
- **H3. Schedule Priya's 15-minute hands-on check** on a test team before ship (one fresh custom topic, one colliding with an archived default).
