# Implementation review: Solution Architect (Ingrid Sollenberger)

Change: zero-topic-team-recovery (#200). Branch agent-team/200-zero-topic-team-recovery, uncommitted tree.
Reviewed against design.md (D1-D10). Scope of my review: boundaries, consistency with existing patterns, authorization enforcement point, transaction/lock discipline, audit design. Not reviewed: UX, domain model.

## Verdict

No blocking findings. The implementation matches the design closely. Four non-blocking items need a recorded decision or a follow-up before merge, and one of them (N1) should go to the PO.

## What I checked and found consistent with the design

- **Authorization is server-side and live (D2).** `checkAssignDefaultsAuthorization` in `routes/topics.ts` reads `users.global_role` at request time, uses the single exported `isApplicationAdmin` predicate (`auth/role-map.ts`), treats a missing row as non-admin, and does not use `checkStandingFacilitatorOrAdminAuthorization`. The same predicate computes `canAssignDefaults` in `routes/content.ts`, so the UI flag and the endpoint cannot drift. The flag is never read back from a client.
- **Check order (D2).** canonical-id 404, lowercase, admin 403 (audited), shared rate limit, `checkWritableTeam`, no lock gate, then the transaction. Order is as designed.
- **Transaction and lock discipline (D2/D3).** Default isolation, `lockTeamTopics` (advisory xact lock), zero-active count as a fresh statement after the lock, `copyCanonicalDefaults`, in-transaction fail-closed audit insert, COMMIT. Every exit path ends in COMMIT or ROLLBACK and `client.release()` in `finally`, and the error is never rethrown (no echo of `err.message`). `applyTimingFloor` runs on every return. `emitAuditEvent` after commit is wrapped. Matches D2 steps 6-9.
- **Error codes (D4).** `NOT_AN_ADMIN`, `TEAM_HAS_ACTIVE_TOPICS`, `DEFAULT_TOPICS_UNAVAILABLE`, `ASSIGN_DEFAULTS_FAILED` are distinct. The empty-template 500 and the generic 500 are not conflated, and the frontend keys on code, with unknown 500 codes falling to the generic line (`assignDefaults.ts`).
- **Lock-gate code unchanged.** `checkCustomizationLockGate` is untouched. The new permanent source test (`assign-defaults-lock-gate-source.test.ts`) pins "four gated routes call it, assign-defaults does not and does not read lock state any other way". This is the control I most wanted and it is there. The zero-topic invariant test is also present.
- **B1 (D2a).** `copyCanonicalDefaults` now returns `string[]` via `RETURNING id`; `POST /api/v1/teams` ignores it, so behavior is unchanged. `DefaultTopicsUnavailableError` is a separate class with a no-identifier message. Good.
- **B2 (D9) helper extraction.** `auth/fail-open-topic-audit.ts` carries the explicit-cast SQL, the `LEFT JOIN users` role capture, the timeout and the `topic.audit_write_failed` emission, parameterized by operation and endpoint. TOPIC-002 now calls it with its own constants and metadata shape unchanged (`endpoint`, `http_status`, `reason`; `extraMetadata` is spread after, empty for TOPIC-002). `sqlstateOf` moved with it, keeping a single "SQLSTATE only" rule. The pattern is a clean extraction, not a fork.
- **S3 per-actor bound.** `auth/denial-audit-limiter.ts` reuses `recordAndCountSlidingWindow` under its own key namespace, 10/min, once-per-window suppression event, store error fails to "no row, log only". TOPIC-002 adoption is correctly left as a follow-up.
- **B3 (D3a).** `defaultTopicsNotActive` uses the lateral join preferring the active match, with a real-Postgres test.
- **Audit (D5).** Four new `AuditEventName`s are registered in `auth/audit-logger.ts`. Success row is in-transaction with counts and correlation id only. Denial and failure rows go through the shared helper; the failure row is written after ROLLBACK on the pool so it survives.
- **Boundaries.** Route stays in `routes/topics.ts` so the scanning source tests stay meaningful. The seams `recordDenial` / `recordFailure` in `auth/assign-defaults-audit.ts` localize the PO fallback (item 4/5) to one function body. Frontend keeps `ActiveTopicsEmptyState` presentational and puts in-flight state, messages and focus in the page (D7). `activeEmptyStateVariant` is the single decision point and treats a missing flag as fail-closed. Shared type `canAssignDefaults` is required, as designed. No schema change.
- **Type check.** `tsc` reports no errors in any non-test source file or in any new assign-defaults/denial file; the errors that appear are in older test files (null session getters, possibly-undefined) and are not introduced by this change.

## Flagged items from the implementer

### F1. Failure-copy wording invented: "The default topics couldn't be assigned. Try again." (non-blocking)
The specs say "the existing generic write-failure message" but no such constant exists on this screen, so a new string was added (`TopicManagementPage.tsx`, modeled on `ADD_RETRY_MESSAGE`). Architecturally this is fine: it is a fixed string, carries no server text, and is consistent with how the screen treats other writes. It is a copy decision, so it needs BA/PO confirmation at PR review (the implementer already says so). Recommend: record the string in the topic-management-screen spec so the spec and code agree, and so a later reviewer does not rediscover it. Not a merge blocker.

### F2. Draft-page copy gap, and its larger consequence (N1) (non-blocking, escalate)
Task 1.5 recorded two findings, and the second is bigger than the design assumed.
1. The draft host still says "Add or restore a topic on Topic Management" for a locked zero-topic team. This is the known D10 gap. Accepted by design, follow-up 8.4(d).
2. New and more important: the `409` branch of `openTheRoom()` in `DraftSessionHost.tsx` ignores the server's message when its refetch succeeds. So the new locked-team "Ask an application administrator..." message (session-creation delta, D8) reaches a browser user only if the refetch fails; the draft page keeps showing the misleading "Add or restore" line. D7/D10 reasoned that the room-open message plus the intact draft "cost one retry", which assumed the facilitator would see the correct message. In the browser they mostly will not.

Consequence: the facilitator-facing half of the recovery (tell the facilitator who to ask) is largely not delivered in the UI, even though the API and the spec scenarios pass. Admin recovery still works end to end, so this does not block the endpoint. I do not want the implementer to widen scope silently. Recommendation: send this finding to the PO now, and decide before merge whether to (a) make the 409 branch display the server message when it is the locked-zero variant (small, local to the host; no lock-state or role plumbing needed because the server already chose the text), or (b) accept and file 8.4(d) with a raised priority. Option (a) is cheaper than the D10 alternative of adding lock state to the draft page. Whichever is chosen, task 8.4(d) must say that the room-open message is rarely visible, so the follow-up is not understated.

### F3. `assignBlockedReason` extra prop on `ActiveTopicsEmptyState` (non-blocking)
Design D7 named three required props (`canAssign`, `assigning`, `onAssign`). A fourth required prop `assignBlockedReason: string | null` was added so the button is disabled by the same busy states that block Add, which D7 also requires ("Busy gating"). The page sets it as `assignBlockedReason = addSubmitBlockedReason`. This is a consistent reading of D7: the requirement existed, the prop name did not. It stays presentational and required (a forgotten call site is a type error), which matches the pattern used for `addAllowed`. Accept. Two small notes: update the D7 prose or the tasks record so the prop list is accurate, and the `aria-describedby` reason text uses an inline `#616161`; that is the same literal other states on this component use, so I am not asking for a change.

### F4. Existing structural guard tests altered (non-blocking, one request)
Three existing guard tests were edited. I read every changed line.
- `topic-write-template-guard-structural.test.ts`: adds the new route to the route list and introduces `ADMIN_ONLY_ROUTES` so that route is exercised as an admin. Necessary: a facilitator gets 403 before the guard is reached. The guard assertion itself (404 plus one `topic.write_denied_template` row with the route key) is unchanged and now covers the new route. Legitimate.
- `topic-write-rate-limit-placement-integration.test.ts`: same admin-only handling, plus an admin app with its own seeded budget. Legitimate; the placement assertions are unchanged.
- `topic-write-rate-limit-structural.test.ts`: the importer allow-list for `auth/sliding-window-limiter.ts` now includes `auth/denial-audit-limiter.ts`, and a new test pins that the denial limiter is imported only by `auth/assign-defaults-audit.ts`, which only `routes/topics.ts` imports. This is the one change that loosens an existing architectural guard. I accept it because the new importer is deliberate, narrowly pinned, and design D9 calls for the shared primitive. No existing assertion was weakened beyond that one allow-list entry. Request: note this loosening in the PR description so a reviewer sees that a guard was widened on purpose.

I found no case where an existing assertion was deleted or relaxed to make something pass.

## Additional non-blocking findings

### N2. Dynamic import in `recordDenial` (non-blocking)
`auth/assign-defaults-audit.ts` does `await import("./denial-audit-limiter.js")` inside the function so that unit tests that mock `db.js` but not `redis.js` do not construct a Redis client. I found no other production `await import(` in the backend. The comment justifies it and the structural test accounts for it, but it is a production-code shape chosen to suit test mocking, and it adds a module-load on the first denial. Acceptable now. Preferred later: static import plus a mocked limiter in those tests, or inject the admission function. Not worth delaying the merge; record it in the follow-ups so it is not copied elsewhere.

### N3. Settled 500 string duplicated in backend and frontend (non-blocking)
`DEFAULT_TOPICS_UNAVAILABLE_MESSAGE` is a literal in `routes/topics.ts` and `ASSIGN_TEMPLATE_UNAVAILABLE_MESSAGE` is a second literal in `TopicManagementPage.tsx`. The design wants a "settled string", and the frontend deliberately does not render server text, so duplication is intended. The risk is silent drift. A test asserting both equal the spec string would pin it; if one exists in the new suites, no action. Low risk.

### N4. Operability notes (non-blocking, confirm in runbook)
- The runbook section "Zero-topic teams" in `docs/deployment.md` is referenced by the user-visible 500 message. It is modified in the tree; confirm before merge that the heading text matches exactly, since the app cannot link to it.
- Redis outage makes admin recovery unavailable (the topic-write limiter fails closed with 503; the denial-audit limiter fails to "no row"). This is accepted in design Risks; the runbook should say the manual DB path is the last resort.
- The `trust proxy` pre-production checklist item (D2 principal-trust note) should appear in the pre-production list; I did not verify it.

## Open items carried by design, not by this review
Task 8.4 (follow-up issues) is unchecked, as expected before merge. It must record: FR-8.6 residual, restore name-collision check, TOPIC-002 adoption of the denial bound, the draft-page copy follow-up (with F2's added finding), and the security threat-model update for "application_admin may write canonical topics into a locked team".

## Summary table

| ID | Item | Class |
|----|------|-------|
| F1 | Invented failure copy | Non-blocking; confirm and record in spec |
| F2 | Draft-page copy gap; 409 message ignored on successful refetch | Non-blocking; escalate to PO before merge |
| F3 | Extra required prop `assignBlockedReason` | Non-blocking; accepted |
| F4 | Existing guard tests altered | Non-blocking; legitimate; mention allow-list widening in the PR |
| N2 | Dynamic import in `recordDenial` | Non-blocking |
| N3 | Duplicated settled 500 string | Non-blocking |
| N4 | Runbook heading, Redis-outage note, trust-proxy checklist | Non-blocking; verify |

Blocking findings: none.
