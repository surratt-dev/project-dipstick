# Tasks Review: topic-003-admin-authorization (#176)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewed:** `tasks.md` against `proposal.md`, `design.md`, and the three spec deltas (`add-custom-topic`, `topic-customization-lock`, `topic-management-screen`)
**Verdict:** **Approve with conditions.** One blocking gap (B1) and a few scenario-to-test holes (M1 to M5). Each is a one-line task edit.

---

## 1. Proposal capability → task coverage

| Proposal "What Changes" item | Task(s) | Status |
|---|---|---|
| TOPIC-003 admits `application_admin` via `checkStandingFacilitatorOrAdminAuthorization`; member-facilitator, engineer, EM, no-`users`-row unchanged | 1.1, 1.3, 3.1, 3.2, 3.6 | Covered |
| Lock applies to admins; `topic.write_denied_locked` records admin role; 403 → 404 → 409 → 422 with timing floor | 1.3, 3.3, 3.4, 3.5 | Covered |
| Success audit `topic.custom_added` with admin role, same transaction | 3.1, 3.2 | Covered |
| `NOT_A_FACILITATOR` copy change; `FACILITATOR_IS_TEAM_MEMBER` unchanged | 1.2, 3.6 | Covered |
| TOPIC-002 `canAddTopics` true for admins; `canEditAnnotations` stays false | 2.1, 2.2, 3.8, 3.9 | Covered |
| Screen: admin sees heading trigger and empty-state add; two `canAddTopics: false` variants removed | 4.1, 4.2, 4.3, 4.5 | Covered (see M1, M2) |
| Add-form help text "your team" → "this team" | 4.4 | Covered |
| Contract and requirements prose (REST API Contract, Use Case, Validation Report, helper header comment) | 1.5, 5.1, 5.2, 5.3 | **Partial, see B1** |
| TOPIC-007 explicitly unchanged | 1.4, 3.10 | Covered |
| Follow-ups F1/F2 filed before merge; F3 to F7 filed | 6.3 | Covered |
| BA propose-review items B1 to B3 and M1 to M5 | 4.5(c), 6.4, 3.2, 4.5(d), 5.2 | All carried into tasks. Thank you. |

Nothing in the proposal is lost except the contract's role matrix (B1).

---

## 2. Spec scenario → task/test map

### `add-custom-topic`

| Scenario | Covered by | Note |
|---|---|---|
| A valid request creates a custom topic (facilitator) | Existing TOPIC-003 suites | Unchanged |
| Admin non-member creates custom topic (`displayOrder = n + 1`) | 3.1 | OK |
| Admin member creates custom topic + exactly one audit row | 3.2 | OK |
| Appended to end of display order | 3.1, 3.2, existing | OK |
| `firstSessionDescription` stored / omitted | Existing | Unchanged |
| Admin add does not change an open room's `session_topics` | 3.7 | **Partial, M3**: second AND ("part of the next room's configuration") not asserted |
| Deactivated team not treated as nonexistent | Existing | Unchanged |
| Neither facilitator nor admin rejected before lock (engineer, EM, no-`users`-row; new copy; lock not revealed) | 3.6 | **Partial, M4**: 3.6 does not say "against a locked team" for the EM and no-row callers |
| Member-facilitator → `FACILITATOR_IS_TEAM_MEMBER`, unchanged copy | 3.6 | OK |
| Facilitator on locked team → 409 | Existing | Unchanged |
| Admin on locked team → 409, `write_denied_locked` with admin role, no success row | 3.3 | OK |
| Available regardless of which facilitator has run sessions | Existing | Unchanged |
| Facilitator nonexistent team → 404 | Existing | Unchanged |
| Neither-role caller → 403 not 404 on nonexistent team | Existing (engineer) | Engineer only today; EM / no-row covered only if M4 is taken |
| Neither-role caller invalid body → 403, no `error.field` | Existing (engineer) | Same as above |
| Locked beats invalid body (facilitator) | Existing | Unchanged |
| Nonexistent + invalid body → 404 (facilitator) | Existing | Unchanged |
| Admin nonexistent + invalid body → 404, no `error.field` | 3.4 | 3.4 should also assert no `error.field`; it says "(not 422)" only |
| Admin locked + invalid body → 409, no `error.field` | 3.4 | Same |
| Admin unlocked + missing `voteType` → 422 `error.field: "voteType"` | 3.4 | OK |
| Timing floor on admin 404/409 and both 403 branches | 3.5 | OK. 3.5 goes further than the spec (adds no-row caller), which is correct |
| Facilitator success audited | Existing | Unchanged |
| Admin success audited with admin role | 3.1, 3.2 | OK |
| Rejected request writes no success audit row | Existing (facilitator); 3.3 (admin 409) | **Gap, M5**: no admin 404 / 422 assertion |
| "Admin arm SHALL NOT be shared with TOPIC-007" (requirement prose) | 1.4, 3.10 | OK |

