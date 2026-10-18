# Security Review of design.md and proposal.md: bulk-restore-default-topics (#218)

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Inputs: design.md, proposal.md, and a read of the live single-restore handler (`packages/backend/src/routes/topics.ts`, ~lines 1525-1690), `content/timing-oracle.ts`, `routes/topic-write-rate-limit.ts`.
Scope: authentication, authorization, data access boundaries, audit, existence-oracle and timing, limiter accounting, locking. I have no opinion on the ritual or UX.

## Verdict

Approve with conditions. The design reuses the single-restore cascade, lock, limiter and audit pattern rather than inventing its own, which is the right security posture. It accepts no client input and has a bounded blast radius. I found no blocking vulnerability. I found one high-priority item (timing floor behavior on a slower, N-dependent path), several medium items where a security decision is implicit or deferred, and some low items. The ones I want resolved before merge are H1, M1, M2 and M3.

## What is sound

- **Cascade order matches the live handler.** I confirmed the order in the code: canonical-id 404, role 403, limiter, `checkWritableTeam`, lock gate, transaction. Citing the live body rather than the stale header comment is correct. Role before limiter means a 403-bound caller never consumes budget, and the limiter before the team lookup means 429/503 is identical for existing, missing and template teams. Bulk inherits both properties by reusing the helpers.
- **No request input.** The body is never read, so there is no mass-assignment, no id list to tamper with, no IDOR vector on topic ids. The target set is computed server-side from `team_id` plus `is_default`. This is the best control in the design.
- **Team scoping.** Both reads and the UPDATE are filtered by `team_id`. The UPDATE repeats `topics.team_id = $team` and `status = 'archived'`, so an id from another team cannot be touched even if the planner were wrong. Good defense in depth.
- **Parameterized SQL.** The `unnest($ids::uuid[], $positions::int[])` form is parameterized; no string interpolation is described.
- **Atomicity and lock.** One transaction under `lockTeamTopics`, same key as Add, restore, archive, reorder and room open. The lock is taken before the reads (unlike single restore, whose pre-check is outside the lock), so bulk is stricter, not weaker. Rollback on row-count mismatch is correct fail-closed behavior.
- **Audit metadata excludes team free text.** Ids and positions only, consistent with `topic.defaults_assigned` and `topic.reordered`. I support this as the right call and agree it satisfies the intent of AC4. Names appear only in the HTTP response to an authorized caller.
- **Locked-team 409 before emptiness.** Correct. Letting emptiness short-circuit ahead of the lock check would create a distinguishable state signal.
- **Live-session isolation (V1).** Snapshot-at-room-open means a bulk restore cannot alter an in-progress session. Good integrity property, and the required test (assert `session_topics` unchanged for lobby and in-progress sessions) is the right one.

## Findings

### H1. Timing floor: the new endpoint is the slowest topic write and the floor is still a placeholder (HIGH)

`timing-oracle.ts` states the floor is a "development-time placeholder" with measurement fields marked `[PENDING]` and "required before production". Single restore does one UPDATE and one INSERT. Bulk adds two reads, a planner pass, an unnest UPDATE, and an INSERT whose metadata grows with N. Its authorized latency is higher and N-dependent. If it exceeds the floor, the success path becomes the slowest response, and the 403/404/409/429 exits become distinguishable by being faster. That is exactly the oracle the floor exists to remove, and here it would distinguish "caller is an authorized facilitator for a real, unlocked team" from the rest.

Note the ordering helps: the expensive work occurs only after the role, team and lock gates, so the denied exits are all cheap and equal. The risk is the success and empty-200 exits versus the denied exits, which only the floor hides.

Required:
1. State in the design that bulk's p95/p99 (at N=12 and the 50-row fixture) is included in the floor measurement for TIMING_FLOOR_MS, not just content endpoints. Add a task to measure it.
2. Add a test that the 200 (non-empty and empty) path does not exceed the floor under the test fixture, or record that it is measured and by how much. The existing timing-oracle test pattern should be extended to the new route.
3. Say explicitly whether the empty-200 and non-empty-200 are intended to be timing-indistinguishable. They differ in work done (no UPDATE/INSERT when empty). Under the floor they should be equal; this is a deliberate property and should be written as a requirement, since it prevents an authorized-but-curious facilitator from probing for "archived defaults exist" via timing. That is low-impact for an authorized caller (they can read `GET /topics/all` anyway), so I rate the property itself low, but the floor-exceeded scenario is the real concern.

