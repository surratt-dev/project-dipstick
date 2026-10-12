# Design review (engineer): 263-topic-002-error-codes

*Reviewer: Marcus Oyelaran, Full Stack Engineer. Checked against `routes/content.ts` (TOPIC-002 handler, lines ~845-905), `routes/topics.ts` (four sibling 403 sites), `routes/error-envelope.ts`, and `__tests__/content.test.ts` plus `fixtures/topic-002-403-baseline.json`.*

## Verdict

Implementable as written: approve with two required edits (R1, R2) and a few small suggestions. The code change is a three-line swap and the sibling pattern is exactly what the design says it is. The risk is in the fixture and test story, not the handler.

## What I verified

- `topics.ts` lines 481, 518, 599, 680 all send `buildErrorEnvelope("forbidden", message, decision.reason)` after the same message ternary. The proposal's claim is accurate and the swap is mechanical.
- `buildErrorEnvelope` spreads `category, code, field, message, correlationId`. With no field, `code` lands between `category` and `message`, so the two-insertion fixture diff in D4 is correct.
- The handler order is audit step, event, `applyTimingFloor`, then send. The envelope's `crypto.randomUUID()` already runs at the send site today, so building it there moves nothing. D2 is right and needs no restructuring.
- Fail-open is real: `runDenialAuditStep` wraps only the insert. D5's audit-failure test pins existing behaviour.
- The existing `expectBaseline403` also asserts the body does not contain "audit" (lowercased). The new codes contain no such substring, so it stays green.

## Required

**R1. The fixture's own header says "Never regenerate or edit", and `expectBaseline403` is reused at ~10 call sites.** The design says the fixture is regenerated (D4, AC6). That is correct and unavoidable, but it directly contradicts the `_comment` in the file and the comment block above the baseline `describe` ("never regenerated: later commits must keep these exact bytes"). Both are #264 invariants. The design should say so explicitly and require:
- Editing the `_comment` and the describe-block comment to record that #263 deliberately changed it and why (otherwise the next reader sees a fixture that violates its own header).
- Hand-editing the two bodies (insert `\"code\":\"<REASON>\",` after `category`), not "regenerating" by running the handler. Regeneration from the new handler would make the test circular; a hand edit keeps the fixture an independent statement of the contract.
- Noting that the fixture now stops being a pre-change baseline. The `status`, `contentType` and message parts remain the real regression guard, and the diff review of exactly two insertions is the proof. The AC6 wording ("not a loosened test") is fine, but "baseline" is now a misnomer; either rename the `describe` title or accept the misnomer on purpose.

**R2. Resolve the `expectBaseline403` coupling in the tasks.** Because that helper is shared by the audit-row, audit-failure, timeout and event tests (the `CASES` table at ~2000), the fixture edit alone turns all of them green or red together. That is good (AC4 is covered for free), but the design should state it, so the implementer does not also add redundant per-case code assertions in those blocks. New code assertions belong only in the one new parametrised block.

## Suggestions (not blocking)

1. **Parametrisation source.** The existing `CASES` has three rows (engineer, global EM with `isMember: true`, facilitator). D5's "parametrised over both reasons" should reuse `CASES` rather than invent a fourth table. Note the EM row sets `isMember: true`; that is what proves "EM keeps NOT_A_FACILITATOR even when a member". Keep it.
2. **"Exactly two bodies" test (AC9).** Normalising `correlationId` by regex across three responses is easy, but make it compare against the fixture strings, not against each other, or it passes vacuously if both reasons ever collapse to one body. Assert the set size is 2 and each element equals a fixture body.
3. **"Participant on existing and non-existent UUID get the same body"** (D5). `routeTopic002` is a SQL-router mock with an `unroutedSql` afterEach guard. A non-existent team needs the mock to return no team row, but the 403 branch runs before any `teams` read, so there is nothing to route differently. As written this is a near-tautology in a mocked test. It only has value in the real-Postgres integration test that #264 already mandates. Either place it there or drop it.
4. **Spurious header/query negative test (AC8).** It proves nothing in a handler that never reads them. Keep it only because it is cheap; do not let it expand into a probe-surface framework.
5. **Removed-membership 200 test** is already covered by existing helper tests per D5. Take the offered "point at existing" option; do not add a duplicate.
6. **Docs scope.** AC10 greps for three literal phrases. Add `docs`-side grep of `requirements/design` for a "Validation Report" mention explicitly in tasks, since the proposal says it is "checked" but the task list should name the file and an expected result (none or one line).
7. **Type tightening, optional.** `decision.reason` is already the two-member union, so `buildErrorEnvelope` receives a precise literal type at the call site even though the parameter is `string`. No change needed; I agree with rejecting the exhaustiveness check.

## Boundaries and coupling

- Clean: backend-only, no shared package, no frontend. `error.code` is read ad hoc by convention (`error-envelope.ts` header), consistent with this.
- Hidden coupling worth stating: the audit `metadata.reason` and `error.code` now share `decision.reason`. That is intentional (D1) and covered by the code-equals-reason test; fine.
- `Topic002DenialReason` (local type in `content.ts`) and the helper's return type are separate declarations of the same union. A third reason added to the helper would break the local type at compile time via `runDenialAuditStep`'s `reason: decision.reason`, which is a useful accidental guard. No action.

## Error paths

- Complete for this change: audit insert failure and timeout (fail-open, 403 unchanged), floor or send throwing (500, unchanged), malformed team id (404, unchanged). I see no missing path.
- One note for the 500 case: since `buildErrorEnvelope` is now invoked inside `.send(...)` arguments after the floor, a throw there is not realistically possible (`randomUUID` only), so no new failure mode.

## Risk summary

Low. Single handler site, additive response member, rollback is a revert. The only way this goes wrong is a fixture edit that is done by regeneration or left with a stale "never edit" header (R1), or duplicated assertions that drift (R2).
