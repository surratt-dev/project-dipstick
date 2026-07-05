# Implementation Review: First Access
**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** first-access
**Date:** 2026-07-05
**Status:** Approved with findings

---

## Summary

The implementation is sound and addresses all six architectural constraints documented in `design.md`. The four confirmed gaps from design review (missing-claims validation, server-side redirect, session fixation, incomplete audit event) are correctly closed. Three minor issues are called out below; none block merging, but two should be tracked as follow-on work before the first production deployment.

---

## Constraint Verification

### 1. Identity match key is always `(oidc_subject, oidc_issuer)` — PASS

`account-resolver.ts` uses `(oidc_subject, oidc_issuer)` in both the SELECT and the `ON CONFLICT` clause. Email appears only in the `SET` clause (to update the stored value on each authentication). It does not appear in any WHERE condition, JOIN, or ON CONFLICT expression. The inline comment on line 58–65 is explicit about this invariant and the reasoning behind it.

Test coverage: `account-resolver.test.ts` includes a dedicated test that creates two accounts sharing the same email but different `sub` values and verifies they resolve to separate records, with query parameters asserting `sub`/`iss` — never email — in the SELECT calls.

### 2. Upsert pattern preserved — PASS (documented limitation acknowledged)

The write path remains an `INSERT ... ON CONFLICT DO UPDATE`. The SELECT-before-upsert pattern for deriving `isNewUser` is explicitly called out in a block comment (lines 32–47) as a documented constraint on future work, not a defect. The concurrent-access test in `account-resolver.test.ts` simulates the race and verifies both the correct data outcome and the known isNewUser-duplication behavior. This matches the design exactly.

### 3. Session creation only after account resolution succeeds — PASS

`session.regenerate()` and session population occur on lines 166–183, unconditionally after `resolveOrCreateAccount` returns on line 137. If `resolveOrCreateAccount` throws, execution falls to the catch block at line 234, which emits an `auth.failure` event and redirects — no session is established. The Task 15 test (`redirects to error page when resolveOrCreateAccount throws`) verifies this by asserting `save` is never called and the redirect goes to `/auth/error`.

### 4. `/no-team` route not inside a navigation-contributing layout — PASS

`App.tsx` wraps `/no-team` in `<ProtectedRoute><NoTeamPage /></ProtectedRoute>` only. No `<Layout>`, `<AppShell>`, or navigation component is present. The comment block on lines 32–44 of `App.tsx` explicitly names this as a structural requirement and references the regression test. `App.test.tsx` Task 18 test asserts `document.querySelector("nav")` is null and `queryByRole("navigation")` is absent at `/no-team`. The regression test is in place.

### 5. Session fixation handled by `regenerate()` alone — PASS

Line 166 of `auth.ts`:

```ts
await request.session.regenerate();
```

No `session.destroy()` call precedes it in the callback handler. The old destroy-then-regenerate pattern is gone. The inline comment (lines 157–165) explains the rationale. One gap in test coverage is noted below.

### 6. `first_access_created` audit event complete — PASS

Lines 147–155 of `auth.ts`:

```ts
emitAuditEvent(request.log, "auth.first_access_created", {
  userId: user.id,
  oidcSubject: user.oidcSubject,
  oidcIssuer: user.oidcIssuer,
  sourceIp: request.ip,
  correlationId,
});
```

All five required fields are present: `userId`, `oidcSubject`, `oidcIssuer`, `sourceIp`, `correlationId`. No PII fields (`displayName`, `email`, `name`) are included. The Task 21 test in `auth.test.ts` verifies the field set using `toMatchObject` and separately asserts the absence of `displayName`, `email`, and `name`.

---

## Specific Checks

### MissingClaimError usage — PASS

`errors.ts` defines `MissingClaimError` with a single `claim: string` field carrying the claim name (e.g., `"sub"` or `"iss"`). The constructor message includes only the claim name, never a claim value. The catch block in `auth.ts` (lines 252–254) adds `auditFields.missingClaim = err.claim` — the name only. `mapAuthError` in `error-handler.ts` recognizes `MissingClaimError` and returns a generic user-facing message with no claim-derived content.

The missing-claims check (lines 125–134) handles three cases: `claims()` returns null (throws `MissingClaimError("sub")`), `sub` is empty string (throws `MissingClaimError("sub")`), `iss` is empty string (throws `MissingClaimError("iss")`). All three are covered by tests in `auth.test.ts` under the `missing claims rejection` describe block.

