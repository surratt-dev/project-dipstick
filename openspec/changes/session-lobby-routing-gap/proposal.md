## Why

`SessionLobbyPage`'s `lobby` branch is the only place in the running application that can move a session out of `lobby` status — it carries the sole rendered "Start Session" control wired to `POST /api/v1/sessions/:sessionId/start` (shipped by `pre-session-action-item-review`) and the sole `pre_session` review render. But nothing in the frontend ever navigates a live user to that page. The facilitator's actual post-creation path (`session-creation`'s `DraftSessionHost`) has no Start Session control at all, and the join-link landing rule only redirects to `/session/:sessionId` when a session is already `active` — so neither the facilitator nor an Engineer following a join link can reach the one screen that exists to advance a session. Every session created today is structurally stuck in `lobby` through any UI path that exists. This is not a dead-code cleanup; it is the only exit from the lobby being unreachable.

## What Changes

- Add a "Start Session" control to `DraftSessionHost`'s `live-readiness-view`, rendered whenever `currentSessionState === 'lobby'` (no additional gating — `DraftSessionHost` is already facilitator-only). On success it updates local state to `pre_session` in place, matching the existing `openTheRoom` pattern; on failure it shows inline retry and stays on `lobby`.
- Add a navigate link/button on `DraftSessionHost`, rendered whenever `currentSessionState` is `pre_session` or a later non-terminal status (`active`, `wrap_up`), that sends the facilitator to `/session/:sessionId` — so Start Session doesn't relocate the dead end instead of closing it. (A genuinely terminal session — `complete` or `abandoned` — keeps the existing static status text with no link; that's not a new dead end.)
- Replace `join-link`'s "Session-aware join link landing" requirement with a full seven-`SessionStatus` enumeration: `lobby`, `pre_session`, and `active` land the user on `/session/:sessionId`; `draft`, `wrap_up`, `complete`, `abandoned`, or no session at all land on `/team/:teamId`.
- Align `SessionLobbyPage`'s `lobby`-state heading/copy and Start Session button label with `DraftSessionHost`'s, so a facilitator or Engineer landing on either surface mid-transition reads it as the same product.
- Drop the raw `sessionId` from `SessionLobbyPage`'s engineer-facing waiting copy and add a one-line reassurance ("The facilitator will start the session shortly").

**Explicit non-goal:** `TeamPage` remains session-blind — it gets no banner, link, or status indicator for a forming session. An existing team member who isn't following a fresh join link still has no way to discover a session in `lobby` or `pre_session`. This predates this change and is a distinct, out-of-scope gap. Intent: file this as its own tracked follow-up issue promptly after this change ships, not let it resurface later as a fresh "how is this still broken" report (this proposal doesn't file that issue itself).

**Named follow-ups, not scheduled by this change:**
- A `DraftSessionHost`-native render of the `pre_session` review (so the facilitator never leaves `DraftSessionHost`), rather than the navigate-link handoff to `SessionLobbyPage` this change ships. Pushed for scoping as a near-term follow-up, not backlog-someday, given the copy/voice fragmentation this change only narrows, not eliminates.
- A facilitator-aware join-link redirect (a facilitator's own link always lands them on `DraftSessionHost` instead of `SessionLobbyPage`) — separate routing logic requiring facilitator-identity resolution before the redirect decision; not touched by the seven-status enumeration above.
- A live "N people have joined" presence signal, and copy differentiating "Open the room" (draft → lobby) from "Start Session" (lobby → pre_session) beyond the alignment pass above.
- A `wrap_up`- (and `active`-) aware observer render reachable from a join link. `SessionLobbyPage`'s current branch logic renders `pre_session` distinctly but collapses every later status — `active`, `wrap_up`, `complete`, `abandoned` alike — into one generic "moved past the pre-session review" message. This is why `wrap_up` stays bucketed with `draft`/`complete`/`abandoned` in this change's join-link enumeration rather than with `active` (see design.md D4): there's no honest "closing phase, not over" content to route a `wrap_up` joiner to yet. It's also why `design.md`'s claim that `/session/:sessionId` has "something to show" for `active` is a routing-destination claim, not a rendered-content one — an Engineer landing there during an active voting session sees the same generic message as one landing post-completion. Both gaps share one root cause and are named together as a single follow-up.

## Capabilities

### New Capabilities
_None. This change wires existing, shipped capabilities together; it introduces no new capability surface._

### Modified Capabilities
- `join-link`: "Session-aware join link landing" requirement is replaced with the seven-`SessionStatus` enumeration described above.
- `session-creation`: `DraftSessionHost`'s `live-readiness-view` gains a Start Session control for `lobby` and a navigate-to-`/session/:sessionId` link for `pre_session`-or-later.
- `pre-session-action-item-review`: `SessionLobbyPage`'s `lobby`-branch copy/heading and Start Session label are aligned with `DraftSessionHost`'s; the engineer-facing waiting copy drops the raw session ID and adds a reassurance line.

## Impact

- **Frontend:** `packages/frontend/src/pages/DraftSessionHost.tsx` (new Start Session control + navigate link in `live-readiness-view`), `packages/frontend/src/pages/SessionLobbyPage.tsx` (copy/heading alignment, waiting-copy change), the join-link post-redemption redirect logic (landing-rule replacement).
- **Backend:** none — `POST /start`, `GET /action-items-review`, and the join-redemption endpoints are unchanged; this is a frontend routing/wiring fix only.
- **Specs:** delta specs against `join-link`, `session-creation`, and `pre-session-action-item-review`.
- **Resolved before this proposal ships:** whether a `wrap_up`-status session landing on `/team/:teamId` is correct — decided (see design.md D4); no longer blocks or gates implementation start.
- **Design-stage follow-up still open:** sequencing of the `DraftSessionHost`-native review follow-up (near-term change vs. general backlog) — a planning call, not a blocker for this change.
