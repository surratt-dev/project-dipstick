# Sync drift check (Architect, Ingrid Sollenberger)

Scope: main specs `default-topic-provisioning` and `topic-customization-lock` versus the uncommitted diff (code, tests, docs/deployment.md) on branch agent-team/215-harden-team-creation-topic-copy.

## Result: no unresolved drift. One wording drift fixed.

### Sync fidelity
- Every requirement block in the change's delta specs (5 in default-topic-provisioning, 1 in topic-customization-lock) appears verbatim in the corresponding main spec. The Purpose paragraph was updated to the active-only predicate.

### Format
- 18 requirements per spec file, each with `### Requirement:`, at least one `#### Scenario:`, and SHALL/MUST in the body. The openspec CLI is not installed here, so this was checked with a script rather than `openspec validate`.

### Requirement versus code
- Copy (`copyCanonicalDefaults`, `canonicalDefaultsWhere`): active default rows only, renumbered by `row_number() OVER (ORDER BY display_order, id)`, explicit column list that excludes annotation columns, same transaction, `sourceTeamId` seam never passed by the route. Matches.
- Shared predicate: `content.ts` `defaultTopicsNotActive` uses `canonicalDefaultsWhere("dt", 2)`. The predicate is applied to the template side only, so the team's own row is unfiltered. Matches the topic-customization-lock requirement.
- Anomalies: `detectTemplateAnomalies` matches the four anomaly definitions, including m = 0 not raising `non_contiguous_order`, canonical order then id, and the cap of 50. `facilitator-sessions.ts` checks after COMMIT on the pool. It writes one warn `template_anomaly` with `templateTeamId`, `anomalies`, `topicIds` and `correlationId = request.id`. On failure it writes `template_anomaly_check_failed` with `errCode` only. No de-duplication across requests. Matches.
- Empty template: 500 `internal_error` with the exact message, a `correlationId` in the body and no template id; the transaction rolls back; an error-level log carries `templateTeamId` and `correlationId`. Matches.
- Snapshot after copy in the same transaction. Matches.
- docs/deployment.md operator note agrees with the spec.

### Requirement versus tests
Covered by `team-creation-canonical-copy-integration.test.ts` (archived default, gaps, archived/active collision, single default, same-name rows, NULL description, every column, snapshot, restore list, set equality, each anomaly code, persistent fault, combined case, empty template, duplicate-position copy with the index dropped). Also covered by `team-creation-failure-paths.test.ts` (generic copy failure, throwing check), `template-anomalies.test.ts`, `default-topics.test.ts`, and `template-invariants(.test|-integration.test).ts` with `template-lock.ts`.

### Drift fixed
- `default-topic-provisioning/spec.md`, scenario "Team creation copies the pre-attempt baseline" (requirement "The template team is never written through a team-scoped topic-write endpoint"). It said the new team's topics, in every status, equal the snapshot's `is_default = true` rows on `display_order` and `status`. The copy now takes active defaults only and renumbers them 1..n, and the updated regression test already asserts that. I reworded it to say active defaults, `display_order` 1 to n in canonical order (unchanged for a healthy template), and `status = 'active'`. Wording only; no code touched.

### Notes
- The "Duplicate active position" scenarios are deliberately limited to the pure detector and the copy-function test. This is documented in the spec and matches the tests.
- I did not execute the test suite; this was a static comparison.
