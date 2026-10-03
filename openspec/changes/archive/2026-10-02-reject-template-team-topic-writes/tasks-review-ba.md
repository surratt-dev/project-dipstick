# Tasks Review: reject-template-team-topic-writes (#188)

*Reviewer: Marcus Delgado, Business Analyst*
*Inputs: `proposal.md`, `specs/*/spec.md` (six deltas), `tasks.md`; `design.md` consulted for D1 to D6 references.*
*Focus: do the tasks, taken together, cover every capability in the proposal, and is anything lost between the requirement text and the task text?*

## Verdict

**Approve with minor revisions.** Every capability and every proposal bullet traces to at least one
task. The trimmed test plan still covers the main scenarios. What gets lost is in the *assertion*
clauses: several SHALLs in the owning requirement (audit row columns, the success-path event,
the timing floor on the template path, "no row written" on the member-facilitator `403`) are in the
spec but no task asserts them. None of them needs a new test. Each is one more assertion in a row or
unit case that already exists. I would fix them before implementation starts, because
an implementer works from `tasks.md` and will not reread the scenarios.

## 1. Capability coverage

| Capability (proposal) | Implementing task(s) | Verifying task(s) | Covered? |
|---|---|---|---|
| `default-topic-provisioning` ADDED: scope (5 endpoints + future) | 1.3, 1.4 | 2.2 (structural), 4.2 | Yes |
| ... per-endpoint 404 parity (status, body, headers, floor) | 1.3 (no header set by guard) | 4.2 (status/body/headers); floor: **partial**, see B2 | Mostly |
| ... check order (after authz + existence, before lock) | 1.3, 1.4 | 3.1, 4.3 | Yes |
| ... independence from lock state / sessions / membership | 1.3 (constant compare, D2) | 4.2 (both lock states), 4.3 (membership), 2.2 (no lock precondition) | Yes |
| ... denial audit row (columns + metadata) | 1.2 | 4.2 (metadata exact; role for admin only), see B1 | Partial |
| ... structured event `topic.write_denied_template` | 1.2 | 3.2 (failure path only), see B3 | Partial |
| ... audit failure: catch, log, same 404 | 1.2 | 3.2 | Yes (see M2) |
| ... no write to template rows | 1.3 | 2.2, 4.5 | Yes |
| ... structural coverage (enumerate, prefix, extra list, no exemptions) | 2.1, 2.2 | 2.2 "can fail" check | Yes |
| ... FR-8.1 boundary | spec text; 7.1 (BRD rationale) | n/a (normative text) | Yes |
| ... reads unaffected (FR-8.6) | none needed | 4.4 | Yes |
| ... real-team default archive/restore (FR-8.6) | none needed | 4.3 last bullet | Yes |
| ... team-creation copies pre-attempt baseline | none needed | 4.5 | Yes |
| ... non-canonical id follows existing rejection | none needed | **none**, see M1 | Deferred on purpose |
| `add-custom-topic` 2a step + floor on template 404 | 1.4 | 3.1, 4.2 | Yes (floor: B2) |
| `remove-topic` 2a step | 1.4 | 3.1, 4.2 | Yes |
| `restore-topic` 2a step | 1.4 | 3.1, 4.2 | Yes |
| `reorder-topics` 2a step + amended audit rule | 1.4 | 3.1, 4.2 ("no other audit row") | Yes |
| `topic-annotation` 2a step + admin `403` first | 1.4 | 3.1, 4.3 | Yes |
| Behaviour change 409 to 404 for existing test | n/a | 4.1, 5.1 | Yes |
| Lock semantics unchanged for real teams | 1.2 (shared type only) | 3.1 ("existing mock call order passes unchanged"), existing suites via 7.2 | Yes |
| Pre-merge human gates (owner, data check, F1/F5/F3 filed) | 6.1 to 6.3 | Engineering Manager at PR | Yes |
| Docs: BRD FR-8.1 rationale | 7.1 | 7.2 (validate) | Yes |

The proposal's non-goals hold up in the tasks: no frontend task, no migration, no change to the
lock-path audit, no `no-store` added to 003/004/005, no dashboards. Good.

## 2. Lost in translation (should fix)

**B1. The audit row's actor and team columns are required, and nothing checks them.**
The ADDED requirement lists `actor_user_id`, `actor_global_role`, `actor_ip` and
`team_id = DEFAULT_TOPICS_TEAM_ID` as required row fields. Task 1.2 only names `operation` and
`metadata`. Task 4.2 checks exact metadata, uses `actor_user_id` only as a filter, and asserts
`actor_global_role` for admin rows only. Nothing asserts `team_id` or `actor_ip`, or `actor_global_role = 'facilitator'`
on facilitator rows. An implementation that wrote `team_id = NULL` (easy to do when
reusing a helper written for a different context) would pass every listed test, and an
incident reviewer filtering on `team_id` would then find nothing.
*Fix:* in 1.2, list the four columns explicitly. In 4.2, assert
`team_id = DEFAULT_TOPICS_TEAM_ID`, `actor_global_role` on every row (facilitator and admin), and
`actor_ip` non-null.

**B2. Nothing asserts the timing floor on the normal template path.**
The `add-custom-topic` delta names "the template-team `404`" among the exits that must apply
`applyTimingFloor`, and the owning requirement includes the floor in parity. Task 3.2 asserts the
floor only when the audit insert *fails*. Task 3.1, the success-path unit case, does not assert it.
The proposal says timing is not *measured*, and I agree, but checking that the floor function was
called is a mock assertion, not a measurement.
*Fix:* add "`applyTimingFloor` was called before send" to the per-endpoint template cases in 3.1.

