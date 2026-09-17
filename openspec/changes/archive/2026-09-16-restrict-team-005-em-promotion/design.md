## Context

Decision 1 (from `establish-manager-team-relationship`, archived) names TEAM-006 as the sole authorized actor for establishing a new Engineering Manager relationship on a team — a deliberate, Application-Admin-only, audited action. Decision 14 (same change) specifies that `evaluateTeamAccess` must perform an "independent, dual control" check: `membership_role = 'engineering_manager'` AND `global_role = 'engineering_manager'`, both read live from the database, neither sufficient alone.

Neither decision is currently honored in code:

- `evaluateTeamAccess` (`packages/backend/src/auth/team-content-access-helper.ts:124-141`) grants EM access from `team_memberships.role` alone. `global_role` (`actorGlobalRole`) is read into the returned object but never compared. The comment block immediately above this code (lines 130-132) asserts the dual-check is what happens — the documentation confidently describes behavior the code doesn't have, in the file whose entire job is to be the last word on access.
- TEAM-005 (`packages/backend/src/routes/teams.ts:380-386`) writes `team_memberships.role = 'engineering_manager'` for any existing team member, with an explicit comment stating that `global_role` is not checked "by design." Its authorization (`checkAssignRolesAuthorization`, `teams.ts:30-64`) is correctly team-scoped and gets the AND-logic right for a structurally identical question ("can this actor act as an EM on this team") — the pattern for the correct fix already exists twenty lines away in the same file.

Two independent doors reach the same lock (EM read access to a team), and the lock only checks one of the two keys the design says it should check. This proposal closes the write-side door that TEAM-005 was never supposed to be able to open, and fixes the lock itself so it checks both keys regardless of which door was used.

**Grounding:** `threat-model.md` (archived `establish-manager-team-relationship` change, Scenario 1 / finding 1.3), `threat-model-review-champion.md`, `threat-model-review-architect.md`, exploration-notes.md (this change), GitHub issue #109.

## Goals / Non-Goals

**Goals:**
- Make `evaluateTeamAccess` perform the dual-control check its own comment already claims it performs.
- Make TEAM-005 structurally incapable of originating a `participant → engineering_manager` transition, unconditionally — no flag, no config, no admin override, for any actor.
- Restore the audit trail's truthfulness: every EM relationship going forward traces to a `team.manager_established` record from TEAM-006.
- Preserve TEAM-005's legitimate function: demotion (`engineering_manager → participant`) continues to work exactly as today, for every currently-authorized actor.
- Correct the three passages in `requirements/use cases/01 - Identity and Access - Use Cases.md` that currently document the pre-fix behavior as accepted design (UC "Assign a Role to a Team Member" AC1 and its Out-of-Scope note; UC "Establish a Manager/Team Relationship" Dependencies/Notes).

**Non-Goals:**
- Re-litigating Decisions 5, 6, or 13 (vote secrecy, reveal mechanics, action-item attribution) — untouched by this change.
- Fixing issue #13's rate-limiting gate — a sibling Phase 2 blocker with an independent root cause, independent owner, independent files.
- Adding new EM capabilities, new admin UI, or new self-service flows — this is containment of an existing gap back to Decision 1's original shape, not new functionality.
- Building the EM/team-relationship removal endpoint (`remove-manager-team-relationship`, already tracked as a separate follow-on with its own owner).
- Resolving the open questions listed below — they are named here as decisions for the right specialist to make, not settled by this document.

## Decisions

### Decision A — Read-side fix: collapse `evaluateTeamAccess` onto the dual-control check the spec already requires

Remove Path 1's `membership_role = 'engineering_manager'` sub-case as an independent grant path. The only way `evaluateTeamAccess` returns `role: 'engineering_manager'` is the existing Path 2 condition: `global_role = 'engineering_manager'` AND an active `team_memberships` row with `role = 'engineering_manager'` for the requested team, both read live in the same query. This mirrors `checkAssignRolesAuthorization`'s existing AND-logic (`teams.ts:33-36`) rather than inventing a new pattern.

**Alternative considered:** Leave Path 1 and Path 2 as separate paths, both dual-checking independently. Rejected — it's the same check duplicated, and duplication is exactly how the original gap between "designed" and "implemented" opened in the first place. One path, one check, one place to get it right.

