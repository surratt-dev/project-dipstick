# Security Review: #264 TOPIC-002 non-admin denial audit

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Reviewed: design.md (D1-D10), proposal.md, tasks.md, both delta specs, exploration notes, and the existing `fail-open-audit-write.ts` / `docs/deployment.md` audit sections.

**Verdict: APPROVED to start implementation (gate 0.1 satisfied for P1), with the conditions in section 6.** None of the conditions needs a design redo. The rulings below are the written decisions; please paste P1 into design.md D3/D4 and the spec paragraph so the "PENDING" markers are removed.

---

## 1. Explicit rulings

### P1. Fail-open vs fail-closed on the denial path: RULING = FAIL-OPEN

Ruled fail-open for both failure points (denial-path role-set read, denial-path insert). The 403 stays a 403 in every case.

Reasoning:
- Fail-closed buys nothing here. In #232 the 500 existed to stop data leaving unaudited. On a denial no data leaves; the request is already refused. Converting the 403 to a 500 does not strengthen the access decision, it only changes which error a refused (or legitimately mis-routed) caller sees.
- A 500 where a 403 is correct is an oracle. Under fail-closed, an attacker who can degrade the DB or audit table can distinguish "denied" paths by status; and a member-facilitator gets a misleading error during a blip.
- Fail-closed would make `audit_log` availability a precondition for a rejection. That is the wrong dependency direction: audit availability must not be able to alter an authorization outcome in either direction.
- The "detection value of the no-manager rule" dissent (D3) is real but does not carry fail-closed: the denial still happened and was still enforced; what is lost under fail-open is a record of one attempt during an incident, and the failure event (with actor and team) preserves that in logs.
- Issue #264 item 3 is headed "Fail closed" while its text recommends fail-open. Record the discrepancy in D3 as the design already proposes. Issue heading loses to issue body and to this ruling.

Role-set read failure (D4): RULING = write the row with `actor_roles = NULL`, emit the denial event with `actorRoles: null`, plus one `topic.audit_write_failed` (`stage: "role_set_read"`). Rejecting the BA's skip-the-row alternative: NULL is defined as "not captured" (migration 22), so the row is truthful, and dropping who/team/reason/when over a secondary column would make the audit blinder than the fault warrants. If the insert also fails: no row, two failure events (as specified).

Timeout behaviour: RULING = accept the single shared `AUDIT_WRITE_TIMEOUT_MS` (500 ms) budget, insert gets the remainder. Conditions that are hard requirements (already in the spec; I am confirming them as security conditions, not rationale):
1. 403 byte-identical (status, Content-Type, body) on every failure path.
2. Failure event never carries `err.message`/`err.detail`.
3. Scope of fail-open is exactly those two steps. Anything else that throws on the denial path stays 500.
4. The admin arm stays fail-closed, with both asymmetric behaviours pinned by tests.
5. Timeout must bound the *wait*; see Finding F2 on the abandoned query still holding a pool connection.

### P2. Log-only detectability of audit-write failure: RULING = ACCEPTED for this change

Accepted, on these terms:
- `topic.audit_write_failed` is emitted at error (or at minimum warn) level, not info, so it survives any plausible level filter. State the level in the `audit-logger.ts` comment.
- `docs/deployment.md` states plainly: log-only, no consumer, tracked by #131; operators who care must grep for it. (Task 4.1 covers this.)
- This is a *residual risk acceptance*, not a closure. #131 stays open and is cited in the PR. This change must not be cited as evidence that audit-failure alerting exists.
- Compensating signal worth recording: the admin arm of the same endpoint inserts into the same `audit_log` table and fails closed (500). A sustained audit-table outage therefore surfaces to users as admin-read 500s even though no alert exists. It is weak, but it means the failure mode is not completely silent.
- The "audit is selectively blind during an incident" risk is acceptable because the attack it hides (a probe of a 403 during a DB fault) yields the attacker nothing: the answer is 403 either way.

### Keep the durable `FACILITATOR_IS_TEAM_MEMBER` row: CONFIRMED (keep)

