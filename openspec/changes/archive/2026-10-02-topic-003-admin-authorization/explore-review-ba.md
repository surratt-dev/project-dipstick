# BA Review — Exploration Notes, topic-003-admin-authorization (#176)

Reviewer: Marcus Delgado (Senior Business Analyst)
Date: 2026-10-01
Reviewed: `exploration-notes.md` (Devon Calloway)
Focus: Are the ideas specific enough to become requirements?

---

## Overall verdict

This exploration is mostly buildable. It traces back to FR-8.2 [HARD], names the protective constraints it must not weaken (lock, member-facilitator exclusion, FR-8.7), and lists the pre-committed coupling items with file locations. I checked the key claims against the code and they hold:

- `checkStandingFacilitatorOrAdminAuthorization` admits `application_admin` regardless of membership.
- `content.ts` L688 hardcodes `canAddTopics` to facilitator-only.
- The lock gate already receives `authResult.actorGlobalRole`.
- The live `topic-customization-lock` spec marks the admin `false` as **temporary**.

The gaps are in the **acceptance conditions**. Several tests are named by intent ("admin timing floor", "admin-as-member success") rather than by observable outcome, two decision points are left open, and the use-case rewrite is narrower than the use case actually needs. None of these block the change. Each needs one sentence of precision before it goes into a proposal.

---

## 1. Clarifications needed (decide before the proposal)

| # | Question | Why it matters | My recommendation |
|---|---|---|---|
| C1 | **Shared `canAddCustomTopic(globalRole)` predicate: yes or no?** (§3 leaves it as a "decision point") | An unresolved "lean slightly" can't be built or reviewed against. | Pick one in design.md and record why. If you skip it, write: "The parity test (`topic-add-flag-parity.test.ts`) is the sole drift guard between TOPIC-002's flag and TOPIC-003's authorization." Either choice is fine for requirements. What isn't fine is leaving it unrecorded. |
| C2 | **Frontend behavior when `canAddTopics: false` on an unlocked team** (§5, "open question") | After the fix, no admitted caller can produce this state. Either we specify what the screen does, or we explicitly say nothing is required. Otherwise someone will write an untested defensive branch. | State it as a rule: "The add trigger (heading and empty-state action) renders only when `canAddTopics === true` and `isCustomizationLocked === false`. The empty state has exactly three variants: locked; unlocked with archived topics; unlocked without archived topics. No scenario covers `canAddTopics: false` on an unlocked team, and the screen SHALL NOT show an add action in that state." |
| C3 | **Exact 403 copy for both rejection branches** | §3 gives the new `notAFacilitator` wording but says nothing about the `FACILITATOR_IS_TEAM_MEMBER` message. TOPIC-004 has distinct copy for each branch. | Specify both strings. (a) `NOT_A_FACILITATOR`: `"Only a facilitator or an application admin can add a custom topic."` (b) `FACILITATOR_IS_TEAM_MEMBER`: unchanged from the current `ADD_CUSTOM_TOPIC_AUTH_MESSAGES` value. Name who receives (a): engineer, engineering manager, and a caller with no `users` row. |
| C4 | **Admin-who-is-a-member: accepted decision or deferred question?** (§7) | "If anyone wants it revisited" is not traceable. The behavior is being shipped, so it needs a documented basis. | Record it as an **accepted decision** in design.md: FR-8.2 places no membership restriction on Application Administrators, and TOPIC-004/005/006 already admit member-admins. If the team still has doubts, file a GitHub issue covering all four write endpoints and link it. Don't leave it as a hallway question. |

---

## 2. Vague areas (hand-wavy acceptance conditions)

### V1. "Admin timing floor" test (§4.3, §9)
An admin is **never rejected at the 403 step**, so "add an admin case" to the 403 timing-floor suite doesn't test anything. The new early-return paths an admin can reach are 404, 409 and 422.

