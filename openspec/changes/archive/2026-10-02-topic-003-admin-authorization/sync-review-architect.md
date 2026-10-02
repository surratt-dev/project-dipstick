# Sync Review: Solution Architect (Ingrid Sollenberger)

**Change:** topic-003-admin-authorization (#176)
**Stage:** Post-`opsx:sync` drift check (synced specs vs. code, tests, design docs)
**Verdict:** No drift remains. Three small documentation drifts were found and fixed directly (below). No application code was changed.

## Scope checked

- Synced main specs: `openspec/specs/add-custom-topic/spec.md`, `openspec/specs/topic-customization-lock/spec.md`, `openspec/specs/topic-management-screen/spec.md`
- Code: `packages/backend/src/routes/topics.ts`, `packages/backend/src/routes/content.ts`, `packages/backend/src/auth/standing-facilitator-access-helper.ts`, `packages/shared/src/types/topic.ts`, `packages/frontend/src/components/ActiveTopicsEmptyState.tsx`, `packages/frontend/src/components/AddCustomTopicForm.tsx`, `packages/frontend/src/pages/addCustomTopic.ts`, `packages/frontend/src/pages/TopicManagementPage.tsx`
- Tests: `topics.test.ts` (admin blocks, tasks 2.1 to 2.6), `topic-add-admin-integration.test.ts` (2.3, 2.4, 2.7), `topic-add-flag-parity.test.ts`, `content.test.ts`, `TopicManagementPage.empty.test.tsx`, `TopicManagementPage.add.test.tsx`, `addCustomTopic.test.ts`
- Docs: `requirements/design/REST API Contract.md`, `requirements/design/REST API Contract - Validation Report.md`, `requirements/use cases/08 - Topic Management - Use Cases.md`

`openspec validate --strict` passes for all three synced specs.

## Requirement-by-requirement trace

| Synced requirement / scenario | Code | Test |
|---|---|---|
| add-custom-topic: admin (member or not) gets 201, appended last, `isDefault: false` | `checkAddCustomTopicAuthorization` delegates to `checkStandingFacilitatorOrAdminAuthorization`; admins pass regardless of membership | `topics.test.ts` 2.1/2.2 `it.each` (non-member and member) |
| Admin success audited in-transaction with `actor_global_role = 'application_admin'` | Unchanged success path, actual role recorded | `topics.test.ts` 2.1/2.2 (INSERT < audit < COMMIT) |
| Admin add does not change an open room's `session_topics` | #175 snapshot-at-room-open; no code change needed | `topic-add-admin-integration.test.ts` 2.7 (real Postgres) |
| 403 `NOT_A_FACILITATOR` copy "Only a facilitator or an application admin can add a custom topic." for engineer, EM, no user row | `topics.ts` wrapper message | `topics.test.ts` 2.6 |
| 403 `FACILITATOR_IS_TEAM_MEMBER` copy unchanged | `topics.ts` wrapper message | `topics.test.ts` 2.6 |
| Admin on locked team: 409, `topic.write_denied_locked` attributed to admin with `attempted_operation = 'topic.custom_added'`, no success row | Shared lock path | `topics.test.ts` 2.3; integration 2.3 |
| Admin cascade: 404 before 422, 409 before 422, 422 with `field: voteType` | Unchanged cascade order | `topics.test.ts` 2.4; integration 2.4 |
| Timing floor on admin 404/409 and both 403 branches of the new wrapper | `applyTimingFloor` in wrapper and existing returns | `topics.test.ts` 2.5 |
| Admin arm not shared with TOPIC-007 | TOPIC-007 still calls facilitator-only `checkStandingFacilitatorAuthorization` | Existing TOPIC-007 tests |
| topic-customization-lock: `canAddTopics` true for facilitator and admin; separate from `canEditAnnotations` | `content.ts` explicit two-role expression | `content.test.ts`; parity test rows (admin non-member and member now `ADMITTED_CAN_ADD`) |
| Parity scenario across seven caller classes | Both endpoints decide through the same helper | `topic-add-flag-parity.test.ts` |
| topic-management-screen: admin sees heading trigger on unlocked team; none on locked team | `addAllowed = !locked && canAddTopics === true` | `.empty.test.tsx` (b), (f) |
| Empty state: three variants by lock and archived count; add action gated separately by the same `addAllowed` | `activeEmptyStateVariant(locked, archivedCount)`; `addAction = addAllowed && variant !== "locked"` | `addCustomTopic.test.ts` D4 block; `.empty.test.tsx` (a1), (a2), (c), addAllowed-gate block |
| Missing or false flag fails closed (message plus archive action, no add, no note) | Same `addAllowed` gate; old variant-5 copy removed | `.empty.test.tsx` (e) drift guard (absent and false) |
| Description helper text ends "...for this team." | `AddCustomTopicForm.tsx` | Form copy test |

Stale-reference sweep: no remaining "temporary"/"pending #176", "can't be added from this account yet", old `NOT_A_FACILITATOR` copy, or "Rows 3 and 5" text in specs, docs, or `packages/*/src`.

## Drift found and fixed (docs only)

1. **REST API Contract, TOPIC-007 Authorization paragraph:** said TOPIC-007 "deliberately differs from TOPIC-004/005/006, which admit administrators". TOPIC-003 now also admits them. Changed to "TOPIC-003/004/005/006".
2. **REST API Contract, authorization matrix TOPIC-003 row:** named only `checkStandingFacilitatorOrAdminAuthorization` as the code. The endpoint's actual check is the per-endpoint wrapper. Changed to "`checkAddCustomTopicAuthorization`, delegating to `checkStandingFacilitatorOrAdminAuthorization`" to match the add-custom-topic spec's implementation note.
3. **Validation Report, FR-8.2 row:** "Covered (admin branch: #176)" could be read as pending work. Changed to "Covered (TOPIC-003 admin branch added by #176)".

## Observations (not drift, no action)

- The use-case main flow still says "The Facilitator" in each step, but it is qualified by the Summary line "An Application Administrator follows the same flow with the same validation and lock rules." That is acceptable.
- The locked empty-state copy is still written for facilitators. What an administrator should see there is deferred to #200, and the synced spec says so explicitly, so it is not drift.
