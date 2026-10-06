# Implementation Review: Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `configurable-oidc-role-map` (#243)
**Scope:** uncommitted working tree on `agent-team/243-configurable-oidc-role-map` against `main` (`c00b496`), checked against `design.md` rev 3, `tasks.md` and the spec deltas.
**Date:** 2026-10-05

## Verdict

**Approve, once R1 is fixed.** The code follows the design closely. The module boundary, config wiring, resolver injection, logging form and the four D11 enforcement points are all as designed, and I found no fail-open path in the code. The one Required item is documentation: the rollback instruction understates a regression that weakens the no-manager rule. The Recommended items are small.

Evidence I gathered myself: `tsc -p tsconfig.build.json` is clean. `vitest run src/auth src/__tests__/config.test.ts src/routes/__tests__/auth.test.ts` passes (20 files, 378 tests). `docker-compose.yml` and `integration.yml` both use `OIDC_ISSUER=http://localhost:4011`, so the D6 issuer gate does not break local or CI boot. I did not run the real-DB integration suites. Tasks 2.3, 3.5 and 5.2(b) are still waiting on `integration.yml` CI.

## Conformance checklist

| Area | Design ref | Finding |
|---|---|---|
| `role-map.ts` is a leaf module | D1, R4 | Pass. It has no imports at all, so there is no cycle with `config.ts`. |
| Types and exports | D1, R1, S4 | Pass. Exports `GlobalRole`, `MappableRole`, `GLOBAL_ROLES`, `RANK` (built from a `Record<MappableRole, number>`, then copied into a `Map`), `PERMITTED_TARGETS` (`Set`), `DEFAULT_ROLE_MAP`, `RoleMapConfigError` (no `cause`), `parseRoleMap`, `normalizeClaim`, `mapValues`, `resolveGlobalRole`, `isClaimOverage`. Signatures match D1. |
| Validation order | D4 | Pass. Unset/empty check, then JSON parse, object shape, duplicate scan, per-entry rules (with `engineer` called out before the general permitted-target check), then deployment guards and warnings. |
| No leakage of the map value | D4, S3, C2 | Pass. The invalid-JSON message is a fixed string. Keys and targets are interpolated with `JSON.stringify`. The summary carries counts only. No `err.message` or `cause` is passed on. `loadConfig` rethrows only errors that are not `RoleMapConfigError`, and `parseRoleMap` produces none. |
| Duplicate scanner | D3, S6, C4 | Pass. It skips escapes, tells key position from value position at depth 1, decodes each key with `JSON.parse` before comparing, and fails closed. It stayed within budget, so no cut was needed. |
| `loadConfig(env)` wiring | D1a, R5, R6 | Pass. `OIDC_ROLE_MAP` is not in `optional`. It runs after the three production guards. On error it prints `FATAL: ` + message and exits 1; otherwise it calls `console.warn` for each warning and `console.info` for the summary. The return type is `AppConfig` with `roleMap`/`roleMapSource`. `export const config = loadConfig()` is computed once. A side benefit: if anything ever serialises `config`, the `Map` comes out as `{}`. |
| Resolver takes the map as a parameter | D7, R3, R4 | Pass. Signature is `resolveOrCreateAccount(claims, { logger, roleMap, client })`, with `logger: Pick<FastifyBaseLogger, "warn">`. It throws on a missing map and has no default fallback. The resolver no longer reads `config.roleMap`. It still reads `config.OIDC_ROLE_CLAIM`, which the design allows. |
| pino argument order | D7, R2 | Pass. Every resolver line is `warn(fields, msg)`. The existing unmapped warn was fixed. Tests assert `calls[i][0]` is the fields object and `calls[i][1]` the message. |
| Child logger carries `correlationId` | D7, R3 | Pass. `routes/auth.ts` passes `request.log.child({ correlationId })`. `auth.test.ts` checks identity: the logger the resolver received is the child's return value, and `roleMap` is `toBe(mockConfig.roleMap)` (a sentinel map). |
| Own-property lookups | D2, S4, S8 | Pass. Claim lookup uses `Map.get`, targets use `Set.has`, `RANK.get` reads the precedence, and `isClaimOverage` uses `Object.prototype.hasOwnProperty.call` on a plain object. No `in`, plain-object index, or allowlist object remains. |
| Log lines | D7, S1, S7, S8 | Pass. A missing claim logs nothing unless the claim is an overage. An unmapped claim logs `{claimName}`. A discard logs `{claimName, resolvedRole, discardedRoles}` on every sign-in. A partial match logs nothing. The `ignoredCount` line is gone. |
| Audit firing condition | D8, C1 | Pass. `shouldEmitRoleClaimMapped` is evaluated once into `emitRoleClaimMapped` and drives both the `audit_log` INSERT and the post-commit event. `previousRole` is on both. No discard flag is recorded in audit. |
| D11 E1: participant registration | D11 | Pass. Adds `global_role !== "application_admin"` to `isEligible` and reuses the existing 403 `invalid_request` envelope, the `audit_log` row and the `session.participant_registration_rejected` event, with `actor_global_role = application_admin`. |
| D11 E2: lock-in | D11 | Pass. Condition added. The message is now `"You are not eligible to lock in votes in this session."`, with status and category unchanged. No audit row, as before. The lock-in INSERT is the only vote write path. |
| D11 E3: subscriber grant | D11 | Pass. The change is on the participant path only, and the facilitator path is unchanged. Tests are added at the connection, dispatcher, re-authorization sweep and grant-reusing endpoints. |
| D11 E4: roster query | D11 | Pass. Adds `AND u.global_role != 'application_admin'`. |
| Stub and dev-login | D9, C7 | Pass. `facilitator-001` now has `role: "facilitator"` and `seeded: true`, and the header comment was rewritten. `PERMITTED_GLOBAL_ROLES` is gone from `src` and `docker/oidc`. |
| Docs vs code | 6.3, 6.4, 5.3 | Mostly accurate. Message texts, prefix, summary format, permitted targets, issuer-gate wording and the name of the refresh test all match the code. Exceptions are R1 and C4–C5 below. |

