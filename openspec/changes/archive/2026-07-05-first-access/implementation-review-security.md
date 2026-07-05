# Security Review — first-access

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-07-05
**Scope:** Security-sensitive implementation areas in the first-access change set

Files reviewed:
- `packages/backend/src/auth/errors.ts`
- `packages/backend/src/auth/error-handler.ts`
- `packages/backend/src/auth/audit-logger.ts`
- `packages/backend/src/routes/auth.ts`
- `packages/backend/src/auth/account-resolver.ts`

---

## Summary

Five of the six verification items pass without findings. One item passes at the code level but carries a pre-existing residual risk in the error path from the OIDC library that is not new to this change. No blocking issues.

---

## 1. MissingClaimError — claim name vs. claim value in logs

**Result: PASS** (with a pre-existing residual risk noted below)

`errors.ts` stores only the claim name in the `claim` property:

```typescript
constructor(claim: string) {
  super(`Missing or empty required OIDC claim: ${claim}`);
  this.name = "MissingClaimError";
  this.claim = claim;
}
```

The `claim` parameter receives a string literal ("sub" or "iss"), never a value read from the token. The error message embeds that name string, not any token-derived value.

In `auth.ts`, the catch block logs:

```typescript
if (err instanceof MissingClaimError) {
  auditFields.missingClaim = err.claim;
}
```

`err.claim` is the claim name string ("sub" or "iss"). No claim value is present.

The `request.log.error({err, ...})` call at line 237 logs the error object itself. The application uses Fastify 5 with a custom serializer defined only for `req` (`app.ts` lines 20–32); there is no custom `err` serializer. Pino's default error serializer therefore applies, which serializes `type`, `message`, and `stack` only. Custom properties — including `err.claim` — are not serialized to the log output by default. Even if they were, `err.claim` contains only the claim name.

**Residual risk (pre-existing, not introduced by this change):** The `request.log.error({err, ...})` path also captures errors thrown by `handleCallback` (the OIDC token exchange). OIDC client libraries occasionally include token-adjacent content in error messages — for example, a nonce mismatch might produce an error message containing the received nonce value. This is not a new risk introduced by the MissingClaimError work, but it is an ongoing exposure in the general callback error path. I recommend a follow-on task to audit what the specific OIDC library version emits in its error messages and confirm that raw token content does not appear.

---

## 2. Session fixation prevention — regenerate() alone

**Result: PASS**

`auth.ts` line 166:

```typescript
await request.session.regenerate();
```

The implementation is correct. `regenerate()` alone atomically invalidates the pre-authentication session ID and issues a new one. The prior pattern (`destroy()` + `regenerate()`) had two problems: a Redis error inside `destroy()` could be swallowed by an always-resolve callback, leaving the old session alive in the store; and the double operation was unnecessary. The inline comment at lines 157–165 correctly documents the reasoning. This is the right implementation.

---

## 3. Missing-claims validation — empty string rejection

**Result: PASS**

`auth.ts` lines 125–134:

```typescript
const claims = tokens.claims();
if (!claims) {
  throw new MissingClaimError("sub");
}
if (!claims.sub) {
  throw new MissingClaimError("sub");
}
if (!claims.iss) {
  throw new MissingClaimError("iss");
}
```

The guard sequence is correct. `!claims` handles null and undefined from the claims() call. `!claims.sub` and `!claims.iss` each evaluate true for `undefined`, `null`, and `""` (empty string) — all three are correctly rejected. The ordering is also correct: the null check on `claims` runs before accessing `.sub` or `.iss`, preventing a property access on null.

The validation occurs before `resolveOrCreateAccount` is called, which means a missing or empty sub/iss never reaches the database. The comment at lines 118–124 correctly identifies the identity confusion risk that motivated this placement.

---

## 4. auth.first_access_created event shape

**Result: PASS**

`auth.ts` lines 148–155:

```typescript
emitAuditEvent(request.log, "auth.first_access_created", {
  userId: user.id,
  oidcSubject: user.oidcSubject,
  oidcIssuer: user.oidcIssuer,
  sourceIp: request.ip,
  correlationId,
});
```

