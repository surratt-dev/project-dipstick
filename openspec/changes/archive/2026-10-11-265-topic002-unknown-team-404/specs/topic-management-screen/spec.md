## ADDED Requirements

### Requirement: The Topic Management screen reports a team that does not exist

The screen SHALL show "Team not found." in its existing error state when the initial load of TOPIC-002 answers `404` with an error envelope whose `error.code` is `TEAM_NOT_FOUND`, and SHALL NOT use that text for any other failure. The scenarios state the edge cases. Live session routes and participant views are unchanged.

#### Scenario: A TEAM_NOT_FOUND 404 shows the not-found state
- **WHEN** the initial load of TOPIC-002 answers `404` with `error.code: "TEAM_NOT_FOUND"`
- **THEN** the screen shows "Team not found."
- **AND** it shows no topic list, no definition block, no write control, and no network-error text

#### Scenario: A non-canonical team id in the URL shows the same state
- **WHEN** the URL carries a team id that is not a canonical UUID and the backend answers `404` with `error.code: "TEAM_NOT_FOUND"`
- **THEN** the screen shows "Team not found."

#### Scenario: The copy does not come from the server message
- **WHEN** the initial load answers `404` with `error.code: "TEAM_NOT_FOUND"` and a different `error.message`
- **THEN** the screen still shows exactly "Team not found."

#### Scenario: A 404 that is not a TEAM_NOT_FOUND envelope is not labelled team-not-found
- **WHEN** the initial load answers `404` with a non-JSON body, with a JSON body whose `error` is not an object, or with a JSON body whose `error.code` is not `TEAM_NOT_FOUND`
- **THEN** the screen shows "Failed to load topics."

#### Scenario: A failing quiet refetch keeps the screen intact
- **WHEN** a quiet refetch after a successful load answers `404`, `403` or `500`
- **THEN** the existing list and any unsaved edit (the annotation text in an open edit field) remain, and the screen shows no full-screen error state

#### Scenario: The not-found state reuses the existing error state
- **WHEN** the screen shows "Team not found."
- **THEN** it is the `role="alert"` paragraph (`data-testid="topic-management-error"`) followed by the existing "Back to team" link to `/team/:teamId`
- **AND** no new component or navigation is added
- **AND** the text is exactly `Team not found.` (capital T, full stop, no second line) and does not include the requested team id
- **AND** the failing URL and team id are not sent to any client-side error reporter

#### Scenario: No empty team shell is rendered first
- **WHEN** the initial load is pending or has answered `404` with `TEAM_NOT_FOUND`
- **THEN** no topic-list or definition element renders (a loading indicator MAY show)

#### Scenario: A write action's TEAM_NOT_FOUND is unchanged
- **WHEN** a write action (add, remove, restore, reorder, annotation save) is answered with `TEAM_NOT_FOUND`
- **THEN** that action keeps its existing handling, because the not-found branch applies to the initial load only

#### Scenario: Each caller of a quiet refetch keeps its own failure message
- **WHEN** a quiet refetch (after Remove, Restore, Add, annotation save or stale-order recovery) fails
- **THEN** the caller's existing failure message applies and this change adds no new notice or other UI
