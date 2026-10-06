# Exploration notes: facilitator session entry point (#237)

**Explored by:** Devon Calloway (Internal Champion), in explore mode. No code written.
**Date:** 2026-10-06
**Status:** Exploration, revised 2026-10-06 after the Facilitator (Priya Nair) and BA (Marcus Delgado) reviews. Scope recommendation in section 4; feedback disposition in section 9.

---

## 1. What is actually broken

A facilitator with a home team cannot reach `/sessions/new` from the app without typing the URL. That is normal for a facilitator: Priya is on the Platform team and facilitates three product teams.

```
 OIDC callback (backend, routes/auth.ts:529-541)
   pendingJoinToken? ── yes ──▶ join-flow redirect
   returnTo?         ── yes ──▶ returnTo
   any membership?   ── yes ──▶ /team/{first team}   ◀── facilitator with home team ends up here
                     ── no  ──▶ /no-team ──(NoTeamPage.tsx:35)──▶ /sessions/new

 "/" (frontend, App.tsx:26-44 AuthenticatedLanding)
   memberships > 0         ──▶ /team/{first}
   canFacilitateSessions   ──▶ /sessions/new
   else                    ──▶ /no-team

 /team/:teamId (TeamPage.tsx)
   links: "Topics" (shown to everyone), MemberManagement, Sign out
   NO link to /sessions/new                    ◀── dead end for the facilitator
```

Two facts the issue does not mention:

1. **The real landing decision is made on the server, not in `App.tsx`.** The OIDC callback redirects straight to `/team/{first}` when the user has any membership (`packages/backend/src/routes/auth.ts:529-541`). `AuthenticatedLanding` is reached only when someone opens `/`. So changing the landing would mean changing both the backend and the frontend. Adding an entry point is frontend-only.
2. **The current spec already requires this, and the implementation does not meet it.** `openspec/specs/session-creation/spec.md`, "Session-creation entry point is gated on facilitator eligibility", says the entry point must be reachable "regardless of whether the user has any team memberships of their own." The only scenario covers the zero-membership case, so the gap went untested. This is a bug against an existing requirement, not a new feature. The change should add the missing scenario.

## 2. Ritual constraints that bear on this

