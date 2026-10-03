# Security Design Review: reject-template-team-topic-writes (#188)

*Reviewer: Tomás Ferreira (Senior Application Security Analyst). Scope: authentication flows,
data access boundaries, audit logging, threat model impact. Reviewed `design.md` and
`proposal.md`, and spot-checked `packages/backend/src/routes/topics.ts`, `routes/teams.ts`,
`routes/join-links.ts` and `sessions/default-topics.ts` against the design's claims.*

## Verdict

**Approve with conditions.** The design is sound where it matters most. The rule is enforced
server-side, keyed on an immutable identifier rather than on mutable state, placed after
authorization so the `403` semantics are preserved, and backed by a CI test that enumerates real
routes instead of trusting a hand-written list. That last part is the one I care about most: a
secure default that does not depend on someone remembering to call it. Two items need to be
resolved before merge (B1, B2). The rest are suggestions.

## What I verified

| Design claim | Result |
|---|---|
| All five handlers run `rejectNonCanonicalTeamId` → auth wrapper → `checkTeamExists` → lock gate | Confirmed (`topics.ts` l.750/767/773 and equivalents). |
| `checkTeamExists` is a bare `SELECT id FROM teams WHERE id = $1` with five callers | Confirmed (l.154). |
| `writeLockDenialAudit` propagates insert errors (→ 500) and emits a structured event after the insert | Confirmed (l.181–213). |
| `DEFAULT_TOPICS_TEAM_ID` is exported once, with no hex letters, so a `===` after canonical-id rejection cannot be bypassed by case or format | Confirmed (`default-topics.ts` l.11). I agree with the reasoning. |
| All five write routes share the literal prefix `/api/v1/teams/:teamId/topics` | Confirmed (l.743, 911, 1121, 1284, 1486). |
| A `preHandler` hook would run before authorization | Correct. Rejecting it was the right call. |

## Threat model impact

- **Asset:** the canonical default topic set (integrity), plus availability of `POST /api/v1/teams`.
  The proposal identifies a realistic path to a platform-wide `500` on team creation. That is an
  integrity-to-availability escalation that any standing facilitator can trigger, so this is a real
  security fix and not just tidying. It is right to treat it as one.
- **Actors:** standing facilitators and application administrators, both authenticated, neither
  holding a sentinel membership. That is the insider/compromised-credential case I always want
  modelled. The design blocks it on this surface.
- **Residual exposure:** the change narrows one surface (topic writes). The sentinel stays a
  "real" team on every other team-scoped surface until F1 ships. See B1.
- **Enumeration:** the sentinel id is public (seed data, picker), so 404 parity protects very little
  confidentiality. I accept that parity is cheap and consistent, and I do not want effort spent on
  timing guarantees beyond the existing floor. The two accepted differences are documented. Good.

## Blocking concerns

### B1. The deferred F2 surface contains a membership-creation chain. F1 must name it explicitly.

F2 ("join links, managers, member role changes") is marked *not yet verified* and folded into F1.
I looked. `POST /api/v1/teams/:teamId/managers` is gated only on `application_admin`
(`teams.ts` ~l.1072), and I saw no sentinel check. If an administrator establishes a manager on
the sentinel, a membership row now exists on the template team. That membership:

1. passes the membership check in `POST /api/teams/:teamId/join-links` (`join-links.ts` l.19), so
   arbitrary users can be invited into the template team;
2. turns accepted difference #1 (`403 FACILITATOR_IS_TEAM_MEMBER`) from theoretical into reachable;
3. makes the sentinel a team with members, sessions and possibly vote data, whose data-access
   boundary nobody has designed.

This does not invalidate #188's code. It does mean the *merge gate* "F1 is filed" is only
meaningful if the F1 issue has the right content. **Condition:** the F1 issue, filed before merge,
must list `POST /teams/:teamId/managers`, `PATCH /teams/:teamId/members/:userId/role` and
`POST /teams/:teamId/join-links` as in-scope surfaces, carry the structural-test pattern over to
them, and be tagged for security review. Add one line to the environment data check:
**zero `team_memberships` rows on the sentinel** (any `removed_at`). The design's assumption that
"nobody holds a membership on it" is currently asserted, not checked.

### B2. A swallowed audit failure must still leave a reconstructable, alertable trace.

I accept the decision to catch the insert failure and still send the `404`. The reasoning is
right: a template-only `500` would undo the parity property. But as written in D3, the fallback
log line carries `{ err, operation, teamId, endpoint }` and **skips `emitAuditEvent`**. On the one
occasion the database row is lost, the incident record also loses the actor, actor role, IP,
`attempted_operation` and correlation id. That is exactly the information an incident reviewer
needs. **Condition:**

