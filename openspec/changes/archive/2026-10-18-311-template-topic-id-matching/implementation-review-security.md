# Security Review: 311-template-topic-id-matching (implementation)

Reviewer: Tomás Ferreira, Security Analyst. Scope: uncommitted diff on `agent-team/311-template-topic-id-matching`. Read, not run: `routes/content.ts`, `sessions/default-topics.ts`, `sessions/default-topic-maintenance.ts`, `migrations/24_template_topic_id.sql`, `test-fixtures/template-link-runbook.sql`, `docs/deployment.md`, `High-Level Architecture.md` 8.1.1, `template-link-writer-structural.test.ts`, `template-writer-scanner.ts`, and the test titles of the integration and migration suites. I did not execute the test suites.

## Verdict

Approve. No blocking findings. The implementation matches the design as amended by the Architect (fallback taken: no unique index, no `ON CONFLICT`, no reactivation), which moots S1 to S3 from the design review. Items S4 to S7 are implemented. Three non-blocking observations follow.

## Blocking

None.

## Non-blocking

### N1 (Low): the structural test does not pin "no ON CONFLICT / no UPDATE" in the copy

Design Decision 6 promised a structural assertion on the copy's SQL: exactly one `INSERT INTO topics` carrying `template_topic_id`, no UPDATE, no `ON CONFLICT`. `template-link-writer-structural.test.ts` pins the first part (single link writer, and its statement starts with `INSERT INTO topics`) and has good rogue-writer and negative fixtures. The migration test asserts `not ON CONFLICT` for the migration only. I found nothing asserting that `copyCanonicalDefaults` stays free of `ON CONFLICT`. The practical risk is small, because reactivation is the thing the Architect removed and a later re-introduction would need to pass review (and reopen 8.1.1 (h) by intent), but the assertion costs one regex on the already-extracted `statement` text. Note `statement` is truncated to 120 characters, so the assertion needs the full literal, not `findings[0].statement`.

### N2 (Low): scanner coverage limits worth stating in the test header

`scanLinkWriters` matches string and template literals only. SQL assembled by concatenation across several literals, or `template_topic_id` named only through a variable, would not be seen. No such writer exists today, and the migration and tests are outside `productionSources` by design. Add one line to the test comment ("literal SQL only") so the limit is known. Also confirm `TABLE` in the scanner accepts a schema-qualified `public.topics`; the rogue fixtures do not cover it.

### N3 (Low, availability not security): migration lock footprint

The whole file is one implicit transaction. `ADD CONSTRAINT ... NOT VALID` takes an ACCESS EXCLUSIVE lock that is held to commit, so `VALIDATE CONSTRAINT` scans `topics` while holding it. `lock_timeout = '200ms'` bounds lock acquisition only, not the hold. The migration header and `docs/deployment.md` already say "time it on a production-sized copy"; I would add the sentence that topic reads and writes block for the duration of the scan. Table is small; accepted.

### N4 (Informational): backfill re-run can mis-link after a template rename

The post-drain re-run matches by raw current template name. If the template default was renamed (#216) between migration and re-run, a legacy unlinked team row that happens to carry the new name could link to it. This is the already-accepted S8 integrity risk (offer correctness, not authorization or cross-team access), and the CHECK plus predicates bound it. Practical mitigation: run the re-run promptly after drain, before any template maintenance rename. One clause in the runbook would say so.

## Checked, no finding

**Team scoping of the new join (`routes/content.ts`).** The lateral subquery filters `team_id = $1 AND template_topic_id = dt.id`; `$1` is the route `teamId` that the existing team-access check authorizes before the handler; `dt` is still bound by `canonicalDefaultsWhere` (template team, active defaults). The linked entry returns the caller's own row id and name; the unlinked entry returns a template id, as before. Suppression runs in application code over `activeResult.rows` (the caller's team rows already read), so it exposes nothing new. Test titles show the two-team read case ("another team's differently named linked row does not affect the read") and TOPIC-005 on a template id staying 404 with nothing written.

**Copy path (`copyCanonicalDefaults`).** One `INSERT ... SELECT` adds `template_topic_id` / `id`; no second statement, no `ON CONFLICT`, annotation columns still excluded, team_id remains the `$1` argument and the template is only the SELECT source. Both callers (`topics.ts` assign-defaults, `facilitator-sessions.ts` team creation) are unchanged and keep their existing gating. `sourceTeamId` remains a non-request seam. Since reactivation was dropped, assign-defaults still inserts only canonical template text into a locked team, so the 8.1.1 trust claim stays literally true; the reopen trigger for "using `template_topic_id` to propagate template content into existing team rows" is added to 8.1.1 (h), as I recommended.

**Migration 24 output.** No `RAISE NOTICE`, no `RAISE`, no SELECT; the migration test asserts the absence. No ids, team ids or names reach migration logs. FK is `ON DELETE RESTRICT`; CHECK limits the referencing row to `is_default` and non-template team; rollback drops CHECK then column. Sentinel-literal drift is asserted by test (S5 made mandatory), including the fixture literal. No production code sets `is_default = false` (grep found none), so the CHECK cannot turn an existing path into a 23514 and a 500. `topics.team_id` cascade deletes remove referencing rows, not referenced template rows, so RESTRICT does not block team deletion.

**Backfill guards.** Both the migration, the fixture `test-fixtures/template-link-runbook.sql` and the `docs/deployment.md` statement carry `is_default = true` on team and template sides, `team_id <> template` on the team side, `team_id = template` on the template side, `template_topic_id IS NULL`, the one-winner ranking (`rn = 1`) with the comment explaining that `NOT EXISTS` is not the guarantee, and `NOT EXISTS` against an existing team link. A test asserts the migration embeds the runbook backfill and that the docs copy all three statements verbatim, so the guards cannot drift. The CHECK backs them up if a future edit drops one.

**Runbook handling (S6, S7).** Docs say counts only go into a PR or ticket, row-level listing is operator-only and never pasted; re-run is under the migration DB role, not an application role; operator, time and updated-row count recorded in the deployment ticket; second run must update 0 rows; predicates must stay as written.

**No new write path or response leak.** `template_topic_id` appears in no production file other than `default-topics.ts` (copy), `content.ts` (SELECT join only) and the migration. No `SELECT *` or `RETURNING *` on topics in production source. `content.ts` selects explicit columns and maps to explicit response fields; `content.test.ts` asserts `templateTopicId` and raw team-row columns never appear, and the integration suite asserts the link is absent from TOPIC-002, add, archive, restore, assign-defaults and the maintenance endpoints. No new endpoint, no new template writer; `default-topic-maintenance.ts` changes only the verbatim rename notice (text change, no behavior). Existing #188 guard and template-writer allowlist are unaffected (the scanner change is additive).

**Docs and threat model.** `docs/deployment.md` and the 8.1.1 (h) edit are accurate against the implementation. No further 8.1.1 or 8.2 change is needed given no reactivation, consistent with design Decision 15.
