# BA Review: tasks.md coverage — `pre-session-action-item-review`

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewed against:** proposal.md, specs/pre-session-action-item-review/spec.md, design.md, and `requirements/use cases/03 - Pre-Session Action Item Review - Use Cases.md` (all as currently settled post-design-review)

## Verdict

Coverage is thorough. Every capability named in proposal.md's "What Changes" and every requirement/scenario in spec.md traces to at least one concrete task, including the scope that was added late in design review (Start Session control, extended 409, the `computeStalenessLevel` fix, timing-floor/no-store hardening, Rachel's copy sign-off, and the follow-up-issue date target). I found one documentation defect worth fixing before implementation starts, and a couple of smaller items worth a second look. Nothing here should block moving forward, but the dangling task reference should be cleaned up — it's exactly the kind of small inconsistency that turns into a "wait, what did you mean by this?" conversation mid-implementation, which is the thing I most want to avoid.

## Coverage matrix — recently-added scope (the items I was asked to focus on)

| Item | Where it's decided | Where it's a task | Verified? |
|---|---|---|---|
| "Start Session" control (facilitator-only, `lobby` branch) | design.md Decision 3; spec.md "facilitator-only Start Session control" requirement | 4.3 (render + wire), 6.4 (failure/retry), 7.0 (manual check it actually works end-to-end) | Yes |
| Extended `409` body (`currentSessionStatus` + `isFacilitator` on every path, not just `200`) | design.md Decision 1 step 3; spec.md "gated to pre_session" + "isFacilitator on every response path" requirements | 3.3 (both fields on 409), 3.5 (route tests assert both fields on 409 for both `lobby` and `active`), 7.6 (spot-check in running app) | Yes |
| `computeStalenessLevel` fix (Decision 7 — fixed 1/2/3, drop the multiplier) | design.md Decision 7 | 2.0a (the fix itself, sequenced before 2.4/2.5 — see Finding 1), 2.0b (regression test at current seed default), 2.0c (audit existing `/start` tests for stale assertions), 7.5 (manual check at exactly 3 sessions) | Yes |
| Timing-floor / `Cache-Control: no-store` hardening (security findings F1/F2) | design.md Decision 1 Security section | 3.2 (clock starts at handler entry), 3.6 (apply to all three paths + tests), 7.6 (manual spot-check) | Yes |
| Rachel Okonkwo's personal copy sign-off | proposal.md "Draft copy..." bullet; design.md Open Questions | 1.1 — names her explicitly, states routing directly to her, requires recorded sign-off, and is explicit that generic stakeholder approval doesn't satisfy the gate for those two copy pieces | Yes |
| Follow-up issue's 2-week merge target | proposal.md "A follow-up issue..." bullet | 1.3 — states the target explicitly and cites the executive-review rationale (wiring task against shipped endpoints, not open-ended) | Yes |

All six recently-added items are represented as concrete, checkable tasks — not left to live only in proposal/design prose. This is exactly what I'd flag as missing if it weren't there, so I checked it carefully.

## Coverage matrix — everything else in proposal.md / spec.md

| Capability | Task(s) |
|---|---|
| New GET endpoint, auth via `evaluateSessionSubscriberAccess`, reuse `fetchPreSessionActionItems` | 3.1–3.4 |
| 404 for no-grant / EM exclusion | 3.2, 3.5 |
| Session-status gate → 409 for non-`pre_session` | 3.3, 3.5 |
| Frontend: subscribe-before-fetch ordering (race mitigation, in-scope transitions) | 4.1, 7.1 |
| Frontend: branch on the one endpoint's response (200/409-lobby/409-other/404/network) | 4.2, 6.1 |
| Frontend: re-branch on `session_state_change` | 4.4 |
| Review component render fields incl. `originatingSessionNumber` → "Session #N" | 5.2 |
| Legend (1/2/3+ → yellow/orange/red) + summary line (both variants) | 5.3 |
| Empty state, facilitator-only advance control | 5.4 |
| "Begin First Topic" wiring + single-gate disablement | 5.5, 6.2 |
| Error states: GET failure, per-item staleness failure, Start Session failure | 6.1, 6.3, 6.4 |
| Ordering decision gate before item rendering | 1.2 → 5.2 |
| Explicitly out-of-scope items (inline status controls, threshold config, SESSION-005 fix, connection-host reconciliation) | Correctly absent from tasks.md — no scope creep found |

