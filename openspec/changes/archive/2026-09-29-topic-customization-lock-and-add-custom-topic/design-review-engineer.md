# Design Review — Engineer (Marcus Oyelaran)

**Change:** `topic-customization-lock-and-add-custom-topic`
**Reviewing:** `design.md`, `proposal.md`, `specs/topic-customization-lock/spec.md`, `specs/add-custom-topic/spec.md`, `tasks.md`
**Checked against:** `packages/backend/src/routes/action-items.ts`, `packages/backend/src/routes/content.ts`, `packages/backend/src/auth/team-content-access-helper.ts`, `packages/backend/src/routes/facilitator-sessions.ts`, `packages/backend/src/routes/teams.ts`, `packages/backend/migrations/2_create_tables.sql`

**Verdict:** Implementable, and most of the design is genuinely good — the check-ordering cascade (Decision 9), the single-source-of-truth lock function (Decision 1), and the audit-before-response pattern (Decision 8) all match this codebase's existing idiom correctly. But **Decision 10's concurrency mitigation does not do what it claims**, and that's a correctness bug in the design, not a style nit — it needs to be fixed before task 5.4 is implemented, not discovered in a flaky test three weeks from now. I also found one response-shape decision that reinvents a wheel we already have, and a couple of places where the design's own "unstated gap" framing undersells that this codebase already answered a closely related question, just not identically.

---

## Blocking

### B1. Decision 10's `SELECT ... ORDER BY ... LIMIT 1 FOR UPDATE` does not serialize the `displayOrder` race it's built to close

This is the one to fix before writing code, not after a flaky concurrency test surfaces it.

**The claim in design.md:** a second concurrent request against the same team "blocks on that row lock until the first transaction commits... then reads the newly committed maximum," so two concurrent requests "can therefore never compute the same `displayOrder`."

**Why that's not how Postgres row locking works here.** `FOR UPDATE`'s wait-then-recheck behavior operates on the *specific row(s) already selected* by the query's initial scan. When transaction B blocks on a row that transaction A holds locked, and A then commits, B's query unblocks and re-checks *that same row* against the `WHERE` clause — it does not re-run the `ORDER BY ... LIMIT 1` ranking against the table's newly-committed state. A's transaction here doesn't `UPDATE` the row B is waiting on; it `INSERT`s a brand-new row. That new row didn't exist in B's original scan and was never a candidate B locked — so there is nothing for B's unblock-and-recheck to notice. Concretely, for two concurrent requests against a team with active topics at `display_order` 1–12:

1. A and B both run the query; both identify row 12 (`display_order = 12`) as "the max" and both attempt to lock it.
2. A gets the lock first, computes `next = 13`, inserts row 13, commits. Row 12 itself is never modified.
3. B was blocked on row 12's lock, not on row 13 (which didn't exist yet). B unblocks, re-checks row 12 — it's unchanged, still `display_order = 12`. B computes `next = 13` too.
4. B inserts `display_order = 13` for the same team and collides with A's already-committed row on `topics_team_order` (`UNIQUE (team_id, display_order, status)`), surfacing as an unhandled `23505` — the exact `500` Decision 10 was written to prevent.

The row lock *does* correctly force B to wait for A — that part of the mechanism works. What it doesn't do is give B a fresh read of the value it needs after waiting, because the value it needs (the new max) lives in a row that didn't exist when B's snapshot was taken.

This isn't a hypothetical edge case dependent on unusual timing — it's the exact concurrent-request scenario in the spec's own "Concurrent Add Custom Topic requests" scenario and task 5.7's concurrency test. As written, that test would very likely fail (or worse, pass under low contention and fail intermittently under CI load — the worst kind of test to ship).

**What actually closes this race**, in order of fit with this codebase:

1. **Catch-and-retry on the unique violation** — the alternative Decision 10 explicitly rejects. But this is *already this codebase's established idiom for precisely this class of problem*: `facilitator-sessions.ts`'s `POST /api/v1/teams` catches a `23505` on `teams_name_unique`/`teams_name_unique_normalized` via a scoped `TeamNameCollisionSignal` marker (lines 587–603), and `POST /api/v1/teams/:teamId/sessions/draft` catches `23505` on `sessions_team_active_unique` by `err.code`/`err.constraint` (lines 396–421) and turns it into a clean `409`. Decision 10 rejects this approach as requiring "the handler to distinguish this specific constraint violation from any other insert failure" — but that's exactly what both of those existing handlers already do, using the same `DatabaseError`/`err.constraint` check. This isn't new complexity being introduced; it's reusing a pattern this file's own neighbors already ship. A single retry (re-run the `MAX` read + insert once, inside a fresh statement) closes the race correctly, because the retried `SELECT MAX(display_order)` runs *after* the collision, under READ COMMITTED's fresh-per-statement snapshot, and will correctly see the sibling's now-committed row.
2. **A `pg_advisory_xact_lock(hashtext(team_id))` taken before the `MAX` read** — correct for a different reason than `FOR UPDATE` on a row: an advisory lock isn't tied to any specific row's pre-existing snapshot. The *second* transaction's `MAX` query is not merely unblocked-and-rechecked, it is not *issued* until after the lock is granted, so it runs as a new statement against the now-current committed state (including the sibling's new row) under READ COMMITTED's per-statement snapshot rules. No error-code sniffing required, and it composes cleanly with the existing `db.connect()` / `BEGIN` / `COMMIT` transaction shape used throughout this codebase.
3. Genuinely not viable here: `SELECT FOR UPDATE` on the full candidate set (`WHERE team_id = $1 AND status = 'active'`, no `LIMIT`) has the identical flaw — the candidate row set is still fixed at the original snapshot and never grows to include a row inserted afterward, for the same MVCC reason. This codebase's one other `FOR UPDATE`-for-serialization precedent, `teams.ts:898` (`SELECT id FROM team_memberships WHERE team_id = $1 ... FOR UPDATE`, the EM-promotion zero-participant race), is protecting against a concurrent `UPDATE` to *existing* rows, not a concurrent `INSERT` of a *new* row — it's solving a different problem than Decision 10's, and citing it as a parallel (which design.md doesn't do explicitly, but the technique clearly borrows from it) would be a mismatch.

**Recommendation:** replace Decision 10's mitigation with option 1 (retry-on-`23505`, matching the two existing precedents byte-for-byte in spirit) or option 2 (advisory lock). Either is a small, self-contained change to task 5.4; I'd lean toward the advisory lock since it avoids the "transaction has already failed, start over" control flow entirely and reads as a one-line addition (`SELECT pg_advisory_xact_lock(hashtext($1))`, first statement in the transaction) rather than a retry loop — but either is correct, and the current design's approach is not.

---

## Major

### M1. Decision 4's rejection body reinvents a shape this codebase already has, and doesn't reconcile with it

Decision 4 specifies "a body with a `code` field... and a `message` string" for every rejected write, distinct from — as far as design.md discusses it — the existing conventions. But this codebase already has an established answer to exactly this need: `teams.ts`'s `PATCH` role-change handler returns, for its own `409` precondition failure,

```ts
return reply.code(409).send({
  error: {
    category: "precondition_failed" as const,
    code: "GLOBAL_ROLE_PRECONDITION_NOT_MET",
    message: "...",
    correlationId: crypto.randomUUID(),
  },
});
```

— i.e., `code` nests *inside* the standard `error` envelope, alongside `category` and `correlationId`, not as a bare top-level `{ code, message }` object. The same rate-limiter code path (`teams.ts` ~L253–278) returns `code: "TEAM006_BURST_LIMIT_EXCEEDED"` etc. the same way. This is the third response shape in the codebase (after the plain `error.category/message/correlationId` used by `action-items.ts`/`content.ts`, and the flat `errorState`-discriminated bodies used for `SessionAlreadyExistsResponse`/`TeamAlreadyExistsResponse`/`RevealFailureResponse`/etc.) — and it's the one that already solves "409 needs a machine-readable reason code the frontend can switch on," which is precisely Decision 4's stated problem.

Design.md doesn't cite this precedent or explain why `TOPIC-003`'s rejection body should be a fourth, differently-shaped thing (`{ code, message }` with no `category` and no `correlationId`) instead of reusing the one that already exists for the identical need. If the omission of `category`/`correlationId` is deliberate, that should be stated as a correction with a reason, the same way Decisions 2 and 3 are — right now it reads as though the author didn't know the precedent existed, which is a fair thing to flag before a frontend (#55) or a shared-types definition gets written against whichever shape ships. My recommendation: nest under `error.code` / `error.message`, keep `category` (`"forbidden"` for the two 403s, `"precondition_failed"` for the 409, matching the `precondition_failed` category `action-items.ts` already uses for its own 409 terminal-state guard) and `correlationId`, consistent with every other rejection in this codebase. This also means `TOPIC_CUSTOMIZATION_LOCKED`'s stable message string lives at `error.message`, and `isCustomizationLocked`'s read-side value is a plain top-level boolean on the 200 body — the two are not the same field shape and shouldn't be designed as if they were.

