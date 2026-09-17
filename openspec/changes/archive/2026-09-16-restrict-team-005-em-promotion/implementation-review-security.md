# Security Review — restrict-team-005-em-promotion

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-09-16
**Scope:** Implementation of the fix for GitHub issue #109 (threat-model.md Scenario 1, finding 1.3), against `design.md`'s Decisions A, B, E, F.
**Verdict: Closes the finding. Approved, with two non-blocking gaps flagged below (one documentation, one test-coverage explicitness) and the pre-existing open items from tasks.md §1/§6 restated as still open.**

---

## 1. Does this close finding 1.3?

Yes, on both halves I identified in the threat model.

**Read side (Decision A).** `team-content-access-helper.ts` no longer has a path that returns `role: 'engineering_manager'` from `membership_role` alone. I traced the new control flow: `membership_role === 'participant'` returns participant; `membership_role === 'engineering_manager'` branches again on `global_role === 'engineering_manager'` before granting the EM role, otherwise degrades (see §2). There is exactly one path to an EM grant, and it requires both columns, read live in the same query — this is what Decision 14 always specified and what the comment block previously (and wrongly) claimed was already true. The comment now matches the code.

**Write side (Decision B).** `teams.ts`'s TEAM-005 handler rejects `fromRole === "participant" && newRole === "engineering_manager"` unconditionally, before the transaction opens, for every actor — I confirmed there is no `actorGlobalRole` branch anywhere near this check (`teams.ts:817`). This closes the specific bypass in finding 1.3: an EM in good standing on Team A can no longer use TEAM-005 to grant a second, ungoverned EM relationship, whether the target's `global_role` is the default `engineer` or already `engineering_manager` from legitimate standing elsewhere. My threat-model writeup was explicit that the read-side fix alone leaves the cross-team-EM variant open (target already holds `global_role = 'engineering_manager'` from Team B) — this implementation closes that variant too, because the write-side block doesn't inspect the target's `global_role` at all; it blocks the transition unconditionally regardless of what the target already holds.

Both fixes are present, which is what my original recommendation required ("both fixes are required, and neither is optional hygiene" — threat-model.md line 72).

## 2. Decision E — mismatched-state degrade

Implemented as I specified in design review: `membership_role = 'engineering_manager'` with `global_role != 'engineering_manager'` returns `role: 'participant'`, not `null`, not a 403, plus the log-only `team.access_grant_mismatch` event carrying `userId`, `teamId`, `globalRole`, `membershipRole` — matching the field list in Decision E exactly. No synchronous `audit_log` row, correctly reasoned in the code comment (this function runs on every content request; a DB write per page view is the wrong volume for this signal). This mirrors the `account-resolver.ts` claim-rejection precedent as intended.

The regression test (`team-content-access-helper.test.ts`, "degrades to role=participant (dual-check mismatch)...") asserts both halves — the returned grant and the `emitAuditEvent` call — and is a genuine rewrite of the test that previously *pinned the bug* (it used to assert the buggy grant was correct). That's the right test to have rewritten, not left in place as `.skip`.

## 3. Decision F — blocked-attempt audit event

Implemented per spec: synchronous `audit_log` INSERT (`operation = 'team.role_change_denied'`) with the exact column layout used by the existing `audit_log` table and by the `denyAdminContentAccess` precedent in `content.ts`, plus a matching `emitAuditEvent`, both written before the 403 response. I checked the column order against `migrations/8_audit_log.sql` — `actor_user_id, actor_global_role, actor_ip, operation, target_user_id, team_id, metadata` — and the INSERT in `teams.ts` matches positionally. Metadata carries `from_role`, `to_role`, `http_status`, as specified.

