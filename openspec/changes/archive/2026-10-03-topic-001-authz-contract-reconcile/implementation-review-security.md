# Implementation Review: Security (topic-001-authz-contract-reconcile)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** uncommitted diff on `agent-team/187-topic-001-authz-contract-reconcile`. I read every line of `routes/content.ts` (TOPIC-001 handler, `isTopicConfigReadAdmitted`, `denyAccess`, `denyNullGrant`, `denyAdminContentAccess`), `auth/team-content-access-helper.ts` (`readActiveMembershipRole`, the path 2' mismatch branch), `auth/audit-logger.ts` (new event name, `emitAuditEvent`), `shared/types/team-content-access.ts` (`TeamAccessGrant`), and the new and changed tests. I also checked Fastify 5.8.5's `defaultErrorHandler`.
**Tests I ran:** `content.test.ts` + `team-content-access-helper.test.ts` (83 passed); `topic-annotation-integration.test.ts`, `template-team-topic-writes-integration.test.ts`, `topics-integration.test.ts` against the local Postgres container (76 passed).

**Verdict: sign-off. Task 6.4 is checked.** Nothing is blocking. The code matches design Decisions 1, 2 and 6 exactly, and the tests pin the properties I care about by call count and SQL text, not by mock position.

---

## What I verified (task 6.4 checklist)

| Item | Result | Evidence |
|---|---|---|
| Deny by default | Pass | `switch (grant.path)`. `admin` returns false, and the `never` default returns false. Every arm is an allow-list except the facilitator arm, which denies one value on purpose (design Decision 2, my earlier N1). |
| Exact `"participant"` match | Pass | `grant.role === "participant" && liveMembershipRole === "participant"`. `null`, `undefined`, `"engineering_manager"` and any future role deny. No truthiness or "not EM" test anywhere. |
| EM by membership OR global role | Pass | The member arm also requires `actorGlobalRole !== "engineering_manager"`. Path 2, path 2', global-EM/participant and global-facilitator/EM-membership are all denied in unit tests 4.1/4.2. The two states the grant alone does not mark (path 2' and global-EM/participant) are also denied against a real DB (4.7, plus the template team in 4.8). |
| Facilitator grant handling | Pass | Does not do the membership read (`liveRole = null`, which is ignored). A drifted global EM is denied (`global_em`). A facilitator whose global role is `facilitator` gets 200 (4.3). No path admits on global role `facilitator` before the gate. |
| Pure predicate | Pass | It reads only its two parameters: no `process.env`, `config.`, `await` or `db.`. `timing-oracle.ts` reads `NODE_ENV` at import. That controls the floor, not admission, so it does not breach "unconditional" (4.11 covers `development` and `test`). |
| Failed membership read cannot admit | Pass | `readActiveMembershipRole` has no try/catch, and neither does the handler. A rejection becomes a 500 before the predicate runs. The helper test proves the rejection propagates, and 4.12 proves 500 with no topics or lock query. |
| Denial leaks nothing | Pass | The gate sits before the topics SELECT and before `hasCompletedFirstSession`. `expectTopicAndLockQueriesSkipped` asserts the exact call count and that no SQL matches `FROM topics` / `FROM sessions WHERE team_id`. The integration tests assert that the annotation text, the topic name and `isCustomizationLocked` are absent from the body. |
| Uniform 403 | Pass | The handler uses `denyAccess(reply)`, which is the null-grant envelope with `no-store`. The parity test compares status, every header except `date`, and the body without `correlationId`, so it also rules out the cross-team facilitator message. `applyTimingFloor(startTime)` is called exactly once, before the response, on both branches. |
| Denial event contents | Pass | `topic.config_read_denied_role` carries exactly `{ userId, teamId, grantPath, actorGlobalRole, membershipRole, reason }`, and 4.1 asserts that key set exactly. This matches the PII level of `team.access_grant_mismatch` (ids and roles only) and carries no IP. It has no topic ids, names, annotation text or lock flag. `reason` is computed only after the predicate has returned false. `emitAuditEvent` forces level `info`, so the event survives a raised log level. |
| 404 before 403 | Pass | The canonical-UUID check is still the first statement. 4.10 shows an EM with a malformed id gets `TEAM_NOT_FOUND` and zero DB calls. |
| Admin audit preserved | Pass | The `admin` branch is unchanged and still comes before the membership read. 4.4 asserts exactly one `admin.session_content_denied` row with the TOPIC-001 endpoint and no new event. It also covers an admin with an active EM membership, which pins the helper's admin-first precedence. |

## Non-blocking

**N1. A 500 echoes the raw error message to the client, which is a pre-existing, app-wide issue.** The backend has no `setErrorHandler`, so Fastify's `defaultErrorHandler` sends `error.message`. If the new membership read fails, the client receives the pg driver's message (for example "connection terminated unexpectedly", or worse, text from a constraint or a relation name), and the 500 carries no `Cache-Control: no-store` and no timing floor. This change neither creates nor widens the problem, since the helper's own query already fails the same way. Design Risks already accepts that the 500 skips the timing floor. I want an app-level error handler that returns a generic envelope with a `correlationId` and `no-store` and logs the detail on the server. Suggested owner: Security + Solution Architect, filed with the proposal follow-ups.

**N2. A race where the membership is demoted between the two reads is handled more strictly than design.md describes.** If `evaluateTeamAccess` reads an EM membership (grant `member / engineering_manager`) and the membership becomes `participant` before `readActiveMembershipRole` runs, the predicate still denies, because `grant.role` must also be `participant`. The design's Decision 1 bullet says that case is "admitted, matches latest state". Failing closed is the right result and I would not change the code. The event will say `reason: "not_admitted"` for that request, which is correct. The design sentence is slightly inaccurate. Correct it at archive time if convenient.

**N3. The two events name the same field differently.** `team.access_grant_mismatch` calls it `globalRole` and `topic.config_read_denied_role` calls it `actorGlobalRole`. Anyone writing a log query that joins the two events on a path 2' denial needs to know this. It is cosmetic, so it does not need to change now. The new name matches the grant field, which I prefer.

**N4. The event is log-only. I still accept that.** It has no `audit_log` row. Keeping per-request DB writes off a pollable read path is the same reasoning used for `team.access_grant_mismatch`, and the `info` level override protects it from application log-level changes. A transport-level filter could still drop it, as documented in `docs/deployment.md` under "Logging". `topic.config_read_denied_role` should be added to that doc's list of events at risk the next time it is touched.

## Sign-off

The admission predicate is correct, it fails closed, and its denials reveal nothing beyond what a null-grant 403 already does. I have checked task 6.4 in `tasks.md`.
