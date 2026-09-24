## Context

This design doc is included for completeness in the artifact chain, not because the change has architectural weight — it doesn't. The facilitator-from-another-team constraint is already implemented in `packages/backend/src/routes/facilitator-sessions.ts` (shipped in PR #153, `session-creation-existing-team`). This change adds test coverage and one clarifying spec scenario; it touches no production code path.

Two queries are in scope for the new assertions:
- The draft-session actor query (`facilitator-sessions.ts:204-217`), which joins `team_memberships` with `AND tm.removed_at IS NULL` to compute `is_member`.
- The eligible-teams query (`facilitator-sessions.ts:1827-1834`), which excludes the caller's own teams via `LEFT JOIN team_memberships ... WHERE tm.id IS NULL`.

The existing test suite (`facilitator-sessions.test.ts`) already established a pattern for asserting an unexercisable-by-mock SQL predicate at the query-text level: test 3.7 asserts the eligible-teams query string contains `deactivated_at IS NULL`, because the mocked DB layer executes whatever query is passed without evaluating its WHERE clause — so the only way to catch a future accidental removal of a predicate is to assert on the query text itself, not just on a hand-crafted mock result.

## Goals / Non-Goals

**Goals:**
- Extend the existing test-3.7 query-text-assertion pattern to the two predicates the addendum identified: the eligible-teams membership-exclusion join and the draft-session `removed_at IS NULL` join condition.
- Make the "historical session not invalidated by a later membership change" boundary explicit in both a test and `session-creation/spec.md`, so it's discoverable without archaeology into the use-case doc.

**Non-Goals:**
- No change to `facilitator-sessions.ts` or any other production file. The behavior is already correct; this is coverage, not a fix.
- No new endpoint, table, or migration. The "later joins the team" scenario has no implementation to build — it's a negative assertion (nothing happens), not a feature.
- No change to the `session-creation` spec's normative requirements — the modification is additive documentation (one clarifying paragraph, one scenario) inside the existing requirement, not a behavior change.

## Decisions

**Assert query text via `mockDbQuery.mock.calls`, matching the existing 3.7 pattern, rather than introducing a new test double or SQL-parsing helper.** The suite already solved "how do you test a WHERE clause against a mocked DB" once; reusing that exact mechanism (`.find((call) => call[0].includes(...))`, then `.toContain(...)` on the query string) keeps the two new assertions consistent with the one they're modeled on, and avoids introducing a second, divergent way of expressing the same kind of check in the same file.

**Test the "no retroactive invalidation" claim by exercising a concrete, existing session-read endpoint and asserting the absence of any `team_memberships` query in its mock-call sequence, rather than a before/after comparison of a membership value.** A repo-wide grep for `team_memberships` (`packages/backend/src/routes/*.ts`, `packages/backend/src/auth/*.ts`) shows many places that read it — access-control gates in `sessions.ts`, `teams.ts`, `em-views.ts`, `session-subscriber-access-helper.ts` all re-check `team_memberships` live, per-request, for their own authorization decisions — but none of them are triggers, hooks, or scheduled jobs that fire *on a membership change* to reach back and alter an existing `sessions` row. There is no event path from "a `team_memberships` INSERT/UPDATE happened" to "a `sessions` row changed."

Because there is no such mechanism, no read path that touches a `sessions` row actually branches on `team_memberships` state — which means there is nothing to vary between a "before" and "after" mock on any of them. The test instead targets `GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state` (`facilitator-sessions.ts:1682`), whose entire implementation is a single query against `sessions` (`facilitator-sessions.ts:1694-1697`, `SELECT id, team_id, facilitator_id, status, join_token FROM sessions WHERE id = $1 AND team_id = $2`) plus an in-memory `facilitator_id` check — no `team_memberships` reference appears anywhere in the handler. The test asserts the response is driven only by the mocked `sessions` row, and separately asserts that the mock-call sequence contains no `team_memberships` query, which is what actually demonstrates the absence of a mechanism rather than merely restating it in prose.

This is a different, and stronger, shape than this file's existing "documented reference" blocks (`Draft session expiry`, `Grace window behavior`): those are `expect(true).toBe(true)` placeholders with a comment pointing at coverage that lives in a different file — they assert nothing about this file's own code. The `facilitator-state` test is executable, exercises this file's own request handler, and fails if a future change adds a `team_memberships` join to that handler.

Scope note (raised in security review): this decision, the test it produces, and the spec scenario it backs establish only that the `sessions` row itself remains valid and is not retroactively invalidated by a later membership change — a creation-time/session-record claim. They say nothing about whether a facilitator who later joins the team may then participate in or vote within the session they facilitate; that is a `session-participation` concern, unmodified by this change, and is not what this test or scenario verifies. The spec scenario's wording has been narrowed accordingly so it cannot be read as covering participation integrity.

**Add the clarifying scenario to the existing `MODIFIED` requirement in `session-creation/spec.md` rather than opening a new requirement.** The use case's Notes-section boundary is a corollary of the enforcement requirement already in that spec ("this constraint applies at creation time"), not a separate rule — splitting it into its own requirement would suggest it's independently togglable or independently testable in a way that misrepresents it as a distinct piece of behavior rather than a scope boundary on the existing one.

## Risks / Trade-offs

- **A query-text assertion is a weaker guarantee than exercising the predicate against a real database.** → Accepted, matching the precedent the suite already set with test 3.7 for the same reason: the unit-test layer mocks the DB entirely, so no unit test in this file can do better than this for a WHERE-clause predicate. Real-predicate coverage, if wanted, belongs to an integration-test layer this change does not introduce or claim to provide.
- **A query-text assertion is brittle to harmless SQL reformatting (whitespace, alias renaming) that doesn't change behavior.** → Accepted for the same reason 3.7 already accepts it: a `.toContain()` check on a normalized substring (`"removed_at IS NULL"`, `"WHERE tm.id IS NULL"`) tolerates reformatting of everything except the exact predicate text, which is the one thing we want to be strict about.

## Open Questions

None. The addendum fully specifies both gaps and the fix shape; nothing here requires a decision beyond the two above.
