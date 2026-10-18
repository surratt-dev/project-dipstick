# BA Review of Exploration Notes: admin-default-topic-maintenance (#216, FR-8.1)

Reviewer: Marcus Delgado, Senior Business Analyst
Input: `exploration-notes.md` (Devon Calloway voice)

## Overall verdict

The notes are strong on constraints, hazards and traceability. Section 2 (existing-team impact) and section 5 (invariants) are close to requirement-grade. But the document is an exploration, not a requirement set. Three things block carrying it into a proposal as-is: (1) ten open questions with no owner or default, several of which change what is in scope; (2) the notes use "should", "must", "lean" and "consider" interchangeably, so I cannot tell which statements are requirements; (3) almost nothing is stated as a testable condition. Below: what is clear enough, what is not, and rewrites.

## A. Clear enough to carry forward (as-is or with light edits)

1. Edits affect only teams created afterwards; recovery (#200) hands out the current template (sec. 2). Traceable to use case 08 line 54. Carry as a requirement.
2. Admin-only authorization, 403 `NOT_AN_ADMIN` for everyone else including Engineering Managers and facilitators (sec. 3).
3. The #188 guard is not relaxed; admin path is a separate route (sec. 6).
4. Template mutations are audited transactionally; denials fail-open (sec. 4).
5. Server-side validation to protect team creation (sec. 7, hazard 5) — direction is clear, values are not (see B).
6. Open sessions and teams mid-first-session are unaffected (snapshotting; sec. 2, hazard 7).

## B. Vague or under-specified (must be fixed before the proposal)

### B1. "Add, edit, archive, restore, reorder" has no business rules
The table in sec. 7 lists hazards, not rules. Missing:
- Which fields are required on add? `first_session_description` "required?" is posed as a question.
- Name uniqueness: "trim + case-insensitive" appears only as a hazard note. State it as a rule and name the error.
- Length caps: "consistent with team topics" is not a number. Pull the actual limits from TOPIC-003 and write them.
- Allowed `vote_type` values: not enumerated.
- Restore position "goes to end" is asserted with "consistent with TOPIC-005"; confirm and state it.

### B2. Template size is an open question, but it is a requirement
Q10 asks about min/max. Minimum is already implied (at least 1). Maximum matters to the "brief session" property. Needs a number or an explicit "no cap, accepted risk" decision, and an error code when exceeded. Suggest: cap, value to be set by PO (I propose a ceiling no more than 2x the current 12, i.e. 24, as a starting point, to be stated as a documented decision, not a magic number, per my standing rule on thresholds).

### B3. "Canonical" is undefined
Sec. 6 asks whether canonical means factory (migration 11) or the current template. This is a terminology gap affecting FR-8.2, FR-8.6, UX copy and the test baseline. I need to rule on it, and the answer I would give: **canonical = the current template**; the migration seed is history. Consequence I must record: FR-8.6 "baseline you can get back to" then means "the baseline as currently maintained"; no factory reset (agree with Devon, do not add). Needs PO confirmation, and the BRD wording of FR-8.6 may need a note.

### B4. Retire semantic (archive vs delete) is an architectural lean, not a requirement
Devon leans archive (B). From the business side the requirement is: "an admin can retire a default so new teams no longer receive it, and can bring it back." That is archive/restore as the issue states. I accept (B), but the requirement must be written so the anomaly detector change is explicit: "an archived template default is a valid state and shall not raise `non_active_default`." Without this, CI and production logs contradict the feature.

### B5. `vote_type` immutability and rename: undecided, and both change meaning
"Consider making vote_type immutable", "strong lean: edits should be rare" are not requirements. I rule: `vote_type` is immutable after creation (change = retire + add). Rename is permitted, with the scope confirmation. Mark as a BA decision pending PO ack, because it removes an operation the issue arguably allows ("edit").

### B6. Prompt-content rule is not testable
Hazard 6: "must never name or target individuals" but then "a content filter is overkill". A requirement that cannot be verified is a policy statement. Either (a) reword as an interface requirement ("the maintenance screen/endpoint documentation states prompts address the team and the work, not individuals") which is verifiable, or (b) accept that the control is audit + review. Pick one and say it. I recommend (a).

### B7. Confirmation copy is a requirement hiding in a UX note
"This changes the topics given to teams created from now on. Existing teams keep what they have." This only means something if there is a screen, which depends on Q6. If API-only, the equivalent is a response/field or documented behavior. Resolve Q6 first (see B9).

### B8. Audit metadata: undecided, and it is the core of the feature's value
Q3 is unresolved. This one cannot be deferred to design; it determines whether an incident reviewer can see what changed. Requirement I propose: each successful template write records the actor, the operation, the topic id, the names of changed fields, and enough prior/new value information to reconstruct the change. Hashes alone fail that unless prior values are recoverable. Devon says they are "versioned (see section 7)" — **section 7 does not describe versioning**. That is a dangling reference. Clarify: is there a template version history, or not? If not, hashes-only is insufficient and full before/after text is the requirement. Also state explicitly that this is a deliberate exception to the "no topic names in audit rows" convention.

### B9. API-only vs UI (Q6) changes the definition of done
FR-8.1 says "maintainable by an Application Administrator". An admin who is not a developer cannot use an API. If the screen is deferred, FR-8.1 stays partially met. Needs a PO decision now, not at proposal time. If deferred, a follow-up issue number must exist before this change is accepted, and the traceability note must say "FR-8.1 partially met, API only".

### B10. Reconsidering the trigger (Q4) must yield a decision, not a menu
Sec. 6 lists trigger, middle option, and decline. The issue's acceptance requires "reconsidered". Requirement: the proposal records one of the three outcomes with reasons. I do not have a business position on mechanism; I do need the outcome documented, and a second-writer-prevention mechanism of some form (trigger or enumerating test) to exist. State that as the requirement and let engineering choose.

### B11. Invariants baseline test (Q5) "largest hidden cost" — requirement unclear
What must remain true: (a) CI continues to catch accidental template drift; (b) a legitimate admin edit does not break CI. The notes propose reshaping but leave the mechanism open. Business requirement: "the test suite verifies structural invariants of the template independent of its content, and verifies the seed content only as the migration-time baseline." Acceptance for the proposal: list the exact invariants (a..e) that remain and which are relaxed, with names.

### B12. Unanswered question directed at me: do reports group by default-topic name (Q7)?
Answer from the requirements as I have them: trends are per topic per team (FR-8.3), keyed to the team's own topic. I am not aware of a cross-team by-name report. I should verify against the trend use cases before ratifying, but I do not expect one. Record as "No cross-team grouping by default name is in scope; if one is added later, it must handle reworded defaults." Ask Devon to confirm no report code does this.

### B13. Known consequences listed but not assigned
Sec. 2 names two accepted gaps: restore returns superseded wording, and `defaultTopicsNotActive` mismatches after rename. They are "flag for the design" with no disposition. Each needs: accepted limitation (documented in spec), or in scope fix, or follow-up issue. My recommendation: both accepted and documented; open follow-up issues; and a requirement that no UI/API copy calls restored topics "canonical" (this one is a good, testable condition already).

### B14. Concurrency expectations are implementation-flavored
Sec. 7 prescribes `lockTeamTopics` and `TOPIC_ORDER_STALE`. Business requirement is: two admins editing at once never produce a template with duplicate/non-dense positions, and a team created during an edit sees either the complete before or complete after set, never a mixture. Write that; leave the locks to design.

### B15. Rate limiting (hazard 10) is "reuse or give its own"
Not a requirement. Either state a limit or state "same limit as team topic writes".

## C. Suggested acceptance conditions (Given/When/Then)

1. **Authorization.** Given a user whose global role is not `application_admin` (including Engineering Manager and facilitator), when they call any maintenance endpoint, then the response is 403 with code `NOT_AN_ADMIN`, the template is unchanged, and a bounded denial audit row is written.
2. **Scope of effect.** Given an admin edits the prompt of default "Pairing", when a team is created afterwards, then its "Pairing" topic carries the new prompt. And given a team created before the edit, then its topics and any open session are unchanged.
3. **Recovery.** Given an admin has edited a default, when zero-topic recovery runs for a team, then it receives the edited (current) set.
4. **Restore wording.** Given a team archived its default "Pairing" before an admin reworded it, when the team restores it, then it gets its own original row, and no UI/API text describes restored topics as canonical.
5. **Last active default.** Given exactly one active default, when an admin archives it, then the request is rejected with a defined error code and the template is unchanged.
6. **Positions.** After any add, archive, restore or reorder, active template positions are exactly 1..N with no duplicates; restore places the topic at N+1.
7. **Creation never breaks.** Given any sequence of accepted maintenance operations, a newly created team has at least one topic and its topics are numbered 1..n in template order.
8. **Validation.** Empty/whitespace name or prompt, over-length values, unknown `vote_type`, duplicate active name (trim, case-insensitive), or exceeding the maximum size are each rejected with a distinct error and no audit success row.
9. **Audit.** Given any accepted write, exactly one audit row exists with actor, operation, topic id, changed fields and reconstructable change; given the audit insert fails, then the write is rolled back and the caller sees a failure.
10. **Sentinel.** The maintenance API accepts no team id; submitting the sentinel id anywhere in a team-scoped route still returns 404 `TEAM_NOT_FOUND`; the #188 structural test passes unchanged.
11. **No ritual configuration.** No maintenance operation can alter the first-session lock, team membership, or any non-topic-content setting (verified by endpoint inventory in the spec).
12. **Immutable vote type.** A request to change `vote_type` of an existing default is rejected (if B5 is accepted).
13. **Concurrency.** Two concurrent reorders yield one success and one stale-order conflict, or a serialized result; never an invalid sequence.
14. **Anomaly detector.** An archived template default does not raise `non_active_default` and does not fail the invariants suite.

## D. Suggested rewrites

- Sec. 1, "Structural, not configurable": replace with "The maintenance path changes only template topic content (name, prompt, first-session description, order, active/archived status). It exposes no control over the first-session lock, membership, or session rules."
- Sec. 2 closing UX line: "Before any save, the interface or response states that the change applies to teams created from now on, and that existing teams keep their current topics."
- Sec. 4 recommendation: "Every successful template write is committed atomically with its audit row. A failed audit write rolls back the change."
- Sec. 5 invariants list: change "(c) no non-active default" to "(c) archived defaults are valid; archived defaults are never copied to new teams."
- Sec. 7 Edit row: "Name, prompt and first-session description are editable. `vote_type` is fixed at creation."
- Sec. 9: add an owner and a deadline to each question; mark each as Blocking (Q1, Q3, Q5, Q6, Q10) or Non-blocking.

## E. Open question triage

| # | Question | Blocks proposal? | Suggested owner |
|---|---|---|---|
| 1 | Archive vs delete | Yes (recommend archive, B) | BA + Devon, PO ack |
| 2 | vote_type immutable | Yes | BA (recommend yes) |
| 3 | Audit metadata | Yes | BA + design; resolve versioning dangling ref |
| 4 | Trigger | No; decision recorded in design | Engineering |
| 5 | Baseline test reshape / "canonical" | Yes for definition; mechanism in design | BA (definition), Engineering |
| 6 | API vs UI | Yes | PO |
| 7 | Reports by name | No; BA/Devon confirm | BA |
| 8 | Copy for recovery/restore | No | BA + UX |
| 9 | Route namespace | No; design | Engineering |
| 10 | Template size cap | Yes | PO |

## F. Additional gaps not raised in the notes

1. **Who is the user?** No use case is named. This needs a use case in `08 - Topic Management - Use Cases.md` (e.g. "Maintain Default Topic Set") with actor, preconditions, main flow and alternates. Without it, traceability from FR-8.1 to feature is broken.
2. **Zero and one team states.** If the template is edited before any team exists, nothing special; but the notes should say the maintenance path works on an empty system.
3. **Edit no-op.** Submitting an edit with no changes: audit row or not? Suggest no row, 200 with unchanged result.
4. **Reorder input.** Whole-list PUT: must contain exactly the active ids; define the error for missing/extra ids.
5. **Archived-template visibility.** Can an admin list archived defaults (needed to restore)? State that the read path exists and what it returns.
6. **Rollback of a bad edit.** No undo is specified. Is "edit it back" sufficient? Say so explicitly.
