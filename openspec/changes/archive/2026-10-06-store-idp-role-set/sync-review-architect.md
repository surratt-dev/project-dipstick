# Sync review: store-idp-role-set (Solution Architect)

Reviewer: Ingrid Sollenberger, Principal Solution Architect
Scope: drift between the synced main specs, the change deltas, `design.md`, `docs/deployment.md`, `requirements/design/database-schema.md`, the use-case doc, and the code on this branch (`git diff main`, migrations 21/22, `role-map.ts`, `account-resolver.ts`, `routes/auth.ts`). I also checked OpenSpec validation against a baseline worktree of `main`.

## Verdict

**No drift between the docs and the code remains.** One finding needed a fix, not just a note: the sync made strict validation **fail for `oidc-role-mapping`**, the only item that passed `--strict` on `main`. I fixed it with wording changes only. I made two further small wording fixes. No code changes were needed or made.

## 1. Main specs against deltas

I compared every MODIFIED and ADDED requirement block in `changes/store-idp-role-set/specs/*` with its block in `openspec/specs/*` using a script. All 14 blocks are byte-identical (before and after my edits, which I applied to both sides). The RENAME "Precedence discard is logged, not audited" to "Outranked roles are recorded in the audit role set" is applied, and the old header no longer exists in main. Outside these blocks, `git diff main` shows no changes to the main specs.

The BA's two corrections are both correct against the code:
- **Shim on an inconsistent UPDATE.** `users_roles_fill_legacy` coerces only when `NEW.roles IS NOT DISTINCT FROM OLD.roles`. A stated `roles` that differs from the stored one passes through to the CHECK and fails with `23514`. This is tested ("an UPDATE that changes global_role while stating an inconsistent roles fails 23514").
- **parseRoleArray fails sign-in.** It throws when the value is not an array, is empty, or holds an element outside `GLOBAL_ROLES`. The resolver also throws when `previous_global_role` is set but `previous_roles` is null. Both fail the sign-in closed, as `auth-error-handling` states.

## 2. Specs and design against code

| Contract | Code | Status |
|---|---|---|
| Set ordered highest first, deduplicated; `{engineer}` when nothing maps; `global_role = roles[0]` (D1, D4) | `resolveRoleSet` builds a `Set`, sorts it with the explicit `RANK` comparator and returns a fresh `[FALLBACK_ROLE]`; the resolver uses `roles[0]` | OK |
| CHECK cannot return NULL; shape rules come first (D2) | Migration 21's function is identical to the D2 listing | OK |
| No DEFAULT; NOT NULL; backfill `ARRAY[global_role]` (D3, D8) | Migration 21 | OK |
| Same-statement `prior` capture, `::text[]` reads, `$6::user_role[]` write (D5) | `account-resolver.ts` | OK |
| `previousRoles` null exactly when `previousGlobalRole` is null; integrity error otherwise (D5) | `account-resolver.ts` | OK |
| Firing rule with the set disjunct; `sameRoles(x, null) = false` (D7) | `shouldEmitRoleClaimMapped` | OK |
| `roles` on both rows and events, `previousRoles` on role_claim_mapped only; `actor_roles` from the same frozen array (D6) | `insertSignInAuditRow` and the post-commit events | OK |
| `actor_roles` NULL on every other operation | Only `routes/auth.ts` writes `actor_roles` in non-test source | OK |
| Separate lock windows: 5 s / 200 ms, `RESET lock_timeout`, `--no-single-transaction` (D9) | Migrations 21/22 and the `docs/deployment.md` command | OK |
| Down order: trigger, shim, constraint, column, helper; 22 before 21 | Migration down sections and the rollback notes in the docs | OK |
| No authorization reads the role set (D12) | No non-test reader of `roles`, `previousRoles` or `actor_roles` outside the three permitted files | OK |
| Column comment wording (D6) | Migration 22 `COMMENT ON COLUMN` matches D6 and the docs | OK |

`docs/deployment.md` (revocation runbook writing both columns, conflict query on `metadata->'roles'`, upgrade/locking/rollback/auditor notes, `actor_roles` NULL semantics) and the use-case 01 note on the TEAM-006 409 for admin+EM users are consistent with the code and specs.

## 3. Validation

I ran the same commands on a temporary detached worktree of `main` (now removed) and on this branch (OpenSpec 1.14.1):

| Run | `main` | Branch as synced by BA | Branch after this review |
|---|---|---|---|
| `validate --all --strict` | 42 / 43 fail | 44 / 44 fail | 42 / 44 fail |
| `validate --all` (non-strict) | 3 / 43 fail | 3 / 44 fail | 3 / 44 fail |
| `validate store-idp-role-set --strict` | n/a | **fail** | **pass** |

- **Non-strict.** The same 3 failures already occur on `main`: spec `project-structure`, and changes `team-membership-removal` and `topic-skip-and-creation-time-confirmation`. This change does not cause them.
- **Strict.** The baseline failures on `main` come mostly from the "requirement text is very long (>500 characters)" warning (248 occurrences), plus two changes with no deltas and one requirement with no scenario.
- **What the sync broke.** It introduced three new over-500-character requirements in `oidc-role-mapping`:
  - "Fixed precedence across several mapped values" (590 characters)
  - "Precedence-discard signal" (586 characters)
  - "The previous build keeps working through the upgrade window" (774 characters; this is the ADDED block, so the change itself also failed `--strict`)

  These turned `oidc-role-mapping` from passing to failing and made the change fail.

After my edits, the per-item issue lists on the branch are identical to `main` for every pre-existing item, and the new change item passes. **This change introduces no new validation failures.**

## 4. Fixes applied (wording only, applied to both delta and main where both exist)

1. **`oidc-role-mapping`: three requirement texts shortened to 500 characters or fewer.** No normative content was dropped:
   - "Fixed precedence across several mapped values" is now 487 characters. The ordering and first-element rules are restated more briefly, and audit order is kept.
   - "Precedence-discard signal" is now 491 characters. The phrasing is tighter, and the final sentence became "Discarded roles stay in `users.roles`."
   - "The previous build keeps working through the upgrade window" is now 497 characters. It now reads: "An UPDATE restating the stored `roles` counts as omitting it. Any other stated `roles` SHALL NOT be altered and stays subject to the consistency rule." This keeps the BA's correction and states it more briefly.
2. **`auth-error-handling` scenario renamed.** "Facilitator mapping discarded by precedence adds nothing to audit metadata" is now "...adds no discard flag to audit metadata". The old title contradicted its own THEN clause (`roles` now carries the outranked facilitator). No test name references the old title.
3. **`database-schema.md`: rewrote the `global_role` DEFAULT sentence.** It claimed the default "no longer lets a writer omit the role", which is not true while the shim exists: omitting both columns still yields `engineer` / `{engineer}`. It now says the default stops standing in once F1 drops the trigger.

## 5. Items for the team (not fixed here)

- **Test gap, minor.** No test covers the shim behaviour the BA's correction now specifies: an UPDATE that changes `global_role` while restating the unchanged stored `roles` is coerced to `{global_role}`. The trigger logic plainly does this, and it can only ever remove roles. Still, the spec now states it, so I recommend one assertion in the "legacy-writer shim" block of `users-roles-schema-integration.test.ts`. This is non-blocking.
- **Baseline debt on `main`, not this change.** Strict validation fails for 42 items and non-strict for 3. This needs its own ticket if the team wants `--all --strict` as a gate.
