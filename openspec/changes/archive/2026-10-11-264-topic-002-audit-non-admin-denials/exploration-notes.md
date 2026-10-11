# Exploration notes: 264-topic-002-audit-non-admin-denials (#264)

*Devon Calloway (Internal Champion). Revised after the Facilitator (Priya Nair) and BA (Marcus Delgado) reviews. Sources: issue #264 and its comment, `routes/content.ts` (TOPIC-002 ~L739-1039), `auth/audit-logger.ts`, `auth/standing-facilitator-access-helper.ts`, `auth/fail-open-audit-write.ts`, `content/timing-oracle.ts`, `migrations/8_audit_log.sql`, `migrations/22_audit_log_actor_roles.sql`, `frontend/src/pages/TeamPage.tsx`, `docs/deployment.md`, archived #232, BRD SEC-13.*

Status key: **FACT** = checked against code or migrations in this revision. **DECISION** = stated outcome the proposal carries. **PENDING** = needs a named person's written answer before specs are drafted.

## 1. What is actually being asked

BRD SEC-13 (BRD.md L576) requires "access control denials" to be captured in the audit log. TOPIC-002 serves the Topic Management screen, including `team_annotation` ("our team's definition"). Two 403s leave no durable trace today: `NOT_A_FACILITATOR` (participants, global EMs, anyone who is not facilitator/admin, and a missing user row) and `FACILITATOR_IS_TEAM_MEMBER` (the facilitator-from-another-team rule). Admin reads are audited (`admin.topic_config_accessed`); denials are not. A global EM poking at a team's topic-configuration screen leaves nothing.

**What SEC-13 does and does not mandate.** SEC-13 says denials "must be captured". It does not say "durable row" and it does not say "fail-closed". A durable `audit_log` row plus a structured event is the design choice this change makes to satisfy it; the proposal says so and does not cite SEC-13 as mandating the shape.

