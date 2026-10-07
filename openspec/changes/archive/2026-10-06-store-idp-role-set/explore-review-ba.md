# BA review: exploration notes for #245 (store the IdP role set)

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-10-06
**Reviewed:** `exploration-notes.md` (Devon Calloway), against issue #245 and the current code/specs
**Question asked:** Are the ideas specific enough to become requirements?

---

## Verdict

Mostly yes. These are among the more buildable exploration notes I've reviewed. The code is cited, the firing-condition analysis in §3 is correct (I checked it against `routes/auth.ts:62`), and §7 already reads like acceptance criteria. What keeps it from going straight into a proposal is a set of **undecided either/ors left inside the acceptance conditions** ("or an explicitly accepted-risk alternative", "same or the next migration", "direction specified", "`null`/absent"). A requirement that offers two options leaves the choice to whoever implements it. Below I pick one answer for each, give the reason, and list three gaps the notes missed.

---

## 1. Gaps the notes missed (clarifications needed)

| # | Gap | Evidence | What the proposal must say |
|---|---|---|---|
| G1 | **A third spec states "exactly one value".** The notes list `first-access` only as "likely". | `openspec/specs/first-access/spec.md` l.119 requirement, items 4 and 5: "`users.global_role` holds exactly one value." | `first-access` is a **definite** spec delta. Item 4 gains "every mapped role is stored in `users.roles`". Item 5's last sentence moves to `roles`/`global_role` wording that matches `oidc-role-mapping`. |
| G2 | **Test fixtures that UPDATE users, not just INSERT.** Q3 counts INSERT fixtures only. | `room-open-integration.test.ts:233` and `facilitator-demotion-mid-session-integration.test.ts:84` run `UPDATE users SET global_role = 'engineer'` alone. Under the Q2 CHECK these fail, because `roles` keeps the old value. | The fixture task lists **14 INSERT test files + `helpers/real-db.ts` + 2 UPDATE sites** by name, and says how each is fixed (preferably one helper, see Q3 below). |
| G3 | **`role_change_audit.actor_global_role` is another actor-role snapshot.** | `migrations/6_role_change_audit.sql` (TEAM-005 audit table). The notes cover only `audit_log`. | Add it to the non-goals: "`role_change_audit` does not gain an `actor_roles` column in this step." Otherwise someone will ask in review why one audit table was changed and the other was not. |

A smaller one: §2 says the next migration number is 21. That is correct (the latest is `20_sessions_room_opened_at.sql`). Keep the file name `21_users_roles.sql` in the tasks so it doesn't get renumbered by accident.

---

## 2. Open questions: proposed answers

### §8.1 / Q1: RANK order direction → **Descending (highest first)**
- **Rationale:** `roles[1] = global_role` then becomes a one-line CHECK, `global_role` is literally "the first element", and the contract step can drop `global_role` without having to redefine "highest". It also matches how support staff will read an audit row.
- **Requirement wording:** "`users.roles` SHALL list each mapped role once, ordered from highest to lowest precedence (`application_admin` first). The same order SHALL be used in audit metadata `roles`/`previousRoles` and in `audit_log.actor_roles`."
- **Acceptance:** claim `["Facilitators","Eng-Mgrs","Dipstick-Admins","Eng-Mgrs"]` → `roles = {application_admin, engineering_manager, facilitator}` exactly (order and length asserted, not set equality).

### §8.2 / Q2: Consistency enforcement → **Option B (database CHECK), all four rules**
- **Rationale:** this is the no-manager rule's foundation. A code-only guarantee (A) is a preference, not a structure. Postgres does not allow subqueries in CHECK, so sortedness and uniqueness need the IMMUTABLE helper the notes mention. That is a one-time cost and acceptable.
- **The CHECK, stated as four testable rules:**
  1. `cardinality(roles) >= 1`
  2. `roles[1] = global_role`
  3. `'engineer' = ANY(roles)` implies `roles = '{engineer}'`
  4. `roles` is strictly descending in enum order (which also gives uniqueness), via `users_roles_well_formed(user_role[])`, IMMUTABLE
- **Acceptance:** one negative DB test per rule (4 rejected inserts with SQLSTATE `23514`), plus one positive insert per resolver outcome (`missing`, `unmapped`, `mapped`).
- **Consequence the proposal must accept:** rule 4 makes `user_role` enum declaration order load-bearing. Risk 7 then stops being "if any SQL relies on it" and becomes a **mandatory** test: `GLOBAL_ROLES` order equals ascending `RANK` order equals `pg_enum.enumsortorder` order.

