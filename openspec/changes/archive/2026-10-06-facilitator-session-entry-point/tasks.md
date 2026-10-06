# Tasks

> **Test-first.** For each task that lists tests, write the tests first and confirm they fail for the stated reason, then implement and confirm they pass. Tasks 3.1, 3.2 and 3.4 are regression guards that are expected to pass at once; they are not test-first, and the PR description draft says so.
>
> **Scope guard.** No change to any backend route, the schema, audit, `App.tsx` routing, `AuthContext`, the shared `SignOutButton`, `NoTeamPage` or any live-session component. A diff that touches them is out of scope (see proposal Non-goals).
>
> **Execution order (A1).** Section 3 (backend tests) runs **first**, then 1, 2, 4. Section 3 has no frontend dependency, and 1.1(e) quotes the title of the test 3.2 creates.
>
> **Ownership.** Unmarked tasks are **implementer**-owned. Tasks marked **[ORCHESTRATOR/HUMAN]** or **[HUMAN]** or **[ARCHIVE STAGE]** are *not* performed by the implementer: the implementer does not file or comment on GitHub issues, request reviews, open or edit the PR, or run the live walkthrough. Where such a task needs text, the implementer drafts it into a file in this change directory (`pr-description-draft.md`, `follow-ups.md`, `walkthrough.md`) and the owner uses it.

## 1. Team view entry point (`TeamPage.tsx`)

- [x] 1.1 **Prerequisite: 3.2 done** (its `it(...)` title is quoted in (e)). Add the following tests to `packages/frontend/src/pages/__tests__/TeamPage.test.tsx`, using a mocked `AuthSession`.
  - **Fixture (E6).** The existing `mockSession` has no `canFacilitateSessions` and uses membership roles that do not exist (`"facilitator"`, `"member"`). Do not edit it (existing tests pass with the flag `undefined`, because D2 checks `=== true`). Add a sibling, correctly typed fixture with `canFacilitateSessions: true/false` and roles `participant` / `engineering_manager`, and team names that cannot collide with label words (`Alpha`/`Beta`, never `Team …`).
  - (a) Positive case. Set `canFacilitateSessions: true` with one membership. A link with test id `nav-facilitate-session` is rendered, its `href` is exactly `/sessions/new`, and clicking it navigates to `/sessions/new`, asserted with a sentinel `<Route path="/sessions/new" element={<Sentinel/>}/>` where the sentinel renders `data-testid="at-picker"` and also asserts that `useLocation().state == null` after the click (G1: the link carries no team context).
  - (b) Repeat (a) with two memberships, rendering the *second* team's `/team/:teamId`.
  - (c) The link's text contains none of the session's `teamName` values (compared case-insensitively) and is not exactly "Start a session", "Create a session" or "Facilitate".
  - (d) Engineer: `canFacilitateSessions: false` with a `participant` membership. `queryByTestId('nav-facilitate-session')` is null, and no element has `href="/sessions/new"`.
  - (e) EM: `canFacilitateSessions: false` with an `engineering_manager` membership. The same absence assertions as (d) apply. Add a comment tying this case to #243 precedence (a manager also sent `facilitator`) and naming, by their actual `it(...)` titles, the backend tests that cover the other half of R4: the new 3.2 `/auth/session` test (quote its exact title as written in 3.2) plus the three existing ones listed in 3.2.
  - (f) `canFacilitateSessions: true` with an `engineering_manager` membership role on the viewed team. The link is shown. (The "not offered by the picker" half of R5 is server-side; see 3.4.)
  - (g) `team-facilitator-block` follows the `h1` "Team" and precedes the "Members" heading in document order (`compareDocumentPosition`), and `block.contains(topicsLink) === false`. `nav-topic-management` renders only when `useParams().teamId` is set, so use the routed `<Routes><Route path="/team/:teamId" …/></Routes>` form, following the existing "renders a discoverable Topics nav link" test (which also mounts `MemberManagement` and its `fetch`).
- [x] 1.2 Implement design D1–D4 in `TeamPage.tsx`:
  - a `<section data-testid="team-facilitator-block">` with `<h2>Facilitator</h2>`, placed after `<h1>Team</h1>` and immediately before `<h2>Members</h2>` (design D1), rendered only when `session.canFacilitateSessions === true`;
  - one `<Link to="/sessions/new" data-testid="nav-facilitate-session">` with no `state`;
  - the helper line.
  - Add a comment citing this change and D3 ("do not add team context to this link").
  - Verify that 1.1 passes and the existing TeamPage tests are unchanged.

