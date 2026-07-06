# Security Review: Join Team Invite Link
**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Change:** join-team-invite-link
**Date:** 2026-07-05
**Files Reviewed:** `routes/auth.ts`, `routes/join-links.ts`, `auth/audit-logger.ts`, `auth/oidc-client.ts`, `app.ts`, `migrations/5_create_join_links.sql`, `migrations/2_create_tables.sql`, `migrations/1_create_enums.sql`, `openspec/changes/join-team-invite-link/design.md`, `openspec/changes/join-team-invite-link/proposal.md`

---

## Summary

The core join link security model — token stored server-side in Redis keyed by the OIDC state nonce, never passed through the IdP, consumed once on callback, looked up via parameterized query — is correctly implemented. The design makes the right call in every architectural decision where I would have had concerns in a less careful implementation. This is the payoff from addressing F-13 in the original sign-in review, which required cleanup of the pending join key after use and explicitly called out that storing join context in Redis rather than in the OIDC state parameter was the correct choice.

That said, I have four findings that require action before this change closes. One of them — the `request.ip` behavior under a reverse proxy — is a pre-existing issue across all audit events, not introduced by this change, but this change is the first time the codebase explicitly commits to threading `request.ip` into a new function signature. This is the right moment to resolve it.

---

## Question 1: The Join-Link-Through-Auth Flow — Is the Join Token Stored and Retrieved Safely During the OIDC State Round-Trip?

**Answer: Yes, with one non-atomic operation that is low-severity in practice.**

The flow is correct:
1. `/auth/login` generates a 32-byte CSPRNG `state` nonce and stores the full state blob (nonce, codeVerifier, pendingJoinToken) in Redis under `dipstick:auth:state:{state}`, with a 10-minute TTL.
2. Only the opaque `state` nonce passes through the IdP. The join token never appears in the OIDC authorization URL or response.
3. On callback, the state nonce is retrieved from the URL, used as the Redis key to fetch the blob, and the blob is deleted before token exchange.
4. The join token in the returned blob is then used for a parameterized database lookup.

The design decision not to carry the join token in the OIDC `state` parameter was a required finding from F-13 in the original sign-in review. It is correctly implemented here. There is no way for a tampered OIDC callback response to alter the join token, because the token lives in Redis — not in the IdP response.

**Finding 1 (Low) — Redis GET and DEL are not atomic:**

```typescript
const stateDataRaw = await redis.get(stateKey);
await redis.del(stateKey);
```

These are two separate Redis calls. Under concurrent requests carrying the same state nonce, both could read the blob before either deletes it. In theory, this allows a state blob to be read twice. In practice, this is not exploitable: the authorization code issued by the IdP is single-use. A second request carrying the same state would succeed the Redis GET but fail at the `authorizationCodeGrant` call when the IdP rejects the reused authorization code. The join flow would not execute twice.

