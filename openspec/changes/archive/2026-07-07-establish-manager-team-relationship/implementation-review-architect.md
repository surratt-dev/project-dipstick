# Implementation Review — establish-manager-team-relationship
**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Date:** 2026-07-07
**Scope:** Verification of implementation against architectural decisions in design.md

---

## Executive Summary

The implementation is structurally sound. All seven architectural decisions examined are reflected in the code. Boundaries are respected. Patterns are consistent with existing code in `packages/`. Two findings require remediation before Phase 2 ships to production. One open item (Q6 rate limiting) is acknowledged in code but remains unresolved.

---

## Decision-by-Decision Findings

### Decision 2: IdP claim mapping for global_role — CONFORMS, with one finding

All five token validation requirements from Decision 2 are implemented in `packages/backend/src/auth/account-resolver.ts`:

1. **Claim name configuration**: `OIDC_ROLE_CLAIM` is read from the environment (`process.env["OIDC_ROLE_CLAIM"] ?? "role"`). Configurable. ✓
2. **Signed ID token only**: The claim is read from `IdTokenClaims` (the parsed ID token). The comment explicitly states "never from userinfo." ✓
3. **Absent claim behavior**: `mapRoleClaimToGlobalRole` returns `DEFAULT_GLOBAL_ROLE` (`"engineer"`) when the claim is absent or null. ✓
4. **Allowlist validation**: `PERMITTED_GLOBAL_ROLES` Set with three permitted strings; unlisted values return default and log a warning. The warning intentionally omits the raw claim value from the log to prevent audit log injection. ✓
5. **Re-evaluation on each authentication**: `global_role = EXCLUDED.global_role` appears in the upsert `DO UPDATE SET` clause, so every sign-in overwrites the stored role. ✓

**Finding F-1 (Medium — must fix before Phase 2 ships):** `OIDC_ROLE_CLAIM` is read directly via `process.env["OIDC_ROLE_CLAIM"]` in `account-resolver.ts` and is not declared in `config.ts`. The startup validation in `config.ts` will not surface this env var in any operator-visible inventory. A deployment with a typo in `OIDC_ROLE_CLAIM` (e.g., `OIDC_ROLE_CLAIN`) fails silently — the application starts, the claim name falls back to `"role"`, no EM roles are assigned, and the error is only discoverable by tracing sign-in behavior. The fix is to add `OIDC_ROLE_CLAIM` to the optional env vars in `config.ts` and read it from the config object in `account-resolver.ts`, consistent with how every other configurable value is managed.

---

### Decision 3: xmax idempotency — CONFORMS

The TEAM-006 handler in `packages/backend/src/routes/teams.ts` uses the exact SQL idiom from Decision 3:

```sql
INSERT INTO team_memberships (user_id, team_id, role)
VALUES ($1, $2, 'engineering_manager')
ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL
DO UPDATE SET role = 'engineering_manager'
RETURNING id, (xmax = 0) AS is_new_row
```

The code comment explains why `xmax` is used, names the race condition it avoids, and explains what `xmax = 0` means — satisfying the design's requirement that "the next engineer who reads it must understand why it is there." The partial unique constraint `team_memberships_active_unique` is created in migration 7 and is required for the ON CONFLICT target. Test `3.3` in `teams.test.ts` asserts that the upsert SQL contains `"xmax"` and `"where removed_at is null"`. Select-before-insert is not used anywhere in the TEAM-006 flow. ✓

---

### Decision 9: audit_log table, TEAM-005 migration, transactional writes — CONFORMS

Migration 8 (`packages/backend/migrations/8_audit_log.sql`) creates the `audit_log` table with the schema from Decision 9. The migration atomically: creates the table, migrates TEAM-005 records from `role_change_audit`, and drops `role_change_audit` — all in one migration, so there is no window where TEAM-005 writes to a table that no longer exists.

The `AuditEventName` union in `packages/backend/src/auth/audit-logger.ts` includes `"team.manager_established"`. ✓

