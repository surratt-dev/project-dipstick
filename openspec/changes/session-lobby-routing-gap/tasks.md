## 1. Recorded design decision (resolved, informational)

- [x] 1.1 `wrap_up` routing is decided: it stays bucketed with `draft`/`complete`/`abandoned` → `/team/:teamId`, not moved to the `/session/:sessionId` bucket. Recorded by Devon Calloway (Internal Champion) against `requirements/use cases/06 - Session Wrap-up - Use Cases.md` and the actual `SessionLobbyPage.tsx` branch logic — see design.md D4 for full rationale. No further confirmation step blocks implementation; this is not a gate.

## 2. `DraftSessionHost` — Start Session control

- [ ] 2.1 Add a "Start Session" control to `DraftSessionHost`'s live-readiness-view, rendered whenever `currentSessionState === 'lobby'`.
- [ ] 2.2 Wire the control to `POST /api/v1/sessions/:sessionId/start`.
- [ ] 2.3 On success, update `currentSessionState` to `'pre_session'` in local state and re-render in place (no navigation), matching the existing `openTheRoom` pattern.
- [ ] 2.4 On failure, show an inline, retryable error and remain on the `lobby` rendering.
- [ ] 2.5 Test: facilitator starts the session from `DraftSessionHost` and the view updates in place to `pre_session`.
- [ ] 2.6 Test: Start Session failure shows inline retry and does not advance local state.

## 3. `DraftSessionHost` — navigate link to the review

- [ ] 3.1 Add a link/button to the live-readiness-view, rendered whenever `currentSessionState` is `pre_session`, `active`, or `wrap_up`, that navigates to `/session/:sessionId`.
- [ ] 3.2 Test: the navigate link appears once `currentSessionState` reaches `pre_session`.
- [ ] 3.3 Test: activating the navigate link routes to `/session/:sessionId`.

## 4. `DraftSessionHost` and `SessionLobbyPage` — copy alignment

- [ ] 4.1 Align `DraftSessionHost`'s `lobby`-status heading and Start Session control label with `SessionLobbyPage`'s equivalent `lobby`-branch heading and label.
- [ ] 4.2 Update `SessionLobbyPage`'s `lobby`-branch non-facilitator waiting message to drop the raw `sessionId` and add a one-line reassurance ("The facilitator will start the session shortly").
- [ ] 4.3 Test: heading and control label text read as the same product on both surfaces for the `lobby` status.
- [ ] 4.4 Test: non-facilitator waiting copy on `SessionLobbyPage` contains no raw `sessionId` and includes the reassurance line.

## 5. Join-link landing rule

- [ ] 5.1 Replace the join-link post-redemption landing logic's status check with the full seven-`SessionStatus` enumeration: `lobby`, `pre_session`, `active` → `/session/:sessionId`; `draft`, `wrap_up`, `complete`, `abandoned`, or no session → `/team/:teamId`.
- [ ] 5.2 Test: each of the seven `SessionStatus` values (plus no-session-exists) routes to the correct destination per the delta spec's scenarios.

## 6. Verification

- [ ] 6.1 Manually walk a session end-to-end through the live UI: create session for existing team → Open the room (`draft → lobby`) → Start Session from `DraftSessionHost` (`lobby → pre_session`) → follow navigate link → reach `pre_session` review on `SessionLobbyPage` → Begin First Topic (`pre_session → active`) — confirming no step strands the facilitator on static, non-actionable status text.
- [ ] 6.2 Manually confirm an Engineer following a join link lands on `/session/:sessionId` while the session is `lobby` and while it is `pre_session`, and on `/team/:teamId` while it is `draft`.
- [ ] 6.3 Run the full frontend test suite and confirm no regression in `DraftSessionHost.test.tsx` or `SessionLobbyPage.test.tsx`.
