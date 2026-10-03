# Explore Review: Facilitator (Priya Nair)

**Change:** topic-001-authz-contract-reconcile (GitHub #187)
**Reviewing:** exploration-notes.md (Devon Calloway)
**Lens:** Does this capture real user pain and workflow friction? Do the people who legitimately need TOPIC-001 keep it? Will the result stay out of the way during a session?

---

## Bottom line

I support closing the EM path now. Devon's reasoning about the team definition matches what I see in rooms. A team writes differently once it suspects the manager will read it, and it doesn't announce the change. Nobody files a bug about this. The words just get blander. So "nothing is broken for users today" is accurate, and it's also why this is the right time.

The notes are strong on code and contract. They're thinner on the people who keep access, on what the denial looks like to a person, and on who the first real consumer will be. My additions are below.

---

## Observations

1. **There's no user-visible friction today, and the notes say so honestly.** TOPIC-001 has no frontend caller (section 4). Topic Management reads TOPIC-002, and the live session reads the snapshot. No facilitator or participant workflow changes on the day this ships. Please put that sentence in the proposal so reviewers don't hunt for a UX regression that can't exist.

2. **Facilitators keep access, but only through the session-scoped grant.** TOPIC-001 admits a facilitator through path 3: an open session, a draft under 24h, or the post-complete grace window. My prep happens days before a session, through Topic Management (TOPIC-002, a standing facilitator grant). So this change takes nothing from my prep workflow. The proposal should still say plainly that **the facilitator branch is not touched** and that the "EM" predicate never looks at a facilitator grant.

3. **Participants keep access, and that matters for the likely first consumer.** Participants appear only in TOPIC-001's column. TOPIC-002 says "No" for them. TOPIC-001 is therefore the only topic-configuration read a participant has. When we build what the BRD asks for on first-session support (letting a new team see the topics, prompts, and `firstSessionDescription` before or during the first session), TOPIC-001 is the obvious endpoint. Its first real consumer is probably participant-facing onboarding, not an EM view. That bears on Open Question 2 (casing) and Open Question 6 (retire it?), and the notes don't say it.

4. **The strict "OR" EM definition (Open Question 1) is the right call from the room's point of view, with one condition.** The vote lock-in (`sessions.ts`) already treats either signal as "this person is an EM". If TOPIC-001 used the looser dual-check, the same person could be "a manager" when they try to vote and "a participant" when they read the team's own words. Two answers for one person is the kind of seam that erodes trust in the rule. So: OR semantics, consistent with voting. The condition is in Question 1 below.

5. **A misconfigured real participant pays the cost of the strict rule.** Path 2' (EM membership row, non-EM global role) is most likely a data-entry mistake, such as an engineer who was tagged EM by accident. Under OR they lose TOPIC-001. They are *already* blocked from voting by `sessions.ts`, so this adds no new harm. Still, the person's experience is "the app says no and I don't know why", and in a live room that turns into a facilitator problem. The `team.access_grant_mismatch` log is the admin's diagnostic. The notes should say that this log is how the mis-tag gets found and fixed, so support has a path besides "file a ticket".

6. **The admin call (keep the denial, fix the docs) is fine for facilitators.** When an admin helps me troubleshoot a team's topics, they use the same Topic Management screen I use (TOPIC-002, read-only on annotations). Admitting admins to a second read path buys nobody anything. I agree with Section 5.

7. **Section 6 point 2 (no configurability) is the most important line for the ceremony.** "No flag, no admin override, no setting" has to land in the spec in the same words as TEAM-005. I've been asked in real sessions whether "the manager can just see the topics, it's harmless". With a structural rule I can say "the tool doesn't allow it" and avoid a social negotiation. A setting would put that negotiation back on the facilitator.

8. **Section 6 point 3 (don't add `teamAnnotation` in the same change) is right.** The in-room display reads the snapshot. Nothing I do in a session needs TOPIC-001 to carry the annotation.

---

## Questions

1. **(Open Question 1) Is the OR predicate scoped to `path: "member"` grants only?** Devon writes "deny a participant grant whose `actorGlobalRole` is `engineering_manager`". Please state explicitly that a `path: "facilitator"` grant is never denied by this check. The BRD and SESSION-001 don't seem to let an EM facilitate (SESSION-001 requires `global_role = facilitator`). If that ever changes, cross-team facilitation is a different question from managing your own team, and it shouldn't be decided by accident here. Could the explorer confirm that a facilitator grant can't carry `actorGlobalRole = engineering_manager` today, and add a test that pins it?

2. **What does an EM actually see if a future UI calls TOPIC-001?** The 403 is correct for the API. The UX contract should be that EM-facing screens *never call* TOPIC-001, so an EM never meets a "you don't have access" wall about their own team. Being told "no" about your own team's page feels like surveillance in reverse. Should the proposal add one line to the contract's TOPIC-001 notes ("EM-facing views use TREND-001 / SESSION-007/008; do not call TOPIC-001 from EM flows"), matching the "Scope boundary" note on TOPIC-002?

3. **(Open Question 2) Casing: whose convenience are we optimizing?** If the first consumer is participant onboarding (Observation 3), it will need `firstSessionDescription` and `isDefault`. Neither is selected today, and both appear only in the camelCase contract shape. Option A hands that future engineer a snake_case response that lacks the fields onboarding needs, under feature pressure. That pushes me toward B. I defer to the architect on blast radius, but please weigh this point.

4. **(Open Question 6) Retirement.** Given Observation 3, I'd argue *against* Option C even as a future direction, unless TOPIC-002 gains a participant read mode. Can the proposal's "considered, not chosen" sentence name participant access as the reason?

5. **Facilitator window wording (Section 6 point 7).** The code admits drafts under 24h and the grace window, but the contract says "active session". If a future UI hides topic previews from a facilitator who is "between" states, for example a draft I created 30 hours ago for next week, I'll see an unexplained gap. Aligning the prose with the actual window costs little now and saves that confusion later. Can this move from "optional" to "in scope"?

---

## Suggested additions to the exploration / proposal

- **A "who keeps access" table** in the proposal: participant (own team) yes, unchanged. Facilitator (open session, draft under 24h, grace window) yes, unchanged. EM (either signal) now 403. Admin 403, confirmed, use TOPIC-002. Reviewers should be able to see at a glance that legitimate users lose nothing.
- **A regression test that a participant and a facilitator still get 200 after the change,** next to the flipped EM tests. Section 7 lists only the EM flips. A wrong allow-list could lock out the people who need the endpoint, and nothing in the current plan would catch it.
- **A test for the path-2' and EM-global/participant-membership cases** if OR semantics is chosen, so the decision is pinned and not just described.
- **A test or assertion that a facilitator grant is never denied by the EM predicate** (Question 1).
- **A contract note that EM flows must not call TOPIC-001** (Question 2), so the EM never sees the denial.
- **A sentence naming participant-facing first-session onboarding as the likely first consumer,** to inform the casing decision and argue against retirement.
- **In the spec, the no-configurability wording copied from TEAM-005:** "no admin override, feature flag, or configuration exception".

---

## Does this lead to a tool that disappears into the background?

Yes. This change has no on-screen footprint, which is right for a structural guardrail. The one way it could surface in a session is if someone who should have access is wrongly denied: a mis-tagged participant, or a facilitator caught by an over-broad predicate. The suggested 200-path regression tests and the facilitator-scope clarification are what keep this invisible.
