## Context

TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`, `packages/backend/src/routes/content.ts`, handler at ~L652) is the Topic Management screen's only data source. It returns active and archived topics with each one's team annotation ("Our team's definition") and its provenance. It authorizes through the shared decision-only helper `checkStandingFacilitatorOrAdminAuthorization` (`packages/backend/src/auth/standing-facilitator-access-helper.ts`), which admits:

- `facilitator` AND not an active member of the team, or
- `application_admin`, before it looks at membership. The helper's membership signal is a boolean `isMember` with no role.

The same helper serves TOPIC-003..006 (writes) through per-endpoint wrappers in `routes/topics.ts`. #208 owns the question of whether a member-admin may write.

Two gaps (GitHub #232):

- **(a)** TOPIC-002 writes no `audit_log` row and emits no event for an admin read.
- **(b)** An admin who holds an active `engineering_manager` membership on the team is admitted, so the team's manager reads the team's words. TOPIC-001 (#187) denies the same caller.

Building blocks that already exist:

- `readActiveMembershipRole(userId, teamId)` in `team-content-access-helper.ts`, exported by PR #230. It is a raw read, uncached, and it throws on query failure (fail closed).
- The `membership_role` enum has exactly `participant` and `engineering_manager` (`migrations/1_create_enums.sql`). No later migration adds a value.
- Admin-read audit precedent: `admin.membership_list_accessed` and `admin.team_detail_accessed` in `routes/teams.ts`. Each is a plain awaited `INSERT INTO audit_log` before `reply.send`, not in a transaction, plus an `emitAuditEvent`. A failed insert throws, and the route returns `500` with no data.
- `users.roles` (from #245) holds the full IdP role set. `global_role` is `roles[0]` by fixed precedence (admin > EM > ...). Migration 21 backfilled existing rows to `ARRAY[global_role]` and states that nothing reads `roles` for authorization.
- `audit_log.actor_roles TEXT[] NULL` (migration 22, #245) is the durable column for "the actor's full role set, highest precedence first". Today only the two sign-in rows write it (`insertSignInAuditRow` in `routes/auth.ts`, `$n::text[]` last in the column list). NULL means "not captured". `parseRoleArray` (`auth/role-map.ts`) validates a `roles::text[]` read and throws on anything malformed.
- `TopicManagementPage.loadTopics` (~L659) ignores the body of a `403` and shows a fixed string. The page already has a `hasEnvelopeMessage` parser (~L214) that its write paths use.

## Goals / Non-Goals

**Goals:**

- An `application_admin` whose live active membership role on the team is anything other than absent or `participant` gets `403` from TOPIC-002, with no topic data and no topic-data queries.
- Every `200` that TOPIC-002 sends to an `application_admin` writes exactly one durable, text-free `admin.topic_config_accessed` row and event, and fails closed.
- Every new admin denial writes exactly one durable `admin.topic_config_denied` row and event.
- Facilitator paths gain nothing: no query, no row, no latency.
- TOPIC-003..006 and the shared helper are unchanged. The read/write split is recorded where #208 will see it.
- The dual-hat admin sees why they are denied.

**Non-Goals:**

- Deciding #208, or changing any topic-write authorization.
- Changing TOPIC-001, TOPIC-007, or any session, trend or action-item endpoint.
- Using `users.roles` for admission.
- Adding a machine-readable `code` to forbidden envelopes.
- Retrofitting `admin.membership_list_accessed` or `admin.team_detail_accessed`. They already satisfy the corrected spec wording.

## Decisions

### D1. Deny the whole response, not strip the annotation fields

**Option A** (`403` for the whole response) was chosen over **option B** (`200` with annotation fields omitted or nulled). The reasons:

- The content matrix gives an EM "None" for topic configuration, not "None except free text".
- It matches TOPIC-001 for the same caller.
- It follows the FR-2.4 dual-hat precedent.
- It doesn't lie. A null annotation reads as "the team wrote nothing", and that could mislead a facilitator who inherits the team.
- It avoids a deny-list of columns that the next free-text field would leak past.

**Cost:** an admin who manages this specific team loses the Topic Management *screen* for that team. They keep the *API* for writes (D6). The project owner (Brian Surratt) accepted deciding this independently of #208. The proposal records that decision and its rationale.

### D2. A TOPIC-002-local allow-list after the shared decision, not a change to the shared helper

In `content.ts`, add a pure, non-exported predicate beside `isTopicConfigReadAdmitted`. For example:

```ts
// #232: the no-manager rule on TOPIC-002's admin arm. Allow-list, not deny-list:
// a role value added to membership_role later is denied until someone decides otherwise.
// Unconditional: no flag, env, or override. TOPIC-002 only; TOPIC-003..006 are #208's.
type AdminTopicConfigRead =
  | { admitted: true; membershipRole: null | "participant" }
  | { admitted: false; reason: "membership_em" | "membership_unrecognised" };

