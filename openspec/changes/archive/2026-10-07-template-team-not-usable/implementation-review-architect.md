# Implementation Review: template-team-not-usable (#214)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** the uncommitted working tree on `agent-team/214-template-team-not-usable`, checked against `design.md` (D1–D9) and the "Implementation notes" in `tasks.md`.
**Verdict:** **Approve with two blocking items.** Neither needs a code change. B1 is a spec-text correction. B2 is a process item for a human. The architecture matches the design.

## What I verified

| Check | Result |
|---|---|
| `npx @fission-ai/openspec validate template-team-not-usable --strict` | **Pass** ("Change 'template-team-not-usable' is valid"). Task 10.1 says this could not be run; it has now been run. |
| Production typecheck (`tsc -p tsconfig.build.json`, backend) | Pass. The type errors in the full test-tree `tsc` are in older test files this change did not touch, at line numbers this change did not alter. |
| The change's targeted suites against local Postgres and Redis (`src/teams`, both `team-template-guard-*` files, every `template-team-*` file, `topic-lock-helper-source`) | 16 files, 145 tests, all pass. None were skipped (infra was up). |
| Full backend and frontend suites | Not re-run by me. 10.1 reports them green. |

## Boundaries and decisions: the design against the code

**D1 (guard + constraint).** Done as designed. The app-layer guard (`teams/template-team-guard.ts`) and the database backstop (`migrations/23_…`, `teams/template-constraint-violation.ts`) are separate files with separate jobs, and the header comments say why. This is the separation I asked for at the tasks stage (R3).

**D2 (shared module, called in each route, never a `preHandler`).** Done. `isTemplateTeam` normalises the value as specified (one brace pair, all hyphens, lower case) and reads no configuration. A source test enforces that. `writeTemplateAccessDenial` takes primitives, resolves the role when none is passed, writes no row for a null actor, and is fail-open. The role lookup, the Redis claim and the insert are bounded together by `AUDIT_WRITE_TIMEOUT_MS`. Its failure log carries only the error's code and message. #188's `checkWritableTeam` is untouched, which is correct.

**D2a (flood bound).** Done. `SET NX PX 60000` per (actor, endpoint), and the row is still written if Redis errors. Suppressed refusals still emit the event, with `audit_row_suppressed: true`. The sliding-window limiter is not reused, as the design required.

**D3 (placement table).** I checked every route against the table:
- `draft`: guarded after the facilitator `403`, before the team lookup and the cross-team check, so no `getOrCreateJoinLink` runs.
- `advance`, `complete`, `topics/advance`, `facilitator-state`: guarded right after authentication and before the session lookup, through one local helper. `advance` keeps its non-canonical `sessionId` rejection in front of the guard.
- `reveal`: see deviation 3.3.
- `members`: guarded after the non-member `403`.
- TEAM-005: guarded after authorization, before the member lookup.
- TEAM-006: guarded after the admin `403` and the limiter.
- Join-link creation: guarded before the membership check.
- Both redemption paths: guarded immediately after the row lookup, before `is_active` and before the login redirect. Each emits `join.link_rejected` with `reason: "template"`.

I compared each template response with the route's existing missing-team, missing-session or non-member response: same status, `category` and message. That parity is also asserted structurally.

**D4 (migration).** Matches the design step for step:
1. Lock first, with `lock_timeout = 200ms` and a retry note in the header.
2. Cleanup, with prior values captured in the same statement (a CTE) before the update. Audit rows are written only for tables that changed (`HAVING count(*) > 0`), so the no-op case writes nothing.
3. `NOT VALID` constraints, each with a comment naming `DEFAULT_TOPICS_TEAM_ID`.
4. `VALIDATE` only where no template row remains.

The down section drops only the constraints. Table names are unqualified on purpose, so the scratch-schema test can run the real file, and the header says so. The two `UPDATE sessions` CTEs in step 2c touch disjoint rows, which Postgres allows. The header's notes on frozen rows and the realtime window cover what operators need to know.

**D5 (constraint violations).** Done. `registerTemplateConstraintErrorHandler` runs first in `registerRoutes`, so `buildFullApp` and production get the same handler. It rethrows non-template errors, so every other `500` body is unchanged. The predicate matches on fields, not message text. The marker is called from the existing fixed-`500` catches (`draft`'s team creation, `advance`'s room open) and from the `/auth/callback` catch before `mapAuthError`. No route plugin sets its own error handler, so all of them inherit this one.

