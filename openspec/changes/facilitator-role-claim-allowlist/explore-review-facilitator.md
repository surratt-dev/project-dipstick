# Explore review: facilitator role-claim allowlist (#235)

**Reviewer:** Priya Nair (Facilitator, SME)
**Date:** 2026-10-03
**Reviewing:** `exploration-notes.md` (Devon Calloway)

I agree with Option A and with all four findings. Finding 1 (demotion is not audited) matters most to me. My comments are about what this looks like from my chair. The notes describe the backend well, but they say almost nothing about what a person sees.

---

## Observations

1. **The real pain point is correct and well put.** Today I can't run a session without someone running SQL, and the role is lost again at the next sign-in. If role-claim mapping takes `facilitator`, the tool stops needing a workaround.
2. **A would-be facilitator gets misleading copy (missing from the notes).** Suppose someone signs in without the role and with no team membership, for example because the IdP admin hasn't assigned the role yet or assigned two Entra roles (Finding 3). They land on `NoTeamPage.tsx:44-50`, which says "ask your facilitator for a join link … No further setup is required on your end." For someone who *is* meant to be the facilitator, that is wrong, and it gives them no hint about what to do. If they go to `/sessions/new` directly, `SessionCreationPage.tsx:116` sends them back to `/` without a word. The API 403 ("Only a facilitator can create a draft session.") is never shown to them. The two-role Entra case makes this worse: the only signal is a server-side warning that nobody in the room will see.
3. **A facilitator who belongs to any team can't find session creation (missing, and it affects me).** `AuthenticatedLanding` (`App.tsx:34-41`) checks memberships *before* `canFacilitateSessions`, so a facilitator with a team membership is sent to their own team view. I searched the frontend. `/sessions/new` is reached only from those two redirects, and the team view has no link to it. I am a member of the Platform team and facilitate three *other* teams. That is the normal facilitator profile, not an edge case. Once #235 makes the role real, every facilitator like me will hit this on day one.
4. **Role-change latency is bounded, and the notes undersell that.** The notes say "until next sign-in". `middleware.ts:34` enforces a 90-minute absolute session lifetime, and the refresh path doesn't re-read the role claim. In practice a grant or revoke takes effect within about 90 minutes, or at once if the person signs out and back in. That is a much more useful sentence for the deployment docs and for the person granting the role.
5. **Mid-ceremony re-authentication is a risk to the room.** A live session that runs past 90 minutes forces me to re-authenticate. If my IdP role changed in the meantime, for example because someone fixed my app roles that morning, I come back as a different role partway through. Live checks happen at open and draft (`facilitator-sessions.ts:846-860`), so I may keep or lose controls depending on where I am in the flow. That edge case is rare, but its cost is the whole session. Mention it, even if it is only documented.
6. **Local hands-on friction mostly goes away.** The "Order matters / re-run the UPDATE after every sign-in" warning (`topic-add-form-hands-on-check.md:46`) was the most error-prone step for me as a tester. Removing it is a real gain in usability-testing readiness, which I've asked for before a first team goes live.

## Questions

- Q1. What should a signed-in user with no role and no team see when they expected to be a facilitator? I suggest a neutral line on `/no-team`: "Expecting to facilitate? Your facilitator role is assigned by your identity provider. Ask your IdP admin, then sign in again." It should not list roles or explain why they don't have one.
- Q2. Is the missing route into session creation for member-facilitators (Observation 3) in scope for #235? If not, can a follow-up issue be filed *before* #235 ships, so the first real facilitator doesn't find it in front of a team?
- Q3. Finding 2 (EM reassigned to facilitator): when a sign-in changes a role, can the person see that change anywhere, such as a header badge, so they know which hat they're wearing before the room fills?
- Q4. Does the 90-minute absolute lifetime fit a session with many topics? This is outside #235, but making facilitation real makes it urgent.

## Suggested additions to the exploration

- A **"What the person sees"** section covering three cases: no role and no team, no role but a team member, and the role granted while already signed in. For each, cite the page and the copy shown.
- In Finding 4, replace "next sign-in" with "within the 90-minute absolute session lifetime, or immediately on sign-out and sign-in". The docs should tell a newly granted facilitator to sign out and back in.
- Add Observation 3 as **Finding 5**, either as in-scope or as a follow-up that must be filed before release.
- Deployment docs: a short troubleshooting entry, "I was given facilitator but still see the join-link page". Likely causes: not signed in again, two app roles assigned (Finding 3), or the wrong `OIDC_ROLE_CLAIM` name.
- Local dev: make sure the persona page still clearly separates facilitator-001 (non-member) from team-member accounts, so testers don't confuse the two landings. Consider whether a second facilitator persona *with* a team membership is needed to reproduce Observation 3 locally.

## Will the tool disappear into the background?

For the backend, yes: one writer and no assign button means nothing for me to manage during a session. For the facilitator's experience, not yet. Observations 2 and 3 mean a correctly assigned facilitator can still sign in and find nothing that looks like facilitation. The first time that happens in front of a team, the ceremony starts with me troubleshooting instead of facilitating. I'd ask the team not to call #235 done until a member-facilitator can get from sign-in to "create session" without typing a URL.
