# Explore review: facilitator session entry point (#237)

**Reviewer:** Priya Nair (Facilitator, SME)
**Reviewed:** `exploration-notes.md` (Devon Calloway, 2026-10-06)
**Grounded against:** `packages/frontend/src/pages/TeamPage.tsx`, `packages/frontend/src/pages/SessionCreationPage.tsx`, `packages/frontend/src/App.tsx`
**Date:** 2026-10-06

---

## Summary verdict

The notes describe my problem correctly. I am on Platform, I facilitate three product teams, and right now I find the session page by typing a URL. Option A is the right size for a bug fix, and I agree with keeping the membership exclusion structural. But the notes treat this as "add a link" when the friction is really a round trip: get to the picker, understand why my team is not in it, and get back out. The link fixes the first step. The other two need attention, or we will get the "my team is missing" bug report Devon is worried about anyway.

---

## Observations

### O1. The pain is real, and it is the setup before a session, not during it
I don't create sessions with a room watching. I do it the day before or ten minutes before, often from a laptop in a hallway. The entry point needs to be easy to find and calm to use. It does not need to be prominent. That is a good reason to keep it off live surfaces, and I strongly agree with the constraint in section 2 that it must not render on `/session/:id`, `/session/:id/live`, `/session/:id/facilitator` or `DraftSessionHost`. The control surface during a session should only hold what I need during a session.

### O2. "For another team" means nothing on today's `TeamPage`
I checked `TeamPage.tsx`. The heading is a bare **"Team"**, and the "Members" list shows *every* team I belong to (`session.teamMemberships`). It does not show the team in the URL. The page never names the team I am looking at. So a label like "Facilitate a session for another team" is relative to a team the page never names. It is better than "Start a session," but it only half-works. The wording has to stand on its own without the page's context (see Q1 and S1).

### O3. The confusing moment is on the picker, not on the team page
Devon's concern is a facilitator on their home team who clicks the link and doesn't see that team in the picker. From `SessionCreationPage.tsx`, the populated picker shows **"Create a session"** and a list of teams. Nothing tells me my own team is deliberately left out. The only explanation is in the *empty* state ("You're already a member of every team..."). Most facilitators will see a populated list, so they never see why their team is missing. The link label alone won't prevent the bug report. The picker has to say it too. This is cheap: one line of copy, and the endpoint already returns `callerHasTeamMemberships`.

### O4. The exclusion is a feature of the ritual. Say so, don't hide it
When I onboard a new facilitator, the first rule I teach is that you never facilitate your own team. The app should state that plainly, as a reason and not as an error: "Your own team isn't listed. Facilitators run sessions for teams they're not on." That reinforces FR-2.2 for people learning the role, and it heads off the request to "make the exclusion optional."

