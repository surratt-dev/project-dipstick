# Design Review: Enforce Access Control on Team Content
**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Date:** 2026-07-07
**Document under review:** design.md + proposal.md + tasks.md

---

## Summary Verdict

The design is implementable. The security model is correct and the high-level structure — a shared authorization helper returning a typed grant, a separate serializer layer enforcing role-specific response shapes, delivery-time WebSocket checks — is exactly the right architecture. I have six findings that need resolution before implementation starts. Two are bugs in the design document itself that will produce runtime failures. The rest are implementation gaps or ambiguities that will cause the implementer to stop and re-derive intent mid-task.

None of these are scope problems. I am not recommending changes to what is being built. I am identifying things that are unclear or wrong in how it is described.

---

## Finding 1 — Bug: `'completed'` vs `'complete'` in the facilitator SQL check

**Location:** Decision 3 SQL check, Task 2.4

The design's facilitator authorization SQL (Decision 3) reads:

```sql
sessions.status = 'completed'
AND sessions.facilitator_access_expires_at > NOW()
```

The actual PostgreSQL enum value in `1_create_enums.sql` and used throughout the codebase is `'complete'`, not `'completed'`. Every existing query in `em-views.ts` uses `status = 'complete'`. The authorization helper as specified in Task 2.4 will execute a SQL check that silently never matches any row for the grace window path, because no `session_status` enum value `'completed'` exists.

**Resolution required before Group 2 begins:** Correct the SQL in Decision 3 and Task 2.4 to use `'complete'`.

---

## Finding 2 — Bug: Admin grant context-dependence breaks the helper contract

**Location:** Decision 8, Tasks 3.1 and 3.2

The design specifies that Application Admins get `null` (no grant) for session content endpoints and `{ path: 'admin' }` for administrative data endpoints. But the authorization helper is defined as `evaluateTeamAccess(userId, teamId)` — it receives no information about which kind of endpoint is calling it.

The helper cannot determine whether to return `null` or `{ path: 'admin' }` from user and team identifiers alone. The distinction is endpoint-type-specific, not user-specific.

This means one of the following is true:
1. The helper needs a second parameter identifying the endpoint type (e.g., `evaluateTeamAccess(userId, teamId, { endpointType: 'content' | 'admin' })`), or
2. There are two distinct helpers (one for content endpoints, one for admin data), or
3. The `{ path: 'admin' }` grant is only returned from a separate admin-specific path, and the general `evaluateTeamAccess` always returns `null` for admins — and the admin route handlers call a different guard function.

Option 3 is the cleanest, and it matches how the existing code works: `teams.ts` does its admin check inline and independently of any shared helper. The tasks should reflect this explicitly rather than mixing the admin grant into the same helper contract. Right now, Tasks 3.1 and 3.2 conflict with Tasks 2.1–2.5 in a way that will leave the implementer stalled.

**Resolution required before Group 2 begins:** Clarify whether `evaluateTeamAccess` handles the admin case or whether admin access uses a separate guard. The shared `TeamAccessGrant` type should include `{ path: 'admin' }` if and only if the helper returns it.

---

## Finding 3 — Implementation gap: The serializer cannot use a single shared dataset

**Location:** Tasks 6.1–6.6

The serializer design assumes a single `rawData: SessionHistoryData` parameter is passed to `serializeSessionHistory(grant, rawData)` and the serializer produces different shapes from it. This will not work correctly for the Engineer path.

The Engineer path requires each engineer's own individual vote per topic. To identify "own vote," the query must return `voter_id` alongside `vote_value` so the serializer can filter to the caller's row. But the EM path must never query `voter_id` — the attribution boundary is enforced at the query layer, not the application layer. This is explicit and correct in the existing `em-views.ts` (every query comment calls out "CRITICAL: Never SELECT voter_id from votes").

A single raw dataset cannot satisfy both requirements: if you query `voter_id` for the Engineer, you have it in memory and could accidentally serialize it for an EM path if the serializer has a bug. If you omit `voter_id` to protect the EM path, the Engineer path cannot identify own votes.

