# Tasks review: reject-template-team-topic-writes (#188)

*Ingrid Sollenberger, Solution Architect. Focus: does the task order respect architectural
dependencies, and does any task assume something that hasn't been built yet?*

Reviewed against `proposal.md`, `design.md` and the code on this branch (`topics.ts`, `app.ts`,
`routes/__tests__/helpers/real-db.ts`, the workflows).

## Verdict

**Approve with reordering.** The guard itself (§1) is ordered correctly. The test sections have
one hard forward reference and two places where the suite goes red between tasks with nothing to
fix it until later. None of this needs a design change. It is sequencing and one split.

## Blocking (order is wrong)

### B1. Task 2.2 uses a helper that task 4.5 creates

2.2 says "snapshots the template with the shared helper from 4.5". 4.5 is where the helper is
defined ("Add a shared snapshot/compare/restore helper ... Also used by 2.2"). An implementer
working top to bottom reaches 2.2 with no helper, and will either write a second one inline or
skip the no-write backstop (security S3), which is the part of 2.2 that matters most if a future
route skips the guard.

The helper is also not small. Its restore does a one-transaction delete, field reset and the
negate-then-set `display_order` step (`topics.ts` l.1397). That logic needs to be written once and
tested where it is written.

**Fix:** split the helper out of 4.5 into its own task placed **before 2.2** (for example a new
2.0, or a new §2 opening task "Shared template snapshot helper"). 2.2 and 4.5 then both say "use
the helper from 2.0". 4.5 keeps only the team-creation regression.

### B2. Task 1.4 breaks existing test "5.6", and the fix is three sections later in 4.1

Today `topics-integration.test.ts` "5.6" (l.746) expects `409 TOPIC_CUSTOMIZATION_LOCKED` on the
template. The moment 1.4 switches the handlers, that test fails. The fix is 4.1. Between them sit
§2 and §3, so the implementer spends two whole sections with a known red integration suite, and
can't use "the suite is green" as the check after 2.1 (which is a behaviour-neutral refactor and
should be checked exactly that way).

**Fix:** move 4.1 to directly after 1.4 (call it 1.5). It is the one existing assertion the guard
is designed to change, so it belongs with the guard.

### B3. Task 5.1 (lock-dependence audit) runs after the work it should inform

5.1 is discovery: grep for sentinel references and confirm 5.6 is the only test that relied on the
lock protecting the template. That answer decides whether 4.1 is the only existing test to update.
At the end of the plan it can only confirm. If it finds a second dependency, 1.4 has already broken
it and the plan had no task for it.

**Fix:** move 5.1 to the start (a §0 or 1.0), before any code change. Keep the PR-description
listing as an output of it. I ran the grep: the hits match the seven files 5.1 names, so the
expected answer is "5.6 only". That is still worth confirming first rather than last.

## Should fix (split or clarify)

### S1. Split 1.2: behaviour-neutral refactor, then new helper

1.2 does two things: it extracts `TopicWriteDenialContext` and retypes two **existing** functions
(`checkCustomizationLockGate`, `writeLockDenialAudit`), and it adds the **new**
`writeTemplateDenialAudit`. The first is a refactor that should leave every existing test green.
The second is new behaviour. If they land together and a lock-path unit test changes, it is not
clear which half caused it.

**Fix:** 1.2a extract the type and retype the existing two (suite green, no behaviour change);
1.2b add `writeTemplateDenialAudit`.

### S2. 1.3 and 1.4 disagree about who removes `checkTeamExists`

1.3 says "Replace `checkTeamExists` with `checkWritableTeam`", 1.4 says "remove `checkTeamExists`".
Read literally, 1.3 deletes a function that five handlers still call, and the build breaks until
1.4. **Fix:** 1.3 "Add `checkWritableTeam` alongside `checkTeamExists`"; 1.4 switches the five call
sites and then removes `checkTeamExists`. Each task then ends compiling.

### S3. Comment updates in 1.3 describe call sites that don't exist until 1.4

1.3 updates each handler's "Step 2" comment to name the template rule. Those handlers still call
`checkTeamExists` at that point. **Fix:** move the per-handler "Step 2" comment update into 1.4,
next to the call-site change. The helper's own header comment and the file-header check-order
comment can stay in 1.3.

### S4. Unit tests (§3) should follow the guard, not the structural test

§3 depends only on §1. §2 depends on §1 and the snapshot helper. Putting §3 straight after §1
gives the implementer fast mocked feedback on check order and audit failure before building the
real-DB structural harness. 3.1 is also the only enforcement of "template step after authorization"
(design D1), so it should exist before anything builds on the guard.

