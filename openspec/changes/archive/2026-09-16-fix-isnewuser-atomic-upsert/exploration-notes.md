# Exploration Notes — Resolve the isNewUser SELECT-before-upsert Race (Issue #8)

**Explored by:** Devon Calloway (Internal Champion / SME), acting as founding-advisor consult on an architecture constraint.
**Status:** Exploration only. No code changed. No proposal written yet.

---

## 1. What's actually being fixed, and why now

`resolveOrCreateAccount` (`packages/backend/src/auth/account-resolver.ts:88-176`) does:

1. `SELECT ... WHERE oidc_subject = $1 AND oidc_issuer = $2` → `isNewUser = existing.rows.length === 0`
2. `INSERT ... ON CONFLICT (oidc_subject, oidc_issuer) DO UPDATE ... RETURNING ...`

Two callbacks racing for the same brand-new identity can both see zero rows at step 1 and both set `isNewUser = true`, even though the upsert at step 2 correctly creates exactly one row. Data integrity is never at risk — only the flag. This is fully documented in the block comment at lines 104-122, in `openspec/specs/first-access/spec.md:201`, and in two archived review docs (`openspec/changes/archive/2026-07-05-first-access/implementation-review-security.md` Follow-on 3, `openspec/changes/archive/2026-07-05-first-access/implementation-review-architect.md` Constraint Verification).

The current consumers of `isNewUser` are both audit-log fields, not UI or non-idempotent side effects: `auth.first_access_created` (`packages/backend/src/routes/auth.ts:161-168`, fires only when `isNewUser` is true) and `auth.success`'s `isFirstAccess` field (`packages/backend/src/routes/auth.ts:220-225`, fires on every authentication, carries the flag value). Both tolerate duplicate/incorrect-but-safe values today, and neither is changed by this fix.

The issue itself was written as a **guardrail**, not a defect ticket: "before any feature that consumes `isNewUser` and triggers a non-idempotent side effect is merged, [fix it or make the consumer idempotent]." The maintainer's framing for this exploration is to stop treating it as a guardrail and just close the gap now.

**Why that's the right call, from where I sit.** A guardrail that lives entirely in a code comment and two review documents is a guardrail that depends on every future engineer, and every future PR reviewer, remembering to go read them before shipping a welcome email or a trial credit. That's not a structural constraint, it's institutional memory — the exact failure mode I've spent years trying to get this org away from. The fix is small and the pattern is already proven elsewhere in this codebase (see §3). There's no reason to keep asking people to carry this in their heads when one query shape change makes the whole class of bug unrepresentable. Collapsing it now, while it's cheap and low-stakes, is exactly the kind of thing that should happen before it becomes load-bearing for a feature nobody's designed yet.

## 2. Scope discipline — what this change is NOT

This is a one-file mechanism swap plus its test file. It is not:
- A redesign of `resolveOrCreateAccount` (role-claim mapping, displayName fallback, email-update-without-identity-match semantics at lines 133-140 are all correct and untouched).
- A new `isNewUser` consumer (welcome email, trial credit, etc.) — the issue lists those only as *examples of what this fix unblocks*, not work to do here. This also means the two existing consumers named in §1 are off-limits for "while I'm in here" tidying: this change must not add, modify, or extend the semantics of either `auth.first_access_created` or `auth.success`'s `isFirstAccess` field, and must not introduce a third consumer.
- A migration. The `users` table already has `CONSTRAINT users_oidc_unique UNIQUE (oidc_subject, oidc_issuer)` (`packages/backend/migrations/2_create_tables.sql:13`), which is exactly the ON CONFLICT target already in use. Nothing to add.

If a proposal for this drifts toward "and let's also add the welcome email while we're in here," that's scope creep on a constraint-closure ticket and should be pushed back into its own change.

## 3. The fix already exists in this codebase — copy it, don't reinvent it

`packages/backend/src/routes/teams.ts` (TEAM-006, `establish-manager-team-relationship`) already solved this exact class of problem for `team_memberships`, reviewed and shipped:

```sql
INSERT INTO team_memberships (user_id, team_id, role)
VALUES ($1, $2, 'engineering_manager')
ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL
DO UPDATE SET role = 'engineering_manager'
RETURNING id, (xmax = 0) AS is_new_row
```