## 2. Session creation picker (`SessionCreationPage.tsx`)

- [x] 2.1 Add the following tests to `packages/frontend/src/pages/__tests__/SessionCreationPage.test.tsx`.
  - **Harness first (E5).** `useAuth` is mocked once at module scope with `teamMemberships: []`, and `vi.clearAllMocks()` in `beforeEach` does **not** reset `mockReturnValue`. Add a `setSession(overrides)` helper and restore the zero-membership default in `beforeEach`, so a membership override cannot leak into later tests.
  - Recipes: a pending request is `global.fetch = vi.fn(() => new Promise(() => {}))` (`mockFetchSequence` cannot express it); a network error is `mockRejectedValueOnce(new TypeError("Failed to fetch"))`; a 403 is `{ ok: false, status: 403, jsonBody: { error: { category: "forbidden", message: "..." } } }`, matching the backend.
  - Query sign-out as `within(getByTestId("picker-way-out")).getByRole("button", { name: /sign out/i })`. Do not add a test id to the shared `SignOutButton`. `<Link>` and `<Navigate>` do not call the module-mocked `useNavigate`, so assert `href` on `picker-go-to-team` and use sentinel routes for redirects, never `mockNavigate`.
  - (a) If the response has `callerHasTeamMemberships: true` and a non-empty `eligibleTeams`, the exclusion copy is rendered (test id `picker-own-team-excluded`).
  - (b) If `callerHasTeamMemberships: false` with a non-empty list, the copy is absent.
  - (c) Empty list, both `callerHasTeamMemberships` branches:
    - `picker-empty-state` renders the new copy from design D5, and "Create a new team" is still offered.
    - The text contains neither "every" nor "no other teams".
    - `picker-own-team-excluded` is absent.
    - **Replace** the existing assertion that matches `/already a member of every team/i`. It defends the defect BA B1 identified.
  - (d) The exclusion copy and both empty-state strings equal the exact shipped strings, and contain neither "every" nor "all other". Add a reviewer note in the test tying this to R6/R9 and 01c ("the chain must not be revealed"): if you change a string, re-check the rule.
  - (e) A facilitator with memberships sees `picker-go-to-team`, with `href` equal to `/team/${teamMemberships[0].teamId}`, and a sign-out control, both inside `picker-way-out`.
  - (f) A zero-membership facilitator sees sign-out and no `picker-go-to-team`.
  - (g) `queryByTestId("picker-way-out")` is null on the confirm screen and on the new-team screen.
  - (h) If the eligible-teams fetch returns 403 (and separately, if it rejects with a network error), then for a facilitator with memberships, `picker-error`, `picker-go-to-team` and sign-out are all present. Also assert they are present while the list is still loading (BA B2). (`refreshSession` is a no-op mock, so the R8 floor is what renders.)
  - (i) Re-sync on 403 (design D5a):
    - After a 403 from eligible-teams, the mocked `refreshSession` is called exactly once. After a network error, and after a 500, it is not called.
    - **Negative (A4):** a 403 from the confirm-screen `POST /draft` does **not** call `refreshSession`.
    - **Gate test (A2; none exists today):** with `setSession({ canFacilitateSessions: false })`, the page redirects to `/`. Render under a `MemoryRouter` with a sentinel `<Route path="/" element={<div data-testid="at-landing"/>}/>` and assert the sentinel, not `mockNavigate`. This is the second half of R8's alternative outcome; the joined flow is walkthrough step 8 (see 3.3).
  - (j) With `useAuth` returning `session: null` and `loading: false` (E3), the picker renders, `picker-way-out` contains sign-out, and `picker-go-to-team` is absent. Nothing throws.
  - (k) **No client pre-selection (G1, R2).** Render the picker under a `MemoryRouter` whose initial entry is `{ pathname: "/sessions/new", state: { teamId: "<an eligible team id>" } }`, with a non-empty eligible list containing that id. The list screen renders, no team is selected, and the confirm screen is not shown. Expected to pass at once against today's code (the page ignores `location.state`); it locks R2 against a future "improvement".
