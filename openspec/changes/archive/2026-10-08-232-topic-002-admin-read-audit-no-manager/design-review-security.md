# Design Review: Security — 232-topic-002-admin-read-audit-no-manager (#232)

*Reviewer: Tomás Ferreira, Senior Application Security Analyst. I raised this as security design review item B2 of #187.*

*Reviewed: `design.md`, `proposal.md`, the four delta specs, `tasks.md`, and GitHub issue #232. I checked them against the code on this branch: `routes/content.ts` (TOPIC-001 and TOPIC-002 handlers, `denyAdminContentAccess`, `fetchConnectionRecoveries`), `auth/standing-facilitator-access-helper.ts`, `auth/team-content-access-helper.ts` (`readActiveMembershipRole`), `routes/topics.ts` (TOPIC-003..007 response shapes), `routes/teams.ts` (admin-read audit precedent), `auth/account-resolver.ts` (`users.roles` write path), `content/timing-oracle.ts`, the global error handler, and migrations 2, 7, 8, 21 and 22.*

## Verdict

**Approve with two required changes (B1, B2).** Both are small. Neither changes the authorization design.

The authorization design is right. The no-manager rule is enforced server-side, on the endpoint that actually serves the definitions. It is an allow-list. It is unconditional, and the membership role is read live. It denies the whole response rather than stripping columns. I checked the write endpoints this change leaves open, and they do not give the dual-hat admin back the definitions through a side door (§7). The gap I raised in #187 is closed by this design.

The two required changes are both about the audit trail. The audit trail is half of what this change is for, so its record shape and its guard check need to be right before the first row is written.

---

## Blocking findings

### B1. Use the existing `audit_log.actor_roles` column, not only a metadata boolean

D5 records the caller's IdP role set as `metadata.actor_idp_roles_include_em: boolean`, taken from a separate `SELECT` on `users.roles`. The proposal attributes that choice to me ("a boolean, not the full role array"), so I am correcting my own call now that I have read migration 22.

