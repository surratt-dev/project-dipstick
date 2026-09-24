## ADDED Requirements

### Requirement: Shared session-expiry detection helper

The frontend SHALL provide a single shared function that, given a `fetch` `Response`, determines whether it represents a disclosed session-expiry: `response.status === 401` AND the parsed JSON response body's `error.category` field equals `"session_expired"`. A response with `status === 401` and any other (or absent) `category` value SHALL NOT be treated as a session-expiry by this helper. The helper SHALL parse the response body itself; it SHALL NOT require or accept a pre-parsed body object from its caller. The helper's result SHALL include the parsed response body (or `null`, if parsing failed) alongside the session-expiry determination, so a caller receiving a non-session-expiry 401 can still derive its own generic-error message without reading the response body a second time. Every call site in this capability SHALL use this single helper rather than independently reimplementing this check.

#### Scenario: A 401 with category session_expired is recognized

- **WHEN** a session-scoped fetch call receives a response with `status === 401` and a JSON body `{ error: { category: "session_expired", ... } }`
- **THEN** the shared helper reports this response as a disclosed session-expiry

#### Scenario: A 401 with a different category is not recognized as session-expiry

- **WHEN** a session-scoped fetch call receives a response with `status === 401` and a JSON body whose `error.category` is not `"session_expired"` (e.g., `"invalid_request"`)
- **THEN** the shared helper does not report this response as a disclosed session-expiry
- **AND** the call site's existing generic non-ok handling applies instead

#### Scenario: A non-401 response is never treated as session-expiry

- **WHEN** a session-scoped fetch call receives any response with `status !== 401`
- **THEN** the shared helper does not report this response as a disclosed session-expiry, regardless of response body content

#### Scenario: A non-session-expiry 401's body is available without a second read

