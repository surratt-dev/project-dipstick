# Facilitator Review: First Access Exploration Notes
**Reviewer:** Priya Nair, Facilitator (Staff Software Engineer, Platform Team)
**Source:** openspec/changes/first-access/exploration-notes.md
**Date:** 2026-07-05

---

## Framing

The exploration is written from Devon's perspective — an internal champion focused on zero-friction adoption and infrastructure correctness. That framing is appropriate for what Devon cares about. But it leaves a gap that I care about: the actual human experience of someone landing on the no-team page for the first time, and the facilitator workflow that makes the join link instruction actionable.

I am not reviewing the technical constraints. The upsert pattern, the sub/iss identity matching, the race condition risk — those are all either correct or flagged appropriately, and the BA review covers them in detail. What I am reviewing is whether this exploration, as written, would lead to a tool that feels like it belongs in a live session context and does not add friction at the moment it matters most.

My short answer: it mostly captures the right structural constraints, but it is almost entirely silent on the user experience of the no-team state, and it does not address the facilitator's role in making the join link instruction work.

---

## Observations

### 1. The no-team page is described as a structural constraint, not as a first impression

The exploration correctly identifies that the no-team page must not look like a broken page and must surface one instruction. But it describes this in terms of what must be absent (no nav, no empty dashboards, no create-team affordance) rather than what the page must communicate to a person who has no idea what they just signed up for.

A first-time participant who lands on this page has likely received a calendar invite for an "Engineering Health Check" session, been told to "sign into the tool," and done so. They now see a screen that tells them they are not a member of any team and should ask their facilitator for a join link. They do not know what an Engineering Health Check is. They do not know what voting means. They do not know whether they've done something wrong.

The exploration treats this page as a routing endpoint. It should also be treated as the first thing the tool says to a participant about what the tool is and why they should trust it.

### 2. The join link instruction assumes the facilitator's work is already done

"Ask your facilitator for a join link" only works if the facilitator has already generated the join link and is in a position to share it. The exploration does not describe the facilitator's side of this flow at all. There is an implicit sequence: facilitator generates link, distributes it out-of-band, participants follow it. But the exploration does not address what happens when participants land on the no-team page before the facilitator has completed setup.

For a first session with a new team, this is not a theoretical concern. It is the most common scenario. Participants are told to sign in. They sign in. They see the no-team page. Some of them ping the facilitator immediately asking if they did something wrong. The facilitator is busy setting up the session. The no-team page needs to set expectations that this state is temporary and normal — not just technically accurate.

### 3. The facilitator's own first-access path is not described

The exploration describes First Access as the path a new participant takes. But if I am a facilitator who is being set up on a new team for the first time, I also go through this flow. I also see the no-team page. The question is: how do I get from the no-team page to having a team I can facilitate?

The use cases say that join links are generated as part of Session Setup, not here. That is correct as a structural division. But it means the exploration is describing only half of the first-access story: the participant's path in is described (follow a join link), but the facilitator's path in is not described anywhere in this feature set. The exploration should at least acknowledge this boundary and confirm that facilitator account setup is handled elsewhere.

### 4. The "one action only" constraint is correct but the reasoning is incomplete

The exploration states that the no-team page should offer exactly one next action. I agree with this. But the stated reason is about preventing confusion and maintaining structural integrity of the no-team state. The deeper reason — and the one that matters to me as a facilitator — is that the right state for a participant who has no team membership is to wait for the facilitator to bring them in. Any affordance that lets them do something else (browse content, create a team, explore settings) would undercut the facilitator's role in pacing the onboarding.

The "one action only" constraint is load-bearing for the ceremony in a way the exploration does not articulate. If the page let participants do things independently, the facilitator loses the ability to control when and how participants are brought into the team context. That matters for first sessions in particular, where the facilitator's introduction to the ritual is part of what makes the first session successful.

### 5. The edge case of a facilitator losing all team memberships is more significant than acknowledged

The exploration flags the "previously active user with no team memberships" scenario and correctly concludes that the no-team page should apply in both cases. But it does not consider what this means specifically for a facilitator.

I facilitate for three teams. If I am removed from one team but not the others, the no-team page does not apply to me. But if I am removed from all three — because the teams were disbanded, because someone made an administrative error, because I am being transitioned off the program — I land on the no-team page with no indication that I have prior history with the tool. The page as described makes no distinction between a new user who has never participated and a returning user who has facilitated dozens of sessions.