**Suggested acceptance conditions:**
- An `application_admin` POSTing to a nonexistent (canonical-format) team ID receives `404`, and the response is not sent before the timing floor elapses.
- An `application_admin` POSTing to a locked team receives `409 TOPIC_CUSTOMIZATION_LOCKED`, and the timing floor is applied.
- An engineer / engineering manager rejected by the **new wrapper** receives `403 NOT_A_FACILITATOR`, and the timing floor is applied. This is the actual new-code floor call the notes worry about.
- A member-facilitator rejected by the new wrapper receives `403 FACILITATOR_IS_TEAM_MEMBER`, and the timing floor is applied.

### V2. "Admin-as-member success" (§9)
This is underspecified as a test.

**Rewrite:** "WHEN an `application_admin` who holds an active (`removed_at IS NULL`) `team_memberships` row for team T sends a valid POST to an unlocked T, THEN the response is `201`, the topic is appended at the end of the display order, and the success audit row records `actor_global_role = 'application_admin'`."

### V3. Audit expectations only cover the lock-denial path (§4.2)
§9 asks for the audited role on the 409 path only. The **success** audit is the more important record. It is how an organization later learns that an admin, not a facilitator, changed a team's topic list.

**Add:**
- The success path writes one `audit_log` row with `operation = 'topic.custom_added'` and `actor_global_role = 'application_admin'` in the same transaction as the insert.
- The lock path writes one row with `operation = 'topic.write_denied_locked'`, `actor_global_role = 'application_admin'`, and `metadata.attempted_operation = 'topic.custom_added'`, before the 409 is sent. No `topic.custom_added` row is written.

### V4. Check-order scenarios for the admin path (§4.3)
The notes say "403 → 404 → 409 → 422 must stay" but give no admin scenarios. The existing ordering scenarios in `add-custom-topic/spec.md` are all written from the facilitator or non-facilitator side.

**Add these scenarios to the spec delta:**
- Admin + nonexistent team + invalid body → `404` (not 422).
- Admin + locked team + invalid body → `409` (not 422).
- Admin + unlocked team + invalid body → `422` with the existing field errors.

### V5. TOPIC-007 regression guard (§4.1, §9)
"TOPIC-007 admin still 403" is right, but the acceptance condition should be fixed to specific outcomes so a "consistency fix" can't slip through.

**Rewrite:** "Existing TOPIC-007 admin-rejection tests pass **without modification**. An `application_admin` PUT to the annotation endpoint still receives `403` with the unchanged annotation copy (`"Only a facilitator can edit a team's topic definition."`). TOPIC-002 still returns `canEditAnnotations: false` for an admin while returning `canAddTopics: true`." The last clause directly tests the "do not merge the two flags" rule.

### V6. Rows 3/5 frontend tests: "rewrite **or remove**" (§5)
"Or remove" is too loose. If those tests are simply removed, nothing on the frontend proves the admin can actually add, which is the user-visible outcome of #176.

**Rewrite:** "Replace the row 3 / row 5 admin tests with positive admin tests: (a) an admin on an unlocked team with no active topics sees the empty-state add action; (b) an admin on an unlocked team with active topics sees the heading add trigger; (c) an admin on a locked team sees the locked variant and no add action."

### V7. Line-number references (§5)
Many targets are cited by line number (Contract L612/L631/L695/L735/L762, spec L189–215, etc.). Those numbers drift as soon as the first edit lands.

**Suggestion:** in the proposal and tasks, cite each target by heading or by quoted anchor text (for example, "the `canAddTopics` requirement in `topic-customization-lock/spec.md`" or "the TOPIC-003 Authorization line"). Line numbers can stay as hints only.

---

## 3. Gaps in the requirements-document updates

### G1. The use case needs more than the Actor line (§5)
`requirements/use cases/08 - Topic Management - Use Cases.md`, "Use Case: Add Custom Topic", has facilitator-only language in several places. Changing only the Actor line leaves the use case contradicting itself:

| Location | Current | Suggested |
|---|---|---|
| Summary → Actor | Facilitator | Facilitator (or Application Administrator, per FR-8.2) |
| Goal | "As a Facilitator…" | Leave as-is (primary actor), or add a note that an Application Administrator may perform the same flow |
| Preconditions, 1st and 3rd bullets | Facilitator authenticated; standing-facilitator eligibility | Add: "or the actor is an Application Administrator (any team, regardless of membership)" |
| Acceptance Criteria, last bullet | "The add topic action is available only to the Facilitator, not to Engineers." | "The add topic action is available to a standing Facilitator (not a member of the team) and to an Application Administrator. It is not available to Engineers, Engineering Managers, or a Facilitator who is a member of the team." |

