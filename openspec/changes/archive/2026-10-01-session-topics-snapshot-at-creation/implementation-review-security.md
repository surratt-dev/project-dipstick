# Implementation Review: Security — session-topics-snapshot-at-creation (#175)

**Reviewer:** Tomás Ferreira (Senior Application Security Analyst)
**Date:** 2026-10-01
**Reviewed:** uncommitted working tree on `agent-team/175-session-topics-snapshot-at-creation`, checked against `design-review-security.md` (M1–M3, S1–S5) and `design.md`
**Verdict:** **Changes required.** There is one must-fix. The tasks.md 2.3 NULL coercion introduces an authorization bypass of the facilitator-is-team-member constraint. Everything I asked for in the design review is implemented correctly.

## What I verified

| Area | Code | Result |
|---|---|---|
| Snapshot helper derives the team from the session row (M1) | `src/sessions/session-topic-snapshot.ts:44-53, 78-82` | **OK.** Signature is `(client, sessionId)` only. The statement joins `topics t ON t.team_id = s.team_id`, so a mismatch is impossible by construction. Test: `session-topic-snapshot-integration.test.ts:95` ("never gives team A's session team B's active topics"). Unit test `session-topic-snapshot.test.ts:35` pins the statement shape. |
| Lock keyed on the row, not the URL | `facilitator-sessions.ts:885` | **OK.** `lockTeamTopics(client, sessionRow.team_id)`. The `::uuid::text` canonical key (`session-topic-snapshot.ts:23`) closes the upper-/lower-case lock split. |
| `/advance` live-role 403 (S1) | `facilitator-sessions.ts:824-858` | **OK.** A missing user row reads as `"unknown"` and is denied. The denial is audited before the 403, with `{ session_id }` metadata only. Test: `room-open-integration.test.ts:231`. |
| Ordering 404 → 403 team → 403 creator → 403 role → 422 → (tx) 409 | `facilitator-sessions.ts:779, 796, 807, 830, 860, 918` | **OK.** The 409 is reachable only inside the transaction, after every authz check. Tests: `room-open-integration.test.ts:177` (422 not 409) and `:191` (non-creator on a zero-topic team gets 403, not 409). Topic state cannot be probed without authorization. |
| Lock taken only after authz | `facilitator-sessions.ts:877-885` | **OK.** An unauthorized caller cannot hold a team's lock. |
| Guarded UPDATE (team + facilitator + status) | `facilitator-sessions.ts:890-913` | **OK.** `WHERE id = $1 AND team_id = $2 AND facilitator_id = $3 AND status = 'draft'`, with `rowCount !== 1` checked explicitly, so the race returns 422. Test: `room-open-integration.test.ts:212`. |
| Audit metadata content boundary (M2) | `facilitator-sessions.ts:955-961, 659-664`; `audit-logger.ts` diff at L192-202, L303-328 | **OK.** Ids and count only. The audit_log row carries `topic_ids` and `topic_count`, and the `emitAuditEvent` line carries `topicCount` only (`:983`, `:736`). Contracts are documented in `audit-logger.ts`. Test `room-open-integration.test.ts:115` asserts there is no topic text. |
| Snapshot-failure 500 does not leak (S3) | `facilitator-sessions.ts:933-941, 288-296, 272-286` | **OK.** Fixed message plus `correlationId`. The DB error goes to `request.log.error` with the same `correlationId`. The empty-template body omits `templateTeamId`. Test: `room-open-integration.test.ts:158`. |
| Error categories (S4) | `src/routes/error-envelope.ts:21-26` | **OK.** `precondition_failed` / `internal_error`, with no ad hoc categories. |
| `activeTopicCount` | `facilitator-sessions.ts:2368-2383`; `shared/.../team-content-access.ts:228-235` | **OK.** Present on the draft branch only, sourced from `sr.team_id`, after the `facilitator_id` check (`:2310`). It discloses nothing beyond Topic Management. |
| R5 registration snapshot | `realtime/session-registration-snapshot.ts:40-62` | **OK, and it narrows exposure.** Both joins are now session-scoped (`st.session_id = s.id`), and `votes` is keyed on `st.id` with `voter_id = $2` preserved. The returned `sessionTopicId` is the same `session_topics.id` that begin-voting already sends to the same subscribers. No new data reaches any principal. |
| Backfill script (M3) | (no `scripts/` present) | **N/A.** It is not written, which is consistent with the gate in design.md Migration Plan step 3. The controls stay recorded there. |

## Must-fix

### MF1. The NULL coercion of non-canonical UUIDs bypasses the facilitator-is-team-member constraint (introduced by this change)

