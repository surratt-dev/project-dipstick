# Engineering Review — pre-session-action-item-review

Reviewer: Marcus Oyelaran (Full Stack Engineer)
Scope: design.md, proposal.md, spec.md, tasks.md, cross-checked against `packages/backend/src/routes/facilitator-sessions.ts`, `packages/backend/src/auth/session-subscriber-access-helper.ts`, `packages/backend/src/routes/content.ts`, `packages/frontend/src/pages/SessionLobbyPage.tsx`, `SessionConnectionHost.tsx`, `FacilitatorConnectionHost.tsx`, and `App.tsx`.

## Verdict

The backend half (Decisions 1, 2, 5-partial, 7) is implementable as written and matches the code it claims to reuse — I checked `fetchPreSessionActionItems`, `computeStalenessLevel`, and `evaluateSessionSubscriberAccess` against the design's descriptions and they're accurate. The frontend half has a blocking gap and an unreconciled inconsistency that need to be resolved before tasks.md section 4/5 can be implemented as scoped. I'm not comfortable signing off until those two are addressed.

## Blocking findings

### 1. No frontend trigger for `POST /start` exists anywhere in this codebase — this change doesn't build one either

I grepped the entire frontend for any reference to `/start`, `begin-voting`, `Start Session`, or `Begin First Topic`: nothing. `SessionConnectionHost.tsx` and `FacilitatorConnectionHost.tsx` are stub hosts that only mount connection-health/readiness components against stub data — neither calls `POST /start`. There is no facilitator-side "Start Session" control anywhere in `packages/frontend/src`.

This means: nothing in the current codebase can ever move a session from `lobby` to `pre_session`. Design.md's Context section treats `POST /start` as "already transitions a session from lobby to pre_session" as a settled fact about the write path, which is true on the backend — but the *only way to invoke it* is a UI control that doesn't exist and that neither proposal.md's "What Changes," design.md's Decisions, nor tasks.md sections 4/5 schedule building. Tasks.md jumps straight to "the review component, calling the Decision 1 endpoint" (task 5.1) as if a session already reliably arrives in `pre_session`.

Without that control, this entire feature is unreachable in the running application — there's no way to manually or automatically verify task 7.1's two-browser check, because nothing gets a real session into `pre_session` in the first place. Either:
- this is a real gap and a "Start Session" button/control needs to be added to scope (most likely on `SessionLobbyPage`'s `lobby` branch, per Decision 3's own three-branch structure — it would be a natural, small addition to the same component work already planned), or
- it already exists somewhere I haven't found and the design should cite the file/component directly so this isn't rediscovered as a blocker mid-implementation.

I'd bet on the former given the grep result, and I'd rather this get named now than discovered when someone can't actually get a session into `pre_session` to test against.

### 2. Decision 3's recommended session-status fetch requires a `teamId` param that `SessionLobbyPage` does not have

Decision 3 says the page "fetches session status on mount" via `GET /api/v1/teams/:teamId/sessions/:sessionId` (`content.ts:499`), which requires `teamId` as a path parameter and is authorized via `evaluateTeamAccess`. But `SessionLobbyPage`'s actual route is `/session/:sessionId` (`App.tsx:83`) — no `:teamId` in the URL — and `AuthSession` (`packages/shared/src/types/auth.ts`) carries `teamMemberships: Array<{teamId, ...}>`, a *list*, not a single team. A user can belong to more than one team, so there's no way to derive "the" teamId for this session from the auth session alone without an extra lookup that nothing in this design specifies.

Two follow-on problems if this is patched around naively:
- Reusing `evaluateTeamAccess` here (a team-scoped grant) alongside the new endpoint's `evaluateSessionSubscriberAccess` (a session-scoped grant) means two different authorization mechanisms gate two halves of the same screen. They aren't guaranteed to agree at the edges — e.g., `evaluateTeamAccess`'s admin path has no equivalent in `evaluateSessionSubscriberAccess`, so an admin could plausibly fetch session status via one endpoint and then 404 on the review GET, landing on a confusing intermediate state that isn't one of the documented error states in Decision 5/spec.
- This is exactly the "frontend assumption meets backend contract" boundary category I'd flag on any review — the design names a specific existing endpoint as reusable without checking that the calling component has the parameter that endpoint's contract requires.

Cleanest fix I'd propose: derive `teamId` server-side and drop it from what the frontend needs to supply at all — either have the new `GET /action-items-review` response return `teamId` alongside `actionItems`/`isFacilitator` (it's already resolving `grant.teamId` server-side per Decision 1 step 3, so this is a zero-cost addition), and have the initial session-status fetch also go through a session-scoped endpoint rather than the team-scoped one in `content.ts`. If session-status-only needs its own lightweight session-scoped GET, that's a small, contained addition to Decision 1's family, not a redesign.

## Non-blocking but should be resolved before implementation starts

### 3. Two different data sources are named for the same "Begin First Topic" gating logic

Decision 4 ties the control's *visibility* and the frontend's facilitator signal to `isFacilitator` from the new `GET /action-items-review` response. Decision 5's second bullet and spec.md's "Facilitator's action item data fails to load" scenario tie the control's *disablement* to "the facilitator's action-items payload... on the `POST /start` response" — a different endpoint, called at a different time (session-start), by a different actor path (whoever clicks the not-yet-built Start Session control from finding #1).

