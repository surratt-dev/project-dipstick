# Architect Review — tasks.md ordering (pre-session-action-item-review)

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope of this review:** does tasks.md's ordering respect the dependency structure design.md and proposal.md establish? I read tasks.md, design.md, and proposal.md as the current, settled state (post design-review). This is not a re-review of the decisions themselves — those are Marcus's, Oyelaran's, and the BA's territory, and I take them as given. I'm checking whether the task sequence lets an implementer build things in an order that actually works, without assuming something that isn't there yet.

## Overall assessment

The high-level section ordering is sound: scope gates (1) → staleness fix (2) → backend endpoint (3) → frontend status awareness (4) → review component (5) → error states (6) → verification (7) is the right shape, and the big dependency the team lead flagged me to check — backend endpoint and its extended 409 body existing *before* the frontend consumes them — is correctly respected. I did not find a case where a task assumes a capability that doesn't exist by the time it's reached, when read as sections. But at the task-number level there are four real issues: one incorrect cross-reference that creates a false blocking dependency, one stale reference to tasks that don't exist, one genuine cross-section forward dependency that isn't flagged as such, and one structural risk where the ordering itself undercuts a design requirement's explicit "not optional hardening" framing. None of these are fatal; all are cheap to fix before implementation starts.

## Findings

### 1. Task 1.2's blocking reference points at the wrong section — false dependency on section 4

Task 1.2: *"update design.md Decision 6 with the outcome before task 4.x below is implemented."*

Decision 6 is item ordering (chronological vs. stale-first). The only task that actually consumes that decision is **5.2** ("per the ordering decision confirmed in task 1.2"), which renders the list. Section 4 (SessionLobbyPage session-status awareness: WebSocket subscription, the 4.2 fetch/branch logic, the Start Session control) has nothing to do with item ordering — it never touches the action-items array's sort order.

As written, this reads as a hard gate on section 4, which is wrong on the merits and costly if followed literally: it would block the WebSocket-subscription and Start Session control work — real, independently-valuable, already-scoped work — behind a stakeholder copy/ordering decision that has nothing to do with it. Conversely, if an implementer notices the mismatch and ignores the "4.x" reference rather than escalating it, the *actual* dependency (1.2 → 5.2) has no textual anchor forcing it, and could get missed.

**Fix:** change "task 4.x" to "task 5.x" (specifically 5.2) in task 1.2.

### 2. Section 2's header references tasks that don't exist in this document

Section 2 header: *"Backend: staleness mapping fix (blocking, do before 2.4/2.5)"*.

There is no 2.4 or 2.5 anywhere in tasks.md — section 2 only contains 2.0a/2.0b/2.0c. The tasks that actually consume the staleness-fix output are **3.4** (`fetchPreSessionActionItems` call, which runs through the corrected `computeStalenessLevel`) and **3.5** (route tests, some of which will assert on staleness values). This looks like a leftover from an earlier draft's numbering. Task 3.1 already states the fix is "a separate, already-completed prerequisite" for the *export* step, which correctly implies section 2 precedes all of section 3, not just two sub-tasks — so the header's narrower "2.4/2.5" framing undersells its own scope even before accounting for the fact that those numbers point at nothing.

**Fix:** change the header to "blocking, do before 3.4/3.5" — or better, given 3.1 already establishes it as a section-wide prerequisite, drop the parenthetical task-number pointer entirely and just say "blocking — complete before any of section 3."

### 3. Task 4.2 has an unflagged forward dependency on task 6.1 (and 6.2 doubles back onto 4.2)

Task 4.2's branch table sends network/5xx failures to "the error state from task 6.1" — a task in a section two full sections later. Read strictly in document order, an implementer building 4.2 needs a component (6.1's error state) that hasn't been built yet. Task 6.1 and 6.2 both point back at 4.2 in turn ("task 4.2/6.1" in 6.2), which tells me the authors already know these are one coupled unit — but the section split still presents them as sequential, unrelated work items 4.2 and 6.1 could be picked up independently in that order.

This is lower severity than finding #1 because it doesn't create a *false* gate — the real dependency exists and is at least named on both ends (4.2 says "see 6.1," 6.1 says "see 4.2," 6.2 says "see 4.2/6.1"). But nothing tells an implementer working strictly section-by-section that they should treat 4.2 and 6.1 as effectively one task split across two locations, so there's a real risk of 4.2 shipping with a stub/placeholder error branch that never gets reconciled with 6.1's actual implementation, or of 6.1 being built as an afterthought disconnected from 4.2's fetch logic.

