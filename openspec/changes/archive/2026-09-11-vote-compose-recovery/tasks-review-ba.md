# Tasks Review — Business Analyst (Marcus Delgado)

**Change:** `vote-compose-recovery`
**Reviewing:** `tasks.md` against `proposal.md` and `specs/vote-compose-recovery/spec.md`
**Question:** Taken together, do the tasks cover every capability and requirement/scenario in the spec? Is anything lost in translation?

## Verdict

Mostly yes, and the translation is unusually disciplined — task 4.5 even preserves spec.md's own framing that discard condition (d) is a race, not a normal-path branch, rather than flattening it into "just another test case." That kind of fidelity is what I look for. But I found one requirement-level omission (no task checks the D3e no-audit-log decision), one structural gap in how the deferred rendering scenarios are tracked, and two smaller traceability soft spots. None of these are "stop and rewrite" issues, but the audit-log one and the deferred-scenario one should be closed before I'd call this buildable-without-follow-up-questions.

## Requirement-by-requirement traceability

### Requirement 1 — Client-local persistence on every compose-value change
- Persist-on-change → 2.1. Write shape/overwrite behavior → 2.2. No network/no other storage touched → 2.3. Covered.
- Scenario "the persisted record never becomes a second source of submitted vote state" (i.e., a later normal lock-in submission is unaffected by, and independent of, this mechanism) has **no direct task**. It's covered only by inference from 6.4 ("no server-side or database write is introduced anywhere in this module") plus the single-call-site guardrails in Group 6. That's reasonable given the submission path/compose UI doesn't exist yet to test against, but it means this scenario is currently unverifiable rather than deferred-and-tracked. Recommend a one-line note in Group 8 (alongside 8.2) naming this as a second integration-level scenario owed once the compose UI and submission path both exist — right now it's silently absent rather than explicitly deferred.

### Requirement 2 — Single-use restore on first WS registration after page load
- Gate implementation → 3.1. Two-registrations-in-one-load → exactly one restore attempt, second is a no-op that doesn't read storage → 3.2 (this explicitly covers the "later in-tab reconnect does not re-attempt" scenario too, including its "no sessionStorage read occurs" clause). Clear-after-one-attempt regardless of outcome → 3.3. Fully covered, cleanly mapped.

### Requirement 3 — Restoration subordinate to server-authoritative state, fixed order; registration payload
- Ordering constraint (no read/apply before payload arrives) → 4.4 (implementation) / 4.8 (test). Lock-in precedence → 4.3 / 4.6. Positive restore path → 4.7. Covered.
- Backend payload itself (D3a–D3d): shape → 7.1; assembly/query/no-cache/null-on-zero-rows → 7.2; builder unit tests including the self-disclosure-only property → 7.3(iv); wiring, ordering-after-the-three-existing-timer-calls, and failure containment → 7.4; integration test for the happy path and the rejected-connection path and the failure-containment path → 7.5. This is thorough and matches design.md's D3c "Ordering and failure containment" section almost clause-for-clause.
- One scenario is thinner than the rest: **"this happens on every successful registration, not only the tab's first one."** Task 7.4 states the *implementation* won't special-case first-vs-subsequent registrations, but 7.5's integration test only asserts one connection receives one snapshot on its one registration — it doesn't exercise a second registration (e.g., a reconnect on the same session) and confirm it also gets a fresh snapshot. Given D3b calls this out explicitly as a design decision ("the backend has no reliable, cheap way to distinguish... and does not need to"), I'd want a test that actually proves it, not just an implementation note that promises it. Minor addition to 7.5, not a new task.

### Requirement 4 — Discard conditions enumerated (the four/five branches)
- (a) topic mismatch, (b) topic matches but not `voting`, (c) `wrap_up` with no current topic, (d) `sessionId` no longer active → all four implemented at 4.2 and individually unit-tested at 4.5, **including** 4.5's explicit instruction to build condition (d)'s fixture as the race window it actually is, matching spec.md's and design.md's own framing almost verbatim. The fifth branch — lock-in always wins regardless of the other four — is correctly kept as its own item (4.3 / 4.6) rather than folded into the four, which matches how spec.md itself separates it (Requirement 3's lock-in scenario vs. Requirement 4's enumerated conditions). This is the strongest piece of translation in the document — nothing lost here.

