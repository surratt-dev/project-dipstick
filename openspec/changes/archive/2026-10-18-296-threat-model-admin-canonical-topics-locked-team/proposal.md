# Proposal: 296-threat-model-admin-canonical-topics-locked-team (#296)

*Framed by Devon Calloway (Internal Champion). `design.md` ("Content source of truth") holds the final wording and is the only content source. `exploration-notes.md` and the explore and propose reviews are history; where they differ from `design.md`, `design.md` wins.*

**Documentation only; no capability spec delta.** No code, migration, API or UI is touched, so no `specs/` directory is produced and the pipeline need not wait for one.

## Why

The topic customization lock exists to stop anyone, admins included, from shaping a team's topics during its first-session window. That is a protective constraint, and It should stay structural rather than becoming a toggle. #200 added exactly one deliberate carve-out: `POST /api/v1/teams/:teamId/topics/assign-defaults` lets an `application_admin` write the default template into a team that has zero active topics, even when the team is locked. #200's security review wrote down the reasoning (live role check, advisory lock, audit on success, denial and failure, residual risk low). It lives only in an archived change. The one document a pre-production reviewer will actually read, `requirements/High-Level Architecture.md` section 8.1, says nothing about privileged write paths, topic integrity or the limits of the audit trail. BRD SEC-31 requires the threat model to be revisited against the implemented app at the 8.4 pre-production review; #296 is a legitimate input to that revisit.

The exposure is slightly larger than #200 knew. #216 let an admin edit the template that assign-defaults copies, so "canonical set only" now means "whatever the template holds". A constraint nobody wrote down does not survive the people who remember it.

## What Changes

All edits are to `requirements/High-Level Architecture.md`:

- Section 8.1: exactly one new table row, "Privileged topic-lock carve-out", appended after "Dependency vulnerability". The existing seven rows are byte-identical.
- New `### 8.1.1 Privileged topic-write paths` between the 8.1 table and 8.2, with eight labelled items, each its own line or bullet. Letters follow `exploration-notes.md` section 6 item 2, except that the former operator paragraph is now item (g), a single sentence, and reopen triggers are (h). Minimum content is in D3.
- Section 8.2 "API Authorization": exactly one bullet naming `assign-defaults-lock-gate-source.test.ts`, worded no stronger than the test asserts (D4).
- A recorded grep over `requirements/` for statements that contradict the carve-out (edit only if a contradiction is found).
- Three drafted, unfiled follow-up issues in `pr-notes.md` (see below). Not a gate.

