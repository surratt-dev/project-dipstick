# Facilitator review: zero-topic-team-recovery exploration notes (#200)

Reviewer: Priya Nair (Facilitator, SME)

## Overall

The notes are an engineering and authorization analysis. Nearly all of it concerns endpoints, locks and audit rows. That is fine for a rare recovery path. But the facilitator's experience of hitting this state is barely described, and the notes treat me mostly as a person who gets sent away ("ask an admin"). Judged on whether the tool disappears during a session, this change is mostly neutral, because it is an off-session setup path. The risk is how it behaves before a session, and what I am left holding when it happens.

## Observations

1. Where I actually meet this state. I will meet it when I set up a session ahead of time, or minutes before the room opens. The notes cover the empty state on Topic Management. They do not cover the earlier moment: me pressing "open room" and getting a 409 `NO_ACTIVE_TOPICS`. The message "Add or restore a topic on Topic Management before opening the room" is wrong for a locked zero-topic team, because I cannot add or restore anything. It sends me to a screen that tells me to ask someone else. That is a dead end with two hops. The room-open error must be revised along with the empty-state copy.
2. The pain is time, not the bug. If participants are already waiting in the lobby when this blocks me, "contact an administrator" is a failed session. The notes do not say how long recovery takes or who the admin is. Option B is only as good as the admin's response time. Nothing in the notes helps me find the admin or tell them what I need.
3. Fix by the person who can do it. For the facilitator variant, I want the copy to name the role ("an application administrator") as Devon prefers. I agree with that preference. "The people who run this application for your organization" is exactly the vague phrase that sends me to the wrong person. Please loosen H1.
4. The facilitator gets no signal after the admin acts. After the admin assigns defaults, does my page update, or do I have to reload? I may be sitting on that screen or on my session draft. A stale "no topics" view after the fix would make me distrust the tool. Suggest a refetch on focus or a plain "Refresh" prompt, and make sure a draft session I created earlier is usable afterward (see 5).
5. Draft sessions. The notes say drafts can exist for a zero-topic team and that the snapshot happens at room open. Confirm that a draft created before recovery picks up the newly assigned topics when the room opens, instead of staying bound to an empty set. This is the "my prepared session just works" test.
6. Participants. Nothing is said about what participants see if a session fails to open. They should not see a stack of technical errors. Only the facilitator view should carry the explanation, and the lobby should not render a half-open state.
7. First-session guidance. Recovery restores the canonical set and the team is still in "first session" mode. Good. That matches my wish that first sessions be guided by design. The notes should state explicitly that the recovered team behaves like a brand-new team (lock stays, explanations present) so no one assumes it is a special state.
8. Admin button without a confirmation dialog. For a rare, additive, idempotent action I agree no dialog is needed. But the admin should see what will happen (the count of topics to be assigned, say "12 default topics") on the button or in the success message, so they can tell it worked.
9. Success message. `{ topicCount }` is returned, but the notes do not say what the admin sees. A one-line confirmation avoids a second click or a support ping to me.

## Questions

- Q1. If the diagnostic query finds no such team anywhere, is this change worth full-pipeline cost? My view: ship the copy fixes (observation 1 and 3) regardless, since those cost almost nothing and help real facilitators now.
- Q2. Can an admin who is also a facilitator on that team do this from the same screen I am on, so we do not both need to be in different places?
- Q3. Is there a "who are the admins" display anywhere for me? If not, the named role in the copy is not enough for a facilitator in a large organization.
- Q4. When the room-open 409 fires, does it leave the session in draft, so I can retry without recreating it and losing my prep?
- Q5. If assignment fails (empty template, 500), what do I see? A fixed 500 is fine for the admin log, but the facilitator needs a sentence saying it is not their fault and who to tell.

## Suggested additions

- Add the room-open error path (`NO_ACTIVE_TOPICS` message and where it points) to scope. Different copy for facilitator and admin, matching the Topic Management variants.
- Add to scope: a facilitator-facing line on the session draft or Topic Management page that says the team cannot run until an admin assigns defaults, so I find out during prep and not at the lobby.
- Add a usability walk-through to the verification list: I would test the facilitator variant (blocked, ask admin, admin acts, I return and open the room) end to end with a real admin on a staging team. I offered to usability-test the facilitator view and this flow belongs in it.
- Add an acceptance criterion in plain words: after recovery, a facilitator can open the room without recreating the session or reloading in a confusing way.
- Keep the out-of-scope list as written. Partial-set top-up would be a policy question I would want to weigh in on, since teams deliberately archive topics. I agree with holding at zero active.

## Does it disappear into the background?

Yes for sessions: the change adds nothing to the live session, the reveal, or the facilitator control surface, and nothing for participants. That is the right outcome. The risk is on the prep side: if the facilitator's path stays a dead end with copy that points nowhere, the tool becomes visible at the worst moment. With the room-open message fixed, the named role, and a clear post-recovery refresh, the rare case stays rare and cheap.