**Scoping requirement verified.** Design.md was explicit that this event must fire only for actors who pass `checkAssignRolesAuthorization`, and must not be conflated with the pre-existing "not authorized to call this endpoint at all" 403. I checked the code ordering directly: the authorization check (`teams.ts:733`) returns its own 403 before the subject lookup runs, and the promotion-block check (`teams.ts:817`) is textually and causally downstream of both the authorization check and the no-op fast-path. An actor who fails `checkAssignRolesAuthorization` cannot reach the `team.role_change_denied` write — there is no code path that would let it. Test 4.4 explicitly calls this out in its comment ("distinct from the unauthorized-actor 403 tests since this actor is otherwise fully authorized"), and the pre-existing 4.7 tests (unauthorized engineer, facilitator, wrong-team EM) each supply exactly one mocked DB row (the authorization check) — if the code incorrectly fell through to the promotion block or the audit INSERT, those tests would throw on an unmocked second query rather than cleanly returning 403. So the non-conflation property is enforced today, but only implicitly, through mock exhaustion. **Flagging as the one gap I'd want closed before sign-off:** none of the three 4.7 tests carries an explicit `expect(mockEmitAuditEvent).not.toHaveBeenCalledWith(expect.anything(), "team.role_change_denied", ...)` assertion. Given that this exact distinction (base-authz 403 vs. transition-block 403) is the specific thing Decision F's scope note exists to prevent, I'd rather see it asserted directly than rely on an incidental mock-exhaustion side effect that would silently stop enforcing anything if the tests are ever reworked to supply extra mocked rows. Non-blocking, but explicit is better than implicit here — this is exactly the category of thing I ask for in every review.

**Ordering / information-disclosure check.** Design.md's ordering requirement (base-authz 403 must fire before this check can even be reached, so an uninvolved caller doesn't learn the promotion-block exists) is correctly implemented — verified above. I looked for a second-order version of this concern: does the *redirective* 403 message itself leak anything about the target (e.g., the target's existing `global_role`, or whether they already hold EM status elsewhere)? It does not — the message is static copy naming TEAM-006 as the correct endpoint, with no interpolated subject data. Good.

## 4. Call-site correctness for the new `logger` parameter

`evaluateTeamAccess` gained a required third parameter. I checked all production call sites (`content.ts` x5, `em-views.ts` x6, `action-items.ts`, `ws-event-dispatcher.ts`, `connection-reauthorization.ts`, `websocket-routes.ts`) — every one passes `request.log` or the appropriate in-scope logger. No call site was missed, and the TypeScript compiler would have caught a miss regardless since the parameter isn't optional.

## 5. Verification performed

- Read `team-content-access-helper.ts`, `teams.ts`, `audit-logger.ts` diffs in full against design.md Decisions A/B/E/F.
- Ran the three relevant test files directly: `teams.test.ts`, `team-content-access-helper.test.ts`, `e2e-content-auth.test.ts` — 93/93 passing.
- Confirmed the audit_log INSERT's column positions against `migrations/8_audit_log.sql`.
- Confirmed `tsc --noEmit` errors in the backend package are pre-existing (118 errors on the unmodified base branch, same category, unrelated test-harness typing strictness) and not introduced by this change.
- Read the requirements-doc corrections (`REST API Contract.md`, `REST API Contract - Validation Report.md`, `01 - Identity and Access - Use Cases.md`) and confirmed they describe the shipped behavior (unconditional block on all actors) rather than the earlier EM-only framing.

## 6. Items I am not signing off on here (outside this review's scope, but tracked)

These are tasks.md items, not implementation defects — noting them so they aren't lost:

- **Task 1.4** (exact error copy/status) is still pending Facilitator sign-off. The shipped copy is a reasonable draft following existing precedent, but it's explicitly provisional in the code comment and should not be read as final.
- **Task 6.1/6.2** sign-off lines are unchecked in tasks.md; this document serves as my 6.1 sign-off — decisions 1.1–1.3 (Decisions B, E, F) are correctly reflected in the implementation and specs.
- **Tasks 1.6/1.7/1.8** (phantom-EM backfill, historical mislabeling, TEAM-006 zero-Engineers warning) remain open per design.md, with named owners — not part of this change's implementation surface, correctly deferred rather than silently dropped.

## Summary

The implementation matches design.md's Decisions A, B, E, and F precisely, closes the exact bypass documented in threat-model.md finding 1.3 (both the common case and the cross-team-EM variant), and the regression test for the specific threat-model scenario (task 4.1) genuinely exercises the fix rather than a weaker variant. Audit logging is correct in shape, column layout, and firing conditions. The one improvement I'd ask for — explicit non-conflation assertions on the existing 4.7 unauthorized-actor tests — is a test-hardening request, not a finding against the fix itself.
