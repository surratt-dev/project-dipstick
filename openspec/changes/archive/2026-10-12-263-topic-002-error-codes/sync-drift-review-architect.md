# Sync drift review: Solution Architect (Ingrid Sollenberger)

Change: 263-topic-002-error-codes. Branch `agent-team/263-topic-002-error-codes`. Nothing fixed, nothing committed.

## Verdict: NO DRIFT FOUND

## Working tree and stash
- `git stash list` is empty. No stash left behind.
- Modified (7): the two main specs (`team-content-access`, `topic-customization-lock`), `REST API Contract.md`, `content.ts`, `content.test.ts`, `topic-002-denial-audit-integration.test.ts`, `topic-002-403-baseline.json`.
- Untracked: `openspec/changes/263-topic-002-error-codes/` (proposal, design, tasks, delta specs for both capabilities, review files).
- Every file the change should touch is present. No stray or unexpected files.

## Checks
1. Delta specs vs synced main specs: every non-heading line of both delta specs appears verbatim in the corresponding main spec. No lost or divergent text.
2. Code vs spec: `content.ts` TOPIC-002 403 now calls `buildErrorEnvelope("forbidden", <message>, decision.reason)`.
   - The code is the single value from the authorization decision, the same value written to the audit row and the event.
   - Messages, status, `no-store`, timing floor and order are untouched, as the spec says.
   - `buildErrorEnvelope` emits `category, code, message, correlationId`, which matches the fixture key order.
3. Fixture vs spec: `topic-002-403-baseline.json` differs from #264 only by the `"code"` member in each of the two bodies, and its `_comment` states the hand-edit. This matches the spec's description of the snapshot.
4. REST API Contract vs spec: the TOPIC-002 error table now has a Code column with `NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER` and `TEAM_NOT_FOUND`.
   - The "internal labels" paragraph was replaced with the envelope-code text. It agrees with the spec on: the client must not use the code for access decisions, no EM/admin-distinguishing code, correlationId not searchable, and TOPIC-001 unchanged.
   - The Denial audit note was reworded consistently with the spec.
   - No stale "internal label" or "not response fields" wording remains in `openspec/specs`, `requirements` or `packages`.
5. Tests vs spec scenarios: tests cover each new scenario.
   - Returning facilitator member code.
   - Audit-timeout 403 with code equal to the fixture.
   - Exactly two bodies and two codes.
   - Spurious header and query parameter.
   - Admin 200 has no `code`.
   - Participant gets the same code for an existing and a non-existent team (integration test).
   - Run: `content.test.ts` and `topic-002-denial-audit-integration.test.ts`, 172 tests passed.
6. Tasks: 22 done. Open: 0.3 (human Security sign-off gate), 6.3 (PR description) and 6.5 (human follow-up issues). All are human or PR-time items, not drift.

## Minor observations (non-blocking, not drift)
- The contract's `NOT_A_FACILITATOR` row still carries the older "corrected (`remove-topic` design.md Decision 9)" sentence after the new Trigger/Message text. The result is wordy but consistent.
- Main spec "denial response" requirement now refers to "the committed snapshot", which is the hand-edited fixture. The fixture is the independent statement of the contract, so it must stay hand-edited; do not regenerate it from the handler.
