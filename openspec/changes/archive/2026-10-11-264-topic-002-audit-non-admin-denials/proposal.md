# Proposal: 264-topic-002-audit-non-admin-denials (#264)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (revised after Priya Nair's `explore-review-facilitator.md` and Marcus Delgado's `explore-review-ba.md`). Follow-up 5 from the archived change #232.*

## Why

"Our team's definition" is where engineers say, in their own words, what a topic means for their team. The no-manager rule protects it. Two 403s on TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`) leave no durable trace today: `NOT_A_FACILITATOR` (participants, global engineering managers, anyone who is not facilitator or admin) and `FACILITATOR_IS_TEAM_MEMBER` (the facilitator-from-another-team rule firing). Admin reads are audited; denials are not. A global EM poking at a team's topic configuration screen leaves nothing, and the more sensitive TOPIC-002 is silent where TOPIC-001's equivalent is at least log-only.

BRD SEC-13 requires access control denials to be captured in the audit log. SEC-13 does not say "durable row" or "fail-closed"; a durable `audit_log` row plus a structured event is the design choice this change makes to satisfy it, and the proposal does not claim SEC-13 mandates that shape. The row is evidence the control is being tested. It records who tried, never what was behind the door.

**Driver for doing this now:** SEC-13 is an open BRD gap that #232 deliberately left behind, and #264 is the governing scope. No compliance date is known; if the VP of Engineering knows of one, it should be recorded here. The change is small (one INSERT and one log event on one rare 403 path, no migration, no API shape or UI change) and is not intended to compete with adoption work.

**Why `FACILITATOR_IS_TEAM_MEMBER` keeps a durable row.** Rachel Okonkwo asked that this benign reason write no row, on privacy grounds (a log of member-facilitators' clicks). Issue #264's acceptance criteria require a durable row and a real-Postgres integration test for a member-facilitator, and omitting it would make the audit selectively blind to the one structural rule firing. The row stays, and the privacy concern is answered by access and retention, not suppression: no application endpoint or screen reads these rows (database and log-sink access only), and none ever serves a non-admin caller; there is no UI surface, aggregation or alerting; retention follows the existing `audit_log` policy with no change (no table-specific purge exists today); volume is one row per member-facilitator load of the Topics screen; and the reason is labelled informational in code and docs. No non-admin read path, aggregation, alerting, or user-visible signal is added, so Rachel's stated threshold for re-consulting her is not met. Her note that this hardens a rare path while the real user-facing problem is the Topics link is accepted; the link fix is Follow-up 1.

## What Changes

- Each TOPIC-002 403 with reason `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER` writes exactly one durable `audit_log` row, operation `topic.config_list_denied` (one operation, `reason` in metadata, no dedup), plus a structured event. Metadata is exactly `{ endpoint, http_status: 403, reason }`; `team_id` is the requested id (the column has no foreign key, so no team lookup is made). A missing `users` row records `actor_global_role = 'unknown'` and `actor_roles = NULL`.
- The shared authorization helper's denied variant gains an additive `actorGlobalRole: string | null` so the row records the role the decision actually used, with no second read. TOPIC-003..007 behaviour does not change.
- `actor_ip` comes from `request.ip`, the same source as the `admin.topic_config_accessed` row in the same handler. `actor_roles` is the caller's `users.roles::text[]` in stored order, captured inside the insert statement itself (LEFT JOIN `users`; NULL when there is no users row), so there is no separate role read.
- Order on the denial path: insert (carrying the role read), event, timing floor, send. The 403 status, `Content-Type` and body equal a snapshot committed before the edit. The floor is a minimum: no extra wait after an audit that already exceeded it.
- Failure mode (ruled by Security, P1): fail-open on the response, loud on the signal. Issue #264 item 3 is headed "Fail closed" but its own text recommends fail open; the text and the ruling win and the discrepancy is recorded. A failed insert (error or the 500 ms `AUDIT_WRITE_TIMEOUT_MS`) still returns the same 403 and emits a `topic.audit_write_failed` event (error level, carries `reason`, log-only, #131). The denial event is emitted even when the insert failed, with `rowWritten: false`. See design.md D3 and D4.
- The REST API Contract entry for TOPIC-002 gains an audit sentence in Authorization / Notes.
- `docs/deployment.md` lists `topic.audit_write_failed` among the log-only events, states there is no consumer (#131), and adds an `audit_log` growth/retention note; the `audit-logger.ts` comment on `topic.config_list_denied` states it is durable and names `topic.config_read_denied_role` as the log-only sibling.
- The `team-content-access` scenario that said the denial "does not decide SEC-13 auditing" is reconciled: the admin assertion stays, the non-goal sentence goes, the durable-row assertion is added; the audit visibility guard names the new operation.

## Ritual constraints preserved

- **No-manager rule:** the denial is unchanged and structural. Auditing never turns a denial into a 200 under any failure mode.
- **Facilitator from another team:** the rule is untouched; its firing is now recorded and labelled informational.
- **Not a performance tool:** no non-admin endpoint returns these rows; no aggregation or alerting is delivered.
- **No surveillance in the room:** participants and facilitators are never told an attempt was recorded. No banner, toast, response field or text, ever.

## Non-goals

This change covers two denial reasons on one endpoint and closes the SEC-13 gap for those only. Remaining denial gaps: TOPIC-001 (log-only, #187), TOPIC-003..007 (#208), and 401 and malformed-id 404 responses. Also out of scope: login failures, alerting or aggregation on denial rows, any UI change, and the Topics link and member-facilitator denial copy (follow-up below). Nothing here detects patterns: the rows enable post-hoc reconstruction only. `docs/deployment.md` states that no audit signal is consumed by any alert (#131); this change does not fix that.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `topic-customization-lock`: adds five lean requirements (row and event; unchanged response and timing; fail-open denial audit; admitted callers pay nothing; visibility and labelling), collapsed from an earlier twelve after executive review.
- `team-content-access`: reconciles the non-admin denial scenario and extends the audit visibility guard to `topic.config_list_denied`.

## Impact

- Backend: `packages/backend/src/routes/content.ts` (TOPIC-002 deny branch), `auth/standing-facilitator-access-helper.ts` (additive field), `auth/audit-logger.ts` (two operations registered), tests (unit, real-Postgres integration, TOPIC-003..007 regression).
- Docs: `docs/deployment.md`, the REST API Contract entry for TOPIC-002.
- No migration, no API shape change, no frontend change.
- Benign volume: a `FACILITATOR_IS_TEAM_MEMBER` row is written every time a member-facilitator opens that team's page, because the Topics link is always rendered (the server gates). Expected noise by construction.

## Follow-ups

1. Hide or disable the Topics link for a member-facilitator, and improve the denial copy. **Issue: #276.**
2. Product question: does a member-facilitator have a route to the definitions she needs to prepare? (P3) Non-blocking; handed to Product (owner: Product Owner), recorded in the PR description so it is not lost; issue #279.
3. Bounded volume control for denial rows (episode shape of `topic.write_rate_limited`; Redis; its fail-open/closed choice decided there). **Issue: #277.** Required by Security before the issue is closed: #277 now exists; `Closes #264` is permitted once the PR links it.
4. `audit_log` growth/retention statement and a top-N denial-writers query for operators. **Issue: #278.**

## Release check

Usability pass with Priya: a member-facilitator opens their own team page, clicks Topics, and confirms the experience is unchanged: same message text, response time not visibly different. Before merge the PR also states (a) whether Fastify `trustProxy` makes `request.ip` trustworthy and (b) whether an edge or global limit already covers this route.

## Open decisions

None blocking. P1, P2 (Security) and P4 (Architect) are ruled in design.md D3 to D6; the role read is folded into the insert (D4). Non-blocking: P3 (Product: who consumes the rows), P5 (user: file the follow-up issues and fill the placeholders). Rachel Okonkwo's concerns are answered above; no re-consultation is needed unless a non-admin read path, aggregation, alerting or user-visible signal is added.