I also checked the inverse direction: nothing in tasks.md introduces scope that isn't backed by proposal.md/spec.md/design.md. No drift in either direction.

## Findings

### Finding 1 (fix before implementation) — Dangling task reference in Section 2's header

Section 2's header reads:

> `## 2. Backend: staleness mapping fix (blocking, do before 2.4/2.5)`

There is no task 2.4 or 2.5 anywhere in this document — Section 2 only contains 2.0a, 2.0b, 2.0c. This reads like a leftover from an earlier numbering pass (likely from when the review-endpoint tasks were renumbered into Section 3's 3.1–3.6). The sequencing intent is still recoverable from document order and from 2.0a's own text ("do before 2.4/2.5" almost certainly meant "before the review-endpoint tasks now in Section 3"), but a task list is exactly the artifact I expect an implementer to scan literally rather than infer intent from — a dangling reference here is a small thing that costs someone real time. **Recommend:** update the header to reference the actual current task IDs (e.g., "blocking, do before 3.1" — since 3.1 exports `fetchPreSessionActionItems` and the fix lives in the same file) or simply drop the parenthetical and rely on document ordering plus 2.0a's own cross-reference to Decision 7.

### Finding 2 (worth a decision, not blocking) — UC5's "real-time clearing" acceptance criterion isn't explicitly named as deferred

UC: Flag Stale Action Items' Acceptance Criteria states: "If a stale item's status is updated during the current review, the staleness indicator is cleared in real time." That behavior depends entirely on the write path (UC2/UC3), which proposal.md explicitly defers to the follow-up issue. Proposal.md's opening paragraph names UC1 step 6 and "all of UC2/UC3" as deferred, which covers this by implication, but UC5 itself is never named alongside that deferral — someone tracing UC5's acceptance criteria against this change in isolation could reasonably conclude this AC is simply unaddressed rather than deliberately out of scope for this change. This is the kind of thing I care about specifically because of edge cases discovered late turning into scope disputes: it isn't ambiguous today, sitting here with all three documents open, but it will be if a stakeholder pulls up UC5 during a later review and checks its boxes against this change alone. **Recommend:** no task change needed, but consider a one-line addition to proposal.md's deferral sentence naming UC5's real-time-clear AC alongside UC1 step 6 and UC2/UC3, so the deferral is traceable from the use case doc a reader is holding, not only from the proposal's framing of UC1.

### Finding 3 (observation, not a gap) — No explicit verification task for "no cross-team/owner comparison"

spec.md's "No cross-team or cross-owner comparison is possible" scenario is satisfied by *absence* of a feature (nothing aggregates or ranks), so there's no natural implementation task for it — that's expected and correct. Section 7 (Verification) doesn't include a manual check confirming this either, though. Given this is a hard requirement for me (it's adjacent to the no-performance-tool constraint Rachel cares about, and to the "no aggregation" boundary this ritual depends on), I'd feel better with one line in Section 7 — e.g., "7.7 Manual check: the review screen shows only the caller's own team's items, with no ranking, aggregation, or comparison UI anywhere on screen" — cheap to add, and it converts an implicit non-feature into something a reviewer actually confirms rather than assumes.

## What I did not find

- No missing task for any capability named in proposal.md's "What Changes."
- No task representing something proposal.md/spec.md explicitly places out of scope (checked the "Explicitly out of scope" and "Explicitly deferred" lists in proposal.md against the full task list line by line).
- No requirement in spec.md without a corresponding task.
- No use case Main Flow step or Acceptance Criterion silently dropped, aside from the UC5 real-time-clear item noted in Finding 2, which is deferred by clear implication rather than dropped.
