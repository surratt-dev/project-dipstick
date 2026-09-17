## 1. Emit-site field additions (`packages/backend/src/routes/auth.ts`)

- [x] 1.1 Add `correlationId` to the `auth.callback_received` emit call (~line 171). Use the existing `const correlationId` bound at handler entry (~line 119) — do not call `crypto.randomUUID()` again.
- [x] 1.2 Add `sourceIp: request.ip` and `correlationId` to the `auth.session_created` emit call (~line 279), matching the field shape already used by `auth.first_access_created`/`auth.role_claim_mapped`.
- [x] 1.3 Add `sourceIp: request.ip` and `correlationId` to the `auth.success` emit call (~line 284), same shape.

## 2. Tests (`packages/backend/src/routes/__tests__/auth.test.ts`)

- [x] 2.1 Extend the existing success-path test(s) to assert `auth.callback_received`, `auth.session_created`, and `auth.success` each include `sourceIp: expect.any(String)` and `correlationId: expect.any(String)`.
- [x] 2.2 Add a direct cross-event identity assertion for the success path: capture the `correlationId` from `auth.callback_received`, `auth.session_created`, `auth.success`, and (for the new-user case) `auth.first_access_created`, and assert they are all `toBe()` the same value — not independently matching `expect.any(String)`.
- [x] 2.2b Add the equivalent cross-event identity assertion for the other success-path branch AC1 names: a returning user with a non-default `globalRole` (e.g. mock `resolveOrCreateAccount` to resolve `{ isNewUser: false, globalRole: "admin", ... }`), which triggers `auth.role_claim_mapped` (auth.ts:242) instead of `auth.first_access_created`. Model this on the existing "first_access_created for new users" test (auth.test.ts:408) — same inline-mock shape, no shared fixture to extend, since `role_claim_mapped` has no existing test today. Capture `correlationId` from `auth.callback_received`, `auth.session_created`, `auth.success`, and `auth.role_claim_mapped`, and assert `toBe()` identity across all four, same as 2.2.
- [x] 2.3 Add a cross-event identity assertion for the failure path: using a scenario where `handleCallback` or claims validation rejects after `auth.callback_received` has already been emitted (e.g. the existing missing-claims rejection tests), assert `auth.callback_received`'s `correlationId` equals `auth.failure`'s `correlationId`.

## 3. Verification

- [x] 3.1 Run the backend test suite for `auth.test.ts` and confirm all new and existing assertions pass.
- [x] 3.2 Confirm no other emit site, test, or type in `auth.ts`/`auth.test.ts` was touched beyond the three call sites and their tests (scope stays limited to issue #4 — no changes to `emitAuditEvent`, `join.link_rejected`/`join.link_redeemed`, the `missingClaim` precision note, or `session.destroy()` coverage).