The structural requirement (live team membership check, not a first-access flag) is correct. The UX question — what does the page say to a returning user who happens to have no current team memberships — is not addressed.

### 6. The transition from no-team to team-member is not described

The exploration describes the no-team page as a static state. But a participant who follows a join link moves from no-team to team-member in a single action. What does that transition feel like? Does the application confirm the join? Does it redirect the participant immediately to the team view? Does the facilitator see the participant appear in a readiness grid in real time?

The exploration notes that the no-team page should only be shown when accurate (section 4 — "should the application redirect them if they have a team?"). But it does not describe the positive case: the moment the participant successfully joins. That transition is the first moment the tool delivers on its promise. It should be described, even briefly.

### 7. The no-team page's "temporary" nature is not surfaced to the user

The exploration describes this as a "holding state." The current NoTeamPage.tsx content (per section 5) says "No further setup is required on your end" — which addresses anxiety about whether the user has done something wrong. But it does not communicate that the state is temporary and that the participant will be able to proceed once they receive the join link. A participant sitting on this page with no join link in hand has no way to know whether this is a problem or a normal part of the flow.

---

## Questions

**Q1.** What does the no-team page say about what the tool is? Does it name the Engineering Health Check? Does it give a participant who has never heard the term any context for what they are joining? Or is it purely a membership status message?

**Q2.** How does a participant know when they have successfully received and followed a join link? Is there a confirmation? Is there a visual transition? Does anything on the no-team page update in real time, or does it only resolve when the participant navigates away?

**Q3.** For a first session with a new team, what is the expected sequencing? Does the facilitator generate the join link before any participants sign in, or can participants sign in first and then follow the link? The no-team page experience differs significantly depending on the answer.

**Q4.** If a returning user lands on the no-team page — someone who has participated in sessions before but has lost all team memberships — does the page give them any indication that their account history is intact and they just need to rejoin? Or does the page look identical to the first-time experience?

**Q5.** The use case for "Enforce Access Control on Team Content" states that a facilitator's access to team content is scoped to sessions they are actively facilitating. Between sessions, does a facilitator have a persistent team relationship that keeps them off the no-team page, or does their access expire when the session ends? This matters for whether a facilitator sees the no-team page between sessions.

**Q6.** The exploration prohibits "create a team" on the no-team page and says team creation is not a participant action. But someone has to create teams. Who creates a team in the first instance, and does that path go through the no-team page or bypass it?

---

## Suggested Additions

### A. Add a "tone and content" specification for the no-team page

The exploration specifies the structural elements (what must and must not appear) but not the tone or content of the message. Suggest adding:

- A statement that confirms the state is expected and temporary, not an error
- A brief description of what the tool is, so a participant who has no prior context understands what they are joining
- A statement that sets expectations for what happens next (once you have the join link, you will be able to participate in your team's session)

This does not require adding navigation or additional affordances. It requires the text to do more work.

### B. Describe the no-team page from the perspective of a returning user

Add a scenario: a user who has previously participated in sessions, was removed from all teams, and now signs in. What does the page say? Is the message identical to the first-access message? Should it acknowledge prior activity? This scenario will happen — facilitator handoffs, team restructuring, and team dissolution all produce it.

### C. Explicitly describe the join flow transition

Add a brief description of what the application does and shows when a participant follows a valid join link from the no-team state. At minimum: the join succeeds, the participant is redirected, and the transition is not jarring or ambiguous. This does not need to be fully specified here — it belongs in Session Setup — but the exploration should note the dependency and confirm the transition is covered elsewhere.

### D. Acknowledge the facilitator's own onboarding path

The exploration describes First Access as a user journey that ends at the no-team page. For facilitators, this journey has a different continuation: they need to be set up on a team they will facilitate, not just wait for a join link. The exploration should explicitly note that facilitator account setup — getting from no-team to a role on a team — is handled by a different part of the system (team creation, session setup) and is out of scope for this feature. Right now it is simply absent, which reads as an oversight.

### E. Note the timing dependency for first sessions

Add a note to the no-team page specification: because the no-team page is the first thing a participant sees before joining, the facilitator must have a join link ready to distribute before directing participants to sign in. This is not a technical constraint but a facilitation dependency that the no-team page creates. If a session is being set up for the first time, the sequence matters: team creation and join link generation should precede participant sign-in, or the no-team page experience needs to account for a waiting period.