### Decision B — Write-side fix: TEAM-005 unconditionally rejects `participant → engineering_manager`, for every actor including Application Admin

The TEAM-005 handler inspects the transition being requested (`current membership_role`, `requested role`) before performing the update. If the transition is `participant → engineering_manager`, the request is rejected regardless of actor authorization, actor role, or target's `global_role`. Demotion (`engineering_manager → participant`) and no-op requests are unaffected and follow the existing code path unchanged.

The check is on the *transition*, not on identity: self-targeting, cross-team EM status on the target, and Application-Admin-vs-EM actor status are all irrelevant to whether the block fires. This includes Application Admin actors — **resolved (formerly Open Question 1)**, decision by Tomás Ferreira (Senior Application Security Analyst), design review 2026-09-16:

- Decision 1 (`establish-manager-team-relationship`) names TEAM-006 as "the sole authorized actor" for establishing a new EM relationship, not "the sole authorized actor when a non-admin is involved." An admin reaching the same effect through TEAM-005 exercises the same authority through a door that carries none of TEAM-006's audit trail, rate limiting, or deliberate-single-action framing.
- This is what makes Decision C's "no admin-configurable exception" claim true in substance rather than only in the narrow sense of "no config flag." A gap that lets admins reach the identical effect via a different code path is the same category of "true on paper, false in reachable behavior" problem this proposal exists to close.
- It is the only reading that makes the Goals section's audit claim ("every EM relationship going forward traces to a `team.manager_established` record") actually true, rather than true-except-for-admin-initiated-promotions.
- `requirements/design/REST API Contract.md:421` was checked against the current implementation as part of this review (Full Stack Engineer, design review 2026-09-16) and confirmed to be aspirational, not precedent: `checkAssignRolesAuthorization` (`teams.ts:325-359`) never inspected the requested role value at all, for either actor type, before this proposal. There is no shipped behavior on the admin side that blocking admins would be reversing — both the EM-only and EM-and-admin resolutions are equally new from the code's perspective, which removes the main reason to default to the narrower reading out of caution.
- No operational cost: admins already have TEAM-006, which is strictly more capable (it can onboard a user who isn't yet a team member; TEAM-005 can't, regardless of this fix). Blocking admins on TEAM-005 removes a second, worse-audited way to reach a capability they retain in full via TEAM-006.

Task 3.2 applies this unconditionally — no actor-role branch at all, which is also simpler to implement than an EM-only version would have been (no need to inspect `actorGlobalRole` in the new check). Task 4.4 is the "Application Admin attempts the same transition via TEAM-005 — rejected" variant.

**Implementation ordering (resolved, formerly implicit — flagged by Security review 2026-09-16):** this check must run strictly after the existing `checkAssignRolesAuthorization` 403 and after the no-op fast-path (`fromRole === newRole` returns success without reaching this check — a no-op `engineering_manager → engineering_manager` request is not a promotion and never reaches TEAM-006 either way), but before the transaction opens (`client.connect()` / `BEGIN` / the team-level row lock). Two reasons, both binding:
- An actor who isn't authorized to call TEAM-005 at all must get the existing generic 403, not a response that additionally confirms this specific transition is policy-blocked — avoiding a minor information-disclosure angle (revealing the promotion-block's existence and target to a caller with no standing to invoke the endpoint at all) at no cost, since the ordering is free to get right.
- A request this check is going to reject must never acquire the team-level lock or touch the transaction machinery — this is also why the check has no interaction with the zero-participant guard (§ Decision B note below).

This ordering places the check between the existing subject-membership lookup (`teams.ts:742-772`, which already produces `fromRole`) and the transaction block (`teams.ts:789` onward).

**Alternative considered:** Gate the block behind the existing authorization check (i.e., only block EM actors, let admins through, treating admin-initiated promotion via TEAM-005 as implicitly fine because the actor "has the authority anyway"). Rejected — see resolution above; this is exactly the kind of admin-override shape that this proposal's "no admin-configurable exception" principle exists to prevent.

### Decision C — No admin-configurable exception, structurally

