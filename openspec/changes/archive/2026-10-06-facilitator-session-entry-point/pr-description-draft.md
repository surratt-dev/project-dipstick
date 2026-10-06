# PR description draft: Facilitator session entry point (#237)

> Drafted by Marcus Oyelaran (implementer). The orchestrator opens or updates the PR from this file and requests Priya's walkthrough review (task 4.5). The walkthrough results (task 4.3, human-run) are pasted in below where marked.

Fixes #237.

## Summary

A facilitator who has a home team had no way to reach session creation without typing `/sessions/new`. This change is frontend only. No API, schema, audit or server check changes.

- **`TeamPage`:** adds a separate **Facilitator** block, after the "Team" heading and above "Members". It is rendered only when `AuthSession.canFacilitateSessions === true` and holds one link to exactly `/sessions/new`, with no team context (design D1–D4).
- **`SessionCreationPage` (picker screen only):**
  - The picker explains why the caller's own team isn't listed.
  - Both empty-state strings are rewritten so they no longer claim the caller is on "every team" or that there are "no other teams".
  - A footer with "Go to your team" and **Sign out** renders in every list state (design D5).
  - When the eligible-teams request returns 403, the picker re-fetches the session once, so a facilitator whose role was revoked is redirected instead of looping (design D5a).
- **Backend:** regression-guard tests only (R11 landing, the R4 flag half, and the R5 server half).

## What changed for facilitators

If you're a facilitator and you belong to a team, sign in as usual. You land on your team's page, as before. Near the top of that page there's now a **Facilitator** section with a link, **Facilitate another team's session**. Click it to open the session creation screen, where you pick the team you'll facilitate.

Your own team isn't in that list, and the screen says so. Facilitators run sessions for teams they're not on, so this is expected and not a bug. If no team is listed, you can create a new one from the same screen. To leave without creating anything, use **Go to your team** or **Sign out** at the bottom of the screen.

Engineers and engineering managers don't see the Facilitator section.

## Shipping strings (for Priya's walkthrough; non-normative, can change without a spec change)

| Where | String |
|---|---|
| Team view, block heading | Facilitator |
| Team view, link | Facilitate another team's session |
| Team view, helper line | You can't facilitate your own team. |
| Picker, exclusion copy (caller has memberships, list non-empty) | Your own team isn't listed. Facilitators run sessions for teams they're not on. |
| Picker, empty state (`callerHasTeamMemberships = true`) | There are no teams you can facilitate right now. Facilitators run sessions for teams they're not on. Don't see the team you're looking for? Create one to get started. |
| Picker, empty state (`callerHasTeamMemberships = false`) | You don't have a home team yet, and there are no teams you can facilitate right now. Don't see your team? Create one to get started. |
| Picker footer, return link | Go to your team |

Rule for any rewrite (spec R6/R9, 01c): name only the membership rule. Never say or imply "every team", "all other teams" or "no other teams". After #247, teams in the caller's reporting chain will also be absent, and the chain must not be revealed. The tests assert these exact strings, so editing one fails a test and sends you back to this rule. Design Open Questions offers Priya a plural alternative for the exclusion copy: "Teams you're on aren't listed. Facilitators run sessions for teams they're not on."

## Walkthrough

The script is `openspec/changes/facilitator-session-entry-point/walkthrough.md`. It needs a running local stack and IdP. **Step 3 (and the SQL in steps 6a and 8) is local development only, never against a shared or production database.** It bypasses the session state machine and writes no audit row. It must not be copied into `docs/deployment.md` or any runbook (design D6, security S-8). The missing abandon path is follow-up 2.

_Walkthrough results (task 4.3, human): paste the filled-in results table here._

## Regression guards (not test-first)

These are expected to pass at once and did. They lock in current behaviour against a future change, so they were not written test-first:

- **3.1** `auth.test.ts`: "redirects a returning facilitator with a membership to /team/:teamId, not /sessions/new (R11)". `setupValidCallbackMocks` gained an optional `globalRole` so the test actually varies the role (design D7 / E8). The landing code does not read `globalRole` today, so this guards only against a future branch on it.
- **3.2** `auth.test.ts`: "returns canFacilitateSessions: false for an engineering_manager caller (R4)". No precedence test was added, because three already exist and are cited:
  - `role-map.test.ts`: the `resolveGlobalRole` row `[["Eng-Managers", "Retro-Facilitators"], "engineering_manager", …]`
  - `account-resolver.test.ts`: `"[engineering_manager, facilitator] returning"`
  - `role-claim-persistence-integration.test.ts`: "a user sent both the manager and facilitator groups is stored as engineering_manager (#238)"
