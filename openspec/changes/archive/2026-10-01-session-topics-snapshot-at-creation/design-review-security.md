# Design Review: Security — session-topics-snapshot-at-creation (#175)

**Reviewer:** Tomás Ferreira (Senior Application Security Analyst)
**Date:** 2026-10-01
**Reviewed:** `design.md`, `proposal.md`, checked against `packages/backend` at `c4585cc`
**Verdict:** **Approve with changes.** There are three must-fix items. None of them needs a redesign. Each one is a constraint that has to be written down before implementation, because otherwise it stays implicit.

## Scope and summary

This change adds the first write path to `session_topics`, which is the table that defines what a team votes on. It also changes two state transitions (`/advance`, `POST /teams`), adds a field to an authorized read (`facilitator-state`), changes a WebSocket read (registration snapshot), extends two audit rows, and describes an operator script that may or may not be written.

Most of the design is sound. Authorization stays where it is today: pre-transaction checks on `/advance`, and the role check first on `POST /teams`. The new `409` is reachable only after authorization. The R5 rewrite closes a real scoping gap. My concerns fall into three areas. The new helper trusts a caller-supplied `teamId` for a cross-table copy. The audit metadata has no stated content boundary. The backfill script is a privileged write path whose controls are entirely unspecified.

## What I verified in code

| Claim / area | Code | Finding |
|---|---|---|
| `/advance` authz | `facilitator-sessions.ts` L683–748 | 404 → 403 (`team_id` mismatch) → 403 (not `facilitator_id`) → 422 (not draft), all before any write. The design keeps this order, and the new 409 comes after it. **OK.** |
| `/advance` live role check | L750–754 | `global_role` is read for the audit row only and falls back to `"unknown"`. It is **never enforced**. See S1. |
| `POST /teams` authz | L490–535 | The role check comes first, and a denial writes an audit row. **OK.** The snapshot runs inside the existing transaction. |
| `facilitator-state` scoping | L2088–2125 | `WHERE id = $1 AND team_id = $2`, plus a `facilitator_id` equality check. The `activeTopicCount` query is therefore reached only by the session's own facilitator. **OK.** |
| Advisory-lock invariant | `topics.ts` L780/925/1127/1288 lock. The annotation PUT (L1421) **explicitly does not lock.** | The design's statement that every write to a team's topics holds the lock is inaccurate. See S5. |
| `session_topics` constraints | `2_create_tables.sql` L86–101 | `UNIQUE (session_id, topic_id)` and `UNIQUE (session_id, display_order)` exist. **No constraint ties `session_topics.topic_id` to the session's team.** See M1. |
| Registration snapshot | `session-registration-snapshot.ts` | The old join `st.id = s.current_topic_id` is not session-scoped. The new `st.session_id = s.id AND st.topic_id = s.current_topic_id` is session-scoped and unique, so it returns at most one row. The `voter_id = $2` self-disclosure is preserved. **Improvement.** |
| Error envelope | `topics.ts` L55–80 (`buildErrorEnvelope`) | A local `ErrorCategory` exists, but no shared one does, and neither includes `"conflict"` or `"server_error"`. The shared `AuthErrorCategory` uses `"internal_error"`. See S4. |
| Audit event docs | `auth/audit-logger.ts` L187–192, L292–298 | The metadata contracts for `session.state_changed` and `team.created_with_session` are documented there. They need updating. See M2. |
| Draft-expiry access | `team-content-access-helper.ts` L50, L216 | Path 3 gives a facilitator team-content access for a `draft` **only within 24h**, but for `lobby`..`wrap_up` **without a time limit**. See S2. |

## Must-fix

### M1. The snapshot helper must not trust a caller-supplied `teamId` for the topic source

`snapshotSessionTopics(client, sessionId, teamId)` copies `topics.name`, `prompt`, and `team_annotation` from `WHERE t.team_id = $2` into the session given by `$1`. No schema constraint checks that the topics belong to the session's team. If any caller passes a `teamId` that does not match `sessionId`, one team's topic names, prompts, and free-text annotations are copied into another team's session. That session's participants then see them, and they are stored permanently in that team's history.

Today both route callers pass values that were already validated. `/advance` checks `sessionRow.team_id === teamId` before the transaction, and `POST /teams` uses ids it just created. The design itself names two more callers that are less safe:

- **The backfill script** takes `(session_id, team_id)` pairs from an operator query. Running it by hand with one wrong argument causes a cross-team disclosure.
- **A future "reopen" path** (Risks section) would be a new caller with its own validation.

