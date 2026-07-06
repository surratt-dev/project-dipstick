# Security Implementation Review — join-team-invite-link

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst  
**Date:** 2026-07-05  
**Scope:** Seven targeted security areas identified during design review, verified against actual implementation in `packages/backend/src/routes/auth.ts`, `packages/backend/src/routes/join-links.ts`, `packages/backend/src/app.ts`, and `packages/frontend/src/pages/JoinErrorPage.tsx`.

---

## Summary

Five of seven areas are correctly implemented and closed. Two findings require remediation before this change is considered clean from a security standpoint. Neither is critical — the implemented safeguards are solid — but both represent gaps in the audit trail and in the log redaction posture that were explicitly raised as concerns during the design review.

| Area | Status | Detail |
|---|---|---|
| redis.getdel atomicity | PASS | |
| trustProxy: 1 | PASS | |
| sourceIp on join.link_redeemed — through-auth path | PASS | |
| sourceIp on join.link_rejected — through-auth path | PASS | |
| Open redirect — /join-error only uses server enum values | PASS | |
| Join token isolated from redirect URLs | FINDING | Token appears in /auth/login?joinToken= URL, not redacted in logs |
| JoinErrorPage — unauthenticated, no team enumeration risk | PASS | |

**Direct path join.link_redeemed missing sourceIp** is an additional finding surfaced during review that was not in the original scope.

---

## Verified Areas

### 1. redis.getdel Atomicity — PASS

`packages/backend/src/routes/auth.ts`, line 87:

```ts
const stateDataRaw = await redis.getdel(stateKey);
```

The implementation uses a single atomic `getdel` command. The comment on lines 81–85 correctly explains the race condition this prevents: a concurrent second callback request for the same OIDC state key could read the stored nonce/code-verifier before the first request deletes it, breaking the single-use guarantee of the PKCE state parameter. The implementation is correct. There are no separate `get` + `del` calls anywhere in the callback handler.

### 2. trustProxy Setting — PASS

`packages/backend/src/app.ts`, line 25:

```ts
trustProxy: 1,
```

The value `1` correctly configures Fastify to trust a single proxy hop, matching the described deployment topology (load balancer or Kubernetes ingress). The comment on lines 19–25 accurately explains the consequence of omitting it: every `sourceIp` field in every audit event would carry the proxy's IP instead of the client's. The setting is present and correct.

`request.ip` is therefore returning the real client IP throughout the application. All `sourceIp` fields in audit events derive from this value.

### 3. sourceIp on join.link_redeemed — Through-Auth Path — PASS

`packages/backend/src/routes/auth.ts`, `executeJoinFlow` function:

- The function signature (line 441–446) declares `sourceIp: string` as a required (non-optional) parameter. This is the correct design choice — an optional parameter would allow future call sites to silently drop it.
- The call site (lines 208–214) passes `request.ip` explicitly:
  ```ts
  const joinResult = await executeJoinFlow(
    user.id,
    stateData.pendingJoinToken,
    request.log,
    request.ip,
  );
  ```
- The `join.link_redeemed` emit (lines 500–505) includes `sourceIp` from the parameter, not from any placeholder string.

The literal `"callback"` placeholder that this change was fixing is gone. The through-auth path now emits a real IP in `join.link_redeemed`.

### 4. sourceIp on join.link_rejected — Through-Auth Path — PASS

Both rejection branches inside `executeJoinFlow` correctly use the `sourceIp` parameter:

- Token not found (lines 454–458): `sourceIp` present.
- Token revoked or expired (lines 471–475): `sourceIp` present.

No literal string placeholders remain on this path.

### 5. Open Redirect — /join-error Uses Only Server-Determined Enum Values — PASS

Every redirect to `/join-error` in both paths uses hardcoded strings:

In `join-links.ts` (direct path):
- Line 124: `/join-error?joinError=invalid`
- Line 140: `/join-error?joinError=expired`
- Line 149: `/join-error?joinError=expired`

In `auth.ts` `executeJoinFlow` (through-auth path):
- Line 459: `{ redirectUrl: "/join-error?joinError=invalid" }`
- Line 475: `{ redirectUrl: "/join-error?joinError=expired" }`

No user-supplied input is reflected into any of these redirect URLs. The error discriminant is a server-determined constant in all cases. `JoinErrorPage.tsx` treats any value other than `"expired"` as `"invalid"` (lines 21–27), which is a safe fallback — even if the parameter were somehow manipulated to an unexpected value, the output is a static string, not reflected content.

### 7. JoinErrorPage — Unauthenticated, No Token Enumeration Risk — PASS

`packages/frontend/src/App.tsx`, line 39:

```tsx
<Route path="/join-error" element={<JoinErrorPage />} />
```

The route has no `ProtectedRoute` wrapper. The comment in `App.tsx` (lines 33–39) explicitly documents this as intentional, analogous to `/auth/error`. The `JoinErrorPage` component reads only the `joinError` query parameter and maps it to one of two static strings. There is no server-side data fetching, no team name or membership data rendered, and no mechanism by which the page could be used to enumerate teams. The unauthenticated route is correctly scoped to what it needs.