- **3.4** `facilitator-sessions.test.ts`: "the eligibility query excludes the caller's own team memberships via its WHERE clause" now also asserts that the SQL has no `tm.role` / `membership_role` predicate.
- **2.1(k)** `SessionCreationPage.test.tsx`: the picker ignores incoming `location.state` and pre-selects nothing (R2). It passed against the old code, and it locks R2 against a future "improvement".
- Several frontend absence assertions also held before implementation, as expected: 1.1(d)/(e), 2.1(b), (g), the network-error and 500 halves of (i), the `POST /draft` negative and the gate test.

The rest were written first and failed for the stated reason (missing test ids, old copy, no `refreshSession` call), then passed after implementation.

## Traceability (spec R1–R11 and the pre-existing scenarios)

Tests are named by their `it(...)` title. "TeamPage" = `packages/frontend/src/pages/__tests__/TeamPage.test.tsx`, "Picker" = `packages/frontend/src/pages/__tests__/SessionCreationPage.test.tsx`.

| Req / scenario | Covered by |
|---|---|
| **R1** Facilitator with a membership reaches the entry point from the team view. **Composite:** "exactly one navigation action after the post-sign-in landing" has no single test. | 3.1 `auth.test.ts` "redirects a returning facilitator with a membership to /team/:teamId, not /sessions/new (R11)" (landing) **+** TeamPage "(a) a facilitator with one membership sees a link to exactly /sessions/new and one click reaches the picker with no navigation state" and "(b) …second team's view…" (one click) **+** walkthrough steps 5–6. |
| **R2** The link does not target the viewed team; the picker pre-selects nothing | TeamPage (a)/(b) (`href` exactly `/sessions/new`, `location.state == null`), "(c) the link label names no team and is not a bare start/create/facilitate label"; Picker "(k) incoming navigation state naming an eligible team is ignored…". |
| **R3** Not shown to an Engineer | TeamPage "(d) an Engineer (canFacilitateSessions false, participant membership) gets no link to /sessions/new"; walkthrough step 7 (`participant-001`). |
| **R4** Not shown to an EM, including one also sent `facilitator` | Frontend: TeamPage "(e) an Engineering Manager … gets no link to /sessions/new". Backend flag: `auth.test.ts` "returns canFacilitateSessions: false for an engineering_manager caller (R4)". Precedence (cited, existing): `role-map.test.ts` row `["Eng-Managers", "Retro-Facilitators"] → engineering_manager`; `account-resolver.test.ts` "[engineering_manager, facilitator] returning"; `role-claim-persistence-integration.test.ts` "a user sent both the manager and facilitator groups is stored as engineering_manager (#238)". Walkthrough step 7 (`manager-001`). |
| **R5** Facilitator with an EM membership on the viewed team still sees the link; that team is not offered | TeamPage "(f) a facilitator holding an engineering_manager membership on the viewed team still sees the link"; server half: `facilitator-sessions.test.ts` "the eligibility query excludes the caller's own team memberships via its WHERE clause" (no membership-role predicate, task 3.4). |
| **R6** Picker explains the own-team exclusion, without overclaiming | Picker "(a) shows the own-team exclusion copy…", "(b) omits the exclusion copy when the caller has no memberships", "(d) the exclusion and both empty-state strings are exactly the shipped strings…"; walkthrough step 6. |
| **R7** Facilitator with memberships can return to a team from the picker; not on confirm/new-team | Picker "(e) a facilitator with memberships sees 'Go to your team'…", "(g) the way out is not rendered on the confirm screen", "(g) the way out is not rendered on the new-team screen"; walkthrough step 6. |
| **R8** Way out on load failure. **Composite** for the alternative outcome (403 → re-sync → redirect). | Floor: Picker "(h) while the list is still loading…", "(h) after a 403…", "(h) after a network error…", "(j) with no AuthSession…". Alternative outcome: Picker "(i) a 403 from eligible-teams calls refreshSession exactly once" (refresh-once half) **+** "(i) gate: when the session says canFacilitateSessions is false, the page redirects to /" (gate half) **+** walkthrough step 8 (end to end; **required**). Not triggered by other failures: "(i) a network error … does not call refreshSession", "(i) a 500 … does not call refreshSession", "(i) negative (A4): a 403 from the confirm screen's POST /draft does not call refreshSession", "(i) a 401 session_expired from eligible-teams renders the reauth treatment and does not call refreshSession". No loop: "(i) a refresh that yields a new, still-facilitator session does not re-fetch the list or refresh again", "(i) a new refreshSession identity from the context does not re-fetch the list or call the new function". |
| **R9** Empty-state copy doesn't claim "every team" / "no other teams" | Picker "(c) empty list with callerHasTeamMemberships=true…" and "=false…" (`it.each`), "(d)…"; the existing "6.1: renders the zero-eligible-targets empty state…" now asserts the new exact string (it replaces the `/already a member of every team/` assertion); walkthrough step 6a (optional). |
| **R10** Zero-membership facilitator sees sign-out, no team link | Picker "(f) a zero-membership facilitator sees sign-out and no 'Go to your team'"; walkthrough step 1. |
| **R11** Post-sign-in landing unchanged for a facilitator with memberships | `auth.test.ts` "redirects a returning facilitator with a membership to /team/:teamId, not /sessions/new (R11)"; walkthrough step 5. |
| Pre-existing: entry point not shown to a non-facilitator | `App.test.tsx` "5.4: a user with canFacilitateSessions: false never sees the session-creation entry point, even with zero team memberships"; Picker "(i) gate…"; TeamPage (d)/(e). |
| Pre-existing: shown to a zero-membership facilitator | `App.test.tsx` "5.5: a user with zero team memberships and canFacilitateSessions: true is routed to the session-creation entry point, not /no-team"; `NoTeamPage.test.tsx` "redirects a zero-membership facilitator to /sessions/new instead of showing no-team copy". |
| Pre-existing: confirm screen shows more than the bare name | Picker "6.2/6.6: confirm screen displays team name plus lastSessionAt context, not the bare team name alone". |
| Pre-existing: race-condition rejection shown inline | Picker "6.4: handles the 403 cross-team-constraint rejection with an inline, named error", "6.5: after a confirm-screen rejection, the picker's eligible-teams list is re-fetched on next open". |
| Pre-existing: 409 offers a path to the existing session | Picker "6.4: handles the 409 concurrent-session rejection with a resume-existing-session affordance". |

