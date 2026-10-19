# Proposal: 311-template-topic-id-matching (#311)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (revision 2) with `explore-review-ba.md` and `explore-review-facilitator.md`. Prerequisite of #310. Traceability: GitHub issue #311; BRD 6.4 (copy-on-create), FR-8.1, FR-8.6 [HARD]; REST API Contract TOPIC-002 (default set, rename semantics), TOPIC-005 (restore); use case 08 (Recover Zero-Topic Team, Maintain Default Topic Set); openspec specs `default-topic-provisioning`, `admin-default-topic-maintenance`, `database-migrations`, `topic-customization-lock`, `bulk-restore-default-topics`. The openspec CLI is not installed in this environment; artifacts were written by hand in the shape of `openspec/changes/archive/2026-10-18-enforce-active-name-duplicate-rule/`.*

## Why

The promise I care about is one sentence from the requirements: the default topic set is visible and easy to restore, so teams can experiment without losing the baseline. #216 let an administrator rename a template default. The moment that happens, the only thing that says "this team topic is that default" (a name match) stops working, and it fails quietly. The team appears to be missing a baseline topic it still holds, or the reverse. Quiet failure in the baseline path erodes trust in "I can experiment safely", and #310 (canonical wording on restore) is about to build on that same join.

So give identity a real home: each team default remembers which template default it was copied from. Do it before #310, and without giving anyone a way to loosen the first-session lock or the template-write guard as a side effect.

I do not care about the column. I care that a rename never changes the name, status, order or restore offer of any topic a team holds, and that "which default is this?" has one answer that does not depend on spelling. (Offers for defaults a team never held do change; the notice says so.) The concrete symptom today: after an administrator renames a default, `defaultTopicsNotActive` for an existing team lists a default the team still holds, or hides one it lacks. There is no UI consumer yet, so the person hurt is the administrator reading the API and, next, the facilitator in #310. I have not seen a production team hit this; it is a prerequisite fix, deliberately small. Whether to narrow Issue #311 acceptance #3 to "any linked default" is a decision for the product owner (Brian), not a housekeeping edit.

## What Changes

