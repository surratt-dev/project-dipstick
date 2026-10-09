# Implementation Review: Security — 232-topic-002-admin-read-audit-no-manager (#232)

*Reviewer: Tomás Ferreira, Senior Application Security Analyst.*

*Reviewed: the working-tree diff on `agent-team/232-topic-002-admin-read-audit-no-manager` (`routes/content.ts`, `auth/audit-logger.ts`, `TopicManagementPage.tsx`, `content.test.ts`, `topic-add-flag-parity.test.ts`, `topic-annotation-integration.test.ts`, the new `topic-002-admin-audit-integration.test.ts`, `TopicManagementPage.test.tsx`, `TeamPage.test.tsx`, `docs/deployment.md`, the REST API Contract), plus `handoff-drafts.md`. I checked these against `design.md` and my `design-review-security.md`. I also read the unchanged code they depend on: `standing-facilitator-access-helper.ts`, `readActiveMembershipRole`, `parseRoleArray`, `emitAuditEvent`, `fetchConnectionRecoveries`, and the TEAM-005 role-change insert. I re-ran the audit-visibility sweep myself.*

## Verdict

**Approve. I found no blocking issues.** The authorization and audit behaviour matches the design. Both of my design-review blockers are closed. B1: `actor_roles` is written on both rows from a single `roles::text[]` read. B2: the sweep was run in its wide form and every hit is classified. The tests would catch the regressions that matter. The non-blocking items below are about hardening and documentation accuracy.

---

## Verification of the focus areas

### 1. Admission allow-list (`evaluateAdminTopicConfigRead`)

The predicate is correct, and it is an allow-list. It returns `admitted: true` only for `null` and `"participant"`, and `engineering_manager` maps to `membership_em`. Every other string falls through to `membership_unrecognised`. It is pure and synchronous, it is not exported, and no flag, env or config read can change its result. The admitted branch's type is `null | "participant"`. That type flows into `adminAudit.membershipRole` and from there into the metadata, so the compiler guarantees that an access row can never record `engineering_manager`.

`readActiveMembershipRole` reads `role` filtered on `removed_at IS NULL`, live and uncached. The unique constraints from migrations 2 and 7 still rule out the `rows[0]` ordering ambiguity I checked at design review.

### 2. Ordering relative to the shared helper

The order is canonical-UUID check → `checkStandingFacilitatorOrAdminAuthorization` → (admin only) membership read → predicate → role-set read → deny branch or data reads. The shared helper's diff is empty. Facilitators never reach the membership or role-set read, and test 3.6 pins this by SQL text: exactly one `team_memberships` query, the helper's LEFT JOIN, and zero `roles::text[]` queries. The parity test's `servedMembershipRoles` assertion separately proves that non-admin callers trigger no membership-role read.

### 3. No topic queries on the deny branch

The deny branch returns before `SELECT name FROM teams`, the active, archived and default topic reads, and the lock-state call. The handler has exactly one `send` of `responseBody`, and no early return sits between the admin arm and the access insert, so no path sends data without passing the insert. `expectNoTopicTeamOrLockQuery` checks every recorded SQL string for `FROM topics`, `FROM teams` and the lock `COUNT(*)`, matching on text, never on mock position. It also asserts `getTopicLockState` was not called. The real-Postgres test checks that the 403 body contains no seeded names, definitions or topic ids.

### 4. Fail-closed on every audit or role-read failure

| Failure | Result | Data exposed | `admin.audit_write_failed` | Test |
|---|---|---|---|---|
| membership read throws | 500 | none (before any data read) | not emitted (by design) | 3.4 |
| role-set read throws (admit path) | 500 | none (before any data read) | `role_set_read`, SQLSTATE | 3.4 |
| role-set read throws (deny path) | 500, never 403/200 | none | `role_set_read`, `operation: denied` | 3.4 |
| role-set read returns 0 rows | 500, no default to `false` | none | `role_set_read`, `errorCode: null` | 3.4 |
| `parseRoleArray` rejects (e.g. missing cast) | 500 | none | `role_set_read`, `null` | real-PG cast proof (5.1) |
| denial insert throws | 500, never 200 | none (structural) | `audit_insert` | 3.4 |
| access insert throws | 500 | none sent (data read but not sent) | `audit_insert` | 3.4 |

`withAdminAuditFailureSignal` rethrows the original error in every case. No path catches it and carries on.