No feature flag, environment variable, configuration value, or admin-only override may exist that permits TEAM-005 to originate a `participant → engineering_manager` transition, under any circumstance. If a legitimate operational need for a faster promotion path surfaces later (e.g., bulk onboarding), it is a new, explicitly reviewed capability with its own authorization story — not a relaxation of this restriction.

**Acceptance criterion (verification method: code review at implementation sign-off, not a runtime test):** No code path, flag, env var, or config value exists that permits TEAM-005 to complete a `participant → engineering_manager` transition. This is a "does this exist" check; it cannot be expressed as a passing/failing runtime test, and QA should not go looking for one.

### Decision D — Error response follows the existing redirective pattern

A blocked promotion attempt via TEAM-005 returns an error in the shape already established at `teams.ts:734-737` (wrong-team) and `:973-976` (admin-only): redirective, not punitive — it names the correct endpoint rather than leaving the actor at a dead end. A good-faith actor clicking the only button an unmigrated UI gave them should not be made to feel accused.

Exact HTTP status code and copy are Open Question 4 below — this decision fixes the *shape* (redirective, names TEAM-006, follows precedent) and defers the *wording*.

### Decision E — Mismatched-state handling: graceful degradation to `participant`, with a log-only signal

**Resolved (formerly Open Question 2)**, decision by Tomás Ferreira (Senior Application Security Analyst), design review 2026-09-16. When `evaluateTeamAccess`'s dual-control check finds `membership_role = 'engineering_manager'` but `global_role != 'engineering_manager'`, the function returns `role: 'participant'` — not `null`, not a 403.

Reasoning:

- The user holds an active `team_memberships` row for this team; they are a legitimate team member, just not correctly an EM. A hard 403 would lock a real team member out of a team's content entirely over a data-integrity anomaly in a column they don't control (`global_role` comes from the IdP claim, not from the membership row). That is an availability cost with no matching security benefit — degrading to `participant` denies exactly the delta this change exists to deny (the EM content profile) without manufacturing a new failure mode a facilitator has to explain to a confused, blocked colleague.
- This is not "failing open": the fail-safe direction is away from the elevated grant, not toward denying the baseline access the membership row already establishes.
- Precedent match: this is the same shape as the OIDC claim-rejection pattern (`account-resolver.ts`) — an invalid/inconsistent input degrades to the safe default (there, `DEFAULT_GLOBAL_ROLE`; here, `participant`) with a logged signal, rather than blocking the request outright. Reusing this shape keeps the codebase's two "untrusted-input degrades safely" patterns consistent with each other instead of introducing a third, different one.
- Once both Decision A and Decision B ship, this state is reachable only from stale pre-fix data or a future write path nobody has built yet (see Risks) — not from live exploitation. A state that only arises from data staleness should degrade gracefully with loud logging, not fail hard.

**The log signal is required, not optional.** Every occurrence of this branch firing emits a new structured log event, `team.access_grant_mismatch`, carrying `userId`, `teamId`, the mismatched `global_role` value, and `membership_role`. This does **not** get a synchronous `audit_log` DB row: `evaluateTeamAccess` runs on essentially every content request (Decision 6, no caching), so a user parked in this anomalous state would otherwise generate a DB write per page view. A structured log event alone is sufficient for detection/alerting — if this state is ever observed in production, it is an incident to investigate by hand, not a volume of events to page on. Document this volume reasoning in the code comment alongside Decision 6's no-cache note, the same way the rate-limiter code explains why `team.manager_association_rate_approaching` is log-only while `rate_limit_exceeded` gets a DB row (`audit-logger.ts:26-50`) — same reasoning, same place to look for it.

Task 2.3 implements the else-branch as `role: 'participant'` plus the `team.access_grant_mismatch` log event. Task 2.4's regression test asserts both halves: the returned grant is `role: 'participant'` (not `null`, not `'engineering_manager'`), and the log event fires.

### Decision F — A blocked promotion attempt produces a distinguishable audit event

**Resolved (formerly Open Question 3)**, decision by Tomás Ferreira (Senior Application Security Analyst), design review 2026-09-16. Required, not optional.

