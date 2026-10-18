# Proposal review (BA): admin-default-topic-maintenance (#216)

Reviewer: Marcus Delgado, Senior Business Analyst
Reviewed: `proposal.md`, `design.md`, `specs/*` deltas, issue #216, BRD FR-8.1/8.2/8.6/8.7.

## Verdict

**Approve with conditions.** The capabilities are specific enough to implement. The new-capability spec is explicit: exact routes, check order, error codes, limits, and a scenario for most rules. Acceptance is mostly explicit and testable. I found eleven gaps (section 3) where a developer would have to guess. Two of them (G1, G2) are behaviours that will otherwise be decided differently by whoever writes the code. Section 5 lists the conditions. None needs a design change.

## 1. Traceability: every issue acceptance line

| Issue line | Where covered | Status |
|---|---|---|
| Admin-only endpoint(s): add, edit, archive/restore, reorder | Spec req 1 and 4; design E1, E5 | Covered |
| Own authorization, Application Administrator only | Spec req 2 (live `global_role`, own 403 code) | Covered |
| Own audit events, separate from `topic.write_denied_template` | Audit delta (five operations plus the denied event) | Covered |
| Edit affects only teams created afterwards; "confirm against the requirements" | Proposal "What it is not"; spec req 5 and 6 | **Covered but the confirmation is not cited.** FR-8.1 does not say this. The proposal asserts it. The use-case 08 text and the BRD 6.4 copy-on-create sentence must be cited as the confirmation (see G11). |
| Template display positions stay unique so team creation works | Spec req 3 (dense 1..N), req 4 (negate-then-set), req 7 (lock); `default-topic-provisioning` delta | Covered |
| Admin can maintain without a migration; every change audited | "No migration"; audit delta; spec req 4 | Covered |
| #188 guard and structural test pass unchanged | Spec req 1, scenarios 2 and 3 | Covered |
| Non-admins get 403 | Spec req 2 | Covered (including EM and facilitator) |
| #215: every template write through one audited function | Spec req 9; design E3 | Covered |
| #215: one `audit_log` row per template write | Audit delta | Covered. A no-op writes zero rows by design; "one per write" is satisfied only if a no-op is not a write. See ruling R4. |
| #215: trigger reconsidered | Design E11 (declined again, reasons, revisit triggers) | Covered. The outcome is recorded as the issue asks. |
| #215: invariants baseline updated in the same change as any edit to the defaults | Design E6 reshapes the test | **Deviates from the literal line.** The issue says the baseline is updated with any edit. The proposal makes it a migration-time baseline that an admin edit never touches. That is the right reading, since a runtime edit cannot change a CI file. But it reinterprets an acceptance line, so it must be on the PO-ack list (D5 covers "canonical" but not this reinterpretation). |

Every line is traceable. One line needs a PO-visible note (baseline) and one needs a citation (new-teams-only).

## 2. Rulings on the three ratification items

**R1. Refuse edits to archived defaults (`409 DEFAULT_ARCHIVED`): RATIFIED, with one condition.**
The reasoning holds. If an archived row could be renamed freely, a later restore could collide with an active name. It keeps the archived row as a fixed record of what was retired, which supports topic-history preservation. Condition: the restore-collision case must be actionable. The `DEFAULT_NAME_DUPLICATE` response on restore must name the conflicting active default, and the spec needs a scenario for it (G3). Without that, the refusal traps an admin who cannot fix the archived row's name and must guess why restore fails. If the follow-up screen ships and users hit this often, revisit by allowing edits to archived rows with uniqueness checked at restore time only.

**R2. Per-row `lastChangedAt` excludes reorders; separate `orderLastChangedAt`: RATIFIED.**
A reorder moves every row, so counting it would make every row look recently edited and destroy the signal. "Last changed" should mean the content or status of that row. Two conditions:
- Define it in the spec as derived from the latest `added`, `edited`, `archived` or `restored` audit row naming the topic. Today only the design says so.
- Note the dependency: this value is derived from audit rows, so it is only as durable as audit retention. If audit rows are ever purged, `lastChangedAt` silently becomes null. State the retention assumption in the runbook.

**R3. Code name `DEFAULT_MAINTENANCE_ADMIN_ONLY`: RATIFIED.**
It is distinct from `NOT_AN_ADMIN` and `NOT_A_FACILITATOR` and says who may use the surface. It follows the repository's naming pattern. No change.

**R4 (extra, not asked). No-op returns 200 with no audit row: RATIFIED.** Please make the spec define "no-op" precisely (G4).

## 3. Gaps: vague or implicit, with concrete conditions

**G1. Success status codes are not stated.** The spec lists every error status but never the success status. Add: add returns `201`, all other writes `200`, GETs `200`. Add a scenario per route asserting the status and that the body has `defaults`, `limits`, `orderLastChangedAt`, `scope`.

**G2. Rename to a differently cased or spaced version of the row's own name.** Duplicate detection says "another active template name". State that the row being edited is excluded. Condition: PATCH "Pairing" to "pairing" or " Pairing " on the same row is accepted (a change of case is a real change and is audited), not `DEFAULT_NAME_DUPLICATE`. Add the scenario.

**G3. Restore collisions have no scenario.** Design says restore returns `DEFAULT_NAME_DUPLICATE` when an active default already has the name, but the spec scenarios only cover add and rename. Add: archive "Pairing", add a new active "Pairing", restore the archived one: `409 DEFAULT_NAME_DUPLICATE`, nothing changes. Also state the check order for restore (already active 422, then capacity 409, then name 409) so two simultaneous failures give one defined answer.