## Verification (task 4.1)

| Check | Result |
|---|---|
| `npm test` (repo root) | **Pass.** shared 30/30; backend 1518 passed, 3 skipped (87 files, 1 skipped); frontend 699/699 (47 files, after the implementation-review tests). |
| `npm run lint` (repo root) | **Pass:** 0 errors, 1 pre-existing warning (unused `eslint-disable` in `packages/frontend/src/realtime/voteRevealedLatency.ts`, untouched). |
| `npm run typecheck -w packages/frontend` | **Pass**, no errors. |
| `npm run build -w packages/backend` | **Pass**, no errors. |
| `npm run build -w packages/frontend` | **Pass.** |
| `npx tsc --noEmit -p packages/frontend/tsconfig.json` (includes tests) | 74 errors, **identical to `main`** (74). No new errors. The 2 in `TeamPage.test.tsx` are on the pre-existing `mockSession` fixture and `beforeEach`, deliberately left unedited (E6). |
| `npx tsc --noEmit -p packages/backend/tsconfig.json` (includes tests) | 203 errors, **identical to `main`** (203). Per-file counts for `auth.test.ts` and `facilitator-sessions.test.ts` are unchanged; none are on lines this change added. |
| `openspec validate facilitator-session-entry-point` | openspec CLI unavailable; validation not run. By hand: the traceability table above covers every scenario in `specs/session-creation/spec.md`. |

The 3 skipped backend tests are `src/__tests__/phantom-em-relationship-detection.test.ts`, which needs a `psql` binary on the host `PATH` (not installed here). Postgres itself was reachable, and the real-Postgres `role-claim-persistence-integration.test.ts` ran. The skip is unrelated to this change.

New tests: TeamPage +7; Picker +22 (one existing assertion replaced; 3 added after implementation review: 401 does not refresh, a new `refreshSession` identity does not re-fetch, a refreshed session object does not re-fetch or re-refresh); `auth.test.ts` +2; `facilitator-sessions.test.ts` +1 assertion in an existing test.

## Follow-ups

Drafted in `openspec/changes/facilitator-session-entry-point/follow-ups.md`: five issues and one comment on #247, to be filed after merge (task 4.7). Two are adoption-blocking: resume an in-progress session, and abandon a session from the UI.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
