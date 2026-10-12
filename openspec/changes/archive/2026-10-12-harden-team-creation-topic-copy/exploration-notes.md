# Exploration notes: harden-team-creation-topic-copy (#215)

*Perspective: Devon Calloway (Internal Champion). Explore mode, no code written. Evidence is from reading
`facilitator-sessions.ts`, `content.ts`, migrations 4/11/18/23, and the archived #188 proposal and design.*

## 1. What the code does today

```
 __default_topics__ (00000000-...-0001)          new team
 topics rows, is_default = true          copy    topics rows
 ┌──────────────────────────────┐   ───────▶   ┌───────────────────────┐
 │ name, prompt, vote_type,     │  no status   │ same columns, status  │
 │ display_order, is_default,   │  filter      │ defaults to 'active'  │
 │ first_session_description    │              └───────────────────────┘
 └──────────────────────────────┘
```

- The copy is in `packages/backend/src/routes/facilitator-sessions.ts` (~l.699 to 714), inside the
  create-team-and-first-session transaction, not in `teams.ts`. Filter is `team_id = $2 AND is_default = true`.
  The column list omits `status`, so every copied row lands as `active` even if the template row is `archived`.
  So the issue's first claim is slightly understated: an archived template default is not skipped, it is
  **resurrected as active** in the new team.
- Migration 18 made `display_order` unique only among active rows (`topics_team_active_order`,
  partial index `WHERE status = 'active'`). The template can legally hold an archived row at position 3 and
  an active row at position 3 after a reorder. The copy then inserts both as active at position 3, the index
  fires 23505, and the whole transaction fails. The handler only maps 23505 on the `teams` insert to a name
  collision, so this surfaces as a 500 for every team creation until someone repairs data by hand.
- The same transaction then runs `snapshotSessionTopics`, which reads only active topics, so the snapshot
  layer is already status-aware. The copy is the one place that is not.
- `content.ts` ~l.1059 to 1136 (TOPIC-002): `defaultTopicsNotActive` comes from a `topics dt LEFT JOIN topics t
  ON t.team_id = $1 AND t.name = dt.name WHERE dt.team_id = $2 AND dt.is_default = true`. It never looks at
  `dt.status`. So an archived template default is offered as a "default topic you can restore" on every team.
  It should say what the copy says: the canonical set is the template's active defaults.
- Side finding (not in scope, worth a note): the join is on `name` only. A team with an archived and an
  active topic of the same name would produce two rows for one default. Possibly a separate issue.

Both fixes must use one definition of "the canonical default set": the predicate
`team_id = template AND is_default = true AND status = 'active'` (see D1 in section 8). Two queries drifting
apart is exactly how this bug exists. The requirement is behavioural (both consumers agree, D6); the mechanism
is a design choice.

## 2. Devon's view: why this matters to the ritual

BRD 6.4 / FR-8.1 / FR-8.6: the default set is "the shared language of the ritual"; it must be preserved,
visible, restorable, and it is what makes teams comparable. Two different failure shapes:

| Failure | Who sees it | Devon's reaction |
|---|---|---|
| 500 on team creation | Facilitator, in front of a new team, loud | Bad adoption moment. Success criterion 1 (a team I've never met adopts it without me) dies here. But it is at least obvious. |
| Archived default resurrected, or reordered baseline | Nobody, silent | Worse. Cross-team comparability quietly erodes. This is the drift 6.4 exists to prevent. |

So the fix for (1) should make the silent case loud somewhere an operator can see it, not only make the 500 go away.

### Decision point: skip duplicates, or renumber?
Acceptance allows either "creation succeeds when two active template topics share a position" or "copy renumbers".
Note the premise differs slightly: with the status filter in place, an active/archived collision disappears,
because the archived row is no longer copied. Genuine duplicates among **active** template rows cannot exist
while `topics_team_active_order` holds. They can only exist if the index is absent or dropped (a down-migration
of 18 re-adds the 3-column key, a hand-restore, a failed migration on a stale environment). So the realistic
residual is: index missing, or non-contiguous positions (gaps) after archiving.

Recommendation: copy with `row_number() OVER (ORDER BY display_order, id)` so the new team always gets
contiguous 1..n positions in canonical order. That makes creation immune to duplicates and gaps without
needing the index, and removes dependence on template position values. Cost: the new team's positions no longer
equal the template's literal numbers when the template has gaps. That is fine; relative order is the shared
language, not the integers. Tie-break on `id` is deterministic but arbitrary; for true duplicates the "right"
order is unknowable, which is why a warning is useful (below).

Devon would add: when the copy detects a template anomaly (duplicate active positions, a `status != 'active'`
default row, a gap in positions), emit a `warn` log entry (D3). Zero active defaults is a separate, already
handled failure (D4), not a warning. The point is that the repair path is visible instead of the app silently
papering over it.

## 3. Ritual constraints that could be touched

- **No-manager rule, facilitator-from-another-team, simultaneous reveal:** untouched. This change is
  provisioning only.
- **Default set visible and easy to restore (FR-8.6):** the real risk. If `defaultTopicsNotActive` filters on
  `dt.status`, an archived template default stops being offered for restore. That is correct only if the
  template should never contain archived defaults in a healthy state, which is the #188 invariant (template is
  read-only to the API). Confirm in the spec: the canonical set = active template defaults, and a template
  archive is a data fault, not a feature. Do not let this quietly become a way to "retire" a default for new
  teams: FR-8.1 says an Application Administrator maintains the defaults, and that path is F5 (#216), not this.
- **Team topics already created:** the fix is forward-only. Teams created while the bug was live may contain a
  resurrected topic. Not repairable here; see D7 for the owner and the one-time read-only check.
- **Restore semantics:** an existing team that holds an archived topic of a default's name must still see that
  default as restorable (`isArchived: true`). The status filter goes on `dt` only, never on `t`. Easy to get
  wrong by filtering the whole join.

## 4. What could go wrong (implementation)

1. Filter added to the WHERE of the `content.ts` query but written against `t.status` instead of `dt.status`:
   would hide the "archived in this team" restore case. Test both directions.
2. `ORDER BY display_order` inside `INSERT ... SELECT` is not guaranteed to fix insertion order, but
   `row_number()` computes positions explicitly, so that is fine.
3. The existing regression suite (`template-team-creation-regression-integration.test.ts`) compares copied rows
   to the template's `is_default = true` rows of **all statuses** (the design says "because the copy ignores
   status"). That assertion will now be wrong and must be updated to active-only, and display_order compared as
   renumbered. Parallel-test hazard in #188 design Risks still applies.
4. Tests that exercise the archived case must mutate the template. They need a snapshot-and-restore in `finally`
   exactly like #188's helper, restoring `display_order` via negate-then-set because of the partial index.
   Reuse that helper; do not write a second one.
5. A test for "duplicate active positions" cannot insert duplicates while the index exists. It must drop the
   index inside a transaction (or use a scratch schema like the migration tests), or test renumbering via a
   scratch copy. Decide which; the scratch-schema style already exists in `template-team-migration-integration`.

## 5. The optional trigger (scope item 3): analysis and recommendation

Proposal: `BEFORE INSERT OR UPDATE OR DELETE ON topics` that raises when `team_id` is the template id unless a
session setting (for example `current_setting('app.allow_template_topic_write', true) = 'on'`) is set.

What it buys:
- Catches accidents and bad hand-written SQL/migrations at the data layer, which is the only gap #188
  deliberately left (API is guarded, data layer is not). Precedent exists: migration 23 put CHECK constraints
  on sessions, memberships and join_links for the same sentinel.

What it does not buy:
- It is not a security boundary. Anyone able to run SQL can set the opt-in. The threat is a mistake by a trusted
  operator, not an attacker. The API threat is already closed by #188 plus #214.
- After items 1 and 2, the blast radius of template drift is already small: no 500, no resurrected archived
  rows, reordered baselines still get normalised. What remains is silent drift of prompts/names/order, which a
  trigger would catch but so would a cheap CI/health test asserting the template's invariants.

What it costs:
- Seed-migration ordering. Template rows are written by migration 4 and replaced (DELETE all + INSERT twelve) by
  migration 11. A trigger must be created after 11 (so a new migration number, 24 or later). On a fresh DB
  that is naturally ordered, so 4 and 11 run untouched. The hazard is the future: any later migration that edits
  defaults (including the F5 maintenance path and any wording fix to the twelve topics) must opt in or fail.
  Failing loudly is arguably the feature, but it also means every future default-topic migration author must
  know the pattern, and migration numbers are assigned across parallel branches, so a stale branch can land
  a seed edit numbered after the trigger without having been written with an opt-in. CI on the merged result
  would catch it only if migrations run in CI against the full chain (they do, via the integration suites).
- `db:migrate` runs with `--no-single-transaction`. `SET LOCAL` needs an explicit `BEGIN` in the migration; a
  plain `SET` leaks to the pooled connection. Getting this wrong either defeats the guard or leaves it open.
- Test suites currently mutate the template directly (snapshot/restore in `finally`, fixtures, parity tests).
  Each would need the opt-in, in many files, or a shared helper. Missing one produces confusing failures in
  unrelated suites.
- `down` migrations and `migrations-manual` scripts must also opt in or be reviewed.
- It is a schema change on a hot, shared table, deployable only with care, for a fault that needs an operator
  to commit it.

Interaction with F5 (#216, admin maintenance of the defaults): this is the real reason to wait. If the
Application Administrator path ever writes template rows through the API, the trigger's opt-in becomes the
single sanctioned channel and starts to mean something (only the maintenance code sets it, only after the
authorization and audit checks). Adding the trigger now, with no sanctioned writer, produces an opt-in that is
just a string people paste. Adding it as part of F5 gives it a design: one function that sets the flag, one
audit row, one place to review.

**Recommendation: decline for now (record on #215), revisit with F5.** Concretely:
1. Ship items 1 and 2 plus tests.
2. Record in the issue and in design.md: declined because (a) not a security boundary, (b) residual risk after
   items 1 and 2 is silent content drift by trusted operators, (c) cost is migration-ordering hazard plus test
   churn, (d) the opt-in has no sanctioned writer until F5.
3. Add a cheap substitute: an integration/health test asserting the template invariants (twelve active defaults
   with the expected names, contiguous positions, no non-active default, nobody holds a membership/session).
   It runs in CI on every merge, so a seed migration that violates the baseline fails visibly, and it also
   documents the canonical set. The pre-merge read-only data check from #188 is the same idea against live data.
4. Reopen the trigger when F5 starts, and make it a task there.

Devon's honest caveat: if the team disagrees and wants defence in depth now, the minimum viable form is the
trigger created in a new migration numbered after all current seeds, opt-in via `SET LOCAL` inside an explicit
transaction, a single shared test helper, and a header comment in migrations 4 and 11 pointing at the rule.
He would not block it, but he would not spend the complexity budget on it before F5.

## 6. Scope for the change (revised after Priya's and Marcus's reviews)

In:
1. The team-creation copy takes active defaults only and numbers positions 1..n in canonical order (D1, D2).
2. `defaultTopicsNotActive` is driven by the same canonical set (D1, D5, D6).
3. Template-anomaly `warn` log entry (D3).
4. Zero-active-defaults behaviour pinned by test, unchanged in contract (D4).
5. Tests per section 9 (acceptance conditions).
6. Update the #188 regression assertions to active-only and renumbered positions.
7. Template invariants CI test (D8).
8. design.md "Declined: template write trigger" section, plus a task on F5 (#216) (D9).
9. A one-time read-only data check against the live environment, result recorded in the change (D7).
Out: the trigger (declined); repairing teams created under the bug (D7); the name-only join duplicate (D10,
filed as its own issue); F5 maintenance path; any facilitator-visible banner, copy or UI change (D3, D11);
any change to ritual mechanics (non-goal, stated in the proposal).

## 7. Open questions (all resolved, see section 8)
- Warning event vs fail loudly on empty template: both, for different states (D3, D4).
- `is_default` stays in the filter alongside status (D1).
- Requirement-level statement that archived template rows are never copied: yes, in
  `default-topic-provisioning`, citing FR-8.1 and FR-8.6 (D12).

## 8. Decisions (added in response to review)

**D1. Canonical default set is a predicate, not a list.** `team_id = <template> AND is_default = true AND
status = 'active'`. Both parts stay: a custom row on the template is a #188 violation and must not copy. The
twelve names exist only in the invariants test (D8), labelled a baseline that F5 (#216) must update when it
edits defaults. Policy confirmed (Devon): **an archived default on the template is a data fault, not a
feature.** It is never copied and never offered for restore. It is not a way to retire a default for new teams;
that is an F5 decision, made by an Application Administrator through an authorized path (FR-8.1). This goes into
the proposal as an explicit assumption, so it is not implied only by a SQL filter.

**D2. Renumbering is a requirement on the outcome; `row_number()` is the tactic.** Requirement: a new team's
active topics are numbered 1..n with no gaps or duplicates, in template `display_order`, ties broken by `id`.
Positions start at 1 (the template's own healthy positions are 1..12). Healthy-template outcome: the new team's
positions, names, prompts, vote types and first-session text are identical to what team creation produces today.
Priya's tie-break question: the tie-break only applies between rows with equal `display_order`, which cannot
occur in a healthy template, so non-duplicate rows are never reordered. Accepted as a test (C4).

**D3. Template anomaly signal is a log entry.** Sink: the application log via `request.log.warn`, the same
surface the neighbouring `request.log.error` calls in `facilitator-sessions.ts` already use. Message key
`template_anomaly`. Fields: `templateTeamId`, `anomalies` (any of `duplicate_active_order`,
`non_active_default`, `non_contiguous_order`, `non_default_row`), `topicIds` of the affected rows, and
`correlationId`. Consumer: whoever monitors application logs (operator). Healthy template emits no such entry.
Rejected alternatives: an `audit_log` row (the audit trail is security-oriented, adds a write to every
creation, and the empty-template path cannot write one anyway because it rolls back), and a metric (no metrics
pipeline exists for this route). Creation still succeeds in these states. No facilitator-facing banner, copy or
response field is added (Priya's question 2: confirmed, silence for facilitators).

**D4. Zero active defaults.** Verified in code, not assumed. `NoActiveTopicsError`
(`packages/backend/src/sessions/session-topic-snapshot.ts`) is thrown by `snapshotSessionTopics` when it
inserts zero rows. `facilitator-sessions.ts` (~l.734) rethrows it, the catch (~l.766) issues `ROLLBACK`, and
replies **HTTP 500, error code `internal_error`**, message "Team creation is unavailable because the default
topic set is not configured. Contact an administrator.", with `correlationId` and no template id. An
error-level log entry carries `templateTeamId` and the correlation id. The team, topics, session and the
audit row are all in the one transaction, so nothing persists and the facilitator can simply retry once an
administrator repairs the template. With the new status filter the copy inserts zero rows when the template has
no active defaults, so this path is reached exactly as before. Decision: keep the existing contract (500 /
`internal_error` / existing message); do not invent a new status or code, which would churn the frontend and
existing tests for no gain. The message is already plain language with no internal ids, which meets Priya's
request; this change adds a test that pins status, code, message, no leaked ids and no persisted rows.
Marcus's point stands that the spec must state it; it goes into `default-topic-provisioning`.
Rejected: 503. The condition is a server configuration fault, as the existing code comments say, and the
envelope convention here is 500 `internal_error`.

**D5. Restore edge case (template default archived AND the team holds its own archived copy).** Decision: not
offered for restore. The canonical set is the template's active defaults, so the query is driven by active
`dt` rows and a team's own copy of a name that is no longer canonical drops out of the list. This case only
arises under a data fault (D1) or after an F5 retirement, and F5 owns the semantics there. The valuable case
Priya uses stays: template default active, team holds its own archived copy, which appears with
`isArchived: true`. The filter goes on `dt.status` only, never on `t`.

**D6. Shared definition.** Requirement: the set of names copied at team creation equals the set
`defaultTopicsNotActive` reports as missing for a team with no topics. One test asserts the equality (C7).
How the two share the predicate (an exported SQL fragment or constant) is a design.md decision; the proposal
does not mandate it. Devon's preference is one exported fragment plus the equality test, not the test alone.

**D7. Forward-only, with a one-time check.** Confirmed: teams created while the bug was live are not repaired
here. Owner of discovery: the engineer implementing this change runs a read-only count query before merge
(active `is_default` topics on non-template teams whose name is not among the template's active default names)
and records the result, or an explicit "not run, reason", in the change's tasks. If rows turn up, a separate
remediation issue is opened by the Engineering Manager of the implementing team. Note a limit: teams that hit
the 500 do not exist, so the check can only find the silent case. Rejected: an administrator-facing check
tool or UI (Priya's question 3). It is scope growth for a one-time situation, and it would add a
facilitator-adjacent surface. Priya gets her answer by the recorded query result: "your teams are fine", or a
list.

**D8. Template invariants test, exact list.** Migration 23 CHECKs cover sessions, memberships and join_links
on the sentinel; this test does not duplicate them for those tables beyond a cheap count assertion. It asserts:
(a) the active default count equals N and the names equal the baseline list in the test; (b) active default
positions are exactly 1..N; (c) zero default rows with status other than `active`; (d) zero non-default rows
on the template; (e) zero memberships and sessions on the sentinel. Each failure message names the violated
invariant. Priya's suggestion to publish the twelve names for non-engineers: partly accepted. The list lives in
the test and the existing requirements topic list; this change does not create a third copy that would drift.
If the stakeholders want a readable page, that is a follow-up tied to F5.

**D9. Trigger decision recorded.** Decision-maker: Devon, on #215, with design.md carrying a "Declined: template
write trigger" section listing the four reasons (not a security boundary; residual risk after items 1 and 2 is
silent drift by trusted operators; migration-ordering and test churn cost; no sanctioned writer until F5). A
task is added on F5 (#216): "reconsider template write guard". Revisit trigger: F5 starts.

**D10. Name-only join side finding.** Priya's question 5: confirmed by reading `content.ts` (~l.1065 to 1136).
The join is on name, so a team holding an archived and an active topic of one default's name yields two rows;
the archived row has status not `active` and passes the `!== 'active'` filter, so the restore list can show a
duplicate entry for a default the team already has active. That is user-visible, so it gets its own issue rather
than a note. First task in tasks.md: file it, and insert the issue number into the proposal's Out of scope.
Not fixed in this change, to keep the diff reviewable (it would change the join shape being modified here).

**D11. Facilitator-visible behaviour: none.** Restating Priya's and Devon's shared bar: a healthy-template
creation looks identical to today. Diagnostics stay operator-side.

**D12. Traceability.** Spec lines go in `default-topic-provisioning`, citing BRD 6.4, FR-8.1 and FR-8.6
(C1, C5, C7 to FR-8.6; C4 to 6.4). Non-goals in the proposal: simultaneous reveal, no-manager rule,
facilitator-from-another-team are untouched.

## 9. Acceptance conditions (Given/When/Then, carried into the proposal)

- **C1.** Template has active default X and archived default Y; new team is created; it has X active and no Y
  in any status.
- **C2.** Template has duplicate active `display_order`, a non-active default, a gap or a non-default row;
  creation succeeds and exactly one `warn` entry with message `template_anomaly` lists the anomaly types and
  topic ids. Healthy template: no entry.
- **C3.** Template has no active defaults; creation returns 500 `internal_error` with the D4 message, no team,
  topic, session or audit row persists, an error-level entry names the template. Message contains no ids.
- **C4.** Active defaults at {1,3,7} (or duplicates in a scratch schema): new team's active positions are 1..n,
  in template order, ties by `id`. Healthy template (1..12): positions equal the template's.
- **C5.** Template default Y archived, team has no Y: Y is absent from `defaultTopicsNotActive`.
- **C6.** Template X active, team holds X archived: X appears with `isArchived: true`. Template X archived and
  team holds X archived: X absent (D5).
- **C7.** Names copied at creation equal names reported missing for an empty team, across the C1/C5 states.
- **C8.** Invariants test per D8.
- **C9.** `template-team-creation-regression-integration.test.ts` compares active defaults only and renumbered
  positions; otherwise unchanged and passing.
- **C10.** design.md has the declined-trigger section and F5 has the linked task.
- **C11 (from Priya).** For every copied row, `name`, `prompt`, `vote_type`, `is_default` and
  `first_session_description` equal the template's, and annotation columns stay unset (the explicit column list
  is being rewritten, so a dropped column must fail a test). Stated from the user side: a new team always starts
  with exactly the active default topics, in canonical order, numbered 1 to n, regardless of template history.
- **C12 (from Priya).** The first session's snapshot runs after the copy in the same transaction (it does today,
  `lockTeamTopics` then `snapshotSessionTopics`), so session topic order equals team topic order; assert it.

## 10. Review response log

Accepted: Marcus A1 to A9, B, C1 to C10, D (with the changes above); Priya observations 1 to 5, questions 1, 2,
4, 5, suggestions 1 to 4 and 6 (the pre-merge browser spot check by Priya is added as a task before merge: create
a team, confirm twelve topics in order, archive one of the team's own defaults, confirm it appears under
restore, restore it).
Modified: Priya Q3 (a recorded read-only query, not a tool, D7); suggestion 5 (the readable list is a
follow-up, not a new copy, D8); Marcus C2 field list extended with `non_contiguous_order` and `non_default_row`,
and its "(index absent in a scratch schema)" example is kept as the way to test duplicates (the unique partial
index prevents them otherwise, so that test needs a scratch schema, not a mutation of the shared template).
Rejected: HTTP 503 or a new error code for the empty template (D4); audit row or metric for anomalies (D3); a
facilitator-facing banner (D3, D11); fixing the name-only join here (D10); the trigger (D9). None of the
reviews asked to weaken a ritual constraint, and nothing here touches one.
