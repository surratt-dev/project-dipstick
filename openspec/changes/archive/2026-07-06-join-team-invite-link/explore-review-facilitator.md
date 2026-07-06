# Exploration Review: Join a Team via Invite Link
**Reviewer:** Priya Nair, Staff Software Engineer / Facilitator
**Date:** 2026-07-05

---

## Overall Read

The exploration is thorough on the technical and ritual-constraint questions Devon cares about. The structural gaps — silent through-auth failure, missing revocation endpoint, `sourceIp` placeholder — are correctly called out. The EM protection analysis is sound, and I agree with the conclusion that the join layer is the wrong enforcement point.

What is largely absent is the facilitator's lived experience of this flow. The exploration is written from the perspective of someone who designed the ceremony and cares about its integrity at the architecture level. I care about that too. But I also have to stand in a room — or a call — with a group of engineers who are seeing this tool for the first time, and the join link is the first thing they will interact with. The exploration does not ask what those engineers experience, or what I experience trying to get them into a session that has already started.

The observations below focus on what is missing from that angle.

---

## Observations

**1. The mid-session arrival case is not explored.**

The spec says: if an active session exists at join time, the user is directed to `/session/:sessionId`. The exploration does not ask what that landing looks like or how it works. This matters enormously in practice. The most common scenario I encounter is: session starts, a few people are still coming through the door (or clicking the link). They land in an active session mid-vote. What do they see? Can they vote on the current topic, or do they observe? If they can vote, the readiness grid now has a new row and the facilitator has to wait. If they cannot vote, they are passive on their first topic, which is a strange way to start.

The exploration calls out that the join link flow completes and routes users to the active session. It does not ask what "arriving in an active session" means for the participant or for the facilitator's view. That is a significant gap.

**2. The facilitator has no signal that someone just arrived.**

When I am running a session and someone joins mid-flow, I need to know. Right now I track this by watching faces or asking "is everyone here?" The readiness grid is supposed to replace that mental tracking. But the exploration does not address whether the readiness grid updates in real time when a new participant joins. If I am three topics in and a new engineer lands on the session page, does a new row appear in my view? Do I get any notification? If not, I may start the reveal before that person has had a chance to vote — or I may not know they are there at all.

This connects to the exploration's note about the batch arrival requirement, which only addresses technical concurrency (no blocking). It says nothing about what the facilitator sees during a batch arrival.

**3. The first-time user experience after through-auth is a black box.**

The exploration correctly identifies the silent failure problem when a token expires during the OIDC flow. It does not ask what a successful through-auth landing looks like for someone who has never seen this tool before. They complete the OIDC flow, they get added to a team, and then what? What is on the team page that tells them what they are looking at, what is about to happen, or what they are expected to do?

The persona says "first-session support" is something I care about deeply — if the application can shoulder some of the mechanical explanation, I can focus on the human side. The join link is the first page a new engineer sees. If it drops them on a team page with no context, they will turn to me for orientation. That is fine in a room; it is friction in a large async situation where I am not immediately available.

**4. The error message for through-auth failure leaves a new user with no path forward.**

The exploration notes that when `pendingJoinToken` fails validation after auth, the user lands on `/no-team` with no error message at all. It calls this a gap and says a user-visible error should be shown. I agree strongly. But the specific message matters. "This link has expired. Ask your facilitator for a new one." is correct. The problem is: a first-time user who just created an account, went through the IdP, and landed on a dead-end page with that message has no idea who their facilitator is, what this tool is, or what they should do next. The message is correct for someone who already knows the context. For a first-time user, it is a wall. The proposal should think about what a recovery path looks like, even if it is just "sign out and try again with a fresh link."

**5. The `?alreadyMember=true` banner is the only join confirmation signal.**

When a user completes the join flow and arrives at `/team/:teamId`, they see a transient notification banner ("already a member" if they were already in, or presumably something analogous for a new join). The exploration does not describe what confirmation a *new* member receives. Is there a "Welcome to the team" moment? Or do they land on the team page with no acknowledgment that they just joined? For a new user, that landing is important. If it is silent, they may click the back button thinking nothing happened.

**6. There is no pre-session roster visibility for the facilitator.**

The join link flow routes new members to `/team/:teamId` if no session is active. The exploration does not address what the team page shows a facilitator before a session starts — specifically, whether the facilitator can see who has joined via a link in preparation for starting a session. I share a link, tell people to use it, and then I want to know that everyone has come through before I start. Right now I do this by asking in chat. If the team page shows me a current member list, this is already handled. If it does not, the join link flow does not give me a way to verify readiness before I start.

