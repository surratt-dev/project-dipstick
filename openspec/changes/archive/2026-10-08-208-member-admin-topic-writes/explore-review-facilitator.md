# Facilitator review: exploration notes for #208 (member-admin topic writes)

**Reviewer:** Priya Nair (Facilitator, SME)
**Date:** 2026-10-08
**Reviewed:** `exploration-notes.md` (Devon Calloway)
**Lens:** whether this reflects real facilitator and team pain, what a barred member-admin actually experiences, and whether the result stays out of the way during sessions.

---

## Verdict

I support Option A. Section 1 gets the reason right: topic writes set the agenda, and the agenda belongs to someone outside the team. I've watched a session go flat because a topic showed up at the top of the list and everyone knew who had put it there. Nobody had to be a manager for that to happen. So the any-membership bar matches what I see in the room.

What the notes are missing is the human side of the refusal. Sections 7 to 10 cover the rule thoroughly, but they don't describe what the barred person sees, who they should go to, or how the change reaches the people who lose access. Those are the gaps below. I don't think any of them should block the decision, but they should go into the proposal and the `topic-management-screen` spec before design starts.

---

## Observations

### O1. Taking the controls away is not enough. The read-only state needs a reason on screen.

Section 7b gates all four write controls on the server flag, and section 9 says the participant-member admin "sees the list read-only". That's correct. The trouble is that today the only read-only state anyone sees comes with an explanation: the dashed `customization-lock-notice` banner ("Topics cannot be customized until this team completes its first session..."). If the controls simply disappear for a member-admin, the screen looks broken or half-loaded. Broken-looking screens produce exactly the support tickets and "fixes" that section 8.4 warns about.

The notes also give message text only for the 403 envelope (7a). With the controls hidden, that text is almost never seen. The common case is the screen loading with no controls on it, and that case needs its own copy.

### O2. The refusal leaves the person with nowhere to go.

Both messages, the proposed 403 text ("An application admin cannot add a custom topic to a team they are a member of") and the existing 403 *page* that an EM-member admin gets from TOPIC-002, say what isn't allowed. Neither says who can do it instead. Realistically, a member-admin opens Topic Management because the team asked them to: "can you add an on-call topic?" or "can you bring back Deployment Pain?" The answer we want them to reach is "ask the team's facilitator". The screen doesn't currently show who that is, and with rotating facilitators (I cover three teams) the team may not know offhand.

### O3. The intended human workflow is implied but never written down.

The notes argue convincingly that someone from outside the team *can* make every change (section 6). They never say how a requested change is supposed to *reach* that person. The workflow that fits the ritual is: the team raises it (in the session, as an action item, or directly with the facilitator), and the facilitator makes the change before the next session. This should be stated in the proposal as the expected path. Otherwise the first time a member-admin is refused, someone will propose a "request a topic change" feature or an override, which is section 8.5's failure mode coming in through usability instead of lockout.

### O4. The people affected are the ones most likely to notice, and nothing tells them.

Section 4 is the strongest part of the notes, and it also identifies who will feel this: the senior engineers who hold both the facilitator and admin roles, and who today can edit their *own* team's topics. To them it's a regression with no announcement. They think of themselves as facilitators, so a message that opens with "An application admin cannot..." won't make sense to them at first. Nothing in the notes covers communicating the change.

### O5. Lockout analysis: I agree with the logic, with one real-world addition.

The chain in section 6 holds (topic writes require a first session, which required a non-member facilitator). In practice the residual case is not "the facilitator left the org". It's the facilitator rotating off the team. When I hand a team over, I stop thinking of myself as its topic owner even though the system still allows me. The notes should acknowledge that the "non-member writer exists" guarantee is about permissions, not about anyone actually feeling responsible. That's mostly a handoff and continuity issue, and it's also why O2's "who to ask" pointer matters.

The FR-8.6 restore path and the pre-session empty-topics guidance in `DraftSessionHost` ("Add or restore a topic on Topic Management before opening the room") are aimed at the facilitator, who is unaffected, so this change creates no new dead end on the way into a session. Good.

### O6. Does this stay in the background during sessions? Yes.

