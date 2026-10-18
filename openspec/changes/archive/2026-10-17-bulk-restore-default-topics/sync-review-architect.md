# Sync review (Architect): bulk-restore-default-topics

Reviewer: Ingrid Sollenberger, Solution Architect. Scope: synced specs (bulk-restore-default-topics, audit-logging-operations, restore-topic, topic-write-rate-limiting, topic-management-screen), docs/deployment.md, BRD FR-8.6 note, use case 08, against the working tree.

## Verdict
No material drift. Cascade order, authorization delegation, one-UPDATE/one-audit-row transaction, ROLLBACK on empty, floor on every exit including the thrown path, Cache-Control, audit metadata shape (ids and positions, skipped cap 100, true counts, no correlation_id key), limiter ordering (after role, before team lookup), response shape and orderings, planner semantics, and all literal frontend copy match the spec text. TIMING_FLOOR_MS is still the 150 ms placeholder with TODO-GROUP6 and the production guard; the spec states this and tasks 4.12/4.14 are still open, so it is accurately recorded.

## Fixed directly (spec/doc only)
1. topic-management-screen, empty-state requirement: the code keeps the "Show archived topics (n)" action next to the primary Restore and secondary Assign actions (`unlocked_restorable`), which the spec did not say. Added that sentence and clarified the no-restorable case.

## Needs a code change (not made; LOW)
1. `base` computation in `packages/backend/src/routes/topics.ts` (bulk handler) uses `reduce(max, 0)` over active display_order, while the spec (and single restore, `COALESCE(MAX(display_order), 0) + 1`) uses `COALESCE(MAX, 0)`. They differ only if every active topic has a negative display_order (Add starts at 0, so this is legacy-data only). It would make "bulk equals sequential single restores for any starting state" false in that corner. Fix: compute base as the SQL MAX with COALESCE 0 (or null-aware JS), or narrow the spec claim. Recommend the code fix; risk is negligible either way.

## Observations, no action
- Task 4.1 evidence notes the byte-identical comparison of the bulk 404 to assign-defaults (admin) and zero-SQL for all four caller classes are not tested; the spec scenarios assert them. The code path is the shared helpers, so I expect them to hold, but they are unproven by tests.
- Spec says the thrown path applies the floor; errors thrown before the try block (for example `db.connect()` failure) skip the floor. Accepted edge, spec wording ("after rollback") is consistent with the code, but a reader could take it as universal.
- Frontend falls back to `displayOrder ?? 0` for archived rows lacking the field; harmless, relevant only to stale/mismatched backend versions.
- docs/deployment.md, BRD FR-8.6 traceability note and use case 08 are consistent with code and specs (audit operation names, metadata, union-query guidance, assign-defaults still available on unlocked empty teams).
- Still blocked for production: floor measurement (4.14) with a named owner, per the existing TODO-GROUP6.
