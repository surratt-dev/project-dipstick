# Implementation Review — Architectural Conformance
**Change:** assign-role-to-team-member
**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Date:** 2026-07-06
**Files reviewed:** `packages/backend/src/app.ts`, `packages/backend/src/routes/teams.ts`, `packages/backend/src/routes/sessions.ts`, `packages/backend/migrations/6_role_change_audit.sql`, `packages/frontend/src/components/MemberManagement.tsx`, `packages/frontend/src/pages/TeamPage.tsx`, `packages/shared/src/types/team.ts`, `packages/shared/src/types/auth.ts`

---

## Summary

The implementation is largely consistent with the architectural decisions in `design.md`. The authorization model, caching prohibition, audit trail, vocabulary mapping, and server-side `canAssignRoles` flag are all correctly implemented. One structural deficiency — the transaction locking mechanism for the zero-participant guard — does not meet the requirement stated in Decision 5. Two lower-severity findings are also noted.

---

## Decision-by-Decision Assessment

### Decision 0 — CORS `PATCH` method
**Status: PASS**

`packages/backend/src/app.ts` line 54: `methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]`. `PATCH` is present. The browser pre-flight will include `PATCH` in `Access-Control-Allow-Methods`.

---

### Decision 1 — `team_memberships.membership_role` only, no `global_role` writes
**Status: PASS**

The PATCH handler in `teams.ts` writes only to `team_memberships` via `UPDATE team_memberships SET role = $1`. There is no write to `users.global_role` anywhere in the handler. TEAM-006 is not called. The audit migration operates only on the new `role_change_audit` table. The layer separation is maintained.

---

### Decision 2 — Session-participation prerequisite shipped before role assignment
**Status: PASS**

`packages/backend/src/routes/sessions.ts` implements both `POST /api/v1/sessions/:sessionId/participants` and `POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in` with dual-field enforcement. Both endpoints query `users.global_role` AND `team_memberships.role` directly from the database on each request, then reject if either field is `engineering_manager`. The prerequisite ordering is satisfied in the codebase as it stands.

---

### Decision 3 — Authorization: Option A (Application Admin and active EM only)
**Status: PASS with a noted gap**

The `checkAssignRolesAuthorization` helper in `teams.ts` performs a per-team, per-request database query. It correctly authorizes only:
- `users.global_role = 'application_admin'` (any team), and
- `users.global_role = 'engineering_manager'` with `team_memberships.role = 'engineering_manager'` and `removed_at IS NULL` for the specific `teamId` from the request URL.

Facilitators are not in either branch and will receive a 403. The `teamId` comes from the URL path; the query verifies it against the database before granting access. An EM on Team A calling the endpoint for Team B will be rejected at the `membership_role === "engineering_manager"` condition because the LEFT JOIN will return NULL for that team. This is correct.

CSRF protection is intact: `sameSite: "strict"` is present in the session cookie configuration in `app.ts` (line 82). The endpoint accepts credentials via the session cookie only — no query string credential path is introduced.

**Gap (Decision 3 escalation UX requirement):** The decision states "Minimum acceptable: plain-language explanation." The minimum is met — `MemberManagement.tsx` renders a visible, non-dismissible banner when `canAssignRoles` is false. The preferred implementation — surfacing the admin contact or an in-app request path — is not present. Decision 3 calls this out as a required deliverable under Option A, not a stretch goal. The minimum is met; the preferred path is absent. This is not a blocker, but the VP Engineering's basis for accepting Option A was that the escalation path would be built in. If facilitators still hit a dead end in practice (no admin contact surfaced), the adoption risk that Decision 3 named will materialize.

---

### Decision 4 — No caching of `membership_role`
**Status: PASS**

All three authorization check sites — `checkAssignRolesAuthorization` (called on every PATCH and every GET /members), the participants endpoint, and the lock-in endpoint — issue a fresh database query on each invocation. There is no Redis read or write for `membership_role` anywhere in the routes. Code comments explicitly state the Redis prohibition at the point of implementation. `AuthSession.user` (in `packages/shared/src/types/auth.ts`) exposes only `{ id, displayName, email }` — `global_role` is not in the session cookie, so the frontend cannot compute authorization from stale session data.

The lock-in endpoint re-reads `membership_role` at each lock-in attempt independently of any role check performed at connection establishment time. A user promoted to EM after opening a session will be rejected at their next lock-in attempt.

---

