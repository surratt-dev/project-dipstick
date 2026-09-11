# Engineering Review: vote-compose-recovery

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Scope:** design.md, proposal.md, tasks.md (GitHub issue #31), read against the current implementation of `packages/backend/src/realtime/websocket-routes.ts`, `connection-registry.ts`, `connection-token-refresh.ts`, `ws-event-dispatcher.ts`, `session-subscriber-access-helper.ts`, `vote-revealed-payload.ts`, `packages/shared/src/types/realtime.ts`, `packages/backend/src/routes/facilitator-sessions.ts`, and the `sessions`/`session_topics`/`votes` migration DDL.
**Method:** I traced every code path this design touches or assumes, rather than trusting the design's own description of that code, per my own standard for reviewing boundary-crossing work.

## Summary

Yes, this is implementable as designed, and the split between the new query module, `websocket-routes.ts`, and `session-subscriber-access-helper.ts` is clean and matches an existing precedent in this codebase almost exactly (`vote-revealed-payload.ts`). D3c's SQL is correct against the real schema — I checked the `votes` table's `UNIQUE (session_topic_id, voter_id)` constraint specifically, which is what guarantees the join can't fan out and return the wrong row. Technology choices (plain SQL over the existing `db` client, a `WsClientMessage` union addition, `sessionStorage` on the frontend) introduce nothing new to the stack.

I have two findings I want addressed before implementation, not blockers to design approval:

1. **A real hidden-coupling risk, but not the one framed in the request — it's worse.** It isn't "should the snapshot also be resent on topic-advance/reveal broadcasts." Today, an ordinary topic-to-topic advance sends **no session-scoped WS event to connected participants at all.** This matters for whoever eventually wires the compose UI (Group 8), not for this change's own contract-level scope, but it needs to be named now.
2. **A missing error path that's a bigger risk than "does registration fail or degrade gracefully" implies** — placed carelessly, a DB failure in the new snapshot call can silently prevent the SEC-26 reauthorization/token-refresh timers from ever being scheduled for that connection, not just fail to send a snapshot.

## Finding 1 — Topic advance today produces no session-scoped broadcast; the design's D3b framing undersells the gap this leaves for the compose UI

D3b reasons about *why* the snapshot is only sent at registration, not on every topic-advance/reveal broadcast: "the backend has no reliable, cheap way to distinguish a SEC-26 recovery reload... and does not need to." That reasoning is correct for *this change's* own scope — D2's restore-once gate is frontend-only and doesn't need a repeated snapshot to work.

But I traced what a **connected** session-scoped participant actually receives when the facilitator calls `POST .../topics/advance` (`facilitator-sessions.ts`, the topic-to-topic branch, lines ~1291–1337), and it's less than the design's own Context section implies. The doc comment on `SessionStateChangePayload` in `realtime.ts` says it's pushed "when session status transitions (lobby advance, session close, and — once GitHub issue #26 lands — topic advance)." That comment is stale. The actual code:

```ts
// facilitator-sessions.ts, topic-to-topic branch (nextTopicResult.rows.length > 0)
await client.query(`UPDATE session_topics SET status = 'voting' WHERE id = $1`, [nextSessionTopicId]);
await client.query(`UPDATE sessions SET current_topic_id = $2 WHERE id = $1`, [sessionId, nextTopicId]);
...
await publishTopicHistoryUpdate(teamId, { teamId, updateType: "topic_advanced", sessionId, topicId: publishNextTopicId!, updatedAt: ... });
```

`publishSessionStateChange` is called **only** in the wrap-up-entry branch (`else`, session status actually changes to `wrap_up`). The far more common topic-to-topic case publishes `topic_history_update` only — a **team-scoped** event, delivered over `/ws/teams/:teamId/events`, not the session-scoped route this design's snapshot lives on. I confirmed this isn't a documentation-vs-reality quibble by grepping the frontend: there is no existing consumer of `session_state_change` or `topic_history_update` anywhere in `packages/frontend/src` today (only `connectionHealth.ts` reacts to WS traffic, and only for `reauth_required`-adjacent connection state). So this is genuinely greenfield — nobody has hit this gap yet because nothing downstream of the facilitator's own HTTP response currently depends on it.

The practical consequence for this change: a participant who is connected and idle when the facilitator advances the topic gets **no push telling them the topic changed** — not from this design, and not from anything that exists today. When the compose UI is eventually built (task 8.1), its "is my currently-composing topic still current" question can't be answered by listening for a live update; the only data point it will have is whatever `session_registration_snapshot` delivered at the last registration, which goes stale the instant the facilitator advances. `restoreDraft`'s own logic is unaffected (it only runs once, at mount, against a registration payload it correctly waits for), but the *ongoing* compose experience the UI is presumably meant to support — not just the SEC-26 recovery case — has no server push to key off once connected.

This isn't something I'm asking this change to fix. Group 7 is scoped correctly as registration-only, and forcing a topic-advance broadcast into this change would be exactly the kind of scope creep the design's own Non-Goals are trying to avoid. What I want on record: **the design's Open Questions or Migration Plan should say explicitly that the compose UI's future implementer cannot rely on any live "topic changed" signal on the session-scoped route today**, and that closing that gap (a new broadcast, or the compose UI re-subscribing/reconnecting to force a fresh registration, or something else) is an open dependency of task 8.1 — not an implementation detail they'll casually discover is already solved. As written, D3b's "the backend's job is simpler and uniform" reads like the registration-time-only decision is a complete story; it's a complete story only for *this change's* restore-once semantics, not for the compose UI's steady-state need to know the topic advanced while connected. Naming this now costs one paragraph; discovering it during task 8.1 costs a redesign of whatever the compose UI assumed.

## Finding 2 — DB failure in `buildSessionRegistrationSnapshot`: the design doesn't specify where it's called relative to the SEC-26 timers, and that ordering is a security-relevant detail, not a style choice

D3c says the new call happens "immediately after `evaluateSessionSubscriberAccess` grants access and the connection is added to `connectionRegistry` (same place `scheduleReauthorizationSweep`/`scheduleTokenRefreshMonitor`/`checkAndRecordGraceRecovery` already run)." I read the actual handler:

```ts
// websocket-routes.ts, GET /ws/sessions/:sessionId — current code, before this change
connectionRegistry.register("session", sessionId, conn);
scheduleForceClose(conn, sessionCreatedAt, () => { ... });
scheduleReauthorizationSweep(conn, "session", sessionId, connectionRegistry, request.log);
scheduleTokenRefreshMonitor(conn, "session", sessionId, connectionRegistry, request.log);
await checkAndRecordGraceRecovery(session.userId, "session", sessionId, request.log);
```

This whole sequence runs inside a single `void (async () => { ... })()` IIFE with **no try/catch anywhere in it** — not around `evaluateSessionSubscriberAccess`, not around `checkAndRecordGraceRecovery`'s `redis.del`/`db.query` calls, nothing. That's a pre-existing property of this file, not something this change introduces. But this change adds a fourth fallible DB round-trip into that exact unprotected sequence, and — critically — *where* it's inserted determines the blast radius of a failure:

- If `buildSessionRegistrationSnapshot` throws and the call is placed **before** `scheduleReauthorizationSweep`/`scheduleTokenRefreshMonitor` (which "same place" doesn't rule out), the thrown error aborts the rest of the async function. Those two calls — which schedule the SEC-26 silent-refresh and re-authorization timers this application depends on for a connection's session to ever be re-checked — **never run**, while the connection is already registered in `connectionRegistry` and already receiving every other broadcast event indefinitely. That's not a degraded UX for this feature; it's a live connection with no security timers attached, caused by an unrelated read failing.
- Separately: `void (async () => {...})()` with no `.catch` means an exception here is an **unhandled promise rejection**. I checked `index.ts` and `app.ts` — there is no `process.on("unhandledRejection", ...)` registered anywhere in this backend. Since Node 15, the default behavior for an unhandled rejection is to crash the process. A single transient DB blip during a WS registration — something that will happen in production, not a hypothetical — could take down the whole pod, not just that one connection.

Neither of these is new to this design; they're latent in the existing registration handler today (a `db.query` failure inside `checkAndRecordGraceRecovery` has the identical exposure right now). But the design is silent on this exact question ("does registration fail, or degrade gracefully?") for the one new fallible call it's adding, and the answer as currently specified is neither — it's "undefined, and possibly catastrophic, depending on where the implementer happens to paste the line." I don't think this warrants relitigating the whole file's error-handling posture as part of this change, but I want two things decided before task 7.4 is implemented, not left to whoever happens to write the code that day:

1. **Ordering**: place the new call *after* `scheduleReauthorizationSweep`/`scheduleTokenRefreshMonitor`/`checkAndRecordGraceRecovery`, not interleaved before them, so a throw here can never prevent those from running. This is a one-line placement decision, not a redesign.
2. **Containment**: wrap the new call (minimally; ideally the whole handler, but that's a larger, separate cleanup) in a try/catch that logs at `warn` and simply skips the `safeSend` — never sends a partial/garbage snapshot, never closes the connection over it. This is a safe degrade: the frontend side (D3, D4.4) already requires `restoreDraft` to be un-callable until a registration payload arrives, so "no snapshot arrives this registration" degrades to "this tab's draft, if any, is never restored this load" — silent-discard-shaped, which is exactly this design's own stated bias (the governing principle: "wherever the restore logic is in doubt, the answer is discard, not restore"). That's a good outcome for a DB hiccup, and it's already consistent with the design's philosophy — it just isn't written down anywhere as the specified behavior for this specific failure mode.

## What I verified and found correct

- **D3c's SQL is right for the schema as it exists.** `votes` has `UNIQUE (session_topic_id, voter_id)`, so `LEFT JOIN votes v ON v.session_topic_id = s.current_topic_id AND v.voter_id = $2` can return at most one matching row — no fan-out risk, `(v.id IS NOT NULL) AS has_locked_in` is safe. I also confirmed lock-in writes a real `votes` row at lock-in time (`sessions.ts`'s `INSERT INTO votes ... ON CONFLICT (session_topic_id, voter_id) DO UPDATE`), not only at actual reveal — despite the misleadingly-named `revealed_at NOT NULL` column, which is set to `NOW()` at lock-in, not at reveal. D3c's join is querying the right table for "has this user locked in," not a table that's empty until reveal.
- **Boundary cleanliness.** The new module doesn't duplicate or reach around `evaluateSessionSubscriberAccess` — it's called only after that grant resolves, exactly mirroring how `vote-revealed-payload.ts`'s `buildVoteRevealedPayload` is a separate, DB-reading module called only after a grant, never itself making the access decision. Signature order `(userId, sessionId)` matches `evaluateSessionSubscriberAccess(userId, sessionId)`'s existing convention. This is the right shape and I wouldn't change it.
- **Delivery mechanism reuse.** Using `safeSend(registry, "session", sessionId, conn, ...)` is the correct, already-proven path (identical to `reauth_required`'s send in `connection-token-refresh.ts`) — no new send mechanism, no risk of missing the readyState-check-before-send discipline `connection-registry.ts` documents as load-bearing.
- **No-cache discipline.** D3c's "one live DB read, no cache" is consistent with `evaluateSessionSubscriberAccess`'s own documented cache prohibition — this design doesn't introduce a second caching convention to keep in sync with the first.
- **Zero-row edge case is real but low-risk.** If `buildSessionRegistrationSnapshot`'s query returns zero rows (session deleted between the grant and this read), the design doesn't say what happens. Given `evaluateSessionSubscriberAccess` already verified the session exists moments earlier, this is reachable only as a genuine race, same class as D4's condition (iv). Worth a one-line note in D3c (return `null` / skip the send) alongside Finding 2's containment fix, not a separate concern.
- **Type additions are consistent with the shared module.** `SessionTopicStatus` already includes `"voting"`; `SessionStatus` already covers `lobby`/`pre_session`/`wrap_up`. No new enum values needed, matching the design's claim of "no database schema changes."

## Recommendation

Proceed with implementation. Before tasks.md's Group 7 is executed:

1. Add a sentence to design.md (Open Questions or Migration Plan) naming that ordinary topic-to-topic advance currently produces no session-scoped WS push to connected participants, and that this is an open dependency for task 8.1's compose UI — not something D3b already solved for the steady-state (post-registration) case (Finding 1).
2. Add an explicit ordering + failure-containment note to D3c: the new call must be placed after the SEC-26 timer-scheduling calls, and its failure must be caught and treated as "send nothing this registration," never allowed to abort the timers or propagate as an unhandled rejection (Finding 2).

Neither changes the design's shape or scope. Both are the difference between a decision made now, on the record, and one discovered later under worse conditions — which is the whole reason I look at boundaries before I look at anything else.
