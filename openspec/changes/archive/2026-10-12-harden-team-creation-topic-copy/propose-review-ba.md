# Proposal review (BA): harden-team-creation-topic-copy (#215)

Reviewer: Marcus Delgado, Business Analyst. Inputs: proposal.md, both delta specs, main specs `default-topic-provisioning`, `topic-customization-lock`, `topic-management-screen`, BRD 6.4, FR-8.1, FR-8.6.

## Verdict

Buildable. Approve with the changes below. Most capabilities are already explicit, with Given/When/Then and named log fields. Two items need a decision before implementation (B1, B2). The rest is tightening.

## Open items from the request

### 1. Is the topic-customization-lock delta correctly ADDED, not MODIFIED?

I searched `openspec/specs/topic-customization-lock/spec.md`. No requirement there states a rule for `defaultTopicsNotActive`. The only mention is a non-normative "Implementation note" (line 296) at the end of the requirement titled "The all-topics endpoint's response carries the team's display name, ...". No SHALL sits on the field's contents. So ADDED is correct: no existing requirement is being restated, and a MODIFIED delta would fail validation because there is no matching header.

Two follow-ups:

- **B1 (stale wording).** That note says the field "is correctly computed by this endpoint's query" and lists "the team's canonical default topics". After this change the first claim is false for the pre-change code, and the definition is now the active-template-default set. Either (a) MODIFY that whole requirement to rewrite the note, which means copying the full long requirement and its scenarios and carries real merge risk, or (b) leave it, and state in the ADDED requirement that it supersedes the note. I recommend (b). Add one sentence to the ADDED requirement: "This requirement supersedes the implementation note in the requirement '...extensions beyond the originally-drafted contract' where they differ." Otherwise the archived main spec holds two statements that disagree.
- **B2 (consumer reality).** `topic-management-screen` (line 989) says the screen must not read `defaultTopicsNotActive`. So C5, C6 and C7 protect an API field with no current UI consumer. That is fine for BRD 6.4/FR-8.6 (the restorable set stays defined), but the proposal should say so in one line. Otherwise a reader assumes a visible facilitator fix. It also supports D11 (no facilitator-visible change). Note also that FR-8.6 ("visible and restorable ... at any time") is, from the facilitator's side, met by the screen's own archived list, not by this field. This change does not close that, and the proposal should not imply it does.

### 2. openspec CLI

Not available. `which openspec` finds nothing, and there is no local `node_modules/.bin/openspec`. I could not run `openspec validate --strict harden-team-creation-topic-copy`. I checked by hand:

- The MODIFIED header in the provisioning delta matches the main spec header exactly (main spec line 9), as required.
- The MODIFIED block restates every original scenario. The ordering scenario was deliberately rewritten.
- The other four new requirements are ADDED, and each has at least one scenario.
- Every requirement uses SHALL.

Residual risk: strict validation may flag nothing, but it should still be run by someone with the CLI before archive. Add that to tasks.md as a gate.

## Are the capabilities specific enough to implement?

| Capability | Verdict | Gap and suggested condition |
|---|---|---|
| Active-only copy | Explicit | Fine. C1 covers it. |
| Numbering 1..n, ties by id | Explicit | Add a scenario where an archived row sits between active rows (the 23505 case from the Why section). It is the real defect and no scenario names it. Condition: template has archived P1 and active P1; creation returns 201, new team has one topic at 1. |
| Shared predicate for copy and restore | Explicit but weakly testable | "Defined once" is satisfied by C7 only for an empty team. Add a case for a team with some topics (set difference), so C7 does not pass by accident. |
| `defaultTopicsNotActive` status filter | Explicit | Add the case the proposal omits: template X active, team holds X active, so X is absent. A regression guard on the unchanged path. |
| Template anomaly signal | Mostly explicit | See V1 to V4 below. |
| Zero active defaults | Explicit | Message text is quoted. Add: status is exactly 500 and the `correlationId` appears in the body (spec says "with a correlationId" but no scenario asserts it). |
| Invariants test | Explicit | "Baseline list" and "N" are undefined in the spec. State N = 12 and where the list lives (file path) in tasks.md. |
| #188 regression update | Explicit | Fine. |
| D7 one-time data check | Vague | "Records the result in tasks.md" has no pass criterion. Condition: count = 0 means proceed; count > 0 means open the remediation issue before merge, and the number is recorded. |

## Vague language to fix

