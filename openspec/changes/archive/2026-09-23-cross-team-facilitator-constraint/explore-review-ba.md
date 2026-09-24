# Independent Review — "Facilitator Team Membership Constraint Violation" AC Mapping

**Reviewed by:** Marcus Delgado (Business Analyst)
**Requested by:** Devon Calloway, specifically *because* Devon authored both the original gap-finding and the fix's sign-off for `session-creation-existing-team` and wanted an independent check on the AC-to-implementation mapping rather than a restatement of their own conclusion.

**Method:** I read the use case source directly (not a summary of it), then read the spec and the handler code line by line, then read the test file's assertions — in that order — before opening Devon's exploration notes' conclusions section, so my read wasn't anchored by theirs. I did use Devon's notes as a pointer to *where* to look (file paths, line ranges), which is appropriate; I did not take their characterization of what the code does as a substitute for reading it.

**Sources checked directly:**
- `requirements/use cases/02 - Session Setup - Use Cases.md` — "Facilitator Team Membership Constraint Violation" (source of the ACs below)
- `openspec/specs/session-creation/spec.md`
- `packages/backend/src/routes/facilitator-sessions.ts` — full `POST /api/v1/teams/:teamId/sessions/draft` handler (lines 198–380) and full `GET /api/v1/teams/eligible-for-session` handler (lines 1785–1860)
- `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts` — both describe blocks in full

---

## Note on scope, up front

This use case's own AC list is backend/server-enforcement-shaped, and I verified it against backend code and backend tests. Two of the use case's Main Flow / Postcondition statements describe **frontend** behavior (the picker not offering teams, the "no teams available" message being displayed). The spec.md capability I was pointed to (`session-creation`) does document frontend requirements textually (see its "Session-creation entry point is gated on facilitator eligibility" section), but I was not handed a frontend test file, and didn't go looking for one outside my assigned file set. I'm flagging that distinction rather than either ignoring the frontend ACs or claiming to have verified something I didn't look at. If a frontend reviewer hasn't separately checked the picker/confirm-screen behavior against `EligibleTeamsResponse.callerHasTeamMemberships`, that's a gap in the review chain, not in the implementation as far as I can tell.

Separately: `requirements/CLAUDE.md` scopes that directory to documentation-only work and says not to read or draw conclusions from files outside it. This specific task — independently verifying that a requirements document is satisfied by shipped code — is structurally impossible to do without crossing that boundary, and it's exactly the kind of traceability check I exist to do. I'm noting the tension rather than silently overriding it: my deliverable lives in `openspec/changes/`, not `requirements/`, and the only file I read *from* `requirements/` was the use case itself, as a fixed reference point for comparison. I'd flag this to whoever owns that CLAUDE.md if cross-team verification like this becomes a recurring pattern — the boundary may need an explicit carve-out for it.

---

## Acceptance Criteria — line-by-line mapping

### AC1: "The team selection list shown during session creation excludes all teams the authenticated user belongs to."

**Verdict: Satisfied, with one test-coverage gap worth naming.**

`GET /api/v1/teams/eligible-for-session` (facilitator-sessions.ts:1819–1837) builds the list with:
```sql
FROM teams t
LEFT JOIN team_memberships tm
      ON tm.team_id = t.id AND tm.user_id = $1 AND tm.removed_at IS NULL
WHERE tm.id IS NULL AND t.deactivated_at IS NULL
```
This is the correct shape for the requirement — an anti-join on active membership.

