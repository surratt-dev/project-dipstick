# Sync Review: Solution Architect (Ingrid Sollenberger)

**Change:** facilitator-session-entry-point (#237)
**Scope:** I compared the manual sync into `openspec/specs/session-creation/spec.md` against the delta spec, `design.md`, `tasks.md`, `pr-description-draft.md` and the uncommitted code in `packages/`.
**Verdict:** **The sync is faithful. One small, substantive drift between docs and tests needs a decision before archive (F1).** No doc edits were made.

## 1. Sync fidelity (main spec vs delta)

- `git diff openspec/specs/` touches only the requirement "Session-creation entry point is gated on facilitator eligibility".
- I extracted that requirement block from both files and diffed them. They are byte-identical, apart from the main file's existing trailing `---` separator before the next requirement, which is pre-existing and correct.
- The scenarios that are not new are unchanged, and none were dropped: non-facilitator, zero-membership facilitator, confirm screen context, race-condition inline error, and the 409 existing-session affordance.
- No other requirement in the main spec was altered.

## 2. Requirement and scenario accuracy against code

| Spec clause / scenario | Implementation | Status |
|---|---|---|
| Team-view link only when `canFacilitateSessions === true`, absent from the DOM otherwise | `TeamPage.tsx`: conditional `<section data-testid="team-facilitator-block">`. Tests (d) and (e) assert there is no `[href="/sessions/new"]` | OK |
| Link is independent of the viewed team and of the membership role ("any other team view they can reach") | The render condition reads only `session.canFacilitateSessions` and ignores `teamId` and role | OK |
| Target is exactly `/sessions/new`, with no id or state | `<Link to="/sessions/new">`, no `state`. The test asserts `data-has-state="false"` | OK |
| Label is not bare and has no team name | "Facilitate another team's session". Test (c) checks this as a property | OK (see F1) |
| Picker set comes only from `eligible-for-session`, with no pre-selection | No client filtering was added, and nothing pre-selects | OK |
| Exclusion copy only when `callerHasTeamMemberships && eligibleTeams.length > 0` | `picker-own-team-excluded`. The string matches design.md and the PR draft exactly | OK |
| Empty-state copy (both branches) makes no "every team" or "no other teams" claim | Both strings were rewritten. They match design.md and the PR draft exactly, and the tests assert them | OK |
| Way out on the picker in every list state, with sign-out always and the team link only with memberships | `picker-way-out` sits outside the list-state conditionals. `homeTeam = session?.teamMemberships[0]` is null-safe | OK (see O1) |
| Way out not on confirm or new-team, with the reauth treatment exempt | Those screens return early. Tests (g) cover this | OK |
| A 403 triggers exactly one `AuthSession` re-fetch. A network error or 5xx triggers none | `res.status === 403` fires `refreshSessionRef.current()`. Tests (i) cover 403, network, 500, 401 and an identity change | OK |
| If the refreshed session says false, the user is redirected to the post-sign-in landing | The existing gate `<Navigate to="/">` leads to `AuthenticatedLanding`, which picks the team view or `/no-team` | OK |
| EM with facilitator mapping resolves to EM, so `canFacilitateSessions = false` | `oidc-role-mapping` "Fixed precedence" (EM > facilitator) exists. `auth.test.ts` adds the R4 flag guard | OK |
| A team where the caller has an EM membership is excluded from the picker | `facilitator-sessions.test.ts` asserts the exclusion query has no role predicate | OK |
| The post-sign-in landing is unchanged | `auth.test.ts` R11 guard: a facilitator with a membership is redirected to `/team/team-fac` | OK |

The cited spec names and API paths resolve: `oidc-role-mapping`, `first-access`, `GET /auth/session` and `GET /api/v1/teams/eligible-for-session`.

## 3. Findings

### F1 (substantive, small): the team-view link and helper strings are not asserted by tests

The requirement text says: *"The shipped strings are recorded in the change's PR description and asserted by the frontend tests."* `pr-description-draft.md` (line 39) also says *"The tests assert these exact strings."*

- **The picker strings are asserted exactly** in `SessionCreationPage.test.tsx`: the exclusion copy, both empty-state strings and "Go to your team".
- **The team-view strings are not.** "Facilitate another team's session" and "You can't facilitate your own team." appear in no test. `TeamPage.test.tsx` (c) checks only properties: the label is non-empty, contains no team name, and is not a forbidden bare label.

So a copy edit on the team view would pass the tests without anyone being sent back to the R6/R9 rule. That is exactly the tripwire the PR description promises.

**Recommended fix (code, not spec):** add an exact-text assertion for `nav-facilitate-session` and for the helper line in `TeamPage.test.tsx`. Keep the property test (c), because it encodes the normative rule.

The alternative is to soften the spec and PR draft to "the picker strings are asserted". I recommend against it: the team-view label is the string most likely to drift toward "Start a session".

I did not fix this myself because it needs either a test change or a change to normative text.

### O1 (observation, no action): the auth-loading window

While `authLoading` is true, the page returns `<p>Loading…</p>` before the picker renders, so the way-out controls are briefly absent. I read the spec's phrase "SHALL NOT depend on … `AuthSession` having loaded (with no session, only the sign-out control is shown)" as covering the case where the session fetch finished without a session. Under that reading the code complies: the picker renders with `session === null` and shows only sign-out. "Loading" is not one of the enumerated list states. If anyone reads it more strictly, the parenthetical already settles it, so no edit is needed.

### O2 (observation): open tasks are correctly human or archive-stage

These tasks are unchecked: 4.3 (walkthrough), 4.5 (PR and Priya review), 4.7 (file follow-ups), 4.8 and 4.9 (archive stage). All are tagged HUMAN, ORCHESTRATOR or ARCHIVE. None of them blocks the sync.

## Resolution

F1 resolved by the orchestrator: added `TeamPage.test.tsx` case "(c2) the shipped label and helper strings are exact", which asserts both team-view strings verbatim. TeamPage suite: 17/17 pass.