## Required

### R1. The rollback instruction understates a fail-open regression of the no-manager rule

`docs/deployment.md` "Upgrading" step 5 and `design.md` Migration Plan step 4 say that on rollback, *"Users granted `facilitator` or `senior_engineer` by the new release drop back to `engineer`"*. That is true only for a deployment whose IdP sends the internal role strings.

Take a deployment that uses this release as intended: `OIDC_ROLE_CLAIM=groups` with a map such as `{"Eng-Managers":"engineering_manager", ...}`. If it rolls back, the old resolver runs `String()` on the array and checks the result against the old allowlist. Every manager and every admin then becomes `engineer` at their next sign-in. Managers are admitted to live sessions again, with no error and no audit signal. That breaks the control this change was built to protect.

**Fix (docs and design text only):** Rollback step 5 must say that a deployment whose role map translates IdP group names cannot be rolled back safely without first switching the IdP back to sending internal role strings on the configured claim. Otherwise managers will be admitted to sessions as engineers. Mirror the sentence in `design.md` Migration Plan step 4 and in the PR "Upgrade notes" material in `follow-ups.md`. The release owner's `release-check.md` (7.2) should record, for each deployment, whether rollback is safe.

## Recommended

**C1. `DEFAULT_ROLE_MAP`, `RANK` and `PERMITTED_TARGETS` are shared mutable singletons.**
`ReadonlyMap` and `ReadonlySet` are compile-time only. In default mode, `config.roleMap` is the same object as the exported `DEFAULT_ROLE_MAP`, so a stray `(x as Map).set(...)` in any test or future code would change authorization for the whole process. The design says the map is "frozen into a `Map`", but a `Map` cannot be frozen. Either return a fresh copy from `parseRoleMap` (`new Map(DEFAULT_ROLE_MAP)`), or change the comment so it does not claim immutability. A copy is a single line and also keeps tests isolated from each other.

**C2. Narrow `ResolvedUser.previousGlobalRole` to `GlobalRole | null`.**
It is now written to audit metadata and to the structured event as `previousRole`, but it is still typed `string | null`. Narrowing it is consistent with R1 and costs nothing. The predicates follow-up can absorb it if you prefer to defer it.

**C3. Type the local in `loadConfig`.**
`let roleMapResult;` relies on evolving-`any` inference. Declare it `let roleMapResult: ParsedRoleMap;` (the type is already exported).

**C4. The runbook's Redis step cannot be followed as written.**
`docs/deployment.md` says "delete that user's `dipstick:session:*` keys". But keys are `dipstick:session:<sessionId>` (`auth/session-store.ts`), not keyed by user. An operator has to scan the keys and match on the `userId` field inside each session value. Either spell that out, with an example command, or say that per-user sign-out needs follow-up 7. Also note that the manual `UPDATE users` the runbook recommends writes no audit row. The docs do say this, and it should be listed in `security-review.md` as an accepted operational gap until follow-up 7 lands.

**C5. The boot-output example lists lines in the wrong order.**
The code prints the warnings first and the summary last. The docs example shows the summary first, and it mixes a `FATAL` line into the same block as a successful boot. Split the example into a successful boot (warnings, then summary) and a failed boot (a single `FATAL` line, no summary). This matches the 1.6 test that no summary is printed on a failed boot.

**C6. The `seeded: true` flag on `facilitator-001` depends on the default map.**
A developer who sets a local `OIDC_ROLE_MAP` without a `facilitator` identity entry will see `facilitator-001` shown as seeded while it resolves to `engineer`. This is acceptable for dev. One sentence in `docs/local-development.md` would prevent confusion: "a custom local map must keep the identity entries for the stub personas to work".

**C7. Test-file typecheck debt.**
`tsc -p .` (which includes tests) reports many errors that already existed before this change. The new `auth.test.ts` spy-logger block adds one more instance of the existing `decorateRequest(..., null)` pattern (line 2582). This is not a blocker, because the build config excludes tests. Noted so the debt is not mistaken for something this change introduced.

## Items noted, no action

- **Historical participant counts.** History and EM-view queries still count admin `session_participants` rows created before this release. This matches the manager rule (rows are kept, and votes are counted at reveal) and the design.
- **Demotion gaps from task 2.3.** These are recorded in `security-review.md` and follow-ups 1/10. They are a deliberate deferral, not an implementation defect.
- **Open tasks.** 7.1 (security sign-off), 7.2 (`release-check.md`), 7.4 (file the follow-ups) and the `integration.yml` runs remain open and still block merge, as `tasks.md` states.

— Ingrid Sollenberger
