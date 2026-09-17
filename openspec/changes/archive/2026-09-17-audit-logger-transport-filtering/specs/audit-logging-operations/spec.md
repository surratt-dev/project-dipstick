## ADDED Requirements

### Requirement: Deployment runbook documents the transport-level filtering gap

`docs/deployment.md` SHALL include a `### Logging` subsection, under `## Running the
Application`, that documents: (1) that `emitAuditEvent`'s child-logger `level = "info"`
override protects audit events from application-wide log-level changes only, and does not
protect against a pino transport configured with its own level filter; (2) the specific
audit events that have no database backing and are therefore actually at risk from
transport-level filtering; (3) that most security-relevant audit events also write an
`audit_log` database row in the same transaction as the state change, which is the
authoritative record and is unaffected by transport configuration; and (4) that
`emitAuditEvent` (`packages/backend/src/auth/audit-logger.ts`) must be revisited before any
pino transport with a level filter is adopted.

#### Scenario: Operator configuring a filtering transport can identify at-risk events

- **WHEN** an operator preparing to configure a pino transport with a level filter reads
  the `### Logging` subsection of `docs/deployment.md`
- **THEN** they can identify, by name, which audit events are log-only with no database
  backing and therefore at risk of being silently dropped by the transport

#### Scenario: Runbook explains why the existing log-level fix does not cover transports

- **WHEN** an operator reads the `### Logging` subsection
- **THEN** it explains that `emitAuditEvent`'s child-logger level override guards against
  application-wide log-level changes only, and explicitly states that transport-level
  filtering is not covered by that protection

#### Scenario: Runbook states the required precondition before adopting a filtering transport

- **WHEN** an operator reads the `### Logging` subsection
- **THEN** it states that `emitAuditEvent` in `audit-logger.ts` must be revisited (e.g. a
  level floor on the transport, or routing audit events to an unfiltered destination) before
  any pino transport with a level filter is adopted

### Requirement: Deferred startup-reachability check is recorded as a traceable future consideration

The deployment runbook's `### Logging` subsection SHALL record the startup audit-event
reachability check requested in GitHub issue #3 as an explicit "Future consideration": not
built in this change, with its own trigger condition (build it alongside the
`emitAuditEvent` transport rework, before any filtering transport ships to production), and
a direct reference to issue #3. This requirement exists so the deferral is discoverable from
the shipped documentation rather than only from change-history artifacts, and so issue #3 can
close without silently dropping the action it requested.

#### Scenario: Reader finds the deferred startup check and its trigger condition

- **WHEN** a reader consults the `### Logging` subsection for the status of issue #3's
  startup-reachability-check request
- **THEN** they find a "Future consideration" note stating the check is not built now,
  naming the condition under which it should be built, and referencing issue #3

### Requirement: Transport-filtering caveat is discoverable from the code, not only the runbook

`packages/backend/src/auth/audit-logger.ts` SHALL include an inline comment, adjacent to the
child-logger level override in `emitAuditEvent`, stating that the override does not protect
against transport-level filtering and pointing to the `### Logging` subsection of
`docs/deployment.md` for the events at risk and the required precondition.

#### Scenario: Engineer reading emitAuditEvent encounters the transport-filtering caveat

- **WHEN** an engineer reads `emitAuditEvent` in `audit-logger.ts`, near the child-logger
  level override
- **THEN** an inline comment states that the override does not cover transport-level
  filtering and directs them to `docs/deployment.md`'s `### Logging` subsection for details
