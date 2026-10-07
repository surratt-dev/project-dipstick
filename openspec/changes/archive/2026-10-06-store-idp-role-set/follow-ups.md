# Follow-ups for #245

Filed 2026-10-06: F1 → #251, F2 → #252, F4 → #253, F6 → #254. FU-7 widening comment posted on #211 (FU-7 itself was never filed). F5 not posted: FU-3 was never filed; include the F5 text in FU-3's body if it is filed.

Drafted by task 0.3. Agents do not post to GitHub: a human files F1, F2, F4 and F6, posts the F5 comment on FU-3's issue and the #244 follow-up 7 comment, and records the numbers and URLs in `tasks.md` "Records" (task H.1). F3 (multi-role local stub persona) is folded into F1 as an acceptance note and is not filed separately.

---

## F1. Contract step 1: authorization checks move to `users.roles`

**Title:** Contract step 1 for #245: move authorization checks from `global_role` to `users.roles`, one area at a time

**Suggested milestone:** to be decided by a human (task H.4). If none is given, record in `tasks.md` that F1 is unscheduled.

**Body:**

#245 (expand step) stores every role the IdP claim maps to in `users.roles` (`user_role[]`, highest precedence first, `roles[1] = global_role`, `{engineer}` when nothing maps), enforced consistent with `global_role` by the `users_roles_consistent` CHECK, and records the set on the sign-in audit rows (`metadata.roles`, `metadata.previousRoles`, `audit_log.actor_roles`). Nothing reads it for authorization yet. This issue moves the checks, one area at a time, each with its own tests.

**Capability rules (verbatim, both structural, never toggles):**

- "can facilitate = has `facilitator` and not `engineering_manager`"
- "can participate = has neither `engineering_manager` nor `application_admin`"

Neither rule may ever become a configuration option or feature flag.

**Risk 8 constraint (verbatim):** "If a future decision lets `application_admin` participate, the participate rule must still deny `engineering_manager ∈ roles`."

**Required test pin (manager + facilitator):** a user whose `roles` contains both `engineering_manager` and `facilitator` cannot create a draft session; the refusal names no role and is visible to no one else.

