# Implementation review (Architect): 311-template-topic-id-matching

Reviewer: Ingrid Sollenberger. Scope: uncommitted diff on `agent-team/311-template-topic-id-matching` against design.md, the three delta specs and tasks.md. I read the code and did not run the integration suites.

## Verdict

No blocking code findings. One blocking spec-hygiene finding (B1): the sync stage will leave two main specs contradicting the new behaviour. It is cheap to fix before sync.

## Conformance to design

- **copyCanonicalDefaults** (`sessions/default-topics.ts`): still one `INSERT ... SELECT` with an explicit column list. `template_topic_id` is added to the column list and `id` to the SELECT list. There is no `ON CONFLICT` and no UPDATE pass. The `RETURNING id` contract is unchanged and annotation columns are still excluded. Matches Decision 6. It is the only production writer of the link (grep of `src` outside `__tests__` finds `template_topic_id` only here and in `content.ts` as a read).
- **Migration 24**: follows the 22/23 conventions. The `-- Up Migration` / `-- Down Migration` markers are exact. `SET LOCAL lock_timeout = '200ms'` comes first and `RESET` last. The sequence is `ADD COLUMN IF NOT EXISTS ... REFERENCES ... ON DELETE RESTRICT`, one idempotent backfill with a ranking comment, drop-if-exists then `ADD CONSTRAINT ... NOT VALID`, then `VALIDATE`. Literals are cast with `::uuid`. There is no `RAISE NOTICE`. The down section drops the CHECK, then the column. The header covers rationale, legacy rows, the no-deletes rule, the transaction model and rollback. The backfill is byte-equivalent to the runbook in `docs/deployment.md` and to the fixture. The backfill correctly applies the ranking (rn = 1) on both sides plus `NOT EXISTS`.
- **Read path** (`routes/content.ts`): the lateral join is now `team_id = $1 AND template_topic_id = dt.id` with the load-bearing `(status='active') DESC, id LIMIT 1`. `ORDER BY dt.display_order` and one-row-per-default are kept. The team row name is selected. The mapping covers all three cases: active is omitted, linked-archived uses the team id and name, unlinked uses the template id and name. Suppression is in application code using `normalizeTopicNameForMatch` from `@dipstick/shared`. It reads `activeResult.rows`. I confirmed that read is unfiltered (it selects every active row's `name`), so the task 4.2 precondition holds. Own-row exclusion is correct, though the `every(id === entry.topicId)` form is vacuous for archived entries (see N2).
- **Boundaries**: no frontend change, no shared-type change, no new response field. `planDefaultRestore` and restore paths are untouched, as the design says.
- **Test helpers**:
  - `restoreWholeTemplate` nulls links to the to-be-deleted template rows before the DELETE, scoped to the same `created_at >= startedAt AND NOT IN snapshot` predicate. This is order-independent and required by the RESTRICT FK. It matches E4.
  - `Fixture.topic` gains `templateTopicId` / `isDefault`, and `isDefault` defaults from the link so the CHECK is satisfied. This is backward compatible.
  - The scanner extension reuses the existing parsing and literal extraction (S4 asked for exactly that). It matches by regex on SQL text, with INSERT-column-list and UPDATE...SET forms. Two limits are noted under N3.
- **Sentinel drift test**: it asserts every uuid literal in migration 24 equals `DEFAULT_TOPICS_TEAM_ID` and that the live CHECK returns 23514. It is placed beside the migration-23 tests. Good (S5).
- **Docs and requirements edits**: consistent with Decisions 12 and 15 and with task 5.2. The runbook captures operator, time and count, the migration role, the keep-predicates rule and a second run of 0. The 8.1.1 (h) change is a single appended reopen trigger and does not alter the trust claim. `RENAME_NOTICE` equals the delta text. Its test pins the string and the forbidden phrases.

## Direct edit of `openspec/specs/topic-customization-lock/spec.md`

Acceptable in substance, but it is the wrong route if left as is. The edit is a one-sentence wording correction inside a non-normative "Implementation note". It changes no SHALL, scenario or requirement, and tasks 5.2 lists it explicitly. I would not block on it, because the old text ("the field's name-based join can mis-match") is now false and shipping it would be worse. Main specs normally change only through the sync stage, though, and this change ships no delta for `topic-customization-lock`. A direct edit sets two traps:
1. If some later sync or archive replays a delta that contains that note, it can overwrite or conflict with this edit.
2. The change's own audit trail (delta specs) no longer lists every main spec it touched.

Recommendation (non-blocking, N1): either add a MODIFIED delta for the one requirement that contains the note so the sync stage owns the edit, or record the direct edit in the tasks and sync notes with a statement that sync must not revert it. Do not edit further main specs by hand.

## Findings

### Blocking

**B1. Stale main-spec text that sync will not fix.** All three deltas use ADDED or MODIFIED on new requirement names, and nothing touches the following text, which will contradict shipped behaviour after sync:
- `openspec/specs/admin-default-topic-maintenance/spec.md` line 176: scenario "THEN the response includes a `notice` about name-based matching and the scope statement". This contradicts the new ADDED requirement, which forbids "name-based" in the notice. After sync the main spec would hold two incompatible rename-notice requirements.
- `openspec/specs/topic-management-screen/spec.md` line 1109: the rationale "Its name-based join produces wrong rows when a custom topic shares a default topic's name" is false after #311. The normative text (the screen SHALL NOT read the field) stays valid, so only the rationale needs updating.
Fix: add a MODIFIED delta to `admin-default-topic-maintenance` that rewrites the rename scenario (or the requirement that contains it) to reference `RENAME_NOTICE`, and a MODIFIED or wording delta to `topic-management-screen` for the rationale. Do this before the sync stage rather than patching main specs afterward.

### Non-blocking

- **N1.** The `topic-customization-lock` handling above. Pick one of the two routes and write it down.
- **N2.** In `content.ts` the filter `[...holders].every((id) => id === entry.topicId)` is dead logic for linked-archived entries (their own row is never active), and for unlinked entries `entry.topicId` is a template id that never matches a team row. The comment explains it. Simplifying to `!holders` is equivalent and clearer. The current form is harmless and defensive.
- **N3.** The scanner has two blind spots, both accepted-risk in nature. Dynamic SQL built by concatenation across several literals could evade it. An `INSERT INTO topics (...)` whose column list contains a nested parenthesis before `template_topic_id` would also evade the `[^)]*` pattern. Neither exists in `src` today. I suggest keeping the existing positive-control test (a known writer is found) so a regex regression fails loudly. I did not confirm that such a control exists in `template-link-writer-structural.test.ts`.
- **N4.** The deploy-window race is documented but still relies on a human. The docs cover this with the post-drain re-run and the count query. Reasonable for a prerequisite change.
- **N5.** Task 5.1 (Priya Nair's sign-off on `RENAME_NOTICE`) and 5.3 (PR note, unlinked count, escalation, #310 comment) are unchecked in tasks.md. They are process gates, not code defects, but they must be closed before merge. The unlinked-count number is not in the repo and I could not verify it.
- **N6.** Confirm that a grep for code setting `is_default = false` on a linked row (task 1.2) was recorded. My grep of non-test `src` found no such writer, so the risk is currently nil.

## Consistency with existing patterns

Migration conventions follow 22/23. Test helpers extend existing ones instead of adding parallel infrastructure. The sentinel and `canonicalDefaultsWhere` are reused, and shared normalization is imported instead of re-implemented. No new dependency or abstraction. The change is proportionate to a prerequisite fix, and the deferral of uniqueness to #310 is documented in design, tasks and the PR-note task.
