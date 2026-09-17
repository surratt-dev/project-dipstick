# Facilitator Review: Exploration Notes for Issue #109 (TEAM-005 EM-Promotion Gap)

**Reviewer:** Priya Nair, Facilitator (Subject Matter Expert)
**Reviewing:** `exploration-notes.md` (Devon Calloway)

A caveat up front, in the spirit of staying in my lane: I don't have — and don't need — an opinion on whether the AND-check logic or the write-side restriction is implemented correctly. That's Devon, Ingrid, and Tomás's call, and the notes read like careful, converged work. What I can speak to is whether this protects the things a facilitator and a team actually feel during and around a session, and whether it stays invisible where it should. Notes below.

---

## Observations

1. **The connection to participant trust is real, and the notes already see it — I'd just push it further forward.** Section 1 frames this correctly: "the Health Check works because participants trust the boundaries around who can see what and how that access came to be." That's not a side effect for me, that's close to the center of the thing. A team only says the honest number on a hard topic because they believe the room — and the data afterward — is bounded the way they were told it is. An EM who can see a team's historical trend data through a side door they were never supposed to have is the data-governance version of a peeked vote: it doesn't have to be discovered by anyone in the room to already have damaged the thing that makes people willing to be honest next time. I'd want the proposal to say this plainly, not just gesture at "data-governance mechanic."

2. **Phantom EM rows are a continuity problem for facilitators specifically, not just an audit-trail abstraction.** Section 3 notes that an unaudited `team_memberships` row with `role = 'engineering_manager'` renders in the `engineeringManagers` array and the team admin view exactly as if it were legitimate, with "no way to tell the difference." I want to name concretely what that means for me: when I hand a team off to another facilitator, or come back after an absence, that admin view and the trend dashboard are the continuity mechanism — that's Success Criteria #3 in my persona, almost word for word. A facilitator picking up a team cold, seeing a person listed as that team's EM who was never actually decided on by an admin, has no way to know to distrust that. They'd build context on a false premise. This is exactly the kind of thing that erodes "pick up a session and have full context without a handoff conversation" — worth citing as a concrete facilitator-facing consequence, not just a data-integrity abstraction for the architect.

3. **The blocked-actor message (open question in §8.2) matters more than its "open question" framing suggests.** My own persona has a near-identical worry about outlier flagging: don't make an unremarkable, good-faith action *feel* like an accusation. Someone using TEAM-005 to promote a colleague to EM may have zero adversarial intent — they may just be doing what the UI let them click. If the block reads like a security denial rather than "here's the correct door," that actor walks away either confused or quietly embarrassed, and possibly avoids the legitimate TEAM-006 flow too because now the whole area feels fraught. The precedent Devon cites (`teams.ts:734-737`, `teams.ts:973-976`) is the right instinct — point at the real front door, don't just say no. I'd elevate this from "open question for design.md" to "requirement: the message must be redirective, not punitive," and I'd like to review the actual copy before it ships, the same way I'd review outlier-flagging copy.

4. **Good boundary discipline — this is what I'd have asked for if it weren't already there.** Section 7's explicit list of what this change is *not* (not Decision 5/6/13, not new EM UI, not a self-service flow) is exactly the shape I want from anything touching the data underneath the ritual: contained, not an occasion to add surface area. Same instinct as my concern about the facilitator view becoming "a participant view with extra buttons" — scope creep on data/access changes worries me the same way scope creep on UI does. I'd flag this section as a model for how to frame the eventual proposal, not just leave it as boilerplate exclusions.

5. **Nothing here touches session mechanics, and I want that stated as a finding, not just an absence.** Reveal simultaneity, readiness-without-spoilers, outlier flagging, pacing — none of it is implicated, confirmed independently by my own read of the notes. Good. I'd like the proposal to say explicitly "no live-session UI or session-flow code is touched by this change" so that's legible to anyone scanning for ritual-integrity risk later without having to re-derive it the way I just did.

---

## Questions

1. **Is there a known population of already-existing phantom EM relationships in production, and if so, does this change include a remediation pass?** The exploration is entirely forward-looking (stop new bad grants). If TEAM-005 has been exploitable in production already, some teams may currently have an EM who was never legitimately established. Closing the gap going forward doesn't fix what a facilitator sees on those teams' admin views today. This feels like it's outside "explore," but I don't want it to fall through the crack between explore and design — who owns confirming whether a backfill/audit query is needed?

2. **Does the audit-mislabeling problem (`team.role_changed` instead of `team.manager_established`, §2) get corrected retroactively, or only going forward from the fix?** If a team's history already contains a mislabeled event, and a new facilitator or an admin later tries to reconstruct "when did this EM relationship actually get established and by whom," the historical record is still wrong for anything that happened before the fix. Is that acceptable, or does someone need to flag which historical `team.role_changed` events were actually promotions?

3. **On the mismatched-state handling question in §5 (participant-downgrade-with-signal vs. hard 403):** from where I sit, the "downgrade to participant + emit a distinguishable signal" option is clearly better for the person experiencing it — nobody gets locked out of content they have a legitimate claim to, silently, mid-workflow. I don't have standing to make that call, but if it were put to me as a UX question I'd advocate for graceful-degradation-with-signal over hard rejection, same as the persona's general aversion to the application producing unexplained dead ends for a good-faith actor. Worth noting that preference explicitly if the security analyst is weighing the two options and UX friction is a tiebreaker.

4. **Will facilitators or team admins ever need to be told this fix happened** — e.g., "this team's EM roster was reviewed and corrected" — or is this purely an invisible backend correction with no user-facing notice? If any team currently has a phantom EM, silently changing their access without any notice could be its own confusing moment for that team the next time someone checks the admin view. Not asking for a big user-facing announcement — just flagging that "silent" cuts both ways: good for not raising alarm, bad if someone notices a role change they don't understand and no one can tell them why.

---

## Suggested Additions

- Add one sentence to the proposal's motivation section connecting this fix explicitly to participant trust in the ritual's data boundaries (building on Section 1's existing framing) — this is the kind of thing that's obvious to the people who wrote the threat model and invisible to anyone reading the proposal cold six months from now.
- Promote the blocked-actor error message (§8.2) from "open question routed to design.md" to an explicit acceptance criterion: message must name the correct endpoint/flow and avoid accusatory framing, consistent with the two existing examples in `teams.ts` Devon already found.
- Add an explicit line to §7 ("what this change is not"): **not** a change to any live-session UI, facilitator view, or session-flow code — confirming by name what's out of scope so a future reader doesn't have to re-derive it.
- Add a question to the proposal (even if the answer is "no action needed, confirmed by X") about whether any already-existing phantom EM relationships in production need identification or remediation, so it's a recorded decision rather than a silent gap between explore and implementation.

---

## Bottom Line

This stays almost entirely outside my usual territory — nothing here touches the reveal, the vote, or a live session — which is itself the right answer for a fix like this: it should disappear into the background and never surface to a facilitator mid-session. Where it *does* surface for me is in the two places facilitators actually touch this system outside of a live session: the team admin/EM roster view (continuity, Question 1 and Observation 2) and whatever message a blocked actor sees (Observation 3). I'd want both addressed explicitly in the proposal before I'd call this ready, but neither is a reason to slow down — they're refinements to a change that's already well-grounded.