### §8.2 / Q3: Default and fixtures → **`NOT NULL`, no DEFAULT**
- **Rationale:** with the CHECK in place, a `DEFAULT '{engineer}'` would be safe *today*, because it can only succeed where `global_role = 'engineer'`. But contract step 2 drops `global_role` and with it rule 2. From that point the default silently turns any fixture that omits `roles` into an engineer, which is exactly the failure Q3 describes. Not adding the default now is cheaper than remembering to remove it later.
- **Fixture strategy:** add one helper to `routes/__tests__/helpers/real-db.ts`, e.g. `insertUser({ roles })`, where `global_role` is derived as `roles[0]`. Migrate the 14 INSERT files and 2 UPDATE sites to it. Tests then state the role set, never `global_role` alone.
- **Acceptance:** `grep -rn "global_role" packages/backend/src/**/__tests__` returns hits only in assertions and in the helper, not in fixture writes.

### §8.3 / Q4: Mark backfilled `previousRoles`? → **No metadata marker. Record the migration timestamp, and define the contract-step precondition as a query.**
- **Rationale:** a per-row marker would need a persistent flag on `users` to know a row is still backfilled, which is new schema for a one-time condition. Working through the precedence order shows the backfill is lossy only in a **fail-closed** direction:
  - `global_role ∈ {engineer, senior_engineer}`: the backfill is exact. Nothing ranks below senior except the fallback.
  - `facilitator`: it may miss `senior_engineer`, which no capability rule reads.
  - `engineering_manager`: it may miss `facilitator`. The facilitate rule denies EMs anyway.
  - `application_admin`: it may miss `engineering_manager` / `facilitator`. The effects are under-recognition as a manager (TEAM-006) and under-granting of facilitation. Neither grants anything extra.
