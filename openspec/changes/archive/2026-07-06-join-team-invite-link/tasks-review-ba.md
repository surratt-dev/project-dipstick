# Tasks Review — BA

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Change:** join-team-invite-link
**Reviewed against:** proposal.md and openspec/specs/join-link/spec.md

---

## Summary

The task list covers the implementation work well. Backend logic, error routing, frontend components, and the bulk of the test cases are accounted for. However, two entire deliverables named in the proposal's Capabilities and Impact sections have no corresponding tasks, and two test cases called out explicitly in the Impact section are missing. There is also one task in the list with no traceable backing in the proposal. These are not minor omissions — one of them is a new spec file the proposal explicitly commits to creating.

---

## Gaps: Proposal Item With No Corresponding Task

### Gap 1 — No task for updating `openspec/specs/join-link/spec.md`

The proposal's Capabilities section lists `join-link` as a modified capability and names four areas of change:

1. Through-auth error delivery — the `?joinError=` mechanism, message mapping for expired/revoked and nonexistent tokens, and the hard requirement that the user must not land on `/no-team` when a join token was present
2. Already-a-member handling — the through-auth path must append `?alreadyMember=true`, matching the direct path
3. New-member confirmation — `?newMember=true` requirement, welcome banner content, auto-dismiss and replace-navigation behavior, the session page's explicit non-handling of the parameter (with the rationale: the banner content "Your facilitator will share what comes next" is misleading when a session is already in progress), and the new-vs-existing detection mechanism (`RETURNING id`)
4. Role vocabulary — a new section mapping "Engineer" (use case) to `participant` (schema), explaining that `membership_role` is distinct from the global `user_role` enum

The Impact section also explicitly names `openspec/specs/join-link/spec.md` as a file that changes in this PR.

The current spec is missing all four of these. It describes error scenarios as redirecting to "an error page" without specifying the URL or query parameter mechanism. It has no `?joinError=` mechanism, no `?newMember=true` requirement, no role vocabulary section, and no through-auth parity requirement for `?alreadyMember=true`.

The proposal also states this change "documents the deferral" of the revocation write endpoint "with rationale and names the follow-on change that should close it." The spec is the natural home for that documentation. No task covers it.

**Without this task, the requirements don't reflect the decisions made in the proposal.** Any engineer who reads the spec after implementation will find a document that doesn't match the behavior of the code.

---

### Gap 2 — No task for creating `openspec/specs/session-participation/spec.md`

The proposal's Capabilities section lists `session-participation` as a new capability:

> Constraint document establishing hard requirements that the session participation feature must satisfy — specifically, EM role enforcement at session join time, facilitator-from-another-team enforcement via `team_memberships`, and mid-session arrival handling relative to the reveal mechanic.

The proposal then specifies what the stub must contain at minimum: one scenario skeleton for EM enforcement naming the enforcement point (the session participation endpoint, server-side), the trigger (a `global_role = 'engineering_manager'` check on the `users` table), and the constraint outcome (the user must not be recorded as a session participant).

The Impact section explicitly names `openspec/specs/session-participation/spec.md` as a new file this change creates.

There is no `session-participation` directory under `openspec/specs/` and no task for creating this file.

This matters because the proposal explains the purpose of the stub: to ensure the EM protection and facilitator-on-own-team constraints are visible when the session participation feature is designed, rather than being discovered later as gaps. A commit that closes this change without the stub leaves those constraints undocumented exactly as the proposal was trying to prevent.

---

### Gap 3 — No task for testing `role = 'participant'` at the insert site

The Impact section explicitly calls out the following test:

> test asserting the `team_memberships` row written by a successful join has `role = 'participant'` (not `'engineer'` or any other value), directly backstopping the vocabulary confusion this change is correcting

This test is the only one that directly backstops the inline documentation added in tasks 1.1 and 1.2. Without it, the vocabulary comment exists but there is no automated check that would catch the defect it is meant to prevent. Tasks 9.1 through 9.8 do not include this case.

---

### Gap 4 — No test for the new-member welcome banner (TeamPage)

