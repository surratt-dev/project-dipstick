# Sync review: template-team-not-usable (#214), Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Drift between the seven synced capability specs (`openspec/specs/{default-topic-provisioning, session-creation, manager-team-association, role-assignment, join-link, topic-customization-lock, topic-management-screen}`), `design.md`, and the uncommitted working tree on `agent-team/214-template-team-not-usable`. Also whether the `openspec validate --strict --all` failures are pre-existing.

## Verdict

**No blocking drift.** Every guarded route, the migration, the `lockReason` surface and the audit/dedupe behaviour match the synced specs. I found three places where `design.md` is out of date: in each, the spec and the code agree with each other and the design does not (N1 to N3). None blocks the change, and I recommend a short design errata before archive. The validation failures come from files this change does not touch, and the seven touched specs have the same warning counts as on `main`.

## 1. Guarded routes vs. spec scenarios

| Route | Spec requirement | Code (working tree) | Result |
|---|---|---|---|
| `POST …/sessions/draft` | Non-canonical id: `404 TEAM_NOT_FOUND` before auth, no row. Then 401, facilitator 403 (admin too), then the template gets `404 TEAM_NOT_FOUND`, before the cross-team check. Audited `surface: session`. No floor | `isCanonicalUuid` → `teamNotFoundEnvelope()` first. The guard runs after the `global_role !== "facilitator"` 403 and before the team-existence and `is_member` checks, using `teamNotFoundEnvelope()` and passing the role in scope. No floor | Match |
| `advance`, `complete`, `topics/advance`, `facilitator-state` | After auth (and any non-canonical `sessionId` reject), before the lookup and any `getOrCreateJoinLink`: "Session not found." `404`. Any authenticated caller. Role read by the writer | `refuseTemplateSessionRoute` sends `{category:"not_found", message:"Session not found.", correlationId}`, byte-shape identical to each route's not-found branch. On `advance` it is placed after the `isCanonicalUuid(sessionId)` reject. `actorGlobalRole` is omitted, so the writer resolves it | Match |
| `reveal` | Non-recoverable `409 reveal_failure`, `recoverable:false`, no `correlationId` in the body. One is minted for the event and log only | The body is the same `RevealFailureResponse` literal as the missing-session branch (`currentSessionStatus:"complete"`). A `correlationId` goes to the writer only | Match (see N1 for the design) |
| `GET …/members` | Admin gets the missing-team response plus an audit row. Non-admin gets the existing 403 and no row | The guard runs after the 401 and the `!is_member && !admin` 403, and returns `404 teamNotFoundEnvelope()` (the same envelope as the existing missing-team branch) | Match |
| `PATCH …/members/:userId/role` | Admin gets `404` "User is not an active member of this team." plus a row. Non-admin gets the existing 403 | The guard runs after `checkAssignRolesAuthorization` and before the subject lookup. Its body (`invalid_request`, same message) matches the existing branch | Match |
| `POST …/managers` | After the admin 403 and the rate limiter, at the existence check: `404 TEAM_NOT_FOUND`. No `team.manager_established` | The guard sits directly before the `SELECT id FROM teams` existence check, after the 503/429 limiter branches | Match |
| `POST /api/teams/:teamId/join-links` | Any authenticated caller, before the membership check: `403` "You are not a member of this team." No row created | The guard is the first statement; the 401 comes from the global `onRequest` auth hook. Category and message match the non-member branch | Match |
| `GET /api/join/:token` | Immediately after the row is found, before `is_active` and before the login redirect: `joinError=invalid`. Logged out gives the event only, no row. No token recorded | The guard runs right after the empty-result branch. `actorUserId: session?.userId ?? null`. It emits `join.link_rejected` with `reason:"template"`. Metadata is `{endpoint, surface}` only | Match |
| `/auth/callback` → `executeJoinFlow` | Same placement, login still completes, row written with the role in scope. Constraint violation logged with the marker before `mapAuthError` | The guard sits before the `revoked_at`/`expires_at` branch and passes `actorGlobalRole`. The callback `catch` calls `logTemplateConstraintViolation` before `mapAuthError` | Match |
| Content reads `GET …/sessions`, `…/sessions/:id` | No route guard. Closed by `evaluateTeamAccess` after the clamp. No `team.template_access_denied` row | No route change. `FACILITATOR_GRANT_SQL` was extracted verbatim, with no predicate change | Match |
| `GET /api/v1/teams/eligible-for-session` | Template excluded by binding the shared constant, never by a literal or name. No config | `AND t.id <> $2` with `DEFAULT_TOPICS_TEAM_ID`. The source test inspects `facilitator-sessions.ts` and the guard module for config/`process.env` | Match |

