# Security Review: reorder-topics (TOPIC-006)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** `design.md`, `proposal.md`, `specs/reorder-topics/spec.md`, cross-checked against shipped code: `packages/backend/src/routes/topics.ts` (TOPIC-003/004/005), `packages/backend/src/auth/standing-facilitator-access-helper.ts`, `packages/backend/src/auth/audit-logger.ts`, `packages/backend/src/content/timing-oracle.ts`, `packages/backend/src/routes/content.ts` (`denyAdminContentAccess`, `GET /topics/all`), `packages/backend/src/auth/team-content-access-helper.ts`, `packages/backend/src/routes/facilitator-sessions.ts` (`POST /draft` 409 body). Prior reviews: `archive/2026-09-30-re-add-removed-topic`, `archive/2026-09-30-remove-topic`, `archive/2026-09-29-topic-customization-lock-and-add-custom-topic`.
**Verdict:** **Approve with required design edits.** Nothing here is blocking, and most of the design reuses controls I have already reviewed and verified. There is one implicit authorization-boundary decision (`openSessionCreatedAt` exposure, F1) and one input-canonicalization gap (F2). Both need to be written into design.md/spec before implementation starts, because the implementer should not be the one who settles them. Everything else is either a small note for implementation or an inherited risk that I am recording again.

---

## What I verified and have no concerns with

- **Authorization reuse.** Decision 2 step 1 names `checkStandingFacilitatorOrAdminAuthorization`, the decision-only helper (`standing-facilitator-access-helper.ts:88-116`). It admits `application_admin` unconditionally and otherwise requires `global_role = 'facilitator'` and no active membership. Reorder becomes its fourth topic caller, with the same wrapper shape as `checkRestoreTopicAuthorization` (`topics.ts:411-431`), which writes its own message and applies the floor on both branches. That is correct. **Implementation check (same one I flagged for TOPIC-005):** confirm that the handler calls this helper and not TOPIC-003's facilitator-only `checkStandingFacilitatorAuthorization` (`topics.ts:92`). Copying the TOPIC-003 handler as a template would silently drop the admin branch.
- **Cascade and lock uniformity.** Identity, then team, then lock, then body, then set. That is TOPIC-003's order. Putting the lock before body validation means a locked team returns `409` for any body. The shared `writeLockDenialAudit` writes only `{ endpoint, attempted_operation }` (`topics.ts:171-203`), so a garbage or hostile body never reaches the audit row or the log. Good.
- **Cross-team / IDOR.** Every write is double-scoped. Phase 1 is `WHERE t.id = v.id AND t.team_id = $teamId AND t.status = 'active'`, and phase 2 is `WHERE team_id = $teamId AND status = 'active'`. Even if the set check were wrong, a foreign or archived ID could not be renumbered: phase 1 would update fewer than N rows, the row-count assertion would fail, and the transaction would roll back. That is defense in depth, and I want the row-count assertion kept, not "simplified" away.
- **Existence oracle (Decision 4).** `409 TOPIC_ORDER_STALE` does not leak more than `404` would. It leaks less. The caller who reaches step 5 has already passed authorization for this team and can read the team's full active set through `GET /topics/all`. So "your set is not our set" tells them nothing they couldn't already read. A foreign-team ID, an unknown ID, and an archived ID all produce the same code and message, so the endpoint can't be used to test whether a topic ID exists anywhere else. `404` is reserved for the path's team, which the same caller could learn through `GET /topics/all` anyway. Conditions for this to hold are in F3.
- **Audit payload contents (Decision 6).** `{ previous_order: uuid[], new_order: uuid[] }` contains opaque internal identifiers only. Leaving out names is the right call: custom topic names and prompts are free text a facilitator typed, and they don't belong in an append-only log. `previous_order` is read inside the advisory lock, so it is authoritative, and the row is written in the same transaction as the renumber. That matches `topic.archived`/`topic.restored`. `actor_user_id`, `actor_global_role`, and `actor_ip` come from server-side session state and `request.ip`, never from the body. No forgery surface.
- **No audit on a no-op.** Acceptable for state-change auditing: a no-op changes nothing, so a row would be noise. It does interact with F1, though. See there.
- **Request-size bound.** No `bodyLimit` override exists in the backend, so Fastify's 1 MiB default applies before parsing. The 200 cap then bounds the work done under the advisory lock (at most 200 rows × 2 updates, plus a ≤ ~15 KB audit row). That is adequate. See F4 for check ordering.
- **Migration 18.** Replacing the constraint with a partial unique index is security-neutral. The Down step rewrites archived `display_order` only, which no reader treats as meaningful and no audit record depends on.
- **No IdP coupling.** Per team memory (multi-provider OIDC): this design performs no authentication and relies only on `global_role` and `team_memberships`, read live. No Entra-specific assumptions.

