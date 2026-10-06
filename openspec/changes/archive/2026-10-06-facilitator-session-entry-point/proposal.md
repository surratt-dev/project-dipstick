# Proposal: Facilitator session entry point (#237)

**Proposer:** Devon Calloway, Internal Champion
**Source:** GitHub issue #237. Exploration and reviews are in this change directory: `exploration-notes.md` (revised), `explore-review-facilitator.md` (Priya Nair), `explore-review-ba.md` (Marcus Delgado), `propose-review-ba.md` and `propose-review-exec.md` (Rachel Okonkwo). See "Review disposition" at the end.
**Size:** Bug fix. Frontend only. Two page components. No API, schema or server-check change.

## Why

The ritual depends on a facilitator from *another* team (BRD FR-2.1, FR-2.2 [HARD]; `Summary.md`: "a senior engineer from another team"). Facilitators normally have a home team of their own. Priya, for example, is on Platform and facilitates three product teams. After #235, such a person keeps `global_role = 'facilitator'`, but the app gives them no way to reach session creation:

- The OIDC callback (`packages/backend/src/routes/auth.ts`) sends anyone with a membership straight to `/team/{a team}`.
- `TeamPage` has no link to `/sessions/new`.
- `/sessions/new` is reached only by redirect, and only when the user has zero memberships.

So the typical facilitator must type a URL to do the one thing their role exists for. That is a direct obstacle to my first success criterion: a team I have never spoken to adopting the ritual without anyone explaining it. It is also a bug against an existing requirement. `session-creation` already says the entry point is reachable "regardless of whether the user has any team memberships of their own". Only the zero-membership case had a scenario, so the gap was never tested.

The fix touches the rule I care most about here, facilitator-from-another-team. The app shows the link on the facilitator's **home** team page, and the picker it leads to deliberately leaves that team out. If the link reads as "start a session for this team", or the picker leaves the missing team unexplained, someone will report it as a bug ("my team is missing"), and the obvious "fix" is to make the exclusion optional. This change therefore states the exclusion in the UI as a ritual rule, and leaves enforcement unchanged and on the server.

## What Changes

1. **Facilitator entry point on the team view.** `TeamPage` renders a small, separate "Facilitator" block above "Members", only when `AuthSession.canFacilitateSessions === true`.
   - It holds one link to exactly `/sessions/new`, with no team id in path, query or navigation state. The label means "facilitate a session for a team other than this one" (the meaning is normative, the string is not; proposed: "Facilitate another team's session", with the helper line "You can't facilitate your own team.").
   - The block sits above "Members" and outside the container that holds "Topics" and member management (the testable form is task 1.1(g)).
   - It is absent from the DOM for everyone else.
2. **The picker explains the exclusion and never overclaims.**
   - When `callerHasTeamMemberships` is true and eligible teams are listed, the `/sessions/new` picker states that the caller's own team isn't listed because facilitators run sessions for teams they are not on.
   - The copy states **only** the membership rule. It never says or implies "every team except yours".
   - The **empty-state** copy comes under the same rule. Today's "You're already a member of every team in the organization" and "there are no other teams" are replaced, because both are already false when a team is deactivated and would point at the hidden exclusion once #247 lands.
3. **A way out of `/sessions/new`.**
   - The picker screen shows a sign-out control for every facilitator.
   - It shows a "Go to your team" link to `/team/{teamMemberships[0].teamId}` only when the user has at least one membership.
   - Both render in every list state, including loading and load error, so a facilitator whose role was just revoked (403) is not stranded.
  - On that 403 the picker also re-fetches the session once, so a revoked facilitator is sent to their landing instead of looping between the team view and the picker (design D5a).
   - Neither is added to the confirm or new-team screens.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `session-creation`: MODIFIED "Session-creation entry point is gated on facilitator eligibility". The requirement text now names the team view as the entry point for facilitators with memberships, and adds rules for the label meaning, the exclusion and empty-state copy, and the way out of the picker. The five existing scenarios are unchanged. Eleven scenarios are added, one-to-one with the delta:
  - **R1** Facilitator with a team membership reaches the entry point from the team view
  - **R2** The team-view entry point does not target the team being viewed (and the picker pre-selects nothing)
  - **R3** Team-view entry point is not shown to an Engineer
  - **R4** Team-view entry point is not shown to an Engineering Manager (including one also sent `facilitator`, with `canFacilitateSessions = false`)
  - **R5** Facilitator whose membership on the viewed team is as an Engineering Manager still sees the entry point
  - **R6** Picker explains why the caller's own team is not listed
  - **R7** Facilitator with memberships can return to a team from the picker
  - **R8** Way out is available when the eligible-teams list fails to load
  - **R9** Empty-state copy does not claim the caller is on every team
  - **R10** Zero-membership facilitator sees sign-out but no team link on the picker
  - **R11** Post-sign-in landing is unchanged for a facilitator with memberships