Topic Management is a preparation screen. Admins don't take part in sessions (FR-1.3/FR-2.4), and nothing in the live flow (readiness, reveal, outliers, pacing) is touched. I see no in-session cost, and one in-session benefit: the facilitator can trust that the agenda wasn't reshaped from inside the team the night before. That is the kind of invisibility I want.

### O7. The framing of the denial audit row needs care.

Section 7c justifies `admin.topic_write_denied` as catching "an insider *trying* to reshape their own team's agenda". Once the controls are hidden (7b), a denial only happens through a stale flag (a page left open across a role or membership change) or a direct API call. Most of those will be innocent: a tab left open over the weekend. I'm fine with the durable row, but the contract or spec prose shouldn't present a denial as evidence of intent. A record people treat as suspicion has a social cost, the same concern I raised about outlier flagging.

### O8. Continuity: the remaining admin writes should be visible to the facilitator.

After this change, every admin topic write comes from a *non-member* admin, which is legitimate but still means someone other than the facilitator changed the agenda. A facilitator who picks up a team needs to see "Archived by <admin>, <date>" on the screen. An audit table they can't read doesn't help. This belongs to #201 (topic provenance), but the notes should link it so the two land in a sensible order.

---

## Questions

1. **What does a participant-member admin see when the team is still locked (before its first session)?** Both reasons apply. I'd show the lock notice only, since it's the reason that will go away. Does the spec decide this, or does the frontend pick by accident?
2. **Can the screen name the facilitator to contact?** For example "Last session facilitated by Priya Nair on 2026-09-30", from session history. Is that data already on the TOPIC-002 response or reachable cheaply, or does it need a separate issue?
3. **Should the EM-member admin's 403 page (from #232) get the same "who to ask" line?** It's the same dead end, only reached earlier.
4. **How many people does this change affect today?** Can someone query existing `topic.*` audit rows where `actor_global_role = 'application_admin'` and the actor had an active membership on that team at the time? Zero means no communication is needed. A handful means a short note to those people before the release.
5. **Should the copy say "member" first and "admin" second?** For someone with both roles, "You're a member of this team, so its topics are set by the facilitator" reads better than starting with their admin role.
6. **Is the membership-removal workaround (section 6) visible to the team?** If an admin leaves the team, edits topics and rejoins, does any team member or the facilitator see it, or only an auditor? I'm not asking for a block, but the executive sponsor should hear about it when they approve the FR-8.2 change, so it's a known gap and not a surprise.

---

## Suggested additions to the exploration and proposal

1. **Add a "member-admin experience" section** covering:
   - A visible read-only notice for the participant-member admin, styled like `customization-lock-notice` and with its own `data-testid`. Suggested copy: *"You're a member of this team, so you can view its topics but not change them. A team's topics are set by a facilitator from outside the team. To suggest a change, contact the team's facilitator."* (Add a name if Q2 allows.)
   - Precedence between the lock notice and the membership notice (Q1).
   - Matching, ritual-framed 403 envelope messages for the stale-flag case, ending with the same "contact the team's facilitator" pointer.
2. **State the expected workflow for requested topic changes** (O3): team raises it, facilitator makes it. Note explicitly that a "request a change" feature and an "only admin" override are both out of scope.
3. **Add a rollout note** (O4, Q4): run the audit query, and if anyone is affected, send a short message before release explaining the agenda-neutrality reason. Include a release-note line in the PR.
4. **Extend the frontend test plan (section 10)**: the participant-member admin sees the membership notice (not just "no controls"); a locked team shows a single notice per Q1; the stale-flag 403 shows the "contact the facilitator" text; the EM-member admin's 403 page, if Q3 is accepted.
5. **Adjust the 7c wording** so that `admin.topic_write_denied` is described as a record of the attempt, not a signal of intent (O7).
6. **Cross-link #201** under section 9 or 11 for facilitator-visible provenance of non-member admin writes (O8).
7. **Add one line to section 6** on facilitator rotation: the permission guarantee holds, and "who to contact" (Q2) is what makes it hold in practice (O5).

---

## Bottom line

The rule is right, and it costs nothing during a session. The gap is how the "no" is delivered. A member-admin who hits it should understand the reason, feel it's fair, and know who to ask. Without that, the bar will read as a bug, and the follow-up issue will be a request for an override.
