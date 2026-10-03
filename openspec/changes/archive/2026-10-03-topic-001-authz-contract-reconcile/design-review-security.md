# Design Review: Security (topic-001-authz-contract-reconcile)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Artifacts reviewed:** `design.md`, `proposal.md`, `specs/team-content-access/spec.md`, `specs/topic-annotation/spec.md`, `specs/topic-customization-lock/spec.md`, `tasks.md`
**Code checked on this branch:** `routes/content.ts` (TOPIC-001 at ~464–520, TOPIC-002 at ~560+, deny helpers at ~71–213), `auth/team-content-access-helper.ts`, `auth/standing-facilitator-access-helper.ts`, `auth/account-resolver.ts`, `auth/middleware.ts`, `content/timing-oracle.ts`, `routes/sessions.ts` 374–391, `migrations/1_create_enums.sql`, `migrations/7_team_memberships_partial_constraint.sql`

**Verdict: approve with conditions.** The core of the design is right, and it is the kind of fix I want to see. It uses an allow-list with an exhaustive `never` arm, checks the actor with OR semantics instead of trusting the grant path, refuses to short-circuit on a `facilitator` global role, and makes sure no topic or lock query runs on denial. It also does all of this before `teamAnnotation` exists, which is when it is cheapest. The three blocking items below are small. Two are about audit and detection, and one is about whether the spec scenarios can actually be implemented. None of them changes the mechanism.

---

## Blocking

### B1. Engineering-manager denials leave no trace

Decision 6 says "No new log or audit row is added." As a result, the new gate denies four kinds of caller and three of them leave no signal at all:

| Denied state | Signal today |
|---|---|
| Path 2 (EM membership + EM global role) | none |
| Path 2' (EM membership + non-EM global role) | `team.access_grant_mismatch` (helper, log only) |
| Global EM + participant membership | none |
| Facilitator grant drifted to EM | none |

The point of this change is to keep a team's manager out of the team's own topic space. Its roadmap is the team's own free text. A manager who repeatedly calls TOPIC-001 against their own team is exactly the security-relevant behavior we would want to reconstruct after an incident, or after an engineer complains. As written, we could not see it. Admin denials on the same endpoint get a DB audit row. EM denials, which is the population this rule targets, get nothing.

I am not asking for a DB row. The helper's own reasoning against per-request writes (team-content-access-helper.ts, Decision E comment) applies here too. I am asking for **one log-only structured event**, emitted through `emitAuditEvent` right before `denyAccess`, for example `topic.config_read_denied_role`. It should carry `userId`, `teamId`, `grantPath`, `actorGlobalRole`, `membershipRole` (or null), and a `reason` of `membership_em` | `global_em`. It must not carry topic data. The codebase already does this for other role denials: `team.creation_denied_role`, `session.advance_denied_role`, `team.role_change_denied` (audit-logger.ts). The work is to add the event name to the union, make one call, and add one assertion in tests 4.1/4.2. Update Decision 6 and add a line to the spec's "Denial response" block.

### B2. The spec sends admins to TOPIC-002, but TOPIC-002 does not meet the audit rule the same delta restates

The modified "Application Admin access is limited to administrative data" requirement now says topic configuration metadata "is served by TOPIC-002". The same requirement says "Every Application Admin read of administrative data SHALL be logged in the `audit_log` table… in the same database transaction." TOPIC-002 (content.ts ~560 onward) admits `application_admin` through `checkStandingFacilitatorOrAdminAuthorization`, selects `team_annotation`, and writes **no** audit row and emits no event. Decision 4's reason for not admitting admins to TOPIC-001 is that "the spec would then require a same-transaction read-audit row that this handler does not have." That reason applies just as much to the endpoint the design points them to.

A related drift-only case: `checkStandingFacilitatorOrAdminAuthorization` returns `authorized` for an admin before it looks at membership. So an `application_admin` who also holds an active `engineering_manager` membership is denied on TOPIC-001 (pinned by test 4.4) but can read the team's annotations through TOPIC-002. That is the no-manager rule's door, reached from next door.

I do not want this change to grow to fix TOPIC-002. It must not, however, write a normative sentence that the code contradicts. Required:
- Reword the TOPIC-002 sentence in the modified requirement so it does not claim TOPIC-002 satisfies the admin-read audit requirement. For example, add "(admin read auditing on TOPIC-002 is tracked separately; see proposal Follow-ups)".
- Add a proposal follow-up, owner Security plus the Solution Architect: (a) TOPIC-002 admin read audit row and event; (b) whether TOPIC-002 should deny an admin who holds an EM membership on the team, applying the OR rule now that TOPIC-002 serves annotations.

### B3. Several scenarios use a global role that cannot exist

The spec and tests describe callers with `global_role = 'participant'`, in the scenarios "EM membership with a non-EM global role", "Participant member keeps access", and others. `users.global_role` is the `user_role` enum: `engineer`, `senior_engineer`, `facilitator`, `engineering_manager`, `application_admin` (`migrations/1_create_enums.sql` 5–11). `participant` is a membership role only. The IdP mapping can produce only `engineer`, `engineering_manager`, and `application_admin` (`account-resolver.ts` 52–56). As written:
- the integration tests in task 4.7 will fail on INSERT, or someone will "fix" them in a way that hides the real state;
- the unit tests (which mock `actorGlobalRole: "participant"`, as `join-links.test.ts` already does) pin an impossible state and never exercise the two real non-EM member roles.

Fix: change those scenarios to `global_role = 'engineer'`. Add `senior_engineer` to the 200 regression in task 4.3, so an over-tight allow-list (for example `actorGlobalRole === "engineer"`) is caught.