A fix that closes the access gap but leaves *attempts* against the closed door invisible to audit repeats, one level up, the exact blind spot that made the original bug severe: no corresponding audit event meant an incident responder searching `audit_log` for `team.manager_established` would never find the gap. A pattern of repeated blocked attempts against TEAM-005 for this specific transition is itself a legitimate detective signal — a credential probing for a gap that used to exist, or a still-unmigrated internal tool hammering the old endpoint.

This follows the existing precedent in this codebase for exactly this shape: `content.ts`'s `denyAdminContentAccess` (from `establish-manager-team-relationship`) writes a synchronous `audit_log` row *and* emits a structured event for a denied-access case, before the error response is sent, with `http_status` in the metadata. The blocked-promotion case follows that precedent exactly:

- A new `audit_log` operation, `team.role_change_denied`, written synchronously **before** the error response, carrying `actor_user_id`, `actor_global_role`, `actor_ip`, `target_user_id` (subject), `team_id`, and `metadata: { from_role: 'participant', to_role: 'engineering_manager', http_status: <Open Question 4's answer> }`.
- A corresponding `emitAuditEvent(request.log, "team.role_change_denied", ...)` call alongside the DB row, matching the `denyAdminContentAccess` pattern.
- **Scope of when this fires:** only for actors who pass `checkAssignRolesAuthorization` (i.e., are otherwise authorized to call TEAM-005 at all) and then hit the new transition block. An actor who isn't authorized to call TEAM-005 in the first place gets the existing, unrelated 403 — that is a different, already-handled case and does not get this new event. "Not allowed to touch this endpoint" and "allowed to touch it, but not for this transition" are different signals with different response urgency and must not be conflated in the audit trail.

Task 3.4 is unconditional (no longer contingent on a decision). The audit write belongs in the TEAM-005 handler at the point Decision B's check fires, before the redirective error response is sent — the same ordering guarantee `denyAdminContentAccess` already uses.

### Decision G — Database-layer defense-in-depth: a detection control, not a prevention control

**Resolved (formerly Open Question 5)**, decision by Ingrid Sollenberger (Solution Architect), design review 2026-09-16, informed by a blocking implementation finding from Marcus Oyelaran (Full Stack Engineer).

Open Question 5, as originally framed, asked whether the write-side restriction wants "a check constraint or trigger... following the precedent of `migrations/7_team_memberships_partial_constraint.sql`." That framing does not survive contact with the actual schema and does not ship as stated:

- **A CHECK constraint cannot express this.** Postgres check constraints validate a single row's columns in isolation; they have no access to the row's prior (`OLD`) value, so they cannot see a *transition*. Migration 7's partial unique index is precedent for adding a DB object via migration, not for solving a transition problem — it constrains set membership, not a state change.
- **A transition-based `BEFORE UPDATE` trigger would break TEAM-006's own legitimate write.** TEAM-006's upsert (`teams.ts:1156-1163`) is `INSERT ... ON CONFLICT (user_id, team_id) WHERE removed_at IS NULL DO UPDATE SET role = 'engineering_manager'`. The `ON CONFLICT` target matches any active membership row for that `(user_id, team_id)` pair, including an ordinary existing `participant` row — promoting an existing team member to EM for their own team via TEAM-006 performs the *identical* `participant → engineering_manager` row-level transition that this proposal blocks when TEAM-005 originates it. A trigger cannot distinguish "this UPDATE came from TEAM-006" from "this UPDATE came from TEAM-005" without additional plumbing (e.g., a `SET LOCAL` session variable set inside each handler's transaction and read via `current_setting()` in the trigger body).

Given that, the choice is between (a) accepting session-variable tagging as explicit, reviewed, added complexity so a prevention-shaped trigger can still be made safe, or (b) re-scoping the DB-layer control to something that doesn't require transition-awareness. This design adopts **(b): a detection control, not a prevention control.**

Rationale: the application-layer check (Decision B) is the correct, sufficient prevention control for the transition itself — it sits in the one place (the TEAM-005 handler) that knows both the transition and its origin without needing to invent a cross-cutting signal for "which code path is this." Session-variable tagging solves a problem that only exists because a trigger is the wrong tool for a transition-aware check; introducing it here would be defense-in-depth purchased by adding a new, easy-to-forget-to-set, easy-to-silently-break coupling between every write path that touches `team_memberships` and a shared trigger's assumptions about session state. That is exactly the kind of premature, incidental complexity this project's architecture practice avoids when a simpler control covers the same risk — and a detection control covers a *different*, still-valuable part of the risk (a future write path nobody has built yet, or a bug in Decision B itself) without that coupling.

The detection control: a scheduled or on-demand query that flags any `team_memberships` row with `role = 'engineering_manager'` and no corresponding `team.manager_established` `audit_log` entry for that `(user_id, team_id)` pair. This is the same query shape Open Question 6's backfill audit already needs — the two are not separate work, and whoever implements the Open Question 6 backfill should build this as a reusable, re-runnable query (not a one-off) so it also serves as ongoing detection. This decision does not resolve Open Question 6 itself (timing, ownership, and whether it runs on a schedule remain open there) — it only settles that when Question 6's query is built, it doubles as the DB-layer defense-in-depth this question asked about, in preference to a trigger.

No new migration is required for Decision G itself. If a future review wants prevention-strength defense-in-depth at the DB layer, session-variable tagging is the concrete mechanism to evaluate then, as an explicit, separately-reviewed addition — not a default assumed here.

### Decision H — Backfill/detection query: owner and timeline

**Resolved (formerly Open Question 6)**, decision by Ingrid Sollenberger (Solution Architect), 2026-09-16.

The query itself was already specified under Decision G: flag any `team_memberships` row with `role = 'engineering_manager'` and no corresponding `team.manager_established` `audit_log` entry for that `(user_id, team_id)` pair. What remained undecided was who runs it against production data and by when — a real organizational assignment, not something resolvable by writing more design text, and not something I can execute myself (I do not have production database access in this capacity).

Decision:

- **Owner:** the on-call Production Data Engineer — the rotation holding production database read access for this organization. No dedicated DBA/data-platform persona exists among this project's named roles, so this is named generically by function rather than by person, consistent with how design.md's own Open Question 6 already deferred to "whoever owns production data access."
- **Timeline:** run within the current sprint, no later than **2026-09-23** (one week from this decision). This makes concrete the Executive Stakeholder's explicit same-sprint ask (`propose-review-exec.md`: "I'd like this closed out within the same sprint as the fix, not parked indefinitely as a someday-item") and Tomás Ferreira's concurrence (`design-review-security.md`, Q6: "'no action needed' is not a safe default answer without someone actually running the query").
- **Deliverable:** a short written result — "checked, nothing found" or "checked, N found, here's who was notified" — matching exactly the shape the Executive Stakeholder asked for, not a remediation program. Record the result against this change (as an addendum here, or a linked follow-up record if archiving happens first).
- **If phantom relationships are found:** remediation (revoking the erroneous `team_memberships` row, notifying affected teams) is incident response, handled outside this change's scope. This decision closes the "was the query run and what did it find" gap only, per the Executive Stakeholder's ask — it does not pre-commit to a remediation process for a population that may not exist.

Task 1.6 is resolved by this decision record. Task 6.4 (Solution Architect confirms 1.6/1.7/1.8 were acted on) is satisfied for 1.6 by the owner/timeline assignment above — final closure still requires the named owner's actual result, due 2026-09-23.

### Decision I — Historical audit-log mislabeling: correct going forward only; annotate historical rows, don't rewrite them

**Resolved (formerly Open Question 7)**, decision by Ingrid Sollenberger (Solution Architect), 2026-09-16.

**Decision: do not retroactively rewrite historical `team.role_changed` rows that actually represented EM-establishment events. Going forward, this is already fully corrected by this change's own fixes** — Decision A closes the read-side gap, Decision B closes the write-side gap, and every EM relationship created from this point forward can only originate via TEAM-006's `team.manager_established` event. For the historical record, add a dated, additive annotation identifying the affected rows, without altering the rows themselves.

Reasoning:

- `audit_log` is append-only by design in this codebase — no code path updates or deletes existing rows. An audit trail whose own history can be silently rewritten is a strictly weaker control than one that can't be: an incident responder needs to trust that a `team.role_changed` row from six months ago is what was actually written then, not what someone later decided it should have said. Rewriting audit history to fix a labeling bug replaces one integrity problem with a worse one.
- Tomás Ferreira's security review reached the same conclusion independently (`design-review-security.md`, Q7): "if past `team.role_changed` rows are reclassified in place, that itself needs to be an audited action (you'd be rewriting the audit trail, which needs its own audit trail)... A dated addendum/backfill marker... preserves the original record's integrity while making the correction discoverable." I adopt his recommended shape directly.
- This weighs against, but does not dismiss, the Facilitator's original concern (`exploration-notes.md:211`, `explore-review-facilitator.md:28`) that an investigator searching `audit_log` for `team.manager_established` won't find these historical events. An additive annotation resolves that concern directly: the annotation *is* discoverable by exactly that search pattern once it exists, without compromising the original rows.

