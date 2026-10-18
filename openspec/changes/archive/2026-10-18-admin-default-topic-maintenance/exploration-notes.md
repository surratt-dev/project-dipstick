# Exploration notes: admin-default-topic-maintenance (#216, BRD FR-8.1)

Voice: Devon Calloway (Internal Champion). Explore mode only.

Revision 2: incorporates the Facilitator (Priya Nair) and BA (Marcus Delgado) reviews. Section 9 now holds **decisions** (with owners) instead of open questions; section 11 is the facilitator-impact view; section 12 records which review suggestions I accepted and which I pushed back on, with reasons.

**Vocabulary used from here on.** **MUST** = requirement the proposal carries as a testable condition. **LEAN** = engineering preference the design may overturn with a written reason. **DECLINED** = considered and rejected. Anything not tagged is context. Decisions marked "PO ack" are mine/the BA's recommendation pending the Product Owner's confirmation; they are firm enough to write the proposal against.

## 1. Why I care about this one

FR-8.1 is the only requirement that lets someone change what every future team is asked in its first session. Those twelve prompts are the Health Check. The first session is deliberately locked to the canonical set (FR-8.2 lock) so that every team starts from the same baseline and trends are comparable. An edit path for that set is therefore an edit path for the ritual itself.

Ritual constraints in play:

- **Canonical first session.** A team's first session must use the canonical defaults in canonical order. If the admin path lets the template drift, "canonical" stops meaning anything.
- **Visible, restorable baseline (FR-8.6).** The defaults are the "baseline you can get back to". If admins can quietly rewrite them, the baseline moves under teams that believed they were restoring to it.
- **Structural, not configurable.** My standing fear is a protective constraint turning into a setting. **MUST:** the maintenance path changes only template topic content (name, prompt, first-session description, order, active/archived status). It exposes no control over the first-session lock, team membership, facilitator rules, or session rules, and the spec carries an endpoint inventory proving it. It must not add non-default rows to the template.
- **Not a performance tool.** Prompts must stay about team health. Admin-authored prompt text is the one place free text reaches every team, so it must never name or target individuals (see risks).
- **Not me as help desk.** Today the only way to change a default is a migration, which means a developer plus a deploy. This issue should end that, without making the admin screen so powerful that nobody reviews changes.

## 2. What an edit to defaults means for existing teams (confirmed against requirements)

Answer: **an edit affects only teams created afterwards.** Confirmed, with two exceptions that the issue text does not mention.

Evidence:

- `requirements/use cases/08 - Topic Management - Use Cases.md`, "Assign Default Topic Set to New Team", line 54: "The default topic set is a system-level constant. If the canonical defaults change in a future application version, existing teams retain their assigned configuration and are not automatically updated. The one exception is a team recovered through Recover Zero-Topic Team, which receives the *current* template, not the template of its creation date; that is intended."
- BRD FR-8.1: "ship with a default set ... applied to all new teams. This default set shall be defined and maintainable by an Application Administrator." Says "new teams"; says nothing about propagation.
- Code: `copyCanonicalDefaults` (`packages/backend/src/sessions/default-topics.ts`) copies the template's active `is_default` rows into the new team's own `topics` rows at creation, renumbering positions 1..n. Annotations are deliberately not copied.
- Open sessions are unaffected: session topics are snapshotted (`session_topics`, `snapshotSessionTopics`) when the room opens.

The two cases where an edit does reach an existing team, both intended or at least already specified:

1. **Zero-topic recovery (#200).** `assign-defaults` copies the *current* template. Use case 08 says this is intended. Spec text should state that an edit changes what recovery hands out.
2. **A team that has not yet created its topic rows is not a thing.** Rows exist from team creation, so there is no "created but not yet copied" window. Teams created but still locked (first session not complete) keep the old set. That is correct and should be said out loud: a team that was created yesterday and whose first session is next week runs the *old* canonical set.

Where an edit must NOT reach existing teams, and could by accident:

- **Bulk restore (#218) and single restore.** Restore reactivates the team's *own* archived `is_default` row (`topics.ts` ~l.1792, `planDefaultRestore` matches by name against the team's rows). It does not read the template. So a team that archived "Pairing" gets back its original "Pairing" row with the old wording, even after an admin reworded the template. The #218 traceability note already records "canonical wording on restore is still not met". An edit path makes that gap visible to users for the first time: after a wording change, "Restore default topics" will return superseded wording. Do not fix it in this change (scope), but name it in the spec as a known consequence, and do not let the confirmation dialog or any copy call restored topics "canonical".
- **`defaultTopicsNotActive` (content.ts ~l.731, #197).** Joins by name against the template. After an admin renames a default, that join starts mis-matching for old teams (the old team's "Pairing" no longer matches a renamed template row). The Topic Management screen does not read this field today, but the field is in the REST contract and could be misread. Flag for the design.
- **Trends.** Votes attach to the team's own topic ids, so history stays intact (FR-8.3). But cross-team comparison of a topic by name, if any exists, would mix old and new wording. Needs an answer from the BA about whether any report groups by default-topic name.

Consequence for copy. **MUST:** every maintenance write response carries an explicit scope statement (a `scope` field plus documented behavior, since this change is API-only, see section 9 D6): "applies to teams created from now on; existing teams keep their current topics". Silence invites an admin to believe they just fixed a typo for everyone. When the follow-up screen exists it shows the same wording once per edit session near Save, not on every field change (confirmation fatigue).

Additional **MUSTs** from the facilitator review (section 11): (i) no maintenance operation reads or writes any real team's `topics`, `session_topics` or an open session; (ii) the maintenance path never takes `lockTeamTopics` on a real team, only on the sentinel, and shares no state with the live-session path; (iii) a negative test proves a template write leaves every existing team's topics and every session snapshot byte-identical. Nobody may later add a "propagate to existing teams" operation; that would be a new change with PO review.

## 3. How admin authorization exists today

- Role is `users.global_role` (enum `user_role`), values include `application_admin`. Mapped from the IdP via `OIDC_ROLE_MAP` (`auth/role-map.ts`; `isApplicationAdmin(role)` at ~l.376: "role === application_admin, and no role implies it").
- The session does not carry the role. Each admin-gated endpoint **reads the role live** from `users` on every request. Clean precedent for an admin-only endpoint: `checkAssignDefaultsAuthorization` in `routes/topics.ts` (~l.943), used by `POST /api/v1/teams/:teamId/topics/assign-defaults`. It selects `global_role`, 403s with code `NOT_AN_ADMIN` for anyone else (fail-open, bounded-per-actor denial audit `topic.defaults_assign_denied` via `auth/assign-defaults-audit.ts`), applies the timing floor, and returns the envelope.
- Other admin branches (TOPIC-003..006 per #176/#208) admit admins *or* non-member facilitators. FR-8.7 (TOPIC-007) shows the opposite pattern: admins explicitly excluded. #216 wants admin-only, so the assign-defaults shape is the closer model than the TOPIC-003..006 wrapper.
- Admins "do not take part in sessions" (BRD l.203) but may hold team membership. For the template, membership is irrelevant and the template must have none (migration 23 CHECKs forbid memberships, sessions and join links on the sentinel).
- Engineering Managers and facilitators get 403. "Non-admins get 403" in the acceptance criteria is consistent.
- Open question for the design: the route must live **outside** the `^/api(/v\d+)?/teams/:[^/]+/topics` write prefix, or the #188 structural test (`team-template-guard-structural.test.ts`) will enumerate it and require it to answer 404 TEAM_NOT_FOUND for the template. Acceptance says the guard and its structural test "still pass unchanged", so a path like `/api/v1/admin/default-topics` (no `:teamId`) is the natural fit. Check that the test's regex and `EXTRA_IN_SCOPE_ROUTES` stay empty for it. The admin route must never accept the sentinel id as input at all: the template is addressed implicitly, not by id.

## 4. How audit events work

- Table `audit_log` (migration 8): `actor_user_id`, `actor_global_role`, `actor_ip`, `operation` (free TEXT, no enum, no migration needed for a new name), `target_user_id`, `team_id`, `timestamp`, `metadata JSONB`; migration 22 added nullable `actor_roles TEXT[]`. Migration 23 already writes `team.template_cleanup` rows with the sentinel as `team_id` and the seeded system user as actor, so there is precedent for template-scoped rows.
- Log events: `emitAuditEvent(log, name, fields)` in `auth/audit-logger.ts`; `AuditEventName` is a closed TS union (new names must be added there; there is a long comment per event). Topic events today: `topic.custom_added`, `topic.archived`, `topic.restored`, `topic.defaults_restored`, `topic.reordered`, `topic.annotation_updated`, `topic.write_denied_locked`, `topic.write_denied_template`, `topic.defaults_assign_*`, `topic.denial_audit_suppressed`, `topic.write_rate_limit_exceeded`.
- Two write disciplines already exist:
  - **Fail-open** (`auth/fail-open-audit-write.ts`, `fail-open-topic-audit.ts`): denial and failure rows; a lost row never changes the response. Right for denials.
  - **Transactional** (`auth/audit-write-transaction.ts`, `withAuditTransaction(domainWrite, auditInsert)`): audit INSERT in the same transaction with `SET LOCAL statement_timeout = 400ms`; an audit failure rolls back the domain write. Right for successful mutations of high significance.
- Recommendation: template mutations use the **transactional** discipline. The #215 revisit lines require "one `audit_log` row per template write" and "every template write goes through one audited function". A fail-open row would let a template change succeed with no record, which is exactly the silent drift #215 accepted only until this issue. Denials (non-admin 403) stay fail-open, bounded per actor, mirroring assign-defaults.
- Audit content (**DECIDED**, replaces my earlier hash-plus-versioning lean; there is no template version history anywhere in this design, so hashes alone could not reconstruct a change). **MUST:** each successful template write commits exactly one `audit_log` row, atomically with the write, whose `metadata` holds: `topicId`, `operation` (also in the `operation` column), `changedFields` (names), and for each changed field the **full before and after values** (name, prompt, first_session_description as plain text; status and display_order as values); for reorder, the full before and after ordered id list; for add, the full new row; for archive/restore, the status transition and resulting position. Actor columns (`actor_user_id`, `actor_global_role`, `actor_ip`) are filled as for other audited events and `team_id` is the sentinel (precedent: migration 23). This is a **deliberate, documented exception** to the "no topic names or prompt text in audit rows" convention: that convention protects team-authored content, while template content is global, non-personal, and exactly what an incident reviewer needs. The exception is scoped to these operation names only; the spec states it. The audit row is the history: there is no separate version table, and "undo" means editing the field back to the prior value taken from the audit row (see D13). No-op edits (nothing changed) write no audit row and return 200 with the unchanged resource.
- Distinct operation names, not reused from `topic.write_denied_template` (that one means "someone was refused"). Suggested family: `topic.default_added`, `topic.default_edited`, `topic.default_archived`, `topic.default_restored`, `topic.default_reordered`; denial: `topic.default_maintenance_denied`. Names to be ratified by the design.

## 5. Position uniqueness constraints (and what the issue's wording gets slightly wrong)

- Schema: partial unique index `topics_team_active_order ON topics (team_id, display_order) WHERE status = 'active'` (migration 18). Archived rows may share a position; their `display_order` is "not meaningful and not maintained". Applies to the template team like any other.
- Reorder precedent (TOPIC-006): two-step negate-then-set to avoid tripping the index mid-update; 1-based dense after a save.
- The issue says "Keep display positions in the template unique, so a team copied from it can always be created." The real mechanics: `copyCanonicalDefaults` **renumbers** 1..n by `(display_order, id)`, so a gappy or even duplicated template does not break team creation. What a duplicate does break is the **template's own** writes: the partial index rejects it, so a bad insert/reorder fails with a unique violation on the template, not on the new team. And a template with no active defaults breaks creation (500 / rollback, #175). So the invariants that matter, in order:
  1. At least one active default always exists (archive-the-last-one must be refused, or creation and assign-defaults die).
  2. Active positions are exactly 1..N and unique (invariants test (b); `template_anomaly` check flags `duplicate_active_order`, `non_contiguous_order`).
  3. No non-default row on the template (invariant (d)). Invariant (c) is restated below: archived defaults become valid.
- Invariant (c) is the sharp edge: "no non-active default". **DECIDED: option (B).** **MUST:** invariant (c) is restated as "archived defaults are valid state; archived defaults are never copied to new teams", and an archived template default shall not raise `non_active_default` in `template-anomalies.ts` or fail the invariants suite. Original analysis follows. The existing test and `template-anomalies.ts` treat an archived default as an **anomaly** (`non_active_default`). Issue scope says "archive and restore". If an admin can archive a default, the template legitimately has archived default rows, and the anomaly logger will warn on every team creation forever, and invariant (c) fails in CI. Two ways out, a real design decision:
  - (A) Retire = **delete** the template row (or flip `is_default` false?) instead of archive. Loses nothing meaningful for teams (they hold their own copies) but breaks "restore" and audit-friendly history.
  - (B) Keep archive/restore and **redefine** the invariant: archived defaults are legitimate state; update `template-anomalies.ts` (remove or narrow `non_active_default`) and invariants (c).
  Decision: (B), because it keeps a recoverable history for the thing that governs every team, and "restore" then has a real meaning. But it changes a detector #215 shipped; call it out in the spec.
- Because `copyCanonicalDefaults` ignores `status` of source only through `canonicalDefaultsWhere` (active + is_default), archived template rows are never copied: that is what makes archive usable as "retire from new teams".

## 6. The #188 guard, the #215 baseline, and the declined trigger

- **#188 guard (`checkWritableTeam`)** stays untouched. The admin path is a *separate* route with its own handler, not an admin exemption inside the team-scoped handlers. The archived design says: "The spec forbids meeting that need by relaxing this guard." Agree completely.
- **#215 declined trigger** (design.md "Declined: template write trigger", D9). The decline holds only if #216 delivers: (i) every template write through one audited function, (ii) one `audit_log` row per template write, (iii) trigger reconsidered now that a sanctioned writer exists. The issue copies these as acceptance.
  - Reconsideration is a genuine fork. Trigger is a `BEFORE INSERT/UPDATE/DELETE ON topics` rejecting `team_id = sentinel` unless `current_setting('app.allow_template_topic_write', true) = 'on'`. The sanctioned writer sets it with `SET LOCAL` inside the same explicit transaction as the audit row (`withAuditTransaction` already opens one, which neatly sidesteps the `--no-single-transaction` pooled-connection leak the #215 note worried about).
  - Costs listed in #215: migrations 4/11 write the template (a trigger must be numbered after them; future default-topic migrations must opt in); every test that mutates the template (snapshot/restore helpers, `withTemplateLock`) needs the opt-in or a shared helper; hot shared table.
  - Benefit: a *second* writer cannot appear silently, which is the property #215 wanted once a first sanctioned writer exists. It is not a security boundary against anyone with SQL access (setting is trivially set); it protects against code paths and mistakes, and gives the audit function a single place to review.
  - A cheap middle option to put on the table: keep the application-layer guarantee, add a **structural test** that greps/enumerates writers to `topics WHERE team_id = sentinel`. Weaker than a trigger but no schema change. Needs an explicit decision recorded either way; "reconsidered" must produce a written outcome, not silence.
  - **Requirement (BA B10), mechanism is engineering's:** the proposal's design records exactly one of the three outcomes (trigger / enumerating structural test / reasoned decline) with reasons, and some second-writer-prevention mechanism MUST exist. **LEAN:** enumerating structural test as the floor, trigger only if the migration-ordering cost is judged acceptable.
- **Invariants baseline** (`template-invariants-integration.test.ts`, `BASELINE` array, N=12): names, vote types, SHA-256 of `prompt` and `first_session_description`, fixed order. Header says "F5 (#216) MUST update this list when it edits defaults." Think about what that means once *admins* edit at runtime and not migrations:
  - The baseline is a **CI-time** check against a CI database seeded by migrations. A runtime admin edit in production never touches the CI baseline, and the test continues to pass while production diverges. So the baseline test and the audit trail now check different things: the test verifies the *seed*, the audit verifies *runtime changes*.
  - If the product's canonical set moves via admin edits, the migration-seeded baseline becomes a stale "factory default". **DECIDED (BA ruling, PO ack): "canonical" means the current template.** The migration 11 seed is history, not a standard. So FR-8.6's "baseline you can get back to" means "the baseline as currently maintained" (a note on FR-8.6 in the BRD traceability, not a rewrite). **DECLINED:** a "reset to factory" operation; it would be a toggle on the ritual and is not specified.
  - Acceptance line: the baseline is "updated in the same change as any edit to the defaults". For a change that adds the *capability* but edits no default, the baseline stays; but the invariants must be revised where capability legitimately breaks them (archived defaults per section 5; "exactly N" counts if an admin can add or retire a topic). The test must be reshaped from "equals this fixed list" to "satisfies structural invariants (a, b, d, e) + content equals baseline *only when the seed is the latest edit*", or the baseline must be derived from an audited source. **DECIDED (mechanism left to design, acceptance fixed):** the suite verifies structural invariants independent of content, and verifies the seeded content only as a migration-time baseline. The proposal must list by name the invariants that remain (a: sentinel identity/shape; b: active positions exactly 1..N unique; c-restated: archived defaults valid and never copied; d: only default rows on the template; e: at least one active default, plus per-field validity: non-empty name and prompt, valid vote_type, within the length limits in D7) and the single relaxation: the exact-12-and-exact-content assertion becomes "content equals BASELINE only while no audited maintenance write has occurred" or is run against a fresh migrated database only. A legitimate admin edit in a test must not break CI for later tests: maintenance tests take `acquireTemplateLock()` and restore through the shared snapshot helper. The "F5 must update this list" header is rewritten accordingly.
- **Parallel-test hazard.** Tests that exercise the new admin endpoint mutate the shared template. They must take `acquireTemplateLock()` and restore with the shared snapshot helper (negate-then-set), exactly as #188/#215 prescribe. Otherwise the invariants test goes flaky.

## 7. Operations in scope and what could go wrong

Scope per the issue: add, edit, archive, restore, reorder. Edit is new (no team-level edit of prompt/name exists; FR-8.7 annotation is a different column).

| Operation | Hidden hazard |
|---|---|
| Add | **MUST:** new row is `is_default = true`, active, appended at N+1. Required: name, prompt, vote_type, first_session_description (all non-empty after trim). Name unique among active template rows, trim + case-insensitive, error `DEFAULT_NAME_DUPLICATE`. Rejected with `TEMPLATE_AT_CAPACITY` above the cap in D7. |
| Edit | **MUST:** name, prompt and first_session_description are editable; `vote_type` is fixed at creation (change = retire + add; an attempt is rejected `DEFAULT_VOTE_TYPE_IMMUTABLE`). Rename is allowed; its response states that name-based matches (restore, `defaultTopicsNotActive`) for existing teams will no longer pair. Same uniqueness/length rules as Add. No-op edit: 200, no audit row. |
| Archive | **MUST:** refused with `LAST_ACTIVE_DEFAULT` if it would leave zero active defaults; remaining active positions are renumbered dense 1..N. Archived defaults are valid state (section 5). |
| Restore | **MUST:** returns the original template row to active at position N+1 (TOPIC-005 semantics; confirmed). Rejected with `TEMPLATE_AT_CAPACITY` if it would exceed the cap. |
| Reorder | **MUST:** whole-list PUT containing exactly the active template ids; missing or extra ids rejected `REORDER_ID_MISMATCH`. Negate-then-set; affects the first-session order of newly created teams only. |

Concurrency. **MUST (business form):** two admins editing at once never produce a template with duplicate or non-dense positions, and a team created during an edit sees either the complete before-set or the complete after-set, never a mixture. **LEAN (design):** reuse `lockTeamTopics` on the sentinel only and the `TOPIC_ORDER_STALE` 409 pattern for reorder; admins get a plain-language conflict message and the current list to reload, never a silently lost edit. Also concurrent *team creation* during an admin edit: creation copies inside a transaction; a half-applied multi-row edit (reorder) must not be visible, so each admin write is one transaction and the copy should see a consistent snapshot (READ COMMITTED is fine if the reorder is one UPDATE statement; verify).

Failure scenarios if the design drifts, in priority order:

1. **A relaxed #188 guard.** Admin exemption inside the team-scoped handlers. Rejected by the issue; keep it that way. Watch for "for convenience" shortcuts like adding the sentinel id to an allow-list.
2. **A second writer.** Any other code that touches sentinel topic rows (a "reset to defaults" button, a migration helper) bypasses the audit function. The declined trigger or an enumerating test exists to stop this.
3. **Audit that loses what changed.** A row saying "edited a default" with no before/after is useless for the S4 concern.
4. **Fail-open audit on successes.** A template edit that succeeds with no row is silent drift again.
5. **Admin edits breaking new-team creation.** Zero active defaults, duplicate positions, an empty prompt. Creation then 500s for everyone, and I become the help desk. **MUST** validate server-side per the limits in D7, with a distinct error code for each failure and no success audit row on rejection. The maintenance path also works on an empty system (no teams yet) with no special case.
6. **Prompt text that targets individuals or turns into performance tooling.** The persona rule: no individual comparison. Admin-authored prompts are free text delivered to every team. **DECIDED (BA option (a)):** the control is verifiable documentation plus structure, not a content filter. The endpoint documentation (REST API Contract entry, and the screen copy later) MUST state that prompts address the team and the work, never individuals, with two or three good/bad example prompts. Structural guardrails that are testable: the length caps in D7, and plain text only (markup and URLs are rejected `PROMPT_FORMAT_INVALID`). The rest is audit plus review. **DECLINED:** a semantic filter (see section 12).
7. **Edits that make the first session non-canonical in spirit.** First session description (`first_session_description`) and order are part of the lock. Changing them is allowed (that is the point), but only for teams created afterwards; no path may apply an admin edit to a team that is mid-first-session.
8. **Surprising existing teams.** See section 2: restore returns old wording; `defaultTopicsNotActive` name join mismatches after rename.
9. **Admin as a configuration hole for the ritual.** The admin screen must edit topic *content* only. It must not, in this change or via later scope creep, expose lock bypass, facilitator-from-same-team, or manager participation. State this as a requirement ("the maintenance path changes only the template's topic content and order").
10. **Rate-limit and abuse.** **DECIDED:** maintenance writes use the same per-actor limit as team topic writes (`topic-write-rate-limit.ts`), same budget, same 429 code; the 403 path reuses `admitDenialAudit` (bounded per actor) to avoid denial-row floods.

## 8. Shape options (for the proposal stage, no decision)

```
                    existing                       new (#216)
 team-scoped   /api/v1/teams/:id/topics*    ---X--> sentinel => 404 TEAM_NOT_FOUND (#188, unchanged)
 admin-scoped                               /api/v1/admin/default-topics*   (admin only, no teamId)
                                                  |
                                                  v
                     one audited function  writeTemplateTopics(client, op, actor)
                       - BEGIN
                       - [SET LOCAL app.allow_template_topic_write='on']  (if trigger accepted)
                       - lockTeamTopics(sentinel)
                       - domain write + invariants check (>=1 active, dense unique positions)
                       - INSERT audit_log (transactional, 400ms timeout)
                       - COMMIT
```

Route options: (1) a small set of RESTful endpoints (POST add, PATCH edit, POST archive, POST restore, PUT reorder), mirroring TOPIC-003..006 request/response shapes where possible so frontend patterns carry over; (2) a single `PUT` that replaces the whole set. Option 2 is attractive for invariants (one transaction, one audit row, positions made dense by construction) and avoids the stale-order problem, but a whole-set replace makes it easy to drop a topic by omission, and the audit diff is harder to read. Devon's lean: option 1, with reorder as a whole-list PUT as TOPIC-006 already does.

Frontend: **DECIDED, API-only (see D6).** Issue #216 asks for "an endpoint, or set of endpoints" and acceptance ("without a migration") is met by the API. A Topic Management screen for the template is a named follow-up issue, opened before this change is accepted; FR-8.1 is recorded as "partially met, API only" until it ships. I am not putting UI, preview, revert buttons or drag-and-drop in this change.

## 9. Decisions carried into the proposal (formerly open questions)

Blocking items are resolved here. "PO ack" means the Product Owner confirms before the proposal is accepted; the proposal is written against these values.

| # | Decision | Status / owner |
|---|---|---|
| D1 (Q1) | **Archive, not delete** (option B). Archived template defaults are valid; `non_active_default` anomaly and invariant (c) are changed accordingly (section 5). | Decided: BA + Devon; PO ack |
| D2 (Q2) | **`vote_type` is immutable after creation; rename allowed** (scope notice in the response). Change of vote type = archive + add. | Decided: BA; PO ack (removes an arguable part of "edit") |
| D3 (Q3) | **Audit content:** full before/after values of changed fields, ids, operation, actor; one transactional row per successful write; documented exception to the no-topic-text convention. No version table. (Section 4.) | Decided: BA + Devon |
| D4 (Q4) | **Trigger:** proposal records one of three outcomes with reasons; some second-writer prevention MUST exist. Floor is an enumerating structural test. (Section 6.) | Engineering, in design.md; non-blocking |
| D5 (Q5) | **"Canonical" = the current template.** Baseline test reshaped to structural invariants plus seed-as-migration-baseline. No factory reset. (Sections 5, 6.) | Decided: BA (definition); Engineering (mechanism) |
| D6 (Q6) | **API only.** The Topic Management template screen is a named follow-up issue (number recorded in the proposal before acceptance). FR-8.1 traceability: "partially met, API only". Authorization stays admin-only. Until the screen lands, the first real users of the API are developer-level, an accepted interim cost. | Decided: PO |
| D7 (Q10) | **Limits (fixed in code, not configurable):** active defaults min 1, **max 15**; name 1..60 chars; prompt 1..400 chars; first_session_description required, 1..800 chars (after trim, plain text). Rationale: 12 already fills a session; 15 allows modest growth without wrecking the "brief session" property; exceeding it returns `TEMPLATE_AT_CAPACITY`. The proposal must verify all 12 current seeded defaults satisfy these limits (if one does not, raise the limit to the smallest value that fits, do not edit the seed). Numbers are a documented decision, revisited by code change with PO review, never a runtime setting. | Decided: BA proposal; PO ack |
| D8 (Q7) | **Reports:** trends are per topic per team (FR-8.3); no cross-team grouping by default name is in scope. If one is added later it must handle reworded defaults. Devon confirms by grepping report code for name-based grouping before the proposal. | Non-blocking; BA + Devon |
| D9 (Q8) | **Copy:** recovery docs state it hands out the template as of now. No UI/API text may call restored topics "canonical". | Non-blocking; BA |
| D10 (Q9) | **Route namespace:** `/api/v1/admin/default-topics*`, no team id accepted anywhere; #188 structural test and `EXTRA_IN_SCOPE_ROUTES` unchanged. | Decided in design (non-blocking) |
| D11 | **Known consequences** (restore returns the team's own superseded wording; `defaultTopicsNotActive` mismatches after rename): **accepted and documented in the spec**, each with a follow-up issue opened before acceptance (canonical wording on restore; name-join robustness). | Decided: BA + Devon |
| D12 | **Use case:** add "Maintain Default Topic Set" to `08 - Topic Management - Use Cases.md` (actor Application Administrator; preconditions, main flow, alternates: last-active, duplicate name, capacity, concurrent edit, non-admin). Without it FR-8.1 has no traceable use case. | Deliverable of this change |
| D13 | **Rollback of a bad edit:** no undo operation. "Edit it back" using the before-values in the audit row is the sufficient recovery; the API provides a read of the admin's audit history for template rows (below). | Decided |
| D14 | **Reads:** `GET` lists all template defaults including archived (needed to restore), with fields, status, position, and a `lastChangedAt` and `lastChangedBy` per row. | Decided |

Acceptance conditions (Given/When/Then) for the proposal are taken from the BA review section C (items 1 to 14) with D1..D14 substituted; I accept them as written. Additional ones from this revision: reading the template never changes it; a no-op edit writes no audit row; a reorder with missing or extra ids is rejected with `REORDER_ID_MISMATCH`; and the negative test in section 2 (template writes leave existing teams and session snapshots untouched).

## 10. Requirements and sources consulted

- `requirements/BRD.md`: FR-8.1, FR-8.2 (and #208 rationale), FR-8.3, FR-8.6 (and #218 traceability), FR-8.7; Application Administrator definition (l.203).
- `requirements/use cases/08 - Topic Management - Use Cases.md`: Assign Default Topic Set (incl. l.54 existing-team rule), Recover Zero-Topic Team, Restore Default Topics (bulk).
- `requirements/design/REST API Contract.md`: TOPIC-002..007 authorization and ordering notes; `defaultTopicsNotActive`.
- `openspec/changes/archive/2026-10-02-reject-template-team-topic-writes/design.md` (D1 guard shape, D4 structural test, Non-Goals F5) and `.../2026-10-12-harden-team-creation-topic-copy/design.md` ("Declined: template write trigger", D8 invariants).
- Code: `packages/backend/src/routes/topics.ts`, `routes/topic-write-context.ts`, `routes/topic-write-rate-limit.ts`, `sessions/default-topics.ts`, `sessions/template-anomalies.ts`, `auth/audit-logger.ts`, `auth/audit-write-transaction.ts`, `auth/assign-defaults-audit.ts`, `auth/role-map.ts`; migrations 2, 8, 18, 22, 23; `routes/__tests__/template-invariants-integration.test.ts`; `docs/deployment.md` (template anomaly and zero-topic runbook).

## 11. Facilitator and participant impact

From the Facilitator review; kept to what is in scope for an API-only change.

- **Mixed wording across a facilitator's teams.** Real: a team created yesterday runs the old set, one created next week the new set. Accepted consequence of "new teams only" (integrity over uniformity). Mitigation in scope: the read endpoint exposes `lastChangedAt` per default (D14) so a facilitator-facing surface can later show "defaults last changed on X". The team-level record of which wording a team was created with is **not** built here (see section 12); a team's creation date already implies it against the audit history.
- **Restore returns superseded wording.** Accepted limitation (D11), documented in the spec, follow-up issue with an owner opened before acceptance. Bulk and single restore copy must not imply currency.
- **First-session description quality.** Required, bounded, plain text (D7), because it carries first-session onboarding.
- **Session length.** The cap of 15 (D7) is chosen against a realistic session length. Adding a topic does not need an API-level time warning; the follow-up screen should show topic count against the cap.
- **Live-session isolation.** Stated as MUSTs in section 2 with a negative test.
- **Reordering and tone.** First topics set the emotional tone; the endpoint documentation says so. No guardrail beyond that.
- **First real edit.** Before the first production edit, one dry run is done on a non-production database by Devon with a facilitator (Priya offered). This is a rollout step in tasks.md, not a requirement on the code.

## 12. Review feedback: accepted and rejected

**Accepted (incorporated above):** BA B1-B3 and B5-B15 and the gaps in F (use case, empty system, no-op edit, reorder input, archived visibility, rollback); acceptance conditions C1-C14; rewrites D; facilitator items on live-session isolation and negative test, first-session description quality, immutable vote type, size and session length, prompt guidance and format guardrail, plain-language conflict message, named follow-up issues, and confirmation-once-per-edit-session wording.

**Pushed back (rationale):**

| Suggestion | Decision | Rationale |
|---|---|---|
| Admin screen with preview before save, accessible drag-and-drop alternative, mobile layout (Facilitator) | Deferred to the follow-up screen issue | Issue #216 says endpoint(s). A screen is a separate piece of work and review. The requirements are recorded for the follow-up so they are not lost. |
| Admin-facing "previous version" view and one-step revert (Facilitator) | Declined for this change | It implies a version store or revert operation, which inflates scope. Audit rows hold before-values and "edit it back" is the recovery (D13). Revisit with the screen. |
| Facilitator-visible "defaults last changed" note and per-team record of template version used (Facilitator) | Partly accepted: `lastChangedAt` on the read endpoint only | A facilitator-facing UI element or per-team version column adds schema and surface to the team and session flows, which this change must not touch (section 2). Follow-up. |
| Notify facilitators of teams in first-session-pending state (Facilitator) | Declined | Decided: no one is notified. Notification machinery is out of scope and risks making the tool prominent. The existing "new teams only" rule is the stable contract. |
| Staging copy / draft-then-publish for template edits (Facilitator Q5) | Declined | Adds a second template state and a publish step, i.e. a new subsystem. Mitigations instead: audit, immutability of vote type, capacity and validation limits, and the dry run before the first real edit. |
| Semantic content filter or word blocklist for prompts naming people (Facilitator, implied) | Declined | Not reliably testable, easy to bypass, and false confidence. Documentation, format and length guards, and audit are the controls (hazard 6). |
| Rename confirmation as a hard blocker (Facilitator) | Accepted only as a response notice | An API cannot confirm interactively; the follow-up screen shows a confirmation. |
| Research which defaults actually cause confusion (Facilitator observation 1) | Outside this change | Valuable product input and the reason a first edit will happen, but it is a PO and facilitator activity, not a code requirement. Raised as a question to the PO; the endpoint is the means, not the content decision. |
| Recording that some template-wide trend comparisons may mislead (Facilitator Q3) | Answered by D8 | No cross-team by-name view is in scope. |
| Template max of 24 (BA B2 suggestion) | Lowered to 15 | 24 would double a session that 12 already fills; this protects the brief-session property. Subject to PO ack. |
