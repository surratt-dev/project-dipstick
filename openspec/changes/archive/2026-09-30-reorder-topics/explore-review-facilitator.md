# Explore Review: Reorder Topics (TOPIC-006, #52), Facilitator Perspective

**Reviewer:** Priya Nair (Facilitator, SME)
**Reviewed:** `exploration-notes.md` (Devon Calloway, 2026-09-30)
**Grounding:** `TopicManagementPage.tsx`, Use Case "Reorder Topics" in `08 - Topic Management - Use Cases.md`

---

## Overall read

This is a solid exploration, and I agree with the positions that matter most to me: the lock covers reorder, sessions that already exist are never touched, nothing gets sorted automatically, and there is no per-session reorder path that goes around the lock (FR-2.7). The backend analysis in §3 is beyond my expertise, but the archived-row collision in §3b is the kind of issue I would notice as "Remove suddenly broke the week after I reordered," so I'm glad it was caught early.

My concerns are about **when and how a facilitator actually does this**. The notes treat reorder as a list-editing problem. In practice it's a session-prep task, usually done in the few minutes before a session or right after a retro where the team said "we keep running out of time for the heavy topics." That context brings friction the notes don't cover yet.

---

## Observations

### O1. Up/down buttons alone are slow with this screen's row height
The notes make Move Up / Move Down the primary control, and I agree it's the right accessible baseline. But each active row today shows the name, the full prompt, the vote type, and the first-session description (`TopicManagementPage.tsx:411-434`). With 11 default topics, moving the last topic to the top means **10 taps while scrolling a tall list** and following the row as it moves. On a tablet that's tedious and easy to get wrong. The most common real edits are "move this one to the front" (warm-up) and "move this one to the end" or "pull it up from the end" (heavy topics getting skipped), so those long jumps are exactly the moves that need to be cheap.

### O2. Position numbers aren't shown today
The active list has no visible position numbers. The mockup in §5 adds them ("1.", "2."). They should be part of the spec, not left as mockup decoration. They're how a facilitator checks "warm-up first, heavy ones in the middle" at a glance, and how two facilitators talk about the order ("move #7 up to #3").

### O3. The biggest real-world trap is "I already created the session"
The notes handle this correctly on the server (snapshot at creation) and in the copy ("sessions created after saving"). But the usual facilitator sequence is: open the session lobby → realize the order is wrong → go to Topic Management → reorder → save → return to the lobby, which still uses the old order. Explanatory copy is easy to miss. If a session for this team is already created and not yet completed, the save confirmation should **say so directly**: e.g. "Saved. Note: the session already created on <date> will keep its original order." Otherwise the first time I use this for real, I'll think it's broken. This ties into the `topic-skip-and-creation-time-confirmation` stub, and it should be named as an explicit scenario, not only a copy guideline.

