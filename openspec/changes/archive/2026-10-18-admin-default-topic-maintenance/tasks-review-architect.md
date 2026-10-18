# Tasks review: architect (Ingrid Sollenberger)

Scope: does the task ordering respect architectural dependencies, i.e. does any task assume something not yet built. Reviewed against `design.md` (E1 to E12) and `proposal.md`. I have no opinion on the domain, wording or UX.

## Verdict

The backend-first shape (decisions, writer, routes, tests, checkpoint, docs, rollout) is right and the 5.1 commit boundary is a good idea. But the list as written is not executable top to bottom. There are four true forward references (a task needs something a later task builds), two structural tests that go red the moment earlier tasks land, two tasks that are too large to be one unit, and a human-gated task placed at the front that is not a real prerequisite. Section 4 as a single trailing block also means the writer and routes are built with no tests for a long stretch, while three existing suites are broken in the interim. None of this changes the design; it is task sequencing and splitting.

Severity: **B** = blocks (task cannot be done as written), **R** = reorder, **S** = split, **N** = note.

## Findings

### B1. Task 2.2 cannot be completed or tested before 2.3, 2.4 and Section 3
- 2.2 requires "a test per row" of the E3 error-mapping table, which maps typed errors to HTTP statuses, `Retry-After`, the `503` body and `correlationId` envelopes. Those are route-layer behavior (3.3, 3.4). The writer module should throw typed errors; the status mapping belongs in the route/handler.
- 2.2 requires a test that "a gapped or damaged template can still be repaired by add/archive/reorder". Those operations are 2.3.
- 2.2 says "operation (setting `updated_at`...)" and "dense normalization", but the operations are defined in 2.3. 
- 2.2 uses `withAuditTransaction` with an audit insert whose `operation` strings and `AuditEventName` members are added in 3.1.
- **Fix:** split 2.2 into (a) the transaction harness: timeouts, lock, fresh re-read, dense-normalization helper, backstop, audit-insert hook, no-op skip, typed error classes, the input contract (`op`, `actor` with user id, role, ip, `correlationId`); and (b) the E3 table tests, moved to after the routes exist (with the 3.3/3.4 mapping), except the pure-writer rows (forced `23505`, lock timeout via a second connection, `AuditWriteError`), which can be asserted as typed errors at writer level. Move the gapped-template repair test to after 2.3. Define the dense-normalization helper once in 2.2 and have add/archive/restore (2.3) reuse it; reorder shares the negate-then-set step.

### B2. Task 3.1 must precede 2.2 (audit event names), and its list is incomplete
- The writer's audit insert and log copy need the `AuditEventName` members. Move 3.1 to before 2.2 (or into 2.1 beside `MAINTENANCE_AUDIT_OPERATIONS`, so the constant and the union cannot drift; add a test that the constant equals the five union members).
- 3.1 omits `topic.denial_audit_suppressed` (the log-only event in 3.2 and design E2). Either add it to the union or state that it is emitted outside `AuditEventName`. As written, 3.2 assumes a type member 3.1 does not create.

### B3. Task 3.6 (info log event per write) is misplaced and has an unstated transaction-boundary decision
- It is numbered after 3.5, but architecturally it is part of the writer (or its immediate caller) and belongs with 2.2/3.1.
- Decision not recorded: the event must be emitted **after commit**. Emitting inside the transaction logs a write that can still roll back (audit failure, backstop failure), which makes the detective control (E5, S4) lie. State this in the task and test it (forced audit failure produces no `topic.default_*` info event).