Structural test (`team-template-guard-structural.test.ts`): `REFUSED_BEFORE_GUARD` is the closed set of four. `BOUNDARY_REJECTS_NON_CANONICAL` and `ADMIN_REFUSED_BEFORE_GUARD` each equal `["POST /api/v1/teams/:teamId/sessions/draft"]` and are asserted by equality. It also asserts that no body contains `_not_template_team` and runs the `__probe` self-test. This matches the spec's "Only a closed set…" and "Only draft is exempt…" scenarios.

`isTemplateTeam` strips one brace pair, removes hyphens, lowercases and compares to 32 hex digits. This matches "recognises every spelling" and touches no real-team path.

## 2. Migration vs. constraint requirements

`migrations/23_template_team_not_a_subject.sql`:
- `SET LOCAL lock_timeout = '200ms'` then `LOCK TABLE sessions, team_memberships, join_links IN ACCESS EXCLUSIVE MODE` before the cleanup. This matches "serialised with the constraints". The concurrent-insert scenario holds: the insert waits on the lock, then sees the constraint and gets 23514.
- Cleanup steps: revoke links; soft-remove memberships; abandon `draft/lobby/pre_session/active/wrap_up` with `abandoned_at`; clamp `complete` rows whose `facilitator_access_expires_at > now()` using `LEAST(…, now())`. All of these run before `ADD CONSTRAINT`. This matches "neutralised once and preserved where terminal".
- Audit: each table gets one `team.template_cleanup` row with the system user as actor, `actor_global_role='system'`, `actor_ip NULL`, the template `team_id`, and metadata `{table, migration, rows:[id + prior values]}`. Prior values come from a pre-update CTE snapshot. `HAVING count(*) > 0` means no row is written when nothing changed, so the no-op scenario holds. `actor_global_role` is unconstrained TEXT (`8_audit_log.sql`), so `'system'` is accepted.
- Constraints: three `<table>_not_template_team CHECK (team_id <> …::uuid) NOT VALID`, each with a comment that points at `DEFAULT_TOPICS_TEAM_ID`. Each is then conditionally `VALIDATE`d only where that table has zero template rows. This matches "fresh DB validates all three" and "historical rows: enforced, not validated".
- Down: drops the three constraints and does not reverse the cleanup, as specified.

Operational note (not drift): in any environment that held template rows, `team_memberships` and `join_links` also stay `NOT VALID`, because the soft-removed and revoked rows remain. The spec allows this ("leaving those rows in place"). The post-deploy `pg_constraint` check in the Migration Plan should therefore expect `convalidated = false` on up to three tables, not only on `sessions`.

## 3. `lockReason` surface

- `auth/topic-lock-state.ts` `getTopicLockState` returns `{true,"canonical_defaults"}` for the template with no DB call. For other teams it delegates to `hasCompletedFirstSession` and maps the result to `first_session` or `null`. `topic-lock-helper.ts` is unmodified, and a source test keeps it template-agnostic.
- TOPIC-001 and TOPIC-002 (`content.ts`) both call it, after authorization. TOPIC-001's response is now typed `GetActiveTopicsResponse`. `ActiveTopicRow` matches the SELECT columns exactly.
- Shared types: `TopicLockReason`, `ActiveTopicRow`, `GetActiveTopicsResponse` and `GetAllTopicsResponse.lockReason` are all exported from `@dipstick/shared`.
- Frontend: the treatment is chosen from `data.lockReason` only. The screen shows the "Default topics" heading, `document.title`, back link and dialog names, and the exact notice copy. The first-session notice is suppressed, and Restore is hidden. Remove, move, add and definition controls are already off whenever `isCustomizationLocked`. This matches the topic-management-screen scenarios.
- Minor, non-blocking: if the template ever had zero active topics, the locked empty state would read "This team has no active topics…". That wording is not the first-session copy, so no spec scenario is violated, but it calls the canon "this team". It is a cosmetic follow-up at most.