The correct implementation is:
- The authorization helper evaluates the grant (as designed).
- The route handler executes a role-qualified database query based on the grant path. The query for a `member/participant` grant selects `voter_id` filtered to the caller. The query for a `member/engineering_manager` grant never selects `voter_id`.
- The serializer transforms the role-specific query result into the response shape.

The serializer module is still the right design — it enforces the response contract from a typed input. But the `rawData` type must be different per path (one with voter identity, one without). Task 6.1's function signature needs to reflect this, or the "raw data" abstraction must be reconceived.

**Resolution required before Group 6 begins:** Either define distinct raw data types per grant path, or restructure the serializer as a set of path-specific functions that each receive the query result appropriate to that path.

---

## Finding 4 — Ordering problem: Group 4 has a dependency on Group 6

**Location:** Tasks 4.1–4.9 vs. Tasks 6.1–6.7

Task 4.1 says: "verify that callers with no grant receive 403, callers with a grant receive role-appropriate data." The "role-appropriate data" part requires the serializer contracts from Group 6, which is listed after Group 4.

In practice, Group 4 can only be partially implemented without Group 6: the 403 behavior can be wired up, but the content response shape cannot be verified. If the tasks are executed in order, the implementer will either need to revisit Group 4 items after Group 6 (breaking the sequential model) or implement partial stubs that are not verifiable.

The existing route handlers in `em-views.ts` demonstrate the complete pattern: authorization check + data query + serialization all in one handler. The split into Group 4 (authorization wiring) and Group 6 (serializer contracts) is correct as a design separation, but the implementation dependency runs from Group 6 to Group 4, not the other way.

**Recommended reordering:** Move Group 6 before Group 4, or restructure Group 4 so that the acceptance criteria only require 403/401 behavior and defer role-appropriate response verification to a post-Group-6 step.

---

## Finding 5 — TeamAccessGrant needs to carry actor global_role for audit logging

**Location:** Decision 8 grant type, Tasks 3.4–3.5, existing audit patterns in `em-views.ts`

Every audit log write in the existing codebase passes `actor_global_role` as a required field. Every handler in `em-views.ts` extracts `globalRole` from the `checkEmAuthorization` result specifically for this purpose. The `audit_log` table schema has `actor_global_role TEXT NOT NULL`.

The `TeamAccessGrant` union as defined in Decision 8 does not carry `actorGlobalRole`. This means every route handler that integrates the authorization helper will need to do an additional database query to fetch the actor's global role for the audit log, or re-query the same row the helper already read. This is either a performance problem (extra query per request) or an implementation correctness problem (duplicate query with potential divergence).

The straightforward fix: add `actorGlobalRole: string` to each grant variant. The helper already queries `users.global_role` as part of Paths 1 and 2 (it needs it for the dual-check). Making it available on the grant costs nothing.

**Resolution required before Group 2 begins:** Add `actorGlobalRole` to the grant type, or document explicitly how route handlers are expected to obtain `actor_global_role` for audit writes without a second database round-trip.

---

## Finding 6 — Background task for draft expiry requires new infrastructure that does not exist

**Location:** Task 7.4, design.md Risks section

The design acknowledges the background task but describes it as if the infrastructure exists and only the logic needs to be added. It does not. The current codebase has no background task runner, no scheduled job mechanism, no worker process. There is a single Fastify HTTP server process and a Redis connection. Nothing that can execute code on a schedule.

Options for implementing a 24-hour draft session expiry:
1. A separate Node.js process run on a cron schedule from the Docker Compose configuration
2. A setInterval in the application process at startup (not recommended — restarts lose the interval, does not survive multiple replicas)
3. Lazy expiry: when a `draft` session is read, check `created_at < NOW() - INTERVAL '24 hours'` and delete it then. Simpler, no new infrastructure required, but orphaned draft sessions persist until they are next read.

The design's choice of hard delete (Task 7.4 says "hard delete, no status transition") is correct — you do not want `draft` sessions lingering in the status query indefinitely. But hard delete requires something to trigger the deletion.

