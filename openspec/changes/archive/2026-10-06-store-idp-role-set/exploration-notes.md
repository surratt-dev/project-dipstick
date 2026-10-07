# Exploration notes: store the IdP role set in `users.roles` (#245, expand step)

**Explorer:** Devon Calloway (Internal Champion)
**Date:** 2026-10-06
**Revision:** 2. Revision 1 was reviewed in `explore-review-facilitator.md` (Priya Nair) and `explore-review-ba.md` (Marcus Delgado). This revision resolves every open question with a decision. See §10 "Feedback disposition".
**Branch:** `agent-team/245-store-idp-role-set`
**Mode:** explore only. No code written; these notes capture thinking for the proposal stage.

---

## 1. Why I care about this one

This looks like plumbing, but it sits under the rule I care about most: **no manager participates**. Today the app knows a person is a manager only if `users.global_role = 'engineering_manager'`. That single column is a lossy summary of what the IdP said. When a manager is also in the admin group, the app stores `application_admin` and forgets they manage anyone. #244 closed the participation hole by barring admins from live sessions (D11), which works. But it works by luck of where admins sit in the precedence order, not because the app knows the truth.

The expand step fixes the *knowledge* problem without changing any *decision*. I support it on that basis. Most of what follows is about keeping it that way:

- The new column must never disagree with `global_role`. If it can drift, someone will one day write a check against the wrong one.
- Nothing in this step may start reading `roles` for authorization. That belongs to the contract step, done one area at a time.
- The capability rules written in the issue's follow-ups ("can facilitate = has `facilitator` and not `engineering_manager`"; "can participate = has neither `engineering_manager` nor `application_admin`") are the right ones, and they are **structural**. They must not become toggles when they land.

### Who feels this today (and what #245 does not change)

The people who actually hit the role collapse are **facilitators**. `docs/deployment.md` l.215 already tells operators that someone who facilitates and is also in the admin or manager group "cannot run a session". Two cases:

- **Facilitator + admin group.** Resolves to `application_admin`. Draft creation requires `global_role = 'facilitator'` (`routes/facilitator-sessions.ts` ~l.318), so they get "Only a facilitator can create a draft session." They don't know why, and neither does the facilitator who referred them. Only an operator searching logs for `discardedRoles` can find out.
- **Facilitator + manager group.** Resolves to `engineering_manager` and is refused for the same reason. This refusal is **correct** and must stay: a manager must never open a room.

After #245, an operator can answer "why can't Sam facilitate?" from the audit trail (`roles = {application_admin, facilitator}`) instead of a log search with shorter retention. That is a diagnosis improvement only. **No user-visible change: facilitators who are refused today are still refused.** The proposal must say this in those words, so nobody tells a facilitator their problem is fixed. The admin + facilitator case becomes facilitation-capable only in contract step 1 (see §9).

```
 IdP claim (string | string[])
        │ normalizeClaim            (role-map.ts:296)
        ▼
  ["Eng-Mgrs","Dipstick-Admins","Facilitators","junk"]
        │ mapValues (own-key Map)   (role-map.ts:305)
        ▼
  [engineering_manager, application_admin, facilitator]
        │
        ├── TODAY:  max by RANK ──► global_role = application_admin
        │                           discardedRoles → log line only (not audited)
        │
        └── #245:   dedupe + sort by RANK, highest first ──► roles = {application_admin, engineering_manager, facilitator}
                                              global_role = roles[1] = application_admin   (unchanged)
                                              audit metadata carries roles + previousRoles
```

---

## 2. What exists today (grounded in code)

### Resolver: `packages/backend/src/auth/role-map.ts`
- `GlobalRole` union, `GLOBAL_ROLES` (pinned to the enum by `role-map.test.ts`).
- `RANK: ReadonlyMap<MappableRole, number>` (admin 4, EM 3, facilitator 2, senior 1). `engineer` is **not** in `RANK`; it is `FALLBACK_ROLE`.
- `normalizeClaim(claim)` → non-empty strings; `mapValues(values, map)` → own-key lookup, unmapped dropped, **duplicates kept**.
- `resolveGlobalRole(claim, map)` → `{ role, discardedRoles, outcome: "missing" | "unmapped" | "mapped" }`. `discardedRoles` is limited to `DISCARDABLE = [engineering_manager, facilitator]`.
- Leaf module rule (design D1/R4): no imports of `config.js`/`db.js`. Any new helper (e.g. `resolveRoleSet`) must stay a leaf.

