# BA Review: Pre-Session Action Item Review — Exploration Notes

**Reviewed by:** Marcus Delgado (Business Analyst)
**Source reviewed:** `exploration-notes.md` (Devon Calloway)
**Cross-referenced against:** `requirements/use cases/03 - Pre-Session Action Item Review - Use Cases.md`
**Question asked:** Are these ideas specific enough to become requirements? What's too vague to carry into a proposal?

Overall, the technical digging here is good — the EM-exclusion trace and the facilitator-from-another-team check are exactly the kind of verification I want to see before something gets asserted as settled (see the persona note on **verifying, not assuming**, in `evaluateSessionSubscriberAccess`). That part is buildable as-is. The gaps below are concentrated in three places: (1) a scope decision that quietly reshapes what the use case's Main Flow describes, (2) two open questions the notes correctly identify but don't resolve enough to hand to the implementation team, and (3) failure/error paths the use cases specify but the notes never touch.

---

## 1. Clarifications needed before this goes to `propose`

### 1.1 The read-only scope cut isn't just an implementation deferral — it changes what the use case's Main Flow means for this change

The exploration frames deferring status-update controls as low-risk ("a wiring task, not a design unknown") because the PATCH endpoint already exists. That's a fair technical read, but it undersells the requirements impact: **UC: Surface Open Action Items at Session Start**, Main Flow steps 6–7, aren't presented in the source use case as a separate feature — they're steps *within* the same use case this change is implementing:

> 6. Owners of action items are presented with inline controls to update the status of their own items.
> 7. The facilitator is presented with a control to advance past the review.

Cutting step 6 means this change delivers a partial implementation of UC1's Main Flow, not the full use case. That may be the right call, but it needs to be **stated as a deliberate, named scope reduction against UC1** in `proposal.md` — not folded into "in scope / out of scope" bullets as if it were a routine phasing decision. I'd want a sentence like: *"This change implements UC1 steps 1–5 and 7 in full; step 6 (owner inline status controls) and the entirety of UC2/UC3 are deferred to [follow-up]."* That sentence is what future-me looks for when someone asks "why doesn't the review screen let me update anything?" six months from now.

**Suggested acceptance condition to add:**
- [ ] `proposal.md` explicitly states that this change implements a subset of UC1's Main Flow (steps 1–5, 7) and defers UC1 step 6 and all of UC2/UC3, with the deferred use cases named, not just described.

### 1.2 The deferral undercuts the exploration's own stated reason for caring about this screen

Devon's opening framing is that this screen is "the only place that closes the loop on what the team said it would *do*" — and that a weak version of it breaks the trend-dashboard narrative. But a read-only screen doesn't close that loop; it only *displays* the loop's current state. Closing it requires the status-update interaction (UC2/UC3), which is exactly what's being deferred. This isn't a reason to reverse the scoping call — read-only-first is defensible — but the tension needs to be surfaced explicitly to whoever signs off on the proposal, rather than left implicit. If the "fast, cheap follow-up" doesn't land before teams start using this screen, the accountability loop this feature exists to support isn't actually delivered by shipping this change, and stakeholders should know that going in.

**Suggested acceptance condition to add:**
- [ ] `proposal.md` or `design.md` includes a one-line risk note: read-only review does not close the accountability loop by itself; the fast-follow (UC2/UC3 wiring) is required before the feature's stated value proposition is realized.

### 1.3 "Fast, cheap follow-up" is not a commitment — it's a hope

Saying the deferred write controls are "a wiring task, not a design unknown" is a useful technical observation, but on its own it isn't specific enough to prevent this from becoming exactly the kind of edge-case-turned-scope-dispute the persona is wary of. Nothing in the notes commits to *when* or *as what* (a tracked issue? a task in this same change's tasks.md marked as a follow-on? a separate change entirely?).

**Suggested rewrite:** Replace "ship as a fast, cheap follow-up" with a concrete commitment, e.g.: *"File a follow-up issue against this change before merge, scoped explicitly to: (a) rendering the existing owner/facilitator status controls on this screen, (b) wiring them to the already-shipped PATCH endpoint, (c) no new backend work required."* That turns a hope into something traceable.

### 1.4 Sort order (oldest-first) is asserted as settled but the use case itself flags it as unconfirmed

The exploration states items are "ordered oldest-first" as a simple fact about the existing backend implementation. But UC1's own Notes section says: *"The ordering logic (oldest session first) is an assumption; implementors should confirm preferred sort order with stakeholders."* The exploration doesn't confirm this with a stakeholder — it just observes that the code already does it this way. Inheriting an existing implementation default isn't the same as resolving an open question the requirements explicitly called out.

**Suggested acceptance condition to add:**
- [ ] `proposal.md` records oldest-first ordering as a **confirmed product decision** (not just "what the code already does"), or flags it for stakeholder confirmation before implementation.

### 1.5 Session-status gating for the new GET endpoint is an open question dressed as a detail

The proposed endpoint spec buries a real product decision inside a bullet: *"gates on session status being `pre_session` (or `active`, if a late joiner arrives after voting starts — worth a product decision)."* This is Open Question #1 restated inline, and it directly determines the endpoint's authorization logic — it can't be left open when the endpoint gets built.