Rejecting the VP Engineering request to drop it. Reasons: (a) it is the only record that the structural no-manager rule fired, so omitting it makes the audit selectively blind per reason, and D1 correctly refuses reason-dependent "audit or not" branches; (b) the issue ACs require it; (c) the row records an actor, a team id and an enum, never content, and the actor is acting on their own membership. Conditions: labelled informational in code, spec and deployment docs (already planned); excluded from any future alerting or per-user aggregation; and see Finding F1 on the "administrators only" wording, which as written is inaccurate and must be corrected because it is the privacy answer being given to the VP.

---

## 2. Findings

**F1 (must fix, wording): "readable by administrators only" is not true as stated.** D9, the proposal and the spec say the rows are admin-only. No endpoint or screen serves them to anyone, including administrators. They are readable by whoever has database or log-sink access. The privacy answer to Rachel/VP should say: "no application endpoint or screen reads these rows; access is database operators only." Correct the three places. This is a smaller promise than the one made and the one we can actually keep.

**F2 (should fix, DoS amplification): denial path becomes a DB write reachable by the lowest-privilege authenticated user.** Before: a denial was cheap. After: each denied request is one role read plus one insert. Two sub-issues:
- Pool pressure: `withTimeout` bounds the wait, but (as in `writeFailOpenAuditRow`) the underlying `db.query` is not cancelled; during a slow DB, repeated denials hold connections for longer than the 500 ms. Existing exposure of every fail-open audit path, but this is the first one reachable by a participant in a loop on a read endpoint. Acceptable because it needs an authenticated session and is attributable, but record it in the risks.
- Table growth: see section 4 (rate limiting).

**F3 (should fix): failure event omits `reason`.** On insert failure no denial event is emitted and no row exists, so the only record of the attempt is `topic.audit_write_failed`, which pins keys `actorUserId, teamId, endpoint, operation, stage, errorCode, failureMode`. That records who/where but not which rule fired. Add `reason` (closed enum, content-free) to the failure event's pinned key set. If rejected, I accept as-is; the loss is minor.

**F4 (verify, timing): confirm where the floor clock starts.** The floor protects against variable-duration work before the response. D7 orders audit work before `applyTimingFloor`, which is correct only if `applyTimingFloor` measures from request start (or from before the helper), so audit latency is absorbed rather than added. Add an assertion (fake timers): a denial whose helper + audit total 20 ms still responds at ~150 ms, not 170 ms. Today call-order tests would not catch a floor that starts after the audit.

**F5 (verify): `actor_ip` provenance.** `request.ip` is only trustworthy if Fastify `trustProxy` is configured to the real proxy hops. If it trusts arbitrary `X-Forwarded-For`, an attacker controls the IP written into a security audit row (spoofing and log pollution). Confirm the existing config (same source as `admin.topic_config_accessed`, so no new exposure) and note the result in the PR. Also confirm the column accepts a bounded string; the insert is parameterised, so there is no SQL injection.

**F6 (informational): attacker-chosen `team_id`.** `audit_log.team_id` has no FK and stores the validated requested UUID, so an authenticated user can seed rows under arbitrary team ids. Not injection (canonical UUID only, malformed ids 404 with no row), but a per-team audit view for a real team can contain rows triggered by a participant of another team, and rows for nonexistent teams. Document that `team_id` on this operation is "requested id", not "verified team". The design already chooses this deliberately to avoid an existence oracle; I endorse that choice.

---

## 3. Checks requested

| Check | Result |
|---|---|
| Timing: denied vs existing/nonexistent team | Pass. No `teams` read and no existence check, so there is nothing for timing to distinguish. Both reasons do identical work (role read, insert, event). |
| Timing: missing users row skips the role read | Pass, with F4. The shorter path is under the 150 ms floor and only reflects the caller's own state anyway. |
| Timing: slow DB makes denial exceed the floor | Accepted, as the design states (D7). It leaks nothing about other users' or teams' state; it is a DB-incident symptom. |
| Timing: insert never between floor and send | Pass; call-order test (3.1) covers it. |
| Differing messages between reasons | Pre-existing, and discloses only the caller's own membership status. No change. |
| Metadata leakage | Pass. Row metadata is exactly `{endpoint, http_status, reason}` (constants and a closed enum); no team name, topic, annotation, definition. No-leak test 3.5 and "no query on teams/topics/annotations" test 2.3 are the right controls. `err.message` excluded from failure events. |
| Audit-log injection | Pass. Every value is a constant, a closed enum, a canonical-validated UUID, the session user id, or `request.ip` (F5). Parameterised insert; `JSON.stringify` on a fixed-shape object. |
| Response must not reveal auditing | Pass. Snapshot test plus "no header/field mentions auditing" covers it. Commit the baseline first (task 0.2): good discipline. |
| No new non-admin read path | Pass in design; strengthen per F1 and the sweep below. The spec's equality-on-one-operation rule and the 3.8 sweep are adequate interim evidence until #262. The sweep must also cover raw SQL in migrations/views/materialised views and any generic "audit export" or log-search route, not only `routes/` handlers. |
| Admin arm unchanged | Pass. Fail-closed stays, and the no-users-row path must not call the throwing `readActorRoleSet` (D2). Good catch. |
| Admitted callers pay nothing | Pass; test 3.4. |