### Sign-in upsert: `packages/backend/src/auth/account-resolver.ts` `resolveOrCreateAccount`
- Calls `resolveGlobalRole`, logs `missing` (overage only), `unmapped`, and the discard line `{ claimName, resolvedRole, discardedRoles }`.
- Single statement: `WITH prior AS (SELECT global_role …) INSERT … ON CONFLICT (oidc_subject, oidc_issuer) DO UPDATE SET global_role = EXCLUDED.global_role … RETURNING …, (xmax = 0) AS is_new_user, (SELECT global_role FROM prior) AS previous_global_role`.
- `ResolvedUser` has `globalRole`, `previousGlobalRole`, `isNewUser`. It needs `roles` and `previousRoles`.
- The only non-test, non-seed writer of `users` is this function (plus `migrations/4_seed_data.sql`, which inserts the system user). The 01b decision made the IdP the single writer of `global_role`. Good: **one write path**.

### Audit at sign-in: `packages/backend/src/routes/auth.ts`
- `shouldEmitRoleClaimMapped(u)` (line ~62): `!u.isNewUser && (u.globalRole !== "engineer" || u.globalRole !== u.previousGlobalRole)`.
- Inside `withAuditTransaction` (lines ~335–378): `INSERT INTO audit_log (actor_user_id, actor_global_role, actor_ip, operation, team_id, metadata)` for `auth.first_access_created` (`metadata: { oidcSubject, oidcIssuer, globalRole, correlationId }`) or `auth.role_claim_mapped` (`metadata: { oidcSubject, globalRole, previousRole, correlationId }`).
- Post-commit `emitAuditEvent` mirrors both (lines ~390–415). The two must carry the same new fields.

### `audit_log` (migration `8_audit_log.sql`) and `role_change_audit` (migration `6_role_change_audit.sql`)
- `audit_log.actor_global_role TEXT NOT NULL`. TEXT, not the enum, so history survives enum changes. A new `actor_roles TEXT[]` follows the same reasoning.
- **52 `INSERT INTO audit_log` statements across 16 non-test source files** (`fail-open-audit-write.ts`, `join-link-creation.ts`, `session-invalidation-audit.ts`, `realtime/*`, routes…). Most get the actor role from `resolveActorGlobalRole` (`realtime/connection-reauthorization.ts:49`) or from the access helpers' `actorGlobalRole`.
- `role_change_audit.actor_global_role text NOT NULL` (TEAM-005) is a second actor-role snapshot. **It is not changed in this step** (non-goal, §9).

### Migrations
- `packages/backend/migrations/`, node-pg-migrate, SQL, `N_snake_name.sql`, `-- Up Migration` / `-- Down Migration` markers (see 18/19/20). The latest is `20_sessions_room_opened_at.sql`, so this change's file is **`21_users_roles.sql`**. Keep that exact name in tasks so it is not renumbered by accident. Header comment cites change + design decision + rollback note.
- `user_role` enum declaration order (`1_create_enums.sql`) is `engineer < senior_engineer < facilitator < engineering_manager < application_admin`, **the same as RANK**. The CHECK in Decision 2 makes this order load-bearing, so it gets a mandatory test (Risk 7).

### Specs touched (all definite)
- `openspec/specs/oidc-role-mapping/spec.md`: "Fixed precedence across several mapped values" (l.228, "`users.global_role` SHALL hold exactly one value"), "Precedence-discard signal" (l.288), "Precedence discard is logged, not audited" (l.320).
- `openspec/specs/auth-error-handling/spec.md`: the requirement at l.185 (metadata field lists, firing condition, "discarded … not in the metadata … deferred to #241"), the scenario at l.225, and the `previousRole` scenarios (l.199–219).
- `openspec/specs/first-access/spec.md`: the "mechanism for assigning `global_role = 'engineering_manager'`" requirement, items 4 and 5 (item 5 ends "`users.global_role` holds exactly one value", l.139). Item 4 gains "every mapped role is stored in `users.roles`"; item 5's last sentence moves to `roles`/`global_role` wording matching `oidc-role-mapping`.
- `openspec/specs/database-migrations/spec.md`: **no delta.** I checked: it lists tables, not `users` columns, and has no per-migration requirements after migration 5.
- `requirements/design/database-schema.md` (l.101–123 `users` table; l.36 already says "a user may have multiple roles") and `docs/deployment.md` (Decision 7).