My recommendation: lazy expiry at read time is a valid fallback that requires no new infrastructure and satisfies the security property (the SQL check in the authorization helper already verifies session recency via `facilitator_access_expires_at > NOW()` or status checks). Stale `draft` sessions are invisible to the auth helper after 24 hours. A periodic cleanup job can be added as a follow-on task without compromising the security model.

**Required before Group 7 begins:** Decide whether a background task process is in scope for this change. If yes, define the mechanism (cron container in Docker Compose, system cron, or other) before implementation begins, because this is infrastructure design, not code placement. If no, document the lazy-expiry fallback as the implementation strategy and add cleanup as a technical debt item.

---

## Review of Specific Design Questions

### TeamAccessGrant union type (Decision 8) — Is it the right pattern for Fastify?

Yes. The existing code already uses inline helper functions that return typed objects (`checkAssignRolesAuthorization`, `checkEmAuthorization`). The discriminated union is strictly better than the current `{ authorized: boolean }` pattern because TypeScript type narrowing then ensures the serializer layer compiles only if it handles all grant paths. The pattern composes cleanly with Fastify's inline route handler style — no preHandlers or decorators needed, just call the helper at the top of the handler.

The one friction point: Fastify's generic route handler types do not automatically carry the grant type through to the reply. The grant will be a local variable, not a typed request property, which is fine — the existing handlers work this way.

### `draft` session status addition — migration risks and state machine impact

The migration itself is low risk: `ALTER TYPE session_status ADD VALUE 'draft'` is additive and does not affect existing rows. Node-pg-migrate handles this correctly. The TypeScript change (`SessionStatus` union addition) is straightforward but will cause the TypeScript compiler to flag any exhaustive switch statements on `SessionStatus` that do not handle `'draft'` — this is the desired behavior, and these callsites need to be found and handled.

The state machine impact is bounded: `draft` only transitions to `lobby` (facilitator advances) or hard delete (expiry). No other status transitions to or from `draft`. The `draft` status should not appear in any existing status-conditional logic for active sessions, revealed topics, or participant actions.

The larger concern is infrastructure, covered in Finding 6.

### `facilitator_access_expires_at` — background task vs. lazy evaluation

Lazy evaluation at request time (the SQL check) is correct for the grace window and that is what the design specifies. No background task is needed for grace window expiry. The SQL `facilitator_access_expires_at > NOW()` is evaluated on every content request and produces the right result without any cleanup process. Existing NULL values (sessions that predate the column) correctly evaluate to false, matching the design's documented behavior.

Do not add a background task for grace window cleanup. The column can remain set indefinitely — it is only read, never the basis for anything other than the access check.

### Dual-check pattern (authorization helper + serializer) — existing patterns?

The pattern is partially established. `em-views.ts` has `checkEmAuthorization` which is an authorization helper, and the route handlers build responses inline (which is the serializer layer, just not extracted as a module). The new design formalizes and generalizes what already exists.

The gap: the existing EM endpoints are purpose-built and each route handler duplicates the authorization call. The new helper replaces those point-in-point checks with a single shared module. The existing `em-views.ts` handlers will need to be updated to use the new helper, or they will become a diverging implementation of the same check.

