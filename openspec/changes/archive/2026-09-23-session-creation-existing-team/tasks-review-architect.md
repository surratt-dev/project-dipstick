# Architecture Review — Task Sequencing

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** `tasks.md` ordering only, checked against `design.md` decisions D1, D3, D6 and the audit-logging requirements. I have not re-reviewed the design itself — that was signed off separately — only whether the task breakdown sequences work in an order that doesn't assume something not yet built.

**Verdict:** Mostly sound. The macro sequence (migration → backend enforcement → shared types → frontend) tracks `design.md`'s own Migration Plan and correctly puts the self-enforcing migration guard ahead of everything that depends on the constraint it creates. But there are two concrete sequencing defects, both in the same area of the document (Sections 3–4a), that should be fixed before implementation starts.

---

## What's sequenced correctly (confirming, not just flagging problems)

- **Migration guard before dependents.** Section 1 (guard + `CREATE UNIQUE INDEX` in one task, 1.1) fully precedes Section 4's unique-violation catch logic (4.3–4.4), which is the only code that depends on the constraint existing. No task assumes the index before it's created. Good — and 1.1 correctly keeps the `DO $$ RAISE EXCEPTION` guard and the index creation as a single task rather than splitting them, which matches D3's requirement that the guard be part of the migration file itself, not a separate step.
- **`SessionAlreadyExistsResponse` before its consumers.** Task 4.1 (named interface in `@dipstick/shared`) is sequenced first in its section, before the implementation (4.2–4.4) and tests that return it, and well before Section 7's frontend handling of the 409. This is the pattern I'd want to see everywhere a shared type crosses a layer boundary.
- **Denial-path audit logging is alongside its check, not after.** Task 2.2 (`session.draft_denied_membership_conflict`, written before the 403) sits immediately after 2.1 (the check itself) and before the test block. An implementer can't complete 2.1 without also wiring the audit write in the same pass. This is exactly the pattern I want; it's also the pattern Section 4a breaks (below).
- **`canFacilitateSessions` before its frontend consumption.** Section 5 (backend field, type-first at 5.1 then computed at 5.2) fully precedes Section 6 (frontend routing that reads it). Correct dependency direction.
- **Check-order internals match D1.** Task 2.1's stated check order (not-found → not-facilitator → team-existence → membership) matches D1's explicit ordering rationale, and 2.8's test (nonexistent team + no membership → 404, not 403) confirms the existence check is exercised before the membership branch. No issue.

---

## Finding 1 (Should-fix): `EligibleTeamsResponse`/`EligibleTeam` are defined *after* the endpoint they type

Section 3 orders:
- 3.1 implement the endpoint (403 gate, live role read)
- 3.2 implement the eligibility query
- 3.3 compute and include `callerHasTeamMemberships` in the response
- 3.4 **add `EligibleTeamsResponse` and `EligibleTeam` as named interfaces**

Tasks 3.1–3.3 have the handler assembling and returning a response body before the named type that's supposed to define its shape exists. Compare this to Section 4, where `SessionAlreadyExistsResponse` (4.1) is placed *first*, ahead of the implementation that returns it — and to Section 5, where the `AuthSession.canFacilitateSessions` field (5.1) precedes its computation (5.2). Section 3 is the outlier, and it inverts the convention `design.md` explicitly calls for: "matching this file's existing convention of typed response shapes (`FacilitatorSessionStateResponse`) rather than an ad hoc inline body." As written, 3.1–3.3 produce exactly that ad hoc inline body, with the type retrofitted in 3.4.

This doesn't block anything downstream — Section 7 (frontend) doesn't run until well after Section 3 is complete either way — but it's a real internal inconsistency in the checklist, and it's the kind of implicit-by-default decision I'd rather see closed at the task-breakdown stage than left to whoever implements Section 3 to notice on their own.

**Recommendation:** Move 3.4 to the front of Section 3, before 3.1, or fold it into 3.1 as its first sub-step.

