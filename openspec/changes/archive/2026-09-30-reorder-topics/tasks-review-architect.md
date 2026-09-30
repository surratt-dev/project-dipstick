# Tasks Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Artifact reviewed:** `tasks.md` (read against `proposal.md` and `design.md`, including the Design review disposition)
**Focus:** Dependency ordering, task granularity, and whether every design decision is both implemented and tested.
**Verdict:** **Approve with required changes.** The group-level sequence is right: schema fix, then shared types, then backend, then frontend, then docs. Inside the groups, though, several tests assert behavior that a later task builds. One task bundles a cross-endpoint change with handler wiring. A handful of accepted review findings have an implementation task but no test. None of this changes the design. It is sequencing and coverage.

I checked the claims below against the code on this branch: `topics.ts`, `topics.test.ts` / `topics-integration.test.ts`, `audit-logger.ts`, `packages/shared/package.json`, `TopicManagementPage.tsx`, and the migrations directory.

---

## 1. What the ordering gets right

- **Migration first, in its own group, with its own commit.** Group 1 has no dependency on anything later, and nothing later can be merged without it. Migration 17 is the current highest, so `18_` is correct.
- **Shared types (2.1) come before any backend or frontend consumer.**
- **`checkTeamExists` (2.3) comes before the test that asserts `TEAM_NOT_FOUND` (2.5).** The order is right. The bundling is not (see R2).
- **The backend comes before the frontend, and the frontend before its tests and the usability check.** Docs come after code, and verification comes last.
- **No frontend API-client task is needed.** `TopicManagementPage.tsx` calls `fetch` inline for `topics/all`, archive, and restore. There is no client module to build first, and adding one here would be scope creep. 5.4 should keep the inline pattern.
- **`attemptedOperation` is typed `string`** (`topics.ts:178, :221`), not `AuditEventName`. So wiring `checkCustomizationLockGate` in 2.3 does not depend at compile time on 4.2. No reorder is needed there.

---

## 2. Required changes (ordering and forward dependencies)

### R1. 2.5 asserts a `200` and an audit row before either exists

