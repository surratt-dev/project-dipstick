# Design Review — Full Stack Engineer (Marcus Oyelaran)

**Change:** `websocket-specification`
**Reviewed:** design.md, proposal.md, specs/websocket-specification/spec.md, against current shipped code in `packages/shared/src/types/realtime.ts`, `packages/backend/src/realtime/ws-event-dispatcher.ts`, `packages/backend/src/realtime/vote-revealed-payload.ts`, `packages/backend/src/realtime/ws-pubsub.ts`, `packages/backend/src/realtime/connection-registry.ts`, `openspec/specs/websocket-session-authorization/spec.md`, and the frontend message-handling chokepoint in `packages/frontend/src/realtime/connectionHealth.ts`.

## Verdict

Not implementable as designed without a correction to Decision D2. Everything else — the catalog reconciliation, the lifecycle narrative, the five invariants, the facilitator/participant UX requirements, the scope boundary against the five sibling specs — holds up cleanly against the real code and I have no objection to shipping it as written. But D2's `serverTimestamp` placement has a concrete bug: it will not produce the identical-value guarantee the spec itself requires, in the exact deployment topology this codebase is built for and that a sibling spec already names as in-scope. This needs to be fixed before implementation, not filed as a follow-up.

## Blocking finding: D2's single-process assumption is false against this codebase's own architecture

D2 rejects sourcing `serverTimestamp` from the Redis-published trigger payload with this reasoning:

> "Stamping at publish time would be more architecturally distant from 'the moment the server decided to reveal' than stamping at dispatch time, and would require plumbing the value through Redis for no accuracy gain, since publish and dispatch happen in the same process today (no cross-pod fan-out delay between them for this event)."

That premise is contradicted by the code this change touches, in the same file:

`packages/backend/src/realtime/connection-registry.ts:5-17`:
> "Per-pod local connection registry ... This registry lives entirely in-process, per pod. It is NOT shared across pods — that is exactly what the Redis pub/sub channel (ws-pubsub.ts) is for."

`packages/backend/src/realtime/ws-pubsub.ts:29-31`:
> "Every backend pod's subscriber receives this message and independently decides, per locally-held candidate connection, whether to deliver it."

And a sibling spec this design cites and delegates to states the cross-pod case as a normative scenario, not a hypothetical:

`openspec/specs/websocket-session-authorization/spec.md:167,175`:
> "the application SHALL keep the delivery-time skew across all recipient connections — **local and cross-pod** — within a documented budget..."
> "**WHEN** the facilitator triggers the reveal for topic T in session S with multiple connected participants **distributed across more than one backend pod**"

Given that, here's the actual bug: `dispatchVoteRevealed` (`ws-event-dispatcher.ts:194-216`) runs once **per pod**, independently, each time that pod's Redis subscriber receives the `vote_revealed` envelope (`ws-event-dispatcher.ts:53-56`, `handleIncomingMessage`). If D2's instruction is followed literally — capture `new Date().toISOString()` once inside `dispatchVoteRevealed`, before that function's own `Promise.all` — then:

- Within one pod, all of that pod's local candidates get an identical timestamp. Correct, as far as it goes.
- Across pods, each pod computes its **own** timestamp, independently, at the moment its own Redis subscriber's message handler fires — which differs from every other pod's by however long Redis pub/sub fan-out and per-pod event-loop scheduling vary. In a single-pod dev deployment (today's `docker-compose.yml`, confirmed no replica config) this difference is invisible. It is not invisible in the multi-pod topology the architecture is explicitly built for and that the sibling spec already scopes.

This directly falsifies the new spec's own requirement. From `specs/websocket-specification/spec.md`:

> "Every recipient of one reveal receives an identical serverTimestamp ... **AND** that value does not vary based on the order in which each recipient's authorization or payload construction completed"

The scenario is written as if "recipient" only ever means "one of this pod's local candidates." It doesn't say that, and the sibling spec it delegates skew-measurement to explicitly does not restrict "recipient" that way.

**This also defeats the design's own stated test mitigation.** The Risks section promises "new tests asserting all recipients of one reveal receive an identical `serverTimestamp` value." I checked the existing suite this would extend (`ws-event-dispatcher.test.ts`, `reveal-timing-independence.test.ts`) — every existing `vote_revealed` test constructs one `ConnectionRegistry` and calls `handleIncomingMessage` once, i.e. it can only ever model a single pod. A new test written the same way will pass even with the bug present, because nothing in the current test harness constructs two independent `ConnectionRegistry` instances each running their own `handleIncomingMessage` off the same envelope to model cross-pod divergence. The mitigation as written provides no actual coverage of the property it claims to cover.

**Fix:** capture `serverTimestamp` at the point that is genuinely single-valued across the whole fan-out — publish time, on `VoteRevealedTriggerPayload` (`packages/shared/src/types/realtime.ts:80-83`), not dispatch time inside `dispatchVoteRevealed`. This is D2's own "alternative considered" (rejected on the false premise above). Concretely: the reveal endpoint (`packages/backend/src/routes/facilitator-sessions.ts`, `POST .../reveal`, per `ws-event-dispatcher.ts:188-192`'s own comment on where this fires) stamps `serverTimestamp` once when it calls the typed publish wrapper in `ws-pubsub.ts`, after commit; every pod's `dispatchVoteRevealed` then reads that one value out of `envelope.payload.serverTimestamp` and forwards it unchanged to each local candidate. This is a small change — one new field on `VoteRevealedTriggerPayload`, read-and-forward instead of generate-fresh in the dispatcher — and it is the only version of D2 that actually satisfies the spec's own "identical value" scenario in the topology the rest of the codebase assumes.