- So the risk is functional (a manager isn't recognised yet), not a breach of the no-manager rule. Write that down. It is the honest reason a marker isn't needed.
- **Precondition for contract step 1 (to be written into that follow-up issue verbatim):** "Before any check reads `roles`, every `users` row with `global_role IN ('application_admin','engineering_manager')` has an `auth.role_claim_mapped` or `auth.first_access_created` audit row with a `roles` field dated after migration 21 was applied, **or** the check treats such rows as unresolved." This can be checked by a query, because non-engineer users always fire `role_claim_mapped` at sign-in (§3).
- **Spec wording for auditors:** add a scenario to `auth-error-handling`: "The first `auth.role_claim_mapped` row after migration 21 may show a `previousRoles` → `roles` difference that reflects the backfill, not an IdP change."

### §8.4 / Q6: `actor_roles` scope → **(a) Sign-in rows only. Keep the column and the metadata, and say why.**
- **Rationale:** threading `resolveActorRoles` through 52 insert sites is contract-step work and widens the diff with no decision depending on it.
- **Why both:** the post-commit `emitAuditEvent` has no columns, so the metadata carries `roles` to the event stream. The column makes `actor_roles` queryable in SQL without JSON extraction, and is ready for the contract step. The proposal should admit that, in this step, the column duplicates metadata on the only rows it populates. Its value is readiness, not new insight.
- **Required wording (column `COMMENT ON` and `database-schema.md`):** "NULL means the actor's role set was not captured for this operation. It does not mean the actor had no roles. Populated only for `auth.first_access_created` and `auth.role_claim_mapped` as of migration 21."

### §8.5 / Q8: #241 boundary → **Yes, #245 posts the comment. #245 claims no #241 acceptance criteria.**
- **Rationale:** the person with the context should write the rebase note. It's a five-minute task that prevents #241's apply from re-deriving the conflict from the claim. Deciding which #241 ACs are met belongs to #241's owner, and if #245 claims some of them, #241's scope becomes unclear.
- **Task:** "Post on #241: (1) #245 records the role set in `users.roles` and audit metadata; (2) define the EM + facilitator conflict as `roles @> '{engineering_manager,facilitator}'`; (3) the issue text's references to `mapRoleClaimToGlobalRole`, `auth/account-resolution-audit.ts` and facilitator > EM precedence are stale since #243." Done = comment URL linked in this change's tasks.md.

### §8.6 / §3: Keep the redundant set-change clause? → **Yes, with a comment and a direct unit test.**
- **Rationale:** I agree with Devon. Intent that is only implied disappears when someone refactors. Contract step 2 must rewrite the first disjunct anyway, and the explicit clause is what survives that rewrite.
- **Wording requirement:** the proposal must say that the clause adds **no new firing case today**. Don't let the change claim a behaviour fix it doesn't make.
- **Acceptance:** a unit test calls `shouldEmitRoleClaimMapped` with a hand-built `ResolvedUser` (`globalRole = previousGlobalRole = 'engineer'`, sets differ). The resolver can't produce that input, but the test pins the clause, so deleting it fails CI.

### §8.7: `docs/deployment.md` l.219 checklist → **"As well as". Audit first, logs second.**
- **Rationale:** audit retention is longer (the gap #243 D8 called out), but log search still finds conflicts from before migration 21, which audit cannot.
- **Acceptance:** the checklist gives a copy-pasteable SQL query (`metadata->'roles'` containing both `engineering_manager` and `facilitator`), states that it covers sign-ins after migration 21 only, and keeps the existing `discardedRoles` log search for earlier sign-ins.

### Q5, Q7, Q9, Q10 (settled in the notes; endorse with one tightening each)
- **Q5:** agreed. Tighten: `previousRoles` is **absent** from `auth.first_access_created` (matching how `previousRole` is absent there today) and **always present, never null** on `auth.role_claim_mapped`, because backfill guarantees a prior value. Replace AC5's "`null`/absent".
- **Q7:** agreed. Tighten: the "Precedence-discard signal" log line keeps its current `DISCARDABLE` scope (EM, facilitator). State explicitly that `senior_engineer` is **not** added to `discardedRoles`, even though `roles` now records it.
- **Q9:** agree on deferring. Make it a filed follow-up issue with its number recorded, not just a note.
- **Q10:** agreed. Requirement: "`engineer` SHALL appear in `roles` only as the sole element." This is CHECK rule 3 above, so the requirement and the constraint trace to each other.

---

## 3. Vague acceptance conditions: suggested rewrites (§7)

| AC | As written | Problem | Rewrite |
|---|---|---|---|
| 1 | "…consistency CHECK … (or an explicitly accepted-risk alternative)… `actor_roles` in the same or the next migration" | Two unresolved options | "Migration `21_users_roles.sql` adds `users.roles user_role[] NOT NULL` (no default), backfills `ARRAY[global_role]`, adds the four CHECK rules in §2 Q2, and adds `audit_log.actor_roles TEXT[] NULL` with a `COMMENT ON COLUMN`. The down migration drops both columns, the constraint and the helper function. `global_role` is untouched in either direction. Up → down → up passes in CI." |
| 2 | "RANK-ordered (direction specified)" | Direction not given | "…ordered highest precedence first. `global_role` is assigned `roles[0]` in code. No separate max computation remains in `resolveOrCreateAccount`." |
| 3 | "the existing precedence test table" | Doesn't say which table | Name the file and `describe` block in `role-map.test.ts`. "Every row asserts the same `role` as before **and** a new exact `roles` array." |
| 4 | "one statement" | OK, but untestable as written | Add: "a test asserts `previousRoles` reflects the row *before* the upsert when the claim changes between two sign-ins of the same subject." |
| 5 | "`null`/absent" | Two options | See Q5 tightening above. Also: "The transactional audit row and the post-commit event carry identical `roles`/`previousRoles` arrays (asserted in one test)." |
| 6 | Fine | — | Add the Q8.6 hand-built-input test. |
| 7 | "a grep-based task check" | No pattern, no allowlist | "`rg -n '\\broles\\b' packages/backend/src --glob '!**/__tests__/**'` hits only `auth/role-map.ts`, `auth/account-resolver.ts`, `routes/auth.ts` and the migration. Recorded in tasks.md with its output, and added to the reviewer checklist." |
| 8 | Spec deltas "as in Q7" plus `database-schema.md` | Leaves out `first-access` (G1) | Add `first-access` (l.119 items 4–5), and `database-migrations` if it lists `users` columns (check, then say yes or no). |
| 9 | "S1 and S4 re-run recorded" | No pass criteria | "`security-review.md` records, for S1: the admin+EM claim gives `roles = {application_admin, engineering_manager}`, `global_role = application_admin`, D11 E1–E4 unchanged and green. For S4: boot fails on `{"A":"toString"}` / `{"A":"__proto__"}`. Claim `["toString","__proto__","constructor"]` gives `{engineer}`. A raw `INSERT` of `'{toString}'::user_role[]` raises `22P02`. Each item cites its test name." |
| 10 | "Follow-ups filed or updated" | OK | Add: "each with an issue number recorded in tasks.md". Contract step 1's body includes the capability rules **verbatim** from #245 and the Q4 precondition query. |

---

## 4. Additions to non-goals (§9)

- `role_change_audit` gains no role-set column (G3).
- `discardedRoles` scope is unchanged. The log line is not removed.
- No backfill-origin marker in metadata or on `users` (Q4).
- `actor_roles` is not populated outside the two sign-in operations (Q6).

## 5. Traceability note

Risk 8 (admin exclusion currently shields the EM+admin case) is a real dependency between two product rules. Record it as a constraint on the contract-step follow-up: "If a future decision lets `application_admin` participate, the participate rule must still deny `engineering_manager ∈ roles`." Otherwise it lives only in these notes, and nobody reads exploration notes after archive.
