# Architecture Review — session-creation-existing-team

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Implementation vs. `design.md` (Decisions D1–D6). Reviewed against my standing concerns: authentication delegation is out of scope here (no OIDC surface touched); real-time state authority (not applicable — no WebSocket state introduced); server-side access control; ephemeral/persistent boundary (not applicable — no Redis involvement); observability via audit trail.

**Verdict: APPROVE.** The implementation matches the design's stated decisions closely, including the parts of the design that were themselves responses to prior review (D1's ordering, D3's transaction/self-guard, D6's real route). I have one non-blocking observation on the audit event set and one note for the record on the `joinToken` addition. Nothing here blocks merge.

---

## 1. Migration guard (D3) — `10_sessions_team_active_unique.sql`

Matches design exactly: the `DO $$ ... RAISE EXCEPTION` guard runs before `CREATE UNIQUE INDEX`, checking the same five non-terminal statuses the index itself filters on. Two things I specifically checked:

- **The guard actually works as a guard, not a comment.** `RAISE EXCEPTION` inside a `DO $$` block aborts the enclosing transaction. `node-pg-migrate` wraps each `.sql` file in its own transaction by default, and this migration takes no `CONCURRENTLY` (which would force `node-pg-migrate` to disable that wrapping) — so the default holds and a violation fails the whole migration file, `CREATE UNIQUE INDEX` included. This is the right mechanism, not just documentation of intent.
- **Status list matches D1/D3 exactly**, including the explicit written rationale for excluding `abandoned` (unreachable today, but a future auto-abandon feature must reconsider this index deliberately). Good — this is exactly the kind of implicit-decision-made-explicit I look for, sitting in the file that will still be read the day someone adds that feature.

The manual-verification narrative in the migration's header comment (drop the index, insert two duplicate rows in a rolled-back transaction, re-run the guard, confirm it raises) is a reasonable substitute given the codebase has no existing precedent for automated migration tests, and it's honest about that being the reason rather than presenting it as sufficient.

## 2. `POST /draft` check order (D1)

The implementation's four-step order in `facilitator-sessions.ts:200–289` matches D1 verbatim: no-row → 401, `global_role !== 'facilitator'` → 403 (identity-only, doesn't touch `:teamId`), team existence → 404, `is_member` → 403 (audited). The combined query is exactly the LEFT JOIN shape D1 specifies, and I confirmed it against the actual precedent it claims: `team.role_change_denied` (`teams.ts:821–845`) uses the same "write audit row synchronously before the 403, then `emitAuditEvent`" shape, and `checkAssignRolesAuthorization`'s baseline 403 is genuinely unaudited elsewhere in this codebase — so D1's "Declined" reasoning for not auditing step 2 holds up against the actual code, not just the design's characterization of it.

One thing worth naming for the record rather than flagging as a defect: step 2's "not a facilitator" 403 and step 4's "member of this team" 403 are randomly-orderable relative to each other only in the sense that both are checked from the same single query result — there's no second round-trip and no TOCTOU gap between them. Good.

Test 2.8 (nonexistent team + no membership row → 404, not 403, `mockDbQuery` called exactly twice) is the correct proof that the ordering is real, not just documented — a naive reviewer could believe steps 3/4 were reordered without a test asserting the call count.

## 3. Audit logging (D1)

Both events fire with the right shape:

- `session.draft_denied_membership_conflict` — synchronous plain `INSERT`, no transaction (correct, since D1 explicitly notes there's no paired state change), fields `actor_user_id, actor_global_role, actor_ip, operation, team_id` — no `metadata`. Compared against `team.role_change_denied`'s payload (`actor_user_id, actor_global_role, actor_ip, operation, target_user_id, team_id, metadata`), the only difference is the absence of `target_user_id` and `metadata`, both nullable columns per the `audit_log` schema (migration 8) and both legitimately inapplicable here — this event has no target user and no operation-specific fields worth recording. Not a deviation, a correct simplification.
- `session.draft_created` — written inside the same transaction as `INSERT INTO sessions`, with `metadata: { session_id }`, matching `team.manager_established`'s "audited in the same transaction as the row it authorizes" precedent as claimed. Test 2.16 (via the mock's call-order assertions on `client.query.mock.calls`) verifies the ordering is `BEGIN → INSERT sessions → INSERT audit_log → COMMIT` on the *same client* — this is the right level of proof for "same transaction" in a mocked unit test; real atomicity is a Postgres guarantee this test correctly doesn't try to reprove.

