## Why

The facilitator-from-another-team constraint is a load-bearing, no-exceptions rule — the entire reason it exists is that a facilitator evaluating their own team's engagement scores undermines the honesty the Health Check depends on. It is already correctly implemented and already shipped (PR #153, closing use-case "Facilitator Team Membership Constraint Violation" under issue #43): both the `POST /api/v1/teams/:teamId/sessions/draft` membership check and the `GET /api/v1/teams/eligible-for-session` exclusion are hard database reads with no toggle, no cache, and no bypass. Exploration on GitHub issue #46 (filed separately, describing the same gap) confirmed this directly against the code, the merged spec, and the archived `session-creation-existing-team` change, and two independent reviewers (BA and facilitator lenses) confirmed the same.

That exploration surfaced two narrow test-coverage gaps rather than any behavior gap. First: the query-text assertion pattern this suite already establishes for one predicate in the eligible-teams query (test 3.7, asserting `deactivated_at IS NULL` appears in the SQL) was never extended to the adjacent membership-exclusion predicate (`LEFT JOIN team_memberships ... WHERE tm.id IS NULL`) in that same query, or to the `removed_at IS NULL` predicate in the draft-session query. Every other test in these describe blocks mocks the already-filtered result set and asserts on the response — which confirms the response shaping, not the SQL predicate that does the actual exclusion. For a rule this security-sensitive, resting on "the SQL was read and looks right" is a weaker guarantee than the pattern the suite itself already uses elsewhere in the same file, and it means a future refactor of these queries could silently drop the exclusion without any test catching it. Second: the use case's own Notes section states a constraint-scope boundary — "if a Facilitator later joins the facilitated team, the historical session is not invalidated" — that is true by construction (nothing in the codebase touches `sessions` on a membership change) but is not asserted anywhere, in a test or in `spec.md`.

Closing both gaps now, while the context is fresh and two reviewers have already lined up the exact predicates and the exact use-case language, is cheaper than rediscovering them the next time someone touches these queries.

This change is intentionally lightweight in engineering risk — test-only, zero production diff, zero open design decisions — despite running on the full seven-stage track. The full track was already committed to at kickoff for the parent issue (#46), before this narrower, smaller-than-expected scope was known; that sequencing, not a judgment that this specific change warrants full scrutiny, is why it's here rather than on a lighter track.

## What Changes

- Add an explicit query-text assertion for the eligible-teams query's membership-exclusion predicate (`LEFT JOIN team_memberships ... WHERE tm.id IS NULL`), mirroring the existing test 3.7 pattern for the adjacent `deactivated_at IS NULL` predicate, in `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts`.
- Add an explicit query-text assertion for the draft-session query's `removed_at IS NULL` predicate in the same test file, using the same pattern.
- Add a test confirming that a membership change occurring after a session already exists does not retroactively affect that session, by exercising the `facilitator-state` read endpoint and asserting both its response and the absence of any `team_memberships` query in its mock-call sequence — i.e., demonstrating, for a concrete endpoint, that no code path re-evaluates or invalidates a `sessions` row on a later `team_memberships` change. Add the corresponding clarifying scenario to `session-creation/spec.md`'s existing enforcement requirement, since it is the kind of edge case a future reader of the spec alone (without also reading the test file) should not have to infer.
- No production code changes. The behavior under test is already correct and already shipped; this change adds coverage and a clarifying spec scenario, not new logic.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `session-creation`: One additive requirement-text change. The existing requirement "Facilitator-from-another-team enforcement at session creation" already documents the membership-check behavior; this change adds test coverage for predicates that requirement already specifies, and adds one clarifying paragraph plus one scenario stating explicitly that the constraint is evaluated only at creation time and is not retroactively re-evaluated on later membership changes. This is not a new requirement and not a behavior change — see `design.md`'s Decisions section and the specs delta.

## Impact

- **Affected code:** `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts` only. No changes to `packages/backend/src/routes/facilitator-sessions.ts` or any other production file.
- **Affected specs:** `openspec/specs/session-creation/spec.md` — one additive paragraph and one scenario added under the existing `MODIFIED` requirement (not a new requirement, not a behavior change).
- **GitHub issues:** This change does not close #46 by itself — #46 is closed by referencing PR #153, which already shipped the enforcement this issue asked for. This change exists because reviewing #46 surfaced a real, if narrow, test-coverage gap worth closing on its own merits; #46 is background/motivation, not the thing this change resolves.
- **Dependencies/systems:** None. No new tables, endpoints, or external dependencies.
