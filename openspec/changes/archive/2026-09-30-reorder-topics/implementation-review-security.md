# Implementation Security Review: reorder-topics (TOPIC-006)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** Uncommitted working tree on `agent-team/52-reorder-topics`: `packages/backend/src/routes/topics.ts`, `packages/backend/src/auth/audit-logger.ts`, `packages/backend/src/content/timing-oracle.ts`, `packages/shared/src/types/topic.ts`, `packages/backend/migrations/18_topics_active_order_partial_unique.sql`, `packages/backend/src/routes/__tests__/topics.test.ts`, `packages/backend/src/routes/__tests__/topics-integration.test.ts`, and the frontend diff (checked for injection sinks only). Baseline: my design review (`design-review-security.md`) and the disposition table in `design.md`.
**Verdict:** **Approve.** Every accepted finding (F1–F4, F6, F7) is implemented as the disposition describes, and each is covered by at least one test. I found no blocking or medium-severity issue introduced by this change. One low finding (L1) is a path-parameter version of F2. The case-sensitive advisory-lock key predates this change, and it matters more for the shipped archive endpoint than for reorder. I want it filed. I don't want it fixed piecemeal here.

---

## Verification of accepted findings

| Item | Result | Evidence |
|---|---|---|
| Authorization reuse (facilitator or admin) | **Verified.** The handler calls `checkStandingFacilitatorOrAdminAuthorization`, not TOPIC-003's facilitator-only helper. The wrapper writes its own message and applies the floor on both deny reasons. | `topics.ts:483-503`, called at `topics.ts:1146`. Tests: `topics.test.ts` "check ordering" block (403 before team/lock); integration 5.1 "an application_admin succeeds, including one who is a member of the team". |
| Team scoping of every write | **Verified.** The set read, phase 1, and phase 2 all filter `team_id = $1 AND status = 'active'`. Phase 1 joins the submitted IDs to rows of the path's team only. Row-count assertions on both phases are kept and throw `ReorderRowCountMismatchError`. The audit row takes `team_id` from the path. | `topics.ts:1191-1196`, `1224-1233`, `1237-1244`. Tests: unit row-count mismatch (phases 1 and 2) → ROLLBACK, no audit, 500; integration 5.1 "archived rows are not modified", 5.6 other-team/archived/unknown IDs change nothing. |
| F2: lowercase before dup/set checks | **Verified.** Strict UUID regex (case-insensitive), then `toLowerCase()`, then the duplicate check. Only the lowered list is used after that: set compare, no-op compare, `$2::uuid[]` binding, audit `new_order`, response. The strict pattern runs before any `::uuid` cast, which closes the `22P02` path for body entries. | `topics.ts:522-549`, `1178`. Tests: unit "a mixed-case duplicate" → 422; unit changed save binds `[T3, T1, T2]` lowercased from uppercase input; integration 5.2 all-uppercase list stored, returned, and audited lowercase. |
| F1: admin gets `null`, query not run | **Verified.** `readOpenSessionCreatedAt` returns before issuing SQL unless `actorGlobalRole === 'facilitator'`. It applies to both the no-op and changed paths. The query is `WHERE team_id = $1 … ORDER BY created_at DESC LIMIT 1`. | `topics.ts:583-600`. Tests: unit asserts no `FROM sessions` query for an admin (`topics.test.ts` diff line ~534); integration 5.8 admin gets `null` despite a lobby session, for a changed save and a no-op. |
| 409 `TOPIC_ORDER_STALE` non-distinguishing | **Verified.** Set equality is computed in memory against the team-scoped read taken under the lock. Submitted IDs are never looked up. The body is a constant message and code, with no diff, echo, or current list. | `topics.ts:1189-1209`, message constant at `topics.ts:602-603`. Tests: unit "missing, extra, and unknown IDs all return an identical 409 … body"; integration 5.6 missing/archived/other-team/unknown identical; 5.2 "200 valid-looking UUIDs that are not the team's set … 409". |
| 422 validation; 200 cap before per-entry work (F4) | **Verified.** Order: object check, array check, length 1..200, then per-entry type/pattern, then dedupe. Messages state the rule only (F3). Null, bare-array, and string bodies return 422, not a TypeError 500. | `topics.ts:525-549`. Tests: 13-case table; "201 non-UUID strings fail on length first"; "the 422 message never echoes a submitted value". |
| Customization-lock denial audit | **Verified.** Reuses `checkCustomizationLockGate` → `writeLockDenialAudit` with `attempted_operation: "topic.reordered"`. The lock is evaluated before the body, so a hostile body never reaches the audit row or the log. | `topics.ts:1157-1171`; `topics.ts:174-205`. Tests: unit "the lock denial writes topic.write_denied_locked with attempted_operation topic.reordered and no order payload"; "a locked team with an empty-array body receives 409 … not 422". |
| `topic.reordered` audit payload | **Verified.** Metadata is `{ previous_order, new_order }`, IDs only. It is inserted after phase 2 and before `COMMIT` on the same client. `previous_order` is read under the lock. The actor fields come from the session and `request.ip`. The no-op path writes no row and emits nothing. `emitAuditEvent` runs after `COMMIT`. | `topics.ts:1246-1273`; no-op `topics.ts:1211-1222`. Tests: unit changed-save test asserts order phase1 < phase2 < INSERT < COMMIT < emit, and that metadata excludes names; unit and integration 5.3 no-op writes no audit row; integration 5.10 exactly one row, no names; 5.4 failure after first write rolls back. |
| `Cache-Control: no-store` | **Verified.** Set once, as the first statement of the handler. I confirmed in Fastify 5.8.5 (`node_modules/fastify/lib/error-handler.js:57-58`) that the default error path removes only `content-type`/`content-length`, so the header survives onto the 500. | `topics.ts:1138`. Tests: every handled exit (8 cases) plus the thrown-path 500. |
| Logging fields (F6) | **Verified.** `emitAuditEvent` fields are exactly `actorUserId, actorGlobalRole, actorIp, teamId, topicCount`. The unit test asserts the exact key set. | `topics.ts:1262-1268`. |
| Timing floor on every exit, including 500 | **Verified for every handled exit** (403×2, 404, 409 lock, 422, 409 stale, 200 no-op, 200 changed; the test asserts exactly one call each). **The 500 path skips the floor**, which is the recorded inherited exemption (design.md Decision 2, F7). After the F2 fix, the only ways to reach it from input are L1/L2 below, and neither selects on secret state. The measurement TODO names reorder at the 200 cap. | `topics.ts:1278-1283`; `timing-oracle.ts:53-58`. |
| `TEAM_NOT_FOUND` on `checkTeamExists` | **No new oracle.** See the analysis below. | `topics.ts:156`. |

