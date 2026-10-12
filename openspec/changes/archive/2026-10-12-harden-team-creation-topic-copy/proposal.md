# Proposal: harden-team-creation-topic-copy (#215)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (decisions D1-D12, acceptance conditions C1-C12) with `explore-review-ba.md` and `explore-review-facilitator.md`. Traceability: issue #215; BRD 6.4 (Default Topic Set Must Be Preserved and Restorable), FR-8.1 and FR-8.6; openspec spec `default-topic-provisioning`.*

## Why

The default topic set is the shared language of the ritual (BRD 6.4). Today the code that hands that set to a new team has two defects, and both are the kind of failure I worry about most.

1. **It is not status-aware.** The team-creation copy in `facilitator-sessions.ts` selects `team_id = template AND is_default = true` and omits `status`. Every copied row therefore lands `active`, so an *archived* template default is not skipped, it is **resurrected as active** in the new team. The restore list in `content.ts` (`defaultTopicsNotActive`) also ignores `dt.status`, so the same archived template row is offered as "a default you can restore" on every team. The copy and the restore list disagree with the snapshot layer, which already reads active topics only.
2. **It can fail every team creation.** Since migration 18, `display_order` is unique only among active rows. If the template ever holds an archived and an active row at one position, the copy inserts both as active at that position, `topics_team_active_order` fires `23505`, the whole transaction fails, and the handler (which maps `23505` only on the `teams` insert) answers 500. Every team creation fails until someone repairs data by hand.

Two failure shapes, and they are not equally bad. The 500 is loud: a facilitator in front of a new team hits an error, which is a bad adoption moment (my success criterion 1: a team I have never met adopts the ritual without me). But the resurrected default or reordered baseline is **silent**: nobody sees it, and cross-team comparability quietly erodes, which is the drift 6.4 exists to prevent. So the fix must stop the failure *and* make a damaged template visible to an operator, not just make the symptom go away.

## What Changes

