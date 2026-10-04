## Conventions for every task

- **Test first.** A task labelled **(red)** writes a test and runs it to see it fail for the stated reason before the matching **(green)** task changes production code. The failure must be an assertion on the behaviour named, not an import error or a missing file. A task labelled **(red, retroactive)** is a test written after the code it targets, whose red evidence is a run against a named earlier commit. A task labelled **(pin)** adds a regression test that should pass on first run; if it fails, stop and investigate before going on. A task labelled **(refactor)** changes structure only: no new tests, and every existing test stays green.
- **Evidence before ticking.** No red, green, pin or refactor task is ticked without a recorded test run. If the environment has no `node_modules`, database or Docker daemon, write the code and tests, leave those tasks unticked, and state in the PR that the TDD evidence is outstanding. Documentation and inspection-only tasks may be ticked on their own.
- Unit tests for the resolver live in `packages/backend/src/auth/__tests__/account-resolver.test.ts` and keep its existing `db.js`/`config.js` mocks.
- Fixture `global_role` values come only from the `user_role` enum (`engineer`, `senior_engineer`, `facilitator`, `engineering_manager`, `application_admin`). `participant` is a membership role, never a global role.
- No test, fixture, doc or script may write `users.global_role` directly to obtain a role, except as the "previous role" setup row in the integration tests in section 3 (design D5 expects none of those tests to need it). This is the test-fixture exception stated in the `first-access` requirement "Facilitator designation comes only from the IdP and persists across sign-in"; it does not extend to docs, seeds or scripts a person runs. The only other `global_role` write in the repo is the pre-existing non-person `system` row in `packages/backend/migrations/4_seed_data.sql`, which the same requirement carves out; add nothing under that carve-out.
- **Execution order** is the document order: 0 → S → 1 → 2 → 3 → 4 → 5 → 6 → 7. Task 0.2 (the pure-move refactor) runs before any behaviour change so that section 3 has a commit to be red against.

## 0. Pre-check and preparatory refactor

- [ ] 0.1 Run `openspec validate facilitator-role-claim-allowlist --strict` (CLI unavailable in the proposal environment; see 7.4). Fix any delta-format error before writing code. If the CLI still cannot run, record 0.1 as **UNMET** and carry it to 7.4; do not substitute a hand check.
- [ ] 0.2 **(refactor)** Pure move, design D5. Create `packages/backend/src/auth/account-resolution-audit.ts` exporting `writeAccountResolutionAuditRow(client, user, { ip, correlationId })`, and move the two existing `INSERT INTO audit_log` statements out of `routes/auth.ts`'s `withAuditTransaction` callback **byte-for-byte unchanged, including today's firing condition** (`isNewUser` → `first_access_created`; else `globalRole !== "engineer"` → `role_claim_mapped`). `routes/auth.ts` calls the writer; the post-commit `emitAuditEvent` sites are untouched. The module uses **type-only** imports (`import type { PoolClient }`, `import type { ResolvedUser }`) and nothing at runtime from `db.js`, `config.js`, `audit-logger.js` or `account-resolver.js`; check this by reading the import block. No new tests. All of `auth.test.ts` and `account-resolver.test.ts` stay green. Commit this alone and record its SHA in the PR as **C0**: the allowlist and the firing condition are both pre-change at C0, and section 3 is red against it (3.5).

## S. ID-token signature verification (`packages/backend/src/auth/oidc-client.ts`, design D9, Decision 11)

Do this section before any behaviour change: the role claim is only worth mapping once the token carrying it is verified. Before ticking S.3, confirm assumptions A1–A7 in design D9 against the installed `openid-client`/`oauth4webapi` source, and record any that turn out wrong in the PR.

- [ ] S.1 **(red)** New `packages/backend/src/auth/__tests__/oidc-client-signature.test.ts`. It does **not** mock `openid-client`. It mocks `../../config.js` (`NODE_ENV: "test"`, fixed issuer, client id and secret, redirect URI). It stubs global `fetch` to serve discovery (with `jwks_uri` and `id_token_signing_alg_values_supported: ["RS256"]`), a JWKS holding key A's public JWK with `kid: "k1"`, and a token endpoint whose `id_token` each test sets. RSA keys and RS256 signatures come from `node:crypto`, with no new dependency. Cases, all through the real `handleCallback`:
  - (a) positive control: a token signed by key A, with valid `iss`/`aud`/`exp`/`iat`/`nonce` and `role: "facilitator"`, resolves, and `claims().role === "facilitator"`
  - (b) a token signed by key B with header `kid: "k1"` rejects
  - (c) a key-A-signed token whose payload is re-encoded after signing with `role: "application_admin"` rejects
  - (d) a token with header `alg: "none"` and an empty signature rejects
  - (e) for (b), (c) **and (d)**, `mapAuthError(err).category === "authentication_failed"`, and `sanitizeOidcError(err, log)` returns a `code`. If (d) is rejected earlier by a different check (for example an unsupported-`alg` guard) and its category differs, record the actual category and the reason in the PR rather than weakening the assertion silently.

  Fails: (b), (c) and possibly (d) resolve, because signatures aren't checked yet. (a) must pass; if it doesn't, fix the harness before going on.
