# Implementation Review: Security — Facilitator session entry point (#237)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewed:** the uncommitted diff on `agent-team/237-facilitator-session-entry-point`: `SessionCreationPage.tsx`, `TeamPage.tsx`, their tests, and the two backend test files (`auth.test.ts`, `facilitator-sessions.test.ts`). I also read `AuthContext.tsx`, `SignOutButton.tsx`, `http/sessionExpiry.ts`, `App.tsx` (`AuthenticatedLanding`), the `GET /eligible-for-session` handler, `walkthrough.md`, `pr-description-draft.md` and `follow-ups.md`, to check the claims against the code.
**Verdict:** **Approve.** No blocking or medium findings. The change adds no server capability, and every new client branch is presentation only. The 403 re-sync is bounded and has no loop. The new copy and links carry no team context and say nothing about other teams or the reporting chain. All nine design findings (S-1 to S-9) were carried through. The three findings below are low or informational.

---

## 1. Verification

### 1.1 The 403 → `refreshSession` → redirect path (D5a)

| Property | What the code does | Result |
|---|---|---|
| Correct branch | The refresh runs only when `res.status === 403`, and only after `detectSessionExpiry` has ruled out a disclosed `session_expired` 401. Network errors (the `catch` block), 500s and other 401s do not refresh. | Correct |
| The 403 means only "role denied" | The `GET /eligible-for-session` handler (`facilitator-sessions.ts:2445–2473`) has one 403: `global_role !== "facilitator"`. A missing user gets a 401 `session_expired`, which goes to the reauth treatment. No global middleware sends a 403 on this GET. Keying on the status code alone is therefore sound. | Correct |
| No loop | `loadEligibleTeams` has `[]` deps and reads `refreshSession` through a ref. A new `session` object from the refresh cannot change its identity or re-run the fetch effect. `fetchSession` never sets `loading` back to true, so the page does not unmount or remount. Each mount of the picker triggers at most one refresh. Any further fetch needs a user action (Back from confirm, or navigating back to the page). | No loop |
| Redirect target | If the refreshed session has `canFacilitateSessions: false`, the page renders `<Navigate to="/" replace />`. `AuthenticatedLanding` then goes to `/team/:first` or `/no-team`. It never goes back to `/sessions/new`, because that branch needs the flag to be true. This holds for a zero-membership facilitator too. | No ping-pong |
| Refresh still says `true` (a race, or role restored) | The page keeps the generic error and the way out. Recovery is user-driven, with no automatic retry. | Safe |
| Refresh returns 401 | `AuthContext` sends the user to sign in. This is existing behaviour, and the right outcome. | Safe |
| Information leakage | The UI shows the fixed string "Failed to load teams you can create a session for." It never renders the server's 403 message or `correlationId`. The confirm screen's `POST /draft` 403 does not refresh (test "(i) negative (A4)"). | No leakage |
| Tests | Covered: 403 refreshes exactly once, network error and 500 do not refresh, the draft 403 does not refresh, and the gate redirects to `/` when the flag is false. | Covered (see F-1) |

### 1.2 The TeamPage link carries no team context (D3)

`<Link to="/sessions/new">` is a static path, with no segment, query string or `state`. The block's copy names no team. TeamPage test (a) asserts that navigation arrives with no state. Picker test (k) asserts that incoming navigation state naming an eligible team is ignored and nothing is pre-selected. The picker's team set comes only from the server listing. **Confirmed.**

The picker's "Go to your team" link is built from `session.teamMemberships[0].teamId`, a server-issued UUID, passed through React Router `<Link>`. It takes no user-controlled input, so there is no open-redirect or injection surface. It is null-safe when `session` is null (test j).

### 1.3 Client gating is presentation only

- TeamPage renders the block only when `session.canFacilitateSessions === true`. The flag is computed by the server from live `users.global_role` (confirmed in the design review, `routes/auth.ts`).
- The picker's gate (`session && !session.canFacilitateSessions` → `/`) changes only where the user is sent. If `session` is null, the picker still renders and calls the endpoint, and the server decides.
- If a client is tampered with so that the flag reads `true`, the result is unchanged from the design review: `/eligible-for-session` returns 403 with no data, `POST /draft` returns 403, and `POST /api/v1/teams` returns 403 with an audit row. The new code has no client-side team filtering or eligibility logic. **Confirmed.**
- The code comment in TeamPage says DOM absence "is a UX property, not an access control", which honours S-1 at the point where a future editor will read it.

### 1.4 Copy: exclusion and empty states

| String | What it discloses |
|---|---|
| "There are no teams you can facilitate right now. Facilitators run sessions for teams they're not on. …" | Only the membership rule. It makes no claim about how many teams exist or about "every team". |
| "You don't have a home team yet, and there are no teams you can facilitate right now. …" | Only the caller's own lack of membership, which they already know. |
| "Your own team isn't listed. Facilitators run sessions for teams they're not on." | Only the caller's own membership. The condition is `listData.callerHasTeamMemberships` (the caller's own state, from the server), not data about other teams. |
| TeamPage: "Facilitate another team's session" / "You can't facilitate your own team." | It names no team. |