**Fix:** either (a) add an explicit note at the top of section 4 — "4.2's network/5xx branch and 6.1 are implemented together; do not consider 4.2 done until 6.1 exists" — or (b) pull 6.1 (and 6.2, since it's the same gate) forward into section 4 as 4.5/4.6, since they're really about the same fetch call section 4 owns, not a separable "error states" concern. I'd lean toward (b): section 6 would still keep 6.3 (per-item staleness failure, which belongs with section 5's rendering) and 6.4 (Start Session retry, which belongs with section 4's 4.3), so section 6 as a distinct "error states" bucket is already fiction — its four items are actually satellites of sections 4 and 5. Folding them in where they're consumed would remove this dependency-direction problem for free rather than just documenting around it.

### 4. Timing-floor/no-store hardening is split across 3.2 and 3.6 in a way that structurally contradicts design.md's own framing

design.md is explicit that F1 (timing floor) and F2 (`Cache-Control: no-store`) are "**both treated as design requirements, not later hardening**." Task 3.2 starts the timing-floor clock ("per task 3.6") but the actual `applyTimingFloor()` application and the `no-store` header both land in 3.6 — the last task in the section, after 3.3 and 3.4 have already fully defined the 404/409/200 response bodies, and after 3.5 has already written the route tests for those same three response paths.

Functionally this still gets built before section 3 is "done," since 3.6 is in the same section. But the *sequencing* — clock-start now, actual enforcement four tasks and one full test pass later — is exactly the "hardening bolted on at the end" shape design.md says this should *not* have. Two concrete risks:
- An implementer (or reviewer) who sees 3.1–3.5 complete, tests green, and treats the endpoint as shippable, with 3.6 read as a follow-on polish item rather than a blocking part of the same route.
- 3.5's tests are written against a response that, at that point in the task sequence, has no timing floor and no `no-store` header yet — meaning 3.5's tests can't (and per the task list, don't) assert on those properties; that assertion only shows up in 3.6. That's not wrong, but it means the endpoint has two "done" test passes instead of one, which is exactly the kind of split design.md's F1/F2 language is trying to avoid.

**Fix:** apply `applyTimingFloor()` and the `no-store` header inline as part of constructing each response in 3.2 (404), 3.3 (409), and 3.4 (200) — the clock already starts in 3.2, so there's no reason the floor-application itself needs to wait. Keep 3.6 only for its actual net-new content: the cross-cutting timing-indistinguishability test and the header-presence test across all three codes, which do legitimately need all three response paths to exist first. That reframes 3.6 from "add the security requirement" to "add the regression test for the security requirement already built into 3.2–3.4" — which matches how design.md itself frames F1/F2.

## Items I checked and found correctly ordered

- **Start Session control (4.3):** correctly sequenced after 4.1 (WS subscribe) and 4.2 (fetch/branch, which produces the `isFacilitator` signal 4.3 needs from the 409 body). Verification 7.0 is explicitly gated on 4.3 and explicitly states 7.1–7.5 depend on it — that's the right way to name a hard sequential dependency, and I'd point to it as the model for fixing findings #1 and #2 above.
- **Extended 409 body (currentSessionStatus/isFacilitator, task 3.3):** built in section 3, consumed in section 4 (4.2, 4.3) and section 3 itself doesn't get ahead of its own dependencies — `isFacilitator` in 3.3 correctly notes it's derived from `grant.path`, already resolved in 3.2 before 3.3's gate runs.
- **computeStalenessLevel fix (Decision 7, task 2.0a):** correctly placed before every consumer — 3.4 (query path), 5.3 (legend copy must match corrected mapping), 7.5 (manual verification of the 3-session-elapsed case). Section 2 fully precedes section 3, which is the right call even though the header's specific pointer is stale (finding #2).
- **Section 3 before section 4, section 4 before section 5:** backend-before-frontend-consumer ordering is respected throughout; I did not find a frontend task that assumes a backend field or endpoint ahead of the backend task that produces it.
- **1.1 (copy gate) and 1.2 (ordering gate) preceding section 5's rendering tasks:** correct in section order; 5.2/5.3 both explicitly cite the task-1 decisions they depend on.

## Summary for the team

Nothing here blocks starting section 1 or section 2 today. Before section 3 is picked up, I'd fix finding #4 (fold the timing-floor/no-store application into 3.2–3.4 rather than deferring to 3.6) since that's the one with a real risk of shipping the endpoint without its stated-as-non-optional security requirements. Findings #1 and #2 are quick text fixes in tasks.md that remove a false gate and a dangling reference, respectively. Finding #3 is worth a decision (note it, or restructure section 6) before section 4 is picked up, so whoever builds 4.2 knows not to treat its error branch as a stub.