`standing-facilitator-access-helper.ts:3, 49` binds `teamId` as `NULL` when it fails a strict 8-4-4-4-12 regex. That turns the membership join into `is_member = false`. In this policy, `isMember` is a **denial** signal (`FACILITATOR_IS_TEAM_MEMBER`), so coercing "unknown" to `false` fails **open**.

Postgres accepts UUID forms that the regex rejects, and canonicalizes them. I verified this against the dev `postgres:16` container: `'{a0eebc99-...}'`, `'a0eebc999c0b4ef8bb6d6bb9bd380a11'` (no hyphens), and `'a0eebc99-9c0b4ef8-bb6d6bb9-bd380a11'` all cast to the same canonical UUID. Two callers then use the **raw** `teamId` for everything after the authz decision:

1. **`POST /api/v1/teams/:teamId/sessions/draft`**
   - `facilitator-sessions.ts:289`: `evaluateStandingFacilitatorAccess` returns `isMember: false`.
   - `:314-316`: `SELECT id FROM teams WHERE id = $1` with the raw value finds the team.
   - `:333`: the `is_member` 403 and its `session.draft_denied_membership_conflict` audit row are skipped.
   - `:381-391`: the INSERT creates the draft on the team.

   A facilitator who is a member of team T can therefore create a session for T by requesting `/api/v1/teams/<T without hyphens>/sessions/draft`. They can then `/advance` it using the canonical id, since the live-role check passes and they are `facilitator_id`. Advancing gives them Path 3 team-content access to their own team's history. That is exactly what the Decision D1 constraint exists to prevent. The bypass also writes no denial audit row.
2. **`GET /api/v1/teams/:teamId/topics/all`**
   - `content.ts:560`: `checkStandingFacilitatorOrAdminAuthorization` returns `authorized` for a member facilitator.
   - `:581, :607, :633+`: the raw value is used to read the team name, all active and archived topics, and `team_annotation` with provenance.

   This bypasses the FR-8.2 `FACILITATOR_IS_TEAM_MEMBER` denial.

The topics.ts write routes (TOPIC-003/004/005/006/007) fail closed. They call `checkTeamExists` (`topics.ts:138-150`), which applies the same coercion and answers 404. They are safe only by coincidence of ordering, not by design.

Before this change, the raw value went to Postgres in the membership query too, so a non-canonical form matched correctly and garbage raised 22P02 (a 500, which fails closed). The 500 was ugly but safe. The fix replaced it with a fail-open path.

**Required:**
- Do not encode "this is not a team id" as "not a member". Reject non-canonical ids at the boundary instead. Either add a Fastify params schema (`teamId: { type: "string", pattern: <strict UUID> }`) on every `:teamId` route, which answers 400/404 before any handler logic, or have the helper return a distinct result (for example `null` → 404 at the caller) rather than a decision.
- Whichever approach is chosen, the team-existence check and the membership check must see the **same** value. The simplest invariant: validate once, at the top of the handler, then use the validated value everywhere.
- Add regression tests on `POST /draft` and `GET /topics/all` for a member facilitator using the hyphenless and braced forms of their own team id. Both must be denied (403 or 404), with no session row created. Extend `session-topic-snapshot-integration.test.ts:137` to cover these two routes, not only add/archive/restore/reorder.

## Should-fix

### SF1. "500 never leaks DB text" holds only for the snapshot step

The app registers no `setErrorHandler` (confirmed with a grep of `src/`), and Fastify's default handler echoes `err.message`. In `/advance`:
- The outer `catch` (`facilitator-sessions.ts:966-968`) rethrows failures from the lock, the guarded UPDATE, the audit INSERT, and COMMIT.
- The pre-transaction `SELECT ... WHERE id = $1` (`:773-777`) raises 22P02 on a non-UUID `:sessionId`.

The same applies to `POST /teams`'s fall-through `throw` (after `:296`). All of these reach the default handler with Postgres text, for example `invalid input syntax for type uuid: "x"`. This is pre-existing and reachable only by authenticated users, but it contradicts the design's stated property. Either register a global error handler that returns the house envelope with a fixed message and logs `err` with the `correlationId`, or file a dated, owned follow-up. A global handler is the secure-default fix. It removes the need for each handler to remember to do this.

### SF2. Use `sessionRow.team_id` for the audit rows' `team_id`

`facilitator-sessions.ts:842` (role denial) and `:954` (room open) write the URL `teamId`. After the strict-equality check at `:796` the two are equal, so this is not exploitable today. It is the same principle as M1 and as the lock at `:885`: the committed record should come from the row, not the request. It is also what keeps the audit row canonical if MF1's fix ever loosens the equality check (for example to a case-insensitive compare).

