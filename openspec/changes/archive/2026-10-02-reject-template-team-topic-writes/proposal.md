# Proposal: reject-template-team-topic-writes (#188)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md`, revised after the
Facilitator (`explore-review-facilitator.md`) and BA (`explore-review-ba.md`) explore reviews, and
again after the BA (`propose-review-ba.md`) and Executive (`propose-review-exec.md`) proposal
reviews. See "Review disposition" at the end.*

## Why

The `__default_topics__` template team (`00000000-0000-0000-0000-000000000001`) holds the
canonical default topic set. BRD §6.4 calls that set "the shared language of the ritual", and
FR-8.1/FR-8.6 require it to ship with the app, apply to every new team, and stay visible and
restorable. Right now the template is protected from the team-scoped topic-write endpoints
(TOPIC-003 to TOPIC-007) only because the customization lock happens to apply to it, since it has
no completed session. That protection depends on a side condition. It isn't a rule.

One completed session on the sentinel removes it, and the exploration found a realistic path to
that state with no API knowledge needed: the template team appears in every facilitator's
Session Creation picker (code-verified), and nothing stops a dry run from reaching `complete`
(partly verified). After that:

- **Team creation breaks for everyone.** If someone archives a template default and then reorders,
  two active rows can share a `display_order`. The team-creation copy ignores `status`, so it trips
  the `topics_team_active_order` partial unique index, and every `POST /api/v1/teams` returns
  `500` until someone repairs the data by hand (code-verified, not reproduced). A facilitator would
  hit this in front of a brand-new team.
- **The baseline drifts silently.** If someone reorders or restores on the template, every team
  created afterwards starts from a different canonical order. Nothing on screen shows it, and
  results stop being comparable across teams. §6.4 exists to prevent this kind of drift.

The fix has to be structural. A guard that holds only while the template has no completed session
would leave the canonical set unprotected in exactly the case above.

## What Changes

- Every team-scoped endpoint that writes a `topics` row for a `:teamId` (today TOPIC-003 add,
  TOPIC-004 archive, TOPIC-005 restore, TOPIC-006 reorder, TOPIC-007 annotate, plus any later
  endpoint of that kind) SHALL reject the template team.
- **404 parity is per endpoint.** The rejection is the response *that same endpoint* already sends
  for a canonical-format `teamId` that matches no team: same status (`404`), same body field for
  field except `correlationId` (`not_found` / `TEAM_NOT_FOUND` / `"Team not found."`), the same
  set of response headers with the same values (apart from `date`), and the same timing floor.
  The guard adds no header of its own. TOPIC-006 and TOPIC-007 already send
  `Cache-Control: no-store` on every response, so both paths carry it there. TOPIC-003/004/005 do
  not set it on their missing-team `404`, so the template `404` does not either. Adding `no-store`
  to those three endpoints is out of scope, and if it is ever done it has to be done for both paths.
- The guard runs **after** authorization and team existence and **before** the customization lock.
  Unauthorized callers still get `403`, an administrator calling TOPIC-007 still gets `403`
  (FR-8.7), and the lock is never consulted for the template.
- The guard does not depend on session history or on membership rows for the sentinel. It holds
  whether or not the template has a completed session.
- Each rejected write records one `topic.write_denied_template` audit row before the response is
  sent. The row is for incident review only. Facilitators don't see it, and it raises no alert.
  **No dashboards or alerts are built on it under this change.**
