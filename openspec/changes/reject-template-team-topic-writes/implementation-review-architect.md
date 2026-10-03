# Implementation Review: reject-template-team-topic-writes (#188)

*Reviewer: Ingrid Sollenberger, Solution Architect. Scope: `git diff main...HEAD` (working tree clean).
I compared it with `design.md` D1 to D6 and with the existing patterns in `packages/backend`.*

## Verdict

**I approve with one blocking test-isolation fix.** The production change matches the design
exactly, and the boundaries are where the design put them. The one blocking item is in the test
harness. It is cheap to fix, and it matters because it can leave the shared template in a state that
no test restores.

## Conformance to design

| Decision | Status | Notes |
|---|---|---|
| D1 `checkWritableTeam` replaces `checkTeamExists` | Conforms | All five handlers call it at step 2, after authorization and before the lock. `checkTeamExists` is gone. The header comment, the file check-order comment and the per-handler "Step 2" comments are updated. `TopicWriteDenialContext` is extracted and used by all four helpers. The envelope is built first and the same object is sent, so the audit `correlationId` matches the response. No header is set in the helper. |
| D2 constant compare, no extra round trip | Conforms | `ctx.teamId === DEFAULT_TOPICS_TEAM_ID` runs after the existing `SELECT`. The non-template DB call sequence is the same as before. |
| D3 separate operation, fail-open audit | Conforms | `topic.write_denied_template` is added to `AuditEventName` with a doc comment. Only the insert is inside `try/catch`. The event is emitted on both outcomes with `auditRowWritten` and `correlationId`. The failure log carries `audit_write_failed: true` and `dbErrorCode`/`dbErrorMessage`, and never the raw `err`. The audit write runs before `applyTimingFloor`. `metadata` is exactly `{ endpoint, attempted_operation }`. `writeLockDenialAudit` is unchanged, as the design says. |
| D4 structural test over registered routes | Conforms | `registerRoutes` was extracted from `app.ts` with nothing changed. The `onRoute` hook is registered before the routes. The prefix regex accepts any param name. Methods are normalized to an array, including `ALL`/`*`. `EXTRA_IN_SCOPE_ROUTES` is empty and there is no exemption list. The test asserts the `TEAM_NOT_FOUND` code plus exactly one scoped audit row. It runs the snapshot, assert-unchanged and restore steps, and fails instead of skipping under `REQUIRE_DB`. |
| D5 parity table, regression, 5.6 | Conforms | Bodies are harmless. Audit counts are scoped by actor, DB clock and endpoint. The regression is in its own file and uses valid writes with a completed sentinel session. 5.6 is rewritten and its fallback is removed. |
| D6 BRD rationale | Conforms | One-line rationale under FR-8.1. |

**Boundaries.** The guard stays application-layer and is confined to `topics.ts`. There is no schema
change, which matches the F3 deferral. `register-routes.ts` keeps WebSocket, session store, helmet and
auth middleware in `app.ts`, as D4 requires, so `app.ts` keeps its coverage exclusion and the test
never imports it. The membership-chain routes (F1) are untouched. Remaining human gates: tasks 6.1 to
6.3 (the data check owner and result, and filing F1 with the B1 content) are still open and still
block the merge.

**Pattern consistency.** The real-DB harness follows `topics-integration.test.ts` and
`helpers/real-db.ts` (`probeInfra`/`requireInfraOrThrow`, dynamic module loading, `Fixture`,
`redis.quit()`). `buildFullApp` is a reasonable sibling of the existing `buildApp` helper. The
fail-open audit follows `auth/fail-open-audit-write.ts` in spirit without borrowing its `auth.*`
name, as D3 intended.

## Evaluation of the reported deviations

### Deviation 1: `restoreTemplate` deletes only non-snapshot `is_default = false` rows. **Accepted, and an improvement.**

`default-topic-provisioning-integration.test.ts` swaps the template's `is_default = true` rows for a
fixture set with fresh ids, then swaps them back with the original ids, and runs in parallel. Suppose
the snapshot were taken while the swap was in place and the restore deleted *every* id missing from
it. The restore would then delete the original seeded rows that the provisioning suite had just put
back, which empties the template for the rest of the run.

