## Conventions for every task

- **Test first.** A task labelled **(red)** writes a test and runs it to see it fail for the stated reason before the matching **(green)** task changes production code. A task labelled **(pin)** adds a regression test that should pass on first run; if it fails, stop and investigate before going on.
- Unit tests for the resolver live in `packages/backend/src/auth/__tests__/account-resolver.test.ts` and keep its existing `db.js`/`config.js` mocks.
- Fixture `global_role` values come only from the `user_role` enum (`engineer`, `senior_engineer`, `facilitator`, `engineering_manager`, `application_admin`). `participant` is a membership role, never a global role.
- No test, fixture, doc or script may write `users.global_role` directly to obtain a role, except as the "previous role" setup row in the integration tests in section 3.

## 0. Pre-check

- [ ] 0.1 Run `openspec validate facilitator-role-claim-allowlist --strict` (CLI unavailable in the proposal environment; see 7.4). Fix any delta-format error before writing code.

## 1. Allowlist, claim shape and precedence (`packages/backend/src/auth/account-resolver.ts`, design D1–D4)

- [ ] 1.1 **(red)** Add `describe("role-claim allowlist")`. One test asserts `new Set(ROLE_PRECEDENCE)` equals a literal `new Set(["engineer","senior_engineer","facilitator","engineering_manager","application_admin"])` written out in the test, not imported. A second test asserts the exact order `["application_admin","facilitator","engineering_manager","senior_engineer","engineer"]`. Fails: `ROLE_PRECEDENCE` is not exported.
- [ ] 1.2 **(green)** Replace `PERMITTED_GLOBAL_ROLES`'s literal set with an exported `ROLE_PRECEDENCE` constant (`as const satisfies readonly UserRole[]`, importing `UserRole` from `@dipstick/shared`), and derive the set from it. Export `mapRoleClaimToGlobalRole`. No behaviour change yet. 1.1 passes; existing tests still pass.
- [ ] 1.3 **(red)** String-claim tests on `mapRoleClaimToGlobalRole`: `"facilitator"` → `facilitator`, `"senior_engineer"` → `senior_engineer`, neither logs a warning; absent (`undefined`, `null`) → `engineer` with **no** warning; `"Facilitator"`, `" facilitator"`, `"facilitator,engineer"`, `""` → `engineer` with exactly one warning each. Add the same `facilitator` and `senior_engineer` cases through `resolveOrCreateAccount`, asserting the upsert's 5th parameter. Fails on the two new allowlisted values.
- [ ] 1.4 **(red)** Logger-shape tests (design D4): the warning is called as `warn(fields, message)`. `calls[0][0]` is an object with exactly the keys `claimName`, `claimShape`, `ignoredCount`, `allowlistedCount`, and `calls[0][1]` is a string. For every rejected input in 1.3 and 1.6, `JSON.stringify(calls)` contains none of the raw values. Update the existing "allowlist-rejected claim value" test (~line 294) to the new argument order and keep its `superuser` absence assertions. Fails: current order is `(message, { claimName })`.
- [ ] 1.5 **(green)** Change the `logger` parameter type of `mapRoleClaimToGlobalRole` and `resolveOrCreateAccount` to `Pick<FastifyBaseLogger, "warn">` (or a structurally identical local type with pino's `(obj, msg)` order), and emit the D2 warning shape. 1.3 and 1.4 pass for string inputs.
- [ ] 1.6 **(red)** Array and other-type tests:
  - `["senior_engineer","facilitator"]` → `facilitator`, no warning
  - `["facilitator","engineering_manager"]` → `facilitator`
  - `["engineer","facilitator","application_admin"]` → `application_admin`
  - `["superuser","facilitator"]` → `facilitator`, one warning with `ignoredCount: 1, allowlistedCount: 1, claimShape: "array"`
  - `[]` and `["superuser","root"]` → `engineer`, one warning
  - `[42, {role:"facilitator"}, "senior_engineer"]` → `senior_engineer`, `ignoredCount: 2`
  - `["facilitator","facilitator"]` → `facilitator`, no warning
  - `42`, `true`, `{ role: "facilitator" }` → `engineer`, `claimShape: "other"`

  Add one `resolveOrCreateAccount` case with an array claim asserting the upsert parameter. Fails: arrays are `String()`-coerced today.
- [ ] 1.7 **(green)** Implement D2: normalise to candidates (string → `[s]`, array → elements, other → one non-allowlisted candidate), filter by exact membership with no coercion, and pick the first `ROLE_PRECEDENCE` entry present, else `engineer`. Remove `String(rawClaimValue)`. 1.3–1.6 pass.
- [ ] 1.8 **(red)** Outranked-EM tests (design D3): `["facilitator","engineering_manager"]` emits exactly one additional warning with fields `{ claimName, appliedRole: "facilitator", outrankedRoles: ["engineering_manager"] }`. `["application_admin","engineering_manager","senior_engineer"]` → `outrankedRoles: ["engineering_manager","senior_engineer"]` (sorted). `["senior_engineer","facilitator"]` and `["engineering_manager"]` emit no outranked warning.
- [ ] 1.9 **(green)** Implement the D3 warning. 1.8 passes.
- [ ] 1.10 Rewrite the module header comment and the `PERMITTED_GLOBAL_ROLES` comment: five-role closed allowlist (spec "The IdP role-claim allowlist is closed"), string or array, precedence, exact match, raw values never logged, and the application never writes `global_role` itself. Remove "silently treated as absent" wording that no longer matches the warning behaviour.

## 2. `role_claim_mapped` firing condition and `previousRole` on the log (design D5)

- [ ] 2.1 **(red)** New `packages/backend/src/auth/__tests__/account-resolution-audit.test.ts`: truth-table test for `shouldRecordRoleClaimMapped`:
  - new user → `false`
  - `engineer`→`engineer` → `false`
  - `facilitator`→`engineer`, `engineering_manager`→`engineer`, `application_admin`→`engineer` → `true`
  - `engineer`→`facilitator`, `engineering_manager`→`facilitator` → `true`
  - `senior_engineer`→`senior_engineer`, `facilitator`→`facilitator` → `true`

  Fails: module does not exist.
- [ ] 2.2 **(green)** Create `packages/backend/src/auth/account-resolution-audit.ts` exporting `shouldRecordRoleClaimMapped` and `writeAccountResolutionAuditRow(client, user, { ip, correlationId })`. Move the two existing `INSERT INTO audit_log` statements out of `routes/auth.ts`'s `withAuditTransaction` callback **unchanged**, except that the `role_claim_mapped` branch is gated by the predicate. `routes/auth.ts` calls the writer. 2.1 passes.
- [ ] 2.3 **(red)** `packages/backend/src/routes/__tests__/auth.test.ts` (near the transactional-group block, ~line 886):
  - (a) returning user `previousGlobalRole: "facilitator"`, `globalRole: "engineer"` → exactly one `'auth.role_claim_mapped'` INSERT whose metadata has `previousRole: "facilitator"`, `globalRole: "engineer"`, and actor role `engineer`; exactly one structured `auth.role_claim_mapped` event with `previousRole: "facilitator"`
  - (b) same for `engineering_manager` and `application_admin` (parameterised)
  - (c) `engineer`→`engineer` → no `role_claim_mapped` INSERT and no structured event
  - (d) the existing non-default test (~line 816) also asserts `previousRole` on the structured event
  - (e) the structured event's key set is exactly `{ userId, oidcSubject, globalRole, previousRole, sourceIp, correlationId }`

  Fails on (a), (b), (d) and (e).
- [ ] 2.4 **(green)** In `routes/auth.ts`, gate the post-commit `emitAuditEvent("auth.role_claim_mapped", …)` on `shouldRecordRoleClaimMapped(user)` and add `previousRole: user.previousGlobalRole`. Update the comment above it and the `audit-logger.ts` comment on `auth.role_claim_mapped` (~line 118) to describe the new firing condition. 2.3 passes; the rest of `auth.test.ts` still passes.
- [ ] 2.5 **(pin)** `auth.test.ts`: a failed `role_claim_mapped` INSERT on a **demotion** still rolls back the UPSERT and surfaces `AuditWriteError` → `internal_error`, and emits no structured event, the same as the existing non-default case.

## 3. Integration through `resolveOrCreateAccount` (real Postgres)

New file `packages/backend/src/auth/__tests__/role-claim-allowlist-integration.test.ts`, following `topics-integration.test.ts`'s pattern (`probeInfra`/`requireInfraOrThrow`, env fallbacks, dynamic imports, no `db.js` mocks). Each test uses a unique `oidc_subject` and cleans up its `users` and `audit_log` rows. Each test runs `resolveOrCreateAccount` and `writeAccountResolutionAuditRow` inside `withAuditTransaction`, exactly as the callback does.

- [ ] 3.1 **(pin)** Persistence: first sign-in with `role: "facilitator"` → row has `global_role = 'facilitator'` and one `auth.first_access_created` row with `metadata.globalRole = 'facilitator'`. Second sign-in with the same claim → still `facilitator`, one `auth.role_claim_mapped` row with `previousRole = 'facilitator'`. Repeat for `senior_engineer`.
- [ ] 3.2 **(pin)** Demotion audit: sign in with `facilitator`, then with no role claim → `global_role = 'engineer'`, exactly one new `auth.role_claim_mapped` row with `actor_global_role = 'engineer'`, `metadata.previousRole = 'facilitator'`, `metadata.globalRole = 'engineer'`, `team_id IS NULL`. Repeat with the second sign-in's claim `"superuser"` and assert `superuser` does not appear in any `audit_log.metadata::text` for that user.
- [ ] 3.3 **(pin)** No-op default: two sign-ins with no claim → zero `auth.role_claim_mapped` rows for that user.
- [ ] 3.4 **(pin)** Array precedence persists: `roles`-style array `["senior_engineer","facilitator"]` under the configured claim name → `global_role = 'facilitator'` in the database.
- [ ] 3.5 Run 3.1–3.4 once against the pre-change code (stash sections 1–2 or check out `main` in a scratch worktree) and record in the PR that 3.1, 3.2 and 3.4 fail there. This is the red half for the integration layer.

## 4. `senior_engineer` is non-privileged (spec requirement "`senior_engineer` is non-privileged")

These pin behaviour that should already hold. They exist so a future privilege grant to `senior_engineer` fails a named test.

- [ ] 4.1 **(pin)** `routes/__tests__/auth.test.ts` (next to 4.3/4.4 at ~line 2377): `GET /auth/session` for `global_role = 'senior_engineer'` returns `canFacilitateSessions: false`.
- [ ] 4.2 **(pin)** `routes/__tests__/facilitator-sessions.test.ts`: `POST /api/v1/teams/:teamId/sessions/draft` and `POST /api/v1/teams` by `senior_engineer` return the same `403` status and body as for `engineer`.
- [ ] 4.3 **(pin)** `routes/__tests__/topics.test.ts`: `POST /api/v1/teams/:teamId/topics` by `senior_engineer` with no membership returns the same `403` as for `engineer`.
- [ ] 4.4 **(pin)** `routes/__tests__/auth.test.ts`: `GET /auth/session` for `global_role = 'facilitator'` returns `canFacilitateSessions: true` (extend the existing 4.3 test if it already covers this; do not duplicate).

## 5. Local development (design D6)

- [ ] 5.1 **(red)** `docker/oidc/__tests__/interactions.test.js` (~line 32): change "carries a role claim only on manager-001 and admin-001" to assert `facilitator-001.role === "facilitator"` and `participant-001.role` undefined, and rename it. Fails.
- [ ] 5.2 **(green)** `docker/oidc/accounts.js`: add `role: "facilitator"` to `facilitator-001` and rewrite the header comment (three personas carry a role claim, `participant-001` relies on the default, no persona is a team member). Update the matching comment in `docker/oidc/server.js` (~line 82). 5.1 passes.
- [ ] 5.3 **(red)** `routes/__tests__/auth.test.ts` (~line 282): `facilitator-001` option has `seeded: true`. Fails.
- [ ] 5.4 **(green)** `routes/auth.ts` `DEV_LOGIN_OPTIONS`: `facilitator-001` → `seeded: true`. Keep the comment explaining `seeded` as the single source of truth. 5.3 passes.
- [ ] 5.5 `packages/frontend/src/pages/__tests__/DevLoginPage.test.tsx`: update the fixture (line 8) to `seeded: true`. Keep the unseeded-caveat test by giving it its own synthetic option with `seeded: false`, so the still-specified caveat branch stays covered.
- [ ] 5.6 Manual check (record in the PR): fresh `docker compose down -v && docker compose up -d --wait`, migrate, `npm run dev`. Sign in as `facilitator-001` and confirm you land on the session-creation entry point, not `/no-team`. Create a team, confirm the session opens, and confirm `SELECT count(*) FROM team_memberships tm JOIN users u ON u.id = tm.user_id WHERE u.oidc_subject = 'facilitator-001'` is `0`. Sign out and in again and confirm `canFacilitateSessions` is still `true`. Use no `psql` write at any step.

## 6. Documentation

- [ ] 6.1 `docs/deployment.md`: add `OIDC_ROLE_CLAIM` (default `role`) to the Optional variables table, and add the `## Role claim (OIDC_ROLE_CLAIM)` section in the design D8 order:
  - the allowlist table, with `facilitator` marked privileged and `senior_engineer` marked as identical to `engineer`
  - string or array, exact match, and the precedence order
  - an Entra app-roles example (`OIDC_ROLE_CLAIM=roles`, app role **Value** equal to the role string, assigned to users or groups, emitted as an array on the ID token)
  - the manager warning, **verbatim** from proposal.md
  - "takes effect within 90 minutes, or immediately if the person signs out and back in; a newly granted facilitator should sign out and in"
  - IdP revocation as design D7 states it (no faster than the access-token lifetime; no in-app control)
  - the mid-ceremony re-authentication note
  - the troubleshooting entry "I was given facilitator but still see the join-link page", with causes: not signed in again, wrong `OIDC_ROLE_CLAIM`, IdP not sending the claim on the ID token, value not an exact match. Say how to check: the allowlist warning in logs, and `auth.role_claim_mapped` rows.
- [ ] 6.2 `docs/local-development.md`:
  - line ~105: the Facilitator button is now labelled like the others; remove the unseeded note
  - the Test accounts table, `facilitator-001` row (~114): **`facilitator`**, real via the OIDC `role` claim, member of no team; create a team through the session-creation entry point to run a session
  - ~118: three accounts carry a claim
  - Scopes and claims (~141): `role` for `facilitator-001`, `manager-001` and `admin-001`

  Fix the stale `docker/oidc/server.js` reference to `docker/oidc/accounts.js` while there.
- [ ] 6.3 `docs/test-scripts/topic-add-form-hands-on-check.md`:
  - keep "sign in once first" (step 2), and explain it as creating the `users` row the setup SQL references
  - delete the "Order matters" callout (~46)
  - delete the `UPDATE users SET global_role = 'facilitator'` line and its comment (~62-63)
  - delete the Part 5 re-run sentence (~205)
  - delete the cleanup's `UPDATE users SET global_role = 'engineer'` line and the "resets facilitator-001" wording (~232, ~240)
- [ ] 6.4 `requirements/use cases/01b - Designate a Facilitator - Deferral.md`:
  - set Status to **Resolved by `facilitator-role-claim-allowlist` (#235)**
  - replace "kept only as a possible later convenience" with "built only if a supported IdP cannot send a custom role claim"
  - correct the "Demotion and audit already exist" bullet: demotion audit was added by this change (Decision 4), not pre-existing
  - point the Consequence paragraph at the deployment-docs role-claim section
- [ ] 6.5 Stale-wording sweep: `grep -rn "not on the application's role-claim allowlist\|not seeded\|re-run only the .UPDATE users\|PERMITTED_GLOBAL_ROLES does not include" docs requirements packages docker --include=*.md --include=*.ts --include=*.tsx --include=*.js` returns no hits that describe the old behaviour. Archived changes are excluded.

## 7. Verification

- [ ] 7.1 `npm run lint` passes at the repo root.
- [ ] 7.2 `npm run test` passes, with the section 3 integration file running (not skipped) against the Docker Compose Postgres.
- [ ] 7.3 `npm run build` passes, including the `satisfies readonly UserRole[]` check from 1.2.
- [ ] 7.4 `openspec validate facilitator-role-claim-allowlist --strict` passes. If the CLI still cannot be installed (npm registry blocked), check by hand: every delta requirement has at least one `#### Scenario:`, every MODIFIED requirement header matches the main spec header exactly, and the PR says the CLI was not run.
- [ ] 7.5 Raw-value check by inspection (security reviewer): no `logger.*`, `emitAuditEvent` or `audit_log` INSERT in `account-resolver.ts`, `account-resolution-audit.ts` or the callback path takes the raw claim or any element of it.
- [ ] 7.6 Spec trace: each scenario in the three delta specs maps to a task above (allowlist → 1.1/1.3; precedence → 1.6/1.8/3.4; facilitator persistence and demotion → 3.1/3.2/2.3/4.4; `senior_engineer` → 3.1/4.1–4.3; firing condition → 2.1/2.3/3.2/3.3; local dev → 5.1–5.6; latency → 6.1 docs plus the existing `oidc-auth` absolute-lifetime tests). Record any gap in the PR.
- [ ] 7.7 The PR body lists the proposal Follow-ups: #237 as a go-live gate, the reporting-chain issue (to be filed), and the revocation-latency measurement.