`sourceIp` and `correlationId` are present. `display_name` and `email` are absent. No PII of the name/email class appears.

`oidcSubject` and `oidcIssuer` are the OIDC subject identifier and issuer URL — appropriate audit identifiers needed to correlate this event with the user's identity at the provider. Their inclusion is consistent with the `auth.success` event at lines 190–195, which also carries these fields. This is correct practice for identity audit events, not a PII leak.

The event shape is now consistent with all other security-relevant audit events in the callback.

---

## 5. Audit logger level fix — pino child logger behavior

**Result: PASS** (with a transport-level caveat documented below)

`audit-logger.ts` lines 33–34:

```typescript
const auditLogger = logger.child({ audit: true });
auditLogger.level = "info";
```

In pino, each logger instance owns its own level threshold independently. `logger.child()` creates a child that inherits the parent's current level at construction time. Setting `auditLogger.level = "info"` after construction overrides that inherited value. From that point forward, this child instance emits events at `info` and above regardless of what the parent's level is set to — including if the parent's level is subsequently changed to `warn` or `error`. This is correct pino behavior and the fix achieves its stated goal.

**Caveat:** If the underlying transport itself (not the logger instance) is configured with a minimum level above `info`, the logger-level override will not help — events are emitted by the logger but dropped before reaching the transport. This would require a transport configuration that explicitly filters at the transport level rather than through the logger's level property. For standard Fastify/pino deployments where the level is configured on the root logger instance, the fix is effective. This edge case should be noted in the deployment runbook, not in code.

---

## 6. Remaining paths where a claim value could reach a log entry

**Result: PASS** (with the pre-existing OIDC library error path noted in item 1)

Walking all log emission points in the callback route:

| Location | Fields logged | Claim values present? |
|---|---|---|
| `auth.callback_received` (line 104) | `sourceIp`, `stateNonce` (truncated), `success` | No |
| `auth.first_access_created` (line 148) | `userId`, `oidcSubject`, `oidcIssuer`, `sourceIp`, `correlationId` | `oidcSubject`/`oidcIssuer` are intentional audit identifiers |
| `auth.session_created` (line 185) | `userId`, `sessionId` | No |
| `auth.success` (line 190) | `userId`, `oidcSubject`, `oidcIssuer`, `isFirstAccess` | `oidcSubject`/`oidcIssuer` intentional |
| `request.log.error` (line 237) | `err`, `correlationId`, `sourceIp`, `event` | Only for MissingClaimError: claim name only; for OIDC library errors: unknown (see item 1) |
| `auth.failure` audit (line 256) | `sourceIp`, `failureCategory`, `correlationId`, optionally `missingClaim` | `missingClaim` = claim name only |

The only paths where claim values intentionally appear are `auth.success` and `auth.first_access_created`, where `oidcSubject` and `oidcIssuer` are logged as stable identity keys — not names or email addresses, and appropriate for an audit log. The MissingClaimError path is clean throughout.

The one unresolved path is errors from `handleCallback` when the OIDC token exchange or validation fails. These errors are from the external openid-client library and their message content is not audited in this review. This is tracked as the residual risk in item 1.

---

## Follow-on Recommendations

1. **Audit OIDC library error messages for token content.** Before the next production release, confirm that `handleCallback` errors from the installed version of openid-client do not include raw token content (JWT segments, claim values) in their `.message` or `.stack` properties. If they do, add a sanitizing wrapper before the error is passed to `request.log.error`.

2. **Document transport-level level filtering.** The audit logger fix comment explains the logger-instance behavior correctly. The deployment runbook should note that if the transport configuration changes to include a level filter above `info`, the audit trail guarantee breaks and code changes would be required.

3. **isNewUser race condition — constraint on future work.** The comment in `account-resolver.ts` at lines 31–47 correctly documents the SELECT-before-upsert race for concurrent first-access flows. The current only consumer (`auth.first_access_created` audit event) is safe to emit twice. This constraint must be enforced in PR review for any future feature that consumes `isNewUser` and triggers a non-idempotent side effect.
