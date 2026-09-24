# Business Analyst Review — tasks.md (cross-team-facilitator-constraint)

**Reviewer:** Marcus Delgado (Business Analyst persona)
**Scope:** Coverage check — do the tasks, taken together, close the two gaps identified in proposal.md (the two query-text assertions, and the historical-session non-invalidation test + narrowed spec scenario)? Anything lost in translation? Did the fixes from my earlier "not yet buildable" review actually land?

## Verdict: Approve

Nothing is lost in translation. Every element proposal.md commits to has a corresponding, concrete task, and the two things I previously flagged as not-yet-buildable are now buildable exactly as described.

## Coverage trace (proposal → task)

| Proposal commitment | Task(s) | Status |
|---|---|---|
| Query-text assertion for eligible-teams membership-exclusion predicate | 1.1, 1.2 | Covered |
| Query-text assertion for draft-session `removed_at IS NULL` predicate | 2.1, 2.2 | Covered |
| Historical-session non-invalidation test (facilitator-state endpoint, absence-of-mechanism proof) | 3.1 | Covered |
| Narrowed spec scenario stating creation-time-only enforcement | 3.2 | Covered |
| No production changes | 4.2 | Covered |
| Full suite still green | 4.1 | Covered |
| Issue #46 closure note | 4.3 | Covered |

Nothing in the proposal's "What Changes" or "Impact" sections is unaccounted for in tasks.md.

## Verification against the actual code (not just against the proposal's prose)

I read `packages/backend/src/routes/facilitator-sessions.ts` and `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts` directly rather than taking tasks.md's claims on faith, since my job is to confirm the tasks are buildable, not just internally consistent.

- **Task 1.1** — `LEFT JOIN team_memberships` / `WHERE tm.id IS NULL` is real, at `facilitator-sessions.ts:1830,1834`, in the eligible-teams query. Confirmed. Test 3.7's exact `.find(...)`/`.toContain(...)` pattern is present at test-file lines 1858–1872 and is trivially mirrored for this predicate.
- **Task 2.1** — the actor query at `facilitator-sessions.ts:204-212` selects `global_role` and `is_member` and does contain `tm.removed_at IS NULL` at line 211. Confirmed.
- **Task 2.2 (previously flagged as not-yet-buildable — now fixed)** — the isolation predicate `(call[0] as string).includes("FROM users u")` is now concrete and I verified it's actually unique: `FROM users u` appears exactly once in the entire production file (line 207; grep confirms no other occurrence). The team-exists check (`facilitator-sessions.ts:243`, `SELECT id FROM teams WHERE id = $1`) contains `FROM teams` but not `FROM users u` — correct, and distinguishable. The denial-path audit insert (line 263) contains neither substring — correct. I also confirmed the claim that the success-path `INSERT INTO sessions`/`INSERT INTO audit_log` pair runs on `client.query`, not `db.query` (lines 301-322 use `client.query` inside a `BEGIN`/transaction block), and that the test file mocks `db.connect()` via a *separate* mock (`mockDbConnect`, line 7) from `db.query` (`mockDbQuery`, line 6) — so those transaction-client calls genuinely never appear in `mockDbQuery.mock.calls`. This claim is not just plausible, it's structurally guaranteed by how the mocks are wired. Task 2.2 is now concrete and correct.
- **Task 3.1 (previously flagged as not-yet-buildable — now fixed)** — the endpoint, mock sequence, and line numbers are all real:
  - `facilitator-sessions.ts:1682` is indeed the `facilitator-state` route registration.
  - `facilitator-sessions.ts:1694-1697` is indeed the sole query in that handler (`SELECT id, team_id, facilitator_id, status, join_token FROM sessions WHERE id = $1 AND team_id = $2`), and I confirmed by reading the full handler (lines 1682-1767) that no `team_memberships` reference exists anywhere in it — the "nothing to vary between before/after" claim in the task is accurate, not asserted without basis.
  - The "11 existing instances" of the `beforeEach(() => vi.clearAllMocks())` convention checks out — I counted 11 occurrences across the file's other describe blocks.
  - The three-step assertion (200 response reflects the mocked row unchanged; no `team_memberships` substring anywhere in `mockDbQuery.mock.calls`) is a sound proof-of-absence, not a weaker "looks right" claim.
- **Task 3.2** — I read `specs/session-creation/spec.md` directly. The scenario "A facilitator joining the facilitated team after session creation does not invalidate the existing session record" is present, and its wording already carries the narrowing the task instructs the implementer to preserve: it explicitly disclaims any claim about participation/voting eligibility and attributes that boundary to `session-participation` instead. The requirement's prose paragraph above the scenarios says the same thing in different words. Task 3.2's instruction not to broaden this wording is protecting something that's already correctly narrow in the drafted spec — good, since this is exactly the kind of scope creep I'd otherwise worry about (see my persona's concern re: edge cases becoming scope disputes in the wrong direction — here the risk is the opposite, over-claiming coverage that isn't tested).

## Assessment against my usual concerns

- **Simultaneous reveal integrity, facilitator/participant view distinction:** not touched by this change; no concern.
- **Traceability from requirement to feature:** strong here — every task cites the exact file, line range, and query text it targets. This is the standard I want the team building to; nothing here requires implementers to re-derive intent.
- **Requirements that are buildable, not just correct:** this is exactly what was broken in the prior revision and is now fixed. Task 2.2 previously had no concrete isolation predicate; it now has one, and I've verified it's actually unique against the codebase, not just asserted to be. Task 3.1 previously lacked the endpoint/mock-sequence specificity to build against; it now names the endpoint, the exact query, the line numbers, and the beforeEach convention to follow.
- **Scope discipline:** the change is honest about being test-only with zero production diff (task 4.2 enforces this), and the spec addition is additive/clarifying rather than a new requirement — consistent with design.md's Decisions section, which I also cross-checked.

## Minor observations (non-blocking)

- Task 1.1 doesn't give exact line numbers the way task 2.2 and 3.1 do, but the pattern-mirroring instruction ("adjacent to existing test 3.7") is unambiguous enough given the existing test 3.7 is right there in the same describe block. Not a gap.
- Task 4.3's phrasing about closing #46 correctly preserves the proposal's distinction that this PR doesn't itself close #46's original ask (PR #153 already did) — it just closes the residual coverage gap. Good, this avoids a false claim of scope in the PR/issue trail, which matters to me for traceability reasons.

No further changes requested. Tasks.md is ready to build from as written.