2.5 includes "an all-uppercase valid list → `200` with lowercase IDs in the response and audit row." At the end of group 2 the handler has no transaction (group 3) and no audit insert (group 4). This test cannot pass where it sits.
**Fix:** Keep 2.5 to the error cascade. Move the uppercase-canonicalisation success case into a test task after 4.1 (see R3's restructure). Asserting "lowercase in the audit row" needs 4.1.

### R2. Split 2.3: it mixes a cross-endpoint change with new-handler wiring

2.3 does three unrelated things:
- (a) changes shared behavior for TOPIC-003/004/005 (`checkTeamExists` code),
- (b) adds `Cache-Control: no-store` to the new handler,
- (c) wires the lock gate.

(a) is the only edit in groups 2–4 that changes the response of already-shipped endpoints. It should be its own task, done **before 2.2**, with its test changes in the same task. In `topics.test.ts`, the existing 404 tests (e.g. `:158`, `:213`, plus the archive/restore equivalents) each gain `expect(body.error.code).toBe("TEAM_NOT_FOUND")`. Then, if anyone bisects a TOPIC-004/005 regression, it lands on a small, self-contained commit and not inside the reorder handler work.
**Fix:** Make a new 2.2a, "Amend `checkTeamExists` + update existing 404 assertions for TOPIC-003/004/005". Keep (b) and (c) in the handler task.

Also, for (b), state *where* the header is set: once at handler entry (`reply.header("Cache-Control", "no-store")`), not per branch. That is the only way the `200` from group 3 and the thrown-path `500` from 3.3 (which goes through the global error handler on the same `reply`) also carry it. The design says "every response from this handler, including errors," and per-branch setting will miss the thrown path.

### R3. The group 3 / group 4 split puts audit-dependent tests before the audit code

The group 4 note says 3.3, 4.1, and 4.2 are one atomic unit, but the tasks are interleaved with tests that depend on the unit being complete:
- **3.8** asserts "the later audit row's `previous_order` equals the earlier row's `new_order`." That needs 4.1.
- **3.2** and **3.4** return `200` "after `applyTimingFloor`," but the success path's final step (Decision 2 step 8: audit insert → read hint → `COMMIT` → `emitAuditEvent`) is split across 3.4 and 4.1/4.2.

**Fix:** Restructure groups 3 and 4 as implementation first, then tests:
- **3A (implementation):** 3.1, then the `openSessionCreatedAt` helper from 3.4, then 3.2 (the no-op branch uses that helper), then 3.3, 4.2 (`AuditEventName`), and 4.1. Finish with the success path's `emitAuditEvent` after `COMMIT`.
- **3B (tests):** 3.5–3.10, 4.3, and the uppercase case moved from 2.5.

This also fixes a smaller forward reference: 3.2 (no-op) "reads `openSessionCreatedAt`," but the query and the admin-null rule are only defined in 3.4.

### R4. The unknown-body-keys decision is made in docs (9.1) after the code is written (2.4)

9.1 says "Unknown body keys: follow whatever TOPIC-003 does today… and state it." That is an implementation decision deferred to a documentation task. TOPIC-003 destructures a typed body (`topics.ts:255-258`) and ignores unknown keys.
**Fix:** In 2.4, state "unknown top-level keys are ignored (matches TOPIC-003)" and add a test case to 2.5 (`{ orderedTopicIds: [...], extra: 1 }` is not a `422`). 9.1 then just records it.

### R5. 1.3 must be written red *before* 1.1, or its "confirm it fails" step is circular

1.3 says "Confirm the test fails against the pre-migration constraint." Written after 1.1, that means migrating down, running, and migrating up again. That works, but it is easy to skip.
**Fix:** Order group 1 as 1.3 (write the regression test, observe the `23505`/`500` on the current schema), then 1.1, 1.2, 1.4, 1.5.

### R6. The shared package must be rebuilt between 2.1 and any consumer

`@dipstick/shared` resolves through `dist/` (`package.json` `main`/`types` → `./dist/index.*`). The backend and frontend will not see `ReorderTopicsRequest` / `ReorderedTopic` / `ReorderTopicsResponse` until `npm run build -w packages/shared` (or the workspace equivalent) runs.
**Fix:** Add to 2.1: "Build the shared package, and confirm `tsc` passes in the backend and frontend before 2.2." This is the most likely stall point for an implementer working through the tasks in order.

---

## 3. Required changes (design decisions without a test)

Each item below was accepted in the Design review disposition, and a task implements it. No task **tests** it. "Confirm" tasks in group 10 are review steps, not regression protection.

| Decision / finding | Implemented in | Missing test | Add to |
|---|---|---|---|
| Decision 3 / M8: each phase asserts N rows and throws `ReorderRowCountMismatchError` | 3.3 | No test that a row-count mismatch rolls back and yields `500` (unit test with mocked `db` returning `rowCount ≠ N`; assert `ROLLBACK` issued, no audit row) | 3B |
| Decision 6 / F6 / m7: log line carries `actorUserId`, `actorGlobalRole`, `actorIp`, `teamId`, `topicCount` only | 4.2 | 4.3 checks the DB row, not the `emitAuditEvent` payload. Assert the exact field set and the absence of the ID arrays, plus that the emit happens after `COMMIT` (the `audit-logger.js` mock already exists in `topics.test.ts`) | 4.3 |
| Decision 10 / F4: cap of 200, checked before per-element work | 2.4 | 2.5's "each malformed-body case" doesn't name the boundaries. State: `[]` → 422, 200 valid-looking entries passes validation, 201 → 422, and 201 **non-UUID** entries → 422 with the *length* message (proves ordering) | 2.5 |
| F3: `422` message never echoes submitted values | 2.4 | Assert the `422` body does not contain the submitted string | 2.5 |
| Decision 2: `applyTimingFloor` on every handled exit | 2.2–3.4 | 10.2 is a manual confirm. `topics.test.ts` already has the pattern ("applies the timing floor on the 404 branch", `:657`). Add one assertion per exit (`403`×2, `404`, `409` lock, `422`, `409` stale, `200` no-op, `200`) | 2.5 / 3B |
| Decision 7 / F1: for admins, the query is **not run** (not just `null`) | 3.4 | 3.9 asserts `null` only. A unit test should assert no `sessions` query is issued for `application_admin`. That is the security boundary, not the output | 3.9 |
| Decision 8 rule 2: moves, **Save, and Discard** disabled while a Remove **or Restore** dialog is open | 5.5(b) | 7.2 covers move buttons with a Remove dialog only. Add Restore-dialog-open, and Save/Discard disabled in both | 7.2 |
| Decision 8: on `200`, patch `data.active` with **no refetch** | 5.4 | 7.1 asserts "one request," but not that no `GET /topics/all` follows. Make it explicit | 7.1 |

---

## 4. Recommended (not blocking)

- **Integration tests self-skip without Postgres.** `topics-integration.test.ts` uses `describe.skipIf(!dbUp)`. Tasks 1.3, 1.4, 3.5, 3.6, 3.7, 3.8, 3.9, and 3.10 only mean anything against a real database: the partial index, the two-phase `23505` behavior, and the `session_topics` byte-identity checks cannot be verified with the mocked `db`. 10.1 should say "with Postgres reachable, and confirm the integration suite reports tests *run*, not skipped." Otherwise the most important group 1 evidence can pass green by skipping.
- **3.6 "forced failure after phase 1."** Pick the mechanism in the task so the implementer doesn't invent a test-only hook in production code. The least invasive option is a unit test with a mocked client that throws on the phase 2 statement and asserts `ROLLBACK`, combined with an integration-level check that no partial state survives a rolled-back transaction.
- **3.10 needs hand-inserted `session_topics` fixtures.** Nothing populates them today (#175). Say so in the task, so nobody reads an empty table as "byte-identical" and calls it proven.
- **5.1 "Unit-test the helpers."** The helpers need to live in their own module (e.g. `pages/topicOrder.ts`), or be exported, to be unit-testable. Say which.
- **7.5 depends on 8.1.** The sticky-bar check is recorded "in the task 8.1 session." That is fine, but 7.5 cannot be ticked until group 8 runs. Note the dependency so group 7 isn't marked done early.
- **8.2 may change the component after group 7's tests pass.** If the compact layout is implemented, re-run group 7 before 10.1. That is implicit in 10.1, but make it explicit.
- **9.7 is an external side effect** (a GitHub comment on #175). It has no code dependency, but it is the only record of the snapshot-point assumption that `openSessionCreatedAt`'s status list rests on. Do it as soon as 3.4 is settled, not last, so #175's owner has it before they design.

---

## 5. Coverage check against the design (summary)

| Design element | Task(s) | Tested? |
|---|---|---|
| D1 migration, markers, M1 drop, Down re-spread | 1.1, 1.2 | 1.2 (manual), 1.3, 1.4. **OK with R5** |
| D2 cascade, wrapper auth, lock-before-body | 2.2–2.4 | 2.5. **Gaps in §3** |
| D2 `checkTeamExists` code (M6) | 2.3 | existing 404 tests. **Split per R2** |
| D2 `Cache-Control: no-store` (F6) | 2.3 | 2.5. **Set at entry, per R2** |
| D2 lowercase canonicalisation (F2/M2) | 2.4 | 2.5. **Success case moves, per R1** |
| D3 two-phase renumber, row-count assertion | 3.3 | 3.5, 3.6. **Mismatch path untested (§3)** |
| D4 stale 409, constant body, no oracle | 3.1 | 3.7 |
| D5 last-writer-wins | — | 3.8. **Needs audit, per R3** |
| D6 audit row, log fields, no-op silent | 4.1, 4.2 | 4.3. **Log fields untested (§3)** |
| D7 `openSessionCreatedAt`, draft excluded, admin null | 3.4 | 3.9. **"Query not run" untested (§3)** |
| D8 frontend state, locking, guard, errors, a11y, sticky bar | 5.x, 6.1 | 6.2, 7.1–7.5. **Rule 2 partial (§3)** |
| D9 compact layout | 8.2 | 8.1 |
| D10 cap 200 | 2.4 | **Boundaries not named (§3)** |
| D11 top/bottom, no DnD | 5.1, 5.2 | 7.1 |
| Risks: sentinel team locked | — | 3.7 |
| F7 timing-floor measurement note | 10.2 | n/a (note) |
| Session isolation / no `session_topics` writes | — | 3.10, 10.4 |
| Docs (contract, use case, FR-2.7, validation report, #175) | 9.1–9.7 | 10.6 (validate). **R4 moves one decision out of 9.1** |

Every design decision and every accepted review finding has an implementing task. The gaps are in tests (§3) and in sequencing (§2). With R1–R6 and the §3 test additions folded in, I'd consider the task list ready to implement.

— Ingrid Sollenberger
