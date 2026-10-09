# Explore review: Facilitator (Priya Nair)

**Reviewing:** `exploration-notes.md` (Devon Calloway), #232, with #208 alongside
**Date:** 2026-10-08
**Lens:** Does this protect what makes the ritual work? Does it add friction to facilitators or make the room feel watched? Does the tool stay out of the way during a session?

---

## Verdict

I support it, with a few additions. Devon has the ritual right. "Our team's definition" is only worth anything if the team writes it for themselves and not for their manager. I've watched a team's wording change once they knew their manager was reading, and after that the definition is useless to me as a facilitator. Option A (deny the whole response) is the right call. My concerns are mostly about what the dual-hat person *sees*, and about writing down explicitly that facilitator flows are untouched. Right now that's implied by the truth table but never stated.

---

## Observations

1. **The pain point is real, and the notes frame it correctly.** Section 1 ties the rule to candour, not only to access control. That's the framing to keep in the proposal. If the proposal turns into "close an authz gap", reviewers will treat Option B (strip fields) as an equivalent fix. It isn't. A manager seeing the topic names, prompts and archive history is still a manager shaping how the team thinks about itself.

2. **Facilitator flows are unaffected, but the notes only show this through the truth table.** I checked: `TopicManagementPage.tsx` is the only frontend consumer of `/topics/all` (the initial load at ~L659 and the silent refetch at ~L698). The live session flow (readiness, reveal, outliers, action items) doesn't call TOPIC-002, so this change can't touch the session itself. Non-member facilitators keep 200 and `canEditAnnotations`. The facilitator branch never reaches the new membership read, so there's no extra query and no added latency on my path. **Please state this outright in the proposal ("no change to any facilitator path or to the live session") and pin it with the regression tests in section 9.** It's the first thing I'd ask in a usability review.

3. **The audit is invisible to the room, and that's correct.** The row is written server-side for admin reads only. Facilitators and participants never see it, and nothing about it shows during a session. It's a quiet record, not a performance, which is what I asked for with outlier flagging too. Good.

4. **What the dual-hat admin actually sees after the 403 is not what the notes assume.** Section 5 proposes a careful server message ("Topic configuration for this team isn't available to its engineering manager.") and section 10 Q4 asks the BA for copy. But `TopicManagementPage.loadTopics` **ignores the response body on 403** and always shows the fixed string "You do not have access to this team's topic management." So:
   - The new server message never reaches the user unless the frontend changes. The notes say (section 4) "No change is needed if the answer is to deny", which is true for correctness but leaves the copy question moot.
   - This person is an Application Administrator. They can open the Topics screen for every other team. On their own team they get a generic "no access" with no reason, and their first guess will be a bug, not a rule. That means a support ticket, or worse, an admin "fixing" their own membership to get in.
   - Suggestion: decide now whether the frontend renders the envelope `message` on 403 (one small change, and it helps every 403 on that screen) or whether generic copy is deliberately accepted. Don't leave it to fall out of the BA's copy decision. FR-2.4's precedent allows generic copy, but FR-2.4's case is a session the person was never invited to. Here it's a screen they use routinely on other teams.

5. **The "Topics" link still shows on TeamPage for this person.** The server gates and the link is a discovery point (by design, per the comment at TeamPage ~L128). That's fine. Just note in the `topic-management-screen` spec that a dual-hat admin will see the link, click it, and land on the denied state, so nobody later "fixes" it by hiding the link client-side from a role guess.

6. **The refetch path fails differently.** If an admin's membership changes to `engineering_manager` while they have the screen open (an edge case, but membership edits happen on the same TeamPage), the next write triggers a refetch. The refetch treats any non-ok as `failed` and shows "Unable to reload topics." The POST that triggered it succeeded (201, #208's split). So the admin sees their write land, then a reload error, with a stale list. It's rare enough not to block anything, but it should be listed as a known edge in the design and not discovered in QA.