- [x] 2.2 Implement design D5 and D5a on the picker screen only:
  - the exclusion copy and the rewritten empty-state copy;
  - the `picker-way-out` footer rendered outside the list-state conditionals and after the `reauthRequired` early return (do not lift it above that return), reading `const homeTeam = session?.teamMemberships[0];` with no `!` and a comment pointing at `AuthenticatedLanding`;
  - **in `loadEligibleTeams` only (A4)**, inside the `!res.ok` branch, *after* the `detectSessionExpiry` / `isSessionExpired` early return and beside `setListError(...)`: on `res.status === 403`, call `void refreshSession()`. Do not read the body again. **Do not touch the `POST /draft` 403 branch** on the confirm screen (D5a). Take `refreshSession` from the existing `useAuth()` call. Do not modify `AuthContext`.
  - Verify that 2.1 passes and that the other existing SessionCreationPage tests are unchanged (only the one assertion replaced in 2.1(c) changes).

## 3. Backend regression guards and traceability (run this section first)

- [x] 3.1 Add to `packages/backend/src/routes/__tests__/auth.test.ts`: a returning user with `global_role = 'facilitator'` and one active membership completes `/auth/callback` with no `returnTo` and no pending join token, and the `Location` is `/team/{that teamId}`, not `/sessions/new` (design D7).
  - First extend `setupValidCallbackMocks` with `globalRole?: GlobalRole` and put it on the resolved account; pass `"facilitator"`. Without this the test duplicates "should complete sign-in flow and redirect to team page for user with memberships" and guards nothing (E8).
  - In the test comment, say that the landing code does not read `globalRole` today, so this guards against a future branch on it.
  - It is expected to pass at once. Note in `pr-description-draft.md` that it is a regression guard, not test-first.
- [x] 3.2 R4 backend half (design D7):
  - In `auth.test.ts`, next to 4.3/4.4, add `/auth/session` with `global_role = 'engineering_manager'` returning `canFacilitateSessions: false`. Record its exact `it(...)` title here when written (1.1(e) quotes it). **Recorded:** `"returns canFacilitateSessions: false for an engineering_manager caller (R4)"`.
  - Do **not** add a precedence test; it exists (E8, S-5). Cite these by name in 1.1(e)'s comment and in `pr-description-draft.md`: `role-map.test.ts` (`resolveGlobalRole` row `["Eng-Managers", "Retro-Facilitators"] → engineering_manager`), `account-resolver.test.ts` (`"[engineering_manager, facilitator] returning"`), and `role-claim-persistence-integration.test.ts` ("a user sent both the manager and facilitator groups is stored as engineering_manager (#238)").
  - The new assertion is a regression guard expected to pass at once.
- [x] 3.3 Traceability (BA V3, A3, A6, G3). In `pr-description-draft.md`, write a table mapping each of R1–R11 (and the pre-existing scenarios in the spec delta) to a named test, a cited existing test, or a walkthrough step, so reviewers don't look for tests that don't exist. Two rows are composites and must say so:
  - **R1** "exactly one navigation action after the post-sign-in landing": 3.1 (landing) + 1.1(a) (one click) + walkthrough steps 5–6.
  - **R8** alternative outcome (403 → re-sync → redirect): 2.1(i) refresh-once half + 2.1(i) gate-test half + walkthrough step 8 (the end-to-end check; required, not optional).
- [x] 3.4 R5 server half (G2). In `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts`, extend "the eligibility query excludes the caller's own team memberships via its WHERE clause" with one assertion that the eligibility SQL contains no membership-role predicate (no `tm.role` / `membership_role`), so an EM membership is excluded like any other. Cite the test by name for R5 in the 3.3 table. Regression guard, expected to pass at once.

## 4. Verification, walkthrough, release notes and follow-ups

- [x] 4.1 Automated verification (implementer). All must pass; record results in `pr-description-draft.md`.
  - `npm test` and `npm run lint` at the repo root.
  - Typecheck (A5): `npm run typecheck -w packages/frontend` and `npm run build -w packages/backend`. Note both configs **exclude** test files, so additionally run `npx tsc --noEmit -p packages/frontend/tsconfig.json` and `npx tsc --noEmit -p packages/backend/tsconfig.json` and confirm **no errors in the test files this change touches** (`TeamPage.test.tsx`, `SessionCreationPage.test.tsx`, `auth.test.ts`, `facilitator-sessions.test.ts`). Pre-existing errors elsewhere are noted, not fixed.
  - Spec validation (A6): **if the `openspec` CLI is available**, run `openspec validate facilitator-session-entry-point` and record the result. If it is not installed, record "openspec CLI unavailable; validation not run" and confirm by hand that the 3.3 table covers every scenario in `specs/session-creation/spec.md`.
