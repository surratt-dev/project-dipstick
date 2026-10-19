# Design review: enforce-active-name-duplicate-rule (#299)

Reviewer: Marcus Oyelaran, Full Stack Engineer
Inputs: design.md, proposal.md, tasks.md, delta specs; checked against `packages/backend/src/routes/topics.ts`, `packages/backend/src/routes/error-envelope.ts`, `packages/shared/src/types/topic.ts`, `packages/frontend/src/pages/addCustomTopic.ts`, `TopicManagementPage.tsx`, `topicWriteRateLimit.ts`.

## Verdict

Implementable as written, with one blocking-ish contract defect (B1) and a handful of small corrections. The core choice (JS comparison inside the existing per-team advisory lock, one shared pure function, no DB constraint) is right and fits the codebase. Boundaries are clean. I would approve after B1 and S1-S3 are folded in.

## Verified claims (against real code)

- Single restore order is as design.md states. In the handler: rate limit, `checkWritableTeam`, `checkCustomizationLockGate` (~1609-1620), then `checkTopicExistsAndArchived` (404 then 422, plain `db.query`, ~661-697), then `BEGIN` + `lockTeamTopics` (~1634), MAX+1, `UPDATE ... AND status='archived'`, zero rows -> ROLLBACK, floor, 422 `TOPIC_ALREADY_ACTIVE` (~1655-1670). Confirmed. R5 (locked team never sees `TOPIC_NAME_ACTIVE`) holds structurally.
- Add order: 403, rate limit, `checkWritableTeam`, lock gate, 422 validation, then tx with `lockTeamTopics` before the MAX read (~1065). Confirmed. An empty name is a 422 before the lock, so "blank never reaches the name check" is true for Add.
- Bulk restore (`planDefaultRestore` caller, ~1786-1830) already does lock, then SELECT of active rows, then JS plan. The proposed Add/restore check is the same shape, so it is a pattern-match, not an invention.
- Remove takes `lockTeamTopics` (~1418) and Add, restore and bulk do too, so the D8 claim about serialization is accurate. Reorder (~2001) and room open take the same key (comment in `session-topic-snapshot.ts`).
- Frontend `findDuplicate` normalizer is a private copy of `trim().toLowerCase()` (addCustomTopic.ts); swapping to the shared one is a pure refactor.
- Names are effectively immutable for team topics: the only `SET name` is `default-topic-maintenance.ts:317`, which operates on the template team (`DEFAULT_TOPICS_TEAM_ID`), and `checkWritableTeam` rejects the template team on the user routes. D3's "read the target name in lock is stable" is sound. (Worth one sentence in D3 naming the template-only rename so a future team-rename endpoint knows it must take the lock.)

## Findings

### B1 (must fix). D4's response shape does not match the house envelope or the builder

`buildErrorEnvelope(category, message, code?, field?)` returns `{ error: { category, code, field?, message, correlationId } }`, and `ErrorEnvelope.error` is a closed type. D4's JSON example omits `category` and `correlationId`, and there is no way to carry `conflictingTopicId` / `conflictingName` through the current signature. Consequences:
- The spec's "exact `error` key set" test (tasks 4.2) will be wrong unless it includes `category` and `correlationId`.
- Implementation needs a signature change to a shared helper used by `facilitator-sessions.ts` and others. Cheapest safe option: add an optional fifth parameter `extra?: Record<string, string>` spread after the base keys (and make sure it cannot overwrite `code`/`message`), or build the envelope in a small local `buildNameActiveEnvelope` that spreads `buildErrorEnvelope(...)`'s result. Either is fine; say which in design.md.
- Pick the category explicitly: existing coded 409s (`TOPIC_LAST_ACTIVE`, `TOPIC_CUSTOMIZATION_LOCKED`) use `"precondition_failed"`. Use that, and fix the D4 example and the REST contract rows (task 7.1) to show it. The comment in `error-envelope.ts` says "No shared-package type: the frontend reads error.code ad hoc"; D4 and task 2.3 add a shared response type, which is a small convention break. Acceptable, but note it, and keep the type to just the new fields.

### S1. Race-branch ordering needs a restructure, not just an added check

The existing in-lock code does MAX read then `UPDATE ... WHERE status='archived'` and infers "already active" from zero rows. D3 wants "re-read target (status, name) in lock, then name check, then MAX/UPDATE". That means a new `SELECT id, name, status FROM topics WHERE id=$1 AND team_id=$2` after the lock, with the existing zero-row UPDATE branch kept as a belt-and-braces fallback (it cannot fire any more, but removing it changes tested behaviour). Tasks 3.2 should say: add the SELECT, keep the zero-row branch. Also decide the not-found-in-lock case (row deleted between pre-check and lock; topics are never hard-deleted today, so treat as the same 422 or 404 and note it). Error-path coverage gap otherwise.

### S2. Handled-exit shape in Add must not fall into the `catch`

In the Add handler a `return reply...` inside the `try` is fine (finally releases), but the structure today computes `topicId`, `createdAt`, `displayOrder` as outer `let`s assigned inside the try and responds after. An early 409 return must come before those assignments and do `ROLLBACK` itself exactly once (the catch also ROLLBACKs; a double ROLLBACK is harmless in pg but a thrown rollback after a handled one would mask). Mirror the restore race branch literally. Call this out in task 3.1 so it is not implemented as a throw-and-catch.

### S3. Frontend restore error path currently shows `body.error.message`

