# BA Review — `cross-team-facilitator-constraint` Proposal

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** proposal.md, design.md, specs/session-creation/spec.md, tasks.md
**Verified against:** `requirements/use cases/02 - Session Setup - Use Cases.md`, `packages/backend/src/routes/facilitator-sessions.ts`, `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts` (current `main`, HEAD `f84dd51`)

## Bottom line

One of the two gaps is buildable as written. The other is not — it's specific about *what* it wants to prove but not about *how* a mocked-DB unit test can prove it, and one of the two example read-paths it names doesn't exist in the form the task claims. I don't think this needs to go back to Design, but tasks.md Section 3 needs one more pass before an implementer picks it up.

---

## Gap 1: Query-text assertions (tasks 1.1, 1.2, 2.1, 2.2) — buildable as written

I checked both predicates against the actual code, not just the design doc's description of it.

- **Eligible-teams query** (`facilitator-sessions.ts:1827-1834`): the query text is exactly `LEFT JOIN team_memberships tm ... WHERE tm.id IS NULL AND t.deactivated_at IS NULL`. Task 1.1 tells the implementer which describe block, which existing test to sit next to (3.7), which `.find()` predicate to key on (`"FROM teams"`), and the exact substrings to assert (`"LEFT JOIN team_memberships"`, `"WHERE tm.id IS NULL"`). That's everything needed to write the test without coming back to ask what was meant.
- **Draft-session actor query** (`facilitator-sessions.ts:204-213`): text is `SELECT u.global_role, (tm.id IS NOT NULL) AS is_member FROM users u LEFT JOIN team_memberships tm ... AND tm.removed_at IS NULL WHERE u.id = $1`. Task 2.1's description ("the actor query call — the one selecting `global_role` and `is_member`") uniquely identifies this query; nothing else in this handler's request path selects those two columns. Task 2.2's concern about isolating it from the team-exists check and the audit-log insert is real but already resolved by the query text itself — `"FROM users"` doesn't collide with either of those, so the `.find()` predicate can't accidentally match the wrong call. Confirming that in the test (2.2) is good practice, not a gap.

Both tasks name the exact file, the exact describe block, and the exact string to assert. An implementer doesn't need to reconstruct intent here — this is exactly the standard I hold requirements to.

---

## Gap 2: Historical-session non-invalidation coverage (task 3.1) — not yet buildable as written

This is the one I'd stop and fix before implementation starts. Two separate problems:

### 3.1(a) — the two named example read-paths aren't equivalent, and one doesn't exist yet

Task 3.1 says: *"a read of the existing session (e.g. via the facilitator-state or facilitator-session read path **already covered elsewhere in this file**)"*.

I grepped the test file for `facilitator-state` coverage. There isn't any — no `describe` block, no `it(...)` referencing that endpoint anywhere in `facilitator-sessions.test.ts`. The endpoint exists in the route file (`GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state`, added for Task 10.3), but it is not "already covered elsewhere in this file" the way the task asserts. If an implementer goes looking for an existing pattern to mirror, as the task instructs, they won't find one there.

More importantly, that endpoint's query never touches `team_memberships` at all — it's a straight `SELECT ... FROM sessions WHERE id = $1 AND team_id = $2`, gated only by `facilitator_id === userSession.userId`. A test built on this endpoint has nothing to vary between a "before" and "after" mock — the response is identical regardless of whether a membership row exists, because the query never asks. That will pass, but it won't be testing what the task claims it's testing; it'll just be re-confirming this endpoint's existing behavior under a new label.

The other named option, `action-items-review`, *is* genuinely covered elsewhere in the file, and its access grant does read `team_memberships` (via `evaluateSessionSubscriberAccess`) — but that's a different claim than the one in scope here. That helper decides whether the *caller* has standing to read the session; it isn't evidence about whether the *session row itself* is invalidated. Using it to prove "the session is unaffected" would actually be proving something adjacent, not the thing the spec scenario states.

**What I'd want changed:** pick one endpoint, not an "e.g." pair, and if it's `facilitator-state`, drop the "already covered elsewhere in this file" claim — it isn't true today and shouldn't be asserted as a given.

### 3.1(b) — the task doesn't say how to represent "membership subsequently acquired" in a mocked-DB test

Design.md's own analysis (which I agree with) is that no code path reads `team_memberships` when reading a session — that's *why* there's nothing to invalidate. But that same fact means there's no lever in a mocked-DB test to flip from "before" to "after" a membership change, on any of the read paths named. The task describes an action ("read the session, confirm it's unchanged") that presupposes a before/after comparison, but nothing in the codepaths named actually branches on membership state, so there's nothing to compare.

