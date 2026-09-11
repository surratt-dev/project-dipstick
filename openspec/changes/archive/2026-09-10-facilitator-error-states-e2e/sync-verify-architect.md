# Sync Verification — Solution Architect (Ingrid Sollenberger)

**Change:** `facilitator-error-states-e2e`
**Branch:** `agent-team/facilitator-error-states-e2e`
**Date:** 2026-09-10

## Verdict

**Not clear to archive without team awareness of one confirmed blocking finding.** The documentation itself is accurate and internally consistent — I found no drift between the spec note, the tasks.md state, and the actual test code. But I independently reproduced a defect (already flagged by the implementation team as issue #39) that means the tests this change adds will **fail in the real CI `integration` workflow as currently configured**, not merely go unrun. That materially undercuts the spec note's and tasks.md's claim that this coverage "runs via the existing `integration` CI workflow with no new CI wiring required" — true as a wiring statement, misleading as a readiness statement if read to imply the suite goes green. See Finding A below. Everything else checks out; see Findings B–E.

---

## 1. Spec note vs. actual test code

Read both test files directly rather than trusting the note's claims.

- `packages/backend/src/routes/__tests__/facilitator-error-states-integration.test.ts` — contains real, unmocked Postgres/Redis coverage for:
  - Error State 1 recoverable (2.2: 503, `reveal_failure`, `recoverable: true`, exact "Try again" string) — confirmed.
  - Error State 1 non-recoverable (2.3: 409, `recoverable: false`, exact "review the session status" string) — confirmed.
  - Error State 1a (2.4: `already_revealed` shape with real `revealedAt`, no `recoverable`/`message` fields) — confirmed.
  - Error State 1b (2.5: `advance_blocked`, `requiresReveal: true`) — confirmed.
  - Ordering rule (2.6: auth failure wins over already-revealed precondition) — confirmed, matches spec's stated ordering rule.
  - Error State 4 (3.2/3.3: cross-team denial, exact "This data is not available in your current session" string, raw-body non-disclosure check via `res.body`, not just parsed JSON) — confirmed, matches spec.md's required phrasing exactly.
  - Error State 3 (4.4/4.5: real `topics/advance` wrap-up-entry and real `complete` triggers, delivered over actual Redis pub/sub to a real `ConnectionRegistry`-registered subscriber, correctly using a facilitator subscriber for 4.4 and a participant subscriber for 4.5 per the delivery-time authorization asymmetry) — confirmed. Also covers the polled `facilitator-state` banner endpoint (4.7) with the exact spec text `"Session state has changed. {status}. Resume or review."` for `wrap_up`/`complete`/`abandoned`, and `bannerState: null` for normal states — confirmed, matches spec.md lines 391–399 verbatim.
  - No `vi.mock` of `db.js`/`ws-pubsub.js`/`config.js` anywhere in the file — confirmed by inspection.

- `packages/backend/src/routes/__tests__/facilitator-error-state-2-restricted-role.test.ts` — contains Error State 2 coverage via a dedicated `dipstick_restricted_probe` Postgres role granted `SELECT` on exactly `users`/`team_memberships`/`sessions` (deliberately excluding `session_topics`), producing a genuine Postgres permission error that lands in `content.ts`'s existing catch block. Asserts real `200`, `errorState: "historical_data_unavailable"`, and the exact "Historical data is temporarily unavailable. Your session is still active." string — matches spec.md's Error State 2 required display exactly. A second test confirms the restricted role is dropped after teardown. No `vi.mock` present.

The spec.md implementation note (lines 11–13, `team-content-access/spec.md`) accurately describes this coverage state-by-state, including correctly scoping 1b as "backend contract only" and correctly naming the "system timeout" variant of Error State 3 as out of scope with a real reason (no such mechanism exists in the codebase).

## 2. tasks.md checked/unchecked accuracy

- All checked items in Groups 1–4 and 6.1–6.2 correspond to real, verifiable file content (test code, spec.md wording, archived tasks.md annotation) — confirmed by direct inspection, not by trusting the checkmarks.
- 6.3 (unchecked) — correctly pending: closing GitHub issue #19 with an explicit forward-link to #38 is a human/PR-description action not yet taken.
- 7.3 (unchecked) — correctly pending in the literal sense (nothing has been pushed yet), but see Finding A: when this does get pushed, the expected outcome is not "tests run for real" as task 7.3 anticipates — it's a **failing CI run**, given the current state of the migrations directory.
- 7.1/7.2/7.4 (checked) — see Findings B and C below regarding independent verification.

## 3. Archived task 11.10 annotation

`openspec/changes/archive/2026-07-07-enforce-access-control-on-team-content/tasks.md` task 11.10's annotation was replaced (diff confirmed) with accurate, consistent language: real Postgres/Redis coverage for States 1/1a/1b/2/3/4, box remains unchecked, gated on issue #38 (frontend WS client/UI rendering), consistent with the spec.md note and tasks.md. The box is still `- [ ]`, correctly unchecked — confirmed via `git diff`.

## 4. Full accounting of files touched

```
 M openspec/changes/archive/2026-07-07-enforce-access-control-on-team-content/tasks.md
 M openspec/specs/team-content-access/spec.md
?? openspec/changes/facilitator-error-states-e2e/   (proposal/design/tasks/reviews — normal pipeline artifacts)
?? packages/backend/src/routes/__tests__/facilitator-error-state-2-restricted-role.test.ts
?? packages/backend/src/routes/__tests__/facilitator-error-states-integration.test.ts
```

`git log main..HEAD` is empty — everything is still uncommitted working-tree state on this branch, not yet committed. No production route/handler code, no migration file, and no unrelated file was touched. This matches the change's own stated scope (two new test files, two documentation annotations). Confirmed `facilitator-error-states.test.ts` (the 22-test mocked suite) is untouched — it does not appear in `git status` at all, consistent with task 7.4's claim of "unchanged."

## Finding A (blocking, independently reproduced) — the new tests will fail, not pass, in CI today

Task 5.1's own documentation already flags that `npm run db:migrate` on a fresh database never leaves `audit_log` in place, because `8_rollback.sql` sits in `packages/backend/migrations/` and `node-pg-migrate` auto-discovers and runs every `.sql` file there as its own migration — so `8_rollback` (a manual, opt-in rollback script) runs automatically immediately after `8_audit_log`, recreating `role_change_audit` and dropping `audit_log`.

I did not take this on faith. I spun up an isolated, fresh `postgres:16-alpine` container (no shared state with any existing dev database) and ran the exact migration command CI runs:

```
pgmigrations: 1_create_enums ... 8_audit_log, 8_rollback, 9_draft_session_and_facilitator_expiry
SELECT to_regclass('public.audit_log');  →  (null — table does not exist)
```

Confirmed independently: **`audit_log` does not exist after a fresh migration run**, exactly as task 5.1 describes.

The consequence for *this specific change*: `facilitator-sessions.ts`'s `reveal`, `topics/advance`, and `complete` handlers all execute `INSERT INTO audit_log ...` as part of the same request that this change's new tests assert against (confirmed via `grep` — lines 44, 351, 479, 663, 816, 1301, 1352 of `facilitator-sessions.ts`). Since `.github/workflows/integration.yml` runs `npm run db:migrate` against a fresh ephemeral Postgres service container before `npm run test`, and `npm run test` (`vitest run --passWithNoTests`) auto-discovers any `*.test.ts` file with no glob restriction, the new integration tests **will actually execute in CI** (the wiring claim is correct) — but tests 2.2, 2.3, 2.5, 2.6, 4.4, and 4.5, which all pass through a `reveal`/`advance`/`complete` code path, will hit a genuine `relation "audit_log" does not exist` error and fail, because the table is missing.

This is not a new bug introduced by this change, and the team correctly scoped its fix as out-of-scope (filed as issue #39). But it means the spec.md note's phrasing — "run via the existing `integration` CI workflow with no new CI wiring required" — is true about wiring and false about outcome: readers should not infer from that sentence that the suite passes in CI today. I recommend the team either (a) fix or relocate `8_rollback.sql` before this branch is pushed/merged, so the `integration` workflow doesn't go red, or (b) explicitly accept and communicate that pushing this branch will fail CI until #39 lands, rather than have that discovered as a surprise at PR time. Given Ingrid's standing concern about observability and CI as the mechanism that surfaces problems before a user does, a red CI run here is actually the system doing its job — but it should be anticipated, not stumbled into.

## Finding B — task 7.1/7.2 claims were spot-checked, not merely trusted

Docker was available in this environment. I did not re-run the full local suite end-to-end (that duplicates task 7.1's own local verification and Finding A already shows what a from-scratch run reveals), but I did independently confirm the CI-equivalent migration behavior (Finding A) and confirmed `npm run test`'s glob (`vitest run --passWithNoTests`, no restrictive pattern) will pick up both new files automatically, supporting the "no new CI wiring" half of the claim.

## Finding C — no drift, no scope creep

Nothing beyond the documented two test files and two documentation annotations was touched. The `openspec/changes/facilitator-error-states-e2e/` directory contains only the expected pipeline artifacts (proposal, design, exploration notes, review files, tasks.md, specs/) — normal for this OpenSpec team workflow, not scope creep.

## Recommendation

Hold archiving until the team has explicitly acknowledged Finding A — either by fixing/relocating `8_rollback.sql` first, or by consciously accepting a red `integration` CI run on push and treating that as the trigger for prioritizing issue #39. The change's own artifacts are otherwise accurate, well-scoped, and consistent with what's actually in the code.

---

## Resolution (2026-09-10, post-recommendation)

Option (a) was taken: `8_rollback.sql` was relocated to `migrations-manual/` (outside `node-pg-migrate`'s discovery path) on branch `fix/audit-log-migration-rollback`, merged to `main` via [PR #40](https://github.com/surratt-dev/project-dipstick/pull/40). `agent-team/facilitator-error-states-e2e` was then rebased onto the updated `main`.

Re-verified independently after the rebase, not taken on faith:
- Fresh `docker compose down -v` + `up` (matching CI's ephemeral-container conditions) + `npm run db:migrate` → `audit_log` now exists with its full schema; `8_rollback` no longer appears in `pgmigrations`.
- Both new test files re-run against this fresh environment: 11/11 pass (previously would have hit `relation "audit_log" does not exist` on tests 2.2, 2.3, 2.5, 2.6, 4.4, 4.5, per Finding A's analysis).
- Full backend suite: 37 files, 461 tests, all pass, 96.91% coverage.

Finding A is closed. This change is ready to archive.
