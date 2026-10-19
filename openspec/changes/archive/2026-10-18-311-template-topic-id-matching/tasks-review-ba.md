# Tasks Review: 311-template-topic-id-matching (Business Analyst)

*Reviewer: Marcus Delgado. Inputs: proposal.md, tasks.md, the three spec deltas (default-topic-provisioning, admin-default-topic-maintenance, database-migrations). Focus: does the task list cover every capability and scenario, and was anything lost in translation.*

## Verdict

Coverage is good. All three modified capabilities have tasks, and the scope exclusions are protected by 6.2 and the structural tests. I count **3 must-fix gaps** (spec scenarios with no task that would produce a test), **1 sequencing defect**, and a handful of should-fix items. None require changing the design.

## Scenario-to-task trace

| Spec scenario | Task | Status |
|---|---|---|
| Team creation links every copied default | 3.3 | Covered |
| assign-defaults links; all-archived case | 3.3 | Covered |
| Copy remains one statement; only the copy writes the link | 3.2 | Covered |
| Custom topics never linked; DB refuses custom/template link | 3.3, 2.2 | Covered |
| Referenced template row cannot be deleted (23503) | 2.2 | Covered |
| **Rename and archive keep the link** (team renames copy, archive/restore, admin renames template; link unchanged, restore reactivates same row) | none | **Missing (M1)** |
| Archived + active linked rows read as held | 4.3 | Covered |
| Two teams link independently | 3.3 | Covered |
| Rename invisible (incl. team-renamed copy "Our pulse") | 4.3 | Partial (S1) |
| Archived linked default offered under team's name | 4.3 | Covered |
| Custom topic no longer hides a default | 4.3 | Partial (S1) |
| Active same-name suppresses (case/space variant; linked to different default; 409) | 4.3 | Partial (S1) |
| Archived template default not listed | 4.3 | Covered |
| Another team's rows do not affect the read | 4.3 | Covered |
| Unlinked legacy default (every unlinked-lacking default listed with template id/name; TOPIC-005 404) | 4.3 | Partial (S2) |
| **Set equality (empty team, healthy and archived-default template) and set difference (partial holder)** under the MODIFIED requirement | none explicit | **Missing (M2)** |
| Rename notice pinned, forbidden phrases | 5.1 | Covered |
| **A rename does not touch any team** (no team topic row, link, session snapshot or team audit row changes) | none | **Missing (M3)** |
| Backfill seeded data, idempotence, four-row, linked+sibling | 2.2 | Covered |
| Count from runbook query; migration output has no identifiers | 2.2 | Partial (S3) |
| Empty database | 2.2 | Covered (see S4 on wording) |
| Failure leaves nothing applied; manual replay | 2.2 | Covered |
| Sentinel literal matches constant | 2.3 | Covered |
| Reversible (down then up, no data loss) | 2.2 | Covered |
| **Rolling-deploy rows fixed by operator re-run (first re-run links, second updates 0)** | 2.2 not listed | **Partial (S3)** |

## Must-fix

**M1. "Rename and archive keep the link" has no test task.** This is the scenario that proves the link is identity rather than spelling, which is the whole point of the change (the proposal says "a rename never changes the name, status, order or restore offer of any topic a team holds"). 4.3 tests the read side only. Add a test to 3.3 or 4.3: team renames its copy, archives it, restores it, and the admin renames the template default; assert `template_topic_id` unchanged and that restore reactivates the same row id.

**M2. The MODIFIED requirement ("copy and restore list share one definition") has no task.** The two scenarios (set equality for an empty team against both a healthy and an archived-default template; set difference for a team holding some defaults by link) are existing-requirement rewrites, and the second now has new semantics. 6.1 only says unrelated suites pass. Add to 4.3 an explicit test for each, and name the existing test that asserted the old name-based equality so it is updated (not deleted or weakened, per 6.1).

**M3. "A rename does not touch any team" is untested.** It is the strongest guard for the BRD 6.4 copy-on-create promise. Add a test (4.3 or 5.1): after an admin rename, no team topic row, link, session snapshot (`session_topics`) or team audit row differs from before. This also covers the scope exclusion "session snapshot untouched" which currently relies only on the 6.2 diff review.

## Sequencing defect