- Call `emitAuditEvent` **regardless** of the insert outcome (log first, then insert), or include
  `actorUserId`, `actorGlobalRole`, `actorIp`, `attemptedOperation` and `correlationId` in the
  error log. The structured log is the fallback audit record, so it has to be complete.
- Do not log `err` raw if the driver error can echo bound parameters (pg `detail`/`parameters`).
  Log `err.code` and `err.message`. No request body. The design already says that, which is good.
- Give the error log a stable, greppable marker (e.g. `audit_write_failed: true`) so a future
  alert can be written without code changes. "No alerts under this change" is fine. "No way to
  alert later" is not.

## Suggestions (non-blocking)

**S1. The structural test should prove the guard fired, not just that a 404 came back.** A future
route that looks up `:topicId` before the team, or one that fails body validation with a 404-ish
path, could satisfy "404" for the wrong reason. Assert `code === "TEAM_NOT_FOUND"` (the design
implies this, so make it explicit) **and** that exactly one `topic.write_denied_template` row was
written for that request. The audit row is the only evidence specific to this guard.

**S2. Widen the prefix match to the parameter-name-agnostic form.** Matching the literal string
`/api/v1/teams/:teamId/topics` misses a future route spelled `/api/v1/teams/:id/topics/...`.
Match on `^/api/v1/teams/:[^/]+/topics(/|$)`. It is one line and closes a quiet bypass of the CI
gate.

**S3. The structural test's safety argument depends on the lock still existing.** "Without the
guard the response is 409 and nothing is written" holds only for routes that call the lock. A
future topic-write route that skips **both** the guard and the lock, and accepts `{}` as a valid
body, would write to the shared template during CI. Run the structural test against a
transaction that is rolled back, or an isolated schema, or restore a snapshot in `finally`, as the
team-creation regression already does.

**S4. Defence in depth at the data layer (record as an accepted residual, or file it with F3).**
The guard is application-layer only. Migrations, ad-hoc SQL, and any future non-`topics.ts` writer
(F2/F5) bypass it. A `BEFORE INSERT/UPDATE/DELETE` trigger on `topics` that rejects
`team_id = sentinel` unless a session-local setting such as `app.allow_template_write` is set would
make the invariant hold regardless of code path, and F5 would then have an explicit, auditable
opt-in. I am not asking for it in #188, but the design should say it was considered and deferred,
instead of leaving it implicit.

**S5. Audit-row volume.** Any facilitator can write unbounded `topic.write_denied_template` rows
by looping requests. The lock path has the same property, so this adds nothing new, but neither
design says whether the topic routes are rate-limited. The managers endpoint has an explicit
limit; the topic routes appear not to. Note it as a known residual, or point to the global limiter
if one exists.

**S6. The administrator path on 003–006.** Administrators pass authorization against the sentinel
and are then stopped by the guard. That is correct. Please make sure the integration table
includes an administrator row on 003–006 that asserts the audit row records
`actor_global_role = 'application_admin'`. Admin attempts against the template are the events
an incident reviewer most wants to separate from facilitator noise.

**S7. Rollback note.** "Rollback is a revert: the template goes back to relying on the lock alone"
is accurate. Add: *if any completed sentinel session exists at rollback time, the template is
immediately writable.* The person rolling back should run the data check first.

## Deferred or implicit security decisions (for the record)

| Decision | Where it lives | Status |
|---|---|---|
| Sentinel as a session team / picker exposure | F1 | Deferred, merge-gated on filing. See B1 for required content. |
| Membership creation on the sentinel (managers → join links) | F2 → F1 | **Implicit until B1 is applied.** |
| Data-layer enforcement of the template invariant | Not mentioned | Implicit. See S4. |
| Audit-failure observability | D3 | Decided, but under-specified. See B2. |
| Rate limiting on topic-write routes | Not mentioned | Implicit. See S5. |
| `Cache-Control: no-store` on TOPIC-003/004/005 | Proposal, out of scope | Deferred explicitly. Acceptable: the 404 bodies hold no sensitive data. |
| Timing beyond the 150 ms floor under a degraded DB | D3 | Accepted residual, explicitly. Agree. |
| Admin maintenance path for defaults (F5) | F5 | Deferred explicitly, with "never relax the guard". Agree. |

*— Tomás Ferreira*
