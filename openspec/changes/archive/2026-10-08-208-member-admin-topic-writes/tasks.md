# Tasks: 208-member-admin-topic-writes (#208)

Tasks are listed in implementation order. Every section must end with the full backend (unit **and** real-Postgres integration) and frontend suites green, and `tsc` clean on the build config (test-file `tsc` errors are pre-existing and identical to `main`: 243 = 243). Section 2 is one vertical slice: its test conversions (2.1–2.6) go red first, for the right reason (they expect `200` and get `403`), and the slice is green only at its gate (2.18–2.19). Do not try to verify green inside section 2 (architect A2).

**Standing constraints for every task:**

- `packages/backend/src/auth/standing-facilitator-access-helper.ts` has **no diff**. `packages/backend/src/routes/topics.ts` has a **comment-only** diff (design D5).
- No facilitator path, session endpoint, TOPIC-001 or TOPIC-007 code changes.
- No test assertion about the `topic.*` write audit rows is weakened. No fail-closed test on the TOPIC-002 admin arm is deleted without a replacement.

## 1. Test fixture and pins against unchanged code

These run before the TOPIC-002 change, so they prove the "writes and TOPIC-007 are unchanged" claims (design D5) against unchanged code. A later failure then points at this change.

- [x] 1.1 Extend `Fixture.member` in `packages/backend/src/routes/__tests__/helpers/real-db.ts` (~L236) to `member(teamId, userId, role = "participant")` with a `$3::membership_role` cast; existing callers are unchanged. In `topic-002-admin-audit-integration.test.ts`, keep the local `membership()` helper (~L82) **only** for the `removed_at` case (~L241, `removed = true`; `Fixture.member` gets no `removed` option); every other seed in that file uses `Fixture.member` (architect A3).
- [x] 1.2 Add one new file, `topic-write-member-admin-integration.test.ts` (name it in the PR), with a real-Postgres case per write endpoint (add, archive, restore, reorder) for an admin with each of: no membership, a `participant` membership, an `engineering_manager` membership. A parametrised test covering the 12-case matrix is fine. Each case asserts (BA F4):
  - the response status;
  - the persisted outcome the spec scenario names, in the response **and** the database: add → the topic is appended at the end of the team's display order (`displayOrder = n + 1`); archive → `status: 'archived'`; restore → `status: 'active'`; reorder → the submitted order is persisted;
  - exactly one in-transaction row with the named operation (`topic.custom_added`, `topic.archived`, `topic.restored`, `topic.reordered`), `actor_global_role = 'application_admin'`, the actor's user id and the team id. Count rows **per request**, filtered by actor, team and operation, so a shared fixture cannot produce a false pass.

  Spec scenarios: `add-custom-topic`, `remove-topic`, `restore-topic`, `reorder-topics`. The EM column exists nowhere today (existing coverage uses participant memberships only), so this is new work, not a confirmation (engineer E2).
- [x] 1.3 TOPIC-007 manager-admin pin (BA F1; `topic-annotation` scenario "An administrator who manages the team still cannot change the annotation"). In `topic-annotation-integration.test.ts` (real Postgres), add a parametrised case for an `application_admin` with an `engineering_manager` membership and with a `participant` membership: `PUT .../annotation` → `403`, and the topic's `team_annotation`, `annotation_updated_by` and `annotation_updated_at` are unchanged. No existing test covers a member admin here: every admin case in `topic-annotation.test.ts` (~L238, L765, L801) uses a non-member admin.
- [x] 1.4 Gate: backend unit + integration and frontend suites green; `tsc` clean on the build config only (test-file `tsc` errors are pre-existing, identical to `main`: 243 = 243).

## 2. TOPIC-002 admin arm revert (one vertical slice)

Files: `packages/backend/src/routes/content.ts`, `packages/backend/src/auth/audit-logger.ts`, and the tests that pin them. Tests first, then code, then comments, then the gate. The producer (`content.ts`) stops emitting `admin.topic_config_denied` before the registry drops it (architect A1).