**Facilitation note.** D11 (#244) does not block an admin + facilitator from running a room: D11's E3 changes only the participant path, and the session-facilitator path is evaluated first and is untouched. The blockers are draft creation's `global_role = 'facilitator'` check (`routes/facilitator-sessions.ts` ~l.318) and the admin-first team grant (`evaluateTeamAccess` returns the admin path before membership, so team content a facilitator needs may be denied). This issue must move draft creation to the facilitate rule **and** check every facilitator-needed read against the admin-first grant, or the new facilitate rule promises something the product does not deliver. D11's participation exclusion stays as it is.

**TEAM-006 and the manager views.** TEAM-006's precondition (`routes/teams.ts` ~l.1157, `global_role !== 'engineering_manager'` → 409 `GLOBAL_ROLE_PRECONDITION_NOT_MET`) and the manager history views (EM-*) move to `roles`, so an admin + manager is recognised as a manager; this is #245's second problem bullet and `requirements/use cases/01 - Identity and Access - Use Cases.md` points operators at F1 for it. **Scope decision:** the EM-* views (`routes/em-views.ts` and the manager branches of `auth/team-content-access-helper.ts`) are in this issue's scope, as their own area, moved together with TEAM-006: both answer the same question ("is this user a manager?"), and moving only one would let an admin + manager be associated with a team but not see its history, or the reverse. They are not split into a separate follow-up.

**Contract step 1 precondition (verbatim from #245 `tasks.md`):**

> "Before any check reads `roles`, a user is *resolved* only if their `users` row's `global_role` is `engineer`, or their most recent `auth.role_claim_mapped` or `auth.first_access_created` audit row (1) carries a `roles` field (rows written by a build before #245 or by the previous build during the upgrade window carry none), (2) was written after the latest `run_on` of migration `21_users_roles` in `pgmigrations`, and (3) has `roles` equal to the current `users.roles`. Every other user is *unresolved*. For an unresolved user, `roles` grants no capability beyond what `global_role` already grants, and the absence of a role from `roles` is not evidence that the user lacks it: deny rules (any rule that refuses because of `engineering_manager` or `application_admin`) must treat an unresolved user as if the denying role may be present, or fall back to a `global_role`-based denial at least as strict as today's. Recommended (not required): F1's first migration applies this test and resets `roles = ARRAY[global_role]` for every user who fails it; those users remain unresolved. F1's first migration drops the #245 legacy-writer shim (`users_roles_fill_legacy`)."

**Recommended (not required):** this issue's first migration applies the precondition test above and resets failing rows to `roles = ARRAY[global_role]` (design D8 of #245). Those users stay unresolved.

**First migration: drop the legacy-writer shim.** This issue's first migration drops the #245 transitional trigger and function (`DROP TRIGGER users_roles_fill_legacy ON users; DROP FUNCTION users_roles_fill_legacy();`). By then no pre-#245 build can be serving. Add, in the same change, the real-Postgres test that an `INSERT INTO users` omitting `roles` is rejected with SQLSTATE `23502`.

**Test fixture migration.** Migrate every remaining raw `INSERT INTO users` and `UPDATE users SET global_role` in backend tests to `Fixture.user` / `Fixture.setRoles` / `insertUser` (`routes/__tests__/helpers/real-db.ts`, #245 design D3), so no test depends on the dropped shim. Exclude `routes/__tests__/auth.test.ts`'s mocked query matcher (`INSERT INTO users` there matches a mocked call, it inserts nothing).

**Constraints:**

- Authorization keeps reading `users` on every request. `roles` is never cached in the Redis session or exposed to the client (`/auth/me`, WebSocket payloads, any response) without a disclosure review.
- The manual urgent-revocation runbook (`docs/deployment.md`) writes both columns: `UPDATE users SET global_role = 'engineer', roles = '{engineer}' WHERE id = …`. Keep it that way; after the shim is dropped, a `global_role`-only update fails the CHECK.

**Acceptance note (formerly F3):** a multi-role persona is added to the local OIDC stub (`docker/oidc/server.js` and the persona-login list), for example a user in both the admin and facilitator groups, and lands before this issue's facilitator usability pass.

---

## F2. Contract step 2: drop `users.global_role`

**Title:** Contract step 2 for #245: drop `users.global_role` (keep `audit_log.actor_global_role`)

**Body:** After F1, no check reads `users.global_role`. Drop the column, remove CHECK rule 2 (`roles[1] = global_role`) from `users_roles_well_formed`, and rewrite `shouldEmitRoleClaimMapped` so the role-set clause carries the rule (delete its first two disjuncts; the #245 hand-built tests say what changes). `audit_log.actor_global_role` is kept permanently as history.

---

## F4. Facilitator-actionable refusal message

**Title:** Show a refused would-be facilitator a message they can act on

**Body:** Scheduled with F1. A user refused draft creation or facilitation sees something they can act on ("ask your administrator to check your group membership") that names no role, group or claim value and is visible only to them. Out of scope for #245, which changes no user-visible behaviour.

---

## F5. Comment for FU-3's issue ("Your resolved role" indicator, #243)

**Comment text:**

> Constraint from #245 (store the IdP role set): any UI that shows a user's role history must annotate or suppress each user's first `auth.role_claim_mapped` diff after migration 21 (`21_users_roles`) was applied. That diff compares against the migration's backfill (`roles = {global_role}`), not against a real IdP change, so a manager + facilitator would otherwise appear to have "gained" facilitator on that day.

---

## F6. Backend test files are not type-checked in CI

**Title:** Backend test files are not type-checked in CI and carry type-error debt

**Body:** No CI job type-checks backend test files: `tsconfig.build.json` excludes `src/**/__tests__` and vitest strips types. `npx tsc -p packages/backend/tsconfig.json --noEmit` reported 203 errors at #245's baseline (task 0.2 in `openspec/changes/store-idp-role-set/tasks.md`). #245 recorded the baseline and added no errors to the files it touched. Either clear the debt and add a scoped `tsc --noEmit` CI step over backend tests, or record that the team accepts the debt. Overlaps #243's FU-14 ("Test-file typecheck debt"); if FU-14 was filed, close one as a duplicate of the other.

---

## Comment widening #244 follow-up 7 (FU-7, per-user session invalidation)

**Comment text:**

> Widening from #245: the manual urgent-revocation `UPDATE` in `docs/deployment.md` now writes `users.roles` as well as `global_role` (`SET global_role = 'engineer', roles = '{engineer}'`), and #245's transitional legacy-writer trigger (`users_roles_fill_legacy`) also writes `users.roles` during the upgrade window. Neither write produces an `audit_log` row. Whatever audited operator tool this issue adds for revocation should cover `users.roles` too, so a manual demotion of the role set is recorded like any other role change.