### 5. `actor_roles` population

Both inserts write `actor_roles` last as `$7::text[]`, following the `insertSignInAuditRow` pattern. The value comes from one `SELECT roles::text[] AS roles FROM users WHERE id = $1` per request, validated by `parseRoleArray`. `actor_idp_roles_include_em` is derived from that same frozen array, so the two values cannot disagree. Neither is used for admission, so migration 21's boundary still holds. Real Postgres checks that the column decodes to `["application_admin","engineering_manager"]`, which is the only real proof that the cast is right.

### 6. Audit metadata is text-free

Both metadata objects and both event payloads are built from literals, counts, booleans, the typed reason, the membership role, ids of the actor and team, and the role array. No topic-row field reaches them. Tests 3.3 assert the exact sorted key sets of both rows and both events, assert exact values, and search the serialized row and event for the definition sentinels, topic names and topic ids. Real Postgres repeats the sentinel search on stored metadata.

### 7. `admin.audit_write_failed` carries only SQLSTATE

The payload is `{ actorUserId, teamId, endpoint, operation, stage, errorCode }`, and `errorCode` is `err.code` only if it is a string, otherwise `null`. Neither `err.message` nor `err.detail` is touched. The test injects an error whose `message` and `detail` contain "boom" and "leaked", then asserts the payload with `toEqual` and checks that neither string is present. That test fails if anyone adds a message field.

### 8. Timing-floor ordering

Both branches end with insert → event → `applyTimingFloor` → send. `expectAuditTailOrder` pins this with `invocationCallOrder` on the 200 path (no membership) and the 403 path (EM), using an `onSend` hook as the send marker. The deny test also asserts that the floor received the request's `startTime`. The extra admin-arm latency before the floor is the residual I accepted at design review (§4).

### 9. Frontend 403 handling

On a 403, `loadTopics` parses the body defensively (`res.json().catch(() => null)`), shows `body.error.message` only if `hasEnvelopeMessage` holds (a string `message`), and otherwise shows the fixed fallback. React renders it as text. The `if (error)` render returns before any `data`-dependent markup, so even stale `data` in state cannot render. The tests cover an envelope body, JSON without a message, HTML and an empty body. Each asserts the exact text, no network-error text, no topic name, no definition block, and zero buttons and textboxes. The "Topics" link is not hidden by any client-side role guess.

### 10. Audit-visibility sweep classification

I re-ran `grep -rniE "audit_log" packages/backend/src --include='*.ts' | grep -v -e __tests__ -e /migrations/`. It returns **129** hits, matching the PR draft. I compared the table in `handoff-drafts.md` against the sweep line by line with a script: **no missing lines and no extra lines.** Excluding comment lines and lines containing `INSERT INTO audit_log` leaves exactly one hit, `content.ts:1172`. That is `fetchConnectionRecoveries`, which filters `operation = 'session.connection_recovered'` by equality. The classification is accurate. There are no SQL views anywhere in the repo, so no read reaches `audit_log` under another name. A dynamically built table name would get past any grep. The drafted structural-test follow-up (issue 9) is the real control for that.

### 11. Would the tests catch a regression?

| Regression | Caught by |
|---|---|
| Allow-list turned into a deny-list (`!== "engineering_manager"`) | 3.2 (`observer` → 403) |
| Data reads moved ahead of the admin check | EM 403 test + 3.2 + 3.4 (SQL-text "no topic/team/lock query") |
| Admin arm moved ahead of the shared helper | 3.6 facilitator (no membership/role-set query); parity `servedMembershipRoles` |
| Rule moved into the shared helper (writes change) | parity row `{get:403, post:201}`; real-PG TOPIC-004 regression |
| Audit made conditional (template team, unannotated, dedup) | 3.5, 3.5a |
| Audit failure swallowed (fail-open) | 3.4 (all six cases assert 500) |
| Insert moved after the floor | `expectAuditTailOrder` on both branches |
| Annotation text, topic name or id added to metadata or event | exact key sets + sentinel search (unit and real PG) |
| `err.message` added to the failure event | `toEqual` on payload + "boom"/"leaked" search |
| `::text[]` cast dropped | unit regex on SQL + real-PG array decode |
| Zero-row role read defaulted | 3.4 zero-row test |
| Client-side role guess hides the link | `TeamPage` test comment only (weak; acceptable) |