Narrowing the delete to `is_default = false` is sound because TOPIC-003 inserts only
`is_default = false`, which makes those rows the only kind a guard regression can add. Detection is
not weakened: `assertTemplateUnchanged` still compares every row in every status, so an extra
`is_default = true` row would still fail the test. That row would simply not be cleaned up, which is
acceptable because the run has already failed.

Suggestion S2 asks for one sentence in `design.md` D5's "Restore" paragraph so the spec and the
helper agree. The helper's header comment already explains the reasoning.

### Deviation 2: `topics-integration.test.ts` `afterEach` deletes sentinel audit rows by actor only. **Accepted.**

The old `team_id = ANY([..., SENTINEL_TEAM_ID])` delete would wipe every other file's concurrent
`topic.write_denied_template` rows. That makes the "exactly one row" assertions in the parity table
and the structural test flaky, and it contradicts D5's scoped-audit rule (engineer S2). Every
sentinel audit row this file writes is attributed to `facilitatorId`, `facilitator2Id` or `adminId`,
which the actor clause already covers, so nothing leaks. This deviation is needed for D5 to hold and
does not depart from it.

## Blocking

**B1. Snapshot-and-restore can bring back another file's in-flight template state, and this change
adds a file that deliberately creates such state.**

`template-snapshot-integration.test.ts` writes directly to a live template row
(`team_annotation = 'self-test'`, `display_order = 987654`) and inserts a custom row. Vitest runs
files in parallel. Two other suites snapshot the template and then restore it unconditionally from
that snapshot by id:

- the structural test (`topic-write-template-guard-structural.test.ts`);
- the regression test (`template-team-creation-regression-integration.test.ts`).

That gives two failure modes:

1. **Flake.** `assertTemplateUnchanged` fails in the structural or regression test while the
   self-test's mutation is live. The self-test can also fail the other way round.
2. **Durable corruption.** The structural test takes its snapshot during the self-test's window. The
   self-test restores first. The structural test's `restoreTemplate` then writes
   `team_annotation = 'self-test'` and `display_order = 987654` back onto the seeded row.

   The same thing can happen with `topic-annotation-integration.test.ts`, which annotates a template
   row with `annotation_updated_by = F` and then deletes user F. A snapshot that captured F gets
   restored. Then either the restore fails on the `annotation_updated_by -> users(id)` FK, or F's
   cleanup fails.

   A corrupted template then breaks later tests in the same run, such as topic-annotation's
   "never-annotated rows read NULL" and every team-creation copy. No `finally` repairs it.

Deviation 1 fixed one instance of this race (the provisioning swap), but the general mechanism is
still there. **Fix (pick one):**

- **(a)** Run the self-test inside a single client transaction and roll it back. Make
  `restoreTemplate` and `assertTemplateUnchanged` take an optional `PoolClient` so that the self-test
  never commits a mutation.
- **(b)** Put the self-test, the structural test and the regression into one file so they run one
  after another. The design's Risks section already names this as the fallback.

Option (a) is smaller and also gets rid of the self-test's own exposure to the parallel writers.

## Suggestions (non-blocking)

- **S1.** The structural and regression suites remain exposed to the provisioning swap and to
  topic-annotation's direct template annotation, through `assertTemplateUnchanged` (flake, not
  corruption, once B1 is fixed). The design's Risks section names this and says what to do if it
  flakes. Record it in tasks.md as a known residual, so whoever sees the first flake moves the
  writers together instead of loosening the assertion.
- **S2.** Add the deviation 1 rationale (delete only `is_default = false` rows that are not in the
  snapshot, and update by snapshot id) to D5 "Restore".
- **S3.** `restoreTemplate` does not restore `name`/`prompt`/`vote_type`. That is correct, because no
  topic-write endpoint changes them, and the regression's snapshot comparison would catch it if one
  did. Say so in the helper's doc comment so a future endpoint that edits names (rename-topic) knows
  to extend it.
- **S4.** The parity between the template 404 and the missing-team 404 relies on both branches
  building the envelope with the same literal arguments, and those arguments are currently written
  out twice. A one-line `teamNotFoundEnvelope()` in `topics.ts` would make that parity hold by
  construction rather than by convention. This is optional: the parity table already tests it.