One precision note: when `claims()` returns `null`, throwing `MissingClaimError("sub")` is semantically imprecise — the entire claims object is absent, not just `sub`. The audit event will show `missingClaim: "sub"` which could mislead an operator. An alternative would be to throw `MissingClaimError("id_token")` in the null case. This is low priority but worth cleaning up before a production incident makes it confusing.

### `regenerate()` called alone — PASS (test gap noted)

Confirmed at the implementation level. However, `auth.test.ts` does not include an assertion that `session.destroy` was not called in any callback success path. The `destroy` mock is wired into `buildApp` but never inspected in the callback tests. This means the test suite would not catch a regression where `destroy()` is added back before `regenerate()`. A simple `expect(destroyMock).not.toHaveBeenCalled()` in the successful callback test would close this gap.

### Server-side redirect uses live data — PASS

Lines 217–229 of `auth.ts` issue a direct database query against `team_memberships` for the authenticated user, filtered by `removed_at IS NULL`. This executes after account resolution and is not influenced by any session flag. The redirect destination (`/no-team` or `/team/:teamId`) is determined by the query result at that moment. The Task 13 and Task 14 tests in `auth.test.ts` verify both branches (no memberships → `/no-team`, has membership → `/team/:teamId`) including the case of a returning user whose memberships have since been removed.

### `first_access_created` event completeness — PASS

Verified above under Constraint 6.

### NoTeamPage loading-state guard — PASS

`NoTeamPage.tsx` lines 13–15 return `<AuthLoadingPage />` when `loading` is true, before any membership check. The membership check (lines 22–26) and the session field access (`session.teamMemberships[0]`) occur only after the loading guard clears. `NoTeamPage.test.tsx` includes an explicit test (`shows loading page while session is loading`) that renders with `loading: true, session: null` and asserts the loading page renders rather than the no-team content.

---

## Findings

### Finding 1 — `auth.success` and `auth.session_created` lack `sourceIp` and `correlationId` (minor, pre-existing)

The design states: "every other security-relevant audit event in the system includes both" `sourceIp` and `correlationId`. The `first_access_created` gap is closed by this change. However, `auth.success` (lines 190–195) and `auth.session_created` (lines 185–188) do not include either field. `auth.callback_received` (lines 104–108) includes `sourceIp` but not `correlationId`.

This appears to be a pre-existing gap rather than a regression introduced by this change. It should be resolved before the first production deployment — an operator trying to trace an authentication event through the audit log from callback to session creation will find `correlationId` present in the failure path but absent in the success path, which is asymmetric and operationally unhelpful.

**Recommendation:** Add `sourceIp` and `correlationId` to `auth.session_created` and `auth.success` in a follow-on task.

### Finding 2 — `executeJoinFlow` hardcodes `"callback"` as `sourceIp` in join rejection events (minor)

Lines 437–442 and 453–458 of `auth.ts` emit `join.link_rejected` with `sourceIp: "callback"` — a static string, not the actual source IP. The `executeJoinFlow` helper does not receive the request object, so it cannot access `request.ip` directly.

This is a data quality issue, not a security issue. The join rejection events occur in the same request context as the callback, so the IP is available — it just isn't threaded through. An operator investigating join link abuse will not be able to identify the source IP from these events.

**Recommendation:** Pass `sourceIp` as a parameter to `executeJoinFlow` and use it in the rejection events.

### Finding 3 — No test assertion that `session.destroy` is not called (test coverage gap)

As noted under the `regenerate()` check above, the `auth.test.ts` callback tests do not assert that `session.destroy` is never invoked. This is a regression risk: if the destroy+regenerate pattern is reintroduced, no test will catch it.

**Recommendation:** Add `expect(sessionMock.destroy).not.toHaveBeenCalled()` to at least one successful callback test path.

---

## Audit Log Independence — RESOLVED

The design flagged that audit events written via a child logger would be suppressed if the application log level was raised above `info`. `audit-logger.ts` addresses this correctly: the child logger's level is explicitly set to `"info"` before each emit (lines 33–35), independent of the parent logger's configured level. The inline comment explains both the risk and the fix. This satisfies the pre-production requirement.

---

## Architectural Integrity

The four structural constraints from design.md are all maintained. The identity resolution boundary (sub/iss only, no email in the match path) is enforced at the SQL level and tested explicitly. The session creation ordering constraint is correctly sequenced and tested via the failure case. The layout isolation for `/no-team` is structural (routing layer, not component layer) and locked by a regression test. The session fixation fix is correctly applied.

The implementation does not introduce any new external dependencies, does not move logic across established module boundaries, and does not change the data classification of any persisted field. The changes are internally consistent with the pre-existing patterns in the authentication module.

No architectural concerns remain that would block this change from proceeding to a production deployment review.
