# Design review (Engineering): #296 threat-model text

Reviewer: Marcus Oyelaran. Scope: factual accuracy of the claims the HLA text will make, checked against `packages/backend/src` on the current branch. Verdict: the design is accurate with four wording corrections (R1 to R4) and four gaps worth a caveat or a conscious omission (G1 to G4). Nothing blocks.

## Claims verified against source

| Claim in design/proposal | Verdict | Evidence |
|---|---|---|
| Live role check per request | Confirmed | `checkAssignDefaultsAuthorization` in `routes/topics.ts` queries `users.global_role` each call; `isApplicationAdmin` (`auth/role-map.ts`) is strict equality to `application_admin`. Missing user row reads as non-admin. |
| Any admin, including a member of the target team (c) | Confirmed | No membership is read. |
| Zero-active precondition checked under the per-team advisory lock | Confirmed | `lockTeamTopics` (`pg_advisory_xact_lock(hashtext(team::uuid::text))`) then a fresh `count(*) ... status='active'` in the same READ COMMITTED transaction. Same lock key room open uses (`facilitator-sessions.ts` imports the same helper). |
| Accepted on locked and unlocked teams | Confirmed | No `checkCustomizationLockGate`, and the source test forbids `hasCompletedFirstSession`/`getTopicLockState` in the block. |
| Copies the default template only; no caller-supplied source | Confirmed | Handler has no body/query read; `copyCanonicalDefaults(client, teamId)` is called without the `sourceTeamId` test seam. Copies template rows where `is_default AND status='active'`, annotation columns excluded. |
| Success audit row in the same transaction, fail-closed | Confirmed | Plain `INSERT INTO audit_log` on the transaction client before COMMIT; a throw goes to the catch, which ROLLBACKs and returns generic 500 `ASSIGN_DEFAULTS_FAILED`. |
| Rollback on template failure | Confirmed | Empty copy throws `DefaultTopicsUnavailableError`, catch ROLLBACKs, 500 `DEFAULT_TOPICS_UNAVAILABLE`. The failure row is then written after the rollback on the pool. |
| Denial and failure audit rows exist | Confirmed, with a qualifier (R2) | `recordDenial` and `recordFailure` use `writeFailOpenTopicAuditRow` (timeout-bounded, swallows errors). |
| Denial rows sampled and absent on Redis outage | Confirmed | `admitDenialAudit` bound exceeded gives a log-only `topic.denial_audit_suppressed`; limiter store error or failed dynamic import gives the same event. Note the rows are also absent if the audit insert itself fails (fail-open). |
| Per-actor topic-write limiter | Confirmed | `enforceTopicWriteRateLimit` runs after authorization, so a 403 caller spends no budget. Fail-closed: Redis error or >500 ms gives 503. |
| `actor_ip` depends on `trustProxy` | Confirmed | `app.ts` sets `trustProxy: 1`; handler stores `request.ip`. |
| Operation names | Confirmed | All five (`topic.defaults_assigned`, `_assign_denied`, `_assign_failed`, `topic.denial_audit_suppressed`, `topic.write_denied_template`) are in `auth/audit-logger.ts`. `topic.default_added/_edited/_archived/_restored/_reordered` and `topic.default_maintenance_denied` exist for #216. |
| Handler inserts only, counts only active (D5) | Confirmed | Only INSERT into `topics` plus INSERT into `audit_log`; no UPDATE/DELETE of any row. Archived rows are untouched. Keep the "left in place" clause. No session, score or reveal tables are touched. |
| Source test: seven routes pinned, five GATED, assign-defaults neither calls the gate nor reads lock state | Confirmed | `GATED` has 5 entries (add, archive, restore, reorder, restore-defaults); route-list pin has 7. Header comment says "four" and is stale. |
| Concurrency test claims (D3) | Confirmed | Tests at lines 80/107 (one 201, one 409), 134 (queued `/advance` snapshots assigned rows), 157 (`/advance` winning the lock gets `NO_ACTIVE_TOPICS`, then assign succeeds). Also a READ COMMITTED test. Nothing on archived topics or template edits, as the design says. |
| #215 team creation rolls back on empty template (D7) | Confirmed in code, wrong route name in comment | `routes/facilitator-sessions.ts` calls `copyCanonicalDefaults`, then `snapshotSessionTopics`; `NoActiveTopicsError` is handled in the catch. `docs/deployment.md` "Zero-topic teams" also says it. `default-topics.ts` header says "POST /api/v1/teams" which is stale, so cite behavior, not a path. Task 1.3 may therefore allow the "team creation rolls back" detail, but see R4 on scope. |

## Corrections to the planned wording

**R1. "denial and failure audit rows" in the controls cell.** The row text lists these as controls without qualification, but both are fail-open and neither covers every failure. Denial: sampled per actor and absent when Redis or the audit insert fails. Failure: written only for the empty-template 500, after the rollback, fail-open. A generic 500 (constraint drift, connection loss, failed success-audit insert) leaves a log line only. Design item (f) already carries most of this; make sure the controls cell says "fail-open denial and failure audit rows" or equivalent so the cell and caveats do not disagree.

**R2. "success audit row ... same transaction" is durable, not detective-complete.** Accurate as written, but it also means the audit row is fail-closed: an audit insert failure blocks the assignment (and returns a generic 500 with no failure row). Fine to say "success is audited fail-closed"; do not say "all outcomes are audited".

