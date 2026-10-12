AC numbers refer to the numbered list in `proposal.md`. No frontend or shared-package file is touched. Order matters: gate, fixture (the independent statement of the contract), new tests (red), handler (green), integration test, docs, release gate.

Paths: `routes/content.ts` and `routes/__tests__/*` are under `packages/backend/src/`.

## 0. Gate (read-only; stop if any item fails)

- [x] 0.1 Confirm in `routes/content.ts` that the `!decision.authorized` branch is separate from the 404 `TEAM_NOT_FOUND` branches (#265) and that `decision.reason` is the only source of the message and audit reason. Verify the admin arm produces no denial. Covers: AC 3, 7
- [x] 0.2 Check how `TopicManagementPage.loadTopics` treats a 403 on a refresh with topics already loaded. Do not change it; if it clears the list, note it for the bug follow-up. Covers: proposal follow-up 3
- [ ] 0.3 HUMAN GATE (repo owner): record the Security sign-off decision on #263 before implement starts. Proposal recommendation: not required (who can see what does not change; Security is informed, not approver). Covers: proposal Open decisions
- [x] 0.4 Baseline check: run `npx -y @fission-ai/openspec validate 263-topic-002-error-codes --strict`. The delta specs are already drafted; this task does not author them. Fix a delta-spec error only if it fails. Also grep the delta specs under this change and `requirements/design` for `regenerated`; the proposal wording is fixed in this change, and the deltas must say "hand-edited". Covers: AC 10
- [x] 0.5 Locate the real-Postgres integration test for TOPIC-002 denials: `routes/__tests__/topic-002-denial-audit-integration.test.ts` (#264). It uses `helpers/real-db.ts`, runs in the integration lane (`integration.yml`, `REQUIRE_DB=1`) and skips locally unless `docker compose up` is running. Confirm it can run (here or in CI). Fallback if it cannot run locally: rely on the integration lane in CI and say so in the PR; if the lane does not run it, state in the PR that AC 9's existing-versus-non-existent claim is verified by review only. Covers: AC 9

## 1. Fixture first (the contract, not derived from the handler)

- [x] 1.1 Hand-edit `routes/__tests__/fixtures/topic-002-403-baseline.json` (do not regenerate from the handler): insert `\"code\":\"<REASON>\",` after `category` in the two bodies. Update the fixture `_comment` and the baseline `describe` comment ("never regenerated / never edit") to record that #263 deliberately added `code`, and that the fixture is no longer a pre-change baseline. Keep the `describe` title. Review the diff: exactly two insertions, nothing else in the fixture. The existing baseline tests (in `content.test.ts` and the #264 integration test, which also reads the fixture) are now red because the handler lacks `code`. Covers: AC 6

## 2. New tests in `routes/__tests__/content.test.ts` (additions only; red until 3)

- [x] 2.1 One new parametrised block reusing the existing `CASES` table (EM global role with `isMember: true`, no facilitator role, active-member facilitator), and the only place new `error.code` assertions go; do not add code assertions to the audit-row, audit-failure, timeout or event blocks that share `expectBaseline403`. Asserts 403, `content-type`, `Cache-Control: no-store`, `error.category` "forbidden", `error.code`, exact `error.message`. Covers: AC 1, 2, 6
- [x] 2.2 Test titled `returning facilitator who is a member of the team gets FACILITATOR_IS_TEAM_MEMBER`. State in a code comment that it is a distinct fixture from the active-member `CASES` row (a user who previously ran sessions for the team, now a member). Add one `CASES` row for a facilitator holding an engineering-manager membership role: `FACILITATOR_IS_TEAM_MEMBER`. The removed-membership 200 is covered by existing helper tests; add no duplicate. Covers: AC 2, 6
- [x] 2.3 Test that `error.code` equals the audit row `metadata.reason` for both reasons. Covers: AC 3
- [x] 2.4 Audit-failure tests: rejected insert and timed-out insert each still give the 403 with the code, equal to the fixture (fail-open, existing behaviour; do not change it). Covers: AC 4
- [x] 2.5 Exactly-two-bodies test: normalise `correlationId`, compare to the fixture strings (not to each other), assert set size 2 and the code set equals the two names; failure message says a new code is a disclosure decision needing Security review. Covers: AC 9
- [x] 2.6 One negative test: a spurious header and query parameter do not alter status, code or message (no framework). Covers: AC 8
- [x] 2.7 Application Admin 200 has no `code` member. Covers: AC 9

## 3. Handler change (green)

- [x] 3.1 In `routes/content.ts`, replace the inline 403 body with `buildErrorEnvelope("forbidden", message, decision.reason)`; keep the message ternary strings byte-identical; keep `noStore(reply)`; keep the order insert, event, floor, send. Covers: AC 1-5, 8
- [x] 3.2 Run the full backend suite (`npm run test -w packages/backend`): green. Confirm no audit-row, event, query-count or floor assertion was edited (`git diff` on the test file shows additions only, plus the fixture and the two comments). Confirm the existing timing and floor tests run both reasons through `CASES`; if they do not, add a timing test for the missing reason. Covers: AC 5, 6

## 4. Integration test (real Postgres)

- [x] 4.1 In `topic-002-denial-audit-integration.test.ts`, assert the same normalised body for a participant on an existing team versus a non-existent team (spec scenario "A participant gets the same code for an existing and a non-existent team"). Add the file to the PR's changed-files list. The existing cases there already compare to the fixture and now carry the code. Run it with `docker compose up` if available; otherwise follow the 0.5 fallback. Covers: AC 9

## 5. Docs and specs

- [x] 5.1 `requirements/design/REST API Contract.md`: TOPIC-002 `403` row lists the two codes; add a Code column (code, message, trigger) to the TOPIC-002 403 rows; replace the "Reason names ... internal labels" sentence and the "differ only in `error.message`" claim; add the MUST NOT / MAY / unknown-code-falls-back / server-is-authority sentence. Edit only those sentences. Covers: AC 10
- [x] 5.2 Next to the MUST NOT sentence add the two Security sentences: no code may distinguish an engineering-manager or application-admin denial without Security review; the TOPIC-002 403 `correlationId` is per response, not recorded in the audit row or event, so not searchable. Covers: AC 10
- [x] 5.3 Read-only grep checks, now: `internal label`, `Reason names` and `differ only in` across the delta specs in this change and `requirements/design` (including the Validation Report file): no sentence says the reasons are not envelope fields. Expected none, or one line to fix. Covers: AC 10
- [x] 5.4 Re-run `npx -y @fission-ai/openspec validate 263-topic-002-error-codes --strict` after the spec and doc edits (final check; 0.4 was the baseline). Covers: AC 10

## 6. Scope guards and release gate

- [x] 6.1 `git diff --stat` shows no change to TOPIC-001, other `code(403)` sites, `packages/frontend`, or `packages/shared`. Record it in the PR body. Covers: AC 7
- [x] 6.2 Run locally before pushing: `npm run lint`, `npm run test`, `npm run build`; all green. Then CI green. Covers: AC 10
- [ ] 6.3 PR description includes: the Security escalation triggers (a new `decision.reason` value or a code distinguishing EM or admin denials; any change to audit-row `metadata`; any change to fail-open or fail-closed behaviour; client-side branching on `error.code` that changes access rather than display text; any change to ordering around the timing floor); a checklist line "diff shows a single `buildErrorEnvelope("forbidden", message, decision.reason)` call and the message ternary is the only branch" (AC 3); the 6.1 diff stat; the 0.5 integration result or fallback. Inform Security on merge. Covers: AC 3, 7
- [x] 6.4 Main-spec check at sync/archive: after the delta specs are synced to `openspec/specs` (sync or archive step, by whoever runs it), grep `openspec/specs` for `internal label`, `Reason names` and `differ only in`: none says the reasons are not envelope fields. Until then, 5.3 (delta specs) is the PR-time evidence; say so in the PR. Covers: AC 10
- [ ] 6.5 FOR THE HUMAN (repo owner; owner of record), before merge: file the follow-up issues by title and copy each one's requirements from the proposal into the issue body (this change files none):
  - "TOPIC-002 / topic management: next-step copy for FACILITATOR_IS_TEAM_MEMBER and NOT_A_FACILITATOR" (proposal follow-up 1): copy the full facilitator-review requirements list and the open question; copy review owner Devon; ordered ahead of other API-consistency items in Milestone 03.
  - Event-only correlation id for the TOPIC-002 denial (follow-up 2), with its named trigger.
  - TOPIC-001 admin 403 has no code (follow-up 4), low priority.
  - Bug, only if 0.2 finds it: `loadTopics` clears the list on a 403 during refresh (follow-up 3).
  - Optional operations item: alert on `rowWritten: false` (follow-up 5).
  - Link them in the PR, and comment on #263 closing item 2 as "not done, deliberately: #264 merged, linkage not requested". Covers: proposal follow-ups
