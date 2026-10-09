# Sync Review: Solution Architect (Ingrid Sollenberger)

**Change:** 208-member-admin-topic-writes, hand-synced delta specs (openspec CLI unavailable)
**Date:** 2026-10-08
**Verdict:** **PASS. No drift found, no edits made.**

---

## 1. Delta vs main spec fidelity

I compared each delta requirement block with its main-spec counterpart by script (exact text match per `### Requirement:` block), and checked the requirement-header lists against `main`.

| Capability | Delta ops | Result |
|---|---|---|
| add-custom-topic | 1 MODIFIED | Exact match |
| remove-topic | 1 MODIFIED | Exact match |
| reorder-topics | 1 MODIFIED | Exact match |
| restore-topic | 1 MODIFIED | Exact match |
| team-content-access | 1 MODIFIED | Exact match (the only diff is the file's existing `---` separator after the block) |
| topic-annotation | 1 MODIFIED | Exact match |
| topic-customization-lock | 1 RENAMED + 3 MODIFIED | Exact match. The old header ("...and every administrator denial") is gone and the new one appears once, in its original position |
| topic-management-screen | 3 MODIFIED | Exact match |

- None of the 8 files has a duplicated requirement header. Requirement counts are unchanged from `main`, apart from the one rename. No requirement was orphaned or added.
- Code fences are balanced, and the `## Purpose` / `## Requirements` structure is intact.
- **Outside the delta (acceptable):** the `## Purpose` paragraphs of `reorder-topics` and `restore-topic` were also edited. The old text said "TOPIC-002 ... adds a no-manager rule to its admin side, #232"; it now says TOPIC-002 shares both sides. A delta cannot express a Purpose change, and leaving the old text would have kept a stale #232 claim, so this is correct hygiene and not drift.

## 2. Synced scenarios vs the code and tests

- **`content.ts`:** the `evaluateAdminTopicConfigRead` deny branch, the two 403 messages and the `admin.topic_config_denied` emission are removed. `membership_role` is recorded raw (`string | null`). The `assertTopic002AuthorizedRole` fail-closed guard is kept. The order audit insert → event → floor → send is unchanged. This matches topic-customization-lock R1/R3.
- **`standing-facilitator-access-helper.ts`:** the helper is unchanged. It admits `application_admin` before any membership check, so TOPIC-003..006 admit member admins. `topics.ts` changes only comments.
- **`audit-logger.ts`:** `admin.topic_config_denied` is removed from the `AuditEventName` union. The `admin.audit_write_failed` operation is narrowed to the access row.
- **Scenario-to-test traceability:**
  - EM-member admin writes for add, archive, restore and reorder, each with exactly one `topic.*` row: covered by `topic-write-member-admin-integration.test.ts`, a 4 × 3 matrix.
  - Raw `observer` membership role: covered by `content.test.ts` 3.2.
  - A removed membership is recorded as `null`, and a team id that names no team gives `team_found:false`: covered by `topic-002-admin-audit-integration.test.ts`.
  - GET/POST parity with no exception: covered by `topic-add-flag-parity.test.ts`.
  - A member admin is still refused TOPIC-007 with 403 and the annotation stays unchanged: covered by `topic-annotation-integration.test.ts`.
  - The manager-admin screen shows write controls but no definition controls: covered by `TopicManagementPage.annotation.test.tsx`.
- **Unit tests:** run locally, all passing. Backend `content`, `topic-add-flag-parity` and `topics`: 308 passed. Frontend `TopicManagementPage*` and `TeamPage`: 240 passed. **The real-Postgres integration suites were not run here** because no DB was available. CI must run them with `REQUIRE_DB`.

## 3. BRD, REST API Contract, deployment.md and 08b vs the code

- **BRD:** FR-1.3, FR-8.2 (the text, the rationale, and its Appendix row), the FR-8.7 rationale and Constraint 2 agree with the code. The #232 sentences are removed. The BRD:227 "no-manager rule" mention refers to session participation (#243), not TOPIC-002, so it is correct.
- **REST API Contract:** the TOPIC-002 authorization section is correct. The `ADMIN_*` 403 rows and reason names are removed. The annotation and audit notes are correct. The TOPIC-006 authorization and Appendix B rows are correct. TOPIC-007 still rejects admins, which matches the code.
- **deployment.md:**
  - The hygiene line, the forensic lookup query and the audit-transport paragraph agree with the code.
  - The `topic.*` metadata shapes it lists match `topics.ts`: `{topic_id}`, `{topic_id, openActionItemCount}` and `{previous_order, new_order}`.
  - The removed #232 review queries and the "Proposed: Security, monthly" owner line are consistent with 08b §6, which calls the rows "forensic, not monitored".
- **08b decision record:**
  - Its scope (TOPIC-002..006 only) matches the code.
  - Its "keeps" list matches the code: the facilitator member bar returns `FACILITATOR_IS_TEAM_MEMBER` in `topics.ts` and `content.ts`, and TOPIC-001/007 admin denials are unchanged.
  - Its traceability list matches the documents edited.
- **Use Case 08:** the manager-admin alternate flow is removed, and the admin actor and acceptance criteria are added.

## 4. Lingering #232 / member-admin assertions

I searched `openspec/specs`, `requirements`, `docs` and `packages/*/src` for `ADMIN_IS_TEAM_MANAGER`, `ADMIN_MEMBERSHIP_NOT_ADMITTED`, `isn't available to its engineering manager`, `until #208`, `pending #208` and `no-manager`.

- The only hits are historical "reversing #232" notes, the explicit "retired" statements, and unrelated uses of "no-manager" (session participation, action-item reassignment, OIDC role map).
- **No main spec still asserts a TOPIC-002 manager-admin 403, or any member-admin bar on TOPIC-003..006.**
- The remaining mentions of `admin.topic_config_denied` all describe it as retired or historical, as intended.

## Findings

None blocking and none non-trivial. Two notes for the record:

1. **(Info)** The real-DB integration suites must pass in CI before archive. This review verified them by reading the code only.
2. **(Info, architectural)** The audit posture is now entirely forensic: the rows have no owner and nobody reviews them on a cadence. The Executive review accepted this explicitly under R-EXEC-1, and 08b records it honestly. I note it only because it is the kind of implicit operability gap I would otherwise flag. It is not drift.