TEAM-005's audit write in `teams.ts` targets `audit_log` with `operation = 'team.role_changed'` and stores `from_role` / `to_role` in the `metadata` JSONB column. Test `4.4` in `teams.test.ts` is updated to assert: the INSERT targets `audit_log` (not `role_change_audit`), the correct positional parameters for `actor_user_id`, `actor_global_role`, `operation`, `target_user_id`, `team_id`, and the JSONB `metadata`. ✓

TEAM-006's audit write is inside the same `BEGIN` / `COMMIT` block as the `team_memberships` upsert. Test `3.6` verifies rollback atomicity: when the audit INSERT throws, the transaction rolls back and the endpoint returns 500. ✓

---

### Decision 10: canAssociateManagers flag — CONFORMS

`TeamMembersResponse` in `packages/shared/src/types/team.ts` has `canAssociateManagers: boolean`. The TEAM-003 handler sets it as `actorGlobalRole === "application_admin"`. The flag is computed server-side per request from the database, consistent with the existing `canAssignRoles` pattern. `canAssignRoles` remains broader (Application Admin or EM with team-scoped membership); `canAssociateManagers` is admin-only. They are separate fields. Tests verify `true` for admin callers and `false` for engineer and EM members. ✓

---

### Decision 11: Phase 3 endpoints are net-new — CONFORMS

`packages/backend/src/routes/em-views.ts` is a new route module. All six endpoints (SESSION-007, SESSION-008, TREND-001, TREND-002, ACTION-004, ACTION-005) are implemented as independent handlers. The module header comment explicitly states: "These are NET-NEW route handlers (Decision 11). They are not authorization unlocks on existing routes." The EM serialization paths are purpose-built — EM queries never `SELECT voter_id` from the votes table, and aggregation happens in SQL (`COUNT(*)`, `AVG(v.vote_value)`, `BOOL_OR(v.is_outlier)`).

Audit records are written on every data-returning response. TREND-001 and TREND-002 write a single audit record with date range rather than one record per session returned, consistent with Decision 11's log-volume guidance. The `em-views.test.ts` test suite asserts that 403 responses do not produce audit records. ✓

---

### Decision 12: TeamMembersResponse split arrays — CONFORMS

`TeamMembersResponse` in `packages/shared/src/types/team.ts` has `{ participants: TeamMember[]; engineeringManagers: TeamMember[]; canAssignRoles: boolean; canAssociateManagers: boolean }`. The original flat-array shape is preserved as `LegacyTeamMembersResponse` (marked `@deprecated`) for backward compatibility. The TEAM-003 handler (`GET /api/v1/teams/:teamId`) segments members in application code after the single-query fetch, uses a loop with explicit role branching (not a client-side filter), and the split is enforced by TypeScript type boundaries. The code comment in the handler explains why this phase ordering matters and what the visible UX defect would be if the change shipped after TEAM-006. Tests assert: no `members` field in the response body, correct placement of EM rows in `engineeringManagers`, correct placement of participant rows in `participants`, and that an EM never appears in both arrays. ✓

---

### Decision 14: Dual authorization checks NOT consolidated — CONFORMS

`checkEmAuthorization` in `em-views.ts` performs a single JOIN query to retrieve both `u.global_role` and `tm.role AS membership_role`, then evaluates them as two separate, sequential conditionals in application code:

```typescript
// Check 1: global role guard
if (global_role !== "engineering_manager") {
  return { authorized: false, reason: "not_engineering_manager_global_role" };
}
// Check 2: team-scoped association guard
if (membership_role !== "engineering_manager") {
  return { authorized: false, reason: "not_associated_with_team" };
}
```

They are not collapsed into a single `WHERE` clause. Each produces a distinct failure reason. The module header comment explains why both exist and why consolidating them would create a single point of failure. Test `5.10` in `em-views.test.ts` verifies that an EM with the correct global role but no team association is rejected. ✓

---

### Phase ordering: TEAM-003 and TeamMembersResponse in Phase 2 — CONFORMS

TEAM-003 (`GET /api/v1/teams/:teamId`) is implemented in `teams.ts` alongside TEAM-006. The `TeamMembersResponse` type change is in `packages/shared/src/types/team.ts`. The TEAM-003 route handler includes an explicit comment noting that the Phase 2 ordering prevents the situation where an EM row created by TEAM-006 appears in the wrong array before the type boundary is in place. Both changes are in the same commit boundary. ✓

