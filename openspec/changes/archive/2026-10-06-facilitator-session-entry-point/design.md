# Design: Facilitator session entry point (#237)

**Author:** Devon Calloway, Internal Champion (proposal stage). Revised by Ingrid Sollenberger, Solution Architect (design stage).
**Revision:** 3. Revision 2 incorporated `propose-review-ba.md` B1–B3 and V1–V7 (see the proposal's Review disposition). Revision 3 incorporates `design-review-engineer.md` E1–E8 and `design-review-security.md` S-1–S-9 (see "Design review disposition" at the end).

## Context

- **Landing.** The server makes the landing decision. `GET /auth/callback` (`packages/backend/src/routes/auth.ts`) chooses in this order: join-flow redirect, then `returnTo`, then `/team/{team}` if the user has any membership, otherwise `/no-team`. The membership query is `LIMIT 1` with no `ORDER BY`. `AuthenticatedLanding` (`App.tsx`) applies the same branches only when someone opens `/`.
- **`TeamPage`.** It renders a bare "Team" heading, a list of *all* the caller's memberships, a "Topics" link (shown to everyone), `MemberManagement` and sign-out. It never names the team in the URL.
- **`SessionCreationPage`.** It is gated client-side on `canFacilitateSessions` and redirects to `/` when that is false. Its picker screen loads `GET /api/v1/teams/eligible-for-session`, which returns `{ eligibleTeams, callerHasTeamMemberships }`, already excluding teams where the caller has an active membership of any role and teams with `deactivated_at` set. Only the empty state explains the exclusion. The picker has no way out: no team link and no sign-out.
- **What the server enforces, and where (S-4).** The membership exclusion is enforced twice: in the listing, and at `POST /teams/:id/sessions/draft` (403 plus an `audit_log` row). Deactivation is filtered from the **listing only**. `POST /draft` checks team existence with no `deactivated_at` filter, by a prior recorded decision (`routes/topics.ts:171`). Deactivation is housekeeping here, not a security boundary, and this change does not alter that.
- **`canFacilitateSessions`.** It is computed by the server from the live `users.global_role` on every `/auth/session` call (`=== 'facilitator'`). The client fetches `/auth/session` when `AuthProvider` mounts and, as a side effect of `fetchSession` depending on `navigate` (whose identity changes with the pathname under `<BrowserRouter>`), again on every client-side pathname change. The only explicit caller of `refreshSession()` is `MemberManagement`, after a role change (E2; corrected after implementation review, architect finding 2).
- **`users.global_role` changes only at sign-in** (the role claim is re-mapped by #235/#243) or by direct database change. Revocation latency is therefore bounded by the next sign-in and the 90-minute absolute session lifetime (`auth/middleware.ts`), not by anything in this UI (S-7).

## Goals / Non-Goals

**Goals**
- A facilitator with one or more memberships gets from sign-in to `/sessions/new` with one click.
- The UI states the other-team rule wherever a facilitator might otherwise read its effect as a bug.
- `/sessions/new` is no longer a dead end in the other direction.

**Non-Goals**
- No change to landing or redirect, shared layout or global nav, resume of in-progress sessions, the Topics link, the persona fixture, or any server behaviour (see proposal).

## Decisions

### D1. The entry point lives on `TeamPage`, in its own Facilitator block
- It renders as a `<section data-testid="team-facilitator-block">` with an `<h2>Facilitator</h2>`, containing one `<Link to="/sessions/new">` with a stable test id (`nav-facilitate-session`) and a helper line.
- **Placement (E7).** After `<h1>Team</h1>` (and therefore after the two join notifications, which stay first because they acknowledge the action the user just took), immediately before `<h2>Members</h2>`.
- It is visually and structurally separate from the "Topics" link and `MemberManagement`, so a cross-team action is not presented as a team-scoped one.

*Alternatives:*
- Next to "Topics": rejected (Priya, Q2/O7). It would pair the link with a link that leads to a denial on the home team.
- A shared header (option B): this would be the first shared layout, a UX-architecture decision, and too large for a bug fix.
- Facilitator-first landing (option C): rejected. It hides the home team, where the user is a participant, and needs a server change.

### D2. The render condition is `session.canFacilitateSessions === true`, and nothing else
- It does not depend on which team is being viewed, the membership role on it, or whether that team is deactivated. The link never targets the current team.
- **A facilitator whose membership role on their home team is `engineering_manager` (BA C4) sees the link.** The protective rule is that they never facilitate a team they're on, and the eligible-teams endpoint and the draft refusal already enforce that for any membership role.
- **When the flag is false, the block is not rendered**: absent from the DOM, not hidden, disabled or collapsed. This is a UX and ritual property (participants are not shown an action that is not theirs). **It is not a disclosure control (S-1).** The block's strings and the `/sessions/new` route ship in the same JS bundle as every other page, and nothing about them is secret. Authorization rests solely on the server checks listed in Context; never cite DOM absence as a confidentiality control.

### D3. The link target carries no team context
The target is exactly `/sessions/new`: no path segment, query string or `state`. The picker stays the single place that decides which teams are offered, and it decides only from `/eligible-for-session`. That is what lets #247's reporting-chain filter (01c) take effect without touching this entry point. **Do not add "pre-select the team I came from" or "exclude the team I came from" logic on the client. The server already excludes it.**

### D4. Label: the meaning is normative, the string is not
- **Normative meaning:** "facilitate a session for a team other than this one". It must not be "Start a session", "Create a session" or a bare "Facilitate", and must not contain the current team's name. That is necessary anyway, because the page does not reliably name its team.
- **Shipping strings (listed in the release notes for Priya's walkthrough):**
  - link: "Facilitate another team's session"
  - helper: "You can't facilitate your own team."

### D5. Picker changes, on the picker screen only
- **Exclusion copy.** Rendered when `listData.callerHasTeamMemberships && listData.eligibleTeams.length > 0`, above the list.
  - Shipping string: "Your own team isn't listed. Facilitators run sessions for teams they're not on."
  - **Guardrail:** the copy names only the membership rule. It must not say "all other teams" or "every team except yours". After #247, teams in the caller's reporting chain will also be absent, and 01c requires that the chain not be revealed.
- **Empty-state copy (BA B1).** Both branches are rewritten under the same guardrail. Today's strings claim "already a member of every team in the organization" and "there are no other teams", which are already false for deactivated teams and would hint at the chain after #247. Shipping strings (not normative):
  - `callerHasTeamMemberships = true`: "There are no teams you can facilitate right now. Facilitators run sessions for teams they're not on. Don't see the team you're looking for? Create one to get started."
  - `callerHasTeamMemberships = false`: "You don't have a home team yet, and there are no teams you can facilitate right now. Don't see your team? Create one to get started."
  - The "Create a new team" button and the `picker-empty-state` test id are unchanged. The existing test that matches "already a member of every team" is replaced. It defends the defect.
- **Return link.**
  - "Go to your team", linking to `/team/${homeTeam.teamId}` where `const homeTeam = session?.teamMemberships[0];`. It is rendered only when `homeTeam` is defined.
  - **Null-safe (E3).** The page's gate is `session && !session.canFacilitateSessions`, so the picker *does* render with `session === null` when `/auth/session` failed at the network level. The footer must not dereference `session` and must not use the `[0]!` non-null assertion that `App.tsx` and `NoTeamPage` use. With a null session it renders sign-out only.
  - It uses the same client index as `AuthenticatedLanding`. No ordering is specified, and there is no list and no switcher. Inline it with a comment pointing at `AuthenticatedLanding`; extracting a shared helper would touch `App.tsx` and `NoTeamPage`, which the scope guard rules out (N2).
  - Test id: `picker-go-to-team`.
  - **Two sources of "has memberships" are deliberate (N1).** The exclusion copy keys on the live `listData.callerHasTeamMemberships`; the return link keys on `session.teamMemberships`, captured at mount. They can briefly disagree (a join in another tab, a removal). Both outcomes are harmless. Do not "harmonise" them by deriving the copy from the context: that moves a server fact onto the client. The split is forced anyway, because `listData` carries no `teamId`.
- **Sign-out.** The existing `SignOutButton` is rendered on the picker for every facilitator, because this page is the landing page for zero-membership facilitators.
- **Render placement (BA B2).** The return link and sign-out sit in a small footer, `<div data-testid="picker-way-out">`, in the picker's own return block, **outside** the `listLoading` / `listError` / `listData` conditionals, so they render in every list state. "Create a new team" stays inside its existing `!listError` guard, because it calls an endpoint that would also 403. `SignOutButton` is reused unchanged; no test id is added to the shared component (tests query the button within `picker-way-out`).
- **One exception: session expiry (E4).** The `if (reauthRequired) return <ReauthRequiredTreatment …/>` early return replaces the whole page, so the footer is absent there. That is correct, because the treatment owns that path. Do not lift the footer above the early return.
- **The confirm and new-team screens are unchanged (BA B3).** Confirm already has "Back", and two competing back controls would confuse. The new-team screen has its own "Back" to the picker. Do not lift the footer into a wrapper shared by all three screens.

### D5a. A role-denied picker re-syncs the session (E2)
**Problem.** Because `AuthSession` is re-fetched only on mount and (incidentally) on pathname changes, a tab can keep `canFacilitateSessions = true` after the server has stopped treating the user as a facilitator (a sign-in elsewhere re-mapped the role, or a direct DB change; see S-7). Without an explicit correction, D1 and D5 together risk a loop (in practice the incidental per-navigation refetch largely closes it, but nothing in this component guarantees that): TeamPage (link shown) → picker (403, "Failed to load teams…") → "Go to your team" → TeamPage (link still shown) → … This design introduces the loop, because the return link closes it.

**Decision.** In `loadEligibleTeams`, when the response is **403** and not a session expiry, set `listError` as today **and call `refreshSession()` once** (fire-and-forget, from the existing `useAuth()`). If the refreshed session has `canFacilitateSessions = false`, the page's existing gate (`session && !session.canFacilitateSessions → <Navigate to="/" replace />`) sends the user to `AuthenticatedLanding`, which routes them to their team or `/no-team`. The refreshed context also removes the TeamPage block everywhere in the SPA.

- Only 403 triggers it. The endpoint's only 403 is the role denial (`category: "forbidden"`); 5xx, network errors and 401 `session_expired` do not refresh. Keying on status rather than parsing `category` keeps the change to the existing branch; the body is already read once by `detectSessionExpiry`, so no second read is needed.
- **No loop risk.** `loadEligibleTeams` has no dependency on `session`, so a new session object does not re-trigger the fetch. One 403 → at most one refresh.
- **Explicit, not incidental.** Arriving at `/sessions/new` already re-fetches `/auth/session` through the per-navigation side effect described in Context, so D5a's refresh may race that request (both read the same column; the race is harmless). D5a is the intentional re-sync at the point where the divergence is detected and does not rely on that side effect.
- If `/auth/session` itself fails, or still says facilitator (should not happen, since both read the same column), the user stays on the picker with the load error and the D5 footer. That is the R8 floor and nobody is stranded.
- The confirm screen's `POST /draft` 403 does **not** refresh. It already shows the rejection inline and marks the list stale; "Back" re-fetches the list, whose 403 then triggers this path. One refresh point is enough.
- `AuthContext` is not modified. It already exposes `refreshSession()` for exactly this purpose ("keeps the UI in sync after a role assignment").

**Why (b) and not (a).** The engineer offered (a): correct the Risks text and accept the loop. It is smaller by about three lines, and it is safe. I chose (b) because the client has *already detected* that its state diverges from the server's, and (a) would knowingly ignore that. A client that holds authority-shaped state and does not re-sync on a server contradiction is precisely the class of divergence the server-authority principle exists to prevent. The cost is three lines and two tests, inside a component this change already edits, with no new state shape. This is the smallest correct option: it closes the loop this change creates and nothing more. **Non-goal:** a general "refresh `AuthSession` on any 403" policy across the app. That belongs to a shared HTTP layer and is not proposed here.

**Spec impact.** R8's THEN gains an alternative outcome: when the refreshed session reports `canFacilitateSessions = false`, the user is redirected to their landing instead. Tests continue to assert the R8 floor with a no-op `refreshSession` mock, plus that the mock is called exactly once on 403 and not on network error or 500.

### D6. Walkthrough cleanup: no way to abandon a lobby session exists, so use a local-only workaround
**Finding.** No route moves a session to `abandoned`.
- The `session_status` enum has `abandoned`, but the only write routes are `draft`, `advance`, `start`, `begin-voting`, `participants`, `reveal`, `topics/advance` and `complete`. `complete` accepts only `wrap_up`.
- Every team created through `POST /api/v1/teams` starts with a `lobby` session owned by its creator.

**Why the walkthrough must clean up.** If `facilitator-001` creates "Home" and then redeems its join link while that session is still `lobby`:
- they become a member of a team whose open session they facilitate, which is not a state a real user starts from;
- `resolveJoinLandingPath` sends them to the session, not `/team/{Home}`, so the walkthrough would not exercise this change.

**Workaround (local development only; documented in tasks 4.1 and the release notes, never in deployment docs).** After copying the "Home" join link, mark that session abandoned directly in the local database:

```
docker compose exec postgres psql -U dipstick -d dipstick \
  -c "UPDATE sessions SET status = 'abandoned', abandoned_at = now() WHERE team_id = (SELECT id FROM teams WHERE name = 'Home') AND status NOT IN ('complete','abandoned');"
```

`abandoned_at` is required (E1): `migrations/2_create_tables.sql` has `CONSTRAINT sessions_abandoned_has_timestamp CHECK (status != 'abandoned' OR abandoned_at IS NOT NULL)`, and the existing integration test `facilitator-error-states-integration.test.ts` writes the same pair. `abandoned` is a terminal status. It is outside the active-session unique index predicate (`migrations/10_sessions_team_active_unique.sql`), and join landing then resolves to `/team/{Home}`. This is acceptable because it changes only local fixture data and bypasses no check under test.

**Guardrails (S-8).** This statement skips the session state machine and writes no `audit_log` row. Wherever it appears (tasks 4.1, the PR release notes) it is labelled "local development only, never against a shared or production database". It never appears in `docs/deployment.md` or any runbook, and it is not an abandon path for shared environments while follow-up 4 is open.

The missing abandon path is filed as follow-up 4. It is also a product gap: a team whose new-team lobby never runs keeps an open session indefinitely.

### D7. Backend tests: landing unchanged (R11), and the EM half of R4
One test in `auth.test.ts`: a user with `global_role = 'facilitator'` and one membership signs in with no `returnTo` or pending join token, and is redirected to `/team/{that team}`. This guards against a future "facilitators land on `/sessions/new`" change that this proposal rejected.

**The landing test must actually vary the role (E8).** `setupValidCallbackMocks` takes no `globalRole` and its resolved account carries none, so a naive test would duplicate the existing "redirect to team page for user with memberships" test and guard nothing. Extend the helper with `globalRole?: GlobalRole` and pass `"facilitator"`. The landing code does not read `globalRole` today, so the test guards only against a *future* branch on it. That is the intent; say so in the test comment.

R4 (an EM who is also sent `facilitator` sees no link) has two halves (BA V1):
- **Backend, precedence: already covered; cite, do not add (E8, S-5).**
  - `auth/__tests__/role-map.test.ts`: the `resolveGlobalRole` precedence row `[["Eng-Managers", "Retro-Facilitators"], "engineering_manager", …]`.
  - `auth/__tests__/account-resolver.test.ts`: the row `"[engineering_manager, facilitator] returning"`.
  - `auth/__tests__/role-claim-persistence-integration.test.ts`: "a user sent both the manager and facilitator groups is stored as engineering_manager (#238)", against real Postgres.
- **Backend, flag: new.** Add an `/auth/session` assertion for `global_role = 'engineering_manager'` returning `canFacilitateSessions: false`, next to the existing 4.3/4.4 cases in `auth.test.ts`. 4.4 covers only a generic non-facilitator, so this gap is real.
- **Frontend:** the link is absent when the flag is false (task 1.1(e)).

## Risks / Trade-offs

- **The link appears only on team pages.** A facilitator viewing an EM page or Topics has no link there. This is acceptable for a bug fix. Option B can absorb it later, and D1's block is easy to move.
- **A stale `canFacilitateSessions` (E2, S-7).** The client's copy of the flag lasts until the next client-side pathname change or explicit refresh (see Context), not for the SPA's lifetime as revision 3 stated. Two different things are easily conflated:
  - *Revocation latency* is set by the role-sync design (#235/#243): `users.global_role` changes only when the user signs in again (bounded by the 90-minute absolute lifetime) or by direct DB change. Until then the server itself still authorizes the user as a facilitator on every endpoint. The 403 is **not** evidence that revocation is immediate.
  - *Client staleness* is the window between the server's role change and this tab noticing. D5a closes it on the first 403 from the picker. Until the user follows the link, the TeamPage block may still show; following it is harmless, because the server decides.
- **Chain non-revelation is #247's design problem, not this copy's (S-2).** The copy guardrail (R6/R9) is necessary but not sufficient. `/eligible-for-session` enumerates org-wide teams (accepted in the base spec), so a facilitator who knows a team exists (from the hallway, or a `TeamNameCollisionResponse` on `POST /api/v1/teams`) can infer chain membership from its absence. #247 must address list filtering, the `POST /draft` refusal body (01c §3) and existence oracles. This change's copy only avoids making it worse; it does not "reveal nothing" on its own.
- **The chain is enforced at `POST /draft`, not by the list (S-3).** The listing is a convenience. #247 must add the `inChain` check to `POST /draft` (enforcement, audited) as well as to `/eligible-for-session` (presentation). A filter on the listing alone would not be enforcement. Recorded as follow-up 5.
- **Role-based 403s on the facilitator path are not audited (S-6).** `GET /eligible-for-session` 403 and `POST /draft` 403 ("Only a facilitator can create a draft session") write no `audit_log` row, while `POST /api/v1/teams` audits the same denial (`team.creation_denied_role`). This change makes the path one click away, so the pre-existing gap is easier to reach. Under the "no server change" scope it is deferred explicitly, not left implicit: follow-up 6 adds `session.draft_denied_role`; auditing the listing's 403 is optional because it is a read. The 01c record already lists "auditing standing-access refusals" as open scope.
- **The copy could drift** toward "all other teams" in a later edit. R6/R9's normative rules, plus tests that assert the exact shipped strings, guard against this: any copy edit fails a test and sends the editor back to the rule. A reviewer note is in tasks 2.1.
- **Return link to a deactivated team (BA V5).** `/auth/session` memberships filter `removed_at` but not `deactivated_at`, and neither does the sign-in callback's landing query. If a facilitator's home team is deactivated, "Go to your team" can lead to that team's page, as sign-in already does today. This is accepted, because the return link adds no failure the landing doesn't already have. Filtering deactivated teams from memberships is out of scope.
- **Nondeterministic "your team".** With several memberships, the return link and landing may pick a different team on different calls. That is harmless: any of the user's teams is a valid way back. Specifying an ordering is out of scope.

## Migration Plan

None. Frontend-only and additive. Rollback is a revert.

## Open Questions

None blocking. Priya reviews the shipping strings in the walkthrough (task 4.2). Strings may change without a spec change. Engineer's N3 (a plural exclusion string for multi-membership facilitators, e.g. "Teams you're on aren't listed. Facilitators run sessions for teams they're not on.") is offered to Priya as an alternative; it satisfies the same guardrail.

## Follow-ups (security and architecture carry-forwards)

Follow-ups 1–4 are in the proposal. This review adds 5 and 6, and attaches requirements to 1 and 4 (task 4.3 copies these into the filed issues):

- **1 (resume), S-9.** "Only the caller's own sessions" (`facilitator_id = caller`) is enforced in the server query and on the resume and read endpoints, not by filtering a broader list on the client. The role is re-read live, as in every other handler.
- **4 (abandon), S-9.** The new transition uses the same authorize/transaction/audit shape as `advance` and `complete`: an `audit_log` row in the same transaction, `session.state_changed` emitted after commit, and authorization against `facilitator_id` plus a live role check. It replaces D6's local SQL.
- **5 (comment on #247), S-3 and S-2.** The reporting-chain check goes on `POST /teams/:id/sessions/draft` (enforcement, audited) **and** `/eligible-for-session` (presentation); the listing filter alone is not enforcement. Chain non-revelation must also cover the `POST /draft` refusal body and existence oracles such as `TeamNameCollisionResponse`.
- **6 (new issue), S-6.** Audit role-based denials on the facilitator path: `session.draft_denied_role` on `POST /draft`, consistent with `team.creation_denied_role`. Auditing the `/eligible-for-session` 403 is optional (a read). Link it to 01c's open "auditing standing-access refusals" scope.
- **Not filed, recorded (S-4).** Deactivated teams are not refused at `POST /draft`, by prior decision. If deactivation is ever meant to be a security boundary rather than housekeeping, it needs its own issue.
- **Not filed, recorded (N5).** TeamPage's "Members" heading lists the caller's own memberships, not the team's members. Worth fixing if anyone revisits TeamPage's information architecture.

## Design review disposition

### `design-review-engineer.md` (Marcus Oyelaran): approve with changes

| # | Point | Disposition | Rationale and where |
|---|---|---|---|
| E1 | D6 SQL violates `sessions_abandoned_has_timestamp` | **Accepted** | Verified in `migrations/2_create_tables.sql:77`. `abandoned_at = now()` added. D6, task 4.1 step 3. |
| E2 | Stale flag lasts the SPA's lifetime; return link creates a loop | **Accepted, option (b)** | Verified: only `MemberManagement` calls `refreshSession()` explicitly. ("`AuthProvider` fetches once" was wrong: it also re-fetches on every pathname change; corrected in Context after implementation review.) Refresh on the picker's 403 (D5a) rather than accept a divergence the client has detected. Risks text corrected. Spec R8 gains the redirect alternative. Tasks 2.1(i), 2.2. |
| E3 | Picker renders with `session === null` | **Accepted** | Verified the gate is `session && …`. D5 specifies `session?.teamMemberships[0]`, no `!`. Task 2.1(j). |
| E4 | Re-auth early return has no footer | **Accepted** | D5 exception stated. |
| E5 | Auth mock leaks between tests; harness recipes | **Accepted** | Verified `vi.clearAllMocks()` does not reset `mockReturnValue`. `setSession` helper, pending/rejected fetch recipes and `picker-way-out` test id in task 2.1. |
| E6 | Stale TeamPage fixture; routed render; sentinel route; case-insensitive (c) | **Accepted** | Verified the fixture uses `"facilitator"`/`"member"` membership roles and no flag. Task 1.1 preamble and (a), (c), (g). |
| E7 | Ambiguous placement; no selector for the block | **Accepted** | D1 placement and `team-facilitator-block`. Tasks 1.1(g), 1.2. |
| E8 | Precedence tests exist; `setupValidCallbackMocks` trap | **Accepted** | Verified all three cited tests exist. D7, tasks 3.1, 3.2. |
| N1 | Two sources of "has memberships" | **Accepted, recorded** | D5. |
| N2 | `teamMemberships[0]` in three places | **Accepted** | Inline with comment; no helper (scope guard). D5. |
| N3 | Plural exclusion copy | **Deferred to Priya** | Non-normative string. Open Questions. |
| N4 | `callerHasTeamMemberships` counts deactivated-team memberships | **Noted, no action** | The copy remains true. Same root cause as V5. |
| N5 | "Members" heading mislabels content | **Noted** | Follow-ups, not filed. |
| N6, N7 | "Create a new team" guard; no live-session leakage | **Agreed** | No change. |

### `design-review-security.md` (Tomás Ferreira): approve with minor changes

| # | Point | Disposition | Rationale and where |
|---|---|---|---|
| S-1 | DOM absence is not a disclosure control | **Accepted** | D2 reworded. |
| S-2 | Copy alone cannot keep the chain hidden | **Accepted** | Risks; follow-up 5. Proposal Constraints softened from "reveals nothing". |
| S-3 | Listing filter is not enforcement | **Accepted** | Proposal Constraints reworded; Risks; follow-up 5. |
| S-4 | Deactivated teams not refused at `POST /draft` | **Accepted (wording only)** | Verified `routes/topics.ts:171`. Context states it. No behaviour change. |
| S-5 | Precedence test exists | **Accepted** | Same as E8. |
| S-6 | Role-based 403s unaudited | **Accepted as a deferred decision** | Out of scope (no server change). Risks; follow-up 6. |
| S-7 | Revocation latency comes from role sync, not the UI | **Accepted** | Context and Risks reworded. D5a makes the 403 path re-sync, without claiming revocation is immediate. |
| S-8 | D6 guardrails | **Accepted** | D6; task 4.1 step 3; task 4.2. |
| S-9 | Server-side scoping and audit shape for follow-ups 1 and 4 | **Accepted** | Follow-ups section; task 4.3. |

Nothing accepted here moves a check off the server or widens scope beyond the two frontend components plus tests. D5a is the only behavioural addition, and it uses an existing context method.