### Decision 5 — Two-step zero-participant flow
**Status: FAIL — LOCKING MECHANISM INSUFFICIENT**

**The correct flow is implemented:** The first PATCH (no `confirmedZeroParticipant`) applies the UPDATE inside a transaction, checks the post-update participant count, and — if the count is zero and confirmation is absent — issues `ROLLBACK` before returning `422 { requiresConfirmation: true }`. The change is not committed to the database when the 422 is returned. The frontend correctly catches the 422, transitions to `awaiting_confirmation` state, and re-submits with `confirmedZeroParticipant: true` on the second call. The warning message text matches the design exactly.

**The locking mechanism does not meet the requirement in Decision 5:**

Design.md states: "The count must be evaluated on the post-update state within the transaction — using a CTE or `SELECT FOR UPDATE` to hold the lock — not as a separate pre-flight query outside it. This prevents a race condition where two concurrent role changes by different authorized actors both pass an independent check and together produce a zero-participant state without either 422 firing."

The implementation uses:
```sql
UPDATE team_memberships SET role = $1 WHERE user_id = $2 AND team_id = $3 AND removed_at IS NULL;
-- followed by:
SELECT COUNT(*) FROM team_memberships WHERE team_id = $1 AND removed_at IS NULL AND role = 'participant';
```

An `UPDATE` acquires a row-level lock only on the rows it modifies — the specific membership row for `user_id = $2`. It does not acquire any lock on other membership rows for the same team. Under PostgreSQL READ COMMITTED isolation (the default), the post-update `SELECT COUNT(*)` will see the current transaction's own update but will not see uncommitted updates from concurrent transactions.