- **Schema (migration 24):** nullable `topics.template_topic_id`, foreign key to `topics(id)`, `ON DELETE RESTRICT`. Template defaults are archived, never deleted (migration-11 lesson goes in the header).
- **One idempotent backfill statement**, one rule: for each team and template-default name, take the team's `is_default` rows with raw name equal to that name and no link, rank them (active first, then lowest id; arbitrary but deterministic), and link the top one to the top-ranked template row of that name (active first, then lowest id), unless the team already has a row linked to that template row. All others stay NULL. No fuzzy matching. As a backfill rule (not a database guarantee) a team row links to at most one template row and a team gets at most one backfilled row per template row. The migration emits nothing with identifiers and no `RAISE NOTICE`; the unlinked count comes from the runbook count query.
- **Invariant CHECK** (link only on `is_default` rows outside the template team), added `NOT VALID` then `VALIDATE`, sentinel cast `::uuid`, with a mandatory sentinel drift test. **No unique index and no `ON CONFLICT`** (Architect decision, the fallback below taken; uniqueness is deferred to #310).
- **`copyCanonicalDefaults`** stays one `INSERT ... SELECT`, now setting `template_topic_id` from the source row id. No `ON CONFLICT`, no UPDATE. `assign-defaults` is gated on zero ACTIVE topics (`routes/topics.ts`); it inserts fresh linked rows as it inserts rows today, and a team's archived rows stay archived with their own text. A team may therefore hold an archived and an active row linked to one template default; `defaultTopicsNotActive` prefers the active one. `topicCount` and the audit `topic_count` are the rows inserted, as today. Team creation never conflicts.
- **`defaultTopicsNotActive`** (TOPIC-002) joins on `template_topic_id = dt.id` instead of name (best linked row: active first, then lowest id). Rules: custom topics never match (fixes #197); linked entries carry the team row's id and name, unlinked ones the template id and name as today; an entry is dropped if an active team row other than its own linked row has an equal `normalizeTopicNameForMatch` name (restoring it would be rejected by #299; without this rule removing the name match would newly surface such offers); archived template defaults are not listed. Shape unchanged.
- **Unlinked entries and restore:** unchanged. TOPIC-005 addresses a team's own row (`WHERE id = $1 AND team_id = $2`), so a template id from an unlinked entry answers the existing team-scoped 404 and creates nothing. No row is created, so there is nothing to link. #310 owns making those entries actionable.
- **`RENAME_NOTICE`** replaced by the exact text in the `admin-default-topic-maintenance` delta (below).
- **Docs (wording corrections only):** `docs/deployment.md` (a count query plus a row-level unlinked-defaults listing; "re-run the backfill after old instances drain" under the migration DB role with operator, time and updated-row count recorded in the deployment ticket, and the check that a second run updates 0 rows; one-sentence rollback), REST API Contract (TOPIC-002 and maintenance sections), use case 08, BRD traceability. Plus `requirements/entities-and-relationships.md` if the Topic entity is documented there (a one-line "copied from" relationship; if omitted, say it is internal).

### Fallback taken (Architect decision)

The Architect took the fallback: no unique index, no `ON CONFLICT`. `copyCanonicalDefaults` has no conflict clause, `assign-defaults` inserts fresh linked rows, a team may hold an archived and an active row for one template default, and `defaultTopicsNotActive` keeps `ORDER BY (status='active') DESC, id LIMIT 1` per default. The FK (RESTRICT) and the CHECK stay. A uniqueness guarantee is deferred to #310. See design.md Decision 4 and the review disposition.

## Scope Exclusions (verbatim from exploration)

This change must NOT touch:
- First-session customization lock and the zero-topic assign exception. The column is not a way to customize or bypass the lock.
- Copy-on-create: existing teams are never auto-updated (BRD 6.4). The link is a reference for identity and for #310's explicit restore reads only; it is not license to propagate template edits.
- Session snapshot (`session_topics`): sessions keep what they snapshotted.
- Template write path: no new writer; #188 guard and the template-writer-structural allowlist unchanged.
- `planDefaultRestore` and its same-name-active rule (#299).
- Any API response shape: no new field (explicit non-goal so nobody adds `templateTopicId` for convenience).
- Session-time screens: lobby, voting, reveal, facilitator control surface. This change must be invisible during a session. Visible surfaces are only Topic Management (restore offers), the admin rename notice, and admin maintenance/runbook.
- Manager participation, facilitator-from-another-team, trends: if a diff touches them, stop.
- Archived team rows are never deleted or relabeled by the migration or the FK (topic history preserved).

### Correction to the exploration: Topic Management needs no change

The exploration listed Topic Management as a place where "restore offers" are visible, pending a check of the UI. The check is done: the Topic Management screen does NOT read `defaultTopicsNotActive` (spec `topic-management-screen`, "The screen does not read `defaultTopicsNotActive`"; `TopicManagementPage.tsx` carries a comment saying so). Its restore path is the team's own archive and the bulk "Restore default topics" action, both of which reactivate the team's own `is_default` row and never read the template. Under the hide approach the screen needs no change. `defaultTopicsNotActive` has no UI consumer today; it is an API field. Effective visible surfaces are therefore only the admin rename notice and the admin runbook. The existing requirement that the screen must not read the field is kept as is; #310 may revisit it.

### Non-goals

- No new API field (no `templateTopicId` in any response).
- No fuzzy or normalized backfill matching.
- No change to bulk or single restore behavior, `planDefaultRestore`, or #299.
- No UI to list or repair unlinked rows (the runbook query is the admin-visible place).
- No "add" vs "restore" label for never-seeded defaults; no reason shown instead of hiding an offer; no admin-visible "held by N teams" count on rename. Follow-ups, not here.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `default-topic-provisioning`: ADDED requirements for the link (copy sets it atomically, invariant, RESTRICT, custom topics never linked, only the copy writes it), assign-defaults over archived linked rows (fresh inserts), and `defaultTopicsNotActive` matching by link; MODIFIED "The copy and the restore list share one definition of the canonical default set" (set difference now by link, then by name suppression).
- `admin-default-topic-maintenance`: ADDED the truthful rename-notice requirement (the existing notice scenario stays; its text content is replaced).
- `database-migrations`: ADDED the migration-24 requirement (one implicit transaction with lock_timeout, backfill rule, idempotence, no identifiers in output, reversibility, sentinel drift test, operator re-run).

## Impact

- Code: new `packages/backend/migrations/24_*.sql`; `packages/backend/src/sessions/default-topics.ts` (one SQL edit); `maintenance-test-hygiene.ts` (test helper); `packages/backend/src/routes/content.ts` (`defaultTopicsNotActive` query and mapping); `packages/backend/src/sessions/default-topic-maintenance.ts` (`RENAME_NOTICE`).
- Callers of the copy: `facilitator-sessions.ts` (team creation) and `routes/topics.ts` (`assign-defaults`): no edit, but each needs its own test (assign-defaults including the all-archived case).
- Tests: extend the E8 single-statement test; new migration and backfill tests on seeded data; update tests that pin `RENAME_NOTICE` and the mocked row shape in `content.test.ts`; extend `default-topics-not-active-integration`, `team-creation-canonical-copy-integration`, `assign-defaults-integration`. No existing test is deleted or weakened. `template-snapshot.ts` is safe; `maintenance-test-hygiene.ts#restoreWholeTemplate` must null linked rows before deleting template rows it created, or the suite goes red under RESTRICT. New structural test: only `copyCanonicalDefaults` writes `template_topic_id`.
- API: no shape change. `defaultTopicsNotActive` values change in three ways: custom topics stop matching; linked entries carry the team's own row id and name; same-name active topics suppress an entry.
- Docs: wording corrections in `docs/deployment.md`, REST API Contract (TOPIC-002 around l.683-707; maintenance l.1196, l.1226), use case 08 (l.233), BRD traceability (l.329), and the entities document if applicable.
- Requirements status: BRD 6.4 text unchanged (the link is identity only). FR-8.6 remains partially met: this change removes the rename-induced false "missing" and "held" results and does not close the visibility gap for unlinked legacy rows; a matching traceability note is added under FR-8.6.
- Issue #311 acceptance #3 narrowing to "any **linked** default": product-owner decision, recorded in the Review disposition.

## Constraints preserved

- Link means identity, not propagation. Existing teams are never auto-updated; template edits still reach only teams created later.
- The first-session lock, the template write guard (#188), the template-writer-structural allowlist, and #299 are untouched; no flag or setting toggles any of them.
- Copy stays one `INSERT ... SELECT` so a team created during an admin edit sees a complete before-set or after-set (#216 E8).
- Nothing changes in a live session, a snapshot, trends, manager participation or facilitator-from-another-team.
- Archived team rows are never deleted or relabeled; topic history is preserved.

## Residual risks and hand-offs

- Legacy rows that cannot be linked (template reseeded by migrations 4 and 11, or renamed before migration) stay unlinked; every active default they lack may be listed, and restore is by the team's own row so nothing breaks. Gate: the per-environment unlinked count is reported in the PR before merge (task 1.1), as a count only; row-level output stays with the operator. If the count is large (more than a handful of teams' worth), the product owner decides before the release announcement.
- No uniqueness guarantee on the link (fallback taken): a team may hold an archived and an active linked row for one default; reads prefer the active one. Deferred to #310. The earlier reactivation edge (two active same-name topics) no longer exists.
- Migration lock/duration: one implicit transaction with `SET LOCAL lock_timeout = '200ms'`; the CHECK `VALIDATE` scans `topics`; measure in staging before release.
- Threat model: High-Level Architecture 8.1.1 trust claim is not affected (assign-defaults still inserts only canonical template text); only an optional reopen-trigger line is added.
- #310 must handle "no template row" for unlinked rows (fall back to the team's own row).
- Architect confirmed: RESTRICT and CHECK kept; index and `ON CONFLICT` dropped.
- Priya Nair checks the final `RENAME_NOTICE` text; a merge gate (task 5.1).
- After #311 and #310 the default-topic area is closed until there is adoption evidence something here hurts teams. Anything beyond the listed files returns to the Executive as a decision.

## Review disposition

Business Analyst (Marcus Delgado):
- B1 unique index vs assign-defaults: accepted. [SUPERSEDED by the Architect fallback; see the last paragraph. Read the following clause as history only.] Decided `ON CONFLICT ... DO UPDATE` reactivation inside the single INSERT...SELECT (verified: gate counts ACTIVE rows only; `topicIds.length` feeds `topicCount`; restore does not clear `archived_at`, so reactivation mirrors it). Scenario added. Race on creation: none, a new team has no rows and assign holds the team advisory lock.
- M1 tie-break: accepted; one stated rule, four-row scenario.
- M2 idempotence: accepted; "never link to a template row the team already has linked", sibling scenario.
- M3 verification discriminator: accepted in a different form. No reliable creation-time discriminator is assumed; the check is that a re-run of the backfill updates 0 rows.
- M4 notice: accepted; exact text and forbidden phrases recorded, Priya a gate.
- Should-fix table: accepted for wording (rename-scope sentence, CHECK/index guarded by catalog lookup or drop-if-exists, 23503, suppression names, three value changes, tasks 5.2 as a checklist, non-goals scenario moved to tasks 6.1, residual-risk threshold). Declined: a scenario for renaming a linked copy to an active custom topic's name (that is #299's territory; task 4.3 confirms existing coverage).
- Unlinked restore: accepted, as unchanged behavior (see above); declined "must create a linked row" because restore creates no rows.
- Traceability 1-3 and 5: accepted. 4 (issue narrowing): accepted as a product-owner decision.
- Edge cases: accepted zero-teams/empty-template (one scenario), lock duration (risk line), team-deletion check (task 1.2). Declined: two-admin swap and restore-from-archived scenarios (covered by "rename is invisible" because behavior is name-independent).

Executive (Rachel Okonkwo):
- Backfill and runbook weight: accepted. Near-miss counting dropped; one count, one query, one re-run check; unlinked count reported pre-merge.
- Unique index and CHECK: [resolved] index dropped (deferred to #310), CHECK kept; Architect confirmed.
- Outcome-rule list: partly accepted. Trimmed to one suppression rule; kept because removing name matching without it would newly list offers #299 rejects. It is a small application-code filter and the first thing to cut if the Architect or Executive prefers.
- Documentation spread: accepted; wording corrections only.
- Conditions 1-4: accepted (task 2.6, Architect, scope gate in 6.2, area closed). Questions: team count and any observed mismatch are answered by the pre-merge count; I expect a small change, roughly a day and a half including migration tests.

Architect (Ingrid Sollenberger), design review dispositions: the fallback was taken, superseding the unique-index and `ON CONFLICT` reactivation statements in the Business Analyst (B1) and Executive entries above. B1's decided behavior is replaced by fresh inserts; its concern (a 500 on the recovery path) cannot occur without the index. See design.md "Review disposition" for Engineer E1 to E8 and Security S1 to S8.