### M2. Decision 9's "identity/role before team-existence" ordering doesn't engage with the one existing endpoint that already answered this question for the same authorization model — and should also inherit its concrete SQL, not just its philosophy

Decision 9 frames the 403-then-404-then-409-then-422 ordering as resolving "two gaps neither the REST API Contract nor this design previously stated explicitly," and reasons from first principles (the enumeration-oracle argument) to get there. But `facilitator-sessions.ts`'s `POST /api/v1/teams/:teamId/sessions/draft` — the only other endpoint in this codebase using the *same* standing-facilitator-not-a-member authorization model (Decision 3's Philosophy 1) — already ships a check order for this exact combination: role (`403`) → **team existence (`404`)** → membership-conflict (`403`), i.e., team existence sits *between* the two 403 checks, not after both.

I traced through whether this is an actual behavioral conflict with Decision 9's proposed order (role-403 + membership-403 both before existence-404), and it isn't, for a structural reason worth stating on the record rather than leaving implicit: `team_memberships.team_id` has a `NOT NULL REFERENCES teams(id)` foreign key, so a membership row can only exist for a team that exists. A nonexistent `teamId` therefore *always* evaluates "not a member" vacuously true in both orderings — there is no real caller for whom the two orderings produce different status codes. So Decision 9's ordering is not wrong, and task 3.1's "SHALL NOT require the target team to exist" is correct. But the design should say this explicitly and cite the existing endpoint, rather than presenting the ordering question as though this codebase had never faced it — because the next engineer who reads both files side-by-side will notice the discrepancy and have to re-derive the same FK argument I just did to convince themselves it's not a bug. One sentence in Decision 9 ("this reorders `facilitator-sessions.ts`'s `POST /draft` precedent, but the FK on `team_memberships.team_id` makes the two orderings behaviorally identical for every real caller") would close this.

Separately, and more actionably: `POST /draft`'s authorization query is *exactly* Decision 3's Philosophy 1 check, in one round trip:

```sql
SELECT u.global_role, (tm.id IS NOT NULL) AS is_member
FROM users u
LEFT JOIN team_memberships tm
      ON tm.user_id = u.id AND tm.team_id = $2 AND tm.removed_at IS NULL
WHERE u.id = $1
```