## Nits

- **N1.** The role-denial audit write (`:833-845`) runs before the status check, so a demoted facilitator can write `session.advance_denied_role` rows against any of their past sessions in any status. The volume is bounded by their own sessions, and the ordering is otherwise correct (no status oracle). Acceptable. Note it in the event's doc comment so a reviewer of audit volume is not surprised.
- **N2.** `facilitator-state` (`:2310`) does not enforce the live `global_role`, so a demoted creator can still read `activeTopicCount` for their own draft. The disclosure is trivial. Fold it into design.md Follow-up 2 (live role on the other session-phase endpoints) rather than fixing it here.
- **N3.** `UUID_PATTERN` is now defined twice (`standing-facilitator-access-helper.ts:3`, `topics.ts:55`). When MF1 is fixed, define one validator in one place. Two copies of a security-relevant regex will drift.

## Disposition requested

MF1 must be fixed, with the regression tests above, before this change merges. SF1 is either fixed (global error handler) or recorded as a dated, owned follow-up. SF2 is a two-line change and should land here. The nits are at the implementer's discretion.

## Re-verification (2026-10-01, Tomás Ferreira)

Checked against the working-tree diff. I made no code changes.

**MF1: cleared.**
- The NULL coercion is gone. `evaluateStandingFacilitatorAccess` (`auth/standing-facilitator-access-helper.ts`) and `checkTeamExists` (`routes/topics.ts`) now bind `teamId` as given. Neither rewrites its input.
- There is one validator, `isCanonicalUuid` / `UUID_PATTERN_SOURCE` in `routes/uuid.ts`. That also resolves N3: the duplicate regexes are gone.
- I traced every caller of `evaluateStandingFacilitatorAccess`, `checkStandingFacilitatorAuthorization`, `checkStandingFacilitatorOrAdminAuthorization` and `checkTeamExists`. All of them sit behind a canonical-id 404 that runs before any query:
  - POST `/sessions/draft` (`facilitator-sessions.ts`)
  - GET `/topics/all` (`content.ts`)
  - POST `/topics`
  - DELETE `/topics/:topicId`
  - POST `/restore`
  - PUT `/order`
  - PUT `/annotation` (`rejectNonCanonicalTeamId`, which is the first statement in each handler)
- No route that reaches these helpers accepts a non-canonical id.
- Defence in depth: the bypass required the coercion. With the coercion reverted, a hyphenless, braced or regrouped id passed to the helper would be cast by Postgres to the same uuid, so the member check would still fire. The boundary check now makes the authorized string and the queried string identical.
- A real-DB regression test covers all seven routes for the hyphenless, braced and regrouped spellings (`session-topic-snapshot-integration.test.ts`). It asserts that Postgres resolves each spelling, that the response is 403/404, that the body does not echo the team id, and that no session or topic row changes.

**Uppercase.** `isCanonicalUuid` accepts uppercase canonical ids (`[0-9a-fA-F]`). This does not matter for authorization:
- Every SQL use binds the id into a `uuid` comparison, and Postgres normalizes case there. Authorization and data queries therefore resolve the same team.
- The one string-keyed construct, the advisory lock, is canonicalized with `hashtext($1::uuid::text)`. There is a test for the uppercase lock case.
- `/advance` compares `sessionRow.team_id !== teamId` strictly in JS. An uppercase id fails closed (rejected), so it is not a bypass.
- The only effect is cosmetic: POST `/draft` echoes the caller's uppercase `teamId` in its 201 body. Not a finding.

**SF1: cleared for this change's routes.**
- `/advance` rejects a non-canonical `sessionId` with 404 before it queries.
- The snapshot and room-open catch blocks return `internal_error` with a fixed message and a `correlationId`. They log `err` server-side and never rethrow, so Fastify's default handler cannot echo `err.message`.
- The POST `/teams` catch-all works the same way.
- `NoActiveTopicsError` and the status-conflict 4xx messages contain only the session status, which is not database text.
- The app-wide global error handler is still the recorded follow-up (release-notes follow-up 6). It is not a blocker here.

**SF2: cleared.** The audit `team_id` (the INSERT and `emitAuditEvent`), the lock key and the room-open UPDATE now use `sessionRow.team_id`, not the URL parameter.

**New leaks introduced by the fix:** none found.
- The new 404 for a malformed id says "Team not found" or "Session not found". A malformed id names no team, so answering 404 before 403 reveals nothing about any team's existence.
- None of the new 500 bodies include database text.

**Verdict: CLEARED.** MF1, SF1 and SF2 no longer block merge.
