# Tasks Review: Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Artifact:** `openspec/changes/topic-annotation/tasks.md` (read with `proposal.md` and `design.md`)
**Focus:** Do the tasks follow the architectural dependency order? Does any task assume something that isn't built yet? Does any task perform an outward-facing GitHub action?
**Verdict:** **Approve with revisions.** The layering is sound: schema, then contract types, then write path, then reads, then session payloads, then UI, then docs. I found two real ordering defects (R1, R2), one build-breaking gap between tasks (R3), and a few tasks to split or tighten. Section 9 already frames GitHub work as prepared text, but it doesn't say where that text goes, and two of its tasks still depend on a human acting on GitHub first (G1–G3).

I checked these claims against the repo: the latest migration is `18_…`, `ArchivedByProvenance` exists (`topic.ts:24`), and `checkCustomizationLockGate` takes `attemptedOperation: string`, so it does not depend on 2.3 at the type level. The six existing `*-integration.test.ts` files exist, and the shared types are used by `content.ts`, `facilitator-sessions.ts`, `TopicManagementPage.tsx` and its two test files, plus `shared/src/__tests__/index.test.ts`.

---

## Ordering defects (must fix)

### R1. Task 1.2 writes into a file and harness that task 6.3 creates
Task 1.2 says to put the migration test in `topic-annotation-integration.test.ts`, "see 6.3". But 6.3 is where the file and its scaffolding get defined: the self-skip probe, the env fallbacks, the dynamic imports, no db mocking, and pickup by `integration.yml`. Task 7.2 depends on that same scaffolding. As written, the first task to touch the file comes five sections before the task that says how to build it.

**Fix:** add a new **task 1.2a, "Create the integration harness"**. It creates `topic-annotation-integration.test.ts` from `facilitator-error-states-integration.test.ts` with the probe, fallbacks and dynamic imports, contains one trivial test, and is confirmed to run in the integration workflow rather than self-skip. Then 1.2, 6.3 and 7.2 each add a `describe` block to it. 6.3 keeps its "do not drop / mocked doesn't count" wording but no longer owns the scaffolding.

### R2. Task 4.5 asserts TOPIC-002 behaviour that task 5.1 builds
Task 4.5 requires `<script>alert(1)</script>` to round-trip "by TOPIC-007 and TOPIC-002 byte-for-byte". TOPIC-002 returns a hard-coded `teamAnnotation: null` until 5.1, so 4.5 can't pass when it's scheduled.

**Fix:** split it. Keep the TOPIC-007 half in 4.5 and move the TOPIC-002 half into 5.3.

### R3. Task 2 makes the shared types stricter, but the code and fixtures that satisfy them come three to six sections later
Task 2.1 adds **required** fields to `GetAllTopicsResponse`: `teamAnnotation`, provenance and `canEditAnnotations`. Task 2.2 adds a required `topicAnnotation` to `BeginVotingResponse.currentTopic` / `TopicAdvanceResponse.currentTopic`. The producers that fill them come later: `content.ts` in 5.1 and `facilitator-sessions.ts` in 6.1. The typed fixtures that must include them come later still: `content.test.ts` in 5.3, and `TopicManagementPage.test.tsx` / `.reorder.test.tsx` in **8.7, the last frontend task**. So from 2.1 until 5.1, 6.1 and 8.7 are all done, `tsc` fails for the backend and the frontend typecheck (`tsconfig.typecheck.json`) fails. No checkpoint in between is green, and any task that "runs the suite" in the meantime can't pass.

**Fix (choose one):**
- (a) Have each type change land in the same task as its producer and its fixtures. The `GetAllTopicsResponse` fields move into 5.1, along with the fixture updates for `content.test.ts` and both `TopicManagementPage*.test.tsx` files. The session `currentTopic` fields move into 6.1. 2.1 keeps only the new TOPIC-007 request/response types and the `Topic` domain fields.
- (b) Keep task 2 as written, but add **task 2.4**: update every typed fixture and add placeholder values at both producers (`teamAnnotation: null`, `canEditAnnotations: false`, `topicAnnotation: null`), so `npm run typecheck` and `npm test` pass at the end of task 2. Then 5.1 and 6.1 replace the placeholders.