**Mechanism:** extend task 1.6's detection query (Decision H) with a companion query joining `team.role_changed` rows where `metadata->>'from_role' = 'participant'` and `metadata->>'to_role' = 'engineering_manager'`, predating this change's ship date — these are the specific historically-mislabeled rows. For each one found, insert one new, forward-dated `audit_log` row under a new operation name (`team.manager_established_retroactive_annotation`), referencing the original row's id and timestamp in its metadata, stating plainly that the referenced historical `team.role_changed` event is now understood to represent an EM-establishment event predating this change's fix. The original row is never modified. A future search for `team.manager_established` will not find the original event, but will find its annotation, which points back to it.

**Owner and timeline:** same as Decision H — the on-call Production Data Engineer, by **2026-09-23**, executed in the same investigative pass as the Decision H query (a second predicate on the same query session, not separate work).

Task 1.7 is resolved by this decision record — the "does this get corrected retroactively" question is answered (no, not by rewriting; yes, by annotation), the owner is assigned, and the reasoning weighs the append-only-integrity concern against the Facilitator's discoverability concern explicitly, per the earlier open item's ask.

## Risks / Trade-offs

- **[Risk]** Any caller (internal tooling, a not-yet-updated frontend flow, a script) currently relying on TEAM-005 to promote a team member to EM breaks after this ships — this is the explicit **BREAKING** change named in proposal.md. → **Mitigation:** the redirective error response (Decision D) names the replacement endpoint; the requirements-doc correction (Goals) ensures the next engineer reading AC1 sees the real contract, not the old one. No migration window is proposed — the security property is not something to phase in gradually, per Decision C's "structural, not preferential" framing carried from exploration.
- **[Risk]** Collapsing Path 1 and Path 2 in `evaluateTeamAccess` (Decision A) touches the single most-called authorization function in the codebase. A mistake here is a wider blast radius than the TEAM-005 write-side fix alone. → **Mitigation:** the two regression tests named in proposal.md/tasks.md (mismatched-state pin, independent of TEAM-005) exist specifically so a future edit to this function's comment block — the exact failure mode that produced this bug — cannot silently reintroduce it without failing a test unrelated to TEAM-005.
- **[Risk]** The mismatched state (`membership_role = 'engineering_manager'`, `global_role != 'engineering_manager'`) becomes unreachable through normal operation once both fixes ship, but the AND-check's "else" branch for that state is still live code, guarding against a future write path (migration, bulk-admin tool) that doesn't exist yet. Undertested backstops for hypothetical future paths tend to bit-rot silently. → **Mitigation:** Decision E resolves the else-branch's behavior explicitly (graceful degrade to `participant` plus a log-only signal), with a specific precedent (OIDC claim rejection's "degrade gracefully but log" pattern, the rate-limiter's early-warning-event pattern) rather than leaving it as an unexamined default.
- **[Trade-off]** This change does not attempt to discover or remediate any EM relationships that may already have been established via the TEAM-005 gap in production before this fix ships (Open Question 6). Shipping the fix without that audit closes the forward-looking gap but leaves any pre-existing phantom relationship in place undetected. Decision G's detection-control query is designed to double as this backfill's query once Question 6 is scheduled.
- **[Risk]** The zero-Engineers warning (UC "Assign a Role to a Team Member" AC4, `teams.ts:832-838`) is implemented only in TEAM-005's transaction block, gated on a `participant → engineering_manager` promotion dropping the participant count to zero. Once Decision B ships, TEAM-005 can no longer originate that transition, so this warning becomes unreachable through TEAM-005 — and TEAM-006 (`teams.ts:940` onward, the sole remaining promotion path) has no equivalent guard. The net effect is that after this change ships, **no code path warns an actor that a promotion would leave a team with zero Engineers.** This proposal does not add that guard to TEAM-006 — see Non-Goals ("no new EM capabilities") — but the loss is real and user-facing, and is named here on purpose rather than discovered later as a silent gap (BA task review, 2026-09-16). → **Mitigation:** task 5.1 rewrites AC4 and its related UC passages to state plainly that this warning no longer fires; Open Question 8 below routes the "should TEAM-006 get an equivalent warning" scope call to its proper owner instead of deciding it here.

