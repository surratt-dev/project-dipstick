# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `restrict-team-005-em-promotion` (GitHub issue #109)
**Scope of this review:** architectural conformance of the shipped code to design.md's Decisions A-G, boundary/pattern consistency with the rest of `packages/`, and specific verification of the undocumented `logger` parameter threading (Decision A / task 2.1) across all call sites.

## Verdict

**Approved.** The implementation matches the design decisions precisely, follows existing codebase patterns rather than inventing new ones, and the one deviation from tasks.md (the `logger` parameter threading) was necessary, correctly scoped, and executed completely at every call site. No architectural concerns block this change.

## What I checked

- `design.md` (Decisions A-G, Open Questions, Risks) against the diffs in `team-content-access-helper.ts`, `teams.ts`, and `audit-logger.ts`.
- `tasks.md` against what actually shipped, specifically the §1 decision log, §2 (read-side), §3 (write-side), §4 (regression suite), §5 (requirements doc corrections).
- Every call site of `evaluateTeamAccess` in `packages/backend/src` (nine files reference it; six call it and required a signature-change edit; one, `session-subscriber-access-helper.ts`, only mentions it in a comment as a sibling function and was correctly left untouched).
- Test diffs in `teams.test.ts`, `team-content-access-helper.test.ts`, and `e2e-content-auth.test.ts`.

## Decision-by-decision conformance

**Decision A (read-side collapse to single dual-check path).** `team-content-access-helper.ts` now has exactly one path that can return `role: 'engineering_manager'` — the `membership_role === "engineering_manager"` branch that additionally requires `global_role === "engineering_manager"`. Path 1's participant sub-case and Path 2 are structurally separated as the design describes; there is no longer a fall-through that grants EM from `membership_role` alone. The comment block above the function was rewritten to describe what the code now does, closing the exact documentation-drift gap this proposal exists to fix (task 2.2) — I checked the new comment text against the actual `if` structure below it and they agree.

**Decision B (write-side unconditional block, ordering).** The block in `teams.ts` sits exactly where Decision B requires: after `checkAssignRolesAuthorization`'s 403 (line ~733-749) and after the no-op fast-path (line ~785-794), before `client.connect()` / the transaction (line ~810 onward). This ordering is load-bearing for the two reasons the design gives (no confirmation-of-block-existence leaked to unauthorized callers; no lock acquisition for a request that will be rejected), and it's correct. The check itself, `fromRole === "participant" && newRole === "engineering_manager"`, has no actor-role branch — confirmed no read of `actorGlobalRole` inside the conditional, satisfying Decision B/task 3.2's "unconditional, including Application Admin" requirement.

**Decision C (no admin-configurable exception).** Confirmed by inspection: no flag, env var, or config value is read anywhere on the path from the authorization check to the block. This was also independently verified by the test suite (`4.4`, `4.6` in the new describe block) rather than only asserted in a comment.

**Decision D (redirective error shape).** The 403 response names TEAM-006 by path and method, matches the tone of the two precedent responses cited (`teams.ts:734-737`, `:973-976`). Copy is correctly flagged in-code as provisional pending Facilitator sign-off (task 1.4) — this is the one open item and it's tracked, not silently shipped as final.

**Decision E (mismatched-state graceful degrade).** `evaluateTeamAccess` returns `role: 'participant'` (not `null`) when `membership_role === 'engineering_manager'` and `global_role` doesn't match, and emits `team.access_grant_mismatch` via `emitAuditEvent` before returning. The no-synchronous-DB-row reasoning is documented in both `team-content-access-helper.ts` (inline) and `audit-logger.ts` (on the `AuditEventName` union member) — duplicated deliberately in both places a future reader would look, which is the right call for a decision this easy to accidentally reverse.

**Decision F (blocked-attempt audit event).** `teams.ts`'s block writes a synchronous `audit_log` row (`team.role_change_denied`) via `db.query` before the error response, and calls `emitAuditEvent(request.log, ...)` alongside it — matching the `denyAdminContentAccess` precedent's shape (DB row + structured event, before the response). Scope is correct: it only fires after `checkAssignRolesAuthorization` has already passed, so it doesn't conflate "not allowed to touch this endpoint" with "allowed, but this transition is blocked," per the design's explicit requirement that these stay distinguishable signals.

**Decision G (detection control, not prevention).** No trigger, no CHECK constraint, no new migration — correctly. This was a documentation/decision-record item, not a code-diff item, and I have nothing to flag against the diffs on this point. (Tasks 1.6-1.8 are separate sign-off items, not implementation tasks — see Open Items below.)

## The flagged deviation: `logger: FastifyBaseLogger` threading

This is the part I was asked to scrutinize hardest, since it wasn't in tasks.md as written and touches the most-called authorization function in the codebase (design.md's own risk framing).

**Necessity:** Decision E requires `evaluateTeamAccess` to emit a structured log event on the mismatched-state branch. `emitAuditEvent` (`audit-logger.ts:204-227`) takes a `FastifyBaseLogger` and calls `.child({ audit: true })` on it, then explicitly overrides `.level = "info"` before logging — this is not a free-standing logger you can default to a module-level singleton; it has to be the request- or connection-scoped logger so the override and child-context tagging apply to the right log stream. There was no way to implement Decision E without either threading a logger into `evaluateTeamAccess` or having it reach for some ambient logger, and an ambient/global logger would have been the worse choice (loses request correlation, harder to test). Threading the parameter was the correct call, not scope creep.