---

## Non-blocking (record in design.md; no re-review needed)

### N1. Role freshness: "read live on the request" overstates the global-role signal

The spec says both signals are "read live on the request." That is true of the **database** read, and false of the **source of truth**:
- **Membership role** is live. TEAM-005 and removal write `team_memberships` directly, the helper reads it uncached on every request, and `team_memberships_active_unique` (migration 7) guarantees at most one active row. This is the FR-1.4 signal, and it takes effect at once.
- **Global role** reflects the user's **last sign-in**. It is rewritten only in the `/auth/callback` upsert (`account-resolver.ts` ~127–150). The HTTP token refresh in `middleware.ts` does not re-map the claim. An IdP-side promotion to EM therefore reaches TOPIC-001 at the user's next sign-in. That is bounded by `ABSOLUTE_LIFETIME_MS` = 90 min (`middleware.ts` 34), plus however long the user takes to sign in again.

I accept that window as residual risk: the authoritative signal is live, and there is no annotation on TOPIC-001 yet. But the design should say so in one sentence under Decision 3, and the spec wording should say "the stored `users.global_role` (as of last sign-in)" rather than "live." When `teamAnnotation` is added to any member-readable endpoint, this window should be looked at again.

A related observation, outside this change's scope but bearing on its drift reasoning: `PERMITTED_GLOBAL_ROLES` does not include `facilitator`, and the upsert sets `global_role = EXCLUDED.global_role` unconditionally. As the code reads, a facilitator who signs in is reset to the IdP-mapped value. So the realistic "drift" for a facilitator is to `engineer`, not to EM. The allow-list admits that state, correctly, because the path-3 grant depends on `sessions.facilitator_id`, not on global role. Please have someone confirm how `facilitator` is meant to persist. If the reset is unintended, it is a separate defect.

### N2. Decision 1: no objection to Option B, with three conditions

From a security standpoint B and A1 are equivalent. B's disagreement window fails closed in every direction, as the design says. A2 is correctly ruled out. If B ships:
- Give the predicate the membership role as an **explicit parameter**: `isTopicConfigReadAdmitted(grant, membershipRole)`. Then the inspection in task 6.4 ("inputs are only the grant and the live roles") can be checked from the signature, and the extra read cannot be silently skipped by a refactor.
- If the extra query throws, the request must fail closed (let it become a 500 through the error handler). It must never default to admit. Add one test.
- Facilitator grants skip the B read. If a membership is created between the helper's two queries, a facilitator grant can be admitted for a request whose caller has just become a member. The window is milliseconds and the outcome is no worse than the previous request. I accept it, and it does not need a test.

### N3. Denial oracle: low exposure, and the test proves less than it suggests

Every caller who reaches the new gate already holds an active membership or an eligible facilitator session on that team, so they already know the team exists. The denial tells them only "you are classed as an EM," which they know. Matching the timing of `denyNullGrant` here is about consistency, not about keeping a secret. The oracle that matters, 403 for well-formed ids whether or not the team exists, is unchanged.

Test 4.5 ("at or above the floor") shows the floor is applied. It does not show the response is indistinguishable if authorized latency is above the floor, and the floor is still the 150 ms placeholder that the production guard in `timing-oracle.ts` blocks. That is a pre-existing, tracked gap. A stronger and cheaper check: assert the EM-denial status, headers, and body are identical to a null-grant 403, except for `correlationId`.

### N4. 404 vs 403 ordering is correct

The canonical-UUID 404 runs before `evaluateTeamAccess` and depends only on the syntax of the id, so it reveals nothing. A well-formed id for a team that does not exist reaches the helper, gets a null grant, and returns 403. Under B, the extra membership read must go after the admin branch (as task 3.2 says), never before the canonical check. Test 4.10 pins this. Good.

### N5. Admin precedence lives in the helper, not the handler

Test 4.4 (admin + EM membership gives exactly one audit row) pins behavior that comes from the helper's path-0-first ordering (`team-content-access-helper.ts`, admin check before any membership branch). That is the right place for it. Name it in the test comment so a future helper reorder fails loudly and points at this spec. A minor point that needs no action: the admin branch applies the floor *before* its audit INSERT, so admin denials take floor plus insert time. The caller knows they are an admin, so nothing leaks.

### N6. "Unconditional" is checked by inspection; the NODE_ENV test is weak evidence

The parameterized `NODE_ENV` test in task 4.11 is harmless, but the predicate never reads `NODE_ENV`, so it would pass whether or not the rule were configurable. The control that matters is the inspection in task 6.4, made easy by N2's explicit signature. Optionally, add a grep in task 6.3 confirming that the predicate's body contains no `process.env` or `config.`.

### N7. The new log event must stay free of content

Whatever form B1's event takes, and the existing `team.access_grant_mismatch`, it must not include topic names, annotation text, or the lock flag. Since neither query runs on denial, this holds by construction today. Note it so a future "add context to the log" change does not break it.

---

## Threat-model delta

- **Removed:** a manager reads the team's topic space through TOPIC-001. This is closed for every EM state, by membership or global role, before the annotation lands.
- **Residual, accepted:** an IdP-side EM promotion takes up to the session lifetime to apply (N1). The facilitator-membership race is milliseconds wide (N2).
- **Residual, needs an owner (B2):** an admin who also holds an EM membership can read annotations through TOPIC-002, and admin reads on TOPIC-002 are not audited.
- **New detection:** none as designed. B1 adds it.

Sign-off for task 6.4 is conditional on B1–B3 being resolved in the artifacts. During implementation review I will check the predicate signature, the denial event, and the fail-closed behavior from N2.