- **The audit write can't change the response.** If the insert fails, the handler catches the
  error, logs it at error level (with no request body), and still sends the same `404`. It does not
  return `500`. This is a deliberate difference from the lock path, where an audit failure
  propagates as `500`. That path is left as it is. Losing one incident-review row costs less than a
  response that marks the template as special. Latency: the insert runs inside the 150 ms timing
  floor. If the database is slow enough to push the insert past the floor, the template path can
  respond later than the missing-team path. That is an accepted residual. It needs a degraded
  database, and the sentinel id is already public (it is in the seed data and in every
  facilitator's picker), so no stronger timing guarantee is claimed or tested.
- The FR-8.1 boundary is written into the spec. The team-scoped endpoints are not the
  Application Administrator maintenance path that FR-8.1 describes. If that path is built, it will
  be a separate endpoint (F5), and this guard SHALL NOT be relaxed to serve it. The structural route
  test is what enforces that in practice. A rationale under FR-8.1 in `requirements/BRD.md` says
  plainly that FR-8.1's "maintainable by an Application Administrator" clause is **not yet met**
  through the UI. Until F5 exists, defaults are maintained by migration only.
- A structural test enumerates the registered routes from the Fastify instance. Any
  `POST`/`PUT`/`PATCH`/`DELETE` route under `/api/v1/teams/:teamId/topics` that skips the guard
  fails CI. The test detects routes **by path prefix**. A `topics`-writing route outside that prefix
  (for example a bulk reset under another path) is still in scope for the rule, but the author of
  that route has to add it to the test's explicit extra list in the same PR. Code review of the PR
  enforces that. There is **no exemption list**. Exempting a route requires a spec change.
- Read endpoints (TOPIC-001, TOPIC-002, `GET /api/v1/teams/:teamId/topics/all`) are **unchanged**
  and keep serving the template. FR-8.6 requires this.
- Behaviour change for existing callers: a write to the template that used to return
  `409 TOPIC_CUSTOMIZATION_LOCKED` now returns `404 TEAM_NOT_FOUND`. No legitimate client depends
  on the old response, so this is not marked **BREAKING**. On Topic Management, the screen shows
  the server message "Team not found." inline on the add form or the annotation editor, on a page
  that loaded normally. That is confusing, but it can only be reached on the template, and F1
  removes the way in.

## Constraints that must be preserved

- **FR-8.6:** the template's defaults stay readable and restorable for every team. Only writes to
  the template itself are rejected. The guard is keyed on the team id, not on `is_default`. Default
  topics on real teams can still be archived and restored as before.
- **FR-8.7:** administrators remain excluded from annotation (`403` before the guard).
- **Anti-enumeration:** the rejection must not tell a caller that this team is special. It sends
  the same status, body, headers and timing floor that the same endpoint sends for a missing team.
  Two differences are **accepted on purpose**:
  1. A facilitator who has an active membership row on the sentinel gets
     `403 FACILITATOR_IS_TEAM_MEMBER`, which a missing team can never produce. Nobody holds sentinel
     memberships today, and authorization has to run first.
  2. Latency beyond the timing floor when the audit insert is slow (see What Changes).
- **Lock semantics for real teams:** behaviour for every non-template team is unchanged, including
  the check order and the `topic.write_denied_locked` audit.
- **Team-creation copy:** `POST /api/v1/teams` still copies the template exactly as before.

## Capabilities

### New Capabilities

None. The owning rule extends `default-topic-provisioning`, which already owns the template. It is
deliberately **not** placed under `topic-customization-lock`, because filing it there would recreate
the coupling to the lock that this change exists to remove.

### Modified Capabilities

- `default-topic-provisioning`: ADDED requirement saying the template team is never written through
  team-scoped topic-write endpoints. It covers scope, per-endpoint 404 parity, audit-failure
  behaviour, independence from session history and membership, the denial audit, structural
  coverage, and the FR-8.1 boundary.
- `add-custom-topic`: canonical check order gains step "template team → 404" between team existence
  and the lock.
- `remove-topic`: same check-order insertion.
- `restore-topic`: same check-order insertion.
- `reorder-topics`: same check-order insertion. The audit requirement ("no audit row for a 404") is
  amended to allow the template-denial row.
- `topic-annotation`: same check-order insertion (after the admin `403`).

The requirement headings in the four MODIFIED check-order requirements are kept word for word
(for example "identity/role, team existence, lock, …"), even though step 2a is now in the order.
This is deliberate, because MODIFIED deltas match on the heading. Don't rename them in this change.

## Non-goals and follow-ups

These are not part of #188. Devon has drafted them, and a human will file them (see
`exploration-notes.md` §7 and "Pre-merge human actions" below). They will be linked here by issue
number once they exist.