I prefer (a): a type and its first producer form one boundary and should change together. Whichever you choose, **8.7 should not carry the fixture updates**. They are a precondition of section 8, not a test of it.

---

## Tasks to split or reorder (should fix)

### S1. Extract `fetchAllTopics()` as its own refactor task before the editor work
Task 8.4 hides a refactor of existing code (`reloadAfterStale`, `TopicManagementPage.tsx:483`) inside a feature task. Make it **task 8.0**: extract `fetchAllTopics()` returning the parsed response or `null`, change no behaviour, and keep the existing reorder and stale-reload tests passing untouched. Then 8.4 uses it. A refactor that is mixed into a feature is a regression that nobody reviews.

### S2. Task 8.2 needs the row data from 8.1, and 8.5/8.6 need 8.2's derived state
That order already holds. But 8.7 puts every component test at the very end, so nothing is tested until the whole section is done. Split 8.7 so each implementation task (8.1–8.6) carries its own scenarios. The cross-cutting ones (reorder-draft interlock, orphaned editor, `beforeunload`) belong with 8.6. Doing that also brings section 8 in line with sections 3–6, where tests follow their implementation.

### S3. Task 5.4's template-team assertion is a database property, so it needs real Postgres
"Annotating a team's default topic leaves the template-team row's `team_annotation` NULL" can only be proven against a real database, for the same reason design Decision 8 gives for 6.3: the route suites `vi.mock` the db module. As a mocked test it would pass whatever the SQL does. Move that sentence into the integration file (after R1's harness), next to 7.2. The archive/restore and custom-topic parts of 5.4 can stay mocked.

### S4. Task 6.4 (the mocked SQL-text guard) should come before 6.3
It is cheap, runs on every local `npm test`, and catches the exact regression 6.3 targets. Running it first gives fast feedback and doesn't depend on the integration harness. Swap them, or fold 6.4 into 6.1 as its acceptance check.

### S5. Run `openspec validate --strict` (11.5) at the start too
Task 11.5 is the only check that the delta specs are well formed, and it runs last. If the specs that tasks 3–8 are tested against turn out to be invalid at the end, the cost is high. Add **task 0.1**: run `openspec validate topic-annotation --strict` before section 1. Keep 11.5 as the final re-check.

### S6. Task 9.1's spec edit is already done, so it shouldn't be scheduled after the code
`specs/session-topic-lifecycle/spec.md` already contains the pending snapshot-content requirement (lines 25–33). As written, 9.1 schedules authoring it after the code it constrains. Reword the first half of 9.1 to "Verify the pending requirement is present and covered by 11.5". That leaves 9.1 as purely the #175 note draft.

### S7. Minor: the comment in 3.2 cites FR-8.7, which 10.4 adds later
Both land in the same PR, so this is acceptable. Add a note to 3.2 saying that FR-8.7 is added in 10.4, so a reviewer doesn't flag a dangling reference mid-branch.

### Dependencies that already hold
- 3.1 (messages parameter) comes before 3.2 (its first caller with new messages). Good.
- 3.2 → 3.3 → 3.4/3.5. These build one handler. The 3.x tests cover only rejection paths, so they don't need 4.1's transaction. Good. 3.2 should state that until 4.1 lands, a request that passes every check returns a temporary `501`/`500`, so nobody mistakes a half-built handler for a working one.
- 4.x comes before 5.4 (annotate, then archive/restore). Good.
- 6.1 depends only on migration 1.1 and type 2.2. Good, and it deliberately has no dependency on #175, because fixtures stand in for the snapshot writer. That is the right boundary.
- 10.x (docs) and 11.x (verification) come last. Good.

---

## Outward-facing actions (must reframe)

Section 9's heading says "prepared here, posted by the team lead; agents do not post to GitHub", which is correct. No task tells an agent to run `gh issue comment`, `gh issue create` or `gh issue edit`. The remaining gaps:

### G1. Section 9 doesn't say where the drafts go
"Prepare a note" with no output path is easy for an implementing agent to read as "post it". **Fix:** each 9.x task names a file, for example:
- `openspec/changes/topic-annotation/handoffs/175-snapshot-note.md` (9.1)
- `handoffs/56-57-62-session-display-acs.md` (9.2; one file, one section per issue)
- `handoffs/53-corrected-body.md` and `handoffs/53-status-note.md` (9.3)
- `handoffs/new-issue-template-team-write-guard.md` (9.4)
- `handoffs/new-issue-topic-001-em-and-casing.md` (9.5)
- `handoffs/note-data-retention.md` and `handoffs/note-csp-priority.md` (9.6)

Add one sentence to the section 9 header: *"Each task writes a Markdown file under `handoffs/`. No task runs `gh` write commands (`issue comment|create|edit|close`, `pr comment`). Read-only `gh issue view/list` is permitted."*

### G2. Task 9.4's "reference it in the Known Limitations once filed" depends on a human acting on GitHub
An agent can't complete a step that waits for an issue to be filed. **Fix:** the agent writes the Known Limitations reference with a placeholder (`#TBD: template-team write guard, see handoffs/new-issue-template-team-write-guard.md`). The step "replace the placeholder with the issue number" goes on the human's list next to C1–C3.

### G3. Task 9.6 asks for "a note on the existing issue (or a new draft if none exists)"
Finding out whether the issue exists means reading GitHub. Say explicitly that this is a read (`gh issue list --search`), and that the output is a file whose header names the target issue (or "NEW"). The agent does not choose between commenting and filing on GitHub.

### G4 (not GitHub, same principle). Task 8.8 says "walkthrough with Priya Nair on the branch"
Priya is a team persona, so this is a persona review, not a live session with a user. Reword it as "a Facilitator-persona usability review of the editor on the branch, written to `usability-review-facilitator.md`". That way nobody reads it as scheduling a person, and its output is a file like every other review. It stays non-gating, as the task already says.

---

## Architectural observations (no task change required)

- **The boundary with #175 is drawn correctly.** This change reads `session_topics.topic_annotation` and never writes it, and the spec pins the write-side rule for #175. Task 11.4 checks that no `session_topics` writes are touched. That is the explicit, documented interface between two units of work I want to see.
- **Authorization is enforced on the server, and the UI only reflects it.** `canEditAnnotations` is presentation-only, and TOPIC-007 independently returns `403` for admins (3.4). The tests cover both sides of the rule, so this is not authorization that lives only in the frontend.
- **Migration safety.** The schema change is additive and nullable, and the design states deploy-before-code. Tasks 1.1/1.2 cover up, down and up again. Good.

## Summary of requested changes

| # | Change | Severity |
|---|---|---|
| R1 | New 1.2a creates the integration harness; 1.2/6.3/7.2 add to it | Must |
| R2 | Split 4.5; the TOPIC-002 half moves to 5.3 | Must |
| R3 | Type changes land with their producers and fixtures (or a 2.4 placeholder step); take fixture updates out of 8.7 | Must |
| S1 | 8.0: extract `fetchAllTopics()` as a no-behaviour-change refactor | Should |
| S2 | Spread 8.7's tests across 8.1–8.6 | Should |
| S3 | 5.4's template-team assertion moves to the integration file | Should |
| S4 | 6.4 before 6.3 | Should |
| S5 | Add 0.1: `openspec validate --strict` up front | Should |
| S6 | 9.1: verify the existing spec requirement rather than author it | Should |
| S7 | Note in 3.2 that FR-8.7 is added in 10.4 | Nit |
| G1 | Section 9 drafts go to named files under `handoffs/`; no `gh` writes | Must |
| G2 | 9.4 uses a placeholder; the human fills in the issue number | Must |
| G3 | 9.6: read-only lookup, draft file names its target | Should |
| G4 | 8.8 becomes a persona review written to a file | Should |
