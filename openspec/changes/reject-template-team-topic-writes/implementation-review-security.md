# Security Implementation Review: reject-template-team-topic-writes (#188)

*Reviewer: Tomás Ferreira (Senior Application Security Analyst). Scope: `git diff main...HEAD`
(working tree clean), focused on `packages/backend/src/routes/topics.ts`,
`routes/register-routes.ts`, `auth/audit-logger.ts`, and the new unit, integration and
structural tests. Checked against `design.md` D1 to D5 and the disposition of my
`design-review-security.md`.*

## Verdict

**Approve. No blocking code findings.** The guard is where I asked for it, it fails closed, the
audit trail survives an insert failure, and the CI gate enumerates real routes. The merge stays
gated on the human actions from my design review (B1 content in F1, and the data check). Those
are not met yet: tasks 6.1 to 6.3 are open.

## Disposition of my design review, verified in code

| Item | Status | Evidence |
|---|---|---|
| B1 F1 content, sentinel `team_memberships` data check | **Open (human gate)** | Written into `design.md` Open Questions and tasks 6.1/6.3, both unchecked. No route outside `topics.ts` changed, as agreed. |
| B2 complete, alertable fallback trace | **Met** | `writeTemplateDenialAudit` catches only the insert. `emitAuditEvent` runs on both outcomes with actor, role, IP, team, endpoint, operation, `correlationId`, `auditRowWritten`. The failure log has `audit_write_failed: true`, `operation`, `correlationId`, `dbErrorCode`, `dbErrorMessage`, and no `err` object and no body. The unit test injects a pg-style error with `detail`/`parameters` and asserts the log object exactly, so neither field can leak. |
| S1 prove the guard fired | **Met** | Structural test asserts `TEAM_NOT_FOUND` **and** exactly one `topic.write_denied_template` row, scoped by actor, DB clock and `metadata->>'endpoint'`. |
| S2 param-agnostic prefix | **Met** | `^/api/v1/teams/:[^/]+/topics(/|$)`. See S-1 below for a remaining gap. |
| S3 no-write backstop | **Met (modified)** | Snapshot before, `assertTemplateUnchanged` after every request, `restoreTemplate` in `finally`. See S-2 for a flakiness risk. |
| S4 data-layer trigger | Deferred to F3 | Recorded. Accepted. |
| S5 rate limiting | Accepted residual | Recorded. No change. |
| S6 admin rows assert `actor_global_role` | **Met** | Unit test (003 to 006) and integration table (`actor_global_role: role`). |
| S7 rollback note | **Met** | `design.md` Migration Plan. |

## Focus areas

### 1. Guard placement in all five handlers

All five handlers (TOPIC-003 l.837, 004 l.1017, 005 l.1240, 006 l.1414, 007 l.1628) run, in
order: `rejectNonCanonicalTeamId`, the endpoint's authorization helper (403), `checkWritableTeam`
(404), `checkCustomizationLockGate` (409), then body validation (422). Nothing reads the body,
queries a topic, or writes before `checkWritableTeam`. `checkTeamExists` is gone, so there is no
old helper left for a new handler to pick up by mistake. TOPIC-007 keeps its facilitator-only
authorization, so an administrator gets 403 before the guard. The unit and integration suites
pin this: an engineer gets 403 with no template audit, an admin on 007 gets 403 with no template
audit, and the template path makes no `FROM sessions` lock query.

The guard is keyed on the immutable id, not on lock state, and it is not a `preHandler`, so
403-before-404 holds. Good.

### 2. 404 parity with a missing team

- **Status and body:** both branches use `buildErrorEnvelope("not_found", "Team not found.",
  "TEAM_NOT_FOUND")`. Only `correlationId` differs, and it is random per response anyway.
- **Headers:** `checkWritableTeam` sets no header. 006 and 007 set `Cache-Control: no-store` at
  handler entry, so both 404s carry it; 003 to 005 carry neither. The integration table compares
  every header except `date`, including `content-length`, against a nonexistent team, in both lock
  states and for both roles. That is the right test.
- **Timing:** both branches end in `applyTimingFloor(startTime)` after all DB work. The template
  branch adds one insert, which the 150 ms floor absorbs. The unit test asserts the floor runs after
  the insert. Under a degraded DB the insert can push past the floor; this is the accepted residual
  from my design review, and the sentinel id is public anyway. No new concern.
- **Audit difference:** a missing team writes no audit row and the template writes one. That is
  server-side only and not observable to the caller. Fine.

### 3. Audit event and insert-failure fallback

The row uses the same column layout as the lock denial, `team_id = DEFAULT_TOPICS_TEAM_ID`,
`actor_ip = request.ip` (resolved by `trustProxy: 1` in `app.ts`), and metadata of exactly
`{ endpoint, attempted_operation }`. The structured event goes through `emitAuditEvent`, which
forces `info` level on its child logger, so a raised application log level cannot drop it. A
failed insert gives a 404, not a 500, which keeps the parity property. B2 is fully met.