Migration 22 (`22_audit_log_actor_roles.sql`, #245) already added `audit_log.actor_roles TEXT[] NULL` as **the** durable place for "the actor's full role set at the time of the operation". Its column comment says it is populated only for the two sign-in operations "as of migration 22", and NULL means "not captured". The design does not mention this column. If we write a parallel boolean into JSONB, we get:

- **Two representations of the same fact.** A forensic query has to know that TOPIC-002 rows keep it in `metadata` and sign-in rows keep it in a column.
- **Lost fidelity that we cannot get back.** Audit rows are immutable. A boolean cannot later answer "was this admin also a facilitator?" or "what exactly did the IdP say?". The proposal argues that "removing a metadata field later is cheap". That is true, but adding fidelity to rows that have already been written is impossible, and that is the direction that matters for audit data.
- **A collapsed unknown.** `false` cannot tell "not an EM" apart from "not known". The spec has to work around this with the backfill caveat (W4). The column's NULL semantics already exist for exactly that purpose.

The full role set is not sensitive in this table. It is the actor's own role set, in a table no non-admin caller reads (B2 keeps it that way).

**Required:**

1. On both new rows, write `actor_roles = users.roles::text[]`, read with the same single `SELECT` the design already plans. Keep `actor_idp_roles_include_em` in metadata as a convenience derived from that same read if the team wants an easy filter. I have no objection to keeping both, but the column is the record.
2. Update the spec's ADDED requirement, D5, and task 2.2/2.3/3.3. The exact key set stays as designed, and the scenarios also assert the `actor_roles` column value.
3. Do **not** edit migration 22's `COMMENT ON COLUMN`, because it is an applied migration. The comment says "as of migration 22", which stays true. Note the new writers in the `AuditEventName` comment blocks instead.

Fail-closed behaviour is unchanged. It is the same read, and if it fails the request is `500`.

### B2. The audit-visibility guard check (task 8.3) can pass falsely

The guard is the control that stops this audit from becoming the surveillance tool it exists to detect, running in the other direction. Proposal review F3 was right to make it checkable. The check as written is `grep -rn "FROM audit_log" packages/backend/src`, and it misses query shapes that will plausibly appear:

- lowercase or mixed case (`from audit_log`)
- the table name on the next line (`FROM\n  audit_log`), the formatting style used throughout this codebase's SQL
- `JOIN audit_log`, a CTE, or a subquery
- an aliased or schema-qualified name (`public.audit_log`)

**Required:** change task 8.3 to `grep -rniE "audit_log" packages/backend/src --include='*.ts'` (excluding `__tests__` and `migrations`). Classify every hit as an INSERT, or as a read that serves an admin or a non-admin caller. Record that table in the PR description. Today that sweep finds the INSERT sites and exactly one read, `fetchConnectionRecoveries` (`content.ts` ~L913), which already filters on equality. So the evidence will be short, and it will be complete.

*Non-blocking companion:* a unit test that asserts this structurally (for example, scanning SQL strings passed to `db.query` in non-admin routes) would turn the guard from a PR-time ritual into a secure default. I won't hold the change for it.

---

## Non-blocking findings and assessments

### 1. Allow-list placement after the shared helper — **agree**

Putting `evaluateAdminTopicConfigRead` after `checkStandingFacilitatorOrAdminAuthorization`, gated on `actorGlobalRole === "application_admin"`, is correct:

- **Facilitators gain no query.** Task 3.6 pins this by SQL text.
- **Order is pinned.** The deny-branch tests use "no `FROM topics` / `FROM teams` / lock query ran" by SQL match, not by mock position. That is the right guard against a refactor that hoists the data reads.
- **The shared helper stays byte-identical** for #208 (task 8.1).
- **No duplicate-row bypass.** `readActiveMembershipRole` takes `rows[0]`. I checked whether a user could hold two active memberships on one team with one `participant` row and one `engineering_manager` row, which would make the result order-dependent. `team_memberships_unique (team_id, user_id)` (migration 2) and `team_memberships_active_unique` (migration 7) rule it out.
- **Global role is read live from the database** by the helper, not from the session. A demoted admin is not admitted on a stale session.

*Residual (accepted):* the helper's read and the membership read are two statements, not one snapshot. A membership change landing between them is decided by the second read. That read is the one that matters, it is a millisecond window, and membership writes are audited in-transaction. No action.

### 2. `actor_idp_roles_include_em` — **agree in substance, superseded in form by B1**

Recording the IdP signal as metadata, and never as an admission input, is right. Migration 21's "nothing reads `roles` for authorization" boundary should hold until there is a team-scoped fact to key on (#238). The false-negative limit is now stated in the spec, with a scenario (W4). That is the honest position.

**Deferred and implicit:** the proposal calls this flag "the visible compensating control" for the dual-hat admin who manages a team without an EM membership on it. A compensating control nobody reviews is not a control. Nothing in the change says who looks at these rows, or when. I recommend a one-line entry in `docs/deployment.md`'s logging section, or in the #238 comment, with the query (`operation = 'admin.topic_config_accessed' AND 'engineering_manager' = ANY(actor_roles)`) and an owner. I am not asking for alerting.

### 3. Fail-closed audit semantics — **agree, with three notes**

The fail-closed set is complete: the membership read, the IdP-role read, the access insert and the denial insert. A failed denial insert can never fall through to `200`, because the data reads sit after the deny branch. That is structural, not a matter of discipline. Scoping the rule to this admin-only read, and explicitly not to live-session paths, is the right call.

- **(a) The `500` body is Fastify's default, not an envelope.** The only `setErrorHandler` (`teams/template-constraint-violation.ts`) rethrows everything except template-constraint violations. Fastify 5's default handler then sends `{ statusCode, error, message: err.message }`, so a pg error string, including table and column names, reaches the client. No topic data can be in it, because metadata is counts only and the deny branch runs no topic query. The spec's phrase "the application's standard error response" is therefore generous. This is pre-existing and app-wide, so it is not this change's job. I would like a follow-up filed for a root error handler that returns the standard envelope with a correlation id and logs the detail server-side.
- **(b) A failed audit write is only visible as a generic error log.** D4 says the missing denial row "shows up in error logs". There is precedent for making this queryable: `auth.audit_write_failed` is a log-only event for exactly this case. I recommend emitting a log-only event (or reusing that shape) on the TOPIC-002 admin arm when the access or denial insert throws, with `{ actorUserId, teamId, operation, reason }` and no topic data. Otherwise "an admin was denied, and the denial wasn't recorded" is something you find with grep, not with a query.
- **(c) D8's "iff" is one-directional in practice.** The design says "the record exists if and only if the data was served". In fact the row can exist when the send fails, for example on a client disconnect after the insert. That is the safe direction (over-record, never under-record), and it is what I want. The wording should just say so.

No statement timeout bounds the plain awaited insert. A hung insert holds the admin's request until the pool or socket gives up. That fails closed, and admin traffic is small. Acceptable.

### 4. Timing floor and enumeration on the new `403` — **agree; the floor here is consistency, not a control**

The new branch runs a membership read, an IdP-role read and an insert before `applyTimingFloor`. If those exceed `TIMING_FLOOR_MS`, the EM-admin `403` is measurably slower than a `NOT_A_FACILITATOR` `403`. I do not consider this an oracle:

- Only an `application_admin` reaches the branch. Admins can already read team existence and every membership through TEAM-003 and the members endpoint, which are audited.
- The branch fires only when the caller holds an EM membership on that team, which they already know.
- Non-admin callers, the population the floor protects against, follow exactly the path they followed before.

Calling `applyTimingFloor` once with the request's start time (W2) is still right for uniformity. Nothing more is needed.

### 5. Audit-visibility guard — **agree with the requirement; see B2 for the check**

The normative text (no non-admin query selects `audit_log` by wildcard, prefix, pattern or `IN` on `operation`) is the right rule. It generalises the comment that already protects `fetchConnectionRecoveries`. One gap: the guard text names only the two new operations. I would accept that for this change, but the rule really protects every `admin.*` and `session.*` row. It is worth lifting into `audit-logging-operations` as a general requirement in a later change.

### 6. Nonexistent team id → `200`, audited — **agree**

There is no new existence oracle. Admins can already list teams, and the facilitator `teamName: ""` behaviour predates this change and is unchanged here. Auditing the attempt beats suppressing it, and `audit_log.team_id` has no FK, so the row is valid.

*Suggestion:* add `team_found: boolean` (from the `teams` lookup the handler already does) to the access row's metadata. Teams can be archived or renamed later. A reviewer looking at a row with all counts `0` should not have to reconstruct whether the id ever named a team. If you take this, update the exact key-set assertion in task 3.3. This is optional. Follow-up 6 (a `404` for unknown ids) is the cleaner long-term fix, and I support filing it.

*Pre-existing, note only:* any admin can mint unbounded audit rows with arbitrary `team_id` values by hammering this GET. That is the same as every other admin read. No rate limit is needed for this change.

### 7. `GET 403 / POST 201` split left to #208 — **accept as a temporary state**

I checked whether the open write half gives the dual-hat admin back what the read half takes away:

- **TOPIC-007** (annotation PUT, the only write that returns `teamAnnotation`) is facilitator-only and rejects admins.
- **TOPIC-003..006** responses carry `id`/`created_at`, `archived_at`, and `name`/`restored_at`. None carries annotation text.
- **Topic ids** are needed for archive, restore and reorder. Once this ships, the EM-admin has no endpoint that returns them: TOPIC-001 denies admins and TOPIC-002 now denies this caller. The reorder `409 TOPIC_ORDER_STALE` is already designed not to be an existence oracle.
- **The residual read** is that POST add's `201` returns `displayOrder`, which reveals the active-topic count. That is low-value, but it is technically "topic configuration" under a content matrix that gives an EM "None".

So the read guarantee ("an EM never sees the team's definitions") holds after this change. The open half is a **blind shaping** channel, not a read channel. The design and the Executive review are both right that it is the worse half from the room's point of view, but it is not a confidentiality gap in this change. Please add two lines to the #208 comment (task 8.4): the `displayOrder` count leak, and the fact that an EM-admin's topic writes are already audited in-transaction (`topic.custom_added`, `topic.archived`, ...). That second fact is the stop-gap #208 relies on. I support scheduling #208 in the current milestone.

### 8. Self-demotion edge — **accept, but make the follow-up real**

An admin can edit their own membership from EM to participant (or remove it), read, and restore it. Every step is audited, so it is not silent. But nobody will find it unless someone runs the correlation query: `team.role_changed` or a removal where `actor_user_id = target_user_id`, followed by `admin.topic_config_accessed` for the same team. Proposal follow-up 3 is marked "optional, Security's call". My call is that it **should be filed**, as an issue to bar an admin from changing their own membership role on a team, or failing that to require a second admin. Until that ships, the correlation query goes beside the one in §2. It doesn't block this change.

### 9. Frontend rendering of `error.message` — **no concern**

The messages are server-side constants, and React renders them as text. Keeping the "Topics" link visible, with the server as the only gate, is the right posture. A client-side role guess would be UX pretending to be access control.

### 10. Structured event payloads

Task 3.3 asserts the exact metadata key set on the **row**. The matching `emitAuditEvent` payload goes to application logs, which have a wider audience than `audit_log`. Assert its key set too, and assert that it carries no annotation text, topic names or topic ids. That is a one-line addition to the same tests.

---

## Deferred or implicit security decisions (for the record)

| Item | Status | Owner / where |
|---|---|---|
| Admin-writes for an EM-member admin (TOPIC-003..006) | Deferred, explicit | #208 (schedule this milestone) |
| Dual-hat admin managing a team with no EM membership | Deferred, explicit; compensating control is audit metadata | #238; **review owner/query is implicit, see §2** |
| Admin self-edit of own membership role | Deferred, "optional" | **File it** (§8) |
| Non-admin TOPIC-002 `403`s unaudited under SEC-13 | Deferred, explicit | Proposal follow-up 5 |
| `404` for unknown team ids | Deferred, explicit | Proposal follow-up 6 |
| Fastify default `500` body leaks `err.message` | **Implicit**, pre-existing | New follow-up (§3a) |
| Failed admin audit write not queryable | **Implicit** | §3b, recommend in this change |
| Audit-visibility guard generalised beyond two operations | **Implicit** | Later `audit-logging-operations` change (§5) |

---

## Summary for the change owner

**Blocking:**

- **B1.** Write `audit_log.actor_roles` (migration 22's existing column) on both new rows. Keep the boolean only as a derived convenience.
- **B2.** Widen task 8.3's guard check to a case-insensitive `audit_log` sweep that is classified per hit.

**Non-blocking, recommended in this change:**

- a log-only event when a TOPIC-002 admin audit insert fails (§3b)
- the event-payload key-set assertion (§10)
- D8 wording: the record exists *if* the data was served, not *iff* (§3c)
- the optional `team_found` metadata flag (§6)

**Non-blocking, follow-ups:**

- file the admin self-edit issue (§8)
- a root error handler returning the standard envelope (§3a)
- name an owner and query for the `actor_roles`/self-demotion review (§2, §8)
- add the `displayOrder` leak and the write-audit note to the #208 comment (§7)

I agree with the allow-list placement, the whole-response deny, fail-closed scoped to this endpoint, the timing-floor treatment, the nonexistent-id decision, and the #208 split as a temporary state.
