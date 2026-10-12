# BA review of exploration notes: #264 (Marcus Delgado)

Checked against BRD SEC-13 (BRD.md L576: "access control denials" must be captured in the audit log) and issue #264.

## Verdict

The notes are specific enough to proceed. The intent is clear, and the two 403 reasons map cleanly to SEC-13's "access control denials". Several items are still not requirements yet. They are phrased as leanings, "confirm", or "decide", and a proposal cannot carry those. Each needs a stated outcome and a testable condition (below).

## SEC-13 traceability

1. SEC-13 says denials "must be captured". It does not say durable, and it does not say fail-closed. Durable row plus event is a design choice that satisfies it, and the notes should say so rather than imply SEC-13 mandates it.
2. The fail-open recommendation weakens "must be captured" for the audit-store-down case. This is the only place the change can fail SEC-13. The proposal must say that fail-open is accepted only because (a) a loud failure signal is emitted and (b) the denial itself is never converted to a 200. The notes already say this. It must be written as a requirement, not as rationale.
3. The BRD has no definition of "access control denial" granular enough to say which denials count. Scope here is two reasons on one endpoint, and TOPIC-001 and TOPIC-003..007 are deliberately excluded. State in the proposal that SEC-13 compliance for the wider denial set remains open and is tracked in #187 and #208. Otherwise a reader will take #264 as closing the SEC-13 gap for topic endpoints.
4. Record the sentence about the 404 for a malformed id not being audited as a scoped decision. It is a denial of a kind, and a reviewer will ask.

## Too vague to carry into a proposal

| # | Notes say | Problem | Suggested rewrite / acceptance condition |
|---|---|---|---|
| 1 | "I lean (a)" (helper exposes `actorGlobalRole` on denial) | Open design choice | Resolve before the proposal. Requirement: "The recorded `actor_global_role` equals the role used to make the authorization decision, with no second read." Acceptance: a test where the decision's role is X records X. TOPIC-003..007 tests pass unchanged. |
| 2 | "record `'unknown'`... confirm no enum constraint" | Unverified fact | Verify the column type now. Acceptance: a missing-user-row denial writes a row with `actor_global_role='unknown'` against real Postgres. |
| 3 | Missing user row: "write `actor_roles` empty/NULL... needs a design decision" | Open | Requirement: "When no users row exists, the denial is still audited with `actor_roles` = empty array (or NULL, pick one) and this is not counted as an audit failure." Acceptance: integration test for this case, with no failure event emitted. |
| 4 | `audit_log.team_id` FK: "Must verify... most likely real bug" | Unverified, and it is a blocker | Verify first. Requirement: "A denial for a team id that names no team is still audited (team_id NULL or as stored) and returns the same 403." Acceptance: integration test with a random valid UUID by a participant returns 403, writes one row, emits no failure event. Include a decision on whether the requested id is retained anywhere (metadata keys are exact, so it is not). |
| 5 | Fail-open: "mandatory, distinctly named failure signal" | Name and shape not fixed | Pick the event name and key set in the proposal (SQLSTATE only, no `err.message`, includes operation and reason). Acceptance: forced insert failure gives status 403, byte-identical body, exactly one failure event, no leaked message. Also test forced role-read failure. |
| 6 | Fail-open applies "only to the audit write and role read" | Boundary unclear | State what happens when the role read fails: is the row still written with an empty `actor_roles`, or is the row skipped? Acceptance: pin one behaviour with a test. I recommend skipping the row and emitting the failure event, because a row with missing roles is misleading evidence. |
| 7 | Timing: "floor is meaningfully larger than two small queries... Worth confirming" | Not testable as written | Requirement: "Denial responses (both reasons and with audit failure) complete no sooner than the floor, with the insert before the floor." Acceptance: call-order test (already listed) plus a failure-path test showing the floor still applies. Drop the speculative timing prose. |
| 8 | "Consider whether the UI should stop offering the Topics link" | Scope creep | Either put it in the proposal as a named follow-up issue or delete it. Do not leave it as a consideration. |
| 9 | "#262 guard: confirm... may need registering" | Unverified | Verify. Acceptance: the guard test passes with the new operation present, and fails if a non-admin read of it is added. |
| 10 | "`docs/deployment.md` ... likely untouched, except the failure event may belong in its log-only list" | Hedged | If the failure event is log-only (it is), then it does belong there. State it as a task. |
| 11 | "Event key set: pin it like #232" | Keys listed but row-vs-event distinction blurred | List the row columns and the event keys as two separate explicit lists in the spec. Acceptance: tests assert exact key sets by equality, not by inclusion. |
| 12 | "Name acceptable... do not rename, document" | Fine, but needs a testable form | Acceptance: the `audit-logger.ts` comment on `topic.config_list_denied` states "durable" and names `topic.config_read_denied_role` as the log-only sibling. |