---

## Findings Requiring Action

### F-1: OIDC_ROLE_CLAIM not declared in config.ts (Medium — must fix before Phase 2 ships)

**File:** `packages/backend/src/auth/account-resolver.ts`
**Issue:** `OIDC_ROLE_CLAIM` is consumed directly from `process.env` rather than through the validated config object. The startup config check in `config.ts` does not cover this variable. A misconfigured deployment fails silently with no log warning at startup — the first indication of a problem is that EMs can't be assigned via IdP role claims.
**Required fix:** Declare `OIDC_ROLE_CLAIM` as an optional env var in `config.ts`. Read it from the config object in `account-resolver.ts`. This is consistent with how `TOKEN_ENCRYPTION_KEY` and `APP_ORIGIN` are handled as optional keys.

### F-2: Hardcoded actor_global_role in EM access audit writes (Low — should fix before Phase 3 ships)

**File:** `packages/backend/src/routes/em-views.ts`
**Issue:** All six EM endpoint audit log INSERTs hardcode the string `"engineering_manager"` for `actor_global_role` rather than reading it from the database. The TEAM-005 and TEAM-006 handlers read `actorGlobalRole` from the DB and pass it as a parameter. The hardcoding works in practice because `checkEmAuthorization` has already verified global_role before the audit INSERT is reached, but it creates an inconsistency in the audit trail: a future code change that modifies the auth check could leave the audit log recording a role that no longer matches what the database holds.
**Required fix:** Read `actor_global_role` from the database in `checkEmAuthorization` (it already retrieves `global_role`) and return it alongside `authorized` and `reason`. Pass it to the audit INSERT.

---

## Open Item: Q6 Rate Limiting on TEAM-006

Decision Q6 (Required before Phase 2) specifies that rate limiting on TEAM-006 is a required compensating control before Phase 2 ships. The TEAM-006 handler has a code comment referencing Q6 and noting that the threshold decision is owned by the BA and security analyst. No rate limiting is implemented. This must be resolved — the comment correctly defers the threshold decision to the business owners, but the implementation hook must be in place before Phase 2 reaches production. This is not a code finding in this review; it is a process gate. The BA and security analyst must close Q6 in writing before the Phase 2 deployment gate.

---

## Observations on Boundary Compliance

**Authentication abstraction:** The claim mapping in `account-resolver.ts` does not reference any Entra-specific claim names. The claim name is configurable. The abstraction holds.

**Server-side authorization enforcement:** All authorization checks read from the database per request. No access control state is read from Redis or the session store. This is consistent with the Redis-prohibition pattern already established in TEAM-005.

**Vote attribution boundary:** The SQL queries in `em-views.ts` do not select `voter_id` or any column from the votes table that can be cross-referenced to identify a voter. Aggregation is done in SQL (`GROUP BY vote_value`, `COUNT(*)`, `AVG`, `BOOL_OR`). The response types expose `voteDistribution: VoteDistributionBucket[]` with fields `voteValue`, `count`, and `containsOutlier`. The presence of `facilitatorName` on session entries is not a boundary violation — facilitators are not voters in the Health Check ritual. The attribution boundary tests in `em-views.test.ts` run at the route handler level and assert specific prohibited field names; they will catch regressions in CI.

**Rollback script:** `packages/backend/migrations/8_rollback.sql` exists, consistent with the Phase 2 rollback requirement in design.md.

---

## Sign-off Condition

The implementation satisfies the architectural decisions. Two findings must be remediated. F-1 must close before Phase 2 ships to production. F-2 must close before Phase 3 ships. Q6 is a process gate requiring business owner sign-off, not a code change.

The security analyst's pre-deployment verification requirements remain in effect as stated in design.md: atomicity test (rollback produces neither `team_memberships` row nor audit record), attribution boundary test with real session data (not fixture data), dual authorization check verification, WebSocket exclusion verification, and interim removal procedure review.
