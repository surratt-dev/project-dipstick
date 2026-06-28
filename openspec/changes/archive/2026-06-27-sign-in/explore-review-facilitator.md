# Sign-In Exploration — Facilitator Review

**Reviewer:** Priya Nair, Staff Software Engineer / Facilitator
**Date:** 2026-06-25
**Reviewing:** exploration-notes.md (Devon's perspective)

---

## Overall Assessment

Devon's exploration gets the big things right: sign-in should be forgettable, the join link is the critical adoption path, and the no-team state must not feel like an error. I agree with all of that. My review adds what I see from the other side of the table — the facilitator who just sent six people a join link and needs all of them in the session in the next three minutes.

---

## Observations

### What is well-covered

- The join link surviving the auth redirect is correctly identified as the highest-risk item. I have lost time in sessions because of exactly this kind of thing with other tools. Tested, not "we think it works" — yes.
- Role-blind sign-in is exactly right. If the app asks someone "are you an engineer or a manager?" before they even have a team, it has already created a weird moment.
- The "waiting room, not empty dashboard" framing for the no-team state is the correct instinct.
- Session lifetime and silent token refresh — if someone gets kicked out during voting, I lose the room. That risk is appropriately elevated here.

### What is missing or underexplored

1. **The facilitator's pre-session setup moment is not addressed.** Before a session, I generate join links and distribute them. I need to be signed in and on the session setup screen before participants start arriving. If my own sign-in is slow or fails, I cannot distribute links, and the session does not happen. The exploration treats sign-in as a participant concern. It is also a facilitator-readiness concern. If I am fumbling with authentication while people are waiting in a Zoom call, the ritual starts with friction I caused.

2. **Batch arrival is not discussed.** When I send a join link to a team Slack channel, six people click it within 30 seconds. The exploration covers the single-user join-link-through-auth flow but says nothing about what happens when the identity provider gets six concurrent OIDC redirects from the same application. Is there a rate limit? Does the application's callback handler serialize or parallelize? If one person's First Access account creation blocks another's redirect completion, arrival feels broken even though nothing is technically wrong.

3. **The "someone in the room cannot get in" scenario needs a facilitator-side signal.** Right now, if a participant's sign-in fails, they see an error message. I see nothing. I am watching my readiness grid wondering why only five of six people are in. The exploration does not discuss whether the facilitator has any visibility into join failures — not the details, but the fact that someone attempted to join and could not. Even a count of "pending joins" versus "completed joins" would tell me whether to keep waiting or ask in the room "is anyone having trouble?"

4. **The join link for someone who has never used the application before — the true cold start — needs more attention to time.** Devon describes the flow: click link, redirect to IdP, authenticate, First Access creates account, join flow completes, land on team. That is at minimum four redirects and an account creation. On a corporate Entra instance with MFA, that could be 30-60 seconds. For someone who has used the app before, it might be 5 seconds. The exploration does not address the experience gap between returning users and true first-timers, or what the facilitator should expect in terms of how long to wait before starting.

5. **What does the participant see between "I clicked the join link" and "I am in the session"?** The exploration covers the endpoints — the click and the landing — but not the in-between. If there are three redirects and a loading state, does the participant see a blank page? A spinner? The application's branding? For a first-time user who has never seen this tool, the in-between state is where anxiety lives. "Did it work? Should I click again? Did I break something?"

6. **Re-joining after a connection drop during a live session.** Devon covers token expiry, but not network drops. If a participant's laptop loses Wi-Fi for 20 seconds and reconnects, do they need to re-authenticate? If the WebSocket reconnects but the session cookie is still valid, do they land back in the session at the right state? From my chair, I need to know: if someone disappears from my readiness grid and comes back 30 seconds later, are they back where they were, or do they have to start over?

7. **Multiple tabs or devices.** An engineer might have the session open on their laptop and accidentally open the join link again on their phone when checking Slack. The exploration mentions the "already a member" case for join links but does not address concurrent sessions from the same account. Can they be signed in on two devices? If so, do both show the session? If one votes, does the other reflect it? This matters because I have seen people accidentally vote twice in the physical version — the digital version should make that impossible, and sign-in is where that constraint starts.

---

## Questions for the Exploration

1. When I send a join link, is there any way for me to know — from within the application — how many people have successfully joined versus how many have the link but have not completed sign-in yet? I do not need to see who failed. I need to know whether to wait or start.

2. If a participant's First Access takes 45 seconds because of MFA enrollment, and I have already started the session, do they join the session in progress? Or do they land on the team view and then need to separately join the active session? The join link should land them in the session, not just on the team.

3. Has anyone mapped the actual redirect chain for the join-link-through-auth flow and counted the number of page transitions a first-time user will see? I would like to see that documented. Every redirect is a moment where someone might think it is broken.

4. The exploration mentions error messages for IdP failures should be human-readable. Agreed. But who do participants contact when they cannot get in? The error message should tell them — "ask your facilitator" or "ask your IT team" depending on the failure type. If they come to me and it is an IdP problem, I cannot help them. If they go to IT and it is an application problem, IT cannot help them either.

---

## Suggested Additions to the Exploration

- **Add a "Facilitator pre-session readiness" section.** The facilitator's own sign-in is a prerequisite for the session happening at all. Document the expected flow: facilitator signs in, navigates to session setup, generates/distributes join links, monitors arrivals.

- **Add a "Batch arrival" consideration.** Document expected behavior when multiple users authenticate concurrently through the same join link flow.

- **Add a "Session-aware join link" note.** If a session is already active when someone completes the join-link-through-auth flow, the destination should be the active session, not the team dashboard. The join link should be smart enough to know that context.

- **Add an "In-transit experience" note.** Specify what users see during the redirect chain between clicking the join link and landing in the application. This is especially important for first-time users who have no mental model of what the application looks like.

- **Add a "Facilitator visibility into join status" question.** The facilitator needs some signal — not personal details, not error logs — just a sense of whether people are successfully getting in or stuck at the door.

---

## Priority from Facilitator Perspective

If I had to rank what matters most for my sessions:

1. **Join link integrity through auth redirect** — if this breaks, adoption fails. Devon is right to call this out as the top priority.
2. **Session-aware join links** — landing on the team page instead of the active session wastes time I do not have.
3. **Silent token refresh / no mid-session auth failures** — if someone gets kicked out during voting, the reveal is compromised.
4. **Facilitator visibility into arrival status** — I need to know when everyone is in so I can start.
5. **First-time user in-transit experience** — minimize the anxiety between clicking the link and seeing the session.
6. **Batch arrival performance** — the whole team clicks at once; the system needs to handle that gracefully.