## Open Questions

Carried forward from exploration-notes.md §4, §5, and §9. Original numbering is preserved for traceability with tasks.md even though some are now resolved.

1. ~~Does the write-side block (Decision B) extend to Application-Admin actors calling TEAM-005, or only to EM actors?~~ **RESOLVED — see Decision B.** Blocked for all actors, including Application Admin.

2. ~~How should the read-side AND-check's "else" branch (the mismatched state) behave?~~ **RESOLVED — see Decision E.** Graceful degradation to `role: 'participant'`, with a log-only `team.access_grant_mismatch` signal.

3. ~~Does a blocked promotion *attempt* itself produce a distinguishable audit event?~~ **RESOLVED — see Decision F.** Yes, required: synchronous `audit_log` row (`team.role_change_denied`) plus `emitAuditEvent`, for actors who pass the base TEAM-005 authorization check.

4. **Exact HTTP status code and error copy for the blocked-promotion response** (Decision D fixes the shape; the wording is open). Something in the shape of "Only an Application Admin can establish a new Engineering Manager relationship for this team — use Establish Manager Relationship," per the existing precedent at `teams.ts:734-737` and `:973-976`. **The Facilitator has asked to review the actual copy before it ships**, the same way she reviews outlier-flagging copy.

5. ~~Does the write-side restriction (Decision B) want a defense-in-depth expression at the database layer (a check constraint or trigger)?~~ **RESOLVED — see Decision G.** A check constraint cannot express a transition, and a transition-aware trigger would break TEAM-006's own legitimate upsert without added session-variable plumbing; this design instead adopts a detection control (flag EM rows with no matching `team.manager_established` audit entry), sharing its query with Open Question 6's backfill work.

6. ~~Is there a known population of pre-existing phantom EM relationships in production that resulted from the TEAM-005 gap before this fix ships, warranting a remediation or backfill audit query?~~ **RESOLVED — see Decision H.** Query already specified (Decision G); owner (on-call Production Data Engineer) and timeline (by 2026-09-23, this sprint) now assigned.

7. ~~Does the historical audit-log mislabeling (`team.role_changed` instead of `team.manager_established` for past TEAM-005-originated promotions) get corrected retroactively, or only going forward from this fix?~~ **RESOLVED — see Decision I.** Not retroactively rewritten (audit_log is append-only); corrected going forward automatically by this change's own fixes, plus a dated additive annotation for historical rows, run by the same owner and timeline as Decision H.

8. ~~Should TEAM-006 gain an equivalent zero-Engineers warning, now that it is the sole remaining promotion path?~~ **RESOLVED (Ingrid Sollenberger, Solution Architect, sync-verify pass 2026-09-16) — see `sync-verify-architect.md` §2.** No, not in this change: a proactive warning is new user-facing scope (its own copy, confirmation flow, test matrix) that Non-Goals correctly excludes from a security-hardening change. Deferred to a separate, explicitly-scoped follow-on proposal. The UC doc (task 5.1) states plainly that this warning no longer fires anywhere; no new guard is added to TEAM-006.

Only Question 4 remains open, routed to its named owner (Facilitator, task 1.4) and not a reason to delay implementation or archival of the core fix. Questions 1, 2, 3, and 5 are resolved into Decisions B, E, F, and G; Questions 6, 7, and 8 are resolved into Decisions H and I above and `sync-verify-architect.md` §2, respectively.
