# Architecture Review — tasks.md (independent pass)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** tasks.md ordering and internal consistency against the current design.md, as if reviewing fresh. Not a re-litigation of Decisions D1-D7 themselves, which I've already reviewed and which are sound. This pass asks one question: given everything design.md now says, does the task sequence actually build in an order where nothing is used before it exists?

**Method:** Read tasks.md, design.md, and proposal.md in full; checked the specific assumptions below against the current code (`middleware.ts`, `routes/auth.ts`, `realtime/connection-reauthorization.ts`, `auth/audit-logger.ts`, and both test files) rather than taking tasks.md's characterization of them on faith. Where I confirmed something against the code, I say so; where I didn't need to, I don't.

**Verdict:** Sections 1, 3, 4, and 6 are correctly ordered relative to their dependencies and to each other. Section 2 has one real internal ordering defect and one substantive consistency defect between tasks 2.3 and 2.4 — the second is the more important of the two, and I'd want it fixed before an implementer starts, not caught in review after. Section 5's placement has a softer but still real problem: it defers a fix that's actually load-bearing for Section 3, not just for the rest of Section 5. None of this requires touching design.md again; all three findings are fixable inside tasks.md.

---

## Finding 1 (blocking): Task 2.4 is sequenced after the task that depends on it

Task 2.3 builds `writeSessionInvalidatedAuditRow`, and its own text says the helper "wraps the actor-global-role lookup (**via the imported `resolveActorGlobalRole`**)... in a single call to `writeAuditRow()`." That parenthetical is written as a fact about code that already exists by the time 2.3 is executed. But the only task that actually performs the import is 2.4, one step later in the list.

