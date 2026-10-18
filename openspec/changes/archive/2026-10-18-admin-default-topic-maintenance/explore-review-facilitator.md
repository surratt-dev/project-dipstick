# Facilitator review (Priya Nair): exploration notes for admin-default-topic-maintenance (#216)

Lens: real user pain, workflow friction, and whether the result stays out of the way during a session.

## Overall

The notes are rigorous about ritual integrity, audit, and invariants. That is the right instinct. But they are almost entirely written from the system's and the admin's side. The person who feels a template change is the facilitator in the first session of a new team, and she barely appears. Nothing here threatens the live session directly (the admin path is outside the session flow), so the tool should stay invisible during sessions. My concerns are about what reaches the room afterwards, and about pain that is unnamed.

## Observations

1. **The real pain point is not captured.** The notes frame the problem as "Devon is a help desk, edits need a migration". That is a maintainer's pain. What I feel as a facilitator: a prompt that confuses new teams (jargon, ambiguous wording, a vote type that does not fit) stays confusing for months because fixing it takes a deploy. The notes never ask which defaults actually cause trouble in first sessions, or how facilitators would report it. Without that, we are building an editor with no known first edit.

2. **"New teams only" is correct for integrity but has a facilitator-visible cost (section 2).** A team created yesterday whose first session is next week runs the old wording. I may be facilitating two teams in the same week with different wording for the "same" topic, and I will be the one explaining it. My trend comparisons across my three teams silently mix wordings. The notes treat this as a BA question (item 7); it is a facilitator-facing question too: how do I know which wording version a team was given?

3. **Restore returning superseded wording (section 2) lands on me.** A facilitator who clicks "Restore default topics" mid-ritual and gets old text, while the admin believes it was fixed, will not know why the room sees different phrasing. Agreed it should not be fixed here, but "name it in the spec" is not enough. The restore confirmation must not imply currency, and the topic should show something that lets me tell. At least record this as a tracked follow-up with an owner.

4. **Topics changing under a session in flight.** Notes say open sessions are snapshotted, good. But a facilitator preparing a session (looking at the Topic Management screen the night before) could see a team's topics, and an edit to the template can't touch them. Confirm that explicitly in the spec so no one invents a "propagate" button later. Also confirm the admin screen can never be reached or interrupt a facilitator during a live session (no shared state, no locks on team rows that a running session needs; `lockTeamTopics` on the sentinel only, never on real teams).

5. **Template changes with no visible changelog for facilitators.** Audit rows serve incident reviewers. Facilitators have no way to learn "the defaults changed on date X". When I onboard a new team I explain the topics from memory and my own notes; if the wording shifts I will explain the wrong thing. Suggest a read-only, facilitator-visible "defaults last changed" indicator or short change note. Low cost, high trust.

6. **Edits to `first_session_description` matter most to me.** That text is what lets the app carry first-session onboarding so I do not have to. The notes list it as just another field. Validation should treat it as required and reasonably short, and the edit UI should show the text as a participant will see it (preview). A blank or sloppy description silently degrades every new team's first session.

7. **Vote type immutability (open question 2): I lean yes, immutable.** Changing a vote type changes what the aggregate and outlier flagging mean. Retire and add is safer and honest. Rename: also confirmation-worthy, because I use topic names as shorthand in conversation and in action items.

8. **Template size cap (open question 10) is a session-length issue, not just abuse.** Twelve topics already fills a session. The cap should reflect a realistic session length, and adding a topic should warn about time. Also consider ordering guidance: the first topics set the emotional tone; an admin reordering can wreck that without noticing.

9. **Prompt-targets-individuals risk (section 7, item 6) is under-defended.** A notice on the screen plus audit is fine, but in practice the admin is not the one in the room. A prompt like "Is [name] blocking reviews?" would be a disaster for trust and I would be the one defending the tool. Suggest light guidance and examples of good prompts on the admin screen, and a simple guardrail (length cap, no free-form markup/links). Not a content filter, agreed.

10. **API-only (open question 6) means no usable fix for the pain.** If there is no screen, the admin is still effectively a developer. If a screen is deferred, say so explicitly and open the follow-up issue (as the notes suggest). From my side, API-only is acceptable only if the first real users of it are Devon-level people, which keeps the help-desk problem.

## Usability concerns missing

- **Preview before save**: show the new-team first-session as a participant and as a facilitator would see it.
- **Undo / recoverability for admin mistakes**: archive/restore covers retire, but a bad prompt edit has no "revert to previous text". The notes say prior values are recoverable from versioning (section 7), but an admin-facing "previous version" is not mentioned. Without it the cost of a typo is high and admins will freeze or ask a developer.
- **Plain-language errors**: "At least one active default" and "positions dense" are system constraints; the admin needs messages like "You cannot archive the last topic" and no raw `TOPIC_ORDER_STALE` conflict. Concurrent two-admin edits need a human message and a reload, not a lost edit.
- **Confirmation fatigue**: the "affects new teams only" message is right, but if shown on every keystroke-level save it will be clicked through. Show it once per edit session, prominently, near the Save action.
- **Who is notified**: no one is. Should facilitators of teams in their first-session-pending state be told? At least discuss and decide not to.
- **Accessibility and mobile for the admin screen**: not mentioned. Lower priority, but reordering is drag-and-drop-prone; ensure a keyboard/button alternative.

## Questions

1. Which current defaults are the ones people actually want to change, and why? Who raised #216 from real session experience?
2. Can a facilitator see which template version/wording a team was created with?
3. Is there any report or trend view (FR-8.3) where mixed wording across teams would mislead me? (Asked in notes; I need the answer for facilitator-level trends, not just admin ones.)
4. If an admin archives a default, does the zero-topic recovery path and bulk restore still behave sensibly for teams that hold that topic?
5. Does admin editing happen on a staging copy or live? A live edit that applies to the very next team created is risky on a day I am onboarding a team.
6. What is the plan for the first real edit: a dry run with me or another facilitator before it goes live (I offered usability testing)?

## Suggested additions to the exploration

- A short section "Facilitator and participant impact" covering: mixed wording across a facilitator's teams, restore returning old wording, first-session description quality, and session length with added topics.
- A requirement that nothing in this change touches the live-session path, plus a negative test: admin template writes do not alter any session snapshot or any team's topics.
- A facilitator-visible "defaults last changed" note (read-only), decided in or out explicitly.
- Admin-facing previous-version view and one-step revert for a field edit.
- Immutable `vote_type` and a rename confirmation, recorded as leaning decisions.
- Guidance copy for prompt authors (team and work, never people), with examples.
- A named follow-up issue for the screen and for canonical wording on restore, so neither stays "partially met by omission".
- A usability pass with a real facilitator on the admin screen before first production edit.

## Bottom line

Would this lead to a tool that disappears during sessions? Yes: the admin path is isolated from the live flow and the notes defend the guard, snapshots, and lock well. The risk is not intrusion into the session but invisible drift in what teams are asked, with the facilitator left to explain it. Add the facilitator-impact view and the admin usability items above before the proposal.
