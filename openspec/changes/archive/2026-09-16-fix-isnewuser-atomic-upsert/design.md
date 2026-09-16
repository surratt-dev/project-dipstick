## Context

`resolveOrCreateAccount` (`packages/backend/src/auth/account-resolver.ts:88-176`) currently runs a SELECT on `(oidc_subject, oidc_issuer)` to compute `isNewUser`, then a separate `INSERT ... ON CONFLICT DO UPDATE` to write the account. Two callbacks racing for the same brand-new identity can both read zero rows at the SELECT and both set `isNewUser = true`, even though the upsert correctly creates exactly one row. This was documented as a hard constraint on future work (`openspec/specs/first-access/spec.md`, Known Limitations and Open Issues #8) rather than fixed at the time, because neither existing consumer of the flag (`auth.first_access_created`, `auth.success`'s `isFirstAccess`) is harmed by a duplicate `true`.

This codebase already carries a reviewed, shipped solution to the identical problem: `packages/backend/src/routes/teams.ts:746-766` (TEAM-006) derives its own "was this row just created" flag from `(xmax = 0) AS is_new_row` on the upsert's `RETURNING` clause, eliminating the SELECT entirely. This design applies that same idiom to `account-resolver.ts`.

## Goals / Non-Goals

**Goals:**
- Make the `isNewUser` race structurally impossible by deriving it from the same statement that performs the write, not a prior read.
- Reuse the exact idiom already reviewed and shipped in `teams.ts`, rather than introduce a second pattern for the same class of problem.
- Leave `ResolvedUser`'s public shape, both existing `isNewUser` consumers, and all non-`isNewUser` behavior of `resolveOrCreateAccount` unchanged.

**Non-Goals:**
- No schema change. `users_oidc_unique (oidc_subject, oidc_issuer)` already exists and is already the `ON CONFLICT` target.
- No transaction wrapping. TEAM-006 wraps its upsert in `BEGIN`/`COMMIT` because it also writes a paired `audit_log` row atomically with the membership write (Decision 9, `establish-manager-team-relationship`). `resolveOrCreateAccount` has no second write to keep atomic — `auth.first_access_created` is emitted by the caller as a structured log entry, not a DB write. `xmax` is evaluated server-side within a single statement's `RETURNING` clause, so it needs no transaction here.
- No new `isNewUser` consumer, and no change to `packages/backend/src/routes/auth.ts`. This change closes a derivation bug; it does not unblock or build the features the original guardrail was protecting against.

## Decisions

### Decision 1: Single upsert with `(xmax = 0) AS is_new_user`, replacing the pre-upsert SELECT

Replace:
```sql
SELECT id, oidc_subject, oidc_issuer, display_name, email FROM users
WHERE oidc_subject = $1 AND oidc_issuer = $2
```
(consumed only to compute `isNewUser = existing.rows.length === 0`) with a single statement:
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
`isNewUser` in the returned `ResolvedUser` is sourced from `row.is_new_user` instead of the pre-computed local boolean. `xmax = 0` is a PostgreSQL-internal idiom (not SQL-standard) that is true for a row this statement just inserted and false for a row this statement updated via `DO UPDATE`; it is evaluated per-statement, so it is inherently race-free without any additional locking or transaction. This app connects via a plain `pg.Pool` (`packages/backend/src/db.ts`) with no PgBouncer or other statement-level pooler in front of it, so there is no session-affinity caveat comparable to `lastval()`/`currval()` — and the idiom would remain safe even if pooling were introduced later, since it doesn't depend on session state.

**Alternative considered — keep the SELECT, add advisory locking:** Rejected. It solves the race but adds latency and a second failure mode (lock contention/timeout) to a path that runs on every authentication, for a problem the upsert-returning approach eliminates for free.

**Alternative considered — leave as documented guardrail, defer until a real consumer needs it:** Rejected per the proposal's Why — the fix is cheap, the pattern is proven in this codebase, and deferring it means every future engineer touching this file must first go read a comment and two archived review docs to know the constraint exists.

**Note on audit-event behavior under the race (security review, Tomás F.):** This change is not fully behavior-preserving in the one scenario it targets. Today, two callbacks racing for the same brand-new identity both read zero rows and both get `isNewUser = true`, so both emit `auth.first_access_created` and both set `isFirstAccess: true`. After this fix, exactly one callback's upsert has `xmax = 0` and the other's does not, so exactly one emits `auth.first_access_created`. This is a real, narrow change to the audit trail's content in the race case specifically — a desirable correction (one event per account instead of a duplicate), not a regression — and is called out here rather than folded into a blanket "no observable behavior changes" claim. See also the Risks section and the corresponding proposal.md wording.

### Decision 2: The concurrency test proves derivation, not just call count

The existing "handles simulated concurrent first access" test (`account-resolver.test.ts:180-209`) currently asserts `mockQuery` is called 4 times and that **both** simulated calls return `isNewUser: true` — it documents and locks in the old racy behavior as expected. Post-fix it is rewritten to mock two independent single-query upsert calls, one returning `is_new_user: true` and the other `is_new_user: false` (simulating what the real DB does when two callbacks race for one new identity: exactly one INSERT succeeds), and to assert `mockQuery` is called exactly twice. The test's assertion must show `isNewUser` tracking the mocked `is_new_user` value per call — a rewrite that mocks both calls returning `is_new_user: true` and asserts both `isNewUser: true` would pass mechanically without proving the derivation is correct, and must not be accepted.

### Decision 3: Most other tests migrate mechanically; one requires a content rewrite

Every other test in the file mocks two sequential `db.query` calls (`mockResolvedValueOnce` for the SELECT, then again for the upsert) and references `mockQuery.mock.calls[1]` for upsert parameters. These collapse to one mocked call at `calls[0]`. `makeUserRow()` gains an `is_new_user` field (defaulted to match whichever scenario the test is asserting) so tests can control it explicitly instead of relying on the removed SELECT-based path. This is mechanical but touches nearly every test in the file — reviewed as a full pass, not a diff of the two special-cased tests (concurrency, and the ones already covering `isNewUser`).

A third test is not mechanical and must not be treated as an index bump: `"creates separate accounts for two identities with the same email but different sub values (AC-2)"` (`account-resolver.test.ts:122-154`) calls `resolveOrCreateAccount` twice within one `it()` block, each currently queuing two mock responses (SELECT then upsert), and asserts on `mockQuery.mock.calls[0]` and `mockQuery.mock.calls[2]` with 2-element SELECT params (`[sub, iss]`). Post-fix, each invocation produces exactly one mocked call, so the two assertions move to `calls[0]` and `calls[1]` — not `calls[2]` — and their content must be rewritten from 2-element SELECT params to the relevant slice of the 5-element upsert params (`sub, iss, displayName, email, globalRole`), e.g. `expect(upsertCallA[1].slice(0, 2)).toEqual([...])`. A grep for `calls[1]` alone would not catch this test, since the line that needs to change is `calls[2]`, and even a correct index bump would leave an assertion checking the wrong shape of data. This is called out as an explicit third special case, alongside the concurrency-test carve-out in Decision 2, because "mechanical migration" undersells the two-invocation pattern in a way that risks a silently wrong or confusingly failing test (design review, Marcus O.).

## Risks / Trade-offs

- **[Risk] A partial migration of the test file leaves some tests asserting against the old two-call shape, passing accidentally or failing confusingly.** → Mitigation: task list requires an explicit full-file pass, widened beyond a `calls[1]`-only grep to catch any test still queuing more than one `mockResolvedValueOnce` per `resolveOrCreateAccount` invocation (see Decision 3's third special case), since an index-only grep misses the two-invocation test whose changed index is `calls[2]`.
- **[Risk] The rewritten concurrency test could be "fixed" by relaxing the call-count assertion without changing what it proves, silently losing coverage of the guarantee the issue exists to protect.** → Mitigation: Decision 2 states the required assertion shape explicitly; review must check the test derives `isNewUser` per-call from mocked DB output, not merely that fewer calls occur.
- **[Risk] Comment or spec drift — the stale "HARD CONSTRAINT" block or the first-access spec's Known Limitations/Open Issues entries get missed.** → Mitigation: both are explicit, checkable tasks (see tasks.md), not left to reviewer memory — which is the same failure mode this change exists to close.
- **[Risk] Overclaiming "no observable behavior change" obscures the one behavior this change intentionally alters.** → Mitigation: proposal.md and the spec delta scope the claim to consumer interfaces and audit event schema, not audit event *frequency* in the race case — the duplicate-firing behavior is eliminated by design, not preserved (see note under Decision 1).

## Migration Plan

No data migration and no schema change. This is a single-PR code change: swap the query, update the TS mapping, update tests, update the comment, update the spec, close issue #8. Standard deploy; no phased rollout, feature flag, or rollback procedure beyond a normal revert (the change is behaviorally inert for every existing consumer — a revert only reintroduces the known, already-tolerated race).

## Open Questions

None. The pattern, scope, and acceptance gates are fully resolved in the proposal and exploration notes.