Task 9.8 specifies frontend tests for `JoinErrorPage`. Tasks 6.1 and 6.2 implement the welcome banner on `TeamPage.tsx` — the banner content, the auto-dismiss, and the replace-navigation after rendering. No test task covers this behavior. Given that the proposal calls out the banner content precisely ("You've joined the team. Your facilitator will share what comes next.") and specifies the replace-navigation behavior as a requirement, the same standard applied to `JoinErrorPage` in task 9.8 should apply here.

---

## Out-of-Scope Task: No Proposal Backing

### Task 7.1 — Redis `getdel` atomicity fix

Task 7.1 replaces `redis.get` + `redis.del` with `redis.getdel` in the callback handler to close a non-atomic window.

This task does not appear in the proposal's "What Changes" section, Capabilities, Impact section, or Resolved Design Questions. It is a correctness improvement — a valid one — but it is work the proposal does not describe. If this task is intentional (added during planning as a discovered issue), the proposal should have been updated to include it. If it was not intentional, it needs review before implementation begins to confirm it is in scope.

---

## Proposal Inconsistency Worth Noting

The `trustProxy: 1` fix (task 8.1) appears in the Impact section but not in "What Changes." The "What Changes" section describes the `sourceIp: "callback"` removal but does not explicitly name the `trustProxy` change as a prerequisite for `request.ip` to carry the real client IP in production. Task 8.1 is correctly scoped — the proposal does name the file — but an engineer reading only "What Changes" would not know this fix is part of the change.

---

## Coverage That Is Solid

For the record: the following proposal items are fully covered by tasks.

| Proposal item | Tasks |
|---|---|
| Through-auth error routing (expired, revoked, nonexistent) | 4.1, 4.2, 4.3, 4.4 |
| `executeJoinFlow` return type change (null → redirect URL) | 4.1, 4.2, 4.3 |
| `?newMember=true` appended on new membership | 3.0, 3.1 |
| `?alreadyMember=true` on through-auth path | 3.2 |
| `JOIN ... ON CONFLICT DO NOTHING RETURNING id` mechanism | 3.0 |
| `join.link_redeemed` gated on actual INSERT result | 3.0, 9.4, 9.5 |
| `sourceIp: "callback"` removed; real IP passed | 2.1, 2.2 |
| Role vocabulary comments at insert sites | 1.1, 1.2 |
| JoinErrorPage component (messages, secondary line, no CTA) | 5.1 |
| `/join-error` route, unauthenticated | 5.2 |
| Direct join path error redirect convergence | 4.4 |
| New-member welcome banner on TeamPage | 6.1, 6.2 |
| `trustProxy: 1` in app.ts | 8.1 |
| Tests: expired/revoked/nonexistent through-auth token | 9.1, 9.2, 9.3 |
| Tests: new member vs. already-member audit event behavior | 9.4, 9.5 |
| Tests: `sourceIp` in audit events | 9.6 |
| Tests: direct path error redirect targets | 9.7 |
| Tests: JoinErrorPage messages | 9.8 |

---

## Recommended Actions

1. **Add a task for `openspec/specs/join-link/spec.md`** covering all four areas named in the Capabilities section: through-auth error delivery with `?joinError=` mechanism and message mapping; through-auth `?alreadyMember=true` parity; `?newMember=true` with banner content, auto-dismiss, replace-navigation, and the session page non-handling rationale; role vocabulary section; and deferral documentation for the revocation write endpoint.

2. **Add a task for `openspec/specs/session-participation/spec.md`** creating the stub with the minimum content the proposal commits to: the EM enforcement scenario skeleton naming the enforcement point, trigger, and constraint outcome.

3. **Add a test task for `role = 'participant'`** in `team_memberships` at a successful join — the direct backstop for the vocabulary fix in tasks 1.1 and 1.2.

4. **Add a frontend test task for the new-member welcome banner** in `TeamPage.tsx`, covering the banner content, auto-dismiss, and replace-navigation behavior, at the same level of specificity as task 9.8.

5. **Resolve task 7.1's status** — either update the proposal to include the Redis atomicity fix or remove the task and treat it as a separate change. As written, it is untraced.