**B3. The structured event is verified only when the insert fails.**
The spec says the `topic.write_denied_template` event is emitted "whether or not the insert
succeeded", carrying `auditRowWritten`. Task 3.2 checks the event with `auditRowWritten: false`.
No task checks it on the normal path with `auditRowWritten: true`. The normal path is what
production will almost always take, and it is the path we have no assertion for.
*Fix:* in 3.1, assert one `emitAuditEvent` call per template case with the listed fields,
the response's `correlationId` and `auditRowWritten: true`. Also assert that `correlationId` is
*not* in the row metadata. The spec states this separately, and 4.2's "no extra keys" covers it
only by implication.

**B4. The member-facilitator `403` should also assert that no audit row is written.**
The scenario "The caller holds a membership on the template" requires `403
FACILITATOR_IS_TEAM_MEMBER` **and** no `topic.write_denied_template` row. Task 4.3's second
membership bullet asserts the `403` only. The "no template-denial row" clause is attached to the
engineer/admin bullet, not this one. This is the accepted-difference case, so it matters more than
most that we pin down exactly what it does and does not leave behind.
*Fix:* add "and no template-denial row" to that bullet. Also state which endpoints 4.3's
membership cases run on. The spec says "any in-scope request" for the facilitator and TOPIC-003 to 006
for the admin. As written, an implementer could reasonably test one endpoint.

## 3. Minor (worth tightening)

**M1. The non-canonical-id scenario has a new clause that nothing tests.** The scenario defers to
`rejectNonCanonicalTeamId`'s existing tests (proposal M3 / Exec 3, which I accept). Its second
clause, "no `topic.write_denied_template` row is written", is new, though, and existing tests can't
cover it. The risk is low because the rejection runs before the handler. Either add the
assertion to one existing non-canonical test, or note in 5.1 that the clause is accepted as
true by construction. Either way, record the decision so it isn't left unaddressed.

**M2. The audit-failure case (3.2) should assert headers and the lock.** The scenario requires "the same
headers" and "the customization lock is not evaluated". Task 3.2 says to run on 003 (no `no-store`)
and 006 (`no-store`), which implies a header check without stating it. Spell it out: 003 has no
`Cache-Control`, 006 has `no-store`, and the lock helper is not called in either.

**M3. Engineer `403` reason code.** The spec scenario fixes `error.code: "NOT_A_FACILITATOR"`. Task 4.3
says "gets 403". Add the code so that a `403` from some other gate doesn't pass by accident.

**M4. Who owns the extra list going forward.** The rule that "any endpoint added later
wherever its path is" falls under the guard is enforced only by the `EXTRA_IN_SCOPE_ROUTES` comment
(2.2) and code review. That matches the proposal. I'd still like the topics.ts file-header comment
(1.3) to point to the extra list too, since that is where the next route author will be working.
This costs one line.

**M5. The frontend symptom needs a line in the PR description.** The proposal accepts that Topic Management shows
"Team not found." inline on the template. There is rightly no task for it, but 5.1/7.2 could ask for
one line in the PR description saying so, so that a reviewer who clicks through the template doesn't file it as
a regression before F1 lands.

## 4. Things I checked that are fine

- The heading-preservation rule for MODIFIED deltas: the tasks don't rename anything, and 7.2's strict
  validate will catch drift.
- `attempted_operation` mapping: 1.4 matches the spec list exactly for all five endpoints.
- `metadata.endpoint` reuses the lock-path strings (1.4 "existing method-plus-path"), as the
  spec requires.
- Logging content: 1.2's field list matches the spec (marker, operation, correlationId, code and
  message only, no raw `err`, no body).
- The reorder audit amendment: 4.2's "no other audit row, none for the missing-team request" covers
  the amended "apart from that row" sentence.
- The team-creation comparison fields in 4.5 match the scenario (`name`, `prompt`, `vote_type`,
  `display_order`, `status`, every status included), and the snapshot covers the archive and
  annotation fields the scenario lists for the template's own rows.
- The merge gates in 6.1 reproduce all five pass criteria from the proposal, including the security
  B1 membership check and the "named owner, not 'human operator'" condition.
- No existing main spec (`topic-customization-lock`, `topic-management-screen`) claims that the lock
  is what protects the template. The decision not to touch `topic-customization-lock` leaves
  nothing contradicting this change.

## 5. Summary of requested edits to `tasks.md`

| # | Task | Edit |
|---|---|---|
| B1 | 1.2, 4.2 | Name the four row columns; assert `team_id`, `actor_global_role` (all rows), `actor_ip` |
| B2 | 3.1 | Assert `applyTimingFloor` called on the template path |
| B3 | 3.1 | Assert event emitted with `auditRowWritten: true` and fields; `correlationId` not in metadata |
| B4 | 4.3 | Member-facilitator `403` writes no row; name the endpoints the membership rows cover |
| M1 | 5.1 or one existing test | Decide and record the non-canonical "no row" clause |
| M2 | 3.2 | Explicit header and lock-not-called assertions |
| M3 | 4.3 | Engineer `403` asserts `NOT_A_FACILITATOR` |
| M4 | 1.3 | File-header comment points at `EXTRA_IN_SCOPE_ROUTES` |
| M5 | PR description | One line on the known "Team not found." UI symptom (F1) |
