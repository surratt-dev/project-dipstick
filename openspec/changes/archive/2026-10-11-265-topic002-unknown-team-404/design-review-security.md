# Security Review: topic002-unknown-team-404 (#265) design

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Inputs: `design.md`, `proposal.md`, and the current handler in `packages/backend/src/routes/content.ts` (TOPIC-002, around lines 845-1170), `standing-facilitator-access-helper.ts`, `timing-oracle.ts`, `migrations/8_audit_log.sql`.

## Verdict

Approve with required changes. The core ordering (authorize, then look up, then audit only real access) is correct and is the right call for enumeration resistance. I have no blocking objection to the 404 itself. I do have three findings the design must resolve before implementation (S1, S2, S3), and several implicit or deferred decisions that should be made explicit.

## What the design gets right

- D1 order. Authorization before existence means a participant, or any caller without the facilitator/admin role, gets a 403 that does not depend on whether the team exists. I confirmed in the helper that the decision (`evaluateStandingFacilitatorAccess` then role and membership checks) never branches on the existence of the `teams` row for unauthorized callers. Good.
- Moving the existing SELECT rather than adding one keeps the facilitator query profile unchanged and avoids a new surface.
- Fail-closed behavior is preserved: a throw from the name read is a 500 with no audit row and no data.
- `assertTopic002AuthorizedRole` still runs before the name read, so an unexpected role cannot reach the 404 branch as an unaudited oracle.
- `audit_log.team_id` has no FK (migration 8), so the existing denial audit rows for a non-existent team will insert successfully. AC 7 ("each with one `topic.config_list_denied` row") is therefore achievable. Worth stating in the design, because it is the reason the #264 insert does not fail-open for the non-existent case.

## Findings

### S1. "Byte-identical" 403 is not achievable as written (test defect, medium)

The 403 body includes `correlationId: crypto.randomUUID()` (content.ts, 403 branch). AC 7 and the proposal's guard tests require a "byte-identical `403 NOT_A_FACILITATOR` (full headers and body)". Two responses can never be byte-identical while that field is random. Either the test normalizes `correlationId` (and any other per-request header such as `date` or `x-request-id`), or the assertion is weaker than the text says. State the normalization explicitly so the guard does not get quietly relaxed to "same status and code", which is the weak form of the check that would miss a leak such as an extra header or a different message string. Also assert the audit rows for the two cases differ only in `team_id` and equal in every other field, since the row is the other observable side.

### S2. The audit-flooding rationale in D2 is partly wrong (medium, affects how the policy question is framed)

D2 says the 403 denial rows "are bounded by the set of callers who can be denied". That is not a bound. Any authenticated user (every participant) can be denied, and each request with a random UUID writes one `topic.config_list_denied` row, including for non-existent teams (no FK, and the handler audits before it knows or cares whether the team exists). So `audit_log` growth by looping is already possible for the whole user base through the 403 path, and #264 shipped it. The 404 decision does not create that problem and does not solve it.

Consequences for the review of this change:
- The flooding argument is a weak justification for not auditing the 404. The stronger justification is signal quality (a row recording access to nothing) and consistency with write routes. Rewrite D2 to lead with those, and drop the "bounded" claim, or the policy approvers (Brian, VP Engineering) will be deciding on a false premise.
- Record the existing 403 flood exposure as a known residual with an owner, not as a solved property. This is out of scope to fix here, but it should be named. Options for the follow-up: per-actor rate limit on the endpoint, or collapsing repeat denials per (actor, reason, window).
- Because 403 audit rows for non-existent team ids are attacker-chosen `team_id` values (UUID typed, so no injection risk), note that they pollute per-team audit queries (`idx_audit_log_team`). Low severity.

### S3. Loss of the admin probe signal is accepted implicitly (medium, decision deferred)

Today an admin looking up a non-existent team leaves an audited row (`team_found: false`). After the change an admin can run unlimited existence probes with no durable trace and, per AC 3, no `admin.*` log event either. The proposal says "no alerting or volume monitoring for 404s exists or is added" and treats this as accepted. My read of the threat model:
- Team UUIDs are random v4, so blind enumeration is infeasible; the realistic abuse is an admin (or a hijacked admin session) testing ids obtained elsewhere (leaked links, logs, exports). The data revealed is one bit.
- The real loss is forensic: an incident responder reconstructing "what did this compromised admin account try" loses the failed attempts, which are often the most informative part of a reconnaissance pattern.

Required: state this residual explicitly in the design's Risks section rather than only "Authorized callers learn whether a team exists". Recommended (not blocking): emit a non-audit, low-severity structured application log line at the 404 branch (for example `topic002.team_not_found` with actor id, role, and requested team id), outside `audit_log` and outside the `admin.*` namespace. That keeps the audit stream clean (the design's actual goal), gives responders a trail, and costs no write amplification in the database. If the team declines, say so as a decision, and add it to the open questions that Brian confirms, because as written the merge gate asks only about the audit asymmetry and not about the absence of any trace.

Note the conflict to resolve if the log line is adopted: AC 3 says "emits no `admin.*` log event". A differently named, non-`admin.*` event is compatible with that wording, but the AC should say so to avoid a test that bans all events.

