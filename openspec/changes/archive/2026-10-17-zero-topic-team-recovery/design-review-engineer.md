# Design review: zero-topic-team-recovery (#200)

Reviewer: Marcus Oyelaran, Full Stack Engineer. Scope: implementability, boundaries, technology fit, hidden coupling, missing error paths. Checked against `routes/topics.ts`, `routes/content.ts`, `routes/facilitator-sessions.ts`, `sessions/default-topics.ts`, `sessions/session-topic-snapshot.ts`, `auth/topic-lock-*.ts`, `routes/topic-write-rate-limit.ts`, `routes/topic-write-context.ts`, and the frontend `ActiveTopicsEmptyState` / `TopicManagementPage`.

## Verdict

Implementable, and the shape is right: a dedicated endpoint beats opening the lock, and the advisory-lock-plus-precondition design is sound. But the design asserts three reuse claims that do not hold against the code, and each hides real work. I would approve after fixing the blocking items below (B1-B3). None change the architecture; they change the task list and the time-box.

## Blocking

### B1. `copyCanonicalDefaults` returns `void`; the design relies on a row count
D2 step 7 says "zero copied rows throws `NoActiveTopicsError`" and the endpoint returns `{ topicCount }`. The function is `Promise<void>` and runs a plain `INSERT ... SELECT` with no `RETURNING`. Team creation never needed a count because `snapshotSessionTopics` catches the empty case later. So:

- The signature must change (return `rowCount`, or `RETURNING`). That is a shared-function change with a second consumer (`POST /api/v1/teams`, facilitator-sessions.ts:705), so it needs the existing team-creation tests to stay green. Add this to the task list; the "everything already exists" framing in Context is not true here.
- `NoActiveTopicsError(sessionId)` takes a session id and formats a session message. There is no session here. Either add a sibling error or loosen the constructor. Do not pass a team id into a `sessionId` parameter.
- Prefer one statement `INSERT ... RETURNING id` and use `rows.length` as `topicCount`. This also gives the audit `topic_count` without a second query, and the count then cannot disagree with what was written.

### B2. The TOPIC-002 denial-audit helper is private to `content.ts` and hard-wired to TOPIC-002
D9 and Impact say "reuse it; do not fork its SQL cast rules". In the code, `insertTopic002DenialAuditRow`, `runDenialAuditStep`, `TOPIC_002_DENIAL_INSERT_SQL`, `TOPIC_002_DENIAL_OPERATION`, `TOPIC_002_ENDPOINT` and the `Topic002DenialReason` union are module-private, and the `topic.audit_write_failed` event carries TOPIC-002's endpoint and operation constants. You cannot import it into `routes/topics.ts`, and a copy is the fork the design forbids.

Options, in my order of preference:
1. Extract a small parameterized helper (operation, endpoint, reason) into `auth/` beside `fail-open-audit-write.ts`, and make TOPIC-002 call it. This touches #264's code and its tests; budget for it and keep the TOPIC-002 test suite as the regression net.
2. Drop the 403 audit for this endpoint and follow TOPIC-003..006 (they audit no 403s). This is the cheaper path, but it reverses ratification item 5, so it is a PO call, not mine.

Either way, state it in the design. The "copy of the helper pattern" wording in D9 understates a refactor of shipped, security-reviewed code. Also note the existing helper reads `actor_roles` from `users` inside the insert; decide whether the new row wants that column (the runbook "who did this" query might).

### B3. "Archived and active same text is acceptable" breaks an existing read path
D3 accepts an archived row and an active row with the same name after assignment. `GET /topics/all` computes `defaultTopicsNotActive` with `LEFT JOIN topics t ON t.team_id = $1 AND t.name = dt.name`, then filters rows whose `team_topic_status !== 'active'`. With an archived "X" and an active "X", the join yields two rows for default X; the active one is filtered out but the archived one survives. The screen would then list X as an archived default that can be restored, even though an active X exists. Once the team unlocks, a restore would create two active topics with the same name (unless TOPIC-005 checks for a name collision; I did not verify, and the design should).

