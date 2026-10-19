# Design: 311-template-topic-id-matching

## Context

Today a team's copy of a default is recognized only by name. `copyCanonicalDefaults` (`packages/backend/src/sessions/default-topics.ts`) copies the template's active defaults with one `INSERT ... SELECT` and an explicit column list, leaving no trace of origin. `defaultTopicsNotActive` (`routes/content.ts`) does a `LEFT JOIN LATERAL` on `name = dt.name`, so it matches any team topic of that name, including a custom one (#197), and stops matching after a #216 rename. Bulk and single restore reactivate the team's own `is_default` row and never read the template, so they are not broken by rename and are not rewritten here. The Topic Management screen does not read `defaultTopicsNotActive`. Constraints: the template team id is defined once (`DEFAULT_TOPICS_TEAM_ID`); migrations run with `--no-single-transaction`, but a `.sql` file is still sent as one multi-statement query and so runs as one implicit transaction (migration 23 relies on this: `SET LOCAL lock_timeout`); migration 23 is the latest.

## Goals / Non-Goals

**Goals:** a durable identity link from a team default to its template default; use it for `defaultTopicsNotActive`; make #310 possible; keep rename invisible to existing teams; truthful copy.

**Architect decision (post design review):** take the proposal's documented fallback. No unique `(team_id, template_topic_id)` index and no `ON CONFLICT` reactivation. `assign-defaults` inserts fresh linked rows exactly as it inserts rows today. A uniqueness guarantee for the link is deferred to #310, which is the first consumer that needs one. This is the proportionate shape for a prerequisite fix and removes the reactivation-of-team-text, audit-ambiguity and #299-bypass problems at their source (Security S1 to S3, Engineer E3). The FK (RESTRICT) and the CHECK stay.

**Non-Goals:** see the proposal's Scope Exclusions and Non-goals. In particular no new response field and no change to `planDefaultRestore`.

## Decisions

1. **Column and FK.** `topics.template_topic_id uuid NULL REFERENCES topics(id) ON DELETE RESTRICT`. RESTRICT: a loud block beats silent loss of identity. Rule recorded in the migration header and the spec: template defaults are archived, never deleted. Admin maintenance already archives; migrations 4 and 11 deleted and reinserted, which is why legacy rows exist. Confirmed. The FK target is not constrained to template rows by the database (a CHECK cannot subquery); that is enforced by a structural test (Decision 5), not by a trigger.

2. **Backfill rule (one statement, idempotent).** Raw `=` on `name`. Candidates: `is_default = true` rows of non-template teams with `template_topic_id IS NULL`. Per (team, name): rank candidates by `(status='active') DESC, id`; rank template default rows of that name (active and archived) by the same key; link the top candidate to the top template row, but only `WHERE NOT EXISTS` a row of the same team already linked to that template row. Everything else stays NULL. `id` is a random uuid, so "lowest id" is arbitrary but deterministic; it is never described as "oldest".
   **Backfill rule, not a database guarantee:** with the index gone, "each team row links to at most one template row, and a team has at most one backfilled row per template row" is a property of this statement alone. In-statement it rests on the one-winner-per-(team, name) ranking, not on the `NOT EXISTS` (which sees the pre-statement snapshot); a comment in the SQL says so, so a later editor does not remove the ranking. It is pinned by a migration test (the four-row case and the linked-plus-sibling case). The runtime copy can later give a team an archived and an active row for one template default (Decision 6); the backfill's `NOT EXISTS` treats such a team as already linked and never adds a third.

3. **Reporting: no `RAISE NOTICE`.** node-pg-migrate need not surface server notices, and no existing migration uses one, so nothing depends on a log line. The unlinked count (unlinked `is_default` team rows) comes from the read-only runbook query, which returns a count and, separately, the row-level listing (team id, row id, name). The pre-merge dry run (task 1.1) and the post-drain check use the count query. The migration itself emits nothing containing an identifier. No near-miss counting.

4. **No unique index (fallback taken).** Reasons: the Executive's proportionality concern; the index forced the `ON CONFLICT` reactivation, which brought back team-authored text on a locked team via the lock carve-out (S1), an audit row that could not tell inserted from reactivated (S2), a path around the #299 active-name rule (S3), and stale `restored_by`/`updated_at` (E3). Deferred to #310. No plain index on `template_topic_id` either (E7): the lateral join is selective through the existing `team_id` access path on a small table, and the RESTRICT check on a template delete is rare; add one only if `EXPLAIN` on seeded data shows a need.

5. **Invariant by CHECK (kept), and who may write the link.** `CONSTRAINT topics_template_link_valid CHECK (template_topic_id IS NULL OR (is_default AND team_id <> '00000000-0000-0000-0000-000000000001'::uuid)) NOT VALID`, then `ALTER TABLE topics VALIDATE CONSTRAINT ...`, as migration 23 does (literal cast `::uuid`). Postgres has no `ADD CONSTRAINT IF NOT EXISTS`; drop-if-exists then add keeps a manual replay safe. Kept because it validates the backfill (fail-loud: the CHECK is added after the backfill, so a violation rolls the whole file back) and constrains the operator re-run (S7), which runs with the CHECK in place: neither can link a custom or template row even if its predicates are mistyped.
   - **Sentinel drift test is mandatory (S5).** A wrong literal silently disables the invariant. The test asserts `DEFAULT_TOPICS_TEAM_ID` equals the literal in migration 24 (and that the CHECK rejects a link on a template-team row). It lives beside the existing migration-23 coverage in `template-team-migration-integration.test.ts` (Engineer: no such constant assertion was found by grep, so this adds it).
   - **No code sets `is_default = false` on a linked row** (that would become a 23514 and a 500): task 1.2 greps for it and records the result.
   - **Link-target integrity (S4): structural test.** A test asserts that the only SQL in `packages/backend/src` that writes `template_topic_id` is `copyCanonicalDefaults` (the `INSERT ... SELECT`); the migration is outside `src`. It extends the scanner infrastructure of `template-writer-structural.test.ts` rather than adding a new scanner, and matches by regex on the SQL text, not substring counts. Any other writer fails the test.

6. **Copy stays atomic and plain.** Add `template_topic_id` to the INSERT column list and `id` to the SELECT list of the single `INSERT ... SELECT`. No `ON CONFLICT`, no UPDATE pass. `assign-defaults` (gated on zero ACTIVE topics, under the per-team advisory lock) inserts fresh linked rows as it inserts rows today; any archived rows the team holds stay archived with their own text. So a team may hold an archived and an active row linked to one template default, and `topicCount` / audit `topic_count` remain the number of rows inserted. Two inherited safeties are unchanged and need no new test beyond the all-archived case in task 3.3: the other unique index (`topics_team_active_order`, migration 18) is satisfied because the gate guarantees no active rows before the insert, and a same-name active collision is impossible for the same reason. A structural assertion (regex on the function's SQL) extends the E8 test: exactly one `INSERT INTO topics` containing `template_topic_id`, no UPDATE, no `ON CONFLICT`.

7. **`defaultTopicsNotActive` query.** Keep one row per template default, keep `ORDER BY dt.display_order`. Replace the lateral name join with `WHERE team_id = $1 AND template_topic_id = dt.id`, ordered `(status = 'active') DESC, id`, `LIMIT 1`. This ordering is now load-bearing, not defence, because a team can hold several linked rows for one default: an active linked row always wins and the default is not listed. Select the team row's `name`. Mapping:
   - best linked row active: omitted.
   - best linked row archived: `{ topicId: team row id, name: team row name, isArchived: true }` unless suppressed.
   - no linked row: `{ topicId: template id, name: template name, isArchived: false }` as today, unless suppressed.
   Using the team's name for a linked row is a value change, not a shape change. When several archived linked rows exist, the lowest id is offered; #310 owns anything smarter. The mocked row shape in `content.test.ts` (fixed `db.query` sequence) gains the team-name column.

8. **Suppression by active name.** An entry is dropped when an ACTIVE team topic (custom or default, other than the entry's own linked row) has a name equal to the name the entry would restore under (team row name for linked, template name for unlinked), compared with `normalizeTopicNameForMatch` imported from `@dipstick/shared` (the backend already depends on it through `planDefaultRestore`), because that is the comparison #299 applies on restore. Done in application code, not SQL `lower()`. Precondition checked in task 4.2: the active-rows read selects `name` for every active row, unfiltered and unlimited, or suppression silently weakens. An archived custom topic, or an active custom topic with a different name, hides nothing. Small and the first thing to cut. If an offer surfaces anyway, restore answers the existing `409 TOPIC_NAME_ACTIVE`.

9. **No UI change.** The screen does not read the field. No frontend edit.

10. **Archived template defaults** drop out of the list, as today (`canonicalDefaultsWhere` requires `status = 'active'`).

11. **Migration shape and transaction model (E1).** `24_template_topic_id.sql`; markers `-- Up Migration` / `-- Down Migration` exactly. The file runs as one implicit transaction: a mid-file failure rolls everything back and leaves nothing half-applied. The header says so, and states the locking like migration 23: `SET LOCAL lock_timeout = '200ms'` first, `RESET lock_timeout` last (below the pool statement timeout; same rationale as 22/23). Plain statements only (nothing needing `CONCURRENTLY`). Up order: `ADD COLUMN IF NOT EXISTS` with the FK; the backfill; drop-if-exists then `ADD CONSTRAINT ... NOT VALID`; `VALIDATE CONSTRAINT`. `IF NOT EXISTS` and drop-if-exists are kept only because they are cheap and make a manual replay safe; they are not a partial-failure strategy. Header: rationale, legacy rows, migration-11 lesson, no-deletes rule, "Rollback:" one sentence. Down: drop the CHECK, then the column (explicit, in that order); no user data lost (the link is recomputable). Test: run the real file with a deliberately failing final statement and assert the column is absent.

12. **Rolling deploy and the out-of-band re-run (S7).** An old instance may create a team during the window, leaving NULL links. `docs/deployment.md` says to re-run the backfill statement after old instances drain; a first re-run may link some rows, a second must update 0. The runbook requires: run under the migration DB role (not an app role); keep the `is_default` and non-template predicates in the statement; record in the deployment ticket who ran it, when, and the updated-row count. It is a manual write with no `audit_log` row; this is stated, not hidden.

13. **Copy text.** `RENAME_NOTICE` is the exact constant in the `admin-default-topic-maintenance` delta. Admin maintenance response only; grep first (task 5.1).

14. **Unlinked entries and restore.** TOPIC-005 looks up `WHERE id = $1 AND team_id = $2`; an unlinked entry's template id answers the existing 404 and writes nothing. Owned by #310.

15. **Threat model (High-Level Architecture 8.1.1): trust claim not affected.** Security S1 was a consequence of reactivation. With the fallback, `assign-defaults` still inserts only canonical template text into a locked team; it never revives team-authored text, so the 8.1.1 argument ("only canonical text enters") remains literally true, the residual-risk rating is unchanged, and no change to (a) to (e) or to 8.2 is needed. One optional, non-claim edit is kept as a docs task so the boundary outlives this change: add to 8.1.1 (h) the reopen trigger "any use of `template_topic_id` to propagate template content into existing team rows". The audit row (`topic.defaults_assigned`, `topic_count`) is unchanged and still unambiguous (all rows are inserts); no `reactivated_count`.

## Risks / Trade-offs

- Backfill mislinks silently -> `is_default` only, raw equality, one deterministic choice, CHECK, seeded-data tests; wrong attribution affects offers only, not authorization (accepted, S8).
- No uniqueness guarantee: a team may hold archived plus active rows for one default -> the read ordering makes the active row win; the cost is a possibly confusing archived duplicate, nothing worse; #310 decides whether it needs the index.
- Legacy unlinked rows produce an offer for a topic held under an old name -> count, runbook query, #299 rejection; accepted, tested.
- Someone adds a second statement or a conflict clause to the copy -> structural assertion on the SQL (tasks 3.2).
- RESTRICT blocks a test helper that deletes template rows -> `maintenance-test-hygiene.ts#restoreWholeTemplate` is the real exposure (task 2.2, E4).
- A future writer links to a non-template row -> structural test (S4).
- Someone reads the link as "template edits propagate" -> Scope Exclusions, the spec, and the optional 8.1.1 (h) trigger.
- Large unlinked count -> reported pre-merge as a count only, product-owner decision.
- Normalized suppression differs from raw backfill matching -> deliberate.

## Migration Plan

Deploy migration 24 with the backend (additive, nullable, old build runs on the migrated schema). Re-run the backfill after old instances drain under the runbook rules in Decision 12 and confirm a second run updates 0 rows. Rollback: redeploy the previous build; optionally run down 24. Frontend unaffected.

## Open Questions

None. Facilitator (Priya Nair) checks final `RENAME_NOTICE` wording. Uniqueness of the link is deferred to #310.

## Review disposition (Architect: Ingrid Sollenberger)

Overridden: none. The recommended fallback was taken as-is; the reasons are in Decision 4.

Engineer (Marcus Oyelaran):
- E1 accepted: implicit-transaction model, `SET LOCAL lock_timeout`/`RESET`, partial-failure test replaced by a "failing last statement leaves nothing applied" test (Decision 11, task 2.4).
- E2 accepted: CHECK kept, `NOT VALID` then `VALIDATE`, `::uuid` cast, constant-vs-literal test made a task in `template-team-migration-integration.test.ts` (Decision 5).
- E3 moot: no `DO UPDATE`, so no stale `restored_by` / `updated_at`.
- E4 accepted: `restoreWholeTemplate` fix (null linked rows first, order-independent) is task 2.2; `template-snapshot.ts` recorded as safe.
- E5 accepted: no `RAISE NOTICE`, count via runbook query, tie-break wording, ranking-vs-`NOT EXISTS` comment, fail-loud note (Decisions 2, 3).
- E6 accepted: mock row shape, shared import, active read checked (Decisions 7, 8; tasks 1.3, 4.1).
- E7 accepted: no plain index absent an `EXPLAIN` need (Decision 4). E8 accepted: Down order CHECK then column; regex-based structural test.

Security (Tomas Ferreira):
- S1 not affected after the fallback; stated in Decision 15. Optional reopen trigger added as a docs task.
- S2 and S3 moot (no reactivation). The accepted two-active-same-name edge no longer exists.
- S4 accepted: structural test, only `copyCanonicalDefaults` and the migration write the link (Decision 5, task 3.2).
- S5 accepted: drift test mandatory. S6 accepted: PR note carries counts only (task 2.6). S7 accepted: Decision 12 and the runbook. S8 accepted, no action.
- Read-path two-team test added to task 4.2.