- **F1 (file before merge, high priority, scheduled right after #188 in the Topic Management
  milestone): the template team is not a real team.** Reject session lifecycle entry points
  (`POST /teams/:teamId/sessions/draft` onward) for the sentinel, exclude it from
  `GET /teams/eligible-for-session`, carry the structural route test pattern over to session routes,
  and report the sentinel as permanently locked on Topic Management. This closes the realistic
  trigger path and the "editor with failing controls" state, which #188 deliberately leaves alone.
  F2 is folded into F1. Issue: #214.
- **F2: other team-scoped writes against the sentinel** (join links, managers, member role
  changes). Folded into F1. The security design review found a membership-creation chain here
  (`POST /api/v1/teams/:teamId/managers` → `POST /api/teams/:teamId/join-links` →
  `GET /api/join/:token`), so F1 must name these routes and
  `PATCH /api/v1/teams/:teamId/members/:userId/role`, carry the structural-test pattern over to
  them, and be tagged for security review (see `design.md` Open Questions). #188 does not change
  them.
- **F3: harden the team-creation copy** to filter `status = 'active'`, and make
  `defaultTopicsNotActive` in `content.ts` filter `dt.status`. Defence in depth for data changed by
  migration or by hand. Can wait. Issue: #215.
- **F4 (conditional, blocking if triggered): template data remediation**, only if the environment
  data check finds drift. This change does not fix data.
- **F5: Application Administrator maintenance path for the default set** (FR-8.1 HARD). A dedicated
  endpoint with its own authorization and audit, never a relaxation of this guard. Link an existing
  issue if there is one, or file a new one. Issue: #216 (no existing issue covered it).

## Impact

- **Code:** `packages/backend/src/routes/topics.ts`, the five write handlers and their shared
  existence check (see design.md). It imports `DEFAULT_TOPICS_TEAM_ID` from
  `packages/backend/src/sessions/default-topics.ts`. No new copy of the literal is added.
  `packages/backend/src/app.ts` gets a behaviour-neutral `registerRoutes(app)` extraction so the
  structural test can enumerate routes.
- **Tests (trimmed after review, see tasks.md §2 to §4):** the structural route test; unit cases
  for check order and audit failure; one table-driven integration suite covering per-endpoint parity
  with the missing-team `404` in both lock states, the `403`s, membership, the audit row, and a
  real-team archive/restore regression; one end-to-end team-creation regression against a
  pre-attempt snapshot. `topics-integration.test.ts` test "5.6" changes from expecting `409` to
  expecting `404`. Full-column snapshots, parallel-test race analysis, and odd-id-format tests are
  dropped (see Review disposition).
- **Audit:** one new operation name, `topic.write_denied_template`. No schema migration is needed
  because `audit_log.operation` is free text.
- **Docs:** a rationale under FR-8.1 in `requirements/BRD.md`.
- **No** frontend, migration, or API-shape changes for non-template teams.

## Pre-merge human actions

These are **merge gates**. The implementer does not perform them. The Engineering Manager named on
the PR is responsible for getting them done before approving the merge.

1. ✅ **Done 2026-10-02:** F1 → #214, F3 → #215, F5 → #216, all in the 03 - Topic Management milestone. **File F1 and F5** (and F3), and link their issue numbers above and in `design.md` Open Questions
   (tasks.md 6.3). F1 must be high priority and sequenced right after #188.
2. **Name an owner for the environment data check** and record the name here before the check runs.
   "Human operator" does not count as an owner.
   - *Data check owner:* **not yet named**.
3. **Run the environment data check** (tasks.md 6.1) in dev, staging and prod. It is read-only. It
   passes only if **all** of the following hold in that environment:
   - zero `sessions` rows with `team_id = DEFAULT_TOPICS_TEAM_ID` and `status = 'complete'` (also
     record the count in any status, including `draft`);
   - every sentinel `topics` row has `is_default = true`, `status = 'active'`, and no annotation;
   - the sentinel's `(name, prompt, vote_type, display_order)` equals the seed
     (`4_seed_data.sql` + `11_default_topics_correction.sql`), row for row;
   - no two active sentinel rows share a `display_order`;
   - zero `team_memberships` rows with `team_id = DEFAULT_TOPICS_TEAM_ID`, whatever `removed_at`
     is (security design review B1).

   If any check fails in any environment, F4 becomes **blocking** for this merge. If this change
   merged over existing drift, the drift would become permanent.
   - *Environment data check result:* **pending**. Record environment, date, operator and
     pass/fail for each environment.