**D6 (lock state).** `auth/topic-lock-state.ts` is a separate wrapper, and `topic-lock-helper.ts` stays template-agnostic (source test). TOPIC-001 and TOPIC-002 both call it, and the mapping keeps the old semantics (`locked = !hasCompletedFirstSession`). `TopicLockReason`, `lockReason` and the new `GetActiveTopicsResponse` are in `@dipstick/shared` and used on both sides. The frontend chooses its copy from `lockReason` only, never from the team id. Write controls are hidden in the UI, but enforcement stays server-side (#188's guard), so no authorization logic moved to the frontend.

**D7 / D8 / D9.** Read surfaces are closed by membership plus the clamp, and the 1.4 test proves the clamp at the data level using the production predicate itself. The structural test selects by prefix plus the extra list, fails any selected route that has no table entry, asserts the four-key `refused-before-guard` set by equality, runs the admin and unauthenticated passes, and includes the probe self-test. #188's tests were reworked to the hoisted module mock.

## Assessment of recorded deviations

| Deviation | Assessment |
|---|---|
| **1.2:** #187 task-4.8 pair collapsed to the reachable case | **Acceptable.** Both set-ups are now impossible by construction, and the comment explains why. |
| **1.4:** `FACILITATOR_GRANT_SQL` extracted; `LIVE_FACILITATOR_STATUSES` exported (now `readonly`) | **Acceptable, and the right call.** The test runs the production predicate, not a hand-copied version that could drift. The extraction is byte-identical, and the module surface grows only by constants. |
| **2.1a:** `redis.js` imported lazily inside the guard | **Acceptable, advisory (A3).** It is the only dynamic `import()` in production source, and production code is bending to test mocking. It is harmless at runtime: one cached module resolution on the first refusal. |
| **2.1b:** an actor with no `users` row writes no row (logged `audit_write_failed`) | **Acceptable.** This follows D2's "never a placeholder role", and the structured event is still emitted. |
| **3.3:** `reveal` answers the template with its non-recoverable `409`, not a `404` | **Acceptable in code.** D3's rule is parity with the missing-session answer, and for `reveal` that answer is the `409`. **The delta spec still says otherwise; see B1.** |
| **3.3 / 5.2:** `engineer` in place of the `participant` global role | **Acceptable in code.** `user_role` has no `participant` value. **The spec scenario names a role that does not exist; see B1.** |
| **5.2:** `draft`'s non-canonical spellings get the parity `404` but no audit row | **Acceptable in code.** This is the existing boundary rejection, which the Non-Goals say must not change, and it matches #188. **It contradicts the spec scenario "Each audited route is probed with non-canonical spellings … with the audit row"; see B1.** It also introduces an open-ended table flag; see A1. |
| **5.2:** admin pass on `draft` expects the facilitator `403` | **Acceptable.** The spec's "no override" scenario covers callers who pass the endpoint's authorization, and an admin does not pass `draft`'s. Open-ended flag; see A1. |
| **4.4:** `join.link_rejected` field comment added rather than extended | **Acceptable.** |
| **5.4:** literal check with a frozen baseline of seven pre-existing test files | **Acceptable.** The baseline can only shrink, and new code must use the constant. |

## Blocking

- **B1. Correct the delta specs to match the three recorded deviations before archive.** At archive, these deltas become the main specs, so they must not describe behaviour the code does not have. No code change is needed.
  1. `specs/session-creation/spec.md`, requirement "Team-addressed session sub-routes refuse the template team before the session lookup": change "the route's 'Session not found.' `404`" to "the route's missing-session response ('Session not found.' `404`; for `reveal`, its non-recoverable `409 reveal_failure`)".
  2. Same file, scenario "A participant-role caller receives the same refusal": `global_role` `participant` does not exist. Use `engineer` (a participant's global role) and assert `actor_global_role = 'engineer'`.
  3. `specs/default-topic-provisioning/spec.md`, scenario "Each audited route is probed with non-canonical spellings": add the exception that a route which already rejects non-canonical ids at its boundary (today only `draft`) returns the parity response with no audit row, as in the topic-write scenario at l.288.

  Re-run `openspec validate --strict` after the edit.

- **B2. File the 8.2 finding as a separate issue linked to #214, before merge, and reference it in the PR.** A template action item's **owner**, or anyone who **ever facilitated** a template session, can still update template action items (`/api/v1/action-items/:id/{status,owner}`). `action_items` has no template constraint, so this is a live write path into frozen template content that neither the guard nor the backstop covers. Task 8.2 requires the issue, and the implementing agent correctly did not make the external write. A human has to file it.

## Advisory (non-blocking)

- **A1. Close the two new table flags the way `REFUSED_BEFORE_GUARD` is closed.** `boundaryRejectsNonCanonical` and `adminRefusedBeforeGuard` can be set on any entry. Setting `adminRefusedBeforeGuard` drops that route's admin-parity assertion, and setting `boundaryRejectsNonCanonical` drops two of its three audit assertions, with nothing to catch it in review. These are the same open escape hatches that engineering B4 closed for `refused-before-guard`. Add two constants (today `["POST /api/v1/teams/:teamId/sessions/draft"]` each) and assert equality. Strongly recommended before merge; it is a few lines.
- **A2. Duplicated response literals.** The template branches restate their route's not-found and non-member bodies (the `reveal` `409` body, the TEAM-005 `404`, the join-link `403`, the session `404` helper) instead of sharing them with the original branch. Drift is caught by the structural parity test, so this is acceptable. If any of these bodies is touched later, extract a shared builder.
- **A3. The lazy `redis.js` import.** Keep it, but note in the guard's header (already partly there) that it is the only dynamic import in `src/`. If a second one shows up, prefer mocking `redis.js` in the route unit tests instead.
- **A4. 8.4: an admin can read the template's team record via `GET /api/v1/teams/:teamId`.** It shows the stored name and an empty member list, with no session data. I accept this as residual: it is not a session, membership or join-link surface, and it carries no sensitive data. Record the acceptance in the PR so it is a decision, not an omission.
- **A5. Operations.** 10.2 (end-to-end) is still open, and the H1 deploy gate is manual. Both must be done before deploy, as the workflow follow-up already states. The post-deploy `pg_constraint` and `team.template_cleanup` queries in the Migration Plan are the runbook check. Make sure the release checklist carries them.
