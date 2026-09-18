## Why

In `/auth/callback`, when `tokens.claims()` returns `null` — meaning the ID token carried no claims object at all — the handler throws `MissingClaimError("sub")`. That names the wrong failure: nothing was inspected for a `sub` claim, because there was no claims object to inspect. The resulting `auth.failure` audit event records `missingClaim: "sub"`, telling whoever reads it a specific, incorrect story about what happened. The fix is a one-line change to throw `MissingClaimError("id_token")` in the null-claims branch instead, so the audit trail says what actually failed.

This is issue #7, tracked as an Open Issue in `openspec/specs/first-access/spec.md` since the `first-access` change shipped. It was deliberately deferred out of `auth-audit-correlation-fields` (which added `sourceIp`/`correlationId` for issue #4) because that change was scoped to different fields, not claim-name precision — not dropped, queued. This proposal is that queue coming due.

Why this matters beyond a cosmetic label: the audit trail is the durable record an operator trusts once the moment of failure has passed — the same property that makes session history and trend data trustworthy once a Health Check session is over. A diagnostic that names the wrong failure is a small instance of the tool's own account of events not matching what happened, and left unaddressed, that habit of imprecision erodes confidence in the tool's diagnostics generally.

**Design: not required.** No architectural surface, no new abstractions, no cross-cutting decision. `MissingClaimError` already accepts an arbitrary string with no enum or validation, `mapAuthError` branches only on `err instanceof MissingClaimError` and never inspects `err.claim`, and no other code in the repository pattern-matches on the specific claim-name string. This is a proposal, a spec delta, and a task list, then implementation — confirmed by code walkthrough in `exploration-notes.md`.

**No facilitator/participant-facing surface.** This callback is the same OIDC login path facilitators and participants use to sign into the Health Check app, but this change touches only the diagnostic label attached to a failure mode after the fact. `mapAuthError` is unchanged, so a facilitator or participant hitting this failure sees the same generic sign-in error before and after this change.

## What Changes

- In `packages/backend/src/routes/auth.ts`, the null-claims branch of the `/auth/callback` handler throws `MissingClaimError("id_token")` instead of `MissingClaimError("sub")`. The `sub`-absent and `iss`-absent branches are unchanged.
- The `auth.failure` audit event's `auditFields.missingClaim` field is `"id_token"` (instead of `"sub"`) specifically when the ID token claims object is `null`. No other audit field changes.
- `packages/backend/src/routes/__tests__/auth.test.ts`: the existing test `it("rejects authentication when claims() returns null", ...)` has its assertion tightened from `expect(auditFields.missingClaim).toBeDefined()` to `expect(auditFields.missingClaim).toBe("id_token")`. No other test in that describe block changes.
- `openspec/specs/first-access/spec.md`'s "Missing sub claim" scenario is split into two scenarios — "Null claims object" and "Missing or empty sub claim" — so the spec's prose matches the corrected behavior. The "Missing iss claim" scenario is unaffected: the null-claims branch throws before the `iss` check is ever reached, so a null claims object can never produce `missingClaim: "iss"`, today or after this fix.
- `spec.md`'s Known Limitations / Open Issues section moves `#7` from **Open Issues** to **Resolved**, in the same format already used for `#2` and `#3`.
- No changes to `mapAuthError` (`packages/backend/src/auth/error-handler.ts`) or to the user-facing redirect message. No branching on `err.claim` is introduced anywhere. Issues `#4` and `#6` (already closed by other changes) are not reopened or touched.

## Acceptance Criteria

This change is complete when all of the following hold. (Consolidated per BA review feedback — see task references for where each is implemented/verified.)

1. A `null` claims object from `tokens.claims()` results in `throw new MissingClaimError("id_token")`, not `MissingClaimError("sub")`. (tasks 1.1)
2. The resulting `auth.failure` audit event has `auditFields.missingClaim === "id_token"` for that case. (tasks 1.1, 2.1)
3. The `sub`-absent branch is unchanged: still throws `MissingClaimError("sub")`. (tasks 1.1, 2.2)
4. The `iss`-absent branch is unchanged: still throws `MissingClaimError("iss")`. (tasks 1.1, 2.2)
5. `mapAuthError` (`packages/backend/src/auth/error-handler.ts`) and the user-facing sign-in redirect message are unchanged for all `MissingClaimError` cases — no diff to that file, no branching on `err.claim` introduced anywhere. (tasks 1.2, 4.3)
6. `it("rejects authentication when claims() returns null", ...)` asserts `expect(auditFields.missingClaim).toBe("id_token")`, tightened from `toBeDefined()`. (tasks 2.1)
7. `openspec/specs/first-access/spec.md`'s "Missing sub claim" scenario is split into "Null claims object" and "Missing or empty sub claim," matching the delta text in `specs/first-access/spec.md`; the "Missing iss claim" scenario is unaffected. (tasks 3.1)
8. Issue `#7` is moved from `## Open Issues` to `## Resolved` in `openspec/specs/first-access/spec.md`, in the same format already used for `#2`/`#3`. (tasks 3.2, 3.3)
9. Issues `#4` and `#6` are not reopened, touched, or referenced by this change's diff. (tasks 3.4, 4.3)

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `first-access`: the "Missing claims rejection" requirement's scenario for a null ID token claims object is corrected — it now specifies `MissingClaimError("id_token")` and `auditFields.missingClaim: "id_token"` instead of `"sub"`, split out from the existing `sub`-absent-or-empty scenario, which keeps `MissingClaimError("sub")` unchanged.

## Impact

- **Code:** `packages/backend/src/routes/auth.ts` (one branch, one string literal).
- **Tests:** `packages/backend/src/routes/__tests__/auth.test.ts` (one assertion).
- **Specs:** `openspec/specs/first-access/spec.md` (one scenario split into two; one Open Issues → Resolved move).
- **Audit consumers:** none found. A repository-wide grep for `missingClaim` (outside `node_modules`/`dist`) turned up only the `auth.ts` emit site, the `auth.test.ts` assertions, and spec/archived-change prose — no dashboard, alert rule, or runbook currently pattern-matches on `"sub"` vs `"id_token"`, so no downstream comms step is needed.
- **User-facing behavior:** none. The generic sign-in error page and `mapAuthError`'s message are unchanged for all `MissingClaimError` cases.
