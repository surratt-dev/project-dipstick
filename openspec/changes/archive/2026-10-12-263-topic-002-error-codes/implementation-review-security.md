# Security Review of Implementation: 263-topic-002-error-codes

Reviewer: Tomás Ferreira, Security Analyst. Inputs: `git diff` of `content.ts`, `content.test.ts`, `topic-002-denial-audit-integration.test.ts`, the baseline fixture, `REST API Contract.md`; `error-envelope.ts`; `standing-facilitator-access-helper.ts`. Earlier review: `design-review-security.md`.

## Verdict

**Approve. No blocking findings. Security sign-off still NOT required.** None of my escalation triggers appear in the diff. Two non-blocking observations (N1, N2).

## Checks

1. **Code comes only from `decision.reason`: PASS.** The only production change is in the TOPIC-002 denial branch: `buildErrorEnvelope("forbidden", <message ternary>, decision.reason)`. `decision.reason` is typed as the closed union `"NOT_A_FACILITATOR" | "FACILITATOR_IS_TEAM_MEMBER"` (helper line 95), set only server-side from the grant/membership lookup (helper lines 112-124). No request header, query or body reaches it. The negative test (spurious `x-denial-reason` header, `?reason=&code=` query) pins this.
2. **No new distinguishable denial: PASS.** Still exactly two bodies. `code` is a one-to-one relabel of the message bit already disclosed. EM denials, non-members and non-facilitators all stay `NOT_A_FACILITATOR` (the new EM-membership-role case maps to `FACILITATOR_IS_TEAM_MEMBER` only because the caller is a facilitator and a member, which is the caller's own state). No admin or EM code. The 200 admin path is untouched and tested to carry no `code`/`error`.
3. **Authorize-before-lookup, ordering, floor, fail-open unchanged: PASS.** Diff touches nothing before `.send(...)`. Order remains canonical-UUID 404, authorization, audit insert, event, floor, send. The envelope is built after the floor, as I assumed. The existing call-order test (insert, event, floor, send), the "floor is a minimum measured from handler entry" timing test, the "throwing floor is still 500" test and the fail-open tests (rejected insert, timeout) are all retained and still run for both reasons (they use `CASES`, which gained one row). Not all of these were re-run by me; I reviewed the diff only. The integration test adds the participant-existing-vs-nonexistent-team equality including `code`, which pins authorize-before-lookup against the real DB (skipped if infra is down; see N2).
4. **Audit row unchanged: PASS.** `insertTopic002DenialAuditRow` and `emitAuditEvent` calls are byte-identical in the diff; `metadata.reason` is the same `decision.reason`. A new test asserts `error.code === auditInsertMetadata(...).reason` for each case, so the response and the row cannot drift.
5. **Contract text carries my escalation rule (S3): PASS.** "No code may distinguish an engineering-manager or application-admin denial without Security review" sits beside the "Clients MUST NOT use `error.code` to grant, unlock or hide an access decision" sentence. S2 is also done: "`error.correlationId` ... is not currently recorded in the audit row or the event, so it is not searchable." The `403` trigger rows state EM is covered by `NOT_A_FACILITATOR`. The old "reason names are internal labels, not envelope fields" sentence is correctly removed (it would now be false).
6. **Tests truly pin these: PASS.** S4 done: the exactly-two-bodies/two-codes test fails with a message directing the reader to Security review. The fixture is hand-edited (not regenerated), with a `_comment` saying why; independent of the handler, so the byte-equality assertions are not circular. Fail-open/timeout tests assert both the code and fixture equality.

## Non-blocking observations

- **N1.** The `it.each([["rejected insert", ...]])` with a single entry is a vestigial parametrisation; harmless. Cosmetic.
- **N2.** The authorize-before-lookup guarantee is pinned by a `describe.skipIf(!infraUp)` integration test. If CI does not run with Postgres, that property rests on the unit tests alone. Please confirm CI runs the integration suite; otherwise the unit-level order tests are the only pin.
- Carried from the design review, still open and not for this change: S1 (rationale for fail-open and alerting on `rowWritten: false` as a compensating control, in design/follow-ups), S5 (confirm timing coverage; covered by the retained floor tests above), and filing the TOPIC-001 admin-vs-nongrant message disclosure and the event-only correlation-id follow-up.

## Escalation triggers (re-checked against the diff)

New `decision.reason` value or EM/admin code: no. Audit `metadata` change: no. Fail-open/closed change: no. Client-side branching on `error.code` for access: none in the diff (backend and contract only). Ordering around the floor: unchanged.

Please inform me on merge.
