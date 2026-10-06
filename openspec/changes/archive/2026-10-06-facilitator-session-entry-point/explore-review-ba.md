# BA review: exploration notes, facilitator session entry point (#237)

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-10-06
**Reviewed:** `exploration-notes.md` (Devon Calloway), checked against `openspec/specs/session-creation/spec.md`, `openspec/specs/first-access/spec.md`, BRD FR-2.2, and `requirements/use cases/02 - Session Setup - Use Cases.md` (Create Session for Existing Team).
**Question asked:** Are the ideas specific enough to become requirements?

---

## Overall verdict

Most of it, yes. The diagnosis is the strongest part. Calling this a bug against an existing requirement ("reachable regardless of whether the user has any team memberships", `session-creation` spec line 303) rather than a new feature is correct. It gives us a clean trace: FR-2.2 → UC "Create Session for Existing Team" step 1 → spec requirement → missing scenario. Option A is well scoped and the reasons for rejecting C are sound.

Three things are not ready to go into a proposal as written:

1. The key safety condition, "does not imply eligibility for the current team", is a sentiment. It is not a testable condition yet.
2. The negative criterion is said to be "covered" by an existing scenario that is too abstract to test against `TeamPage`.
3. The "back to your team" pairing is offered as part of the leaning but has no definition for users with several memberships.

Details and suggested rewrites follow.

---

## 1. Clarifications needed before the proposal

