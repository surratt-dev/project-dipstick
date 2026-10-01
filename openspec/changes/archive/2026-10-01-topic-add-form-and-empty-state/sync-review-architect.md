# Sync Review — Solution Architect (Ingrid Sollenberger)

Change: `topic-add-form-and-empty-state`
Scope: spec sync into `openspec/specs/topic-management-screen/spec.md` and `openspec/specs/topic-customization-lock/spec.md`, checked against the code on branch `agent-team/55-topic-add-form-and-empty-state`, `requirements/design/REST API Contract.md`, and `requirements/use cases/08 - Topic Management - Use Cases.md`.

**Verdict: APPROVE.** The synced specs match the code. The drift I found was in the REST API Contract's TOPIC-003 entry, which predates this change but is now load-bearing because the screen depends on it. I fixed it directly (below). Nothing substantive blocks.

## Sync completeness

All 13 ADDED requirements in the delta for `topic-management-screen` and the 1 for `topic-customization-lock` appear verbatim in the living specs. The Purpose and scope paragraphs of both specs were updated (the `add-custom-topic` reference in the "does NOT cover" list resolves to `openspec/specs/add-custom-topic/`). No older requirement text contradicts the new rules: the existing inline-refetch rules for reorder and definitions agree with the new "never replace the screen" rule.

## Spot-checks against code (all consistent)

| Claim in spec / implementation note | Code | Result |
|---|---|---|
| `canAddTopics = decision.actorGlobalRole === "facilitator"`, kept separate from `canEditAnnotations` | `packages/backend/src/routes/content.ts` (TOPIC-002 handler) | Match |
| `GetAllTopicsResponse.canAddTopics`; shared `AddCustomTopicRequest` / `AddCustomTopicResponse` | `packages/shared/src/types/topic.ts`, exported from `packages/shared/src/index.ts` | Match |
| TOPIC-003 validator typed against `AddCustomTopicRequest`; vote types from `satisfies Record<VoteType, true>`; 422 `field` typed `keyof AddCustomTopicRequest` | `packages/backend/src/routes/topics.ts` | Match |
| Parity test: both routes, real auth helpers, SQL-routing fake, seven caller classes, explicit `expected` per row, admin rows to be changed by the #176 fix | `packages/backend/src/routes/__tests__/topic-add-flag-parity.test.ts` | Match (the seven classes in the test are exactly the seven in the spec scenario) |
| Form, empty state, and the pure-rules module, with the functions the note lists (`findDuplicate`, `activeEmptyStateVariant`, the 80% counter rule, `VOTE_TYPE_LABELS` used by rows and radios) | `components/AddCustomTopicForm.tsx`, `components/ActiveTopicsEmptyState.tsx`, `pages/addCustomTopic.ts` | Match |
| Phases `editing \| confirmingDiscard \| submitting`, plus `duplicate` and `duplicateOverride`; radios `disabled` and text fields `readOnly` while in flight | `AddCustomTopicForm.tsx`, `TopicManagementPage.tsx` | Match |
| Refetch counter returning ok / failed / superseded, used only for TOPIC-002 refetches | `fetchAllTopics` in `TopicManagementPage.tsx` | Match |
| A Remove/Restore dialog closes only if it is still `submitting` for the same `topicId` | `TopicManagementPage.tsx` (both success paths) | Match |
| `TopicManagementRoute` keyed by `teamId` and rendered by `App.tsx` | `TopicManagementPage.tsx`, `App.tsx` | Match |
| Heading "Active Topics (n)" with `tabIndex=-1`; trigger beside the h2, not inside it; one screen-message region using `status` or `alert` | `TopicManagementPage.tsx` | Match |
| Gate uses `canAddTopics === true` and fails closed if the flag is missing | `TopicManagementPage.tsx` | Match |
| Every copy string in the spec (form helpers, vote-type explanations, duplicate warnings, outcome messages, interlock reasons, empty-state variants) | Form, empty state, and page constants | Match (spot-checked word for word) |
| Rows are focusable h3s with the "Custom" tag inside the heading; a whitespace-only description is not rendered | `TopicManagementPage.tsx` | Match (archived rows render no description at all, which satisfies the rule) |
| The screen does not read `defaultTopicsNotActive` | `TopicManagementPage.tsx` (the only reference is a comment) | Match |
| Server 422 `field` and the `VALIDATION_FAILED` code, which the screen's field mapping relies on | `topics.ts` passes `validation.field` to `buildErrorEnvelope` | Match |

## Doc fixes I made (small, clearly correct)

1. **`requirements/design/REST API Contract.md`, TOPIC-003 request body:** the contract said `firstSessionDescription?: string`. The validator accepts `null` and the screen sends `null` when the field is blank. Changed it to `?: string | null`, noted that the server does not trim the value, and pointed to the shared type.
2. **REST API Contract, TOPIC-003 `422` row:** the row did not name `VALIDATION_FAILED` or `field`, even though the TOPIC-006 section already says "TOPIC-003's `VALIDATION_FAILED`… keeps the same shape by setting `field`", and the screen now maps `field` to its own copy. Added the code, the four field values and the order they are checked in, and the fact that the screen never shows `message`.
3. **REST API Contract, TOPIC-003 Notes:** the envelope shape now says "(plus `field` on `VALIDATION_FAILED`)", matching how TOPIC-007 documents its envelope.
4. **REST API Contract, permission matrix TOPIC-002 row:** added "`canAddTopics` false for admins (temporary, pending #176)" next to the existing `canEditAnnotations` note.
5. **REST API Contract, TOPIC-002 Notes on `defaultTopicsNotActive`:** the note still said the field "enables the restore defaults UI path", with no mention that the screen is now required not to read it. Added that the Topic Management screen does not read the field, with the reason and a link to the handoff.
6. **`openspec/specs/topic-customization-lock/spec.md`, authorization requirement:** the parenthetical "this read endpoint still admits them, and returns `canEditAnnotations: false`" now adds "and, while #176 is open, `canAddTopics: false`".
7. **`requirements/use cases/08 - Topic Management - Use Cases.md`, Notes:** the open question about a duplicate-prompt warning now records how this change resolved it on the screen: an exact match after trimming and ignoring case, a non-blocking warning, no fuzzy matching, and still no uniqueness rule on the server.

## Substantive items (not fixed; listed for owners)

1. **FR-8.6 "restore defaults" path has no consumer.** The REST contract still presents `defaultTopicsNotActive` as the basis for FR-8.6, but the only screen is now forbidden from reading it, and its name-based join is known to be wrong (`handoffs/default-topics-not-active-name-join.md`). Before any FR-8.6 UI is built, someone must decide whether to fix the field's join (by `topic_id` or provenance) or remove it from the contract. Owner: BA + Engineering.
2. **Issue numbers still pending.** The use case edit cites `handoffs/custom-topic-description-never-shown-in-session.md` with "issue number pending". The other handoffs in `handoffs/` also need issues before this change is archived, so the living docs do not keep pointing into an archived change folder.
3. **#176 coupling.** The rule for fixing #176 is now written in four places: the `canAddTopics` requirement, rows 3 and 5 of the empty-state table, the parity test's `expected` fields, and the TOPIC-002 row of the REST permission matrix. The #176 fix must update all four. I recommend linking this list from the #176 issue.
4. **Section headers in the REST contract.** TOPIC-003's own "Authorization" line (facilitator-only) and the TOPIC-004 note "TOPIC-003 … keeps its existing facilitator-only check" are consistent with each other and with the code. No change is needed until #176 lands.
