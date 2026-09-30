# Executive Review — Re-Add a Previously Removed Topic

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Verdict:** Approve the restore capability. Split the trend-gap signal into a separate change.

## Strategic alignment

The core of this proposal — the restore endpoint plus the one-button "Restore" action on the screen `remove-topic` already shipped — is exactly the kind of work I want to see land quickly. `remove-topic` made removing a topic safe to try; without a restore path, it wasn't actually safe, it was just a delayed commitment, and a facilitator who figures that out stops experimenting. That's the adoption-friction pattern I care about most: a tool people quietly stop trusting because the "undo" they assumed existed doesn't. This closes that gap for a few hundred lines of reused authorization, cascade, and confirmation-dialog plumbing that's already proven out by TOPIC-003/004. Proportional, low-risk, ship it.

## Scope creep: the trend-gap signal

I don't think the trend-gap signal belongs in this change, and the proposal's own sourcing makes the case for me. The use case's Notes say the trend view treatment of the gap "should be designed in conjunction with the Trend Dashboard feature set" — that's the use case's authors flagging this as a joint decision with a different feature area, not a detail to settle unilaterally inside a topic-restore change. The trend dashboard is the single feature I've told this team matters most to me — it's my early-warning signal for the things I'd otherwise find out in crisis mode — and I don't want its design getting decided piecemeal as a rider on unrelated changes, however well-reasoned each individual rider is.

Three concrete reasons to split it out rather than wave it through:
1. **Ownership mismatch.** Whoever ends up owning the Trend Dashboard feature set should be the one deciding how it represents a gap — line-chart break, label, color, something else. Deciding it now, in a change scoped around topic restore, forecloses that conversation before the dashboard owner is even in the room.
2. **Rework risk on a component I care about.** This design is careful to avoid building chart infrastructure, but it still commits `EmTopicTrend`'s response shape and `EmTrendDataPage.tsx`'s rendering to a specific approach. If the eventual Trend Dashboard redesign wants something other than a plain-text marker, that's a second pass at a surface this change just touched — churn that a coordinated design would avoid.
3. **It can't even be demonstrated today.** The proposal is candid that end-to-end verification is blocked on #175 (session_topics not populated at session creation) — it ships unit-tested against synthetic fixtures only. A signal nobody can see work end-to-end is a reasonable thing to defer until the dashboard work that will actually exercise it is underway, not a reason to hold up the restore endpoint that has no such blocker.

The use case's acceptance criteria do require *some* gap treatment for this use case to read as complete, so I'm not asking to drop it — I'm asking for it to ship as its own change, coordinated with Trend Dashboard ownership and timeline, rather than bundled here. Restore itself doesn't depend on it: a facilitator can restore a topic and see it reappear in the active list with correct history whether or not the trend view marks the gap yet.

## Bottom line

Ship the restore endpoint and the screen action now — it's proportional, it's ready, and it's the kind of fast, iterative delivery I want to see more of. Pull Decision 6 (trend-gap signal), its schema/type additions to `EmTopicTrend`, and the `EmTrendDataPage.tsx` rendering change into a separate proposal that names a Trend Dashboard owner and timeline before it's designed, not after.