### S4. Removal of `team_found` (low, handled adequately)

Dropping the key is the right call: a constant `true` invites future code to treat it as a live check. Points to tighten:
- The consumer-grep task (AC 12) covers the repo only. Log pipelines, SIEM saved searches, and dashboards live outside the repo. The task should name who is asked (whoever owns log queries) and the result recorded, not just "no hits in repo".
- Historic rows keep `team_found: false` rows that, after this change, are the only evidence that ghost-team admin reads happened. Say that they must not be rewritten or purged by any retention job as "noise", since they are audit evidence of past behavior. A one-line note in the design is enough.
- Removing the key means a query like `metadata->>'team_found' = 'false'` returns rows only from before the change. Document the cutover date or PR in the runbook so an analyst does not read the absence as "no incidents".

### S5. Timing side channel (low-medium; correctly scoped but one implicit assumption)

The design says only that the 404 path calls the same `applyTimingFloor`. Observations:
- Participant-visible timing is unaffected: the unauthorized path returns before the lookup, and both existing and non-existent cases run the same authorization queries plus a denial audit insert. Good. The design should say the authorization path does not touch `teams` for the unauthorized case so that this stays true; a future refactor adding a `teams` join to the authorization helper would silently reintroduce an oracle for unauthorized callers.
- Among authorized callers, 404 does one query after authorization, a 200 does roughly six or more, plus an audit insert for admins. The floor (150 ms) hides the difference only while the 200 path stays under 150 ms. This is the existing TIMING_FLOOR placeholder that is blocked in production (`timing-oracle.ts` throws at startup in production while the value is 150), so the true floor is unmeasured. Because the callers are already authorized, I agree the residual is low, but the design should state the dependency: "the 404/200 indistinguishability for authorized callers holds only up to the measured floor".
- The floor is measured from handler entry. The 404 path in the admin case now skips the membership and role-set reads, which is exactly where the new timing gap between admin-404 and admin-200 originates. Acceptable, same reasoning.
- The test mechanism (spy on `applyTimingFloor`, assert one call before send) proves call placement, not equivalence. That is fine as stated; do not let anyone cite it as evidence that timing is flat.

### S6. Ordering regression risk in code (low, add a guard)

The design depends on the name read sitting after `assertTopic002AuthorizedRole` and before the admin arm. The current handler has a long comment block explaining the arm; moving a query across it is exactly the kind of edit that later tidy-ups reverse. The tests "pin both orders" per D1, which is good. Add one pin: an unauthorized caller (participant, and member-facilitator) hitting a non-existent team must produce zero queries against `teams` from the handler (assert the SQL text list). That makes the "authorize before lookup" property a test, not a comment.

### S7. Frontend (low)

- Matching on `error.code === "TEAM_NOT_FOUND"` and falling back to the generic message for any other 404 is the right secure default (a proxy or WAF 404 is never mislabeled). Keep the response parsing defensive and never render `error.message` from the server body directly; the design says the string is a literal, which is correct and also avoids reflecting content.
- The 403 branch still reveals nothing distinct. Confirm the page does not echo the requested team id into the "Team not found." state or the error text (the design says it does not; good).
- Logging: confirm the frontend does not send the failing URL (which contains the team id) to any client-side error reporter on a 404. Low impact, but one sentence in the tasks closes it.

## Decisions that are deferred or implicit (please make them explicit)

1. 403 audit flood on the existing denial path (S2). Deferred with no owner and no issue number.
2. No trace of admin probes of non-existent teams (S3). Treated as accepted without being named as a risk.
3. Adequacy of the timing floor (S5). Explicitly out of scope, but production is blocked on it already; reference the existing blocker so the two do not drift.
4. Mid-request deletion race (D4). Accepted; correct. The failure mode is a 404 for a team that existed at authorization time, with no leak. Fine.
5. Upper-case id behavior is "deliberately unspecified" (proposal non-goals). From a security view this is acceptable because it follows Postgres `uuid` semantics and `isCanonicalUuid` gates the input, but note the audit row will record `team_id` as the normalized UUID value Postgres stores, not the raw string, which is the behavior we want for correlation. No change requested.
6. Template team stays `200` and audited, deactivated teams stay `200`. Correct for audit completeness: every read of an existing team is recorded exactly once. The regression tests that pin this are the right controls; keep them.
7. Policy gate. The merge gate covers only the audit asymmetry. I recommend adding S3 (no probe trace) to the same confirmation so the approver sees the full cost of the decision in one place.

## Required before implementation proceeds

- S1: specify `correlationId` (and any per-request header) normalization in the byte-identical test.
- S2: correct D2 so it does not claim the 403 rows are bounded; name the existing 403 flood as a tracked residual.
- S3: record the loss of failed-probe trace as an accepted risk, or add the non-audit log line, and fold it into the merge-gate question.

## Recommended

- S4 notes (external consumer check owner, historic rows retained, cutover documentation).
- S5 sentence tying authorized-caller indistinguishability to the measured floor.
- S6 extra test (no `teams` query for unauthorized callers).