### O5. `/sessions/new` is a dead end in the other direction
The picker page has no back link and no sign-out (I didn't see a `SignOutButton` in the picker render). A facilitator who opens it to check something, or by mistake, has to use the browser back button or edit the URL. If we fix one dead end, we shouldn't leave the opposite one in place. Yes, a link back is needed (see Q3).

### O6. Getting back to a draft or lobby session is a bigger pain than the notes suggest
I almost always create the session ahead of time, then come back to open the lobby when people arrive. Today the only way back is to go through confirm and hit the 409, which shows "Go to your existing session". In practice that path is an error message. It works, but it is exactly the moment I don't want to fight the tool, with people walking into the room. I agree that option D belongs in a separate issue. I would like that issue filed *now*, as part of this change, so it doesn't get lost. I'd rate it higher than the issue notes imply.

### O7. The "Topics" side observation is real, and it is the same failure
Section 4, item 5 is right. On my home team, "Topics" leads to a `FACILITATOR_IS_TEAM_MEMBER` denial. If we add one carefully worded link next to one that sends me to a denial, the page as a whole still misleads. It's fine to keep it out of scope, but please file it, and don't put the new link right next to "Topics" in a way that makes the two look like a matched pair.

### O8. Participant integrity on the home team
When I am a participant in my home team's session, nothing should suggest I am "the facilitator." The notes cover this for live routes. One more point: the team page link should not change how my home team's members view the page. It shows only to me, which `canFacilitateSessions` already ensures. Fine as written.

---

## Answers to the open questions (section 4)

### Q1. Wording
My recommendation is **"Facilitate another team's session"**. Second choice: **"Facilitate a session for another team"**, which is accurate but long.
- Reject **"Create a session"** on the team page. Next to a team's member list it reads as "for this team," the exact drift Devon described.
- Reject **"Facilitate"** alone. It is too terse, and on my home team it suggests the wrong thing.
- The word "facilitate" carries weight. It names my role, not a generic action, and it tells a participant (who never sees the link) nothing. Keep it.
- Put a short helper line under the link if layout allows: *"You can't facilitate your own team."* That makes it clear on a page that doesn't name the current team (O2).

### Q2. Placement
**Not next to "Topics", and not as a big primary button at the top.** Put it in its own small "Facilitator" block at the top of the page, above "Members", visually separate from team-scoped links. Reasons:
- It isn't a team-scoped action, so it shouldn't sit among team-scoped links (Topics, member management).
- Facilitators land on this page *because* of their home team. For them the link is the main reason to be there, so it shouldn't be under the member list.
- A modest labeled block ("Facilitator" heading, one link) is also what B or D can absorb later without anyone needing to unlearn a habit.

### Q3. Back-to-team link on `/sessions/new`
**Yes, needed.** Specifics:
- Render it only when `teamMemberships.length > 0`, so the zero-membership facilitator arriving from `/no-team` sees nothing that presupposes membership.
- Label it as *my* team, not "back": **"Go to your team"**. With several memberships, link to the first one (consistent with landing) or list them. Either is fine. Don't build a team switcher for this.
- Show it on the picker view only, not on confirm. Confirm already has "Back" to the picker, and two "back" controls there would compete.
- Add sign-out to the picker page too, since it is a landing page for zero-membership facilitators.

### Q4. Returning to an in-progress draft or lobby
Yes, it's needed (O6). File it as a follow-up issue from this change. A low-cost interim option to *evaluate*, not necessarily build: the picker could mark teams that already have a session in progress and send me straight to it instead of making me hit the 409. That stays within the picker and the existing endpoint shape.

### Q5. Topics link on home team
File it separately (O7). It's the same class of problem.

---

## Suggested additions to the exploration

1. **S1: Picker copy explaining the exclusion (populated state).** Add a scenario: when `callerHasTeamMemberships` is true and eligible teams are listed, the picker states that the caller's own team(s) aren't listed and why. This is the main defense against the "missing team" bug. Treat it as in scope for option A.
2. **S2: Back-to-team link scenario.** On `/sessions/new` (picker view), a facilitator with memberships sees a link to their team. A zero-membership facilitator does not.
3. **S3: Negative placement scenario.** The entry point doesn't render on any live-session route or `DraftSessionHost`, and `/no-team` stays bare. Make the section 2 constraint testable, not just a comment.
4. **S4: Label test that ties to intent, not just text.** Component tests should check that the link is absent when `canFacilitateSessions` is false, *including for an EM who is also sent the facilitator claim*. That case has regressed before (#243), and it is my "no manager participates" line.
5. **S5: File follow-ups as part of this change:** (a) resume a draft or lobby session (option D, or the picker interim); (b) the Topics link on the home team; (c) the `facilitator-002` persona fixture. I'd use (c) for usability testing of anything facilitator-facing, so it deserves more priority than "dev experience."
6. **S6: Walkthrough before merge.** I offered to test facilitator-facing UI. This is small, but it's the first time a facilitator *with a home team* uses the app as designed. Use the manual reproduction path in section 6 option 1, and close or abandon the odd self-facilitated session first so the walkthrough doesn't start from a state real users won't be in.

---

## Does this lead to a tool that disappears into the background?

Mostly yes. Keeping the link off live surfaces and out of a new global layout is right. The risk is the one I raised in O3: if the picker leaves people confused, the tool becomes something facilitators have to explain or work around before every session. Fixing the picker copy and adding the way back makes this a trip through the app with nothing to think about, which is what "disappears" should mean for setup work.
