# Proposal: admin-default-topic-maintenance (#216)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (revision 2) with `explore-review-ba.md` and `explore-review-facilitator.md`. Traceability: GitHub issue #216; BRD FR-8.1 [HARD], FR-8.2, FR-8.3, FR-8.6, FR-8.7; use case `requirements/use cases/08 - Topic Management - Use Cases.md` (Assign Default Topic Set to New Team; Recover Zero-Topic Team; new: Maintain Default Topic Set); archived changes `reject-template-team-topic-writes` (#188) and `harden-team-creation-topic-copy` (#215); openspec specs `default-topic-provisioning`, `audit-logging-operations`, `topic-write-rate-limiting`, `topic-customization-lock`, `team-not-found-envelope`. The openspec CLI is not installed in this environment; artifacts were written by hand in the shape of `openspec/changes/archive/2026-10-17-bulk-restore-default-topics/`.*

## Why

BRD FR-8.1 [HARD] says the default topic set "shall be defined and maintainable by an Application Administrator". Today it is not maintainable: the only way to change one of the twelve prompts is a SQL migration, which means a developer, a review and a deploy. FR-8.1 is therefore unmet, and every wording fix lands on me or on whoever I can persuade.

I care about this one more than its size suggests, because it is the only requirement that lets someone change what every future team is asked in its first session. Those prompts are the Health Check. The first session is deliberately locked to the canonical set (FR-8.2) so every team starts from one baseline and trends are comparable. An edit path for that set is an edit path for the ritual itself. So the job is not "build an admin CRUD". It is: give administrators a way to maintain the defaults that cannot be turned into a way around anything protective.

Three ritual properties are in play, and the design is judged against them:

- **Structural, not configurable.** The maintenance path changes template topic content (name, prompt, first-session description, order, active or archived status) and nothing else. It exposes no control over the first-session lock, team membership, facilitator rules or session rules. The spec carries an endpoint inventory that proves it. Nobody should be able to read this change and conclude that a protective constraint now has an admin setting.
- **A visible, restorable baseline (FR-8.6).** If admins can quietly rewrite the defaults, the "baseline you can get back to" moves under teams that believed they were restoring to it. Every template write is therefore audited, in the same transaction, with full before and after values.
- **Not a performance tool.** Admin-authored prompt text is the one place free text reaches every team. It must address the team and the work, never individuals.

It also serves the success criterion that a team I have never spoken to adopts the ritual without me: the people who maintain the defaults should be able to do so without me being the help desk.