### `TEAM_NOT_FOUND`: existence-oracle analysis

Adding the code changes the response body only. It changes neither the status code nor which callers can reach the response.

1. **Reachability is unchanged.** `checkTeamExists` runs only after the identity/role check in all four callers (`topics.ts:629`, `786`, `990`, `1152`). A caller who is not a facilitator or admin gets `403` whether or not the team exists (unit test "a non-facilitator against a nonexistent team receives 403 … before team or lock"). The callers who reach the 404 are standing facilitators and admins, who are org-wide by design and can already enumerate teams.
2. **No new bit is disclosed.** Before this change the team 404 already differed from the topic 404: `"Team not found."` vs `"Topic not found."` + `TOPIC_NOT_FOUND` (`topics.ts:386`, `457`). The re-add-removed-topic contract already documented that the split is deliberate. The code makes an existing distinction machine-readable. It does not create one.
3. **Timing is unchanged.** The same query and the same floor apply.

Accepted. The regression tests on the three shipped endpoints now assert the code.

---

## Findings

### L1 (Low, inherited, applies to all four topic writes): the advisory-lock key depends on the case of the path `teamId`

`pg_advisory_xact_lock(hashtext($1::text))` hashes the raw path string (`topics.ts:680`, `824`, `1026`, `1187`). `teams.id` and `topics.team_id` are `uuid` (`2_create_tables.sql:17,47`), so Postgres accepts `/teams/ABCD…/` and `/teams/abcd…/` as the same team for every query. The two spellings hash to **different lock keys**, though. Two concurrent requests from authorized callers that spell the team ID in different cases do not serialize. This is F2's canonicalization gap applied to the path parameter instead of the body.