Terminology source: the topic customization lock use case (amended in #200) and the BRD. Wording: ("topic customization lock", "locked team", "zero active topics"). `first_session` appears once, as the design-state name. "Carve-out" is defined on first use, because the reader has not read #200.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- None. Documentation only.

## Constraints preserved

- The no-manager rule, simultaneous reveal and facilitator-from-another-team are untouched; the endpoint has no participation or facilitator path. Nothing here alters session pacing, reveal, readiness or outlier behavior.
- The text must not recommend or imply that recovery needs a second approver, ticket or step-up. The cost of that is recorded as a weighing factor in any reopen decision, and the reopen trigger for a future security or compliance requirement stays.
- The carve-out is justified by a precondition (zero active topics, nothing for the lock to protect), not by who the caller is. Generalizing it (top-up, copy-from-team, facilitator or EM trigger, partial restore) is a named reopen trigger.
- No sentence claims more than the cited code or test asserts. Nothing calls the carve-out "safe". Numeric limits are not cited. Line numbers are not cited.
- The residual-risk rating is stated with its basis and its conditions (conditional on #208 and a near-zero zero-topic population; currently unmonitored, #131): low, because the expected affected population is none and `application_admin` is already an accepted trusted role (#208), not because the controls are preventive. They are detective.
- The chained path (template rewrite, then assign) is described as "covered by #208's trusted-role decision (which predates #216's template edit; not separately re-accepted); the chained path is recorded as a reopen trigger", never as "accepted by the product owner".

## Acceptance conditions (Marcus Delgado, BA; D1 to D9)

- D1 Diff scope: `git diff --stat main` shows changes only under `requirements/High-Level Architecture.md` and `openspec/changes/296-*/`; nothing under `packages/`, `docs/`, the BRD or `requirements/use cases/` unless the contradiction grep names a line.
- D2 8.1 table: exactly one new row, three cells; the row name contains "topic", "lock" and "carve-out"; the description names the endpoint path; the controls cell lists only confirmed mechanisms; existing rows unchanged. "Confirmed" means found by grep in non-test source on the landing day (tasks section 1).
- D3 8.1.1 exists, and each of items a to h is present as a separate labelled line or bullet containing at least:
  - (a) the zero-active-topics precondition, and that it is accepted on locked and unlocked teams; "carve-out" defined; `first_session` mentioned once.
  - (b) what it writes (a copy of the template's current active rows, plus its own audit row, nothing caller-supplied, no session, score or reveal data; see Review resolution) and what it cannot do (not unlock, not alter an existing active set, not touch in-progress `session_topics`).
  - (c) any `application_admin`, including a member of the target team; #208.
  - (d) the phrase "the bound is whatever the template holds"; #216; that an emptied or badly edited template degrades onboarding.
  - (e) rating low, the one-sentence basis, and "detective, not preventive".
  - (f) each caveat as its own bullet (see `design.md` for the list).
  - (g) one sentence: the facilitator is the first to notice (`NO_ACTIVE_TOPICS` on room open), recovery is an `application_admin` calling assign-defaults, facilitators have no self-service recovery and that costs a wait before a scheduled session; pacing, reveal, readiness and outlier behavior are unaffected. No pointer to the unfiled follow-up.
  - (h) the reopen-trigger list and recovery-speed sentence exactly as in `design.md` (including the event triggers added after design review).
- D4 8.2 gets exactly one bullet, and no other 8.2 hunk. Its claims are limited to what the test body asserts (see `design.md` D3).
- D5 Test-citation rule: the one test file named in the HLA (`assign-defaults-lock-gate-source.test.ts`) exists at the cited path and its sentence matches the assertions. Behavior claims in 8.1.1 that rest on the integration tests are stated as behavior, not by file name, and each is checked against the test body in tasks section 3.
- D6 Over-claim sweep: `grep -n -i "prevent\|cannot\|impossible\|guarantee\|safe"` over the added text; each hit is supported by a code reference or removed. Hits in the "cannot do" item are supported by the handler checks in tasks section 1. Nothing calls the carve-out "safe".
- D7 8.3, 8.4 and BRD SEC-31 untouched.
- D8 Traceability: this proposal names #296; 8.1.1 references #200, #208, #216, #271, #131 as plain issue references (and #215 and #218 in item (d)); no URLs, no line numbers, no numeric limits in the added text (checked in tasks section 3); this proposal carries the out-of-scope list.
- D9 Sign-off, a merge gate and not a drafting gate (a Security timeout is recorded as "not reviewed", see `design.md` Design review resolution): Security (Tomas) confirms the rating and reopen triggers; the BA (Marcus Delgado) confirms terminology against the use-case and BRD wording. Requests go out once the HLA text exists and all tasks-section-3 checks pass. Drafting and implementation proceed without waiting. Timeout, one business day after the request: for the BA, record "requested, no reply, proceeded as proposed" in `pr-notes.md`; for Security, record "requested, not reviewed" and the merge decision is the user's.

All controls and tests cited in the new text are re-confirmed against the code on the day of landing (tasks section 1).

## Out of scope

- Revoking UPDATE/DELETE on `audit_log` for the application DB role (drafted as a follow-up in `pr-notes.md`; filing is the user's call).
- Monitoring or alerting on audit signals (#131).
- Step-up authentication or a second approver for admin writes.
- Any code change; any `docs/deployment.md` change (its "Zero-topic teams" section already says the expected count is 0).
- Denial-audit sampling in general, sentinel-lock blast radius, and the "never spread `request.body`" rule (#216 S-B, N-A, N-D). The S-B limit is stated for assign-defaults only.
- Building a facilitator-facing empty-team message.

## Follow-ups (drafted in `pr-notes.md`, unfiled, not a gate; whether to file is a question for the user at PR time)

1. One issue covering #216's S-B generalized, N-A and N-D threat-model additions.
2. One facilitator-experience issue: verify what a facilitator of a zero-topic team sees when room open answers `NO_ACTIVE_TOPICS`; if there is no actionable message (for example "This team has no topics. Ask an administrator to restore the default set."), add one; check whether an already-open page updates after assignment or needs a refresh; consider a way to tell an admin which team without a screenshot.
3. Revoke UPDATE/DELETE on `audit_log` for the application DB role; related to #131.

## Review resolution

Two reviews pulled in opposite directions. Rule applied: keep every acceptance condition that a reviewer can check mechanically; cut the process around them (extra citations, extra prose, open-ended waiting).

Accepted from Marcus Delgado (`propose-review-ba.md`):
- D3 per-item content restored, but as a compact minimum list, not a copy of the notes. Without it "contains a to h" is satisfiable by eight empty labels.
- Single content source: `design.md` now holds the row text, reopen triggers, recovery-speed sentence and caveat list. The notes are history. This also fixes the rot risk of "verbatim from" a superseded file.
- D9 reconciled: merge gate, not a drafting gate (the tasks sign-off section matches).
- Verification tasks for D3, D4, D8 and the no-URL, no-line-number, no-numeric-limit rule (tasks section 3). `safe` added to the D6 grep.
- Fuller task 1 confirmations (advisory lock, same-transaction audit, locked and unlocked acceptance, template-failure rollback, `deployment.md` wording), a stop-and-raise rule if the handler touches archived rows, and keep or drop recorded in `pr-notes.md`.
- 8.2 bullet capped at the test's assertions. The "dedicated admin-only endpoint and not a flag" clause is not asserted by the test, so it is removed from 8.2 (it is already item (a) in 8.1.1). The count of lock-gated writes was re-confirmed from the test body: the `GATED` array has five entries (add, archive, restore, reorder, restore-defaults) and the route-list pin has seven routes. The test's header comment still says "four"; that comment is stale and is not the assertion, so the bullet says five.
- Terminology source named (lock use case and BRD). The "no participant-visible trace" claim is reworded to what the #271 structural test asserts (tasks sections 1 and 2, item (f)).

Accepted from Rachel (`propose-review-exec.md`):
- Item (g) cut to one sentence with no pointer to the follow-up, because a pointer to an unfiled issue would rot. Marcus Delgado's content checks are kept as clauses of that sentence, which costs nothing.
- Follow-up pair stays unfiled and explicitly not a gate.
- D9 timeout defined (one business day).
- "No session, score or reveal data" added to item (b). Verified in code: the handler reads no body or query, inserts rows into `topics` by copying the template's active rows, and writes one `audit_log` row (counts and request id only). The sentence therefore says "topic rows plus its own audit row", not "topic rows only", to stay true. Tasks section 1 re-confirms on landing.
- Lightweight pipeline: recorded here as the expectation; nothing in this change needs the full seven stages. No growth into the SEC-31 revisit (D7 unchanged).
- Trimmed: HLA names one test file instead of three; the first-person line in Why is removed.

Rejected or partly rejected:
- Dropping the 8.2 test-citation bullet (Rachel). Kept. It is the only place a control reviewer sees the regression guard that keeps the carve-out single, and D4/D5 already bound it to one bullet and one file. The rot cost (a rename) is accepted and bounded by the landing-day re-check.
- Marcus Delgado's D9 preference and Rachel's speed concern are not in conflict once D9 is a merge gate with a timeout, so neither is rejected.