Read literally in order, an implementer writing 2.3's code has nothing to import yet — 2.4 hasn't run. In practice most implementers will just do the import while writing 2.3 and treat 2.4 as already-satisfied busywork by the time they get to it, which is a fine outcome but not one the task list should have to rely on a reader improvising around. The rest of this document is written at a level of precision (see task 1.1's explicit "do not treat `retryCount` as already available... it isn't, until this task lands") that makes this a real inconsistency, not a style nitpick: 2.3 makes exactly the kind of forward assumption tasks.md elsewhere goes out of its way to prohibit.

**Fix:** either fold 2.4's import into 2.3 as its first sub-step, or move 2.4 immediately before 2.3 and reword 2.3 to stop describing the import as already done. Given Finding 2 below, I'd fold it in rather than reorder — see that finding for why a standalone 2.4 doesn't survive as written anyway.

## Finding 2 (blocking): Task 2.4's scope contradicts the single-helper, no-duplication design 2.3 just mandated

This is the substantive one. Task 2.4 says:

> Import `resolveActorGlobalRole` into **both `middleware.ts` and `auth.ts`**... no inline duplicate of the `SELECT global_role FROM users WHERE id = $1` query at either call site.

Task 2.3, one line above it, says the write helper must not be "duplicated between `middleware.ts` and `auth.ts`" — i.e., there is exactly **one** `writeSessionInvalidatedAuditRow`, living in exactly one location ("co-located in `middleware.ts` or a new small module — implementer's call"), and it is this single helper that internally calls `resolveActorGlobalRole` and performs the `INSERT`. I confirmed against the code that this is a real architectural choice, not a wash: `resolveActorGlobalRole` is exported from `connection-reauthorization.ts` for exactly this kind of reuse (`realtime/connection-reauthorization.ts:49`), and neither `middleware.ts` nor `routes/auth.ts` imports it or `db.js` today — `routes/auth.ts` already imports `db.js` directly (`routes/auth.ts:6`) for its own existing queries, while `middleware.ts` imports neither `db.js` nor anything from `connection-reauthorization.ts` right now.

Under 2.3's design, resolveActorGlobalRole is called from exactly one place — inside `writeAuditRow`, inside the one `writeSessionInvalidatedAuditRow`. Work out where that lives:

- **If co-located in `middleware.ts`:** `middleware.ts` needs the `resolveActorGlobalRole` import (for the helper's own body) and needs `db.js` (for the `INSERT`). `auth.ts` needs neither — it calls the shared helper function (which 2.3 doesn't currently say must be `export`ed, a small gap worth closing at the same time), not `resolveActorGlobalRole` directly. `auth.ts` already imports `db.js` for unrelated reasons, so nothing there changes.
- **If placed in a new small module:** neither `middleware.ts` nor `auth.ts` imports `resolveActorGlobalRole` at all — the new module does, and both call sites import the helper from it.

In neither case does the literal instruction "import `resolveActorGlobalRole` into both `middleware.ts` and `auth.ts`" hold. Following 2.4 as written produces an import that at least one of the two files never uses — which is precisely the class of mistake Decision D7 already had to correct once for `resolveTeamIdForAudit` (an unused import failing this repo's `@typescript-eslint/no-unused-vars: "error"` rule and therefore CI). Design.md's D7 text asserts that it "matches tasks.md 2.4 as already written," but D7 is describing each call site independently calling `resolveActorGlobalRole`, while 2.3's helper design centralizes that call in one place. Those are two different architectures, and only one of them is what tasks.md 2.3 actually specifies for implementation.

**Fix:** Delete 2.4 as a standalone task. Fold its real content — "don't inline a duplicate `SELECT global_role` anywhere, reuse `resolveActorGlobalRole`, don't import `resolveTeamIdForAudit` at all" — into 2.3 itself, scoped correctly: *the module containing `writeSessionInvalidatedAuditRow` imports `resolveActorGlobalRole`; if that module is `middleware.ts`, `auth.ts` imports the helper function, not `resolveActorGlobalRole`.* This also closes the "must the helper be exported for `auth.ts` to reach it" gap that 2.3 currently leaves implicit when read together with Section 4's call site.

## Finding 3 (non-blocking, but worth reordering): Section 5's placement defers a fix that Section 3 itself needs

Task 5.1 states plainly why it exists: once `middleware.ts` imports a module that constructs a real `pg.Pool` (which is exactly what Section 2/3 do), the existing `absolute_timeout`/`token_revoked`/`transient_failure` branch tests in `middleware.test.ts` will "hit a real (unconfigured) `pg.Pool` and either fail non-deterministically or 'pass' only by coincidentally hitting the new fail-open path." I confirmed this against the actual test file: `middleware.test.ts` mocks `oidc-client.js`, `token-encryption.js`, `session-store.js`, `audit-logger.js`, and `config.js` today — no `db.js` mock, no mock for wherever `resolveActorGlobalRole` resolves to. (`auth.test.ts`, by contrast, already mocks `../../db.js`.)

Task 5.1 is careful to call itself "a prerequisite for 5.2-5.7," which is true but understates its actual scope: it's a prerequisite for **Section 3 landing without breaking the existing suite**, full stop — not just for the new tests that come after it. As tasks.md currently groups the work (Sections 1-4 as "the change," Section 5 as "the tests," in that order), a team executing this sequentially and running the suite after finishing Section 3 will see exactly the non-deterministic failures 5.1 describes, two full sections before 5.1 is scheduled to fix them. That's a real, avoidable window where CI is red (or worse, flaky-green) for a reason a reviewer three commits later has to rediscover rather than being told up front.

**Fix:** Pull 5.1 forward so it lands in the same step as Section 2/3 — either renumber it into Section 2 (e.g., as 2.5, executed once the helper's location is chosen and before 3.1 starts touching call sites), or add an explicit note on Section 3's heading that 5.1 must be completed before or alongside 3.1, not deferred to "Section 5." I'd rather see it move than see a note added, since a note is exactly the kind of soft dependency this document has otherwise been rigorous about making structural (see task 1.1's explicit warning, or 5.1's own "not an implicit side effect" framing for 5.2-5.7).

---

## Everything else: checked, no issues

- **Section 1 → Section 3 dependency (retryCount):** correctly ordered and explicitly cross-referenced at both ends (1.1's own text, and 3.2/3.3's "now populated per task 1.1" / "populated per task 1.1"). This is the model the rest of the document should follow — Findings 1 and 2 above are places where that same discipline slipped.
- **Section 2 (2.1, 2.2) → Section 3/4:** `AUDIT_WRITE_TIMEOUT_MS`/`AuditWriteTimeoutError`/`withTimeout` (2.1) and `auth.audit_write_failed` (2.2) are both consumed by 2.3's helper and by nothing before it. Correctly sequenced ahead of 2.3.
- **Section 2 → Sections 3 and 4:** both call-site sections correctly follow the shared plumbing they depend on; no call site tries to invoke the helper before Section 2 builds it.
- **Section 4 (`auth.ts`) after Section 3 (`middleware.ts`):** no dependency runs in the other direction — this ordering is a convenience, not a requirement, and it's a reasonable one (finish the three-branch site before the single-branch site).
- **Section 5 internal ordering (once 5.1 is relocated per Finding 3):** 5.2's fake-timer guidance correctly precedes 5.6, the test it's warning about. 5.9 (full regression) correctly sits last, after every other assertion in the section exists to regress against.
- **Section 6:** 6.1 (spec-sync confirmation) and 6.2-6.5 (docs/follow-on issues) have no code dependency that requires them mid-sequence; "before this change is archived" is the right binding for 6.1, and end-of-list is the right place for process/documentation follow-through that depends on the rest of the change existing to describe accurately.
- **`resolveTeamIdForAudit` non-import:** correctly stated as a negative constraint in both 2.4 and D7, consistent with D4's `team_id: NULL` decision; no ordering dependency to check here since nothing calls it.

## One thing I'd ask about but am not blocking on

2.3 leaves the helper's file location ("co-located in `middleware.ts` or a new small module") as "implementer's call." I lean toward the new-module option, for a reason that's mine to raise and the team's to weigh, not a task-ordering defect: co-locating it in `middleware.ts` creates a new one-directional import from `routes/auth.ts` into `auth/middleware.ts` that doesn't exist today (confirmed — `auth.ts` imports nothing from `middleware.ts` currently), which is a small step away from a clean boundary between "the onRequest hook" and "a route handler." A new module (e.g. alongside `audit-logger.ts`) avoids creating that edge at all. Not worth a task rewrite over, but worth the implementer knowing it's a live consideration rather than a coin flip.