### Tests first (red until 2.7–2.11 land)

- [x] 2.1 `content.test.ts`: convert "#232: an application_admin with an engineering_manager membership gets 403 with no topic/team/lock query" (~L1139) to "gets 200 with topic data and exactly one `admin.topic_config_accessed` row with `membership_role: "engineering_manager"`". Seed an active topic annotated `"X"` and an archived topic annotated `"Y"`, and assert the structured event payload contains neither `"X"` nor `"Y"` (BA F3; `topic-annotation` scenario).
- [x] 2.2 `content.test.ts`: add (or parametrize) an admin case for each of no membership, `participant`, `engineering_manager`: `200`, one access row whose `membership_role` matches, tail order insert < event < floor < send, and **no** `admin.topic_config_denied` insert on any path. Run the existing access-row exact key-set test (~L1615–1647) with an `engineering_manager` membership as well as without one (BA §3, `topic-customization-lock` audit key-set scenario); parametrising it is enough.
- [x] 2.3 `content.test.ts`: delete the denial-only tests (denial insert failure, denial tail order, denial key-set ~L1684–1694, deny-path role-set failure, imports of the removed message constants). **Convert, do not delete,** the `membership_unrecognised` test (~L1597, `membershipRole: "observer"`): `observer` → `200`, one access row with `metadata.membership_role: "observer"`, event `membershipRole: "observer"` (design D2, engineer E1). Keep the "rejected membership read … emits no `admin.audit_write_failed`" test unchanged. Keep the fail-closed tests for the membership read, role-set read and access insert, the `admin.audit_write_failed` payload test, and the `assertTopic002AuthorizedRole` tripwire test (reword its "#208" comment).
- [x] 2.4 `topic-add-flag-parity.test.ts`: delete the `{ get: 403; post: 201 }` variant from `Expected` and its exception branch; the "application_admin with an engineering_manager membership" row becomes `ADMITTED_CAN_ADD`. Keep the `servedMembershipRoles` assertion on every admin row. Reword the fake's `INSERT INTO audit_log` comment (no "_denied").
- [x] 2.5 `topic-002-admin-audit-integration.test.ts` (~L118): EM-member admin (seeded with `Fixture.member(..., "engineering_manager")`) → `200`, with (BA F3):
  - an active topic annotated `"X"` and an archived topic annotated `"Y"`, both texts present in the response's active and archived lists;
  - `canEditAnnotations: false` and `canAddTopics: true`;
  - one `admin.topic_config_accessed` row with `membership_role: "engineering_manager"`, `metadata.annotated_count = 2`, `actor_roles` written, and neither `"X"` nor `"Y"` anywhere in the row;
  - no `admin.topic_config_denied` row.

  Update the file header comment (~L13, "gets 403 and no topic data").
- [x] 2.6 Same file (~L238): keep "removed EM membership" as a `membership_role: null` regression (local `membership()` helper, task 1.1); reword its rationale. (~L215) global EM with a participant membership → `403`, no `admin.*` row: unchanged.

### Code

- [x] 2.7 `content.ts`: delete `evaluateAdminTopicConfigRead`, the `AdminTopicConfigRead` type, and the exported `ADMIN_IS_TEAM_MANAGER_MESSAGE` / `ADMIN_MEMBERSHIP_NOT_ADMITTED_MESSAGE` constants.
- [x] 2.8 `content.ts`: delete the admin deny branch (denial insert, denial event, timing floor, `403`). Narrow `Topic002AdminOperation` (and the `dueOperation` selection) to `"admin.topic_config_accessed"`.
- [x] 2.9 `content.ts`: keep `readActiveMembershipRole(session.userId, teamId)` on the admin arm, before the data reads, and pass its raw result to the access row as `metadata.membership_role` / event `membershipRole` with no allow-list (design D2). Widen `adminAudit.membershipRole` from `null | "participant"` to `string | null`; do **not** cast to the known enum values (a cast is a hidden allow-list; engineer E4). A failed read still propagates to `500` with no data, outside `withAdminAuditFailureSignal`, as today (security S-1 deferred; design disposition).
- [x] 2.10 `content.ts`: keep the role-set read, `insertTopic002AdminAuditRow`, `withAdminAuditFailureSignal` and the tail order (insert → event → `applyTimingFloor` → send) unchanged.
- [x] 2.11 `audit-logger.ts`: remove `"admin.topic_config_denied"` from the `AuditEventName` union, with its comment block. This comes after 2.7–2.8 so `tsc` never sees a producer of a name the registry no longer has (architect A1).