The `emitAuditEvent` structured-log call happens after `COMMIT` in both success and denial paths, matching the "DB row authoritative, log is the alerting path" split stated in D1 and used elsewhere in this file (e.g., the `/reveal` and `/advance` handlers).

## 4. `canFacilitateSessions` — live computation, no `global_role` leak

`auth.ts`'s `/auth/session` handler now selects `global_role` from `users` and computes `canFacilitateSessions: user.global_role === "facilitator"` inline, live, every call — never touching the Redis-backed `SessionData`. I grepped the frontend tree for `globalRole`/`global_role` and found zero references outside this backend computation — the raw role never crosses the API boundary. `AuthSession.canFacilitateSessions` is additive at the top level, not nested under `user`, matching D4's stated shape distinction.

D4's own text is careful to correct the exploration notes' claim that `canAssignRoles` lives on `AuthSession` today (it doesn't — it's per-team, on `GET /members`/`GET /:teamId`). The implementation is honest about this too: it doesn't retrofit a fake `canAssignRoles`-on-`AuthSession` precedent, it just follows the stated principle. This is the kind of thing that erodes quietly if nobody checks it, so I'm glad it's called out explicitly in the design rather than asserted.

## 5. Eligible-teams query (D2)

Implementation matches: `teams LEFT JOIN team_memberships ... WHERE tm.id IS NULL AND deactivated_at IS NULL`, `lastSessionAt` as `MAX(completed_at)` scoped to `status = 'complete'`, `callerHasTeamMemberships` computed as a separate independent query rather than derived from `eligibleTeams`'s emptiness (correct — they answer different questions, and design explicitly calls this out). The 403-vs-200 gate re-reads `global_role` fresh rather than trusting `canFacilitateSessions`, exactly as D2 requires, and test 3.11 (a role downgrade between calls is reflected on the very next call) is the right proof of that live-read discipline.

