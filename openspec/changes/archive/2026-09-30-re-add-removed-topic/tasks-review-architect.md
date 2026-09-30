# Architecture Review — tasks.md (`re-add-removed-topic`)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Task ordering vs. architectural dependencies; internal consistency of the renumbering from the last revision (design.md's 8-section tasks.md, post trend-gap-section removal).

## Summary

The overall section ordering is sound: schema (1) precedes the transaction that writes the new columns (3); the endpoint's checks (2) precede the transaction that completes the handler (3); the transaction (3) precedes the read-side response fields that expose its output (5); the backend endpoint (2-4) precedes the frontend that calls it (6); everything precedes verification (8). Decision-number and section citations were spot-checked against design.md and proposal.md and are internally consistent — no dangling references to the removed trend-gap decision (formerly "Decision 6" pre-scope-correction) or to a ninth section. `design.md` tops out at Decision 6 and nothing in tasks.md cites higher; every trend-gap mention in tasks.md correctly frames it as deferred, not as a task in this set.

Two findings, one on sequencing and one on a missing task that a later documentation task presupposes.

## Finding 1 — Task 2.7 tests a success path that doesn't exist until Section 3 (sequencing)

Task 2.7 (Section 2, "checks and cascade") bundles four assertions:
- a standing facilitator not on the team **succeeds**
- an `application_admin` **succeeds** for any team
- a non-facilitator/non-admin is rejected `403 NOT_A_FACILITATOR`
- a facilitator who's an active team member is rejected `403 FACILITATOR_IS_TEAM_MEMBER`

The two rejection assertions only require Task 2.1's authorization check to exist — correctly placed in Section 2. The two "succeeds" assertions require a `200` response, which only exists once Section 3's transaction (Task 3.1: advisory lock, reposition, status flip, `RETURNING restored_at`) is implemented. As written, Task 2.7 cannot be completed — in the sense of writing a test that can actually pass — until Section 3 exists, even though it's sequenced inside Section 2.

This maps cleanly onto `specs/restore-topic/spec.md`'s own structure: the "succeeds" scenarios live under the first Requirement ("A standing facilitator or an application administrator can restore an archived topic on an unlocked team," lines 11-36 — full end-to-end behavior), while the rejection scenarios live under the second Requirement ("...evaluates checks in a fixed order," lines 38-65 — cascade behavior only). Task 2.7 pulls a scenario from the first Requirement into a Section 2 task, misaligning the task split from the spec's own split.

**Recommendation:** Split Task 2.7. Keep the two `403` rejection assertions in Section 2 (they test the cascade, not the transaction). Move the two "succeeds" assertions to Section 3, alongside Tasks 3.6-3.8 (which already test other post-transaction success properties). This also makes Task 2.7 a strictly cheaper task to pick up mid-stream — right now, whoever picks it up first must either stub the transaction or leave two of its four assertions unrunnable.

## Finding 2 — Task 7.6 documents a frontend capability that Section 6 never builds

Task 7.6 asks to add an acceptance-criteria line stating "the archived-topics view shows who restored a topic and when." That's describing the `restoredBy`/`restoredAt` fields Task 5.1 adds to `GetAllTopicsResponse.archived[]` — populated for an archived topic that was previously restored and later re-archived (Task 5.3 tests exactly this case).

I checked `packages/frontend/src/pages/TopicManagementPage.tsx` — the existing archived-row rendering is explicit, not generic:

```
414:  Archived {new Date(topic.archivedAt).toLocaleString()}
415:  {topic.archivedBy ? ` by ${topic.archivedBy.displayName}` : ""}
```

There's no field-agnostic provenance renderer here; `archivedAt`/`archivedBy` are named directly in JSX. Section 6 ("Frontend — Restore action on the Topic Management screen") only covers the Restore button, the confirmation-dialog state, and their tests (Tasks 6.1-6.6). Nothing in Section 6 (or anywhere else in tasks.md) adds the equivalent `restoredAt`/`restoredBy` line to the archived row. As written, Task 7.6 would ship a requirements-doc acceptance criterion the shipped UI doesn't satisfy.

**Recommendation:** Add a task to Section 6 — e.g., 6.1b, ordered after 6.1 and after Section 5 (already correctly positioned ahead of Section 6) — to render `restoredAt`/`restoredBy` on an archived row when present, mirroring the `archivedAt`/`archivedBy` pattern at lines 414-415, plus a component test confirming it's absent (no second line) when a topic has never been restored. Task 7.6 should depend on that new task, not on Section 5 alone.

## Non-findings (checked, no issue)

- Migration (1) → transaction (3): correctly ordered; Task 3.1's `UPDATE` writes `restored_at`/`restored_by`, which don't exist before Task 1.1.
- Section 4's explicit bundling note (Tasks 3.1/4.1/4.2 as one atomic unit) is a deliberate, precedented exception (cites `remove-topic` Tasks 5.3/6.1/6.2) — not an ordering defect, correctly called out rather than left implicit.
- Decision citations (1 through 6) all resolve to decisions that exist in the current design.md; no citation exceeds 6, matching the post-scope-correction renumbering.
- Task 7.4's explicit instruction not to cite FR-8.6 matches design.md Decision 3's own "Alternatives considered" correction — consistent, not a leftover.
- Task 8.6's verification step correctly references Tasks 2.1/2.2, which exist as written.
- No stray references to the removed trend-gap section/decision; every trend mention in tasks.md is about the deferral itself (7.1b, 7.5, 7.8, 8.5), not a task built in this change.