The gap: test 3.7 explicitly asserts the query text contains `deactivated_at IS NULL` (a string-level proxy check, since the DB is mocked and can't be exercised for real). There is **no equivalent assertion for the membership-exclusion clause** — no test checks that the query text contains the `LEFT JOIN team_memberships ... WHERE tm.id IS NULL` shape, the way 3.7 does for the deactivation clause. Every other test in the eligible-teams describe block mocks the *already-filtered* result set and asserts on what comes back, which confirms the response-shaping code but not the SQL predicate that does the actual exclusion. The predicate is correct on inspection — I checked it against the spec's own worked SQL and it matches — but "I read the SQL and it looks right" is a weaker guarantee than the pattern the test suite itself sets for the adjacent deactivation rule in the same query. I'd ask for a test mirroring 3.7's approach but asserting on the membership join instead, given the suite already established that this is the right way to test an unexercisable-by-mock predicate.

### AC2: "If the user belongs to all teams in the application, the session creation screen shows no available teams and explains why."

**Verdict: Backend half satisfied and tested; "explains why" half is outside the files I was given to check.**

Test 3.9 ("facilitator with a home team and zero eligible targets") confirms `eligibleTeams: []` and `callerHasTeamMemberships: true` — the data contract the spec (spec.md:68) says exists specifically so the frontend can distinguish this case from the zero-home-team case and show the right copy. That data contract is real and tested. Whether the frontend actually *uses* `callerHasTeamMemberships` to render distinct, explanatory copy for each empty state is a claim about frontend code I did not read. I'm not asserting it's missing — I'm saying this AC has a frontend half that wasn't in my source set and I won't claim coverage I don't have.

### AC3: "A server-side check prevents session creation for the user's own team regardless of how the request is submitted."

**Verdict: Fully satisfied, well-tested, this is the strongest part of the mapping.**

The `POST /draft` handler's `is_member` check (lines 261–289) is a hard, unconditional block with no bypass path — it's the only handler that inserts into `sessions`, so "regardless of how the request is submitted" is true by construction (there is exactly one code path in). I traced this claim rather than accepting it: I grepped for other INSERT-into-sessions call sites in this file and found none outside this handler.

Tests covering this directly:
- `2.3/2.6/2.7` — active membership → 403, named message, no session created (`mockDbConnect` never called), audit row written with `session.draft_denied_membership_conflict`.
- `2.4` — previously-removed membership (`removed_at` set) → permitted. This is the one place I'd push back slightly on how the test is written: the comment at line 241–243 says the soft-deleted-membership behavior is "simulated here directly, since the query itself is not re-executed" — i.e., the test mocks `is_member: false` rather than exercising the SQL's `removed_at IS NULL` condition against two membership rows (one active-elsewhere, one removed-for-this-team). That's an honest limitation of a fully-mocked-DB unit test, not a hidden problem, but it means the "removed_at is what flips this" claim rests on reading the single SQL statement correctly, same as AC1's gap above.
- `2.5` — non-facilitator → distinguishable 403, no audit row.
- `2.8` — nonexistent team + no membership row → 404, not the membership-conflict 403 (confirms check ordering: team-existence is checked before membership, so a bad `:teamId` never gets the membership-conflict audit treatment).

The spec's own scenarios ("Direct API submission bypassing the picker UI," "Membership acquired after the eligible-teams list was fetched is caught at submission") match the use case's Alternate Flows verbatim, and the handler's live re-read of `team_memberships` on every request (not cached, not derived from the picker response) is what makes the race-condition scenario actually true rather than just documented. I confirmed this by reading the query — no caching layer, no session-token-carried role, straight `SELECT ... FROM users LEFT JOIN team_memberships` on each call.

### AC4: "The error message, if shown after a rejected submission, is clear and does not suggest a workaround."

**Verdict: Satisfied by inspection; not independently testable beyond that, and that's fine.**

The literal message is `"A facilitator cannot create a session for a team they are a member of."` (line 285). It names the rule, states no reason, offers no alternative path. Test 2.3/2.6/2.7 asserts the message contains "member of" and is distinct from the not-a-facilitator message, but "does not suggest a workaround" is a semantic property of fixed literal text — there's nothing further a unit test can meaningfully assert here beyond string content, and the string content is what I'd have flagged if it were a problem. It isn't.

---

## Main Flow / Alternate Flow / Postcondition cross-check (beyond the numbered ACs)

- **Main Flow steps 1–4** (construct list, exclude, user sees only eligible teams): satisfied by the eligible-for-session endpoint, same as AC1.
- **Main Flow step 5** ("If no eligible teams exist... does not offer a session creation path"): frontend behavior, out of my source set — see the scope note above.
- **Alternate Flow — UI bypass**: satisfied, AC3.
- **Alternate Flow — race condition**: satisfied, AC3, and explicitly scenario-tested in spec.md (not literally unit-tested with two sequential requests in the backend test file, but the mechanism — live re-read, no caching — is what makes the scenario true, and that mechanism is directly inspectable in the single query).
- **Postcondition, Success**: satisfied, matches AC1 + AC3.
- **Postcondition, Failure** ("a session is created with the Facilitator as a member... the failure state this use case exists to prevent"): test 2.3/2.6/2.7's `mockDbConnect` assertion is doing real work here — it's not just checking the response code, it's checking that the failure state literally cannot occur because the transaction never opens. That's the right thing to assert for a "this must never happen" postcondition.

## Notes section cross-check

- **"If the Facilitator is listed as a member of multiple teams, they are excluded from facilitating any of those teams."** Structurally true — the check is a per-`:teamId` query with no "home team" concept, so it generalizes to N memberships with no special-casing needed. I agree with Devon's read of the query shape on this point. I'll note, as Devon did, that there's no test that actually constructs a facilitator with multiple team memberships and confirms all are blocked independently — the generalization is architectural (no code path exists that could special-case a "first" or "primary" team), not test-proven. Low-risk given the query shape, but naming it for completeness since the use case calls this scenario out explicitly by name.
- **"This constraint applies at the time of session creation. If a Facilitator later joins the facilitated team, the historical session is not invalidated."** This is the one note I don't see addressed anywhere — not in spec.md's scenarios, not in the test file. There's no code path that would invalidate a historical session on a later membership change (there's no membership-change hook that touches `sessions` at all, as far as the file I read shows), so the property likely holds by absence of any mechanism that could violate it. But "nothing exists that could break this" is different from "this is verified," and it's a real note in the use case, not a throwaway one. I'd call this the one genuine, if narrow, gap in the mapping — not a defect, but an unverified claim.

