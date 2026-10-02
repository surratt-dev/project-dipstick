# Facilitator review: session-topics-snapshot-at-creation (#175) exploration notes

**Reviewer:** Priya Nair (Facilitator, SME)
**Date:** 2026-10-01
**Reviewed:** `exploration-notes.md` (Devon Calloway)

Overall: Devon has the ritual right. Treating this as the main path is correct. I have run sessions where the tool lost the room's trust in the first ten minutes, and a team that hits a 409 right when it should start voting won't give the tool a second session. My notes below are mostly about what the facilitator sees and feels at the boundary this change creates.

---

## Observations

### O1. Option B is the right line, and it matches how I actually prepare
I back B without reservation. My real prep loop is: open the draft the day before or that morning, look at the trend for the last few sessions, notice something ("we've rushed Deployment three times, move it up"), adjust, then open the room when people start arriving. Under Option A, that prep would be silently thrown away. That's the worst failure a facilitator tool can have: it looks like it worked and it didn't. I'd only find out when the topics came up in the old order with the team watching. B puts the freeze at the moment the room becomes shared, which is how the physical ritual has always worked: once people are in the room, you don't change the agenda.

### O2. Lobby time is mostly short, but not always
The notes assume the lobby is "room opens, people arrive." Usually that's true. But the stub mentions facilitators who create a session early to send the join link around. If the join link only works once the room is in `lobby`, then a facilitator who opens the room at 9am for a 2pm session freezes the list at 9am, maybe without realizing it. B is still right, but the confirm copy (O3) is what keeps this from being a surprise. Please confirm whether a join link exists or works while the session is still a draft. If it doesn't, "Open the room" is the only way to hand out the link, and the lock message matters more.

### O3. Yes, the "Open the room" confirmation should say the list locks
Current copy (`DraftSessionHost.tsx:299`): "Opening the room lets participants join immediately, and cannot be undone. Continue?"

Add one sentence, and include the count. Something like:

> Opening the room lets participants join immediately and locks in today's **9 topics** in their current order. Later topic changes apply to your next session. This cannot be undone.

Why the count: it's a two-second sanity check I'll actually read. If I expected 8 and it says 9, I'll catch the topic I meant to archive. The full "last look" list belongs in `topic-skip-and-creation-time-confirmation`, and I don't want this change to grow into that. But the sentence plus the count is cheap, it states exactly when changes stop applying, and it costs nothing in the session itself. Do this in this change, not in the stub. Without it, B swaps one invisible boundary for another.

Keep the copy calm and factual. No warning icon or red text. This is a normal step, not a danger zone.

### O4. Zero active topics: block at room-open, with copy that tells me what to do
I agree with the guard at room-open. A room that opens and then fails at begin-voting is far worse than a draft that won't open, because by begin-voting the team is already watching. Specifics:
- Disable or refuse "Open the room" with copy like: "This team has no active topics. Add or restore a topic on Topic Management before opening the room." Link straight to Topic Management. A bare 409 message with no next step is a dead end.
- Best is to show this *before* I click: the draft host already knows the team, so it can show the state up front instead of failing after the confirm dialog.
- Keep begin-voting's guard, but if it ever fires it should say "contact support / re-create the session," not just describe the state. By then I can't fix it from inside the room.
- One active topic is a valid (if short) session. Please don't add a minimum above 1.

### O5. The first session path (`POST /teams`) locks immediately, and that's fine
A new team goes straight into `lobby` with defaults, so the list locks at creation with no draft window. That is consistent with the first-session customization lock, and in a first session I *want* the defaults so the team learns the standard set. No change needed. Just write down that this is intended, so nobody "fixes" it by adding a draft step to team creation.

### O6. R7 is a trust issue, not a cosmetic one
The `openSessionCreatedAt` hint showing the *draft* time is exactly the kind of small lie that teaches facilitators to stop believing the tool. If I reorder at 10:00, open the room at 10:05, and the hint says "a session created at 9:30 keeps its original order," I'll assume my reorder was lost and start doubting everything. I'd strongly prefer a `topics_snapshotted_at` (or "room opened at") timestamp, with the hint worded around it: "Today's session (opened 10:05) uses the list as it was then. Changes apply to your next session." Treat this as in scope.

### O7. Existing lobby sessions with no rows: someone will hit this mid-meeting
If any real team has a session sitting in `lobby` or `pre_session` when this ships, they'll still hit the 409 at begin-voting with the team in the room. From a facilitator's point of view, a backfill from current active topics is the lesser evil: nobody has voted, and today's list is almost certainly what they meant. Abandoning those sessions means a facilitator finds out live. If engineering confirms nothing is deployed beyond dev/CI, skip the backfill. Just make that confirmation explicit in the proposal, not assumed.

### O8. R5 must be fixed in this change, not filed
If the reconnect snapshot reports `has_locked_in = false` for everyone once sessions go `active`, the readiness grid is wrong on every reconnect. The readiness grid is how I know when to call the reveal. A grid that says "nobody's locked in" after a participant refreshes is worse than no grid, because it pushes me to wait or nag. This change is what makes the bug reachable for the first time, so shipping #175 without the R5 fix trades one broken session for a different broken session. Fix it here.

### O9. Double-advance is a real facilitator behavior
Q6 isn't theoretical. Facilitators double-click, especially on a slow connection with the team watching. The second click should be a no-op the UI absorbs quietly (land in the lobby view), not an error banner. A 409 on the API is fine, but the frontend should treat "already in lobby" as success.

---

## Questions

1. Does the join link work while a session is in `draft`? (Drives how much O2 and O3 matter.)
2. Can an expired draft (24h) currently be opened via `/advance`? If so, what does the facilitator see? I'd want "This draft expired; start a new one," not a generic failure.
3. Once the room is open, is there anywhere in the facilitator view (lobby or pre_session) where I can see the locked list? Not asking for it in this change, but I'd like to know whether the gap exists. Today I'd have to trust the count in the confirm.
4. If I edit topics while my own session is in `lobby`, does Topic Management tell me the edit won't apply to today's session? The reorder spec has the hint. Does archive/add/annotate show the same thing?
5. Does the annotation I wrote during the draft window show up on the topic during the session? That's the point of writing it then. The e2e test should check that the annotation is visible in the active phase, not only that it's stored.

---

## Suggested additions to the notes / proposal

- **S1.** Make the confirm-copy change (O3, with topic count) an explicit in-scope item, not an open question.
- **S2.** Zero-topic guard: show it on the draft host before the confirm, with a link to Topic Management. Specify the copy in the spec scenario (O4).
- **S3.** Promote R7 to scope: record when the room opened and word the Topic Management hint around it (O6).
- **S4.** Fix R5 in this change (O8). Add an e2e step: participant locks in, reconnects, and the facilitator's readiness grid still shows them locked in.
- **S5.** The frontend treats a double "Open the room" as success, not an error (O9).
- **S6.** State that `POST /teams` locking immediately is intended (O5).
- **S7.** Add a ritual-level acceptance check to the e2e: a facilitator reorders and annotates in the draft, opens the room, and the session runs topics in the *new* order with the annotation visible. That is the scenario that proves the draft window is worth having.
- **S8.** Backfill stance: write down the deployment check result explicitly, and default to backfilling open lobby/pre_session sessions if anything real exists (O7).

Usability testing: I'd like to walk through draft -> reorder -> open the room -> begin voting once this is on a dev environment, before it's called done. This is the first time the full ritual can actually run end to end, so it's the right moment for the facilitator walkthrough I offered.
