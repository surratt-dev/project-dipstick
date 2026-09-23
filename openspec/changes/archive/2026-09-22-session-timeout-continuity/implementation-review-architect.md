# Implementation Review — Solution Architect (Ingrid Sollenberger)

**Change:** session-timeout-continuity
**Reviewed:** diff against `main` on branch `agent-team/133-session-timeout-continuity`, against `design.md`'s six decisions.

## Verdict: No blocking findings.

The implementation matches every architectural decision I was asked to check, and matches it closely enough that I read the diff as a faithful execution of the design rather than a reinterpretation of it.

## Findings by decision

**Decision 5 (fan-out, not local iteration) — confirmed.** `publishFacilitatorConnectionStatus` (`ws-pubsub.ts`) goes through `publishWsEvent` onto the shared `ws:events` Redis channel, exactly like `publishParticipantJoined`/`publishParticipantLeft`. `ws-event-dispatcher.ts` adds a `facilitator_connection_status` case to the existing `eventType` switch and runs the same per-candidate `evaluateSessionSubscriberAccess` check every other case runs, filtering the facilitator's own `subscriberPath` out. Both new call sites in `websocket-routes.ts` sit immediately adjacent to the existing `recordFacilitatorConnectionAudit("connected"/"disconnected", ...)` calls (issue #94) — one fact, two consumers, as specified. I ran the relevant test files: `ws-pubsub-integration.test.ts` includes a real-Redis PUBLISH/SUBSCRIBE test that delivers `facilitator_connection_status` to a participant-scoped connection while excluding a facilitator-scoped one — this is exercised end-to-end, not just mocked. The "prior disconnect" Redis flag (`facilitator_connected:<sessionId>`) is read-before-write and cleared at the wrap-up transition in `facilitator-sessions.ts`, matching the stated lifecycle boundary.

**Decision 6 (lift `useConnectionHealth`, no second socket) — confirmed.** `SessionConnectionHost.tsx` now owns the `useConnectionHealth(connect)` call and passes `{ state, socket }` down to `ConnectionStatusBanner` (now a pure props-driven component) and to the new `FacilitatorReconnectIndicator`, which attaches its own `message` listener to the same socket via `addEventListener` in `facilitatorConnectionStatus.ts`. No second WebSocket connection is opened. `FacilitatorReadinessGrid.tsx` is correctly left untouched by this refactor — it still calls `useConnectionHealth` directly for the facilitator's own connection, which is the right boundary since the new indicator is participant-facing only.

**`returnTo` allow-list — confirmed.** In `auth.ts`, `rejectReturnToCharacters` runs before the allow-list regex match and rejects CR/LF, backslash, `://`, and leading `//`. The allow-list patterns pin `:id` to the full UUID shape (`[0-9a-fA-F]{8}-...`), not a loose wildcard, and tolerate an optional `?`-prefixed query suffix as the design specifies. The value is stored in the same `state` payload as `pendingJoinToken` and retrieved via a single atomic `redis.getdel` in `/auth/callback` — this makes it single-use by construction, and nothing in the login or callback handler branches on OIDC provider; the mechanism is entirely in this app's own routes, consistent with the multi-provider OIDC posture this project has committed to elsewhere.

**`ReauthRequiredTreatment` role-aware copy — confirmed, not forked.** `role` conditions only whether `VOTE_LOSS_SENTENCE` is appended; the ARIA role (`role="alert"`), the style, and the CTA's navigation branch (`returnTo` present or not) are unconditional and identical across both roles. This is the one-conditional-inside-a-shared-component shape Decision 4 called for, not two diverging code paths.

## Secondary observations (non-blocking)

- `publishFacilitatorConnectionStatusForTransition`'s disconnect-time call resolves session status via a fresh `db.query` (no live grant available at disconnect), then wraps the whole publish attempt in try/catch that only logs a warning on failure. That's the right failure posture for a best-effort, cause-blind UI signal riding alongside an audit write that has its own independent error handling — a dropped broadcast degrades to "indicator doesn't update" rather than anything session-correctness-affecting.
- The known limitation named in Decision 5 (no duration cutoff distinguishing a blip from a permanent facilitator loss) is carried into the component's own comments and tracked as issue #145, not silently left for a future reader to discover. That's the standard I look for.

## Scope not covered by this review

I did not re-review the HTTP-side 401 parity gap (design.md's Open Questions) since it's explicitly deferred as a follow-up issue, not part of this change's shipped surface. I also did not re-litigate the two requirement-narrowing MODIFIED deltas' security rationale — that's Decision 1's and Decision 3's own text, and Tomás's/Marcus's design-stage reviews already pressure-tested it before implementation started.