## Review disposition

**BA review (`propose-review-ba.md`)**

| Item | Disposition | Rationale |
|---|---|---|
| B1 404 parity vs. `no-store` | **Accepted** | Parity is now per endpoint: the template response is the same endpoint's missing-team `404`, header for header (except `date`), body field for field (except `correlationId`). The literal `no-store` is gone from the template rule. It appears only where the endpoint already sends it. |
| B2 audit failure / latency | **Accepted, decided** | Catch, log, same `404`. This doesn't match the lock path's `500`, on purpose: the guard is what carries the weight, and the audit row is secondary. Latency beyond the floor is an accepted residual and is written down. One unit test covers the failure case. |
| S1 prefix vs. scope | **Accepted** | Prefix detection is stated. Routes outside the prefix go on an explicit extra list, owned by the route's author and enforced in code review. There is no exemption list. The rule for building requests is deterministic. |
| S2 audit contents | **Accepted** | Method-plus-path `endpoint`, the full `attempted_operation` mapping, metadata limited to those two keys, the event named, and audit clauses added to every per-endpoint scenario. |
| S3 membership scenario | **Accepted** | Replaced with three concrete cases. The `403 FACILITATOR_IS_TEAM_MEMBER` is recorded as an accepted difference. |
| S4 reads | **Accepted** | Concrete TOPIC-002 and `/topics/all` scenarios. The unlocked-template "editor with failing controls" state is recorded as a known gap handed to F1. |
| S5 FR-8.6 regression | **Accepted** | One real-team archive-then-restore case in the integration table. |
| S6 team-creation before-state | **Accepted** | Compared against a snapshot taken before the attempts. This replaces the old 4.9 and is now the only snapshot in the plan. |
| S7 FR-8.1 honesty | **Accepted** | BA wording adopted, and F5 added. |
| S8 data check gate | **Accepted** | Made a merge gate with pass criteria and a named owner (see Pre-merge human actions). |
| M1 headings | **Accepted** | Confirmed as deliberate (see Capabilities). |
| M2 two states in one scenario | **Modified** | Not split. Each per-endpoint scenario says "(tested in both lock states)", and the integration table covers both states. |
| M3 non-canonical ids | **Accepted** | The scenario now defers to the existing `rejectNonCanonicalTeamId` behaviour and its existing tests. No new test is added (see Exec 3). |
| M4 frontend on 404 | **Accepted** | One sentence in What Changes. |
| M5 "SHALL NOT be relaxed" | **Accepted** | Points to the structural test as what enforces it. |

**Executive review (`propose-review-exec.md`)**

| Item | Disposition | Rationale |
|---|---|---|
| 1 F1 filed and linked before merge, high priority | **Accepted as a human merge gate** | Recorded under Pre-merge human actions and in tasks.md 6.3. The agent does not file it. F2 is folded into F1. |
| 2 Named owner for the data check | **Accepted as a human merge gate** | An owner field is added, and the merge is blocked until it is filled in and every environment passes. |
| 3 Trim the test plan | **Accepted, reconciled with the BA** | Fewer tests, each sharper. Kept: the structural route test (mandatory), one table-driven parity suite in both lock states, the `403` cases, and the team-creation regression. Dropped: full-column snapshots and parallel-test race analysis (old 4.4 and 5.3), and odd-id-format tests (old 4.7, already covered by `rejectNonCanonicalTeamId`'s own tests). The BA's sharper conditions became assertions in the existing table rows, not new tests. Net: about 25 test items down to 10 (tasks 2.2, 3.1 to 3.2, 4.1 to 4.5, 5.1). |
| No dashboards or alerts on the audit row | **Accepted** | Stated in What Changes. |
| Anti-enumeration shouldn't drive extra test work | **Accepted** | Parity is checked once per endpoint inside the table, and timing is not measured. |

**Unresolved by me (needs a human):** whether an existing issue already covers F5. I couldn't
confirm one, so F5 is drafted as new.