## Out of Scope cross-check

- No exception path, admin override, or config flag exists anywhere near this check — confirmed by reading the full handler; there's no settings read, no feature flag, nothing conditionally skipping the `is_member` branch. Matches the use case's "no exceptions are defined."
- No code attempts to remove a user from their own team to enable facilitation. Not applicable, correctly absent.

---

## Final Verdict

**Yes, the use case is satisfied by shipped work on `main`, with two narrow gaps I'd want on record rather than silently accept:**

1. **Test-coverage gap, not a behavior gap:** the membership-exclusion `WHERE tm.id IS NULL` predicate in the eligible-teams query and the `removed_at IS NULL` predicate in the draft-session query are both correct on direct inspection, but neither is asserted at the query-text level the way the adjacent `deactivated_at IS NULL` predicate is (test 3.7). Given the test suite already established that pattern for one predicate in the same query, I'd ask for the same treatment on the other two rather than resting on code review alone for a rule this load-bearing.
2. **Genuinely unverified note:** the use case's "a later membership change does not retroactively invalidate the historical session" statement has no corresponding scenario in spec.md and no test. It's true by absence of any mechanism that could violate it, which is a reasonable state to ship in, but it is a note in the source use case that nothing currently confirms — worth a scenario if this capability gets touched again, not worth blocking on now.

Neither of these changes my answer to the question I was asked: this is not open work, and nothing here should reopen issue #46 or justify a new implementation change. Both gaps are testing/documentation follow-ups at most, addressable as small additions to the existing `session-creation` spec and test file whenever someone is next in that area — not scope for a new change directory. I'd support Devon's recommendation to close #46 against PR #153.