**Required:** derive the team inside the statement so a mismatch is impossible by construction:

```sql
INSERT INTO session_topics (...)
SELECT s.id, t.id, row_number() OVER (ORDER BY t.display_order, t.id), ...
FROM sessions s
JOIN topics t ON t.team_id = s.team_id AND t.status = 'active'
WHERE s.id = $1
RETURNING topic_id, display_order
```

The helper takes `sessionId` only, or takes `teamId` only for the advisory lock and asserts that it equals `sessions.team_id`. In `/advance`, add `AND team_id = $2 AND facilitator_id = $3` to the conditional `UPDATE` as defense in depth, so the guarantee lives in the statement that commits and does not depend only on the pre-transaction read. Add a test that calls the helper with a session from team A and asserts that no team-B topic can end up in its rows.

### M2. Audit metadata needs a stated content boundary, for both sinks

D12 adds `topic_count` and `topic_ids`. Ids and a count are fine. The design does not say what the metadata **must not** contain, and it does not say which sink each field goes to.

- **Content:** make it normative that the audit metadata holds `topics.id` values and the count only. **Never** `topic_name`, `topic_prompt`, or `topic_annotation`. The annotation is team free text, and the TOPIC-007 precedent (`topics.ts` L1426–1428, topic-annotation design Decision 7) keeps it out of the application log on purpose, because the log has a different retention and access profile. A developer who "helpfully" adds names to make the audit row readable would break that rule. Put the rule in the spec, not just in a code comment.
- **Sinks:** state whether `topic_ids` also goes into the `emitAuditEvent` structured-log fields (L791, L656) or only into the `audit_log` row. My recommendation: both sinks get `topicCount`, and `topic_ids` goes into the `audit_log` row (the durable record). Either choice is acceptable, but it must be explicit and tested. The implementer should not have to guess.
- **Docs:** update the metadata contracts in `audit-logger.ts` for both operations. This is the documented source of truth for what each operation carries. Add it as a task.
- **Failure paths:** I accept that no audit row is written on `409 NO_ACTIVE_TOPICS` (it is not a security event) or on the `POST /teams` empty-template `500`. The `500` is covered by the error log. Make that log line include the response's `correlationId` (see S3).

### M3. The backfill script's security controls must be specified now, even though the script is written only on "Yes"

The design calls the script "the single exception" to the room-open rule. That makes it a privileged write path into the voting record that skips every route-level check. "Write it only on Yes" defers the engineering work, which is fine. It must not also defer the controls, because a script written in a hurry at release time is how the controls get skipped. The design should record these as requirements for the script:

1. **Re-check under the lock.** Inside the transaction, after the team advisory lock: confirm `status IN ('lobby','pre_session')` and `NOT EXISTS (SELECT 1 FROM session_topics WHERE session_id = $1)`. Skip the session if either check fails. The detection query's result is stale by the time the script runs, and `UNIQUE (session_id, topic_id)` would otherwise turn a re-run into a 23505 halfway through the batch.
2. **Session-id input only** (follows from M1). The team is derived from the session row and is never an argument.
3. **An audit row per session.** For example, operation `session.topics_backfilled`, with `actor_global_role` set to an operator/system marker, plus `topic_count` and `topic_ids`. The design currently writes no audit row for these rows. Without one, a backfilled session cannot be told apart from a normally opened session with `room_opened_at` NULL, and that is exactly the question an investigator will ask.
4. **Dry-run by default**, with an explicit flag to write, and output listing the session ids it would touch.
5. **Credentials and packaging.** Run the detection query with a read-only role. The script runs with operator credentials from the secret store, never from a checked-in env file. `packages/backend/scripts/` must not be importable from `src/` or registered as a route, and it must not be in the runtime image's entry path.

The release-notes record should include who ran the script, when, and the session ids.

## Should-fix

### S1. `/advance` does not enforce the live `global_role` (pre-existing; the consequence grows here)

`/advance` authorizes only on `facilitator_id === session.userId`. A user whose facilitator role was revoked after creating a draft can still open the room. That gives them Path 3 team-content access with no time limit (S2), and with this change it also lets them fix the team's voting list. The handler already queries `global_role` at L750. Rejecting with 403 when it is not `facilitator`, and writing a denial audit row (the `team.creation_denied_role` pattern), costs about five lines. This is pre-existing and does not block this change. I would rather it landed here than in a follow-up nobody picks up.

### S2. The expired-draft deferral (D10) is an access-control deferral, and the follow-up must say so

