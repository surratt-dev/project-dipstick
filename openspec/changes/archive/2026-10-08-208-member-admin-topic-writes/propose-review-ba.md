# Propose Review: Business Analyst (Marcus Delgado)

**Change:** 208-member-admin-topic-writes (#208)
**Reviewed:** `proposal.md`, all eight delta specs under `specs/`, plus `tasks.md` for coverage. I checked them against `requirements/BRD.md`, `requirements/use cases/08 - Topic Management - Use Cases.md`, the main specs under `openspec/specs/`, and the #232 archive.
**Scope of review:** whether the proposal and specs faithfully implement the product owner's decision. I am not reviewing whether the decision is right.

## Verdict

**Approve with changes.** The proposal does what the owner decided. Writes have no membership bar. The #232 read bar is reverted completely, including the predicate, both `403`s, the messages, `admin.topic_config_denied`, and the parity exception. The audit row stays and is now described as permanent. Most scenarios are explicit WHEN/THEN statements with exact messages, exact keys and exact ordering, which is what I want to see. There are two fidelity problems and one factual error to fix before design is frozen (F1–F3). The rest are testability tightenings.

## Delta-spec structure (checked by hand)

| Capability | Header(s) | Requirement names vs main spec | Result |
|---|---|---|---|
| add-custom-topic | MODIFIED | 1/1 exact match | OK |
| remove-topic | MODIFIED | 1/1 exact match | OK |
| restore-topic | MODIFIED | 1/1 exact match | OK |
| reorder-topics | MODIFIED | 1/1 exact match | OK |
| team-content-access | MODIFIED | 1/1 exact match | OK |
| topic-annotation | MODIFIED | 1/1 exact match | OK |
| topic-management-screen | MODIFIED | 3/3 exact match | OK |
| topic-customization-lock | RENAMED + MODIFIED | 2 MODIFIED match exactly. RENAMED FROM `The all-topics endpoint audits every administrator read and every administrator denial` exists at main L313. The MODIFIED block uses the TO name. | OK. This matches the `2026-10-02-topic-003-admin-authorization` and `2026-10-06-store-idp-role-set` precedents. |

Every #232 statement I found in the main specs sits either inside a requirement block this change replaces or in a Purpose paragraph that task 8.1 covers. These include `topic-customization-lock` L115–140, L191, L204, L290–384; `team-content-access` L178, L191, L233, L250, L258; `topic-annotation` L234; and the Purpose lines of `restore-topic` and `reorder-topics`. The cross-reference to the old requirement name at `topic-customization-lock` L123 is inside a MODIFIED block and is rewritten. **No structural defects.** One caveat: task 8.1 edits two main-spec Purpose lines by hand at sync time. If someone archives the change without reading tasks.md, those lines will still say "adds a no-manager rule to its admin side, #232". The 8.2 grep catches this, so keep 8.2 as a hard gate.

## Findings

### F1 (fidelity, must fix): the specs restate the owner's rule as a system-wide truth, and the system contradicts it

Four delta specs say administrators are "a trusted role, constrained only from facilitating their own team". In `add-custom-topic` it appears as normative text, and `topic-customization-lock` and the 08b brief in task 7.1 use the same words. The owner's verbatim words were "should not be constrained from any features except facilitating their own team."

The same change deliberately keeps these admin restrictions:

- FR-1.3 / FR-2.4 / Constraint 2 (D11): no participation, votes or live events. That is participating, which is different from facilitating.
- `team-content-access` Option B: trends, sessions, action items and notes are denied, and the requirement still says "SHALL NOT have access to session content endpoints".
- TOPIC-001: denied, with `admin.session_content_denied`.
- TOPIC-007 / FR-8.7: no annotation authoring.
- Admins cannot facilitate *any* team, because only `facilitator` creates sessions (FR-2.1). "Only from facilitating their own team" is therefore not even accurate on its own terms.

The proposal's "Constraints" section files all of these under "the parts of the ritual the owner's 'except facilitating their own team' protects". The quote does not cover them. I am not asking to reopen the decision. I am asking for its **scope** to be written down, so that a reader of 08b cannot cite it to remove Option B or the FR-8.7 bar.

**Concrete conditions:**
1. In the delta specs, replace "constrained only from facilitating their own team" with an attributed quote and an explicit scope, for example: "The product owner decided (#208) that administrators are a trusted role and are not barred from topic configuration by team membership. This decision covers TOPIC-002..006 only."
2. Give 08b (task 7.1) a "Scope" section. It should say that the decision is applied to topic configuration reads and writes, and that FR-1.3/D11, Option B session-content denial, TOPIC-001 denial and FR-8.7 annotation authoring are **not changed by this decision and remain in force**. It should also record that applying the quote literally would reach these, and that this was noted to the owner and not acted on.
3. Add one line to the PR description (task 8.4) asking the owner to confirm that scope. That is a confirmation, not a re-decision.

### F2 (factual error, must fix): the write audit rows do carry topic ids

Proposal, Constraints, 4th bullet: "Neither carries topic names, ids or definition text." That is true for `admin.topic_config_accessed`. It is false for the `topic.*` write rows. `packages/backend/src/routes/topics.ts` writes `metadata: { topic_id }` for `topic.custom_added` (L985) and `{ topic_id, openActionItemCount }` for `topic.archived` (L1205). It is fine for a write row to carry a topic id, because that row is the record of which topic changed. The proposal must not promise otherwise, or someone will "fix" the rows to match the text.

**Concrete condition:** reword to "The access row carries no topic names, ids or definition text. The `topic.*` write rows carry `topic_id` (and endpoint-specific counts) but no topic names or definition text." Check that the 08b record and `docs/deployment.md` (task 7.8) use the same wording.

### F3 (fidelity, must fix): one scenario in a rewritten block still rejects member-admins

`topic-customization-lock`, Scenario "A caller who is neither a standing facilitator nor an admin is rejected" reads: "a caller who does not have `global_role = 'facilitator'` (and is not an `application_admin`), **or who is an active member of the target team** … THEN 403". Read literally, the "or" clause covers an `application_admin` with a membership. That directly contradicts the scenarios above it. The text was already in main (L218–220), but this change rewrites the block and is specifically about member-admins, so this is the place to fix it.

**Concrete condition:** split it into two scenarios.
- "WHEN a caller whose global role is neither `facilitator` nor `application_admin` requests … THEN 403." The engineer, `engineering_manager` and no-`users`-row cases are already in the parity matrix.
- The member-facilitator case is already covered by "A facilitator who is an active member of the team is rejected". Delete the "or who is an active member" clause rather than restating it.

### F4: the screen's access-denied scenario still keys eligibility to "the standing facilitator model"

`topic-management-screen`, "An ineligible caller sees an access-denied state" uses: "WHEN a caller who is not eligible under the standing facilitator model". Admins are not eligible under that model, yet the requirement body now admits them. **Condition:** "WHEN a caller whom TOPIC-002 rejects (a facilitator who is a member of the team, an engineer, or an engineering manager by global role) navigates …".

### F5: no scenario says a manager-admin can *use* the write controls on the screen

The screen deltas pin that a manager-admin *sees* the screen and sees definitions read-only. The whole point of #208 is that the API writes are allowed, and the old split was "API yes, screen no". The UI side of "writes allowed" is never asserted. **Condition:** add a scenario to `topic-management-screen`: "WHEN an application administrator with an active `engineering_manager` membership views an unlocked team's Topic Management screen THEN each active row has a Remove action, the add-topic control is shown (`canAddTopics: true`), reorder controls are shown, and the removed-topics list offers Restore; AND no definition add/edit/clear control is shown." Add a matching test to task 6.4. Today that task covers only the read-only definition.

### F6: the write-side member-admin scenarios should name the operation

The new EM-admin scenarios in `remove-topic`, `restore-topic` and `reorder-topics`, and the EM case in `add-custom-topic`, assert "exactly one `audit_log` row for the write". `add-custom-topic`'s member scenario already names `topic.custom_added`. **Condition:** name the operation in each one (`topic.custom_added`, `topic.archived`, `topic.restored`, `topic.reordered`). Otherwise a test that counts any row passes even when the wrong operation is written. These rows are now described as the permanent record, so the assertion has to be exact.

### F7: compound "regardless of membership" THEN clauses hide a test matrix

`remove-topic` / `restore-topic` "An application administrator can … for any team" end with "AND this succeeds regardless of whether the admin is also an active member … in any membership role, including `engineering_manager`". That is three cases in one THEN. Tasks 4.3/4.4 cover none/EM explicitly, but not `participant` on archive, restore or reorder. **Condition:** either state the matrix in the scenario ("for each of: no membership, `participant`, `engineering_manager`") or point the task at the existing parametrised test that covers it. "Any other role" (add-custom-topic) is untestable as written. Drop it or define it as "any value of `team_memberships.role`".

### F8: Use Case 08 actor lines leave admins out of three of the use cases this decision covers

Task 7.6 removes the #232 alternate flow from "View Active Topic Configuration". But the **Actor** lines for *Remove a Topic* (L190), *Re-Add a Previously Removed Topic* (L384) and *View Active Topic Configuration* (L448) still say "Facilitator" only. *Add Custom Topic* and *Reorder Topics* already say "(or Application Administrator, per FR-8.2)". The View use case's first acceptance criterion also says the screen is "accessible to the Facilitator". For traceability, the use cases should say what FR-8.2 now says. **Condition:** extend task 7.6 as follows.
- Use the FR-8.2 actor wording on those three use cases.
- Add the acceptance criterion "An Application Administrator can view the screen for any team, whatever their membership on it; team definitions are shown read-only."
- In "Reorder controls are only available to the Facilitator, not to Engineers" (L297), add "or an Application Administrator".

### F9: the release-note follow-up has no owner or gate

The proposal correctly flags that the approved #187 release-note line becomes false, and drafts a replacement. Nothing in tasks.md blocks the merge until that line is re-approved. **Condition:** make it a checklist item in task 8.4's PR description with an explicit "owner re-approval required before release", and/or name the release-notes file to edit. That way the false line cannot ship by default.

## Vague language to tighten

| Where | Text | Suggested replacement |
|---|---|---|
| Proposal §What I'd ask, item 1; task 7.8 | "Keep admin membership in a team rare" | Fine as hygiene guidance, but say what to check: "Review `team_memberships` rows held by `application_admin` users at each access review; each should have a stated reason." Label it guidance, not a control. |
| `topic-customization-lock` audit requirement | `membership_role` "today `participant` or `engineering_manager`", "recorded without an allow-list" | Acceptable. Add one sentence saying a new membership role added later is recorded verbatim and needs no change here, so the "today" is not read as a closed set. |
| Proposal Why §3 | "which matters more now that a manager-admin is admitted" | Fine as rationale. No change needed. |
| Proposal What Changes | "**BREAKING** (… in the permissive direction)" | State the affected caller: "Clients that branch on the TOPIC-002 `403` messages for admins. In-repo, only `TopicManagementPage`, whose handling is generic." |

## Edge cases checked and found covered

- Removed (`removed_at` set) EM membership is recorded as `null`, with an explicit scenario.
- An admin requesting a canonical UUID that names no team gets `200` and is audited with `team_found = false`.
- Global EM with any membership gets `403 NOT_A_FACILITATOR`, unchanged and pinned.
- Facilitator path has no extra `team_memberships` query, pinned by SQL text.
- TOPIC-007 still rejects a manager-admin (topic-annotation scenario). TOPIC-001 still denies admins.
- Historical `admin.topic_config_denied` rows are left untouched, with no migration (stated in the non-goals and the visibility guard).
- Fail-closed behaviour on membership read, role-set read and access insert is kept, and each has a scenario.

## Summary for the author

F1–F3 must be fixed. F1 is about scope: attribute the owner's quote and record what the decision does *not* change. F2 corrects a false claim about the write audit rows. F3 removes a scenario clause that contradicts the decision. F4–F7 tighten testability, F8 brings Use Case 08 in line with the decision for traceability, and F9 adds a gate for the release note. None of them changes the decision or the design direction.
