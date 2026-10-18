# Facilitator review (Priya Nair): #271 exploration notes

## Plain statement up front

This is a test-only, docs-only change. No screen, no flow, no vote, no reveal, no facilitator control surface is touched. Most of my lens (session pacing, reveal integrity, first-session support, cognitive load in the room) does not apply directly, and I will not invent friction that is not there. I review only where the change touches something I care about: the facilitator-visible audit read, and the trust of the room.

## Observations

1. The only facilitator-facing reader is R1 (`fetchConnectionRecoveries`, session history). It is the one place this change touches my world. The notes treat it correctly: the test must not break what I see today. Connection-recovery counts in session history are useful to me because they explain why someone seemed to drop out mid-reveal. That should keep working untouched.

2. The notes' framing of what leaks if a prefix match slips through (admin reads of team config, who is a manager-admin, revocation cause, participant auth-failure detail) matches my concern that participants must not feel surveilled. A facilitator seeing "someone's token refresh failed" attributed to a person would be the same failure as an aggressive outlier callout. The guard protects the "informs the facilitator, does not perform for the room" principle. Worth saying that in the rationale; it is a better justification than "Security asked for it."

3. R1 returns actor_user_id and timestamp per recovery. I would want to be sure the facilitator view shows recoveries as a session-level signal, not as a per-person scoreboard. That is outside this change, but the notes' optional "SELECT * / column check" extension touches it. I support keeping that as a follow-up, and would add it to the backlog rather than lose it.

4. The notes are strong on the failure message teaching the next developer. That is the equivalent of my "tool that disappears": the guard should be invisible until it matters, then say exactly what to do. The six-step extension procedure serves that.

## Questions

1. Does anything in the allow-list or the deny-list reasoning change which session events I am allowed to see? For example, if `session.connection_recovered` stays allowed but a future "reconnect reason" operation is wanted for facilitators, is the path to add it clear and not so painful that people work around the test?
2. If a developer adds a facilitator-useful session-history signal (say, late joiners), will the process feel proportionate? The notes call friction a feature; for a new reader that is right, but I want the cost to be a short Security review, not a multi-week gate.
3. Is there any chance the structural test flakes or becomes slow enough to affect the dev loop for the people building facilitator features? (Notes say pure source scan in the unit lane; please confirm runtime is small.)

## Suggested additions

1. In the rationale, add one sentence naming the participant-facing consequence (people stop speaking honestly if they believe admin or diagnostic data about them is surfaceable), tied to the product principle, so the test is understood as protecting the ceremony and not only compliance.
2. Record R1's allow-list reason in facilitator terms too: "serves the facilitator via session history; shows connection recoveries only."
3. Note explicitly that the content.test.ts pin stays (the notes already do this); I would like it stated that no facilitator-visible behavior changes, so usability testing of the facilitator view is not needed for this change.
4. Backlog item: a follow-up to check that session history never displays per-person diagnostic detail from audit rows to the room.

## Verdict

No usability concerns. The notes are appropriate for a test-only change. I have no blockers; the additions above are small rationale and backlog items.