The SQL-routed fixture records unrouted SQL and fails in `afterEach`, which closes the "exhausted mock queue looks like fail-closed" trap the engineer raised.

---

## Non-blocking findings

### N1. The admin arm is opt-in by string equality (hardening, recommended)

```ts
if (decision.actorGlobalRole === "application_admin") { ...admin arm... }
```

`StandingFacilitatorOrAdminDecision.actorGlobalRole` is typed `string`. Today the helper authorizes only `facilitator` and `application_admin`, so this is correct. #208 will reopen that helper, though. If a later change ever authorizes a third role, or returns the admin role under a different spelling, that caller gets a 200 with no no-manager check and no audit row, and no test fails. The secure default is the reverse: name the known non-audited case and fail closed on anything else. For example: `facilitator` → skip; `application_admin` → admin arm; anything else → `throw` (500). Alternatively, narrow the decision's type to a literal union so the compiler forces the question. This is cheap, and it fits "controls that don't depend on discipline". I would take it in this change, but I won't hold the merge for it. If it is deferred, add one line to the #208 comment draft.

### N2. "A removal is itself an audited membership write" is not true today (docs accuracy)

D5a and `docs/deployment.md` review query 2 both refer to a "membership-removal row". The backend has no application path that sets `team_memberships.removed_at` (`grep` finds only TEAM-005's `UPDATE team_memberships` role change). So a removed membership can only come from direct database access, and no `audit_log` row records it. The handler's behaviour stays correct, because a removed membership is no membership. Two corrections are needed:

- **`docs/deployment.md` query 2:** drop "or membership-removal row", or mark it as not yet applicable. Write the self-demotion correlation as SQL, because the columns exist (`team.role_changed` writes `target_user_id`). For example: `operation = 'team.role_changed' AND actor_user_id = target_user_id AND metadata->>'from_role' = 'engineering_manager'`, joined to a later `admin.topic_config_accessed` row on the same `actor_user_id` and `team_id`. A review query written only in prose will be run inconsistently or not at all.
- **D5a wording** (or the PR description): say that removal is out-of-band today and therefore unaudited at the application layer. Database-level access control is the control for that, not this change.

### N3. The 500 body still echoes `err.message` (pre-existing, follow-up drafted)

This is unchanged and already tracked as drafted follow-up 8. For the record: in the unit fail-closed tests the injected message ("boom: row value leaked-sensitive-detail") does reach the 500 body. The tests correctly don't assert otherwise, because that is today's app-wide behaviour. No topic data can reach that path. The error-handler follow-up should be filed, not left as a draft.

### N4. Test nits

- `FORBIDDEN_STRINGS` in the #232 unit block omits the team name ("Platform Squad"). On the 500 paths, the team name is the only other datum the handler holds after the reads. Adding it would cost one line.
- No real-Postgres case covers fail-closed (for example, an `audit_log` insert rejected by a temporary trigger). The unit coverage is thorough and SQL-routed, so I accept this.
- The `TeamPage` "link stays visible" guard is a comment on an existing test, not an assertion tied to an admin or EM caller. That is acceptable, because a hidden link is UX, not a control.

### N5. Review-query owner

`docs/deployment.md` lists me as the "proposed" owner, monthly, with no alerting. I'm willing to take it. Brian still needs to confirm it, as the hand-off says. Once N2's query is concrete SQL, I can actually run it.

---

## Summary

**Blocking:** none.

**Non-blocking, recommended in this change:**
- N1: make the admin arm fail closed on an unexpected `actorGlobalRole` (or narrow the type).
- N2: fix the "membership-removal row" claim and write review query 2 as SQL.
- N4: add the team name to `FORBIDDEN_STRINGS`.

**Non-blocking, follow-ups:**
- N3: file the root error-handler issue.
- N5: owner confirmation (Brian).
- N1, if deferred: note it in the #208 comment.

Confirmed correct: the allow-list, its placement after the shared helper (helper diff empty), no topic, team or lock query on the deny branch, fail-closed on all four audit and role-read failures plus the zero-row case, `actor_roles` from a single cast read, text-free metadata and events with exact key sets, a SQLSTATE-only failure signal, insert → event → floor → send on both branches, no data rendered after a frontend 403, and an accurate, complete sweep classification (129 of 129 hits, one equality-filtered non-admin read).