Please mirror whatever form the Reorder use case (L253 area) uses so the two read consistently.

### G2. Spec requirement headings need renaming, not just new scenarios
In `openspec/specs/add-custom-topic/spec.md`, the requirement title "A standing facilitator can add a custom topic to an unlocked team" becomes inaccurate. The delta should either **rename** it (e.g. "A standing facilitator or application administrator can add a custom topic to an unlocked team") or add a sibling requirement. The same applies to "…enforces the customization lock and standing-facilitator authorization". Say which in the proposal so the delta uses the right operation (MODIFIED vs RENAMED vs ADDED).

### G3. `canAddTopics` requirement rewrite: give the replacement text
§5 says "drop 'temporary', replace the scenario". Spell out the replacement so it can't be half-done:

- Requirement body: "`canAddTopics` SHALL be `true` for every caller TOPIC-002 admits, that is, every non-member `facilitator` and every `application_admin`. It SHALL NOT be derived from `canEditAnnotations`, whose administrator exclusion (FR-8.7) is permanent."
- Replacement scenario: "WHEN an `application_admin` requests a team's full topic list, THEN the response includes `canAddTopics: true` and `canEditAnnotations: false`."
- The existing parity scenario ("flag agrees with the add endpoint for every caller class") stays **unchanged**. That is the point of it. Say so explicitly.

### G4. Validation Report traceability
`requirements/design/REST API Contract - Validation Report.md` L65 marks FR-8.2 as **Covered** by TOPIC-003. That was inaccurate until this fix. No text change is strictly required after #176. I'd still note in the proposal that the report was wrong and is now true, so the traceability record stays honest. Optionally add "(admin branch: #176)" to the row.

---

## 4. Suggested rewrite of §9 (Recommended next step)

> **Scope:** TOPIC-003 authorization switched to `checkStandingFacilitatorOrAdminAuthorization` via a new `checkAddCustomTopicAuthorization` wrapper. `checkStandingFacilitatorAuthorization` is retained for TOPIC-007, which keeps it as its only caller. Updated 403 copy (C3). All §5 coupling items, with the use-case changes in G1 and the spec text in G2/G3.
>
> **Decisions recorded in design.md:** shared predicate yes/no (C1); frontend `canAddTopics:false` rule (C2); admin-as-member accepted per FR-8.2 (C4).
>
> **Required acceptance tests:**
> 1. Admin (non-member), unlocked team, valid body → 201; success audit `actor_global_role = 'application_admin'` (V3).
> 2. Admin (member), unlocked team, valid body → 201; same audit (V2).
> 3. Admin, locked team → 409 `TOPIC_CUSTOMIZATION_LOCKED`; `topic.write_denied_locked` row with admin role; no success row (V3).
> 4. Admin check-order: 404 beats 422; 409 beats 422; 422 on an unlocked invalid body (V4).
> 5. Timing floor on admin 404/409 and on the new wrapper's two 403 branches (V1).
> 6. Engineer / EM / no-user-row → 403 `NOT_A_FACILITATOR` with the new copy; member-facilitator → 403 `FACILITATOR_IS_TEAM_MEMBER` with unchanged copy (C3).
> 7. TOPIC-007 admin 403 tests pass unmodified; TOPIC-002 admin returns `canAddTopics: true`, `canEditAnnotations: false` (V5).
> 8. Parity test admin rows → `ADMITTED_CAN_ADD`; constant deleted; the test passes for all seven caller classes.
> 9. Frontend: positive admin tests (a)–(c) from V6; empty-state variant type reduced to three.

---

## 5. Things I'd keep exactly as written

- §1's constraint table. It's the clearest statement of what *must not* change, and it should go into the proposal verbatim.
- §4.1's warning against widening the shared function. That warning is the main protection for FR-8.7.
- §7's out-of-scope list, with C4 applied.
- §8's rollout reasoning. A lightweight pipeline is appropriate.