### H2 (carry-over, MEDIUM): thrown-path skips the floor, and bulk has more ways to throw

The design copies single restore's thrown path (ROLLBACK, rethrow, no `applyTimingFloor`) and calls it an "inherited gap". I accept inheriting it for consistency, but bulk adds two new deliberate throw sites: row-count mismatch (D17) and audit-insert failure. Both are reachable only by a caller who has passed every gate, so they are not an existence oracle for unauthorized callers. Rated medium for that reason. Condition: the follow-up issue in tasks.md section 8 must have an owner and must cover bulk, not just "all topic writes" as a generic phrase. I would prefer that bulk apply the floor in its catch (a three-line deviation) and diverge from single restore; consistency with a known defect is not a security argument. If the team keeps the copy, record that decision as a security exception with an expiry, not just a "named gap".

### M1. Audit-failure semantics are decided but inconsistently with the log-emit path (MEDIUM)

D16 says the audit INSERT is in the transaction (failure means rollback and 500) while `emitAuditEvent` after COMMIT swallows failures. The first is the right fail-closed choice: no restore without an audit row. Good. Please say so as a requirement ("a restore never commits without its audit row"), and add a test that forces the INSERT to fail and asserts no topic status changed. Currently D17 mentions it in a sentence but the test list in the design does not.

Separately: the empty 200 writes no audit row. For a successful but empty request this is acceptable (no state change), but those requests still consume limiter budget and are otherwise invisible. Confirm that the limiter's own breach logging is the only trace and that this is acceptable. I consider it acceptable; it should be stated as a decision.

### M2. Audit row content: confirm the actor fields and the skipped list (MEDIUM)

- The single-restore audit row carries `actor_user_id`, `actor_global_role`, `actor_ip`, `team_id`. The design says the bulk row follows suit but does not enumerate. State that `actor_ip` is `request.ip` and that nothing from the request body or headers is logged. Confirm `request.ip` is the trusted-proxy-resolved address, as for the other topic writes.
- Metadata carries `skipped` ids and reasons. Good. Make sure the metadata size is bounded: it is O(N) with N bounded by archived defaults with distinct names, but a team with many legacy archived copies of different names could in principle produce a large JSON. State the bound or cap the stored list (with a count) so the audit row cannot become an unbounded write.
- Provenance asymmetry: single restore writes one `topic.restored` row per topic; bulk writes one `topic.defaults_restored`. Anyone building an incident query on `topic.restored` will miss bulk restores. Add a note to the audit-logging-operations delta that queries for "who restored topic X" must union both operations. The `restored_by` column is written per row in both paths, which mitigates this; mention it as the authoritative per-topic provenance.
- The `restored_at`/`restored_by` columns are overwritten on every restore, and `archived_at/by` preserved, so history of earlier restores is lost from the row. The audit log is then the only history. That makes the audit row's durability matter more; confirm audit_log has retention at least as long as the topic history it explains (see M5).

### M3. Rate-limit accounting: decisions stated, one gap (MEDIUM)

Stated and agreeable: shared per-actor budget, each admitted request spends one unit, 429s not counted, `TOPIC_WRITE_LIMITS` untouched, empty 200 and later 404/409 still spend a unit.

Gaps:
1. One bulk request can restore up to N topics for one unit, where single restore costs one unit per topic. That is the point of the feature, but it means the limiter no longer bounds "topics mutated per window" the way it did. The design's amplification bullet argues that N is bounded by the archived-defaults count, which is true, and a second bulk call restores nothing. I accept it. Please record it as an explicit security decision ("bulk is deliberately one unit; the effect bound is the archived default set, not the limiter") so a later reviewer does not treat it as an oversight.
2. The fail-closed 503 and the Redis timeout are inherited unchanged; confirm the bulk handler goes through `enforceTopicWriteRateLimit` and not a copy, and that the structural test (limiter not imported by session, voting or WebSocket code) is run against the new route's imports. The design says this; make it a task with the specific test name.
3. `attemptedOperation: "topic.defaults_restored"` in the denial context flows into breach logging. Confirm no topic names or other free text can reach those log fields (D18 says ids only; the hygiene test extension is listed as "should be extended". Change "should" to "must", because it is the control).

### M4. Existence-oracle / 404 uniformity (MEDIUM, mostly confirmatory)