**Risk of leaving `em-views.ts` handlers as-is:** The EM-specific routes (`/api/v1/teams/:id/em/*`) currently use `checkEmAuthorization` which enforces the dual-check (both `global_role = 'engineering_manager'` AND `membership_role = 'engineering_manager'`). The new general authorization helper returns a `member/engineering_manager` grant based on `team_memberships.role` alone (per the proposal's acceptance criterion: a user with `global_role = 'engineer'` and `membership_role = 'engineering_manager'` must receive the EM response shape). If the two helpers diverge, an EM-associated user with a mismatched global_role could access general content endpoints in EM mode but be denied access to the EM-specific endpoints. This inconsistency should be explicit in the design, not left to the implementer to notice.

### Task group dependency ordering — risks

The most significant dependency ordering problem is Finding 4 (Group 4 depends on Group 6). Beyond that:

- Group 3 (Admin) references the `TeamAccessGrant` type defined in Group 2. This is correctly ordered (3 after 2).
- Group 7 (Draft/Grace Window) depends on Group 1 (schema migration) and Group 2 (authorization helper Path 3). Correctly ordered.
- Group 8 (WebSocket) references the serializer from Group 6 explicitly (Task 8.3). Correctly ordered (8 after 6).
- Group 9 (Facilitator Error States) depends on Group 4 and Group 8. Correctly ordered.
- Group 10 (End-to-End Tests) depends on everything above. Correctly ordered.

One ambiguity in Group 2: Tasks 2.2 and 2.3 define Path 1 and Path 2 as distinct cases, but both query `team_memberships`. If a user has `global_role = 'engineering_manager'` and `team_memberships.role = 'engineering_manager'`, they match Path 1 and Path 2 simultaneously. The task list does not specify evaluation order. If Path 1 is evaluated first and returns `{ path: 'member', role: 'engineering_manager' }`, the helper may never reach Path 2 logic. This is fine if the grant is the same — but the task descriptions imply Path 2 is a separate conceptual path. Clarify whether Path 1 and Path 2 are collapsed into a single team_memberships query (returning the role value) or truly distinct branches.

---

## Index Assessment

Task 1.4 asks to verify whether `(user_id, team_id)` index exists. The current indexes in `3_create_indexes.sql` are:
- `idx_team_memberships_team_active` ON `(team_id)` WHERE `removed_at IS NULL`
- `idx_team_memberships_user_active` ON `(user_id)` WHERE `removed_at IS NULL`

Neither is a composite on `(user_id, team_id)`. The authorization helper's primary query pattern — "find the membership for this user on this team" — uses `WHERE user_id = $1 AND team_id = $2 AND removed_at IS NULL`. The existing single-column indexes will work but the query planner may not use them optimally for the composite filter. Task 1.4 is correct to flag this.

Task 1.3 asks for an index on `sessions(facilitator_id, team_id, status)`. The existing `idx_sessions_facilitator_active` covers `(facilitator_id)` WHERE `status IN ('lobby', 'pre_session', 'active', 'wrap_up')`. This partial index does not include `team_id` or `draft`. After adding the `draft` value, the partial index will need to be updated (or a new composite index added) to support Path 3's query pattern efficiently. The existing index will not be invalidated but may not be used for Path 3's query which includes `team_id` in the WHERE clause.

---

## Things the Design Gets Right

The following are confirmed correct from my review of the codebase:

- The decision to return a typed grant object rather than a boolean is the correct approach. The existing `boolean + re-query` pattern in `em-views.ts` is exactly the duplication problem this solves.
- Authorization before resource lookup (Task 5.1) is correctly sequenced. The existing `teams.ts` handlers have a minor violation of this — they check membership but then do a team existence query that could return 404 to an authorized user on a nonexistent team. Extending the consistent 403/404 rule to fix this is the right call.
- The `facilitator_access_expires_at` NULL behavior (NULL evaluates to false in the SQL check) is documented and correct. No migration data fixup is needed.
- The `Cache-Control: no-store` requirement (Task 4.7) is new — the existing handlers do not set this header. It is correctly identified as missing.
- Writing the audit log row in the same transaction as the data write (Tasks 3.5, 7.7) is the existing pattern in `teams.ts` (role change and audit log in the same transaction) and should be maintained.

---

## Prerequisites Before Implementation Starts

1. Correct the `'completed'` → `'complete'` typo in Decision 3's SQL check and Task 2.4. (Finding 1)
2. Resolve the admin grant context-dependence — does `evaluateTeamAccess` return `{ path: 'admin' }` or null for admin callers, and under what conditions. (Finding 2)
3. Decide on background task infrastructure for draft session expiry before Group 7 begins. (Finding 6)
4. Add `actorGlobalRole` to the `TeamAccessGrant` type or document the audit-log workaround. (Finding 5)
5. Reorder Group 6 before Group 4, or restructure Group 4 acceptance criteria to exclude response-shape verification. (Finding 4)
6. Clarify whether the existing `em-views.ts` `checkEmAuthorization` is replaced by or coexists with the new `evaluateTeamAccess` helper, and whether the dual-check requirement differs between the two.
