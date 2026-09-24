# BA Review — tasks.md (join-link-redemption-wiring, #166)

Reviewer: Marcus Delgado (Business Analyst)
Scope: does tasks.md, taken as a whole, cover everything proposal.md and the spec deltas commit to; did anything from the design-review revision pass fail to land as a concrete task; will the three #166 acceptance criteria actually be satisfied.

## Verdict

Mostly yes, with one real gap I'd block on, plus two minor ones worth a look before this moves to implementation.

## 1. Blocking: the "active" predicate is not actually shared — tasks.md doesn't create the shared definition the spec requires

`specs/join-link/spec.md`'s new "Get-or-create join link" requirement is explicit and unambiguous on this point:

> "Get-or-create and redemption SHALL check this condition by construction from one shared definition, not two independently-maintained copies of it."

I went and read the current redemption check to see what "shared" would mean in practice. `packages/backend/src/routes/join-links.ts:143-183` (`GET /api/join/:token`) does **not** encode "active" as a SQL predicate at all — it fetches the row unconditionally by token, then evaluates two separate JS conditionals: `if (link.revoked_at) {...}` and `if (new Date(link.expires_at) < new Date()) {...}`.

Task 2.1 says: "SELECT the team's active `join_links` row (`revoked_at IS NULL AND expires_at > NOW()`)... " — a SQL-level `WHERE` predicate.

These are two different mechanisms encoding the same rule in two different places, in two different languages (SQL vs. JS date comparison). That is exactly the "two independently-maintained copies" the requirement rules out — not hypothetically, it's the current state of the codebase the moment Task 2.1 is implemented as written. Nothing in tasks.md instructs anyone to extract a shared definition (a SQL fragment, a shared constant, a helper both call, or a refactor of the redemption check to use the same query shape) or to touch `join-links.ts`'s redemption logic at all.

This isn't pedantry: it's the specific failure mode this proposal exists to close (proposal.md's own framing — two systems that drift because nobody wired them together). If get-or-create's SQL-side "active" and redemption's JS-side "active" are ever changed independently — say, someone adds a grace period to one and not the other — you get exactly the "technically complete, functionally invisible" bug class design.md names as the recurring pattern in this area. Today the two checks are equivalent by inspection; tasks.md as written has no task that makes them equivalent *by construction*, and no task even touches the redemption side to reconcile it.

**Recommendation:** add a task, most naturally under Section 1 or 2, to extract the "active" predicate into one shared place (e.g., a SQL WHERE-fragment constant, or a small shared helper) used by both the get-or-create SELECT and `GET /api/join/:token`'s validation — refactoring the latter's two `if` blocks to consume it rather than reimplementing the same rule in raw JS. If the team decides this is out of scope for #166, that's a legitimate call, but it should be a stated decision in design.md (like Decision 3's race-acceptance reasoning), not a silent gap between spec language and task list.

## 2. Minor: no test asserts POST /draft's miss-path does *not* re-issue a global_role lookup

Task 2.4 explicitly covers the `facilitator-state` miss-path lookup "resolving correctly and only firing on a miss" — good, that's the one design.md calls a blocking gap. But the spec's parallel bullet for `POST /draft` says its `actor_global_role` value flows from the value "already resolved and confirmed earlier in that same handler — no additional lookup." Task 2.4's list has nothing verifying the `POST /draft` path continues *not* issuing a redundant `SELECT global_role`. Low severity — a regression here wastes a query, it doesn't break correctness — but since Task 2.4 already itemizes the equivalent negative-condition test for the other call site, it reads like an intentional omission rather than a decision. Worth a one-line addition if the team wants parity, or an explicit note if not.

## 3. Minor: "no duplicate creation logic" scenario has no independent test

`specs/join-link/spec.md`'s "No duplicate creation logic" scenario is satisfied structurally by Tasks 1.1/2.1 (get-or-create's miss branch calls the Task 1.1 function), not by anything in Task 2.4's test list. That's probably fine — it's an implementation-shape requirement more naturally enforced by code review than a runtime assertion — but flagging it since it's the one scenario in that spec section with no corresponding line in Task 2.4.

## Design-review revision pass — verified all four items landed in tasks.md

The prompt asked me to specifically check that the propose→design revision pass didn't lose anything in the handoff to tasks.md. Checked each:

- **`actor_global_role` lookup added for `facilitator-state`'s miss path** — Task 2.3 states it explicitly, including the exact query and the "paid only on miss" condition. Task 2.4 has a corresponding test line. Present.
- **Helper extraction widened (token/expiry generation + post-commit `emitAuditEvent`, not just the transaction call)** — Task 1.1 states the widened boundary explicitly and even names the original narrower framing as the thing being corrected ("Revised per engineer review"). Present, and unusually well-annotated — a reviewer six months from now will understand *why* the boundary is what it is without re-reading design.md.
- **`joinToken` field dropped from `POST /api/v1/teams`'s response** — Task 4.2 covers the field removal, the "verified unconsumed by frontend" reasoning, and the corresponding test-assertion update. Present.
- **Two test files moved into Commit 1** (`facilitator-sessions.test.ts`'s `facilitator-state` block, `http-session-expiry-no-partial-execution.test.ts`) — Task 2.5 lists both by name with line numbers, and Task 4.5 explicitly draws the boundary ("This commit does not touch the five backend test files below — Migration A does not break them"). Present, and the two-commit split is unambiguous throughout Section 4.

All four items from the revision pass are concretely represented as tasks, not just as design.md prose. I did not find anything from that pass that got left behind in translation.

## Acceptance criteria (#166) — will tasks.md, as a whole, satisfy all three?

1. **"The join link a Facilitator sees and shares resolves to a real, redeemable `join_links` row."** — Yes, via Tasks 2.1–2.3 (get-or-create wiring into both response sources) plus Task 3.1 (URL path fix). Modulo the Section 1 gap above, which is about the *robustness* of the "active" check staying correct over time, not about whether it's correct today.
2. **"GET /api/join/:token successfully admits a participant using the link the Facilitator was shown, verified end-to-end through the actual frontend-constructed URL."** — Yes. Tasks 5.1–5.2 are explicit that this must drive the actual rendered/copied URL string through to a real redemption, and 5.2 requires demonstrating the test would have caught both original bugs (dead token, wrong path). This directly answers design.md's stated concern (a test that only calls the backend route in isolation would have missed the frontend path bug) and I don't see it watered down anywhere in the task list.
3. **"`sessions.join_token`'s role after this fix is explicitly documented (removed, per this design)."** — Yes. Section 4 removes it in full (column, constraint, index, all INSERT/SELECT sites, dead type, stale JSDoc), split across two commits for rolling-deploy safety, and Section 6 requires the scope/ship-order decisions to be visible in the merged change for a reviewer. The removal itself and its documentation are both concrete tasks, not left implicit.

## Bottom line

Tasks 1 through 6 correctly and thoroughly translate proposal.md, design.md, and the spec deltas — including catching every item from the design-revision pass I was asked to spot-check. The one place I'd send this back before implementation starts is Section 1: the "active" predicate needs an actual shared definition, not two independently-written checks that happen to agree today, per the spec's own explicit "not two independently-maintained copies" language. That's a small addition, not a rethink of the approach.
