# Proposal Review (BA): 264-topic-002-audit-non-admin-denials

*Reviewer: Marcus Delgado, Business Analyst. Reviewed: proposal.md, design.md, tasks.md, both delta specs, issue #264 (body and comment), BRD SEC-13 (BRD.md L576, L798).*

## Verdict

Approve with required changes. The intent is clear and traceable to SEC-13. Most capabilities can be built as written. The blockers are (1) three issue acceptance criteria that no task or capability covers, (2) the delta spec is copy-pasted in several places so some requirements have the wrong scenario attached, and (3) the fail-open/fail-closed decision contradicts the issue text and is still "pending", so the spec is not yet implementable as a settled contract.

## 1. Issue AC coverage

| Issue AC | Covered? | Where / gap |
|---|---|---|
| Exactly one `audit_log` row per denial, agreed operation, columns, exact metadata key set, plus one event with pinned keys | Yes | spec "writes one durable row", "exactly three keys", "denial event pairs with the row". |
| Unit: call order insert < event < floor < reply | Yes | tasks 3.1, spec timing scenario. |
| Unit: fail-open/closed behaves as decided | Partial | Depends on P1, still pending. See section 3. |
| Unit: admitted facilitator runs no added query (match on SQL text) | Partial | Spec has the scenario; tasks 2.3 says "confirm" but no test task in section 3 names it. Add a test task. |
| Unit: nothing in row or event contains team name, topic names/ids, annotation text | Partial | Spec requirement exists; no task in 3.x asserts it on both row and event. Add one. |
| Integration: participant, global EM with participant membership, member facilitator, each one row with right `reason` and `actor_roles` | **No** | Task 3.3 lists only random-UUID/inactive-team and missing-users-row cases. The three named cases are absent. Add them. |
| 403 status/message/body unchanged | Yes | spec + task 3.1 snapshot. |
| Specs updated | Yes | |
| **REST API Contract TOPIC-002 updated** | **No** | Issue AC and issue item 5 require it. Not in proposal Impact, not in tasks section 4. Add a task (Authorization / Notes audit sentence). |
| **`openspec validate --strict` passes** | **No** | Not in tasks. Add. |
| Audit-visibility guard (#262) still holds | Partial | Spec names the operation; D8 notes #262's guard does not exist yet. State the interim check (the sweep in 3.5) is the acceptance evidence. |
| **`npm run lint`, `npm run test`, `npm run build` pass** | **No** | Not in tasks. Add as a release gate task. |
| Issue item 4: facilitators unaffected | Yes | "Admitted callers pay nothing". |
| Issue item 5: `docs/deployment.md` only if log-only | Yes | task 4.1. |

## 2. Delta spec defects (must fix before implementation)

The `topic-customization-lock` delta reuses the same scenario text under unrelated requirements. An implementer or a verifier cannot tell what each requirement is supposed to prove.

- "Denial row metadata has exactly three keys": scenario duplicates the participant scenario. Acceptable but should assert both reasons and the literal `endpoint` string.
- "The denial event pairs with the row": the scenario is the insert-failure scenario. It never asserts the success-path event key set (`actorUserId`, `actorGlobalRole`, `actorIp`, `teamId`, `endpoint`, `httpStatus`, `reason`, `actorRoles`). Add: on a successful denial, exactly one `topic.config_list_denied` event with exactly those keys.
- "The denial path reads no team content": scenario is "team id that names no team". That does not prove no content is in the row or event. Add a scenario asserting no `teams`/topics/annotations query and no such strings in row or event.
- "Reason labelling": scenario is the member-facilitator scenario; nothing tests labelling. The requirement is also untestable as written ("no review or alert SHALL treat its volume as a signal"). Reword as a documented property: the audit-logger comment and `docs/deployment.md` label `FACILITATOR_IS_TEAM_MEMBER` informational. Test = that text exists.
- "Fail-open stays distinct from fail-closed admin": scenario is the denial insert-failure scenario only. Add the paired admin scenario (admin insert fails, response 500, no data) so "tests pin both" is real.
- "Denial rows are never exposed": scenario is "Nothing tells the room". Wrong scenario. Replace with the equality-on-single-operation query check.
- "Nothing tells the room it was recorded": "the frontend rendering contain no statement" is not testable by a backend test. Name the check (frontend grep for audit/logged wording, or drop the frontend clause since there is no frontend change).
- Missing scenarios: insert timeout (spec text mentions it, only "fails or times out" in one scenario, fine, but no separate timeout assertion that floor still applies); both role read and insert fail (expect two events, row not written, 403).

## 3. Vague or underspecified language

1. **Fail mode contradiction.** Issue body item 3 is headed "Fail closed" yet recommends fail open. Proposal chooses fail-open "pending Security". The spec states fail-open as a SHALL. Until P1 is resolved in writing, the key behaviour (403 vs 500 on audit failure) is not a settled requirement. Condition: do not start implementation until Tomás Ferreira's answer is recorded in design.md; record it in the spec as the issue demands.
2. **"AUDIT_WRITE_TIMEOUT_MS bounds the role read and insert together"** (spec) vs "per step" (D3, tasks 2.2). Decide: one shared 500 ms budget, or 500 ms each (worst case 1 s). Concrete condition: shared budget, the insert gets the remainder, a test with a role read taking 400 ms and an insert hanging asserts total latency <= 500 ms + floor tolerance.
3. **"Timing floor still applies"** when the audit already took 500 ms: floor is a minimum, so it is a no-op. State this ("floor is a minimum; no additional wait after an audit that exceeded it").
4. **"byte-identical to the unaudited behaviour"**: no baseline exists after the change. Define the baseline as a committed snapshot (status, `Content-Type`, body JSON string) taken before the edit, for both reasons.
5. **`actor_roles` "equal to the stored role set"**: state type and ordering (`text[]` as returned by `roles::text[]` and `parseRoleArray`, order as stored).
6. **`actor_ip` source** is never defined. Say "same source as `admin.topic_config_accessed` rows in the same handler".
7. **"emitted only when the row was written"** conflicts with nothing, but clarify the role-read-failure case: row IS written (NULL roles), so the denial event IS emitted with `actorRoles: null`, plus one failure event. State it, and state which key value the event carries.
8. **Missing users row**: how can an authenticated session lack a `users` row? Say what produces it (deleted user with live session) so the integration test builds the right fixture.
9. **"Benign volume ... expected noise by construction"** and **"more sensitive than TOPIC-001"** are assertions without evidence. Keep the first (it is testable via the integration test and release check); soften or substantiate the second.
10. **Retention/growth** of `audit_log` from the per-page-open `FACILITATOR_IS_TEAM_MEMBER` rows is not considered. At minimum state "no retention change; volume = member-facilitator page loads" and ask Product (P3) to confirm.
11. **"SEC-13 satisfied"**: the BRD says "access control denials" generally and the stated purpose (BRD L798) includes anomaly detection. The proposal correctly disclaims detection, but the spec sentence "satisfies SEC-13 for these two reasons on this endpoint only" should be softened to "closes the SEC-13 gap for ..." and the remaining gaps (TOPIC-001 #187, TOPIC-003..007 #208, 401/404) should be listed with issue numbers so traceability does not stop here.

## 4. Suggested concrete conditions per capability

**topic-customization-lock: durable row per denial**
- Given a participant, EM, or member-facilitator is denied, then exactly one row where `operation = 'topic.config_list_denied'`, `team_id` = requested id, `actor_user_id` = caller, `metadata` deep-equals `{endpoint, http_status: 403, reason}`.
- Reason precedence: `global_role = 'facilitator'` plus active membership gives `FACILITATOR_IS_TEAM_MEMBER`; every other non-admin, non-facilitator gives `NOT_A_FACILITATOR`; a facilitator who is not a member is admitted and writes nothing.
- Same caller twice gives two rows.

**Row columns**
- `actor_global_role` equals `decision.actorGlobalRole`, `'unknown'` when null; `actor_roles` is the stored array or NULL when absent or read failed; no read of `teams`.

**Event**
- On success: one event, exact key set above. On insert failure: zero denial events, one `topic.audit_write_failed` with `stage="audit_insert"`, `errorCode` SQLSTATE or null, `failureMode` `error|timeout`, no `err.message`.

**Ordering and response**
- Mock call log order: role read, insert, event, floor, send. 403 status and body match committed snapshots for both reasons, on success and on failure paths.

**No-cost for admitted callers**
- SQL-text-routed fixture shows zero queries against `audit_log` or the role read for an admitted facilitator or admin beyond the pre-change set.

**Failure mode (after P1)**
- Fail-open: forced role read failure gives 403, row with NULL roles, one failure event. Forced insert failure/timeout gives 403, no row, one failure event. Admin insert failure still gives 500 with no data.

**team-content-access reconciliation**
- Grep of the merged spec shows the "does not decide SEC-13 auditing" sentence is gone, the admin assertion remains, and the guard names `topic.config_list_denied`.

**Visibility**
- Sweep result (task 3.5) lists every `audit_log` read and its operation filter; only `fetchConnectionRecoveries` serves non-admin, filtered by equality.

## 5. Process and traceability notes

- Open decisions P1 to P5 are all unowned by name in the proposal text ("Security", "Architect") and the proposal says P5 must be resolved "before this proposal is accepted". Name the people (Tomás Ferreira for Security per the issue) and make P1 and P4 blocking for implementation start; P2, P3, P5 may follow.
- The release check (usability pass with Priya) is a good acceptance gate. Add the concrete pass condition: same message text, response time not visibly different.
- Zero-impact on ritual: no concern raised about the simultaneous reveal or facilitator surface; the change does not touch them.

## 6. Required changes summary

1. Add tasks for: REST API Contract TOPIC-002 update, `openspec validate --strict`, lint/test/build gate.
2. Replace task 3.3 (or extend) with the three named integration cases asserting `reason` and `actor_roles`.
3. Add unit tasks for admitted-caller no-added-query and no-content-in-row-or-event.
4. Fix the mismatched/duplicated scenarios in the topic-customization-lock delta (section 2).
5. Resolve P1 in writing; clarify shared vs per-step timeout budget; define `actor_ip`, `actor_roles` type, and the byte-identical baseline.
6. Soften the SEC-13 claim and list remaining denial gaps with issue numbers.
