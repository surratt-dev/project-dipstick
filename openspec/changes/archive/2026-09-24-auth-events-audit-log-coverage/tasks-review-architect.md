# Architecture Review: Task Ordering — `auth-events-audit-log-coverage`

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope of this review:** task sequencing only — does `tasks.md`'s ordering respect the dependencies `design.md` itself establishes, and does any task assume a symbol, mock, or code state that a later task is the one that actually creates? I am not re-litigating the design decisions (D1–D7); I'm checking whether the plan to build them is internally consistent.

**Verdict:** No task ordering issue here would produce an incorrect final system — this is a small, single-file-adjacent change and a competent implementer building Section 1 as one unit before moving on would never notice most of these. But two of the findings below are genuine forward-references (a task's own text requires a symbol or test fixture that a *later*-numbered task is the one that creates), which is exactly the kind of implicit assumption that's cheap to fix now and mildly confusing to hit mid-implementation. I'd ask for the reordering below before this is handed off, not as a blocker on the design itself.

---

## Finding 1 (Should Fix): `audit-write-transaction.ts` (task 1.2a) forward-references `AuditWriteError`, which task 1.5 is the one that creates

Task 1.2a's own text requires `AuditWriteError` to exist:

> "(a) wraps a failed `db.connect()` in `AuditWriteError` and rethrows immediately... (d) wraps any error from `auditInsert` in `AuditWriteError` before it triggers `ROLLBACK`."

`AuditWriteError` isn't defined until task 1.5, three tasks later in the same section (`1.2a → 1.3 → 1.4 → 1.5`). As numbered, an implementer following the list in order hits a task that says "wrap in `AuditWriteError`" before reaching the task that says "add `AuditWriteError`." Task 1.2a's own required unit test ("simulate an audit `INSERT` that hangs... confirm the mock client receives a `ROLLBACK` call promptly afterward") can't be written correctly without the class already existing, since the helper's error-wrapping behavior is part of what the test is asserting.

Nothing in task 1.5 depends on 1.2a — it's a self-contained error class, a new `AuthErrorCategory` value, two sanitizer branches, and a frontend/shared-type update. It can move earlier with zero cost.

**This isn't a tasks.md-only artifact — it's inherited from `design.md`'s own Migration Plan**, which has the identical forward reference: step 3 ("Add `audit-write-transaction.ts`...") precedes step 4 ("Add `AuditWriteError`... `withAuditTransaction` (step 3) is where both are wrapped"). Worth noting for whoever owns `design.md`, but since `tasks.md` is the document an implementer actually executes task-by-task, I'd fix it here regardless of whether `design.md`'s migration plan gets touched.

**Recommendation:** Reorder Section 1 so the `AuditWriteError` class (current 1.5's error-class portion) lands before 1.2a — e.g., `1.1 → 1.2 → 1.5 → 1.2a → 1.3 → 1.4` — or split 1.5 into "1.2-pre: add `AuditWriteError`" (moved ahead of 1.2a) and a later task for the `AuthErrorCategory`/sanitizer/frontend pieces, which have no urgency relative to 1.2a. Either works; what matters is that no task in Section 1 names a symbol before the task that introduces it.

---

## Finding 1a (Corollary, worth noting): tasks 3.5, 3.6, 6.6, 6.7 read cleanly *because* Section 1 is assumed complete first

Once Finding 1 is fixed, tasks 3.5/3.6 (asserting `mapAuthError`/`sanitizeOidcError` classify `AuditWriteError` as `internal_error`) and 6.6/6.7 (same, at the `executeJoinFlow` call site) are fine — they correctly sit in Sections 3 and 6, both after Section 1 in full. I checked these specifically because they're the tasks most likely to silently pass against the wrong error shape if `AuditWriteError`/`mapAuthError`/`sanitizeOidcError` weren't actually wired up yet; they aren't a problem, contingent on Finding 1's fix.

---

## Finding 2 (Should Fix): the `auth.test.ts` mock-infrastructure task (9.8) is a prerequisite for tests that appear three sections earlier

Task 9.8 states the pitfall plainly: `auth.test.ts`'s `db` mock currently only mocks `.query`, and needs a `.connect` method added that **returns a distinct mock client instance per call** — because `GET /auth/callback` with a pending join token opens two sequential transactions in one request (task 3.1's, then task 6.2's), and a shared client mock would corrupt any positional assertion across both.

But tasks 3.4, 3.5, and 3.6 — which assert exactly this kind of thing ("the `users` row is not created/updated when the audit `INSERT` fails," "a failed `db.connect()`... is also wrapped as `AuditWriteError`") — are in Section 3, and 9.8 is in Section 9. An implementer writing task 3.4's test before reaching task 9.8 either (a) can't write it correctly yet, because the mock doesn't support `.connect()` at all, or (b) has to independently rediscover and build the exact mock-fixture fix that task 9.8 already describes, ahead of schedule, without the task list telling them to. Either way, the task that names the required test infrastructure comes after the tasks that need it. The same applies to tasks 6.4–6.7, which need the same two-distinct-clients-per-request mock behavior for `executeJoinFlow`'s transaction alongside `resolveOrCreateAccount`'s.

**Recommendation:** Move task 9.8 (or a scoped version of it — just the mock-fixture work, not the cross-referencing prose) into Section 1 as its own task, immediately after 1.2a, so it's built as shared test infrastructure before any section that needs it. Section 9's remaining tests can still cross-reference it by task number, same as they do today for 3.4/5.3/6.5.

---

## Finding 2a (Gap, not just ordering): no equivalent mock-fixture task is stated for `join-links.test.ts`

Task 9.8 names the fix only for `auth.test.ts`, and explicitly contrasts it with `teams.test.ts` ("which already mocks both"). It says nothing about `join-links.test.ts`'s current mock shape. But Sections 5 and 6 add `join-links.ts`'s *first* transactional (`db.connect()`-based) writes — before this change, per design.md, that file's DB access went through the plain pool only, the same situation `auth.ts` was in. If `join-links.test.ts`'s `db` mock also currently only mocks `.query` (a reasonable assumption, given it's never needed `.connect()` before), then tasks 5.3–5.5 and 6.1/6.4–6.7 have the identical missing-fixture problem as Finding 2, just unstated.

**Recommendation:** Before Section 5 is implemented, verify `join-links.test.ts`'s existing `db` mock shape. If it doesn't already mock `.connect()` with per-call distinct instances, add an equivalent task (parallel to the relocated 9.8) ahead of Section 5 — don't let this be discovered mid-Section-5 the way 9.8 flags it should not be for `auth.test.ts`.

---

## Finding 3 (Minor, coordination note rather than a blocking dependency): Section 2 precedes Section 3, but Section 3's code sits earlier in the handler

Per design.md, `auth.first_access_created`/`role_claim_mapped` (Section 3, transactional) fire immediately after `resolveOrCreateAccount` returns — earlier in `GET /auth/callback` — while `auth.session_created`/`auth.success` (Section 2, fail-open) fire later, after `request.session.regenerate()`. Both groups read from the same `user` object, but Section 3 is the one that changes *how* `user` is obtained (wrapping `resolveOrCreateAccount` in `withAuditTransaction`, via task 3.1) and Section 2 only consumes fields already on the existing `ResolvedUser` shape (`globalRole`, `isNewUser`, etc. — unchanged by this proposal).

There's no genuine architectural dependency of Section 2 on Section 3 — both could be built in either order without breaking correctness once merged — but they edit the same handler at adjacent points, and implementing Section 2 first means editing code downstream of a restructuring (Section 3's transaction wrap) that hasn't happened yet. That's a mechanical/diff-conflict risk, not a logic error, but reordering Sections 2 and 3 (do 3 first, top-to-bottom through the function) would match the actual code flow and reduce the chance of the "await ordering" mistake task 2.3 is explicitly checking for.

**Recommendation:** Optional. Consider swapping Section 2 and Section 3's order so implementation proceeds top-to-bottom through `GET /auth/callback` instead of bottom-then-top. Not required — flagging as a "cheaper if you do it this way" observation, not a defect.

---

## Finding 4 (Minor, spec gap surfaced by ordering review): task 6.3's new `SELECT global_role` isn't placed relative to the transaction boundary

Task 6.1 wraps `join-links.ts`'s `team_memberships` INSERT and conditional audit INSERT in `withAuditTransaction`. Task 6.3's second bullet adds a new `SELECT global_role FROM users WHERE id = $1` needed to populate `actor_global_role` for that same audit row — but neither task states whether this SELECT runs on the plain pool *before* `withAuditTransaction` is called, or on the checked-out `client` *inside* `domainWrite`/`auditInsert`. This doesn't block sequencing (either placement is buildable), but it's exactly the kind of implicit decision that gets made by whoever's typing at 4pm rather than deliberately — one adds a query to a connection that's about to be torn down if the transaction fails; the other burns an extra round trip on the plain pool that could itself race the transaction's data. Given `design.md`'s own tone (Decision D2's opening line: "the central technical fact this design has to get right rather than default on"), this reads like a decision worth pinning down explicitly rather than leaving to task-time judgment.

**Recommendation:** Have design.md's Decision D5 (or a corresponding tasks.md note on 6.3) state explicitly which connection this lookup runs on and whether it happens before or after `db.connect()`/`BEGIN`. Not a reordering issue in the strict sense, but adjacent enough to this review's mandate that I'd rather name it than let it ride.

---

## What I did *not* find

- No task in Sections 4–8 assumes a symbol, schema change, or mock that isn't already available by the time it's reached, once Findings 1 and 2 are fixed.
- Section 6's dependency on Section 3 (the `user.globalRole` parameter threading at `auth.ts:385`, and the shared-catch-block classification behavior task 6.2 explicitly says "task 3.5's classification assertion applies here too") is correctly sequenced — Section 3 precedes Section 6.
- No schema/migration ordering issue — proposal.md and task 1.4 are consistent that no migration is needed, and no task assumes one.
- The GitHub-issue confirmation tasks (8.1–8.3) have no code dependency on Sections 1–7 and are safely placed; they could in principle move earlier or later without effect.

---

## Summary of recommended changes to `tasks.md`

1. **(Should fix)** Move `AuditWriteError`'s class definition (currently inside task 1.5) to before task 1.2a, so `withAuditTransaction` doesn't reference a class that doesn't exist yet at that point in the list.
2. **(Should fix)** Move the `auth.test.ts` mock-fixture task (currently 9.8) to Section 1, immediately after 1.2a, so it exists before Section 3's tests (3.4–3.6) and Section 6's tests (6.4–6.7) need it.
3. **(Should fix / gap)** Add an explicit check — and, if needed, an equivalent fixture task — for `join-links.test.ts`'s `db` mock before Section 5 is implemented, matching the same concern task 9.8 already raises for `auth.test.ts`.
4. **(Optional)** Consider swapping Section 2 and Section 3's order to match the handler's actual top-to-bottom code flow.
5. **(Adjacent gap, not strictly ordering)** Pin down, in design.md Decision D5 or a tasks.md note, which connection (`client` vs. plain pool) task 6.3's new `SELECT global_role` query runs on relative to `withAuditTransaction`'s boundary.