### `topic-customization-lock`

| Scenario | Covered by | Note |
|---|---|---|
| Standing facilitator / admin / ineligible / member-facilitator list access; 403 timing | Existing | Behaviour unchanged; only the parenthetical changed (living spec via archive) |
| Facilitator `canAddTopics: true` | Existing | Unchanged |
| Admin `canAddTopics: true`, `canEditAnnotations: false`, full lists | 3.8 | 3.8 should also assert `active`/`archived` present (cheap) |
| Flag agrees with add endpoint for all seven caller classes | 3.9 | OK |
| Flag does not depend on lock | Existing | Unchanged |

### `topic-management-screen`

| Scenario | Covered by | Note |
|---|---|---|
| Eligible facilitator on unlocked team sees add control | Existing | Unchanged |
| Locked team, no add control (facilitator) | Existing | Unchanged |
| Admin on unlocked team sees heading trigger | 4.5(b) | OK |
| **Admin on locked team (with active topics) sees no add control + lock notice** | none | **Gap, M2**: 4.5(c) covers the locked *empty* state only |
| No vote type preselected; counter at 80%; identical name/prompt | Existing | Unchanged |
| Description label + new help text | 4.4 | OK |
| Locked team with no topics (facilitator, full copy) | Existing row 1 | OK |
| Unlocked + archived, facilitator | Existing row 2 | OK |
| **Unlocked + 3 archived, administrator** ("Show archived topics (3)" and "Add custom topic") | 4.5(a)? | **Gap, M1**: 4.5(a) does not specify archived count |
| **Unlocked + nothing archived, administrator** ("Add custom topic" only) | 4.5(a)? | **Gap, M1**: same test can't satisfy both |
| Unlocked + nothing archived, facilitator | Existing row 4 | OK |
| Missing add flag fails closed | 4.5(e) | OK. Spec says "`false` or absent"; see M6 |
| Locked + no topics, administrator (structure only, copy owned by #200) | 4.5(c) | OK, matches my earlier B1 |
| Show archived expands/focuses | Existing | Unchanged |
| Restore from empty state replaces it without reload | Existing | Unchanged |
| (Proposal-level) admin add reaches the list | 4.5(d) | OK |

---

## 3. Findings

### Blocking

**B1. The REST API Contract's role matrix is not in task 5.1, and grep won't find it.**
`requirements/design/REST API Contract.md` has an endpoint-by-role table (~L3031 to L3032):

- `TOPIC-002 | … | canAddTopics false for admins (temporary, pending #176)`
- `TOPIC-003 | No | Yes (non-member teams, post-lock) | No | **No** | Facilitator-only (code: checkStandingFacilitatorAuthorization); …`

Task 5.1 lists the TOPIC-002 parenthetical, the `canAddTopics` description, the TOPIC-003 Authorization line, the 403 row and the TOPIC-004 note. It does not list this table. Task 6.2's grep only covers "source and living specs", not `requirements/`, so it won't catch these rows. The TOPIC-003 row's "No" contains neither "#176" nor "temporar", so no grep would find it anyway. This is the table people actually read when they ask "can an admin do X". If it still says No after merge, that is the requirements trail contradicting FR-8.2, which is the problem #176 exists to fix.
**Fix:** add to 5.1: "Role matrix: TOPIC-002 row drops the `canAddTopics` false/temporary note; TOPIC-003 App Admin column → `Yes`, Notes → 'Facilitator (non-member) or admin (any team, per FR-8.2); code: `checkStandingFacilitatorOrAdminAuthorization`; customization lock enforced'. Consider merging the row into TOPIC-004 to TOPIC-006." Also widen 6.2's grep to `requirements/`.

### Should fix (scenario-to-test gaps)

**M1. The two admin empty-state scenarios are collapsed into one test.** The spec keeps "Unlocked team with archived topics, administrator" (3 archived: both actions) and "Unlocked team with nothing archived, administrator" (add only) as separate scenarios. 4.5(a) is one test with no archived count. Split it into (a1) 3 archived → "Show archived topics (3)" + "Add custom topic"; (a2) 0 archived → "Add custom topic" only, no archive action. These are the direct replacements of the deleted row-3/row-5 tests, so one-for-one keeps the traceability clean.

**M2. "An administrator on a locked team sees no add control" (with active topics) has no test.** 4.5(c) covers the locked *empty* state. The heading-trigger path on a locked team for an admin is a different render branch, and it is the screen-level form of "the lock applies to admins". Add 4.5(f): admin, locked, active topics → no "Add custom topic" anywhere, lock notice shown.

**M3. The open-room scenario's second clause is untested.** 3.7 proves the open session is unchanged. The spec also says the new topic "is part of the team's active topic configuration for the next room opened". Add to 3.7: the team's active topics (TOPIC-001/002 or the next snapshot) include the new topic. Without this, "nothing happened" would pass the test.

**M4. EM and no-`users`-row callers against a locked team.** The spec scenario's point is that the 403 fires *before* the lock and doesn't reveal lock state. Existing tests prove this for an engineer only. 3.6 adds EM/no-row callers but doesn't say against which team. State it: "against a locked team, and against a nonexistent team with an invalid body". EMs are the role this boundary is really about (design D2), so they deserve the full set, not just the copy check.

**M5. "A rejected request writes no success audit row" for admin rejections.** 3.3 covers admin → 409. Add a no-`topic.custom_added`-row assertion to 3.4's admin 404 and 422 cases. It costs one line each.

### Minor

**M6.** Spec fail-closed covers "`false` or absent"; 4.5(e) tests absent only. The rollback case in design's Migration Plan is explicit `false`. Either parameterize 4.5(e) over `undefined` and `false`, or add a component test of `ActiveTopicsEmptyState` with `addAllowed={false}` on an unlocked variant. That second option is also the most direct guard for engineer review B1.

**M7.** 3.4: add "and no `error.field`" to the 404 and 409 cases to match the scenarios word for word.

**M8.** 3.8: also assert `active` and `archived` are present for the admin, per the scenario's AND clause.

**M9.** 6.4 runs *after* `openspec archive`, so it happens after merge, while 6.3 gates merge. Say who owns 6.4 and when (same PR's archive commit, or a named follow-up), or it will drift like the Purpose text it was written to fix.

---

## 4. Traceability check

- FR-8.2 [HARD] → proposal → `add-custom-topic` deltas → tasks 1.x/3.x → Use Case (5.2) → Validation Report (5.3). The chain is complete except the contract role matrix (B1).
- FR-8.7 → TOPIC-007 left untouched (1.4, 3.10). Good.
- FR-8.6 conflict (locked team with zero topics can't be repaired) is correctly left out of scope and routed to #200 via F4. No task needed here.
- EM exclusion recorded in design D2 and the use-case Notes (5.2). Good.

With B1 added to 5.1 and the 4.5 split (M1/M2), every scenario in the three deltas has a named task or an existing test.