7. **The GET 403 / POST 201 split is a real UX oddity, not just a parity-table footnote.** Through the UI the dual-hat admin can't reach the write controls, because the screen never loads. Through the API they can still add, archive and reorder their own team's topics. From the room's point of view that's the worse half: their manager can still *shape* what they discuss, just not read their definitions. The notes treat it correctly as #208 evidence. I'd strengthen the wording: from a facilitator's view, a manager choosing the team's topics is closer to the harm of the no-manager rule than a manager reading annotations. #208 should be told this is the strongest case it has, and it should be prioritised, not just "sharpened".

8. **Handoff continuity is unaffected.** A facilitator inheriting a team still gets the definitions and archive history from TOPIC-002 without a handoff conversation. That's one of my success criteria and the change keeps it intact. Worth one line in the proposal.

9. **Option B would have hurt facilitators indirectly, and the notes miss this point.** A null annotation renders exactly like "the team hasn't written one" (section 2). If B were chosen and an admin passed a team's state along to a new facilitator ("they have no definitions yet"), the facilitator would start the session from a false picture. That's another reason A is right, and it's the reason that matters most from my side.

---

## Questions

1. **Does an admin who also *facilitates* elsewhere hit this in a way that blocks them?** The facilitator-from-another-team rule means a dual-hat admin/EM would never facilitate their own team anyway, so I believe there's no conflict. Please confirm the dual-hat person has no legitimate facilitation reason to need their own team's Topic Management screen.
2. **Who prepares the template team / first-session topics when the only admin available is also the team's manager?** For a new team's first session, I rely on someone having the topic set ready. If the only admin in a small org is also that team's EM, they now can't view the screen for that team. A non-member facilitator can still do it, so I don't think this blocks onboarding. But say so, and name the fallback ("a non-member facilitator or another admin prepares it").
3. **Will any audit consumer surface these rows to a team or its manager?** The audit row is a compensating control for the dual-hat manager we can't see structurally. If a future admin dashboard lists "who read your team's topic config", it has to stay admin/security-only. Please add a sentence so `admin.topic_config_accessed` rows aren't later exposed somewhere a manager can browse.
4. **Is "read on every refetch" going to make the audit trail noisy enough that people stop reading it?** Each admin write triggers a refetch, which writes another access row. One admin editing a team's topics produces write row, read row, write row, read row. I'm not against it, since the volume is small, but Security should decide whether reviewers can tell a "browse" from an "edit session" (for example by putting `reason: initial | refetch` in the metadata, or just accepting the pairs). An audit nobody can read is a quiet failure.

---

## Suggested additions to the exploration / proposal

- **A "Facilitator and session impact" subsection** stating: TOPIC-002 is consumed only by `TopicManagementPage`. No live-session endpoint changes. Facilitator paths gain no query, no audit row and no new state. Handoff context is preserved. List the regression tests that prove it.
- **A "What the dual-hat admin sees" subsection** covering the TeamPage link, the generic 403 copy on `TopicManagementPage` (which today discards the server message), and an explicit decision: render the envelope message, or accept generic copy with rationale. Move this out of BA open question Q4 and into a decision.
- **Frontend test row** (`TopicManagementPage` tests): a 403 lands in the access-denied state with no topic data, no "Our team's definition" block, and no write controls rendered. The notes say no frontend change is needed, but a test that pins "no annotations ever render after a 403" is cheap and protects the rule if the page later caches data across teams.
- **Refetch edge (observation 6)** listed as a known, accepted edge in design.
- **Stronger #208 hand-off wording** (observation 7): the manager can still *write* their own team's topics through the API. That's the more harmful half for the ritual, and #208 should be prioritised on that basis.
- **Release-note dependency** (section 7 item 7): agreed, and add the inverse. Once #232 ships, the release note should say "engineering managers, including administrators who manage the team, cannot read the team's definitions". Not "cannot change topics", which stays untrue until #208.
- **Audit visibility guard** (question 3): one sentence saying topic-config access rows are not exposed to team members or managers.

---

## Would this lead to a tool that disappears into the background during sessions?

Yes. Nothing in this change appears in the session. The only new thing anyone sees is a denied screen for a narrow class of user outside sessions, and with the copy fix above that screen explains itself. What makes the session work, a team that writes its definitions honestly, is protected by it. That's the kind of change I want: invisible in the room, and noticeable only because the team keeps telling the truth.
