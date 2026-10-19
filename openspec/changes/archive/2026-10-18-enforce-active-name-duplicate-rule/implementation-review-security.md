# Security Implementation Review: enforce-active-name-duplicate-rule (#299)

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Scope: uncommitted diff on branch `agent-team/299-enforce-active-name-duplicate-rule`, checked against `design-review-security.md` conditions 1 to 4 and design.md D4/D5/D5a/D6. Source not edited.

## Verdict

Approve. All four sign-off conditions are met. No blocking findings. Two low advisory items (I1, I2) and two informational notes.

## Condition checklist

| Condition / focus | Result | Evidence |
|---|---|---|
| Auth and lock ordering: unauthorized or locked callers never reach `TOPIC_NAME_ACTIVE` | Met | `topics.ts` Add: `checkAddCustomTopicAuthorization` (403), `enforceTopicWriteRateLimit` (429/503), `checkWritableTeam` (404), `checkCustomizationLockGate` (409 lock), 422 validation, then `db.connect` / `BEGIN` / `lockTeamTopics`, then the name check. Restore: same cascade, then `checkTopicExistsAndArchived`, then in-lock re-read and name check. `findActiveNameConflict` is called only after every gate, and no `topics` row is read for name purposes before the lock. |
| `Cache-Control: no-store` on the 409 | Met | `sendTopicNameActive` sets it on the one reply used by both Add and single restore. Asserted in the integration test (Add line 160, restore line 243). The header is not changed on other responses, as D4 specified. |
| No audit row on the 409 | Met | Handled exit does ROLLBACK, floor, reply, before any `INSERT INTO audit_log` or `emitAuditEvent`. Test asserts no `audit_log` row for the Add and `topic.restored` operations. No new operation, so the #271 reader inventory is unchanged. |
| No logging of submitted or conflicting names | Met | No `request.log` or `emitAuditEvent` call on the new paths. The handled return avoids the `catch` (which rethrows to the global handler), so the name cannot reach an error log through this path. Test 4.7 runs a real trace-level logger, proves it is live (a 201 produces lines), and asserts neither name appears in logs or `audit_log` metadata. This is the negative test I asked for in S4. |
| 503, not 409, on limiter outage | Met | The rate-limit step precedes the name check in both handlers. Tests "limiter unavailable answers 503, never 409" (Add) and the restore equivalent (line 307) assert `TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`. The 409 spends budget, as designed (asserted). |
| `conflictingName` rendered as text only | Met | `AddCustomTopicForm` renders `addNameBlockedMessage(...)` as a JSX text child of the `role="alert"` div. The restore message goes through state to a text node. No `dangerouslySetInnerHTML` or `innerHTML` use in the change. The name is reflected inside straight quotes only. |
| No role-dependent response | Met | Handler never branches on `authResult.actorGlobalRole` after the gate. `force: true` and `application_admin` get the same 409 (tests at 196 and 298). Unknown body fields are ignored (D6). |
| D5a recorded in the threat model | Met | HLA 8.1.1 item (i) and the 8.2 line carry the accepted-risk statement with the "no reopen trigger" wording I asked for (S2). |
| `buildErrorEnvelope` extras cannot clobber base fields | Met | `extra` is spread first; `category`, `code`, `message`, `correlationId` follow. Output with no extra is unchanged. `error-envelope.test.ts` covers this. |
| Client branches on `code`, not bare 409 (S6) | Met | `parseTopicConflict` plus a `switch` with a `never` default in the Add handler; the restore handler checks the code before taking the name branch. An unknown code or malformed body falls back to the existing generic path. |

## Findings

### I1 (Low, advisory): no explicit "403 never yields TOPIC_NAME_ACTIVE" test in the new suite

Ordering is correct by construction and the lock and 503 cases are tested, but the new integration file has no case where a caller who would hit a name conflict (non-facilitator, or a facilitator who is a team member) receives 403 with no `conflictingName`. Existing 403 tests cover the gate, but they do not use an active duplicate name, so they would not catch a future reordering that moves the check ahead of authorization. A two-case test (Add and restore) with a conflicting active name would pin condition 1 directly. Not blocking.

### I2 (Low, advisory): in-lock 422 on restore lacks no-store

The new in-lock "no longer archived" 422 returns a fixed message with no topic data, so there is no leak. It does match the existing pre-lock 422 behaviour. No action required; noted only because it is a new response on the endpoint.

### Informational

- The Add and restore handlers query `SELECT id, name, display_order ... status = 'active'` for the team, so all active names are loaded into the process before comparison. Bounded by team topic count; no extra exposure because only the first match is returned.
- Timing: the 409 uses ROLLBACK plus `applyTimingFloor`, as designed. The Add thrown-path gap remains deferred to #305, unchanged by this change.

## Sign-off

Conditions 1 to 4 from the design review are satisfied by the implementation and tests. No re-review needed unless the response shape or the audit decision changes.
