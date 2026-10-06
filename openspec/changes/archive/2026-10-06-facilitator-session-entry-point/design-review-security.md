# Design Review: Security — Facilitator session entry point (#237)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewed:** `design.md` (rev 2), `proposal.md`, `specs/session-creation/spec.md`, `tasks.md`, and the 01c decision record (`requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`). I checked the claims against the code on `agent-team/237-facilitator-session-entry-point`.
**Verdict:** **Approve with minor changes.** The change is UI only and adds no server-side capability. Every control the design relies on is enforced on the server, and I confirmed that in the code. My findings are about wording that overstates what the UI does, carry-forward requirements for #247 and the follow-ups, and audit gaps that already exist and that this change makes easier to hit.

---

## 1. Verification: client gating is presentation only, and the server decides

| Claim in design | Verified in code | Result |
|---|---|---|
| `canFacilitateSessions` is computed by the server from live `users.global_role` | `routes/auth.ts:767`: `canFacilitateSessions: user.global_role === "facilitator"`. `global_role` is read from `users` on each `/auth/session` call and is not cached in the Redis session blob. | Confirmed |
| `/eligible-for-session` makes its own authorization decision | `routes/facilitator-sessions.ts:2445–2471`: a live `SELECT global_role FROM users`, then 403 unless `facilitator`. It never reads `canFacilitateSessions` or session-carried role state. | Confirmed |
| `/eligible-for-session` excludes the caller's teams for any membership role, and excludes deactivated teams | Lines 2484–2495: `LEFT JOIN team_memberships … removed_at IS NULL WHERE tm.id IS NULL AND t.deactivated_at IS NULL`. There is no role predicate, so `participant` and `engineering_manager` memberships are both excluded. | Confirmed |
| `POST /draft` re-checks the role and the membership, and audits the conflict | Lines 285–370: `evaluateStandingFacilitatorAccess` (one live query, `auth/standing-facilitator-access-helper.ts`), 403 when the role is not `facilitator`, 404 when the team does not exist, then 403 plus an `audit_log` row and `emitAuditEvent("session.draft_denied_membership_conflict")` when `is_member`. | Confirmed |
| `POST /api/v1/teams` (the "Create a new team" path) is role-gated on the server | Line 523 onward: role denial is audited as `team.creation_denied_role`. | Confirmed |
| All `/api/v1` routes require an authenticated session | `auth/middleware.ts:156`: an `onRequest` hook returns 401 when there is no `session.userId` (only the public-route allowlist is exempt), and enforces the absolute lifetime. | Confirmed |
| EM plus `facilitator` claims resolve to `engineering_manager`, so the flag is false | `auth/__tests__/role-map.test.ts` ("precedence for [Eng-Managers, Retro-Facilitators] → engineering_manager") and `auth/__tests__/account-resolver.test.ts` ("[engineering_manager, facilitator] returning logs exactly one precedence-discard line"). | Confirmed. Tests already exist (see S-5). |

**Threat check: a tampered client.** Suppose a participant or EM edits the `/auth/session` response, or React state, so that `canFacilitateSessions = true`. They would see the Facilitator block and reach the picker. Then:
- `GET /eligible-for-session` returns 403 with no team data.
- `POST /teams/:id/sessions/draft` returns 403.
- `POST /api/v1/teams` returns 403, and the denial is audited.

The UI gate grants nothing, so tampering with it yields nothing. D3 (no team context in the link) and the spec rule "SHALL NOT add, remove or pre-select teams on the client" also mean the client cannot widen the eligible set. A forged `/team/:teamId` value never reaches the server through this link.

**New inputs.** The return link `/team/${teamMemberships[0].teamId}` is built from a server-issued UUID and passed through React Router `<Link>`. It accepts no user-controlled input, so it creates no injection or open-redirect surface. The picker's `SignOutButton` reuses the existing `POST /auth/logout` flow without changes.

---

## 2. Findings