- **V1.** "Position gap" versus `non_contiguous_order`. The spec says "positions that are not exactly 1 to n". A template starting at 0, or at 2, is that a gap? Say: the sorted active default positions differ from 1..n, including a nonzero start.
- **V2.** `non_default_row`: the requirement says "a row with `is_default = false`". Does that include archived non-default rows? Say whether the check counts all template statuses. The invariants test says "any non-default row exists", which implies all statuses. Make both agree.
- **V3.** "Exactly one" `warn` entry per creation. Per request, I assume. Say so, and say what happens under concurrent creations (one entry each, so N entries; no de-duplication). Operators will see log spam from a persistent fault. Is that intended? If so, state it. If not, that is a decision for Devon.
- **V4.** `topicIds` of "the affected rows": for a gap, which rows? Probably none, or all. Define per anomaly type, or say the list may be empty for `non_contiguous_order`. Also cap the list or confirm 12-ish rows makes a cap unnecessary.
- **V5.** "Identical to before this change" (healthy-template response). Specify what is compared: status, body shape, and field values excluding generated ids and timestamps.
- **V6.** "Canonical order" is used in the proposal and in C11 without a definition. Define once: template `display_order` ascending, ties by `id`.
- **V7.** The Why section says 23505 on topics returns 500, but C4 states a scratch schema is needed to produce duplicates. The duplicate-position scenario in the spec says "an environment without the unique partial index". It is unclear whether it is a required automated test or documentation. Make it a required test and say how (drop the index inside the test transaction, as the Impact section suggests).
- **V8.** "Exactly the active default topics ... regardless of template history" (C11) is stated as a user-side outcome. Good, but "regardless" is unbounded. Bound it to the four anomaly types plus the zero case.

## Acceptance criteria: explicit or implicit

Explicit: C1 to C12 are all stated, and each maps to a scenario. Implicit gaps:

1. **Traceability.** BRD 6.4, FR-8.1 and FR-8.6 are cited, but the proposal does not map conditions to them. Suggested table: C1, C5 and C6 trace to FR-8.6; C1 and C4 to FR-8.1 (shipped default applied to all new teams); C2 and C8 to 6.4 (drift detection). FR-8.1 also says the default set is "maintainable by an Application Administrator". The proposal correctly defers that to F5 (#216), but there should be a tracked line saying FR-8.1's maintainability half remains open, so it cannot be mistaken as satisfied.
2. **The "no gaps or duplicates" claim** for the new team assumes nothing else inserts topics in that transaction. State that no other topic rows exist for the new team before the copy.
3. **Session topic order (C12)** is asserted but no scenario in the first session says what "equals" means (same ids in the same order? same names?). Session snapshots copy rows, so the check should be names and positions.
4. **Rollback (C3).** "Nothing persists" lists team, topic, session and audit rows. Does it include membership rows (the creator becomes a member)? Add it.
5. **Out of scope item "#TBD".** The proposal needs the issue number before it is archived. Flag it as a gate on the first task. Also, D10's duplicate restore entry is user-visible only via the API, and given B2 it is not user-visible today. Re-word "User-visible" accordingly.

## Edge cases I would add (QA instinct)

- Template has exactly one active default (boundary of "zero" and "healthy").
- Template default with a NULL or empty `first_session_description` copies as-is (NULL stays NULL).
- Two template defaults with the same name, one active and one archived: only the active one copies; the restore list has one entry. This interacts with D10, so confirm it is not the D10 duplicate.
- Concurrent team creation during a template edit: the copy reads a consistent snapshot (state the isolation assumption, or say it is acceptable that it reads either state).
- Template default whose `vote_type` or other column is invalid: out of scope, but say the DB constraints already prevent it.
- Zero-sessions state (my standing concern): a team created from an anomalous template must still be usable, so its first session must start with n >= 1 topics. C12 covers this, so add it as an explicit assertion that the first session is startable.

## Requirements check (against requirements/)

- BRD 6.4 and FR-8.6: strengthened as claimed, with the caveat in B2.
- FR-8.1: the shipped default is applied to all new teams (met); the "maintainable by an Application Administrator" half stays with #216. Say so.
- Topic history preservation (my persona constraint): the change copies only active defaults and never deletes or archives team topics, so history is untouched. Worth one explicit line in the non-goals.
- Facilitator and participant views, simultaneous reveal, no-manager rule: untouched, correctly listed.
- Outlier/threshold "no magic numbers": not applicable here.

## Summary of requested changes

Must (before implementation): B1 (supersede wording), B2 (one-line consumer note), V1, V2, V3, V4 (define the anomaly semantics), V7 (make the duplicate test required), D7 pass criterion, the openspec validate gate in tasks.md, and the #TBD issue number gate.
Should: the extra scenarios in the table above, the traceability table, and the edge cases.