**Suggested order:** §1 (guard, with 5.6 fix) → §3 (unit) → 2.1 (extract `registerRoutes`) →
snapshot helper → 2.2 (structural) → 4.2 to 4.5 → §7.

2.1 has no dependency on §1 and could equally go first. Wherever it sits, its own check is "full
suite green, no behaviour change", so it should not share a step with anything that changes
behaviour.

### S5. Use the existing shared real-DB harness instead of copying `topics-integration.test.ts`

2.2 and 4.5 tell the implementer to follow `topics-integration.test.ts` l.18 to 71. Since #175,
`routes/__tests__/helpers/real-db.ts` already provides the env defaults, `probeInfra` /
`requireInfraOrThrow` (the REQUIRE_DB rule), `SENTINEL_TEAM_ID` bound to the production constant,
and a `Fixture` with `user(globalRole)`, `unlock()` and FK-ordered `cleanup()`. That covers most
of what 2.2, 4.2, 4.3 and 4.5 need (distinct fixture actors per row, completed sentinel session).

Its `buildApp(mods, userId)` registers only four plugins and doesn't use `registerRoutes`, so 2.2
still needs its own app build. The right place for it is next to 2.1: add a `loadModules`
entry for `register-routes.js` and a small builder in `real-db.ts`, and put the snapshot helper
(B1) in the same directory.

Two cautions for the task text:
- **Never `fx.track(SENTINEL_TEAM_ID)`.** `Fixture.cleanup()` deletes the tracked team's topics,
  sessions and team row. Sentinel sessions must be deleted by id in each test's `finally`, as D5
  says. The task should say this explicitly.
- **2.2 must call `requireInfraOrThrow`.** The structural test is the only mechanism that enforces
  coverage for future routes. In `ci.yml` (no Postgres) it skips. It only fails CI through
  `integration.yml`, which does run on PRs to `main`. The task should state that 2.2 follows the
  REQUIRE_DB rule so it fails loudly in that lane and never skips silently.

### S6. 7.1 (BRD rationale) has no dependency and is not "validation"

7.1 can be done at any time. It is fine at the end, but it should not be bundled with 7.2 as if it
depended on the tests. No reorder needed; just note that it is independent.

## Human gates (§6)

The ordering is correct: §6 has no code dependency and gates the merge, not the implementation.
Two notes:
- 6.1 says "name the owner in `proposal.md`, **then** run". That is a real dependency inside the
  task and is stated. Good.
- Nothing in §1 to §5 should wait on §6. The tasks don't imply that, but the implementer should
  be told explicitly that §6 runs in parallel and blocks only the merge.

## Things I checked and found sound

- 1.1 before 1.3: the constant import precedes its use. `default-topics.ts` has no imports, so
  pulling it into `topics.ts` adds nothing to the unit-test mock surface.
- 1.2 before 1.3: `checkWritableTeam` calls `writeTemplateDenialAudit`, so the helper exists first.
- 2.1 before 2.2 and 4.5: `registerRoutes` exists before anything imports it.
- 2.2's "check that the test can fail" step comes after §1, so there is a guard to bypass.
- 4.2/4.3 harmless bodies don't depend on the snapshot helper, so they are safe in parallel with
  2.2 and 4.5. That holds after B1.
- 7.2 is last and covers both validation and the full suite.

## Proposed order (summary)

| New | From | Task |
|---|---|---|
| 0.1 | 5.1 | Lock-dependence grep (discovery) |
| 1.1 | 1.1 | Import constant |
| 1.2a | 1.2 | Extract `TopicWriteDenialContext`, retype existing helpers (neutral) |
| 1.2b | 1.2 | Add `writeTemplateDenialAudit` |
| 1.3 | 1.3 | Add `checkWritableTeam` alongside `checkTeamExists`; helper and file-header comments |
| 1.4 | 1.4 | Switch five call sites, "Step 2" comments, remove `checkTeamExists` |
| 1.5 | 4.1 | Update existing test 5.6 |
| 2.x | 3.1, 3.2 | Unit tests |
| 3.1 | 2.1 | Extract `registerRoutes` (neutral) and add it to `real-db.ts` |
| 3.2 | from 4.5 | Shared snapshot/compare/restore helper |
| 3.3 | 2.2 | Structural route test (REQUIRE_DB rule) |
| 4.x | 4.2 to 4.5 | Integration tests (4.5 without the helper) |
| 6.x | 6.x | Human gates, in parallel, block merge |
| 7.x | 7.x | BRD rationale, validate, full suite |