The race is concrete: if a team has exactly two participants and two authorized actors simultaneously promote each one to EM, both transactions will execute the UPDATE, then each will read a count of 1 (each sees its own update but not the other's uncommitted update). Both will pass the guard and commit. The result is zero participants with neither transaction returning 422.

The design's specification — a CTE or `SELECT FOR UPDATE` — would prevent this by serializing access to the team's membership rows at the transaction level. A `SELECT ... FOR UPDATE` on all active membership rows for the team before the UPDATE would cause T2 to block until T1 commits or rolls back, at which point T2 would read T1's committed update and the count check would reflect the true post-T1 state.

This is a required correction before this change ships. A two-person team where an admin simultaneously promotes both members will produce a broken state with no user-visible warning. The scenario is unusual but not implausible; it is exactly the scenario the design named and required protection against.

**Required fix:** Before the `UPDATE` in the transaction, add:
```sql
SELECT id FROM team_memberships WHERE team_id = $1 AND removed_at IS NULL FOR UPDATE;
```
This serializes concurrent modifications to the same team's membership, ensuring that the post-update count check reflects the fully committed state of all concurrent transactions.

---

### Decision 6 — Task Group 6 absent (WebSocket real-time update deferred)
**Status: PASS**

There is no WebSocket infrastructure in the codebase. No event bus, connection pool, or broadcast mechanism was introduced. The deferral to the WebSocket infrastructure change is correctly reflected in the implementation.

---

### Decision 7 — Audit log in same transaction
**Status: PASS**

Migration `6_role_change_audit.sql` creates the `role_change_audit` table with all required fields: `actor_user_id`, `actor_global_role` (stored as `text NOT NULL` for audit durability — not a FK to the enum), `actor_ip`, `subject_user_id`, `team_id`, `from_role`, `to_role`, `changed_at`. The `actor_global_role` text storage is correct — it makes the audit record stable against future enum extension.

The `INSERT INTO role_change_audit` is inside the same `BEGIN`/`COMMIT` block as the `UPDATE team_memberships`. If the INSERT fails, the outer `catch` block issues `ROLLBACK`, and the role change does not commit. A role change without an audit record is not possible through normal application paths.

The structured-log counterpart (`emitAuditEvent` with `team.role_changed`) is called after the transaction commits, which is correct — it is explicitly described as the operational alert path, not the authoritative record. The authoritative record is the database row.

Four indexes on the audit table (`team_id`, `actor_user_id`, `subject_user_id`, `changed_at`) support the post-incident query patterns described in Decision 7.

The no-op path (where `fromRole === newRole`) returns early before the transaction. No audit entry is written for a no-op. This is correct — there is no role change to record.

---

### Decision 8 — Vocabulary mapping: UI labels vs. database values
**Status: PASS with a pre-existing violation in TeamPage.tsx**

`MemberManagement.tsx` defines `ROLE_LABELS` and `ROLE_DESCRIPTIONS` that exactly match the design:

| DB value | UI label | Description |
|---|---|---|
| `participant` | Engineer | participates in session voting |
| `engineering_manager` | Engineering Manager | can view session history; will not vote |

The role selector contains exactly two options (`participant` and `engineering_manager`). `facilitator` does not appear. Labels render correctly through `ROLE_LABELS[member.role]`.

**Pre-existing violation in `TeamPage.tsx`:** The existing `session.teamMemberships.map` at lines 80–84 renders `m.role` directly:
```tsx
{m.teamName} ({m.role})
```
This displays `participant` and `engineering_manager` as visible text to the user, which violates Decision 8. This list predates this change and was not introduced by it, but since Decision 8 is now an established requirement in this codebase, it applies to all role-displaying surfaces. This should be corrected.

---

### Decision 9 — `canAssignRoles` server-side flag
**Status: PASS**

`TeamMembersResponse` in `packages/shared/src/types/team.ts` includes `canAssignRoles: boolean` with a comment explicitly documenting that it is evaluated server-side per request. The GET handler calls `checkAssignRolesAuthorization` on every request to populate this field — the same helper used by the PATCH handler, ensuring the two are always consistent.

`AuthSession.user` contains only `{ id, displayName, email }`. `globalRole` was not added. The frontend cannot infer authorization from the session object; it reacts to the server's `canAssignRoles` result. `MemberManagement.tsx` reads `canAssignRoles` from `data` (the server response), not from `useAuth()`. The access control principle that authorization is enforced at the API layer is correctly maintained.

---

## Findings Summary

| # | Severity | Decision | Finding |
|---|---|---|---|
| 1 | **Medium** | Decision 5 | Transaction locking insufficient — does not use `SELECT FOR UPDATE` or CTE to serialize concurrent role changes for the same team. The zero-participant race described in the design is not prevented. |
| 2 | Low | Decision 8 | `TeamPage.tsx` renders raw `m.role` enum values in the pre-existing team membership list, exposing `participant` / `engineering_manager` as user-visible text. |
| 3 | Low | Decision 3 | Escalation message meets the minimum spec but not the preferred spec. Admin contact and in-app request path are absent. The VP Engineering's Option A acceptance was conditioned on the escalation path being built in. |

---

## Required Actions Before Ship

**Finding 1 must be resolved.** The fix is a single additional query before the UPDATE in the transaction. It is a one-line addition with no other behavioral changes required:

```typescript
// Serialize concurrent modifications to this team's membership rows
await client.query(
  `SELECT id FROM team_memberships WHERE team_id = $1 AND removed_at IS NULL FOR UPDATE`,
  [teamId],
);
```

This must be added before the `UPDATE team_memberships SET role = $1 ...` statement in the transaction block.

**Finding 2** should be resolved in this change since Decision 8 now governs all role-displaying surfaces. The fix is a ROLE_LABELS mapping in `TeamPage.tsx` identical to what exists in `MemberManagement.tsx`.

**Finding 3** does not block ship but is tracked as a follow-on with a named owner and a stakeholder condition attached. Finding 3 has been documented as a tracked risk in `MemberManagement.tsx` at the escalation message render site. The plain-language explanation is present (minimum spec met). The in-app admin contact surface and request path (preferred spec) are not yet implemented. Rachel Okonkwo's Option A sign-off was conditioned on the escalation path being built in — this is a required deliverable, not a stretch goal, and must not be deferred indefinitely. Owner: Marcus Oyelaran.

---

## Architectural Boundaries — General Assessment

The implementation respects the boundaries I care most about in this system:

- **Authorization is enforced at the API layer, not the UI layer.** The `canAssignRoles` pattern is the right model — the frontend reacts to an authorization result, it does not compute one. This should be the template for any future endpoint that requires a frontend visibility decision.
- **Redis is used only for session storage.** Role data does not touch Redis. The prohibition is documented at the implementation site.
- **The audit trail is transactionally coupled to the state change.** Out-of-transaction audit writes are a common shortcut that creates a silent failure mode. The implementation avoids it.
- **The two-role-system distinction is maintained.** Nothing in this change conflates `users.global_role` and `team_memberships.role`. The comment block at the top of `teams.ts` and the shared type definitions reinforce this separation.

The one structural gap — Finding 1 — is a correctness issue on an explicit requirement in the design, not a pattern violation. It is fixable in place without architectural changes.
