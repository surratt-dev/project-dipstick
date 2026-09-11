# BA Review — Task Coverage: `actionitem-updated-live-broadcast` (#64 + #65 + #95, combined)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `tasks.md`, against `design.md` (D1–D14, Open Questions — Resolved), `proposal.md`, and `specs/action-item-status-management/spec.md`
**Also cross-checked:** `design-review-engineer.md`, `design-review-security.md` (to confirm findings routed into D10–D14 aren't being re-litigated here), `requirements/design/REST API Contract.md` (VOTE-002), `packages/backend/src/routes/content.ts`, `packages/backend/src/routes/em-views.ts`

---

## The four things you asked me to specifically check — all present

1. **`audit_log` write (D13)** — covered by both an implementation task (3.9: new `AuditEventName`, in-transaction insert, `emitAuditEvent` structured-log counterpart) and a test task (6.2a: transactional atomicity, correct `metadata`, no-op skip). Matches D13's spec requirement text exactly.
2. **Anti-enumeration (D12)** — implementation is 3.1a (load-by-id, 404 if missing) + 3.1b (relationship check, 404 for zero-relationship, 403 only for some-relationship); test is 6.1b, which explicitly covers all four D12 sub-cases including the timing-floor assertion. Both present.
3. **Facilitator-scope regression test (D10)** — 6.1a exists and names both grace windows (`draft` 24h, `complete`/`facilitator_access_expires_at`) as rejection cases, confirming the endpoint doesn't inherit `evaluateTeamAccess`'s broader grant. Present.
4. **VOTE-002 reconciliation task** — 5.3 is still tracked, and it's grown to match everything that's changed since my last review: path confirmation, D10's narrowed facilitator wording, D12's error-table reordering, the wire-name correction, and the stale CHECK-constraint claim. This is the most thorough version of this task yet. Present and current.

So the specific coverage you flagged is solid. What I found instead are two places where the *documents disagree with each other* or a write is assumed but never stated — the kind of gap that survives a checklist pass because each individual task reads fine in isolation.

---

## Finding 1 (should block): the delta spec still asserts the old, enumeration-vulnerable `403`, contradicting D12 and tasks 3.1a/3.1b/6.1b

`specs/action-item-status-management/spec.md`'s existing scenarios were written before D12 existed and were never updated:

- **Requirement: "An action item's owner can update its own item's status"** — Scenario "A non-owner, non-facilitator user is rejected": *"THEN the request is rejected with `403`, and `action_items.status` is unchanged."* No `404` branch at all.
- **Requirement: "An authorized facilitator can update..."** — Scenario "A user without ownership or facilitator authorization is rejected **regardless of team membership**": *"THEN the request is rejected with `403`."* The scenario's own title asserts `403` applies "regardless of team membership" — the literal opposite of D12, which exists specifically to make the response depend on team membership (zero relationship → `404`; some relationship, unauthorized → `403`).

This isn't a stale-prose nitpick — it's a direct contradiction on security-relevant behavior between two documents in the same change that are each individually treated as authoritative. An engineer implementing strictly from the delta spec (the artifact OpenSpec treats as the capability's source of truth) would build the enumeration-vulnerable version D12 exists to close; an engineer working from tasks.md 3.1a/3.1b would build the safe version. Both can't be "the spec." Given `design-review-security.md`'s F2 finding is what created D12 in the first place, leaving the delta spec unreconciled is the one place in this whole revision where the fix didn't fully propagate.

**Needed before implementation starts:** update both scenarios (and the Requirement 2 title, which shouldn't say "regardless of team membership" when the entire point of D12 is that it's *not* regardless) to state the `404`-for-zero-relationship / `403`-for-some-relationship split, matching D12 and 6.1b's four sub-cases. This is a spec-text task, not a design decision — the decision is already made, it just didn't make it back into the file that's supposed to record it.

---

## Finding 2 (should block): no task or requirement ever states that `action_items.resolution_note` itself gets written

Traced this through all four documents — proposal.md, design.md (D5, D9), the delta spec, and tasks.md 3.6/3.7 — and the same gap is in all of them: every one talks about persisting the resolution note to `action_item_history.resolution_note` (the audit trail), and none of them says `action_items.resolution_note` (the action item's own current-state column) also gets written.

This matters because I checked where resolution notes are actually *read* today: `packages/backend/src/routes/content.ts:433-440` and `packages/backend/src/routes/em-views.ts:800-907` both select `ai.resolution_note` directly off the `action_items` table — not off `action_item_history`. There's already a passing test (`em-views.test.ts:681`) asserting a resolution note round-trips through that exact column. If this change only writes the history row's `resolution_note` and never touches `action_items.resolution_note`, the whole point of D9 — closing issue #65, making resolution notes actually work — silently fails: the PATCH would return `200`, the note would be validated and stored in the audit trail, and it would *never appear anywhere a user can see it*, because every existing read path looks at the other column. That's the kind of gap that passes every test written against the current task wording (since 6.3's "valid note persisted" doesn't say *where*) and only surfaces when someone opens the EM view and the note isn't there.

Specific spots to fix:
- **Delta spec**, Requirement "A transition to Resolved may include an optional resolution note...": the SHALL statement and Scenario 1 ("A resolution with a valid note is persisted") should say the note is persisted to **both** `action_items.resolution_note` (the current-state column every existing read path uses) and `action_item_history.resolution_note` (the audit trail), not just the latter.
- **Task 3.6**: currently says "ignore (do not persist) a `resolutionNote` supplied on a non-resolving transition" and separately "Set `action_items.resolved_in_session_id`..." — it should add an explicit line: "Set `action_items.resolution_note` to the supplied note when the transition targets `Resolved`."
- **Task 6.3**: "valid note persisted" should be split or annotated to assert both writes — `action_items.resolution_note` (and confirm it's visible via `content.ts`/`em-views.ts`'s existing read path, ideally with an assertion against one of those endpoints or their query, not just a raw column check) and `action_item_history.resolution_note`.

---

## Finding 3 (non-blocking, worth a stated sentence): D10's facilitator window is broader than UC 03's literal precondition, and that gap was never explicitly named

D10 lands on `lobby`/`pre_session`/`active`/`wrap_up` as "actively facilitating," reasoned carefully against `evaluateTeamAccess`'s broader grace windows (security review F1) and against `session-subscriber-access-helper.ts`'s `LIVE_FACILITATOR_STATUSES` pattern (engineer review). Both reviews compared this status set to *other code*. Neither compared it back to the use case that originally motivated Open Question 1: `03 - Pre-Session Action Item Review - Use Cases.md`, "Facilitator Updates Status of Any Action Item," whose precondition is narrower still — *"The session is in the Pre-Session Action Item Review phase"* (i.e., `pre_session` only), and whose Notes line is explicit: *"Their ability to update items here is a session-scoped permission, not a general administrative one."*

D10/D11's ratified set lets a facilitator PATCH a team's action items while their session is in `active` (mid-voting) or `wrap_up` — phases the UC's precondition doesn't name at all. `design-review-engineer.md` (line 58) noticed the authorization window is broader than the broadcast gate and called that "fine and arguably correct" per D7 — which is a reasonable read for the *authorization-vs-broadcast* question, but it's a different question from *authorization-vs-the-UC-text*, and the latter was never explicitly checked. I don't think this needs to change — VOTE-002's own ratified formulation already reads as team-wide-while-a-session-is-active, broader than the UC's phase-scoped language, and the ratification decision (Open Question 1) already chose VOTE-002's formulation deliberately over the UC's narrower one. I just want that specific comparison — ratified scope vs. UC 03's literal precondition — stated as a conscious choice in design.md or the delta spec, the same way D11 states the D7 boundary explicitly, rather than leaving it as something only visible by reading the UC file directly. One sentence closes it.

---

## Findings 4–5 (minor, non-blocking)

- **No task explicitly tests D7/D11's core resilience claim.** D11 spends real effort establishing that authorization failure (no active session, no facilitator grant) is a `403` decided before any transaction begins, while broadcast failure (bad Redis publish, session left `pre_session` mid-flight) never affects the PATCH's own success — this is the specific tension security review F4 raised. None of 6.1–6.6 directly exercises "the PATCH still returns `200` when the WS publish fails" or "an owner PATCH with no `sessionId` supplied succeeds normally, with no broadcast, and no `422`." Both are one-line additions (I'd fold the first into 6.2's atomicity test since it's a similar shape of forced-failure test, and the second alongside 6.1). Worth adding given how much design-review work went into stating this boundary precisely — a design decision that subtle deserves a test that actually pins it down, not just prose.
- **6.1a bundles two distinct grace-window sub-cases into one bullet** ("a `draft` session... or a `complete` session..."). Not wrong, but given D10's whole rationale rests on both windows being excluded, I'd rather see them as two explicit assertions than one test description that could pass by only exercising one branch. Suggest splitting into 6.1a-i / 6.1a-ii.
- **Task 3.1 doesn't state the response body shape.** VOTE-002 documents `UpdateActionItemStatusResponse` (`actionItemId`, `status`, `resolutionNote`, `resolvedInSessionId`, `updatedAt`) in detail, and 5.3 reconciles the doc, but no task explicitly says the endpoint's `200` response matches that shape, and no test task asserts the full response body. Low risk since it's implied by "per VOTE-002's documented path, ratified by 1.2," but worth a one-line addition to 3.1 or 6.1 given how much of this review chain has hinged on VOTE-002 fidelity specifically.

---

## What's not a gap — confirming so it isn't re-litigated

- D9's resolution-note scope, D13's audit_log, and D14's dispatcher envelope plumbing all have both implementation and test tasks, matching design.md's mechanisms exactly (not just outcomes).
- Task 2.2/2.3's envelope-vs-client-payload split for `sessionStatus`/`resolutionNote`/`resolvedInSessionId` is correctly mirrored in 6.6's payload-invariant test — this is the one place a three-way document sync (spec, design, tasks, and now a payload-shape test) all agree.
- Tasks 5.1/5.2's dot-notation-naming fix (catching the conformance-test skip Marcus Oyelaran's review flagged) is correctly reflected and doesn't need further changes.
- Milestone/issue-tracker closure (5.4) correctly reflects #64+#65+#95 shipping together, matching D9's reversal and the exec-review framing in proposal.md.

---

## Bottom line

Task coverage against design.md's mechanisms (D10–D14 specifically) is strong — the four things flagged for this pass are all genuinely present and well-specified, better than most task lists I review at this stage. The two blocking findings aren't missing tasks so much as **documents that stopped agreeing with each other partway through revision**: the delta spec's authorization scenarios are one revision behind D12, and no document in the chain — spec, design, or tasks — ever states the one write (`action_items.resolution_note`) that makes D9's whole point (closing #65, making notes visible) actually true. Both are quick, mechanical fixes once named; neither requires a new design decision. I'd want both closed before implementation starts, since both are exactly the shape of gap that passes code review (the code will do what the task says) but fails a user opening the screen and not seeing what they just typed, or a penetration test finding the oracle D12 was supposed to close.