- **Policy, stated up front (assumption, D1).** An archived default on the template is a data fault, not a feature. It is never copied and never offered for restore. It is *not* a way to retire a default for new teams; that is an F5 (#216) decision, made by an Application Administrator through an authorized path (FR-8.1).
- **One definition of the canonical default set (D1, D6).** The predicate `team_id = <template> AND is_default = true AND status = 'active'`. Both the copy and `defaultTopicsNotActive` use it. How they share it is in `design.md`. The twelve names are not hard-coded in application code; they appear only in the invariants test (D8).
- **Team-creation copy takes active defaults only and numbers them 1..n (D1, D2).** Positions are computed explicitly in template `display_order`, ties by `id`. A new team's active topics always have contiguous positions with no gaps or duplicates, whatever the template's history. For a healthy template (1..12) the result is identical to today. Copied columns remain the explicit list (name, prompt, vote_type, is_default, first_session_description); annotation columns stay unset.
- **`defaultTopicsNotActive` is driven by active template defaults (D5).** The status filter goes on the template side (`dt`) only, never on the team side (`t`), so a team that holds its own archived copy of an active default still sees it with `isArchived: true`.
- **Template anomaly signal (D3).** When the copy sees any of four anomalies on the template (defined precisely in the "Anomaly semantics" section below), creation still succeeds and exactly one `warn` log entry, message `template_anomaly`, is written with `templateTeamId`, `anomalies`, `topicIds` and `correlationId`. A healthy template writes nothing. No facilitator-facing banner, copy or response field (D11).
- **Zero active defaults keeps its existing contract (D4).** `NoActiveTopicsError` still rolls back and answers 500 `internal_error` with the existing plain-language message, no ids. This change pins it with a test; it does not invent a new status or code.
- **Template invariants test (D8).** A CI integration test asserts twelve active defaults with the baseline names, positions exactly 1..N, no non-active default, no non-default row, no memberships or sessions on the sentinel. It is the cheap substitute for the declined trigger.
- **#188 regression suite updated (C9).** `template-team-creation-regression-integration.test.ts` compares active defaults only and renumbered positions.
- **Trigger declined, on the record (D9).** The optional `BEFORE INSERT/UPDATE/DELETE` write-guard trigger on `topics` is not built. `design.md` carries the "Declined: template write trigger" section; a task on F5 (#216) reopens it.
- **One-time read-only data check (D7).** Before merge, the implementing engineer runs a read-only count of non-template teams holding an active default whose name is not among the template's active defaults, and records the result in `tasks.md`. Pass criterion: count = 0 means proceed; count > 0 means a remediation issue is opened and its number recorded before merge, and a one-line report goes to Rachel Okonkwo. No repair is built into this change.

Forward-only: teams created while the bug was live are not repaired here.

## Definitions

- **Template**: the `topics` rows of the sentinel `__default_topics__` team (`00000000-0000-0000-0000-000000000001`).
- **Canonical order**: template `display_order` ascending, ties broken by `id` ascending. Defined once here; the spec, tests and design use this term.
- **Canonical default set**: template rows where `is_default = true AND status = 'active'`.

## Anomaly semantics (V1-V4)

All checks read every template row, of any status. One `template_anomaly` entry is written per creation request, listing every anomaly type that applies.

| Anomaly | Fires when | `topicIds` contribution |
|---|---|---|
| `duplicate_active_order` | two or more **active default** rows share a `display_order` | all rows sharing a duplicated position |
| `non_active_default` | a row with `is_default = true` has `status` other than `active` | each such row |
| `non_contiguous_order` | the **distinct** `display_order` values of the active default rows, sorted, are not exactly 1..m (m = number of distinct values). A nonzero start (0, 2, ...) or any hole fires it. Duplicates alone do not fire it (they fire `duplicate_active_order`); the two checks are independent | none (a position problem names no single row); the list may be empty for this type |
| `non_default_row` | any row with `is_default = false`, **whatever its status** (archived non-default rows count) | each such row |

- `topicIds` is the de-duplicated union of the contributions, in canonical order then id, capped at 50 ids. The template is expected to hold 12 rows, so the cap only bounds a pathological template and is not expected to bind.
- **No de-duplication across requests.** Concurrent or repeated creations against a damaged template each write one entry. A persistent fault is therefore noisy in the log. That is intended: the fault needs an operator to repair the template, and a noisy log is the signal. No rate limit, counter or alert is added.
- **Isolation and placement.** The anomaly read runs after `COMMIT`, on the connection pool rather than the creation transaction's client, so a failure in it cannot abort or fail creation; it therefore logs only for requests that created a team. It observes post-copy state under read-committed isolation. A concurrent edit to the template may make it see a different state than the copy did; either state is acceptable, because the copy never fails on position anomalies and the log is a diagnostic only.
- **Log content.** The entry carries ids and anomaly codes only, never names, prompts or other row text. `correlationId` is the request's `request.id`, the same id pino binds to every other log line of that request.
- **Pre-existing rows.** The new team has no topic rows before the copy (its id was just generated), so "positions 1..n with no gaps or duplicates" depends only on the copy.
- Template columns are already constrained by the database (for example `vote_type`), so invalid column values are out of scope. A NULL `first_session_description` copies as NULL.

## Ritual constraints preserved (non-goals)

This change is provisioning only. It touches none of the following, and none becomes configurable:

- **Simultaneous reveal:** untouched.
- **No-manager rule:** untouched. No change to who may join a session.
- **Facilitator from another team:** untouched.
- **Default set visible and restorable (FR-8.6):** *strengthened*, not weakened. The canonical set is defined once, restore still works for a team's own archived copy of an active default, and nothing here lets a team or an API caller retire a default.
- **Constraints structural, not preferential:** no flag, setting or override is added; the anomaly log is observability, not a switch.
- **Facilitator-visible behaviour: none (D11).** A healthy-template creation looks identical to today. Diagnostics stay operator-side.
- **Not a performance tool:** no individual data is read or surfaced.
- **Access rules unchanged.** The `topic-customization-lock` delta is a wording restatement of the `defaultTopicsNotActive` contents. It changes no authorization rule: who may read or change topics (TOPIC-002 admin and facilitator arms, the 403/404 codes, audit rows) is untouched. The PR description will state this, as requested by the executive stakeholder.
- **Topic history preserved.** The change copies active defaults into a brand-new team only. It never deletes, archives or rewrites an existing team's topics.
- **No UI consumer of `defaultTopicsNotActive`.** The topic management screen (`topic-management-screen`) does not read this field; it shows the team's archived topics from its own list. C5-C7 therefore protect an API contract, not a visible facilitator fix. FR-8.6 ("visible and restorable at any time") is met on the facilitator side by the screen's own archived list, and this change does not claim to close or extend it.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `default-topic-provisioning`: the copy takes only active defaults, numbers them 1..n in canonical order, signals template anomalies, and keeps the zero-active-defaults failure contract; the restore list is driven by the same canonical set; the invariants test is specified. The existing copy requirement's wording on `display_order` preservation and "every `is_default` row" is modified (D12; cites BRD 6.4, FR-8.1, FR-8.6).
- `topic-customization-lock`: **ADDED**, not MODIFIED. No existing requirement in that spec states a normative rule for `defaultTopicsNotActive`; the only mention is a non-normative "Implementation note" at the end of the all-topics response requirement, so there is no header to MODIFY. The ADDED requirement states that it supersedes that note where they differ, so the archived main spec does not hold two disagreeing statements. Wording only; no access rule changes.

## Acceptance conditions

Carried unchanged from the exploration (Given/When/Then detail is in the delta specs; the section 9 text of `exploration-notes.md` is the source).

- **C1.** Template has active default X and archived default Y; a new team has X active and no Y in any status.
- **C2.** Template with a duplicate active position, non-active default, gap or non-default row: creation succeeds and exactly one `warn` entry `template_anomaly` lists anomaly types and topic ids. Healthy template: no entry.
- **C3.** No active defaults: status is exactly 500, code `internal_error`, the D4 message, a `correlationId` in the body, nothing persists (no team, membership, topic, session or audit row), an error-level entry names the template, the message holds no ids.
- **C4.** Active defaults at {1,3,7}, and (required test) duplicate active positions produced by dropping the partial unique index inside a rolled-back test transaction: the new team's active positions are 1..n in template order, ties by `id`. Healthy template: positions equal the template's.
- **C5.** Template default Y archived, team has no Y: Y absent from `defaultTopicsNotActive`.
- **C6.** Template X active, team holds X archived: X appears with `isArchived: true`. Template X archived and team holds X archived: X absent (D5).
- **C7.** Names copied at creation equal names reported missing for an empty team, across the C1/C5 states, and, so it cannot pass by accident, set-difference holds for a team that already holds some of the defaults.
- **C8.** Invariants test per D8, with N = 12 and the baseline list (names plus hashes of `prompt`, `vote_type` and `first_session_description`) in the test file named in `tasks.md`.
- **C9.** `template-team-creation-regression-integration.test.ts` compares active defaults only and renumbered positions; otherwise passing.
- **C10.** `design.md` has the declined-trigger section and F5 has the linked task.
- **C11.** For every copied row, `name`, `prompt`, `vote_type`, `is_default` and `first_session_description` equal the template's and annotation columns stay unset. From the user side: a new team always starts with exactly the active default topics, in canonical order, numbered 1 to n, for the four anomaly types above and the zero-active case (bounded; not "any history"). Asserted inline in the C1/C4 tests, not a separate test file.
- **C12.** The first session's snapshot runs after the copy in the same transaction, so the session's topic names and positions equal the team's, in order (not generated ids). Asserted inline in an existing creation test, and the first session is startable with n >= 1 topics.

## Traceability

| Requirement | Conditions | Status |
|---|---|---|
| BRD 6.4 (default set preserved, drift detected) | C2, C8 | Strengthened: anomaly signal and CI invariants |
| FR-8.1 (shipped default applied to every new team) | C1, C4, C11 | Met and hardened |
| FR-8.1 ("maintainable by an Application Administrator") | none | **Stays open, owned by F5 (#216).** Not satisfied by this change |
| FR-8.6 (default set visible and restorable) | C1, C5, C6, C7 | API contract strengthened; facilitator side served by the screen's archived list, no UI consumer of `defaultTopicsNotActive` |
| Failure contract for an empty template | C3 | Pinned with a test |
| Regression suite | C9 | Updated |
| Declined trigger recorded | C10 | Documented in `design.md`, F5 task |

## Impact

- Backend: `packages/backend/src/routes/facilitator-sessions.ts` (the copy and the anomaly check), `packages/backend/src/routes/content.ts` (`defaultTopicsNotActive` query), `packages/backend/src/sessions/default-topics.ts` (shared predicate).
- Tests: `template-team-creation-regression-integration.test.ts` (updated), new integration tests for C1-C7, C11, C12, a new template-invariants test (C8). Duplicate active positions cannot be produced through the route (the route uses its own pooled connection and the index drop would block it). The required duplicate test runs at function level on one client: it calls the exported `copyCanonicalDefaults` against a scratch source team inside a transaction that drops `topics_team_active_order` and always rolls back, guarded to run only against the local test database. The invariants test baseline also covers `prompt`, `vote_type` and `first_session_description`, and template-mutating tests are serialized with an advisory-lock helper (see `design.md`). C11 and C12 are inline assertions inside tests already being written, not new test files.
- No migration, no new endpoint, no frontend, no shared package, no API response shape change.

## Out of scope

- The write-guard trigger (declined, D9); reconsidered under F5 (#216).
- Repairing teams created under the bug (D7); a remediation issue is opened by the implementing team's Engineering Manager only if the check finds rows. Teams that hit the 500 do not exist, so the check can only find the silent case.
- The name-only join duplicate in `defaultTopicsNotActive` (D10): a team holding an archived and an active topic of one default's name can show a duplicate or misleading restore entry in the API response. It is not user-visible today (no UI consumer), but is a real API defect. Filed as **#290**. Not fixed here, to keep the diff reviewable. This is a team-side join issue and is distinct from a template holding an active and an archived default of one name (which this change handles: only the active one copies and is listed).
- The F5 maintenance path for the defaults (#216).
- Any facilitator-visible banner, copy or UI change; an audit-log row or metric for anomalies; a new HTTP status or error code for the empty template.
- An administrator-facing check tool or UI (D7).

## Open decisions

None blocking. If stakeholders want a readable published list of the twelve defaults, that is a follow-up tied to F5, not a third copy now (D8).