**D1. Section 1 contradicts itself.** The heading says "no code written until done", yet 1.3 requires fixing `maintenance-test-hygiene.ts`, and 1.1 requires a dry run of the backfill and the runbook count query, both of which only exist after 2.1. Either move 1.3 into section 2/3 and split 1.1 into "agree the count query and dry-run mechanism" (before) and "report counts" (after 2.1, before merge), or relax the heading. 1.5 is a recorded decision, not a pre-check; mark it done or fold it into design.md. Also 1.5's text is garbled ("unique index, `ON CONFLICT` and no plain index ... per the fallback"); say "no unique index, no `ON CONFLICT`, no plain index".

## Should-fix (lost in translation or too loose)

- **S1. 4.3 abbreviates scenario variants that matter.** Spell out: team-renamed copy ("Our pulse") stays invisible; archived custom topic with a default's name does not hide it; active custom topic with a *different* name does not hide it; the suppression case differing only by case or surrounding spaces (this is the `normalizeTopicNameForMatch` behavior, the reason the import exists); the active same-name row being a default linked to a *different* template default.
- **S2. Unlinked legacy scenario.** Task 4.3 tests only the 404. Add the positive half: a team with an unlinked row whose name differs from every template default gets every active default it lacks listed with template id and name, shape unchanged.
- **S3. Migration test list omits two scenarios.** 2.2 should explicitly include (a) the rolling-deploy scenario (create team via pre-migration-style NULL-link insert, re-run backfill, first run links, second updates 0), and (b) an assertion that migration output contains no team id, row id or topic name. Also "backfill ignores template-team rows and custom rows on the team side" is implied by the seeded-data case but worth naming.
- **S4. Spec inconsistency to resolve before implementation.** The "Empty database" scenario says the migration "reports a count of 0", while the same delta forbids `RAISE NOTICE` and says the count comes from the runbook query. Reword the scenario to "succeeds and the runbook count query returns 0". Test task 2.2 already says "runbook count query returning a count", so the task is right and the spec wording is stale.
- **S5. Migration header content.** The spec requires the header to give the rationale, the legacy-rows explanation, "template defaults are archived, never deleted", and a one-sentence "Rollback:". 2.1 lists only "header, exact markers" and the transaction/locking statement. Enumerate the four required header elements, plus `IF NOT EXISTS` on the column and drop-if-exists before the CHECK (the spec requires both for replay safety).
- **S6. Staging lock/duration measurement has no task.** The proposal lists it as a residual risk ("the CHECK VALIDATE scans topics; measure in staging before release"). Add it to section 6 as a release gate, with the result recorded in the PR.
- **S7. Product-owner decision trigger.** The proposal says that if the unlinked count is large (more than a handful of teams' worth) the product owner decides before the release announcement. 1.1 and 5.3 report the count but neither states the escalation or the threshold. Add one line to 5.3: "if over threshold, stop and escalate to Brian".
- **S8. "SHALL NOT appear in any API response."** 4.3 says "no `templateTopicId` in any response" but only in the context of `defaultTopicsNotActive`. Name the other readers of `topics` (team topic list, add/rename/archive/restore/assign-defaults responses, maintenance endpoints) so the assertion is not silently narrowed.
- **S9. Hand-off to #310.** The proposal states #310 must handle unlinked rows and owns the uniqueness guarantee. No task records this on the #310 issue. Add to 5.3: comment on #310 listing the two deferrals (uniqueness; no-template-row fallback to the team's own row).

## Verified as faithfully carried over

- Scope exclusions (lock, `planDefaultRestore`/#299, template write path, session screens, manager participation, trends): protected by 3.2 (only-writer structural test), 4.4, 6.1 and 6.2.
- Topic Management correction (screen does not read the field): 4.4.
- Docs list in the proposal (deployment, REST contract, use case 08, BRD, entities, architecture 8.1.1, lock spec note): all in 5.2, including the runbook re-run controls.
- Priya Nair sign-off gate and Brian's decision on acceptance #3: 5.1 and 5.3.
- RESTRICT fallout on test helpers and the delete greps: 1.3 and 1.4.
- Review-disposition items (log lines not emitting topic rows wholesale, existing #299 coverage, team-deletion check): present.

## Persona note

Per my standing concern about edge cases being treated as out of scope when found late: M1 to M3 are all "negative" guarantees (nothing changes) which are exactly the kind that get dropped when tasks are written as "make the new thing work". They are the requirements this change exists to protect.
