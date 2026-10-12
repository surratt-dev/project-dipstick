# Implementation review: Solution Architect (Ingrid Sollenberger)

Change: 263-topic-002-error-codes. Scope reviewed: uncommitted diff on `agent-team/263-topic-002-error-codes`.

## Verdict: APPROVE, with two minor non-blocking notes

## Design conformance

- **D1 (one source for code):** `content.ts` now calls `buildErrorEnvelope("forbidden", <ternary message>, decision.reason)`. Message strings are byte-identical to the originals (checked against the diff). There is no reason-to-code mapping, and the code is not derived from the message. Same call shape as TOPIC-003..006 in `topics.ts`. This is the consistent pattern.
- **D2 (order):** the envelope is built inside `.send(...)` after `applyTimingFloor`. `noStore(reply)` is still explicit. The audit insert, event, floor, send order is untouched. The only other `content.ts` change is the import line.
- **Boundaries:** `git diff --stat` shows 5 files: backend route, backend tests, fixture, REST API Contract, integration test. Nothing in `packages/frontend` or `packages/shared`. TOPIC-001 and the other 403 sites are untouched. No new config, flag or alternate path. No scope creep.
- **D3:** the correlation id is not linked to the audit row or event, as designed. The contract text now says it is not searchable.
- **D4 (fixture):** the diff is exactly two insertions of `\"code\":\"<REASON>\",` after `category`, plus a `_comment` update. The `describe` comment block in `content.test.ts` is updated and the title keeps "baseline". The fixture was hand-edited and not regenerated. Good.
- **D5 (tests):** additions only. The only change to existing material is the test-file header comment. A new row was appended to `CASES` (facilitator with an EM *membership* role, so `FACILITATOR_IS_TEAM_MEMBER`). That is an addition, but every `CASES`-driven existing test now also runs it. It passes, so this is acceptable and covers the "any membership role" rule. Added tests:
  - Code, category, message and no-store per case.
  - The named returning-facilitator test.
  - Code equals audit `metadata.reason`.
  - Audit rejected and audit timeout, both still giving the 403 with the code and matching the fixture.
  - Exactly two bodies and two codes, compared against the fixture strings with the Security failure message.
  - Spurious header and query negative.
  - Admin 200 has no `code`.
  - The real-Postgres existing-vs-missing-team case is placed in the integration test, as D5 required. The mocked file does not carry the tautology.
- Mocked suite run: `content.test.ts` 163/163 pass. I did not run the real-Postgres integration test (skipped without infrastructure).
- **Timing (S5):** no timing code moved, and the existing timing tests run through the same `CASES` rows.

## The "identical to before" sentence (REST API Contract, "Denial audit (#264)" bullet)

My view: it is stale and should be fixed, with a minimal edit. The bullet says "The response (status, `Content-Type`, body) and timing floor are identical to before; the caller sees no sign of the audit." "Before" was the pre-#264 state. After #263 the body gained `error.code`, so a reader comparing against pre-#264 behaviour would be misled. The sentence's intent is that the audit adds no observable signal, and that stays true. Recommended wording: "The response and timing floor do not depend on the audit: the 403 is the same whether the write succeeds or fails, and the caller sees no sign of the audit." This is a now-false sentence, so it fits within D6's "remove now-false sentences" scope. I would make the edit in this PR (a one-line docs change), and also mirror it in `topic-customization-lock/spec.md` if it appears there.

## Notes (non-blocking)

1. **Spec sync pending.** `openspec/specs/topic-customization-lock/spec.md:125` still says "Reason names are internal labels ... not response fields". That is expected while the delta specs live under the change directory. AC 10's grep passes only after sync/archive, so make sure the sync happens before merge or archive. Today the grep finds exactly that one hit.
2. **Table row layout.** In the contract's `403 NOT_A_FACILITATOR` row, the message and trigger text are followed by a leftover clause from the old "When" cell ("Authenticated user does not satisfy ... **corrected (...)**"). It is accurate, but long and redundant with the Trigger text. Fine to leave given the minimal-edit rule. A future docs pass could tidy it.
3. The `it.each([[...]])` wrapper with a single "rejected insert" row in the audit-failure test is slightly over-built, but harmless.

## Operability / security lens

Fail-open denial audit behaviour is pinned by tests and not changed. The new exactly-two-codes test is a real guard against a third disclosed reason. The Engineering Manager role keeps `NOT_A_FACILITATOR`. No client-side authorization input is introduced; the MUST NOT language is in the contract.