### Security checks from #244 that must be re-run
- **S1** (`archive/2026-10-05-configurable-oidc-role-map/design-review-security.md` l.46): EM + admin resolves to `application_admin` and escapes manager checks. Closed by D11. D-7 in `security-review.md` says whoever reconciles must re-run S1 and S4.
- **S4** (same file, l.76): target allowlist and `RANK` must be own-key (`ReadonlySet`/`Map`), so `toString`, `constructor` and `__proto__` can never be a role.

---

## 3. A finding that changes the audit work: the firing condition is already sufficient

The issue asks that `shouldEmitRoleClaimMapped` "also fire when the role set changes". Working through the cases, it **already does**:

| Previous → new role set | New `global_role` | Fires today? |
|---|---|---|
| any → set containing a mapped role | ≠ `engineer` | yes (first disjunct) |
| `{…mapped…}` → `{engineer}` | `engineer`, previous ≠ `engineer` | yes (second disjunct) |
| `{engineer}` → `{engineer}` | `engineer`, unchanged | no, and the set did not change |

`roles = {engineer}` happens only when nothing maps. So a set change that ends at `engineer` always starts from a non-engineer `global_role`. Every set change already fires.

**Decision (§8.6):** write the explicit `|| !sameRoles(roles, previousRoles)` clause anyway, with a comment, because contract step 2 must rewrite the first disjunct when `global_role` goes and the explicit clause is what survives that rewrite. The proposal must say the clause adds **no new firing case today**; the change must not claim a behaviour fix it doesn't make. What changes is the **metadata**, not the firing. The clause is pinned by a unit test with a hand-built `ResolvedUser` (`globalRole = previousGlobalRole = 'engineer'`, sets differ). The resolver can't produce that input, but deleting the clause then fails CI.

---

## 4. Design decisions (were open questions in revision 1)

### Q1. Ordering → **descending (highest precedence first)**
"`users.roles` SHALL list each mapped role once, ordered from highest to lowest precedence (`application_admin` first). The same order SHALL be used in audit metadata `roles`/`previousRoles` and in `audit_log.actor_roles`." `roles[1] = global_role` (Postgres 1-based; `roles[0]` in TypeScript) is then a one-line CHECK, the contract step can drop `global_role` without redefining "highest", and it reads naturally in an audit row. Tests assert exact arrays (order and length), not set equality.

### Q2. Consistency enforcement → **Option B, database CHECK, all four rules**
This is the no-manager rule's foundation; a code-only guarantee is a preference, not a structure. Rejected: A (silent drift from any other writer), C (a rewrite of `global_role`, more than "expand"), D (hidden trigger, two legitimate writers).

1. `cardinality(roles) >= 1`
2. `roles[1] = global_role`
3. `'engineer' = ANY(roles)` implies `roles = '{engineer}'`
4. `roles` is strictly descending in enum order (which gives uniqueness), via an IMMUTABLE SQL function `users_roles_well_formed(user_role[])`, because Postgres CHECK does not allow subqueries.

One negative DB test per rule (SQLSTATE `23514`), plus one positive insert per resolver outcome (`missing`, `unmapped`, `mapped`).

### Q3. Default and fixtures → **`NOT NULL`, no DEFAULT; one fixture helper**
A `DEFAULT '{engineer}'` is safe today under rule 2, but once contract step 2 drops `global_role` (and rule 2 with it) the default would silently make any fixture that omits `roles` an engineer, which is exactly how an EM fixture becomes a participant in tests. Not adding it now is cheaper than remembering to remove it later.

Fixture strategy: add `insertUser({ roles, … })` to `packages/backend/src/routes/__tests__/helpers/real-db.ts`, deriving `global_role` from `roles[0]`, and a matching `setUserRoles(id, roles)` for updates. Migrate the ~14 INSERT test files, `helpers/real-db.ts` itself, and the **two UPDATE sites** that would otherwise break under rule 2:
- `routes/__tests__/room-open-integration.test.ts:233`
- `routes/__tests__/facilitator-demotion-mid-session-integration.test.ts:84`

Tasks list each file by name. Tests then state a role set, never `global_role` alone.

### Q4. Backfill → **lossy only in a fail-closed direction; no marker; contract step gated by a query**
Backfill gives `ARRAY[global_role]`. Working through the precedence order:
- `engineer`, `senior_engineer`: exact.
- `facilitator`: may miss `senior_engineer`, which no capability rule reads.
- `engineering_manager`: may miss `facilitator`. The facilitate rule denies EMs anyway.
- `application_admin`: may miss `engineering_manager`/`facilitator`. The effect is under-recognition as a manager and under-granting of facilitation. **Neither grants anything extra**, and the admin is still excluded from participation by D11.