This is reachable by exactly the population this feature serves (a zero-active team that has archived rows, which D3 and the Appendix explicitly allow). Either fix the join (de-duplicate by name, prefer the active row), or restrict the precondition, or add a test and a decision for the restore collision. At minimum add a test: zero-active team with an archived default, assign, GET all, assert `defaultTopicsNotActive` is empty.

## Should fix

### S1. D8 "read live in the same transaction" is not what `hasCompletedFirstSession` does
`hasCompletedFirstSession` and `getTopicLockState` query through the pool (`db.query`), not the transaction client. Inside `/advance` that is a second connection while a client is checked out and the advisory lock is held. It works, and the stale-message risk is negligible (session completion does not take the topic lock), but the design's claim is wrong. Do the read after `ROLLBACK`, in the `NoActiveTopicsError` branch only, so no second connection is held mid-transaction. Also note that `topic-lock-helper` is mocked as a whole module in tests; plan the advance tests accordingly. Say "read after rollback, advisory" rather than "same transaction".

### S2. Check order has an unstated seam with `checkWritableTeam` and the context type
`TopicWriteDenialContext` requires `actorUserId`, `actorGlobalRole`, `endpoint`, `attemptedOperation`. `attemptedOperation` is a free `string`, so the template-denial reuse works. But `checkWritableTeam` returns 404 for a missing team after the rate limiter, which means a 404 `TEAM_NOT_FOUND` for an admin on a bogus id consumes budget. That matches siblings, fine, but say so. Also `checkWritableTeam` is not deactivated-aware (existing decision 11), so an admin can assign defaults to a deactivated team. Probably harmless; record it as accepted so a reviewer does not rediscover it.

### S3. Error paths not specified
- A non-`NoActiveTopicsError` failure in the transaction (23505 from constraint drift, connection loss, audit insert failure). The room-open and team-create handlers answer a fixed 500 with the error logged and never formatted into the body. State that this endpoint does the same, with a code distinct from `DEFAULT_TOPICS_UNAVAILABLE`, or the 500 copy ("template is empty") will be shown for an unrelated fault. The screen's 500 branch keys on the code; make that explicit.
- `emitAuditEvent` after COMMIT must not be able to turn a committed success into a 5xx. Wrap or confirm it cannot throw.
- In-transaction audit insert failure on the success path: fail-closed (rollback, 500) is correct and consistent with `topic.custom_added`; say so.
- `ROLLBACK` and `client.release()` in `finally` on every early return (the 409 precondition path especially). The advance handler's pattern of returning mid-try after ROLLBACK is easy to get wrong when copying it.
- Timing floor on the 201, 409 and 500 paths, not only refusals.
- `Cache-Control` on the 201/409; match siblings.

### S4. `canAssignDefaults` placement and parity
The handler already has `activeResult` and `decision.actorGlobalRole`; `isTemplateTeam` is already imported via `topic-lock-state`. So no extra query is needed, as D6 hopes. But `canAddTopics` has a dedicated parity test (`topic-add-flag-parity.test.ts`) tying the expression to the endpoint's authorization function. Do the same: export one `isApplicationAdmin`-style predicate used by both the new endpoint and the flag, rather than two expressions kept in step by a test. This is the "explicit contracts over implicit conventions" point, and the eight-row table test then guards behaviour, not duplicated logic.