function evaluateAdminTopicConfigRead(liveRole: string | null): AdminTopicConfigRead
```

Handler order, after the canonical-UUID check (design review M3, S1):

1. `checkStandingFacilitatorOrAdminAuthorization`. On `!authorized`, the existing `403` branch runs unchanged.
2. **Only when** `decision.actorGlobalRole === "application_admin"`: `readActiveMembershipRole(session.userId, teamId)`, then `evaluateAdminTopicConfigRead`.
3. **Still on the admin arm, on both outcomes:** read the caller's role set once (D5, "Actor role set"). This is the only place it is read.
4. If not admitted, go to the deny branch (D4).
5. Otherwise: the existing reads (team name, active, archived, `defaultTopicsNotActive`, lock state) → the awaited `admin.topic_config_accessed` insert → `emitAuditEvent` → `await applyTimingFloor(startTime)` → `noStore(reply).send(...)`.

Every admin request therefore runs the same prefix (shared-helper row → membership row → role-set row), and both admin branches end with the same tail: **insert → emit → timing floor → send**. The insert must never sit between the floor and the send. If it did, an admin `200` would take floor + insert time while the deny branch takes max(floor, work), and the two would become distinguishable by timing (M3). Unit tests pin the tail with `mock.invocationCallOrder` (insert < floor < send) on both branches.

**Why not widen `evaluateStandingFacilitatorAccess` to return `tm.role`?** It would save one round trip for admins, but it changes the shape seen by the session-draft and topic-write callers. #208 has to be able to see that the helper's diff is empty. The extra query is paid only by admins, a small population on a non-hot path.

**Why not one TOPIC-002-local query joining `users` and `team_memberships`** (folding the membership role and the role set into one round trip)? `readActiveMembershipRole` exists so that `content.ts` runs no SQL against `team_memberships` (access-control Decision 8). A local join would break that rule. Two small indexed reads is the right trade. This is the first optimisation someone will try, so the handler comment says so (Engineer review).

**Why the order matters:** the shared decision runs first, so the facilitator branch never reaches the membership or role-set read. Facilitators therefore gain no query. A test pins "admin + EM membership → 403 **and** no topic/lock/team-name query ran", so a later refactor that moves the reads ahead of the check fails loudly.

The membership read is live, uncached, and fails closed. **Fail-closed set (normative in the spec since propose review F1):** if `readActiveMembershipRole`, the role-set read, the access insert or the denial insert throws, the request is `500` with no topic, annotation, team-name or lock-state data. A failed denial insert never becomes a `200`; that is structural, because the data reads sit after the deny branch. The `500` body is the application's existing default error response. Today that is Fastify's default handler, which echoes `err.message`; no topic data can be in it (metadata is counts only and the deny branch runs no topic query), and the app-wide envelope fix is a follow-up, not this change (Security §3a). Scope: this is the administrator arm of one low-traffic, admin-only configuration read. It is **not** a pattern for facilitator, participant or live-session paths, where availability during a session matters more (Executive review note 3).

### D3. Reason names and messages

| Live membership role | Outcome | Internal reason / audit `metadata.reason` | Message |
|---|---|---|---|
| none | `200` | — | — |
| `participant` | `200` | — | — |
| `engineering_manager` | `403` | `ADMIN_IS_TEAM_MANAGER` / `membership_em` | "Topic configuration for this team isn't available to its engineering manager." |
| any other value | `403` | `ADMIN_MEMBERSHIP_NOT_ADMITTED` / `membership_unrecognised` | "Topic configuration for this team isn't available to you." |

The `ADMIN_IS_TEAM_MANAGER` message leaks nothing, because the caller knows their own membership. It states the rule instead of suggesting a bug. The defensive message doesn't claim the caller is a manager. As with `NOT_A_FACILITATOR` and `FACILITATOR_IS_TEAM_MEMBER` today, the reason names appear in the contract's 403 table and the audit metadata, not as an envelope field. The spec now says so explicitly, and every `403` scenario asserts the exact `error.message`, which is the only observable difference between the reasons.

The two messages are exported module-level constants in `content.ts`, and the unit tests import them, so the handler and the assertions cannot drift by a typo (Engineer nit).

### D4. Deny-branch mechanics

These mirror the existing TOPIC-002 `403` branch, so the response is indistinguishable in shape. After steps 1–3 of D2 (helper, membership read, role-set read):

1. Await the `admin.topic_config_denied` insert (D5), with `actor_roles` populated.
2. `emitAuditEvent(request.log, "admin.topic_config_denied", …)` with the D5 payload.
3. `await applyTimingFloor(startTime)`.
4. `noStore(reply).code(403).send({ error: { category: "forbidden", message, correlationId: crypto.randomUUID() } })`.

The deny branch runs no team-name, topic, archived-topic, `defaultTopicsNotActive` or lock-state query. If the role-set read or the denial insert fails, the request is `500` (never `200`) and still returns no topic data. The failure also emits the log-only `admin.audit_write_failed` signal (D5b), so "an admin was denied and the denial wasn't recorded" is findable by a log query, not only by grepping error text. The dual-hat admin then sees the screen's load failure, not the explained denial. That is acceptable for a rare infrastructure fault.

### D5. Audit records: durable rows plus events, written before the timing floor and the send

**Why durable and not log-only.** Log-only (`team.access_grant_mismatch`, `topic.config_read_denied_role`) is justified by **call volume** on hot paths. TOPIC-002 is loaded on screen mount and on the refetch after a write, by a small population. The spec says "SHALL be logged in the `audit_log` table". And for the no-manager rule, the durable row is the only after-the-fact evidence.

**Actor role set (design review M1 / Security B1, M2, S1).** Read once per admin request, at D2 step 3:

```sql
SELECT roles::text[] AS roles FROM users WHERE id = $1
```

- The result goes through `parseRoleArray` (throws on a malformed value). The `::text[]` cast is required: node-pg does not parse an enum array (`user_role[]`) into a JS array without it, which is also why `account-resolver.ts` casts.
- **Zero rows throws.** The handler checks `rows.length !== 1` and throws an `Error("TOPIC-002 admin arm: caller's users row vanished after authorization")`. That keeps "caller identity vanished between authorization and audit" inside the fail-closed set, and it makes an unrouted SQL fake (the parity test's default `{ rows: [] }`) fail loudly instead of quietly recording `false`. Neither `rows[0]?.roles ?? …` nor a non-null assertion is acceptable. One unit test pins the `500`.
- From that one array the handler derives both recorded values, so they cannot disagree:
  - **`audit_log.actor_roles`** = the array, written as `$n::text[]` last in the column list, the same pattern as `insertSignInAuditRow`. **This column is the record.** It keeps full fidelity (audit rows are immutable, so fidelity can't be added later) and its NULL already means "not captured".
  - **`metadata.actor_idp_roles_include_em`** = `roles.includes("engineering_manager")`. A derived convenience for a dashboard filter, kept because it costs nothing and reads plainly in the row. It is never an admission input.
- **Migration 21's boundary holds.** The role set is metadata only. Nothing about admission keys on it.
- **Known limit, unchanged:** a dual-hat admin who hasn't signed in since #245 still has the backfilled `{application_admin}`. The row then records `actor_roles = {application_admin}` and the flag `false`. That is honest (it is what the system knew), and the `AuditEventName` comment block states it.
- We do **not** edit migration 22's `COMMENT ON COLUMN` (applied migration; "as of migration 22" stays true). The new writers are named in the `AuditEventName` comment blocks and in `docs/deployment.md`'s Logging section, whose "`actor_roles` … on sign-in rows only" sentence would otherwise become false (task 7.8).

**`admin.topic_config_accessed`** is written on every TOPIC-002 `200` to an `application_admin`, for every team, the template team included, and whether or not anything is annotated:

- Columns: `actor_user_id`, `actor_global_role = 'application_admin'`, `actor_ip = request.ip`, `operation`, `team_id`, `metadata`, `actor_roles`.
- `metadata = { endpoint: "GET /api/v1/teams/:teamId/topics/all", http_status: 200, membership_role: null | "participant", actor_idp_roles_include_em: boolean, team_found: boolean, active_count, archived_count, annotated_count }`.
- `membership_role` is the value carried by the admitted branch of `AdminTopicConfigRead`, not a second read of `liveRole`, so the type proves an access row can never record `engineering_manager` (Engineer nit).
- `team_found` is whether the handler's existing `SELECT name FROM teams WHERE id = $1` returned a row (Security §6). A reviewer looking at an all-zero row then knows whether the id named a team at the time, without reconstructing it after renames or archives. It costs no query.
- `annotated_count` is the number of entries in `active` **and** `archived` with a non-null `teamAnnotation`. Archived entries carry the field too.
- It is a plain awaited insert in the `teams.ts` style, after every data read, then the event, then the timing floor, then the send (D2). If it throws, the route returns `500` with no data.
- One row **per request**. An admin who edits topics produces pairs (a write row, then a refetch read row). That is expected and must not be deduplicated.

**`admin.topic_config_denied`** is written on the D4 branch:

- Same columns, `actor_roles` included.
- `metadata = { endpoint, http_status: 403, reason: "membership_em" | "membership_unrecognised", actor_idp_roles_include_em }`. No `team_found`: the deny branch runs no team query, and adding one would break the "no team-name query on deny" rule.

**Event payloads (Engineer S5, Security §10).** The structured events go to application logs, which have a wider audience than `audit_log`, so their key sets are pinned exactly, like the rows, in the precedents' camelCase style:

- `admin.topic_config_accessed`: `{ actorUserId, actorGlobalRole, actorIp, teamId, endpoint, httpStatus, membershipRole, actorRoles, actorIdpRolesIncludeEm, teamFound, activeCount, archivedCount, annotatedCount }`
- `admin.topic_config_denied`: `{ actorUserId, actorGlobalRole, actorIp, teamId, endpoint, httpStatus, reason, actorRoles, actorIdpRolesIncludeEm }`

`actorRoles` in the event matches the sign-in precedent, whose event carries the same frozen array as its row.

**Neither** row nor either event ever contains annotation text, topic names or topic ids. Tests assert the exact key sets of both rows and both events, and that no value contains the definition text or a topic name or id.

**Why two operation names and not one with an `http_status`.** A consumer counting `*_accessed` would otherwise count denials as reads. **Why not reuse `admin.session_content_denied`.** Topic configuration isn't session content, and that name is spec-protected for TOPIC-001. **Consequence:** "admin denied topic configuration" now has two names, `admin.session_content_denied` (TOPIC-001) and `admin.topic_config_denied` (TOPIC-002). Both carry `metadata.endpoint`, so a consumer can tell them apart.

**Non-admin callers** (non-member facilitators) write no `admin.*` row. TOPIC-002's pre-existing non-admin `403`s also stay unaudited. That is a scope boundary, not a SEC-13 decision (proposal Non-goals).

**Visibility guard, made checkable (design review B2 / S6).** The spec requires every `audit_log` query that serves a non-admin caller to filter `operation` by equality on one named operation. A grep for `FROM audit_log` misses lowercase SQL, the table name on the next line (this codebase's normal SQL formatting), `JOIN`, CTEs, subqueries and schema-qualified names. Task 8.3 is therefore a **sweep, not a pattern match**: `grep -rniE "audit_log" packages/backend/src --include='*.ts'`, excluding `__tests__` and `migrations`. **Every** hit is classified in a table in the PR description as one of: INSERT; read serving an admin; read serving a non-admin (with its `operation` filter quoted); or comment/identifier only. Any non-admin read without a single-operation equality filter blocks the PR. Today the sweep finds INSERT sites, comments, and exactly one read, `fetchConnectionRecoveries` (`content.ts` ~L913), which filters on equality. A structural unit test that enforces this automatically is a worthwhile follow-up, not part of this change.

**Registration:** add both names, plus `admin.audit_write_failed` (D5b), to `AuditEventName` in `audit-logger.ts`, with comment blocks giving the change, the durable-row rationale (or, for D5b, the log-only rationale), the row columns including `actor_roles`, the exact metadata and event keys, the text-free rule, the visibility guard and the backfill limit. The `audit-logging-operations` spec doesn't enumerate operations, so it doesn't change.

### D5a. Edge cases pinned by the allow-list (propose review T2)

No new design. Each case is already decided by D2; the spec now pins it with a scenario.

- **Removed EM membership** (`removed_at` set): `readActiveMembershipRole` returns `null`, so the admin is admitted with `membership_role: null`. Correct under "live active membership". The backend has **no** membership-removal path today: nothing in the application sets `team_memberships.removed_at` (the only `UPDATE team_memberships` is TEAM-005's role change). A removed membership can therefore only come from direct database access, which is out-of-band and **unaudited** at the application layer; database-level access control is the control for it, not this change. The audited self-demotion edge is a TEAM-005 role change: a `team.role_changed` row with `actor_user_id = target_user_id` and `metadata->>'from_role' = 'engineering_manager'`, followed by an `admin.topic_config_accessed` row for the same user and team. `docs/deployment.md` review query 2 is that correlation as SQL. (Corrected per implementation review, security N2.)
- **Canonical UUID that names no team:** decided as **audited like any other admin `200`**. The handler already answers `200` with `teamName: ""` and empty lists for every admitted caller; this change does not turn that into a `404`. The access row carries the requested `team_id` (no FK on `audit_log.team_id`), all counts `0`, and `team_found: false`. Rationale: changing TOPIC-002's not-found behaviour would change the facilitator path too, which this change promises not to touch, and recording the attempt is more useful than suppressing it. A `404` for unknown team ids is a separate, contract-level follow-up.
- **Unrecognised membership role:** unreachable against the current enum. It is defence in depth for a future enum value, covered by unit tests only. The predicate's comment says that adding an enum value must revisit `evaluateAdminTopicConfigRead`. We do **not** add a comment to `migrations/1_create_enums.sql`: editing an applied migration is not something we do for a comment.

### D5b. A queryable signal when the admin-arm audit write fails (Security §3b)

When the role-set read or either insert throws on the TOPIC-002 admin arm, the handler emits a **log-only** event, `admin.audit_write_failed`, then rethrows so the request is still `500`:

- payload `{ actorUserId, teamId, endpoint, operation: "admin.topic_config_accessed" | "admin.topic_config_denied", stage: "role_set_read" | "audit_insert", errorCode }`
- `operation` is the row that was due. The predicate has already decided by the time the role set is read, so even a `role_set_read` failure knows which row it was for.
- `errorCode` is the pg `code` (SQLSTATE) when present, otherwise `null`. **Never `err.message` or `err.detail`**: a pg detail string can echo row values. No topic data can reach it.
- A membership-read failure does not emit it. At that point no audit row was due yet; the generic error log covers it.

**Why a new name and not `auth.audit_write_failed`.** That event's payload (`userId`, `authSessionId`, `failureMode`, `sourceIp`) and its fail-open semantics belong to the auth trail; this one fires on a fail-closed path whose request already fails. Reusing it would make one name mean two contracts. The name is `admin.*`-generic (with `operation` and `endpoint` in the payload) so the `teams.ts` admin reads can adopt it later without a rename. That retrofit is out of scope.

**Why log-only.** Writing a database row about the database failing to take a row is not a fallback. Same reasoning as `auth.audit_write_failed`. `docs/deployment.md`'s log-only list gains it (task 7.8).

**Why not emit `admin.topic_config_denied` before the denial insert instead** (Engineer nit)? It would leave a log trail for the denial when the database is down, but it gives one operation name two orderings and a log line that may have no matching row. D5b gives the same evidence under a name that says what actually happened, on both branches.

### D6. TOPIC-003..006 unchanged; the split is recorded in the parity test

`topic-add-flag-parity.test.ts` drives TOPIC-002 and TOPIC-003 through a SQL-routing fake returning `{ global_role, is_member }`. The fake gains a membership-role column so it can answer `readActiveMembershipRole`. The `Expected` union (today `{ get: 200; canAddTopics; post } | { get: 403; post: 403 }`) gains a third shape, `{ get: 403; post: 201 }`, used **only** by the new "application_admin with an engineering_manager membership" row. The row carries a comment that cites #208 and says the divergence is deliberate and must not be "fixed" here. Existing rows keep their expectations. The existing "application_admin member" row is pinned to a `participant` membership.

**The fake must prove what it served (Engineer S2).** `readActiveMembershipRole`'s SQL matches none of the fake's current routes, so today it would fall through to the default `{ rows: [] }`, which reads as a `null` membership. The new EM row would fail loudly, but the "participant member" row would keep passing as a non-member and never exercise the participant case. The fake therefore **records** the membership role it served for each request, and every admin row asserts that the recorded value equals the row's configured role. Route order matters: the membership query is matched before any broader `team_memberships` rule, and the role-set query (`FROM users WHERE id`) must not collide with the helper's `FROM users u`. The role-set route returns one row; the D5 zero-row throw then guarantees an unrouted query fails the test instead of passing.

The spec's parity scenario is amended so that "`canAddTopics` true exactly when add does not answer 403" is stated for callers TOPIC-002 admits, plus the one recorded exception.

### D7. Frontend: render the server's 403 message

In `TopicManagementPage.loadTopics`, on `403`, parse the body **defensively**: `const body = await res.json().catch(() => null)`. A `403` whose body isn't JSON (a proxy or WAF page, an empty body) must not throw into the existing `catch`, which would show "Network error loading topics." and regress today's behaviour (Engineer M4). If `hasEnvelopeMessage(body)` holds, show `body.error.message` in the existing access-denied state. Otherwise show the current fallback, "You do not have access to this team's topic management." No topic list, definition block or write control renders in any case (the error state returns early at the `if (error)` render). Tests cover three bodies: an envelope with a message, a JSON body without one, and a non-JSON body; the last renders the fallback string, not the network error. This also improves the member-facilitator's `403`.

The quiet refetch after a write keeps its existing failure handling.

`TeamPage` keeps the "Topics" link visible for every caller who sees it today. **No client-side role guess** hides it, because the server is the only gate.

### D8. Spec wording for admin-read audits

The `team-content-access` sentence "The audit write MUST execute in the same database transaction as the data access operation" is replaced, for admin **reads**, with: the row is written after the data is read and before the response is sent, and if the write fails the request fails with `500` and returns none of the data read. A transaction around SELECTs guarantees nothing extra. What matters is that **if the data was served, the record exists**. The converse does not hold, and is not meant to: a row can exist for a response that never reached the client (for example, a client disconnect after the insert). That is the safe direction, over-record and never under-record (Security §3c). The spec states it in those words.

Write-side audit rows keep their in-transaction rule. The field list is corrected to the real columns (`timestamp`, `actor_user_id`, `actor_global_role`, `actor_ip`, `operation`, `team_id`, `metadata`), plus `actor_roles` where the operation captures the role set (the sign-in rows and, from this change, the two TOPIC-002 rows). `admin.membership_list_accessed` and `admin.team_detail_accessed` leave `actor_roles` NULL, which the column comment already defines as "not captured"; they are not retrofitted. This is the Solution Architect's call to override at design review.

## Risks / Trade-offs

- **The parity row gets "fixed" by making TOPIC-003..006 deny too.** That would be #208 decided by accident. Mitigation: a comment on the row citing #208, the spec scenario naming the exception, and the #208 comment.
- **The membership check migrates into the shared helper later.** That would silently change the writes. Mitigation: the helper diff is empty in this change, and D2's comment says why.
- **The audit becomes conditional** (only when annotated, skip the template team, skip participants). Mitigation: scenarios pin "every admin 200", including the template team and an unannotated team.
- **Someone adds annotation text to the metadata "for forensics".** Mitigation: tests assert the exact key sets of both rows and both events, and search the stored row and the logged event for the definition text.
- **Refactor reorders the reads ahead of the admin check.** Mitigation: a no-topic-query assertion on the deny branch, in unit tests (SQL match, not mock position) and in real Postgres.
- **The dual-hat admin with no EM membership** (their IdP set includes EM, but they don't manage this team) is admitted. Accepted. The membership row is the only team-scoped manager fact. `actor_roles` (and the derived flag) make these reads visible, but only if someone looks. The review query and a proposed owner are recorded in `docs/deployment.md` (task 7.8); the owner needs confirming (Open Questions). Revisit admission with #238.
- **Refetch edge (accepted).** If the admin's membership becomes `engineering_manager` while the screen is open, the next write still lands (`201`, the #208 split). The quiet refetch then fails with "Unable to reload topics." over a stale list. It is rare and fails closed. It is listed so QA doesn't rediscover it.
- **Self-demotion edge (accepted).** An admin with an EM membership can change their own membership to `participant` and then read. That isn't silent: the membership edit writes an in-transaction `audit_log` row plus `team.role_changed`, and each later read writes `admin.topic_config_accessed` with `membership_role: "participant"` and `actor_roles` containing `engineering_manager` (if they have signed in since #245). Blocking self-edits is outside scope here, but it is now a **filed** follow-up, not an optional one (Security §8). Until it ships, the correlation query (a TEAM-005 `team.role_changed` row where `actor_user_id = target_user_id` and `from_role` is `engineering_manager`, followed by `admin.topic_config_accessed` for the same team; there is no application removal path, see D5a) sits beside the role-set query in `docs/deployment.md`.
- **Extra latency for admins** of two small indexed queries plus one insert. Accepted. Facilitators pay nothing. The work sits before the timing floor on both admin branches, so if it exceeds `TIMING_FLOOR_MS` an EM-admin `403` is slower than a `NOT_A_FACILITATOR` `403`. Security assessed this as not an oracle: only an admin reaches the branch, and only for a team whose EM membership they already know.
- **The audit write fails** (database fault). The request is `500` with no data, and `admin.audit_write_failed` (D5b) makes the gap queryable in logs. The `500` body is Fastify's default and echoes `err.message`; that is pre-existing and app-wide (follow-up).
- **`actor_roles` read without the `::text[]` cast** returns a string such as `{application_admin,engineering_manager}`, not an array. `parseRoleArray` throws on it (fail closed, `500`), and the real-Postgres `true` case (task 5.1) catches it before merge.
- **Two names for "admin denied topic configuration"** (D5). Accepted. `metadata.endpoint` distinguishes them.

## Migration Plan

No schema migration. The operation names are new strings in an existing text column, and `actor_roles` already exists (migration 22). Deploy is backend and frontend together, but either order is safe. Old frontend plus new backend shows the generic denied string to the dual-hat admin. New frontend plus old backend changes nothing.

Rollback is a plain revert. The audit rows written in the meantime stay, and they are valid records.

After merge:

- Post the #208 and #238 comments (proposal Follow-ups). The #208 comment also records that POST add's `201` returns `displayOrder`, which reveals the active-topic count to an EM-admin (a low-value residual read), and that an EM-admin's topic writes are already audited in-transaction (`topic.custom_added`, `topic.archived`, …), which is the stop-gap #208 relies on (Security §7).
- File the follow-ups: admin self-edit of own membership role (Security §8, now required); a root error handler that returns the standard envelope with a correlation id and logs pg detail server-side (Security §3a); lifting the audit-visibility guard into `audit-logging-operations` as a general rule, with a structural test (Security §5, B2 companion).
- Unblock #187 Follow-up 5's release-note line with the approved wording.

## Open Questions

None blocking the implementation. Both calls the proposal made on others' behalf are now settled: Security replaced the boolean-only call with `actor_roles` (D5), and the Solution Architect confirms the D8 wording with the one-directional correction.

**Needs a human decision (Brian):** who owns the periodic review of the two queries in `docs/deployment.md` (admin topic-configuration reads where `'engineering_manager' = ANY(actor_roles)`, and the self-demotion correlation). The design proposes Security (Tomás Ferreira) as owner, monthly, with no alerting. A compensating control with no named reviewer is not a control, but assigning someone's time is not this change's call. The PR can merge with the owner recorded as "proposed"; it should not merge with the line missing.

**Recommendation (Executive review note 1), for the owner:** schedule #208 in the current milestone. The `GET 403 / POST 201` split is acceptable as a temporary state, not a resting one, and the open half (a manager shaping their own team's topics through the API) is the worse half. If #208's outcome touches who can shape a team's topics, take it to the executive sponsor. Scheduling is a separate decision from this change and does not block it.

## Design review disposition

*Ingrid Sollenberger (Solution Architect), after `design-review-engineer.md` (Marcus Oyelaran) and `design-review-security.md` (Tomás Ferreira). Both approved with changes. Nothing changes the authorization design: the allow-list, the whole-response deny, its placement after the shared helper and the empty helper diff all stand.*

| # | Point | Disposition | Where |
|---|---|---|---|
| Eng M1 / Sec B1 | `audit_log.actor_roles` exists and was ignored | **Accepted, option (a).** Both rows write `actor_roles` from one `roles::text[]` read; `actor_idp_roles_include_em` stays as a derived convenience from the same array. Immutable audit rows can't gain fidelity later, and the column's NULL already means "not captured". Migration 22's comment is not edited; `docs/deployment.md` and the `AuditEventName` blocks name the new writers. | D5; spec ADDED req; tasks 1.1, 2.2, 3.3, 5.1, 7.8 |
| Eng M2 | Zero-row role-set read undefined | **Accepted.** `rows.length !== 1` throws → `500`. Keeps vanished identity in the fail-closed set and makes an unrouted fake fail loudly. One unit test. | D5; spec; tasks 2.2, 3.4 |
| Eng M3 | Insert vs timing floor on the `200` path | **Accepted.** Both branches end insert → emit → floor → send; the insert never sits between floor and send. Pinned with `invocationCallOrder`. | D2, D4, D5; spec; tasks 2.2, 2.3, 3.1 |
| Eng M4 | Non-JSON `403` body shows "Network error" | **Accepted.** Guarded parse; a non-JSON test case. | D7; spec topic-management-screen; tasks 6.1, 6.2 |
| Eng S1 | Read the role set once after the predicate | **Accepted.** One read at D2 step 3 on both branches; every admin request has the same three-row prefix. | D2, D4 |
| Eng S2 | Parity fake can pass vacuously | **Accepted.** The fake records the membership role it served; each admin row asserts it. Route-order note. | D6; task 2.4a (was 4.1) |
| Eng S3 | Positional mock queues hide miscounts as fake fail-closed | **Accepted.** New admin describe blocks use SQL-routed `mockImplementation`; injected failures match SQL text. Existing facilitator tests keep queues. | tasks 2.0 (was 3.0), 3.4 |
| Eng S4 | Real-PG `true` case; explicit `roles` in fixtures | **Accepted.** Also asserts `actor_roles`. New helpers write `roles` explicitly (migration 21's fill trigger is slated to go). | task 5.1 |
| Eng S5 / Sec §10 | Pin event payloads | **Accepted.** Exact camelCase key sets for both events; tests assert them and their text-freedom. | D5; spec; tasks 1.1, 3.3 |
| Eng S6 / Sec B2 | Guard check can pass falsely | **Accepted, Security's wider form.** Case-insensitive `audit_log` sweep over `*.ts` (excluding tests and migrations), every hit classified in the PR description; an unfiltered non-admin read blocks the PR. | D5; task 8.3 |
| Eng nit | Type the predicate result into metadata | **Accepted.** | D5; task 2.3 |
| Eng nit | Emit denial event before the insert | **Rejected in favour of D5b.** Gives the same DB-down evidence without giving one event name two orderings. | D5b |
| Eng nit | No statement timeout on the insert | **Accepted as designed.** Fails closed; `withAuditTransaction`'s bound is for write paths. | — |
| Eng nit | Message constants | **Accepted.** | D3; task 2.1 |
| Sec §1, §4, §6, §7, §9 | Placement, timing, nonexistent id, #208 split, frontend | **Agreed, no change** beyond the items below. | — |
| Sec §2 / §8 | Compensating control needs an owner and a query; self-edit follow-up should be filed | **Accepted.** Both queries go in `docs/deployment.md`'s Logging section with a proposed owner; the self-edit issue moves from optional to filed. **Owner needs Brian's confirmation** (Open Questions). | Risks; Open Questions; proposal Follow-ups; tasks 7.8, 8.4 |
| Sec §3a | Default `500` body echoes `err.message` | **Accepted as a follow-up** (root error handler). Pre-existing and app-wide; the spec's "standard error response" wording is corrected to "existing `500` response". | D2; spec; proposal Follow-ups |
| Sec §3b | Failed admin audit write is only a generic error | **Accepted.** New log-only `admin.audit_write_failed` (D5b), SQLSTATE only, never `err.message`. Added to the deployment log-only list. | D5b; spec; tasks 1.1, 2.4, 3.4, 7.8 |
| Sec §3c | D8 "iff" is one-directional | **Accepted.** "If served, recorded"; over-record is the intended direction. | D8; spec team-content-access |
| Sec §5 | Guard generalised beyond the two operations | **Accepted as a follow-up** (`audit-logging-operations`), with the structural-test companion. | proposal Follow-ups |
| Sec §6 suggestion | `team_found` on the access row | **Accepted.** From the existing team lookup, no new query. Access row only: the deny branch runs no team query. | D5, D5a; spec; tasks 2.3, 3.3, 5.1 |
| Sec §7 | `displayOrder` leak and write-audit note in the #208 comment | **Accepted.** | Migration Plan; task 8.4 |
