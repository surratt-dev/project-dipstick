# Propose Review: Business Analyst (Marcus Delgado)

**Change:** 232-topic-002-admin-read-audit-no-manager (#232)
**Reviewed:** proposal.md, the four delta specs, plus design.md and tasks.md where a spec relies on them. Checked against issue #232's acceptance criteria, BRD (FR-2.4, FR-8.2, FR-8.7, Constraint 2, SEC-13, SEC-16), Use Case 08 "View Active Topic Configuration", and the current TOPIC-002 handler, `audit_log` DDL (migration 8) and `membership_role` enum (migration 1).

**Verdict: Approve with changes.** Most of what I raised at explore (C5–C7, V1–V8, R1–R7) is in the proposal and specs, nearly word for word. The capabilities are specific enough to build. Most scenarios have a concrete WHEN and a checkable THEN. I found nothing blocking. Some fail-closed rules live only in design.md, a few scenarios aren't testable as written, one use case drifts out of traceability, and a few edge cases have no scenario. All are listed below with concrete wording.

---

## 1. Traceability to issue #232 acceptance criteria

| Issue AC | Where it is met | Status |
|---|---|---|
| Recorded decision with rationale for Q1 and Q2, "consistent with #208's outcome" | Proposal "Decision recorded"; Q2 answered in topic-customization-lock ADDED requirement | **Met, with a deliberate deviation.** The issue asks for consistency with #208's outcome, and the proposal decides Q1 *independently* of #208. The rationale is sound and the project owner signed off. But the issue's AC text will read as unmet to anyone who checks the box literally. **Action:** the PR description should state "AC1 is met by a recorded deviation: Q1 decided independently of #208 (owner decision, proposal §Decision recorded)". Or Brian amends the AC on the issue. |
| Admin with active EM membership never gets `team_annotation` from TOPIC-002; integration tests | topic-customization-lock "admin who is the team's EM is denied"; topic-annotation "administrator who manages the team never sees the annotation"; tasks 5.1 | Met. Real-PG test covers it and checks both active and archived definitions. |
| Every admin read returning topic config writes the agreed audit record; a test asserts it | ADDED requirement "audits every administrator read…"; tasks 3.1, 3.3, 5.1, 5.3 | Met. The proposal goes further and audits *every* admin 200, including empty and template teams. |
| Unchanged: non-member admins and non-member facilitators 200; member-facilitator `403 FACILITATOR_IS_TEAM_MEMBER`; TOPIC-004 unchanged until #208 | Constraints section; tasks 3.6, 5.2, 8.1 | Met. The "no diff" check in task 8.1 is a good, cheap condition. |
| Specs and contract row updated | Proposal Docs bullet; tasks 7.1–7.4 | **Partially met.** See finding T1 (Use Case 08 is not in the doc list). |

The issue also asks that the answer to Q1 "cover the reverse case: a global EM with a participant membership". That is covered by the `NOT_A_FACILITATOR` regression scenarios. Good.

---

## 2. Findings

### Must fix before design/tasks are final

**F1. Fail-closed rules are in design.md but not in the spec.** design.md L82 and L104 decide two failure behaviours that the delta specs either leave vague or omit:

- *Membership-read failure.* The spec says "the request SHALL fail without returning topic data". That gives no status code and no audit expectation. Design says `500`.
- *Denial-row insert failure.* The spec doesn't mention it. Design says `500`, no topic data.
- *IdP-role read failure* (`SELECT … FROM users`). Neither spec nor design says what happens. Tasks 2.3 imply it propagates to `500`. That means a metadata-only read can block an admitted admin. That's acceptable (fail closed), but it is a decision, so write it down.

The spec is the contract, so these belong in it. Suggested text for the topic-customization-lock no-manager paragraph and the ADDED audit requirement:

> If the membership-role read, the IdP-role read, or either audit insert fails, the request SHALL respond `500` with the standard error envelope and SHALL contain no topic, annotation, team-name or lock-state data. A failed denial-row insert SHALL NOT turn the `403` into a `200`.

Add scenarios: "membership read fails → 500, no topic query ran"; "denial insert fails → 500, body has no topic data". Add both to tasks 3.4, which today covers only the access-insert and membership-read failures.

**F2. "Reason" codes aren't observable in the response.** Scenarios say "`403` for reason `NOT_A_FACILITATOR`" and introduce `ADMIN_IS_TEAM_MANAGER` / `ADMIN_MEMBERSHIP_NOT_ADMITTED`. The proposal says (rightly) that no machine-readable `code` is added to the envelope. A tester reading only the spec can't tell what to assert. **Fix:** in each scenario, assert the exact `error.message`. For `NOT_A_FACILITATOR` today that is "Only a facilitator or an application admin can view this team's topic list." State once in the requirement that reason names are internal labels (audit `metadata.reason`, code identifiers), not response fields. Tasks 3.7 already asserts the message, so the spec just needs to say the same.

**F3. The audit visibility guard scenario can't be tested as written.** "WHEN any team member or engineering manager uses any endpoint or screen available to them THEN no … row is returned" can't be checked by a test. Today the only application read of `audit_log` is `fetchConnectionRecoveries` in `content.ts` (~L913), which filters on `operation = 'session.connection_recovered'` by equality, so the guard holds now. Make it a condition someone can check:

> No application query that serves a non-admin caller SHALL select from `audit_log` using a wildcard, prefix or `IN` list that could match `admin.topic_config_*`. Every such query SHALL filter `operation` by equality on a named operation.

Verification: a task item (8.x) that greps `packages/backend/src` for `FROM audit_log` and confirms each hit filters by equality, recorded in the PR. tasks.md has no item for this guard yet.

### Should fix

**T1. Use Case 08 "View Active Topic Configuration" falls out of traceability.** Its actor is "Facilitator" only, its access alternate flow says access rules "should be defined", and Out of Scope says EMs don't view topic configuration. After this change the admin read path and the dual-hat denial are real, specified behaviour with no use-case trace. Add to tasks 7:

> 7.6 `requirements/use cases/08 - Topic Management - Use Cases.md`, View Active Topic Configuration: add "Application Administrator (read-only definitions; FR-8.7)" as a secondary actor. Add the alternate flow "Administrator who holds an engineering manager membership on the team: the Application shows 'Topic configuration for this team isn't available to its engineering manager.' (no-manager rule, #232)". Add an acceptance criterion "Every administrator view is recorded in the audit log."

**T2. Edge cases with no scenario.** Each is decided implicitly by the allow-list, so they need pins, not new design:

- *Removed EM membership* (`removed_at` set): `readActiveMembershipRole` returns `null`, so the admin is **admitted** with `membership_role: null`. That is correct under "live active membership", but it is the self-demotion edge's cousin and should be pinned. Scenario: "admin whose `engineering_manager` membership was removed → 200, access row with `membership_role = null`".
- *Well-formed UUID for a team that doesn't exist.* The handler currently returns `200` with `teamName: ""` and empty lists. Under the new rule an admin gets `200` plus an access row whose `team_id` names no team. `audit_log.team_id` has no FK, so the insert succeeds. Either accept that and pin it ("audited like any other 200"), or note it as pre-existing 404 behaviour that's out of scope. Pick one and say so. Don't leave it to the implementer.
- *Unrecognised membership role.* The `membership_role` enum has only `participant` and `engineering_manager`, so `membership_unrecognised` can't be produced against real Postgres. That's fine as defence in depth, but say in the requirement that this branch is unit-tested only and exists for future enum values. Also add a comment to migration 1's enum or to the predicate that adding an enum value must revisit `evaluateAdminTopicConfigRead`.

**T3. "Each admin request is audited separately" mixes UI and API levels.** "loads, adds a topic, and the screen refetches" is a screen flow inside a backend capability's scenario. Restate it at the API level: "WHEN an admitted `application_admin` sends two TOPIC-002 requests for the same team THEN two `admin.topic_config_accessed` rows are written". The no-dedupe intent stays, and the scenario is testable in `content.test.ts` without a frontend.

**T4. SEC-13 consistency for the other TOPIC-002 denials.** SEC-13 says access-control denials must be captured in the audit log. This change audits the new admin denial, but TOPIC-002's existing `NOT_A_FACILITATOR` and `FACILITATOR_IS_TEAM_MEMBER` `403`s still write no row, and a new scenario explicitly pins "no `admin.*` audit row" for the global-EM case. That is consistent with scope. But a reader could take the pin as a decision that those denials *shouldn't* be audited. Add a Non-goal: "Auditing TOPIC-002's pre-existing non-admin denials (SEC-13) is out of scope; the pins assert only that no `admin.*` row is written." Optionally add a follow-up issue.

### Minor / wording

- **W1.** The topic-customization-lock requirement title still reads "…matching every other topic-write endpoint it serves". After this change, its admin arm deliberately does *not* match TOPIC-003..006. The body explains the split, but the title now overstates. Consider "…standing, org-wide facilitator authorization model, with a no-manager rule on its administrator arm". If renaming a requirement is too costly for the sync, keep the title and accept it.
- **W2.** "A 403 rejection is not detectably faster than a 200 success" is still vague ("detectably"). It's pre-existing, so out of scope to fix, but the new EM-denial scenario should assert the concrete thing tasks 3.1 checks: `applyTimingFloor` called once with the request's `startTime` before the reply.
- **W3.** "A facilitator's request performs no membership-role read beyond the shared authorization check". Good. The unit test should assert it by SQL text (`FROM team_memberships` call count equals the helper's), not by mock position, the same way tasks 3.1 does for the no-query assertion.
- **W4.** The ADDED requirement says `actor_idp_roles_include_em` is "whether `engineering_manager` is in the caller's stored IdP role set at the time of the request". Add "`false` when `users.roles` does not contain it, including users whose roles were backfilled to `{global_role}` and have not logged in since #245". The false-negative limit is in tasks 1.1's comment block but not in the spec, so an auditor reading the spec will over-trust `false`.
- **W5.** BRD FR-8.7 rationale edit (tasks 7.4): good. Also consider a one-line cross-reference in Constraint 2 next to the existing #243 sentence: "…and an administrator who holds an engineering manager membership on a team cannot read that team's topic configuration (#232)." Constraint 2 is where a reader looks for the dual-hat rule, and the #243 precedent already lives there.

---

## 3. Things I'd keep exactly as written

- Deny the whole response, and use an allow-list of `null | participant`. The content-matrix argument ("EM = None", not "None except free text") is the right trace.
- "Engineering managers, including administrators who manage the team, cannot read the team's definitions" as the gated release-note line, and the explicit ban on claiming managers can't *change* topics. That is honest about the #208 half.
- Counts-only metadata. It satisfies SEC-16 directly.
- The `{ get: 403, post: 201 }` parity row with a #208 comment. It shows the inconsistency in the test instead of hiding it.
- The screen rendering the server's message. It follows on from my explore V2: once a reason-specific message exists, showing a generic "no access" to the one person it applies to reads as a bug.

---

## 4. Summary of requested edits

| # | Artifact | Edit |
|---|---|---|
| F1 | topic-customization-lock spec (+ tasks 3.4) | Make every read/insert failure `500` with no data normative. Add scenarios for membership-read and denial-insert failure. |
| F2 | team-content-access, topic-customization-lock specs | Assert exact `error.message` in scenarios. Declare reason names internal. |
| F3 | team-content-access spec (+ tasks 8) | Replace the "any endpoint" guard scenario with an equality-filter condition and a verification step. |
| T1 | tasks 7 | Add the Use Case 08 update. |
| T2 | topic-customization-lock spec | Pin removed-EM-membership admission, the nonexistent-team decision, and enum-only reachability of `membership_unrecognised`. |
| T3 | topic-customization-lock spec | Restate the refetch scenario at the API level. |
| T4 | proposal Non-goals | State that the pre-existing non-admin TOPIC-002 denials stay unaudited (SEC-13), out of scope. |
| W1–W5 | various | Optional wording. |
