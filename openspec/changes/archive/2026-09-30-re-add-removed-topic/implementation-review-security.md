# Implementation Security Review: re-add-removed-topic (TOPIC-005)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** Implementation-time follow-up to `design-review-security.md`'s single flagged check. Verified directly against shipped code (`git diff main`), not against the implementation summary.

**Verdict:** No blocking findings. The implementation-time check I flagged at design review closes clean.

---

## 1. Authorization — shared function, not re-derived (the flagged check)

`checkRestoreTopicAuthorization` (`topics.ts:414-433`) calls `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)` (`standing-facilitator-access-helper.ts:91`) directly — the same decision-only function TOPIC-002/TOPIC-004 already call, imported at the top of the file alongside `evaluateStandingFacilitatorAccess`. It is not re-derived inline. I read the shared function itself: it admits `application_admin` unconditionally (`standing-facilitator-access-helper.ts:103-105`) before the facilitator/membership check runs, which is the exact branch the original contract draft was missing. The wrapper adds only its own 403 message text and `applyTimingFloor` call on the rejection branch, matching the established pattern (`checkArchiveTopicAuthorization` does the same for TOPIC-004).

**Test coverage confirms the admin branch is exercised**, not just present in the helper: `restore-topic-integration.test.ts:469`, "an application_admin can restore a topic for a team they are an active member of" — this is the specific case the original contract gap would have rejected.

## 2. Lock denial returns 409, not 403 (the second half of the flagged check)

The restore handler calls `checkCustomizationLockGate` unmodified (`topics.ts:501-513`) — I diffed this function and confirmed zero changes to its body; only a new call site was added. That function sends `.code(409)` with `TOPIC_CUSTOMIZATION_LOCKED` (`topics.ts:237-239`). Unit test confirms this at the call site: `topics.test.ts:1532-1545`, "a locked team's rejection (409) takes priority over an already-active topic's state," asserts `res.statusCode` is `409` and `error.code` is `TOPIC_CUSTOMIZATION_LOCKED`. No fresh 403 branch was written for this endpoint. Both halves of the design-review flag are closed.

## 3. `restored_by`/`restored_at` — server-set only, no forgery path

The route signature takes only `Params: { teamId, topicId }` — no `Body` type, no request body read anywhere in the handler. The UPDATE sets `restored_at = now()` (DB clock) and `restored_by = $2` bound to `session.userId` (`topics.ts:903-910`), which comes from `request.session`, not from any client-suppliable field. Same pattern as `archived_by`/`archived_at` on the archive path, already reviewed and shipped. The response DTO (`RestoreTopicResponse`, `packages/shared/src/types/topic.ts`) only echoes `restoredAt` back from the DB `RETURNING` clause — there is no round-trip path where a client value could influence what gets written.

## 4. Cross-team scoping (IDOR) — double-scoped in both pre-check and write

`checkTopicExistsAndArchived` scopes `WHERE id = $1 AND team_id = $2` (`topics.ts:441`), and the transactional UPDATE independently repeats `WHERE id = $topicId AND team_id = $teamId AND status = 'archived'` (`topics.ts:907`). A caller cannot supply a `topicId` belonging to a different team than the URL's `teamId` and have either the pre-check or the write resolve — both require the same row to match on both columns, closing the TOCTOU gap between pre-check and write the same way TOPIC-004 already does. This matches what the design review verified would be inherited, and it's inherited correctly.

## 5. Audit event — same transaction, correct actor attribution

The `topic.restored` `INSERT INTO audit_log` (`topics.ts:930-943`) runs on the same `client` inside the same `BEGIN`/`COMMIT` as the topics `UPDATE` — not a separate connection, not best-effort-after-commit. `actor_user_id` is `session.userId`, `actor_global_role` is `authResult.actorGlobalRole` (the value returned by the shared authorization decision, not re-derived or client-supplied), `actor_ip` is `request.ip`. If the transaction fails, the catch block rolls back before rethrowing (`topics.ts:965-969`), so a failed restore cannot produce an orphaned audit row, and a rejected zero-rows race explicitly rolls back before responding without writing an audit row (`topics.ts:917-928`) — confirmed by `topics.test.ts:1683`, "no topic.restored audit row is written when rejected by the zero-rows race (422)."

`audit-logger.ts`'s only change is the additive `"topic.restored"` union member with no schema migration required (`audit_log.operation` is unconstrained `TEXT`) — same low-risk shape as `topic.archived`'s original addition.

## Non-blocking note (not new, carried forward from design review)

`content.ts`'s archived-topics read (TOPIC-002 extension) now joins `restored_by`/`restored_at` onto every archived-status row. Per `design.md` Decision 4, these columns are never cleared on re-archive, so a topic that was restored and then re-archived will show a stale `restoredAt`/`restoredBy` from its prior restore cycle alongside its current `archivedAt`/`archivedBy`. This is a named, accepted product limitation in the design (not a gap introduced silently during implementation) and carries no security exposure — the data shown is the same class of internal-user provenance already reviewed for `archivedBy`, just possibly stale. Noting it here only so it's traceable from the implementation review too, not raising it as a finding.

## Summary for the team

Both halves of the design review's implementation-time flag are verified directly against source: the restore handler calls the shared, already-corrected `checkStandingFacilitatorOrAdminAuthorization` (admits `application_admin`, no re-derived inline check), and the customization-lock denial returns 409 via the unmodified shared `checkCustomizationLockGate` (no fresh 403 branch reintroducing the original contract miscategorization). Provenance columns are server-set only with no client-forgery path. Cross-team scoping is double-enforced (pre-check and transactional write) closing the IDOR angle. The `topic.restored` audit event is written in the same transaction as the state change with correct, non-client-supplied actor attribution, and is correctly skipped on rollback paths. No blocking findings.