---

## Finding 2 (Fix before implementation): Success-path audit logging is positioned after, and forward-referenced by, the section it belongs to

Task 4.2 reads: *"Wrap the `INSERT INTO sessions` and the `session.draft_created` audit_log write (**Group 4a below**) in a single transaction."*

This is a literal forward reference: 4.2 cannot be implemented — the code won't compile, since `session.draft_created` isn't yet a valid `AuditEventName` — until 4a.1 has been done. But Section 4a is positioned in the document *after* all of Section 4 (4.1–4.9) *and* after Section 3 in between. An implementer following the checklist top to bottom hits 4.2 and is told to reference work that, per the document's own ordering, doesn't exist yet.

This also isn't just a document-ordering nit — it contradicts `design.md`'s own Migration Plan, which groups this differently:

> "2. Ship the `POST /draft` membership check, its audit logging (**both the denial and success paths** — see D1), and its tests. This is independently deployable and independently valuable — it closes the enforcement gap, with an audit trail, even before the picker UI exists.
> 3. Ship the `GET /eligible-for-session` endpoint and its tests."

The design treats "membership check + denial audit + success audit" as *one* atomic, independently-deployable unit that ships *before* the eligible-teams endpoint. `tasks.md` instead splits that unit across Section 2 (membership check + denial audit only) → Section 3 (an unrelated endpoint, interposed in between) → Section 4 (transaction + 409 handling, no success audit yet) → Section 4a (success audit, finally, forward-referenced the whole time). This is the same failure mode the review prompt named directly: an audit event landing after, not alongside, the code path it logs — the success-audit event is further from its check than the design's own deployment grouping intends, by an entire unrelated endpoint's worth of tasks.

**Recommendation:** Merge 4a into Section 4, with 4a.1 (`AuditEventName` value) sequenced immediately before 4.2, and 4a.2 folded into 4.2 as the same task (they describe one transaction). 4a.3's test belongs alongside 4.5–4.9, not after them. Once merged, consider whether the combined section (2 + 4 + 4a) should move ahead of Section 3 entirely, to match the design's stated deployable-unit boundary — Section 3 has no dependency on Section 2/4/4a or vice versa, so this reordering is free.

---

## Non-findings worth stating explicitly (so a future reader doesn't have to re-derive them)

- Section 2 (membership enforcement) and Section 4 (concurrent-session block) touch the same handler and are correctly sequenced — 2's check order ends with "5. Insert (see D3...)" and Section 4 is exactly that insert step, layered on after the checks it follows. No conflict.
- Section 3 (eligible-teams) has no dependency on Sections 1, 2, or 4, and vice versa (confirmed by D2's explicit decision *not* to join against `sessions` in the eligibility query) — its position relative to those sections is a style/grouping choice, not a correctness requirement, aside from Finding 2's forward-reference problem.
- Section 8's reliance on the pre-existing `facilitator-state` endpoint (from `enforce-access-control-on-team-content` / `session-lifecycle-transitions`) introduces no new intra-change dependency — that endpoint is already shipped, so Section 8 doesn't need to wait on anything in this task list besides Section 7 (which produces the `POST /draft` navigation Section 8 renders after).

---

## Summary of requested changes

1. Move task 3.4 (`EligibleTeamsResponse`/`EligibleTeam`) ahead of 3.1.
2. Merge Section 4a into Section 4; sequence the `AuditEventName` addition immediately before the transaction task that references it, not after the whole section.
3. Once merged, consider promoting the combined Section 2+4+4a ahead of Section 3, matching `design.md`'s Migration Plan step 2/3 boundary — optional, since no hard dependency forces it, but it would make the checklist's grouping match the design's stated deployment units.

Everything else — the migration-guard-before-dependents ordering, the shared-type-before-consumer pattern where it's followed correctly, and the denial-path audit placement — is sound and needs no change.