| Constraint | How it bears on this change | Status today |
|---|---|---|
| **Facilitator from another team** (FR-2.2 [HARD]) | The entry point must not suggest that the facilitator can run a session for the team page they are looking at, which is their **home** team, the one team they must not facilitate. | The real safeguards are on the server: `GET /eligible-for-session` leaves out the caller's own teams (`LEFT JOIN team_memberships ... WHERE tm.id IS NULL`), and `POST .../draft` refuses and audits `session.draft_denied_membership_conflict`. The link only helps people find the page; it is not an access control. |
| **No manager participates** | EMs must not see the link. Under #243 precedence an EM who is also sent `facilitator` resolves to `engineering_manager`, so `canFacilitateSessions = false` and the gate already hides it. | OK. No new path. |
| **Not in the reporting chain** (01c, #247 deferred) | Nothing new. The entry point only leads to the eligible-teams picker. When #247 ships, the reporting-chain filter applies to that endpoint and the entry point needs no change. **Design rule: the entry point must never list or pre-select teams itself. It always defers to `/eligible-for-session`.** | Interim operator rule in `docs/deployment.md`. |
| **Simultaneous reveal / app fades into the background** | The entry point must not appear inside live-session surfaces (`/session/:id`, `/session/:id/live`, `/session/:id/facilitator`, `DraftSessionHost`). When the facilitator is a *participant* in their home team's session, nothing should mark them as the facilitator there. | Constraint on where a global nav may render. |
| **`/no-team` has no navigation** (first-access spec, locked by `App.test.tsx`) | A global nav or layout must not wrap `/no-team`. That route already redirects facilitators away, so this matters only for a layout-based option. | Structural, must hold. |

**My concern, as Devon:** the easiest drift is a "Start a session" button on the team page that reads as "start a session *for this team*." A facilitator clicks it on their home team, then sees a picker that leaves that team out. At best that is confusing. At worst someone files a bug ("my team is missing from the picker") and the "fix" is to make the exclusion optional. The wording and placement have to say *other teams*. The membership exclusion must stay structural.

**Added after review: what the reviews surfaced about today's pages**
- `TeamPage` never names the team being viewed. Its heading is a bare "Team", and "Members" lists *all of the caller's* memberships (Priya, O2). Any label that relies on "this team" needs to make sense without that context.
- The populated picker never says why the facilitator's own team is missing. Only the empty state explains it (Priya, O3). The label alone won't head off a "my team is missing" report.
- `/sessions/new` has no way out: no link back to a team and no sign-out (Priya, O5). It is also the *landing page* for zero-membership facilitators.
- Neither the server callback's membership query (`LIMIT 1`, no `ORDER BY`) nor the `/auth/session` membership list is ordered. "First team" is not deterministic and is not defined in any spec. Nothing in this change should specify it.
- Stale `canFacilitateSessions` (C6): if the role is revoked at the IdP, the link may still show until the next session refresh. Clicking it reaches the picker. `GET /eligible-for-session` returns 403, and the picker's non-OK branch shows "Failed to load teams you can create a session for." That is a message, not a blank page. It is safe because the server re-reads the role live. The message is generic, but acceptable for a rare transitional state. No change needed.
- Deactivated home team (C7): the link does not depend on the team being viewed, so it renders. The picker already filters `t.deactivated_at IS NULL`. No change needed.

---

## 3. Candidate options (unchanged from the first pass; both reviewers agreed with A)

| Option | Summary | Verdict |
|---|---|---|
| **A** | Entry point on `TeamPage`, rendered only when `canFacilitateSessions` is true | **Chosen.** Bug-fix sized, frontend only, follows the "Topics" link precedent |
| B | Shared facilitator header or nav on non-session routes | Deferred. The app's first shared layout is a UX-architecture decision, not a bug fix |
| C | Facilitators always land on `/sessions/new` (server callback + `AuthenticatedLanding`) | **Rejected**, and locked out by scenario R5 below. Hides the home team, where the facilitator is a participant |
| D | Dedicated facilitator home, including a way back to an in-progress draft or lobby session | Follow-up issue (see section 7). Priya rates it high priority. I agree it should be filed now |

---

## 4. Scope decision for #237

The scope is option A plus the two pieces that make the round trip work. Priya is right that the friction is a round trip (getting in, understanding the picker, getting out), not just one missing link. All three pieces are frontend-only, need no API change, and touch two components (`TeamPage.tsx`, `SessionCreationPage.tsx`).

**In scope**
1. **Entry point on `TeamPage`.** Rendered only when `canFacilitateSessions === true`. The render condition is that flag *alone*, not tied to the team being viewed (BA C3).
   - Placement: a small, separate "Facilitator" block at the top of the page, above "Members". It must not sit next to "Topics" or member management, so it doesn't read as a team-scoped action (Priya, Q2 and O7).
   - Label meaning (normative): facilitating a session for a team *other than this one*. It must not be "Start a session", "Create a session" or a bare "Facilitate". It must not contain the current team's name.
   - Label string (not normative, release notes): **"Facilitate another team's session"**, with the helper line *"You can't facilitate your own team."*
   - Target: exactly `/sessions/new`, with no team id in the path, query or navigation state.
2. **Picker copy explaining the exclusion (populated state).** When `callerHasTeamMemberships` is true and eligible teams are listed, the picker says that the caller's own team(s) are not listed, and why. This is the main defense against the drift I am worried about, so it is in scope, not polish.
   - **Guardrail on that copy:** it may state *only* the membership rule. It must not say or imply that the list contains "every team except yours". Once #247 ships, teams in the caller's reporting chain will also be left out silently, and 01c requires the response not to reveal the chain. Suggested string (not normative): *"Your own team isn't listed. Facilitators run sessions for teams they're not on."*
3. **Way out of `/sessions/new`, picker screen only.**
   - A "Go to your team" link to `/team/{session.teamMemberships[0].teamId}`, rendered only when `teamMemberships.length > 0`. It uses the same client-side index `AuthenticatedLanding` uses. No team switcher, no list, and no claim about server ordering (BA C1/C2).
   - A sign-out control, because this page is a landing page for zero-membership facilitators (Priya, Q3).
   - Not shown on the confirm screen, which already has "Back".
   - The zero-membership facilitator sees no team link, so nothing on the page assumes a membership.

**Explicit non-goals (for the proposal)**
- No landing or redirect change, on the server or in `AuthenticatedLanding` (option C). R5 enforces this.
- No shared layout or global nav (option B).
- No resume-in-progress-session affordance, and no marking of in-progress teams in the picker (option D or interim; see section 7).
- No change to the "Topics" link.
- No change to `/eligible-for-session`, the draft endpoint or any server check. The exclusion stays structural and server-side. The UI only *explains* it.

---

## 5. Answers to the reviewers' clarification questions

| # | Answer |
|---|---|
| C1 | The return path is **in scope** (section 4, item 3). |
| C2 | It links to `teamMemberships[0]`, matching `AuthenticatedLanding`. One link, no switcher. We don't specify an order. |
| C3 | Rendered on `canFacilitateSessions` alone. The link never targets the current team, so it doesn't depend on which team is shown. |
| C4 | A `global_role = 'facilitator'` user with an `engineering_manager` **membership role** on a team **does see the link**. The ritual's protection is that they never facilitate the team they manage, and FR-2.2 already removes every team they are a member of (any membership role) from the picker and refuses the draft. The link changes nothing about that. How this combination interacts with reporting chains is left to #247. |
| C5 | The *meaning* of the label is normative and the exact string is not. That follows the spec's existing convention, and Priya's proposed strings go in the release notes. |
| C6 | Already handled: the picker shows an error message on 403 (section 2 addendum). No change. |
| C7 | The link shows. The picker already excludes deactivated teams. No change. |

---

## 6. Spec delta (for the proposal)

Under `session-creation`, MODIFY "Session-creation entry point is gated on facilitator eligibility". Keep the existing scenarios and add the following. Wording follows the BA's rewrites, with my edits marked.

- **R1 (positive).** A facilitator with one or more memberships, viewing `/team/:teamId` for *any* team they belong to, sees a link to `/sessions/new`. Activating it navigates there with no URL typed. From sign-in, that takes exactly one navigation action after the post-sign-in landing. Test with one membership, then with two memberships rendering the second team.
- **R2 (does not target the current team).** The label means "another team" and contains no current-team name. The target is exactly `/sessions/new` with no team id in path, query or state. The picker is populated only from `GET /api/v1/teams/eligible-for-session` and pre-selects no team. *(The last clause is the hook that keeps #247 effective without touching the entry point.)*
- **R3 (negative, explicit).** The link is absent from the DOM (not hidden, disabled or collapsed) for (a) an Engineer with a `participant` membership and (b) a user resolving to `engineering_manager`, *including one whose IdP claims also include `facilitator`* (#243 precedence; Priya S4). The existing abstract "not shown to a non-facilitator" scenario does **not** cover the team view. The BA is right.
- **R4 (return path).** On the `/sessions/new` picker, a facilitator with memberships sees a link to one of their teams and a sign-out control. A zero-membership facilitator sees sign-out but no team link.
- **R5 (landing unchanged).** A facilitator with memberships who signs in with no `returnTo` or pending join token is redirected to `/team/{a team they belong to}`, as before. *Edit: the BA's wording "first team" is replaced, because no spec defines that ordering and the server query has none.*
- **R6 (picker exclusion copy).** With `callerHasTeamMemberships = true` and a non-empty eligible list, the picker states that the caller's own teams are not listed because facilitators run sessions for teams they're not on. The copy states only the membership rule.

`first-access`: no change. R5 lives under `session-creation`, so the `first-access` "no change" stays true.

Constraint for `design.md`, **not** a spec scenario: the entry point never renders on live-session surfaces (`/session/:id`, `/live`, `/facilitator`, `DraftSessionHost`) and never wraps `/no-team`. Under option A this holds by construction. It becomes a constraint any future option B must meet.

Use-case trace (when the change is archived): annotate UC "Create Session for Existing Team", step 1, with where the facilitator navigates from (BA R6).

---

## 7. Follow-up issues to file as part of this change (out of scope for #237)

1. **Resume an in-progress draft or lobby session.** This is option D, or as an interim, the picker marks teams with an active session and links to it instead of making the facilitator go through the 409. **High priority**: Priya hits this before every session, with people arriving. Constraint for that issue: whatever is shown is limited to *the caller's own* sessions (`facilitator_id = caller`). The picker must not show another facilitator's session or its status for a team.
2. **"Topics" link shown to a facilitator on their home team leads to `FACILITATOR_IS_TEAM_MEMBER`.** Same class of misleading affordance. Hide it, or explain the refusal.
3. **`facilitator-002` persona with a seeded home-team membership.** This is more than dev convenience: it is the fixture for Priya's usability testing of facilitator-facing UI, and #247 will need it.

---

## 8. Reproducing locally (walkthrough for this change)

The walkthrough goes in the change's `tasks.md`, as the verification task, and the release notes for Priya's pre-merge walkthrough. It uses the existing personas with no seeding change.

1. Sign in as `facilitator-001`. You land on `/sessions/new`, the zero-membership carve-out. Confirm that sign-out is visible and there is no team link (R4, zero-membership branch).
2. Choose "Create a new team" and name it "Home". This creates the team with a session in `lobby` and adds no membership for the facilitator. Copy the join link from the readiness view.
3. **Clean up before joining:** get the "Home" session out of its non-terminal state, by abandoning it or running it to completion, so that `facilitator-001` is not left facilitating an open session for a team they are about to join. *Before the proposal is written, check whether an abandon or cancel path exists for a `lobby` session. If none does, the walkthrough must run the session to completion, or the cleanup step needs the follow-up 3 fixture instead.* Do not skip this step: real users never start from that state. **Resolved at the propose stage:** no abandon route exists, and `complete` accepts only `wrap_up`. The walkthrough uses a local-only SQL update to `abandoned` (design.md D6), and the missing UI path is follow-up 4.
4. Sign out, open the join link and sign in as `facilitator-001`. You land on `/team/{Home}`.
5. Check that the Facilitator block shows above Members, follow the link and confirm "Home" is not in the picker and the exclusion copy is shown. Check that "Go to your team" returns to `/team/{Home}`.
6. Sign in as `participant-001` (redeem the same join link) and as `manager-001`, and check that no Facilitator block renders.

Component tests (`TeamPage.test.tsx`, `SessionCreationPage` tests) with a mocked `AuthSession` cover R1–R4 and R6. A backend callback test covers R5.

---

## 9. Feedback disposition

**Accepted**
| From | Item | Why |
|---|---|---|
| Priya O3, S1 | Picker copy explaining the exclusion, in scope | This is the real defense against the "my team is missing → make the exclusion optional" drift. It explains a load-bearing rule instead of hiding it. |
| Priya O4 | State the exclusion as a ritual rule, not an error | Teaches the rule to new facilitators, which carries the knowledge I used to carry by hand. |
| Priya Q1 | Label "Facilitate another team's session", with the helper line | Names the role and the other-team rule. Recorded as non-normative. |
| Priya Q2, O7 | Separate "Facilitator" block above Members, not next to Topics | Keeps a cross-team action from looking team-scoped, and keeps it apart from the Topics link that leads to a denial. |
| Priya Q3, O5 | Return link and sign-out on the picker only | It fixes the dead end in the other direction, at the same size as the rest. |
| Priya S4 / BA R3 | Explicit negative scenarios, including the EM who is also sent `facilitator` | This is the "no manager participates" line, and it has regressed before. |
| Priya S5 / BA V7, V8 | File the three follow-ups now | Otherwise they are lost in exploration notes. |
| Priya S6 / BA V7 | Walkthrough with a cleanup step, written down | Done (section 8), with an open check on the abandon path. |
| BA V1/R2, V5 | A testable "does not target the current team" scenario, and a scenario for "never pre-selects" | It turns my table-cell rule into something that will survive refactors and #247. |
| BA V3 | The existing negative scenario does not cover the team view | Correct. It is the same gap that let the original bug through. |
| BA V4 | Spec names "the team view", not placement-neutral wording | A testable scenario today matters more than wording that tries to anticipate option B. |
| BA V6 | Live-surface exclusion goes in design.md, not the spec | It holds by construction under A. |
| BA C1–C7, C5 | Answered (section 5); label meaning normative, string not | Keeps Priya's wording review from blocking the spec. |
| BA R5 | Landing-unchanged scenario | Locks out option C with a test. |

**Accepted with changes**
| From | Item | Change and why |
|---|---|---|
| BA R5, C2 | "first team" | Replaced with "a team they belong to". Neither the server query nor `/auth/session` orders memberships, so specifying "first" would put an undefined ordering into the spec. |
| Priya O4 / S1 | Exclusion copy | Limited to the membership rule. Copy implying "all teams except yours" would become false, and would hint at the chain, once #247 silently excludes reporting-chain teams. 01c says the chain must not be revealed. |
| Priya Q4 | Picker marks in-progress sessions (interim for D) | Moved to a follow-up, not this change, and limited to the caller's own sessions. Surfacing another facilitator's session status per team is a separate access question. |

**Rejected**
| From | Item | Why |
|---|---|---|
| Priya S3 | Negative placement scenario for live-session routes in the spec | Under option A it can't fail, and a scenario for something that can't happen is noise. It is recorded in design.md as a constraint for option B (agreeing with BA V6). The `/no-team` bare-page rule already has its own regression test. |
| Priya Q3 (alternative) | Listing every membership on the picker as return links | One link to the landing team is enough. A list is the start of a team switcher, which is option B scope. |

Nothing either reviewer proposed weakens the no-manager rule, the other-team rule or the reveal. The changes above are about where things go and how they are worded, not about the constraints.