Given Decision 3's architecture — the review screen independently fetches via the new GET when it detects `pre_session` status, for every participant including the facilitator — the `POST /start` response's `actionItems` payload doesn't appear to feed the rendered review screen at all; it's consumed once, at start-time, by whatever component calls `/start` (see finding #1), and then the review screen re-fetches everything fresh via the GET. If that's right, Decision 5 bullet 2 and its corresponding spec scenario describe an error path that never reaches "Begin First Topic" as actually wired — tasks 5.5 and 6.2 would then be redundant asks pointed at two different failure surfaces (button-disable-until-GET-succeeds, and button-disable-until-POST/start-succeeds) that don't compose cleanly into one disabled/enabled boolean.

I don't think this needs a new decision so much as one clarifying sentence: does "Begin First Topic" read its enabled state purely from the review GET's success (in which case Decision 5 bullet 2 / spec's POST-start-failure scenario should be re-scoped to whatever *does* call `/start`, not to this control), or does the review component also need to receive/track the `/start` response's outcome somehow (in which case Decision 3 needs to say how that data crosses from the start-trigger into the review component)? As written, an implementer could reasonably wire either interpretation and both tasks 5.5 and 6.2 would appear satisfied while actually gating on the same single source.

### 4. Fetch-then-subscribe race is broader than the "Risks" section scopes it

Design.md's Risks section names one fetch-then-subscribe race and marks it "not applicable yet, since no write path exists in this change's scope for anything to race against" — but that's describing the *item-status-update* race (the deferred PATCH path), not the *session-state-transition* race, which very much is in this change's scope right now: `begin-voting` is the write path, it's wired in this change (Decision 4/spec), and nothing prevents this sequence today:

1. Participant's `SessionLobbyPage` fetches session status → `pre_session`, begins rendering the review branch.
2. Before the WebSocket subscription for `session_state_change` goes live, the facilitator clicks "Begin First Topic" — `begin-voting` commits and publishes.
3. The participant's subscription starts after the publish. They never receive the transition event and are stuck on the review screen indefinitely (until manual refresh), even though the session is now `active`.

This is a real, in-scope gap, not a deferred one — I'd want it named as its own risk (or folded into Decision 3 with a concrete mitigation: subscribe before the initial status fetch and reconcile, or re-fetch status once the subscription confirms live) rather than conflated with the item-level race that genuinely is out of scope until the follow-up ships. Given how thin the existing WebSocket-consumption pattern is on the frontend today (see finding #5), I'd rather this be decided at design time than left to whoever implements task 4.1.

### 5. "Subscribe to `session_state_change`" is new frontend infrastructure, not a reuse of an existing pattern

I checked for any existing frontend consumer of `session_state_change` or any typed WS-message-dispatch pattern: there isn't one. `ConnectionStatusBanner`/`SessionConnectionHost`/`FacilitatorConnectionHost` only manage raw connection health (`connect: () => WebSocket`) against stub data — nothing today parses an incoming WS message by event type and dispatches on it. Tasks 4.1/4.2 read as if "subscribe to the session's WebSocket event" is picking up an existing capability; it's actually the first instance of message-type routing on the frontend. Not a blocker — the `buildSessionWebSocketUrl` plumbing is genuinely reusable — but I'd flag it so whoever picks up task 4.1 doesn't underestimate it as a one-line addition, and so the pattern this change establishes (a hook, presumably) gets designed once rather than copy-pasted by whatever screen needs the next WS event type.

## Confirmed accurate (no issue)

- Decision 1/7 and the backend query/function descriptions all match the current code exactly: `fetchPreSessionActionItems` (`facilitator-sessions.ts:92`), `computeStalenessLevel` (`facilitator-sessions.ts:82`), and `evaluateSessionSubscriberAccess` (`session-subscriber-access-helper.ts:57`) behave as design.md describes, including the EM-exclusion dual-check and the no-cache/live-read requirement.
- `POST /start` and `begin-voting`'s facilitator-only 403 / status-gate 409 / 404 shapes match what Decision 1 assumes when it says the new endpoint should follow "the established pattern."
- Decision 7's staleness fix is genuinely isolated: I grepped for every reference to `staleness_threshold_sessions` and `computeStalenessLevel` across the backend — both appear only in `facilitator-sessions.ts` and its own test file. The "orphaned setting, not read anywhere else" claim holds; this is a safe, contained fix.
- The 404-vs-409 precedent claim (matching `action-item-status-management` Decision D12 and `session-topic-lifecycle`'s `already_revealed`/`advance_blocked` pattern) is consistent with how this codebase already handles authorization-before-precondition elsewhere.

## Recommendation

Resolve findings #1 and #2 before tasks.md section 4 starts — #1 because without it there's no way to reach this screen at all in the running app, and #2 because it's a parameter the recommended endpoint literally cannot be called without. #3 and #4 are worth a sentence each in design.md so the ambiguity doesn't get resolved three different ways across backend/frontend/tests. Everything else in the design is sound and matches the code it claims to build on.
