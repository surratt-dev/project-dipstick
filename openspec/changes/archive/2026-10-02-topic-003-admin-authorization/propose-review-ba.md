# BA Review: Proposal, topic-003-admin-authorization (#176)

Reviewer: Marcus Delgado (Senior Business Analyst)
Date: 2026-10-01
Reviewed: `proposal.md`, `design.md`, `tasks.md`, and the three spec deltas under `specs/`
Checked against: BRD FR-8.2, FR-8.6, FR-8.7; "Use Case: Add Custom Topic" (`requirements/use cases/08 - Topic Management - Use Cases.md`); the living specs `add-custom-topic`, `topic-customization-lock`, `topic-management-screen`
Focus: Can each capability be built as written? Are the acceptance criteria explicit?

---

## Verdict: approve, with three small fixes

This proposal can be built as written. Every point from my exploration review (C1–C4, V1–V7, G1–G4) has been answered, either in the spec deltas, in a design decision, or in a named task. The traceability chain is complete: FR-8.2 [HARD] → #176 → the spec deltas → tasks 3.x and 4.x → the parity test.

I also compared the deltas against the living specs requirement by requirement. Every MODIFIED or RENAMED requirement carries all of its existing scenarios. Only the two scenarios #176 made obsolete are dropped ("An administrator cannot add topics while #176 is open" and "An administrator sees no add control and no explanation"). Nothing will be lost silently at archive.

Below are the three items I'd fix before apply, then some minor wording points.

---

## 1. Items to fix before apply

### B1. A new scenario writes copy into the spec that is wrong for its own reader

`topic-management-screen`, the new scenario "Locked team with no topics, administrator", says:

> THEN the screen shows the locked variant's message

That message ends: *"Ask the people who run this application for your organization to restore this team's default topics."* For an application administrator, that sentence tells them to ask themselves. The proposal defers the copy to #200 (F4). That's fine. What isn't fine is a **new** scenario that turns the current copy into an acceptance condition for admins. Once it's in the spec, #200 has to fight a passing test to change it.

**Concrete condition:** reword the scenario so it asserts the structure and leaves the admin copy open:
- WHEN an application administrator views a team with `isCustomizationLocked: true` and no active topics
- THEN the locked variant is shown (no "Show archived topics" action and no "Add custom topic" action)
- AND the variant's message text is not asserted for administrators here. Admin-specific copy is owned by #200 (F4).

Alternatively, drop the scenario and rely on "An administrator on a locked team sees no add control" in the add-control requirement, which already covers the authorization point.

### B2. Purpose sections and implementation notes go stale at archive, and no task covers them

Spec deltas only carry requirements. After archive, these living-spec paragraphs will contradict the merged requirements:

| File | Text that becomes wrong |
|---|---|
| `openspec/specs/add-custom-topic/spec.md`, Purpose | "lets a standing, org-wide facilitator (one not an active member of the target team) add a custom topic…" (no admin arm) |
| `openspec/specs/add-custom-topic/spec.md`, "Implementation note — files" | says it reuses `evaluateStandingFacilitatorAccess`; after D1 the call site goes through `checkAddCustomTopicAuthorization` → `checkStandingFacilitatorOrAdminAuthorization` |
| `openspec/specs/topic-customization-lock/spec.md`, "Implementation note — `canAddTopics`" | "Computed … as `decision.actorGlobalRole === "facilitator"`" and "the `application_admin` rows' `expected` field is what the #176 fix must change" |

Task 6.2's grep for "#176" and "temporar" catches the third row. It doesn't catch the first two.

**Concrete condition:** add a task (or extend 6.2): "After `openspec archive`, update the Purpose and implementation-note paragraphs of `add-custom-topic` and `topic-customization-lock` to name the admin arm, the new wrapper, and the new `canAddTopics` expression. Check: `grep -n "standing, org-wide facilitator (one not" openspec/specs/add-custom-topic/spec.md` returns no hit without the admin clause beside it."

### B3. The member-admin success scenario doesn't assert the audit row

Task 3.2 says the member-admin success writes the same audit as the non-member case. The spec scenario "An application administrator who is a team member creates a custom topic" only asserts `201` and append order. The audit scenario "An administrator's creation is audited with the administrator role" doesn't say whether the admin is a member.

The member-admin is exactly the actor F1 is worried about. The audit row is the only record that a member-admin, not a facilitator, changed the team's topics. This needs to be a spec obligation, not just a test that happens to exist.

**Concrete condition:** add to that scenario: "AND exactly one `audit_log` row with `operation = 'topic.custom_added'` and `actor_global_role = 'application_admin'` is written in the same transaction as the insert."

---

## 2. Minor points (fix if convenient)

| # | Where | Observation | Suggested condition |
|---|---|---|---|
| M1 | Frontend tests, task 4.5 | Tests (a)–(c) prove the admin **sees** the control. None proves an admin submit **reaches the list**. That is the user-visible outcome of #176 ("can put a new one in"). | Add one screen test: admin, unlocked team, empty state → opens the form, submits a valid topic, mocked `201` + refetch → the new row appears and the empty state is gone. The facilitator equivalent at living spec L686 is the model. |
| M2 | `add-custom-topic`, "A caller who is neither facilitator nor administrator is rejected…" | "Engineering manager" is named, but the BRD gives EMs authority over their own team's membership (FR-1.6). Someone could read FR-8.2 as covering an EM. | No change to behavior. Add one line to design.md, or to the use-case Notes: "Engineering Managers are excluded from topic writes; FR-8.2 names only the facilitator and the Application Administrator." This keeps the exclusion traceable. |
| M3 | 403 copy, D2 | "application admin" vs the BRD term "Application Administrator". | Acceptable, since it matches TOPIC-004's shipped copy. Record in D2 that it was matched on purpose, so nobody "fixes" one endpoint alone. |
| M4 | Proposal, "What Changes", empty-state bullet | Says rows "3 and 5" are removed. After the change the table has no row numbers. Anyone reading the archived proposal later can't tell which rows those were. | Name the removed variants by content: "unlocked, `canAddTopics: false`, with archived topics" and "unlocked, `canAddTopics: false`, nothing archived ('Topics can't be added from this account yet.')". |
| M5 | Use case update, task 5.2 | The Main Flow and Alternate Flows still say "The Facilitator" throughout. | Fine to leave, since the Goal stays facilitator-voiced. Add one sentence under Summary: "An Application Administrator follows the same flow with the same validation and lock rules." Then the flows don't read as exclusive. |

---

## 3. FR-8.6 observation (not for this change)

For the record: on a **locked** team with zero active topics, an admin can't add, restore or reorder. Every write is gated by the lock, which applies to admins too (correctly, per FR-8.2's "after a team's first session"). FR-8.6 [HARD] says the canonical default set "must remain visible and restorable for any team at any time". This change doesn't create that gap, and it shouldn't try to close it, but #200 needs to resolve it. When F4 is posted on #200, include the FR-8.6 reference so the discussion isn't only about wording.

---

## 4. Keep as written

- The explicit statement in `add-custom-topic` that the administrator arm SHALL NOT be shared with TOPIC-007, and task 3.10's "without modifying them". This is the FR-8.7 guard.
- The parity scenario in `topic-customization-lock`, left unchanged and covering seven caller classes. It is the one test that makes the flag and the endpoint fail together.
- The admin check-order scenarios (404 > 422, 409 > 422, 422 on unlocked), and leaving out "admin at 403" on purpose.
- The scenario "An administrator's add does not change a session whose room is already open". It ties #176 to the #175 snapshot guarantee in observable terms.
- D6's warning not to restrict the add form's fields for admins.
