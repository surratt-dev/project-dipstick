## 1. Recorded design decision (resolved, informational)

- [x] 1.1 `wrap_up` routing is decided: it stays bucketed with `draft`/`complete`/`abandoned` → `/team/:teamId`, not moved to the `/session/:sessionId` bucket. Recorded by Devon Calloway (Internal Champion) against `requirements/use cases/06 - Session Wrap-up - Use Cases.md` and the actual `SessionLobbyPage.tsx` branch logic — see design.md D4 for full rationale. No further confirmation step blocks implementation; this is not a gate.

## 2. `DraftSessionHost` — Start Session control

- [x] 2.1 Add a "Start Session" control to `DraftSessionHost`'s live-readiness-view, rendered whenever `currentSessionState === 'lobby'`.
- [x] 2.2 Wire the control to `POST /api/v1/sessions/:sessionId/start`.
- [x] 2.3 On success, update `currentSessionState` to `'pre_session'` in local state and re-render in place (no navigation), matching the existing `openTheRoom` pattern.
- [x] 2.4 On failure, show an inline, retryable error and remain on the `lobby` rendering.
- [x] 2.5 Test: facilitator starts the session from `DraftSessionHost` and the view updates in place to `pre_session`.
- [x] 2.6 Test: Start Session failure shows inline retry and does not advance local state.

## 3. `DraftSessionHost` — navigate link to the review

- [x] 3.1 Add a link/button to the live-readiness-view, rendered whenever `currentSessionState` is `pre_session`, `active`, or `wrap_up`, that navigates to `/session/:sessionId`.
- [x] 3.2 Test: the navigate link appears once `currentSessionState` reaches `pre_session`.
- [x] 3.3 Test: activating the navigate link routes to `/session/:sessionId`.

## 4. `DraftSessionHost` and `SessionLobbyPage` — copy alignment

- [x] 4.1 Align `DraftSessionHost`'s `lobby`-status heading and Start Session control label with `SessionLobbyPage`'s equivalent `lobby`-branch heading and label.
- [x] 4.2 Update `SessionLobbyPage`'s `lobby`-branch non-facilitator waiting message to drop the raw `sessionId` and add a one-line reassurance ("The facilitator will start the session shortly").
- [x] 4.3 Test: heading and control label text read as the same product on both surfaces for the `lobby` status.
- [x] 4.4 Test: non-facilitator waiting copy on `SessionLobbyPage` contains no raw `sessionId` and includes the reassurance line.

## 5. Join-link landing rule (backend — see design.md D6)

This is a backend change touching **two independent call sites**. Do not stop after fixing `join-links.ts` — `auth.ts`'s `executeJoinFlow` has the identical check and is easy to miss because nothing about its name suggests join-link logic lives there.

- [x] 5.1 Extract a shared helper (e.g. `resolveJoinLandingPath(teamId): Promise<string>`) implementing the full seven-`SessionStatus` enumeration: `lobby`, `pre_session`, `active` → `/session/:sessionId`; `draft`, `wrap_up`, `complete`, `abandoned`, or no session → `/team/:teamId`.
- [x] 5.2 Test: unit-test the shared helper directly against each of the seven `SessionStatus` values plus no-session-exists, per the delta spec's scenarios.
- [x] 5.3 Replace `packages/backend/src/routes/join-links.ts`'s `GET /api/join/:token` handler (~lines 202-216, the direct/already-authenticated join path) to call the shared helper instead of its inline `status = 'active'` query. Also update the existing test `"should redirect to active session if one exists"` in `join-links.test.ts` (~line 411): its mocked session row (`{ rows: [{ id: "session-abc" }] }`) currently omits `status`, which the shared helper needs to pick the correct bucket — add a `status` field (e.g. `"active"`) so the test keeps exercising (and asserting) the `/session/:id` redirect it claims to cover. The adjacent test `"should join team and redirect when authenticated"` (~line 369) mocks `rows: []` for the same query slot ("no session") and needs no change — an empty result set means "no session" under both the old and new query shape.
- [x] 5.4 Test (backend, `join-links.ts`): a route-level test exercising `GET /api/join/:token` for at least one `lobby`/`pre_session` case, confirming the real redirect uses the shared helper's output — not just that the helper is called.
- [x] 5.5 Replace `packages/backend/src/routes/auth.ts`'s `executeJoinFlow` (~lines 855-869, the through-OIDC join path reached from `GET /auth/callback` via `pendingJoinToken`) to call the same shared helper instead of its own independent copy of the same query. Checked against the current suite: every existing `auth.test.ts` test that mocks this query call (the through-OIDC join-flow tests around lines 1224, 1704, 1768, 1878, 1941, and 2009) mocks it as `rows: []` ("no active session") — none mock a found session, so none encode the old `status = 'active'`-only shape in a way the new bucket logic breaks (empty rows still means "no session" either way). No existing mocks in this file need updating for this change; re-check this once the helper's exact query/param shape is finalized in 5.1, in case the call sequence itself shifts.
- [x] 5.6 Test (backend, `auth.ts`): a route-level test exercising the through-OIDC join path (`executeJoinFlow` via `GET /auth/callback` with `pendingJoinToken`) for at least one `lobby`/`pre_session` case. This path has no dedicated test today for the status-check behavior — do not assume 5.4's coverage of `join-links.ts` also covers this file.

## 6. Verification

- [x] 6.1 Run the full frontend **and backend** test suites and confirm no regression — frontend: `DraftSessionHost.test.tsx`, `SessionLobbyPage.test.tsx`; backend: the join-link/auth route tests covering task 5's shared helper and both call sites. Doing this before the manual walkthroughs below catches a regression at the cheaper, automated checkpoint first.
- [ ] 6.2 Manually walk a session end-to-end through the live UI: create session for existing team → Open the room (`draft → lobby`) → Start Session from `DraftSessionHost` (`lobby → pre_session`) → follow navigate link → reach `pre_session` review on `SessionLobbyPage` → Begin First Topic (`pre_session → active`) — confirming no step strands the facilitator on static, non-actionable status text.
- [ ] 6.3 Manually confirm an Engineer following a join link, both already-authenticated (direct `join-links.ts` path) and requiring the OIDC round-trip first (`auth.ts`'s `executeJoinFlow` path), lands on `/session/:sessionId` while the session is `lobby` and while it is `pre_session`, and on `/team/:teamId` while it is `draft`. Confirm both paths independently — this is exactly the seam that drifted out of sync before this review (see design.md D6).
- [ ] 6.4 Known, out-of-scope gap — confirm, don't fix (see design.md D7): using a genuinely first-time account (no prior `session_participants` row for the target session), follow a join link into a `lobby` or `pre_session` session and confirm the real, current behavior is `404` from `action-items-review` and `CLOSE_UNAUTHORIZED` on the WebSocket connection. This is expected today, not a regression introduced by task 5 — it verifies the security review's Finding 1 against the actual database/WebSocket rather than leaving it as an unverified code-trace, and confirms the routing fix lands the user at the right *address* even though what's there currently rejects a first-time joiner. Do not attempt to fix this under task 5's scope; if it's not reproducible as described, that's new information — flag it rather than silently closing the follow-up.
