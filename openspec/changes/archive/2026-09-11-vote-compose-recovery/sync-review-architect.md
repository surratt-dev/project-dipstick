# Sync Review — Solution Architect (Ingrid Sollenberger)

**Change:** vote-compose-recovery (GitHub issue #31, branch `agent-team/vote-compose-recovery`)
**Reviewed:** synced capability spec at `openspec/specs/vote-compose-recovery/spec.md`, against the actual implementation and its adjacent specs.

## Scope of this review

My review discipline on this project is architectural boundaries, state authority, access control, and operability — not domain/UX correctness. For this sync review specifically, I focused on whether the newly-synced spec's factual claims (what's built, what's tested, what talks to what) match the code, since a spec that overclaims verification is exactly the kind of implicit, undocumented risk I exist to catch.

## Method

- Read the synced spec (`openspec/specs/vote-compose-recovery/spec.md`) against the delta it was carried over from (`openspec/changes/vote-compose-recovery/specs/vote-compose-recovery/spec.md`).
- Read all four named implementation files: `packages/shared/src/types/realtime.ts`, `packages/backend/src/realtime/session-registration-snapshot.ts`, `packages/backend/src/realtime/websocket-routes.ts` (via `git diff`), `packages/frontend/src/realtime/voteDraft.ts`.
- Located and read test names for both the frontend unit tests (`voteDraft.test.ts`) and backend unit + integration tests (`session-registration-snapshot.test.ts`, `websocket-routes-registration-snapshot.test.ts`).
- Cross-checked `tasks.md` Groups 4, 6, 7, 8 checkbox state against what the spec claims is verified vs. deferred.
- Diffed `openspec/specs/websocket-connection-reauthorization/spec.md` and `openspec/specs/session-topic-lifecycle/spec.md` for unintended changes.

## Findings: no drift

**Requirement 1 (client-local persistence).** Matches `persistDraft` exactly: unconditional write on every change, no debounce/unload hook, no network call, single sessionStorage key. Frontend tests confirm the "writes expected shape, overwrites on repeat call" and "no network call / no other storage key touched" scenarios. The spec's Verification-status note under the *second* scenario ("never becomes a second source of submitted vote state") correctly scopes the untested gap to needing a real submission path — accurate, not overclaimed.

**Requirement 2 (single-use restore gate).** Matches the module-scope `restoreAttempted` flag in `voteDraft.ts` exactly, including that it's consulted before any storage read and cleared unconditionally after one attempt. Backed by matching unit tests.

**Requirement 3 (restoration subordinate to server state + the `session_registration_snapshot` payload).** This is the one place the synced spec's *wording* diverges meaningfully from the delta — and the divergence is a correction, not drift:
- The delta's original phrasing implied the ordering guarantee could only be verified at the integration level once the compose UI exists.
- The synced spec instead states the ordering guarantee and the payload send are "both implemented and verified today," at contract level (Group 4 frontend tests) and integration level (Group 7 backend tests), with only the `restoreDraft`-to-real-compose-control wiring (task 8.1) left open.
- This is factually correct: `websocket-routes-registration-snapshot.test.ts` contains exactly the tests the note cites by name — exactly-one-message-before-any-other-event, rejected-connection-receives-nothing, two failure-containment cases (throw and null-return), and the per-registration-freshness case (D3b, "every registration, not just the first"). All five are present and match the note's description precisely.
- The `websocket-routes.ts` diff confirms the ordering claim in code: `evaluateSessionSubscriberAccess` gates the connection before registration even happens (closes with `CLOSE_UNAUTHORIZED` if denied), and `sendSessionRegistrationSnapshot` is called strictly after the SEC-25/26 scheduling calls, with its own try/catch that never throws past itself — matching the "composes with the existing grant, doesn't leak past it" and "failure containment" language verbatim.
- Payload shape in `packages/shared/src/types/realtime.ts` (`SessionRegistrationSnapshotPayload`) matches the spec's documented shape field-for-field, and is properly re-exported from `packages/shared/src/index.ts`.
- `hasLockedInVote` self-disclosure-only claim matches the SQL in `session-registration-snapshot.ts` (`v.voter_id = $2`, scoped to the connecting user), confirmed further by unit test case (iv) "another user's vote row does NOT affect this user's hasLockedInVote."

**Requirement 4 (enumerated discard conditions).** Matches `restoreDraft`'s four discard branches, including the check-order rationale (lock-in checked last so it always wins) reproduced almost verbatim from the code's own comments. No discrepancy.

**Requirement 5 (no-flash / no facilitator-grid-state rendering guarantees).** Correctly marked as contract-level-only via code review, not integration-tested. Confirmed: `FacilitatorReadinessGrid.tsx` does not appear in the working-tree diff (untouched), and a dedicated grep-based test (`connectionHealth.grep.test.ts`, "FacilitatorReadinessGrid.tsx non-disclosure invariants") exists to enforce this by static check rather than render test — exactly what the spec's note describes as the current verification method.

**Build status / Purpose section.** Accurately describes Group 8 (compose-UI wiring, task 8.1) as not started (`tasks.md` shows it unchecked, `[ ]`), correctly frames it as blocked on a UI that doesn't exist yet and on issue #32's redirect trigger, and correctly states Group 7 (backend) is real, in-scope, already-shipped work rather than a placeholder.

## Adjacent specs: clean, no incidental changes

`git diff --stat` against both `openspec/specs/websocket-connection-reauthorization/spec.md` and `openspec/specs/session-topic-lifecycle/spec.md` returns empty — zero lines changed. `git status` shows only the new `openspec/specs/vote-compose-recovery/` directory as untracked; nothing else under `openspec/specs/` was touched. The sync did not leak any edits into capabilities it merely reads from.

## Architectural read

Nothing here changes my read from the design/implementation review checkpoints: state authority stays server-side (the frontend module is discard-by-default and cannot originate a value without the server-sent registration payload), the new WebSocket message composes with an existing access-control gate rather than adding a parallel one, and failure containment around the new DB read is explicit and tested (throw or null-return degrades to "no snapshot this registration," never a dropped connection or unhandled rejection). No new persistent store, no new authorization surface. This is within the boundaries I'd expect for a client-local UX recovery mechanism layered on infrastructure two prior changes already established.

## Verdict

**Sync is clean. Ready to archive** from an architectural/drift-verification standpoint. No overclaiming, no underclaiming, no incidental edits to adjacent specs. The one wording change between delta and synced spec (Requirement 3's verification note) is a factual improvement, and I verified it against the actual test suite rather than taking it on faith.