with `db.query<{ id: string; is_new_row: boolean }>(...)` and a code comment explaining the idiom and naming the race it avoids (`teams.ts:746-766`). Its test suite (`teams.test.ts:850-905`) mocks the upsert's returned row directly with `is_new_row: true/false` — it does not attempt to simulate two racing SELECT calls, because a mocked unit test can't actually race the JS event loop anyway; the meaningful assertion is "the function correctly derives its output flag from the row the DB handed back."

**account-resolver.ts should follow this pattern almost verbatim:**

```sql
INSERT INTO users (oidc_subject, oidc_issuer, display_name, email, global_role)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (oidc_subject, oidc_issuer)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  email = EXCLUDED.email,
  global_role = EXCLUDED.global_role,
  updated_at = NOW()
RETURNING id, oidc_subject, oidc_issuer, display_name, email, global_role, (xmax = 0) AS is_new_user
```

— delete the separate SELECT (lines 123-129) entirely, and source `isNewUser` from `row.is_new_user` instead of the pre-computed boolean.

One difference worth calling out explicitly so nobody copies more than they should: **TEAM-006 wraps its upsert in `client.connect()` / `BEGIN` / `COMMIT`, but that's there because it also writes a paired `audit_log` row in the same transaction** (Decision 9, atomicity between the membership write and the audit write). `resolveOrCreateAccount` has no second write to keep atomic with — `auth.first_access_created` is emitted by the caller (`auth.ts`) as a structured log, not a DB insert. The xmax idiom itself needs no transaction; it's inherent to a single statement's `RETURNING` evaluation. Importing the BEGIN/COMMIT machinery here would be unnecessary ceremony that doesn't match why it exists in `teams.ts`. Keep this a plain `db.query(...)` call.

## 4. Things a rushed implementation could get wrong

