# Executive Review — vote-compose-recovery

**Reviewer:** Rachel Okonkwo, VP Engineering
**Focus:** Strategic alignment, scope-to-value proportionality, priority

## Bottom line

Not a block, but I'd push back on timing. This is well-contained, low-risk engineering, but it's solving a narrow edge case of a UI that doesn't exist yet, ahead of the UI itself. I'd rather see this land as part of the compose UI change than as a standalone proposal that ships now and integrates later.

## What I like

- **Blast radius is genuinely small.** Frontend-only, additive, no backend/DB/API touch, no new facilitator-visible state, no admin toggle. If I'm wrong about priority, the cost of being wrong is low — the whole module is described as deletable with one call site to remove (Migration Plan). That's the right way to scope a defensive fix.
- **Discipline on non-goals is good.** No new chrome, no facilitator signal, no cross-device resume, no server-side shadow state. That's consistent with my access-control and "this is the team's data" principles — nobody's tempted to bolt a "manager visibility" feature onto this later.
- **The "discard unless clearly right" default (D4, Risk section) is the correct failure mode** for anything touching vote data, and the write-on-change vs. write-on-navigate decision (D1) is sound engineering — it avoids a flaky unload hook.

## Where I'd push back

**1. Population affected is small, and the proposal doesn't size it.** This fixes the intersection of two already-uncommon events: a participant is mid-compose (a window of maybe tens of seconds within a voting round) *and* their connection hits SEC-26's grace-period re-auth in that exact window. I don't have a frequency estimate anywhere in this proposal or the design doc, and I'd want one before treating this as high-value work. "Trust and ritual-integrity problem, not a UX nicety" is a strong claim to make about an event I have no evidence happens more than rarely. I'm not saying it's zero — I'm saying the proposal asserts severity without sizing incidence, and I'd want that gap closed before I call this well-prioritized.

**2. This is building the safety net before the trapeze.** The compose UI does not exist. Issue #32 (the redirect trigger this is meant to protect against) does not exist. What ships here is a fixture-tested contract with explicit "integration-level scenarios are deferred, not covered here" (design.md D7) and a follow-up task list (tasks.md §7) to wire it up *later, against a UI that isn't built*. That's precisely the pattern I warn teams about: don't build every feature before anyone uses it. The actual value of this work is unrealized until the compose UI ships and someone remembers to do the two wiring tasks in §7 — at which point it would have been cheaper and less error-prone to build persist/restore *inside* that same change, with the real component in hand, than to pre-build a contract against fixtures and hope the eventual wiring matches the assumptions.

**3. Opportunity cost, not correctness, is my objection.** Every hour on this is an hour not spent getting a first team through six real sessions — which is my actual success metric. I'd rather this be a task inside the compose-UI proposal's tasks.md (a "handle reload during compose" subtask) than a separate change with its own review cycle, its own spec, and its own merge — that's process overhead disproportionate to a problem we haven't confirmed is common.

## Recommendation

- Don't kill it — the design work (D1–D7) is sound and cheap to preserve. But hold it as a documented design decision and fold the implementation into the compose UI change when that lands, rather than merging a standalone module now that sits unintegrated for an unknown period.
- If the team believes this needs to merge now (e.g., to lock in the "discard by default" contract before compose UI implementers are tempted to cut corners under deadline), that's a legitimate reason — but say so explicitly in the proposal rather than defaulting to "ship independently because we can."
- Ask whoever owns issue #31/#32 sequencing for a rough estimate of how often a participant is actually mid-compose when a SEC-26 re-auth fires, even if it's a guess. That number should drive whether this is next sprint or backlog.
