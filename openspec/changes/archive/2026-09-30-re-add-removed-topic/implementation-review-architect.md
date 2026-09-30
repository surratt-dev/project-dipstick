# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `re-add-removed-topic`
**Scope of this review:** verification of the shipped implementation against `design.md`'s stated decisions, by reading the actual diffs against `main` and the actual source — not the executor's self-report.

## Verdict

**Approved.** The implementation matches every architectural decision in `design.md` that was in scope for this review. No boundary violations, no re-derived logic where a shared function should have been reused, and the scope split (trend-gap signal deferred) held. This is a clean instance of the pattern this codebase is establishing: correct a contract gap once, in a shared function, and have every subsequent caller inherit the fix rather than re-deriving it.

## Verification findings

**1. TOCTOU race branch (Decision 3) — confirmed implemented, not just tested.**
`packages/backend/src/routes/topics.ts`, the `restore` handler: the `UPDATE ... WHERE status = 'archived' RETURNING name, restored_at` runs inside the advisory-lock-held transaction, and a zero-row result explicitly `ROLLBACK`s, applies `applyTimingFloor`, and returns `422 TOPIC_ALREADY_ACTIVE` — the handler does not fall through to a success path or throw on an empty `RETURNING`. Matches Decision 3's SQL block and the stated mirroring of the existing `TOPIC_ALREADY_ARCHIVED` branch.

**2. Advisory lock (Decision 3) — confirmed used.**
`SELECT pg_advisory_xact_lock(hashtext($1::text))` is the first statement after `BEGIN`, before the `MAX(display_order)` read, using `teamId` as the key — same lock namespace TOPIC-003/004 already take, as designed (cross-endpoint serialization is intentional, per Decision 3's "why the lock namespace is shared" note).

**3. `checkStandingFacilitatorOrAdminAuthorization` reuse — confirmed, not re-derived.**
`checkRestoreTopicAuthorization` (the new wrapper) calls the shared, decision-only `checkStandingFacilitatorOrAdminAuthorization(userId, teamId)` directly and only adds the reply/timing-floor plumbing Decision 1 assigns to each caller. The lock check in the handler calls the existing `checkCustomizationLockGate` unchanged — no new inline `403` branch reintroducing the contract's original fold-the-lock-into-403 mistake. This was the specific item the Security Analyst flagged as unverifiable until code existed (design.md Decision 1, "Implementation-time verification" note, tasks.md Task 8.6); it now checks out against the running code.

**4. Frontend restore flow and provenance line (Decision 5) — confirmed matches intended placement.**
`TopicManagementPage.tsx`: `RestoreTopicState` is a single-step `idle → confirming → submitting → error` union with no escalation branch, consistent with "restoring only ever increases the active count." Dialog copy matches Decision 5's specified text exactly, including the deliberate omission of the trend-gap clause. The `restoredAt`/`restoredBy` provenance line renders as a second line directly below the existing `archivedAt`/`archivedBy` line, only when present — matching Decision 4/tasks.md Task 6.1b's placement.

**5. Scope split — confirmed held.**
`git diff --stat main` against `packages/backend/src/routes/em-views.ts`, `packages/shared/src/types/em-views.ts`, and `packages/frontend/src/pages/EmTrendDataPage.tsx` is empty. No trend-view files were touched, consistent with the Scope Correction note and tasks.md Task 8.5.

**6. Tests exercise what they claim.**
`restore-topic-integration.test.ts`'s same-topic concurrent-restore test runs against real Postgres (`describe.skipIf(!dbUp)`), fires two `app.inject` calls via `Promise.all` against the same archived topic, asserts the sorted status pair is exactly `[200, 422]`, asserts the rejected response's reason code is `TOPIC_ALREADY_ACTIVE`, and queries `audit_log` to assert exactly one `topic.restored` row. This is a real concurrency test against a real transaction boundary, not a mocked stand-in. The unit-level cascade-ordering tests in `topics.test.ts` (e.g., "a locked team's rejection (409) takes priority over an already-active topic's state") independently confirm Decision 2's check ordering.

## Architectural notes (non-blocking)

- Provenance columns (`restored_by`/`restored_at`) and the migration are additive and nullable with no backfill, consistent with this codebase's established migration discipline (migration 16 precedent). No concerns.
- The shared advisory-lock namespace (`hashtext(teamId)`) now has three callers (TOPIC-003, TOPIC-004, TOPIC-005) all serializing against the same team-scoped key. This is documented as intentional in Decision 3 and is the correct call — I'd flag it if a fourth or fifth write path to `topics` started appearing without reusing this same lock, but that's a future-review concern, not one for this change.
- The single-event-name-per-transition audit convention (`topic.restored` distinct from `topic.archived`) continues to scale cleanly; no drift observed.

No findings require changes before this ships.