### 4. The structural test enumerates real routes

`buildFullApp` adds the `onRoute` hook **before** `registerRoutes`, and `registerRoutes` is the
same function `buildApp()` now calls. So the test sees exactly the production HTTP route table,
including routes registered inside plugins. A route left out of `registerRoutes` would not be
served in production either. Methods are normalized and uppercased, and wildcards count as writes.
The test asserts the selected set is non-empty and contains all five known routes, so an empty
selection cannot pass silently. It fails, not skips, under `REQUIRE_DB`.

A future topic-write route that admits only administrators would get 403 from the facilitator
fixture and **fail** the test. That is the right direction: it fails closed and makes the author
deal with it.

### 5. ID normalization bypasses

- `isCanonicalUuid` accepts only the anchored `8-4-4-4-12` hex form, before any query. Braces,
  hyphenless forms, other groupings, whitespace and trailing newlines are all rejected with 404 and
  no audit. JS `$` without `m` does not match before a trailing `\n`. The unit test adds the braced
  and hyphenless template spellings.
- **Case:** the regex accepts upper-case hex, but `00000000-0000-0000-0000-000000000001` has no
  hex letters, so every case variant is the same string as the constant and `===` cannot be
  bypassed. I re-checked the constant in `sessions/default-topics.ts` l.11.
- **Percent-encoding:** Fastify decodes path params before the handler sees them, so `%30`/`%2D`
  spellings either decode to the canonical string (and are guarded) or fail the regex. Only ASCII
  `[0-9a-fA-F]` is accepted, so Unicode digits are rejected.
- The authorized string, the existence query and the constant comparison all use the same
  `teamId`. Nothing rewrites it in between.

No bypass found.

## Suggestions (non-blocking)

**S-1. The structural prefix is version-anchored.** `^/api/v1/teams/...` would not select a future
`/api/teams/:teamId/topics/...` route. The join-links routes already use the unversioned
`/api/teams/` prefix, so this is a real convention in this codebase, not a hypothetical. The
`EXTRA_IN_SCOPE_ROUTES` list covers it only if code review catches it. Widening to
`^/api(/v\d+)?/teams/:[^/]+/topics(/|$)` is a one-line change. Consider doing it now, or when F1
carries the pattern over.

**S-2. `assertTemplateUnchanged` can flake against `default-topic-provisioning-integration.test.ts`.**
That file's test 4.3 atomically swaps the template's `is_default` rows for a fixture set and then
swaps them back, while vitest runs files in parallel. If the structural test (or the creation
regression) takes its snapshot, or asserts, inside that window, the id sets differ and the
assertion fails for reasons that have nothing to do with the guard. `restoreTemplate` handles this
safely (it deletes only non-default rows and updates by snapshot id, so it cannot corrupt the
other file's rows). But a flaky security gate tends to get retried until it passes, or skipped.
Serialize the template-touching files (an advisory lock shared by the swap and the snapshot
helper, or a vitest `poolMatchGlobs`/sequence group), or compare only non-default rows plus the
fields a topic write can change on default rows. Low effort, and it protects the gate.

**S-3. `dbErrorMessage` is not guaranteed value-free.** Some pg messages echo the offending value
(for example `invalid input syntax for type inet: "..."`). Here the only values bound are actor
id, role, IP, a constant team id and the endpoint/operation strings, none of which is sensitive
beyond what the event already logs. So this is acceptable as built. Add a one-line comment to that
effect, so that nobody later adds a user-controlled field to this insert without considering it.

**S-4. `templateUrl` assumes plain `:name` segments.** A future route with a regex-constrained
param (`:id(^\\d+)`) or a `*` wildcard segment would get a malformed URL. The request would 404 at
the router, fail the `audit === 1` assertion, and so fail closed. Note it in a comment so the
failure is easy to diagnose.

## Residuals carried forward (unchanged, for the record)

- The sentinel is still a normal team on every non-topic surface until F1. The membership-creation
  chain (managers → join links → redemption) is open and must be in F1 as specified.
- No data-layer enforcement (F3). Migrations and ad-hoc SQL bypass the guard.
- No rate limit on topic-write routes. Denial rows can be generated without bound by any
  facilitator, the same as the existing lock path.
- Latency beyond the 150 ms floor under a degraded DB.

## Merge gates (not code, still open)

1. Tasks 6.1/6.2: a named owner runs the data check in each environment, including **zero sentinel
   `team_memberships` rows in any `removed_at` state**.
2. Task 6.3: F1 is filed with the managers, member-role, join-link and redemption routes named as
   in scope, the structural-test pattern carried over, and a security-review tag, and is linked in
   `proposal.md`/`design.md`.

*— Tomás Ferreira*