The design and the proposal frame the 24h expiry as "history access, not topic freshness". That is true, but it leaves out the security consequence. `team-content-access-helper.ts` gives draft-path access only within 24h, while `lobby` and later statuses get access with no time limit. Advancing an expired draft therefore **re-establishes** a facilitator's team-content access after it lapsed. This is pre-existing, since `/advance` already transitions today. I accept the deferral. The follow-up issue must be labelled security, must state this access consequence, and must have an owner. As it stands, this is an implicit security decision.

### S3. Error disclosure: acceptable, with two adjustments

- `409 NO_ACTIVE_TOPICS` tells the caller that the team has zero active topics. It is reachable only by the draft's own facilitator, after 404/403/422. **Add an ordering test:** a non-creator calling `/advance` on a zero-topic team gets **403**, not 409, so the topic state cannot be probed without authorization.
- `POST /teams` `500`: the fixed message ("default topic set is not configured") is a mild configuration disclosure to an authenticated facilitator. It is acceptable, and more useful than a generic message. **Do not** put `templateTeamId` or any SQL or constraint detail in the response body. Include `correlationId` in the body (house envelope) **and** in the `request.log.error` line, so the operator can match a user report to the log entry. The design's log line currently does not include it.
- The existing 422 message echoes the current status (`'lobby'` etc.) to an authorized caller only. This is unchanged, and fine.
- Any other failure from the snapshot statement (for example a 23505 from a constraint drift) must go to the global error handler's generic `500`, never echoing a `DatabaseError` message. Confirm the `catch` in the restructured `/advance` rethrows rather than formatting `err.message` into a response.

### S4. Error envelope: use the house helper and categories, and do not invent new ones ad hoc

The design specifies `category: "conflict"` and `category: "server_error"`. Neither exists today. `topics.ts` has a local `ErrorCategory` (`forbidden | not_found | precondition_failed | invalid_request`) with `code` already supported. `teams.ts` sends `code` on its 409s. The shared `AuthErrorCategory` uses `internal_error` for server-side failures. Pick existing categories (`precondition_failed` for the 409, matching `TOPIC_ORDER_STALE`, and `internal_error` for the 500) or add new ones deliberately in one shared type. Category drift is how frontend error handling ends up branching on message strings. This is not a security defect in itself, but it is where one starts.

### S5. Correct the advisory-lock claim, and accept the annotation race explicitly

Design "Facts" and Decision 4 say every write to a team's topics holds the advisory lock. The annotation PUT (`topics.ts` L1421) deliberately does not take it. The snapshot is still consistent per row: one `INSERT ... SELECT` sees a single statement-level snapshot under READ COMMITTED, so an annotation edit lands either fully in the snapshot or fully after it. That is an acceptable integrity property. Rewrite the claim to "every structural topic write (add, archive, restore, reorder)", and state that annotation edits are last-writer-wins relative to room open. Otherwise a later reviewer will treat a false invariant as true.

## Notes (no change needed)

- **`activeTopicCount`:** this is a team-scoped count returned only to the session's facilitator on an endpoint already scoped by session, team, and facilitator. It discloses nothing beyond what Topic Management shows. Compute it from `sr.team_id` rather than the URL `teamId`. The two are equal after the `WHERE`, but sourcing from the row keeps M1's principle consistent. The design correctly treats it as a UI hint, with the server guard deciding.
- **Lock acquisition and DoS:** on `/advance` the team lock is taken only after all authorization checks have passed, so an unauthorized caller cannot hold a team's lock. Keep this order. Make it normative in the spec, so a refactor cannot move the lock to the top of the transaction ahead of a cheaper authz check.
- **`publishSessionStateChange`:** the payload is unchanged and carries no topic data. Publish-after-commit is preserved. **OK.**
- **`room_opened_at`:** not sensitive. It is an additive nullable column, with a clean rollback.
- **R5:** a real fix, and it narrows the join's scope. Keep the call-site discipline comment on `userId` intact during the rewrite.
- **Threat model:** add "integrity of `session_topics` at room open" as an asset, covering cross-team contamination (M1), out-of-band writes (M3), and unauthorized lock-in (S1). Revisit it against the implementation before release, alongside the Priya walkthrough.

## Disposition requested

M1–M3 should be reflected in `design.md` and the relevant spec deltas (`session-topic-lifecycle`, `session-creation`), plus tasks for the tests and for the `audit-logger.ts` doc update. S1–S5 should each be either accepted or recorded as a dated, owned follow-up. A silent omission is not acceptable.