The deliberate non-filtering of teams with a live session out of `eligibleTeams` (D2's Resolved decision) is implemented as designed and covered by test 3.12. I'd note this is a real, intentional UX rough edge — a facilitator can select a team that's about to 409 — but it's a documented, reviewed trade-off with a single, correctly-placed enforcement point, not an oversight. Nothing for me to flag here; this is squarely a product/UX call, not an architectural one.

## 6. D6 — draft control view route

This is the item I looked at most carefully, since it was the one point of the design that engineering review said it would block on. The route (`/team/:teamId/session/:sessionId`) is real, registered in `App.tsx`, and `DraftSessionHost` unconditionally fetches `GET .../facilitator-state` on mount regardless of entry path — create-flow navigation, refresh, direct hit, or the 409 resume affordance. I traced all four paths:

- **Create flow →** `SessionCreationPage.confirmCreate` navigates with `state: { teamName, lastSessionAt }` after a 201.
- **409 resume →** the confirm screen's error branch navigates to the *existing* session's id/status straight from `SessionAlreadyExistsResponse`, with the same state shape.
- **Refresh / direct hit →** no router state present; `DraftSessionHost` falls back to `Team ${teamId}` and "No completed sessions on record," which is an honest degradation, not a broken state.

In every case the component renders off `facilitator-state`'s `currentSessionState`, not off the navigation state — router state is display-hint-only (team name, last-session date), never authorization-bearing or state-determining. That's the right boundary: a stale or spoofed `location.state` can at worst show the wrong team name for a moment before the fetch resolves; it cannot show the wrong control view. This resolves the refresh-safety problem D6 was written to close, and does so without a second backend endpoint or a duplicated authorization path, which is what I'd have pushed back on if it existed.

Also confirmed: no client-side facilitator-only gate is added on this route beyond `ProtectedRoute`'s session-presence check — task 7.12 exists specifically to prove `facilitator-state`'s existing server-side `facilitator_id === caller` check is what's actually doing the work here, not a UI-layer assumption. That's precisely the failure mode ("authorization enforced in the UI but not independently in the API, or worse, assumed present when it's actually just absent") I look for, and it's closed correctly — the *server* endpoint was already gated before this change; this change's contribution is exposing a route that reuses that server gate rather than trusting a client check as the goal to prove.

## 7. `joinToken` on `FacilitatorSessionStateResponse` — judgment call assessment

This field is additive, was not in `tasks.md` verbatim, and I looked at it specifically for scope drift. My assessment: **reasonable, in-bounds, correctly scoped.**

- It's a plain passthrough of `sessions.join_token`, a column that already exists and is already returned by `POST /draft`'s 201 response (`facilitator-sessions.ts:378`). No new data is exposed that a facilitator couldn't already see from the creation response — this just makes it available on refresh/rehydration too, which D6 explicitly requires the control view to support ("join link, visibly marked not-yet-joinable" is *in* D6's scope, task 7.3).
- Without it, `DraftSessionHost` would have no way to render the join link after a refresh — which is exactly the gap D6 was written to close. Not adding it would have left D6 half-implemented on the one entry path (refresh) that was the entire reason for building a real route in the first place.
- It's on the response for every session status, not just `draft`, which the type's own doc comment justifies (one shared fetch backs both the draft and live views). That's a defensible simplification, not scope creep — the alternative (conditionally including it) would require the type to encode a status-dependent shape for no security benefit, since a join token isn't sensitive on its own (redemption, if it ever exists, is a separate authorization event).

I'd call this the kind of judgment call I want an engineer making without a design amendment: it's additive, backward-compatible, serves a goal already in scope, and doesn't touch an authorization boundary. No action needed.

## 8. Minor observations (non-blocking)

- **Frontend inline styles.** `DraftSessionHost` and `SessionCreationPage` use inline `style={}` objects throughout rather than whatever the project's existing styling convention is. I didn't check what that convention is elsewhere in `packages/frontend` — this is a code-consistency note for whoever does frontend review, not an architectural concern, and explicitly out of my scope per my own remit (UX is not mine to review).
- **`SessionCreationPage`'s generic-failure branch reuses `kind: "membership_conflict"`** for the "something went wrong" and network-error cases (lines 123–133), rather than a third `ConfirmError` variant. Functionally fine — the rendered copy is generic and correct for those cases — but the type name is now slightly misleading for two of its three use sites. Cosmetic; not something I'd hold up a merge for.
- **Rate limiting remains an accepted follow-on** (per design's own Trade-offs section) — I have no new concern here beyond what's already documented; the actor population (internal, low-volume, already role-gated) is consistent with the risk profile in TEAM-006's precedent that design.md cites.

## Summary against my review criteria

| Criterion | Status |
|---|---|
| Boundaries respected (no new backend endpoint invented where an existing one already carried the needed data/auth) | Yes — D6 confirmed |
| Server-side enforcement, not UI-assumed | Yes — task 7.12 proves it; D1/D2's live-reads confirmed by test 3.11 |
| No raw role exposed to client | Yes — confirmed by grep, zero `globalRole` references in frontend |
| Audit trail closes the stated blind spot | Yes — both events present, transactional properties correct, payload shape consistent with the cited precedent |
| Concurrency race closed at the right layer (DB, not app) | Yes — partial unique index + self-enforcing migration guard, not check-then-insert |
| Engineer's out-of-spec addition reviewed for drift | Reviewed — `joinToken` is in-bounds |

No blocking findings. This is a well-scoped, cleanly-bounded change that closes a real, previously-invisible enforcement gap and does so consistently with the codebase's existing authorization and audit conventions rather than inventing new ones.