Task 3.1 should reuse this shape verbatim (it's already correct, already tested, and already handles the "vacuously not a member" case for a nonexistent team) rather than have `topics.ts` re-derive its own version — that would be the third independent implementation of this exact query (after `teams.ts`'s EM-dual-check variant and this one), which is the identical kind of drift risk Decision 1 explicitly worries about for the lock check. Worth factoring into a small shared helper (e.g. `evaluateStandingFacilitatorAccess(userId, teamId)`) that both `POST /draft` and the new `POST /teams/:teamId/topics` call, rather than writing it a second time. Not blocking, but cheap to do now and expensive to reconcile later if the two copies drift (e.g. one adds a `deactivated_at` filter and the other doesn't — see M3).

### M3. Neither the design nor `tasks.md` says what happens when `:teamId` refers to a deactivated team

`teams` has a `deactivated_at timestamptz NULL` column. Task 3.2's proposed existence check is presumably `SELECT id FROM teams WHERE id = $1` (matching `POST /draft`'s own existence check, which also doesn't filter on `deactivated_at`) — so a deactivated team is currently treated as "exists" by every write-adjacent existence check in this codebase except `GET /api/v1/teams/facilitatable` (`facilitator-sessions.ts:2238`, which does filter `deactivated_at IS NULL`). That means, as designed, a facilitator could add a custom topic to a deactivated team and get a `201`, not a `404`. That may well be the right answer (deactivation and topic-customization are arguably orthogonal), but it isn't a decision this design makes — it's a silent inheritance of whatever the copy-pasted existence-check happens to do. Given this design already goes out of its way to nail down check ordering to the level of "which caller learns which fact first," a soft-deleted team sliding through as a normal write target deserves at least a sentence of explicit intent, one way or the other.

---

## Minor

### m1. `content.ts`'s existing `GET /teams/:teamId/topics` response is unmapped snake_case; the new field will be the only camelCase key in it

The current handler (`content.ts:475–492`) returns `result.rows` straight from the query — `vote_type`, `display_order`, etc., untouched snake_case — unlike every other endpoint reviewed here (`action-items.ts`, `POST /teams`, `POST /draft`), which all map to camelCase response DTOs by hand. Decision 1/task 2.1 adds `isCustomizationLocked` (necessarily camelCase, per the spec's own scenarios) into that same response body. The result ships with one camelCase field sitting next to a list of snake_case ones in the same JSON object — which is a pre-existing inconsistency this change didn't create, but is about to make one line worse rather than fixing, since task 2.1 touches this exact handler anyway. Worth either fixing the whole response's casing while the handler is already open (small, contained, arguably in scope since "no schema migration" doesn't mean "no response-shape cleanup"), or explicitly noting in the design that it's deliberately left alone to keep the diff focused — right now it's neither.

### m2. Route-file boundary (Decision 5) is the right call, with one thing to watch

Splitting `topics.ts` (write) from `content.ts` (read) is reasonable given the genuinely different auth models, and matches the `action-items.ts` precedent's spirit even though it's not a full "one file per resource" move. One thing worth being deliberate about during implementation: the shared lock-check helper (Decision 1) will now be imported by both `content.ts` and `topics.ts`. Make sure it lives somewhere neither file has to reach *into* the other to get it (e.g., alongside `team-content-access-helper.ts` under `auth/`, or a new `content/topic-lock-helper.ts` — either is fine, just not inside `content.ts` itself, which would make `topics.ts` import from a file whose name and file-header comment both describe it as read-only).

### m3. Validation-error "field(s)" plural wording is slightly loose against existing precedent, but not a real gap

`specs/add-custom-topic/spec.md`'s validation requirement says the `422` response "SHALL identify which field(s) failed validation" (plural). Every existing `422` in this codebase (`action-items.ts`'s `resolutionNote` length check, `sessionId` state check, etc.) identifies exactly one field per response, because validation runs as an ordered sequence of checks that returns on the first failure — there's no existing precedent for a response that lists multiple simultaneously-failing fields in one body. I'd assume task 5.3 intends the same first-failure-wins sequence (`name` → `prompt` → `voteType` → `firstSessionDescription`, matching the field order in the requirement's own prose), which is fully consistent with every scenario actually written in the spec (each scenario tests exactly one bad field at a time) — the plural wording in the requirement's summary sentence just overstates what the scenarios actually require. Worth a one-word fix (or an explicit note that it's sequential, not simultaneous) so nobody reads "field(s)" as a mandate to build a multi-error-aggregation response shape this codebase has never needed before.

---

## What's solid and shouldn't change

- **Decision 1** (single lock-check function, live read, no cache) is correctly scoped and matches the `team-content-access-helper.ts` no-cache precedent exactly. Trivial to implement as written.
- **Decision 2** (409 for lock, 403 reserved for identity/role) is the right split and matches `action-items.ts`'s own 409-for-terminal-state-not-403 precedent (the resolved-item guard) almost exactly. Good citation in the design.
- **Decision 6** (no row lock on the *read-side* lock check) is correct reasoning — that race really is false-negative-only, unlike Decision 10's, and the design is right to distinguish the two rather than reuse one justification for both.
- **Decision 8** (synchronous audit-before-response on denial) matches `content.ts`'s `denyAdminContentAccess` (audit write via plain `db.query`, no transaction needed since it's a single row with no accompanying state mutation) and `facilitator-sessions.ts`'s `session.draft_denied_membership_conflict` precedent cleanly. Implementable as designed, no notes.
- **Decision 3's authorization model itself** (standing, org-wide facilitator, Philosophy 1) is not just implementable, it's *already implemented* for the identical case in `POST /draft` — see M2 above for why that's an opportunity, not a problem.

---

## Summary for tasks.md

- **Before task 5.4 is written:** resolve B1. Either add a `23505`/`topics_team_order` catch-and-retry (mirroring the `TeamNameCollisionSignal` / `sessions_team_active_unique` precedents) or a `pg_advisory_xact_lock(hashtext(teamId))` ahead of the `MAX` read. The `FOR UPDATE`-on-`ORDER BY ... LIMIT 1` approach as literally specified will not close the race under concurrent inserts, and task 5.7's own concurrency test is likely to expose this once written.
- **Before task 3.4 is written:** resolve M1 — confirm whether the rejection body nests `code` under `error` (matching `teams.ts`'s existing precedent) or is genuinely a new top-level shape, and state which on the record either way.
- **Worth a sentence in design.md, not blocking:** M2 (cite `POST /draft`'s existing ordering and FK reasoning explicitly; consider extracting the shared standing-facilitator-auth query), M3 (state intent for deactivated teams).
- **Cheap cleanups, take or leave:** m1–m3.
