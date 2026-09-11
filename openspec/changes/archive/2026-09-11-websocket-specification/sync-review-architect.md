# Sync review — websocket-specification (Solution Architect)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Verify no drift between the newly-synced main spec (`openspec/specs/websocket-specification/spec.md`) and (a) shipped code, (b) `design.md`/`tasks.md` in the change directory. Plus a ruling on the task 3.3 / D4 invariant-5 tension.

## (a) Spec vs. shipped code — spot-check results

All claims checked resolve cleanly against the code as it stands today. No drift found.

| Spec claim | Code location | Result |
|---|---|---|
| `serverTimestamp` captured once, at publish time, before the envelope is published — never inside `dispatchVoteRevealed` | `packages/backend/src/routes/facilitator-sessions.ts:1109-1113` stamps `serverTimestamp: new Date().toISOString()` in the `publishVoteRevealed` call, after `COMMIT` (line 1093) and with an inline comment citing this exact D2 rationale | Confirmed |
| Every pod's `dispatchVoteRevealed` reads `envelope.payload.serverTimestamp` and forwards it unmodified, never generates a fresh timestamp | `packages/backend/src/realtime/ws-event-dispatcher.ts:213,226` — `const { serverTimestamp } = envelope.payload;` then forwarded verbatim into each recipient's message; no `Date` call anywhere in `dispatchVoteRevealed` | Confirmed |
| Field placement: `serverTimestamp` on `VoteRevealedTriggerPayload` (envelope) and the `vote_revealed` variant of `WsClientMessage`, not on the content-view types | `packages/shared/src/types/realtime.ts:91,151,222`; grep for `serverTimestamp` in `team-content-views.ts` returns nothing | Confirmed |
| Frontend: `voteRevealedLatency.ts` attaches via `addEventListener` on the socket `useConnectionHealth` returns, computes `observed_latency_ms = Date.now() - Date.parse(serverTimestamp)`, logs via `console.info`, best-effort POSTs to `/api/v1/sessions/:sessionId/reveal-latency`, never throws | `packages/frontend/src/realtime/voteRevealedLatency.ts` — matches line for line, including the `.catch(() => {})` no-throw guarantee | Confirmed |
| Reveal-latency endpoint reuses `evaluateSessionSubscriberAccess` unmodified for authorization, logs via `emitAuditEvent(..., "session.reveal_latency_observed", ...)` | `packages/backend/src/routes/sessions.ts:439,460` | Confirmed |
| Known gap: `observedLatencyMs` has no upper-bound validation | `sessions.ts:450` validates only `Number.isFinite(observedLatencyMs)` — no ceiling check | Confirmed, gap is real and exactly as described |
| Known gap: reveal-latency endpoint not documented in `REST API Contract.md` | Grepped the contract doc for `reveal-latency` — zero hits | Confirmed, gap is real |
| `requirements/design/REST API Contract.md` Appendix D correction note (task 4.1) | Line 2958, dated 2026-09-11, consolidated note covering all seven corrected names, matches the spec's D1 table | Confirmed |
| `todo.md` "WebSocket Specification" item checked off with a pointer (task 4.2) | `requirements/todo.md:23-26`, `[x]`, pointer to the change-directory spec copy | Present and worded as task 4.2 specified — **but see note below** |

**One pending-task note, not a spec/code drift:** `todo.md`'s pointer still targets the change-directory path (`openspec/changes/websocket-specification/specs/websocket-specification/spec.md`), not the now-synced `openspec/specs/websocket-specification/spec.md`. Task 6.6 ("at spec-sync/archive time, update `todo.md`'s pointer... to the final path") is the task that closes this, and it is still unchecked in `tasks.md`. Since sync has now happened, task 6.6 is actionable — flagging so it isn't lost, not blocking anything.

## (b) Spec's gap callouts vs. tasks.md's actual open-task state

Checked both callouts the synced spec makes against what `tasks.md` shows as open, as of this review:

- **Skew-measurement gap** (spec.md, end of the `observed_latency` requirement): states Owner Marcus Oyelaran, tracking issue "not yet filed," archiving gate open. Matches `tasks.md` 5.4 (`[ ]`, owner Marcus Oyelaran, unfiled) and 6.5 (`[ ]`, archiving gate). Consistent — no drift.
- **Two `[PREF]` events** (spec.md Purpose paragraph and dedicated requirement): states "no follow-up issue filed... implementation unscheduled." Matches `tasks.md` 5.3 (`[ ]`, owner Marcus Delgado, unfiled) and 6.4 (`[ ]`, archiving gate). Consistent — no drift.

Both callouts accurately reflect present reality; neither overstates nor understates what's actually open.

## Ruling on the task 3.3 / D4 invariant-5 tension

Confirmed at the now-synced main-spec level: invariant 5 ("nothing in this catalog is configurable") does not appear anywhere in `openspec/specs/websocket-specification/spec.md`, in any form, as either a standalone requirement or folded into another requirement's prose. This is unchanged from the change-directory delta copy — the sync did not alter this outcome.

**I agree the prior architect implementation review was correct, and it holds at this level too.** A requirement needs a checkable acceptance condition — something a scenario can assert against. "Nothing is configurable" isn't a property of the system today that a `WHEN`/`THEN` scenario can exercise; it's an absence of a feature that was never proposed. Writing it as a `spec.md` requirement would either be vacuously true (nothing to fail against) or would require inventing a negative-space scenario ("WHEN no configuration surface exists, THEN...") that tests nothing real. D4's framing — review guidance for whoever designs or implements a future change that touches this catalog, not an acceptance condition on this one — is the architecturally sound call, and `spec.md` correctly reflects it by omission.

**Task 3.3's wording should be corrected**, not left as-is. As written, "verify the five ritual-integrity invariants... each appear as standalone, traceable requirements" states a literal completion bar that item 5 cannot satisfy without becoming vacuous — which is exactly why it needed a hand-written verification note explaining the departure rather than a clean checkmark. That note is doing the wording's job after the fact. Two independent reviews (the prior implementation review and this one) have now reached the identical conclusion; the cheap fix is to correct the source of truth once, so a future reader doesn't have to re-derive "why isn't this 5-for-5" from a buried note. Suggested replacement text for task 3.3:

> Verify ritual-integrity invariants 1–4 (no pre-reveal leak, measured simultaneity, no reconnection side door, facilitator visibility exclusion) each appear as standalone, traceable requirements in the spec, not folded into prose. Confirm invariant 5 ("nothing in this catalog is configurable") is intentionally carried as design/implementation-review guidance only, per `design.md` D4 — not as a `spec.md` acceptance condition — since it has no checkable behavior to gate.

## Bottom line

No drift found between the synced main spec and either shipped code or the change directory's `design.md`/`tasks.md`. One outstanding housekeeping item (`todo.md`'s pointer, task 6.6, now actionable). One wording correction recommended for `tasks.md` task 3.3 to stop this tension from being re-litigated on a future pass.
