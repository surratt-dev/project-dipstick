## Context

`users.global_role` has exactly one writer: the sign-in upsert in `packages/backend/src/auth/account-resolver.ts`. That upsert maps the IdP role claim (`OIDC_ROLE_CLAIM`, default `role`) through `mapRoleClaimToGlobalRole` and overwrites the column every time someone signs in. Three things stop a facilitator from persisting today:

| Where | What it does today | Effect |
|---|---|---|
| `PERMITTED_GLOBAL_ROLES` (`account-resolver.ts:52-56`) | `{engineer, engineering_manager, application_admin}` | `facilitator` and `senior_engineer` are dropped to `engineer` with a warning |
| `String(rawClaimValue)` (`:83`) | Coerces whatever the claim holds | `["facilitator"]` passes by accident. `["senior_engineer","facilitator"]` becomes `"senior_engineer,facilitator"` and is rejected |
| `role_claim_mapped` gating (`routes/auth.ts:337, 371`) | Fires only when the new role ≠ `engineer`, and the condition is duplicated across two sites | A demotion to `engineer` writes no row. The structured log line has no `previousRole` |

The enum (`migrations/1_create_enums.sql`) and `UserRole` (`packages/shared/src/types/user.ts`) already list all five roles, so no migration is needed. Everything downstream that gates on `global_role = 'facilitator'` (session creation, standing topic admin, `canFacilitateSessions`) already reads the column live. Once the column holds `facilitator`, those checks work as written.

One more gap sits under all of this. The `oidc-auth` requirement "OIDC callback and token validation" already says ID-token validation SHALL include "signature verification via the IdP's JWKS endpoint", and it has a "Token signature validation failure" scenario. `oidc-client.ts` does not turn that on. openid-client v6 checks `iss`, `aud`, `exp`, `iat` and `nonce` on a token-endpoint ID token, but it checks the JWS signature only after `enableNonRepudiationChecks` (Security review S1). This change makes that claim carry `facilitator` and `application_admin` from arrays, so it closes the gap (Decision 11, D9).