`first-access` is unchanged. Landing routing stays as it is, and R11 locks that in.

## Constraints that must be preserved

- **Facilitator-from-another-team stays structural and server-side.** `GET /api/v1/teams/eligible-for-session` (which excludes the caller's teams with any membership role, and deactivated teams) and the `POST .../draft` refusal plus audit are the controls. This change only *explains* them. The entry point never lists, filters or pre-selects teams itself, so #247 adds the chain check to `POST /draft` (enforcement, audited) and to `/eligible-for-session` (presentation), with no UI change. A filter on the listing alone would not be enforcement (security review S-3).
- **The chain is never revealed.** Once this change ships, no picker copy (the populated state or either empty state) claims the list holds every team the caller is not on. The copy names only the membership rule, so it stays true and does not itself point at the chain once #247 silently excludes reporting-chain teams. Copy is necessary but not sufficient: full non-revelation (list absence, refusal bodies, existence oracles) is #247's design problem (security review S-2; design Risks). Before this change the empty state did make that claim (BA B1), which is why it is in scope.
- **No manager participates.** The link is gated on the server-computed `canFacilitateSessions` alone. An EM who is also sent `facilitator` resolves to `engineering_manager` (#243 precedence) and sees nothing. R4 tests this end to end: the backend resolves the role and computes the flag, and the frontend then hides the link. This case has regressed before.
- **The tool stays in the background during sessions.** Nothing renders on live-session surfaces (`/session/:id`, `/session/:id/live`, `/session/:id/facilitator`, `DraftSessionHost`). `/no-team` stays bare. No shared layout or global nav is introduced.
- **Landing is unchanged for everyone.** Neither the server callback nor `AuthenticatedLanding` changes.

## Non-goals

- Changing the landing or redirect (option C in the exploration).
- A shared layout or global facilitator nav (option B).
- Resuming an in-progress draft or lobby session, or marking such teams in the picker (option D). This becomes a follow-up issue.
- The "Topics" link that a facilitator sees on their home team, which leads to a `FACILITATOR_IS_TEAM_MEMBER` denial. Follow-up issue.
- A seeded `facilitator-002` persona with a home team. Follow-up issue.
- Any change to the API, schema, audit or server check.

## Impact

- `packages/frontend/src/pages/TeamPage.tsx`: the Facilitator block.
- `packages/frontend/src/pages/SessionCreationPage.tsx`: exclusion copy, rewritten empty-state copy, and the return link and sign-out on the picker screen in every list state.
- Tests: `TeamPage.test.tsx`; `SessionCreationPage.test.tsx`, where the existing empty-state assertion on "already a member of every team" is replaced; `packages/backend/src/routes/__tests__/auth.test.ts` (R11 landing guard and R4's `canFacilitateSessions = false` for `engineering_manager`); and R4's precedence half, which existing tests in `packages/backend/src/auth/__tests__/` already assert (cited, not added; design D7).
- `openspec/specs/session-creation/spec.md` through the delta in this change.
- Release notes: the proposed strings and a walkthrough for Priya.
- UC "Create Session for Existing Team", step 1: annotate where the facilitator navigates from, at archive time.

## Follow-ups (file when this merges; out of scope)

The executive sponsor asked that #1 and #4 be marked **adoption-blocking for the facilitator flow** and scheduled right after this change.

1. **Resume an in-progress draft or lobby session.** *Adoption-blocking.* Without it, this fix only moves the facilitator one screen further before they get stuck. Any affordance must show only the caller's own sessions (`facilitator_id = caller`).
4. **Abandon a session from the facilitator UI.** *Adoption-blocking.* No abandon path exists today (design.md D6). A facilitator who starts a session by mistake cannot recover, and the team stays blocked by the active-session index.
2. **"Topics" link on a facilitator's home team** leads to a denial. Bundle it with #1 if that is cheap.
3. **`facilitator-002` persona with a seeded home-team membership.** This is the fixture for facilitator usability testing, and #247 will need it.
5. **Comment on #247: enforce the chain at `POST /draft`, not only in the listing** (security review S-3, S-2). The chain check goes on `POST /teams/:id/sessions/draft` (enforcement, audited) and on `/eligible-for-session` (presentation). Non-revelation must also cover the refusal body and existence oracles.
6. **Audit role-based denials on the facilitator path** (security review S-6). `POST /draft`'s role 403 writes no `audit_log` row; add `session.draft_denied_role`, consistent with `team.creation_denied_role`. Pre-existing, deferred because this change makes no server change.

Server-side requirements for #1 and #4 (security review S-9) are in design.md "Follow-ups" and are copied into those issues when filed.

## Review disposition

### `propose-review-ba.md` (Marcus Delgado): approve with changes

| # | Point | Disposition | Rationale and where |
|---|---|---|---|
| B1 | The empty-state copy ("member of every team") breaks the no-overclaim rule, and task 2.1(c) would lock it in | **Accepted, option (a)** | This is a defect in the same rule this change introduces, and fixing it is a two-string copy change. Deferring it to #247 (option b) would let the change ship with a false claim in its own Constraints section. The rule is extended to *both* empty-state branches, because "there are no other teams" makes the same claim. Spec: requirement text + R9. Design: D5. Tasks: 2.1(c), 2.1(d). |
| B2 | The way out must render in every picker list state, especially load error/403 | **Accepted** | A stranded facilitator after a role revocation is exactly the dead end we are fixing. Spec: requirement text + R8. Tasks: 2.1(h). |
| B3 | The new-team screen is missing from the spec | **Accepted** | The design already intended it, and the spec now matches. R7, requirement text, task 2.1(g). |
| V1 | The EM scenario does not tie to `canFacilitateSessions = false`, and the backend half is untested | **Accepted** | Spec R4 GIVEN gets the AND. Tasks 3.2 adds an `/auth/session` assertion for `engineering_manager`, plus a precedence assertion if none exists. |
| V2 | "Next to" is not testable | **Accepted** | The proposal now points to task 1.1(g). |
| V3 | R1's "one navigation action" has no single test | **Accepted** | Tasks note that it is verified by 1.1(a) + 3.1 together plus walkthrough 4.1. |
| V4 | Word checks are a weak proxy for "imply" | **Accepted** | Tests also assert the exact shipped strings, so any edit forces a reviewer back to the rule (2.1(d)). |
| V5 | "Go to your team" may lead to a deactivated team | **Accepted as a recorded risk, no behaviour change** | Confirmed that `/auth/session` memberships filter only `removed_at`, not `deactivated_at`. The sign-in callback has the same behaviour today. The return link goes wherever landing would, so it adds no new failure. Design Risks. |
| V6 | The R-list does not match the scenarios | **Accepted** | Renumbered R1–R11, one-to-one with the delta. |
| V7 | The "every team they belong to" floor could be read as the render condition | **Accepted** | Requirement text adds "and on any other team view they can reach". |
| FR-1.5 note | The Facilitator block partly meets FR-1.5 by accident | **Noted** | Not claimed as delivered. |

### `propose-review-exec.md` (Rachel Okonkwo): approve

| Point | Disposition | Rationale |
|---|---|---|
| Ship to the pilot without waiting for follow-ups | **Accepted** | Nothing here depends on them. |
| Follow-up #1 is the next point of friction, so schedule it right after | **Accepted** | Marked adoption-blocking above. Priya said the same. |
| Rank follow-up #4 (no abandon) next to #1 | **Accepted** | I agree. A volunteer with no way to undo a mistake loses trust, and the team stays blocked by the active-session index. It is re-ordered above the persona fixture. |
| Bundle #2 with #1 if cheap | **Accepted as a suggestion** | Recorded. The decision belongs to whoever schedules #1. |
| Release notes a facilitator can follow alone | **Accepted** | Task 4.2 now says that explicitly. |

Nothing either reviewer asked for weakens a ritual constraint. B1 actually tightens one. The scope is still two frontend components plus tests.