---

## Findings

### F1 (Medium, required design edit): `openSessionCreatedAt` is an implicit authorization-boundary decision, and a no-op makes it a silent probe

Decision 7 argues for the field on UX and freshness grounds, but it never asks **who** is allowed to learn it. The codebase has an explicit rule here:

- `team-content-access-helper.ts` (Path 0) says content endpoints, meaning session history, trends, and the like, **MUST** return 403 for admin grants. `content.ts` enforces this with `denyAdminContentAccess`, which also writes an `admin.session_content_denied` audit row. `GET /api/v1/teams/:teamId/sessions` is one of those endpoints.
- A standing (non-member) facilitator likewise gets `null` from `evaluateTeamAccess` for a team whose session they are not running, so they can't read that team's sessions either.

With this design, **any** standing facilitator in the org, and any `application_admin`, can learn whether a team has a live session and exactly when it was created. Because a no-op save writes no audit row, they can do that by submitting the team's current order, with no record that they asked. For an admin, this is a read the system otherwise denies **and audits**.

How much this matters: low data sensitivity. It is one timestamp, not votes, trends, or action items. For facilitators it adds little, because `POST /draft` already reveals `existingSessionId` and status in its `409` (`facilitator-sessions.ts:395-410`), though only as a side effect of trying to create a session. For admins it is new. The problem is less the data than the fact that the boundary moved without anyone deciding to move it.

**Required:** state the decision in design.md Decision 7 and in the spec requirement. Either of these is acceptable to me:
- **(a) Accept, with rationale:** "open-session existence and `created_at` are administrative metadata, not session content under the Path 0 rule, and are visible to every actor who can reorder." Add a spec scenario for the admin case so the exposure is tested and intentional.
- **(b) Narrow:** return the field only when the actor's `global_role = 'facilitator'`, and return `null` for `application_admin`. The UI copy degrades to the always-shown pinned floor copy, which Decision 7 already keeps.

I lean toward (a) because of the `POST /draft` precedent, but it is a product/BA call, and it has to be written down. I do **not** ask for no-ops to be audited as a fix. That would add a row per idle Save click for a signal this small.

Also required, whichever option is chosen: the query must be `WHERE team_id = $1` (it is), and it must tolerate more than one row (`ORDER BY created_at DESC LIMIT 1`) rather than trusting migration 10's invariant and returning a 500 if that invariant ever drifts.

### F2 (Medium, required design edit): UUID canonicalization is unspecified

Step 4 says "non-UUID entry" and "duplicates" but doesn't say how they are compared. UUIDs are case-insensitive, and Postgres returns them lowercase. If the handler dedupes and compares the raw client strings:
- `["AAAA…", "aaaa…"]` passes the JS duplicate check. After that, either the in-memory set comparison produces a spurious `STALE`, or, if the comparison happens in SQL after a `::uuid` cast, phase 1 updates N−1 rows and the row-count assertion turns it into a `500`.
- An all-uppercase but otherwise correct list always comes back `STALE`, which sends the UI down the reload path for no reason.

Every one of these fails closed, so there is no integrity breach. But the result is a `500`/wrong-error path reachable from input, and the kind of "works except when" bug that gets patched in a hurry later.

**Required:** the spec should say that entries must be JSON strings matching a strict UUID pattern (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, case-insensitive), that they are **lowercased before** the duplicate check, the set comparison, the no-op comparison, and SQL binding, and that the audit's `new_order` records the canonical form. Add one scenario: mixed-case duplicates → `422`. Strict validation before any `::uuid[]` cast also closes the `22P02` → `500` path for malformed entries.

### F3 (Low, implementation condition): keep the stale check non-distinguishing in practice as well as on paper

Decision 4's oracle guarantee holds only if the implementation keeps to these:
1. Set equality is computed **in memory** against the team-scoped active set read under the lock. The submitted IDs are never looked up individually, and never looked up without a `team_id` filter (for example, `SELECT … WHERE id = ANY($ids)`). That would add a timing difference, and a future "helpful" diff message would turn it into a real oracle.
2. The `409 STALE` body is constant. It carries no diff, no echo of the missing or extra IDs, and no current list. The spec already requires the same `error.message`, so this is a note for code review.
3. The `422` message describes the rule and does not reflect submitted values back.