**G4. "No-op" is not defined.** Condition: an edit is a no-op when, after trim, every supplied editable field equals the stored value, byte for byte (case and internal whitespace count). Decide and state: an empty PATCH body (`{}`) is a no-op `200`, or `422`? I recommend `422 DEFAULT_FIELD_REQUIRED`-style "nothing to change" is not worth a new code, so make it a no-op `200`. Whichever is chosen, test it. A PATCH with several fields where one is invalid must apply none of them (all-or-nothing). Add that scenario.

**G5. Denial-audit "bound" and timing floor are references with no value.** Spec says "the shared per-actor bound" and "the existing constant". That is acceptable for implementation, but the acceptance scenario must name the actual limit from `admitDenialAudit`, or it cannot be tested. Add the number to the scenario, or a test that reads the constant.

**G6. History endpoint parameters.** `limit` default 50, max 200 is stated. Not stated: behaviour for `0`, negative, non-numeric, or above 200. Condition: above 200 is clamped to 200 (or `422`; choose one); invalid is `422` with a code. Also state ordering ties (same timestamp) are broken by id. Add boundary scenarios at 1, 200 and 201.

**G7. Reorder edge cases.** Add scenarios for: a single active default (list of one is a no-op `200`); a list containing an archived id (already covered as mismatch, good); a list of the right length with one id repeated (`422 INVALID_DEFAULT_ORDER`, covered by name but no scenario); an empty list. Also the stale-same-ids case: design E8 says last write wins and the audit keeps the old order. That is a behaviour an admin might not expect. It needs a spec scenario, not only design text.

**G8. Add: position and capacity ordering.** If the template is at 15 and the new default is also invalid, which error wins? Per check order, validation (422) comes before the transactional capacity check (409). Say so in one scenario so it is not accidental.

**G9. Archived row's `displayOrder` is `null` in the API but the row keeps its old number in the table.** That is fine, but add a scenario that after restore the position is N+1, never the old number, and that an archived row's old number never blocks the partial unique index.

**G10. "Plain text" rule precision.** The list is clear. Two ambiguities: (a) a literal `<` followed by a space or digit (for example "rate < 5") is allowed, since the rule needs a letter, `/` or `!` after `<`. Add that as an explicit allowed example, because teams will write comparisons. (b) A lone `&` not forming an entity (for example "Dev & Ops") is allowed. Add it as an allowed example. These two are the most likely false rejections in real prompts.

**G11. Citations for "new teams only".** Proposal asserts it. Condition: cite the exact existing requirement (use case 08 "Assign Default Topic Set to New Team", BRD 6.4 copy-on-create, FR-8.2 first-session lock) in the proposal's traceability so the issue's "confirm against the requirements" is visibly closed.

### Smaller wording points
- Proposal says "Six operations" then lists seven routes (six plus history). Say "seven routes".
- "Visible, restorable baseline", "quietly", "bounded", "small denial-audit seam" are narrative, fine in a proposal, but none may appear as an acceptance criterion without a number.
- "A rename response additionally says name-based matches ... will no longer pair": give the exact `notice` string in the spec (the `scope` string is exact; the notice is not). Tests will otherwise assert only presence.
- "Prompt must address the team and the work, never individuals" is a guideline enforced only by documentation. That is a deliberate decision (E9). Record it as a known residual risk in the proposal itself, not only in design.

## 4. Requirements and persona checks

- **Topic history preservation (my hard requirement): met.** Archive, never delete, at the template level. Team histories are untouched (isolation requirement and its negative test).
- **Structural, not configurable: met.** The inventory-as-test is the right control. Good.
- **FR-8.1 "partially met, API only": correct and honest.** Do not mark it met until the screen ships. This is the main reason the follow-up issue numbers matter.
- **FR-8.2 / FR-8.7 interplay:** admins edit the template, not teams' definitions. Nothing here touches annotation. Fine.
- **FR-8.6 note ("canonical means the current template"):** acceptable as a note, but the FR-8.6 traceability text from #218 already says "canonical wording on restore is still not met". The two notes must read consistently. Update both in one edit.
- **Follow-up issue numbers are `#TBD`.** Task 1.4 says they are recorded before acceptance. Treat this as a gate: I will not sign acceptance while any of the four is still `#TBD`.
- **Dry run with a facilitator (task 8.1):** good, and it is the only usability check an API-only release gets. Make its outcome a recorded checklist item, not just a task.

## 5. Conditions for ratification (summary)

1. Add the success status codes and response-shape scenario (G1).
2. Exclude the edited row from its own duplicate check, with a scenario (G2).
3. Add restore-collision scenario and check order (G3).
4. Define no-op, empty-body, and multi-field atomicity (G4).
5. Put actual numbers in the denial-audit scenario (G5).
6. Specify history parameter boundaries (G6) and reorder edge cases (G7).
7. Add allowed-example scenarios for `<` followed by space and lone `&` (G10).
8. Cite the confirming requirements for new-teams-only (G11) and add the baseline reinterpretation to the PO-ack list.
9. Fill the four follow-up issue numbers before acceptance.
10. State the audit-retention dependency of `lastChangedAt` in the runbook (R2).

With these closed, I consider the proposal ready to implement against. Items 1 to 4 are the ones I would not want the team to decide on its own.
