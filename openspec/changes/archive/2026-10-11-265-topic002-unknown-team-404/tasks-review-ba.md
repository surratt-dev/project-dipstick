# Tasks Review (Business Analyst): topic002-unknown-team-404 (#265)

Reviewer: Marcus Delgado. Inputs: `tasks.md`, `proposal.md`, issue #265 (read live), delta specs (headings only, for cross-reference).

## Verdict

Approve with minor changes. Traceability from the 12 proposal ACs and the issue's 9 acceptance bullets to tasks is nearly complete, and the tasks are buildable as written. I found no AC with zero coverage. I found four places where something is lost or left implicit, and one place where the tasks quietly weaken an issue criterion. None blocks starting work; items 1 and 2 should be fixed before the tasks are frozen.

## Coverage matrix: proposal ACs to tasks

| AC | Covered by | Note |
|---|---|---|
| 1 (404, envelope, no-store, one timing floor before send) | 1.1, 1.2 | Complete. |
| 2 (check order; non-canonical 404 before any query) | 1.1, 1.2, 1.2a, 0.3 | Complete. |
| 3 (no audit row, no event, no membership/role-set query; facilitator 404 not 403; name-read failure 500) | 1.1, 1.2, 2.1 | Complete. 2.1 re-asserts at DB level. |
| 4 (key sets exact, no `team_found`/`teamFound`) | 1.1, 1.3, 2.1 | Complete. Stale `toMatchObject` expectations called out, good. |
| 5 (same SQL-text multiset for facilitator) | 0.1, 1.1 | Complete. |
| 6 (zero-topic, deactivated, template 200; template admin row) | 1.1, 2.1 | Complete. Template admin row is only explicit in 2.1. 1.1 should say "template team (admin: one audit row)". Minor. |
| 7 (participant identical 403, rows equal except `team_id`, zero `teams` queries, member-facilitator unchanged) | 1.1, 2.1 | Complete. |
| 8 (TOPIC-001 regression) | 1.4 | Complete. |
| 9 (screen "Team not found.") | 3.1, 3.2 | See finding 4. |
| 10 (other failures stay "Failed to load topics.") | 3.1, 3.2 | Complete. |
| 11 (quiet refetch keeps content) | 3.1, 3.2 | Complete, with the drop-and-file fallback. |
| 12 (docs, checks, recorded outcomes, cutover, structural test, lint/test/build, delta spec format) | 0.2, 1.3, 4.1-4.5, 5.1 | See findings 1, 2, 3. |

Issue bullets: all nine map to tasks. The only weakened one is finding 3.

## Findings

### 1. No task owns the PR body, though eight tasks say "record in the PR" (should fix)
Tasks 0.1, 0.2, 0.4, 4.1, 4.2, 4.3, 4.5 and 5.2 each end in "record/quote in the PR", and the proposal promises the PR body will "surface" the merge gate. Nothing assembles that. This is where requirements-to-evidence traceability gets lost. Add one task: "Draft the PR body: SQL-text baseline (0.1), grep outcomes (0.2, 4.2), fixture-churn size (0.4), contract and docs result (4.1), named owner and answer for SIEM/dashboards (4.5), and both merge-gate items (5.2) with the 'not to be merged until Brian confirms' line." Also state in 0.4 where its result is recorded (PR or commit message).

### 2. Follow-up issues the proposal commits to have no task (should fix)
- Open decision 5: stale links "becomes a filed follow-up issue covering deactivated-team indication and clearing stale remembered team ids". No task files it. The issue's own text frames this as the real user problem, and the proposal itself admits #265 "does not fully solve" it. Without a filing task it will be forgotten, and later it will show up as a scope dispute.
- Open decision 2b: the follow-up for 403 denial-row growth. 5.2 asks Brian to *decide whether to file*, but there is no task to file it once he says yes.
- 3.2 has a conditional "file a follow-up" for any path found to blank the screen. That one is fine, but make it a visible conditional task or checkbox so it is not lost.
Suggested: add 5.3 "File follow-up issues (stale links; denial-row growth if approved; quiet-refetch blanking path if found) and link them in the PR."

### 3. Issue criterion `openspec validate --strict passes` is downgraded without saying so (should fix, wording)
The issue lists `openspec validate --strict` passing as an acceptance criterion. 4.3 and AC 12 replace it with hand-checking because the CLI is unavailable, and run it only "if it becomes available". That is a reasonable constraint, but it is a deviation from the issue, and the tasks should name it as one. Add to 4.3 or the PR task: "Deviation from #265 AC: CLI unavailable; hand-check recorded; validate before merge if the CLI can be obtained." Otherwise the reviewer ticking the issue's boxes will see an unmet item.

### 4. Frontend "no empty team shell first" has a test but no implementation instruction (minor)
AC 9 requires that no empty team shell renders before the not-found state (a loading indicator is acceptable). 3.1 tests it. 3.2 says only "implement the `TEAM_NOT_FOUND` branch in `loadTopics`". If the page currently renders its shell before `loadTopics` resolves, the test fails and the engineer must add loading-state code the task does not mention. Add to 3.2: "verify the pre-load state is a loading indicator; if not, fix the minimum needed (this is part of AC 9, not new UI)." Also note this interacts with the "no new UI" cap, so the fallback should be decided now rather than mid-implementation.

### 5. `team_found` appearing in the REST API Contract is not named in 4.1 (minor)
Exploration notes record `team_found` at REST contract L696 (and in the main `topic-customization-lock` spec L159/L299, which the delta covers). 4.1 lists the 404 row, the "tracked optional follow-up" sentence, the status order, and the TOPIC-001/002 sentence, but not removing `team_found` from the contract's audit-row description. Add it to 4.1, or add a grep step ("no `team_found` remains in contract or specs except the historic-rows note in 4.4"). The same grep is a cheap final check under 5.1.

### 6. Smaller items
- 4.4 does not say which doc or runbook holds the cutover note and the "do not purge historic `team_found: false` rows" warning. Name the file so the task is verifiable.
- 4.2 "record the outcome" has no destination (covered by finding 1).
- Proposal open decision 4 (Priya's quick look at the one string) appears only inside 5.1. Fine, but note it is non-blocking so the release gate does not stall on it.
- Open decision 3 (never label a non-envelope 404 "Team not found.") is a confirmation item for Brian. 5.2 includes it; good.
- Task 3.3 lists non-goals as a review step, a good guard against live-session and participant-view drift. No change needed.

## What was kept well (nothing lost)
- The audit asymmetry (403 audited, 404 not) is a merge gate in both documents, with the "implementation proceeds, merge blocked" rule intact.
- The no-manager record is preserved: 1.1 and 2.1 assert existing, deactivated and template teams are still audited once, and the admin 404 runs no membership-role or role-set query.
- Enumeration resistance (participant identical 403, zero `teams` queries) is carried through in detail, including the header and body normalization being named in the test.
- Non-goals are mirrored: no `fetchAllTopics` code change, no write-action handling change, no template-team 404, no upper-case pinning test.
- Tests-first ordering (1.1 before 1.2, 3.1 before 3.2) is honored.

## Requested changes summary
1. Add a PR-body task (finding 1).
2. Add a follow-up-filing task (finding 2).
3. Name the `openspec validate --strict` deviation (finding 3).
4. Clarify the loading-state expectation in 3.2 (finding 4).
5. Add `team_found` removal and a final grep to 4.1/5.1 (finding 5).
6. Name the file for 4.4 (finding 6).