**R3. Limiter wording needs a coupling note (see G1).** "per-actor topic-write limiter" is accurate. Do not imply it protects against admin abuse specifically; it is a shared budget for the six topic-write routes and the #216 template-maintenance routes use the same function. It is a rate bound, not a control on what is written.

**R4. Item (d) "emptied template degrades onboarding".** Source supports stronger and more precise text: an emptied or all-archived template makes team creation fail (rolls back) and makes assign-defaults answer 500 `DEFAULT_TOPICS_UNAVAILABLE`. "Degrades onboarding" is true but undersells that recovery itself (assign-defaults) is also dead until the template is repaired. That is the substantive consequence of the chained path and is worth one clause in (d) or (g), since (g) says recovery is "an `application_admin` calling assign-defaults". Add: recovery also depends on the template being non-empty.

## Gaps, missing error paths, hidden coupling

**G1. Shared rate-limit budget couples recovery to other writes.** `enforceTopicWriteRateLimit` keys on the actor only (`topicWriteRateLimitKeys(userId)`), shared across add, archive, restore, reorder, annotation, restore-defaults, assign-defaults, and the #216 template routes. An admin who has exhausted the budget cannot assign defaults until the window clears, and a Redis outage returns 503 on this endpoint (fail-closed), so assign-defaults is unavailable when Redis is down. That is the reverse of the denial-audit behavior (fail-open) the design already notes, and it affects the recovery-speed discussion in (g)/(h). Suggest one clause in (f) or (g): recovery is unavailable during a Redis outage or after the actor's budget is spent. No numbers needed.

**G2. Admin template edits and assign share budget and sentinel.** The chained path (rewrite template via #216, then assign) uses one actor budget for both steps. Not a mitigation (limits are generous), just a fact; do not cite the limiter as a control against the chained path. R3 covers this.

**G3. Advisory lock is a hashed 32-bit key with no lock timeout.** `hashtext(teamId)` can collide between teams (contention only, no correctness issue) and `pg_advisory_xact_lock` blocks without a timeout. The proposal puts "sentinel-lock blast radius" out of scope, which covers the sentinel case; the generic hash collision and unbounded wait are not mentioned. Fine to leave out of the HLA, but do not write "per-team lock" in a way that implies exclusive isolation between teams. Suggest saying "per-team advisory lock" only, as the design does, and no stronger.

**G4. Success audit row omits `actor_roles`.** The success `INSERT` lists `actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata`; denial and failure rows (via `FAIL_OPEN_TOPIC_AUDIT_INSERT_SQL`) also capture `actor_roles` from the users table. So the three row types are not shape-identical. Harmless for the threat model, but do not claim the rows carry the same actor attributes. Also worth knowing for any future reader joining on `actor_roles`.

**Error-path inventory (for completeness; all handled in the handler).** 404 non-canonical id; 403 NOT_AN_ADMIN (before any team lookup, so identical for existing, missing and template team); 429/503 from limiter; 404 TEAM_NOT_FOUND and template-team 404 with `topic.write_denied_template`; 409 TEAM_HAS_ACTIVE_TOPICS; 500 DEFAULT_TOPICS_UNAVAILABLE (with failure row); 500 ASSIGN_DEFAULTS_FAILED (log only). The post-commit `emitAuditEvent` is wrapped so it cannot turn a committed success into a 5xx. Timing floor applied on every exit. No uncovered path found.

## Specific checks the implementer should do at landing

1. Keep "five" in the 8.2 bullet; the test body confirms five `GATED` and seven pinned routes. Do not repeat the stale "four" from the header comment, and do not describe restore-defaults as a second carve-out: it is gated.
2. For the 8.2 sentence "requires assign-defaults not to": the test asserts the block does not match `checkCustomizationLockGate(`, `hasCompletedFirstSession(` or `getTopicLockState(`. It is a source-text regex on comment-stripped code in `routes/topics.ts`, so a gate invoked through a helper or another file would not be caught. Wording "does not call the lock gate" is within the test's assertion; wording "cannot be bypassed" is not.
3. The "zero-topic-invariant" test is a fixed scenario on one locked one-topic team plus one unlocked-team archive case, as the design says. Keep it behavior-only and unnamed.
4. `topic.write_denied_template` is only reachable for the sentinel team id after authorization and the rate limit, so it is an admin-visible signal only; do not describe it as protecting the template from the carve-out itself. (The template is protected from assign-defaults by `checkWritableTeam`; the template's own edits go through #216 routes.)

## Overclaim sweep on the planned text

- "copies the default template only (no caller-supplied source or text)": true for the route. `copyCanonicalDefaults` has a `sourceTeamId` parameter used by tests only; the route never passes it. Wording is safe; the source-test does not pin this, so it rests on a handler read, which is fine for task 1.2.
- "single lock carve-out": supported for the lock gate by the source test. Other mechanisms that write topics into a locked team (the #216 template maintenance writes to the sentinel team, team creation copy) are not lock carve-outs in the same sense, because the sentinel has no lock and team creation is before any session. The text should say "exactly one carve-out to the customization lock", which is what the 8.2 bullet says, not "the only way topics enter a locked team".
- "detective, not preventive": accurate; the only preventive controls are the role check and the precondition.
- "no tamper evidence is claimed": accurate; nothing in the code hashes or chains `audit_log`.
