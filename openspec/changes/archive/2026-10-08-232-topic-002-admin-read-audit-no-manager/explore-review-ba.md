# Explore review (BA): #232, TOPIC-002 admin read audit and the no-manager rule

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-10-08
**Reviewed:** `exploration-notes.md` (Devon Calloway), against issue #232 and related #208
**Verdict:** Ready to carry into a proposal once the clarifications in section 2 are answered. The two recommendations (deny the whole response; durable read row on every admin 200) are specific, traceable to the BRD and the existing specs, and testable. Most of what follows tightens wording so the proposal can't be read two ways.

---

## 1. Traceability: issue #232 acceptance criteria to the notes

| # | Acceptance criterion (#232) | Where the notes cover it | Status |
|---|---|---|---|
| AC1 | A recorded decision, with rationale, for Q1 and Q2, **consistent with #208's outcome** | §5 (Q1), §6 (Q2), §11 bottom line; #208 relationship §5 "Does it pre-empt #208?" | **Partial.** Rationale is there. "Consistent with #208's outcome" can't be met literally because #208 has no outcome yet, and the issue body says "decide (b) together with #208". The notes decide (b) *independently*. That deviation is defensible, but it is not stated as a deviation. See C1. |
| AC2 | Admin with active EM membership never gets `team_annotation` from TOPIC-002; integration tests cover it | §5 recommendation A; §9 integration bullet 1; §7 item 6 (no topic queries run) | **Covered.** Make "never" include archived-topic annotation fields and the `annotation_updated_*` fields explicitly (R2). |
| AC3 | Every admin read that returns topic configuration writes the agreed audit record; a test asserts it | §6 (operation, metadata, every 200, fail-closed); §9 unit + integration | **Covered.** The notes go further (fail-closed on insert failure, denial row). Good, but the proposal must say which of these are AC-mandated and which are additions (V5). |
| AC4a | Non-member admins still get 200 | §5 (null membership admitted); §9 unit split of L915 | **Covered.** |
| AC4b | Standing non-member facilitators still get 200 | §9 regression bullet | **Covered.** Add: facilitator 200 writes **no** `admin.*` row (it's in §9 unit, keep it in the AC list). |
| AC4c | Member-facilitators still get `403 FACILITATOR_IS_TEAM_MEMBER` | §5 reverse-case note; §9 regression | **Covered.** |
| AC4d | TOPIC-004 behaviour through the shared helper unchanged until #208 decides | §5 mechanics (helper untouched); §7 items 1–2; §9 parity row `{get:403, post:201}` and TOPIC-004 regression | **Covered, but narrower than the intent.** The notes rightly keep TOPIC-003/005/006 unchanged too, but the regression test plan names only TOPIC-004 (and parity covers POST/TOPIC-003). See V4. |
| AC5 | Specs and the contract row updated to match | §8 | **Covered**, and broader than the issue asks (adds `topic-customization-lock`, `topic-management-screen`). Needs concrete target paths and one unresolved item (V6). |
| Issue Q1 sub-question | "Also cover the reverse case: a global EM with a participant membership" | §5 "The reverse case" | **Covered** (already denied; pin with tests). |
| Issue Q2 sub-questions | in-transaction vs log-only; operation name; every read vs only when annotations returned | §6, each answered | **Covered**, except the in-transaction question is handed to the Solution Architect rather than answered (C3). |

Nothing in #232 is untraced. The two gaps are the #208 consistency wording (AC1) and the transaction wording (Q2), both of which are open questions rather than missing analysis.

---

## 2. Clarifications needed before the proposal

**C1. Who accepts deciding (b) without #208?** The issue says "decide (b) together with #208 so the admin and membership rules stay consistent". The notes argue the two rules differ (no-manager vs facilitator-from-another-team) and decide (b) alone, leaving a documented GET 403 / POST 201 split. I agree with the argument. But the product owner raised #232 with that instruction, so the proposal needs an explicit line: "This change decides #232 Q1 independently of #208, because ... ; #208 remains open; consistency is demonstrated by [X]." Proposed [X]: a comment on #208 recording the split and linking this change, plus the parity-test row comment. Get the owner's acknowledgement at proposal review, not after implementation.

**C2. What are the membership role values today?** The allow-list says "admit on `null | 'participant'`; `engineering_manager` or any unknown future role → 403". The proposal should list the current enumerated values of `team_memberships.role` (from the migration / CHECK constraint), so a reviewer can confirm no current value other than `engineering_manager` is newly denied. If, for example, a `facilitator` membership role exists, the notes don't say what an admin holding it gets. Name every value and its outcome.

**C3. Transaction wording: decide in the proposal, not "for the SA later".** The notes defer "same transaction vs teams.ts precedent" (§6, §10 Q2). AC3 depends on what "the agreed audit record" means, so this must be settled before tasks are written. My suggested requirement text is in R4. If the SA prefers `withAuditTransaction`, fine, but the decision belongs in design.md of this change, and "apply to all three admin-read operations" needs a scope call: is retrofitting `admin.membership_list_accessed` and `admin.team_detail_accessed` in scope here, or only the spec wording? I'd keep code changes to TOPIC-002 and change only the shared spec wording.

**C4. `actor_roles` in metadata (§10 Q1): in or out of this change?** It's framed as an open question to Security with "Devon leans yes". A proposal can't carry "leans yes". Either it's in the metadata schema (and the test asserts it) or it's a filed follow-up tied to #238. Also clarify the shape: the full `users.roles` array, or a boolean `actor_roles_include_em`. The boolean is safer (less data in the trail) and answers the only question anyone will ask of it.

**C5. Two denial names for the same thing.** TOPIC-001 denies an admin with `admin.session_content_denied` (and the spec forbids renaming it). TOPIC-002 would deny an admin + EM membership with a new `admin.topic_config_denied`. So "admin denied topic configuration" now has two operation names, depending on endpoint. The notes' reasoning for not reusing the TOPIC-001 name is sound, but the proposal should state the consequence: an audit consumer looking for denied topic-config reads must query both operations, distinguished by `metadata.endpoint`. Confirm `metadata.endpoint` is present on both (it is on TOPIC-001's).