**Completeness of the call-site update — verified by direct inspection, not by trusting the report:**

I grepped every file under `packages/backend/src` referencing `evaluateTeamAccess` (nine matches) and diffed each one individually:

| File | Call sites updated | Logger passed | Type |
|---|---|---|---|
| `routes/content.ts` | 5 | `request.log` | `FastifyBaseLogger` (Fastify request logger) |
| `routes/em-views.ts` | 6 | `request.log` | `FastifyBaseLogger` |
| `routes/action-items.ts` | 1 | `request.log` | `FastifyBaseLogger` |
| `realtime/ws-event-dispatcher.ts` | 1 | `logger` (in-scope param) | `FastifyBaseLogger` (declared type on the enclosing function) |
| `realtime/connection-reauthorization.ts` | 1 | `log` (in-scope param) | `FastifyBaseLogger` |
| `realtime/websocket-routes.ts` | 1 | `request.log` | `FastifyBaseLogger` |
| `auth/session-subscriber-access-helper.ts` | 0 (comment-only reference to a sibling function; does not call `evaluateTeamAccess`) | n/a | n/a, correctly untouched |

That's 15 call sites across 6 files, not the ~14 estimated in tasks.md — close enough that the estimate was reasonable, and I found no missed site. Every one of them passes a real, request- or connection-scoped `FastifyBaseLogger` — I checked the type annotations at each enclosing function signature (`runSweepCheck`'s `log: FastifyBaseLogger`, `dispatchTopicHistoryUpdate`'s `logger: FastifyBaseLogger`, etc.) rather than trusting the variable name. None of them is a null logger, a no-op stub, or a narrowed interface that would silently swallow `emitAuditEvent`'s `.child()`/`.level` calls. The test-file mock (`MOCK_LOGGER = {} as Parameters<typeof evaluateTeamAccess>[2]`) is fine — it's paired with a full `vi.mock` of `emitAuditEvent` itself in both `team-content-access-helper.test.ts` and `e2e-content-auth.test.ts`, so the logger's own methods are genuinely never invoked in that test path; the empty-object cast doesn't mask a call site that would break in production.

**Boundary consistency:** the pattern of passing `request.log` (or a request/connection-scoped equivalent) into helpers that need to emit audit events already exists elsewhere in this codebase — `emitAuditEvent(request.log, ...)` is called directly in the `teams.ts` handler itself, and the realtime layer already threads `logger`/`log` through its dispatch functions for connection-expiry logging (`isConnectionExpired(conn, logger)`). Adding one more parameter to `evaluateTeamAccess` for the same purpose is consistent with how this codebase already does it, not a new pattern introduced under time pressure.

## Boundary and pattern review (general)

- **Server-side enforcement, not UI-trust.** Both fixes are entirely in `packages/backend`; nothing here relies on frontend behavior to enforce the restriction. Consistent with my standing concern about authorization logic leaking into the frontend — it doesn't, here.
- **No new abstractions invented.** Decision A reuses the AND-logic shape already present in `checkAssignRolesAuthorization` rather than inventing a new authorization primitive. Decision E reuses the OIDC claim-rejection "degrade safely, log loudly" shape from `account-resolver.ts`. Decision F reuses `denyAdminContentAccess`'s audit shape from `content.ts`. This is exactly the "don't over-engineer, don't introduce a fourth pattern where three exist" instinct I look for — three separate decisions in this design each explicitly cite and reuse an existing precedent rather than adding a new one.
- **Ephemeral vs. persistent boundary respected.** `team.access_grant_mismatch` (high-volume, runs on every content request) is correctly log-only. `team.role_change_denied` (low-volume, human-scale admin action) correctly gets a synchronous `audit_log` row. This is the right classification and matches the existing rate-limiter precedent's reasoning for the same log-only/DB-row split.
- **No DB-layer prevention control was added, and that's correct.** Decision G's reasoning (a CHECK constraint can't see `OLD`, a transition-aware trigger would break TEAM-006's own upsert without session-variable plumbing) is sound schema-level reasoning, and I would have made the same call. Detection-control-only is the right scope for this change; introducing trigger plus session-variable tagging here would have been unjustified complexity for a risk the application-layer check already covers.

## Open items (not blocking this review, tracked in tasks.md)

- Task 1.4: exact error copy/status pending Facilitator sign-off — code is correctly flagged provisional.
- Tasks 1.6/1.7/1.8: production-data backfill decision, historical mislabeling decision, TEAM-006 zero-Engineers warning decision — these are sign-off/decision-record items assigned to me (Solution Architect) or another named owner, not implementation gaps. I'll address 1.6 and 1.8 as separate decision records; they don't affect whether this diff is architecturally sound.
- Task 6.4: sign-off confirmation that 1.6-1.8 were each closed before archive — still open, tracked correctly as a gate on archiving rather than on this code review.

None of the open items above represent a defect in the code reviewed here.
