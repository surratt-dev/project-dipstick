## Context

`users.global_role` has exactly one writer: the sign-in upsert in `packages/backend/src/auth/account-resolver.ts`. That upsert maps the IdP role claim (`OIDC_ROLE_CLAIM`, default `role`) through `mapRoleClaimToGlobalRole` and overwrites the column every time someone signs in. Three things stop a facilitator from persisting today:

| Where | What it does today | Effect |
|---|---|---|
| `PERMITTED_GLOBAL_ROLES` (`account-resolver.ts:52-56`) | `{engineer, engineering_manager, application_admin}` | `facilitator` and `senior_engineer` are dropped to `engineer` with a warning |
| `String(rawClaimValue)` (`:83`) | Coerces whatever the claim holds | `["facilitator"]` passes by accident. `["senior_engineer","facilitator"]` becomes `"senior_engineer,facilitator"` and is rejected |
| `role_claim_mapped` gating (`routes/auth.ts:337, 371`) | Fires only when the new role ≠ `engineer`, and the condition is duplicated across two sites | A demotion to `engineer` writes no row. The structured log line has no `previousRole` |

The enum (`migrations/1_create_enums.sql`) and `UserRole` (`packages/shared/src/types/user.ts`) already list all five roles, so no migration is needed. Everything downstream that gates on `global_role = 'facilitator'` (session creation, standing topic admin, `canFacilitateSessions`) already reads the column live. Once the column holds `facilitator`, those checks work as written.

The decisions recorded in `decision-log.md` are binding here: 4 (fire on any change), 6 (string or array, precedence), 7 (the order), 8 (allowlist `senior_engineer`), 9 (manager risk handled in docs), 10 (no UI copy change).

## Goals / Non-Goals

**Goals:**
- A user whose IdP sends `facilitator` signs in as a facilitator and still is one at the next sign-in.
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

**Warning shape (never raw values).** One `warn` per sign-in at most, message `"OIDC role claim contained values not on the allowlist; ignored"`, fields `{ claimName, claimShape: "string" | "array" | "other", ignoredCount, allowlistedCount }`. `claimName` is configuration, not user input. The current test already asserts that `superuser` is absent from the message and the fields, and the new tests extend that check to every element of an array (tasks 1.4).

### D3. Outranked `engineering_manager` is logged (exploration open item 1: yes, narrowed)

When `engineering_manager` is among the allowlisted elements but loses to a higher role, emit one `warn`: message `"OIDC role claim carried engineering_manager but a higher-precedence role was applied"`, fields `{ claimName, appliedRole, outrankedRoles }`. `outrankedRoles` lists every distinct allowlisted value other than the applied role (not only `engineering_manager`), once each, in `ROLE_PRECEDENCE` order (highest first). For `["application_admin","facilitator","engineering_manager"]` it is `["facilitator","engineering_manager"]`. These are enum strings produced by the allowlist filter, not raw input, so they are safe to log.

- Why only EM: it is the one outranking that weakens a ritual constraint. That is the no-manager rule's `global_role` signal (proposal Constraints). `["senior_engineer","facilitator"]` is an ordinary Entra assignment, and warning on every such sign-in would bury the one line that matters.
- It is log-only, with no `audit_log` row and no alert (Decision 9). A user resolved this way still gets the normal `role_claim_mapped` row, and its `globalRole` is the applied role.

### D4. Logger call order follows pino

The resolver's `logger` parameter today is typed `{ warn(msg, fields?) }`, and `routes/auth.ts` passes `request.log` (pino). Pino's signature is `warn(obj, msg)`. When the first argument is a string, later arguments are treated as format arguments, so the `{ claimName }` object is very likely dropped from production log output today. The unit test can't see this, because it mocks `warn` with the same wrong order. This change types the parameter as `Pick<FastifyBaseLogger, "warn">` and calls `logger.warn(fields, msg)`. The tests then assert `calls[0][0]` is the field object and `calls[0][1]` is the message. If pino's actual behaviour turns out to keep the fields, the change is still correct, because it matches every other log call in the backend.

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
- `previousGlobalRole` comes from the `prior` CTE in the same upsert statement (unchanged), so the demotion row records the value that was actually overwritten, even under concurrent sign-ins.
- Unchanged: transactional coupling, `AuditWriteError`, the post-commit-only emission, and `actor_global_role = globalRole` (for a demotion row that means `engineer`, the role the actor holds now).

To make the integration test (tasks 3.x) honest without driving the whole OIDC callback, the row-writing body of the `withAuditTransaction` callback moves into `writeAccountResolutionAuditRow(client, user, { ip, correlationId })` in `packages/backend/src/auth/account-resolution-audit.ts`. `routes/auth.ts` calls it, and the integration test calls the same function on a real Postgres client. It contains no new logic, only the existing two INSERTs behind `shouldRecordRoleClaimMapped` (which moves into the same module).

### D6. Local dev