**Suggested rewrite for `design.md`:** State the default explicitly and give it an acceptance condition:
- [ ] A participant joining after the session has transitioned to `active` does **not** receive the pre-session action item review (the endpoint returns 404/409 for non-`pre_session` sessions, or equivalent). Rationale: per UC1, the review phase is a one-way transition; a late joiner during active voting sees the current topic, not the closed review.

If the answer turns out to be "yes, show it anyway," that needs its own acceptance criteria (what does a late joiner see alongside an in-progress vote?) — right now neither answer has one.

---

## 2. Vague areas that need concrete acceptance conditions

### 2.1 Error/failure states for this screen are unaddressed

UC1's Postconditions are explicit: *"Failure: If the query fails, the application displays an error and does not advance to topic voting. The session remains in the Pre-Session Review phase."* UC: Skip Review's Postconditions add: *"An error state is shown and the session does not advance until the query succeeds."* None of this appears anywhere in the exploration notes — not for the facilitator's initial `POST /start` response, and not for the new participant-facing GET endpoint. This is a real gap, not a nice-to-have: without it, "in scope" item 4 (the new GET endpoint) has no defined failure behavior, and the facilitator's "Begin First Topic" control has no defined relationship to a failed fetch.

**Suggested acceptance conditions to add to scope:**
- [ ] If the participant-facing GET endpoint fails or returns an error, the frontend displays an explicit error state (not a blank screen or infinite spinner) to that participant.
- [ ] If the facilitator's own action-items payload (from `POST /start`) is missing or errored, the "Begin First Topic" control is disabled until the data loads successfully, per UC1's postcondition that the session must not advance to voting on a failed query.
- [ ] Staleness-computation failures (per UC: Flag Stale Action Items' postcondition) degrade to "no indicator shown," not a blocked screen — this should be stated explicitly as in-scope behavior for this change, since the new endpoint reuses the staleness logic.

### 2.2 What actually moves participants off the review screen when the facilitator advances?

The notes trace the *entry* transition (lobby → pre_session via `session_state_change`) in detail, but never trace the *exit* transition. UC: Facilitator Advances requires: *"Activating the control transitions all participants' screens to the first topic simultaneously... The transition is immediate and does not require individual participant action."* Is there confirmation that `POST /begin-voting` emits a `session_state_change` (or equivalent) that the frontend listens for to leave the review screen, the same way entry into `pre_session` is handled? If this doesn't already exist, "wired to `POST /begin-voting`" is not sufficient scope — the screen would show a stale review after the facilitator has moved on for everyone but the facilitator's own browser.

**Suggested acceptance condition to add:**
- [ ] Confirm (or add to scope, if missing) that a successful `POST /begin-voting` broadcasts a state-change event that all connected review-screen participants act on to leave the review screen simultaneously, matching UC: Facilitator Advances' acceptance criteria — not just that the facilitator's own client transitions after a successful API response.

### 2.3 Copy/tone for staleness and empty state has no acceptance condition at all

Open Question #3 in the notes correctly identifies the risk (staleness copy reading as a "report card") but stops at "I'd want a plain-language pass" — no owner, no gate, no example text. Given this is called out as a design-time concern in Devon's own framing (item 2 under "Two of my standing concerns"), it shouldn't be left as an aspiration.

**Suggested rewrite:** Add to `design.md`'s scope, not just its risks section:
- [ ] Draft copy for the empty state and each staleness tier (yellow/orange/red — including what the badge/label text actually says, not just the color) is reviewed and approved before this change is considered ready for implementation, not "at some point before ship."

### 2.4 "Where does this screen live" is a real open question, but it's a design question, not a requirements gap — say so

Open Question #2 (extend `SessionLobbyPage` vs. new route) is legitimate and correctly flagged, but it isn't a gap in the requirements — the use cases don't care about routing structure. Framed as an "open question" alongside genuinely unresolved product decisions (like #1), it risks being treated with the same weight. Recommend `design.md` own this outright as an architecture decision with a recommendation, rather than carrying it forward into `propose` as an unresolved question needing stakeholder input.

---

## 3. Already well-specified — don't re-litigate

- EM-exclusion verification (traced through `evaluateSessionSubscriberAccess`, not assumed) — solid, matches the persona's standard of evidence.
- Facilitator-from-another-team boundary — correctly identified as already enforced elsewhere and out of scope for this screen.
- Staleness color thresholds (1/2/3+ sessions → yellow/orange/red) — UC: Flag Stale Action Items states these as a "decided requirement," and the exploration doesn't disturb that. Good.
- Reuse of `fetchPreSessionActionItems` and the `isFacilitator` flag pattern for render-gating — concrete, avoids inventing a second authorization concept.
- One open question from UC2/UC3 that this exploration incidentally answers and should be fed back: whether facilitator/owner status changes are audit-logged. The notes confirm the shipped PATCH endpoint already does audit logging — this resolves a "to be confirmed" item in UC2/UC3's Notes and should be recorded as answered when those use cases are eventually revisited, not left marked open.
