# Architecture Review: tasks.md as an Implementation Sequence

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Task ordering and dependency correctness only — not a re-review of design.md content, which I already own from the prior stage.

## Overall assessment

The sequencing is sound. No task assumes a downstream artifact that hasn't been built yet by the time it's reachable in section order, and the recent design revisions are reflected structurally, not just as text:

- **AdminContact type before use:** 2.1 introduces the type and query; 2.2 is the first task to consume it. No forward reference.
- **Single-endpoint scope:** 2.2 explicitly scopes population to `GET /api/v1/teams/:teamId` only — correctly a property of the *implementation* task, not left implicit until a test catches it.
- **Viewer-state gating:** 2.2 implements the `!canAssociateManagers` gate; 2.3 and 2.4 (the two new backend test tasks) are ordered after 2.2 and test exactly that gate, including the two-distinct-causes-of-`[]` fixture split called out in design.md Decision 5's caveat. This is correctly sequenced — tests follow the implementation they assert against, not the other way around.
- **TEAM-005/006 separation (Decision 2):** 3.1 (TEAM-006) and 4.1/4.2 (TEAM-005) are built as independent tasks before 4.4 asks to factor out *shared rendering markup only*. Placing 4.4 last in section 4, after both resolution paths already exist, is the right order — it prevents the shared-component temptation from happening before there are two working, independently-tested paths to compare.
- **Copy lock as a real gate:** 1.3 sits in section 1, ahead of all frontend rendering tasks (3.2, 4.3 explicitly cite "locked copy from task 1.3"; 3.1/4.1/4.2's format is separately fixed by Decision 3). Section ordering enforces that no one renders un-locked copy.
- **Test rewrite after implementation:** section 5 (rewriting the task-4.3 describe block and adding new cases) is correctly placed after sections 3 and 4, since several new cases (5.2, 5.2a, 5.3, 5.4, 5.6, 5.7) assert against rendering behavior those sections introduce.

## Findings

### 1. (Minor — process clarity) Task 1.3 doesn't name its dependency on 1.2's disposition

1.3 ("Lock final rendered copy...") is sequenced after 1.2 by position in the document, but its text doesn't state that it's conditional on 1.2's recorded disposition being "proceed with Decision 3" rather than "escalate to Option B." If someone picks up 1.3 without reading 1.1/1.2 closely, they could lock copy for the enumerated multi-admin line while 1.2 is still open, or after it closed with an escalate-to-Option-B outcome. Since 1.1 already carries the branching logic and 1.2 is marked BLOCKING, this is very likely fine in practice — but a one-line addition to 1.3 ("only if task 1.2 is closed with disposition = proceed with Decision 3") would remove the ambiguity for whoever picks up the task out of order.

### 2. (Minor — possible redundancy) Task 3.3 and task 5.6 overlap without a clear division of labor

3.3 ("Verify this path never renders an Engineering Manager's identity as the contact...") and 5.6 ("Add a TEAM-006 test case asserting the escalation contact is never an Engineering Manager's identity...") assert the same property. 5.6 is clearly the enforcement mechanism (an automated test). 3.3 isn't a test task per its own text — it reads as a developer self-check performed during 3.1's implementation, with no stated artifact (no test file, no checklist output). As written, 3.3 could be checked off on the strength of "I looked at it and it's fine," which doesn't hold up over time once someone edits the component later. I'd either reword 3.3 to explicitly say "confirmed by the test added in 5.6" (making the dependency direction explicit: 3.3 isn't actually completable, i.e. checkable-with-confidence, until 5.6 exists), or fold 3.3 into section 3 as a design note rather than a checkable task, since 5.6 is what actually verifies it.

### 3. (Cosmetic) Task numbering: "5.2a"

5.2a was inserted between 5.2 and 5.3 rather than the section being renumbered. Not a dependency problem, just worth a pass to renumber sequentially before this is archived, so the task list doesn't read as having been patched after the fact for a future reader who wasn't in this design cycle.

## What I did not find

- No task in sections 3–5 depends on a backend field, type, or gating behavior that isn't already built by an earlier-numbered task.
- No test task (2.3, 2.4, 5.x) precedes the implementation task it exercises.
- No task silently reopens Q2 (TEAM-006 admin-only) or the EM/Admin resolution-path split — 4.4's scope restriction ("shared rendering markup only, not resolution logic") is stated explicitly enough that an implementer would have to actively ignore it to violate Decision 2.
- Section 1's BLOCKING gate (1.2) correctly precedes all of section 2 by document order, so no backend disclosure work is positioned ahead of the security reconfirmation.

## Recommendation

Ready to proceed as sequenced. Findings 1 and 2 are worth a one-line fix each before implementation starts, but neither is a structural reordering — they're clarifications of dependencies that the section ordering already gets right in practice.