**7. The exploration does not ask whether the join link URL is facilitator-visible after generation.**

When I generate a join link, I get back a `JoinLink` response with `id`, `teamId`, `token`, `createdAt`, and `expiresAt`. The exploration does not describe the UI for link generation and sharing. How do I copy the link? Is it a full URL or just the token? Can I see what links I have generated and when they expire? If I generate a new link because I think the old one is not working, how do I know whether the old one expired or was still valid? The revocation gap (section 5d) is correctly identified, but the broader link management UX is not addressed.

---

## Questions

**Q1: What does a user see when they land on `/session/:sessionId` as a new arrival during an active vote?**

Is there a "hold" state while the vote is in progress? A "join the vote" affordance? Or are they immediately presented with the same vote UI as everyone else who arrived before the topic opened? The answer to this drives whether mid-session arrivals disrupt the reveal mechanic.

**Q2: Does the facilitator's readiness grid update in real time as users join mid-session?**

If yes, how is the new participant represented before they have voted? If no, the facilitator may start the reveal with an incomplete picture of who is in the session.

**Q3: What does the team page show a first-time user after a successful join?**

Is there any explanation of the tool, the session format, or what happens next? Or does the team page assume the user already knows?

**Q4: What does the team page show the facilitator about who has joined?**

Is there a pre-session roster that updates as join links are redeemed? This is the mechanism I would use to know whether to wait before starting.

**Q5: For the through-auth failure case, is `/no-team` really the right fallback?**

A user who clicked a join link and authenticated for the first time, then lands on `/no-team`, has no context for what that page means. Should the fallback for the through-auth failure path be a dedicated error page rather than the membership-state page?

**Q6: Is there any rate limiting on join link redemption?**

The batch arrival scenario is addressed from a concurrency standpoint. Is there protection against a link being redeemed by the same user repeatedly, or by an unusual number of users in a short window?

---

## Suggested Additions

**Add to exploration: the mid-session arrival user experience.**

The exploration should describe, even at a high level, what happens to a user who lands on `/session/:sessionId` during an active vote. The decision — whether they are held out until the next topic, allowed to vote, or shown as observers — has direct implications for the reveal integrity and the facilitator's readiness grid. This is not a gap that can be deferred without defining the expected behavior.

**Add to exploration: the facilitator's real-time view during batch arrivals.**

The batch arrival handling requirement (section 91–100 of the spec) covers technical concurrency. The exploration should also address the facilitator's experience: does the readiness grid update in real time, and if so, does it require a UI contract with the session layer that does not yet exist? If there is a dependency on real-time session state for the join flow to "feel complete," that dependency should be documented here.

**Add to implementation gaps: through-auth success state lacks user confirmation.**

Alongside the through-auth failure gap (4c), the exploration should document what a successful first-time through-auth join looks like from the user's perspective. If there is no "welcome" state or join confirmation, the proposal should add one. This is especially important for first-session participants who arrive this way.

**Add to open questions: facilitator link management UI.**

The exploration surfaces the revocation gap but does not address the broader link management experience. As a facilitator, I need to be able to see active links, copy them easily, and understand their status. This should be an open question even if it is not in scope for this change.

**Add to "what this change must not do": do not route through-auth failures to the membership state page.**

The current fallback behavior (routing a through-auth failure to `/no-team` or an existing team) is a symptom of treating the through-auth path as a secondary path rather than a first-class path. The exploration correctly identifies this as a gap and calls for a user-visible error. The "must not do" list should also say: do not let the through-auth failure path end up on a page whose purpose is unrelated to the join flow. The failure should land on the join error state, not the membership state.

---

## Summary Assessment

The exploration is solid on the structural and ritual-constraint questions. The gaps it identifies are real and the guidance on enforcement boundaries is correct. My concern is that the document does not ask whether this feature will hold up in the actual conditions under which it will be used: a facilitator sharing a link in Slack five minutes before a session, first-time users coming through an OIDC flow they have never seen, several people arriving simultaneously into an active vote. Those are the moments that determine whether the join link becomes something that disappears into the background or something I am managing during the session itself.

The proposal that follows this exploration should include at least a high-level answer to the mid-session arrival UX question before any implementation begins. Everything else can be refined in iteration. That one cannot.
