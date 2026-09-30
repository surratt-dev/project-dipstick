# Post-sync drift review: reorder-topics (Solution Architect)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** The synced main specs (`reorder-topics`, `topic-management-screen`, `remove-topic`), REST API Contract TOPIC-006, use case 08 "Reorder Topics", and BRD FR-2.7, checked against `routes/topics.ts`, migration 18, `shared/types/topic.ts`, `TopicManagementPage.tsx`, `topicOrder.ts`, and their tests. I also checked the synced specs against the other main specs.

**Verdict:** No code-vs-spec divergence that matters. I found two small doc drifts and fixed them in the docs. The code was not changed.

---

## 1. Backend (TOPIC-006) vs. spec and contract: aligned

| Aspect | Spec / contract | Code | Status |
|---|---|---|---|
| Route | `PUT /api/v1/teams/:teamId/topics/order` | same | OK |
| Auth | standing facilitator (non-member) OR `application_admin` | `checkStandingFacilitatorOrAdminAuthorization` | OK |
| Cascade | 403 → 404 `TEAM_NOT_FOUND` → 409 lock → 422 → 409 stale | same order (steps 1–5) | OK |
| 403 codes | `NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER` | `decision.reason` | OK |
| 404 | team only, `TEAM_NOT_FOUND` | `checkTeamExists` now sends the code | OK (see note A) |
| 409 lock | `TOPIC_CUSTOMIZATION_LOCKED`, shared denial audit with `attempted_operation: "topic.reordered"`, no order payload | `checkCustomizationLockGate` with `attemptedOperation: "topic.reordered"` | OK |
| 422 | `INVALID_TOPIC_ORDER`, `field: "orderedTopicIds"`; non-object, missing/non-array, 0 or >200 (length first), non-UUID, duplicate after lowercasing; no echo | `validateReorderTopicsBody`, `MAX_REORDER_TOPICS = 200`, strict UUID regex `/i` | OK |
| 409 stale | `TOPIC_ORDER_STALE`, `category: precondition_failed`, identical body, no IDs, set compare under advisory lock, no per-ID lookup | in-memory compare against team-scoped active read after `pg_advisory_xact_lock(hashtext(teamId))` | OK |
| No-op | 200 same shape, stored `displayOrder`, no audit, no renumber | step 6 | OK |
| Write | single txn, two-phase, each phase exactly N rows else rollback | negate then flip, `ReorderRowCountMismatchError` | OK |
| Response | `{ topics: [{ topicId, name, displayOrder }], openSessionCreatedAt }`, lowercase IDs, dense 1..N | `ReorderTopicsResponse` in shared | OK |
| Audit | `topic.reordered`, same txn, `{ previous_order, new_order }`, IDs only, lowercase; none on 403/404/422/stale/no-op | same; structured log after COMMIT carries `topicCount` only | OK |
| `openSessionCreatedAt` | facilitator: newest of lobby/pre_session/active/wrap_up (not draft), read in txn; admin: always null, sessions not read | `readOpenSessionCreatedAt` returns early for non-facilitator | OK |
| `Cache-Control: no-store` | every response incl. 500 | set first in handler | OK |
| Timing floor | every handled exit incl. 200 | yes; thrown path exempt (inherited, documented) | OK |
| session_topics | never written | only `topics` and `audit_log` written | OK |

**Note A (worth recording, not drift):** `checkTeamExists` is shared, so the `TEAM_NOT_FOUND` code change also affects TOPIC-003, TOPIC-004, and TOPIC-005. For TOPIC-004 and TOPIC-005 this *fixes* earlier drift: the `remove-topic` and `restore-topic` specs and the contract already required `TEAM_NOT_FOUND`, but the code sent no code. For TOPIC-003 the change only adds a field, and the `add-custom-topic` spec asserts only the status. It should be mentioned in the PR description.

**Note B (tolerable):** `request.body ?? {}` turns a literal JSON `null` body into `{}`. The result is still `422 INVALID_TOPIC_ORDER` as the spec requires, just with the "orderedTopicIds is required" message instead of the "must be an object" one. This is not drift.

## 2. Migration 18 vs. `remove-topic` spec: aligned

It drops the `topics_team_order` constraint and the superseded non-unique `idx_topics_team_active`, and creates `UNIQUE INDEX topics_team_active_order ON topics (team_id, display_order) WHERE status = 'active'`. The down migration re-spreads archived rows first. This matches the new "Display-order uniqueness applies only among a team's active topics" requirement. The add and restore paths already compute `MAX(display_order)` over active rows only, which is consistent with the partial index.

## 3. Frontend vs. `topic-management-screen` spec: aligned

