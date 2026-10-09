# Hand-off drafts: 232-topic-002-admin-read-audit-no-manager (#232)

Drafts for a human or the orchestrator. **Nothing here has been posted, filed or opened.** No `gh issue comment`, `gh issue create` or `gh pr create` was run by the implementing agent. Posting, filing and opening the PR are the human's (or the orchestrator's) step; the orchestrator opens the PR.

---

## 1. Comment on #208 (draft)

> **TOPIC-002 now applies the no-manager rule; TOPIC-003..006 do not (yet).**
>
> Change `232-topic-002-admin-read-audit-no-manager` (#232) makes `GET /api/v1/teams/:teamId/topics/all` (TOPIC-002) deny an `application_admin` who holds an active `engineering_manager` membership on the team (`403`, "Topic configuration for this team isn't available to its engineering manager."). It also audits every admin read (`admin.topic_config_accessed`) and every such denial (`admin.topic_config_denied`).
>
> It deliberately does **not** change the topic-write endpoints. The shared helper `checkStandingFacilitatorOrAdminAuthorization` has an empty diff, so the same caller today gets:
>
> - `GET …/topics/all` → `403`
> - `POST …/topics` (TOPIC-003) → `201` (and likewise TOPIC-004/005/006 admit them)
>
> This split is recorded as an explicit row, with a comment pointing here, in `packages/backend/src/routes/__tests__/topic-add-flag-parity.test.ts` ("application_admin with an engineering_manager membership", expected `{ get: 403, post: 201 }`).
>
> **Request:** please schedule #208 in the current milestone. The split is meant to be a temporary state, not a resting one. The half still open is arguably the worse half: a manager who can add, archive and reorder their own team's topics through the API is shaping what the team talks about. If #208's outcome touches who can shape a team's topics, please take the decision to the executive sponsor. (Scheduling is the owner's call; this is a request, not a decision.)
>
> Two facts for whoever decides #208:
>
> - (a) POST add's `201` response returns `displayOrder`, which reveals the team's active-topic count to an EM-admin. It's a low-value residual read, but it is a read.
> - (b) An EM-admin's topic writes are already audited in-transaction (`topic.custom_added`, `topic.archived`, `topic.restored`, `topic.reordered`, attributed to `actor_global_role = 'application_admin'`). That is the stop-gap #208 relies on until it is decided.
> - (c) If #208 changes the shared helper so it authorizes any role other than `facilitator` or `application_admin`, TOPIC-002 fails closed on it (`assertTopic002AuthorizedRole` in `routes/content.ts` throws, `500`, before any data read). That is deliberate: the admin arm is TOPIC-002's only audited path, so a new authorized role must be given an explicit branch there rather than falling through unaudited.
>
> This comment doesn't recommend an answer for #208.

---

## 2. Comment on #238 (draft)

> When reporting chains land, please revisit TOPIC-002 admission (#232). Today the no-manager rule keys only on the admin's **membership** role on the team. A dual-hat admin whose IdP role set includes engineering manager, but who holds no EM membership on that team, is still admitted. Until reporting chains exist, the compensating control is:
>
> - `audit_log.actor_roles` on every `admin.topic_config_accessed` / `admin.topic_config_denied` row (the caller's `users.roles` at request time; `metadata.actor_idp_roles_include_em` is derived from it), and
> - the two review queries in `docs/deployment.md` ("Logging" → "Review queries"): admin topic-configuration reads where `'engineering_manager' = ANY(actor_roles)`, and the self-demotion correlation.
>
> Known limit: users who haven't signed in since #245 still have the backfilled `{application_admin}`, so `false` doesn't prove the absence of a manager role.

---

## 3. Follow-up issue bodies to file (drafts)

### 3a. (Follow-up 3, **file**, not optional) Bar an admin from changing their own membership role on a team, or require a second admin

> **Context:** #232 (Security design review §8). TOPIC-002 denies an `application_admin` with an active `engineering_manager` membership on the team. Such an admin can change their own membership to `participant` through TEAM-005 (the membership role-change endpoint) and then read the team's topic configuration. That isn't silent: the role change writes an in-transaction `audit_log` row plus `team.role_changed` (with `actor_user_id = target_user_id`), and each later read writes `admin.topic_config_accessed` with `membership_role: "participant"` (and `actor_roles` containing `engineering_manager` if they have signed in since #245). But it is a self-service bypass of the no-manager rule.
>
> There is no application path that removes a membership (nothing sets `team_memberships.removed_at`). A removal can only happen by direct database access, which writes no `audit_log` row; database-level access control is the control for that.
>
> **Proposal:** reject a membership role change (and any future removal endpoint) where the actor is the target (`actor_user_id = target_user_id`) for an `application_admin`, or require a second administrator to approve it.
>
> **Until this ships:** the correlation query in `docs/deployment.md` ("Review queries", item 2) is the compensating control.

### 3b. (Follow-up 8, **file**, not optional) A root error handler that returns the standard envelope

Security's implementation review (N3) asks for this to be filed as an issue, not left as a draft: in #232's fail-closed unit tests the injected error message does reach the `500` body.

> **Context:** #232 (Security design review §3a; implementation review N3). Fail-closed paths (including TOPIC-002's administrator arm) answer `500` through Fastify's default error handler, which echoes `err.message` in the body. A pg error message can echo row values. No topic data can reach it on the #232 paths, but this is app-wide and pre-existing.
>
> **Proposal:** register a root `setErrorHandler` that answers `500` with the standard error envelope (`{ error: { category, message, correlationId } }`) and a generic message, and logs the error detail (including pg `code`/`detail`) server-side under the same correlation id.

### 3c. (Follow-up 9, file) Generalise the audit-visibility guard in `audit-logging-operations`

> **Context:** #232 (Security design review §5). The `team-content-access` spec now requires every `audit_log` query serving a non-admin caller to filter `operation` by equality on one named operation. #232 verified this by a manual sweep (see the PR description's classification table). It applies only to the TOPIC-002 operations today.
>
> **Proposal:** lift the guard into the `audit-logging-operations` capability as a general rule for every `admin.*` and `session.*` operation, and add a structural unit test that scans `packages/backend/src` for `audit_log` reads (case-insensitive, multi-line SQL, `JOIN`, CTEs, subqueries, schema-qualified names) and fails on any non-admin read without a single-operation equality filter.

---

## 4. Optional follow-ups (not drafted; the human decides)

- **4.** Machine-readable `code` on forbidden envelopes, contract-wide. Optional, not drafted.
- **5.** Audit TOPIC-002's pre-existing non-admin `403`s (`NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER`) under SEC-13. Optional, not drafted.
- **6.** `404` for a canonical UUID that names no team on TOPIC-002 (and TOPIC-001). Optional, not drafted. The REST API Contract's TOPIC-002 `404` row now states the actual behaviour (malformed id → `404`; well-formed unknown id → `200` empty, audited for admins) and points here (Architect implementation review N1).

---

## 5. PR description (draft)

> ### TOPIC-002: no-manager rule on the administrator arm, and an audit row for every admin read (#232)
>
> Closes #232.
>
> **What changes**
>
> - `GET /api/v1/teams/:teamId/topics/all` (TOPIC-002) now denies an `application_admin` whose live active membership role on the team is anything other than absent or `participant` (allow-list). An `engineering_manager` membership gets `403` "Topic configuration for this team isn't available to its engineering manager."; any other value gets "Topic configuration for this team isn't available to you." The deny path runs no topic, team-name or lock-state query.
> - Every admin `200` writes one durable, text-free `admin.topic_config_accessed` `audit_log` row and event. Every no-manager `403` writes one `admin.topic_config_denied` row and event. Both write `actor_roles` from `users.roles` (`roles::text[]`). Both branches end insert → event → timing floor → send.
> - Fail closed: a failed membership read, role-set read (including zero rows) or insert is `500` with no data. A failed role-set read or insert also emits the log-only `admin.audit_write_failed` (SQLSTATE only, never `err.message`).
> - Facilitator paths are unchanged and gain no query.
> - Any authorized role other than `facilitator` or `application_admin` fails closed (`500`, before any data read), so a role the shared helper starts admitting later (#208) cannot reach the data unaudited.
> - The Topic Management screen renders the server's `403` message (defensive parse; a non-JSON `403` shows the existing fallback, not "Network error").
> - Contract, BRD, use case and `docs/deployment.md` updated (including the "Review queries" compensating control).
>
> **AC1 is met by a recorded deviation: Q1 decided independently of #208 (owner decision, proposal §Decision recorded).**
>
> **TOPIC-003..006 unchanged (8.1 evidence).** `git diff --stat main -- packages/backend/src/auth/standing-facilitator-access-helper.ts packages/backend/src/routes/topics.ts` is empty. The resulting `GET 403 / POST 201` split for an EM-admin is recorded in `topic-add-flag-parity.test.ts` with a comment citing #208.
>
> **`teams.ts` admin reads (8.2 evidence).** The modified `team-content-access` wording says admin reads write their row after the data read and before the send, not in a transaction, failing closed. Both existing admin reads in `packages/backend/src/routes/teams.ts` already comply. Each is an awaited, uncaught `db.query("INSERT INTO audit_log …")` before the send, with no `try`/`catch` in either handler:
>
> - `admin.membership_list_accessed`: insert at L433–445 (SQL at L434, operation at L441), event at L447, `reply.send` at L463.
> - `admin.team_detail_accessed`: insert at L592–607 (SQL at L593, operation at L600), event at L609, `reply.send` at L631.
>
> **Audit-visibility guard (8.3).** `grep -rniE "audit_log" packages/backend/src --include='*.ts' | grep -v -e __tests__ -e /migrations/` → 129 hits, all classified below. There is exactly one `audit_log` read, and it serves a non-admin (facilitator) with an equality filter on one named operation. No non-admin read lacks a single-operation equality filter.
>
> | File | Lines | Classification |
> |---|---|---|
> | `auth/session-invalidation-audit.ts` | 10, 56 | comment / identifier only |
> | `auth/session-invalidation-audit.ts` | 49 | INSERT |
> | `auth/join-link-creation.ts` | 50 | INSERT |
> | `auth/audit-logger.ts` | 7, 13, 19, 34, 39, 42, 59, 66, 77, 81, 95, 101, 129, 134, 158, 160, 186, 200, 224, 250, 263, 276, 285, 288, 310, 377, 389, 407, 420, 436, 456, 499, 508, 538, 547, 555, 564, 565 | comment / identifier only |
> | `auth/team-content-access-helper.ts` | 188 | comment / identifier only |
> | `auth/audit-write-transaction.ts` | 40 | comment / identifier only |
> | `auth/fail-open-audit-write.ts` | 19 | comment / identifier only |
> | `auth/fail-open-audit-write.ts` | 51 | INSERT |
> | `content/team-content-serializers.ts` | 313 | comment / identifier only |
> | `realtime/connection-reauthorization.ts` | 30, 88 | comment / identifier only |
> | `realtime/connection-reauthorization.ts` | 94 | INSERT |
> | `realtime/websocket-routes.ts` | 269, 363 | comment / identifier only |
> | `realtime/websocket-routes.ts` | 289 | INSERT |
> | `realtime/connection-token-refresh.ts` | 55 | comment / identifier only |
> | `realtime/connection-token-refresh.ts` | 130 | INSERT |
> | `teams/template-team-guard.ts` | 109 | comment / identifier only |
> | `teams/template-team-guard.ts` | 156 | INSERT |
> | `routes/join-links.ts` | 212 | comment / identifier only |
> | `routes/join-links.ts` | 231 | INSERT |
> | `routes/em-views.ts` | 53, 481, 719 | comment / identifier only |
> | `routes/em-views.ts` | 119, 374, 511, 724, 786, 890 | INSERT |
> | `routes/content.ts` | 64, 1160 | comment / identifier only |
> | `routes/content.ts` | 87, 272 | INSERT |
> | `routes/content.ts` | 1172 | read serving a non-admin (facilitator): `fetchConnectionRecoveries`, filter `operation = 'session.connection_recovered'` (equality, one named operation). **Passes.** |
> | `routes/topics.ts` | 222, 1587 | comment / identifier only |
> | `routes/topics.ts` | 235, 283, 977, 1198, 1368, 1569, 1809 | INSERT |
> | `routes/action-items.ts` | 263, 288, 570, 657, 696 | comment / identifier only |
> | `routes/action-items.ts` | 291, 608, 699 | INSERT |
> | `routes/facilitator-sessions.ts` | 100, 410, 472, 615, 744, 941, 1047, 1200, 1557, 1716, 2243, 2295 | INSERT |
> | `routes/facilitator-sessions.ts` | 445, 977, 1697 | comment / identifier only |
> | `routes/teams.ts` | 434, 593, 811, 942, 1117, 1283 | INSERT |
> | `routes/teams.ts` | 590, 933, 934, 1014, 1078 | comment / identifier only |
> | `routes/topic-write-context.ts` | 12 | comment / identifier only |
> | `routes/auth.ts` | 65, 90, 367, 428, 917 | comment / identifier only |
> | `routes/auth.ts` | 99, 101, 946 | INSERT |
> | `routes/sessions.ts` | 165, 216, 483 | INSERT |
> | `routes/sessions.ts` | 424 | comment / identifier only |
>
> **Compensating-control review owner:** proposed: Security (Tomás Ferreira), monthly, no alerting. **Proposed, pending Brian.**
>
> **Optional follow-ups (optional, not drafted):** 4 (machine-readable `code` on forbidden envelopes), 5 (audit TOPIC-002's non-admin `403`s under SEC-13), 6 (`404` for an unknown team id).
>
> **Release-note gate:** #187 Follow-up 5's release-note line stays blocked until this merges. Approved wording once merged: "Engineering managers, including administrators who manage the team, cannot read the team's definitions." (It must not claim that managers cannot change topics; that stays untrue until #208 is decided.)
>
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## 6. Human steps (open decisions, not agent work)

- **(a)** Brian confirms the review-query owner and cadence (proposal follow-up 10). Proposed: Security (Tomás Ferreira), monthly, no alerting. The PR may merge with "proposed", but not with the line missing (it is present in `docs/deployment.md`).
- **(b)** Brian either accepts the AC1 deviation sentence in the PR description or amends AC1 on #232 (follow-up 7).
- **(c)** After merge, unblock #187 Follow-up 5's release note with the approved wording. The agent edited no release notes in this change.
- **(d)** Decide whether to schedule #208 in the current milestone.
- **(e)** Post the #208 and #238 comments (sections 1 and 2) and file issues 3, 8 and 9 (section 3).
