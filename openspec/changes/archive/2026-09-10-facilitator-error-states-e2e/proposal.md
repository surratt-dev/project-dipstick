## Why

Archived task 11.10 — "End-to-end test exercising all four facilitator live session error states through the full stack" — has sat unchecked for two months, blocked first on WebSocket infrastructure and then, once that landed, effectively frozen because nobody separated "the backend/WebSocket layer is real now" from "the UI exists." Both are now true: `session-lifecycle-transitions` resolved issue #26, so all four production-trigger events fire from real committed code paths, and the missing frontend surface has been correctly filed as its own change (issue #38) rather than smuggled into this one. That leaves a real, closeable gap — `facilitator-error-states.test.ts` is 22 good tests, but every one of them runs against a mocked `db.query` and none of them touch a real database, real Redis, or a real WebSocket hop. Error State 3's actual production trigger (`session_state_change` published over `ws:events` after a committed state transition) has never been asserted against anything real. Closing 11.10 honestly means proving these states against real infrastructure, not re-confirming what the mocks already told us. The alternative — leaving the gap unresolved while the checkbox drifts further from what's actually verified, or quietly checking it off on the strength of mocked coverage — is the failure mode this change exists to avoid.

## What Changes

- Add full-stack E2E test coverage, run against real Postgres and real Redis via the existing `integration` npm/CI workflow (`.github/workflows/integration.yml` — already provisions both on every push/PR to `main`; no new CI wiring required), for all six facilitator live-session error-state variants:
  - Error State 1 — reveal failure, recoverable path (real `POST .../reveal`, session stays active)
  - Error State 1 — reveal failure, non-recoverable path (real `POST .../reveal`, session not active)
  - Error State 1a — reveal on an already-revealed topic (backend contract only — real endpoint, `already_revealed` response shape)
  - Error State 1b — advance blocked before reveal (backend contract only — real endpoint, `advance_blocked` response shape, `requiresReveal: true`)
  - Error State 2 — historical data unavailable during an active session (real HTTP call, empty-state body, confirmed not a 403)
  - Error State 3 — session status transition, real-trigger case (real `session_state_change` publish over actual Redis pub/sub, following a real committed transition via the topic-advance wrap-up-entry branch or session completion, delivered to a real connected subscriber)
  - Error State 4 — cross-team denial (real cross-team HTTP request, non-disclosure of Team A's identity asserted by absence, matching the rigor already established for this assertion elsewhere in the suite)
- Extend/replace the mocked `db.query` assertions in `facilitator-error-states.test.ts` that cover these specific states with equivalent real-infra assertions. Tests for behavior this change doesn't touch are left as-is.
- **Out of scope, named explicitly rather than silently dropped:** Error State 3's "system timeout" trigger variant. No timeout-driven auto-transition mechanism exists anywhere in this codebase — this is a separate, unbuilt mechanism, not a consequence of issue #26 or anything this change resolves.
- **Out of scope, filed separately:** all new frontend UI for these six states (reveal trigger and its rendering, historical-data view, transition banner, cross-team-denial-producing request path). This is [issue #38](https://github.com/surratt-dev/project-dipstick/issues/38), referenced here as the follow-on dependency that ultimately closes task 11.10.
- Annotate (not check) archived task 11.10 in `openspec/changes/archive/2026-07-07-enforce-access-control-on-team-content/tasks.md`, replacing its current "PARTIALLY UNBLOCKED" note with a statement of exactly which states/scenarios now have real full-stack coverage, what infra that coverage runs against, and that the task remains unchecked pending issue #38.
- Add an implementation note to `team-content-access/spec.md`'s "Live session error states for facilitators..." requirement, in the same style as the existing Error States 1a/1b note, documenting this change's real-infra coverage status. No required display text, MUST/MUST NOT behavior, or scenario changes.

## Capabilities

### New Capabilities

None. This change adds test coverage against already-specified behavior; it does not introduce a new product capability.

### Modified Capabilities

- `team-content-access`: No requirement text, display behavior, or scenario changes. Adds an implementation note to the "Live session error states for facilitators are distinct from general 403/404 responses" requirement documenting that Error States 1 (both paths), 1a, 1b (backend contract), 2, 3 (real-trigger case), and 4 now have real full-stack test coverage, what infra that coverage runs against, and that the requirement's frontend "Required display" behavior remains open follow-up work tracked under issue #38.

## Impact

- **Test suite:** `packages/backend/test/.../facilitator-error-states.test.ts` (or its real-infra successor) — mocked assertions for the six in-scope states are replaced with real-Postgres/real-Redis assertions. No production code in `packages/backend/src/routes/facilitator-sessions.ts` or the session-lifecycle endpoints changes; they are exercised, not modified.
- **CI:** No changes to `.github/workflows/integration.yml` — its existing Postgres (5433) and Redis (6380) services already satisfy this change's infra requirement.
- **Archive:** `openspec/changes/archive/2026-07-07-enforce-access-control-on-team-content/tasks.md` — task 11.10 annotation updated, checkbox unchanged.
- **Specs:** `openspec/specs/team-content-access/spec.md` — one implementation note added; no requirement or scenario text changes.
- **Downstream:** Issue #38 (frontend rendering of these six states) remains the only change that can check task 11.10, and depends on this change's real-infra assertions existing as its testable foundation.
- **Issue #19 closure communication:** Whatever GitHub comment or PR description closes out issue #19 will state plainly that it closes only the backend-rigor half of task 11.10 and will link forward to issue #38 by number — not close silently. This is a commitment on how the closure is communicated, independent of this change's technical content.

## Disposition of Propose-stage review feedback

Reviewed against Marcus Delgado's (`propose-review-ba.md`) and Rachel Okonkwo's (`propose-review-exec.md`) feedback. All items were adopted; nothing was rejected. One item was adopted with a correction, noted below for traceability.

- **Marcus's blocker (spec delta's two new scenarios):** Verified directly against the delta file. Confirmed: both scenarios were net-new (absent from the main synced spec), would have merged as permanent requirement content on archive despite this proposal's explicit "no scenario changes" claim, and described test infrastructure ("proven against real Postgres, not a mocked query layer") rather than facilitator-observable behavior — the wrong register for a durable spec scenario. Deleted both. The implementation note already carries this content correctly.
- **Marcus's should-fix (issue #26 disclaimer missing from design.md/tasks.md):** Agreed — the exploration notes treated this disambiguation as something to name explicitly precisely because it's the kind of thing a future reader re-derives incorrectly if it's only stated once. Added the same clause to design.md's Non-Goals and to tasks.md 4.4's code-comment instruction.
- **Marcus's minor should-fix (Error State 2's vague fixture condition), adopted with a correction:** Marcus's own suggested example — "a session/team membership row that doesn't match" — does not actually produce Error State 2. I read `content.ts`: `evaluateTeamAccess` resolves the grant (including authorization) *before* the route's `try/catch`; a non-matching membership/session row produces a null grant and a 403 via `denyNullGrant`, which is Error State 4's mechanism, not Error State 2's. Error State 2 is only reachable by a genuine exception inside the query/serialization step, *after* authorization has already succeeded. Task 3.1 now names the actual mechanism (a real, forced query failure — e.g., a temporarily revoked `SELECT` privilege, restored in `finally`) and adds a note flagging the distinction so implementation doesn't go down the authorization-denial path Marcus's example implied.
- **Rachel's condition (b) — issue #19 closing comment states partial scope and links to #38:** Adopted; see the new "Issue #19 closure communication" bullet in Impact above.
- **Rachel's condition (a) — a named owner and rough target date for issue #38 before #19 is treated as closed:** This is a staffing decision I can't make in this document — flagging it for the user to decide before treating #19 as closed, per Rachel's explicit ask. Nothing in this proposal package invents an owner or date.

Nothing in this feedback was rejected. All of it aligned with keeping the spec's register honest (product behavior, not test methodology), keeping the issue-#26/timeout disambiguation unambiguous wherever an implementer will actually be reading, and keeping the #19/#38 handoff visible rather than letting a closed ticket quietly erase the remaining user-facing gap.
