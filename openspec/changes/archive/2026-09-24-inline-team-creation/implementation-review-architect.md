## Implementation Review — Solution Architect (Ingrid Sollenberger)

Scope: does the implementation match `design.md` (D1–D9) and `tasks.md`? Boundary respect and pattern consistency with the rest of `packages/`, per my standing concerns (server-side authority, explicit boundaries, auditability). Not a re-review of the design decisions themselves — those are settled.

### Verdict

Matches the design. Every decision D1–D9 is implemented as written, with inline comments at the exact call sites that name the decision they implement — this codebase's established convention, and this change follows it consistently rather than only in the new code's own novel parts. The two implementer-flagged deviations are both legitimate refinements, not regressions or scope creep (detail below). The 4.4 test failure is the intended, designed-for state. I have no must-fix findings.

---

### D1–D9 correspondence

- **D1** (third `Screen` variant, one component): `SessionCreationPage.tsx`'s `Screen` union is exactly `{ name: "picker" } | { name: "confirm"; team: EligibleTeam } | { name: "new-team" }`. No sibling page was created. Matches.
- **D2** (skip `draft`, land in `lobby`; name-echo submit label; landing acknowledgment; dedicated error state): the session INSERT hardcodes `status = 'lobby'`; the submit button label is computed live from `trimmedName` (`Create team '<name>' and open session room`); `DraftSessionHost.tsx` renders `new-team-landing-acknowledgment` scoped strictly to `newTeamCreated` passed through router state, leaving the existing-team landing copy untouched. `newTeamError` is its own state, reset on both `goToNewTeam` and `backToPickerFromNewTeam`. Matches, including the "reset on every transition" detail.
- **D3** (single transaction; route in `facilitator-sessions.ts`; `is_first_session`/`session_number` as named literals; `team.creation_denied_role` audit on the 403): all present. `BEGIN` → `INSERT teams` → `INSERT topics ... SELECT` → `INSERT sessions (..., true, 1)` → `INSERT audit_log` → `COMMIT`, one client, one try/catch/finally, matching `POST /draft`'s established shape. The route-placement rationale is documented inline at the handler, not just in design.md. Matches.
- **D4** (normalized functional index; `23505`-on-teams-INSERT-only, not constraint-name matching): migration 11 creates `teams_name_unique_normalized` as a functional index, additive, existing `teams_name_unique` left untouched (confirmed at `2_create_tables.sql:23`, task 2.2's verification note). The handler's `23505` handling is scoped to the teams INSERT specifically — see the deviation discussion below. Matches, with the refinement addressed separately.
- **D5** (copy not reference; no locked column): `INSERT INTO topics (...) SELECT ... FROM topics WHERE team_id = <sentinel> AND is_default = true` produces independent rows; no `locked` column exists in the schema or is written anywhere in this step. Test 4.5 verifies both directions of independence against real Postgres. Matches.
- **D6** (no `team_memberships` row, ever): grep-confirmed absent from the handler; the negative assertion has its own regression test (`facilitator-sessions.test.ts:598`) carrying the required inline comment naming D6 and the facilitator-from-another-team constraint it protects, exactly as task 7.1 and D6 itself specify. Matches, including the "treat this test as security-critical" instruction.
- **D7** (prerequisite is a real merge dependency, enforced by a real-data test, not prose): `fix-default-topic-seed-data` is still a stub (README only, not proposed). Task 4.4's integration test queries the actual seeded sentinel rows and — confirmed by reading the test and its own header comment — is written to fail until the prerequisite lands. This is the correct, intended state, not an implementation bug (see dedicated section below). Matches.
- **D8** (check order: authenticate → authorize role → validate name → check uniqueness, as a spec-level requirement): the handler's role check runs first and writes its own audit row before any name-dependent code executes; name validation follows; the uniqueness pre-check is last. Test `7.1/D8` explicitly asserts the non-facilitator rejection is byte-identical regardless of whether the submitted name collides, and that only 2 `db.query` calls happen (actor lookup + audit insert) — the uniqueness check is provably never reached. This is exactly the enumeration-surface bound D8 exists to guarantee, verified by a test that would fail if a future refactor inverted the order. Matches.
- **D9** (rate limiting deliberately deferred): no rate-limiting code was added to this endpoint, consistent with the decision. Nothing to verify beyond absence, which holds.

Tasks.md cross-check: every task 1.1 through 8.1 is marked complete except 1.1 (correctly left unchecked — the prerequisite genuinely hasn't merged) and 2.1a (correctly left unchecked — it's explicitly a pre-merge action, not an implementation-time one). No task is checked off without corresponding code; no code exists that isn't traceable to a task.

---

### Deviation 1: `TeamNameCollisionSignal` marker vs. a blanket transaction-level `23505` catch

**This is more correct, not a regression — endorsed.**

D4's own text, read literally, says "treats any `23505` on the `teams` INSERT as the same collision response, regardless of which named constraint fired." The literal spec language is about not matching on `err.constraint`, not about catching every `23505` anywhere in the transaction. A blanket catch would be a real correctness bug: this transaction contains three INSERTs (`teams`, `topics`, `sessions`), and `topics`/`sessions` have their own constraints that could in principle raise `23505` for reasons that have nothing to do with a name collision. Reporting those as `team_name_collision` to the caller would be actively misleading — the response body would claim `providedName` collided when the real failure was an unrelated constraint violation on a different table.

The implementation's approach — catch `23505` in a `try/catch` scoped to only the `teams` INSERT call, translate it to a private `TeamNameCollisionSignal` marker, and only that specific signal is caught outside the outer `try` to become the 409 — correctly narrows D4's intent to where it belongs. The test at `facilitator-sessions.test.ts:832` ("a 23505 on a statement other than the teams INSERT is not mistaken for a name collision") is exactly the regression this design decision needs, and it exists. I'd consider a blanket catch a bug if I found it; I did not find it. No change requested.

### Deviation 2: `newTeamGenericError` beyond D2's two-member union

**Reasonable, minimal, endorsed — not scope creep.**

D2 explicitly scopes `newTeamError`'s vocabulary to the two error shapes the backend can name (`empty_name`, `name_collision`). It says nothing about network failures, unexpected 5xx, or non-session-expiry 401s — because those aren't part of the *backend's* typed error vocabulary; they're client-side failure modes the design didn't need to enumerate since they aren't shaped by a `TeamNameCollisionResponse`-style contract. Every other screen in this same component (the `confirm` screen's fallback branches, `DraftSessionHost`'s load/advance error paths) already has an equivalent "something unexpected happened" fallback message, so a bare crash or a silently-stuck "Creating…" button on an unmodeled failure would be the actual inconsistency here, not the addition of a slot to handle it.

The implementation keeps `newTeamGenericError` genuinely separate — a free-text `string | null`, not folded into the `NewTeamError` discriminated union — and resets it alongside `newTeamError` on both transition functions, so it doesn't leak state across screens either. This is additive to D2, doesn't touch the two-member union D2 actually specifies, and closes a real gap (unhandled failure UX) rather than opening new scope. No change requested.

---

### Task 4.4's failing state

Confirmed correct and intended, not a bug. Three independent signals agree:
1. `fix-default-topic-seed-data/README.md` is still a stub — not proposed, not merged.
2. `4_seed_data.sql` (unmodified by this change, per design.md's explicit non-goal) still seeds six topics.
3. The test file's own header comment and the test's own `it(...)` title both say, verbatim, "EXPECTED TO FAIL until fix-default-topic-seed-data merges" / "expected red until fix-default-topic-seed-data lands," and tasks.md 4.4's completion note records the actual run result (6 rows found, 12 asserted) as the working merge gate.

This is D7 functioning as designed: a real, executable dependency check rather than a sequencing instruction someone has to remember to honor. I would flag it as a problem only if the test had been weakened to pass anyway — it has not.

---

### Boundaries and pattern consistency

- **Server as sole authority**: name uniqueness, role authorization, and topic provisioning are all enforced in the transaction/query layer, not trusted from the client. The frontend's empty-name check (`submitNewTeam`'s early return) is a UX nicety backed by the server's own `trimmedName.length === 0` check — not a substitute for it.
- **Audit trail**: both the denial path (`team.creation_denied_role`) and the success path (`team.created_with_session`) write synchronously alongside their triggering state change, matching the codebase's `session.draft_created`/`session.draft_denied_membership_conflict` precedent exactly, including the "reject gets audited, business-rule-miss doesn't" asymmetry D3 calls for (no audit row for the 409 collision case).
- **Route placement**: `teams.ts` (TEAM-005/006) was left untouched; this stays out of that file's unrelated domain, as D3 requires.
- **Type-safety at the boundary**: `TeamNameCollisionResponse` is a real shared type (`packages/shared/src/types/session-creation.ts`, exported via `index.ts`), consumed on the frontend by type, not by string-matching a message — avoiding the exact anti-pattern `facilitator-sessions.ts:298`'s own comment calls out.

No findings requiring changes before this ships. My earlier tasks-stage findings (`tasks-review-architect.md` #1 and #5) were both incorporated as implemented — 3.3a now precedes 3.4, and 2.1a exists as an explicit pre-merge re-verification step, correctly still unchecked pending actual merge.
