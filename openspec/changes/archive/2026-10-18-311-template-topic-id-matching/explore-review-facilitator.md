# Exploration review: 311-template-topic-id-matching

Reviewer: Priya Nair (Facilitator, SME). Lens: real user pain, session-time friction, and whether the tool stays out of the way.

## Overall

The notes are rigorous about data integrity and almost silent about the people who hit these states. That is mostly right for a plumbing change. But the plumbing produces visible states (a "restore" offer, a rename notice, a rejected click), and those are what a facilitator or team admin actually meets. Nothing here touches the live session, the reveal, or pacing, and I am glad the non-goals say so. My concerns are about the few places where this change surfaces in the UI before or between sessions.

## Observations

1. **Where the pain really is.** The real-world pain is not "the join is name-based". It is: an admin renames "Code Review" to "Peer Review", then a team opens Topic Management during setup and is told a baseline topic is missing, or is offered a duplicate of one they already hold. That is the moment I would lose a team's trust before the first session. The notes capture this well (Devon's "quiet failure" framing). Good.

2. **Same-name custom topic scenario (item 3).** The behavior change is correct, but the notes only say the API "must tolerate" the rejected restore. From the user's side this is a dead-end button: the screen offers "Restore X", I click it, and I get an error about a name clash with a topic that looks identical to the one I wanted. That is exactly the kind of thing that makes a tool feel fussy in setup. The spec needs a defined user-facing outcome, not just "not a 500".

3. **Rename notice (item 8 of the code section, risk 7).** Rewording RENAME_NOTICE is treated as mechanical. For an admin it is the only explanation of what a rename does to teams. The new text should say plainly: existing teams keep their own copy and its name; a rename does not change their topics; teams that never had the topic will see the new name. Without that, admins will assume a rename propagates (risk 5 in your list, arriving through the UI copy instead of through code).

4. **Unlinked legacy rows (option 2a).** Offering a possible near-duplicate is acceptable for a rare case, but the facilitator-facing consequence is a team whose topic list has two similar topics going into a session. Session time is the wrong place to discover that. The mitigation currently lives in an operator runbook; nobody on the facilitator side would see it.

5. **Newly added defaults appear as "restorable" for every team (item 5).** Already accepted in #216, but the word "restore" is wrong for a topic the team never had. A facilitator reading "restore" will think they deleted something. This is a small wording issue worth a line in the spec.

6. **First-session lock.** Notes protect it structurally. I agree. Nothing here should give a team a reason to want to bypass it.

## Questions

- What exactly does the user see when a default is offered for restore while an active custom topic with the same name exists? Disabled with an explanation, hidden, or an error on click?
- Is the offer list for a team with an unlinked legacy default distinguishable in the UI from a genuinely missing default? If not, can we at least avoid showing more than the count of real gaps?
- Does a renamed-in-template default show the team's name, the template's name, or both when offered for restore? Showing only the new template name for a topic the team holds under the old name would confuse people ("where did Code Review go?").
- Who is the audience for RENAME_NOTICE: the admin only, or does any team-facing screen reference it?
- Will an admin renaming a default see how many teams hold the old name, so the effect is not a surprise?

## Suggested additions

1. Add a spec scenario: custom topic with the same name as a default. State the UI outcome (recommend: the default is not offered as restorable while the name is active, or is shown with a short reason such as "A topic with this name is already active"; never a failure on click).
2. Specify the rewritten RENAME_NOTICE wording as an acceptance item, with the three points in observation 3, not just "update the string".
3. Rename the offer label for never-seeded defaults from "restore" to something like "add" in the same pass if the label is cheap to change; otherwise record it as a follow-up.
4. Add a scenario for a rename followed by an offer: the team should see recognizable naming (their own name, or "was: X") so identity survives a rename visibly, not just in the database.
5. Put the legacy-unlinked count in a place an admin can see it (a read-only admin query is enough), so a facilitator is not the first to find a near-duplicate.
6. State explicitly in the spec that no session-time screen (lobby, voting, reveal, facilitator control surface) changes. This is the "tool disappears into the background" test, and the answer should be written down: this change should be invisible during a session, and the only visible surfaces are Topic Management and admin maintenance.

## Verdict

Safe for the session experience and the right call to keep the lock, snapshot and writers untouched. Before proposal, resolve the user-facing outcomes in additions 1, 2 and 4; the rest can be documented. I am available for a quick check of the final wording and the Topic Management behavior.
