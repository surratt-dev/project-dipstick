# BA Review — `remove-topic` Tasks

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewed:** `tasks.md` against `proposal.md`, `design.md` (revised), and my own prior reviews of exploration notes (`explore-review-ba.md`) and the proposal (`propose-review-ba.md`).

**Overall:** Tasks.md is a faithful translation of design.md — I did not find a capability named in the proposal that tasks.md drops, softens, or leaves implicit. Every specific finding from my two earlier reviews that design.md says it addressed is actually present in tasks.md, worded clearly enough that an implementer wouldn't need to re-derive intent from the design doc. No blocking findings this pass.

---

## Coverage check: proposal capabilities against tasks.md sections

| Proposal capability | Tasks.md coverage |
|---|---|
| `DELETE .../topics/:topicId` (TOPIC-004) — cascade, audit | Sections 3–6 |
| Last-active-topic hard `409` block | Section 4 |
| `facilitator-sessions.ts` begin-voting crash fix | Section 8 |
| Escalating confirmation flow (retention notice → open-action-item warning) | Sections 5, 9.3 |
| TOPIC-002 authorization correction | Section 7 |
| Facilitator-visible provenance (`archivedBy`) | Tasks 1.1, 6.1, 7.3, 7.5, 9.5 |
| New Topic Management screen + nav entry point | Section 9 |
| Requirements-doc corrections | Section 10 |
| Verification / non-regression | Section 11 |

Nothing in "What Changes" or "Impact" is missing a corresponding task. Two decisions correctly produce **no** task by design, and I checked that the absence is deliberate rather than dropped:

- **Decision 6's disclosure-boundary reasoning** (why `archivedBy` surfacing a facilitator's identity org-wide is an accepted, considered choice) needs no task — it's a documented rationale, not a code or doc change beyond what Tasks 6.1/7.3 already implement.
- **Decision 7's reason for not auditing `TOPIC_LAST_ACTIVE` denials** needs no task either — the absence of an audit write *is* the implementation, and Task 6.3 actually tests for that absence ("no such row is written when the request is rejected at any check... or last-active-topic guard"), which is the right way to make a "we decided not to do X" decision verifiable rather than just asserted.

---

## Verification of my specific prior findings

### 1. Admin-auth fix for TOPIC-004 (my propose-review-ba.md Finding 1, BLOCKING) — landed correctly

Task 3.1 explicitly instructs: "Do **not** reuse `checkStandingFacilitatorAuthorization`... verbatim — it is facilitator-only with no `application_admin` branch, which would violate FR-8.2 [HARD]," and requires the new decision-only `checkStandingFacilitatorOrAdminAuthorization` instead. Task 3.6 tests the specific scenario my finding was about — an `application_admin` succeeds "for any team, **including one they are an active member of**" — which is the exact detail that closes the gap: admin access isn't just added, it's added without inheriting the `FACILITATOR_IS_TEAM_MEMBER` restriction that would otherwise make no sense for an admin acting outside the standing-facilitator model.

I also asked, as part of that finding, that the team make an explicit call on whether TOPIC-003's identical gap gets fixed in the same pass or deliberately deferred on the record. It's deferred, stated in design.md's Non-Goals with reasoning, and now carries its own tracked-follow-up-issue task (11.6, see below) — a more complete resolution than my original ask required.

### 2. Use-case-doc corrections — both landed

- **Line 241 in-progress-session note** (my "Minor" finding, propose-review-ba.md): Task 10.6 resolves it directly — "resolve the 'Notes' section's line 241 ('Removal does not affect in-progress sessions... This edge case may need a decision.')... replace the open-question framing with the resolved behavior." Correct and complete; it also folds in the last-topic note correction (line 211/240) in the same task, which is the same edit-pass economy I asked for.
- **AC line for `archivedBy` provenance** (Finding 3): Task 10.7 adds an Acceptance Criteria line to the "Remove a Topic" use case (or "Re-Add," whichever reads more naturally) "stating that archived topics show who archived them and when," with the stated purpose of giving "FR-8's requirements documentation a traceable home for the provenance requirement, which otherwise exists only in a design doc's 'Why' paragraph." That's precisely the traceability gap I flagged — provenance shouldn't live only in a design decision's rationale.

### 3. Tracked-follow-up-issue task for `session_topics` — landed, and strengthened

Task 11.5 files a tracked GitHub issue for the `session_topics` snapshot-at-creation gap, explicitly noting it's "total and pre-existing, not scoped to this change's trigger condition (confirmed independently by Marcus Delgado's BA review and escalated by Rachel Okonkwo's executive review)" and stating the issue must be filed "before this change is considered done — not left to be rediscovered." That matches both asks from my Finding 2 (propose-review-ba.md): the severity is no longer buried in an Open Question, and the follow-up issue is now an actual task with a completion gate, not a suggestion.

### 4. New TOPIC-002 timing-floor task — present and clear

Task 7.2 is unambiguous: `applyTimingFloor(startTime)` must be called "immediately before sending `403`, on both `NOT_A_FACILITATOR` and `FACILITATOR_IS_TEAM_MEMBER`," and — notably — it pre-empts the obvious failure mode: "Do not rely on Task 11.2's verification pass to be the only place this is checked — it is a required implementation step of this task, not just a checklist line." That's a task written by someone who's seen a timing-floor requirement get treated as a checklist afterthought before. Good.

### 5. New TOPIC-003 FR-8.2 follow-up-issue task (11.6) — present and clear

Task 11.6 files a tracked issue for TOPIC-003's identical FR-8.2 gap, attributed to the security review (Finding 5, informational) and explicitly given "the same tracked-issue discipline" as 11.5, with the same before-this-change-is-done gate. This closes the loop on my original Finding 1 ask — TOPIC-004 is fixed, and TOPIC-003's matching gap is no longer just named in a Non-Goals paragraph, it has an owner-independent record.

---

## Minor observations (non-blocking)

- Task 3.6 and Task 7.4 test the identical four identity/role scenarios for TOPIC-004 and TOPIC-002 respectively — good, since both endpoints share the same authorization function and a divergence between their test coverage would be an easy thing to miss later.
- Task 6.3's negative assertion ("no such row is written when... rejected at any check... **or when it returns `requiresConfirmation` without confirming**") correctly captures that the `200 requiresConfirmation` response is not itself an audited event — only the eventual archive is. Worth calling out because it would be an easy scenario to mis-test as "should audit the warning too."
- Task 5.5's staleness scenario ("an item resolved between the first... and second... request does not block or alter the successful archive") is the concrete test-level expression of Decision 5's server-re-derivation requirement — good, this is exactly the kind of scenario that would otherwise only exist as prose in a design doc.

## What I did not find

No task list gap, no requirement translated ambiguously, no capability from the proposal without a home in tasks.md. I have nothing further to raise against this document.

## Summary for sign-off

All four items I was asked to specifically verify are present and correctly worded: the TOPIC-004 admin-auth fix (Task 3.1/3.6), both use-case-doc corrections (Tasks 10.6, 10.7), and the `session_topics` follow-up-issue task (11.5). The two new items from this design revision — the TOPIC-002 timing-floor task (7.2) and the TOPIC-003 FR-8.2 follow-up-issue task (11.6) — are both present and unambiguous. No blocking findings. Tasks.md is ready to build from.
