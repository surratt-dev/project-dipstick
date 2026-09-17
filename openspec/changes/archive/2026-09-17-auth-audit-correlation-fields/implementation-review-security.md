# Security Implementation Review: auth-audit-correlation-fields

**Reviewer:** Tomás Ferreira (Senior Application Security Analyst)
**Reviewed:** `git diff main -- packages/backend/src/routes/auth.ts packages/backend/src/routes/__tests__/auth.test.ts`
**Prior artifact:** `openspec/changes/auth-audit-correlation-fields/design-review-security.md` (Approved, no blocking findings, one non-blocking documentation correction)

**Verdict: Approved. No blocking findings. Implementation matches the approved design.**

---

## What I checked

I re-read the actual diff rather than relying on the design review's description of intent — a design review approves a plan, not a diff, and the two can drift during implementation.

- Full diff of both files (`git diff main`).
- The complete `GET /callback` handler in `packages/backend/src/routes/auth.ts` (lines 95–364), not just the changed lines, to confirm control flow around the additions.
- Ran the test file: `npx vitest run src/routes/__tests__/auth.test.ts` — 40/40 passing.

## 1. No new PII/sensitive field introduced

Confirmed by diff inspection. The only fields added are `sourceIp` (already emitted on `auth.authorization_initiated`, `auth.failure` ×3, `auth.first_access_created`, `auth.role_claim_mapped` before this change) and `correlationId` (already emitted at five sites before this change, per the design review's own verification). Three call sites gained one or both fields:

- `auth.callback_received` (line 175): gained `correlationId` only — `sourceIp` was already present.
- `auth.session_created` (lines 283–284): gained both `sourceIp` and `correlationId`.
- `auth.success` (lines 292–293): gained both `sourceIp` and `correlationId`.

No new field name, no claim value, no token material, no PII appears anywhere in the diff. Consistent with the approved design.

## 2. `correlationId` is the same value reused, not a new mint per site

Verified directly in code, not inferred from the field name:

- `correlationId` is minted exactly once, `crypto.randomUUID()` at line 119, **before** the `try` block opens.
- It is never reassigned anywhere in the handler — I read the full function body (lines 118–364) looking for a second `const correlationId` or any shadowing `let`; there is none.
- Every emit site inside the closure (`auth.failure` ×2 early-exit paths, `auth.callback_received`, `auth.first_access_created`, `auth.role_claim_mapped`, `auth.session_created`, `auth.success`, and the catch-block `auth.failure`) reads the same outer binding.
- The catch block (line 337) closes over the identical `correlationId` — confirmed it's the same lexical variable, not a fresh one scoped to the catch.

This is a closure capture over a single `const`, which is the strongest form of "same value" guarantee available in JS — there's no code path that could produce a divergent value across these emit calls within one invocation.

The test suite verifies this behaviorally, not just structurally, and does so correctly: `auth.test.ts` uses `expect(x).toBe(correlationId)` (exact reference/value equality) across `callback_received` → `session_created` → `success` → `first_access_created`/`role_claim_mapped`, in three separate test cases (new-user path, returning-admin path, and the claims-rejection failure path). This is exactly the test discipline the design review asked for — no `expect.any(String)` softening, which would have let a bug that mints a new UUID per site pass silently since `emitAuditEvent`'s `Record<string, unknown>` signature enforces nothing.

## 3. No security-relevant code path altered

Diffed against the full handler: claims validation (`MissingClaimError` checks, lines 193–202), account resolution (`resolveOrCreateAccount`, lines 209–222), and session regeneration (`request.session.regenerate()`, line 261) are unchanged — they appear in the diff only as unmodified context lines, not as additions or deletions. The change is additive-only: new object properties on existing `emitAuditEvent` calls. No new branch, no new conditional, no change to what triggers success vs. failure. Confirmed with a full read of the handler, not just the diff hunks.

## 4. `join.link_rejected`/`link_redeemed` and `missingClaim` handling untouched

- `executeJoinFlow` (line 541 per design review, confirmed still a standalone top-level function taking `(userId, token, logger, sourceIp)`) and its two `join.link_rejected` emit sites (lines 559, 575) plus `join.link_redeemed` (line 605) do not appear anywhere in the diff. Correctly out of scope, consistent with the deferred follow-on decision.
- The `missingClaim` audit field logic (lines 355–357, `auditFields.missingClaim = err.claim`) is unchanged — still logs only the claim name, never a value. Consistent with the design review's finding that this is a documentation-clarity question, not a security one, and correctly out of scope for this change.

## Test execution

`npx vitest run src/routes/__tests__/auth.test.ts` → 40/40 passing, including the four new/extended assertions blocks added by this change (callback-received/session-created/success field presence; new-user cross-event `correlationId` equality; new `role_claim_mapped` test with cross-event equality; failure-path `correlationId` equality).

## Summary

Implementation matches the approved design exactly: three additive `emitAuditEvent` field additions, one `const correlationId` minted once and read by closure everywhere it's needed, zero changes to authentication, session, or claims-validation logic, and zero changes to the join-flow or missing-claim code paths correctly deferred at design time. Test assertions use exact-value equality (`toBe`), which is the correct level of rigor given the logger enforces no schema. No PII/sensitive-value concern. No blocking findings.