- **Reorder itself fails closed.** Row locks from the phase-1 `UPDATE` serialize two reorders, and a concurrent archive either removes a row before phase 1, which trips the row-count assertion (500, ROLLBACK), or blocks behind it. A concurrent add or restore appends above the renumbered range. I found no path to a corrupted order, only a 500 in the archive race.
- **The shipped archive endpoint does not fail closed.** Its last-active-topic guard (`topics.ts:826-847`) is a `COUNT(*)` that only the advisory lock protects. Two concurrent archives of the last two active topics, using differently-cased team IDs, can both see `activeCount = 2` and both commit, leaving a team with zero active topics. That breaks a stated invariant. It takes an authorized standing facilitator or admin acting deliberately, and it is recoverable through restore, hence Low.

**Recommendation (follow-up, not a condition of this change):** key the lock on the canonical value, `hashtext($1::uuid::text)`, or lowercase `teamId` once at handler entry, in all four handlers together. Add one integration test with an uppercase path. Fixing only reorder would leave the actual exposure (archive) in place and make reorder the odd one out, which is the same reasoning design.md uses for the thrown-path floor.

### L2 (Low, inherited): a non-UUID `teamId` path parameter becomes a 500 before authorization

The path `teamId` is never validated. The first query that binds it (`evaluateStandingFacilitatorAccess`, `tm.team_id = $2`) raises `22P02` for a non-UUID string. That surfaces as a 500 through the global handler, before the 403 and without the timing floor. It discloses nothing about data, because the outcome depends only on the caller's own input. But it is a 500 any authenticated user can trigger, and it puts noise in the error logs. It affects every topic endpoint. **Recommendation:** add a UUID route-param schema to the topic routes in the same follow-up as L1. That also makes the L1 fix trivial.

### I1 (Informational): responses Fastify writes before the handler runs don't carry `no-store` or the floor

Malformed JSON (400) and an unsupported content type (415) are rejected during content-type parsing, before the handler body sets the header. These responses contain no data, so there is nothing to cache and no oracle. I'm recording it so nobody reads "every response carries no-store" as covering the framework's rejections. An `onSend` hook scoped to the plugin, as `em-views.ts:80` does, would cover them if anyone wants that.

### I2 (Informational, carried forward): F5, no rate limit on topic writes

This is still open as designed, and design.md records it as a follow-up with no issue filed. Reorder is now the fifth caller of the standing-facilitator helper and the heaviest topic write. The request stands: file an issue for a shared per-actor limiter. L1 and L2 fit naturally in the same hardening pass.

### Other checks with no finding

- **Frontend:** the diff and `topicOrder.ts` contain no `dangerouslySetInnerHTML`, no `innerHTML`, no browser storage of topic data, and no logging of response bodies. Topic names are rendered through React's escaping.
- **Migration 18:** security-neutral, as in the design review. The Down step rewrites only archived `display_order`, which nothing depends on, and it uses node-pg-migrate's real section markers.
- **Phase 2 predicate `display_order < 0`:** it is safe regardless of the "all prior values ≥ 0" comment. The set check under the lock guarantees phase 1 rewrote every active row to a negative value, and the phase-2 row-count assertion would catch any deviation.
- **Admin role on the audit row:** `actor_global_role` records `application_admin` correctly, so an admin's reorder can be told apart from a facilitator's in `audit_log`.
- **Multi-provider OIDC:** no identity-provider coupling. The code uses only `global_role`, membership, and the session `userId`.

## Summary

The implementation matches the reviewed design. It uses the right authorization helper, scopes every write to the team twice, lowercases IDs before any comparison, never runs the session query for admins, returns a constant stale body, validates in a bounded order, writes an IDs-only audit row in the same transaction (nothing on a no-op), sets `no-store` on every exit including the 500, and applies the timing floor on every handled exit. `TEAM_NOT_FOUND` adds no oracle, because the status and message already distinguished team from topic and the 404 is reachable only after authorization. Approve. File one follow-up covering L1 (case-sensitive lock key, which matters most for archive's last-active guard), L2 (path UUID validation), and F5 (rate limit).
