# Exploration notes: 311-template-topic-id-matching

Author: Devon Calloway (Internal Champion). Issue #311, prerequisite of #310. Exploration only; nothing implemented.
Revision 2: incorporates the Facilitator (Priya Nair) and BA (Marcus Delgado) reviews. Open questions are now resolved with single picks; remaining inputs are listed under "Hand-offs and PR notes".

## Terminology (used everywhere; "pairing" is retired)

- **Linked**: a team topic row whose `template_topic_id` equals the id of a template default row. Link means identity: "this row was copied from that template default".
- **Unlinked default**: a team row with `is_default = true` and `template_topic_id IS NULL` (legacy rows that could not be backfilled, or rows created by an old build during a rolling deploy).
- **Custom topic**: `is_default = false`. Never linked.
- **Template default**: a row in the template team (sentinel team id, defined in one place in code; the spec names that definition rather than restating its value).
- "Restore" (single, bulk) keeps its #216/#218 meaning: reactivating the team's own archived row. It is not a join to the template.

## Devon's lens

I do not care about the column. I care about one promise: "the default topic set is visible and easy to restore, so teams can experiment without losing the baseline." #216 let an admin rename a default. The moment that happens, the name join silently stops recognizing a team's own copy as "that default". Failure is quiet: the team looks like it is missing a baseline topic it still holds, or the reverse. Quiet failure in the baseline path erodes trust in "I can experiment safely." Fix it before #310 builds on it, without anyone being able to loosen the first-session lock or the template-write guard as a side effect.

Requirement traceability for the proposal: TOPIC-002 (default set, rename semantics), TOPIC-005 (restore), the Recover Zero-Topic Team use case, BRD 6.4 (copy-on-create).

### Scope Exclusions (copy verbatim into the proposal)

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

## What the code actually does today