### O4. Explicit save is right, but it has to feel finished
I agree with draft-then-save (the use case requires it, and it's the right choice: I don't want half-arranged orders showing up in someone's session). Things that are missing:
- A clear **"Order saved"** confirmation that stays up long enough to see and then goes away. Not a modal.
- The Save button disabled when the draft equals the saved order. That includes the case where I move a topic down and back up again: "dirty" should mean "differs from saved," not "has been touched."
- "Discard" should revert immediately with no confirmation. It's cheap and reversible.

### O5. Dirty draft plus Remove/Restore: disabling is right, but explain it
§5 suggests disabling Remove/Restore while the order is dirty. I support that, but a disabled button with no reason is a small puzzle for the person using it. Add inline text or a tooltip: "Save or discard your order changes first." Also think about **where** the Save/Discard bar sits. With a long list it has to stay visible (sticky, or repeated at the bottom), or the facilitator moves topic 11 up and then can't find Save.

### O6. Stale-list failure must not discard my work silently
The 409 `TOPIC_ORDER_STALE` idea is good. The UI behavior matters just as much. If a co-facilitator archived a topic in another tab, I should see what changed ("The topic list changed since you opened this page") and get a **reload that keeps my relative ordering where it can**, rather than losing a five-minute arrangement. At minimum, don't wipe the draft before I've read the message.

### O7. Lock feedback is mostly already handled. Keep it quiet
The locked state already hides Remove and shows a notice (`:389-402`). Hiding the reorder controls the same way is right. The only way to hit the 409 lock from this UI is an edge case (stale page state, or a crafted request), since the lock only moves from locked to unlocked. The generic error treatment is enough for that path: no special dialog, just "Topics can't be customized until the first session is complete" plus a reload. Don't over-design this.

### O8. Continuity across facilitators is missing
I rotate between three teams, and other people facilitate them too. The audit row with before/after order (§4, Q7) is good for forensics, but nobody reads audit logs before a session. A small **"Order last changed by <name> on <date>"** line on the Topic Management screen would answer "why is Deployment first now?" without a handoff conversation. That's success criterion #3 in my persona. It's cheap, and it's the facilitator-visible side of the audit data Devon already wants to capture.

### O9. Will this disappear into the background during sessions? Yes, as long as it stays out of the session
Reorder is a between-sessions tool, and it should never show up on the facilitator's live control surface. The notes already ensure that (no mid-session reorder, no live-session coupling). Please keep it that way. I don't want a "reorder remaining topics" affordance during a live session later on. If I need to skip a topic mid-session, that's the skip feature, not reorder.

### O10. Trend dashboard row order
§2 point 4 says the trend dashboard follows the current order. I'm fine with that. Watching the trend rows reshuffle after a reorder will look odd for a moment, but it's better than rows in the "order voted that day." No action needed beyond the scenario Devon proposed.

---

## Questions

1. **Long moves:** Will v1 include "Move to top" / "Move to bottom" (or a position-number input) alongside up/down? I'd consider at least move-to-top/bottom essential for a tablet user with 11 tall rows.
2. **Compact mode:** Could the list collapse to name plus position while there's an unsaved draft (or behind a "Reorder" toggle), so the whole list fits on one tablet screen?
3. **Focus management:** After Move Up/Down, does keyboard focus stay on the moved row's button? If focus falls back to the top of the list, keyboard reordering doesn't work in practice. The same goes for a screen-reader announcement ("Deployment moved to position 3 of 11").
4. **Created-but-not-completed session:** Can the frontend find out cheaply whether one exists, so the save confirmation can warn (O3)?
5. **Navigate-away warning (Q6 in the notes):** My vote is yes for v1, covering both in-app route changes and browser close/refresh. Losing a draft without warning erodes trust in the whole screen.
6. **Stale reload:** On `TOPIC_ORDER_STALE`, does the UI try to preserve the draft's relative order (O6), or start over from the server's order?

---

## Suggested additions to the proposal/design

- **Spec scenario:** long-distance moves (top/bottom) are possible without N repeated actions. Or explicitly record the decision not to support them.
- **Spec scenario:** visible 1-based position numbers on active topics.
- **Spec scenario:** Save disabled when the draft equals the saved order. A successful save shows a transient, non-modal confirmation.
- **Spec scenario:** saving while a session for the team is already created and not completed shows an explicit "that session keeps its original order" notice (O3).
- **Spec scenario:** Remove/Restore disabled while the draft is dirty, **with a visible reason**.
- **Spec scenario:** the stale-list response shows an explanatory message and doesn't discard the draft until the facilitator acts.
- **Design note:** the Save/Discard controls stay reachable (sticky) on a long list, and on tablet width.
- **Design note:** focus stays on the moved item, and moves are announced through an `aria-live` region.
- **Nice-to-have (can be a follow-up):** "Order last changed by X on <date>" on the screen, sourced from the `topic.reordered` audit row.
- **Usability test hook:** I'd like to try the reorder interaction on a tablet before this merges, the same way I've offered for the facilitator view. It takes fifteen minutes, and it would catch O1/O5 friction better than any spec scenario.
- **Guardrail restated for the design doc:** reorder never shows up in the live-session facilitator view (O9).
