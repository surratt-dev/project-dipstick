# Architect Review: tasks.md Ordering vs. design.md Dependencies

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Does task ordering in `tasks.md` respect the architectural dependencies
`design.md` establishes? No task should assume something not yet built.

## Verdict

**No blocking ordering defects found.** The task sequence is internally consistent
with every dependency `design.md` states. One non-blocking observation and one
clarification request below — neither requires reordering, both are cheap to address
in passing.

## Dependency checks requested, verified individually

### 1. Task 1.0 (declare `oauth4webapi` direct dependency) before anything importing `OperationProcessingError` from it

Confirmed. Task 1.1 ("Import `OperationProcessingError` from `oauth4webapi` directly
... now a direct dependency per 1.0") is the only import site, and it's sequenced
immediately after 1.0, both under section 1, in file order. No other task imports
from `oauth4webapi` ahead of 1.0. D8's rationale (the import currently resolves only
via hoisting, and this change makes that explicit) is respected — the dependency
declaration happens first, the import that relies on it second.

### 2. Split 1.2 / 1.2a

Correctly sequenced. Both are branch implementations inside the module 1.1 creates,
and 1.2a (`WWWAuthenticateChallengeError`) is positioned immediately after 1.2
(`ResponseBodyError | AuthorizationResponseError`), matching D3's note that these were
originally one shared branch and were split so the allowlist reflects only fields
actually present on each class. Neither sub-branch depends on the other's
implementation — order between them is arbitrary but their shared prerequisite (1.1)
correctly precedes both.

### 3. Split 2.2a / 2.2b

Correctly sequenced, with one nuance worth naming rather than fixing: 2.2b (new
`log.error` call via `sanitizeOidcError`, per D9) has a real dependency on section 1
being complete — it can't compile or be meaningfully tested until `sanitizeOidcError`
exists. 2.2a (the `isRevocation` fix, per D10) does **not** depend on section 1 at
all — it's a pure logic correction reading `err.error` via `instanceof
ResponseBodyError`, using an import (`ResponseBodyError`) already reachable via
`openid-client` before this change. Grouping 2.2a under the same parent task as 2.2b
is organizationally sound (same catch block, same design decisions D9/D10 discussed
together) but means 2.2a is over-constrained by its position — it could be
implemented and landed independently of section 1 if the team wanted to parallelize.
Not a defect; flagging only so implementers don't infer a dependency that isn't
architecturally real.

### 4. Split 3.2 / 3.5 / 3.5a

Correctly sequenced within section 3, and section 3 as a whole correctly follows
section 1 (the branches under test must exist before they can be asserted against).
3.2 constructs the real instances (including `WWWAuthenticateChallengeError`) that
3.3–3.5a's assertions run against; 3.5a's absent-field assertion for
`WWWAuthenticateChallengeError` is a direct check on 1.2a's output shape, and 1.2a
precedes it by a full section. No forward reference.

One clarification worth requesting from whoever implements 3.2, not a reorder: the
task text says the `OperationProcessingError` case must "exercise the actual
`getEndSessionUrl()` → `buildEndSessionUrl()`-reachable path" rather than an arbitrary
construction. As written this reads as calling the existing, unmodified
`oidc-client.ts` function directly from the test file — which has no dependency on
task 2.3's route-level `try/catch` (2.3 wraps the *handler's* call site; the function
being exercised in 3.2 is unchanged library-adjacent code that already exists today).
If that's the intended reading, ordering is fine as-is. If 3.2 were instead intended
to exercise the test through the actual `/auth/logout` route handler, it would need
2.3 to land first, which would put section 3 out of order relative to section 2 for
this one case. Worth a one-line confirmation in the task text (e.g. "call
`getEndSessionUrl()` directly, not via the route handler") so this doesn't become an
implementer's judgment call mid-section.

### 5. New task 2.3 (`/auth/logout` try/catch)

Correctly placed in section 2 as a sibling to 2.1/2.2, after section 1 (it depends on
`sanitizeOidcError` existing, specifically the case-2 branch from 1.3 since
`OperationProcessingError` is what `buildEndSessionUrl()` throws per D8). No task
before it in section 2 needs to complete first — 2.1, 2.2, 2.3 are three independent
call sites sharing only the section-1 prerequisite, and their relative order among
themselves doesn't matter architecturally.

### 6. New task 4.3 (refreshSessionTokens D9/D10 test)

Correctly placed in section 4, after section 2. It exercises both 2.2a's
classification fix and 2.2b's new log line — both must exist for the two assertions
in 4.3(a) and 4.3(b) to be meaningful, and both do, two sections earlier.

## Cross-section checks beyond what was explicitly asked

- Section 4 (user-facing verification) as a whole correctly follows section 2 in
  every case: 4.1 needs 2.1, 4.2 needs 2.3, 4.3 needs 2.2a/2.2b. None of section 4
  depends on section 3, and section 3 doesn't depend on section 4 — the two are
  parallelizable if the team wants to split work, which is consistent with them
  testing different surfaces (sanitizer unit behavior vs. end-to-end route behavior).
- Section 6 (follow-up issue filing) is correctly last and explicitly scoped as
  post-implementation, matching its "file once implementation lands" framing.
- Task 1.6 (onboarding code comment) is positioned last within section 1, after all
  five branches (1.2–1.5) it documents are implemented — correct, since the comment
  describes behavior (including the 1a/1b split rationale) that only exists once
  those branches are written.

## Summary

Ordering respects every dependency design.md establishes, including the one most
likely to be gotten wrong (1.0 before the direct `OperationProcessingError` import).
No task assumes unbuilt work. The two items above are a documentation nicety
(2.2a's real independence from section 1) and a one-line clarification request
(3.2's exact call path) — recommend addressing both in tasks.md text but neither
blocks implementation from starting in the order as written.