The decisions recorded in `decision-log.md` are binding here: 4 (fire on any change), 6 (string or array, precedence), 7 (the order), 8 (allowlist `senior_engineer`), 9 (manager risk handled in docs), 10 (no UI copy change), 11 (verify the ID-token signature in this change), 12 (existing sessions stay with a revoked facilitator; documented, no code), 13 (S3 docs; S4/S5 at the architect's discretion).

## Goals / Non-Goals

**Goals:**
- A user whose IdP sends `facilitator` signs in as a facilitator and still is one at the next sign-in.
- The role claim is read only from an ID token whose signature has been checked against the IdP's JWKS.
- The allowlist is closed, equals the `user_role` enum, and can't be widened without a failing test.
- String and array claims resolve deterministically by a fixed precedence. Raw values never reach a log line or an audit row.
- Every change of `global_role` at sign-in, demotions included, produces exactly one `auth.role_claim_mapped` row and log line, and both carry `previousRole`.
- Local dev has a real facilitator persona and no SQL workaround.

**Non-Goals:**
- Any application-side writer for `global_role`, including admin endpoints, UI and seeds.
- Reporting-chain modelling (proposal Non-goals, Follow-up 2).
- #237 routing, `/no-team` copy, role badges, session lifetime changes, an in-app revoke control.
- Alerting on the EM-plus-facilitator combination (Decision 9).

## Decisions

### D1. One ordered constant is the allowlist and the precedence

```ts
// Highest first. The allowlist IS this list; there is no second list to keep in sync.
export const ROLE_PRECEDENCE = [
  "application_admin",
  "facilitator",
  "engineering_manager",
  "senior_engineer",
  "engineer",
] as const satisfies readonly UserRole[];
const PERMITTED_GLOBAL_ROLES: ReadonlySet<string> = new Set(ROLE_PRECEDENCE);
```

- For: the allowlist and the order can't disagree. `satisfies readonly UserRole[]` makes the compiler reject a value that isn't in the shared enum.
- The set-equality test (tasks 1.1) compares `new Set(ROLE_PRECEDENCE)` with a **literal** five-element set written out in the test, not with `UserRole`. A change to the enum then still needs a deliberate test edit, which brings a spec delta with it. A second test pins the exact order.
- Alternative considered: a precedence map keyed by role (`{application_admin: 4, …}`). Rejected. Two values with the same rank would be legal, and the ordering would be harder to read in review.

### D2. Claim shape handling (Decision 6)

`mapRoleClaimToGlobalRole(rawClaimValue, logger?)` is exported (for unit tests only; the module's public use is still `resolveOrCreateAccount`). It normalises the claim as follows:

| Raw claim | Treated as | Warning |
|---|---|---|
| `undefined` / `null` (key absent) | no candidates → `engineer` | none, because this is the normal case for most users |
| string | one element | if not allowlisted |
| array | its elements | if any element is ignored, or if no element is allowlisted (including `[]`) |
| anything else (number, boolean, object) | one non-allowlisted element | yes |

- Allowlist membership is **exact string equality**. No trimming, case folding or comma splitting. `"Facilitator"`, `" facilitator"` and `"facilitator,engineer"` are each one non-allowlisted value. Normalising input would widen what counts as a privileged claim, and an IdP administrator can always send the exact value.
- A non-string array element counts as ignored. It is never coerced.
- Duplicates (`["facilitator","facilitator"]`) are harmless. The result is `facilitator` with nothing ignored. Counts are per element and duplicates are not collapsed, so `["facilitator","facilitator","superuser"]` warns with `ignoredCount: 1, allowlistedCount: 2`.
- Only a top-level `undefined`/`null` is an absent claim. A `null` element inside an array is a non-string element: `[null]` maps to `engineer` and warns with `claimShape: "array", ignoredCount: 1, allowlistedCount: 0`.
- The result is the first entry of `ROLE_PRECEDENCE` that appears among the allowlisted elements, or `engineer` when there is none.

**Warning shape (never raw values).** At most one allowlist warning per sign-in. D3 may add one outranked warning, so a sign-in emits at most two warnings in total (for example `["facilitator","engineering_manager","superuser"]` emits both). Message `"OIDC role claim contained values not on the allowlist; ignored"`, fields `{ claimName, claimShape: "string" | "array" | "other", ignoredCount, allowlistedCount }`. `claimName` is configuration, not user input. The current test already asserts that `superuser` is absent from the message and the fields, and the new tests extend that check to every element of an array (tasks 1.4).

### D3. Outranked `engineering_manager` is logged (exploration open item 1: yes, narrowed)

When `engineering_manager` is among the allowlisted elements but loses to a higher role, emit one `warn`: message `"OIDC role claim carried engineering_manager but a higher-precedence role was applied"`, fields `{ claimName, appliedRole, outrankedRoles }`. `outrankedRoles` lists every distinct allowlisted value other than the applied role (not only `engineering_manager`), once each, in `ROLE_PRECEDENCE` order (highest first). For `["application_admin","facilitator","engineering_manager"]` it is `["facilitator","engineering_manager"]`. These are enum strings produced by the allowlist filter, not raw input, so they are safe to log.

- Why only EM: it is the one outranking that weakens a ritual constraint. That is the no-manager rule's `global_role` signal (proposal Constraints). `["senior_engineer","facilitator"]` is an ordinary Entra assignment, and warning on every such sign-in would bury the one line that matters.
- It is log-only, with no `audit_log` row and no alert (Decision 9). A user resolved this way still gets the normal `role_claim_mapped` row, and its `globalRole` is the applied role. `outrankedRoles` is not copied into that row's metadata (Security S4, declined; see Review disposition).

### D4. Logger call order follows pino

The resolver's `logger` parameter today is typed `{ warn(msg, fields?) }`, and `routes/auth.ts` passes `request.log` (pino). Pino's signature is `warn(obj, msg)`. When the first argument is a string, later arguments are treated as format arguments, so the `{ claimName }` object is very likely dropped from production log output today. The unit test can't see this, because it mocks `warn` with the same wrong order. This change types the parameter as `Pick<FastifyBaseLogger, "warn">` and calls `logger.warn(fields, msg)`. The tests then assert `calls[0][0]` is the field object and `calls[0][1]` is the message. If pino's actual behaviour turns out to keep the fields, the change is still correct, because it matches every other log call in the backend. The type documents the order but does not enforce it: pino's `LogFn` also has a `(msg: string, ...args)` overload, so `warn(msg, fields)` still compiles. The tests are the guard, and they assert argument order on **both** warnings (D2 and D3).

### D5. One predicate decides `role_claim_mapped` (Decision 4)

```ts
// packages/backend/src/auth/account-resolution-audit.ts
export function shouldRecordRoleClaimMapped(u: Pick<ResolvedUser, "isNewUser" | "globalRole" | "previousGlobalRole">): boolean {
  if (u.isNewUser) return false;                       // first_access_created covers it
  return u.globalRole !== "engineer" || u.previousGlobalRole !== u.globalRole;
}
```

- The `audit_log` INSERT branch (inside `withAuditTransaction`) and the post-commit `emitAuditEvent` branch both call it. Today the condition is copied into two places. That is how the row and the log line could drift apart, and one decision point removes the risk.
- The structured log line gains `previousRole: user.previousGlobalRole`, which matches the row's metadata. The field set is `{ userId, oidcSubject, globalRole, previousRole, sourceIp, correlationId }`.
- `previousGlobalRole` comes from the `prior` CTE in the same upsert statement (unchanged), so it is captured in the same statement as the write. Concurrent sign-ins for one user may each record the same transition: under READ COMMITTED, `prior` reads the statement snapshot while `ON CONFLICT DO UPDATE` waits for the row lock, so two tabs finishing sign-in together can both write `facilitator → engineer`. That is a duplicate row, never a missed transition, and it is accepted. No test is added for it.
- Unchanged: transactional coupling, `AuditWriteError`, the post-commit-only emission, and `actor_global_role = globalRole` (for a demotion row that means `engineer`, the role the actor holds now).

To make the integration test (tasks 3.x) honest without driving the whole OIDC callback, the row-writing body of the `withAuditTransaction` callback moves into `writeAccountResolutionAuditRow(client, user, { ip, correlationId })` in `packages/backend/src/auth/account-resolution-audit.ts`. `routes/auth.ts` calls it, and the integration test calls the same function on a real Postgres client. It contains no new logic, only the existing two INSERTs behind `shouldRecordRoleClaimMapped` (which moves into the same module).

**Constraint on the new module.** `account-resolution-audit.ts` has **type-only** imports: `import type { PoolClient } from "pg"` and `import type { ResolvedUser } from "./account-resolver.js"`. It imports nothing at runtime from `db.js`, `config.js`, `audit-logger.js` or `account-resolver.js`. That keeps `auth.test.ts`'s existing `vi.mock` set sufficient, avoids a runtime import cycle, and lets the integration test import it with no mocks. A lint or review check at task 2.2 enforces this.

**Integration-test notes (tasks section 3).**
- It follows the repo's real-Postgres pattern: `describe.skipIf(!infraUp)` plus `requireInfraOrThrow`, so it fails under `REQUIRE_DB=1` in `integration.yml` and skips in `ci.yml`. It sets env fallbacks, then uses dynamic imports. It lives in `auth/__tests__/` and imports `../../routes/__tests__/helpers/real-db.js`.
- `probeInfra()` also requires Redis. The file therefore skips locally when Redis is down, even though it doesn't use Redis. That is accepted for consistency with the other integration files.
- `ROLE_CLAIM_NAME` is fixed at module load (`config.OIDC_ROLE_CLAIM ?? "role"`). Both lanes use the default, so every test puts its claim, array claims included, under **`role`**. Setting `OIDC_ROLE_CLAIM` partway through the file has no effect.
- Subjects are `randomUUID()` with a fixed test issuer. Cleanup deletes `audit_log` by `actor_user_id`, then `users`. `audit_log` has no append-only trigger and no FK to `users` (`8_audit_log.sql`).
- Every "previous role" in 3.1–3.4 comes from an earlier sign-in through `resolveOrCreateAccount`, not from a direct `UPDATE users`. The test-fixture exception stays in the spec, but this change should not need to use it.

### D6. Local dev

- `docker/oidc/accounts.js`: `facilitator-001` gets `role: "facilitator"`. The header comment is rewritten to say that all three non-participant personas carry a role claim, and that `participant-001` relies on the default.
- `routes/auth.ts` `DEV_LOGIN_OPTIONS`: `facilitator-001` gets `seeded: true`. The frontend's unseeded-caveat branch stays (persona-login still specifies it), but no option uses it now.
- `facilitator-001` stays a member of no team. The only seeded team is `__default_topics__` (`migrations/4_seed_data.sql`), the template team, which can't host sessions. So the "team I'm not a member of" precondition is met by the existing new-team flow: sign in, land on the session-creation entry point (zero-membership carve-out), create a team. `POST /api/v1/teams` already refuses to make the creator a member. The exploration note's "name the seeded team" item resolves to "there is none, use the new-team flow", and the docs say so. Seeding a demo team is out of scope.
- `docs/test-scripts/topic-add-form-hands-on-check.md` keeps "sign in once first". Its setup SQL creates teams and needs the `users` row. It drops the `UPDATE users SET global_role` line, the "Order matters" callout, the Part 5 re-run note, and the cleanup's reset-to-`engineer` line.

### D7. Latency and revocation (exploration Finding 4, open item 2)

What the code does, confirmed by reading `auth/middleware.ts`:
- `global_role` changes only at a completed `/auth/callback`. Token refresh (`refreshSessionTokens`) does not re-read claims and does not count as "authentication" for role purposes. This holds for revocation as well as grant: a user whose `facilitator` claim is removed keeps `global_role = 'facilitator'` (and `POST /api/v1/teams` keeps succeeding for them, since it reads the live column) until their next `/auth/callback`.
- The absolute session lifetime is 90 minutes (`ABSOLUTE_LIFETIME_MS`), so a role change reaches a signed-in user within 90 minutes at most, or immediately if they sign out and back in.
- If an operator revokes the user's refresh tokens at the IdP, the next refresh attempt gets `invalid_grant`. It is classified as `revoked` with no retry, and the session is destroyed with an `auth.session_invalidated` row (`reason: token_revoked`). Refresh is attempted only once the access token is within 5 minutes of expiry (`TOKEN_REFRESH_THRESHOLD_S`). Revocation therefore ends the app session at roughly (access-token remaining lifetime − 5 min). That bound depends on the IdP. With Entra's default access-token lifetime (60–90 min, randomised) it is usually **no faster than the 90-minute cap**. The docs say this plainly and do not promise a fast kill switch. **Accepted control (decision-log row 15):** the product owner signed off on the 90-minute absolute session lifetime as the control mechanism for role-change and revocation latency. IdP-side revocation latency will not be measured (proposal Follow-up 3 withdrawn).
- **Sessions a revoked facilitator already runs stay with them (Decision 12).** Revocation stops a facilitator from creating teams and opening sessions. A draft cannot be opened once the live `global_role` is no longer `facilitator`, because `facilitator-sessions.ts` re-reads it before draft → `lobby`. A session already in `lobby` or later is controlled through `sessions.facilitator_id` alone (`session-subscriber-access-helper.ts`), so the demoted facilitator keeps running it to the end. This is deliberate: ending a live ceremony mid-reveal harms the participants more than letting it finish does. There is no code change. The docs (D8 item 4) say so in one sentence.

### D8. Deployment docs structure

A new `## Role claim (OIDC_ROLE_CLAIM)` section in `docs/deployment.md`, placed after "Required environment variables". `OIDC_ROLE_CLAIM` also goes in the Optional table. The section holds exactly the five items in the `first-access` requirement "Deployment documentation describes the role claim", plus the manager warning, and no more (VP review: operators' needs only, not an IdP tutorial):
1. `OIDC_ROLE_CLAIM` and the allowlist table: the five values, `facilitator` marked privileged, `senior_engineer` marked identical to `engineer`. One sentence: the claim must be one that only IdP administrators can set, such as Entra app roles, and never a user-editable attribute (Security S3).
2. String or array, exact match, precedence order.
3. One Entra example: app roles whose **Value** is the exact role string, assigned to users or groups, `OIDC_ROLE_CLAIM=roles`, emitted as an array on the ID token. No Okta or Keycloak walkthrough until a customer asks.
4. When changes take effect: next sign-in, within 90 minutes; a newly granted facilitator should sign out and in; IdP revocation behaves as in D7 and there is no in-app control. One sentence: a revoked facilitator keeps running any session they have already opened, until it ends (D7, Decision 12).
5. Troubleshooting: "I was given facilitator but still see the join-link page". Causes: not signed in again; wrong `OIDC_ROLE_CLAIM` name; IdP not sending the claim on the ID token; value not an exact match. How to check: the allowlist warning in the logs, `role_claim_mapped` rows.

Plus the **manager warning**, verbatim from the proposal.

### D9. ID-token signature verification is switched on (Decision 11, Security S1)

**How.** In `packages/backend/src/auth/oidc-client.ts` `getOidcConfig()`, right after `client.discovery(...)` resolves and before the `Configuration` is cached and returned:

```ts
oidcConfig = await client.discovery(/* unchanged */);
// oidc-auth "OIDC callback and token validation": verify the ID token's JWS
// signature against the IdP's JWKS. Without this, openid-client v6 validates
// iss/aud/exp/iat/nonce on a token-endpoint ID token but not its signature.
client.enableNonRepudiationChecks(oidcConfig);
```

There is no new environment variable and no off switch, in either production or development. `handleCallback` and `routes/auth.ts` don't change. Verification runs inside `authorizationCodeGrant`, before `handleCallback` returns, so `tokens.claims()` and `resolveOrCreateAccount` never see an unverified token. No `users` write, no `audit_log` row and no role mapping happen on a token that fails.

The setting belongs to the shared `Configuration`, so it also applies to `refreshTokenGrant` whenever the IdP returns a fresh ID token on refresh (A1). The refresh path does not read claims (D7), so the only effect there is that a bad-signature refresh response fails.

**JWKS fetching.**
- The JWKS comes from the discovery document's `jwks_uri`. It is fetched lazily on the first verification in each process and cached in memory on the `Configuration`. When a token carries a `kid` that is not in the cache (IdP key rotation), the library refetches, with its own rate limit (A2). No application code fetches or caches keys.
- Consequences: the first sign-in after each process start makes one extra GET to the IdP. Key rotation needs no operator action. Each backend replica keeps its own cache, which is fine at this scale. If the JWKS endpoint is down, **new sign-ins** fail; existing app sessions carry on until a refresh returns an ID token that needs a key the process doesn't hold.
- The `execute: [allowInsecureRequests]` option already on the `Configuration` (non-production only) also covers the JWKS fetch, so an `http:` JWKS works locally and is refused in production.
- Algorithms: when neither the client nor discovery names one, the library expects `RS256`. It accepts asymmetric algorithms only, so `alg: none` and `HS*` ID tokens fail (A3). Entra and the local `oidc-provider` both sign with `RS256`. Entra caveat: an app registration that uses a claims-mapping policy with an app-specific signing key publishes that key only at a JWKS URL with an `appid` query, so the standard `jwks_uri` will not hold it and every sign-in fails closed. App roles, which D8 documents, need no claims-mapping policy. This goes in the Risks list, not the docs.

**When verification fails.**
- A bad signature, an unknown key or a disallowed `alg` makes the library throw. The expected throw is an `OperationProcessingError` or `ClientError` with a `code` such as `OAUTH_JWS_SIGNATURE_VERIFICATION_FAILED` or a key-selection code, and a static message such as `"JWT signature verification failed"` (A4).
- The callback's existing catch handles it. `sanitizeOidcError` already has a branch for both classes and logs `errorClass`, `message` and `code`, so `auth.callback_error` tells an operator it was a signature failure. `mapAuthError` matches none of its keyword branches and falls through to the default, **`authentication_failed`**. That is the right category under `auth-error-handling` "Distinct error messages for authentication failure modes": the IdP returned something the app could not accept. It is not `invalid_request`, which is reserved for state, nonce and CSRF and tells the user to restart. It is not `provider_unavailable`, because the IdP answered. `auth.failure` is emitted with `failureCategory: authentication_failed`, and the user goes to `/auth/error` with the default "try again / contact IT" message.
- `mapAuthError` gets **no new branch**. A test pins the category instead (tasks S.4), so a future keyword branch that happens to match the message can't silently reclassify it.
- JWKS unreachable (network error) surfaces as the same `fetch failed` `TypeError` as an unreachable token endpoint, which maps to `provider_unavailable` (A5). A pin test covers this.
- On refresh, a verification failure is not `invalid_grant`. It goes down the existing transient-retry path, and the session ends as `transient_failure` once the retries run out. This fails closed and is accepted without a dedicated test.

**Local docker OIDC provider.** It is compatible with no change. `docker/oidc/server.js` (`oidc-provider` ^8) signs ID tokens `RS256` with its inline 2048-bit `jwks` key and publishes the public half at the `jwks_uri` it advertises in discovery. The issuer is `http://localhost:4011`, so the JWKS URL has the same origin as the token endpoint and is reachable wherever sign-in already works. The inline key has no `kid`. `oidc-provider` derives one (its JWK thumbprint), and with a single key the library would select it even without a `kid` (A6). CI's `integration.yml` drives no real OIDC sign-in, so the manual local sign-in in task 5.6 is the end-to-end confirmation, and it is now a stated check.

**Tests (test-first, tasks section S).** The existing `oidc-client.test.ts` mocks `openid-client` wholesale. It gets `enableNonRepudiationChecks: vi.fn()` in its mock factory (otherwise the missing export breaks every test in the file) and one assertion that the call happens once, with the discovered config. The real rejection test is a new `auth/__tests__/oidc-client-signature.test.ts`. It does **not** mock `openid-client`. It mocks `config.js`, stubs the global `fetch` (A7) to serve a discovery document, a JWKS and a token response, and calls the real `handleCallback`. Keys come from `node:crypto` (`generateKeyPairSync("rsa", { modulusLength: 2048 })`, `export({ format: "jwk" })`, `crypto.sign("sha256", …)`), so it adds no dependency (`jose` is only transitive). The cases:
- a correctly signed token resolves and its `claims().role` is `"facilitator"`. This positive control proves the harness is sound.
- a token signed by a different key under the JWKS key's `kid` is rejected.
- a correctly signed token whose payload `role` was changed to `"application_admin"` after signing is rejected.
- for both rejections, `mapAuthError(err).category === "authentication_failed"` and `sanitizeOidcError(err, log)` carries a `code`.
- a JWKS fetch that rejects with `TypeError("fetch failed")` maps to `provider_unavailable`.

**Library assumptions to confirm during implementation.** `node_modules` was unavailable at design time. Each assumption is checked against the installed `openid-client` 6.8.4 / `oauth4webapi` 3.8.6 source, or by the S-section tests, before task S.3 is ticked. If any is wrong, record it in the PR and revise this section.
- A1: `enableNonRepudiationChecks(config)` is exported in 6.8.x, mutates the `Configuration` in place, and also covers ID tokens returned by `refreshTokenGrant`.
- A2: the JWKS is fetched lazily from `jwks_uri`, cached on the `Configuration`, and refetched on an unknown `kid` with a cooldown.
- A3: `RS256` is the default expected `alg`, and symmetric or `none` algorithms are rejected for this check.
- A4: the failure error class is `ClientError` or `OperationProcessingError`, with a static message that contains none of `mapAuthError`'s keywords (`state`, `nonce`, `csrf`, `network`, `fetch failed`, …). S.4 pins this.
- A5: a JWKS network failure propagates as a `TypeError` whose message contains `fetch failed`. S.4 pins this.
- A6: `oidc-provider` publishes a usable `kid` for a key configured without one.
- A7: `discovery` and the grant use `globalThis.fetch` at call time, so `vi.stubGlobal("fetch", …)` intercepts them. If not, pass `[client.customFetch]` through a test-only seam in `getOidcConfig`. That seam must not be reachable from configuration.

## Risks / Trade-offs

- **[Precedence weakens the no-manager rule for EM+facilitator users]** → Docs warning, the D3 log line, and the existing membership-based hard blocks. Accepted (Decision 7, 9). Recorded in the proposal Constraints.
- **[Behaviour change for deployments already sending arrays]** → A multi-element array that used to fall back to `engineer` now maps by precedence. Called out in the release note. An operator who relied on the fallback was relying on a bug.
- **[`senior_engineer` writes a `role_claim_mapped` row on every sign-in]** → Same as EM and admin today. Accepted (Decision 8), not to be reopened.
- **[Stale role up to 90 minutes]** → Specified as a limitation. Docs tell people to sign out and in. IdP revocation is documented honestly as roughly no faster. Risk accepted by the product owner: the 90-minute absolute session lifetime is the control (decision-log row 15).
- **[A future change adds an app-side role writer]** → The `first-access` spec now says the application never writes `facilitator`, and the deferral doc says in-app designation is only a fallback for an IdP without custom claims.
- **[Signature verification adds a runtime dependency on the IdP's JWKS endpoint]** → New sign-ins fail while it is unreachable (`provider_unavailable`). Sessions that are already signed in are unaffected. Keys are cached in memory and refetched on rotation by the library (D9). Accepted: an unverifiable token must not be trusted.
- **[An Entra app with an app-specific signing key fails every sign-in]** → Only when it uses a claims-mapping policy, which app roles don't need. The failure is closed and shows `code` in `auth.callback_error`. Not documented in D8, which covers operators' needs only. Revisit if a customer hits it.
- **[Exact-match strictness rejects a case-variant value an IdP admin typed]** → The allowlist warning tells the operator a value was ignored, and the troubleshooting entry covers it. Failing closed is the right direction for a privilege claim.

## Migration Plan

No schema change. Deploy order does not matter. Existing rows stay as they are until each user's next sign-in. Rollback is a redeploy of the previous build: users mapped to `facilitator` or `senior_engineer` fall back to `engineer` at their next sign-in, and the old code writes no row for that. That gap is acceptable for a rollback. A rollback also turns ID-token signature verification back off (D9). That is the pre-change posture, and the release note says so.

## Open Questions

None blocking. D9 lists library-behaviour assumptions (A1–A7) that are confirmed at implementation, not open design questions. Exploration open item 1 is decided in D3, open item 2 in D7 (mechanism confirmed; the 90-minute session lifetime is the accepted control, decision-log row 15), and open item 3 is task 6.4. Open item 4 is proposal Follow-up 2, for a human to file.

## Review disposition

Design-stage reviews: Engineer (Marcus Oyelaran) and Security (Tomás Ferreira). User decisions 4, 6, 7, 11 and 12 are binding and were not reopened.

| # | Reviewer point | Disposition | Rationale |
|---|---|---|---|
| Eng F1 | Pino argument order: say the type doesn't enforce it; assert order on both warnings | Accepted | D4 sentence added. Task 1.4 now covers the D2 and D3 warnings. |
| Eng F2 | D2 "one warn per sign-in" contradicts D3 | Accepted | D2 now says at most one allowlist warning plus at most one outranked warning. Task 1.8 adds the two-warning mixed case. |
| Eng F3 | D5 overclaims concurrency | Accepted | Reworded to "same statement; concurrent sign-ins may each record the same transition". No test added. |
| Eng F4 | New audit module must stay dependency-free, with type-only imports | Accepted | Stated as a D5 constraint and checked at task 2.2. |
| Eng F5 | Integration practicalities: skip pattern, Redis-coupled probe, `role` claim name, cleanup, prefer IdP-path prior roles | Accepted | D5 "Integration-test notes". Section 3 preamble and task 3.4 updated. |
| Eng F6 | `interactions.test.js` is definitely affected | Accepted | proposal Impact corrected. |
| Eng F7 | Narrow `mapRoleClaimToGlobalRole` to return `UserRole` | Accepted (optional) | No cost, and it doesn't spread. Folded into task 1.2. `ResolvedUser.globalRole` stays `string`. |
| Sec S1 | ID-token signature isn't verified; enable it or correct the wording | Accepted, option (a) | Decision 11. New D9 and an `oidc-auth` delta. Tasks section S comes first and is written test-first. |
| Sec S2 | Revoked facilitator keeps sessions already created; state it | Accepted | Decision 12. D7 bullet and one sentence in docs item 4. No code. |
| Sec S3 | `OIDC_ROLE_CLAIM` must name an admin-only claim | Accepted | Decision 13. One sentence in D8 item 1 and in the `first-access` docs requirement. |
| Sec S4 | Record `outrankedRoles` in the `role_claim_mapped` row | Declined | It would widen `ResolvedUser` and the audit spec for a risk Decision 9 settled as docs-only. The control an incident reviewer needs is `team_memberships` (EM rows), not the claim shape. Added as an input to Follow-up 2, where it can be revisited if reporting-chain evidence becomes a requirement. |
| Sec S5 | Dev-provider production guard misses `::1` and single-label hosts | Follow-up | Pre-existing, and the fix changes production startup validation in `config.ts`, which is not trivially in scope. Signature verification does not mitigate it, because the simulator signs validly. proposal Follow-up 4, owner Security. |
| Sec (table) | Assert no claim value appears in **either** logger argument | Accepted | Task 1.4 already stringifies the whole `calls` array. Wording made explicit. |
| Sec (table) | Rollback writes no demotion row; release note | Accepted | Already in the Migration Plan. The release-note line now also covers the signature-verification rollback. |