---

## Findings

### Finding 1 (Medium) — Join Token Appears Unredacted in /auth/login Server Logs

**File:** `packages/backend/src/routes/join-links.ts`, line 154  
**Area:** Join token isolation from server logs

When an unauthenticated user hits `GET /api/join/:token`, the server redirects to:

```ts
return reply.redirect(`/auth/login?joinToken=${token}`);
```

The token value is a 32-byte cryptographically random `base64url` string — correctly generated, not guessable. However, this redirect causes Fastify to log the incoming `GET /auth/login?joinToken=<raw_token>` URL when the browser follows the redirect. The logger serializer in `app.ts` (line 33) only redacts the `/api/join/` pattern:

```ts
url: url.replace(/\/api\/join\/[^/?#]+/, "/api/join/[REDACTED]"),
```

The `/auth/login?joinToken=<value>` URL is not covered. A valid, unexpired join token is therefore written to server access logs in plaintext.

**Impact:** Anyone with read access to application logs can extract join tokens and use them. Using a join token still requires completing OIDC authentication, so this is not an authentication bypass — an attacker gains the ability to join a team they were not intended to join, not to authenticate as another user. The 7-day TTL limits the window. The risk is proportional to how tightly log access is controlled and how broadly join links are considered sensitive.

**Remediation:** Extend the logger serializer regex to cover the login URL:

```ts
url: url
  .replace(/\/api\/join\/[^/?#]+/, "/api/join/[REDACTED]")
  .replace(/(\/auth\/login\?.*joinToken=)[^&]+/, "$1[REDACTED]"),
```

This is a one-line change. It is the same pattern already applied to the direct join URL and should be applied here for consistency.

---

### Finding 2 (Low) — join.link_redeemed Missing sourceIp on Direct Path

**File:** `packages/backend/src/routes/join-links.ts`, lines 175–179  
**Area:** Audit completeness

The `join.link_redeemed` event on the direct path (authenticated user hitting `GET /api/join/:token`) does not include `sourceIp`:

```ts
emitAuditEvent(request.log, "join.link_redeemed", {
  userId: session.userId,
  teamId: link.team_id,
  linkId: link.id,
  // sourceIp absent
});
```

The through-auth path (`executeJoinFlow` in `auth.ts`) correctly includes `sourceIp`. The event schema is identical in both paths except for this field. If a direct-path redemption is later relevant to an incident investigation, the source IP cannot be recovered from the audit log — it would need to be reconstructed from raw access logs, which may not be retained at the same fidelity or for the same duration.

This is not a vulnerability; it is an audit gap. Audit logging is a security control, not an operational nicety. Inconsistency in event shape across redemption paths undermines the reliability of the audit trail.

**Remediation:** Add `sourceIp: request.ip` to the `join.link_redeemed` event in `join-links.ts`:

```ts
emitAuditEvent(request.log, "join.link_redeemed", {
  userId: session.userId,
  teamId: link.team_id,
  linkId: link.id,
  sourceIp: request.ip,
});
```

`request.ip` is already available at this call site and will return the real client IP due to the `trustProxy: 1` configuration confirmed above.

---

## Additional Observations

**Session fixation prevention is correctly handled.** The callback uses `request.session.regenerate()` rather than the previously documented `destroy()` + `regenerate()` pattern. The code comment on lines 160–168 explains the correctness reasoning, which is accurate: `regenerate()` alone is the right call, and the `destroy()` + `regenerate()` sequence was both redundant and had an error-swallowing risk on the destroy callback.

**Token parameterization in SQL is complete.** Every database query that takes the join token value uses it as a positional parameter (`$1`), never in string interpolation. This was verified in both `join-links.ts` (line 111) and `auth.ts` `executeJoinFlow` (line 449). No SQL injection surface exists on this code path.

**The `pendingJoinToken` is not forwarded to the OIDC provider.** The login handler stores the token in Redis under the OIDC state key (lines 33–47 of `auth.ts`) and sends only the state nonce to the authorization endpoint. The raw token does not appear in the redirect URI sent to the identity provider, so there is no risk of the token being captured in IdP logs or referrer headers on the OIDC leg of the flow.

**EM enforcement deferral is correctly scoped.** The design decision to enforce EM non-participation at the session participation layer is documented and is the correct architectural boundary. The join layer's responsibility ends at membership insertion. No security control is missing here — the requirement exists and is formally captured where it belongs.

---

## Disposition

This change may proceed with the two findings tracked as follow-on work items. Finding 1 (log redaction) is the higher priority — it should be resolved before this code path sees significant production traffic. Finding 2 (direct path sourceIp) is lower urgency but should be resolved in the same pass to ensure the audit event schema is consistent across all join redemption paths.

Neither finding is a blocker if remediation is tracked and committed to before the next deployment window.