### Comments

- [x] 2.12 `audit-logger.ts`: edit the `admin.topic_config_accessed` comment: `membership_role` is the raw live value (`null`, `"participant"` or `"engineering_manager"` today, or any future enum value, recorded raw), audit data only, not an admission input (#208). The set is open: the comment must not read as an allow-list (design D2, architect minor). Drop the "no-manager rule" framing (the comment's text is "no-manager", e.g. ~L160; the "#238" wording lives in `docs/deployment.md`, task 5.8, not here); keep the change-folder reference `232-topic-002-admin-read-audit-no-manager` as a historical slug. Keep the text-free rule, the visibility guard and the backfill limit.
- [x] 2.13 `audit-logger.ts`: edit the `admin.audit_write_failed` comment: on TOPIC-002 it can only carry `operation = "admin.topic_config_accessed"`.
- [x] 2.14 `content.ts`: keep `assertTopic002AuthorizedRole`; reword its comment to "guards the audited admin arm" (no "no-manager" wording, no "#208 will reopen that helper"). Keep, restated, the reason it exists: "a role admitted by the shared helper in future must not reach the data unaudited" (security S-2).
- [x] 2.15 `content.ts`: rewrite the handler's authorization comment block to describe the audit only, citing #208 (reverses #232's no-manager rule), **preserving the Decision 8 note** (~L825: "Two small reads, not one users/team_memberships join: content.ts runs no SQL against team_memberships (access-control Decision 8)"). Specifically reword ~L836–839 ("either insert … The deny branch below returns before any team-name/topic/lock read") and the in-handler ~L841–846 ("#208 will reopen that helper … silently skipping the no-manager check and audit"), engineer E5. Remove the "Do NOT move this check into the shared helper" note and the `canAddTopics` comment about the EM-member admin and the `GET 403 / POST 201` exception. The `canAddTopics` expression is unchanged.
- [x] 2.16 `topics.test.ts` (~L844): reword "F1's interim compensating control" to "the permanent audit record of admin topic writes (#208 decision)". Keep "do not weaken". Assertions unchanged.
- [x] 2.17 `topic-add-admin-integration.test.ts` (~L19): reword the header comment to "the permanent audit record of admin topic writes (#208 decision) — do not weaken these assertions". Member-admin cases on add/archive/restore/reorder stay.

### Gate

