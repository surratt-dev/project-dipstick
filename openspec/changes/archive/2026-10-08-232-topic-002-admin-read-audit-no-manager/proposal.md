# Proposal: 232-topic-002-admin-read-audit-no-manager (#232)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md`, which was revised after Priya Nair's `explore-review-facilitator.md` and Marcus Delgado's `explore-review-ba.md`. This is Follow-up 7 from the archived change `2026-10-03-topic-001-authz-contract-reconcile` (#187), raised as security design review item B2 by Tomás Ferreira.*

## Why

"Our team's definition" (`team_annotation`) is where engineers describe, in their own words, what a topic means for their team. In #187 we said the no-manager rule covers that place as well as the vote. If an engineer suspects their manager reads it, they will write it for their manager, and then the definition is worthless. **This is a candour problem first and an access-control gap second.** I want the proposal read that way, because the access-control framing makes "just strip the annotation fields" look like an equivalent fix. It is not one.

TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`) serves those definitions to the Topic Management screen. It has two gaps that the TOPIC-001 fix did not close:

- **(a) Admin reads leave no record.** TOPIC-002 admits `application_admin` and writes no `audit_log` row and emits no event. The `team-content-access` spec says every admin read of administrative data SHALL be logged, and the spec itself already admits TOPIC-002 doesn't comply (it points at #187 Follow-up 7).
- **(b) The manager gets in through the admin arm.** `checkStandingFacilitatorOrAdminAuthorization` returns `authorized` for `application_admin` *before* it looks at membership, and it never looks at the membership role. So an admin who is also the team's engineering manager (an active `engineering_manager` membership) reads the team's definitions. For the same caller and team, TOPIC-001 says `403` and TOPIC-002 says `200`.

Every other manager shape is already denied, because TOPIC-002 admits only the `facilitator` and `application_admin` global roles. The admin arm is the only way a manager reaches the annotations. The dual-hat person is real: BRD FR-2.4's rationale (#243, D11) already resolved the manager-plus-admin conflict **against the admin capability**, so that a manager can't route around the no-manager rule. #232 is the same conflict on a different screen, and I want it resolved the same way.

The release-note line #187 promised ("engineering managers cannot read the team's definitions") is **not true until this ships**.

## What Changes

- **TOPIC-002 denies an admin who manages the team (gap b).** On the admin arm, TOPIC-002 reads the caller's live active membership role on the target team and admits only when it is absent or `participant`. This is an allow-list. `engineering_manager` gets `403` (reason `ADMIN_IS_TEAM_MANAGER`), and any future role value gets `403` (reason `ADMIN_MEMBERSHIP_NOT_ADMITTED`; unreachable against today's enum, unit-tested only). Reason names are internal labels; the observable difference is the envelope's `error.message`, which every scenario asserts. A removed membership is no membership, so an admin whose EM membership was removed is admitted. The **whole response** is denied, not just the annotation fields. No topic, annotation, lock-state or team-name query runs for a denied request. The rule is unconditional, with no flag, environment switch or override.
- **Every admin read of TOPIC-002 is audited (gap a).** Every `200` to an `application_admin` writes exactly one durable `audit_log` row, `admin.topic_config_accessed`, plus the matching structured event. The row is written after the data is read and before the timing floor and the response. **Fail closed:** if the membership-role read, the role-set read (including a missing `users` row) or either audit insert fails, the request is `500` with no topic, annotation, team-name or lock-state data, and a failed denial insert never becomes a `200`. This fail-closed rule is scoped to this admin-only endpoint and is not a pattern for facilitator or live-session paths. The row records the caller's stored role set in the existing `audit_log.actor_roles` column (migration 22). The metadata holds counts only (`active_count`, `archived_count`, `annotated_count`), `team_found`, the caller's `membership_role`, and `actor_idp_roles_include_em` (derived from the same role-set read, as a filter convenience). Neither the row nor the structured event, whose key set is pinned, ever holds annotation text, topic names or topic ids. A failed audit write also emits a log-only `admin.audit_write_failed` signal (database error code only) so the gap is queryable. This fires on every admin read, including empty teams, the template team, and a canonical UUID that names no team (which keeps its existing `200`-with-empty-lists behaviour and is audited with all counts `0`). A role set without `engineering_manager` does not prove the caller holds no manager role: backfilled users who haven't signed in since #245 record `{application_admin}` and `false`.
- **The new denial is audited too.** The new `403` writes a durable `admin.topic_config_denied` row plus event, with `reason: "membership_em" | "membership_unrecognised"`.
- **Audit visibility guard.** Neither new operation is ever exposed through an endpoint or screen available to team members or engineering managers. A "who read your team's config" view for managers would turn a compensating control into surveillance in the other direction. To make the guard checkable, every `audit_log` query serving a non-admin caller must filter `operation` by equality on one named operation; a PR-time case-insensitive sweep for `audit_log`, with every hit classified in the PR description, confirms it.
- **The screen explains the rule.** On a `403`, `TopicManagementPage` shows the server's `error.message` when the envelope carries one, and falls back to today's generic string otherwise. The dual-hat admin sees "Topic configuration for this team isn't available to its engineering manager." and not a bare "no access" that reads as a bug. The "Topics" link on the team page stays visible, because the server is the only gate.
- **Spec wording for admin-read audits is corrected.** "The audit write MUST execute in the same database transaction as the data access operation" is replaced with what a read actually needs: written after the read, before the send, fail closed. The audit field list is corrected to the real columns. The existing `admin.membership_list_accessed` and `admin.team_detail_accessed` already meet the new wording, so no code outside TOPIC-002 changes.
- **Regression pins.** A global `engineering_manager` gets `403 NOT_A_FACILITATOR` from TOPIC-002 whatever their membership (none, `participant`, `engineering_manager`). No code change is needed; unit, parity and real-Postgres rows pin it.
- **Docs in the same change:** the four delta specs below, the REST API Contract (TOPIC-002 Authorization, 403 rows, annotation-fields note, audit note, the TOPIC-001 caveat, and Appendix B), the BRD FR-8.7 rationale and a one-line cross-reference in BRD Constraint 2, and Use Case 08 "View Active Topic Configuration" (admin secondary actor, dual-hat alternate flow, audit acceptance criterion).

## Decision recorded: #232 question 1 is decided independently of #208

**Decision (Brian Surratt, project owner):** #232 question 1 is decided as option (b)-deny, independently of #208.

- TOPIC-002 reads deny an `application_admin` with an active `engineering_manager` membership on the team: `403` for the whole response, using the allow-list of null or `participant` membership.
- TOPIC-003, TOPIC-004, TOPIC-005 and TOPIC-006 (writes) and the shared helper `checkStandingFacilitatorOrAdminAuthorization` **stay unchanged** until #208 is decided.
- The resulting split (`GET 403` / `POST 201` for an admin with an EM membership) is recorded in the parity test with a comment citing #208, and handed to #208.

**Rationale.** The issue asked for (b) to be decided "together with #208". We are deviating from that on purpose.

1. **They are different rules.** #208 asks whether a *member*-admin may **write**, under the facilitator-from-another-team rule, where there is room for judgement. #232 asks whether a *manager*-admin may **read** the team's words, under the no-manager rule, which is HARD. No outcome of #208 could make it acceptable for a team's manager to read the team's definitions. Waiting would only keep the gap open longer.
2. **The issue's own suggested fix anticipates this.** It says to check membership "in a TOPIC-002-specific wrapper ... so the TOPIC-004 and other write callers keep their behaviour until #208 is decided." That is exactly the mechanism here.
3. **Consistency is shown, not assumed.** The parity test gets an explicit `{ get: 403, post: 201 }` row for "admin + EM membership" with a comment citing #208. A comment on #208 records the split and links this change. `standing-facilitator-access-helper.ts` and the four `topics.ts` wrappers have **no diff** in this change, which is cheap for a reviewer to check.

**Why deny the whole response, not omit the annotation fields.** The `team-content-access` content matrix says an EM gets "None" for topic configuration, not "None except the free text". A manager who sees topic names, prompts and archive history is still shaping how the team thinks about itself. A null annotation reads as "the team wrote nothing", which is a lie. It could also mislead a facilitator who later inherits the team from a dual-hat admin. Stripping fields is a deny-list of columns, and deny-lists rot: the next free-text field anyone adds to TOPIC-002 would leak by default. #187 rejected that shape. Denial costs one narrow subclass (an admin who manages this very team) the *screen* for their own team, and nothing else.

**Why an admin with a participant membership stays admitted.** Reading the definitions as a participant member is not a no-manager problem. Whether that person may *shape* topics is #208's question, and denying them here would pre-empt it.

## Non-goals

- **This change does not decide #208.** After it, an `application_admin` with an `engineering_manager` membership is denied TOPIC-002 (read) but is still admitted by TOPIC-003..006 (writes) through the API. The parity test records this as `{ get: 403, post: 201 }` with a comment citing #208. A comment on #208 records the split as evidence for that decision.
- No change to `checkStandingFacilitatorOrAdminAuthorization`, `evaluateStandingFacilitatorAccess`, or any `topics.ts` authorization wrapper.
- No change to TOPIC-001, TOPIC-007, or any session, live-room, trend or action-item endpoint.
- Admission does not key on `users.roles` (the IdP role set from #245). That set isn't team-scoped, its backfill holds only `{global_role}` until the user's next login, and migration 21 says nothing reads it for authorization. It is used only as audit metadata.
- No machine-readable `code` field is added to the forbidden envelope. No other TOPIC-002 `403` carries one. Adding codes to forbidden envelopes would be a contract-wide change.
- No block on an admin editing their own membership. See the self-demotion edge in design.md.
- **TOPIC-002's pre-existing non-admin denials stay unaudited.** Auditing `NOT_A_FACILITATOR` and `FACILITATOR_IS_TEAM_MEMBER` `403`s under SEC-13 is out of scope. Scenarios that pin "no `admin.*` row" for those callers assert only that no administrator operation is written; they are not a decision that those denials shouldn't be audited.
- **No `404` for a team id that names no team.** TOPIC-002 already answers `200` with empty lists for every admitted caller. Changing that would touch the facilitator path. An admin's request for such an id is audited like any other admin read.
- **Fail-closed audit is not a general pattern.** It is right for this low-traffic, admin-only read. It must not spread to facilitator, participant or live-session paths, where availability during a session matters more.
- No comment is added to the applied migration 1 enum. The "revisit on new enum value" note lives on the predicate.

## Constraints this change must preserve

- **The no-manager rule is structural.** No flag, no environment switch, no admin override, and no "unless" clause on the deny branch.
- **Facilitator flows are untouched.** TOPIC-002's only consumer is `TopicManagementPage`. No live-session endpoint changes: readiness, reveal, outliers and action items don't call TOPIC-002. The facilitator branch never reaches the new membership read, so facilitators gain no query, no audit row, no new state and no added latency. Non-member facilitators keep `200` and `canEditAnnotations: true`. Handoff continuity holds: a facilitator inheriting a team still gets the definitions and archive history without needing a handoff conversation. Member-facilitators keep `403 FACILITATOR_IS_TEAM_MEMBER`.
- **The #208 boundary holds.** The shared helper and the topic-write wrappers stay byte-for-byte unchanged. TOPIC-004's behaviour for an admin member, with a participant or an EM membership, is pinned unchanged.
- **Audit records carry no team words.** Counts only, never text, names or ids of topics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `team-content-access`: "Application Admin access is limited to administrative data". The TOPIC-002 caveat is replaced with the new behaviour. The admin-read audit wording is corrected (after read, before send, fail closed; real column names). The audit visibility guard is added. New scenarios cover TOPIC-002's admin outcomes and the global-EM regression.
- `topic-customization-lock`: "The all-topics endpoint uses the standing, org-wide facilitator authorization model". The admin arm gains the membership allow-list, the deny mechanics and the TOPIC-003..006 boundary. "The all-topics endpoint tells the screen whether the caller can add a custom topic": the parity scenario records the #208 split. New requirement: "The all-topics endpoint audits every administrator read and every administrator denial".
- `topic-annotation`: "The active-topics endpoint does not return the team annotation". A cross-reference is added so that "engineering managers never see the team's definition" holds across both reads, including the dual-hat admin.
- `topic-management-screen`: the access-denied state renders the server's message when present. The truth table notes that an admin with an EM membership doesn't reach the screen. The "Topics" link stays visible and the server gates.

## Impact

- **Backend:** `packages/backend/src/routes/content.ts` (TOPIC-002 handler: a TOPIC-002-local admin-membership policy, the deny branch, the access/denial audit writes). `packages/backend/src/auth/audit-logger.ts` (register `admin.topic_config_accessed`, `admin.topic_config_denied`, and the log-only `admin.audit_write_failed`). No migration: `audit_log.actor_roles` already exists.
- **Frontend:** `packages/frontend/src/pages/TopicManagementPage.tsx` (`loadTopics` renders the 403 envelope message via the existing `hasEnvelopeMessage`).
- **Tests:** `content.test.ts`, `topic-add-flag-parity.test.ts` (fake gains a membership role; the `Expected` type gains the split shape), a real-Postgres integration suite for TOPIC-002 admin outcomes, `TopicManagementPage` tests.
- **Docs:** `requirements/design/REST API Contract.md` (TOPIC-002 section, TOPIC-001 caveat at ~L566, Appendix B TOPIC-002 row). `docs/deployment.md` Logging section (new `actor_roles` writers, the new log-only event, the compensating-control review queries with a proposed owner). `requirements/BRD.md` FR-8.7 rationale (L341) gains the qualifier ", except an administrator who holds an engineering manager membership on that team (no-manager rule; #232)".
- **Untouched (reviewable as an empty diff):** `packages/backend/src/auth/standing-facilitator-access-helper.ts` and the TOPIC-003..006 wrappers in `packages/backend/src/routes/topics.ts`.
- **API:** TOPIC-002 gains two `403` outcomes for one narrow caller class. The response shape is unchanged for every admitted caller.

## Release-note gate

#187 Follow-up 5's release-note line is **blocked on #232 merging**. Follow-up 5 has no tracking issue, so this gate is recorded here, in the #208 comment, and in the PR description. Once #232 ships, the approved wording is: "Engineering managers, including administrators who manage the team, cannot read the team's definitions." It must **not** say that managers cannot change topics. That stays untrue until #208 is decided.

## Follow-ups (for a human to file or post)

1. **Comment on #208** recording the `GET 403 / POST 201` split, linking this change, and asking for #208 to be **scheduled in the current milestone**: the split is a temporary state, not a resting one. If #208's outcome touches who can shape a team's topics, it goes to the executive sponsor. From the room's point of view, the half left open is the worse half. A manager who can add, archive and reorder their own team's topics through the API is shaping what the team talks about, which is closer to the core harm than reading the definitions. It also records that POST add's `201` returns `displayOrder` (the active-topic count, a low-value residual read for an EM-admin) and that an EM-admin's topic writes are already audited in-transaction, which is the stop-gap #208 relies on. The comment does not recommend an answer.
2. **Comment on #238** (reporting chains, deferred): when reporting chains land, revisit whether TOPIC-002 admission should also use them for a dual-hat manager who holds no EM membership on the team. For now, `actor_roles` on the audit rows, reviewed with the query in `docs/deployment.md`, is the compensating control.
3. **File (Security's call, made at design review):** an issue to bar an admin from changing their own membership role on a team, or to require a second admin (the self-demotion edge). Not in scope here; until it ships, the correlation query in `docs/deployment.md` covers it.
4. **Optional:** a contract-wide issue for machine-readable `code` fields on forbidden envelopes.
5. **Optional:** an issue to audit TOPIC-002's pre-existing non-admin `403`s under SEC-13.
6. **Optional:** an issue for TOPIC-002 (and TOPIC-001) to answer `404` for a canonical UUID that names no team.
7. **PR description** states: "AC1 is met by a recorded deviation: Q1 decided independently of #208 (owner decision, proposal §Decision recorded)." Alternatively Brian amends AC1 on #232.
8. **File:** a root error handler that answers `500` with the standard envelope and a correlation id, and logs error detail server-side. Today Fastify's default handler echoes `err.message` (pre-existing, app-wide; design-review Security §3a).
9. **File:** generalise the audit-visibility guard in `audit-logging-operations` to every `admin.*` and `session.*` operation, with a structural test (design-review Security §5).
10. **Owner decision (Brian):** confirm who reviews the compensating-control queries in `docs/deployment.md`. Proposed: Security (Tomás Ferreira), monthly, no alerting.

## Calls made on others' behalf (overridable at review)

- **Security (Tomás Ferreira):** ~~`actor_idp_roles_include_em` is in the audit metadata as a boolean, not the full role array.~~ **Superseded at design review (Security B1):** both rows write the full role set to the existing `audit_log.actor_roles` column; the boolean stays as a derived convenience. Audit rows are immutable, so fidelity can't be added later.
- **Solution Architect (Ingrid Sollenberger):** the admin-read "same transaction" sentence is replaced with "after the read, before the send, fail closed". This codifies what `teams.ts` already does and changes no code outside TOPIC-002. **Confirmed at design review**, with the guarantee stated as one-directional (served ⇒ recorded; over-recording on a client disconnect is intended).

## Proposal review disposition

*Devon Calloway, after `propose-review-ba.md` (Marcus Delgado) and `propose-review-exec.md` (Rachel Okonkwo). Both approved; nothing was blocking.*

| # | Point | Disposition | Where |
|---|---|---|---|
| BA §1 | AC1 reads as unmet because Q1 was decided independently of #208 | **Accepted.** The PR description carries the deviation sentence (or Brian amends the AC). | Follow-up 7; tasks 8.4 |
| F1 | Fail-closed rules only in design | **Accepted in full.** Membership read, IdP-role read and both inserts → `500`, no data; a failed denial insert never becomes `200`. Normative in the spec, with scenarios, and in tasks 3.4. | topic-customization-lock; team-content-access; design D2/D4; tasks 3.4 |
| F2 | Reason names aren't observable | **Accepted.** Reason names are declared internal; every `403` scenario asserts the exact `error.message`. | topic-customization-lock; team-content-access; topic-annotation; design D3 |
| F3 | Visibility guard untestable | **Accepted.** Kept the normative guard and added the equality-filter condition plus a PR-time grep. The guard is the part of this change that stops the audit from becoming a manager's surveillance tool, so it should be checkable, not aspirational. | team-content-access; design D5; tasks 8.3 |
| T1 | Use Case 08 traceability | **Accepted.** | tasks 7.5 |
| T2 | Edge cases | **Accepted, with one rejection.** Removed EM membership → admitted, `membership_role: null`, pinned. Nonexistent team id → **decided: audited like any other admin `200`**, existing `200`-empty behaviour unchanged (a `404` would touch the facilitator path; optional follow-up 6). `membership_unrecognised` declared unit-test-only. **Rejected:** adding a comment to migration 1's enum. We don't edit applied migrations for a comment; the note goes on the predicate. | topic-customization-lock; design D5a; tasks 2.1, 5.1 |
| T3 | Refetch scenario mixes UI and API | **Accepted.** Restated as two API requests → two rows. | topic-customization-lock; tasks 3.5a |
| T4 | SEC-13 and pre-existing non-admin denials | **Accepted** as a Non-goal and a scoping sentence in the spec; optional follow-up 5. | Non-goals; topic-customization-lock; team-content-access |
| W1 | Requirement title overstates | **Rejected (rename), accepted (clarify).** Renaming breaks the MODIFIED header match on sync. The body now says the admin arm deliberately differs from TOPIC-003..006. | topic-customization-lock |
| W2 | "Not detectably faster" is vague | **Accepted for the new scenario.** The EM-denial scenario asserts `applyTimingFloor` called once with the request's start time before the reply. The pre-existing scenario is left alone. | topic-customization-lock |
| W3 | Facilitator no-extra-query by SQL text | **Accepted.** | topic-customization-lock; tasks 3.6 |
| W4 | `actor_idp_roles_include_em: false` over-trusted | **Accepted.** The false-negative limit is now in the spec, with a scenario. | topic-customization-lock |
| W5 | BRD Constraint 2 cross-reference | **Accepted.** That is where a reader looks for the dual-hat rule. | tasks 7.6 |
| Exec 1 | Get #208 scheduled, not just commented on | **Accepted as a recommendation to the owner.** Follow-up 1 and the #208 comment ask for the current milestone, with escalation to the sponsor if it touches who shapes topics. Scheduling is Brian's call, not this change's. | Follow-up 1; design Open Questions; tasks 8.4 |
| Exec 2 | Keep paperwork proportional | **Accepted, no artifact change.** This depth is warranted because it is a HARD-rule fix. It is not the default for small bugs. | — |
| Exec 3 | Fail-closed scoped to this endpoint | **Accepted.** Stated in the spec, design and Non-goals. Facilitator and live-session paths are not touched and must not copy it. | team-content-access; topic-customization-lock; design D2; Non-goals |

**Nothing was rejected on ritual-constraint grounds.** No review point asked to soften the no-manager rule, add an override, or narrow the deny to the annotation fields. Both reviewers kept the whole-response deny and the allow-list, and those stay unconditional.
