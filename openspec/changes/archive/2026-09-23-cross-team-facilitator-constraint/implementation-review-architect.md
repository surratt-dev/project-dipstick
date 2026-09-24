## Implementation Review — Solution Architect (Ingrid Sollenberger)

**Change:** `cross-team-facilitator-constraint`
**Scope of my review:** Whether the implementation matches `design.md` and `tasks.md`, and whether it's built correctly. This change carries no architectural weight of its own — it's test-only, closing a coverage gap left after PR #153 shipped the actual enforcement — so most of my standing concerns (auth delegation, real-time state authority, Redis/Postgres boundary, observability, deployment) are not implicated here. The one property of mine this change does touch, tangentially, is server-side enforcement of access control: these tests further pin down that the membership check is enforced in the query itself, not just in application logic or the UI. That's a positive, not a gap.

### Verdict: Approve

### What I checked

**Diff shape.** `git diff HEAD -- packages/backend/src/routes/facilitator-sessions.ts` is empty — confirmed no production code changed. `git diff HEAD -- packages/backend/src/routes/__tests__/facilitator-sessions.test.ts` shows exactly three additions, all test-only. This matches the design doc's explicit non-goal ("No change to `facilitator-sessions.ts`") and tasks 4.2.

**Test 1 — eligible-teams membership-exclusion predicate (tasks 1.1).** Added inside `GET /api/v1/teams/eligible-for-session`, adjacent to test 3.7. I checked the mock setup against test 3.7 line-by-line: identical three-call `mockResolvedValueOnce` sequence (actor role, eligible-teams rows, membership-exists check), identical `.find(call => call[0].includes("FROM teams"))` / `.toContain(...)` shape, only the asserted substrings differ (`LEFT JOIN team_memberships`, `WHERE tm.id IS NULL` vs. 3.7's `deactivated_at IS NULL`). I confirmed both substrings appear verbatim in the actual query at `facilitator-sessions.ts:1827-1834`. This is exactly the "extend the existing pattern" the design called for, not a divergent mechanism.

**Test 2 — draft-session membership check (tasks 2.1/2.2).** Added in the `POST .../sessions/draft` block, modeled on the adjacent 201-success test's mock shape (actor query, team-exists check, transaction client for the insert path). I verified the isolation predicate directly against source:
- Actor query (`facilitator-sessions.ts:203-213`) contains `FROM users u` and `tm.removed_at IS NULL` — matches.
- Team-exists check (`facilitator-sessions.ts:243`, `SELECT id FROM teams WHERE id = $1`) contains `FROM teams` but not `FROM users u` — does not collide with the `.find()` predicate.
- Denial-path audit insert (`facilitator-sessions.ts:263`, `INSERT INTO audit_log ...`) contains neither substring.
- The success-path `INSERT INTO sessions` / `INSERT INTO audit_log` pair runs on the transaction `client`, not `db.query`, so it never enters `mockDbQuery.mock.calls` at all — confirmed by reading the handler's transaction block.

The isolation predicate is correct and uniquely resolves to the actor query, as tasks.md 2.2 claimed.

**Test 3 — facilitator-state non-invalidation coverage (tasks 3.1).** New `describe` block for `GET .../facilitator-state`, which had no prior coverage in this file. It has its own `beforeEach(() => vi.clearAllMocks())` — I counted the convention across the file: 11 pre-existing `describe` blocks follow this pattern, and this one makes 12, exactly as tasks.md states. The test mocks a single `sessions` row, asserts the response fields (`sessionId`, `teamId`, `currentSessionState`, `bannerState`, `joinToken`) against the handler's actual response shape (`facilitator-sessions.ts:1758-1763` — field names match exactly), and asserts no `team_memberships` substring appears anywhere in `mockDbQuery.mock.calls`. I read the full handler (`facilitator-sessions.ts:1680-1767`): it issues exactly one query, against `sessions`, with no `team_memberships` reference anywhere in it. The design's claim ("no team_memberships reference appears anywhere in the handler") and the test's negative assertion both check out against the real code.

**Spec scenario (tasks 3.2).** `specs/session-creation/spec.md`'s `MODIFIED` requirement includes the "does not invalidate the existing session record" scenario, and its wording is scoped exactly as the design's security-review note describes: it asserts session-record validity/creatability only, and explicitly disclaims any claim about participation or voting eligibility, attributing that to `session-participation` by name. This matches the test's actual scope — I did not find any wording in the scenario broader than what the test demonstrates.

**Full suite run.** `npx vitest run src/routes/__tests__/facilitator-sessions.test.ts` — 68/68 passing, confirmed over 10 repeated runs (cold and warm cache). One run during my investigation (while I was adding temporary debug instrumentation) showed a single spurious failure on the new facilitator-state test, with an unrelated `team_memberships` query call appearing that doesn't correspond to any query in the handler or anywhere I could find in the repo. I was not able to reproduce it again across 9 subsequent runs, isolated or full-suite, warm or cold cache. I'm noting it rather than dropping it silently: this file holds a single module-scoped `mockDbQuery` shared across 12 `describe` blocks, and `vi.clearAllMocks()` clears call history but not any unconsumed `mockResolvedValueOnce` queue — so a test elsewhere in the file that queues more responses than it consumes could in principle leak a stale response into the next block's first query call. I don't have a reproduction, so I'm not blocking on it, but it's a latent fragility in the suite's shared-mock convention (pre-existing, not introduced by this change) worth the team keeping an eye on if CI ever shows a one-off flake here.

### Process note (not a finding on the diff)

While diagnosing the flake above, I ran a `git checkout --` on the test file to reset my own temporary debug edit, which discarded the actual implementation diff under review. I caught it immediately and restored it by reapplying the diff I'd captured earlier in this review (verified byte-identical via `diff` against the original). No work was lost, but flagging it for the record since it's a process error on my part, not a property of the implementation.

### Summary

The three tests are built exactly as `tasks.md` specified, the isolation predicates are correct and verified against the real query text, the new `describe` block follows the file's existing conventions (own `beforeEach`, same mock-call-inspection pattern as test 3.7), and the spec scenario's scope matches what the test actually proves. No production code changed. I have no blocking concerns.