**What it is not.** It is not a propagation mechanism. The new-teams-only rule is the existing requirement, not a choice made here: use case 08 "Assign Default Topic Set to New Team" (the default set is copied to a team when it is created) and BRD section 6.4 (copy-on-create: a team's topics are its own copy), with FR-8.2 (first-session lock) keeping a not-yet-run team on the set it was created with. FR-8.1 itself is silent on propagation; the issue's "confirm against the requirements" is closed by those citations. An edit affects only teams created afterwards (plus teams recovered through Recover Zero-Topic Team, which by existing design receive the current template). It does not touch existing teams, open sessions, or session snapshots. It is not a "reset to factory" (declined). It has no screen in this change.

## What Changes

- **New admin-only endpoint family under `/api/v1/admin/default-topics`** (D10). No `:teamId` anywhere; the template is addressed implicitly and the sentinel id is never accepted as input. Seven routes: list (including archived, with `lastChangedAt` and `lastChangedBy` per row, D14: the time and actor of the latest `topic.default_added`, `_edited`, `_archived` or `_restored` audit row naming that topic; reorders do not count; derived from the audit trail, so it depends on audit retention), add, edit, archive, restore, whole-list reorder (six operations), plus a read of the template's audit history (D13). The history read is kept deliberately; see "Why the history endpoint stays" below. Success statuses: add `201`, every other write `200`, both GETs `200`. The route is outside the `^/api(/v\d+)?/teams/:[^/]+/topics` prefix the #188 structural test enumerates, so the test and its empty `EXTRA_IN_SCOPE_ROUTES` pass unchanged.
- **Admin-only with its own 403 code.** `application_admin` only, read live from `users.global_role` on every request (the assign-defaults model, not the TOPIC-003..006 "admin or non-member facilitator" wrapper). Anyone else, including facilitators and engineering managers, gets `403 DEFAULT_MAINTENANCE_ADMIN_ONLY`, a code distinct from `NOT_AN_ADMIN` (assign-defaults) and `NOT_A_FACILITATOR`. The denial is audited fail-open and bounded per actor. Requests are JSON-only with a per-route `bodyLimit`; CSRF protection is the inherited SameSite=Strict cookie plus the CORS allow-list (stated, not newly built; design E2a).
- **Every successful template write is one transactional audit row** via `withAuditTransaction`: operations `topic.default_added`, `topic.default_edited`, `topic.default_archived`, `topic.default_restored`, `topic.default_reordered`. The metadata holds full before and after values of changed fields (D3); the application log copy of each event carries identifiers and `changedFields` only, and is the structured event an operator can alert on. This is a documented, scoped exception to the "no topic text in audit rows" convention, with a break-glass redaction procedure in the runbook for text that must not persist. An audit failure rolls the write back. A no-op edit writes no row and returns 200. "No-op" is defined precisely in the spec: after trim, every supplied editable field equals the stored value byte for byte (case and internal whitespace count); an empty `{}` PATCH is a no-op `200`; a multi-field PATCH with any invalid field applies none of its fields.
- **One audited writer function.** All writes to `topics WHERE team_id = sentinel` go through a single module, so #215's revisit lines hold: one audited function, one `audit_log` row per template write.
- **Validation that keeps team creation alive** (D7, D2): active defaults min 1, max 15; name 1..60, prompt 1..400, first-session description required 1..800 (after trim, plain text, no markup or URLs); name unique among the other active template rows (trim, case-insensitive; the row being edited is excluded, so a case-only or spacing-only rename of its own name is a real, audited change); `vote_type` fixed at creation. Each failure has its own error code and writes no success audit row. Archiving the last active default is refused. Plain text is narrow and exact: "rate < 5" and "Dev & Ops" are accepted; `<b>`, `&amp;`, URLs, `](` and Unicode Cc/Cf characters (bidi overrides, zero-width, NUL; `\n` allowed in the description only) are not. This is a denylist, not the XSS control: the control is that every consumer renders template text as text (design E4a).
- **Scope statement on every write response.** A `scope` field says: "applies to teams created from now on; existing teams keep their current topics". A rename response additionally says name-based matches for existing teams (restore, `defaultTopicsNotActive`) will no longer pair.
- **Shared limits and rate budget.** Maintenance writes share the existing per-actor topic-write rate limit and 429/503 codes (no new values). The 403 path reuses the bounded denial audit through a parameterized seam. A lock or statement timeout on the sentinel lock answers `503 DEFAULT_MAINTENANCE_BUSY`.
- **Trigger reconsidered; outcome recorded** (D4). #215 declined a database trigger on template writes on condition that this change delivers a sanctioned writer and reconsiders. Outcome: trigger declined again, with reasons, replaced by an enumerating structural test that fails if any code outside the single maintenance module (and the named team-scoped writers) writes `topics`. See design.md. Revisit triggers are recorded.
- **Baseline test updated** (D1, D5). `template-invariants-integration.test.ts` is reshaped from "equals this fixed list of twelve" to structural invariants plus the seed as a migration-time baseline. Invariant (c) is restated: archived defaults are valid state and are never copied. `non_active_default` is removed from `template-anomalies.ts`. The "F5 (#216) MUST update this list" header is rewritten.
- **Use case document**: "Maintain Default Topic Set" is added to `requirements/use cases/08 - Topic Management - Use Cases.md` (D12), and the BRD traceability for FR-8.1 reads "partially met, API only" (D6) and FR-8.6 gets a note that "canonical" means the template as currently maintained (D5).
- **Docs**: REST API Contract entry (TOPIC-009 family, with prompt-writing guidance and good/bad examples), `docs/deployment.md` runbook note (including the audit-retention exemption behind `lastChangedAt`, the break-glass redaction step, the suggested alert on the maintenance log events, how `application_admin` is granted, and the audit-table access-control reliance), and an operational checklist item: one dry run on a non-production database with a facilitator before the first production edit. The dry run is a pre-first-production-edit checklist item, not a gate on merging this change (executive review).

## Capabilities

### New Capabilities
- `admin-default-topic-maintenance`: the admin-only endpoint family, its authorization and check order, validation limits, error codes, scope statement, concurrency and live-session isolation guarantees, endpoint inventory, audit content, and the second-writer prevention test.

### Modified Capabilities
- `default-topic-provisioning`: an archived template default becomes valid state (never copied) instead of a data fault; the `non_active_default` anomaly is removed; the template-invariants requirement is reshaped as above.
- `audit-logging-operations`: the five maintenance audit operations (transactional, with the scoped text exception) and the bounded fail-open denial row.
- `topic-write-rate-limiting`: the maintenance write endpoints share the existing budget with no new values.

## Constraints preserved

- **#188 guard (`checkWritableTeam`) and its structural test pass unchanged.** The admin path is a separate route and handler. No admin exemption is added inside any team-scoped handler, no allow-list gains the sentinel id, `EXTRA_IN_SCOPE_ROUTES` stays unchanged. Team-scoped writes to the template still answer `404 TEAM_NOT_FOUND`.
- **Route outside `/teams/:teamId/topics`**, no team id accepted anywhere.
- **Admin-only, own 403 code**, role read live, same timing-floor and envelope conventions as assign-defaults.
- **Own audit events via `withAuditTransaction`**, not reused from `topic.write_denied_template` (which means "someone was refused").
- **No operation reads or writes any real team's `topics`, `session_topics` or an open session**, never takes `lockTeamTopics` on a real team, and a negative test proves a template write leaves every existing team's topics and every session snapshot byte-identical.
- **First-session lock, membership, facilitator and session rules have no admin control**; migration 23's CHECKs on the sentinel remain.
- **Decisions D1 to D14** from `exploration-notes.md` section 9 are carried as written; see design.md for mechanism.

## Assumptions flagged for Product Owner acknowledgement ("PO ack")

The build proceeds on these defaults. Each is reversible by a code change with PO review; none is a runtime setting. They are called out so nobody discovers them later as surprises.

1. **D2: `vote_type` is immutable after creation; rename is allowed.** The issue says "edit"; this narrows it. Changing a vote type means archive plus add. Rationale: vote values are comparable only within a type, and a template vote-type change would silently alter what "a 3" means for new teams while old teams keep the old meaning.
2. **D3: audit rows carry full before/after topic text, with no version table.** This knowingly breaks the "no topic names or prompt text in audit rows" convention, scoped to the five maintenance operations only. Template text is global and non-personal; it is what an incident reviewer needs. Recovery from a bad edit is editing it back from the audit row (D13); there is no undo operation and no revert button.
3. **D6: API only.** FR-8.1 is recorded as "partially met, API only". Until the Topic Management template screen ships, the first real users of the endpoints are developer-level. This is an accepted interim cost. The screen is a named follow-up issue.
4. **D7: the limits (max 15 active, name 60, prompt 400, description 800, plain text only).** I lowered the BA's suggested 24 to 15 to protect the brief-session property: 12 already fills a session. All twelve seeded defaults were checked against these limits (longest name 36, longest prompt 61, longest description 262, all plain text), so the limits fit without editing any seed.
5. **D5: "canonical" means the current template.** The migration 11 seed becomes history, not a standard. No "reset to factory" (declined as a toggle on the ritual).
6. **D1: archive, not delete, and `non_active_default` is retired.** This changes a detector #215 shipped.
7. **Design E6: the invariants baseline is reinterpreted.** #215's line says the invariants baseline is updated in the same change as any edit to the defaults. A runtime admin edit cannot change a CI file, so `template-invariants-integration.test.ts` becomes structural invariants plus the seed as a migration-time baseline that only a migration updates; the exact-twelve check (f) is skipped, never passed, once an audited maintenance write exists. This reinterprets an acceptance line and needs explicit PO acknowledgement.
8. **Edit of an archived default is refused (`409 DEFAULT_ARCHIVED`)**, per-row `lastChangedAt` excludes reorders, and the 403 code is `DEFAULT_MAINTENANCE_ADMIN_ONLY` (all ratified by the BA).
9. **Single-admin control is accepted for the first release.** One `application_admin` can rewrite the template with no second approver and no preventive control beyond validation; the compensating control is detection (the structured log event and the audit trail). `application_admin` comes from the IdP role claim mapped at sign-in, so the IdP group process is part of this control. Reopen if the administrator count grows beyond a handful, or after any incident that involves a template change. Audit-table tamper resistance relies on database access control and is not claimed beyond that.

## Status reporting (FR-8.1)

FR-8.1 [HARD] is reported as **"partially met, API only"**. It is not described, in the PR, the BRD, release notes or conversation, as administrator self-service. The first real users are developer-level until the template screen ships. The screen follow-up must be a numbered, scheduled issue, not a parking lot.

**Issue closure (decision).** Issue #216 asks for admin-only API endpoints with their own authorization and audit, maintained without a migration. This change meets that, so the PR body uses "Closes #216" and states in the same description that FR-8.1 is only partially met (API only) and where the remainder is tracked (the four follow-up issues). BA acceptance stays conditional on the follow-up numbers being filed (task 8.1).

## Why the history endpoint stays (D13)

The executive review asked for it to be deferred unless it is the sole recovery path. It is. There is no undo, no version table and no revert button (D3); recovery from a bad edit is reading the before-value from the audit row and editing it back. Without the history read, the only way to see a before-value is SQL access to `audit_log`, which puts a developer back in the loop for exactly the case FR-8.1 exists to remove, and an administrator would be changing global prompts with no way to see what they replaced. The cost is one read-only route over an existing index with no new schema or audit rows. If the screen follow-up ships first with its own history view, the route is the thing it calls. Decision: keep.

## Reorder stays

Reorder is kept (executive review: low cost, not insisted on). It is whole-list, atomic and audited, and without it a newly added default can only ever sit last, which would force archive plus re-add to change the order of a ritual whose topic order sets the tone of a session.

## Known residual risk: prompt content

"Prompts address the team and the work, never individuals" is enforced by documentation, the length and plain-text guards, the audit trail and review only. There is no semantic filter (E9, declined). A prompt naming a person can be written by an administrator and will be visible to every team created afterwards. Accepted.

## Known consequences (accepted, documented, each with a follow-up issue to be filed by a human before acceptance, D11)

- **Restore returns the team's own superseded wording.** Single and bulk restore (#218) reactivate the team's own archived `is_default` row; they do not read the template. After an admin rewords a default, a team that archived it gets its original wording back. No UI or API text may call restored topics "canonical" (D9).
- **`defaultTopicsNotActive` name join mismatches after a rename.** The join is by name against the template; an old team's "Pairing" stops pairing with a renamed template row. The field is in the REST contract and could be misread.
- **Mixed wording across a facilitator's teams.** A team created yesterday runs the old set; one created next week runs the new. Accepted: integrity over uniformity. A team still locked pre-first-session when an edit lands keeps the old set; this is said plainly in the docs.
- **Trends (D8).** Votes attach to the team's own topic ids, so history is intact. I grepped the report code (`routes/em-views.ts`, `routes/content.ts`): every trend query is scoped to one team and groups on `topic_id` or the session snapshot's `topic_name`; nothing groups by default-topic name across teams. A future cross-team by-name view must handle reworded defaults.

## Follow-up issues (numbers are `#TBD` until a human files them)

**Flagged open item.** The agent team does not create GitHub issues. All four numbers below are `#TBD` in this proposal and must be filed by a human, at or before PR time, and written back here (task 8.1). The BA will not sign acceptance while any is `#TBD`, and the executive sponsor wants the screen issue scheduled. Ranked in priority order:


1. Facilitator-visible "defaults last changed" note and template updated date (ranked first: it is what lets a leader interpret mixed wording across teams correctly; filed as date-only, no per-team version record): #307
2. Topic Management template screen (preview before save, accessible reorder alternative, mobile layout, confirmation once per edit session, topic count against the cap). Filed as two issues: read-only view and history #308, editing #309. #309 is what moves FR-8.1 from "partially met, API only" to met, so it must be scheduled
3. Canonical wording on restore (restore reads the template; depends on #311): #310
4. `defaultTopicsNotActive` name-join robustness (match by template id; prerequisite of #310): #311

## Impact

- **Backend**: new route module `packages/backend/src/routes/admin-default-topics.ts`; new writer module `packages/backend/src/sessions/default-topic-maintenance.ts` (the only module that writes sentinel `topics` rows); additions to `auth/audit-logger.ts` (closed `AuditEventName` union); a small **parameterized** denial-audit seam (endpoint/family label) reusing `admitDenialAudit`, not a copy of `auth/assign-defaults-audit.ts`; an exported `MAINTENANCE_AUDIT_OPERATIONS` constant used by every query that selects maintenance rows (never `LIKE`); registration in `register-routes.ts`; `sessions/template-anomalies.ts` (remove `non_active_default`).
- **Tests**: new integration and structural tests; **`routes/__tests__/topic-write-rate-limit-structural.test.ts` allow-lists extended** by exactly the new route module and denial seam, with reasons (the limiter import graph is an allow-list and would otherwise fail); reshaped `routes/__tests__/template-invariants-integration.test.ts` **and** its pure checker `routes/__tests__/helpers/template-invariants.ts` (the `InvariantId` union, labels, baseline parameter) with its unit test `helpers/template-invariants.test.ts`; amended `template-anomalies.test.ts` and `team-creation-canonical-copy-integration.test.ts` where they assert `non_active_default`; `docs/deployment.md`'s `template_anomaly` paragraph (lists `non_active_default`) is updated. `team-template-guard-structural.test.ts` unchanged.
- **No migration** (acceptance: "without a migration"). `audit_log.operation` is free text.
- **No frontend change.**
- **Requirements docs**: use case 08, BRD traceability, REST API Contract, `docs/deployment.md`.