- `copyCanonicalDefaults` (`packages/backend/src/sessions/default-topics.ts`): one `INSERT INTO topics (team_id, name, prompt, vote_type, display_order, is_default, first_session_description) SELECT $1, name, ... FROM topics WHERE canonicalDefaultsWhere("topics", 2) RETURNING id`. Explicit column list. The single statement is load-bearing: #216 design E8 says a team created during an admin edit sees the complete before-set or after-set because it is one READ COMMITTED statement. Fix: add `template_topic_id` to the column list and `id` to the SELECT list. Still one statement. No second UPDATE pass, ever.
- Callers: team creation (`facilitator-sessions.ts` ~l.714) and zero-topic recovery `assign-defaults` (`routes/topics.ts` ~l.1270). Same function, one SQL edit, but two tests.
- `defaultTopicsNotActive` (`routes/content.ts` ~l.982): `FROM topics dt LEFT JOIN LATERAL (SELECT id,status FROM topics WHERE team_id=$1 AND name = dt.name ORDER BY (status='active') DESC, id LIMIT 1) t`. Raw name equality, matches ANY team topic of that name including a custom one (REST contract l.707, #197). Consumer: the Topic Management restore offers (screen to be named by the proposal after the UI file is checked; I have not inspected the UI).
- Bulk and single restore reactivate the team's OWN archived `is_default` row (`planDefaultRestore`, `packages/shared/src/types/topic.ts` l.405); they never read the template. So rename does not break them today. What rename breaks today is `defaultTopicsNotActive` and the admin RENAME_NOTICE truthfulness, and #310's future need. The issue's "switch restore pairing to join on id" therefore means: provide the id link and use it for `defaultTopicsNotActive` and #310; do not rewrite `planDefaultRestore`.
- Other writers of team topics: custom add in `routes/topics.ts` ~l.1119 (`is_default=false`, link stays NULL, correct); template `opAdd` in `default-topic-maintenance.ts` (template rows, link stays NULL).
- Copy to update: `RENAME_NOTICE` (`default-topic-maintenance.ts` l.47), REST contract l.1196, l.1226, l.707, BRD traceability l.329, and tests that pin the string.

## Data facts that matter for the backfill

- Migrations 4 and 11 DELETEd and re-inserted template rows (new ids). Teams created before migration 11 reference ids that no longer exist, and names may differ from the current template. These legacy rows are real in any long-lived deployment.
- Admins may already have renamed template defaults (#216) before this migration runs; a team row with the old name will not match.
- Archived template rows exist (admin archive, never deleted).
- #299 constrains only ACTIVE names, so a team can hold an archived default plus an active custom topic of the same name, or two archived rows of one name. A naive UPDATE...FROM would link both to one template id.

## Decisions (all open questions resolved)

1. **Backfill matches ALL template default rows, active and archived.** Link is identity, not "currently offered". Otherwise a team holding a topic whose template default was since archived stays unlinked and later gets offered it as "never seeded".
2. **Name comparison is raw equality.** It reproduces what today's join already links and cannot invent identity. Near-misses (case/whitespace) are reported by the migration, never linked. No fuzzy matching, ever (guessing identity is how silent mislinks happen). I checked the current join: it is raw `=`, so raw is consistent.
3. **Candidates and tie-break.** Only `is_default = true` team rows are candidates. For each team and template default, at most one team row is linked: among several same-name default rows of that team, the active one, else the lowest id; the rest stay NULL.
4. **FK is `ON DELETE RESTRICT`.** A loud block beats silent loss of identity. Rule recorded in the migration header and the spec: template defaults are archived, never deleted; a future reseed must archive (the migration-11 lesson). Architect to confirm; my position and the BA's agree.
5. **Unique partial index on `(team_id, template_topic_id) WHERE template_topic_id IS NOT NULL`, added now**, after the backfill (which never produces duplicates). It makes "one team row per template default" a stated rule that #310 may rely on. Plus a plain index on `template_topic_id` if the join plan needs it.
6. **Invariant.** A team row has non-null `template_topic_id` only if `is_default = true`; a template-team row never has one. Enforced by a CHECK constraint if it can be written without restating the sentinel value inline (reference the sentinel as defined in migrations/code); otherwise by a structural test. Proposal picks CHECK first; test is the fallback, not both undecided.
7. **No new API field.** Stated as a non-goal.
8. **Unlinked legacy rows stay NULL; #299 duplicate-name rule is the backstop.** They hold no template default, so every active template default they lack shows as missing; restoring a duplicate-named one is rejected by #299. Option (b) and fuzzy match (c) are rejected. The backstop gets an explicit test.
9. **Archived template defaults drop out of `defaultTopicsNotActive`**, as today (archiving a default means "no longer offered"). Written as a scenario.
10. **#197 mis-match fix is in this PR as an explicit requirement**, not a side effect. Reviewing stakeholder (Brian) acknowledges it.
11. **Migration reports counts.** The migration logs the count of unlinked `is_default` rows (and near-miss count). Team and row ids are NOT logged (data-access concern); the runbook provides a read-only query listing team id, row id, name. This doubles as the admin-visible place for the Facilitator's request: an admin can run the query before teams meet a near-duplicate. No new UI for it.
12. **Migration shape.** Next file is `24_...sql`. Use the "Up Migration"/"Down Migration" markers that node-pg-migrate actually recognizes (17's bare markers are a known trap), header with rationale and "Rollback:" paragraph. Backfill is one idempotent statement touching only rows where `template_topic_id IS NULL`. Down drops unique index, CHECK, then column; no user data lost (link is derived). `db:migrate` runs `--no-single-transaction`, so order: add column, backfill, then indexes/constraint, using IF NOT EXISTS where the repo does.
13. **Rolling-deploy window.** A team created by an old instance gets NULL. Requirement: backfill is idempotent; deployment.md lists "re-run the backfill statement after old instances drain" plus a verification query expected to return zero rows created post-migration.

## UI outcome for the custom-topic-same-name case (Facilitator's dead-end-click concern)

Accepted: a defined user-facing outcome is needed, and a failing click is the wrong one. Decision, within minimal scope:

- `defaultTopicsNotActive` does not list a template default whose name equals the name of an ACTIVE topic the team holds (custom or default), because it could not be restored without breaking #299. Result: no offer, no failing click, no new state, no new API field, no UI change.
- This is narrower than today's masking: a custom topic that is archived, or an active custom topic whose name differs, no longer hides anything, and masking never depends on the link. A linked-and-held default is matched by id.
- If the offer is ever surfaced anyway (race, or an old client), restore returns the existing #299 duplicate-name rejection (name the status code in the spec) and changes no state. Not a 500.
- Feasible but deferred: showing the entry with a reason ("A topic with this name is already active") would need a new response field or UI work. Record as a follow-up; out of scope here. I have not inspected the UI file, so the proposal must confirm the Topic Management component needs no change under the hide approach.

## Reviewer feedback: accepted, adapted, declined

Accepted:
- Terminology and acceptance rewording (BA 1, 2a): issue acceptance #3 is restated as "#310 can read the template row for any **linked** default". The issue text should be amended so the change is not judged against a criterion unlinked legacy rows cannot meet. Hand-off constraint for #310: handle "no template row" explicitly (fall back to the team's own row).
- Rewritten RENAME_NOTICE is a stated acceptance item, not "update the string" (Facilitator 3, BA 9). Required content: existing teams keep their own copy and its current name; renaming a default does not change or rename any team's topic; teams that never held the topic see the new name. Audience: the admin maintenance screen; the proposal confirms no team-facing screen references it.
- Rename-then-offer naming (Facilitator 4): a team must see recognizable naming. For linked rows the team's own name is what the team sees. The proposal verifies what `defaultTopicsNotActive` returns as the name today for an archived linked row; if it is the template name, switch to the team row's name for linked rows (a value change, not a shape change). Add as a scenario.
- Explicit "no session-time screen changes" scope exclusion (Facilitator 6), above.
- Non-testable text replaced by requirements (BA table): invariant, deterministic link rule, idempotent backfill, one reporting deliverable, scenario for archived template default.
- Edge scenarios (BA 5): team renames its own copy then admin renames template (link survives both); team archives its copy (link retained, restore reactivates the same row); two teams; team created during the migration window.
- Test template snapshot/restore helper must preserve template row ids, or the suite goes red under RESTRICT (BA 5). Flagged to Tess/Architect: check the helper before implementing.

Adapted:
- Facilitator "add vs restore" label for never-seeded defaults (3): record as a follow-up unless the label is a one-line string change found during implementation. It is a UI/vocabulary change beyond plumbing scope; the spec gets one line noting the wording mismatch.
- Facilitator "legacy-unlinked count visible to admin" (5): met by the runbook read-only query, not a UI.
- Facilitator "do not show more than real gaps" (question 2): the offer list cannot distinguish unlinked-held from genuinely missing without fuzzy guessing (rejected). Mitigation is the count/query and #299; accepted residual risk, stated in the spec.

Declined, with rationale:
- Showing an admin how many teams hold the old name when renaming (Facilitator question 5): new feature and new data path on the template-write surface; not needed for this prerequisite. Follow-up candidate under #216 maintenance.
- "Fixture churn" as a requirement (BA): implementation concern. Kept only "no existing test is deleted or weakened".
- BA scenario 5 as originally worded ("a custom topic named like a default no longer hides that default"): narrowed by the UI decision above; an ACTIVE same-name topic still suppresses the offer because restore would be rejected. Rewritten scenario: archived or differently named custom topics never hide a default; an active same-name topic suppresses the offer.

## Acceptance scenarios for the proposal (each maps to a test)

1. Rename invisible to existing teams: team T holds linked "Pulse"; admin renames template default to "Heartbeat"; T's `defaultTopicsNotActive` is unchanged and T's topic is still "Pulse". Variants: active, archived-by-team, team-renamed copy.
2. New teams linked on both paths: team creation and zero-topic `assign-defaults` each set `template_topic_id` to the source template row id; custom topics never have one.
3. Copy stays atomic: exactly one `INSERT ... SELECT` including `template_topic_id` (E8 test extended).
4. Backfill on seeded data: matched default; renamed-template unmatched; custom topic with a default's name; two same-name default rows (active+archived; both archived); default whose template row is archived; already linked. Exactly the expected rows link; second run changes nothing.
5. Custom topics never linked; mis-match behavior per the UI decision above (documented change from #197).
6. Unlinked defaults hold no template default; migration reports the count; the offered duplicate is rejected on restore by #299.
7. Reversible: down then up on seeded data restores the schema; down loses no user data.
8. Non-goals hold: existing structural tests (template-writer-structural, #188 guard, canonical-defaults-no-duplicate-names, seed integration) pass unmodified.
9. Truthful copy: RENAME_NOTICE, REST contract (l.707, 1196, 1226), BRD traceability (l.329) no longer say teams stop matching after rename.
10. Archived template default drops out of `defaultTopicsNotActive`.

## What could go wrong (ranked)

1. Backfill mislinks silently. Mitigation: is_default only, raw equality, deterministic single choice, unique index, seeded verification.
2. Unlinked legacy rows cause an offer for a topic the team holds under an old name. Mitigation: count, runbook query, #299 backstop, tested.
3. Copy becomes two statements and breaks E8. Mitigation: structural assertion on the SQL.
4. Rolling-deploy window creates NULL-link teams. Mitigation: idempotent re-backfill step with verification query.
5. Link read as "template edits propagate". Out of scope; Scope Exclusions say so.
6. RESTRICT blocks a future reseed. Deliberate: reseed must archive.
7. Stale copy (RENAME_NOTICE, contract text). Update together with the pinned tests.
8. Test snapshot helper reinserting template rows breaks under RESTRICT; verify first.

## Hand-offs and PR notes

- **Real-environment unlinked-row count cannot be queried from here.** Not a blocker. The migration logs the count at run time; the runbook query lists the rows. Flag as a PR note: "Count of unlinked `is_default` rows per environment is unknown at authoring time; check the migration log on each environment, and if non-zero, review the runbook query output before announcing." If a reviewer wants it measured pre-merge, that is Brian's data task, not a gate on implementation.
- Issue #311 text: amend acceptance #3 to "any linked default".
- Architect to confirm: RESTRICT, CHECK vs test for the invariant, test snapshot helper behavior.
- #310: must handle "no template row" for unlinked rows.
- Follow-ups (not in this change): "add" vs "restore" label for never-seeded defaults; showing a reason instead of hiding the offer; admin-visible held-by-count on rename.
- Facilitator (Priya) offered a quick check of the final RENAME_NOTICE wording and Topic Management behavior; request it at the propose stage.

## Suggested change outline (for the propose stage)

1. Migration 24: nullable FK (RESTRICT) column, single idempotent backfill with count reporting, unique partial index, invariant CHECK (or test), down section; header documents legacy rows and the migration-11 lesson.
2. `copyCanonicalDefaults`: add `template_topic_id` / `id` to the single INSERT...SELECT.
3. `defaultTopicsNotActive`: LATERAL join on `template_topic_id = dt.id`, same ORDER BY and one-entry-per-default; omit defaults whose name equals an active team topic's name; team's own name for linked rows.
4. Rewrite RENAME_NOTICE and contract/BRD text; add unlinked-row runbook query, re-backfill step and verification query to docs/deployment.md.
5. Tests per the scenarios above.
6. Scope Exclusions section copied verbatim.
