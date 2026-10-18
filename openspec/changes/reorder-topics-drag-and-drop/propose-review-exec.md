# Proposal Review: Reorder Topics by Drag and Drop (#181)

Reviewer: Rachel Okonkwo, VP of Engineering (Executive Stakeholder)
Focus: strategic alignment, proportionality, scope creep

## Verdict

Approve with changes. The intent is sound and the guardrails are good. The scope of the proposal text is larger than the value of the feature. Ship the narrow version.

## Strategic alignment

- **Adoption value is real but small.** Reorder is a facilitator convenience used a few times a year per team. It does not move any of my four success criteria (six sessions on three teams, a closed action-item loop, a trend insight, no evaluative-use concerns). It is a polish item, and I am fine with it only because the buttons already work and this adds no backend risk.
- **The commitment argument is the strongest one.** The #52 owner deferred drag on condition that #181 follows. Keeping a promise is a legitimate reason. The "long-distance move from 9 to 2" case is also credible. I would not defend this on adoption grounds, so please do not describe it that way to me or the CTO.
- **Priority check.** If this competes with anything touching first-session onboarding, the trend dashboard, or action-item closure, those win. Please confirm it is not displacing them.
- **Trust constraints are handled well.** No telemetry on how people reorder (constraint 4), no new data shown, a no-op or cancelled drag writes no audit row, and the first-session lock and the "existing sessions keep their order" copy are untouched. This is the right reflex. I back the decision to decline adoption telemetry.
- **Open source and on-prem.** No new dependency, no hosted service. Good.

## Scope and proportionality

Concerns, in priority order:

1. **Hand-built Pointer Events is the largest hidden cost.** Touch, auto-scroll, Escape and `pointercancel`, reduced motion, and cancel-on-transition amount to a small custom drag-and-drop library that the team then owns and maintains. The proposal rejects every library candidate, but it does not weigh the cost of owning this code against a simpler alternative. Ask for that comparison: what is the estimated size in lines and tests, and what is the maintenance burden? If it is more than a couple of days of work, I want to know before approving.
2. **Touch and tablet support is the likely creep.** The core case is a facilitator at a laptop the day before. The two-tablet real-device check, auto-scroll, and touch gesture handling are justified only if tablets matter. Propose a laptop-first release (mouse and trackpad) with touch as a fast follow-up if the first teams ask. This is the cheapest scope cut and keeps with my "ship to a first team quickly" ask. If touch stays in, keep it to the acceptance check already described.
3. **Auto-scroll for lists of about 25 items.** The default set is about 11. A 25-item list barely scrolls on a laptop. Auto-scroll looks like gold-plating. Cut it, or make it explicitly optional.
4. **The constraint list is long.** Six constraints plus a long out-of-scope list is more specification than a convenience feature needs. Several constraints ("no toast", "one handle per row", "no animation except the drop line") are UI taste rather than organizational policy. Keep the ones that protect trust and the lock (1 through 4, 6). Treat 5 as a guideline, not a gate.
5. **Refactor is fine.** The shared `applyNewOrder` and `moveToIndex` path is cheap and reduces risk. The equivalence test (drag and buttons yield identical draft, announcement and payload) is the best part of the proposal. Keep it.

## Things I am not worried about

- No backend, migration or schema change. Low organizational risk.
- Accessibility reasoning (buttons stay as the keyboard path, WCAG 2.5.7). Sound, though see the first request below.

## Requests before approval

1. Give a rough effort estimate for hand-built drag versus the buttons-only status quo, and state what happens if it overruns.
2. Decide explicitly: laptop-only first release, or touch included. My recommendation is laptop-only first.
3. Drop or defer auto-scroll unless real-device testing shows a need.
4. Name an owner for the accessibility confirmation. "Someone should own it" is not a plan, and I will not approve an unowned item.
5. Confirm that the 20 kB ceiling and the 25-topic assumption are accepted by the team lead. They are fine as stated, and I do not need to sign off on a number this small. Delegate it.
6. Put the new "drag unavailable while editor open" copy through the normal copy review. Make sure it is neutral and does not nag.

## Summary

Right idea, trustworthy guardrails, well argued. It is larger than the value it delivers. Cut touch and auto-scroll from the first release, trim the constraint list to what protects the team's trust, and this is a small, safe commitment fulfilled. I am not blocking it.
