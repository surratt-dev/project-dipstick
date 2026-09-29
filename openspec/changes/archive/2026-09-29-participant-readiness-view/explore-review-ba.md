# BA Review — Exploration Notes, Issue #47: View Participant Readiness Before Session Begins

**Reviewed by:** Marcus Delgado (Business Analyst)
**Reviewing:** `exploration-notes.md` (Devon Calloway, Internal Champion)
**Grounded against:** `02 - Session Setup - Use Cases.md`, "View Participant Readiness Before Session Begins" (lines 374–429)

## Overall assessment

This is a strong exploration — better traced against the actual codebase than most I see, and §4 in particular (the registration gap) is exactly the kind of finding I want surfaced before design work starts rather than discovered mid-implementation. Most of what's here is specific enough to carry forward as-is.

That said, three things need to happen before this becomes a proposal: (1) one place where the notes assert a decision the source use case explicitly marks as unconfirmed, (2) one direct tension between the source AC's literal wording and the notes' own UI guidance that isn't reconciled, and (3) a handful of behaviors described only in prose (disconnect handling, sort order, the hand-off to live voting) that need to become checkable acceptance criteria, not just narrative. None of this contradicts Devon's judgment — I largely agree with the leans — but "I agree with the conclusion" and "this is documented as a decision" are different things, and scope disputes later get resolved by which one we did.

---

## 1. Clarifications needed (decisions the notes treat as settled that the source doc does not)

### 1.1 Facilitator-only visibility — asserted as settled, but the source use case flags it as open

Exploration notes §1 and §7 both state this should be treated as "settled, not open" and "confirmed, not reopened." But the source use case itself says otherwise, in two places:

- AC (line 414): "The view is visible only to the Facilitator in this pre-session context (participants see a waiting screen, not each other's names — **this should be confirmed**; see Notes)."
- Notes (line 426): "Whether participants can see the names of other participants who have joined in the pre-session waiting room is not specified. This may matter for privacy in some team contexts and **warrants a decision**."

Devon's reasoning for treating it as closed (privacy risk of a roster becoming a "check-in log") is sound, and it's consistent with `SessionLobbyPage`'s already-shipped `lobby` branch behavior (no participant list, no Start Session control for non-facilitators — confirmed in `session-lobby-routing-gap`'s design.md). I'm not asking to reopen the question. I'm asking that the proposal record it as a decision with a rationale, not carry it forward as an assumption that happens to match what the exploration notes want. This is exactly the "requirement back to a real user need" chain I need intact — someone six months from now debating whether to add participant-visible names should find a documented decision, not silence.

**Suggested rewrite for the proposal's decision record:**
> **Decision:** The participant roster is Facilitator-only. Engineers see a waiting screen during `lobby` status with no participant names or count. **Rationale:** consistent with `SessionLobbyPage`'s existing `lobby` branch, which already withholds the Start Session control and any participant-identifying information from non-facilitators; a visible roster of peers turns a waiting-room utility into a social check-in surface, which is out of character for this ritual (see BA persona note on facilitator/participant view separation).

