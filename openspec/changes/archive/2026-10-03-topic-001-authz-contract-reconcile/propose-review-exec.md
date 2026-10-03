# Proposal Review: Executive Stakeholder

**Reviewer:** Rachel Okonkwo, VP Engineering (Executive Sponsor)
**Change:** `topic-001-authz-contract-reconcile` (GitHub #187)
**Focus:** Strategic alignment, adoption goals, scope proportionality
**Verdict:** **Approve, with three conditions** (below)

---

## 1. Strategic alignment: strong

This change protects the boundary I care about most. "Managers can view trends and action items but cannot take part in sessions" only works if engineers believe the team's space belongs to the team. The proposal makes the right point: the risk is not today's payload, which leaks nothing. The risk is `teamAnnotation` ("Our team's definition"). If managers can read the place where a team describes its health in its own words, the team will write those words for the manager, and the ritual stops being honest. That leads straight to my success criterion #4, "no engineer feels the data is evaluative," and to my deepest concern, that this starts to feel like surveillance.

Fixing it now, while TOPIC-001 has no production consumer, is the right call. This is the cheapest the fix will ever be. Once a UI depends on the current behavior, it will cost a migration and a conversation.

I also endorse these decisions:
- **Unconditional, with no flag or override.** I do not want a configuration setting that someone could quietly switch on for "just one team." Matching TEAM-005's wording is correct.
- **OR semantics for "engineering manager."** Covering a demoted or link-joined global EM closes the obvious workaround. Engineers will not trust a boundary that has a side door.
- **Application Admin denial kept on purpose.** Admins administer; they do not browse team content. Routing them to TOPIC-002 and writing an audit row is consistent with "signal without surveillance."
- **Non-revealing denial.** Fine. Low cost, and it removes a whole class of argument.

**On "needs no VP sign-off":** I agree. This puts the code in line with policy that is already written down (BRD FR-9.5, Constraint 2, the content matrix). It does not set new policy. I am consulted on who sees what, and nothing here changes that. Ship it without waiting on me. A one-line note in the release summary is enough.

## 2. Adoption impact: neutral today, positive for trust

No user-visible change, no workflow change for facilitators, participants, or EMs, and no frontend consumer. That is what I want from a defect fix: no onboarding friction and no change-management cost. EMs keep their intended views through TREND-001 and SESSION-007/008, so the manager experience I committed to my peers is unaffected.

## 3. Scope proportionality: mostly right, with one pressure point

The core fix is small: one allow-list predicate in one handler, plus contract corrections. Deferring the camelCase remap, `teamAnnotation`, and the retire-the-endpoint question shows good discipline. I'm glad to see the out-of-scope list stated explicitly.

The pressure point is **Decision 1 (task group 2).** Option A1 adds `membershipRole` to the shared `TeamAccessGrant` type. That touches a shared type, the access helper, a realtime payload, and fixtures across four or more test suites, all to fix one endpoint that nobody calls yet. That is how a defect fix turns into a grant-model refactor. Option B keeps the change inside the TOPIC-001 handler.

- **Condition 1:** The architect decides Decision 1 quickly and writes down the reason. A1 is acceptable **only if** there is concrete, near-term reuse, for example the `teamAnnotation` consumer change or another endpoint that has to detect path 2'. If the only justification is "cleaner model," choose B and leave the refactor for when a second consumer needs it. Either way, this decision must not block the fix for more than a day.

The test plan is thorough. A couple of cases (the drifted facilitator, which the app cannot create, and the timing-floor test) are past what I would normally ask for. Given the security-reviewer gate and how small each test is, I won't object. I am noting it so the pattern doesn't grow on the next change.

## 4. One adoption gap to keep track of, not to fix here

The "Considered, not chosen" section says TOPIC-001 is the only topic-configuration read a participant has. It also says the use case currently has engineers see topics only in the room. That matters for adoption. One of my stated risks is that the first session has to be low-friction, and a team champion may want to preview the topics before the first session. Deferring this out of the change is correct.

- **Condition 2:** The BA opens a tracked issue, with an owner, for the question of a participant topic preview before the first session, to be resolved with facilitator stakeholders. It should not live only in this proposal's prose. It also bears on whether TOPIC-001 is retired later, so the two questions should stay connected.

## 5. Trust communication

Because nothing user-visible changes, no broad announcement is needed. Still, team champions are the people who will tell skeptical engineers "your manager can't see this."

- **Condition 3:** When `teamAnnotation` ships, its release notes should state plainly that engineering managers cannot read the team's definitions, and cite this change. That is where this fix pays off for adoption, so we should say so then.

## Summary

This change is aligned, proportionate, and well timed. It enforces a non-negotiable trust boundary at near-zero adoption cost before the boundary carries anything sensitive. Approve. Keep Decision 1 from growing the change into a refactor, give the onboarding preview question an owner, and use the boundary in the `teamAnnotation` messaging when that ships.
