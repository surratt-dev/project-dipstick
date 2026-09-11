# Architecture Review — `websocket-specification` tasks.md

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Task ordering and dependency correctness against `design.md` (as amended in the prior design stage — D2's publish-time `serverTimestamp` fix and the skew-measurement-gap accountability items are treated as settled) and `proposal.md`.

**Verdict:** Approve with required changes. No task assumes a mechanism that contradicts the design, and the two archiving gates (6.4/6.5) are correctly built so they don't block spec publication. But one sequencing dependency is backwards from what the content actually requires, one review-gate obligation from `design.md` never became a checklist item, and one task makes a forward-reference to a path this task list never actually creates. All three are fixable without restructuring the document.

---

## Finding 1 (High) — Task 1.3's gate on Task 2 is misdirected; it should gate Task 3, not Task 2

Task 1.3 reads: *"if a contradiction is found, amend `design.md`'s Decisions section and this change's spec delta before proceeding to task 2."*

Task 1 checks whether this change's "does not cover" boundary contradicts the stated non-goals of five already-shipped specs (`session-topic-lifecycle`, `websocket-session-authorization`, `websocket-connection-reauthorization`, `websocket-staleness-signal`, `vote-compose-recovery`). Nothing in that boundary check touches the content of Task 2 (adding `serverTimestamp` to `VoteRevealedTriggerPayload`, stamping it at publish time in the reveal endpoint, forwarding it unmodified through `dispatchVoteRevealed`). A contradiction found in Task 1 would require amending `design.md`'s Decisions section and the spec delta — i.e., it's a risk to Task 3 (the document that states the boundary), not to Task 2 (a code change whose correctness doesn't depend on how the non-goals boundary is worded).

Gating Task 2 on Task 1 delays a fix the proposal itself frames as urgent ("I'm not willing to let it sit open indefinitely once named") behind a documentation cross-check it has no real dependency on. This is exactly the kind of implicit, undeliberate sequencing decision I'd otherwise flag as made by default rather than on purpose — the two are independent workstreams and should be allowed to run in parallel.

**Recommendation:** Change 1.3's gate to read "before proceeding to task 3" (spec finalization), not task 2. Task 2 (code) and Task 1 (boundary cross-check) should proceed independently/in parallel. This mirrors the precedent your own process already set: the archived `session-lifecycle-transitions` tasks.md carries an explicit architect-review sequencing note — *"6.1–6.3 correct contract text that design.md has already fully determined and carry no code dependency... they may proceed in parallel with Groups 1–4, not after them"* — for exactly this situation. Add an equivalent note here.

---

## Finding 2 (High) — Task 2's mandatory review gates have no checklist teeth

Task 2's process note states this serverTimestamp change "MUST go through the same design-review (Full Stack Engineer + Security Analyst) and implementation-review gates as any other code change in this pipeline — riding inside a docs-titled change is not grounds for a lighter pass." That's the right call, and `design.md`'s Risks section restates it. But as written, it's a paragraph attached to a section header, not a task. There is no checklist item that a reviewer can check off, and nothing in Task 3 (publish) or Task 6 (sign-off) confirms those two review passes actually happened before the spec claims the field is shipped.

This is the same failure mode `design.md`'s D4 invariant #2 and Task 5.3/5.4 were explicitly built to close for the PREF-events and skew-measurement gaps: *"a `SHALL`-level requirement... should not carry a weaker accountability structure than a documentation gap... a stated intent... is not the same completion condition as [it] existing."* A process note with no corresponding checkbox is precisely the "naming paragraph alone" pattern this change elsewhere refuses to accept.

**Recommendation:** Add two explicit tasks under section 2 (e.g., 2.7, 2.8) — "Design-review sign-off obtained (Full Stack Engineer + Security Analyst) on 2.1/2.2" and "Implementation-review sign-off obtained on 2.1–2.6" — and make Task 3.1 (finalize spec.md) explicitly conditioned on both, the same way Task 6.4/6.5 are explicit conditions on archiving.

---

## Finding 3 (Medium) — Task 4.2 forward-references a path this task list never creates

Task 4.2 says: *"Check off `todo.md`'s 'WebSocket Specification' item and annotate it with a pointer to `openspec/specs/websocket-specification/spec.md`."*

