# BA review of exploration notes: harden-team-creation-topic-copy (#215)

Reviewer: Marcus Delgado, Business Analyst

Overall: the diagnosis is strong and evidence-based. The scope list (section 6) is close to requirement-ready, but several items are phrased as intentions ("make it loud", "clean failure", "one shared definition") with no observable pass/fail. Those cannot go into a proposal as they stand. Below: clarifications needed, vague areas, and suggested rewrites.

## A. Clarifications needed (answer before the proposal)

1. **What is "the canonical default set"?** Notes use it three ways: template active defaults (s1), "twelve active defaults with expected names" (s5), and `is_default AND status='active'` (s7). Decision needed: is the set defined by a predicate or by a fixed list of twelve? These differ the moment F5 (#216) edits defaults. Recommend: the predicate is the requirement; the twelve-name list lives only in the invariants test and is labelled as a baseline that F5 must update.
2. **Renumbering: is it a requirement or an implementation tactic?** s2 recommends `row_number()`, but acceptance in the issue allows "skip duplicates OR renumber". The proposal must pick one. Also: does the new team's `display_order` start at 1 or 0, and is the first-session/snapshot ordering expected to be unchanged for a healthy template? State the healthy-template outcome explicitly (positions identical to today).
3. **Warning event: what, where, who?** "Structured warning event" has no event name, sink, fields, or consumer. Is this a log line, an audit row, or a metric? Who is the "operator" who sees it? Without this, it is untestable. See C2.
4. **Zero active defaults: what does the facilitator see?** s7 asks whether the response is clean but does not say what "clean" is. Need status code, error code, and message for the create-team call. Does the team/transaction get rolled back (should: no half-created team)?
5. **Is `NoActiveTopicsError` reachable on this path today, and is it mapped?** Notes say "already throws downstream" and "confirm". That is an unverified claim; it must be verified before it is written into a requirement.
6. **Forward-only scope.** Confirm the stakeholder accepts that already-created teams with a resurrected topic are untouched, and who owns discovering them ("F4-style remediation" is not a defined owner). At minimum, a read-only count query result should be recorded in the change, or an explicit statement that none was run.
7. **`defaultTopicsNotActive` consumer impact.** Who consumes it (UI restore list)? Does an archived-in-template default that a team previously received (pre-fix) still need to be restorable for that team? Notes say the team's own archived copy still shows as restorable; confirm this holds even when the template no longer has it as active. Currently ambiguous: the filter on `dt.status` would drop that row entirely from a LEFT JOIN driven by `dt`.
8. **Requirement-level statement (s7 Q3).** Answer is yes from a BA standpoint: traceability to FR-8.1/8.6 needs a spec line. Confirm it goes in `default-topic-provisioning`.
9. **Name-only join side finding.** Say who files it and by when; "file separately" with no issue number tends to vanish. Cross-reference the new issue in the proposal's Out of scope.

## B. Vague areas

| Phrase in notes | Problem |
|---|---|
| "make the silent case loud somewhere an operator can see it" | No definition of loud, no location, no operator role. |
| "creation succeeds with gaps/duplicates" | "Succeeds" with what resulting data? Needs expected positions. |
| "one shared definition ... or at least one test that asserts both consumers agree" | An either/or is a design option, not a requirement. Requirement should be the behaviour (both consumers agree); the mechanism is design. |
| "template invariants test ... nobody holds a membership/session" | Which sentinel checks exist already in migration 23 CHECKs? Is this duplicate coverage? State the exact invariant list. |
| "Reuse that helper" (snapshot-restore) | Good, but name the helper and file so the task is unambiguous. |
| "decline the trigger, record on #215" | The declining decision needs a named decision-maker and a revisit trigger written into F5's scope (an actual task/issue link), otherwise it is a note, not a commitment. |
| "Cross-team comparability quietly erodes" | Rationale, fine, but no measurable outcome. Ties to nothing testable. |

## C. Suggested acceptance conditions (rewrites)

Use Given/When/Then; each is directly testable.

**C1. Archived template default is not copied**
- Given the template holds an active default "X" and an archived default "Y"
- When a new team is created
- Then the new team has a topic "X" with status `active` and has no topic "Y" in any status.

**C2. Template anomaly is observable** (replaces the "warning event" bullet)
- Given the template has any of: duplicate active `display_order`, a default row whose status is not `active`
- When a team is created
- Then creation succeeds (except zero-active case below) AND one log entry at level `warn` with message key `template_anomaly` is emitted, containing the anomaly type(s) and affected topic ids; healthy-template creation emits no such entry.
- (If an audit row or metric is wanted instead, the proposal must say so. Pick one.)

**C3. Zero active defaults**
- Given the template has no active default topics
- When a team is created
- Then the request fails with HTTP <status> and error code `<code>`, no team, membership, session or topic rows persist, and an error-level log entry names the template.

**C4. Positions are contiguous and ordered**
- Given the template has active defaults at positions {1,2,4,4} (index absent in a scratch schema) or {1,3,7}
- When a team is created
- Then the new team's active topics have positions 1..n with no gaps or duplicates, and relative order follows template `display_order` (ties broken by `id`).
- Given a healthy template (positions 1..12), the new team's positions equal the template's.

**C5. Restore list excludes archived template defaults**
- Given template default "Y" is archived and team T has no topic "Y"
- When `defaultTopicsNotActive` is evaluated for T
- Then "Y" is absent.

**C6. Restore list still shows a team's own archived copy**
- Given template default "X" is active and team T holds "X" archived
- Then "X" appears with `isArchived: true`.
- Open item (A7): the case where template "X" is archived AND team holds "X" archived must be specified, not left to the implementer.

**C7. Consumers agree**
- Given any template state covered by C1/C5
- Then the set of names copied at team creation equals the set of names for which `defaultTopicsNotActive` would report "missing" for a team with no topics. One test asserts this equality.

**C8. Template invariants (CI)**
- The test asserts exactly: N active defaults (N and names listed in the test), positions contiguous from 1, zero default rows with status other than `active`, zero non-default rows on the template, zero memberships/sessions on the sentinel. Failing any one fails CI with a message naming the violated invariant.

**C9. Regression suite updated**
- `template-team-creation-regression-integration.test.ts` compares against active defaults only, and compares positions as renumbered. Existing assertions otherwise unchanged and passing.

**C10. Trigger decision recorded**
- design.md contains a "Declined: template write trigger" section listing the four reasons, and F5 (#216) has a linked task "reconsider template write guard".

## D. Ritual / traceability notes

- Traceability: each requirement above should cite BRD 6.4, FR-8.1 or FR-8.6 as appropriate; C1/C5/C7 map to FR-8.6 (default set visible and restorable), C4 to 6.4 (shared language / comparability).
- The "template archive is a data fault, not a feature" statement is a policy decision touching organizational data ownership. Capture it as an explicit assumption in the proposal and have Devon confirm; do not let it be implied by a SQL filter.
- Zero-state: a new team created from a healthy template must be indistinguishable from today's behaviour. Make that an explicit no-regression requirement (C4 second half, C9).
- No ritual mechanics (reveal, no-manager rule, facilitator separation) are touched; agree with the notes. State it as a non-goal in the proposal so reviewers do not look for it.

## E. Summary

Ready to carry forward as-is: diagnosis (s1), the status-filter fixes, trigger decline reasoning, scope in/out structure.
Needs work before proposal: warning event definition (A3/C2), zero-active response (A4/C3), the restore edge case (A7/C6), the "shared definition" either/or (B), and the renumbering decision (A2).