### F4 (Low, implementation note): check the length cap before per-element validation

A 1 MiB body can hold an array of several hundred thousand tiny elements. Check `Array.isArray`, then `length === 0 || length > MAX_REORDER_TOPICS`, **before** iterating elements for type, UUID, and duplicates. It costs nothing and keeps the pre-lock work bounded by the cap and not by the body limit.

### F5 (Low, inherited, recorded again): no rate limit on a lock-holding, audit-writing write

Decision 6 inherits "no rate limiter, no `withTimeout`" from TOPIC-004/005. Reorder is the heaviest of the four topic writes. It takes the per-team advisory lock, updates up to 200 rows twice, and writes an audit row of up to ~15 KB. Under the standing-facilitator model, one compromised facilitator or admin credential can, for **every team in the org**, (a) repeatedly take the advisory lock and stall add/archive/restore, and (b) grow `audit_log` without bound by alternating two orders, each of which is a real, audited change. I am not asking this change to fix that. I am asking for a follow-up issue for a shared per-actor limiter across topic writes (the TEAM-006 limiter is the precedent). Otherwise this risk keeps getting inherited without anyone owning it. The pre-existing blast-radius note from my TOPIC-005 review applies, and reorder is its fifth caller.

### F6 (Low, implementation note): structured-log payload and caching

- Decision 6 says `emitAuditEvent` is called "alongside" but doesn't give its fields. I recommend the log event carry `actorUserId`, `actorGlobalRole`, `actorIp`, `teamId`, and `topicCount`, with the ID arrays kept in the durable DB row only. The arrays aren't sensitive, but 400 UUIDs per line is log-pipeline weight with no alerting value. Either is acceptable. State it so the implementer isn't guessing.
- The `200` body carries topic names and (per F1) session metadata. Set `Cache-Control: no-store` on every response from this handler, matching `GET /topics/all`'s `noStore`. The existing topic *write* handlers don't do this, and I'd rather reorder didn't copy that gap.

### F7 (Note, inherited): timing floor

- `applyTimingFloor` on every exit is correct and consistent. Here it guards no new oracle, because the only pre-authorization distinction is `403` vs. the rest, same as TOPIC-003/004/005. However, reorder at the 200 cap is plausibly the slowest topic write. **Include it in the Group 6 p95/p99 measurement** that `timing-oracle.ts` still blocks production on. A floor measured without it may sit below reorder's success latency, which would make success slower than the error paths.
- The `catch → ROLLBACK → throw` path, which Decision 3's row-count assertion now deliberately uses, skips the floor. This is inherited from every topic write. Its cause is not attacker-selectable beyond F2, which the F2 fix closes. Noted only.

---

## Deferred or implicit security decisions (for the record)

| Decision | Status in design | My position |
|---|---|---|
| Who may learn `openSessionCreatedAt` (esp. `application_admin`) | **Implicit** | Must be made explicit (F1) |
| UUID case canonicalization | **Implicit** | Must be specified (F2) |
| Stale-body contents / in-memory set compare | Partly explicit (same message) | Implementation condition (F3) |
| No audit on 403/404/422/STALE/no-op | Explicit, matches TOPIC-003/004/005 convention | Accepted |
| No rate limit / timeout | Explicit, inherited | Accepted for this change; follow-up issue requested (F5) |
| `emitAuditEvent` field set, `Cache-Control` | Implicit | Specify (F6) |
| Floor measurement coverage, 500 path skips floor | Inherited | Noted (F7) |

## Summary for the team

The design reuses the right authorization helper, keeps the lock uniform, double-scopes every write to the path's team, and uses one stale code that leaks nothing the caller couldn't already read. The audit row is IDs-only and written in the same transaction. Two things must be written down before implementation. First, `openSessionCreatedAt` quietly gives admins and org-wide facilitators a session-metadata read, silently when the save is a no-op. That is small data, but it crosses a boundary the codebase otherwise denies and audits, so someone has to decide it on purpose. Second, UUID entries must be lowercased before dedupe and comparison, or mixed-case input reaches a `500`. The rest are implementation notes and one inherited rate-limit gap that deserves its own issue.
