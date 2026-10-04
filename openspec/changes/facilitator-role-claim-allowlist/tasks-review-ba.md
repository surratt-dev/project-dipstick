# Tasks review: BA (Marcus Delgado)

**Verdict: approve with fixes.** Every proposal capability has tasks, and 41 of the 44 delta scenarios trace cleanly to a named task. The gaps are in the latency/revocation scenarios, a spec sentence the repo already contradicts, and a few assertions that got dropped between spec and task. All fixes extend existing tasks; none needs a new numbered task (VP condition).

## Trace (scenario → task)

**first-access**
| Scenario | Task(s) |
|---|---|
| EM claim → `engineering_manager`; absent → `engineer`, no warning | 1.3 (absent), existing EM tests |
| Not-on-allowlist rejected silently (value in no log/audit) | 1.3, 1.4, 3.2 |
| EM removed at IdP → demoted + audited | 2.1, 2.3(b) |
| TEAM-006 precondition / 409 / onboarding scenarios | unchanged; existing tests |
| Allowlist is exactly the five values | 1.1 |
| `facilitator` / `senior_engineer` string maps, no warning | 1.3 |
| Near-miss values not normalised | 1.3, 1.4 |
| Array precedence, admin outranks all, ignored element, empty array, non-string, duplicates, `[null]` | 1.6 |
| Facilitator outranks EM; every outranked role listed | 1.8 |
| `["senior_engineer","facilitator"]` persists across re-sign-in | 3.4 |
| Facilitator persists on re-sign-in (+ `canFacilitateSessions: true`) | 3.1 + 4.4 (split across layers) |
| First sign-in as facilitator | 3.1 |
| Facilitator demoted when claim removed | 3.2, 2.3(a); **`canFacilitateSessions: false` not named, see G4** |
| Grant does not reach existing session before re-auth | **G1** |
| Revocation does not reach existing session; refresh revoke → `revoked` | **G1** |
| `senior_engineer` persists / cannot facilitate / draft 403 / topics 403 | 3.1, 4.1, 4.2, 4.3 |
| `senior_engineer` cannot create a team (403, audit row, no rows) | 4.2, **see G5** |
| `senior_engineer` demoted | 2.3(b), 3.2 |
| Deployment docs pass the checklist | 6.1 |

**auth-error-handling**
| Scenario | Task(s) |
|---|---|
| First-access transactional / rollback / conn-acquisition / log-after-commit | existing tests; 2.2 moves INSERTs unchanged; 2.5 |
| Role-claim mapping recorded with `previousRole` (row + log) | 2.3(a)(d)(e), 3.1 |
| Brand-new user has no `previousRole` | 2.1 (new user → false), 3.1 |
| Demotion from facilitator / EM / admin / senior_engineer | 2.1, 2.3(a)(b), 3.2 |
| Demotion by non-allowlisted value, value absent from row **and log** | 3.2 (row only), 7.5 (inspection); **G6** |
| Lateral change EM → facilitator | 2.1 only (truth table); **G6** |
| Unchanged default not recorded | 2.1, 2.3(c), 3.3 |
| Non-allowlisted value for returning engineer: warning only | 2.3(f), 3.3 |
| Unchanged non-default role recorded every sign-in | 2.1, 3.1 |

**oidc-auth**: valid exchange, expiry, audience, state, port: existing tests. Signature failure → S.1(b)(d), S.5. Altered role claim → S.1(c), S.5. JWKS unreachable → S.4. "Cannot be configured off" / "no claim read before verify" → S.3, 7.5. See G3 for `alg: none`.

**local-dev-environment**: discovery, code flow, seeded accounts, ID-token issuance: existing. Role claims on accounts → 5.1, 5.2. Participant unseeded → 5.1. Session with no SQL step → 5.6, 6.2, 6.3. Survives sign-out/in → 5.6. Role on ID token, not userinfo → 5.6 (manual).

## Gaps

- **G1 (medium): the latency/revocation scenarios have no task.** 7.6 maps them to "6.1 docs plus the existing `oidc-auth` absolute-lifetime and `revoked` refresh tests", but no task names those tests or confirms they exist. Docs are not verification. The scenarios make two claims that need a test: token refresh never re-reads the role claim (no `resolveOrCreateAccount` call on the refresh path), and `POST /api/v1/teams` keeps succeeding for the old role until callback. *Fix:* extend 7.6 to name the existing test files (likely `middleware.test.ts`, `session-invalidation-audit.test.ts`, `connection-token-refresh.test.ts`), and add a refresh-path pin to 2.5 or 4.4 if none exists.
- **G2 (medium, spec vs repo): "No seed migration SHALL write ... any other value to `users.global_role`."** `migrations/4_seed_data.sql:17` already inserts the `system` user with `global_role = 'application_admin'`. As written, the spec is violated on day one, and no task checks for seeds or scripts that write a role. *Fix:* narrow the spec sentence to "no person's account" (or name the `system` row as an exception), and add a `global_role` write grep over migrations, scripts and docs to 6.5.
- **G3 (low): `alg: none` category is unchecked.** The spec gives `none` as a signature failure categorized `authentication_failed`, but S.1(e) covers only (b) and (c). *Fix:* include (d) in (e), or record why its category differs.
- **G4 (low): the facilitator-demotion `canFacilitateSessions: false` assertion is never named.** It holds by construction (the session reads `global_role` live), but no task asserts it. *Fix:* cite the existing `engineer → false` test in 4.4.
- **G5 (low): 4.2 drops two assertions.** The spec says "no team, **topic**, or session row". 4.2 says "no team/session INSERT". The draft-403 case also loses "no membership on Team A". *Fix:* restore both in 4.2.
- **G6 (low): two `auth-error-handling` scenarios are thin.** "Lateral EM → facilitator" is only a truth-table row, with no row or `previousRole` assertion. "Non-allowlisted demotion, value in no structured log entry" relies on inspection (7.5). *Fix:* add EM→facilitator to 2.3(b)'s parameter list, and in 3.2 also assert that the captured logger output omits `superuser`.

## Lost in translation (proposal → tasks)

- The proposal's release-note line (facilitator/senior_engineer accepted, arrays, demotions audited, signatures verified) and its operator caveat ("rollback also turns signature verification off") shrink in 7.7 to the signature sentence only. 7.7 should carry the full line.
- 7.6 says "three delta specs". There are four (`local-dev-environment` is missing from the count, though its tasks are traced).
- The no-manager rule (Constraints) rests on docs plus a log line, by decision. 1.8 and 6.1 cover both faithfully. The reporting-chain Follow-up 2 is in 7.7. Nothing was lost there.