| # | Question | Why it matters | Who answers |
|---|---|---|---|
| C1 | **Is "back to your team" on `/sessions/new` in scope for this change, or a follow-up?** The leaning in §3 includes it, but §5 (spec impact) does not mention it. | Scope dispute waiting to happen. If it is in scope, it needs its own scenario. If not, say so in the proposal's Non-goals. | Devon / Priya |
| C2 | **If "back to your team" is in scope, where does it go for a facilitator with 2+ memberships?** The first team (same as the server callback's ordering)? A link per team? The team they came from? | "Your team" assumes one home team. The notes themselves say the facilitator lands on "the first team", and that ordering is not defined anywhere in a spec. | Priya |
| C3 | **Should the entry point appear on every `/team/:teamId` page the user can view, or only on teams where the user has an active membership?** Today a facilitator only reaches `TeamPage` for their own teams, but an EM-associated or previously-removed path may exist. | Defines the render condition precisely: `canFacilitateSessions` alone, or `canFacilitateSessions` AND viewing a team they belong to. I recommend `canFacilitateSessions` alone, since the link never targets the current team. | Devon (confirm) |
| C4 | **A user with `global_role = 'facilitator'` who holds an `engineering_manager` *membership role* on their home team.** The notes cover the IdP-claim precedence case (#243), not the membership-role case. Does that user see the link? | "No manager participates" is about sessions for the team they manage. FR-2.2 already excludes that team from the picker, so I think the answer is "yes, show it". But it should be stated, not assumed, because this combination comes up again in #247. | Devon / VP Eng policy if contested |
| C5 | **Is the exact link wording normative?** | The spec's convention elsewhere (e.g. the draft-landing pending label) is: the *meaning* is normative, the exact string is listed in release notes for the walkthrough. Decide that up front so Priya's wording review doesn't block the spec. | Priya, with my recommendation below |
| C6 | **What does a user see if `canFacilitateSessions` is stale?** (The role was revoked at the IdP and the session is not yet refreshed. The link shows, but `GET /eligible-for-session` returns `403`.) | The spec already says the server gate is a live read, so this is safe. But the user experience of "I clicked the link and got a 403" is not specified. Confirm that the picker's existing 403 handling shows a message, not a blank page. If it does not, that is a gap for this change. | Devon (check current behaviour) |
| C7 | **Deactivated home team.** Can a facilitator land on `/team/:teamId` for a team whose `deactivated_at` is set, and if so, does the link still show? | An edge case I would rather close now than find in implementation. The expected answer is "show it": the link does not depend on the current team. | Devon (confirm) |

---

## 2. Vague areas

### V1. "Does not imply eligibility for the current team" (§5, second scenario)
Not testable as written. "Imply" is a reviewer's judgement, not an assertion. This is also the load-bearing ritual protection (FR-2.2 [HARD]), so it needs to be concrete. See rewrite R2.

### V2. "Reachable from the team view without typing a URL" (§5, first scenario)
Close, but "reachable" needs a defined number of steps and a starting point. The issue's own criterion is "from sign-in to `/sessions/new`". Tie the scenario to that, and to every team view, not just the first. See rewrite R1.

### V3. "The existing 'not shown to a non-facilitator' scenario covers the negative acceptance criterion" (§5)
I disagree. That scenario says "uses the application" and "no entry point is presented". It was written before there was any entry point on a membership-bearing surface, and nothing tests it against `TeamPage`. The gap the notes found (zero-membership scenario only, so the membership case went untested) applies equally to the negative case. Add explicit negative scenarios for an Engineer and an EM on the team view. See rewrite R3.

### V4. "Written so it does not depend on its placement, so B or D can absorb it later" (§3, leaning)
This is a design intent, not a requirement. That's fine, but keep it out of the spec. The spec scenario should say "the team view" (the surface that exists today). If B or D ships later, that change modifies the scenario. Don't write placement-neutral wording like "a navigation surface" into the spec. It makes the scenario untestable today.

### V5. "Must never list or pre-select teams itself" (§2, design rule)
Good rule, but it lives only in a table cell. It should become a scenario, because it is what keeps #247's reporting-chain filter effective without touching the entry point. See rewrite R2, last AND.

### V6. Live-session exclusion (§2)
Stated as a constraint on "where a global nav may render". Under option A it is satisfied automatically, because `TeamPage` is not a live-session surface. Either drop it from this change's spec delta (and record it in design.md as a constraint for a future option B), or turn it into a scenario. Don't leave it half in. I recommend design.md only.

### V7. Local reproduction (§6)
"Option 1 documented as the walkthrough" does not say where it is documented, or how the odd state it leaves (`facilitator-001` facilitating an open session for a team it now belongs to) is cleaned up. Acceptance should say: the walkthrough lives in the change's release notes or tasks, and it starts by abandoning or completing the session before the sign-in through the join link. The notes flag this as "worth confirming". Confirm it before the proposal, not during the walkthrough. Also open the separate dev-experience issue for option 2 now and link it, so it doesn't evaporate (#247 will need it).

### V8. Side observation on the "Topics" link (§4 Q5)
Correctly scoped out. Please file it as an issue rather than leaving it in exploration notes. It is the same class of misleading affordance, and it will be lost otherwise.

---

## 3. Suggested rewrites

### R1. Positive scenario (replaces §5 first bullet)

> #### Scenario: Facilitator with a team membership reaches the entry point from the team view
> - **GIVEN** an authenticated user with `canFacilitateSessions = true` and one or more active team memberships
> - **WHEN** they view `/team/:teamId` for any team they belong to
> - **THEN** the team view shows a link to `/sessions/new`
> - **AND** activating that link navigates to `/sessions/new` with no URL typed or edited
> - **AND** from sign-in, the user reaches `/sessions/new` with exactly one navigation action after the post-sign-in landing on `/team/{team}`

Test: `TeamPage.test.tsx`, with a mocked `AuthSession` (`canFacilitateSessions: true`, one membership; repeat with two memberships, rendering the second team).

### R2. "Other team" scenario (replaces §5 second bullet; covers V1 and V5)

> #### Scenario: The team-view entry point does not target the team being viewed
> - **GIVEN** a facilitator viewing `/team/:teamId` for a team they belong to
> - **THEN** the entry point's visible label refers to facilitating *another* team and does not contain the current team's name
> - **AND** the link target is exactly `/sessions/new`, with no team identifier in the path, query, or navigation state
> - **AND** the eligible-teams picker reached through it is populated only from `GET /api/v1/teams/eligible-for-session` and pre-selects no team

The exact label string is not normative and is listed in release notes. Meaning rule (normative): the label must read as "facilitate a session for a team other than this one". It must not be a bare "Start a session" / "Create a session".

### R3. Negative scenarios (added; covers V3)

> #### Scenario: Team-view entry point is not shown to an Engineer
> - **GIVEN** a user with `canFacilitateSessions = false` and a `participant` membership
> - **WHEN** they view `/team/:teamId`
> - **THEN** no link to `/sessions/new` is rendered (not hidden, disabled, or collapsed; absent from the DOM)
>
> #### Scenario: Team-view entry point is not shown to an Engineering Manager
> - **GIVEN** a user whose role resolves to `engineering_manager` (including one whose IdP claims also include `facilitator`, per #243 precedence)
> - **WHEN** they view `/team/:teamId`
> - **THEN** no link to `/sessions/new` is rendered

### R4. Return path (only if C1 = in scope)

> #### Scenario: Facilitator with memberships can return to a team from session creation
> - **GIVEN** a facilitator with one or more active memberships on `/sessions/new`
> - **THEN** the screen offers a link to `/team/{team}` for *[answer to C2: the first team per the callback's ordering | each team they belong to]*
> - **AND** a facilitator with zero memberships sees no such link

### R5. Landing unchanged (makes the non-goal explicit)

> #### Scenario: Post-sign-in landing is unchanged for a facilitator with memberships
> - **WHEN** a facilitator with one or more active memberships completes sign-in with no `returnTo` or pending join token
> - **THEN** they are redirected to `/team/{first team}`, as before this change

This locks out option C by test, not by memory, and keeps the `first-access` "no change" claim honest.

### R6. Use case trace (suggestion, not this change's file edits)
UC "Create Session for Existing Team", Main Flow step 1 ("The Facilitator navigates to the session creation screen") does not say *from where*. When the change is archived, add a note to step 1 that the entry point is on the team view for facilitators with memberships, and via the landing redirect for facilitators without. Then the requirement trace is complete in both directions.

---

## 4. Acceptance conditions for the proposal (consolidated)

1. R1, R2, R3 and R5 are present as scenarios under the MODIFIED "Session-creation entry point is gated on facilitator eligibility" requirement.
2. C1 is answered. R4 is either included or listed under Non-goals.
3. C4, C6 and C7 have recorded answers in design.md.
4. The label meaning rule is normative. The exact string goes through Priya's review and is listed in release notes.
5. The local walkthrough (option 1) is written down with a cleanup step, and the option 2 fixture issue is filed and linked.
6. The "Topics on home team" issue (Q5) is filed and linked as out of scope.
