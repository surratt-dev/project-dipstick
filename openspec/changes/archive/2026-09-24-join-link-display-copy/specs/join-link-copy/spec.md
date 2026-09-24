## ADDED Requirements

### Requirement: Join link and copy control render in both `draft` and `lobby`-and-later states

`DraftSessionHost` SHALL render the join link together with an adjacent copy button in both its `draft-control-view` and `live-readiness-view` branches. The control is not withheld during `draft` status: a Facilitator MAY copy the link before the room is opened, to support staging a share message in advance. The underlying URL is identical in both states (`${window.location.origin}${buildJoinLinkPath(joinToken)}`, i.e. `${window.location.origin}/api/join/${joinToken}` — the backend's actual registered redemption route, resolved by `join-link-redemption-wiring` (#166) after this spec was originally drafted). Only the `draft`-status badge (`data-testid="draft-join-link-badge"`) distinguishes `draft` from `lobby`-and-later; per `session-creation`'s requirement, that badge no longer describes the link as "not yet joinable" (also resolved by #166) — so the badge's presence, not the copy button's presence, is what signals the difference between the two states.

#### Scenario: Facilitator sees a copy button while session is in draft status
- **WHEN** a Facilitator is viewing `DraftSessionHost` for a session with `status = 'draft'`
- **THEN** the join link is displayed with the existing `draft-join-link-badge`, and a copy button is present adjacent to it

#### Scenario: Facilitator sees a copy button once the session is open
- **WHEN** a Facilitator is viewing `DraftSessionHost` for a session with `status = 'lobby'` (or any later non-terminal status)
- **THEN** the join link is displayed without the `draft`-status badge, and a copy button is present adjacent to it

#### Scenario: Copied URL is identical across draft and lobby status
- **WHEN** a Facilitator copies the join link during `draft` status and again after the session advances to `lobby`
- **THEN** both copies place the same URL (`${window.location.origin}${buildJoinLinkPath(joinToken)}`) on the clipboard

#### Scenario: Control persists for the full waiting window
- **WHEN** a session remains in `lobby` status while participants join over several minutes
- **THEN** the join link and copy button remain rendered in place for the entire duration, without requiring the Facilitator to re-navigate to find them again

---

### Requirement: Successful clipboard copy shows a confirming banner

Activating the copy button SHALL call `navigator.clipboard.writeText()` with the full join link URL. On success, the application SHALL display an inline confirmation banner reading exactly `"Link copied"`, which SHALL automatically clear after 8 seconds without requiring user action, following the existing auto-clearing inline banner convention (`MemberManagement.tsx`) rather than introducing a toast or notification system.

#### Scenario: Successful copy shows the confirmation banner
- **WHEN** a Facilitator activates the copy button and `navigator.clipboard.writeText()` resolves successfully
- **THEN** the full join link URL is placed on the system clipboard
- **AND** an inline banner reading exactly "Link copied" is displayed

#### Scenario: Confirmation banner clears automatically
- **WHEN** the "Link copied" banner has been visible for 8 seconds
- **THEN** the banner is removed from view without any Facilitator interaction

---

### Requirement: Clipboard unavailability and write rejection both fall back without a false confirmation

When the Clipboard API is unavailable (feature-detection fails) or a `navigator.clipboard.writeText()` call rejects (e.g., permission denied, insecure context, or any other runtime rejection), the application SHALL treat both cases identically: the join link renders as selectable text and no copy-success confirmation is shown. The application SHALL NOT use `document.execCommand('copy')` or any other automatic fallback that could report success without the application being able to verify it.

#### Scenario: Clipboard API unavailable
- **WHEN** `navigator.clipboard.writeText` is not available in the Facilitator's browser
- **THEN** the join link is rendered as selectable text
- **AND** no copy-success confirmation banner is shown at any point

#### Scenario: Clipboard write call rejects at runtime
- **WHEN** a Facilitator activates the copy button and the `navigator.clipboard.writeText()` promise rejects
- **THEN** the application falls back to the selectable-text state identically to the Clipboard-API-unavailable case
- **AND** no copy-success confirmation banner is shown

#### Scenario: Manual selection always works regardless of clipboard state
- **WHEN** the join link is rendered as selectable text, whether due to Clipboard API unavailability, a rejected write, or normal display
- **THEN** the Facilitator can select and manually copy the link text without interference from the application

---

### Requirement: Joinable-state link uses full-emphasis styling, not the not-yet-joinable muted treatment

While the join link is joinable (`lobby`-and-later), it SHALL render using full-emphasis body text color. The muted/de-emphasized styling (`color: #9e9e9e`, small label) that `draft`'s link treatment uses today SHALL remain reserved for the `draft` state and SHALL NOT be the default styling for the link once it is usable.

#### Scenario: Link is de-emphasized during draft status
- **WHEN** a session is in `draft` status
- **THEN** the join link renders using the existing muted/de-emphasized styling alongside the `draft-join-link-badge`

#### Scenario: Link is full-emphasis once joinable
- **WHEN** a session is in `lobby` status (or later)
- **THEN** the join link renders using full-emphasis body text styling, not the muted gray treatment used for the `draft`-status badge