### S-1 (Low, wording): "A participant never learns that a facilitator affordance exists" overstates what the UI can do
D2 says DOM absence means "a participant never learns that a facilitator affordance exists". The block's strings and the `/sessions/new` route ship in the same JS bundle as every other page, so anyone who reads the bundle can see them. That is acceptable, because nothing about the affordance is secret. But nobody should later cite DOM absence as a confidentiality control.
**Change:** reword D2 to say the absence is a UX and ritual property ("the block is not rendered"), not a disclosure control. Authorization stays solely with the server checks in section 1.

### S-2 (Medium, carry-forward to #247): copy alone cannot keep the chain hidden
The design says the copy guardrail (R6/R9) keeps the reporting chain from being revealed once #247 lands. The copy is necessary, but it is not sufficient:
- `/eligible-for-session` enumerates teams across the whole org. This is accepted in the base spec, line 70.
- A facilitator who knows a team exists (from the hallway, or from a `TeamNameCollisionResponse` on `POST /api/v1/teams`) can see that it is missing from the list and infer that they are in its chain, unless the team is deactivated.

This change does not create that inference. It is inherent to filtering by chain. However, the proposal's Constraints section says the copy "reveals nothing", and #247 should not inherit that claim as settled.
**Change:** in design Risks, add one line saying chain non-revelation is ultimately #247's design problem, covering list filtering, the `POST /draft` refusal body (01c §3 already requires that it not reveal the chain) and existence oracles. This change's copy only avoids making it worse.

### S-3 (Medium, carry-forward to #247): enforcement on the list is not enforcement
The proposal says the #247 filter "can be added to that endpoint [`/eligible-for-session`] later with no UI change". That is true for the UI. For security, though, the list is a convenience and `POST /draft` is the control: the codebase already treats the 409 at submission as the only enforcement point for active sessions, and list filtering is not enforcement. 01c §3 requires `inChain` on draft creation, the standing topic and content endpoints, and the listing.
**Change:** reword the proposal's Constraints bullet so it reads: "#247 adds the chain check to `POST /draft` (enforcement, audited) and to `/eligible-for-session` (presentation), with no UI change." Nobody reading this change should conclude that a filter on the listing alone would be enough.

### S-4 (Low, pre-existing, recorded): deactivated teams are filtered from the picker, but `POST /draft` does not refuse them
`POST /draft` checks team existence with `SELECT id FROM teams WHERE id = $1` and has no `deactivated_at` filter. `routes/topics.ts:171` records this as a stated decision. A facilitator who calls the API directly can still create a draft for a deactivated team. This change does not touch that path. But design Context and proposal Constraints list "and deactivated teams" next to the server controls, which suggests deactivation is enforced.
**Change:** in Context, say that deactivation is filtered from the listing only and is not refused at `POST /draft`, by prior decision. No behaviour change is requested here. If deactivation is meant to be a security boundary rather than housekeeping, it needs its own issue.

### S-5 (Low): task 3.2's precedence test already exists, so cite it rather than add one
`role-map.test.ts` (`resolveGlobalRole` precedence table, the `["Eng-Managers","Retro-Facilitators"] → engineering_manager` row) and `account-resolver.test.ts` (the `[engineering_manager, facilitator] returning` row) already assert the R4 precedence half.
**Change:** none to the design. When implementing task 3.2, cite those two tests by name in 1.1(e)'s comment and in the PR. Do add the new `/auth/session` assertion for `global_role = 'engineering_manager'`: 4.4 covers only `engineer`, so that gap is real.

### S-6 (Low, pre-existing audit gap made easier to reach): role-based 403s on the facilitator path are not audited
This change makes `/sessions/new` reachable in one click and keeps it open after a role revocation (R8). Two denials on that path leave no `audit_log` row:
- `GET /eligible-for-session` 403 (not a facilitator).
- `POST /draft` 403 "Only a facilitator can create a draft session".

By contrast, `POST /api/v1/teams` audits the same kind of denial (`team.creation_denied_role`), and `/draft` audits the membership conflict. An attempt to create a draft after revocation is exactly the sequence an investigator wants to reconstruct. Under the "no server change" scope I accept that this change does not fix it, but it should be recorded as a deferred decision rather than left implicit.
**Change:** add a Risks line, and file a follow-up to audit `session.draft_denied_role`, consistent with `team.creation_denied_role`. Auditing the listing's 403 is optional because it is a read. Note that the 01c record already lists "auditing standing-access refusals" as open design scope.