- `docker/oidc/accounts.js`: `facilitator-001` gets `role: "facilitator"`. The header comment is rewritten to say that all three non-participant personas carry a role claim, and that `participant-001` relies on the default.
- `routes/auth.ts` `DEV_LOGIN_OPTIONS`: `facilitator-001` gets `seeded: true`. The frontend's unseeded-caveat branch stays (persona-login still specifies it), but no option uses it now.
- `facilitator-001` stays a member of no team. The only seeded team is `__default_topics__` (`migrations/4_seed_data.sql`), the template team, which can't host sessions. So the "team I'm not a member of" precondition is met by the existing new-team flow: sign in, land on the session-creation entry point (zero-membership carve-out), create a team. `POST /api/v1/teams` already refuses to make the creator a member. The exploration note's "name the seeded team" item resolves to "there is none, use the new-team flow", and the docs say so. Seeding a demo team is out of scope.
- `docs/test-scripts/topic-add-form-hands-on-check.md` keeps "sign in once first". Its setup SQL creates teams and needs the `users` row. It drops the `UPDATE users SET global_role` line, the "Order matters" callout, the Part 5 re-run note, and the cleanup's reset-to-`engineer` line.

### D7. Latency and revocation (exploration Finding 4, open item 2)

What the code does, confirmed by reading `auth/middleware.ts`:
- `global_role` changes only at a completed `/auth/callback`. Token refresh (`refreshSessionTokens`) does not re-read claims and does not count as "authentication" for role purposes. This holds for revocation as well as grant: a user whose `facilitator` claim is removed keeps `global_role = 'facilitator'` (and `POST /api/v1/teams` keeps succeeding for them, since it reads the live column) until their next `/auth/callback`.
- The absolute session lifetime is 90 minutes (`ABSOLUTE_LIFETIME_MS`), so a role change reaches a signed-in user within 90 minutes at most, or immediately if they sign out and back in.
- If an operator revokes the user's refresh tokens at the IdP, the next refresh attempt gets `invalid_grant`. It is classified as `revoked` with no retry, and the session is destroyed with an `auth.session_invalidated` row (`reason: token_revoked`). Refresh is attempted only once the access token is within 5 minutes of expiry (`TOKEN_REFRESH_THRESHOLD_S`). Revocation therefore ends the app session at roughly (access-token remaining lifetime − 5 min). That bound depends on the IdP. With Entra's default access-token lifetime (60–90 min, randomised) it is usually **no faster than the 90-minute cap**. The docs say this plainly and do not promise a fast kill switch. Measuring it against production Entra is proposal Follow-up 3.

### D8. Deployment docs structure

A new `## Role claim (OIDC_ROLE_CLAIM)` section in `docs/deployment.md`, placed after "Required environment variables". `OIDC_ROLE_CLAIM` also goes in the Optional table. The section holds exactly the five items in the `first-access` requirement "Deployment documentation describes the role claim", plus the manager warning, and no more (VP review: operators' needs only, not an IdP tutorial):
1. `OIDC_ROLE_CLAIM` and the allowlist table: the five values, `facilitator` marked privileged, `senior_engineer` marked identical to `engineer`.
2. String or array, exact match, precedence order.
3. One Entra example: app roles whose **Value** is the exact role string, assigned to users or groups, `OIDC_ROLE_CLAIM=roles`, emitted as an array on the ID token. No Okta or Keycloak walkthrough until a customer asks.
4. When changes take effect: next sign-in, within 90 minutes; a newly granted facilitator should sign out and in; IdP revocation behaves as in D7 and there is no in-app control.
5. Troubleshooting: "I was given facilitator but still see the join-link page". Causes: not signed in again; wrong `OIDC_ROLE_CLAIM` name; IdP not sending the claim on the ID token; value not an exact match. How to check: the allowlist warning in the logs, `role_claim_mapped` rows.

Plus the **manager warning**, verbatim from the proposal.

## Risks / Trade-offs

- **[Precedence weakens the no-manager rule for EM+facilitator users]** → Docs warning, the D3 log line, and the existing membership-based hard blocks. Accepted (Decision 7, 9). Recorded in the proposal Constraints.
- **[Behaviour change for deployments already sending arrays]** → A multi-element array that used to fall back to `engineer` now maps by precedence. Called out in the release note. An operator who relied on the fallback was relying on a bug.
- **[`senior_engineer` writes a `role_claim_mapped` row on every sign-in]** → Same as EM and admin today. Accepted (Decision 8), not to be reopened.
- **[Stale role up to 90 minutes]** → Specified as a limitation. Docs tell people to sign out and in. IdP revocation is documented honestly as roughly no faster.
- **[A future change adds an app-side role writer]** → The `first-access` spec now says the application never writes `facilitator`, and the deferral doc says in-app designation is only a fallback for an IdP without custom claims.
- **[Exact-match strictness rejects a case-variant value an IdP admin typed]** → The allowlist warning tells the operator a value was ignored, and the troubleshooting entry covers it. Failing closed is the right direction for a privilege claim.

## Migration Plan

No schema change. Deploy order does not matter. Existing rows stay as they are until each user's next sign-in. Rollback is a redeploy of the previous build: users mapped to `facilitator` or `senior_engineer` fall back to `engineer` at their next sign-in, and the old code writes no row for that. That gap is acceptable for a rollback.

## Open Questions

None blocking. Exploration open item 1 is decided in D3, open item 2 in D7 (mechanism confirmed, production latency is Follow-up 3), and open item 3 is task 6.4. Open item 4 is proposal Follow-up 2, for a human to file.