## Clarifications needed from the team

- Security (Tomas): fail-open or fail-closed. This is the single decision the proposal depends on. The notes make a persuasive case for fail-open but acknowledge it is defensible the other way. Ask for the decision in writing before the specs are drafted. Also ask for the SLA of the failure signal: who is alerted, and where.
- Architect: helper extension vs separate read (item 1).
- Full Stack Engineer: FK check and role-read behaviour (items 3, 4, 6).
- Product (open question): is the denial row expected to be reviewed by anyone? The notes state it must not become a profiling tool, but also that benign `FACILITATOR_IS_TEAM_MEMBER` volume is expected. Who consumes these rows? If nobody does, say so. The value is then post-hoc reconstruction only, which matches the SEC-13 rationale ("post-hoc incident reconstruction and anomaly detection").

## Concerns about the ritual constraints section

- "Not a performance tool... SEC-13 review must not become a way to profile individuals." This is a good principle, but the only enforceable piece is the #262 visibility guard. Write the requirement in testable form: "No non-admin API endpoint returns rows of operation `topic.config_list_denied`." Do not leave a policy statement without an acceptance condition.
- The no-manager framing is useful. However, an EM-denial row records that a manager attempted access. State that this reveals only attempts by the actor, never the content, and confirm that no user-facing view surfaces it to the team (candour). This is a one-line requirement.
- "A pattern of these... is a signal" implies detection or alerting. That is not in scope. Say explicitly that no alerting or aggregation on denial rows is delivered by this change.

## Suggested requirement wording (for the proposal)

1. When TOPIC-002 denies a caller with `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`, the system SHALL write exactly one `audit_log` row with operation `topic.config_list_denied`, containing actor user id, actor global role (`'unknown'` if no user row), actor IP, team id, and actor roles, and metadata exactly `{endpoint, http_status, reason}`.
2. The row SHALL be written before the response is sent and before the timing floor is applied.
3. The row and the accompanying event SHALL NOT contain the team name, any topic name or id, or any annotation text, and no such data SHALL have been read on the denial path.
4. The response status, message and body of these denials SHALL be unchanged, including when the audit write fails.
5. If the audit write or the role-set read fails, the system SHALL still return the 403 and SHALL emit `<named failure event>` carrying the SQLSTATE only. (Subject to the Security decision.)
6. An admitted facilitator or admin request SHALL execute no additional query.
7. No non-admin read path SHALL expose `topic.config_list_denied` rows.
8. Out of scope: the malformed-id 404, TOPIC-001, TOPIC-003..007, alerting or aggregation, and any UI change.

## Edge cases to add to the test plan

- User with both a facilitator role and an active membership on the team: `FACILITATOR_IS_TEAM_MEMBER` (not `NOT_A_FACILITATOR`). Confirm reason precedence.
- Caller with no role at all and no membership.
- Same caller requesting twice: two rows (no dedup), stated as intended.
- Soft-deleted or inactive team id (does the denial or 404 apply first?). Not covered by the notes. Clarify.
- Unauthenticated callers never reach this branch. Say so, so the scope is not mistaken for a login-failure audit (also SEC-13, separate).
