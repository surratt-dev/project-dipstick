# Tasks review: Solution Architect (Ingrid Sollenberger)

**Scope of this review:** the task list itself, ordering and dependencies. I am not reopening Decision 1 (B) or any other design decision. I checked each task's assumptions against the branch (`content.ts`, `content.test.ts`, `team-content-access-helper.ts`, `audit-logger.ts`, and the integration tests that call TOPIC-001).

**Verdict: approve once B1–B3 are fixed.** The dependency spine is sound: read (2) → predicate and handler (3) → tests (4) → docs (5) → verification (6). The problems are local. One task uses a symbol before the task that adds it. One task depends on an unlisted test migration landing at the same moment. One test task rests on a wrong premise about what an existing test covers.

---

## Blocking

### B1. 3.3 emits an event that 3.5 has not declared yet

3.3 says "emit the 3.5 event". `emitAuditEvent` takes `event: AuditEventName` (`audit-logger.ts` ~456), so the handler does not typecheck until `"topic.config_read_denied_role"` is in the union. 3.5 also mixes two files and two concerns: the union member in `audit-logger.ts`, and the emission plus `reason` derivation in `content.ts`.

**Fix:** split 3.5.
- **3.0 (new, first in section 3, or 2.3):** add `"topic.config_read_denied_role"` to `AuditEventName` with the #187 / log-only / metadata / content-boundary comment.
- **Fold the rest of 3.5 into 3.3:** on predicate denial, derive `reason` (after the predicate returns `false`), emit via `emitAuditEvent(request.log, …)`, then `applyTimingFloor`, then `denyAccess`. The gate, the event, and the floor are then one task, in the order Decision 2 step 6 gives.

### B2. 3.2 breaks existing tests that 4.0 does not list, and the two must land together

`content.test.ts` mocks `db.js`, so the real helper runs and every `db.query` row is consumed in order. As soon as 3.2 adds the second read, each member-path TOPIC-001 unit test hands its topics row to `readActiveMembershipRole`. That row has no `role`, so `liveRole` is not `"participant"`, the caller is denied, and the test fails with a confusing `403`.

1. **4.0's list is incomplete.** It names ~316, ~331 and ~370. It leaves out **"does not select team_annotation or its provenance" (~818)**, which uses `mockMemberGrant("participant")` and expects `200`. Everyone who runs the suite after 3.2 will hit this. Add it to 4.0. Also tell 4.0 to grep `content.test.ts` for `/topics"` and move **every** member-grant hit, rather than relying on a list of line numbers. Today there are six hits: 323, 337, 350 (facilitator, untouched), 363 (4.1), 378, and 826.
2. **Ordering.** 4.0 is not a later test task. It is the other half of 3.2. State that 3.2 + 3.3 + 4.0 are one green unit: no commit or checkpoint between them has a passing `content.test.ts`. A simple fix is to write 4.0's fixture helper before 3.2, then migrate the tests in the same step as 3.2.

### B3. 4.1 assumes the existing EM test is path 2. It is path 2', so the plan has no path 2 unit test

`mockMemberGrant(role)` hardcodes `global_role: "engineer"` (`content.test.ts` ~59–63). The test "is present regardless of caller role — engineering_manager grant" (~357) is therefore **EM membership + engineer global role**, which the helper degrades to `member / participant` and logs as `team.access_grant_mismatch` (helper ~165–179). That is path 2', the same state as 4.2(a). Flipping it as 4.1 describes gives two tests for path 2' and none for path 2 (`member / engineering_manager`: global EM + EM membership). 6.4 asks the security reviewer to sign off on "path 2", but no task builds that test.

**Fix:** 4.1 rewrites the flipped test on the 4.0 fixture as `mockTopic001MemberGrant("engineering_manager", "engineering_manager")`. That is true path 2, with `reason: "membership_em"` (membership takes precedence when both signals are EM, per Decision 6) and **no** `team.access_grant_mismatch` event. 4.2(a) stays the path 2' case. Name the test for the grant it builds.

---

## Non-blocking

- **N1. 4.9 duplicates 4.0 and refers forward to 5.2.** 4.0 already moves "does not remap…" onto the fixture. 4.9 then edits the same test again and points its comment at the contract's "As built (#187)" note, which does not exist until 5.2. Fold 4.9 into 4.0 (add `statusCode === 200` during the move), and either do 5.2 first or accept that the comment refers ahead. Either is fine. Pick one so the implementer does not touch the test twice.
- **N2. Remove queued rows from tests that flip to deny.** The current ~357 test queues a topics row and a lock row. After 4.1 neither query runs, and an unconsumed `mockResolvedValueOnce` can carry into the next test, depending on whether the `beforeEach` clears or resets mocks. 4.1 and 4.2 should queue only the rows the deny path reads, so 4.1's `toHaveBeenCalledTimes(2)` is the only thing proving the gate.
- **N3. 2.2 file path.** The helper's unit test is `packages/backend/src/auth/__tests__/team-content-access-helper.test.ts`, not a file next to the helper. Give the full path, as the other tasks do.
- **N4. Run 6.1 early as well.** The delta specs already exist, so `openspec validate --strict` can gate the start of section 2 as well as the end. That costs nothing and catches spec drift before code depends on it.
- **N5. 6.3 has a check that cannot run inside this change.** "After sync or archive, the same grep over `openspec/specs`" happens after the task list is done. Either mark it as an archive-time check or move it to the archive step, so 6.3 can be ticked honestly.
- **N6. 4.8 regression list.** `topic-annotation-integration.test.ts` ~471 (an engineer with a participant membership gets `200` on TOPIC-001 against a real database) is the integration counterpart of 4.3. Name it next to the template-team and `topics-integration` checks. I confirmed that the other `/topics` hits in integration tests (`restore-topic`, `session-topic-edit-isolation`, `template-team-creation-regression`, the rate-limit suites) are POSTs, so they are not affected.
- **N7. Sections 5 and 3–4 are independent.** Contract and comment tasks 5.1–5.6 depend on nothing in sections 2–4 and can run in parallel. 3.4 and 5.6 must both be done before 6.3's grep. That is already implied, but saying so helps whoever splits the work.

## Suggested sequence

1. 6.1 (pre-check)
2. 2.1 → 2.2
3. 3.0 (event name)
4. 3.1 (pure predicate, which can be unit-checked on its own)
5. 4.0 fixture helper → 3.2 + 3.3 (with the emission) + the full 4.0 migration, as one unit → 3.4
6. 4.1 (path 2) → 4.2–4.5, 4.10–4.12
7. 4.6–4.8 (integration)
8. 5.1–5.6, any time after step 1
9. 6.1–6.5
