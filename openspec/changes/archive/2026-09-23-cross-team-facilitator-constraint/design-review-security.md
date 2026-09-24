# Security Design Review — cross-team-facilitator-constraint

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** `design.md`, `proposal.md`, `tasks.md`, the delta spec at `specs/session-creation/spec.md`, and the current implementation in `packages/backend/src/routes/facilitator-sessions.ts` (lines 180-240, 1790-1850, 1656-1755) and its test file.

## Verdict: correctly scoped, approve with one flagged follow-up (non-blocking for this change)

I verified the load-bearing claims in `design.md` directly against the code rather than taking them on faith:

- The draft-session actor query (`facilitator-sessions.ts:204-214`) does join `team_memberships` with `AND tm.removed_at IS NULL`, exactly as described.
- The eligible-teams query (`facilitator-sessions.ts:1824-1836`) does exclude via `LEFT JOIN team_memberships ... WHERE tm.id IS NULL`, exactly as described.
- Test 3.7 (`facilitator-sessions.test.ts:1858-1872`) does use the `.find(call => call[0].includes(...))` / `.toContain(...)` pattern the new tests are modeled on, and the two "documented reference" `expect(true).toBe(true)` placeholders (lines 1782-1793, 1802-1813) do exist as described — so the design doc's characterization of "a stronger, executable test vs. a placeholder" is accurate, not aspirational.
- The `facilitator-state` handler (`facilitator-sessions.ts:1682-1727`) genuinely contains no `team_memberships` reference — its only authorization check is `sr.facilitator_id !== userSession.userId` (line 1719). The design's claim that there's "nothing to vary between a before/after mock" is correct, and the proposed test (assert on the mocked `sessions` row, assert absence of any `team_memberships` query) is the right way to demonstrate absence of a mechanism rather than just asserting it in prose.

Given that: this is what it says it is. Zero production diff, and the diff that exists converts an implicit invariant — "the SQL predicate is correct because someone read it in code review" — into a regression-detecting assertion. That's exactly the pattern I want: a control that doesn't depend on a future developer remembering not to touch it. I have no objection to the query-text-assertion approach or its accepted trade-offs (brittleness to reformatting, weaker-than-integration-test guarantee) — both are pre-existing precedent (test 3.7), correctly extended rather than re-invented, and correctly labeled as a unit-test-layer ceiling rather than a substitute for integration coverage.

Authentication, session-token handling, secrets, CORS, and WebSocket auth are all untouched by this change — nothing here calls for review under those headings.

## On the threat-model question: does formalizing "no retroactive invalidation" create or paper over a privilege-escalation path?

Not by itself, and I want to be precise about why. The `facilitator-state` endpoint's only gate is `facilitator_id === userSession.userId` — an identity check pinned at creation time, entirely independent of `team_memberships`. That's actually a sound property: authorization keyed to a durable, immutable-after-creation identity field is *more* robust than one that re-derives from mutable membership state on every read, because there's no TOCTOU window and no way to flip a membership row to gain or lose access to a session already tied to you. A facilitator who joins the team after creating the session gains nothing new from *this* endpoint that they didn't already have from the moment they created it. So the scenario being formalized is, narrowly, exactly as benign as the spec says.

**However, formalizing it this way risks implying more than it proves, and I traced the adjacent path to check:**

I had it verified whether anything stops the person named as `facilitator_id` on a session from also joining that same session as a participant and voting in it. It does not:

- `POST /api/v1/sessions/:sessionId/participants` (`sessions.ts:40-145`) checks only session status and excludes callers whose `global_role` or team-membership `role` is `engineering_manager`. It never reads or compares `facilitator_id`.
- `POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in` (`sessions.ts:162-403`) — the vote-submission endpoint — likewise checks only session/topic status, the same EM exclusion, and a pre-existing `session_participants` row. No `facilitator_id` comparison anywhere.
- `evaluateSessionSubscriberAccess` (`session-subscriber-access-helper.ts:57-172`), which gates the WebSocket layer, explicitly models facilitator (Path 3) and participant (Path 1) as independent, co-satisfiable paths. Its own comments note only EM-promotion revokes participant access — there's no "facilitator can't also be participant" exclusion there either.
- I checked `openspec/specs/session-participation/spec.md`: it specifies EM non-participation as a requirement but has no requirement excluding a session's own facilitator from participating in it.

So: a facilitator who is not an EM and who later joins the team they are facilitating — precisely the scenario this change's new spec scenario declares as having "no effect" on the session — can then `POST /participants` and `POST /lock-in` on their own session and vote in it. That directly reaches back into the proposal's own stated rationale for this whole constraint: *"a facilitator evaluating their own team's engagement scores undermines the honesty the Health Check depends on."* The session-creation-time check prevents a facilitator from starting out as a member; nothing prevents them from becoming one mid-session and then participating in the vote they're facilitating. This is a pre-existing gap — it is not introduced by this change, and it is correctly out of scope for a test-only PR — but writing the "no invalidation" behavior into the spec as settled, expected, fully-tested behavior, with no accompanying note that participation/voting integrity is a separate, unguarded control, risks a future reader treating the scenario as "checked and fine" in a broader sense than the test actually establishes.

**Recommendation (non-blocking for this change):**
1. Either narrow the new spec scenario's language so it's unambiguous that "no invalidation" is scoped to session-creation eligibility and existing-session validity only, and does not speak to participation/voting eligibility — or add one sentence noting the adjacent control is out of scope and tracked separately.
2. Open a follow-up issue to decide whether `POST /participants` and `POST /lock-in` should exclude the session's own `facilitator_id`, the same way they already exclude EMs. I'd treat this as a real, if narrow, integrity gap worth a deliberate decision (fix it, or explicitly accept the risk and document why) rather than something that stays invisible because no spec or test currently asserts either way.

This is a flag, not a blocker — it doesn't belong in this PR's scope, and I don't want it to delay test coverage that's ready to land. I do want it on record before this scenario reads as "considered and closed."

## Other items checked, no findings

- Audit logging for the rejection path (Decision D1) predates this change and is unaffected; not re-reviewed here since no logging code is touched.
- No secrets, environment configuration, or dependency changes in this diff.
- Identity-provider / OIDC integration is untouched — out of scope, no findings.

## Summary

Approve. The change is accurately described as behavior-preserving, the query-text-assertion approach is sound and consistent with existing precedent, and the "no retroactive invalidation" claim is correct as literally stated and verified against the code. The one thing I want carried forward — not as a blocker on this PR, but as a tracked item — is that this change formalizes a session-creation-time guarantee in a way that could be misread as a broader integrity guarantee, when a real, unguarded adjacent path (facilitator later voting in their own session) exists and is not covered by any spec or test in this repository today.