I checked each item below against `TopicManagementPage.tsx`:
- Controls are shown only when the team is unlocked and has at least 2 active topics. Otherwise the controls, Save bar, and order copy are all hidden.
- Positions come from the rendered index, not `displayOrder`.
- There are four buttons with accessible names `"<label>: <topic name>"`. Boundary buttons are disabled, not hidden.
- The draft is clean exactly when it equals the saved order, including after moving a row back to where it was.
- The Save bar is static while clean and sticky while dirty. Discard asks for no confirmation.
- A save sends one PUT with the full list. The list is updated from the response with no refetch.
- Copy strings match the spec exactly: "Order saved.", "Order saved. The session created on {date} keeps its original order." (en-US `MMM d, yyyy`), "Order changes apply to sessions created after you save. Sessions already created keep their order.", "Save or discard your order changes first.", "The topic list was changed elsewhere since you opened this page.", "Unable to save the topic order.", "Unable to reload topics."
- Remove and Restore are disabled while the draft is dirty or a save is in flight. Moves, Save, and Discard are disabled while a Remove dialog (including the open-items escalation) or Restore dialog is open or submitting, and while saving. Save and moves are also disabled while stale.
- Stale handling: Reload and Discard both refetch the server's order. A failed reload stays stale, shows the save-error alert, and keeps Reload enabled. It never shows the page-level error.
- Other failures show `error.message` or the fallback in a `role="alert"` region. The draft is kept, Save stays enabled, nothing retries automatically, and the next move clears the error.
- `beforeunload` is registered only while dirty. In-app navigation is not intercepted.
- The `aria-live` announcement reads "<name> moved to position n of N", and focus moves with the row, with a fallback when the row hits a boundary.
- The only caller of `topics/order` is `TopicManagementPage.tsx`, so there is no live-session reorder path.

`topicOrder.ts` helpers are pure and return the same array for a no-op or out-of-range move, as the draft-clean logic needs.

The tests (`topics.test.ts`, `topics-integration.test.ts`, `TopicManagementPage.reorder.test.tsx`, `topicOrder.test.ts`) have a titled test for every spec scenario I sampled.

## 4. Requirements docs: aligned

- **BRD FR-2.7:** it covers reordering the team configuration before a session is created, excludes the first session (lock), and has no per-session path. The code and the endpoint whitelist agree.
- **UC 08 Reorder Topics:** the actor now includes the Application Administrator, the postcondition uses "sessions created after the save", the #175 gap is noted, and the Notes describe the beforeunload-only guard and the Move buttons (drag-and-drop deferred to #181). Consistent with the code. The Main Flow step 3 wording ("drags … or uses an equivalent reorder control") still holds.
- **REST API Contract TOPIC-006 and the Validation Report:** consistent with the code, including `category: "precondition_failed"` for stale.

## 5. Cross-spec consistency: no contradictions

- **`topic-customization-lock`:** reorder uses the shared 409 and the `topic.write_denied_locked` row with endpoint and attempted-operation metadata, as that spec requires.
- **`restore-topic`:** "max active `display_order` + 1" is still valid under the partial index and after dense renumbering.
- **`add-custom-topic`:** it uses the same advisory lock and active-only MAX.
- **`session-topic-lifecycle`:** it reads `session_topics.display_order`, which reorder never writes. No conflict.
- **`remove-topic`:** the new requirement doesn't conflict with its existing requirements. The Purpose now names migration 18.

## 6. Doc drift fixed (docs only)

1. **`requirements/design/database-schema.md`, `topics` table:** still showed `CONSTRAINT topics_team_order UNIQUE (team_id, display_order, status)` and the non-unique `idx_topics_team_active`, both removed by migration 18. I replaced them with `CREATE UNIQUE INDEX topics_team_active_order ON topics (team_id, display_order) WHERE status = 'active'` and a comment citing migration 18 and design.md Decision 1.
2. **`requirements/use cases/08 - Topic Management - Use Cases.md`, Re-Add Removed Topic Notes:** said the `topics_team_order` constraint is why archiving never renumbers. I reworded it to cite the active-only partial unique index (migration 18) and to say that it replaced the original constraint.

## 7. Items not fixed (for the team's awareness, non-blocking)

- `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts:1034` uses `constraint: "topics_team_order"` as a mock 23505 fixture. It is an arbitrary non-teams constraint name, so the test's meaning is unaffected, but the name no longer exists in the schema. This is optional test-fixture cleanup and I did not change it (it is code, and outside docs).
- Inherited, already-documented gaps are unchanged: #175 (session_topics not populated at creation), the thrown-path timing-floor exemption, and TIMING_FLOOR_MS still needing a measured value that includes TOPIC-006 at the 200-entry cap.
