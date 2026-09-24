## MODIFIED Requirements

### Requirement: Return-to value is allow-listed by known internal path shape

The application SHALL validate a supplied `returnTo` value against an explicit allow-list of known internal route shapes before storing it (`/session/:id`, `/team/:id`, `/team/:teamId/session/:sessionId`, and the literal path `/sessions/new`). A `returnTo` value that does not match an allow-listed shape SHALL be discarded silently: the login flow proceeds as though no `returnTo` value was supplied, without surfacing an error to the user. The application SHALL NOT accept an arbitrary path, a full URL, a protocol-relative URL, or any value containing a scheme or authority component as a `returnTo` value.

#### Scenario: A non-allow-listed path is discarded silently

- **WHEN** `GET /auth/login?returnTo=/some/unrecognized/path` is requested
- **THEN** the application does not store this value in the OIDC state payload
- **AND** the login flow proceeds exactly as though no `returnTo` parameter had been supplied
- **AND** no error is returned to the caller for this reason alone

#### Scenario: A full URL or protocol-relative value is rejected

- **WHEN** `GET /auth/login?returnTo=` is requested with a value containing `://`, a leading `//`, or an explicit scheme
- **THEN** the application discards the value and proceeds as though no `returnTo` parameter had been supplied

#### Scenario: An allow-listed session path is accepted

- **WHEN** `GET /auth/login?returnTo=/session/abc123` is requested
- **THEN** the value matches the `/session/:id` allow-listed shape and is stored

#### Scenario: An allow-listed team path is accepted

- **WHEN** `GET /auth/login?returnTo=/team/xyz789` is requested
- **THEN** the value matches the `/team/:id` allow-listed shape and is stored

#### Scenario: An allow-listed combined team-and-session path is accepted

- **WHEN** `GET /auth/login?returnTo=/team/<uuid>/session/<uuid>` is requested, with both `<uuid>` segments matching this application's UUID format
- **THEN** the value matches the `/team/:teamId/session/:sessionId` allow-listed shape and is stored

#### Scenario: The allow-listed session-creation path is accepted

- **WHEN** `GET /auth/login?returnTo=/sessions/new` is requested
- **THEN** the value matches the literal `/sessions/new` allow-listed shape and is stored

#### Scenario: A near-miss of the session-creation path is rejected

- **WHEN** `GET /auth/login?returnTo=/sessions/new/anything` or `GET /auth/login?returnTo=/sessions/newer` is requested
- **THEN** the value does not match the literal `/sessions/new` allow-listed shape
- **AND** the application discards the value and proceeds as though no `returnTo` parameter had been supplied
