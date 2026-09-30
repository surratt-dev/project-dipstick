# BA Review — tasks.md (Re-Add a Previously Removed Topic, #54)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewed:** `tasks.md` against the revised `proposal.md` (with its "Scope Decision" and "Known Limitations" sections), `design.md`, `specs/restore-topic`, `specs/topic-customization-lock`, `specs/topic-management-screen`, `propose-review-ba.md`, and the "Re-Add a Previously Removed Topic" use case in `requirements/use cases/08 - Topic Management - Use Cases.md`.

## Summary

tasks.md covers the revised proposal's full capability set, with nothing lost in translation. I verified the three things I was specifically asked to check, plus did a full pass for coverage gaps and scope leakage. No blocking findings.

## Scope-split verification: trend-gap / manager-team-association fully removed

Confirmed. The only appearances of "trend-gap" language in tasks.md (Task 6.3, 7.1b, 7.5, 7.8, 8.5) are all deferral/exclusion statements — removing a promise from dialog copy, striking a stale contract sentence, updating use-case wording to point at a future change, recommending an issue be filed, and an explicit verification step confirming `em-views.ts`/`EmTrendDataPage.tsx`/`EmTopicTrend` are untouched. No task implements gap derivation, no task touches `manager-team-association`, and the `specs/` directory for this change no longer contains a `manager-team-association` delta at all (confirmed by directory listing — only `restore-topic`, `topic-management-screen`, `topic-customization-lock` remain, consistent with the proposal's Capabilities section). This is a clean split, not a partial one.

## Provenance work (`restored_by`/`restored_at`): fully covered

Task 1.1 (migration), 3.1/3.8 (set in the restore transaction, `archived_at`/`archived_by` left untouched), 5.1-5.4 (TOPIC-002 response exposes `restoredBy`/`restoredAt` via the same join pattern as `archivedBy`) trace directly to design.md Decision 4 and match the scenarios already written into `specs/restore-topic/spec.md` and `specs/topic-customization-lock/spec.md`. Nothing here is aspirational — the columns, join pattern, and audit pairing are all specified at the same level of concreteness the rest of this change uses.

## Requirements-doc corrections: complete, including the two items I was asked to verify by name

- **Task 7.1b** (striking the stale trend-gap sentence from `REST API Contract.md:852`) is present and correctly scoped — it calls out that this is the same signal being deferred per the Scope Decision, and that the contract shouldn't describe behavior this change doesn't build, in the same PR that's already touching this document for 7.1-7.3. Good catch keeping this bundled with the other contract corrections rather than left for a later cleanup pass.
- **Task 7.7** (acknowledging the reorder-after-reinstatement limitation) is present and matches proposal.md's "Known Limitations" framing precisely: it's stated as a pre-existing, feature-area-wide gap ("not a restore-specific gap"), not something this change is on the hook to close, and it traces to `propose-review-ba.md` Finding 3 by name.
- Also confirmed: **Task 7.4** correctly avoids the FR-8.6 mis-citation `propose-review-ba.md` Finding 1 flagged, citing design.md Decision 3's collision-avoidance reasoning instead — this was a real risk (the citation error originates in the contract itself and could have propagated silently into the use case doc), and the task text explicitly guards against it.
- Task 7.5 correctly handles all three places the use case currently promises trend-gap behavior (the second open Note, Main Flow step 5, and the Postconditions "Success" line) rather than just the Note, and correctly leaves the Dependencies section's Trend Dashboard reference in place since it still applies to the follow-up change.
- Task 7.6 adds the restore-provenance AC line design.md Decision 4 calls for, mirroring the pattern `remove-topic` already established for archive provenance.
- Task 7.8 (recommend, don't file) correctly stops short of assigning ownership, consistent with proposal.md's own statement that ownership isn't Devon's call to make.

## Other coverage checks

- Every check-ordering cascade step in design.md Decision 2 has a corresponding implementation task (2.1-2.5) and a corresponding test task (2.6-2.7).
- The advisory-lock/zero-rows race (design.md Decision 3) has three distinct concurrency tests (3.3-3.5), not just one — this matches the level of rigor `remove-topic` set for the analogous TOPIC-004 race.
- Audit posture (design.md Decision 6) is covered end-to-end: the write itself (4.1-4.2), a positive test (4.3), and a negative test confirming lock denials use the shared `topic.write_denied_locked` operation rather than a new variant (4.4).
- Section 8's verification tasks close the loop on both review findings that drove design decisions: 8.6 verifies the authorization function is actually wired (not re-derived) per the Security Analyst's design-review flag, and 8.5 verifies the trend-gap exclusion by absence-of-touch rather than by assertion alone.
- Finding 2 from `propose-review-ba.md` (the "included in the next session" AC has no spec-level scenario) doesn't need a new task — it's already resolved at the spec level in `specs/restore-topic/spec.md`'s "A restored topic is eligible for the next session's topic snapshot (blocked on #175...)" scenario, which predates this tasks.md revision. No gap here.

## Bottom line

No missing capabilities, no scope leakage, no unresolved citation errors carried into the tasks. This is buildable as written.
