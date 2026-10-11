# Facilitator review of exploration notes (#264)

*Priya Nair, Facilitator. Reviewing Devon's notes from the point of view of someone who runs sessions for three teams and clicks "Topics" before every one.*

## Overall

Devon's notes protect the right things: candour, no profiling, no data behind the door. But the notes treat the benign member-facilitator as a risk to be logged around, when for me it is the main usability problem. The change is invisible to me today (a 403 and a fixed string). The question is whether it stays that way and whether it makes the underlying friction worse.

## Observations

1. **The member-facilitator case is a real, regular workflow, not an edge.** I facilitate three teams. On some rotations I am also a member of one of them. When I open that team's page, the Topics link is there, I click it, and I get told no. The notes (section 2, 5.2) correctly call this "design-induced, regular, legitimate", then defer the fix as a "follow-up if rows show it's common". The rows will show it is common by construction, because the link is always shown. Please do not wait for the audit data to confirm what the code already tells you.
2. **Every click I make on my own team becomes a durable "denial" row.** An audit trail that says I "tried to get around the rule" every time I open my own team's page will teach reviewers to ignore the table. That is the opposite of SEC-13's purpose. Noise destroys the signal the EM-probing case needs.
3. **Being logged as a denied actor feels like being accused.** The persona concern about participants feeling surveilled applies to me too. If I ever learn that I generate "access denied" rows for doing my job, I will trust the tool less. The notes' "who tried" framing is accurate for the EM and misleading for me.
4. **Fail-open is right, and for the reason I care about.** A 500 on a page I legitimately cannot use, mid-session prep, looks like the tool is broken. Agree with Devon's landing. Whatever is chosen, the visible result must be identical: same message, same status, same speed. Good that the notes pin byte-identical bodies and the timing floor.
5. **The message I see is the whole experience.** The notes say the frontend ignores the 403 body and shows a fixed string. For the member-facilitator that string is the only help I get. It does not say why (I am a member of this team) or what to do (ask another facilitator, or use the participant view of annotations). Not changing it is right for this change, but it should be named as a known gap, not silently preserved.
6. **Timing parity is good for enumeration and irrelevant to me.** No concern, as long as the added insert never makes the denied page visibly slower than today. During a live session I should never wait on a log write.
7. **No effect on the live session path.** Nothing here touches voting, reveal, readiness or pacing. Good. Confirm explicitly in the proposal that the session-flow endpoints are untouched, so nobody scopes it wider.

## Questions

- Why does the Topics link render for a facilitator who is a member of that team, when the server will always refuse? Who owns that decision, and is there a reason the page cannot know it?
- Could the page hide or disable the link (with a short explanation) for exactly the `FACILITATOR_IS_TEAM_MEMBER` case, using data it already loads? If yes, that removes most benign rows at the source, which is better than filtering them later.
- Is the member-facilitator supposed to see the team's own definitions another way (as a participant would)? If not, I have no route to the content I need to prepare a session for my own team.
- Will anyone read these rows? If a reviewer sees a spike of `FACILITATOR_IS_TEAM_MEMBER`, what do they do? If the answer is "nothing", the value is only in the EM and participant rows.
- Does a failed audit write that I never see eventually page someone? Silent failure of the audit is invisible to users, so the signal has to go somewhere a human reads.

## Suggested additions

1. **Make the link behaviour part of this change, or file it now with a number.** At minimum, record in the proposal that the benign rate is expected to equal "every time a member-facilitator opens the page", and link the follow-up issue instead of leaving it as a note.
2. **Distinguish expected from unexpected in the row, not just the reason.** `reason` already separates `FACILITATOR_IS_TEAM_MEMBER` from `NOT_A_FACILITATOR`. State in the spec that any review or alert must treat the first as informational and the second as the probing signal. Do not alert on volume of the first.
3. **Consider not writing a durable row for `FACILITATOR_IS_TEAM_MEMBER` at all, or writing it at lower severity.** The notes argue a pattern of these signals evasion. I would argue a facilitator who is a member and clicks a visible link is not evasion. Ask Security whether the benign path earns a durable row. If it does, keep it, but say why.
4. **Spec the user-visible contract as unchanged.** Add scenarios: member-facilitator gets the same 403, same message, same latency before and after; audit failure does not change what the member-facilitator sees.
5. **Improve the denial copy as a separate small change.** For the member-facilitator the message should say "You are a member of this team, so someone else facilitates its topic definitions" (wording for the team to settle). Keep the server body unchanged here; this is a frontend string.
6. **Usability check before release.** I have offered to test the facilitator view. Include a pass where a member-facilitator opens their own team page, clicks Topics, and I tell you whether I understand what happened.
7. **State the guarantee for the room.** Add one line to the spec: participants and facilitators are never shown that an access attempt was recorded. No banner, toast or "this has been logged" text, ever. It would feel like surveillance in a ceremony that depends on people speaking freely.

## Does it disappear into the background?

Mostly yes: no change to session flow, no new UI, fail-open keeps a DB blip from surfacing. It stops disappearing if the member-facilitator keeps hitting a dead link that now also generates records. Fix the link and the tool stays out of my way; leave it and the audit table fills with my normal behaviour.