**C6. Spec field names vs table columns.** The `team-content-access` requirement lists audit fields `action`, `resource_type`, `resource_id`; the real table (per teams.ts) uses `operation`, `team_id`, `metadata`. The notes map to the real columns. Say so in the proposal, and decide whether this change corrects the spec's field list or leaves it (I'd correct it while the paragraph is being rewritten anyway, since L178 is already being rewritten).

**C7. Release-note dependency (§7 item 7).** Who owns #187 Follow-up 5, and is it gated? Add a concrete action: "Follow-up 5 release-note line is blocked on this change merging" recorded wherever Follow-up 5 is tracked.

---

## 3. Vague areas

**V1. "Timing floor, `no-store`, the standard forbidden envelope" (§5 mechanics).** Fine as a pointer for engineers, but not testable as written. Name the existing constant/helper the deny branch must use and what the test asserts (e.g. "response is no faster than the same floor applied to `NOT_A_FACILITATOR`"; `Cache-Control: no-store` header present).

**V2. The 403 message and reason code (§5, §10 Q4).** The notes give an example message but no reason code. The 403 needs a machine-readable `code`. Note also that the frontend ignores the server message: `TopicManagementPage.tsx` sets its own copy on any 403 ("You do not have access to this team's topic management."). So the server message only matters to API consumers, and the BA answer to §10 Q4 is: **generic UI copy is acceptable for this release; no frontend change.** Suggested code `ADMIN_IS_TEAM_MANAGER` (or reuse a generic forbidden code; pick one and put it in the contract's 403 table). Suggested message: "Topic configuration for this team isn't available to its engineering manager." Also decide whether `membership_unrecognised` gets the same message (it shouldn't claim the caller is the manager when they aren't; use a neutral "isn't available to you" for that reason).

**V3. "Only admins pay for the extra query."** Good, but make it a stated requirement only if it's tested; otherwise it's design commentary. Suggest: keep it in design.md, not in the spec.

**V4. "TOPIC-004 unchanged" vs "writes untouched".** The issue AC names TOPIC-004; the notes say TOPIC-003..006. The regression plan should assert all four write endpoints still admit admin + EM membership (or explicitly accept that the parity test covers TOPIC-003 and the rest are covered by "helper file unchanged"). State which. Pin: "`standing-facilitator-access-helper.ts` has no diff in this change" is a cheap, reviewable condition.

**V5. Scope additions beyond the ACs.** The notes add: a durable denial row, fail-closed on audit insert failure, `annotated_count`, inclusion of the template team, and the global-EM regression. All are good. The proposal should list them as additional requirements of this change (so reviewers see they are deliberate), not mix them into the AC checklist as if the issue asked for them.

**V6. Doc targets.** §8 says "Update the Appendix B matrix cell if it lists TOPIC-002" and "register the two new operations if that spec lists operations". I checked the second: `openspec/specs/audit-logging-operations/spec.md` covers transport filtering and runbook items only and does **not** enumerate operations, so no change there; the registry is `AuditEventName` in `audit-logger.ts`. The Appendix B check is still open; resolve it before the proposal. Name the contract file: `requirements/design/REST API Contract.md`.

**V7. "Refetch after a write" volume claim.** TOPIC-002 is re-fetched after every admin write on the screen, so each admin write produces one write row plus one read row. That's fine, but the tests should assert "exactly one `admin.topic_config_accessed` row **per TOPIC-002 request**", not per user action, so nobody later "dedupes" it.

**V8. `annotated_count` definition.** Active topics only, or active + archived? Archived topics carry annotation fields too (§2). Define it: suggest `annotated_count` = number of topics in the response (active and archived) with non-null `team_annotation`.

---

## 4. Suggested rewrites (proposal/spec-ready wording)

**R1. Admission rule (replace §5 recommendation bullet 1).**
> TOPIC-002 SHALL admit a caller whose global role is `application_admin` only when that caller's live active membership role on the target team is absent or `participant`. Any other membership role, including `engineering_manager` and any role value not listed here, SHALL receive `403` with code `<CODE>`, and the handler SHALL NOT execute any topic, annotation, or lock-state query for that request. The membership role SHALL be read live per request (no cache). This rule SHALL NOT change the authorization of TOPIC-003, TOPIC-004, TOPIC-005, or TOPIC-006.

**R2. AC2, made checkable.**
> Given an `application_admin` with an active `engineering_manager` membership on a team that has at least one active and one archived topic with a team definition, when they call `GET /api/v1/teams/:teamId/topics/all`, then the response is `403` with code `<CODE>`, the body contains no topic names, no `teamAnnotation`, and no `annotation_updated_*` field, and exactly one `admin.topic_config_denied` row is written for that team. (Real-Postgres integration test; the test greps the body and the audit row for the definition text and finds neither.)

**R3. Audit record (replace §6 "Operation name" and "Fire on every admin 200").**
> Every TOPIC-002 response of `200` to an `application_admin` SHALL write exactly one `audit_log` row with `operation = 'admin.topic_config_accessed'`, `actor_user_id`, `actor_global_role = 'application_admin'`, `actor_ip`, `team_id`, and `metadata = { endpoint, http_status: 200, membership_role: null | "participant", active_count, archived_count, annotated_count }`, and SHALL emit the matching structured event. This applies to every team, including the template team, regardless of whether any topic has a definition. Metadata SHALL NOT contain annotation text, topic names, or topic ids. A `200` to a non-admin caller SHALL write no `admin.*` row.

**R4. Transaction wording (replacement for the spec's "same database transaction" sentence, pending C3).**
> For an Application Admin read, the audit row SHALL be written after the data has been read and before the response is sent. If the audit write fails, the request SHALL fail with `500` and the response SHALL contain none of the data read.

**R5. Reverse case (replace §5 "The reverse case" bullet with a requirement).**
> A caller whose global role is `engineering_manager` SHALL receive `403 NOT_A_FACILITATOR` from TOPIC-002 regardless of membership (none, `participant`, or `engineering_manager`). No code change; covered by unit and parity regression rows.

**R6. #208 boundary (add to proposal Non-goals).**
> This change does not decide #208. After it, an `application_admin` with an `engineering_manager` membership is denied TOPIC-002 (read) and still admitted by TOPIC-003..006 (writes) via the API. The parity test records this as `{ get: 403, post: 201 }` with a comment citing #208. A comment on #208 records the split as evidence for that decision.

**R7. Spec sentence to correct in `team-content-access` (L178 area).** Replace "TOPIC-002 does not yet write the admin read-audit row ... not changed by this requirement" with:
> TOPIC-002 writes an `admin.topic_config_accessed` row on every admin read it serves, and denies an admin who holds an active membership on the team other than `participant` (see topic-customization-lock).

---

## 5. Things I'd keep exactly as written

- Deny the whole response, not omit fields. The deny-list-of-columns argument (§5 table, §7 item 3) is the strongest point in the notes, and it matches the content matrix ("Topic configuration: EM = None") and the FR-2.4 precedent.
- Don't key admission on `users.roles` (§5 last subsection). Correct: it isn't team-scoped.
- Admin + participant membership stays admitted; that's #208's question.
- Note FR-8.7's rationale ("Administrators may still read team definitions on the topic management screen") needs a qualifying clause ("other than an administrator who is the team's engineering manager"). §8 doesn't list the BRD; add it, since it's the source that currently reads as unconditional.