## 4. Rate limiting and volume (audit-log DoS)

Question: does repeated denial writing rows need rate limiting?

**Ruling: not required to ship this change, but it is accepted residual risk with a mandatory follow-up, not a non-issue.**
- Exposure: any authenticated user (no privilege needed) can loop `GET /teams/:id/topics/all` and write one row per request. At ~300 bytes a row and a few hundred requests per second, that is gigabytes per day of table growth plus WAL. Real, but: authenticated only (an IdP account), every row is attributable by `actor_user_id` and `actor_ip`, and the account can be disabled; and there is no unauthenticated reach.
- Why not dedup here: D1's "no dedup" is correct. Per-actor dedup silently blinds the audit exactly under probing, and the spec scenario "repeated denials write repeated rows" is the control. I will not trade detection for volume in this change.
- Required follow-ups (file as issues, cite numbers in the PR): (1) bounded volume control for denial rows using the episode shape already used by `topic.write_rate_limited` (first breach in a window writes a row; later ones are counted in a log event); this needs Redis, and the fail-open/closed behaviour of that limiter must be decided there, not here; (2) add a documented `audit_log` growth/retention statement and a query for top-N denial writers to `docs/deployment.md` so an operator can spot a flood.
- Before merge: check whether an edge or global per-IP/per-user limit already covers this route (the only limiter found in the codebase is the Topic write limiter, which does not cover this GET). State the answer in the PR.
- Mitigation already present: the shared 500 ms budget stops a slow table from stacking unbounded waits on the response path.

## 5. Threat model delta

| Threat | Before | After |
|---|---|---|
| Probing topic config by non-facilitators / global EMs (no-manager rule bypass attempts) | Undetectable | Durable, attributable, content-free record |
| Existence/enumeration oracle on team ids | None | None (no team lookup, same 403, same floor) |
| Information disclosure via audit rows | n/a | None in row/event; only exposure is DB/log-sink access (F1) |
| Audit table flood by an authenticated low-privilege user | n/a | New, low-medium, mitigated by attributability, follow-up required (section 4) |
| Audit-write fault changing authz outcome | n/a | Prevented: response always 403; denial can never become 200 |
| Attacker-controlled IP in audit row | Existing via admin arm | Same exposure, unchanged (F5) |
| Pool pressure from abandoned timed-out queries | Existing on other fail-open paths | Extended to a participant-reachable path (F2) |
| Privacy profiling of member-facilitators | n/a | Low: actor/team/reason only; no UI, aggregation or alerting; any change requires re-consulting VP Engineering (D9, keep) |

## 6. Conditions of approval

Blocking before implementation merge:
1. Replace the PENDING markers in D3/D4/D5 with the rulings above, and add the issue-heading discrepancy note.
2. Correct the "administrators only" wording (F1) in design D9, the proposal and the spec requirement to "no application endpoint or screen reads these rows; database/log-sink access only".
3. Add the floor-clock assertion (F4) to task 3.1/3.3.
4. State the `request.ip` / `trustProxy` check and the existing edge rate-limit answer in the PR (F5, section 4).

Non-blocking but required before closing the issue:
5. Add `reason` to the failure event key set (F3).
6. Failure event level documented as error/warn (P2).
7. File the volume-control follow-up and the deployment-doc growth note (section 4); cite their numbers in the proposal beside the P5 placeholder.
8. Visibility sweep (3.8) includes migrations, views, export/search routes and log-sink access, not only handlers.

Residual risks accepted by Security: log-only audit-failure detectability (#131); unbounded-but-attributable denial row volume until the follow-up lands; pool pressure from abandoned timed-out queries on this path.