- [x] 4.2 Write the walkthrough script to `walkthrough.md` in this change directory (implementer writes; **execution is [HUMAN]**, it needs a running stack and IdP). Include, in order:
  - **Preconditions (A7):** a **fresh `docker compose` volume** (no active teams other than those created below), `npm run dev`, the local IdP personas `facilitator-001`, `participant-001`, `manager-001`.
  1. Sign in as `facilitator-001` and land on `/sessions/new`. Sign-out is visible and there is no team link.
  2. Choose "Create a new team" and name it "Home". Copy the join link from the readiness view.
  3. **Local cleanup (design D6). Local development only, never against a shared or production database.** It bypasses the state machine and writes no audit row.
     ```
     docker compose exec postgres psql -U dipstick -d dipstick \
       -c "UPDATE sessions SET status = 'abandoned', abandoned_at = now() WHERE team_id = (SELECT id FROM teams WHERE name = 'Home') AND status NOT IN ('complete','abandoned');"
     ```
  4. Go back to `/sessions/new` and create a second team, "Other", so that the picker will have a populated list. Its `lobby` session can be left open, because `facilitator-001` is not a member of "Other".
  5. Sign out. Open the "Home" join link and sign in as `facilitator-001`. You land on `/team/{Home}`. **If the link is not redeemable after step 3, record the observed behaviour and stop; do not work around it (A7).**
  6. Confirm that the Facilitator block shows above Members. Follow it. In the picker, "Home" is absent, "Other" is listed, and the exclusion copy is shown. "Go to your team" returns to `/team/{Home}`.
  6a. (Optional, empty state.) Locally, in psql, set `deactivated_at = now()` on "Other" (and on any other non-Home team, if the volume was not fresh). Reload the picker and confirm that the empty-state copy no longer claims "every team", even though "Other" exists. Reset it afterwards.
  7. Redeem the "Home" join link as `participant-001`, and separately as `manager-001`. On `/team/{Home}`, no Facilitator block is rendered for either.
  8. **(Required; R8 end-to-end, D5a.)** As `facilitator-001` on `/team/{Home}`, locally run `UPDATE users SET global_role = 'engineer' WHERE …` for that user, then follow the Facilitator link without reloading. You are returned to `/team/{Home}` and the Facilitator block is gone. Reset the role afterwards. Local only.
  - A results table (step, expected, observed, pass/fail) for the human to fill in.
