# Post-sync drift review: topic-annotation

**Reviewer:** Ingrid Sollenberger, Solution Architect
**Date:** 2026-09-30
**Scope:** I compared the synced specs (`openspec/specs/{topic-annotation, session-topic-lifecycle, topic-management-screen, topic-customization-lock}`) against four sources: `design.md`, the REST API Contract and Validation Report edits, BRD FR-8.7 and use case 08, and the uncommitted code in `packages/`. Four specs (manager-team-association, role-assignment, websocket-session-authorization, project-structure) already fail validation on main. They were out of scope and I did not touch them.

**Verdict:** No code drift. The code matches the design and the specs on every checked point. I fixed two small documentation drifts. Two items are recorded below for awareness only.

## Sync fidelity

- `topic-annotation`: every requirement block in the main spec is byte-identical to the delta.
- The other three capabilities: every ADDED or MODIFIED requirement block matches its main-spec counterpart exactly. I compared them block by block.
- `openspec validate --strict` passes for all four specs (`--type spec`) and for the change.

## Spec/design vs code: verified points

| Area | Source of truth | Code | Result |
|---|---|---|---|
| Migration (4 nullable columns, no CHECK, no ON DELETE, real `-- Up/Down Migration` markers, Down drops exactly 4) | spec Req 1, design Migration Plan / D4 | `migrations/19_topics_team_annotation.sql` | Match |
| Facilitator-only auth with parameterized messages; admin gets `403 NOT_A_FACILITATOR` | D1, FR-8.7 | `topics.ts` `checkStandingFacilitatorAuthorization` + `ANNOTATION_AUTH_MESSAGES` | Match |
| `Cache-Control: no-store` is the first statement | D2 | handler first line | Match |
| Check order: auth → team → lock (`attempted_operation: topic.annotation_updated`) → body → UUID/topic → status; timing floor on every handled exit | D2, spec cascade req | handler steps 1–7 | Match |
| Body rules: object/string check, `\r\n`→`\n` + trim, reject-not-strip character set evaluated before length, 500 UTF-16 units, exact messages, `INVALID_ANNOTATION` + `field` | D3, spec | `validateAnnotationBody`; the regex covers U+0000–0008, 000B–001F, 007F, 202A–202E, 2066–2069 plus unpaired surrogates | Match. Tab and LF are allowed, lone CR is rejected. |
| Shared `normalizeAnnotation` / `MAX_ANNOTATION_LENGTH` | D3/D10, S-2 | `shared/src/types/topic.ts`, imported by `topics.ts` and `TopicManagementPage.tsx` | Match |
| Single `FOR UPDATE OF t` read; no-op returns existing provenance with no audit; CTE `UPDATE … RETURNING` scoped by `team_id` and `status='active'`; zero rows gives `422` with no second lookup; `updated_at` not touched; no advisory lock | D5 | handler | Match |
| Response `{ topicId, teamAnnotation, annotationUpdatedAt, annotationUpdatedBy }`, provenance only when both id and name are present | D6 | `toAnnotationResponse` | Match |
| Audit `{ topic_id, action, length }` in the same transaction; structured event without the text | D7 | handler, `audit-logger.ts` | Match. Sentinel tests exist in both suites. |
| TOPIC-002: annotation and provenance on active and archived entries, `canEditAnnotations = actorGlobalRole === 'facilitator'`, admins can read | D8, lock spec | `content.ts` `annotationFields` | Match |
| TOPIC-001 selects no annotation columns | D8, spec | `content.ts` comment + SELECT unchanged | Match. Covered by real-Postgres tests, including the EM case. |
| SESSION-005/012 read `st.topic_annotation` only | D8, lifecycle spec | `facilitator-sessions.ts` | Match. Covered by the SQL-text guard and the real-Postgres negative test. |
| Seed column list stays explicit | D9 | `facilitator-sessions.ts` INSERT | Match, with a test |
| Frontend: label, helper, counter on the normalized value, limit flag on the raw value, `aria-live`, clear-confirm, Saved status, fallback error, all three disabled reasons, lock-notice sentence, provenance format, pre-wrap, no `dangerouslySetInnerHTML`, definition above the description and visible while editing | D10, screen spec | `TopicManagementPage.tsx` | Match. All exact strings are present. |
| Contract TOPIC-007 section, TOPIC-002 fields, SESSION-005/012 `topicAnnotation`, access matrix, OQ-7 | design | code | Match |
| BRD FR-8.7 and use case 08 | design Open Questions / H1 | n/a | Wording matches the proposed FR-8.7 |

## Doc drift fixed

1. **`openspec/specs/topic-customization-lock/spec.md`, requirement "The all-topics endpoint uses the standing, org-wide facilitator authorization model…"**
   - **What was wrong:** The body said TOPIC-002's model (non-member facilitator **or admin**) is "the same" as `POST …/topics` and "every other topic-write endpoint". That was already untrue for TOPIC-003. With this change it is also untrue for TOPIC-007, which rejects admins under FR-8.7 (the code uses `checkStandingFacilitatorAuthorization` for both).
   - **Fix:** I added a parenthetical saying the admin arm is shared only with TOPIC-004/005/006, and that TOPIC-003 and TOPIC-007 reject admins.
   - **What did not change:** TOPIC-002's normative rule and the requirement header, so future deltas still match by header. Strict validation still passes.
   - **Delta/main mismatch:** This edit is in the main spec only. The change's delta does not touch that requirement, so archiving the change will not conflict with it.
2. **`requirements/design/REST API Contract.md`, TOPIC-002 `archived[]` shape**
   - **What was wrong:** The three annotation fields had been inserted between `restoredAt` and `restoredBy`, which split that provenance pair.
   - **Fix:** I moved them after `restoredBy`, which is the order `GetAllTopicsResponse` uses in `shared/src/types/topic.ts`. This is a cosmetic change only.

## For awareness (not fixed)

- **Stale line references in `design.md`:** `topics.ts:95`, `:523`, and `:1138` now point elsewhere because TOPIC-007 added code above them. The function and constant names next to each reference are still correct. I left them as they are, because design.md is a historical record that gets archived with the change.
- **Use case 08 wording vs H2:** The use case says "sessions created after the save". The precise rule is "sessions whose `session_topics` rows are written after the save", and that timing is H2, owned by #175. The use case's own parenthetical already says this, so I left it alone. If #175 chooses to snapshot when a session leaves `draft`, the wording should be adjusted at that point.

## Code defects

None found.
