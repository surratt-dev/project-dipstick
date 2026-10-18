# Security Review of design.md and proposal.md: zero-topic-team-recovery (#200)

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Scope: authentication and authorization, data access boundaries, audit logging, threat model impact of a new admin-only endpoint that bypasses the topic customization lock.
Method: document review only. I did not read the code, other reviews, or run anything. Every "verify" item below is something the design asserts or implies and I could not confirm from the documents.

## Verdict

Approve with conditions. The design is narrower than most lock bypasses I review, and that is the main reason it is acceptable. Four things carry that narrowness: the endpoint can only write one fixed data set (the canonical template), it needs a structural precondition checked under a lock, and it is admin-only. The lock gate code is untouched. Denials are audited, which I did not expect on a write endpoint, so credit there.

I have no blocking findings against the architecture. I have three conditions (S1, S2, S3) that I want resolved or explicitly accepted in writing before merge, and a list of implicit decisions (section 4) that should be made explicit in the spec so nobody has to rediscover them.

## 1. Threat model impact

New capability: a principal with `application_admin` can write the canonical topic set into a team's `topics` table while the team is customization-locked.

Assets: team topic configuration (low sensitivity, integrity matters more than confidentiality); the lock invariant ("first session runs the canonical set"); the audit trail.

Threats considered:

| Threat | Assessment |
|---|---|
| Non-admin (facilitator, EM, engineer) reaches the endpoint | Mitigated by a server-side role check, ahead of every other check. Must be a live DB read (S1). |
| Compromised or malicious admin uses the endpoint to customize despite the lock | Not possible via this route: no request-controlled content, canonical set only, precondition requires zero active topics. An admin already has the other topic writes via #208 once unlocked, so this adds no net capability. Residual risk is low. |
| Compromised admin drives a team to zero active topics to enable the carve-out | The last active topic cannot be archived (`TOPIC_LAST_ACTIVE`), and the lock blocks writes anyway. The design should state this chain as an invariant and have a test (S5). |
| Race between this endpoint and room open, or two assign calls | Mitigated by the shared advisory lock; correct in principle. Depends on lock semantics and isolation level (S2). |
| Cross-team effects (tenancy) | AC 8 covers it. Add: endpoint accepts no body and no template or team override in the query string, so there is no mass assignment surface (S6). |
| Cross-site request forgery against the admin | Not addressed. See section 4, decision I1. |
| Audit log flooding by any authenticated user | The denial-audit design has a new unbounded write path (S3). |
| Attempt visibility for admin-caller failures | Gap, see S4. |
| Information disclosure | Mostly handled (fixed-shape errors, no template id or topic text in bodies, counts only in audit metadata). Minor items in section 3. |

The lock carve-out is a permanent change to a security-relevant invariant, so I agree with the proposal's rule that any further carve-out needs explicit PO sign-off. I would add that the source test asserting "the four lock-gated endpoints still call `checkCustomizationLockGate`" should be a permanent regression test, not only a change-time check.

## 2. Findings

### S1. Authorization source must be the live database role, stated in the spec (condition)

D2 says authorization is `global_role = 'application_admin'`, and D8 correctly says the advance handler reads the caller's live `users.global_role`. D2 does not say where this endpoint reads the role. Under OIDC, the role map (#243) derives the role from token claims. If this endpoint trusts a cached claim in a token or session, a demoted or deprovisioned admin keeps the carve-out until token expiry. That is exactly the "claims trusted without being verified" pattern I flag on OIDC integrations.

Requirement: the delta spec should say the role is read from the `users` row at request time (same as the siblings and `/advance`), a missing user row yields 403 `NOT_AN_ADMIN` (AC 2 already lists "a caller with no user row"; good), and a test covers a role downgraded between login and call. If the project's convention is that `users.global_role` is refreshed at each login only, state the revocation latency as an accepted risk and say so in the ratification list.

### S2. Concurrency guarantees depend on two unstated facts (condition)

D3 relies on `lockTeamTopics` plus a zero-active re-check. That is sound only if:

1. The lock is transaction-scoped (`pg_advisory_xact_lock` or equivalent) and released at COMMIT or ROLLBACK, including on the `NoActiveTopicsError` rollback path. A session-level advisory lock on a pooled connection would leak and could block room open for that team indefinitely, which turns a recovery feature into a denial of service. Verify.
2. The zero-active count is read after the lock is acquired, in a statement that sees the other transaction's committed rows. Under READ COMMITTED (the Postgres default) a fresh statement after the lock does. Under REPEATABLE READ or SERIALIZABLE the snapshot may have been taken earlier and the check would be stale. State the isolation level in the design, and make the concurrency test (AC 3) run against real Postgres with two connections, which the design already implies for the audit helper.

Also confirm the advisory lock key is derived from the team id in a way that two teams cannot collide into one key in a manner that matters (collision only costs latency, not correctness, so this is low; note it, do not engineer for it).

