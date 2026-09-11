# Implementation Review — Solution Architect (Ingrid Sollenberger)

**Change:** `websocket-specification`
**Reviewed:** `git diff`/`git status` on `agent-team/websocket-specification` against `design.md` and `tasks.md`, plus the code paths the diff touches (`packages/backend/src/routes/facilitator-sessions.ts`, `packages/backend/src/routes/sessions.ts`, `packages/backend/src/realtime/ws-event-dispatcher.ts`, `packages/shared/src/types/realtime.ts`, `packages/backend/src/auth/audit-logger.ts`, the new `packages/frontend/src/realtime/voteRevealedLatency.ts`, and the relevant test suites). I ran the affected backend and frontend test suites directly rather than trusting the reported counts.

**Verdict: Approve.** The code matches Decision D2 exactly, the cross-pod test is real, the scope-drift call on the frontend module was the correct one, and I concur with not adding an invariant-5 requirement to spec.md. Two small notes below, neither blocking.

---

## 1. Does the implementation match D2 exactly?

Yes, verified against the actual diff, not the design's description of it.

- `VoteRevealedTriggerPayload` (`packages/shared/src/types/realtime.ts`) gains `serverTimestamp: string`, and the `vote_revealed` variant of `WsClientMessage` gains it as a sibling of `payload`, not folded into `ParticipantContentView`/`FacilitatorContentView`. Matches D2's explicit field-placement rationale (those types are shared with HTTP session-history serialization, which has no delivery-latency concept).
- `packages/backend/src/routes/facilitator-sessions.ts`, `POST .../reveal`: `serverTimestamp: new Date().toISOString()` is set on the `VoteRevealedTriggerPayload` argument to `publishVoteRevealed`, at the same publish-after-commit call site the design names, and only there.
- `packages/backend/src/realtime/ws-event-dispatcher.ts`, `dispatchVoteRevealed`: `const { serverTimestamp } = envelope.payload;` sits **textually outside** the `Promise.all`, and the forwarded wire frame uses that destructured value — no `new Date()` call anywhere in this function. This is exactly the placement Tomás Ferreira's security review flagged as the one place a correct design could regress into the per-recipient timing leak D2 rejected ("confirm... the capture lands textually outside the `Promise.all`... not merely 'before the loop starts' in a way a future edit could accidentally move inward"). It holds.
- No other call site constructs a `vote_revealed` `WsClientMessage` literal (grepped; matches Marcus Oyelaran's design-review finding that this is a single call site).

This is the corrected D2, not the original rejected dispatch-time version. Publish-once, forward-unmodified, per-pod-independent — all three properties are present in the diff, not just asserted in comments.

## 2. Is the cross-pod test actually testing what it claims?

Yes. `ws-event-dispatcher.test.ts`'s new `describe("serverTimestamp cross-pod forwarding...")` block constructs two independent `ConnectionRegistry` instances, serializes **one** envelope to a raw string (`JSON.stringify(envelope)`, modeling what one Redis `PUBLISH` actually fans out as), and calls `handleIncomingMessage` on each registry independently, with independent mocked DB grant lookups, asserting both delivered messages carry the identical `serverTimestamp`. This is the exact shape Marcus Oyelaran's design-review finding said the existing suite couldn't produce — every pre-existing `vote_revealed` test constructs exactly one registry. I ran it (along with the full `ws-event-dispatcher.test.ts`, `sessions.test.ts`, `facilitator-sessions.test.ts`, and the new frontend `voteRevealedLatency.test.ts`): 64 backend + 5 frontend tests pass.

One nit, not blocking: the test's negative case (catching a dispatch-time-capture regression) relies on the two `handleIncomingMessage` calls not producing the same `new Date()` value if the code regressed — i.e., if a future edit reintroduced per-pod generation, the test would very likely fail, but isn't certain to, on a fast enough machine within the same millisecond. A `vi.useFakeTimers()` with two distinct `Date.now()` values advanced between the two calls would make this deterministic rather than probabilistic. Given the test is exercising real code paths (not mocking `Date`), I don't consider this worth blocking on — it does test the real property, it just doesn't have a hostile-timing guarantee. Worth a follow-up polish, not a rejection.

## 3. Is Marcus's endpoint/module split a reasonable interpretation, or unauthorized scope drift?

Reasonable, and I checked this independently rather than taking the report at face value.

I confirmed there is no live-session voting UI: `SessionConnectionHost.tsx` is explicitly scoped, by a **different** change's design.md (`websocket-staleness-signal`, Decision D9), as "the smallest surface that mounts `ConnectionStatusBanner` against a real session WebSocket connection — not a feature-complete live-session page," with topic display, vote casting, and reveal rendering named as out of scope there. `useConnectionHealth` does return a live `socket` handle, but `ConnectionStatusBanner` destructures only `{ state }` from it and `SessionConnectionHost` never calls the hook directly — so there is no place in the current component tree that already holds a `WebSocket` reference for a session and could attach a second listener without restructuring that composition. Wiring `attachVoteRevealedLatencyLogger` in would mean extending `SessionConnectionHost.tsx` past the scope another change's design explicitly bounded it to, from inside a change titled `websocket-specification`. That's the real reason this isn't currently attachable, not a hand-wave.

Given that, building the backend endpoint plus an unwired, independently-testable frontend module is the correct shape:
- It closes the actual FR-4.6.1 obligation the design assigns to this change (tasks 2.4/2.5) with real, tested code, rather than leaving the requirement's client-side half undone because the wiring point doesn't exist yet — consistent with Devon's and Marcus Delgado's stated position elsewhere in this design that "documenting a HARD requirement as not-yet-true is the paper-compliance failure mode this change exists to prevent."
- It does **not** invent a new UI, a new authorization model, or new reconnection-safety behavior — the three things this design's own Non-Goals reserve for a future onboarding/live-session-UI change. `computeObservedLatencyMs` and `attachVoteRevealedLatencyLogger` are pure/composable and sit ready for whatever component eventually holds the socket reference; that's a reasonable bet on a stable interface, not scope creep.
- The frontend module's own header comment states its integration point precisely (`connectionHealth.ts`'s `addEventListener`-based design "specifically so a consumer can attach an independent listener to the same returned socket") and is honest that it isn't attached yet. Nothing here is presented as done when it isn't.

