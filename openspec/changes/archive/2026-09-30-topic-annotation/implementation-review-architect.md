# Implementation Review: topic-annotation (Solution Architect)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Uncommitted working tree on `agent-team/53-topic-annotation`: backend routes (`topics.ts`, `content.ts`, `facilitator-sessions.ts`), `audit-logger.ts`, migration 19, shared types, `TopicManagementPage.tsx`, and the new and changed tests. I checked them against `design.md` Decisions 1–10 and the sibling TOPIC-003..006 code.
**Verdict:** **Approve with minor revisions.** I found no MUST-FIX items. The boundaries the design drew all hold in the code. The SHOULD-FIX items are about writing down decisions so they do not get quietly undone, and about one duplicated rule.

---

## 1. Boundary conformance

| Design boundary | Result | Evidence |
|---|---|---|
| D1: facilitator-only auth, reusing TOPIC-003's check with parameterized copy | Holds | `topics.ts:99-107` adds the `StandingFacilitatorMessages` parameter. TOPIC-003 still passes its original strings (`ADD_CUSTOM_TOPIC_AUTH_MESSAGES`). The TOPIC-007 call site explains why admins are excluded (FR-8.7). |
| D2: cascade order; `Cache-Control` set first; non-UUID `topicId` returns 404 | Holds | The header is the handler's first statement, as in TOPIC-006. The order is auth → team → lock (`attemptedOperation: "topic.annotation_updated"`) → body → `UUID_PATTERN` → `checkTopicExistsAndActive`. Every handled exit applies the timing floor. |
| D3: validation, normalization and character rules | Holds | `topics.ts:626-663`. Characters are rejected before the length check. The surrogate regex is equivalent to `!isWellFormed()` and does not depend on the TS lib target, which is a sensible choice. |
| D4: no database CHECK | Holds | Migration 19 has no CHECK, and its header records why. |
| D5: single `FOR UPDATE OF t` read, scoped CTE `UPDATE`, no advisory lock, `updated_at` untouched, no-op returns 200 with nothing written | Holds | The handler body in `topics.ts`. The `UPDATE` repeats the `team_id`/`status` predicates (security R1). |
| D6/D7: response shape; audit metadata `{topic_id, action, length}` and never the text | Holds | `toAnnotationResponse` uses the same both-present rule as `archivedBy`. `emitAuditEvent` carries `action` and `length` only. A comment at the handler says the request body must never be logged. |
| D8: TOPIC-002 gains the fields and `canEditAnnotations`; TOPIC-001 untouched; SESSION-005/012 read only `st.topic_annotation` | Holds | `content.ts` uses the same LEFT JOIN pattern as `archivedBy` in both the active and archived queries, with a comment at TOPIC-001. `facilitator-sessions.ts` has a warning comment at the SESSION-005 JOIN. SESSION-012 now aliases `st`, so the SQL-text guard is meaningful. |
| D9: seed column list stays explicit | Holds | There is a comment at the seed `INSERT`, and the integration test is in place (7.2). |
| D10: one editor at a time; dirty/busy interlocks in both directions; orphaned-editor reset; quiet refetch; patch after save with no refetch | Holds | `TopicManagementPage.tsx:466-488` and `808-944`. `fetchAllTopics()` is extracted and `reloadAfterStale` reuses it unchanged. The reorder-save path (`setData` rebuilding from `rowsById`) keeps the annotation fields on each row, which I checked specifically. |
| Migration pattern: real `-- Up Migration` / `-- Down Migration` markers (not migration 17's) | Holds | Migration 19 follows migration 18's header style and markers. Down drops exactly the four columns, in reverse order. |

The test for migration 19 (`topic-annotation-integration.test.ts:208-309`) is well built. It runs Up and Down against `LIKE` copies in a throwaway schema inside a transaction that is rolled back, so it never takes an `ACCESS EXCLUSIVE` lock on tables that other integration files are using in parallel. That is the right decision, and other migration tests should copy it.

---

## 2. Implementer-reported deviations

| Deviation | Judgement |
|---|---|
| **No temporary `501`** (task 3.2) | **Accepted.** The `501` was scaffolding, so that a half-built handler could not be mistaken for a working one between tasks 3 and 4. Tasks 3 and 4 landed together and nothing in the tree is half-built. Task 11.2's real check ("the `501` is gone") holds. |
| **The 5.4 archive→restore round-trip moved to real Postgres** | **Accepted, and an improvement.** A mocked version would only have confirmed that the mock returns what the test told it to. The integration test (`:443-483`) drives the real TOPIC-007 → TOPIC-004 → TOPIC-002 → TOPIC-005 → TOPIC-002 sequence. It also asserts that the original `annotationUpdatedAt` and provenance survive, and that `isDefault: false` (so it covers "a custom topic can be annotated"). The trade-off is that it self-skips locally when Docker is down. CI's `integration.yml` covers it. See S-3 about recording the change. |
| **Edit is also disabled while a Remove/Restore dialog is open** (`TopicManagementPage.tsx:1119`) | **Accepted. It closes a gap the design missed.** Design D10 closes a *clean* editor when a dialog opens, but it did not stop a new editor being opened *behind* an open dialog. If that editor became dirty, the dialog's Confirm would call `loadTopics()`, and its failure path (`setError`) would unmount the screen and lose the draft. That is exactly the loss D10's "every row's Remove/Restore" rule exists to prevent. The fix keeps that rule true in both directions. It has to be written down, though (S-1). |

---

## 3. Findings

### MUST-FIX

None.

### SHOULD-FIX

**S-1. The dialog-open Edit disable is not in the design or spec.**
`TopicManagementPage.tsx:1116-1120`; `design.md` Decision 10; `specs/topic-management-screen/spec.md`.
The rule exists only in code and in one test (`TopicManagementPage.annotation.test.tsx:765`, Remove dialog only). The next change to this screen could remove it as an unexplained inconsistency. To fix this:
- (a) Add one sentence and its rationale to Decision 10, and add a scenario to the screen spec.
- (b) Add the Restore-dialog case to the test.
- (c) Give the disabled button a reason. Today `title` is set only for `topicActionsLockedByDraft`, so when a dialog is open the button is disabled with no explanation. Every other disabled control on this screen states its reason.

**S-2. The normalization rule and the 500 limit are defined twice.**
`topics.ts:626,638` (`MAX_ANNOTATION_LENGTH`, `normalizeAnnotation`) and `TopicManagementPage.tsx:105,118` (`DEFINITION_MAX_LENGTH`, `normalizeDefinition`).
D3 and D10 make client/server agreement on "unchanged", "clear" and the count a stated invariant, and the only thing enforcing it now is a code comment. `@dipstick/shared` already exports runtime values (`buildJoinLinkPath` in `types/auth.ts:63`, constants in `types/ws-close-codes.ts`). Move `normalizeAnnotation` and `MAX_ANNOTATION_LENGTH` there and import them on both sides. Keep the character-rejection rules server-only, as D3 says. This also stops a route module (`topics.ts`) from exporting domain helpers that only tests import.

**S-3. `tasks.md` text does not match what was built.**
Task 3.2 still describes a temporary `501`, and 5.4 still says "(mocked suite)". Add a one-line note under each, or a short "Implementation deviations" section that also covers S-1, so the archive record matches the code. Without it, task 11.2's "`501` is gone" check reads as if a step was skipped.

### NIT

**N-1. The defensive branch makes a second query outside the transaction.** `topics.ts:1559-1574`. The branch is unreachable under `FOR UPDATE`, yet after `ROLLBACK` it runs a fresh `db.query` to tell `404` from `422` apart. Design D5's engineer-minor-3 intent was "no second lookup after `ROLLBACK`". TOPIC-004's equivalent branch simply returns `422`. Either mirror that, or keep the branch but say in the comment that the second query is intentional.

**N-2. Date conversion is inconsistent between handlers.** `topics.ts:685` wraps the value in `new Date(...)`, while `content.ts:542` calls `.toISOString()` directly on the pg `Date`. Both work. Pick one form.

**N-3. Closing a clean editor through a side door skips the pending refetch.** `TopicManagementPage.tsx:536-538`. `closeCleanAnnotationEditor` clears an editor that has `refetchOnClose` without running the quiet refetch, which `closeAnnotationEditor` and `openAnnotationEditor` both do. This is reachable only when the 404/422 editor's draft equals the saved text. Route it through the same refetch.

**N-4. A retry drops `refetchOnClose`.** `TopicManagementPage.tsx:865` replaces the editor state with `{ topicId, draft, phase: "saving" }`. If a retry after a 422 then fails at the network level (the `catch` path), the flag is lost and the stale row is never refetched. Carry the flag through the save.

**N-5. The migration test checks the markers by string search, not with the runner.** `topic-annotation-integration.test.ts:236-241` checks that `-- Up Migration` appears before `-- Down Migration`, which is reasonable. The migration-8 incident class (a runner that does not recognize the markers) is only truly caught by `db:migrate` in CI's setup step. That is acceptable, but a comment in the test should say so.

---

## 4. Summary

The implementation follows the design closely, and the architecturally significant lines all hold:
- Session payloads read only the snapshot, with a real-Postgres negative test and a mocked SQL-text guard.
- TOPIC-001 is untouched.
- The authorization divergence from the siblings is deliberate, documented, and pinned by tests.
- The audit trail carries no text.
- The seed stays explicit.

The three deviations are all sound, and one of them fixes a gap in the design. What remains is to record those deviations (S-1, S-3) and to give the client/server normalization rule a single definition (S-2).
