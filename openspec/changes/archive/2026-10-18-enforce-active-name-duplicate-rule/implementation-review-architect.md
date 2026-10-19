# Implementation review: Solution Architect (Ingrid Sollenberger)

Change: enforce-active-name-duplicate-rule (#299). Reviewed against design.md by reading the uncommitted diff. I did not run the test suites or the type-checker; verdicts on behaviour below come from reading the code and test files.

## Verdict

Approve. The implementation matches the design on every boundary I was asked to check. The findings are minor, and none blocks merge.

## Claims verified

| Claim | Result | Evidence |
|---|---|---|
| Bulk restore handler has an empty diff | Confirmed | The `topics.ts` diff has hunks only at the import, the new `sendTopicNameActive` helper, the Add handler and the single-restore handler. The `restore-defaults` handler (~1799+) is untouched, and so is `planDefaultRestore`. Only bulk test files and the frontend `skippedLine` copy changed (see S2 below). |
| In-lock check order, Add | Confirmed | After `BEGIN` and `lockTeamTopics`, the active-topic SELECT and `findActiveNameConflict` run before the `MAX(display_order)` read. The 422 validation runs before the lock, so an empty name never reaches the rule. |
| In-lock check order, single restore | Confirmed | The order is `lockTeamTopics`, then a re-read of the target, then 422 `TOPIC_ALREADY_ACTIVE` if the row is missing or not archived, then the active-name check and 409, then MAX+1 and UPDATE. The pre-lock 403/404/409-locked/404/422 cascade is unchanged, so a locked team can never receive `TOPIC_NAME_ACTIVE` (R5). The zero-row UPDATE fallback is kept, as D3 specifies. |
| Handled-exit Add 409 | Confirmed | The 409 does one `ROLLBACK`, then `applyTimingFloor`, then `return`. It sits inside the `try`, before the outer `topicId/createdAt/displayOrder` assignments. It is not throw-and-catch, so there is no double ROLLBACK. `finally` still releases the client. |
| No audit row | Confirmed | Neither 409 path inserts into `audit_log` or calls `emitAuditEvent`. No new operation exists, so the #271 reader inventory is untouched. The Add 201 audit INSERT is only reached after the conflict return. |
| No names in logs | Confirmed | No `request.log` call was added in either new block. |
| Cache-Control: no-store | Confirmed | `sendTopicNameActive` sets it, and both handlers use that one helper, so the reply shape is identical for every role (D5a). |
| One finder, no SQL `lower()` | Confirmed | Matching is done in JS with `findActiveNameConflict` (displayOrder ascending, then id ascending). The frontend hint calls the same shared function. |
| Advisory lock covers all writers | Confirmed | `lockTeamTopics` is taken by Add (~1089), Remove (~1461), single restore (~1680) and bulk restore (~1868). |

## Boundaries and consistency

- **Shared package.** New symbols are added as explicit named exports in `shared/src/index.ts`, as D1 requires. The `TopicConflictError` discriminated union is an additive export. The frontend branches on it with a `never` default in Add. `planDefaultRestore` is not forced through the finder, matching D1, and `TOPIC_NAME_PARITY_PAIRS` guards the drift.
- **Error envelope.** `buildErrorEnvelope` gains an optional 5th `extra` parameter, spread before the base keys, so it cannot overwrite `category`, `code`, `message` or `correlationId`. Callers that omit `extra` are unchanged. `ErrorEnvelope.error` is widened with two optional named string fields rather than an index signature. That is stricter than D4 describes and acceptable.
- **Frontend.** The page never branches on a bare 409. A client-owned message is used for restore (the server text is not shown). The active-name block clears only on a Name edit. Submit's disabled reason is the interlock reason first, then the name-block reason (D7). `assignBlockedReason` was correctly narrowed to interlocks only, so a name block cannot disable Assign. The restore-row error renders outside the confirm dialog, so it stays visible. The archive success path resets only an error state.
- **Docs.** HLA 8.1.1 (i) and 8.2 carry the D5a threat-model line, as the design asked.

## Findings (non-blocking)

- **S1 (nit).** `topics.ts` now has two separate `import ... from "@dipstick/shared"` statements. Merge them into the existing import.
- **S2 (informational).** `skippedLine` in `bulkRestoreCopy.ts` changed its NAME_ACTIVE wording to the shared phrase. This is a copy-only change that serves D7's shared-phrase goal, and it does not alter bulk behaviour. The "bulk handler empty diff" claim holds for the backend only. Say so explicitly in the PR description.
- **S3 (informational).** The archive-success reset of `restoreState` runs after `await finishAfterTopicWrite(...)`. A failed refetch therefore briefly leaves the stale restore message in place. The window is harmless.
- **S4 (observation).** An unknown or unparsable 409 on Add still falls to `refetchThenOfferRetry`, as it did before. That fallthrough is limited to genuinely unknown codes, so the design's concern about bare-409 branching is satisfied.
- **S5 (deferral, already recorded in the design).** The Add thrown-path timing gap (#305) is untouched. The floor is asserted as "called", not measured, so the extra in-lock SELECT staying under the floor is unverified.

No unguarded writer was found beyond the admin and seed paths D8 lists. The blank-name (`""` vs `""`) parity pair is present.