**Scope statement (goes in the proposal verbatim in spirit).** This change covers two denial reasons on one endpoint. It does **not** close the SEC-13 gap for topic endpoints generally. Out of scope, with owners: TOPIC-001 (log-only, decided in #187), TOPIC-003..007 (#208), login failures (separate SEC-13 item), the malformed-id 404 (below), alerting or aggregation on denial rows, and any UI change.

## 2. Ritual constraints in play

- **No-manager rule (candour).** Engineers write annotations for whoever they think reads them (#232 proposal). The EM denial is the control; the audit row is evidence the control is being tested. Today TOPIC-001's equivalent is at least log-only while the more sensitive TOPIC-002 is silent.
- **Facilitator-from-another-team.** `FACILITATOR_IS_TEAM_MEMBER` is the structural rule firing. It is also the benign, regular case (section 5, link behaviour). The two reasons carry different meaning and the spec says so: `NOT_A_FACILITATOR` is the probing signal; `FACILITATOR_IS_TEAM_MEMBER` is informational.
- **Not a performance tool.** The row records who tried, never what was behind the door. REQUIREMENT, in testable form: no non-admin API endpoint returns rows of operation `topic.config_list_denied`. See section 3 (guard facts). The row reveals only that the actor attempted access, never content, and no user-facing view surfaces it to the team.
- **No surveillance in the room.** REQUIREMENT (accepted from the Facilitator review): participants and facilitators are never shown that an access attempt was recorded. No banner, toast, response field, or "this has been logged" text, ever. Candour depends on it.
- **Constraint stays structural.** Nothing here makes a denial configurable or skippable. Auditing never changes the decision: a denial never becomes a 200 under any failure mode.
- **No alerting is delivered.** Nothing in this change aggregates, detects patterns, or alerts on denial rows. Earlier wording ("a pattern of these is a signal") described why the rows are worth keeping, not a feature. See also the monitoring fact in section 4.

## 3. Verified facts

### 3.1 `audit_log.team_id` has no foreign key (FACT; closes the earlier "most likely real bug")

`migrations/8_audit_log.sql`: `team_id UUID` is nullable with no `REFERENCES`. No later migration adds a constraint (21, 22, 23 touch it only by adding `actor_roles` and inserting rows). `audit-logger.ts` already records this for `topic.write_rate_limited`: "team_id is the lowercase path value, never checked against teams ... team_id has no FK". Consequences:

- A denial for a canonical UUID that names no team inserts normally. No existence check is needed or wanted (an extra query on the denied path would only add a timing/oracle surface).
- DECISION: `team_id` stores the requested team id as the route validated it. The requested id is retained only in the `team_id` column, not in metadata (metadata keys are exact, section 6).
- The admin arm's `team_found` metadata is not needed here: the denial path never reads `teams`.
- Acceptance: a participant requesting a random valid UUID gets the same 403, exactly one row is written with that `team_id`, and no failure event is emitted. Runs against real Postgres.
- The authorization helper reads `users` and `team_memberships` only, never `teams` or any soft-delete flag, so a deleted, inactive, or nonexistent team produces the same denial as any other. The denial applies before any team lookup. State this in the spec.

### 3.2 Missing users row and `'unknown'` (FACT)

- `actor_global_role` is `TEXT NOT NULL` with no enum and no CHECK (migration 8; `audit-logger.ts` comments describe it as TEXT "for audit durability"). `'unknown'` is accepted. It is the existing convention: `routes/facilitator-sessions.ts` writes `?? "unknown"` for the missing-row case at about seven call sites (including the `session.advance_denied_role` denial row), and `realtime/connection-reauthorization.ts` does the same.
- `actor_roles` is `TEXT[] NULL`, and migration 22's column comment defines NULL as "the actor's role set was not captured for this operation. It does not mean the actor had no roles." That is exactly the missing-user-row meaning.
- `readActorRoleSet` (`content.ts` ~L233) is typed for the admin arm and **throws on zero rows** by design ("never default"). For a missing user row that throw is guaranteed, so it must not be called there.
- DECISION: for a missing user row, write `actor_global_role = 'unknown'` and `actor_roles = NULL`, skip the role read entirely, and do not count it as an audit failure and do not emit the failure event. The admin arm's throwing read is unchanged.
- Acceptance: integration test, no users row for the session user: 403, one row with `actor_global_role='unknown'` and `actor_roles IS NULL`, zero failure events. (Practically unreachable because session middleware guarantees a row, but the test must hit it.)

### 3.3 Helper and live role (DECISION: option (a), no second read)

`checkStandingFacilitatorOrAdminAuthorization` returns `{ authorized: false; reason }` only; the denied decision carries no role. The helper already holds `grant.globalRole` and `grant === null` (no user row). DECISION: extend the denied variant additively with `actorGlobalRole: string | null` (`null` = no users row; the handler maps it to `'unknown'`). No extra query, no second read of a live value that could disagree with the decision's read.

- REQUIREMENT: the recorded `actor_global_role` equals the role used to make the authorization decision.
- Acceptance: a test where the decision's role is X records X; TOPIC-003..007 tests pass unchanged (the field is additive; their behaviour must not change). The Architect confirms the type change; it is a ruling on form, not a reopened choice.

### 3.4 Timing (FACT)

`TIMING_FLOOR_MS = 150` (`content/timing-oracle.ts`; a production guard warns if it stays at the default). Today both 403 reasons, and the 404 for a malformed id, answer at about the floor. REQUIREMENT: on the denial path the order is role read (if applicable) -> insert -> event -> `applyTimingFloor` -> send. The insert is never between the floor and the send. Applies to both reasons and to the audit-failure path. Acceptance: call-order test, plus a failure-path test showing the floor still applies. The earlier speculation about relative query counts is dropped; the floor is the mechanism. An admitted facilitator or admin executes no additional query (the work lives inside `if (!decision.authorized)`).

Known limit, stated not hidden: with fail-open the write is bounded by `AUDIT_WRITE_TIMEOUT_MS` (500 ms, `audit-write-timeout.ts`), which is longer than the 150 ms floor. A hanging database can therefore make a denial slower than the floor. That is a database incident, the same exposure every fail-open audit path in the codebase already has, and it is accepted.

### 3.5 Guard (#262) and other audit_log reads (FACT)

#262 is OPEN. The structural test it describes does not exist yet. What exists today is a spec rule in `openspec/specs/team-content-access/spec.md` ("every audit_log query serving a non-admin caller filters operation by equality on one named operation") and one non-admin read, `fetchConnectionRecoveries` (`content.ts` ~L1113), which filters by equality on `session.connection_recovered`. So nothing needs registering in a guard. DECISION: the requirement is the spec rule applied to the new operation, verified by a sweep recorded in the PR description (as #232 did); the structural test stays #262's. Acceptance: the sweep shows no new `audit_log` read; the existing rule's wording covers `topic.config_list_denied` by name in the spec.

### 3.6 Failure-signal precedent and monitoring (FACT)

- Fail-open audit writes already exist: `auth/fail-open-audit-write.ts` (`writeFailOpenAuditRow`, 500 ms bound, emits log-only `auth.audit_write_failed`) and `session-invalidation-audit.ts`. Log-only failure events deliberately have no DB row.
- `admin.audit_write_failed` is admin-named and typed to the admin operation union (`withAdminAuditFailureSignal`, `content.ts` ~L206); `auth.audit_write_failed` is typed to the auth group with `authSessionId`. Neither fits a non-admin topic denial; reusing either mislabels it.
- `docs/deployment.md` states that **no `AuditEventName` signal is consumed by any alert rule, anomaly job, or dashboard** (#131, open). A log-only failure event here is therefore detectable, not alerted. That is the honest state of the codebase and this change does not fix it (see Pending P2).

### 3.7 Link behaviour (FACT)

`TeamPage.tsx` (~L138) renders the "Topics" link for every viewer of the team, by design (remove-topic Decision 10: discoverability for a facilitator who inherits a team; "the server gates"). The page loads membership and team data already, so it could know. See section 5.

## 4. Fail-open vs fail-closed

Two failure points, both on the denial path only: the `users.roles` read and the `audit_log` INSERT. Constant across both options: **the 403 is never converted to a 200.** The only question is whether a failed audit write yields 403 (fail-open) or 500 (fail-closed).

**Case for fail-closed (500):** matches the #232 admin arm and the durable denials (`team.role_change_denied` throws -> 500); one simple rule; SEC-13's value is that nothing slips through unrecorded, and an attacker who can induce write failures gets unrecorded denials; a 500 discloses nothing.

**Case for fail-open (403 + failure event):** what is audited is a rejection, not a disclosure. In #232 the 500 stopped unaudited data leaving the building; here no data leaves. A participant or member-facilitator hitting a legitimate 403 during a DB blip would see an error state instead of the correct "no access"; a 500 where a 403 is correct is also an oracle ("the denial path ran an insert"). The codebase has an established fail-open audit pattern (3.6). If the DB is down enough to fail the insert, the next request fails regardless.

**Position (Devon; Tomas owns the call): fail-open on the response, loud on the signal.** Both conditions are REQUIREMENTS, not rationale:

1. A failed role read or insert still returns the 403 with a byte-identical status, message, and body, emits exactly one log-only failure event per failing step, and leaks no `err.message`. Name: **`topic.audit_write_failed`** (non-admin, non-auth, one name for the topic family). Event keys, exactly: `actorUserId`, `teamId`, `endpoint`, `operation` (`topic.config_list_denied`), `stage` (`"role_set_read"` or `"audit_insert"`), `errorCode` (SQLSTATE or `null`), `failureMode` (`"error"` or `"timeout"`). Never `err.message`, `err.detail`, team name, or topic data.
2. The fail-open scope is exactly: the denial-path role read and the denial-path insert, together bounded by `AUDIT_WRITE_TIMEOUT_MS`. Anything else that throws (the helper itself, for example) stays 500 as today. The timing floor still applies on the failure path.

**Role-read failure behaviour (DECISION, and a respectful departure from the BA's suggestion).** The BA recommends skipping the row when the role read fails. I recommend writing the row with `actor_roles = NULL` and emitting the failure event with `stage: "role_set_read"`. Reason: migration 22 defines NULL as "not captured", so the row is not misleading; the evidence that matters for SEC-13 is who, which team, which reason, when, from where, and dropping that to save a secondary column makes the audit blinder than the fault warrants. If the insert also fails, a second event with `stage: "audit_insert"` is emitted. Pinned by a test either way. If Tomas prefers the BA's skip-the-row rule, it is a one-line change to the spec and not a constraint question.

**Asymmetry with #232 is recorded in the spec with reasons** (admin read = disclosure = fail-closed; non-admin denial = no disclosure = fail-open) so nobody "fixes" it later in either direction. Tests pin it.

Honest dissent: if Tomas treats denial rows as carrying the detection value for the no-manager rule, fail-closed is defensible and costs little, because a real EM or participant sees a 500 only during a DB incident. What tips it for me is the benign member-facilitator path, a regular, legitimate 403.

## 5. Facilitator-review items: disposition

| Item | Disposition |
|---|---|
| Member-facilitator case is regular, not an edge (obs 1, 2) | Accepted as fact. The earlier "follow-up if rows show it's common" is withdrawn: the link is always rendered (3.7), so benign rows are expected by construction. The proposal says the benign rate equals "every time a member-facilitator opens that team's page". |
| Hide or disable the Topics link for `FACILITATOR_IS_TEAM_MEMBER` | **Out of scope for #264** (this change adds an audit write; it touches no UI). Not left as a "consider": the proposal names it as a follow-up and links an issue. **Action:** the team files the follow-up issue before the proposal is accepted and cites its number in the proposal (I have not filed it; filing is the team's step). Pushing a frontend change into an audit change would widen scope and bundle two reviews. |
| Do not write a durable row for `FACILITATOR_IS_TEAM_MEMBER`, or lower its severity | **Declined, with reasons.** It is the structural rule firing, SEC-13 asks for denials, and a reason-dependent "audit or not" branch makes the audit selectively blind and adds a code path to test. One operation, no dedup, `reason` carries the distinction. To be confirmed by Security (P1), and the spec states why it is kept. |
| Expected vs unexpected distinguished | Accepted. Spec: `FACILITATOR_IS_TEAM_MEMBER` is informational and `NOT_A_FACILITATOR` is the probing signal; any future review treats them so and never alerts on `FACILITATOR_IS_TEAM_MEMBER` volume. No alerting is delivered now (section 2). |
| Same message, status, latency for member-facilitator; audit failure invisible to her | Accepted as spec scenarios: same 403, same message, same body before and after; audit failure does not change what she sees; the denial is not slower than the floor in the normal path. Frontend still ignores the body and shows a fixed string; that is preserved, not silently. |
| Improve denial copy for the member-facilitator | **Named as a known gap**, not changed here: the server body is pinned byte-identical and the frontend string is a separate small change. It joins the link follow-up issue. |
| Member-facilitator has no route to the definitions she needs to prepare | Not verified here and not this endpoint's job to change (the rule is by design). Passed to Product as a question; if there is a gap it belongs in the follow-up issue, not in #264. |
| Who reads these rows? | P3 below. |
| Failed audit write pages someone? | Fact in 3.6: nothing alerts on any audit signal today (#131). Stated, not solved here. |
| Session-flow endpoints untouched | Accepted. The proposal states that voting, reveal, readiness, and pacing are untouched and that no live-session endpoint changes. |
| Never show the room that an attempt was recorded | Accepted (section 2). |
| Usability pass with Priya | Accepted as a release check: a member-facilitator opens their own team page, clicks Topics, and confirms the experience is unchanged (same message, no new delay). Her offer is taken. |

## 6. Requirements and row/event shapes

Two separate lists, asserted by exact equality in tests, not by inclusion.

**Row (`audit_log`), columns:** `actor_user_id`, `actor_global_role` (`'unknown'` if no users row), `actor_ip`, `operation = 'topic.config_list_denied'`, `team_id` (requested id), `metadata`, `actor_roles` (`text[]`, or NULL: missing users row or role-read failure). **`metadata` exactly:** `{ endpoint: TOPIC_002_ENDPOINT, http_status: 403, reason: "NOT_A_FACILITATOR" | "FACILITATOR_IS_TEAM_MEMBER" }`.

**Denial event (log), keys exactly:** `actorUserId`, `actorGlobalRole`, `actorIp`, `teamId`, `endpoint`, `httpStatus`, `reason`, `actorRoles`. Emitted only when the row was written, so event and row stand or fall together; otherwise only the failure event (section 4) is emitted.

**Failure event (log-only):** keys in section 4.

**Requirements (SHALL):**
1. On a TOPIC-002 denial with either reason, write exactly one row as above. No dedup: two requests give two rows, intended.
2. The row is written before the response and before the timing floor.
3. Neither row nor event contains team name, topic name or id, or annotation text, and none of that data was read on the denial path. The test asserts that no such query ran, not only that fields are omitted.
4. The 403 status, message, and body are unchanged, including on audit failure (snapshot-style, byte-identical).
5. A role-read or insert failure still returns that 403 and emits the failure event per section 4. (Subject to P1.)
6. An admitted facilitator or admin request executes no additional query.
7. No non-admin API endpoint returns `topic.config_list_denied` rows (3.5).
8. No UI, banner, or response text discloses that an attempt was recorded.
9. Unauthenticated callers never reach this branch (session middleware); this is not a login-failure audit.

## 7. Other design decisions

- **One operation.** `topic.config_list_denied`, `reason` in metadata. Do not reuse `topic.config_read_denied_role` (TOPIC-001, log-only). Name stays (renaming is churn). Acceptance: the `audit-logger.ts` comment on `topic.config_list_denied` states "durable" and names `topic.config_read_denied_role` as the log-only sibling.
- **Volume.** Denied callers produce at most one request per page load (refetch-after-write only happens for admitted callers). Benign `FACILITATOR_IS_TEAM_MEMBER` rows are expected noise (5); any future review is built with that in mind.
- **Malformed-id 404 not audited: a scoped decision, recorded.** It is a denial of a kind, but no team is named and it is outside this change's two reasons. Not audited here.
- **Admin arm unchanged.** No `admin.*` row on a non-admin denial. In `team-content-access` the scenario line "no `admin.*` audit row is written (... does not decide SEC-13 auditing of non-administrator denials)" must be reconciled: keep the admin assertion, remove the SEC-13 non-goal sentence, and add the new durable-row assertion.
- **Docs task.** `docs/deployment.md`: add `topic.audit_write_failed` to the log-only list and update its event counts, and keep the "no monitoring consumer" note (#131). The denial row is durable, so no other deployment doc change.
- **Constants.** `endpoint` and `http_status` reuse `TOPIC_002_ENDPOINT` and the literal 403.

## 8. Test-plan additions (from the BA review)

- Facilitator-role user with an active membership: `FACILITATOR_IS_TEAM_MEMBER`, not `NOT_A_FACILITATOR` (reason precedence follows the helper: global role `facilitator` and member).
- Caller with no role and no membership: `NOT_A_FACILITATOR`.
- Same caller twice: two rows.
- Nonexistent, deleted, or inactive team id: denial applies first, row written (3.1).
- Missing users row (3.2).
- Forced insert failure; forced role-read failure; forced timeout: 403, byte-identical body, floor applied, exactly one failure event per failing step, no leaked message.
- TOPIC-003..007 unchanged after the helper's additive field.
- Sweep: no new non-admin `audit_log` read (3.5).

## 9. What could go wrong

- Insert after the floor reveals the branch by timing. Test call order.
- Reusing `topic.config_read_denied_role` mixes durability semantics.
- Calling the throwing `readActorRoleSet` for a missing row turns a denial into a false audit failure (3.2).
- Helper change accidentally altering TOPIC-003..007. Keep it additive and run their tests.
- Stretching `admin.audit_write_failed` or `auth.audit_write_failed` over a topic denial mislabels any future alert.
- The row becoming a profiling instrument. Actor/team/reason only, visibility-guarded, no aggregation delivered.
- Scope creep into TOPIC-001 (#187), TOPIC-003..007 (#208), the Topics link, and the denial copy. Out of scope; named follow-ups instead.
- Message or body drift on the 403. Pin with a snapshot assertion.

## 10. Open items needing a named answer before specs are drafted

- **P1, Security (Tomas), in writing:** fail-open versus fail-closed on the denial audit (section 4), whether the benign `FACILITATOR_IS_TEAM_MEMBER` row earns a durable row (5), and role-read failure: NULL `actor_roles` (my pick) or skip the row (BA's).
- **P2, Security:** the failure-signal "SLA". Fact: nothing alerts on any audit signal today (#131). Either accept log-only detectability for this change or tie it to #131. This change delivers no alerting.
- **P3, Product:** who consumes denial rows? If no one, say so; the value is then post-hoc reconstruction only, which is the SEC-13 rationale ("post-hoc incident reconstruction and anomaly detection"). Also the member-facilitator content-route question (5).
- **P4, Architect:** rule on the additive `actorGlobalRole: string | null` field on the denied union (3.3). Form only.
- **P5, team:** file the follow-up issue for the Topics link and member-facilitator denial copy, and cite its number in the proposal.

Resolved by verification (no longer open): `audit_log.team_id` FK (none, 3.1); `'unknown'` column constraint (none, 3.2); missing-row `actor_roles` handling (NULL, 3.2); #262 guard registration (nothing to register, 3.5); `docs/deployment.md` (log-only list, a task, 7).

## 11. Recommendation

Proceed, lightweight-pipeline size, once P1 is answered. Position: durable row plus denial event, single operation with `reason`, fail-open on the response with a distinctly named log-only failure event (`topic.audit_write_failed`), additive `actorGlobalRole` on the denied decision, NULL `actor_roles` where the role set is unknown, and the asymmetry with #232 written into the spec. The only point that touches the ritual's intent: the audit remains evidence about access attempts, never about what the team wrote, and the room is never told it is being watched. I do not need to be the help desk on any of the rest.