- [ ] 4.3 **[HUMAN]** Execute `walkthrough.md` against a running local stack and IdP, fill in its results table, and paste the outcome into the PR description. The implementer does not run it.
- [x] 4.4 Write release notes into `pr-description-draft.md` (implementer drafts; the orchestrator places them in the PR):
  - the shipping strings (G4): link, helper line, block heading ("Facilitator"), exclusion copy, **both** empty-state strings, "Go to your team";
  - a pointer to the walkthrough, with the cleanup step labelled "local development only, never against a shared or production database" (it must not be copied into `docs/deployment.md` or any runbook; design D6, S-8);
  - a short "what changed for facilitators" paragraph a facilitator can follow alone, without someone explaining it (executive sponsor's request);
  - the regression-guard notes from 3.1/3.2/3.4 and the 3.3 traceability table.
  Changing a string needs no spec change.
- [ ] 4.5 **[ORCHESTRATOR/HUMAN]** Open the PR (or update its description) from `pr-description-draft.md`, and request Priya's walkthrough of the strings and the flow (Facilitator review). The implementer does not open/edit the PR or request reviews.
- [x] 4.6 Draft the follow-ups into `follow-ups.md` in this change directory (implementer drafts only; nothing is filed). One section per item, each with a title, body, labels suggestion and the source design reference:
  - resume an in-progress session (**adoption-blocking**). Copy design Follow-ups 1 (S-9): server-side `facilitator_id = caller` scoping and a live role re-read;
  - abandon a session from the UI (**adoption-blocking**, ranked alongside the first). Copy design Follow-ups 4 (S-9): audit row in the same transaction, `session.state_changed` after commit, authorization on `facilitator_id` plus live role;
  - the "Topics" link on the home team (bundle with the first if cheap);
  - the `facilitator-002` persona;
  - **comment text for #247** (design Follow-ups 5, S-3/S-2): the chain check goes on `POST /draft` (enforcement, audited) as well as `/eligible-for-session`; non-revelation covers the refusal body and existence oracles;
  - **new issue** (design Follow-ups 6, S-6): audit `session.draft_denied_role` on `POST /draft`, consistent with `team.creation_denied_role`.
- [ ] 4.7 **[ORCHESTRATOR/HUMAN, after merge]** From `follow-ups.md`, file the five issues and post the #247 comment. The implementer does not file issues or comment on GitHub.
- [ ] 4.8 **[ARCHIVE STAGE, after 4.7]** Link the filed issue numbers in `proposal.md`.
- [x] 4.9 **[ARCHIVE STAGE]** Annotate UC "Create Session for Existing Team", step 1, in `requirements/use cases/02 - Session Setup - Use Cases.md`. Facilitators with memberships reach the session creation screen from the team view, and facilitators without memberships reach it through the landing redirect. The implementer leaves this unchecked.

## Task review disposition

Reviews: `tasks-review-architect.md` (Ingrid Sollenberger, A1–A8 and section 2) and `tasks-review-ba.md` (Marcus Delgado, G1–G4 and section 5). Dispositions by Marcus Oyelaran.

| Item | Disposition | Rationale / where |
|---|---|---|
| A1 1.1(e) forward-references 3.2 | **Accepted** | Kept numbering to preserve review/design cross-references; added an execution-order note (section 3 first) and "Prerequisite: 3.2 done" on 1.1; 3.2 records the exact `it(...)` title for 1.1(e) to quote. |
| A2 no existing gate test; `<Navigate>` bypasses `mockNavigate` | **Accepted** | 2.1(i) now adds the gate test with a sentinel `/` route; harness note extended to `<Navigate>`. |
| A3 R8 joined only by optional step 8 | **Accepted (both options)** | Step 8 is now required, and R8 is a declared composite in the 3.3 table. |
| A4 403 hook placement; second 403 branch | **Accepted** | 2.2 pins the call to `loadEligibleTeams` after the expiry return, no body re-read, `POST /draft` branch untouched; 2.1(i) adds the negative confirm-screen test. |
| A5 no typecheck | **Accepted, amended** | Added the suggested commands, but both `tsconfig.typecheck.json` (frontend) and `tsconfig.build.json` (backend) exclude tests, so they would not check the E6 fixture or the `setupValidCallbackMocks` change. 4.1 also runs `tsc` on the full configs and requires no errors in touched test files (pre-existing errors elsewhere are out of scope). |
| A6 no spec validation / R mapping | **Accepted, conditional** | `openspec` CLI is not installed here; 4.1 runs `openspec validate` only if available and otherwise records that and checks the mapping by hand. 3.3 extended to all of R1–R11. |
| A7 walkthrough premises | **Accepted** | Fresh-volume precondition; 6a deactivates any other non-Home team; step 5 says record-and-stop if the link is not redeemable. |
| A8 within-section order | **Noted** | No change needed. |
| Arch §2: 4.3 issue filing / #247 comment | **Accepted** | Split into 4.6 (implementer drafts `follow-ups.md`), 4.7 (orchestrator/human files after merge), 4.8 (archive links numbers). |
| Arch §2: 4.2 Priya review request | **Accepted** | Release notes drafting is 4.4 (implementer); the review request is 4.5 (orchestrator/human). |
| Arch §2: "state in the PR" | **Accepted** | All PR text goes to `pr-description-draft.md`; opening/editing the PR is 4.5. |
| Arch §2: UC annotation | **Accepted** | Now 4.9, marked archive stage. |
| (orchestrator constraint) live walkthrough | **Applied** | 4.2 implementer writes `walkthrough.md`; 4.3 execution is human-owned. |
| G1 R2 no-preselect / no-state untested | **Accepted (both assertions)** | New 2.1(k) (picker ignores incoming `state`) and 1.1(a) sentinel asserts `location.state == null`. |
| G2 R5 server half uncited | **Accepted** | New 3.4 cites the existing eligibility test and adds a no-role-predicate assertion. |
| G3 mark step 8 as R8 end-to-end | **Accepted** | Same change as A3. |
| G4 release notes omit strings | **Accepted** | 4.4 lists heading and both empty-state strings. |
| BA §5 step 7 `manager-001` path | **Accepted** | Step 7 now redeems the "Home" join link for both personas. |
| BA §5 word checks weak; 3.1/3.2 not test-first | **Noted** | Already handled by 2.1(d) and the regression-guard notes; no change. |