- **Return-shape ripple.** The `row` destructuring at lines 158-165 and the `ResolvedUser` construction at 167-175 both need the new field threaded through. Small, but it's the one place a copy-paste of just the SQL (without updating the TS mapping) would silently leave `isNewUser` wired to nothing or to a stale local.
- **Every existing test in `account-resolver.test.ts` mocks two sequential `db.query` calls** (`mockResolvedValueOnce` for the SELECT, then again for the upsert) — this pattern appears in essentially all ~13 test cases in the file, not just the concurrency one. Collapsing to one query means every one of those mocks and every `mockQuery.mock.calls[1]` index reference shifts to `calls[0]`. This is mechanical, but it's not a one-line diff — it's a full pass over the test file, and it's easy to leave one test half-migrated.
- **The concurrency test needs to be rewritten, not just adjusted.** `account-resolver.test.ts:180-209` ("handles simulated concurrent first access") currently asserts `mockQuery` is called **4 times** (2 SELECTs + 2 upserts) and that **both** calls return `isNewUser: true` — it documents and locks in the *old* racy behavior as expected. Post-fix, this test should mock two single-query calls where only the first returns `is_new_user: true` and the second returns `is_new_user: false` (simulating that the real DB only performed one genuine insert), and assert `mockQuery` is called twice, not four times. Leaving this test as-is would make it fail for the right reason (good) — but if someone "fixes" it by just relaxing the call count without changing what it proves, the test stops meaningfully covering the constraint the issue exists to protect. The replacement test's job is to prove `isNewUser` is now derived per-call from the DB's answer, not that two calls can't both be told "you're new."
- **`makeUserRow()` test helper** (`account-resolver.test.ts:22-39`) will need an `is_new_user` field added so every test that builds a row can control it explicitly, rather than relying on the old implicit SELECT-based path.
- **Caller impact is (correctly) zero.** `ResolvedUser`'s public shape doesn't change, so `packages/backend/src/routes/auth.ts` needs no changes. Worth confirming that stays true in the actual diff — if it doesn't, scope has crept.
- **`xmax = 0` idiom itself is sound here, no pooler caveat in practice.** This app connects via a plain `pg.Pool` straight to Postgres (`packages/backend/src/db.ts`) — no PgBouncer or statement-level pooler in the stack (grepped; none referenced anywhere in the repo). `xmax` is evaluated server-side within the single `RETURNING` statement, so it isn't a session-affinity trick like `lastval()`/`currval()` that a transaction-mode pooler could break — it'd still be safe even if pooling were introduced later. Still, per the precedent in `teams.ts:757-760`, keep a short comment noting this is a PostgreSQL-internal idiom (not SQL-standard), consistent with how the reviewed TEAM-006 code documents it.
- **Comment cleanup.** The "HARD CONSTRAINT" block at lines 104-122 describes a problem that will no longer exist — it needs to be replaced with something short describing the mechanism actually used (mirroring `teams.ts:746-766`'s style), not left in place as a stale warning about a race that's been closed. Leaving it as dead prose is the kind of thing that erodes trust in comments generally.
- **Update `openspec/specs/first-access/spec.md` in two places, not one.** The race is documented twice, and both need to change together or the spec will contradict itself: the "isNewUser SELECT-before-upsert race (hard constraint on future work)" entry under Known Limitations (line 201) and the separate `#8 — [Architecture] isNewUser SELECT-before-upsert race` line under Open Issues (line 215-221). Acceptance condition: the Known Limitations entry is replaced with a short closed-status note naming this change; the Open Issues line for #8 is removed or moved to a Resolved/Closed list (check first whether this doc has an existing pattern for closed issues, since #8 may be the first). A proposal that only touches line 201 leaves a stale "still open" line 20 lines below it.
- **Close the loop on Issue #8 itself when this ships, with the mechanism stated.** It exists specifically to keep this visible until resolved; leaving it open after the fix lands would recreate the exact "guardrail nobody remembers to check" problem this fix is meant to eliminate. Acceptance condition: the PR description or commit message uses a closing keyword (`Closes #8`) so the close is automatic, or — if this team doesn't use that convention — the task list carries an explicit manual "close #8 post-merge" step with a named owner. Either is fine; leaving it unstated is not, since an unenforced manual step is exactly what this change exists to stop relying on.

## 5. Net assessment

Low blast radius, no schema change, no new dependency, no behavior change for any existing caller — and the technique isn't novel to this codebase, it's a direct copy of an already-reviewed pattern (TEAM-006) applied to a second table. The only place real care is warranted is the test file, because nearly every test in it is coupled to the two-query shape, and the one test that specifically exists to document the race needs to be re-purposed to prove the race is gone rather than deleted or loosened. I'd treat "does the concurrency test actually prove something post-fix" as the one thing worth a second pair of eyes in review, and "did the block comment and the first-access spec get updated" as the two things that quietly slip through if reviewers only check the SQL.

For a guardrail-closure change specifically — where the whole point is to stop relying on someone remembering to check — the proposal's task list should state these as explicit, checkable gates rather than prose warnings a reviewer has to re-derive:

- [ ] Concurrency test rewritten to mock two single-query calls (one `is_new_user: true`, one `is_new_user: false`) and asserts `mockQuery` is called exactly 2 times, not 4
- [ ] The rewritten concurrency test's assertion proves `isNewUser` is *derived from the DB response*, not merely a reduced call count — a test that mocks both calls returning `is_new_user: true` and asserts both `isNewUser: true` would pass mechanically but prove nothing, and should fail review
- [ ] All ~13 existing test cases in `account-resolver.test.ts` updated for the single-query mock shape; no `mockQuery.mock.calls[1]` index references remain
- [ ] `makeUserRow()` helper (lines 22-39) extended with an `is_new_user` field
- [ ] Stale "HARD CONSTRAINT" comment block (lines 104-122) replaced, mirroring `teams.ts:746-766`'s style
- [ ] `openspec/specs/first-access/spec.md` updated at both the Known Limitations entry (line 201) and the Open Issues entry (line 215-221)
- [ ] `packages/backend/src/routes/auth.ts` diff is empty — confirms no caller-side scope creep, and that neither `auth.first_access_created` nor `auth.success`'s `isFirstAccess` field was touched
- [ ] Issue #8 closed, with the closing mechanism specified (closing keyword in PR/commit, or a named-owner manual step)