I checked: `openspec/specs/websocket-specification/` does not exist. The spec Task 3.1 finalizes lives at `openspec/changes/websocket-specification/specs/websocket-specification/spec.md` — the delta-spec location — until this change is archived. Archiving is never a task in this list; it's only referenced obliquely, as the event Tasks 6.4/6.5 gate against. So Task 4.2, as sequenced (before Section 5, well before any archiving), points `todo.md` at a spec.md that won't exist yet when 4.2 executes.

This project already has a clean precedent for exactly this situation. The archived `session-lifecycle-transitions` tasks.md disambiguated a task that *documents* a correction from the task that *performs* it "at spec-sync time" (its task 6.5 vs. 7.3), and it carried a dedicated "Spec and Documentation Finalization" group whose first two tasks were the literal sync of delta-spec content into `openspec/specs/`. This tasks.md has no equivalent sync step at all — it's missing from the document, not merely unstated.

**Recommendation:** Either (a) add an explicit spec-sync task (mirroring the precedent's Group 7.1) that this change currently lacks, and have 4.2 depend on it, or (b) have 4.2 point at the change-directory path now and add a follow-up task, run at spec-sync/archive time, that updates the `todo.md` pointer to the final `openspec/specs/...` path — matching the documents-now/performs-later split the precedent already established. Don't leave it as a same-stage forward reference with no task closing the gap.

---

## Finding 4 (Low) — Task 4.2's stated precedent doesn't exist

Task 4.2 asks the implementer to match "the annotation style of other completed `todo.md` items." I read `requirements/todo.md` in full: it has exactly one entry under "Outstanding Documents" (the WebSocket Specification item itself, currently `[ ]`), and no other item in the file carries a completion checkbox or a pointer annotation to match. The precedent this task cites doesn't currently exist in the file.

This doesn't block anything — the implementer can still write a reasonable annotation — but it's worth removing the false premise so nobody goes looking for a pattern that isn't there. **Recommendation:** either state the intended annotation format directly (e.g., `[x]`, with a one-line pointer sentence) or drop the "matching the annotation style of..." clause.

---

## Findings on Sections 5/6 (the two accountability structures) — structurally sound, one coordination note

Per the specific ask: I checked whether 5.3/6.4 (PREF-event tracking issues) and 5.4/6.5 (skew-measurement tracking issue) are correctly structured and don't block each other or the main spec publication.

- **They don't block Task 3.** Both are sequenced after Section 3 (publish) and gate only Task 6's archiving, not publication — correctly matching `design.md`'s own intent that the spec ships first with placeholder "no follow-up issue exists" language (5.1) and gets the issue numbers backfilled later (5.3/5.4), with archiving as the hard stop (6.4/6.5), not publication.
- **They don't block each other.** Different owners (Marcus Delgado vs. Marcus Oyelaran), disjoint content, no shared precondition. Fine as parallel tracks.
- **One real coordination risk:** both 5.3 and 5.4 independently instruct their owner to edit the same two files — `spec.md` and `design.md` — once their respective issue is filed. Nothing sequences these edits relative to each other, and nothing says who reconciles if both land around the same time. Given this document's own D6 precedent for *why* scattered edits to the same target are worth consolidating ("a reader should be able to find the whole correction in one place"), I'd add a one-line coordination note to 5.3/5.4 (or to Section 6's preamble): confirm the other's edit isn't clobbered, or land them as two clearly separated diffs reviewed together.

No change needed to the gating logic itself — it's the right shape (named owner, filed issue, archiving as the enforcement point).

---

## Summary of Required Changes

1. Reword 1.3's gate to block Task 3, not Task 2; add a parallel-work note between Tasks 1 and 2.
2. Add explicit design-review and implementation-review sign-off tasks under Section 2, and condition Task 3.1 on them.
3. Add (or explicitly defer via a documented follow-up task) the missing spec-sync step that Task 4.2 currently assumes has already happened.
4. Drop or correct Task 4.2's false claim of an existing `todo.md` annotation precedent.
5. Add a one-line coordination note to Section 5 so 5.3 and 5.4's edits to `spec.md`/`design.md` don't collide.

None of these require restructuring the document or renumbering beyond inserting a small number of new sub-tasks.