### B4. Writes return "the full refreshed list" including `lastChangedAt`, but that value is derived from the audit row the same call inserts
- Design E5/E7 requires every write response to carry the refreshed list; `lastChangedAt/By` for the touched row comes from the audit row written by `auditInsert`, which runs after `domainWrite`. The list read therefore cannot run inside `domainWrite`. 2.2 and 2.4 do not say where the post-write list is read.
- Choices: read after commit with the 2.4 list function (a small race with another admin's write, acceptable because the response is a view, not authority), or read inside the transaction after the audit insert if `withAuditTransaction` allows. Pick one in 2.2 and make 2.4's list read a function callable both ways. Otherwise the first write response will show the changed row with null `lastChangedAt`, a spec-visible bug found only in 4.2.

### B5. Task 1.2 cannot run "before code" using the validators it is meant to check
- 1.2 verifies the migration-11 seeds against the D7 limits and the plain-text rule "(script or unit test)", before 2.1 creates the validators and constants. A throwaway script risks implementing a second, divergent copy of the rule. The design already says 2.1 repeats this as a test.
- **Fix:** fold 1.2 into 2.1 as an explicit acceptance step (seed test using the real validators; if any seed fails, raising the constant is a 2.1 edit). Keep only the PO-facing record of the maxima.

### R1. Tests that go red when earlier tasks land (cross-suite breakage ordering)
Several existing suites break as a direct consequence of code tasks, yet their fixes are in Section 4, so the tree is red for most of the work:
- **3.5 (remove `non_active_default`) and 4.10 (rewrite its two tests)** must be one atomic step. Any 2.3 archive test that then creates a team will log or assert against the old detector.
- **4.9 (invariants baseline reshape) and 4.11 (test hygiene)** must precede the first test that writes a maintenance row to a shared DB (2.2/2.3/2.5 tests). The first archive or maintenance audit row makes invariants (c) and (f) fail in the same CI database, and (f) becomes permanently skipped without the cleanup helper. The hygiene helper (`acquireTemplateLock()`, snapshot restore, guarded audit-row delete, `afterEach` guard) is a prerequisite for every DB test in Section 2, including 2.5.
- **4.8a (rate-limit structural allow-list)** goes red the instant the route module or denial seam imports the limiter (3.2/3.3). It must land with 3.2/3.3, not after them.
- **Fix:** move 4.11 (helper), 4.9 and the 3.5+4.10 pair into a new early "test infrastructure and existing-suite adjustments" step before Section 2 code that touches the database, and move 4.8a to sit beside 3.2/3.3.

### R2. 4.7 (second-writer structural test) sentinel rule conflicts with tasks 3.2/3.3 and existing code
- The rule forbids any reference to `DEFAULT_TOPICS_TEAM_ID`, the sentinel literal or `__default_topics__` outside the writer module. But design E2 item 4 has the route pass the sentinel id as the rate limiter's `teamId`, and the denial seam and list read also need it. Existing production code (the `checkWritableTeam` guard, assign-defaults, `template-anomalies`) already references the sentinel. As worded, the test is red on day one or silently over-exempted.
- Decide before building 4.7 (and therefore before 3.3): the rule applies to SQL statements that write (and to call sites that execute them), not to any reference; or the route imports the sentinel constant from the writer module, with an allowlist of existing referencers. Record the choice in 4.7, and note the day-one allowlist generation depends on 2.x and 3.x being complete, so 4.7 cannot precede them. It is correctly late, but it should be listed as depending on 3.3 as well as 2.3.

### R3. Consumer checklist in 4.12 is a pre-condition, not a trailing test
- 4.12's grep of every consumer of `topics.prompt`/`name`/`first_session_description`, `session_topics.topic_name`, WebSocket payloads, reports, exports and email for raw-HTML sinks verifies the E4a MUST ("every consumer renders as text"). If it finds a sink, the fix is a code change in another module that the whole change's safety depends on, and the fix cannot wait until after the routes exist. Likewise "confirm no other reader of `audit_log` copies or unescapes `metadata`" and "no new dependency".
- **Fix:** split 4.12 into (a) the checklist, moved to Section 1 beside 1.3 (same nature: re-verify an assumption before building), re-confirmed at 5.1 for "no new dependency", and (b) the security tests (mass assignment, `415`, `bodyLimit`, array > 15, no value echo, generic 500), which stay after the routes.

### R4. Task 1.4 (file the follow-up issues) is a human gate sitting in the wrong place
- It is listed as first-section work but is not a prerequisite of any implementation task. Its real consumers are 6.3 (needs the screen issue number), the proposal text, and 7.2 (PR statement). Placing it at the front implies sequencing that cannot be met by the agent team ("the agent team does not create GitHub issues"), and 6.3 is formally blocked until a human acts.
- **Fix:** keep it as a tracked external dependency, but move it to a clearly labeled "Human-gated" step before 6.3, and say 6.3 proceeds with `#TBD` placeholders if the number is not yet available (and what the BA acceptance rule then does). Same applies to 1.1: its "proceeds on defaults if unattended" is fine, but the D2/D7 values are baked into 2.1 and E6 into 4.9, so a later redirection invalidates those; note the rework cost.

### R5. Threat-model revisit in 8.1 happens after merge but may require code changes
- 8.1 revisits the threat model "against the implemented routes", listing CSRF, lock DoS, audit tampering, stored XSS. Any finding there is a code or design change, which cannot sensibly happen after merge. Split 8.1: the threat-model revisit becomes a pre-merge step (after 5.1, before 7.2); only the dry run with a facilitator and the first-edit check stay as rollout items.

### R6. 1.5 and 5.1 contradict each other
- 1.5 says that if `copyCanonicalDefaults` is no longer one statement, move it to REPEATABLE READ or share the lock. That edits `sessions/default-topics.ts` and the #215 suites, but 5.1 requires "the #215 suites unmodified apart from 4.9 and 4.10". State the contingency: if 1.5 triggers, it becomes its own task with its own tests, and 5.1's wording is amended. It is likely a no-op, but the task list should not forbid its own contingency.

### S1. Task 3.3 is too large; split it
It currently bundles: plugin and registration, the role check with live DB read, id canonicalization, rate limit wiring, body validation ordering, seven handlers, `bodyLimit`, timing floor on every return, success statuses, `scope` and `notice` text, and response serialization. Suggested split, in order:
1. Plugin skeleton, registration in `register-routes.ts`, role check, denial path via the 3.2 seam, canonical id check, timing floor, and the two GET routes (needs 2.4). Shippable and testable alone with the 4.1 authorization tests.
2. Write routes: rate-limit step, explicit field picking, validation order, `bodyLimit`, handlers calling the writer, status codes, `scope`/`notice` responses, error mapping from the writer's typed errors (the mapping moved out of 2.2).
3. Fold 3.4 into step 2; it restates the same error-code mapping and "pick fields explicitly" and is separately numbered only by accident.

### S2. Task 4.2 is a single task covering essentially the whole spec; split by operation
It lists ~50 scenarios across add, edit, archive, restore, reorder, history and list. It should be written alongside each operation (2.3, 2.4) and the corresponding route slice, not after everything. Concretely: operation tests per operation next to their implementation; history/limit tests next to the history read; denial bound and timing assertions next to the seam and the floor. Section 4 then keeps only cross-cutting tests (4.1 authorization matrix, 4.3 audit shape, 4.4 isolation, 4.6 inventory, 4.7 structural, 4.12b security).

### S3. Task 2.4 combines two reads and one performance gate
List read and history read are independent; split them so each can be tested with its serializer. The EXPLAIN confirmation requires a populated sentinel audit set to be meaningful; state that it runs against the test database after the operation tests have created rows, or it will show a trivially small plan.

### N1. Smaller sequencing and consistency notes
- Numbering is out of order (3.6 before 3.5; 4.8a/4.8 after 4.12; 4.11 last). Renumber after reordering; cross-references such as "5.4a rule" in 4.8a point at a task that does not exist in this list (it is the #184 numbering) and should name the shared mock helper directly.
- 4.5 greps "docs and response strings" for the word "canonical", but the docs are written in Section 6. Restrict 4.5 to code and response strings, and add the docs check to 6.4/6.5 acceptance.
- 6.1 and 6.4 are contract-shaped; drafting 6.4 (error codes, response shape) before 3.3 would let the route tests and the contract agree, and costs little. Optional.
- 6.6 asks for a cross-reference note in the "archived `harden-team-creation-topic-copy`" change. Editing an archived change is unusual; confirm the intended artifact (a note in this change's archive, or the main spec) rather than mutating an archive.
- 4.1 requires "role changed after login" and "member facilitator" cases; these depend on a test fixture for users with differing `global_role`, which is fine but should be in the shared helper from the early infrastructure step.
- 2.5's team-created-during-open-admin-transaction test needs a deterministic way to hold the transaction open after the negate step (a test seam or a second connection with manual BEGIN). Do not add a production test hook for it; use direct SQL in the test.

## Recommended order

1. **Verification and decisions (no code):** 1.1; 1.3; 1.5; consumer checklist (R3a); decide the 4.7 sentinel-rule scope (R2); decide where the post-write list is read (B4).
2. **Test infrastructure and existing-suite adjustments:** 4.11 helper; 4.9 invariants reshape (checker, its unit test, integration test); 3.5 with 4.10 together.
3. **Writer foundations:** 2.1 (constants, `MAINTENANCE_AUDIT_OPERATIONS`, validators, seed test absorbing 1.2); 3.1 (event names, including the suppressed event, constant-equals-union test); 2.2a (transaction harness, typed errors, input contract).
4. **Operations with their tests:** 2.3 by operation (add, edit, archive, restore, reorder), each with its scenario tests; gapped-template repair test; 2.4a list read; 2.4b history read; 3.6 log event after commit; 2.5 concurrency.
5. **Routes:** 3.2 with 4.8a; route slice 1 (plugin, authorization, GETs) with 4.1; route slice 2 (writes, validation order, error mapping, 3.4) with the E3 table tests, 4.8, 4.5 (code strings only), 4.12b.
6. **Cross-cutting tests:** 4.3, 4.4, 4.6, then 4.7 (needs everything above).
7. **Checkpoint:** 5.1 (plus re-confirm no new dependency); then the pre-merge threat-model revisit (R5).
8. **Docs:** 6.1, 6.2, 6.4, 6.5; 6.3 after the human-gated issue filing (R4), with `#TBD` fallback; 6.6.
9. **Spec sync and PR:** 7.1, 7.2.
10. **Rollout:** 8.1 dry run (post-merge, before first production edit), 8.2.

## Items for the team to decide (not blocking if defaults accepted)
- B4: post-write list read after commit (my default) versus inside the transaction.
- R2: sentinel-reference rule scope for the structural test (my default: writes and executing call sites, with the constant imported from the writer module for non-SQL uses).
- B3: log event after commit (my default; the alternative is incorrect for a detective control).