This is a correct call, not scope drift. Scope drift would have looked like building a voting UI to give the module somewhere to live, or silently wiring it into `SessionConnectionHost.tsx` without going back to that change's owners. Marcus did neither.

**Architectural boundaries:**
- Auth reuse is clean: the new `POST /api/v1/sessions/:sessionId/reveal-latency` calls `evaluateSessionSubscriberAccess(session.userId, sessionId)` with the identical signature used at every other call site in this codebase (`ws-event-dispatcher.ts`, `connection-reauthorization.ts`, `websocket-routes.ts`, and the existing handlers in `sessions.ts` itself). No parallel or weakened check was introduced. This is the right gate: only someone who could legitimately have received this session's `vote_revealed` event may report a latency observation for it.
- Audit event naming (`session.reveal_latency_observed`) matches the existing `session.<verb>_<past-participle>` convention used by every other entry added in this same lineage (`session.access_revoked_live`, `session.token_refresh_failed_live`, `session.connection_recovered`).
- The 403 error shape (`category: "invalid_request"`) matches the convention already established elsewhere in this same file (`sessions.ts`), not a newly-invented category.
- Routing the metric through `emitAuditEvent` on the same structured-log pipe as `session.access_revoked_live` is a real, verifiable satisfaction of Tomás Ferreira's access-control confirmation (task 2.8) — it's the same function, same pipe, not a new destination described as equivalent.

## 4. Is Marcus's non-resolution of the invariant-5 tension the correct call?

Yes, agree with leaving it unresolved rather than adding a requirement.

`design.md` D4 is unambiguous: invariant 5 ("nothing in this catalog is configurable") is carried "as review guidance for whoever reviews this spec at design/implementation time, not as an acceptance condition, since nothing currently proposed introduces an SLA toggle or similar." `tasks.md` 3.3's checklist wording ("each appear as standalone, traceable requirements") is broader than that and creates the tension Marcus flagged rather than resolved. I read this as a wording gap in the task-list summary of D4, not a considered decision to promote invariant 5 to a requirement — nothing in `design.md`'s Decisions, Risks, or Migration Plan sections argues for a configurability requirement, and no code in this diff or its siblings introduces anything resembling a toggle. A requirement with no corresponding acceptance condition to check ("nothing is configurable," with nothing in the system that could be configured) would be a vacuous spec.md entry — exactly the kind of unfalsifiable statement that erodes trust in the rest of the document's requirements over time. Adding it unilaterally to satisfy a checklist's literal wording, against the design's explicit framing, would be the wrong instinct even though it's a smaller change than the alternative.

The correct resolution is what happened: implement against `design.md`'s stated intent (the authoritative decision record), and surface the tension to the team lead rather than silently claiming 5-for-5 or silently rewriting the task. That is the right call for anyone in an implementer role to make on their own — spec content decisions are not implementer-unilateral, and this wasn't treated as one.

## 5. Pattern consistency with existing code

Checked directly, not assumed:
- `evaluateSessionSubscriberAccess(userId, sessionId)` call signature is identical to five other call sites across `ws-event-dispatcher.ts`, `connection-reauthorization.ts`, and `websocket-routes.ts`.
- `AuditEventName` union entries follow the same dot-namespaced, past-tense convention throughout `audit-logger.ts`; the new entry's placement and inline comment style (explaining what it is, what it isn't, and citing the owning decision) matches the three immediately preceding entries added by the `websocket-connection-reauthorization`/`vote-compose-recovery` lineage.
- The new route handler in `sessions.ts` follows the same `app.post<{ Params; Body }>(...)` typed-handler shape as the other two POST handlers already in that file, including the same manual body-shape validation style (no schema library in use elsewhere in this file either).
- Comment style throughout the diff (attributing each nontrivial line to a Decision ID, a task number, or a named reviewer's finding) matches the standing convention across this whole spec lineage, which makes this diff easy to audit against its own design record — I did not have to reconstruct intent from the code alone anywhere in this review.

## Minor, non-blocking notes

1. Cross-pod test's negative case is timing-probabilistic rather than deterministic (see §2). Worth a follow-up `vi.useFakeTimers()` polish, not a blocker.
2. `tasks.md` still shows 2.7 and 2.9 unchecked, correctly — those name specific ceremony roles (Full Stack Engineer + Security Analyst design-review sign-off, implementation-review sign-off) that this review and the prior design-review-engineer/design-review-security passes satisfy the substance of, but the checkboxes themselves are for the team lead to close, not for me to check on the implementer's behalf.

Everything else in this diff — field placement, dispatch-time forwarding, test coverage, the new endpoint's authorization and audit-logging integration, and the decision not to force a UI attachment point that doesn't exist yet — reflects the corrected D2 and the rest of `design.md` accurately, and I have no objection to this being archived once the remaining named gates (5.3/5.4 issue filings, 6.1–6.6 sign-offs) are closed.