- [ ] S.2 **(red)** `auth/__tests__/oidc-client.test.ts`: add `enableNonRepudiationChecks: vi.fn()` to the `openid-client` mock factory. Assert `getOidcConfig()` calls it exactly once, with the config `discovery` returned, and that a second `getOidcConfig()` call does not call it again (cached). Fails: not called.
- [ ] S.3 **(green)** `oidc-client.ts` `getOidcConfig()`: call `client.enableNonRepudiationChecks(oidcConfig)` right after `discovery` resolves, with the D9 comment. Add no env flag. S.1 and S.2 pass. The rest of `oidc-client.test.ts` and `auth.test.ts` still pass.
  - Local-key smoke (design D9 A6, derived `kid`): if the compose stack can run, do one `facilitator-001` or `engineer-001` sign-in now against the local `oidc-provider` and confirm there is no `auth.callback_error` in the backend log. If it cannot run here, record "S.3 local-key compatibility unverified" in the PR; 5.6 then becomes a **merge gate** for the whole change, not just section 5, because a failure breaks every local sign-in.
- [ ] S.4 **(pin)** In the S.1 file: JWKS fetch rejects with `new TypeError("fetch failed")` → `handleCallback` rejects, and `mapAuthError(err).category === "provider_unavailable"` (A5). Keep this task after S.3: before verification is enabled no JWKS fetch happens, so it cannot be exercised.
- [ ] S.5 **(pin)** `routes/__tests__/auth.test.ts`, callback error block: `handleCallback` rejects with `new Error("JWT signature verification failed")` → `resolveOrCreateAccount` is not called, there is no `audit_log` INSERT, the redirect carries `category=authentication_failed`, and `auth.failure` is emitted with `failureCategory: "authentication_failed"` (`oidc-auth` scenario "Token signature validation failure"). This test mocks `handleCallback`, so it passes with or without S.3; a green S.5 is **not** evidence that S.3 works (S.1 is).

## 1. Allowlist, claim shape and precedence (`packages/backend/src/auth/account-resolver.ts`, design D1–D4)

Before 1.3, grep `account-resolver.test.ts` and `routes/__tests__/auth.test.ts` for any existing test that expects `facilitator` or `senior_engineer` to map to `engineer`. None is known today (the only rejected-value test uses `superuser`, ~line 294); if one exists, rewrite it inside 1.3 so it goes red there, not in a green task.

