# Facilitator review of exploration notes (#296)

Reviewer: Priya Nair (Facilitator, SME). Lens: real user pain, session friction, and whether the tool stays out of the way during a session.

## Overall

This is a documentation-only change, so there is no session-time UI risk from the change itself. I am fine with that. The notes are thorough on the security side but almost silent on the person who actually meets this state: the facilitator (or team member) of a team that has zero topics and a locked customization. I would not block the change, but I would ask for the additions below so the threat model does not quietly encode an assumption about my experience that I have not validated.

## Observations

1. The notes describe the zero-topic locked team only as "legacy/data fault, expected 0". That is the right framing for the threat population, but it hides the user-facing reality: if it ever happens, the first person to notice is a facilitator trying to open a session. At that moment I am in front of a room. The notes never say what I see, what I can do, or who I call.
2. The "lock" is described purely as a protective constraint against admins. From my seat the lock is what stops me and the team from adding, restoring, or archiving topics during the first-session window. For a zero-topic team that means I am blocked from fixing it myself, and the only remedy is an application_admin calling an endpoint I cannot call. That is a workflow dependency on a person, and the threat model should acknowledge that the carve-out exists precisely to unblock facilitators, so "tighten it" has a user cost.
3. Reopen trigger list includes "a facilitator or EM trigger for assign". I understand the security reason. But for balance, the model should record that facilitators are not given self-service recovery on purpose, and the cost of that choice (waiting on an admin before a scheduled session) so a future reader weighs both sides rather than treating "no facilitator trigger" as free.
4. Detective-only controls with no monitoring (#131) mean nobody gets alerted that a team is empty either. Operationally, the facilitator is the de facto detector. That is a real finding, not just a security one.
5. The notes say the endpoint "does not reach sessions in progress" because `session_topics` is a snapshot. Good. From a facilitator view I want that stated as a promise: a mid-session facilitator must never see topics change under them. Please confirm it is also true for a session in the lobby/room-open state, not only after the snapshot.
6. The notes do not address what "team creation rolls back on an empty template" looks like to whoever is creating a team (often me for a new team). If the template were emptied via #216, a new team cannot be created. That is a first-session onboarding blocker, which is exactly my "low-friction entry" concern. It belongs in the chain-with-#216 discussion.

## Does the documentation change affect facilitators?

- Not directly: High-Level Architecture.md section 8 is an engineering/security audience document, and the planned `docs/deployment.md` pointer is operator-facing. No facilitator-facing wording, UI, or flow changes. Good: nothing here should add friction during a session.
- Indirectly: the new text will be what an admin reads to decide how to respond to a facilitator's "my team has no topics" request. If the text emphasizes risk and says nothing about turnaround, admins may add ceremony (approvals, delays) that hurts the facilitator. Suggest the doc state that the carve-out exists for fast recovery and that a reopen decision must weigh recovery speed.

## Questions

1. What does a facilitator of a locked zero-topic team see today? An empty topic list, an error on starting a session, a disabled start button? Is the message actionable ("contact an administrator") and does it avoid blaming the facilitator or implying data loss?
2. Is there a way for a facilitator to tell an admin which team and why, without a screenshot/email? (Out of scope to build; worth one line in the follow-up list.)
3. After an admin runs assign-defaults, does the facilitator's already-open page update, or do I need to refresh? A stale empty list in front of the room is awkward.
4. Is the standard 15-topic set what the team gets even if they previously had customized topics? For a team that already ran sessions, getting the generic defaults back may surprise the facilitator. (The notes imply first-session-only because lock means no completed session; confirm.)
5. Does the endpoint's success or failure ever surface to the team members in a way that reveals admin activity (see #271)? I want no participant-visible trace, since it could read as surveillance.

## Suggested additions to the notes / change

1. Add a short "operator and facilitator experience" paragraph to subsection 8.1.1 or to the `docs/deployment.md` pointer: how a facilitator reports an empty team, the expected recovery path (admin calls assign-defaults), and that recovery should not require a second approver given the low risk. Keep it to two or three lines.
2. Add the non-security cost to the reopen triggers: "added approval or step-up would delay facilitator recovery before a scheduled session; weigh against the near-zero affected population".
3. Record the #216 chain's onboarding impact: an emptied or badly edited template blocks new-team creation (rollback) and degrades first sessions. This reinforces why template integrity is part of the control.
4. Add one open question for the team: verify and, if missing, file a follow-up for a clear facilitator-facing message when a team has zero topics ("This team has no topics. Ask an administrator to restore the default set."), so the facilitator is not left guessing mid-setup.
5. State explicitly that nothing in this change alters session pacing, reveal, readiness, or outlier behavior, so reviewers do not need to re-test those.

## Disappears-into-the-background check

The change itself is invisible to sessions, which is the right outcome. The residual risk to that goal is the unspecified empty-team experience (observation 1) and the possibility that process language in the threat model leads to heavier admin procedures around recovery. Fix those with the small additions above and I have no objection.