I don't think this is a reason to slow the whole change down; it's a one-field relocation, not a redesign. But it should be corrected in the design before implementation starts, because the current wording will pass code review as written (it looks exactly like the "obviously correct" shape — one variable, hoisted above a loop) and the bug only shows up under multi-pod load, which is precisely the failure mode Marcus's own persona treats as the whole point of this kind of review.

## Everything else: sound

- **Field placement (`WsClientMessage`, not `ParticipantContentView`/`FacilitatorContentView`):** correct and consistent with the existing type boundary. `team-content-views.ts` types are shared with HTTP session-history serialization (`vote-revealed-payload.ts` calls the same `serializeForFacilitator`/`serializeForMemberParticipant` functions `content.ts` uses); a WS-only delivery timestamp does not belong there. Confirmed no existing code constructs a `vote_revealed` `WsClientMessage` literal anywhere except `ws-event-dispatcher.ts:210-213`, so the additive field change has exactly one call site to update on the backend, plus the type declaration.
- **No frontend consumer currently depends on the field's absence:** grepped for `vote_revealed` handling on the frontend — none exists yet. The generic message-parsing chokepoint at `connectionHealth.ts:239-243` (`if ("eventType" in parsed)`) is the natural, and only, place to add the new `observed_latency` computation; no new dispatch infrastructure is needed on the frontend side. The design's claim that this is a small addition holds up.
- **Catalog corrections (D1) against shipped code:** spot-checked `vote_readiness_update`, `vote_revealed`, `topic_history_update` dispatch logic directly — the catalog's descriptions of grant-path gating (facilitator-only for readiness, admin-path explicit rejection for topic history) match `ws-event-dispatcher.ts` exactly, including the parts that are easy to get wrong (e.g. the admin-rejection comment at `ws-event-dispatcher.ts:255-260` matches D1/D2's framing precisely). No daylight between the design's claims and the code.
- **Scope boundary against the five sibling specs:** spot-checked stated non-goals in all five (`websocket-session-authorization`, `websocket-connection-reauthorization`, `websocket-staleness-signal`, `vote-compose-recovery`, `session-topic-lifecycle`). Found no contradiction with this design's stated non-goals. This doesn't replace the owned cross-check task in Open Questions #2 (I didn't do a full line-by-line reconciliation), but nothing I read raises a flag.
- **Invariant D4.4** (facilitator's elevated visibility can't see vote values pre-reveal) is verifiably true in code: `VoteReadinessUpdatePayload` (`realtime.ts:30-36`) has no field capable of carrying a vote value, structurally, not by convention.
- **Migration/sequencing plan** (backend field first, then frontend consumer, then docs) is the right order and matches how the codebase's other additive WS fields have shipped.

## Minor note, non-blocking

`vote-revealed-payload.ts:102` types `grant` as `Extract<SessionSubscriberGrant, {path:"facilitator"}> | Extract<...,"participant">`, but the caller (`ws-event-dispatcher.ts:206-209`) only narrows via `if (grant === null) return`, not an explicit check that `grant.path` is one of those two values. If `SessionSubscriberGrant` ever grows a third path, this becomes a silent type-assertion mismatch rather than a compile error. Not introduced by this change and not in scope for it — flagging for whoever next touches `evaluateSessionSubscriberAccess`'s return type.

## Recommendation

Send back for one correction to Decision D2 (move `serverTimestamp` generation to publish time / `VoteRevealedTriggerPayload`, forward-not-generate in the dispatcher) and the corresponding line in the Migration Plan and the wire-frame example. Everything else in design.md is ready to implement as written.