None of these strings names other teams, implies an org-wide count, or says anything about the reporting chain. A team that #247 later excludes for being in the chain will be absent without any contradiction from this copy. Test (d) pins the exact strings and asserts that they never say "every" or "all other". **Confirmed.** The remaining inference from a team's absence in the list is #247's problem, as S-2 records.

### 1.5 Sign-out on the picker

The picker reuses the existing `SignOutButton` unchanged: `POST /auth/logout` with credentials, the existing `confirmRequired` step for active sessions, and `redirectUrl` from the server. It renders in every list state (loading, error including the 403, empty, populated), so a user whose role was revoked always has a way out. It is not shown on the reauth early return. That is correct, because that treatment replaces the page and owns re-authentication. No new logout surface or token handling is introduced. **Confirmed.**

### 1.6 Backend test additions

- `auth.test.ts`: there is an R11 regression guard (a returning facilitator lands on `/team/:id`, not `/sessions/new`) and the R4 assertion that an `engineering_manager` gets `canFacilitateSessions: false`, which closes the gap S-5 identified. The `globalRole` mock option is opt-in and leaves existing tests unchanged.
- `facilitator-sessions.test.ts`: the eligible-teams SQL is asserted to have no membership-role predicate, so a facilitator's `engineering_manager` membership still excludes that team. This is a string-match guard (see F-3).

---

## 2. Design findings disposition (S-1 to S-9)

| # | Design finding | Where it was honoured | Status |
|---|---|---|---|
| S-1 | DOM absence is not a disclosure control | design D2; TeamPage code comment | Honoured |
| S-2 | Copy alone cannot keep the chain hidden | design Risks; proposal Constraints softened; follow-ups 5; the copy names only the membership rule | Honoured |
| S-3 | A listing filter is not enforcement | proposal Constraints; design Risks; follow-ups 5 (#247 comment text) | Honoured |
| S-4 | Deactivated teams are not refused at `POST /draft` | design Context; follow-ups "not filed, recorded" | Honoured (wording only, as agreed) |
| S-5 | The precedence test already exists | cited in `auth.test.ts` comment and `pr-description-draft.md`; new EM flag assertion added | Honoured |
| S-6 | Role-based 403s are not audited | design Risks; follow-ups 6 (`session.draft_denied_role`) | Honoured (deferred explicitly) |
| S-7 | Revocation latency comes from role sync, not the UI | design Context and Risks; the D5a comment does not claim immediacy | Honoured |
| S-8 | Guardrails for the D6 direct-database workaround | `walkthrough.md` banner and step 3 labelled "local development only, never against a shared or production database"; PR draft repeats it; nothing added to `docs/` | Honoured |
| S-9 | Server-side scoping and audit shape for resume and abandon | `follow-ups.md` issues 1 and 2 carry the requirements | Honoured |

---

## 3. Findings

### F-1 (Low, test strength): the "exactly once" refresh test does not show that a refreshed session leaves the fetch alone
Test "(i) a 403 from eligible-teams calls refreshSession exactly once" uses a mock `refreshSession` that does not change the context value. The no-loop property rests on the `[]` deps and the ref. That is correct today, but nothing would catch a regression where someone adds `session` or `refreshSession` to `loadEligibleTeams`' deps.
**Recommendation (non-blocking):** add one test where the mock `refreshSession` re-renders with a new session object that still has `canFacilitateSessions: true`. Assert that `fetch` was called once and `refreshSession` was called once.

### F-2 (Informational): the 403 re-sync generates no audit trail, by scope
The D5a path makes a role-denied visit to the picker cost one extra `/auth/session` read and nothing more. That is fine. As S-6 recorded, the `GET /eligible-for-session` 403 itself is not audited, so a revoked facilitator's repeated attempts are invisible to an investigator except through access logs. No change here. Make sure follow-up 6 is filed (task 4.3) and not lost.

### F-3 (Informational): the R5 server guard is a SQL string match
`expect(sql).not.toMatch(/tm\.role|membership_role/)` would miss a role predicate written with a different alias, or a predicate moved into a CTE. It is adequate as a regression tripwire alongside the existing `LEFT JOIN … WHERE tm.id IS NULL` assertions. The real-Postgres harness from #235 could later hold a behavioural test (a facilitator with an EM membership on team X does not get X listed). Optional.

---

## 4. Threat model impact (implementation)

| Area | Impact |
|---|---|
| Authentication | None. Callback landing is unchanged, and the R11 guard was added. The sign-out flow is reused as is. |
| Authorization | None on the server. All new client branches are presentational, and the server checks are unchanged and re-verified. |
| Information disclosure | None new. Error text is generic, the copy states only the membership rule, and the links carry no team context. |
| Audit | No new events. The pre-existing gap is deferred to follow-up 6 (S-6, F-2). |
| Availability / client loops | The 403 re-sync is bounded to one refresh per mount, and the redirect target cannot route back to the picker. |

The change is ready to merge from a security standpoint. F-1 is a worthwhile test hardening, but it does not block the merge.