### S3. Denial audit rows are an unbounded write path for any authenticated user (condition)

D9 places the denial audit insert before the rate limiter on purpose, so that "a 403-bound caller still consumes no limiter budget". The consequence, which D9 names as "accepted", is that any authenticated non-admin, including a low-privilege engineer, can insert unlimited `audit_log` rows with attacker-chosen `team_id` (any well-formed UUID, no foreign key) at request speed. Effects: audit table growth, index bloat, and, most important to me, dilution of the signal. A real probing campaign becomes hard to distinguish from noise, and an attacker can bury a different event. TOPIC-002 has the same exposure today; this change copies and extends it.

I do not accept "same as TOPIC-002" as sufficient, because the right response to a known weakness is not to replicate it on a more sensitive endpoint. Options, cheapest first:

1. Apply a separate, generous limiter keyed on actor id to the denial-audit write only (for example, N denial rows per actor per minute, then 403 without a row plus a log-only counter). This does not make a 403 caller consume the main topic-write budget, so the stated intent of D9 survives.
2. Coalesce: one row per (actor, endpoint, minute) with a count.
3. Accept as is, but record the volume ceiling and retention in the runbook so on-call knows the table can be flooded.

I prefer option 1. Whichever is chosen, this should be a decision in the design, not an implication. Also confirm the row cannot be written for an unauthenticated caller (401 should precede this; consistent with TOPIC-002).

### S4. Admin-caller failures leave no durable record (recommend; ratification item 4 should be answered by Security, not deferred to compliance alone)

The design audits success (in-transaction) and non-admin denial. It does not durably audit:

- The empty-template 500 (declared and accepted as a gap, log line only).
- 409 `TEAM_HAS_ACTIVE_TOPICS`, 404 `TEAM_NOT_FOUND` and rate-limit refusals for admins (no state change, so I am comfortable).

The 500 is the one that matters. It is the signature of either a data fault or someone having emptied or tampered with the template, and it is a state the admin is asked to hand to an "operator". A log line with a correlation id is better than nothing, but log retention is usually shorter than audit retention, and logs are not in the audit tooling the runbook points to. The design rejects a post-rollback audit write because it "would introduce a new audit pattern". That pattern already exists in spirit: D9's denial row is a fail-open write that is independent of the main outcome. Writing the 500 as a fail-open row using a separate connection or after ROLLBACK is the same shape (try, swallow failure, emit `topic.audit_write_failed`), and the endpoint is rare and admin-only so volume is not a concern.

My position: I would sign off on the log-only approach only if (a) log retention for error-level lines in the target deployment is at least that of the audit log, or (b) the runbook says explicitly that this event class must be reconstructed from logs and gives the search. Otherwise write the row post-ROLLBACK. This answers ratification item 4 from the security side; compliance should still record their response.

### S5. Make the "cannot reach zero active" chain an explicit invariant (low)

Everything about the carve-out being narrow depends on there being no path by which a compromised admin (or a bug) can make a healthy, locked team zero-active and then run this endpoint. The design relies on `TOPIC_LAST_ACTIVE` and the lock gate but never states the dependency. Add one sentence to the spec and one integration test: "From a team with one active topic, no sequence of API calls available to an admin (archive, reassign, edit, delete, template change) results in zero active topics on a locked team." If any path exists (for example, template-team operations, team deletion and recreation, or a bulk admin tool), it needs to be named.

### S6. Request surface: no body, no overrides (low)

State in the spec that the route ignores or rejects any body and any query parameter, and never accepts a source team or template id. This closes mass-assignment and prevents a future "copy from team X" refactor from slipping in unreviewed. A test posting a body containing `templateTeamId`, `teamId`, `topics` and asserting identical behaviour is cheap.

### S7. `canAssignDefaults` is UX only; keep it that way (low, confirm)

D6 and the proposal are correct that the frontend flag is fail-closed and that the endpoint enforces independently. AC 7 requires parity with the endpoint's 403. Good. Add one negative test: with the flag spoofed true in a hand-built request path, a non-admin still gets 403 (this is just the endpoint test; mention that no server code reads the flag back from the client).

## 3. Smaller observations

