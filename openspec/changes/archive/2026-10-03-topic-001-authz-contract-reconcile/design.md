## Context

TOPIC-001 (`GET /api/v1/teams/:teamId/topics`, handler in `packages/backend/src/routes/content.ts`) authorizes through `evaluateTeamAccess`. It turns away only a `null` grant (`denyNullGrant`) and an `admin` grant (`denyAdminContentAccess`, with an audit row). Every `member` grant gets `200`, including `role: "engineering_manager"`, and so does every `facilitator` grant. The contract, its matrix, the `team-content-access` content matrix, the use case, and BRD FR-9.5 all say EMs get no topic configuration (see proposal). The code is the one outlier.

What the grant model tells us today (`team-content-access-helper.ts`, `TeamAccessGrant` in `packages/shared/src/types/team-content-access.ts`):

| State | Grant produced | Can the handler tell it is an EM? |
|---|---|---|
| EM membership + EM global role (path 2) | `member / engineering_manager` | Yes, `grant.role` |
| EM membership + non-EM global role (path 2', Decision E) | `member / participant`, `actorGlobalRole` = the non-EM role | **No.** The grant is byte-identical to an ordinary participant grant. Only the `team.access_grant_mismatch` log event records it. |
| Participant membership + EM global role (TEAM-005 demotion, join link) | `member / participant`, `actorGlobalRole = "engineering_manager"` | Yes, `grant.actorGlobalRole` |
| Facilitator grant, live global role drifted to EM | `facilitator`, `actorGlobalRole = "engineering_manager"` | Yes, `grant.actorGlobalRole` |

The handler can recognise three of the four EM states from the grant it already has. The fourth (path 2') needs one more fact: the membership role the helper already read and then dropped.

Constraints I hold as load-bearing:
- **The no-manager rule.** The team's topic space, and later its own words about each topic, are not readable by its manager. There is no flag and no override.
- **No collateral damage to the room.** A participant or facilitator who has access today keeps it. Breaking that is the one way this change could show up in a live session.
- **Small and reviewable.** This is a security fix. Cleanups go to follow-ups.

## Goals / Non-Goals

**Goals:**
- TOPIC-001 admits only non-EM participant members and non-EM eligible facilitators, as an allow-list, with EM defined by membership role OR global role.
- The denial reveals nothing: standard 403 envelope, `no-store`, timing floor, and no topic or lock query.
- Admin denial is kept deliberately and the docs say so.
- The contract, matrix, and spec rationale match the code, and nothing still claims TOPIC-001 "admits engineering managers".

**Non-Goals:**
- Adding `teamAnnotation` to TOPIC-001.
- The camelCase remap of TOPIC-001's topic rows (deferred; recorded as a contract note and a tripwire).
- Admitting admins to TOPIC-001, retiring TOPIC-001, renaming `admin.session_content_denied`, or rewording the admin denial message.
- Changing Decision E's degrade-to-participant on any other endpoint.
- Realigning the contract's "facilitator with an active session" prose with the grant's real window.

## Decisions

### Decision 1 (decided): how the handler detects an EM membership with a non-EM global role (path 2')

**Decided at design review (Solution Architect, Ingrid Sollenberger): Option B, with the read exported from the grant helper module.** Rationale in one line: the exec criterion for A1 (a concrete second consumer) is not met, and A1 would force constructors that cannot read a membership role, such as the synthetic grant in `realtime/vote-revealed-payload.ts`, to hardcode a security fact into a shared type.

Conditions that are part of the decision (both reviewers):
- **Location of the read.** `packages/backend/src/auth/team-content-access-helper.ts` gains one narrow export, `readActiveMembershipRole(userId: string, teamId: string): Promise<string | null>`, which runs `SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2 AND removed_at IS NULL` and returns the raw `role` value or `null`. It exports a *read*, not a policy, so it does not conflict with Decision 2's "no shared deny-EM helper", and the `removed_at IS NULL` predicate stays in one file (access-control Decision 8). `content.ts` contains no SQL against `team_memberships`.
- **Pure predicate.** The admission decision is `isTopicConfigReadAdmitted(grant, liveMembershipRole)` (Decision 2). It does no I/O; the handler does the read and passes the result in.
- **Allow-list equality.** A member is admitted only when `liveMembershipRole === "participant"`. Never "not EM" or "not null".
- **Fail closed on read failure.** If `readActiveMembershipRole` rejects, the error propagates to the Fastify error handler as a `500`. The handler SHALL NOT catch it and SHALL NOT default to admit. One test pins this (tasks 4.12).

**Decision criterion (exec review, Condition 1).** Choose A1 only if there is concrete, near-term reuse: a planned consumer, other than TOPIC-001, that has to read the membership role from the grant or detect path 2'. A "cleaner model" alone is not enough. Without that reuse, choose B and defer the grant-model change until a second consumer needs it.

**Option A1: add a required `membershipRole` field to both `member` grant variants.**
`TeamAccessGrant`'s `member` variants gain `membershipRole: "participant" | "engineering_manager"`, populated from the `membership_role` value the helper already selects. In path 2' the grant stays `role: "participant"`, so Decision E is unchanged for every other consumer, but it now carries `membershipRole: "engineering_manager"`.
- For: no new query. The fact comes from the same read that produced the grant, so there is no window where the two reads disagree. Because the field is required, the compiler makes every place that builds a grant state it (the helper, the synthetic grant in `realtime/vote-revealed-payload.ts`, test fixtures). A later variant cannot silently leave it out. Handlers that do not care just ignore it.
- Against: it touches a shared type used by the serializers and the realtime layer. More importantly (engineer review), the synthetic grant in `realtime/vote-revealed-payload.ts` is built from a `SessionSubscriberGrant`, which deliberately has no participant/EM distinction. A required `membershipRole` would make that literal hardcode `"participant"`, a security fact nobody read from the database, sitting in a shared type that the next serializer author would trust. Existing `toEqual` assertions on member grants in `team-content-access-helper.test.ts` and the grant fixtures in `action-items.test.ts` / `websocket-routes.test.ts` need the new field. That churn is mechanical and visible in review.

**Option A2: add an optional marker set only on the degraded grant** (for example `degradedFromMembershipRole?: "engineering_manager"`).
- For: minimal churn, since only path 2' sets it and existing literals compile unchanged.
- Against: an optional security fact fails open if it is left off. A future code path that builds a degraded grant without the marker would quietly let an EM through TOPIC-001. That is exactly the kind of drift this change exists to stop.

**Option B (chosen): a second membership read on the TOPIC-001 member path** (`SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2 AND removed_at IS NULL`, via `readActiveMembershipRole`).
- For: no change to the shared grant type, so the blast radius stays inside one handler.
- Against: an extra query on every TOPIC-001 member-path call. It adds test-fixture churn of its own: `content.test.ts` mocks `db.query` positionally, so every existing member-path TOPIC-001 test shifts by one query (tasks 4.0). Without the helper-module export it would duplicate membership logic outside the helper, which Decision 8 of the access-control design set out to avoid. It adds a small window where the two reads can disagree. It also adds a query that must run on the denial path within the timing floor, and the spec forbids only the topics and lock queries there, so it is allowed but it widens what a reviewer has to check.

**What the code shows against that criterion (checked on this branch):**
- **A1's real footprint:** the 3 `member` grant constructions in `team-content-access-helper.ts`, the synthetic participant grant in `realtime/vote-revealed-payload.ts` (~line 122), and about 10 grant literals in tests (`team-content-access-helper.test.ts` ×3, `team-content-serializers.test.ts` ×2, `websocket-routes.test.ts` ×1, `action-items.test.ts` ×4). Plus the shared type, which `team-content-serializers.ts` narrows with `Extract<…>`.
- **No current reuse.** No source file other than the helper reads the membership role. The two `content.ts` serializer branches (~844, ~974) key on `grant.role` and want Decision E's degraded value. The other EM checks in the codebase are handler-local OR checks of `global_role` and `membership_role`: the vote lock-in at `sessions.ts` 378–391 and the assign-roles check at `teams.ts` ~306. Those each run a *single* combined `users ⟕ team_memberships` query, which is the only read on their path. B follows the precedent of a handler-local OR check, but it is new in one respect: the helper reads, then the handler reads again. That second read is accepted because its disagreement with the first fails closed (next bullet).
- **No near-term reuse.** No open issue or active change (`team-membership-removal`, `topic-skip-and-creation-time-confirmation`) adds a TOPIC-001 consumer or another endpoint that needs path 2' detection. The `teamAnnotation`-on-TOPIC-001 consumer is not planned, and it waits on the participant-need follow-up (proposal Follow-ups, item 1). The "Decision E elsewhere" question could create a second consumer, but it is unfiled and undecided.
- **B's weaknesses are smaller than they look.** The read can be one indexed row: `SELECT role FROM team_memberships WHERE user_id = $1 AND team_id = $2 AND removed_at IS NULL`, the same predicate the helper uses. It runs only for `path: "member"` grants, which are the only ones with a membership. Its disagreement window with the helper fails closed in every direction that matters. A row that is now `engineering_manager` is denied. A row that is now missing is denied. A row demoted to `participant` between the two reads is also denied, because the predicate requires `grant.role` to be `participant` as well; the caller is admitted on the next request (stricter than the latest state, which fails closed; implementation security review N2). The predicate still combines this read with `grant.actorGlobalRole` for the global-role signal, and does not re-read `users`. The timing floor covers the extra query.

**Decision: B.** I know of no reuse beyond what the repo shows, so the exec criterion is not met. A1 stays the right shape once a second consumer appears (proposal Follow-ups, item 6). A2 is rejected: an optional security marker fails open. The implementation and PR SHALL NOT claim "no new query".

### Decision 2: the rule is a pure, local allow-list predicate in `content.ts`, used only by TOPIC-001

Exact signature (engineer review B1):

```ts
function isTopicConfigReadAdmitted(
  grant: TeamAccessGrant,
  liveMembershipRole: string | null,
): boolean
```

It is synchronous and does no I/O. Its only inputs are its two parameters; it reads no `process.env`, config object, feature flag, or database setting. It is not exported.

Structure: `switch (grant.path)` with a `never` default arm that returns `false`.
- `case "member"`: return `grant.role === "participant" && liveMembershipRole === "participant" && grant.actorGlobalRole !== "engineering_manager"`. `grant.role` is compared explicitly, because the union has two `member` variants and narrowing on `path` alone would not flag a third. `liveMembershipRole` is compared by **equality** with `"participant"`, so `null`, `undefined` (a malformed row), `"engineering_manager"`, and any membership role added later all deny.
- `case "facilitator"`: return `grant.actorGlobalRole !== "engineering_manager"`. `liveMembershipRole` is ignored (the handler passes `null`).
- `case "admin"`: return `false` (unreachable, because the handler denies admins earlier; kept so the switch is exhaustive without relying on order).
- `default`: `const _exhaustive: never = grant; return false;`.

The facilitator arm uses a deny on one value, not an allow-list of global roles, on purpose: the path-3 grant is earned by `sessions.facilitator_id`, not by global role, and a facilitator's stored global role can legitimately be `engineer` after a sign-in (security review N1). An allow-list such as `=== "facilitator"` would wrongly deny that facilitator.

Handler order (engineer review N6):

1. Canonical-id check → `404 TEAM_NOT_FOUND` (unchanged, before any query).
2. `grant = await evaluateTeamAccess(...)`.
3. `null` → `denyNullGrant` (unchanged; keeps its cross-team facilitator message).
4. `admin` → `denyAdminContentAccess` (unchanged; audit row).
5. `liveRole = grant.path === "member" ? await readActiveMembershipRole(userId, teamId) : null`. A rejection propagates as a `500` (Decision 1).
6. `!isTopicConfigReadAdmitted(grant, liveRole)` → `emitAuditEvent(request.log, "topic.config_read_denied_role", …)` (Decision 6), then `await applyTimingFloor(startTime)`, then `return denyAccess(reply)`.
7. Topics query, then `hasCompletedFirstSession`.

- **Why not a deny-list** (`grant.path === "member" && grant.role === "engineering_manager"`, the shape already used for serialization at `content.ts` ~844/974): it misses path 2' and the global-EM/participant state, and it would admit any future variant by default.
- **Why not a shared "deny EM" helper:** the OR rule diverges from Decision E on purpose, on this endpoint only. Exporting it would invite reuse on endpoints where that policy question is still open (see Open Questions). It stays local, with a comment pointing at the spec requirement. `readActiveMembershipRole` is exported from the helper module, but it returns a fact, not a decision.

### Decision 3: OR semantics, judged on the actor, on every grant path

The caller is an EM if their membership role **or** their global role is `engineering_manager`. BRD FR-1.4 defines an EM as anyone assigned the EM role for a team, so a path 2' user *is* that team's manager. The global-EM/participant state is reachable by design (TEAM-005 is demotion-only and leaves `users.global_role` alone, and join-link redemption inserts `participant` with no global-role check). The vote lock-in (`sessions.ts` 378–391) already uses OR. The app must not treat one person as "too much of a manager to vote" and "a participant who may read the team's words" at the same time.

On the facilitator path the check is `actorGlobalRole` only. A facilitator grant exists only when the caller has no active membership on the team, so membership can never disqualify a facilitator. A facilitator whose global role is `facilitator` is never denied, and a test pins that. A facilitator grant whose live global role has drifted to `engineering_manager` fails closed. The app cannot create that state, because session creation requires `global_role = 'facilitator'`. It only arises from IdP drift during the window. Denying it takes no position on whether an EM may facilitate another team. SESSION-001 already decides that.

**Freshness of the two signals (security review N1).** The membership role is live: TEAM-005 and membership removal write `team_memberships` directly, both reads are uncached, and `team_memberships_active_unique` (migration 7) guarantees at most one active row. The global-role signal is the stored `users.global_role`, which is rewritten only by the `/auth/callback` upsert, so it reflects the user's **last sign-in**. An IdP-side promotion to EM therefore reaches TOPIC-001 at the user's next sign-in, bounded by the 90-minute `ABSOLUTE_LIFETIME_MS` plus however long they take to sign in again. I accept that window: the authoritative FR-1.4 signal (membership) is live, and TOPIC-001 carries no annotation yet. When `teamAnnotation` is added to any member-readable endpoint, this window must be revisited. The spec says "stored", not "live", for the global role.

This is a **deliberate, TOPIC-001-only divergence from Decision E** (restrict-team-005-em-promotion). Decision E's reasoning ("denying baseline content over a column the user doesn't control is an availability cost with no security benefit") holds for content the user is meant to see. Here the security benefit is the whole point, because this endpoint's roadmap carries the team's own free text.

### Decision 4: admin 403 is confirmed, not changed

The 403 on TOPIC-001 came from task 5.10 of `enforce-access-control-on-team-content`, a blanket "admin → 403" rule applied to every `content.ts` handler. Decision 2 of that change had in fact listed topic configuration metadata as admin-readable. We now keep the denial **on purpose**. Admitting admins here would open a new admin-read path, and the spec would then require a same-transaction read-audit row that this handler does not have. Admins can read topic configuration through TOPIC-002, but (security review B2) TOPIC-002 does not meet that audit rule either: it admits `application_admin` through `checkStandingFacilitatorOrAdminAuthorization`, selects `team_annotation`, and writes no audit row or event. It also admits an admin who holds an EM membership on the team before looking at membership. Both are pre-existing and are **not fixed here**; the spec no longer claims TOPIC-002 satisfies the admin-read audit requirement, and proposal Follow-ups item 7 gives them an owner. Pointing admins at TOPIC-002 is a description of where the data lives, not an endorsement of its controls. The audit operation `admin.session_content_denied` keeps its name (consumers may key on it, and `metadata.endpoint` already identifies TOPIC-001). The "session content" wording in the message is inaccurate for topic configuration, but it is harmless. Rewording it needs a parameter on the shared `denyAdminContentAccess`, so it is a follow-up.

### Decision 5: camelCase remap deferred, guarded by a contract note and a spec tripwire

Topic rows stay raw snake_case (`id`, `vote_type`, `display_order`, `status`) next to camelCase `isCustomizationLocked`. The remap is not a rename: it adds four columns, renames `id`, and drops `status`. That is a contract-shape decision, and it belongs with the consumer that knows which fields it needs. That consumer is not settled, because the use case and the contract disagree about whether participants need TOPIC-001 at all. So:
- The contract TOPIC-001 response block gets an **"As built (#187)"** note saying the topic entries are raw snake_case rows today, the camelCase shape shown is the target, and the first change that adds a TOPIC-001 consumer SHALL do the remap.
- The `topic-annotation` requirement says the same thing, so a reader coming from either side finds the tripwire.

### Decision 6: a log-only denial event, plus the existing mismatch log

Under OR, a real engineer wrongly tagged EM on a team (path 2') loses TOPIC-001. They are already blocked from voting by `sessions.ts`, so this adds no new harm, and since TOPIC-001 has no UI caller they will not notice. The helper's `team.access_grant_mismatch` event still fires before the denial. An administrator finds the user through that event and fixes the membership role through TEAM-005.

**New (security review B1): `topic.config_read_denied_role`, log-only.** Without it, three of the four denied EM states leave no trace, while admin denials on the same endpoint get a DB row. Every predicate denial emits one structured event through `emitAuditEvent(request.log, "topic.config_read_denied_role", fields)` immediately before the timing floor and `denyAccess`. The name follows the codebase's `*_denied_role` convention (`team.creation_denied_role`, `session.advance_denied_role`, and the related `team.role_change_denied`). Those three also write an `audit_log` row because they gate low-volume privileged writes. This is a read on an endpoint that can be polled, so it follows `team.access_grant_mismatch`'s log-only reasoning (no per-request DB write on a read path). The name is added to the `AuditEventName` union in `audit-logger.ts` with a comment citing #187.

Fields: `userId`, `teamId`, `grantPath` (`"member"` | `"facilitator"`), `globalRole` (the grant's `actorGlobalRole`, named to match `team.access_grant_mismatch`; implementation security review N3), `membershipRole` (the live value passed to the predicate, or `null`), `reason`. `reason` is derived only after the predicate has returned `false`, for diagnosis, and never feeds admission:
- `membership_em`: `liveMembershipRole === "engineering_manager"` (takes precedence when both signals are EM);
- `global_em`: `actorGlobalRole === "engineering_manager"`;
- `not_admitted`: anything else (for example no active membership row because of a removal between the two reads, an unrecognised membership role, or an unhandled grant variant).

**Content boundary (security review N7).** The event, like `team.access_grant_mismatch`, SHALL NOT carry topic names, annotation text, topic ids, or the lock flag. This holds by construction today because neither query runs on denial; it is stated so a future "add context to the log" change does not break it.

## Risks / Trade-offs

- [The allow-list wrongly denies a real participant or facilitator] → 200 regression tests for participant members with global role `engineer` and `senior_engineer` (so an over-tight `=== "engineer"` is caught), a standard facilitator, and a global facilitator with a participant membership, placed next to the flipped EM tests. Scenario 4.3 of `template-team-topic-writes-integration.test.ts` (a member reads the template's rows) must still pass unchanged. So must the facilitator-actor TOPIC-001 calls in `topics-integration.test.ts` (~91, ~131, ~547); the facilitator path adds no query, so they should pass untouched.
- [Positional `db.query` mocks in `content.test.ts` shift under B and an existing test fails confusingly] → A fixture helper queues both reads (tasks 4.0). The snake_case tripwire test also asserts `statusCode === 200`, so a future failure reads as an authorization regression rather than a shape change. Denial tests assert call counts or SQL text, never position.
- [The second read throws] → It becomes a Fastify `500` without the timing floor. That matches what happens today when the helper's own query fails, so it adds no new oracle, and it never admits (tasks 4.12).
- [Test fixtures pin an impossible role state] → `users.global_role` is the `user_role` enum (`engineer`, `senior_engineer`, `facilitator`, `engineering_manager`, `application_admin`; `migrations/1_create_enums.sql`). `participant` is a membership role only. Spec scenarios and new fixtures use only enum values.
- [Someone "fixes" the unit test but not the integration test, or relaxes the no-leak assertion while editing] → Tasks flip both, and the S1 test in `topic-annotation-integration.test.ts` keeps its "body does not contain the annotation text" assertion as a canary.
- [The EM denial is faster than other denials and acts as a timing oracle] → `applyTimingFloor(startTime)` runs once before `denyAccess`. Exposure is low anyway: every caller who reaches the gate already knows the team exists. `content.test.ts` mocks `timing-oracle.js`, so the test asserts the floor is called exactly once with the handler's `startTime` before the response, plus that the EM-denial status, headers, and body match a null-grant 403 except for `correlationId` (tasks 4.5). It does not measure wall-clock time; the floor value itself is still the tracked 150 ms placeholder.
- [`timing-oracle.ts` reads `NODE_ENV` at import] → It throws under `NODE_ENV=production` while the floor is a placeholder. That does not violate "unconditional": the floor is not the admission decision, and the predicate reads no env. Task 6.4 says so for the security reviewer. The NODE_ENV test (4.11) stays at `development` and `test` only.
- [Decision 1: B adds a query] → Scoped to `member` grants, after the admin branch, failing closed, inside the timing floor, and implemented once in the helper module.
- [Facilitator/membership race] → A facilitator grant skips the second read, so a membership created between the helper's two internal queries could be missed for one request. The window is milliseconds and the outcome is no worse than the previous request. Accepted, no test.
- [Spec rationale goes stale and a future reader thinks the annotation gate is still closed] → All five "admits engineering managers" sites are updated. Acceptance check: `grep -rn "admits engineering" openspec/specs requirements packages/*/src` returns nothing once the change is synced (the phrase wraps across lines in `content.ts`, hence the shorter pattern).
- [OR semantics on TOPIC-001 differ from Decision E elsewhere, which looks inconsistent] → Recorded here as deliberate and scoped. The wider policy question goes to the VP of Engineering as a follow-up.

## Migration Plan

No data migration. Deploy is a normal backend release, because TOPIC-001 has no production consumer and EM callers moving from 200 to 403 affects no UI. Rollback is reverting the commit; `readActiveMembershipRole` and the new event name are additive.

## Open Questions

- Decision 1 is closed (B). None remain for implementation.
- The follow-ups this change surfaced are in proposal.md "Follow-ups", for a human to file: participant need and first-session preview for TOPIC-001 (BA), Decision E elsewhere (VP of Engineering), facilitator-window prose, the TOPIC-001-specific admin denial message, `teamAnnotation` release-note messaging, A1 deferred, TOPIC-002 admin-read audit and admin-with-EM-membership (Security + Solution Architect), and confirming how `global_role = 'facilitator'` persists across sign-in.

## Design review disposition

**Engineer review (Marcus Oyelaran), verdict: approve with two blocking clarifications**

| Item | Disposition | Where |
|---|---|---|
| Position on D1: B, read exported from the helper; A1 synthetic-grant argument; precedent overstated | **Accepted, all three.** B is decided. The read is `readActiveMembershipRole` in `team-content-access-helper.ts`. The A1 synthetic-grant cost is recorded. "Follows that precedent" is replaced with "handler-local OR check, with a second read". | Decision 1 |
| B1: exact predicate signature; allow-list equality on membership role | **Accepted (blocking).** `isTopicConfigReadAdmitted(grant, liveMembershipRole: string \| null): boolean`, pure, `switch` on `path` with `never` default, explicit `grant.role` comparison, `=== "participant"`. | Decision 2; tasks 3.1, 3.2 |
| B2: positional mocks shift; fixture helper, tripwire status, call counts, Impact line | **Accepted (blocking).** New task 4.0 adds `mockTopic001MemberGrant` and moves the three named tests onto it. 4.9 asserts `200`. Denial tests assert call counts or SQL text. proposal Impact corrected. | tasks 4.0, 4.1, 4.9; proposal Impact |
| N1: timing assertion form | **Accepted**, combined with security N3 (envelope parity). | tasks 4.5; Risks |
| N2: NODE_ENV caveat, no `production` case | **Accepted.** | Risks; tasks 4.11, 6.4 |
| N3: second read throws | **Accepted**, and strengthened by security N2 into a test. | Decision 1; Risks; tasks 4.12 |
| N4: realistic `global_role` fixtures | **Accepted in intent, corrected in content.** The engineer's list included `participant`, which is not a `user_role` value. Fixtures use the enum (security B3). | Risks; tasks 4.0, 4.3 |
| N5: other TOPIC-001 callers | **Accepted.** `topics-integration.test.ts` added to the regression list. | Risks; tasks 4.8 |
| N6: explicit handler order | **Accepted.** | Decision 2 |
| N7: assert the mismatch event in 4.2(d) | **Accepted** (already in 4.2(d); now also asserts it for (a)). | tasks 4.2 |
| N8: no frontend coupling | **Noted**, confirms the proposal's claim. | — |

**Security review (Tomás Ferreira), verdict: approve with conditions**

| Item | Disposition | Where |
|---|---|---|
| B1: EM denials leave no trace | **Accepted (blocking).** Log-only `topic.config_read_denied_role` with `reason`, following the `*_denied_role` naming and `team.access_grant_mismatch`'s log-only reasoning. | Decision 6; `team-content-access` spec; tasks 3.5, 4.1, 4.2 |
| B2: spec steers admins to an unaudited TOPIC-002 | **Accepted (blocking), scope held.** The modified requirement no longer implies TOPIC-002 meets the admin-read audit rule. TOPIC-002 is not changed here. Follow-up 7 (owner Security + Solution Architect) covers the audit row and the admin-with-EM-membership case. This is a pre-existing gap that this change neither creates nor widens. | Decision 4; `team-content-access` spec; proposal Follow-ups 7 |
| B3: impossible `global_role = 'participant'` | **Accepted (blocking).** Verified against `migrations/1_create_enums.sql`. Scenarios now use `engineer`; `senior_engineer` is added to the 200 regression. | spec scenarios; tasks 4.3, 4.7 |
| N1: global role reflects last sign-in; facilitator reset observation | **Accepted.** Spec says "stored" for the global role; Decision 3 records the window. The facilitator-reset question is follow-up 8, and Decision 2 explains why the facilitator arm is deliberately not an allow-list of global roles. | Decision 2, 3; spec; proposal Follow-ups 8 |
| N2: explicit parameter; fail closed on throw; facilitator race | **Accepted, all three.** | Decisions 1, 2; Risks; tasks 4.12 |
| N3: timing test proves less than it says | **Accepted.** Replaced with floor-call assertion plus envelope parity with a null-grant 403. Spec scenario reworded to match. | spec; tasks 4.5 |
| N4: 404 ordering | **Noted**, already pinned by 4.10. | — |
| N5: name helper precedence in test comment | **Accepted.** | tasks 4.4 |
| N6: grep for `process.env` / `config.` in predicate | **Accepted.** | tasks 6.3 |
| N7: event content boundary | **Accepted.** Normative in the spec. | Decision 6; spec |