Design.md's justification leans on an analogy to this file's existing `"... — documented reference"` blocks (`Draft session expiry`, `Grace window behavior`) as precedent for "the same shape." I checked those — they are not executable behavioral tests. They are `expect(true).toBe(true)` with a comment pointing at where the real coverage lives in a different file. That's a materially different shape than "call an endpoint, get a response, assert fields," which is what task 3.1 actually describes. The analogy in design.md and the instruction in tasks.md don't match each other.

**What I'd want changed, one of two ways — implementer's call is fine, but it needs to be an explicit choice, not left open:**
1. Write task 3.1 as a documented-reference test in the same no-op shape as the two existing ones (a grep-backed assertion, in prose, that no code path joins `sessions` to `team_memberships` for the purpose of invalidation — matching what design.md actually found), or
2. Name one concrete endpoint and describe the exact mock sequence that represents "membership acquired after creation but the session read is unaffected" — which, given (a) above, will need to be a test that creates the session, then asserts the read endpoint's response shape is driven only by the `sessions` row and never queries `team_memberships` at all (i.e., assert the *absence* of a `team_memberships` query in that call's mock sequence, not a before/after comparison of its result).

Either is fine with me. Leaving it as "e.g. X or Y" is not — that's exactly the kind of ambiguity that sends an implementer back to ask what was meant, which is the outcome I try to design out of every requirement I write.

---

## proposal.md is inconsistent with its own attached artifacts

Proposal.md's Capabilities section says: *"No requirement text changes"* for `session-creation`, and the Impact section frames the spec.md change as conditional: *"only if a spec note (rather than a test) turns out to be the better vehicle."*

That's not what actually happened. `design.md`'s Decisions section already resolved this ("Add the clarifying scenario to the existing MODIFIED requirement... rather than opening a new requirement" — stated as a decision, not an option), `tasks.md` task 3.2 treats the spec addition as **already drafted** and just needs verifying, and I read `specs/session-creation/spec.md` directly — the new paragraph and the fifth scenario ("A facilitator joining the facilitated team after session creation does not invalidate the existing session") are already there, unconditionally, alongside the test in task 3.1 (this was never an either/or between a test and a spec note — both are happening).

Proposal.md reads like it was written before that decision was made and not updated after. I'd fix the Capabilities and Impact sections to state plainly: the requirement text changes (an additive paragraph and one scenario, not a new requirement), and both the test and the spec note are in scope. As it stands, someone reading only proposal.md — which is the document most likely to be read in isolation, e.g. by someone triaging #46 later — would come away with a wrong picture of what shipped.

---

## spec.md scenario vs. the use case — accurate, with one minor overreach

The use case's Notes section (`02 - Session Setup - Use Cases.md`, "Facilitator Team Membership Constraint Violation") states: *"This constraint applies at the time of session creation. If a Facilitator later joins the facilitated team, the historical session is not invalidated."*

The new spec.md paragraph and scenario 5 map onto this accurately and the scenario's WHEN/THEN structure is a faithful translation of the use case language. One thing worth naming, not blocking: spec.md generalizes the use case's one-directional statement ("later joins") into a bidirectional claim — *"in either direction — the facilitator joining the facilitated team, or leaving it."* The "leaving it" half describes a state that can't actually be reached for this specific team: the precondition for creating the session in the first place is that the facilitator was *not* a member of the target team, so there's no membership to "leave" with respect to that same team unless they first joined it — which is already the "joining" case. It isn't wrong, it's just not sourced from the use case and doesn't correspond to a distinct reachable scenario. I'd either cut it or replace it with something that does trace back to a real precondition, in keeping with the traceability standard the rest of this spec holds to. Low priority — I wouldn't block the change on it, but I'd fix it in the same pass as the Section 3 rewrite above.

---

## Summary for the team

- **Gaps 1 (tasks 1.1, 1.2, 2.1, 2.2):** ready to implement directly. No changes needed.
- **Gap 2 (task 3.1, and its dependent 3.2):** needs a rewrite before implementation — name one concrete endpoint (or explicitly choose the documented-reference no-op shape), and drop the false claim that `facilitator-state` already has test coverage in this file.
- **proposal.md:** Capabilities/Impact sections are stale relative to design.md/tasks.md/the actual spec delta — fix before merge so the proposal doc doesn't misrepresent what's already been decided and drafted.
- **spec.md:** accurate against the use case; optional cleanup on the "or leaving it" clause, not blocking.

None of this changes the verdict that this is a small, additive, test-only change with no design decision left to make on the substance. It does mean Section 3 of tasks.md isn't quite at the "build it without asking" bar yet — the other three sections are.