1. Error-code disclosure. A non-admin learns from `NOT_AN_ADMIN` that an administrator role exists. The room-open copy names "an application administrator" to facilitators. Neither is a secret; I accept the H1 loosening. No finding.
2. Oracle behaviour. Non-admins get 403 for any team, existing or not, template or not (check order places authorization before lookup). Admins can distinguish template from nonexistent only if the bodies differ. Confirm the template 404 body and the `TEAM_NOT_FOUND` 404 body are intended to differ (the table lists different audit treatment, and `TEAM_NOT_FOUND` carries a code). An admin is already trusted with the template id, so I rate this informational.
3. Timing. `applyTimingFloor` is copied from siblings. Confirm it wraps the 403 branch too, so admin versus non-admin and existing versus missing cannot be separated by response time. Only matters for non-admins, who see 403 regardless.
4. Audit completeness. Success row has `actor_user_id`, role, `actor_ip` and `team_id`. Metadata is `{ topic_count }` only, so after the template is later edited nobody can say which topics were assigned. That is a deliberate privacy-minimizing choice and I accept it, but an audit row that cannot be correlated with the request log is weaker than one that can. Recommend adding the request correlation id (already used in the error log line) as a column or an allowed metadata key on both new operations. Then S4's log-only path and the audit row can be joined. This is a small change to the metadata-limits requirement.
5. `emitAuditEvent` after COMMIT. A process crash between COMMIT and emit loses the event but not the row. State in the spec that the `audit_log` row is the system of record and the emitted event is a convenience notification. Not a finding.
6. `actor_ip`. Only as trustworthy as the proxy configuration (`trust proxy` / forwarded header handling). Pre-existing behaviour across the app; mention in the pre-production review checklist for this endpoint since the row is now used for attribution of a lock bypass.
7. Template as an input. The endpoint copies whatever the template contains at call time. If an admin or a migration poisons the template (text with markup, oversized prompts), the content propagates to a team that has no opportunity to review it. This is not new (team creation does the same), but the recovery path makes it a more deliberate copy. Confirm topic text is escaped at render in every consumer; I regard the existing control as sufficient but I will test it.
8. Rate limiter failure mode. 503 fail-closed when the limiter store is down means admin recovery is unavailable during a Redis outage. That is the safe side. No change; just make sure the runbook's last-resort manual DB path is not described as a routine alternative.
9. Runbook diagnostic query and `migrations-manual/` repair script. Reviewed as intent only. If a bulk repair script is ever written, it needs the same precondition (zero active) and must write one audit row per team, using the same operation name, with an actor value that identifies the operator. Say so in the runbook now so the script, if built, does not become a silent bypass.
10. Archived rows. Left untouched and not recreated. Good: no resurrection of deliberately removed content.

## 4. Security decisions that are deferred or implicit

| # | Decision | Where it sits now | Recommendation |
|---|---|---|---|
| I1 | CSRF protection for a state-changing POST with no body. Whether the session credential is a cookie (needs CSRF token or SameSite plus Origin check) or a bearer token in a header (not CSRF-prone) is not stated anywhere in these documents. | Implicit. A body-less admin POST is the textbook CSRF target. | State the app's existing CSRF/CORS posture applies and confirm CORS policy does not allow credentialed cross-origin requests to this route. If the app is bearer-only, say so. |
| I2 | Source of the role used for authorization (live DB vs claim). | Implicit in D2, explicit only for `/advance`. | See S1. |
| I3 | Isolation level and advisory lock scope. | Implicit. | See S2. |
| I4 | Bounding denial-audit writes. | Explicitly "accepted" in D9 without a bound. | See S3. |
| I5 | Durable record of the empty-template failure. | Deferred to compliance (ratification item 4). | See S4. Security position stated; compliance still owes a response. |
| I6 | Ratification item 5 says "Security may prefer to confirm". | Deferred to me. | Confirmed with conditions: follow TOPIC-002 (audit denials) is right; add the S3 bound. |
| I7 | The endpoint accepts calls on an unlocked zero-topic team ("would still accept"). | Implicit/noted in G and AC 9. | Harmless, because the result is the canonical set, but it means the route's authorization is the only thing between non-admins and a topic write on an unlocked team, where facilitators can already add topics. Fine; keep the explicit scenario so it is never "tightened" to a lock check by accident. |
| I8 | Permanence of the carve-out and who may add the next one. | Explicit (ratification item 1). | Add the source regression test noted in section 1 so a later change cannot silently widen it. |
| I9 | Admin cross-team write scope (#208) is inherited. | Explicit, out of scope here. | No action; note for the threat model update that blast radius of one compromised admin is every team. |
| I10 | Data retention for the two new audit operations. | Not addressed. | Inherit the audit-log retention policy; one sentence in the runbook. My success criterion 4 (defined retention) applies to audit data as well. |

## 5. Conditions for my sign-off

1. S1: role is read live from the `users` row on this endpoint; spec and test say so (or revocation latency is explicitly accepted).
2. S2: advisory lock is transaction-scoped and released on the rollback path; isolation level stated; two-connection test against real Postgres.
3. S3: a bound on denial-audit writes (option 1 preferred), or a recorded decision to accept unbounded growth with retention noted.
4. I1: CSRF/CORS posture for this route confirmed in writing.
5. S4: either the empty-template 500 is written as a fail-open post-rollback audit row, or log retention and the runbook search are confirmed adequate.

Items S5, S6, S7 and the section 3 observations are recommendations; I will check them in the pre-production review of this endpoint and add them to the threat model revisit. The threat model should be updated with the new trust relationship "application_admin may write canonical topics into a locked team", with this document's table as the starting point.