- **WHEN** a session-scoped fetch call receives a response with `status === 401` and a JSON body whose `error.category` is not `"session_expired"` (e.g., `"provider_unavailable"`, produced by `authMiddleware`'s token-refresh transient-failure branch)
- **THEN** the shared helper does not report this response as a disclosed session-expiry
- **AND** the helper's result still exposes the parsed response body to the caller
- **AND** the caller derives its own generic-error message from that body without calling `response.json()` a second time

---

### Requirement: Recognized session-expiry renders the reauth-required treatment inline

Each in-scope call site SHALL, on the shared helper recognizing a disclosed session-expiry, render the existing `ReauthRequiredTreatment` component in place of its normal content or generic error state — passing a `role` value ("participant" or "facilitator") appropriate to that call site and a `returnTo` value of the current page's path and query string (`window.location.pathname + window.location.search`). This rendering SHALL NOT be preceded or replaced by an automatic navigation; the user SHALL remain on the current page, viewing the treatment's own call-to-action, until they click it.

In-scope call sites: `SessionLobbyPage.tsx`'s `start` POST and `begin-voting` POST (always `role="facilitator"` — both are only reachable from UI already gated on `branch.isFacilitator === true`, so the caller is always the facilitator by the time either fires); `SessionLobbyPage.tsx`'s `action-items-review` GET (`role="facilitator"` if `session?.canFacilitateSessions` is true, else `role="participant"` — this call establishes the page's own facilitator/participant distinction, so it cannot read that distinction from itself; `canFacilitateSessions` is used as an explicit proxy instead, since `role` here only selects which sentence renders, not an authorization outcome); `DraftSessionHost.tsx` (`facilitator-state` GET, `advance` POST — always `role="facilitator"`); `SessionCreationPage.tsx` (`eligible-for-session` GET, `sessions/draft` POST — always `role="facilitator"`, since this route is gated on `canFacilitateSessions`); and `MemberManagement.tsx` (`submitRoleChange` PATCH — always `role="facilitator"`, used here only to suppress the vote-loss sentence, which is inapplicable outside a session context, not as a claim that the caller is a session facilitator).

#### Scenario: A facilitator's advance POST 401s with a disclosed session-expiry

- **WHEN** a facilitator on `DraftSessionHost.tsx` clicks "Yes, open the room" and the `advance` POST response is a disclosed session-expiry (per the shared helper)
- **THEN** the page renders `ReauthRequiredTreatment` with `role="facilitator"` and `returnTo` set to the current page's path
- **AND** does not render "Could not open the room. Please try again."
- **AND** does not automatically navigate away from the current page

#### Scenario: A mount-time GET 401s with a disclosed session-expiry

- **WHEN** a facilitator lands on `DraftSessionHost.tsx` (refresh, bookmark, or direct navigation) and the mount-time `facilitator-state` GET response is a disclosed session-expiry
- **THEN** the page renders `ReauthRequiredTreatment` with `role="facilitator"` in place of "Unable to load this session."

#### Scenario: An EM's or Admin's role-change PATCH 401s with a disclosed session-expiry

- **WHEN** an Engineering Manager or Application Admin on `MemberManagement.tsx` submits a role change (either the initial submission or the confirmed re-submission after a 422) and the `submitRoleChange` PATCH response is a disclosed session-expiry
- **THEN** the page renders `ReauthRequiredTreatment` with `role="facilitator"` and `returnTo` set to the current page's path (`/team/:teamId`)
- **AND** does not render "Role change failed."
- **AND** does not automatically navigate away from the current page

#### Scenario: A non-session-expiry failure keeps its existing generic handling

- **WHEN** any in-scope call site's fetch response is not a disclosed session-expiry (a different 4xx, a 5xx, or a network failure)
- **THEN** that call site's pre-existing error handling and message apply unchanged
- **AND** `ReauthRequiredTreatment` is not rendered

---

### Requirement: SessionLobbyPage additionally reacts to the connection-health reauth-required state

In addition to the fetch-response detection above, `SessionLobbyPage.tsx` SHALL render `ReauthRequiredTreatment` when its `useConnectionHealth` hook's `state` value equals `"reauth-required"`. This is a second, independent detector of the same absolute-lifetime expiry, operating over a different channel (the session's WebSocket close code) than the fetch-response check.

Whichever signal — a fetch response recognized by the shared helper, or `state === "reauth-required"` — occurs first for a given page instance SHALL render the treatment. Once rendered for that page instance, a subsequent occurrence of either signal (the same one again, or the other one) SHALL NOT re-render, re-trigger, or otherwise visibly affect the already-rendered treatment.

#### Scenario: The WebSocket signal fires before any in-flight fetch 401s

- **WHEN** `SessionLobbyPage.tsx`'s `useConnectionHealth` state transitions to `"reauth-required"` before any fetch call site on the page has received a session-expiry response
- **THEN** the page renders `ReauthRequiredTreatment`
- **AND** a fetch response that subsequently arrives as a disclosed session-expiry does not re-render or alter the already-rendered treatment

#### Scenario: A fetch 401 fires before the WebSocket signal

- **WHEN** a fetch call site on `SessionLobbyPage.tsx` receives a disclosed session-expiry response before `useConnectionHealth`'s state has transitioned to `"reauth-required"`
- **THEN** the page renders `ReauthRequiredTreatment`
- **AND** a subsequent transition of `state` to `"reauth-required"` does not re-render or alter the already-rendered treatment

#### Scenario: Neither signal has fired

- **WHEN** no fetch call site on `SessionLobbyPage.tsx` has received a disclosed session-expiry response, and `useConnectionHealth`'s state is not `"reauth-required"`
- **THEN** the page renders its normal content, unaffected by this capability

---

### Requirement: A disclosed-session-expiry 401 on a POST guarantees the action did not execute server-side

Because the session-expiry check runs in the backend's `onRequest` hook, before any route handler executes, a POST response the shared helper recognizes as a disclosed session-expiry SHALL guarantee that the requested action was not performed server-side. This capability's rendering behavior itself makes no distinct promise beyond the shared helper's detection and the treatment's own display — this requirement exists to state the guarantee explicitly for downstream copy (e.g., `DraftSessionHost.tsx`'s confirm-step "cannot be undone" copy) that depends on it remaining true.

#### Scenario: A 401'd advance POST is guaranteed not to have opened the room

- **WHEN** the `advance` POST on `DraftSessionHost.tsx` receives a disclosed session-expiry response
- **THEN** the session's state was not advanced from `draft` to `lobby` by that request
- **AND** the facilitator, after re-authenticating and returning, sees the session still in `draft` state (absent any other unrelated change)

#### Scenario: A 401'd role-change PATCH is guaranteed not to have applied

- **WHEN** the `submitRoleChange` PATCH on `MemberManagement.tsx` receives a disclosed session-expiry response, on either the initial submission or the confirmed re-submission
- **THEN** the member's role was not changed by that request
- **AND** the EM or Admin, after re-authenticating and returning, sees the member's role unchanged (absent any other unrelated change)