`submitRestore` sets `message: topicWriteErrorMessage(res, body, ...)`, i.e. server text, and uses a single-slot `restoreState` (`error` carries one `topicId`). The spec requires fixed client text, branching on `code`, persisting until the next attempt on that row, a successful archive anywhere in the team, or reload. Implications the design should state:
- Add a `code` branch in `submitRestore` before the generic fallback, producing client-owned copy (the server message is contract text, same stance as `SERVER_FIELD_MESSAGES` for 422).
- "Clears on a successful archive" requires `submitArchive` success to reset `restoreState` (it does not today). One line in task 5.4.
- Single slot means a second row's failure replaces the first row's message; fine, but say so (spec says "at the row", singular).
- Row message must stay visible while the confirm dialog is closed; check how `restore-error-${topicId}` (line ~2248) is rendered relative to the dialog state, since today the error state may be coupled to the dialog.

### S4. Frontend hint vs server verdict can disagree on blanks and prompt-only; keep one rule only for name

D7 keeps `findDuplicate` matching names OR prompts across active and archived. Active name match blocks; active prompt-only match warns. That is workable, but `findDuplicate` returns a single `DuplicateMatch` (archived wins). D7/task 5.1 requires "active name match governs over archived". This inverts the current precedence and changes the return type (task says it returns three distinct results). Specify the new signature now (suggest returning `{ activeName?, archived?, activePromptOnly? }`) so the form and tests are not designed twice. Use `findActiveNameConflict` for the active-name part so the client and server literally share one function (the parity claim only holds if the client calls it, not merely the normalizer).

### S5. `findActiveNameConflict` input shape and the restore case

For restore, the candidate is excluded from "active" naturally because it is archived, so no self-match issue. Good. For `planDefaultRestore`, the existing signature takes `activeNames: string[]`, not `{id,name,displayOrder}`. D1 says it "calls the same primitive"; the primitive is a one-conflict finder, while the plan needs a growing seen-set (restored names join it). Easiest honest refactor: share `normalizeTopicNameForMatch` plus a small `buildActiveNameIndex`, or accept that the plan keeps its Set and only the verdict is shared. Do not force `planDefaultRestore` through the finder (it would make it O(n*m) and need synthetic ids). Recommend: D1 says "same normalizer and same equality; `planDefaultRestore` unchanged apart from import", and parity is enforced by task 4.1's table. Lower risk, same guarantee.

### S6. Legacy empty-name edge

Restore treats `"" ` vs `"  "` as duplicates (both normalize to ""), Add cannot create them. Fine, but D4's `conflictingName: ""` means the client gets `"a topic with no name"` copy; ensure the type is `string` and the JSON never serializes `null` (pg returns the stored value; a NOT NULL column makes this safe; confirm the column is NOT NULL).

### N1. Rate limit and audit decisions are fine

Rejections spend budget like other 4xx (limiter runs before the check). No audit row; #271 inventory untouched since no new operation. Agree. One nit: the existing 409 for `TOPIC_LAST_ACTIVE` also logs nothing; consistent.

### N2. Timing floor

`applyTimingFloor` after ROLLBACK on the new branch matches restore's race branch. The test "asserts it is called" is the right level; the repo already mocks it elsewhere.

### N3. Concurrency tests

Task 4.4 relies on the existing real-DB harness (`topics-bulk-restore-races-integration.test.ts` exists and gates on the lock via `TEAM_TOPICS_LOCK_KEY_SQL`). Reuse it; Add/Add and Add/restore are cheap with that helper. I would promote one restore/restore case from OPT to MUST since single restore gets the most invasive handler change (S1).

### N4. Admin template routes and other INSERT sites

Verified the only `INSERT INTO topics` sites outside tests are `topics.ts` (Add), `default-topics.ts` (`copyCanonicalDefaults`, team creation and assign-defaults), and `default-topic-maintenance.ts` (template team, has its own `findNameConflict`). The D8 inventory matches. The one-time baseline-duplicate check (task 1.3) matters: `copyCanonicalDefaults` does a bulk INSERT with no name check, so the rule is not enforced there by design; a duplicate in the baseline would silently seed legacy duplicates. Make 1.3 a test, not only a PR note (a unit test over the canonical default set with `findActiveNameConflict`), so it stays true after #216 template maintenance edits (which has its own duplicate guard, so low risk).

### N5. Old-client compatibility statement

Migration plan says an old client "just sees a 409 with an existing envelope". True, but old `submitRestore` shows `body.error.message` verbatim, and the Add path falls to `refetchThenOfferRetry` on an unknown 409 (offers retry, which will 409 again). Harmless given ship-together; just do not claim it is graceful.

## Hidden coupling worth recording

- `error-envelope.ts` shared helper change (B1) touches every route importing it.
- `finishAfterTopicWrite` / `restoreState` single-slot state (S3).
- Public export surface: `packages/shared/src/index.ts` explicit named exports (lines ~61-63), so every new shared symbol needs adding there; build order shared -> backend/frontend.
- Spec statement "Unknown body fields (`force`) are ignored by existing body handling" holds only if `validateAddCustomTopicBody` does not reject unknown keys; I did not see strict-key rejection, but task 4.2's `force: true` test will prove it.

## Suggested edits to design.md

1. D4: show full envelope with `category: "precondition_failed"` and `correlationId`; state how extra fields are added (optional builder param).
2. D1: narrow the `planDefaultRestore` refactor (S5).
3. Add a "Restore handler change" paragraph: new in-lock SELECT, keep zero-row branch (S1).
4. D7: specify the new `findDuplicate` return shape and that it calls `findActiveNameConflict` (S4); add the `submitArchive` clear and code-branch notes (S3).
5. D3: note that the only name-mutating code is template-only; any future team rename must take `lockTeamTopics` and apply the rule.