- [x] 2.18 Regression pins: existing tests, unmodified, still pass. One line per proposal constraint (BA F2), so the PR can list constraint → pin:
  - Facilitator TOPIC-002 issues no extra `team_memberships` query: `content.test.ts` ~L1881 ("3.6: a non-member facilitator gets 200 …").
  - Member-facilitator `403 FACILITATOR_IS_TEAM_MEMBER` on TOPIC-002..006: `content.test.ts` ~L1898 (TOPIC-002) and `topics.test.ts` (~L150, ~L965) for the writes.
  - Global EM `403 NOT_A_FACILITATOR` on TOPIC-002 whatever the membership: `content.test.ts` ~L1928 ("3.7"); on TOPIC-003..006: `topics.test.ts` ~L966 and ~L990.
  - TOPIC-007 rejects admins: `topic-annotation.test.ts` ~L238 (non-member) plus task 1.3 (member admins).
  - TOPIC-001 admin `admin.session_content_denied`: `content.test.ts` ~L666 ("→ 403 with exactly one admin.session_content_denied audit row").
  - FR-2.1 / FR-2.2, a facilitator cannot create a session for a team they belong to: `facilitator-sessions.test.ts` ~L361 ("2.3/2.6/2.7").
  - Admins create no sessions (FR-2.1) and take no part in sessions (FR-1.3, FR-2.4, #243 D11): `admin-session-exclusion-integration.test.ts` (~L42, ~L113, ~L134) and `sessions.test.ts` ~L813.
  - Timing floor on the TOPIC-002 `403` exits that remain: `content.test.ts` ~L1219 ("applies the timing floor on the 403 branch").
  - Audit visibility guard (exact-operation filter, no prefix match): `content.test.ts` ~L265.
  - `topic-annotation-integration.test.ts`: unchanged apart from task 1.3; green (architect A6).
- [x] 2.19 Gate: `tsc` clean on the build config only (test-file `tsc` errors are pre-existing, identical to `main`: 243 = 243); backend unit + integration and frontend suites green.

## 3. Write wrappers (`packages/backend/src/routes/topics.ts`) — comments only

- [x] 3.1 In `checkAddCustomTopicAuthorization`, `checkArchiveTopicAuthorization`, `checkRestoreTopicAuthorization`, `checkReorderTopicsAuthorization`: replace any "pending #208" / "interim" wording with "admits `application_admin` whatever their membership on the team (#208 decision; BRD FR-8.2)". No code change. Suites green.

## 4. Frontend

The page never knows the caller's membership: it renders whatever TOPIC-002 returns. These tests are therefore fixture-based ("an admin-shaped `200` renders correctly"); the membership half of each manager-admin scenario is pinned by the backend (tasks 2.4, 2.5). Each test name cites its `topic-management-screen` scenario. The nav scenario "sees the link and the screen" maps to 4.3 (link) plus 4.4 (screen) (BA F5).

- [x] 4.1 `TopicManagementPage.tsx`: reword the 403-handling comment (no "no-manager rule" example). Code unchanged.
- [x] 4.2 `TopicManagementPage.test.tsx`: re-anchor "renders that exact message" on the `FACILITATOR_IS_TEAM_MEMBER` message (any envelope message works; behaviour is generic; the test uses a literal string, not a backend import). Fallback and non-JSON tests unchanged.
- [x] 4.3 `TeamPage.test.tsx`: keep the "Topics link not hidden by role or membership" assertion; reword its comment (the link leads to a working screen for every admin).
- [x] 4.4 Add a page test: admin with `canEditAnnotations: false` sees definitions read-only (if not already covered by the existing admin read-only test, extend its fixture comment to note membership is irrelevant).
- [x] 4.5 Add a page test for the scenario "An administrator who manages the team has the topic write controls": on an unlocked team with `canAddTopics: true` and `canEditAnnotations: false`, each active row has Remove, the add-topic control and reorder controls are shown, the removed-topics list offers Restore, and no definition add/edit/clear control is shown.
- [x] 4.6 Gate: frontend suite green.

## 5. Requirements and docs

- [x] 5.1 New `requirements/use cases/08b - Member Admin Topic Writes - Decision.md` (01c format), containing:
  - **Rule:** administrators are admitted to TOPIC-002..006 whatever their membership on the team.
  - **Decision, verbatim and attributed:** the product owner, answering #208: "No, admins are a trusted role and should not be constrained from any features except facilitating their own team." Selected outcome, in the owner's words: "No bar, and undo #232." Do not paraphrase the quote as a general rule anywhere in 08b.
  - **Scope:** this decision is applied to topic configuration reads and writes (TOPIC-002..006) only. The following administrator restrictions are **not changed by this decision and remain in force**: no session participation, registration, votes or live session events (FR-1.3, FR-2.4, Constraint 2, #243 D11); session-content denial (`team-content-access` Option B: trends, sessions, action items, notes); TOPIC-001 denial with `admin.session_content_denied`; no annotation authoring (TOPIC-007, FR-8.7 definitions); admins create no sessions (FR-2.1). Global engineering managers stay out of TOPIC-002..006.
  - **Open item for the owner (not in scope here):** read literally, the owner's broader statement ("should not be constrained from any features except facilitating their own team") would reach the restrictions listed above, none of which is facilitating. Whether to revisit any of them is a separate decision for the owner. This change does not act on it. Relaxing any of them goes back through security review: admin access to session content (votes, trends, notes, action items) is a different data class from topic configuration, and R-EXEC-1's acceptance does not cover it (security D-2).
  - Alternatives A/B/C/D with one line each; what it reverses (#232 / PR #259 `dce3b35`; "interim" status of write audit rows); what it keeps (access row, facilitator member bar, admin session exclusion).
  - **Audit-row content**, in the wording of design D6: the access row carries no topic names, ids or definition text; the `topic.*` write rows carry topic ids (and endpoint-specific counts) but no topic names or definition text. State that the actor's membership role at the time of a write is reconstructed from `team.role_changed` / manager-association audit history, not from the current `team_memberships` row (security S-4), and that the admin audit rows are **forensic** (read after an incident or on request), not monitored (security D-1).
  - **Disclosed risk R-EXEC-1** (proposal "Disclosed risk"), with its mitigations and residual risk, and the champion's risk note, both recorded as accepted by the owner.
  - "This change is the implementation".
- [x] 5.2 `requirements/BRD.md` FR-8.2: "After a team's first session, a facilitator who is not a member of the team, or an Application Administrator, shall be able to add, remove, restore, or reorder topics for that team. An Application Administrator may do so whether or not they hold a membership on the team, in any role." Add a short rationale labelled "added by #208".
- [x] 5.3 BRD FR-8.7 rationale (~L341): delete ", except an administrator who holds an engineering manager membership on that team (no-manager rule; #232)".
- [x] 5.4 BRD Constraint 2 (~L652): delete the final #232 sentence. The D11 session-participation sentence stays word for word.
- [x] 5.5 BRD FR-1.3 admin bullet: keep the session exclusion untouched; add "They may read and change any team's topic configuration (FR-8.2)." Add the missing FR-8.2 traceability row.
- [x] 5.6 Use Case 08: delete the "Administrator who holds an engineering manager membership on the team" alternate flow (~L472). Keep the "Every administrator view is recorded in the audit log" acceptance criterion. Also (BA F8): change the **Actor** lines of *Remove a Topic* (~L190), *Re-Add a Previously Removed Topic* (~L384) and *View Active Topic Configuration* (~L448) to the FR-8.2 wording "Facilitator (or Application Administrator, per FR-8.2)"; in *View Active Topic Configuration*, add the acceptance criterion "An Application Administrator can view the screen for any team, whatever their membership on it; team definitions are shown read-only."; and change "Reorder controls are only available to the Facilitator, not to Engineers" (~L297) to "... only available to the Facilitator or an Application Administrator, not to Engineers".
- [x] 5.7 `requirements/design/REST API Contract.md`: TOPIC-001 note (~L566) → "audits every administrator read (#232, #208)"; TOPIC-002 Authorization (~L632–634) → drop the no-manager clause and paragraph, add "An `application_admin` is admitted whatever their membership on the team (#208, reversing #232's no-manager rule)."; remove the two admin `403` rows and names (~L696–700), keep the `404` clarification; annotation-fields note (~L703) and audit note (~L706) per exploration §6; TOPIC-006 Authorization (~L913) drop the #232 clause; Appendix B TOPIC-002 row "Yes; every read audited", TOPIC-003..006 rows "admin (any team, any membership, per FR-8.2 / #208)". Where the contract names the membership roles recorded in `membership_role`, say "any value of `team_memberships.role` (today `participant` or `engineering_manager`)", not a closed list (BA §4). Docs-only; no suite change.
- [x] 5.8 `docs/deployment.md`: drop `admin.topic_config_denied` from the durable admin-read list and the `actor_roles` writers list (~L291); `admin.audit_write_failed` fires on the access-row path only (~L302); replace "Review queries (#232 compensating control)" with one uncadenced on-demand lookup (design D6), labelled forensic, not monitored (security D-1), removing the self-demotion query, the proposed owner/cadence line and the "Until #238 revisits admission" line; add the hygiene line from design D6 ("Keep Application Administrator team memberships rare", the reason: a manager-admin can read the team's definitions and change its agenda, and the check: review `team_memberships` rows held by `application_admin` users at each access review, each with a stated reason, plus the IdP-overlap sentence: an administrator also in the manager or facilitator IdP group bypasses those groups' restrictions on topic configuration), labelled guidance, next to the existing facilitator/manager/admin group-overlap hygiene line (security S-3). Wherever the page relies on joining write rows to `team_memberships`, use the design D6 point-in-time wording instead (security S-4). Where the page describes audit-row content, use the design D6 wording (access row: no topic names, ids or definition text; `topic.*` write rows: topic ids, no names or definition text).


## 6. Pre-PR verification and PR

- [x] 6.1 Verify `git diff main -- packages/backend/src/auth/standing-facilitator-access-helper.ts` is empty and `git diff main -- packages/backend/src/routes/topics.ts` touches comments only. Run it here, over the whole change, not mid-plan (architect A5).
- [x] 6.2 `grep -rn --exclude-dir=dist --exclude-dir=node_modules "no-manager rule\|ADMIN_IS_TEAM_MANAGER\|ADMIN_MEMBERSHIP_NOT_ADMITTED\|topic_config_denied\|evaluateAdminTopicConfigRead\|membership_unrecognised" requirements docs packages` returns only: TOPIC-001/#187 no-manager references (unrelated); `packages/backend/src/auth/role-map.ts` (~L130) (the OIDC manager-mapping rule, unrelated; do not "fix"); and historical/retired mentions explicitly labelled as such. (Untracked `packages/backend/dist/` still holds the old names; it is excluded, not edited.) `openspec/specs` is checked at archive, task 7.2 (architect A4).
- [x] 6.3 Run the full backend unit + integration suites and the frontend suite; all green. Produce a scenario → test table for the PR covering every scenario in the eight delta specs, each marked **existing / converted / new** with the test file. Any row with no test blocks the PR (BA F7).
- [x] 6.4 PR description: states the owner's decision verbatim and attributed, links the 08b decision record, lists the preserved constraints (proposal "Constraints this change must preserve") each with its pin from task 2.18, notes the empty helper diff and comment-only `topics.ts` diff, discloses R-EXEC-1, and lists the suggested issue actions from `exploration-notes.md` §7 for a human (no issue is edited by this change), with security's notes: close #260 as **superseded by #208** (not "won't fix"), noting its no-self-approval proposal returns if an admin's membership role ever matters again; keep #264 open, cite the `topic.*` write-denial operations as precedent instead of `admin.topic_config_denied`, and do not close it as "related to #208". Candidate follow-ups for a human: membership fields (`membership_role`, `actor_roles`) on admin `topic.*` write rows (security S-4 b, Security-owned); a `membership_read` stage on `admin.audit_write_failed` (security S-1, deferred); an automated source scan for the audit visibility guard alongside #264 (security D-5). It also includes:
  - One line asking the owner to **confirm the scope** recorded in 08b (topic configuration only; the other admin restrictions stay, and revisiting them is an open item). This is a confirmation, not a re-decision.
  - A checklist item: **#187 release note — owner re-approval required before release.** Replace "Engineering managers, including administrators who manage the team, cannot read the team's definitions" with "Engineering managers cannot read the team's definitions. Application administrators can, including one who manages the team; every administrator read is audited." The release must not ship with the old line. (No release-notes file in the repo carries it; the approved line lives in the archived #232 `handoff-drafts.md`, so the correction goes to the owner with the PR.)
  - A **BREAKING (permissive)** API line (BA F8): "API: TOPIC-002 no longer returns `ADMIN_IS_TEAM_MANAGER` / `ADMIN_MEMBERSHIP_NOT_ADMITTED`; the only in-repo client handles `403` generically."
  - The scenario → test table from 6.3.

## 7. At archive (after the PR merges; not a PR gate)

- [x] 7.1 (Done at sync.) At sync/archive time, edit the Purpose paragraphs of `openspec/specs/reorder-topics/spec.md` and `openspec/specs/restore-topic/spec.md` to drop "TOPIC-002 shares the facilitator side but adds a no-manager rule to its admin side, #232" (Purpose is not a requirement block, so the delta cannot carry it; design D7).
- [x] 7.2 (Done at sync.) After sync and 7.1, run the 6.2 grep over `openspec/specs`. It returns only: TOPIC-001/#187 no-manager references (unrelated); `openspec/specs/oidc-role-mapping` (the OIDC manager-mapping rule, unrelated; do not "fix"); historical/retired mentions explicitly labelled as such.

## Task review disposition

Reviews: `tasks-review-architect.md` (Ingrid Sollenberger), `tasks-review-ba.md` (Marcus Delgado). Tasks were renumbered; the proposal's and design's task references were updated to match.

| Finding | Disposition | Where |
|---|---|---|
| Architect A1 (registry drops the name before the producer stops) / BA F6 | **Accepted.** `AuditEventName` change is now 2.11, after the `content.ts` code tasks. | 2.7–2.11 |
| Architect A2 (sections 1–3 and 4.1 cannot each be green) / BA F6 | **Accepted, option 1.** One vertical slice, tests first; preamble states the slice is green only at its gate. | Section 2, preamble |
| Architect A3 (fixture after its users) / BA F6 | **Accepted.** Fixture is 1.1; local `membership()` kept only for `removed_at`. | 1.1, 2.6 |
| Architect A4 (8.2 depends on post-merge sync) | **Accepted.** Grep split: pre-PR over code and docs (6.2), at archive over `openspec/specs` (7.2); Purpose edits move to the archive section. | 6.2, 7.1, 7.2 |
| Architect A5 (whole-change diff check mid-plan) | **Accepted.** | 6.1 |
| Architect A6 (confirm tasks belong at the gate) | **Accepted.** | 2.18 |
| Architect: write matrix before the slice | **Accepted.** | 1.2 |
| Architect minor (proposal "task 6.4") | **Accepted.** Proposal now cites 4.5 (old 6.5). | `proposal.md` |
| Architect minor (open `membership_role` set in comment) | **Accepted.** | 2.12 |
| BA F1 (no TOPIC-007 test for a member admin) | **Accepted.** New real-Postgres case, EM and participant memberships. | 1.3 |
| BA F2 (constraints not all pinned) | **Accepted.** Each constraint names an existing test; no new tests needed, since each one is already pinned in the cited file. | 2.18 |
| BA F3 (4.1 under-asserts) | **Accepted.** Archived `"Y"`, `annotated_count = 2`, both flags; event has no `"X"`/`"Y"` at unit level. | 2.1, 2.5 |
| BA F4 (writes assert status only) | **Accepted.** Persisted outcome per endpoint; row count per request. | 1.2 |
| BA §3 (access-row key set with an EM membership) | **Accepted.** Parametrise the existing key-set test, no new test. | 2.2 |
| BA F5 (frontend tests are fixture-based) | **Accepted.** Section note and scenario mapping. | Section 4 |
| BA F7 (scenario → test table) | **Accepted.** Produced at the final gate; an empty row blocks the PR. Targeted: the table cites existing tests, it does not re-test them. | 6.3, 6.4 |
| BA F8 (BREAKING note in the PR) | **Accepted.** | 6.4 |
| BA §4 (REST wording must not close the membership-role list) | **Accepted.** | 5.7 |


**6.3 outcome (2026-10-09):** suites green (shared 30; backend 1773 passed, 3 skipped; frontend 718). The scenario → test table (`scenario-test-table.md`) has 87 rows; 86 are covered. The one uncovered row, team-content-access "Application Admin who adds themselves to a team is detectable from audit log", is older than #208 and names a non-existent endpoint. The product owner exempted it from this gate; follow-up #267.