**Suggested AC addition** (the source AC only says the view is "visible only to the Facilitator" — it doesn't say what the participant sees instead, beyond "a waiting screen"):
> - [ ] A participant (Engineer) viewing the session room during `lobby` status sees a waiting message only — no participant names, no participant count, no indication of how many others have joined.

### 1.2 "Hold the slot" is framed as inferred from schema behavior, not stated as a product decision

Exploration notes §5 concludes disconnected participants should have their row held, not removed — correctly, in my view — but the reasoning given is "`session_participants` rows are never deleted... so 'restored from the session record' is achievable." That's a technical observation about what the schema currently permits, not a statement that slot-holding is the intended behavior. The source Notes section (line 427) lists this explicitly as "an open question relevant to the connection handling logic" — it's asking for a decision, and the exploration notes answer it by pointing at an implementation detail rather than making the call directly.

The conclusion is right. The proposal needs to state it as a decision on its own terms, because "the database happens to make this easy" is not a rationale that survives a future refactor of the schema.

**Suggested rewrite:**
> **Decision:** A disconnected participant's slot is held for the duration of the `lobby` state, not released. Reconnecting (including a page refresh) restores the participant to their existing row rather than creating a new one. **Rationale:** matches the AC's refresh-restore requirement (line 413) and avoids a participant flickering out of the list on a simple tab refresh.

---

## 2. Vague area: the AC's per-row "status" requirement isn't reconciled with the notes' UI restraint guidance

Source AC (line 394, Main Flow step 4): "Each participant entry shows the Engineer's name **and a status indicating they are present but the session has not yet begun**."

Exploration notes §7 argues, correctly in spirit, against adding anything that looks like quorum tracking or attendance-taking: "A plain list of names with a disconnected marker is the right amount of UI. Anything more starts to look like attendance-taking."

These two statements are in tension and the exploration notes don't say which wins. Does simply *appearing in the list* satisfy "a status indicating present but not begun" (i.e., presence-in-list is itself the status, no separate label needed), or does the AC require an explicit per-row indicator (a word like "Waiting," a dot, a badge) beyond the disconnected marker? This is exactly the kind of ambiguity that turns into a "what did you mean by this" conversation with an engineer mid-build if it's not settled now.

My lean, for what it's worth: list membership alone satisfies the requirement, since there's only one non-disconnected state pre-session — an explicit "Present" label on every row would be redundant, not informative. But I want this decided and written down, not left to whoever picks up the ticket to guess.

**Suggested AC rewrite to remove the ambiguity:**
> - [ ] Each participant entry displays the participant's name. No additional per-row status label is required for the "present" state — appearing in the list, undecorated, constitutes the "present, not yet begun" status. A disconnected participant is the only state that receives a visible marker (see §3 below).

---

## 3. Missing acceptance criteria: disconnect/reconnect behavior is described only in Alternate Flows prose, not as checkable criteria

The source use case gives join events an explicit checkbox AC (line 411: "Each participant who joins via the join link appears in the list in real time"), but disconnect and reconnect are only described in an Alternate Flow (line 400), with no corresponding checkbox. Exploration notes §5 and §7 add real substance here (key by `userId`, mark-not-remove, no cause-of-disconnect disclosure) but that substance needs to land as testable AC lines in the proposal, not stay narrative.

**Suggested AC additions:**
> - [ ] A participant's disconnection is reflected in the roster in real time (no manual refresh), marked as disconnected — the row is not removed.
> - [ ] A participant's reconnection (including their own page refresh) clears the disconnected marker on their existing row. It does not create a duplicate row and does not reorder the list (see §4).
> - [ ] The disconnected marker does not indicate a cause (network drop vs. reauth vs. anything else) — consistent with existing connection-health UI elsewhere in the app.

---

## 4. Missing acceptance criterion: roster sort order

Neither the source use case nor the exploration notes say anything about ordering. Left unspecified, "reconnect clears the marker" (§3 above) could be implemented in a way that also re-sorts the list — e.g., if the roster is naively re-queried and re-rendered by `joinedAt`, a reconnect could look like a reorder even though the row itself is unchanged. Small thing, cheap to specify now, easy to get subtly wrong later.

**Suggested AC addition:**
> - [ ] Participants are listed in the order they joined the session (earliest first). Disconnecting and reconnecting does not change a participant's position in the list.

---

## 5. Gap at the boundary with issue #33: what happens to the roster the moment the Facilitator starts the session

Exploration notes §8 correctly scopes `FacilitatorReadinessGrid` (issue #33's component) out, and flags — appropriately, as a note to #33's owner rather than a decision made here — that the two features might share the underlying `participant_joined`/`participant_left` primitives. What's not addressed is the user-facing moment of transition: when the Facilitator clicks Start Session, does the roster view get replaced by the live-voting grid outright, does the Facilitator lose the "who's here" information at that exact moment, or does something carry over?

This isn't a request to design #33's grid here. It's a request that the proposal say explicitly whether the transition itself is in scope for #47 (e.g., "the roster view unmounts when the session advances past `lobby`; no continuity of display is guaranteed or required") so that it's a stated decision rather than whatever falls out of implementation order. This is the same category of gap as §4 in the exploration notes: a seam between two features that's easy to leave undecided until someone notices it in a demo.

**Suggested addition to Out of Scope, or a one-line Postcondition:**
> - The roster's visual continuity across the transition from `lobby` to an active-voting state is not guaranteed by this change; issue #33 owns the post-start experience.

---

## 6. Confirming the Out of Scope carries forward

Source Out of Scope (line 418) explicitly excludes "Allowing the Facilitator to remove a participant from the session." The exploration notes don't mention this, which is fine — it's inherited automatically — but I want to flag it because §5/§7's discussion of disconnected-and-held rows is exactly the kind of area where an implementer might reasonably think "well, if they're disconnected and holding a slot, shouldn't the Facilitator be able to clear it?" Worth a one-line restatement in the proposal so it isn't reintroduced as a "nice to have" partway through implementation.

---

## 7. Items I'm satisfied with as-is (no rewrite needed)

- **§4 (registration gap)** — thoroughly traced, correctly identified as blocking, correctly deferred to a design-stage security review per D7 rather than resolved by exploration-stage fiat. This is the right level of specificity for this stage; I'd only ask that the proposal make it an explicit blocking dependency in its own section, not a paragraph inside a "Findings" narrative.
- **§2 / §9.1 (which page(s) render the roster)** — appropriately left open with a stated lean, not a silent default. I'd add one framing constraint to whatever AC results: tie it back to the source Main Flow's step 1 ("Facilitator views the session room after creating the session") so a single-surface implementation can't claim AC compliance while leaving the page the Facilitator actually lands on 90% of the time roster-less. Suggested phrasing: "The roster is visible on every facilitator-facing surface that constitutes 'the session room' during `lobby` status, without requiring navigation away from the page the Facilitator lands on after session creation."
- **§7 no-manager rule** — correctly treated as a hard correctness requirement with a test, matching how `evaluateSessionSubscriberAccess`'s existing EM checks are already tested. No changes needed.
- **§9 open questions list** — appropriately left for the design stage rather than guessed at here.