### S-7 (Informational, correct the risk text): what "stale `canFacilitateSessions`" actually means
The design says a stale flag after IdP revocation lasts "until the next session refresh", and the picker then gets 403. To be precise:
- `/auth/session` and the server checks all read `users.global_role`. That column changes only when the role claim is re-mapped at sign-in (bounded by the 90-minute absolute session lifetime in `auth/middleware.ts`).
- Until the user signs in again, the flag is not stale. The server itself still authorizes them as a facilitator, on every endpoint and not only on this link.
- The 403 in R8 happens only when another sign-in, or a direct DB change, has already updated `global_role` while this tab still holds the old `AuthSession`.

The outcome is still safe, and the server stays authoritative. But the revocation latency comes from the role-sync design (#235/#243), not from this UI.
**Change:** reword the Risks bullet so nobody reads the 403 as proof that revocation is immediate.

### S-8 (Low, process): the D6 direct-database workaround
The `UPDATE sessions SET status = 'abandoned'` workaround skips the state machine and writes no `audit_log` row. I accept it for local fixtures, as scoped. Two guardrails:
- Keep it out of `docs/deployment.md` and any runbook, as the design states. Release notes in the PR description are fine. Mark it "local development only, never against a shared or production database" there too.
- Nobody should run it against a shared environment as an abandon path while follow-up 4 is open. If someone does, that is an unaudited state change to session data.

### S-9 (Requirement for follow-ups 1 and 4): server-side scoping and audit
These are not in scope here, but the proposal sets their shape now:
- **Follow-up 1 (resume).** "Show only the caller's own sessions (`facilitator_id = caller`)" must be enforced in the server query and on the resume and read endpoints, not by filtering a broader list on the client. The role must be re-read live, as every other handler does.
- **Follow-up 4 (abandon).** The new state transition needs the same authorize/transaction/audit shape as `advance` and `complete`: an `audit_log` row in the same transaction, `session.state_changed` emitted after commit, and authorization against `facilitator_id` plus a live role check.

**Change:** copy these two lines into the follow-up issues when filing them (task 4.3).

---

## 3. Threat model impact

| Area | Impact |
|---|---|
| Authentication flow | None. `/auth/callback` landing is unchanged, and R11 plus task 3.1 add a regression guard. No new routes, tokens or redirects. `returnTo` handling is untouched. |
| Authorization / data access boundaries | None on the server. The new UI surfaces read only `AuthSession` (already returned to the user) and `/eligible-for-session` (already authorized). No team data is newly exposed. The Facilitator block contains no data. |
| Ritual constraint (facilitator from another team) | Unchanged and still structural. The server enforces it at `POST /draft` (audited) and in the listing. EMs are excluded by #243 precedence plus `canFacilitateSessions = false`, and the backend tests are confirmed. |
| Audit logging | No new events, consistent with scope. One deferred gap is pre-existing (S-6). |
| Live-session surfaces / WebSocket | None. The design explicitly keeps the block out of `/session/*` and `DraftSessionHost`. |
| Information disclosure | Copy no longer overclaims (B1 fixed). The residual chain-inference risk belongs to #247 (S-2). |

## 4. Deferred or implicit security decisions (make them explicit)

1. **Audit of role-based denials** on `/eligible-for-session` and `POST /draft`: deferred (S-6). File a follow-up.
2. **Deactivated-team refusal at `POST /draft`**: an existing decision, currently implied as enforced (S-4). State it in Context.
3. **Chain non-revelation beyond copy**: deferred to #247 (S-2).
4. **Where the chain is enforced**: must be `POST /draft` and not only the listing (S-3). Reword.
5. **Authorization and audit shape for resume and abandon**: carry into the follow-ups (S-9).
6. **Role revocation latency**: bounded by sign-in and the 90-minute lifetime, not by this UI (S-7). Correct the wording.

None of these block the change. S-2, S-3, S-4, S-6 and S-7 are wording or Risks edits to `design.md` and `proposal.md`. S-5, S-8 and S-9 go into implementation and issue filing.