### Requirement 5 — Resolves before first paint; no visible or facilitator-visible trace
- The *logic-level* precondition that makes this possible — no application of a value before the payload arrives — is enforced by 4.4/4.8, which is correct as far as it goes.
- The *actual* rendering scenarios from spec.md — "a restored draft appears with no visible transition" and "a discarded draft is indistinguishable from an empty compose control" — cannot be tested now because the compose UI doesn't exist (design.md D7 acknowledges this explicitly as an integration-level tier). That's a legitimate reason to defer, not a hole in the design. But **tasks.md's only tracked follow-up for deferred integration scenarios is 8.2, and it names exactly one scenario** ("a participant who reloads via SEC-26 recovery sees their in-progress selection restored"). The no-flash/no-spinner scenario, the discard-is-indistinguishable-from-empty scenario, and the toast/banner/console-silence scenario are not named anywhere as things owed once the compose UI lands — they exist today only as SHALL statements and Given/When/Then scenarios in spec.md with no forward pointer in tasks.md. Given how explicit this document is elsewhere about naming deferred work (7.1–7.5 vs. 8.1 vs. 8.2), this is the one place where "deferred" quietly became "unlisted." I'd want 8.2 (or a new 8.3) to enumerate all of Requirement 5's scenarios as owed integration coverage, not just the headline restore case.
- The facilitator-readiness-grid scenario is the one exception that's well handled without needing a future test: 6.2 confirms `FacilitatorReadinessGrid.tsx` is unmodified by this change, which is a directly provable, checkable-now guardrail for "the grid gains no new state" — no deferral needed there, and the tasks correctly treat it that way.
- No toast/banner/sound/animation/console message → 6.1, explicitly scoped as a code-review confirmation rather than a runtime test, which is appropriate for a module with no UI yet.

## The two ritual/design-decision-specific checks the review was asked to make

**Self-disclosure-only (D3d):** Well covered. 7.3(iv) unit-tests directly that another user's vote row for the same topic does not affect this user's `hasLockedInVote`, and 7.5 confirms the rejected-connection path discloses nothing. This is the one place I'd call fully closed with no notes.

**No-audit-log (D3e):** **This is the one clear miss.** Design.md D3e states, deliberately and at some length, that `session_registration_snapshot` sends are *not* written to `audit_log`, and explicitly wants that absence to "read as a decision, not an oversight, to anyone reviewing this later." Nothing in Group 7 (7.1–7.5) or Group 6 checks this. Compare with how carefully Group 6 guards the *other* non-goals for the frontend module — 6.1 (no toast), 6.2 (no facilitator grid state), 6.3 (no admin toggle), 6.4 (no server-side write) all get an explicit confirm-via-review task. The backend side of this change has an equally explicit non-goal (D3e) and got no equivalent guardrail. Concretely: nothing stops an implementer from reflexively adding an `audit_log` insert next to the new `safeSend` call in 7.4 (it would look like "the responsible thing to do" without this context), and nothing in the task list would catch it in review. Recommend adding a task alongside 7.4 or 7.5: confirm (via code review, matching the style of 6.1–6.4) that no `audit_log` write is introduced anywhere in this change's backend code path, citing D3e.

## Capabilities coverage (proposal.md)

The single new capability (`vote-compose-recovery`) is fully addressed across Groups 1–8. The "Modified Capabilities: none" claim in proposal.md is consistent with tasks.md — no task touches `websocket-connection-reauthorization` or `session-topic-lifecycle` beyond reading their existing state, which matches the proposal's stated intent not to delta those specs. No orphaned or uncovered capability found.

## Minor process note (not a spec-coverage gap)

Task 8.1's instruction to "file the compose-UI-side half of this as a follow-up task against the compose UI's own change if that UI has not landed yet" is a prose instruction to create a ticket, not a checkbox deliverable itself. Given this team's history of edge cases surfacing late and turning into scope disputes, I'd rather see that follow-up filed as soon as Group 7 lands rather than left as a "whoever gets to task 8.1 remembers to do this" step — but this is a process preference, not a translation defect.

## Recommendations, in priority order

1. Add a guardrail task (near 7.4/7.5) confirming no `audit_log` write is introduced for `session_registration_snapshot`, citing design.md D3e. This is the one requirement-adjacent decision with zero task coverage.
2. Expand 8.2, or add 8.3, to enumerate all of Requirement 5's deferred integration scenarios (no-flash restore, discard-indistinguishable-from-empty, no toast/banner/console trace under real wiring) — not just the single headline restore scenario — so they're tracked as owed rather than silently dropped once ownership moves to the compose UI's change.
3. Add a note to 7.5 (or a 7.6) asserting that a second/subsequent registration on the same connection also receives a fresh snapshot, proving D3b's "every registration, not just the first" claim rather than only asserting it in implementation notes.
4. Optional: name the Requirement 1 "never becomes a second source of submitted vote state" scenario explicitly as deferred-to-integration in Group 8, alongside 8.2, rather than leaving it uncovered and unmentioned.

None of these block starting implementation — Groups 1–7 are buildable as written. I'd want #1 and #2 closed before I'd sign off on this as complete, since both are places where an explicit design decision could quietly go unverified.
