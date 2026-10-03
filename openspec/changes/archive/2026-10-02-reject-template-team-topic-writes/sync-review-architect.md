# Sync review: reject-template-team-topic-writes (#188)

*Ingrid Sollenberger, Solution Architect. Reviewed commit 5d36790 (spec sync) against `design.md`,
`git diff main...HEAD`, `routes/topics.ts`, `routes/register-routes.ts`, `auth/audit-logger.ts` and
the new tests.*

## Verdict

**No code-side drift.** The synced main specs match the delta specs line for line: every non-heading
line of each of the six delta specs is present in its main spec, and no main spec keeps stale text
that contradicts the template rule. I found one piece of doc drift, in `design.md` D4 and `tasks.md` 3.3,
and fixed it in this commit.

## Checks

| Area | Spec | Code | Result |
|---|---|---|---|
| Check order | non-canonical id → authz 403 → existence 404 → (2a) template 404 → lock 409 → endpoint checks; stated in all five endpoint specs and in `default-topic-provisioning` | All five handlers call `rejectNonCanonicalTeamId` → endpoint authz → `checkWritableTeam` → `checkCustomizationLockGate` (topics.ts l.860–906, 1040–1080, 1262–1301, 1441–1478, 1656–1704). TOPIC-007 uses facilitator-only authz, so an admin gets 403 | Match |
| Response envelope | `404 { error: { category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found.", correlationId } }`, timing floor applied, headers unchanged | Both 404 branches use the shared `teamNotFoundEnvelope()`. The guard sets no header. `no-store` comes only from handler entry on 006/007. `applyTimingFloor` runs before send | Match |
| Audit row | `topic.write_denied_template`; actor id/role/ip; `team_id` = sentinel; metadata is exactly `{ endpoint, attempted_operation }` | `writeTemplateDenialAudit` matches. All five endpoint strings and operation mappings match the spec list | Match |
| Structured event | emitted on both outcomes, with row fields plus `correlationId` and whether the row was written; `correlationId` not in metadata | `emitAuditEvent(..., { ..., correlationId, auditRowWritten })` after the try/catch. Operation is registered in `audit-logger.ts` | Match |
| Insert failure | caught; error log with `audit_write_failed: true`, operation, correlationId, db code/message only; same 404, never 500 | Matches. Unit test asserts there is no `err` key, the floor is called, and the event has `auditRowWritten: false` | Match |
| Structural scope | versioned or unversioned prefix, any param name, POST/PUT/PATCH/DELETE/wildcard, empty extra list, no exemptions, `{}` body, fixed other-param UUID, 404 + code + one scoped row, snapshot/assert/restore (updates by id, deletes only added `is_default = false` rows) | `TEAM_TOPICS_PREFIX = /^\/api(\/v\d+)?\/teams\/:[^/]+\/topics(\/|$)/`; the rest matches, and so does the `template-snapshot.ts` restore | Match (design was stale, fixed) |
| `registerRoutes` | D4: Routes block moved unchanged, `/auth` prefix kept, WS/session/helmet left in `buildApp` | Matches | Match |

## Doc drift fixed in this commit

- **`design.md` D4 "Selection"** and **`tasks.md` 3.3** still gave the structural regex as
  `^/api/v1/teams/:[^/]+/topics(/|$)`. The spec and the code use `^/api(/v\d+)?/teams/...`, after
  security implementation review S-1. I updated both and cited S-1, which `tasks.md` l.148 already
  recorded as accepted.

## Observations (no change made)

1. **Wildcard-route edge in the structural test (code, test-only).** A route with method `ALL`/`*` is sent as `POST`,
   and the audit lookup filters on `metadata.endpoint = "POST <url>"`. Whether that passes depends on
   the endpoint string the handler writes. The test fails closed, so this cannot hide a regression. No
   such route exists today. Leave it as is, and revisit if a wildcard topic route is ever added.
2. **Audit-failure unit coverage is representative, not exhaustive.** It covers TOPIC-003 (no
   `no-store`) and TOPIC-006 (`no-store`). The spec scenario says "any in-scope request". All five
   handlers share one helper, so this is acceptable.
3. **`topics.ts` file-header cascade** begins at "1. Identity/role authorization" and leaves out the
   earlier `rejectNonCanonicalTeamId` step. This predates #188, the spec states the step, and it is a
   comment only. Not changed, because it is production source.
4. **`design.md` Context line numbers** (l.740, 908, ...) describe the code before the change and no longer match
   `topics.ts`. They are historical context and are not normative, so I left them.

## Still open (human gates, unchanged)

F1 filed with the B1 content, a named data-check owner, and the pre-merge data check result.
