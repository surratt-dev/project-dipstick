# Design Review: topic-001-authz-contract-reconcile (Engineer)

**Reviewer:** Marcus Oyelaran, Full Stack Engineer
**Artifacts reviewed:** design.md, proposal.md, specs/{team-content-access, topic-annotation, topic-customization-lock}/spec.md, tasks.md
**Code checked:** `packages/backend/src/routes/content.ts` (TOPIC-001 handler ~461–520, `denyAccess`, `denyNullGrant`, `denyAdminContentAccess`), `auth/team-content-access-helper.ts`, `shared/src/types/team-content-access.ts`, `realtime/vote-revealed-payload.ts` ~105–130, `routes/sessions.ts` 366–391, `routes/teams.ts` ~280–306, `content/timing-oracle.ts`, `routes/__tests__/content.test.ts`, the other test suites that call TOPIC-001 GET

**Verdict:** Approve with two blocking clarifications. Both are about wording in design.md and tasks.md. Neither changes the approach.

---

## Position on Decision 1: B, with one small adjustment

I agree with B. One argument the design leaves out makes the case stronger. Two of the design's supporting claims need correcting.

**The A1 cost the design misses.** The synthetic grant in `realtime/vote-revealed-payload.ts` (~line 122) is built from a `SessionSubscriberGrant`. That type has no membership role, on purpose: it has no participant/EM distinction (see the type's own comment). Under A1, `membershipRole` is required, so that literal would have to hardcode `membershipRole: "participant"`. That is a security fact nobody read from the database, sitting in a shared type. The next engineer who keys on `grant.membershipRole` in a serializer would trust it. This is the coupling A1 creates. The design treats it as compile churn, but the real issue is that every grant would carry a field some constructors cannot honestly fill. Without a second consumer, that is the wrong trade.

**Correction 1: the precedent is weaker than stated.** `sessions.ts` 366–391 and `teams.ts` ~280–306 do not run a *second* read after `evaluateTeamAccess`. Each runs its own single combined `users ⟕ team_memberships` query, which is the only read on that path. B is new in a small way: the helper reads, then the handler reads again. I accept that, because the design's analysis that a disagreement between the two reads fails closed is correct. I checked each case against the helper: a missing row is denied, an EM row is denied, a demoted row is admitted to match the latest state, and a facilitator grant skips the read. But the design should not claim B "follows that precedent". Say it follows the precedent of handler-local OR checks, with a second read.

**Correction 2: B has its own fixture churn.** See blocking item B2. The design says B's footprint is "nothing else", and that is not true for the tests.

**Adjustment (non-blocking, recommended).** Put the read in `team-content-access-helper.ts` as a narrow export, for example `readActiveMembershipRole(userId, teamId): Promise<string | null>`, and call it from the handler. The `removed_at IS NULL` membership predicate then lives in one file, which is what access-control Decision 8 wanted. It also keeps raw SQL against `team_memberships` out of `content.ts`. This exports a *read*, not a policy, so it does not conflict with Decision 2's "don't export a deny-EM helper". If the architect prefers the SQL inline in `content.ts`, I can live with that.

A2: agreed, reject it. A security marker that is optional fails open.

---

## Blocking

### B1. Under Option B, the predicate's inputs and comparison are not specified, and the wording in tasks 3.2 allows fail-open drift

Decision 2 gives the predicate as `isTopicConfigReadAdmitted(grant)`. Under B, the grant does not contain the membership role, so that signature cannot evaluate path 2'. Task 3.1 says "whose membership role is `participant`" but never says where that value comes from. Task 3.2 states the rule for the second read as a deny-list: "Treat `engineering_manager` or no row as not admitted". An implementer who writes `liveRole !== "engineering_manager" && liveRole !== null` admits `undefined`. That happens with a malformed mock row, and it would also happen with any membership role added later. The spec's central claim is that this is an allow-list, so the comparison has to be an allow-list too.

**Required change (design.md Decision 2 and tasks 3.1/3.2):**
- Signature: `isTopicConfigReadAdmitted(grant: TeamAccessGrant, liveMembershipRole: string | null): boolean`. It is pure and synchronous, with no I/O. The handler does the read only for `path: "member"` and passes `null` otherwise. This makes the spec's "only inputs are the grant and the live membership/global role" requirement checkable by reading the code, which is what task 6.4 needs. It also makes the predicate unit-testable without mocks.
- Member arm: admit only when `grant.role === "participant" && liveMembershipRole === "participant" && grant.actorGlobalRole !== "engineering_manager"`. The membership role must be **equal to** `"participant"`, not "not EM".
- Facilitator arm: `grant.actorGlobalRole !== "engineering_manager"`. Ignore `liveMembershipRole`.
- Structure: `switch (grant.path)` with a `never` default. In the `member` arm, compare `grant.role` explicitly, because the union has two `member` variants and the narrowing won't flag a third.

Under A1, the second parameter goes away and the member arm reads `grant.membershipRole === "participant"`. Write the decision so that either way, the comparison is an equality check against `"participant"`.

### B2. Positional DB mocks in `content.test.ts`: B shifts every existing TOPIC-001 member-path test, and tasks.md does not cover it

`content.test.ts` mocks `db.query` in order with `mockResolvedValueOnce` (`mockMemberGrant`, lines ~59–64). Under B, every member-path call to TOPIC-001 makes one extra query between the helper read and the topics SELECT. These existing tests will break, and none of them are in tasks 4.x:
- "includes isCustomizationLocked: true …" (~316)
- "includes isCustomizationLocked: false …" (~331)
- "does not remap existing snake_case fields to camelCase" (~370). This is the Decision 5 tripwire. It does not assert `statusCode`, so after the shift it fails with a `TypeError` on `body.topics[0]` instead of a clear 403. That is confusing enough that someone might "fix" it the wrong way.

The breakage fails closed: the topics row lands in the membership read, the role is `undefined`, and the request is denied. Fixing it is mechanical. But it has to be planned, or a red tripwire gets edited without anyone thinking about it.

**Required change (tasks.md 4.x):**
- Add a fixture helper, for example `mockTopic001MemberGrant(globalRole, membershipRole, liveMembershipRole = membershipRole)`, that queues both the helper row and the membership read. Move the three tests above onto it.
- Add `expect(res.statusCode).toBe(200)` to the snake_case tripwire test, so a future failure there reads as an authorization regression and not a shape change.
- For the denial tests, express "topics and lock queries not run" as `expect(mockDbQuery).toHaveBeenCalledTimes(n)`, where `n` is the helper read plus the membership read, or as an assertion that no call's SQL matches `FROM topics` / the lock COUNT. In this harness, "not called for the topics query" cannot be checked positionally.
- Correct the design's Impact line ("Under … Option B …, nothing else") to mention the content.test.ts fixture updates.

---

## Non-blocking

1. **Timing test (task 4.5).** `content.test.ts` mocks `timing-oracle.js`, so this suite measures no wall-clock time. The existing pattern (~582–598) is `expect(mockApplyTimingFloor).toHaveBeenCalledTimes(1)`. Write 4.5 as: on the EM-denial branch, `applyTimingFloor` is called exactly once with the handler's `startTime`, before `denyAccess`. Use that same assertion for the null-grant branch for comparison. If anyone wants a real latency comparison, it belongs in an integration test, and I don't think this change needs one.

2. **NODE_ENV test (task 4.11).** It is a tautology: nothing in the predicate reads env. It is also cheap, so keep it. Do not add `production` to the parameter list. `timing-oracle.ts` throws at import under `NODE_ENV=production` while the floor is still the placeholder. The test mocks that module, but a later refactor that stops mocking it would break the whole suite at load. Also note for the security reviewer that this module, which the denial path uses, reads `NODE_ENV` at import. That does not violate the spec, because the floor is not the admission decision. Say so in 6.4 so the reviewer doesn't stop on it.

3. **Error path: the second read throws.** A rejected promise becomes a Fastify 500 without the timing floor. That is the same as the helper's own query failing today, so it adds no new oracle. Accept it, and add one sentence in design Risks so a reviewer doesn't ask.

4. **Fixture realism.** `mockMemberGrant` uses `global_role: "engineer"`. New tests should use real `global_role` values (`participant`, `facilitator`, `engineering_manager`). The OR rule depends on that exact string, so a placeholder value hides the case that matters.

5. **Other TOPIC-001 GET callers that must stay green.** Add them to the Risks/regression list alongside template-team 4.3: `topics-integration.test.ts` lines ~91, ~131, ~547 (facilitator actor, real DB). Under B the facilitator path adds no query, so they should pass unchanged. List them anyway. `topic-add-flag-parity.test.ts` calls only TOPIC-002 and POST, so it is not affected.

6. **Placement of the read.** Run the membership read after the `admin` branch and only when `grant.path === "member"`. Tasks 3.2 already say this. Make design.md's handler order (Decision 2) show it explicitly: `… admin → deny; member → read live role; !isTopicConfigReadAdmitted(grant, liveRole) → floor + denyAccess; topics; lock`.

7. **Mismatch log ordering.** The spec requires `team.access_grant_mismatch` to fire on path 2'. It does, inside the helper and before the gate, so the handler needs no change. Test 4.2(d) should assert `emitAuditEvent` was called with that event name, using the existing `audit-logger.js` mock.

8. **No frontend coupling.** Confirmed: the only frontend `fetch` to `/api/v1/teams/${teamId}/topics` is `TopicManagementPage.tsx` ~1351, and it is a `POST` (TOPIC-003). No consumer of the GET exists, so the "no user-visible change" claim holds.

---

## Summary

| # | Item | Severity |
|---|---|---|
| B1 | Pure predicate signature `(grant, liveMembershipRole)`; membership role must **equal** `"participant"` (allow-list), not "not EM / not null" | Blocking |
| B2 | Positional mocks: 3 existing TOPIC-001 tests shift under B; add a fixture helper, a status assertion on the tripwire test, and call-count assertions; fix the Impact line | Blocking |
| D1 | **B**, ideally with the read exported from the helper module; drop the "follows precedent" overstatement; the A1 synthetic-grant argument favours B | Position |
| N1–N8 | Timing assertion form, NODE_ENV caveat, 500 path, fixture realism, extra regression tests, explicit order, mismatch assertion, frontend check | Non-blocking |