- Non-canonical id: 401 for unauthenticated, uniform 404 for every authenticated class, no handler query. Confirmed against the code order. Good.
- Role check precedes team lookup, so a non-facilitator probing arbitrary well-formed team ids gets 403 whether or not the team exists. A facilitator who passes the role check and the limiter then gets 404 TEAM_NOT_FOUND for a nonexistent or template team, identical to the other topic writes. Because the helper `checkStandingFacilitatorOrAdminAuthorization` is global (facilitator status is not per-team), this reveals only team existence to people already authorized to attempt topic writes, which is the established posture. No new oracle. I want the spec to carry a scenario that asserts the bulk 404 body is byte-identical to the single-restore and assign-defaults 404 for the same inputs (the design says the template team is byte-identical; extend to the nonexistent team).
- New oracle surface to check: `200 {restored: [], skipped: []}` versus `409 TOPIC_CUSTOMIZATION_LOCKED` reveals lock state to an authorized facilitator. That is already available through the existing lock indicator and the single-restore 409, so no new disclosure. Fine.
- `skipped` reveals to the caller which active names collide. The caller can already read `GET /topics/all`; no new disclosure beyond authorized data.
- No topic-existence 404 or 422 on bulk, so there is no per-topic-id oracle at all. Good.

### M5. Data retention and deletion are not addressed (MEDIUM, project-level criterion 4)

Neither document says how long `topic.defaults_restored` rows are retained, or whether they are covered by the audit retention policy. The project success criterion is that the retention policy is implemented, not deferred. The proposal says "no migration" because `audit_log.operation` is unconstrained text, which is true, but retention of the new rows should be stated as "same as other audit_log rows, governed by <policy reference>". One sentence closes this.

### M6. Name comparison rule: security-relevant edge cases (MEDIUM/LOW)

The duplicate rule uses `trim().toLowerCase()` with no Unicode normalization, and the design declines to "fix" NFC vs NFD. That is a stated decision, so not hidden. Security angle: this is a correctness rule, not an authorization rule, so a homoglyph or NFD variant bypassing the skip only produces a visible duplicate name inside the caller's own team. No privilege or confidentiality impact. Accepted. Note it so nobody later reuses `normalizeTopicNameForMatch` from `@dipstick/shared` as a security comparator (for example for uniqueness or access decisions); add a one-line doc comment on the shared function saying it is a UX hint, not an identity check.

### L1. Advisory lock behavior under contention (LOW)

The per-team advisory lock serializes writers. A caller with a legitimately unlocked team can hold the lock for the duration of the transaction. Bulk's transaction is a fixed small number of statements (good, "statement count independent of N"). Confirm that:
- `lockTeamTopics` uses a transaction-scoped lock (`pg_advisory_xact_lock`) so a thrown error or connection drop releases it; the design implies this by saying the lock is held "between steps 1 and 5". State it.
- There is a statement or lock timeout, so a stuck holder cannot make every topic write and room open for that team hang indefinitely. If none exists today, that is a pre-existing gap; do not block this change on it, but note it. Because the limiter caps admitted requests at 120 per 10 minutes per actor, a single actor cannot pile up unbounded waiters, which is a useful property worth mentioning.
- Connection pool: the handler takes `db.connect()` before the transaction. A request blocked on the lock holds a pooled connection. With multiple actors targeting one team, pool exhaustion is possible. Pre-existing for the other topic writes; bulk is no worse. Note only.

### L2. Authorization is global, not per-team, for facilitators (LOW, inherited)

`checkStandingFacilitatorOrAdminAuthorization` admits any non-member facilitator for any team. That is the product model (facilitator from another team) and was decided earlier. Bulk does not change it. I mention it only so the review record shows that a compromised facilitator credential can bulk-restore defaults on every team; the effect is limited to reactivating archived defaults, is reversible by archive, and is audited. Combined with H1/M3 the exposure is acceptable. Re-token validation (session middleware) is outside this change and is covered by the main security review.

### L3. Response and caching (LOW)

