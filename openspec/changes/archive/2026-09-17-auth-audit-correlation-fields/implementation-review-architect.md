# Implementation Review — Architect (auth-audit-correlation-fields)

Reviewed by: Ingrid Sollenberger (Solution Architect)

**Verdict: Approve.** The implementation matches design.md exactly. No boundary
violations, no scope creep, no pattern drift from the codebase's existing audit-logging
conventions. Test suite passes (40/40).

## What I checked

**1. Same `correlationId` binding reused, not re-minted.**

Confirmed by reading `packages/backend/src/routes/auth.ts:119`: `correlationId` is bound
once, via `crypto.randomUUID()`, before the `try` block at handler entry. All three new
call sites read that same binding by reference — no new `crypto.randomUUID()` call
anywhere in the diff:

- `auth.callback_received` (line 171-176): adds `correlationId` (it already had
  `sourceIp`).
- `auth.session_created` (line 280-285): adds both `sourceIp: request.ip` and
  `correlationId`.
- `auth.success` (line 287-294): adds both `sourceIp: request.ip` and `correlationId`.

This is exactly the field shape already used by `auth.first_access_created` (line 228)
and `auth.role_claim_mapped` (line 243), and exactly what design.md's Decisions section
calls out as the one implementation discipline that matters here. No new pattern was
invented; the existing one was extended to three sibling sites. Consistent with the rest
of `packages/` — this handler is the only place this pattern lives, and it's now applied
uniformly within it.

**2. Cross-event identity asserted via `toBe()`, not just presence.**

Confirmed in `packages/backend/src/routes/__tests__/auth.test.ts`:

- Success path, `first_access_created` branch: captures `correlationId` off the
  `auth.callback_received` call and asserts `auth.first_access_created`,
  `auth.session_created`, and `auth.success` all `toBe()` that same value.
- Success path, `role_claim_mapped` branch (task 2.2b, new test — "should emit
  role_claim_mapped with matching correlationId for returning users with a non-default
  globalRole"): mocks `resolveOrCreateAccount` to return `{ isNewUser: false, globalRole:
  "admin", ... }`, triggering the `role_claim_mapped` branch instead, and runs the same
  four-way `toBe()` chain against it.
- Failure path (missing-claims rejection test): asserts `auth.failure`'s `correlationId`
  `toBe()`'s `auth.callback_received`'s.

All three required identity checks use direct value equality (`toBe`), not
`expect.any(String)` independently per event — this is the actual risk the proposal names
(a same-shape, fresh-UUID-per-site implementation that passes field-presence tests while
being useless for tracing). The tests would catch that failure mode.

**3. Scope discipline — nothing outside the declared boundary was touched.**

`git diff main --stat` for the full repo shows exactly two files changed:
`packages/backend/src/routes/auth.ts` (+5) and
`packages/backend/src/routes/__tests__/auth.test.ts` (+119), 124 lines total, all
additions, zero deletions. Specifically confirmed absent from the diff:

- No change to `emitAuditEvent`'s signature or to `audit-logger.ts`.
- No change to `join.link_rejected`/`join.link_redeemed` or to `executeJoinFlow`
  (auth.ts:541) — correctly left alone, consistent with the design-review-disposition.md
  correction that `correlationId` is not free in that closure and would need explicit
  parameter-threading as a separate follow-on.
- No change to the `missingClaim: "sub"` vs. `"id_token"` precision note.
- No `session.destroy()` test additions.

This is a clean three-field, additive-only diff, exactly matching the proposal's stated
Impact section.

**4. Test suite.**

Ran `cd packages/backend && npx vitest run src/routes/__tests__/auth.test.ts`:

```
✓ src/routes/__tests__/auth.test.ts (40 tests) 291ms
Test Files  1 passed (1)
Tests  40 passed (40)
```

All 40 tests pass, including the 3 new/extended assertions blocks for tasks 2.1, 2.2,
2.2b, and 2.3.

## Notes

Nothing to add beyond the above. This closes the gap I flagged in the first-access
implementation review (Finding 1) cleanly, without expanding scope beyond issue #4. The
deferred items (join-flow parameter threading, `role_claim_mapped`'s own dedicated
presence test prior to this change, logger-level enforcement) remain correctly out of
scope and are already tracked in design.md's Non-Goals — no new follow-on items from this
review.