### S5. Frontend coupling
- `ActiveTopicsEmptyState` takes a closed `ActiveEmptyStateVariant` driven by `activeEmptyStateVariant(locked, archivedCount)` in `pages/addCustomTopic.ts`. Adding a "locked and can assign" variant is natural, but the component currently renders no state of its own. The assigning/in-flight state, the status/alert regions and the focus move all want to live in `TopicManagementPage` (which already owns `isSaving`, `annotationBusy`, dialogs). Keep the component presentational: add `canAssign`, `assigning`, `onAssign` props, required (not optional), mirroring how `addAllowed` is required so a forgotten call site is a type error.
- The page has busy-state gating for Add (`addSubmitBlockedReason`). Decide whether Assign is blocked by the same states. With zero active topics a dirty reorder is impossible, but an open annotation or archived-view dialog is not. One sentence in the design.
- Assign is shown only when `isCustomizationLocked && canAssignDefaults === true`. D6 says the screen picks by lock state; make the variant function the single place that decides, and unit-test the full (locked, canAssign, canAdd, archivedCount) matrix there rather than in the component.
- Success status line must survive the refetch that replaces the empty state (the component that holds it unmounts). Put the message in page state, not in the empty-state component.

### S6. Concurrency test is harder than the design implies
Acceptance criterion 3 (one 201, one 409, exact count) needs a real Postgres test with two concurrent requests contending on the advisory lock. Mocked `db` cannot prove it. The mandatory real-Postgres test for the audit casts (D9) is the same infrastructure; note both in tasks so they are not mocked. Also note the other racer the design names, room open: add a test that `/advance` blocked behind the assign lock then snapshots the new rows (that is the actual user-visible guarantee).

## Observations and risks

- Lock semantics are correct. `lockTeamTopics` takes `pg_advisory_xact_lock` keyed on the team; add, restore, archive, reorder, room open and the new route all serialize on it, and the snapshot helper's single-statement contract is unaffected. Under READ COMMITTED the zero-active `SELECT` after the lock sees any committed concurrent write. Good.
- Reading the template inside the transaction without locking it means a concurrent template edit gives either the old or the new set, never a mix (single statement). The design's "as read inside that transaction" is accurate; "under the lock" would be misleading since the lock is the team's, not the template's.
- Migration 18's partial unique index on active `(team_id, display_order)` makes the renumbered copy safe against archived rows. Confirmed.
- Deploy ordering (backend before frontend, fail-closed flag) is right and consistent with the `canAddTopics` precedent. The shared type `canAssignDefaults` should be required in the type (so the backend cannot forget it), with the frontend using `=== true` as `canAddTopics` does.
- Source tests (template-guard source test, lock-gate source test) are string/AST assertions on `topics.ts`; adding the route there is easy, but keep the new handler in `topics.ts` so those tests stay meaningful rather than creating a new file they do not scan.
- `topics.ts` is already 1856 lines and `content.ts` 1445. A sixth handler plus the denial helper pushes both. If B2 option 1 is taken, the helper leaves `content.ts`; consider also putting the assign handler's transaction body in `sessions/` or a `topics/` service module so the route stays a thin cascade. Not blocking.

## Scope and time-box

The "about two working days" box looks optimistic against the real task list: the `copyCanonicalDefaults` signature change (B1), the audit-helper extraction (B2), the `defaultTopicsNotActive` fix (B3), real-Postgres concurrency and cast tests, five delta specs, a use-case rewrite, the runbook section and accessibility work. I would estimate three to four days, and I would cut in this order if it grows: usability pass, runbook extras, D10 draft-copy check, then option 2 of B2 (drop the 403 audit) with PO agreement. The endpoint, flag, button, and room-open message are the core and should not be cut.

The five-spec fan-out is acceptable as the BA/Exec dispositions argue, but it is the largest source of non-code effort here; keep each delta to the scenarios the tests will actually assert.

## Requested design edits

1. D2/D4/D5: state that `copyCanonicalDefaults` is changed to return the inserted count and name the error thrown on zero (B1).
2. D9: replace "reuse; do not fork" with the extraction plan or the fallback (B2).
3. D3: add the `defaultTopicsNotActive` duplicate-name consequence and its resolution (B3).
4. D8: correct "same transaction" (S1).
5. D2/D4: add the generic-500 and post-COMMIT-emit rules (S3).
6. D6: single shared admin predicate (S4).
7. Time-box: restate the estimate and the cut order.