`Cache-Control: no-store` on every exit is correct and matches assign-defaults. Confirm the 401 from `authMiddleware` and the 429/503 from the limiter also carry it (the design says "every exit" but the middleware and limiter paths are not the handler's). Add one test per class.

### L4. CSRF / method safety (LOW)

State-changing POST with no body and no content type requirement. Because the handler ignores the body, a cross-site form POST (no custom header) is accepted if the session cookie is sent. The design does not mention CSRF protections. I expect the application relies on SameSite cookies and/or an origin check at the framework level for all POST routes. Please confirm that the global CSRF/origin defense applies to this route and that a no-body POST with `Content-Type: text/plain` or `application/x-www-form-urlencoded` is not exempted by "body is never read" (Fastify content-type parsing can return 415 for unknown types before the handler; either outcome is fine as long as the guard is consistent). Add a test with an unusual content type and a large body: it must be ignored or rejected cleanly, never parsed into memory beyond the framework body limit. The proposal's "any body is ignored (not parsed, not rejected)" needs the framework body-size limit stated, since "not parsed" is not the same as "not buffered".

### L5. Frontend authorization is UX only (LOW, informational)

D20 derives `canBulkRestore` from loaded data. I agree this is display logic and the design says the server re-enforces everything and recomputes under the lock, ignoring client input. Keep it that way; no finding. The 409-on-stale-view handling is correct.

## Security decisions that are deferred or implicit

| # | Decision | Status in the docs | Requested action |
|---|---|---|---|
| 1 | Timing floor value covers bulk latency | Implicit; floor is an unmeasured placeholder | Make explicit; add measurement task and test (H1) |
| 2 | Thrown path skips timing floor, bulk adds throw sites | Named, deferred to a follow-up | Name an owner; prefer fixing in bulk now (H2) |
| 3 | No restore commits without its audit row | Mentioned in one sentence in D17 | Promote to a requirement and test (M1) |
| 4 | Empty 200 produces no audit row and one limiter unit | Stated | Record as a security decision (M1) |
| 5 | One limiter unit buys up to N mutations | Implicit in "Amplification" | Record as explicit accepted risk (M3) |
| 6 | Retention of `topic.defaults_restored` rows | Not addressed | State governing policy (M5) |
| 7 | Audit metadata size bound | Implicit | Bound or cap with count (M2) |
| 8 | Provenance split between two audit operations | Not addressed | Document in audit delta; `restored_by` is authoritative per row (M2) |
| 9 | CSRF / origin protection and body-size limit for a body-less POST | Not addressed | Confirm global control applies; add test (L4) |
| 10 | Advisory lock is transaction-scoped; no lock timeout | Implicit | State; note pre-existing gap (L1) |
| 11 | Global (not per-team) facilitator authority | Inherited, decided earlier | None; recorded for the threat model (L2) |
| 12 | `normalizeTopicNameForMatch` is not a security comparator | Implicit | Doc comment (M6) |
| 13 | Hygiene test extension for new route | "Should be extended" | Make mandatory (M3.3) |

## Tests I will want to see before sign-off

1. Cascade matrix for the new route: unauthenticated 401; non-canonical id 404 for each authenticated class with zero handler queries; participant and member facilitator 403 with the machine-readable codes; admin admitted regardless of membership; nonexistent and template teams 404 byte-identical to single restore.
2. Limiter: 403-bound caller consumes no budget; admitted empty 200, 404 and 409 each consume one unit; 429 not counted; Redis failure yields the fail-closed 503.
3. Audit: exactly one row per non-empty request, none for empty; no `topic.restored` rows; metadata contains no names; forced INSERT failure leaves all topics archived; log emit failure still returns 200.
4. Concurrency: two simultaneous bulk requests (one full, one empty, one audit row); bulk racing room open (snapshot is all-or-nothing); bulk racing Add of a same-named topic (duplicate rule evaluated under the lock).
5. Cross-team isolation: a fixture with archived defaults on team B; a bulk call on team A touches none of them.
6. Timing: success, empty, and each denied exit are all at or above the floor, and the floor exceeds measured bulk p95.
7. Hygiene: no topic names in logs, limiter denial context or audit metadata for the new route.
8. Content type and oversized body on the body-less POST.

## Threat model impact summary

- **New asset exposure:** none. No new read surface (the additive `displayOrder` on archived items goes to callers who already read that list).
- **New write capability:** reactivation of archived default topics for the target team, by an already-authorized role, with no client-controlled inputs.
- **Abuse by a compromised facilitator or admin credential:** can reactivate defaults on any team (facilitator) or any team (admin). Reversible, audited, rate-limited, blocked after first session by the lock.
- **Abuse by an unauthorized user:** blocked by the same cascade as single restore; no new oracle identified, subject to H1.
- **Availability:** bounded statement count; lock contention bounded by the limiter; see L1.

Residual risk after the conditions above are met: low.