The correct implementation is `GETDEL` (a single atomic Redis operation). This was correct behavior in the original design (the prior review's F-13 required post-use deletion), and the current implementation achieves single-use semantics in the happy path. The GETDEL fix closes the theoretical gap without behavioral change.

**Required action:** Replace `redis.get(stateKey)` + `redis.del(stateKey)` with `redis.getdel(stateKey)` (available in ioredis). This is a one-line change that eliminates the non-atomic window.

---

## Question 2: The `?joinError=` Redirect — Is There Any Open Redirect Risk?

**Answer: No. The proposed mechanism does not introduce an open redirect.**

The `?joinError=` parameter values (`expired`, `invalid`) are derived from server-side validation logic, not from user-provided input. The redirect destination path is application-relative and hardcoded in the callback handler. The join token from `pendingJoinToken` is used only as a database lookup key (via parameterized query); its value is never reflected into the redirect URL.

One secondary observation, not introduced by this change: the unauthenticated redirect in `GET /api/join/:token` does not URL-encode the token:

```typescript
return reply.redirect(`/auth/login?joinToken=${token}`);
```

Legitimate tokens are produced by `randomBytes(32).toString("base64url")`, which outputs only `[A-Za-z0-9_-]` characters. A forged URL with a token containing `&` or `=` characters could inject additional query parameters into the `/auth/login` request — but not redirect to a different origin. The token then passes through `request.query.joinToken` (framework-parsed) into a Redis JSON value, and then into a parameterized SQL query. No injection risk exists in the data path.

The open redirect risk is absent. The URL-encoding gap is informational and bounded by the character set of legitimate tokens.

---

## Question 3: Audit Event `sourceIp` Fix — Is the IP Passed Correctly from the Request Through to the Audit Layer?

**Answer: The fix is structurally correct but there is a pre-existing gap that this change must not leave unaddressed.**

The proposed fix — add `sourceIp: string` as a required parameter to `executeJoinFlow`, pass `request.ip` at the call site — is the correct approach. Making the parameter required (not optional) is explicitly called out in the design's risk section as the mitigation for future call sites. I agree with this constraint.

**Finding 2 (Medium) — `request.ip` returns the proxy IP, not the client IP, in a proxied deployment:**

Fastify resolves `request.ip` from the raw socket's `remoteAddress`. In a production deployment behind a reverse proxy (load balancer, Kubernetes ingress), `remoteAddress` is the proxy's IP, not the client's. The real client IP is in `X-Forwarded-For`. Fastify supports this via the `trustProxy` configuration option, which is absent from `app.ts`:

```typescript
const app = Fastify({
  logger: { serializers: { ... } },
  // trustProxy is not set
});
```

This affects every `sourceIp` field across all audit events (`auth.authorization_initiated`, `auth.callback_received`, `auth.failure`, `auth.session_created`, `auth.first_access_created`, `join.link_created`, `join.link_rejected`). None of them carry the real client IP in production. This is a pre-existing issue, but threading `sourceIp` into `executeJoinFlow` makes it the right moment to resolve it systemically.

**Required action:** Add `trustProxy: true` (or a specific trusted proxy address/subnet) to the Fastify app configuration in `app.ts`. The correct value depends on the deployment topology. If the application receives traffic from a single known proxy (e.g., an in-cluster Kubernetes ingress), set `trustProxy` to that address. If the topology is unknown, `trustProxy: 1` (trust one hop) is the appropriate default for a single-layer proxy. Document the chosen value in the deployment configuration.

**Finding 3 (Medium) — `join.link_redeemed` is missing `sourceIp` and the omission is not covered by the proposed tasks:**

The tasks in `tasks.md` (Task 2.1) say "remove the `sourceIp: "callback"` literal from any audit event calls inside the function." The `join.link_rejected` events use `"callback"` today. But the `join.link_redeemed` event has no `sourceIp` at all:

```typescript
emitAuditEvent(logger, "join.link_redeemed", {
  userId,
  teamId: link.team_id,
  linkId: link.id,
  // no sourceIp
});
```

After the proposed fix, `executeJoinFlow` will have the `sourceIp` parameter in scope. Not including it in `join.link_redeemed` would be an oversight — a successful join redemption event is the most security-relevant event in the flow and should carry source attribution. From an incident investigation standpoint: if a join link is redeemed by an unexpected party, knowing the source IP is the first thing I would look for.

**Required action:** Add `sourceIp` to `join.link_redeemed` alongside the fix for `join.link_rejected`. Both events are emitted from the same function with the same `sourceIp` parameter in scope after the proposed change. The fix is a one-field addition.

---

## Question 4: The `ON CONFLICT DO NOTHING RETURNING id` Pattern — TOCTOU or Race Condition Concerns?

**Answer: The pattern is correct and race-safe, but the through-auth path's INSERT is missing the RETURNING clause today.**

The `ON CONFLICT (user_id, team_id) DO NOTHING RETURNING id` pattern in `GET /api/join/:token` (the direct path) is correct. PostgreSQL evaluates the conflict detection and the RETURNING clause as a single atomic operation at the row level. The RETURNING clause emits rows only for rows actually written by this statement — not for rows that conflicted. Under concurrent inserts of the same (user_id, team_id) pair, exactly one caller receives a returned row and the other receives an empty result set. This is the correct mechanism for distinguishing new membership from existing membership.

**Finding 4 (Medium) — `executeJoinFlow` uses `ON CONFLICT DO NOTHING` without RETURNING, making new-vs-existing detection impossible and producing spurious audit events:**

The current `executeJoinFlow` INSERT:

```typescript
await db.query(
  `INSERT INTO team_memberships (user_id, team_id, role)
   VALUES ($1, $2, 'participant')
   ON CONFLICT (user_id, team_id) DO NOTHING`,
  [userId, link.team_id],
);

emitAuditEvent(logger, "join.link_redeemed", {
  userId,
  teamId: link.team_id,
  linkId: link.id,
});
```

The `join.link_redeemed` event is emitted unconditionally. A returning member who goes through the auth flow — someone who already has a membership row — will generate a `join.link_redeemed` audit event even though nothing was inserted. The direct path in `GET /api/join/:token` correctly guards this:

```typescript
const isAlreadyMember = insertResult.rows.length === 0;
if (!isAlreadyMember) {
  emitAuditEvent(request.log, "join.link_redeemed", { ... });
}
```

The through-auth path does not.

The proposal's Tasks 3.1 and 3.2 require distinguishing new membership from existing membership to append `?newMember=true` or `?alreadyMember=true`. These tasks cannot be implemented without adding `RETURNING id` to the `executeJoinFlow` INSERT. The tasks document does not call this out explicitly. Without it, Task 3 cannot be completed.

**Required action:** Add `RETURNING id` to the INSERT in `executeJoinFlow`. Use the returned row count to gate the `join.link_redeemed` audit event (emit only on actual insert), and to determine which query parameter to append (`?newMember=true` vs `?alreadyMember=true`).

**Theoretical TOCTOU — link validation before insert:** The token's expiry and revocation are checked before the INSERT. If a link were revoked in the window between the check and the INSERT, the user would be inserted with an expired/revoked link. This window is a few milliseconds. The risk is negligible for two reasons: (1) the revocation write endpoint does not yet exist; (2) the 7-day expiry provides a bounded exposure window without concurrency concerns. The design's explicit deferral of revocation is documented and acceptable. When the revocation endpoint is implemented, the design for that change should evaluate whether a database-level constraint (a trigger or a foreign-key check against a valid-links view) is warranted.

**Soft-delete collision (informational):** The `team_memberships` table has a UNIQUE constraint on `(team_id, user_id)` and a `removed_at` nullable column. If a future change introduces explicit membership removal via `removed_at`, a removed user who follows a join link again would hit the `ON CONFLICT DO NOTHING` constraint and be silently not re-added. The `isAlreadyMember` detection would return true, and the user would be redirected with `?alreadyMember=true` even though their active membership is gone. This is not a current concern (no removal endpoint exists), but the removal design should account for it when it is built.

---

## Question 5: Join Link Token Entropy — Is 32 Bytes Base64url Sufficient?

**Answer: Yes. The entropy is well above any practical threshold. Storage and transmission are handled correctly.**

`randomBytes(32)` produces 256 bits of cryptographically secure randomness. 128 bits is the commonly accepted minimum for bearer tokens. 256 bits provides a comfortable margin. At the maximum scale of this application (an internal tool for a single organization), token space exhaustion is not a credible concern.

Storage is correct: `VARCHAR(64)` accommodates the 43-character base64url output of 32 bytes (with room to spare), the column has a UNIQUE constraint, and a dedicated index on `token` supports efficient lookup.

Transmission properties:
- The token appears in the join URL path (`/api/join/:token`) and is present in browser history for the duration of its 7-day validity
- Request logging correctly redacts the token: the custom `req` serializer in `app.ts` replaces `/api/join/:token` with `/api/join/[REDACTED]` in all HTTP access log entries — this directly addresses F-18 from the original sign-in review
- `Referrer-Policy: strict-origin-when-cross-origin` is configured — the token will not leak via Referer headers to external sites
- HTTPS is enforced in production via HSTS — the token is not transmitted in plaintext

One observation: the token column is `VARCHAR(64)`, but there is no application-layer length validation on the `token` parameter received in `GET /api/join/:token`. An attacker can send an arbitrarily long string as the token value. The database lookup will simply return no rows. This is not an injection risk (the query is parameterized), but it allows arbitrary-length strings to propagate to the database layer. A maximum length check (e.g., 100 characters) at the route handler would enforce the expected input shape without material security impact. This is informational.

---

## Items That Are Implemented Correctly

**Join context isolation:** The join token is stored in Redis alongside the OIDC state nonce, not in the OIDC state parameter passed to the IdP. The IdP never sees the join token. A compromised or adversarial IdP cannot manipulate join context.

**Single-use state consumption:** The Redis state blob is deleted immediately after retrieval, before token exchange. State replay is prevented at the application layer, independent of IdP behavior.

**Parameterized queries throughout:** Every database interaction in both `auth.ts` and `join-links.ts` uses node-postgres parameterized query syntax. Join tokens, user IDs, and team IDs are never interpolated into query strings.

**State TTL alignment:** The Redis state TTL is 10 minutes (`STATE_TTL_SECONDS = 600`). A join link token stored in that state blob can only be acted on during a 10-minute OIDC flow window. Even if the join link itself has 7 days remaining, the `pendingJoinToken` in the state blob cannot be abused after the state expires.

**Audit event architecture:** The `emitAuditEvent` function forces the child logger's level to `info` before emitting, ensuring audit events are not suppressed if the application log level is raised. This was a structural finding from the first-access review. It is correctly implemented.

**Token redaction in access logs:** The `req` serializer in `app.ts` redacts the join token from the URL before it is logged. This was F-18 in the original sign-in review.

**`executeJoinFlow` as an internal function:** The function is not exported and has only one call site. Making `sourceIp` a required parameter (not optional) is the correct design constraint — it makes future call-site omission a type error rather than a silent gap.

---

## Required Actions Before This Change Closes

| # | Finding | Severity | Action |
|---|---|---|---|
| 1 | Redis state GET+DEL non-atomic | Low | Replace `redis.get` + `redis.del` with `redis.getdel` |
| 2 | `request.ip` reflects proxy IP without `trustProxy` | Medium | Add `trustProxy` configuration to `app.ts`; document chosen value in deployment config |
| 3 | `join.link_redeemed` missing `sourceIp` | Medium | Add `sourceIp` field to the `join.link_redeemed` event alongside the `join.link_rejected` fix |
| 4 | `executeJoinFlow` INSERT missing `RETURNING id` | Medium | Add `RETURNING id`; gate the `join.link_redeemed` event on actual insert; use result to determine `?newMember=true` vs `?alreadyMember=true` — tasks.md must be updated to reflect this dependency |

Findings 1 and 3 are straightforward one-line changes. Finding 4 is a prerequisite for Task 3 in tasks.md; I would not sign off on the Task 3 implementation until the RETURNING clause is in place.

Finding 2 (trustProxy) is the most operationally significant issue in this review. It does not affect the correctness of the join flow itself, but it makes every `sourceIp` field in every audit event wrong in production. This change is introducing `sourceIp` into a new function explicitly, which makes fixing the underlying issue now the right call rather than deferring it further.

---

## Deferred Items and Standing Risks

**No revocation endpoint (design decision).** The 7-day expiry is an adequate interim control. The risk is documented. When revocation is implemented, the design for that change should evaluate whether validation should move inside the INSERT transaction to eliminate the TOCTOU window between validation and insert. At that point I want a design review.

**EM enforcement deferred to session participation.** An EM who joins via a link gets a `participant` membership row. This is explicitly documented and correct by design. The session participation spec stub is the right artifact to prevent this from being re-litigated or forgotten. I will review the session participation design when it is produced.

**No rate limiting on join or login endpoints.** This was noted as F-06 in the original sign-in review. It has not been addressed in any subsequent change. I am elevating this: unauthenticated endpoints that accept a bearer token and perform a database lookup (`GET /api/join/:token`) and unauthenticated endpoints that initiate OIDC flows (`GET /auth/login`) should have IP-based rate limiting. The join endpoint's 256-bit entropy makes token guessing computationally infeasible, but rate limiting is the control that makes it observable — a sustained scan against the join endpoint should generate a detectable signal, not just a run of 404s in the database.

---

*Review conducted by Tomás Ferreira, Information Security. I am available for consultation on the `trustProxy` configuration if the deployment topology needs to be established before this can be resolved. Finding 4 (RETURNING clause) should be verified in code review before the through-auth path implementation is merged.*
