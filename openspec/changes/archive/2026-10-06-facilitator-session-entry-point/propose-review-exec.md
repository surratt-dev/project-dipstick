# Proposal Review: Executive Stakeholder

**Reviewer:** Rachel Okonkwo, VP Engineering (Executive Sponsor)
**Change:** `facilitator-session-entry-point` (#237)
**Focus:** Strategic alignment with adoption goals; scope proportional to value
**Verdict:** **Approve.** Two notes on priorities below, neither blocking.

---

## Strategic alignment

This is the right fix to make, and it should go first.

My biggest adoption worry is that the practice stalls when a team has no champion. Here, the champion is the facilitator. That is a senior engineer from another team who gives up their own time to run sessions. Right now the typical facilitator has a home team, and when they sign in the app gives them no way to the one action their role exists for. If someone has to be told "type `/sessions/new` into the address bar", we have failed at "make the first session low-friction". The volunteers we can least afford to frustrate are the ones who hit this.

It also counts against success criterion 1 (three or more teams with six or more sessions). Each team that adopts needs a facilitator who can actually start a session. Every session goes through this path, so this is not an edge case.

The proposal also treats it correctly as a **bug** against an existing requirement ("regardless of whether the user has any team memberships"), not as a new feature. A test gap left that requirement unenforced, and the change closes the gap with scenarios. That is how I want these handled.

## Policy boundaries (things I hold firm on)

- **Managers stay out of sessions.** The link depends only on the server-computed `canFacilitateSessions`. An EM who is also sent `facilitator` still sees nothing, and R3 tests that case explicitly because it has broken before. Good.
- **Facilitator-from-another-team stays on the server.** The UI explains the rule and does not enforce it. The entry point never lists or pre-selects teams. So nobody can later "fix" a missing team in the frontend, and the reporting-chain filter (#247) can go in later without UI work. I support this.
- **Nothing reveals the reporting chain.** The exclusion copy states only the membership rule. This matters to me. If the app ever suggested "you can't see this team because of who reports to whom", it would start to look like management machinery. Test 2.1(d) guards the wording. Keep it.
- **No access or data changes.** There is no API, schema, or audit change, and live-session surfaces are untouched. Nothing here changes who can see what data. No concern there.

## Scope proportionality

The scope fits the value. Two page components, frontend only, about nine tasks, with an explicit scope guard against backend, routing and live-session changes. The rejected options were the right ones to reject: a global nav or shared layout (B) and changing the landing redirect (C) would each have been a bigger, riskier change for the same user outcome.

Items 2 (exclusion copy) and 3 (sign-out and "Go to your team" on the picker) go slightly beyond "add a link". I accept both:
- Without item 2, we can predict the bug report ("my team is missing"), and the obvious response to it weakens a hard ritual rule. That is cheap insurance on a policy I care about.
- Item 3 fixes a dead end that the new link itself creates. A user who can get into a screen must be able to get out of it.

I see no scope creep. The non-goals are disciplined, and each deferred item has a named follow-up rather than being dropped quietly.

## Notes on priorities (non-blocking)

1. **Follow-up #1 (resume an in-progress draft or lobby session) matters more for adoption than this proposal suggests.** The proposal says Priya "hits this before every session". If so, it is the next friction point in the same funnel, and this fix only moves the facilitator one screen further before they get stuck. I'd like it scheduled right after this change, not left in the backlog. The constraint already noted, showing only the caller's own sessions, is the right one.
2. **Follow-up #4 (no way to abandon a session from the UI) worries me more than its placement suggests.** The walkthrough needs a manual `psql` statement to clean up. That is fine for a local test. But it tells me a real facilitator who starts a session by mistake has no way to recover, and that is a trust problem for a volunteer. Please rank it next to #1 when triaging, not below the persona fixture.
3. **Follow-up #2 (the "Topics" link leading to a denial)** is small, but it is the same kind of problem as this bug: the app sending a facilitator somewhere they can't use. It would be worth bundling with #1 if it is cheap.

## What I need from the team

- Ship this to the pilot team without waiting for the follow-ups.
- File the four follow-ups when this merges (task 4.3), with #1 and #4 marked as adoption-blocking for the facilitator flow.
- Release notes that a facilitator can follow on their own, without someone explaining it to them. Priya's walkthrough of the strings (4.2) is the right check.