- [ ] 1.1 **(red)** Add `describe("role-claim allowlist")`. One test asserts `new Set(ROLE_PRECEDENCE)` equals a literal `new Set(["engineer","senior_engineer","facilitator","engineering_manager","application_admin"])` written out in the test, not imported. A second test asserts the exact order `["application_admin","facilitator","engineering_manager","senior_engineer","engineer"]`. Fails: `ROLE_PRECEDENCE` is not exported (the imported binding is `undefined`, so both assertions fail).
- [ ] 1.2 **(green)** Add an exported `ROLE_PRECEDENCE` constant (`as const satisfies readonly UserRole[]`, importing `UserRole` from `@dipstick/shared`). Export `mapRoleClaimToGlobalRole` and narrow its return type to `UserRole` (`ResolvedUser.globalRole` stays `string`). **Leave `PERMITTED_GLOBAL_ROLES` as today's three-role literal**; it is not derived from `ROLE_PRECEDENCE` until 1.5. No behaviour change: 1.1 passes and every existing test still passes.
- [ ] 1.3 **(red)** String-claim tests on `mapRoleClaimToGlobalRole`: `"facilitator"` → `facilitator`, `"senior_engineer"` → `senior_engineer`, neither logs a warning; absent (`undefined`, `null`) → `engineer` with **no** warning; `"Facilitator"`, `" facilitator"`, `"facilitator,engineer"`, `""` → `engineer` with exactly one warning each. Add the same `facilitator` and `senior_engineer` cases through `resolveOrCreateAccount`, asserting the upsert's 5th parameter. Fails on the two new allowlisted values: they are still outside the three-role set and map to `engineer` with a warning.
- [ ] 1.4 **(red)** Logger-shape tests (design D4) for the string inputs in 1.3: the warning is called as `warn(fields, message)`. The type does not enforce this order, so these tests are the guard. `calls[0][0]` is an object with exactly the keys `claimName`, `claimShape`, `ignoredCount`, `allowlistedCount`, and `calls[0][1]` is a string. For every rejected input in 1.3, `JSON.stringify(calls)` (both arguments of every call) contains none of the raw values. Update the existing "allowlist-rejected claim value" test (~line 294) to the new argument order and keep its `superuser` absence assertions. Fails: current order is `(message, { claimName })`.
- [ ] 1.5 **(green)** Derive `PERMITTED_GLOBAL_ROLES` from `ROLE_PRECEDENCE`. Change the `logger` parameter type of `mapRoleClaimToGlobalRole` and `resolveOrCreateAccount` to `Pick<FastifyBaseLogger, "warn">` (or a structurally identical local type with pino's `(obj, msg)` order), and emit the D2 warning shape. 1.3 and 1.4 pass.
- [ ] 1.6 **(red)** Array and other-type tests:
  - `["senior_engineer","facilitator"]` → `facilitator`, no warning
  - `["facilitator","engineering_manager"]` → `facilitator`
  - `["engineer","facilitator","application_admin"]` → `application_admin`
  - `["superuser","facilitator"]` → `facilitator`, one warning with `ignoredCount: 1, allowlistedCount: 1, claimShape: "array"`
  - `[]` and `["superuser","root"]` → `engineer`, one warning
  - `[42, {role:"facilitator"}, "senior_engineer"]` → `senior_engineer`, `ignoredCount: 2`
  - `["facilitator","facilitator"]` → `facilitator`, no warning
  - `["facilitator","facilitator","superuser"]` → `facilitator`, one warning with `ignoredCount: 1, allowlistedCount: 2` (per-element counts, duplicates not collapsed)
  - `[null]` → `engineer`, one warning with `claimShape: "array", ignoredCount: 1, allowlistedCount: 0` (a null element is ignored, not an absent claim)
  - `42`, `true`, `{ role: "facilitator" }` → `engineer`, `claimShape: "other"`
  - raw-value check: every warning is `(fields, message)`, and for every input above with a rejected element, `JSON.stringify(calls)` contains none of the rejected raw values (`superuser`, `root`, `42`, the object)

  Add one `resolveOrCreateAccount` case with an array claim asserting the upsert parameter. Fails: arrays are `String()`-coerced today.
- [ ] 1.7 **(green)** Implement D2: normalise to candidates (string → `[s]`, array → elements, other → one non-allowlisted candidate), filter by exact membership with no coercion, and pick the first `ROLE_PRECEDENCE` entry present, else `engineer`. Remove `String(rawClaimValue)`. 1.3–1.6 pass.
- [ ] 1.8 **(red)** Outranked-EM tests (design D3): `["facilitator","engineering_manager"]` emits exactly one additional warning with fields `{ claimName, appliedRole: "facilitator", outrankedRoles: ["engineering_manager"] }`. `["application_admin","engineering_manager","senior_engineer"]` → `outrankedRoles: ["engineering_manager","senior_engineer"]`. `["engineering_manager","facilitator","application_admin","facilitator"]` → exactly one outranked warning with `appliedRole: "application_admin"`, `outrankedRoles: ["facilitator","engineering_manager"]` (every distinct loser, precedence order, deduplicated). `["senior_engineer","facilitator"]` and `["engineering_manager"]` emit no outranked warning. Mixed case: `["facilitator","engineering_manager","superuser"]` → `warn` is called exactly twice, once with the allowlist message (`ignoredCount: 1, allowlistedCount: 2`) and once with the outranked message. Both calls are `(fields, message)`, and neither contains `superuser`.
- [ ] 1.9 **(green)** Implement the D3 warning. 1.8 passes.
- [ ] 1.10 Rewrite the module header comment and the `PERMITTED_GLOBAL_ROLES` comment: five-role closed allowlist (spec "The IdP role-claim allowlist is closed"), string or array, precedence, exact match, raw values never logged, and the application never writes `global_role` itself. Remove "silently treated as absent" wording that no longer matches the warning behaviour. (6.5's grep depends on this; 6.5 stays last.)

## 2. `role_claim_mapped` firing condition and `previousRole` on the log (design D5)

The module already exists from 0.2 with today's condition. This section adds the shared predicate and switches **both** sites (row and structured log) to it in one green step, so the row and the log never disagree at any commit.

- [ ] 2.1 **(red)** New `packages/backend/src/auth/__tests__/account-resolution-audit.test.ts`: truth-table test for `shouldRecordRoleClaimMapped`:
  - new user → `false`
  - `engineer`→`engineer` → `false`
  - `facilitator`→`engineer`, `senior_engineer`→`engineer`, `engineering_manager`→`engineer`, `application_admin`→`engineer` → `true`
  - `engineer`→`facilitator`, `engineering_manager`→`facilitator` → `true`
  - `senior_engineer`→`senior_engineer`, `facilitator`→`facilitator` → `true`

  Fails: `shouldRecordRoleClaimMapped` is not exported from the 0.2 module.
- [ ] 2.2 **(green)** Add and export `shouldRecordRoleClaimMapped` in `account-resolution-audit.ts`. Do **not** wire it into the writer or `routes/auth.ts` yet; both sites keep today's condition. 2.1 passes; all of `auth.test.ts` stays green.
- [ ] 2.3 **(red)** `packages/backend/src/routes/__tests__/auth.test.ts` (near the transactional-group block, ~line 886):
  - (a) returning user `previousGlobalRole: "facilitator"`, `globalRole: "engineer"` → exactly one `'auth.role_claim_mapped'` INSERT whose metadata has `previousRole: "facilitator"`, `globalRole: "engineer"`, and actor role `engineer`; exactly one structured `auth.role_claim_mapped` event with `previousRole: "facilitator"`
  - (b) same for `senior_engineer`, `engineering_manager` and `application_admin` → `engineer` (parameterised), plus the lateral change `engineering_manager` → `facilitator`: exactly one INSERT with `metadata.previousRole: "engineering_manager"`, `metadata.globalRole: "facilitator"`, and a structured event with the same `previousRole`
  - (c) `engineer`→`engineer` → no `role_claim_mapped` INSERT and no structured event
  - (d) the existing non-default test (~line 816) also asserts `previousRole` on the structured event
  - (e) the structured event's key set is exactly `{ userId, oidcSubject, globalRole, previousRole, sourceIp, correlationId }`
  - (f) returning user `previousGlobalRole: "engineer"` whose claim is `"superuser"` (resolved `globalRole: "engineer"`) → no `role_claim_mapped` INSERT, no structured `auth.role_claim_mapped` event; the allowlist warning is the only output ("warning only", #235 AC 4)

  Fails: (a) and the four demotions in (b) write no row and emit no event under today's `!== "engineer"` gate; the lateral case in (b), (d) and (e) fail because the structured event has no `previousRole` (the lateral row already fires). (c) and (f) already pass and stay as pins.
- [ ] 2.4 **(green)** Switch **both** sites in one step: the writer's `role_claim_mapped` branch and the post-commit `emitAuditEvent("auth.role_claim_mapped", …)` in `routes/auth.ts` are both gated by `shouldRecordRoleClaimMapped(user)`, and the event gains `previousRole: user.previousGlobalRole`. Update the comment above it and the `audit-logger.ts` comment on `auth.role_claim_mapped` (~line 118) to describe the new firing condition. 2.3 passes; the rest of `auth.test.ts` still passes.
- [ ] 2.5 **(pin)** `auth.test.ts`: a failed `role_claim_mapped` INSERT on a **demotion** still rolls back the UPSERT and surfaces `AuditWriteError` → `internal_error`, and emits no structured event, the same as the existing non-default case.

## 3. Integration through `resolveOrCreateAccount` (real Postgres)

New file `packages/backend/src/auth/__tests__/role-claim-allowlist-integration.test.ts`, following `topics-integration.test.ts`'s pattern (`describe.skipIf(!infraUp)` + `requireInfraOrThrow`, env fallbacks, then dynamic imports, no `db.js` mocks). It imports helpers from `../../routes/__tests__/helpers/real-db.js`. Each test runs `resolveOrCreateAccount` and `writeAccountResolutionAuditRow` inside `withAuditTransaction`, exactly as the callback does. The file uses only APIs that exist at C0 (0.2), so it can run unchanged against C0. See the design D5 integration-test notes:
- Each test uses a `randomUUID()` `oidc_subject` with a fixed test issuer. Cleanup deletes `audit_log` by `actor_user_id`, then `users`.
- Every claim goes under **`role`**, the module-load default in both lanes. Don't set `OIDC_ROLE_CLAIM` in the file; it would have no effect.
- Pass a capturing logger stub (`{ warn: vi.fn() }`); vitest does not type-check, so it runs against both the C0 and the final logger type.
- `probeInfra()` also needs Redis, so the file skips locally when Redis is down. That is expected. Under `REQUIRE_DB=1` it fails instead; every run recorded as evidence below uses `REQUIRE_DB=1`.
- Every "previous role" comes from an earlier sign-in in the same test. Use the test-fixture `UPDATE users` exception only if a case can't be reached that way; none in 3.1–3.4 should need it.

- [ ] 3.1 **(red, retroactive)** Persistence: first sign-in with `role: "facilitator"` → row has `global_role = 'facilitator'` and one `auth.first_access_created` row with `metadata.globalRole = 'facilitator'`. Second sign-in with the same claim → still `facilitator`, one `auth.role_claim_mapped` row with `previousRole = 'facilitator'`. Repeat for `senior_engineer`. Red at C0 because both values are outside the allowlist there.
- [ ] 3.2 **(red, retroactive)** Demotion audit:
  - sign in with `facilitator`, then with no role claim → `global_role = 'engineer'`, exactly one new `auth.role_claim_mapped` row with `actor_global_role = 'engineer'`, `metadata.previousRole = 'facilitator'`, `metadata.globalRole = 'engineer'`, `team_id IS NULL`
  - repeat with the second sign-in's claim `"superuser"`: assert `superuser` appears in no `audit_log.metadata::text` for that user **and** in no argument of any call on the captured logger (`JSON.stringify(logger.warn.mock.calls)`)
  - repeat with `senior_engineer` then no claim → `metadata.previousRole = 'senior_engineer'` (#235 AC 3)
  - `engineering_manager` then no claim → one `role_claim_mapped` row with `metadata.previousRole = 'engineering_manager'`. This case is red at C0 **because of the firing condition alone** (EM is already allowlisted there), so it proves the gate change independently of the allowlist change
- [ ] 3.3 **(pin)** No-op default: two sign-ins with no claim → zero `auth.role_claim_mapped` rows for that user. A third sign-in with claim `"superuser"` → still `engineer`, still zero `auth.role_claim_mapped` rows (warning only). This passes at C0 as well; it guards against the new gate over-firing.
- [ ] 3.4 **(red, retroactive)** Array precedence persists: the Entra-style array `["senior_engineer","facilitator"]` under the claim name **`role`** (not `roles`; see the section preamble) → `global_role = 'facilitator'` in the database, on the first sign-in and again on a second sign-in with the same claim. Red at C0 because the array is `String()`-coerced to `"senior_engineer,facilitator"` and rejected.
- [ ] 3.5 Red evidence: check out **C0** in a scratch worktree (`git worktree add`), copy this test file in, and run it with `REQUIRE_DB=1`. Record in the PR that 3.1, 3.2 and 3.4 fail **on their assertions** (not at import or setup) for the reasons stated above, and that 3.3 passes. A failure at import or connection means the run is not valid red evidence; fix the harness and re-run. Do not use `main`: the module the file imports does not exist there.
- [ ] 3.6 Green evidence: run the file at the branch head with `REQUIRE_DB=1`; 3.1–3.4 all pass. Record the run in the PR.

## 4. `senior_engineer` is non-privileged; role is read live (spec requirement "`senior_engineer` is non-privileged")

These pin behaviour that should already hold. They exist so a future privilege grant to `senior_engineer`, or a future role read from the token, fails a named test.

- [ ] 4.1 **(pin)** `routes/__tests__/auth.test.ts` (next to the existing `canFacilitateSessions` tests at ~line 2377): `GET /auth/session` for `global_role = 'senior_engineer'` returns `canFacilitateSessions: false`.
- [ ] 4.2 **(pin)** `routes/__tests__/facilitator-sessions.test.ts`:
  - `POST /api/v1/teams/:teamId/sessions/draft` by `senior_engineer` returns the same `403` status and body as for `engineer`, and issues no `team_memberships` INSERT (no membership on Team A) and no session INSERT
  - `POST /api/v1/teams` by `senior_engineer` returns the same `403` as for `engineer`, writes a `team.creation_denied_role` audit INSERT with `actor_global_role = 'senior_engineer'`, and issues no team, **topic** or session INSERT
- [ ] 4.3 **(pin)** `routes/__tests__/topics.test.ts`: `POST /api/v1/teams/:teamId/topics` by `senior_engineer` with no membership returns the same `403` as for `engineer`.
- [ ] 4.4 **(pin)** Role is read live from `global_role`, and only the callback writes it:
  - `routes/__tests__/auth.test.ts`: `GET /auth/session` for `global_role = 'facilitator'` returns `canFacilitateSessions: true` (extend the existing test if it already covers this; do not duplicate)
  - same file: name in the PR the existing test that `global_role = 'engineer'` returns `canFacilitateSessions: false`. Together with 3.2 (the row becomes `engineer`), it covers "Facilitator demoted when the claim is removed → `canFacilitateSessions: false`". Add the test only if it does not exist
  - `auth/__tests__/middleware.test.ts`: on the `refreshSessionTokens` `"refreshed"` path, `resolveOrCreateAccount` is not called (mock `../account-resolver.js` and assert zero calls) and no `UPDATE`/`INSERT` on `users` is issued. This pins "token refresh does not re-read the role claim", which the grant- and revocation-latency scenarios rest on: a role change reaches the session only at the next `/auth/callback`

## 5. Local development (design D6)

- [ ] 5.1 **(red)** `docker/oidc/__tests__/interactions.test.js` (~line 32): change "carries a role claim only on manager-001 and admin-001" to assert `facilitator-001.role === "facilitator"` and `participant-001.role` undefined, and rename it. Run it with `npm --prefix docker/oidc test` (it is outside the root workspaces). Fails.
- [ ] 5.2 **(green)** `docker/oidc/accounts.js`: add `role: "facilitator"` to `facilitator-001` and rewrite the header comment (three personas carry a role claim, `participant-001` relies on the default, no persona is a team member). Update the matching comment in `docker/oidc/server.js` (~line 82). 5.1 passes.
- [ ] 5.3 **(red)** `routes/__tests__/auth.test.ts` (~line 282): `facilitator-001` option has `seeded: true`. Fails.
- [ ] 5.4 **(green)** `routes/auth.ts` `DEV_LOGIN_OPTIONS`: `facilitator-001` → `seeded: true`. Keep the comment explaining `seeded` as the single source of truth. 5.3 passes.
- [ ] 5.5 **(pin)** `packages/frontend/src/pages/__tests__/DevLoginPage.test.tsx`: update the fixture (line 8) to `seeded: true`. Keep the unseeded-caveat test by giving it its own synthetic option with `seeded: false`, so the still-specified caveat branch stays covered. Passes on first run.
- [ ] 5.6 Manual check (record in the PR; a merge gate if S.3's local-key smoke was not run): fresh `docker compose down -v && docker compose up -d --wait`, migrate, `npm run dev`. Sign in as `facilitator-001` and confirm you land on the session-creation entry point, not `/no-team`. Create a team, confirm `POST /api/v1/teams` returns `201` with `status: "lobby"` and that the `sessions` row for the returned `sessionId` has `facilitator_id` = facilitator-001's user id, and confirm `SELECT count(*) FROM team_memberships tm JOIN users u ON u.id = tm.user_id WHERE u.oidc_subject = 'facilitator-001'` is `0`. Sign out and in again and confirm `canFacilitateSessions` is still `true`. This sign-in also confirms that ID-token signature verification (design D9) accepts the local `oidc-provider`'s RS256 key: there should be no `auth.callback_error` in the backend log. Use no `psql` write at any step.

## 6. Documentation

- [x] 6.1 `docs/deployment.md`: add `OIDC_ROLE_CLAIM` (default `role`) to the Optional variables table, and add the `## Role claim (OIDC_ROLE_CLAIM)` section (design D8). Keep it to this checklist, which mirrors the `first-access` requirement "Deployment documentation describes the role claim"; the reviewer ticks each box in the PR:
  - [ ] `OIDC_ROLE_CLAIM` and the five-value allowlist table, `facilitator` marked privileged, `senior_engineer` marked identical to `engineer`, plus one sentence: the claim must be one only IdP administrators can set (for example Entra app roles), never a user-editable attribute
  - [ ] string or array, exact match, and the precedence order
  - [ ] one Entra app-roles example (`OIDC_ROLE_CLAIM=roles`, app role **Value** equal to the role string, assigned to users or groups, emitted as an array on the ID token); no other IdP walkthrough
  - [ ] latency and revocation: "takes effect within 90 minutes, or immediately if the person signs out and back in; a newly granted facilitator should sign out and in"; IdP revocation as design D7 states it (no faster than the access-token lifetime; no in-app control); and one sentence: a revoked facilitator keeps running any session they have already opened until it ends
  - [ ] the troubleshooting entry "I was given facilitator but still see the join-link page", with causes (not signed in again, wrong `OIDC_ROLE_CLAIM`, IdP not sending the claim on the ID token, value not an exact match) and how to check (the allowlist warning in logs, `auth.role_claim_mapped` rows)
  - [ ] the manager warning, **verbatim** from proposal.md
- [x] 6.2 `docs/local-development.md`:
  - line ~105: the Facilitator button is now labelled like the others; remove the unseeded note
  - the Test accounts table, `facilitator-001` row (~114): **`facilitator`**, real via the OIDC `role` claim, member of no team; create a team through the session-creation entry point to run a session
  - ~118: three accounts carry a claim
  - Scopes and claims (~141): `role` for `facilitator-001`, `manager-001` and `admin-001`

  Fix the stale `docker/oidc/server.js` reference to `docker/oidc/accounts.js` while there.
- [x] 6.3 `docs/test-scripts/topic-add-form-hands-on-check.md`:
  - keep "sign in once first" (step 2), and explain it as creating the `users` row the setup SQL references
  - delete the "Order matters" callout (~46)
  - delete the `UPDATE users SET global_role = 'facilitator'` line and its comment (~62-63)
  - delete the Part 5 re-run sentence (~205)
  - delete the cleanup's `UPDATE users SET global_role = 'engineer'` line and the "resets facilitator-001" wording (~232, ~240)
- [x] 6.4 `requirements/use cases/01b - Designate a Facilitator - Deferral.md`:
  - set Status to **Resolved by `facilitator-role-claim-allowlist` (#235)**
  - replace "kept only as a possible later convenience" with "built only if a supported IdP cannot send a custom role claim"
  - **required correction, line 17** ("**Demotion and audit already exist.** … without new work."): rewrite it to say demotion at next sign-in already existed, but the demotion audit row was added by this change (Decision 4). Leaving line 17 unchanged would contradict Decision 4
  - point the Consequence paragraph at the deployment-docs role-claim section
- [ ] 6.5 Sweeps (keep this task last in section 6, after 1.10 and 6.1–6.4). Archived changes are excluded from both:
  - stale wording: `grep -rn "not on the application's role-claim allowlist\|not seeded\|re-run only the .UPDATE users\|PERMITTED_GLOBAL_ROLES does not include" docs requirements packages docker --include=*.md --include=*.ts --include=*.tsx --include=*.js` returns no hits that describe the old behaviour
  - `global_role` writes: `grep -rniE "(update users[^;]*set[^;]*global_role|insert into users[^;]*global_role)" packages/backend/migrations packages/backend/migrations-manual scripts docs docker requirements` (adding `-z` or reading each hit's surrounding statement where it spans lines) finds no write other than the pre-existing `system` row in `packages/backend/migrations/4_seed_data.sql` (the carve-out in the `first-access` requirement) and the column default in `2_create_tables.sql`. Test files under `__tests__` are out of scope for this grep; they are governed by the test-fixture exception

## 7. Verification

- [ ] 7.1 `npm run lint` passes at the repo root.
- [ ] 7.2 `npm run test` passes, with the section 3 integration file running (not skipped) against the Docker Compose Postgres (`REQUIRE_DB=1`). Also run `npm --prefix docker/oidc ci && npm --prefix docker/oidc test`: `docker/oidc` is outside the root workspaces and no workflow runs it, so `npm run test` never covers 5.1.
- [ ] 7.3 `npm run build` passes, including the `satisfies readonly UserRole[]` check from 1.2.
- [ ] 7.4 **Hard gate.** `openspec validate facilitator-role-claim-allowlist --strict` passes (#235 AC). If the CLI cannot be run, this task stays **UNMET**: do not tick it, and state in the PR that the #235 validate AC is unmet and needs a human to run the CLI and sign off before merge. A hand check (every delta requirement has a `#### Scenario:`, MODIFIED headers match the main spec exactly) may be recorded as supporting evidence, but it does **not** satisfy this task.
- [ ] 7.5 Raw-value and signature check by inspection (security reviewer). `oidc-client.ts` enables non-repudiation checks unconditionally, and nothing reads `tokens.claims()` except after `handleCallback` resolves. No `logger.*`, `emitAuditEvent` or `audit_log` INSERT in `account-resolver.ts`, `account-resolution-audit.ts` or the callback path takes the raw claim or any element of it. (Supporting the tested raw-value checks in 1.4, 1.6, 1.8 and 3.2, not replacing them.)
- [ ] 7.6 Spec trace: each scenario in the **four** delta specs (`first-access`, `auth-error-handling`, `oidc-auth`, `local-dev-environment`) maps to a task above:
  - `first-access`: allowlist → 1.1/1.3; near-miss values → 1.3/1.4; precedence, duplicates, `[null]`, outranked list → 1.6/1.8/3.4; facilitator persistence and first sign-in → 3.1/4.4; facilitator demotion → 3.2/2.3(a)/4.4 (`canFacilitateSessions: false`); `senior_engineer` persistence, demotion and denial → 3.1/3.2/2.3(b)/4.1–4.3; `global_role` written only by sign-in (with the `system`-row carve-out) → 6.5; grant and revocation latency → 4.4 (refresh path never calls `resolveOrCreateAccount`) plus the existing `auth/__tests__/middleware.test.ts` "should return 401 when absolute lifetime exceeded" (~line 114) and the `invalid_grant` → `revoked` refresh test (~line 222), and `realtime/__tests__/connection-token-refresh.test.ts` `revoked` cases (~lines 258, 288); confirm each still exists and name it in the PR; deployment docs checklist → 6.1
  - `auth-error-handling`: transactional/rollback/connection-acquisition/log-after-commit → existing tests, 0.2 (unchanged move), 2.5; `previousRole` on row and log → 2.3(a)(d)(e)/3.1; brand-new user → 2.1/3.1; demotion from facilitator/EM/admin/senior_engineer → 2.1/2.3(a)(b)/3.2; non-allowlisted demotion, value absent from row and log → 3.2/7.5; lateral EM → facilitator → 2.1/2.3(b); unchanged default → 2.1/2.3(c)/3.3; warning-only for a returning engineer → 2.3(f)/3.3; unchanged non-default recorded every sign-in → 2.1/3.1
  - `oidc-auth`: signature validation failure, `alg: none`, altered role claim → S.1(b)–(e)/S.5; JWKS unreachable → S.4; cannot be configured off, no claim read before verify → S.3/7.5
  - `local-dev-environment`: role claims on accounts, participant unseeded → 5.1/5.2; session with no SQL step, survives sign-out/in, role on the ID token → 5.6/6.2/6.3

  Record any gap in the PR.
- [ ] 7.7 The PR body lists the proposal Follow-ups: #237 as a go-live gate, the reporting-chain decision (#238), and the dev-provider production-guard gap (#239). It carries the proposal's release-note line **verbatim**: "The IdP role claim now accepts `facilitator` and `senior_engineer`, and accepts arrays (highest role wins). Demotions are now audited. ID-token signatures are now verified against the IdP's published keys." It also carries the operator caveat: a rollback to the previous build also turns signature verification back off.

## Review disposition

| Item | Source | Disposition | Rationale |
|---|---|---|---|
| A1 1.2 not behaviour-free | Architect | Accepted | 1.2 now exports `ROLE_PRECEDENCE` but keeps the three-role set; 1.5 derives it, so 1.3 is genuinely red. Added a pre-1.3 grep for any existing `facilitator → engineer` test. |
| A2 2.2 changes the gate before its red | Architect | Accepted | Pure move is now 0.2 (old condition); 2.2 only adds the predicate; 2.4 switches row and log together. |
| A3 3.5 red for the wrong reason | Architect | Accepted | 3.5 runs against C0 (0.2), which is before section 1, so allowlist and gate are both pre-change. 3.1, 3.2, 3.4 relabelled red (retroactive); 3.3 stays a pin. Added an EM-demotion case to 3.2 that is red on the gate alone. |
| A4 1.4 forward refs | Architect | Accepted | 1.4 covers 1.3 inputs only; array raw-value check moved into 1.6; 1.8 note removed from 1.4. |
| Pure move placed in section 0, not a new section | Architect A2/A3 vs exec condition | Accepted | Correct ordering needs the move before section 1. Extending 0 keeps the section count unchanged. |
| B1 de-risk S.3 | Architect | Accepted | Local-key smoke under S.3; otherwise 5.6 becomes a merge gate. |
| B2 `docker/oidc` outside the test gate | Architect | Accepted | Added to 7.2 and 5.1. |
| B3 labels | Architect | Accepted | 5.5 is **(pin)**; 6.5 explicitly last. 1.10 stays unlabelled (comments only). |
| B4 S.5 is green before S.3 | Architect | Accepted | Stated in S.5. |
| B5 S.4 after S.3 | Architect | Accepted | Stated in S.4. |
| Verifiability (no `node_modules`/DB/Docker/CLI) | Architect | Accepted | New "Evidence before ticking" convention. |
| G1 latency/revocation untested | BA | Accepted | 4.4 adds a refresh-path pin; 7.6 names the existing absolute-lifetime and `revoked` tests. |
| G2 `system` seed row contradicts spec | BA | Accepted | `first-access` spec carves out the existing non-person `system` row only; 6.5 adds a `global_role` write grep; conventions note it. |
| G3 `alg: none` category | BA | Accepted | S.1(e) now includes (d), with a record-don't-weaken rule. |
| G4 demotion `canFacilitateSessions: false` | BA | Accepted | 4.4 names the existing `engineer → false` test. |
| G5 4.2 dropped assertions | BA | Accepted | Restored "no topic" and "no membership on Team A". |
| G6 thin scenarios | BA | Accepted | EM → facilitator lateral in 2.3(b); 3.2 asserts captured logger output omits `superuser`. |
| Release note shrunk in 7.7 | BA | Accepted | Full line verbatim plus rollback caveat. |
| "Three delta specs" | BA | Accepted | Now four, with `local-dev-environment` traced in 7.6. |
