# Tasks Review: Business Analyst

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Artifact reviewed:** `openspec/changes/reorder-topics/tasks.md`
**Read against:** `proposal.md`, `specs/reorder-topics/spec.md`, `specs/topic-management-screen/spec.md`, `specs/remove-topic/spec.md`, and the live requirements docs the tasks edit (`REST API Contract.md` TOPIC-006 at `:863-918` and the TOPIC-005 note at `:856`; use case 08 "Reorder Topics" at `:250-310` and the Restore AC at `:420`; `BRD.md:229`; `REST API Contract - Validation Report.md:27`)
**Verdict:** **Approve with minor revisions.** Every requirement and every scenario in the three delta specs has a task that implements it. Almost every scenario also has a task that tests it. The requirements-doc edits carry my explore-review wording through intact. There is one real gap: the timing-floor scenario is verified by reading the code, not by a test, even though `topics.test.ts` already has a pattern for testing it. The rest are small precision items where a test task is looser than the scenario it claims to cover. None of them is a scope change.

---

## 1. Proposal capabilities → task groups

| Proposal item | Tasks | Status |
|---|---|---|
| Prerequisite collision fix (migration 18, partial unique index, drop `idx_topics_team_active`, real `-- Up/Down Migration` markers, runnable rollback) | 1.1–1.5 | Covered. The shipping note matches Rachel's condition 1. |
| TOPIC-006 endpoint: shared authorization, `checkTeamExists` + `TEAM_NOT_FOUND`, lock gate + denial audit, envelope, timing floor, advisory lock | 2.2, 2.3, 3.1, 4.3, 10.2, 10.3 | Covered. The timing floor is verified only by review (see G1). |
| `422` structural validation (object, array, UUID, case, duplicates, empty, cap 200 checked first) | 2.4, 2.5 | Covered |
| `409 TOPIC_ORDER_STALE`, one constant body for every cause | 3.1, 3.7 | Covered |
| Dense 1-based two-phase renumber in one transaction | 3.3, 3.5, 3.6 | Covered |
| No-op: same shape, no audit | 3.2, 4.3 | Covered |
| Last-writer-wins, stated and tested | 3.8, 9.1 | Covered |
| `openSessionCreatedAt` (`lobby`–`wrap_up`, not `draft`, `null` for admin) | 3.4, 3.9 | Covered. Status coverage is partial (see G4). |
| `Cache-Control: no-store` | 2.3, 2.5 | Covered |
| `topic.reordered` audit (IDs only) + log line | 4.1–4.3 | Covered |
| Shared types | 2.1 | Covered |
| Screen: four move buttons, position numbers, draft/Save/Discard, sticky bar | 5.1–5.4, 7.1, 7.5 | Covered |
| Screen: Remove/Restore disabled while dirty; moves disabled during dialogs/save | 5.5, 7.2 | Covered. Re-enable after Reload is not tested (see G5). |
| Screen: `beforeunload` only, in-app navigation not intercepted | 6.1, 6.2 | Covered |
| Screen: stale path vs. general save-error path | 5.6, 7.3 | Covered |
| Screen: focus retention and `aria-live` announcements | 5.7, 7.4 | Covered |
| Screen: pinned copy and both confirmation strings | 5.3, 5.4, 7.1, 7.4 | Covered |
| Not on the live-session surface; no automatic ordering | 5.8, 5.2 | Covered for the live surface. "No automatic ordering" has no verification step (see G7). |
| No new frontend dependency | 10.5 | Covered |
| Requirements docs: REST contract, use case 08, BRD FR-2.7, Validation Report | 9.1–9.6 | Covered (see §3) |
| #175 snapshot-point dependency routed | 9.7 | Covered |
| Usability check with Priya and the compact-layout decision | 8.1, 8.2 | Covered |
| Drag-and-drop deferral accepted by the issue owner (#181) | proposal disposition | Covered. It is correctly left out of the tasks. |

Nothing in the proposal's "What Changes" or "Capabilities" is missing from the tasks.

---

## 2. Spec scenario → implementing and testing tasks

### 2.1 `reorder-topics`

| Requirement / Scenario | Implements | Tests | Notes |
|---|---|---|---|
| **R1 Facilitator or admin can reorder an unlocked team** | 2.2, 3.1, 3.3 | | |
| A valid full ordering is persisted densely and 1-based | 3.3 | 3.5 | ✓ |
| The read endpoints reflect the saved order | 3.3 | 3.5 | ✓ |
| Reorder closes gaps left by earlier archives | 3.3 | 3.5 (`1,2,4,7 → 1..4`) | ✓ |
| An application administrator can reorder any team's topics | 2.2 | 3.5 (includes an admin who is a team member) | ✓ |
| Archived topics' display_order is untouched | 3.3 (the `status='active'` predicate) | 3.5 | ✓ |
| **R2 Fixed check cascade** | 2.2–2.4 | | |
| Locked team → 409 regardless of body | 2.3 | 2.5 | ✓ |
| Non-facilitator → 403 before team/lock | 2.2 | 2.5 | ✓ |
| Team member facilitator → 403 | 2.2 | 2.5 | ✓ |
| Nonexistent team → 404 `TEAM_NOT_FOUND` | 2.3 | 2.5 | ✓ |
| Structurally malformed bodies → 422, no rows modified | 2.4 | 2.5 ("each malformed-body case") | ~ See G2. The cases should be listed. |
| Non-object body → 422, not 500 | 2.4 | 2.5 | ✓ |
| Mixed-case duplicate → 422 | 2.4 | 2.5 | ✓ |
| Uppercase valid list accepted, lowercased in response and audit | 2.4 | 2.5 | ✓ |
| Every response forbids caching | 2.3 | 2.5 (one `200` and at least one error) | ✓ |
| Every exit applies the timing floor | 2.2, 2.4, 3.1, 3.4 | **10.2 (review only)** | **G1** |
| Requirement text: "422 message SHALL NOT echo submitted values" | 2.4 | none | G2 |
| **R3 Stale set** | 3.1 | | |
| Missing active ID → stale, no `display_order` change | 3.1 | 3.7 | ~ 3.7 does not assert that rows are unchanged (G3) |
| Archived / foreign / unknown ID → stale, identical message, no 404 | 3.1 | 3.7 | ✓ |
| Concurrent add makes the save stale; the added topic keeps its position | 3.1 | 3.7 | ✓ |
| **R4 Atomic renumber** (includes "each phase affects exactly N rows") | 3.3 | | Row-count guard has no test (G3) |
| Swap 2 and 3 | 3.3 | 3.6 | ✓ |
| Reverse 11 | 3.3 | 3.6 | ✓ |
| Failure after the first write leaves the prior order | 3.3 | 3.6 | ✓ |
| **R5 No-op** | 3.2 | | |
| Submitting the current order writes nothing | 3.2 | 3.2, 4.3 | ✓ |
| **R6 Last-writer-wins** | 3.1 | | |
| B, committing after A, determines the order; `previous_order` chains | 3.1, 4.1 | 3.8 (forced ordering) | ✓ |
| **R7 Audit** | 4.1, 4.2, 2.3 | | |
| A successful reorder records before/after, with no names | 4.1 | 4.3 | ✓ |
| A lock denial writes the shared denial row before the 409 | 2.3 | 4.3 | ✓ |
| A stale save writes no audit row | 4.1 | 4.3 | ✓ |
| **R8 No session modification** | 3.3, 10.4 | | |
| Created session (`lobby`/`active`) unaffected | — | 3.10 | ✓ |
| History not rewritten (completed sessions) | — | 3.10 | ✓ |
| No `session_topics` write (executable form while #175 is open) | — | 3.10 | ✓ |
| Requirement text: "no endpoint accepts a session-scoped order" | — | 10.4 | ✓ (review) |
| **R9 `openSessionCreatedAt`** | 3.4 | | |
| Lobby session → its `created_at` | 3.4 | 3.9 | ✓ |
| Only a draft → `null` | 3.4 | 3.9 | ✓ |
| All complete/abandoned → `null` | 3.4 | 3.9 | ✓ |
| Admin always `null` (changed save and no-op) | 3.4 | 3.9 | ✓ |
| Requirement text: `pre_session`/`active`/`wrap_up` also count; most recent one wins | 3.4 | none | G4 |

### 2.2 `remove-topic`

| Scenario | Implements | Tests | Notes |
|---|---|---|---|
| Archiving a topic whose position an archived topic already holds succeeds | 1.1 | 1.4 | ✓ |
| Archive, add, archive no longer fails | 1.1 | 1.3 (also confirmed failing before the migration) | ✓ |
| Two active topics still cannot share a position | 1.1 | 1.4 (`23505`) | ✓ |
| Rollback path | 1.2 | 1.2 (manual) | ✓ Acceptable for a migration Down |

### 2.3 `topic-management-screen`

| Requirement / Scenario | Implements | Tests | Notes |
|---|---|---|---|
| **S1 Positions and move controls** | 5.2 | | |
| Each row shows its position and four buttons | 5.2 | 7.1 | ✓ Accessible names are not asserted (G6) |
| Boundary buttons disabled, not hidden | 5.2 | 7.1 | ✓ |
| A long move takes one action (bottom from 1) | 5.1 | 5.1 (helpers), 7.1 | ✓ |
| Locked team shows no reorder controls | 5.2 | 7.1 | ✓ Also assert that no Save order control is shown, per the scenario |
| One active topic shows no controls | 5.2 | 7.1 | ✓ |
| Requirement text: never on the live surface; no automatic ordering | 5.2, 5.8 | 5.8 (grep) | G7 |
| **S2 Local draft, Save/Discard** | 5.1, 5.4 | | |
| A move is immediate and sends no request | 5.1 | 7.1 | ✓ |
| Down then up leaves the draft clean | 5.1 | 7.1 | ✓ |
| Discard reverts without a request | 5.4 | 7.1 | ✓ |
| Save bar in view at 768px | 5.4 | 7.5 (manual or Playwright) | ✓ |
| Save sends the full list and confirms in `role="status"` until the next move | 5.4 | 7.1 | ✓ |
| **S3 Pinned copy and confirmation** | 5.3, 5.4 | | |
| Pinned copy shown with the controls | 5.3 | 7.1 | ✓ |
| Open-session confirmation replaces "Order saved." | 5.4 | 7.1, 7.4 (timezone-safe fixture) | ✓ |
| **S4 Remove/Restore disabled while dirty** | 5.5(a) | | |
| Disabled with the reason | 5.5 | 7.2 | ✓ |
| Discard re-enables them | 5.5 | 7.2 | ✓ Re-enabling after Reload is not tested (G5) |
| **S5 Reorder disabled during a dialog or a save** | 5.5(b)(c) | | |
| An open Remove dialog disables reordering | 5.5 | 7.2 | ✓ Restore dialog is not tested (G5) |
| Save in flight disables moves, Save, and Discard | 5.5 | 7.2 (moves only) | ~ G5 |
| **S6 `beforeunload`; in-app navigation discards** | 6.1 | | |
| Dirty draft registers the prompt; clean does not | 6.1 | 6.2 | ✓ |
| In-app navigation discards without a prompt; return shows the saved order | 6.1 | 6.2 | ✓ |
| **S7 Stale and general failures** | 5.6 | | |
| Stale explains itself and waits for Reload | 5.6 | 7.3 | ✓ |
| Discard after stale goes to the server's order, not the initial one | 5.6 | 7.3 | ~ G5. The fixture must make the server order differ from the initial order |
| A failed Reload keeps the screen and the draft | 5.6 | 7.3 | ✓ |
| A transient failure keeps the draft; no auto-retry | 5.6 | 7.3 | ✓ |
| Any other rejection (403) shows the server's message | 5.6 | 7.3 | ✓ |
| **S8 Focus and announcements** | 5.7 | | |
| Announcement text and focus after Move down | 5.7 | 7.4 | ✓ |
| Focus fallback after Move to top | 5.7 | 7.4 | ✓ |

---

## 3. Requirements-document edits: did anything get lost in translation?

I checked each task 9.x against the current text of the document it edits.

**9.1 REST API Contract TOPIC-006.** Today the section says: facilitator-only authorization with the lock folded into `403`; `404` for unknown topic IDs; `422` for a set mismatch; `displayOrder` "0-indexed or 1-indexed"; and a response with no `openSessionCreatedAt`. Task 9.1 corrects every one of those, and adds the cascade, the envelope, the timing floor, the 200 cap, the case rule, no-store, the no-op shape, and the notes. There are two things to add to the task text:
- **Keep the `401 Unauthorized` row.** The task lists the rows to set without mentioning `401`. A literal reading could drop it, and it is still true.
- **Update the Notes bullet "A partial list is rejected with `422`."** It becomes `409 TOPIC_ORDER_STALE`. The task covers the error table but not this sentence, and an implementer following "one diff hunk, surgical" could miss it.

**9.2 TOPIC-005 note (`:856`).** Correctly identified. The current sentence claims the old constraint is *why* archiving never had to renumber. After migration 18 that reasoning is false, not just outdated, so the fix has to restate the reason (position is only unique among active rows) and not just swap the constraint name.

**9.3 Use case 08, Reorder Topics.** Covers the Out of Scope wording, the Postcondition, the #175 AC annotation, both Notes, the Actor, the Engineers AC, and the FR-2.7 link. Two small items:
- **Main Flow step 3** still reads "drags a topic to a new position in the list (or uses an equivalent reorder control)." That is already true with buttons only, because of the parenthetical, so no edit is needed. I record it here so nobody "fixes" it into a drive-by rewrite.
- **Alternate flow "Save fails due to a system error… The previously saved order is retained."** That is consistent with keeping the draft (the server order is retained, and the draft is kept for retry). No edit is needed.

**9.4 Restore AC at `:420`.** Correct. After this change the AC is satisfiable, and the annotation should be removed and not reworded.

**9.5 BRD FR-2.7.** The verbatim text matches my explore-review wording, keeps `[PREF]`, and keeps "The order in effect when a session is created is the order that session uses." It replaces "before starting the session", which was the root of the start/creation confusion. ✓

**9.6 Validation Report `:27`.** The task changes the coverage statement. **Also change the description column**, "Facilitator may reorder topics before starting." Left as it is, it restates the old FR-2.7 and the row contradicts the BRD it traces. The FR-8.2 row (`:65`) already lists TOPIC-006 and needs no edit.

**Not in the tasks, and should not be:** REST contract `:291` lists "TOPIC-003, TOPIC-004, and TOPIC-006" as lock-enforcing and omits TOPIC-005. That is a pre-existing gap from the restore work, not this change's to fix under the surgical-edit rule. I note it for a follow-up.

**Spec Purpose lines at archive time.** The main `topic-management-screen` spec's Purpose and "does NOT cover" paragraph list the endpoints the screen calls (GET all, DELETE, POST restore) and the capabilities they belong to. After this change the screen also calls `PUT /topics/order` (`reorder-topics`). ADDED requirements won't update that prose, so whoever archives the change should add the endpoint and the capability reference by hand. The same goes for the `remove-topic` Purpose if it mentions the old constraint. A one-line note under task 10.6 would stop this from being missed.

---

## 4. Gaps and recommended task edits

| # | Severity | Gap | Recommended change |
|---|---|---|---|
| **G1** | Medium | The spec scenario "Every exit applies the timing floor" has no automated test. Task 10.2 is a code-review check. `topics.test.ts` already mocks `applyTimingFloor` and asserts `toHaveBeenCalledTimes(1)` for the TOPIC-003/004/005 exits (e.g. `:654-725`), so the pattern exists. | Add to 2.5, 3.2, 3.5, and 3.7: assert that `mockApplyTimingFloor` is called exactly once on the `403`×2, `404`, `409` lock, `422`, `409` stale, no-op `200`, and changed `200` exits. Keep 10.2 as the review backstop. |
| G2 | Low | 2.5 says "each malformed-body case" without listing them. The spec names: `orderedTopicIds` missing, not an array, empty, 201 entries, non-UUID string, non-string entry, duplicate. Also, "the `422` message SHALL NOT echo submitted values" has no assertion. | List the cases explicitly in 2.5, and add: the `422` `error.message` does not contain the submitted non-UUID string. |
| G3 | Low | 3.7's "missing active ID" test doesn't assert that `display_order` is unchanged, which the scenario requires. The `ReorderRowCountMismatchError` path from 3.3 (a SHALL in R4) has no test. | Add the "no row changed" assertion to 3.7. Add a 3.6 case that forces a phase to report ≠ N rows (mocked client) and asserts rollback plus a non-`200` response. |
| G4 | Low | 3.9 tests only `lobby`, `draft`, and terminal statuses. R9 also names `pre_session`, `active`, and `wrap_up`, and "most recent if more than one." A mistyped status literal in the `IN (...)` list would pass every current test. | Parameterize 3.9's non-null case over all four statuses. The "most recent" clause can stay untested, since one open session per team is enforced elsewhere. |
| G5 | Low | 7.2 and 7.3 are looser than the S4, S5, and S7 scenarios. Missing: Remove/Restore re-enabled after **Reload**; Save and Discard (not only moves) disabled while saving; the **Restore** dialog also disabling moves; the stale-Discard fixture must return a server order different from the initial load, or the "not the stale one" assertion proves nothing. | Add each of these to 7.2 and 7.3. |
| G6 | Low | Accessible names that include the topic name (S1 requirement text) are implemented in 5.2 but never asserted. The component tests will probably query by role and name anyway. | Make 7.1 query the buttons by accessible name (e.g. `getByRole('button', { name: /Move up.*Deployment/ })`). |
| G7 | Low | "The screen SHALL NOT offer any automatic ordering" has no verification step. It is my guardrail item, and it costs one line to check. | Add to 5.8 or 10.4: confirm that no sort, "by score," or "by flag" control or code path was added. |
| G8 | Low | 9.1 omits the `401` row and the Notes "partial list → `422`" sentence. 9.6 omits the description column. See §3. | Amend 9.1 and 9.6 as described in §3. |
| G9 | Info | Archive-time prose updates to spec Purpose paragraphs. See §3. | Add a note under 10.6. |

---

## 5. What I checked and found sound

- The first-session lock covers reorder through the shared gate (2.3), the denial audit is tested (4.3), and the sentinel-team edge case is covered (3.7). Proposal guardrail 1 is honored.
- Order never reaches an existing session. 3.10 and 10.4 cover it, the tasks add no `session_topics` write, and #175 carries the snapshot-point and renumbering dependency (9.7). Guardrail 2 is honored.
- No automatic ordering: 5.2 forbids it, and G7 adds a check. Guardrail 3 is honored.
- The collision fix really is first and ships on its own (group 1 shipping note). The §3b regression test is written to fail before the migration.
- The in-app navigation limitation now appears in the spec (S6), the tests (6.2), and the use-case Note (9.3), so it won't come back as a defect. That closes my earlier G3.
- Every item from my propose review (G1–G10, the §3 items) is either in the tasks or routed with a disposition.

The tasks are ready to implement once G1 is added. G2–G9 can be folded in while the implementation is underway.
