# Facilitator review: 263-topic-002-error-codes exploration notes

Reviewer: Priya Nair, Facilitator (SME). Not an implementation-team member; I read this for what happens in the room.

## Overall

This change is backend labelling, so it is mostly invisible to me. That is fine. My concern is the one moment where I would see it: a facilitator hits a 403 on the topic-management page, possibly minutes before a session starts. The notes are written from Devon's chair (ritual integrity, structure) and say almost nothing about that person. Nothing here threatens the reveal, readiness, outlier flagging or pacing, and I agree no ritual mechanic is touched.

## Observations

1. **The real pain point is unnamed.** The person who trips FACILITATOR_IS_TEAM_MEMBER is a facilitator preparing a session, often under time pressure and often a facilitator covering for another one. Because I rotate across three teams and hand teams off, I am the most likely person to hit it, for example by being added to a team I used to facilitate for. The notes treat this as "the team might conclude the tool is broken". It is more specific: I am blocked from the control surface I need, and what I do next determines whether the session happens.
2. **Explaining the rule matters more than labelling it.** Section 6 notes that the copy should say "a facilitator must come from another team" in ritual terms, then makes the frontend branch optional and leans toward skipping it. From my side the code only matters if it gets me a message that tells me what to do next ("ask a facilitator from another team to run this", or "you are on this team, so you can't manage its topics"). If the message already does that, skip the branch. If it only restates the refusal, the branch is the whole user value of this change. Verify the current message text against that bar before deciding.
3. **Two denials, two different next actions.** NOT_A_FACILITATOR means "you lack the role, ask an admin". FACILITATOR_IS_TEAM_MEMBER means "you have the role but are on this team, find someone else". The notes say "labels on a refusal", but the recovery path is different for each, and that is the usability argument for the codes. Say it in the proposal.
4. **A dead end is the worst outcome.** A bare 403 with no recovery guidance pushes people back to a spreadsheet, which is exactly what I don't want. The non-JSON 403 fallback (proxy page) is good to keep, but the generic fallback copy should still tell me who to contact, not just "forbidden".
5. **Security-over-clarity tension is handled well.** Keeping TOPIC-001 generic and not adding an EM-specific code is right. I don't want a facilitator-facing page that tells participants or managers things about roles. Good call.
6. **Audit and correlation id (4.2).** I care about one thing: if I report "it said forbidden, I'm a facilitator" to support, can someone find my request? That argues mildly for option 2 (correlation id in the event, not the durable row). The id also should be visible in the error UI only if it is cheap to copy; otherwise skip. I defer to Security on the rest.
7. **Quiet in the background.** The change adds no new UI, prompts or steps, which is correct. The risk is the optional frontend branch growing into a modal, banner or tooltip. Keep any new copy inline, short and in the existing error area.

## Usability concerns missing

- **Who sees the error and when.** No mention of whether the facilitator sees this at page load (list topics) or at the moment of an edit. Failing at load, before I have started anything, is much better than failing mid-edit. Confirm which calls can return these codes.
- **Mid-session behaviour.** If a membership change lands while a session is live, can TOPIC-002 return a 403 on a refresh or poll and blank the topic list I am running from? A denial during a session should never look like data loss. State explicitly that the frontend keeps what it has and shows the error alongside.
- **Message wording is not tested for tone.** The tests assert exact strings but nobody reviews whether they are plain English. Have someone read both messages as a non-engineer.
- **Handoff scenario.** A facilitator returning to a team after an absence (my persona's "continuity" case) is a natural trigger. Worth one test or doc note using that story.
- **Accessibility of the error.** If copy is branched, it should be announced (role=alert or equivalent) like the existing 403 text, not silently swapped.

## Questions

1. What are the exact current message strings for the two denials, and do they tell me what to do next?
2. Does the frontend show any recovery hint today (for example, who can run this team's topics)?
3. Can an admin or other facilitator be named in the message without leaking role information? If not, is a static "ask a facilitator from another team" enough?
4. Is a facilitator from another team able to reach this page for a team they don't belong to without friction? That is the path the denial is pointing me at.
5. If the frontend branch is skipped, is there a follow-up issue so the guidance copy is not lost?

## Suggested additions

- Add a short "user impact" paragraph to the proposal: who hits each code, what they should do next, and that the message (not the code) is what they read.
- Make the frontend branch conditional on a copy review rather than on Devon's lean: if the current message does not name the next step, do the branch.
- Add an acceptance line: "A denied facilitator sees a message that names the next step; a non-JSON 403 still shows a usable generic message."
- Add a note that a 403 on refresh must not clear already-loaded topics.
- Keep the out-of-scope list (TOPIC-001, shared enum, other 47 sites). I agree with all three.

## Verdict

Safe to proceed. The exploration is sound on structure and risk and thin on the human who actually reads the result. Adding the user-impact framing and the next-step-copy bar would make this a change that supports a facilitator rather than just a cleaner API.