## 4. Audit and dedupe scenarios

`teams/template-team-guard.ts` `writeTemplateAccessDenial`:
- Logged-out (`actorUserId === null`): the event only, no row. This matches.
- The role is read from `users` when it is not supplied. If there is no `users` row, it throws inside the bounded block, logs `audit_write_failed: true` and writes no row, never a placeholder. This matches.
- Dedupe: `SET dipstick:template-denial:<actor>:<endpoint> 1 PX 60000 NX` is claimed before the insert. A Redis error lets the write proceed. A suppressed refusal emits `audit_row_suppressed: true`. This matches.
- Release: if the slot was claimed but the row was not written, `redis.del` runs. This matches "A failed insert does not suppress the next row".
- The role lookup, the claim and the insert are all inside `withTimeout(…, AUDIT_WRITE_TIMEOUT_MS)`. The failure log carries only the code and message. The response never changes.
- Row metadata is exactly `{endpoint, surface}`.
- `team.template_access_denied` is added to `AuditEventName`, and `join.link_rejected` documents `reason:"template"`.
- Unit tests cover the engineer-role, no-users-row, key-format and release/no-release cases (`teams/__tests__/template-team-guard.test.ts`).

Constraint backstop: `registerTemplateConstraintErrorHandler` is the first statement in `registerRoutes`. It matches on the fields `23514` and a `constraint` ending in `_not_template_team`, sends a fixed 500 that does not name the constraint, and rethrows every other error to Fastify's default handler. The local catches on `advance` and on team creation call the marker logger. This matches "fails closed and visibly" and "Other server errors keep their existing response".

## 5. Design-doc drift (non-blocking; spec and code agree)

- **N1.** In the D3 table, `reveal` is grouped with the routes that answer "Session not found." `404`. The synced spec and the code answer `reveal` with its missing-session `409 reveal_failure` and no body `correlationId`.
- **N2.** D2a gives the Redis key as `template-denial:<actor>:<endpoint>`. The spec and code use `dipstick:template-denial:…` (from security implementation review F3). D2/D2a also omit releasing the claimed slot when the insert fails (F1), which the spec now requires.
- **N3.** D8 records only the four-key `refused-before-guard` closed set. The spec and test add two more closed sets, `BOUNDARY_REJECTS_NON_CANONICAL` and `ADMIN_REFUSED_BEFORE_GUARD`, both `[draft]`. D8's statement that "every `evidence: audit` route" gets three spellings that each write a row is wrong for `draft`.

Recommendation: add a short "Implementation errata" note to `design.md` before archive, so the archived design does not contradict the archived specs.

## 6. `openspec validate --strict --all` failures: pre-existing, not caused by this change

- `change/template-team-not-usable` passes (✓).
- The three hard errors are in `spec/project-structure` (requirement 11 has no scenario), `change/team-membership-removal` (no deltas) and `change/topic-skip-and-creation-time-confirmation` (no deltas). `git diff main --stat` and `git status` show no change to any of those paths. Their last touching commit is `e0aaee3` (#205), well before this branch.
- I compared the seven touched specs against `main` by validating `git show main:<path>` copies in a scratch project:

  | Spec | Working tree (errors/warnings) | main (errors/warnings) |
  |---|---|---|
  | default-topic-provisioning | 0 / 2 | 0 / 2 |
  | session-creation | 0 / 17 | 0 / 17 |
  | manager-team-association | 0 / 7 | 0 / 7 |
  | role-assignment | 0 / 8 | 0 / 8 |
  | join-link | 0 / 10 | 0 / 10 |
  | topic-customization-lock | 0 / 7 | 0 / 7 |
  | topic-management-screen | 0 / 27 | 0 / 27 |

  The sync introduced no errors and no new warnings. The remaining warnings are long-text and missing-SHALL warnings on requirements that were already there. The other failing specs are untouched by the diff.

## 7. Housekeeping (not drift)

The new `packages/backend/src/teams/` directory, migration 23, `auth/topic-lock-state.ts` and the new test files are untracked. Make sure the commit includes them. The routes import `teams/*`, so a commit without them would not build.
