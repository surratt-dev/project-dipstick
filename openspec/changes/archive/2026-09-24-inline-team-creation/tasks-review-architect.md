## Task Ordering Review — Solution Architect (Ingrid Sollenberger)

Scope: task sequencing and dependency correctness only, against the current `design.md`/`proposal.md`. Not a re-review of the design decisions themselves — those are settled and incorporated.

### Verdict

Mostly sound. Sections are ordered correctly at the macro level (prerequisite → migrations → backend → frontend → tests → docs), and the two enforcement mechanisms the design leans on (the 4.4 real-data test as the actual merge gate, the 7.1 security-critical test annotation) are positioned after the code they depend on. There are two real forward-reference defects inside Section 3 that should be fixed before implementation starts, and one dependency (migration numbering) that is stated as a caveat but not actually sequenced as a blocking dependency. None of these require restructuring the plan — they're reorderings and one added checkpoint.

---

### 1. Must-fix: `TeamNameCollisionResponse` (3.9) is defined after the task that requires it (3.4)

Task 3.4 says: *"Translate to the typed `TeamNameCollisionResponse` (design.md D2), not a message string."* Task 3.9 is: *"Add `TeamNameCollisionResponse` ... to `@dipstick/shared`."* As numbered, 3.9 is the last item in Section 3 — it comes after 3.4, 3.5, 3.6, 3.7, and 3.8, all of which either use or sit downstream of a type that, per the list order, doesn't exist yet.

This isn't just a documentation nit — it's the exact kind of implicit-ordering assumption the design process is supposed to surface, not leave to whoever executes the list literally. An implementer following tasks.md top to bottom will hit a compile error at 3.4 (or write the response inline as an untyped shape "for now," which is the string-matching anti-pattern D2 explicitly rejects).

**Fix:** renumber. Move the shared-type addition to occur before 3.4 — either as 3.1a (right after the route-file decision, before any handler logic that returns a typed response) or simply resequence 3.9 to 3.3a. The type has no dependency on anything else in Section 3, so it can move freely to the front.

### 2. Minor: Section 3's transaction step (3.5) references Section 4's topic-copy step, which is sequenced after it

Task 3.5 folds "default-topic copy (see Section 4)" into the single transaction, but Section 4 (topic provisioning, including 4.1's actual `INSERT ... SELECT`) is listed *after* all of Section 3 in the document. An implementer working strictly in list order would write the transaction's topic-copy line in 3.5 before 4.1 exists.

In practice these are tightly coupled — same transaction, likely written as one code change — so this is lower severity than #1 and an implementer who reads ahead won't be tripped up. But since the brief here is ordering-as-written, worth flagging: either (a) note explicitly in 3.5 that 4.1 is a co-requisite implemented alongside it, not after it, or (b) move Section 4 (default topic provisioning) ahead of Section 3 in the document, since the route's transaction is the only consumer of the copy step and currently reads as if it's built on top of something that doesn't exist yet at that point in the list.

### 3. Route file (3.1) and typed collision response (3.9) vs. frontend — macro ordering is correct

At the section level this is right: Section 3 (backend route, including whichever numbering fix from #1 applies to 3.9) fully precedes Section 5 (frontend new-team screen), and 5.3's `newTeamError` union correctly consumes the backend's typed response only after Section 3 is complete. No issue here once #1 is fixed — the problem was internal to Section 3's own numbering, not the route-before-frontend relationship, which holds.

### 4. Security-critical test (7.1) and audit logging (3.2a) — correctly sequenced

7.1's assertions (the `team.creation_denied_role` audit row, the D6 no-membership-row regression test with its required inline comment) all sit in Section 7, after Section 3 has built the handler, the 403 check, and the audit write. No task before the code exists asks to test it. This is the one area of the four flagged where I found nothing to change — the ordering already reflects "build, then test, then annotate the security-relevant assertion," and 3.2a itself is correctly placed immediately after 3.2 (the check it audits), not deferred to a later cleanup pass.

### 5. Must-fix: migration numbering (2.1) is caveated in prose but not actually sequenced as a blocking dependency

Task 2.1 says to "confirm the next available migration number at implementation time — do not assume 11," noting that `fix-default-topic-seed-data` also claims a new migration number. Design.md D4 adds that numbering "resolves naturally in sequence *if* the prerequisite lands first as required."

That "if" is doing load-bearing work that the task list doesn't actually enforce. Task 1.1 blocks this change's *merge* on the prerequisite, but nothing blocks *implementation* of 2.1 on the prerequisite's migration having already landed. If both changes are worked in parallel branches — plausible, since the prerequisite is currently only a stub — an implementer picking "the next available number" at the time they write 2.1 can legitimately choose a number the prerequisite's migration later also claims once it's actually merged. "Confirm at implementation time" catches the case where the prerequisite already merged before this task started; it does not catch the case where both are in flight simultaneously, which is exactly the scenario the merge-dependency in 1.1 exists to handle.

**Fix:** add an explicit note to 2.1 (or a new task 2.0) that the migration number must be re-verified immediately before this change's own merge — not only once, early, at implementation time — precisely because 1.1 only guarantees the prerequisite merges *first*, not that it has already merged *before this task is written*. Concretely: "re-confirm the migration number against `main` immediately before merging this change, and renumber if `fix-default-topic-seed-data`'s migration claimed the same number in the interim." This turns a prose caveat into an actual checklist step, consistent with how 4.4 turned the seed-data dependency from a prose caveat into an enforced test.

---

### Summary of changes recommended

1. Resequence 3.9 (`TeamNameCollisionResponse`) to before 3.4 — genuine forward reference, will break implementation-in-order.
2. Note the 3.5/4.1 co-dependency explicitly, or reorder Sections 3 and 4 — lower severity, same class of issue.
3. No change needed — route-before-frontend ordering is correct.
4. No change needed — test/audit sequencing is correct.
5. Add a re-verification step to 2.1 (or new task) confirming the migration number against `main` immediately pre-merge, not only at implementation start — closes a real parallel-branch collision risk that the current prose caveat doesn't structurally prevent.