So the backfill risk is functional, not a breach of the no-manager rule. That is the honest reason it is acceptable.

**Marker decision: no `previousRolesSource: "backfill"` marker.** The reviewers disagreed; my reasoning:
- A sign-in can't know the prior row was backfilled unless `users` carries a persistent flag. That is new schema for a one-time condition, and a column whose only job is to be cleared on next sign-in is another thing that can drift.
- The marker carries no information that isn't already reconstructable. The suspect row is, deterministically, **each user's first `auth.role_claim_mapped` row after migration 21 was applied** (the applied timestamp is in node-pg-migrate's `pgmigrations` table). A marker could not tell an auditor any more than that: that row's diff might be partly a backfill artefact and partly a real IdP change, and the marker can't separate the two either.
- Priya's real concern is a future history view showing phantom role changes to a facilitator. That is handled as a **constraint on FU-3** (any UI that shows role history), not as data written now: such a view must annotate or suppress each user's first post-migration-21 diff. Recorded in §9.

For auditors, add a scenario to `auth-error-handling`: "The first `auth.role_claim_mapped` row after migration 21 may show a `previousRoles` → `roles` difference that reflects the backfill, not an IdP change."

**Precondition for contract step 1** (copied verbatim into that follow-up issue): "Before any check reads `roles`, every `users` row with `global_role IN ('application_admin','engineering_manager')` has an `auth.role_claim_mapped` or `auth.first_access_created` audit row with a `roles` field dated after migration 21 was applied, **or** the check treats such rows as unresolved, meaning they gain no capability from `roles` beyond what `global_role` already grants." Checkable by query, because non-engineer users always fire `role_claim_mapped` at sign-in (§3). "Unresolved" is fail-closed by definition; it must never mean "assume engineer".

### Q5. `previousRoles` → **same statement, absent on first access, always present on `role_claim_mapped`**
Extend the `prior` CTE: `SELECT global_role, roles FROM users …` and `RETURNING …, (SELECT roles FROM prior) AS previous_roles`. Same statement, same race-freedom as D4.
- `previousRoles` is **absent** from `auth.first_access_created` (as `previousRole` is today) and **always present, never null**, on `auth.role_claim_mapped`, because the backfill guarantees a prior value.
- Keep `previousRole` **and** add `previousRoles`; don't rename (spec l.199–219 and audit consumers depend on it).
- camelCase keys: `roles`, `previousRoles`.

### Q6. `audit_log.actor_roles` → **sign-in rows only; keep column and metadata**
Threading a `resolveActorRoles` through 52 insert sites is contract-step work with no decision depending on it. Both carriers stay: the post-commit `emitAuditEvent` has no columns, so metadata carries `roles` to the event stream; the column makes manager-history queries work in SQL without JSON extraction and is ready for the contract step. The proposal should admit that in this step the column duplicates metadata on the only rows it populates. Its value is readiness.

`COMMENT ON COLUMN` and `database-schema.md` wording: "NULL means the actor's role set was not captured for this operation. It does not mean the actor had no roles. Populated only for `auth.first_access_created` and `auth.role_claim_mapped` as of migration 21."

### Q7. Spec deltas for the discard requirements
- "Fixed precedence across several mapped values": keep the precedence for `global_role`. Replace "`users.global_role` SHALL hold exactly one value" with: `users.roles` holds every mapped role, de-duplicated, highest first, or `{engineer}`; `global_role` is its first member. Keep all four scenarios and add exact `roles` assertions (admin+EM → `roles = {application_admin, engineering_manager}`, the S1 pin).
- "Precedence-discard signal": **keep the log line and its `DISCARDABLE` scope** (EM, facilitator). Operators search for `discardedRoles` (`docs/deployment.md` l.179, l.219). `senior_engineer` is **not** added to `discardedRoles`, even though `roles` now records it. "Discarded" now means "outranked for `global_role`", not "lost"; clarify the wording.
- "Precedence discard is logged, not audited": rename to e.g. "Outranked roles are recorded in the audit role set". The conflict is now reconstructable from audit. Still **no discard flag** and no conflict operation; those remain #241's.
- `auth-error-handling` l.225: "metadata carries `roles = [application_admin, facilitator]` and no discard flag, claim values or role-map keys". Update the l.185 field lists and its "deferred to #241" sentence, and add the Q4 backfill scenario.
- `first-access` items 4–5 as in §2.

### Q8. #241 boundary → **#245 claims no #241 acceptance criteria; the rebase note is a human follow-up action**
#241's text is stale (it describes #235's facilitator > EM precedence, `mapRoleClaimToGlobalRole` and `auth/account-resolution-audit.ts`, none of which exist after #243). After #245 the conflict is derivable from `roles @> '{engineering_manager,facilitator}'`; the conflict operation, notice and stranded-draft handling are untouched. Deciding which #241 ACs are met belongs to #241's owner, so #245 claims none.

This change's agents **do not post to GitHub**. The comment is a follow-up action for the human (§9, H1) with drafted text. Done = the comment URL recorded in this change's `tasks.md`.

### Q9. Multi-role local stub persona → **defer, but file it now and land it before the contract step's facilitator usability pass**
Touching `docker/oidc/accounts.js`, `DEV_LOGIN_OPTIONS` (`routes/auth.ts` l.46), the frontend test and `interactions.test.js` in lockstep (#243 D9/C7) is not worth it while no behaviour depends on the set. But a real facilitator needs to sign in as "facilitator who is also an admin" and see both the refused and the allowed paths during contract step 1's usability pass, so the persona must land **before** that pass, not after. Filed as a follow-up issue with its number in `tasks.md`.

### Q10. Where does `engineer` appear? → "`engineer` SHALL appear in `roles` only as the sole element."
A `senior_engineer`-only user has `roles = {senior_engineer}`. "Engineer" is the absence of a mapped role, not a role you also hold. This requirement and CHECK rule 3 trace to each other. The contract-step participate rule must not depend on `'engineer' = ANY(roles)`.

### Q11. Migration 21 during a live session → **bounded lock, no re-authorization change**
Sign-in, the WebSocket re-authorization sweep (`realtime/connection-reauthorization.ts`) and every live check read `users`. `ALTER TABLE … ADD COLUMN`, the backfill `UPDATE` and `ADD CONSTRAINT … CHECK` take an ACCESS EXCLUSIVE lock on `users` for their duration. On a table of this size that is milliseconds; the risk is *queueing* behind a long transaction, which would make readers queue behind the migration. Decisions:
- The migration sets `SET LOCAL lock_timeout = '5s'` so it fails and rolls back rather than stall the sweep. A failed migration is retried; a stalled reveal is not recoverable.
- A task measures migration 21's duration against a seeded table of 10,000 users and records it in `tasks.md`.
- The upgrade notes *recommend* applying it outside session hours. It is a recommendation, not a requirement, because the lock is bounded.
- `global_role` is unchanged by the backfill, so no sign-in, session, lobby or re-authorization outcome changes. That is an acceptance condition (§7, AC11).

---

## 5. Risks (what goes wrong if the design drifts)

1. **Drift between `roles` and `global_role`.** Mitigated structurally by the four-rule CHECK (Decision 2).
2. **Premature reads of `roles` for authorization.** Someone "helpfully" makes TEAM-006 accept `roles @> {engineering_manager}` in this PR, changing behaviour without the contract-step review. Mitigation: non-goal, reviewer checklist item, and the AC7 grep.
3. **Capability rules applied with the wrong polarity later.** "Has `facilitator`" alone would let EM+facilitator users open rooms. Copy the rules verbatim into contract step 1, plus a test pin there: an EM + facilitator user cannot create a draft, and the refusal names no role and is visible to no one else.
4. **Claim values leaking via the role set.** `roles` is built only from `mapValues` output, never from `normalizeClaim` output. Every #243 S7 logger/audit assertion extends to the new fields. Re-run S4 (§6).
5. **Backfill read as truth.** Mitigated by the Q4 precondition query on contract step 1.
6. **Audit noise.** None new. Row volume unchanged; row width grows slightly.
7. **Enum order is load-bearing** (CHECK rule 4). **Mandatory** test: `GLOBAL_ROLES` order equals ascending `RANK` order equals `pg_enum.enumsortorder` order for `user_role`.
8. **Admin exclusion lost in translation.** Today the EM+admin case is blocked only by D11's admin rule. Constraint on contract step 1 (written into the follow-up, not left here): "If a future decision lets `application_admin` participate, the participate rule must still deny `engineering_manager ∈ roles`."
9. **Migration lock stalls a live room** (Q11). Mitigated by `lock_timeout` and a measured duration.

---

## 6. Re-running S1 and S4 against the new resolver

**S1 (EM + admin collapse)**
- Claim maps to `{application_admin, engineering_manager}` → `roles = [application_admin, engineering_manager]`, `global_role = application_admin` (unchanged).
- The discard log line still fires with `discardedRoles = [engineering_manager]`.
- D11 E1–E4 tests pass unchanged. No authorization check reads `roles`.
- New: sign-in metadata and `audit_log.actor_roles` carry `engineering_manager`. Manager status is now durable, which **improves** S1's "it is also invisible" finding.
- Still open (contract step): TEAM-006 cannot associate this person as a manager.

**S4 (own-key target validation)**
- `PERMITTED_TARGETS` and `RANK` stay `Set`/`Map`. Any sort or dedupe uses `RANK.get` or the `GLOBAL_ROLES` index, never `obj[role]`.
- Boot fails on `{"A":"toString"}` / `{"A":"__proto__"}`.
- Claim `["toString","__proto__","constructor"]` → `roles = [engineer]`.
- A raw `INSERT` of `'{toString}'::user_role[]` raises `22P02`, as defence in depth.

---

## 7. Acceptance conditions I would sign off on

1. Migration `21_users_roles.sql` adds `users.roles user_role[] NOT NULL` (no default), backfills `ARRAY[global_role]`, adds the four CHECK rules (Decision 2) and the IMMUTABLE helper, and adds `audit_log.actor_roles TEXT[] NULL` with a `COMMENT ON COLUMN`. It sets `lock_timeout` (Q11). The down migration drops both columns, the constraint and the helper. `global_role` is untouched in either direction. Up → down → up passes in CI. Header in house style.
2. The resolver returns the role set: mapped, deduped, highest precedence first, `{engineer}` only when nothing maps. Still a leaf module. `global_role` is assigned `roles[0]`; no separate max computation remains in `resolveOrCreateAccount`.
3. In `role-map.test.ts` `describe("claim resolution (task 3.1)")`, every existing precedence row asserts the same `role` as before **and** a new exact `roles` array (e.g. `["Facilitators","Eng-Mgrs","Dipstick-Admins","Eng-Mgrs"]` → `[application_admin, engineering_manager, facilitator]`).
4. The upsert writes both columns in one statement; `previous_roles` comes from the same `prior` CTE. A test asserts `previousRoles` reflects the row *before* the upsert when the claim changes between two sign-ins of the same subject.
5. Both sign-in audit rows and both post-commit events carry `roles`; `role_claim_mapped` carries `previousRoles` (always present, never null); `first_access_created` has no `previousRoles` key. `previousRole` is kept. Sign-in rows populate `actor_roles`. The transactional row and post-commit event carry identical arrays (one test). No claim values or map keys anywhere (the S7 spy test is extended).
6. Firing condition pinned by tests: `{admin, facilitator} → {admin}`, `{facilitator} → {engineer}`, and the hand-built-input test for the explicit set clause (§3).
7. Zero authorization code paths read `roles`. Check: `rg -n '(\.roles\b|\broles\s*(=|@>|&&|\[)|actor_roles|previous_roles|previousRoles)' packages/backend/src --glob '!**/__tests__/**'` hits only `auth/role-map.ts`, `auth/account-resolver.ts` and `routes/auth.ts`. (Baseline today: zero hits. A bare `\broles\b` pattern is unusable; it already matches comments in `content.ts` and `teams.ts`.) Output recorded in `tasks.md` and added to the reviewer checklist.
8. Spec deltas in `oidc-role-mapping`, `auth-error-handling` and `first-access` as in Q7; `database-migrations` explicitly unchanged; `database-schema.md` `users` and `audit_log` tables updated; `docs/deployment.md` per Decision 7.
9. `security-review.md` records, each citing a test name: S1: admin+EM claim gives `roles = {application_admin, engineering_manager}`, `global_role = application_admin`, D11 E1–E4 unchanged and green. S4: boot fails on `{"A":"toString"}` / `{"A":"__proto__"}`; claim `["toString","__proto__","constructor"]` gives `{engineer}`; raw `'{toString}'::user_role[]` raises `22P02`.
10. Fixtures: the `insertUser`/`setUserRoles` helpers exist; the ~14 INSERT files and both UPDATE sites (Q3) use them. One negative test per CHECK rule (`23514`). The enum-order test (Risk 7) exists.
11. Deploying migration 21 does not end, re-authorize-fail or delay any open lobby or live session; no user is forced to sign in again. Migration duration on a 10,000-user seed is measured and recorded.
12. Follow-ups filed with issue numbers recorded in `tasks.md` (§9). Contract step 1's body includes the capability rules **verbatim**, the Q4 precondition, the Risk 8 constraint and the facilitation notes in §9.

---

## 8. Decisions on revision 1's open questions (summary)

| # | Question | Decision |
|---|---|---|
| 1 | Order direction | Descending, highest first (Q1) |
| 2 | DB vs code consistency; fixtures | DB CHECK, four rules; NOT NULL, no default, one helper (Q2, Q3) |
| 3 | Mark backfilled `previousRoles`? | No marker. Fail-closed analysis, auditor scenario, contract-step precondition query, FU-3 display constraint (Q4) |
| 4 | `actor_roles` scope | Sign-in rows only; column and metadata both kept, duplication admitted (Q6) |
| 5 | #241 boundary | #245 claims no #241 ACs; rebase comment is a human action, drafted in §9 (Q8) |
| 6 | Redundant set-change clause | Keep, with comment and a direct unit test; no claimed behaviour change (§3) |
| 7 | `docs/deployment.md` checklist | "As well as": audit first, logs second (below) |

**Decision 7 detail.** The conflict-finding checklist (l.219) gives a copy-pasteable SQL query over `audit_log` for `metadata->'roles'` containing both `engineering_manager` and `facilitator`, states it covers sign-ins after migration 21 only, and keeps the `discardedRoles` log search for earlier sign-ins. Audit retention is longer (#243 D8's gap); log search still covers pre-migration history. l.215's warning ("cannot run a session") stays true and unchanged in this step.

---

## 9. Non-goals and follow-ups

### Non-goals (state in the proposal)
- **No change to what any facilitator, participant or manager sees or can do. Facilitators refused today are still refused.**
- No authorization check moves to `roles`.
- `users.global_role` is not dropped. `audit_log.actor_global_role` stays permanently.
- `role_change_audit` gains no role-set column.
- `discardedRoles` scope is unchanged; the log line is not removed.
- No backfill-origin marker in metadata or on `users`.
- `actor_roles` is not populated outside the two sign-in operations.
- No conflict operation, notice or stranded-draft handling (#241).
- No change to refusal messages (follow-up F4).
- No change to precedence, the role map format, the fallback, or refresh-time re-resolution (still interactive sign-in only, ~90-minute bound).
- No UI showing roles (FU-3 from #243 remains separate).

### Follow-ups to file (numbers into `tasks.md`)
- **F1. Contract step 1 (checks move to `roles`, one area at a time).** Body includes: the capability rules verbatim; the Q4 precondition; the Risk 8 constraint; the EM + facilitator draft-creation test pin (Risk 3). **Facilitation note** (correcting the facilitator review's O5): D11 itself does not block an admin + facilitator from running a room. D11's E3 changes only the participant path, and the session-facilitator path is evaluated first and untouched. What blocks them is draft creation's `global_role = 'facilitator'` check (`facilitator-sessions.ts` ~l.318), plus possibly `evaluateTeamAccess` returning the admin path before membership (team content a facilitator needs may be denied). Contract step 1 must move draft creation to the facilitate rule **and** check every facilitator-needed read against the admin-first grant, or the new facilitate rule promises something the product won't deliver. D11's participation exclusion stays as it is.
- **F2. Contract step 2** (drop `global_role`; rewrite the firing condition's first disjunct; CHECK rule 2 goes).
- **F3. Multi-role local stub persona** (Q9), scheduled to land before F1's facilitator usability pass.
- **F4. Facilitator-actionable refusal message**, scheduled with F1: a refused would-be facilitator sees something they can act on ("ask your administrator to check your group membership") that names no role, group or claim value and is visible only to them. Out of scope for #245: it is user-visible behaviour, and this step changes none.
- **F5. FU-3 constraint (role-history UI, if built):** annotate or suppress each user's first post-migration-21 role diff (Q4). Add as a comment on FU-3's issue.

### Actions for the human (agents do not post to GitHub)
- **H1. Comment on #241.** Suggested text:
  > #245 (store the IdP role set) records every mapped role in `users.roles` and in `auth.role_claim_mapped` / `auth.first_access_created` audit metadata (`roles`, `previousRoles`). Suggest #241 define the EM + facilitator conflict as `roles @> '{engineering_manager,facilitator}'` rather than re-deriving it from the claim. Note the issue text's references to `mapRoleClaimToGlobalRole`, `auth/account-resolution-audit.ts` and facilitator > EM precedence are stale since #243 (precedence is now admin > EM > facilitator > senior). #245 claims none of #241's acceptance criteria. The stored set also makes the stranded-draft case detectable (a facilitator who gains `engineering_manager` while owning a draft); who tells that facilitator, and when, stays with #241.

  Record the comment URL in this change's `tasks.md`.

---

## 10. Feedback disposition

### Facilitator review (Priya Nair)

| Item | Disposition | Rationale |
|---|---|---|
| O1 / "Who feels this" paragraph | **Accepted** | Added to §1. The facilitator is the person who hits this, and the proposal should say so. |
| O2 / explicit "no user-visible change" non-goal | **Accepted** | §1 and §9, in her words. Prevents overclaiming. |
| O3 / migration lock during a live session | **Accepted, reshaped** | Q11 and AC11: `lock_timeout`, measured duration, no re-authorization change as an acceptance condition. "Deploy outside session hours" is a recommendation, not a requirement, because the lock is bounded. |
| O4 / backfill marker in metadata | **Rejected** | Q4. A marker needs a persistent flag on `users` for a one-time condition and tells an auditor nothing that "first row after migration 21" doesn't. Her UI concern is real and becomes a constraint on FU-3 (F5). |
| O5 / D11 must be narrowed for admin + facilitator | **Accepted in part, corrected** | The dependency is real but misplaced: D11 leaves the facilitator path untouched. The blockers are draft creation's `global_role` check and the admin-first team grant. Recorded on F1. |
| O6 / EM + facilitator test pin, no leak to the room | **Accepted** | Risk 3 and F1. Contract-step work, not this step. |
| O7 / continuity side benefit | Noted | A small side benefit; not a goal. |
| Q1 / refusal message | **Deferred** | F4, scheduled with F1. User-visible change; out of scope for an expand step. |
| Q2 / lock timing check | **Accepted** | Q11, AC11. |
| Q3 / D11 narrowing | See O5. |
| Q4 / stranded draft in the #241 rebase | **Accepted** | Included in the H1 drafted comment; remains #241's to solve. |
| Q5 / persona before usability pass | **Accepted** | Q9, F3. |
| Deployment checklist "as well as" | **Accepted** | Decision 7. |

### BA review (Marcus Delgado)

| Item | Disposition | Rationale |
|---|---|---|
| G1 / `first-access` is a definite delta | **Accepted** | Verified l.139. §2, Q7, AC8. |
| G2 / two UPDATE fixture sites | **Accepted** | Verified both lines. Q3, AC10. |
| G3 / `role_change_audit` non-goal | **Accepted** | §2, §9. |
| Keep the `21_users_roles.sql` name | **Accepted** | §2, AC1. |
| Q1 descending | **Accepted** | |
| Q2 option B, four rules; enum-order test mandatory | **Accepted** | Same as my revision-1 lean, now firm. |
| Q3 NOT NULL, no default, one helper | **Accepted** | Added `setUserRoles` for the UPDATE sites. Dropped his `grep global_role` AC for tests: "hits only in assertions" isn't mechanically checkable. AC10 names the files instead. |
| Q4 no marker, precondition query, auditor scenario | **Accepted, tightened** | Defined "unresolved" as fail-closed (no capability from `roles` beyond `global_role`). |
| Q6 sign-in rows only, both carriers, NULL wording | **Accepted** | |
| Q8 "#245 posts the comment" | **Rejected as stated** | Agents don't post to GitHub. The comment is drafted as human action H1. "Claims no #241 ACs" accepted. |
| §8.6 keep clause, hand-built test | **Accepted** | |
| §8.7 "as well as", SQL query in docs | **Accepted** | |
| Q5, Q7, Q9, Q10 tightenings | **Accepted** | Q5 absent/always-present, Q7 `DISCARDABLE` unchanged, Q9 filed issue, Q10 requirement ↔ rule 3. |
| AC rewrites 1–6, 8–10 | **Accepted** | §7. AC3 now names the `describe` block. `database-migrations`: checked, no delta. |
| AC7 grep `\broles\b` | **Accepted in intent, pattern replaced** | His pattern already matches existing comments in `content.ts` and `teams.ts`, so it would fail on day one. Replaced with a pattern for reads that has zero hits today. |
| §5 Risk 8 into the follow-up | **Accepted** | F1. |
