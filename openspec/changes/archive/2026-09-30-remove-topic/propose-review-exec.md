# Executive Review — remove-topic (#51)

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Focus:** Strategic alignment, scope proportionality, escalation of the session_topics finding

## Verdict

Approve, with one thing I want pulled out of this document and put in front of me and the CTO directly, not left as an Open Question footnote. The scope in front of me is larger than the one-line issue title, but when I trace each piece back to "can #51 ship correctly without it," almost all of it earns its place. This is not the internal-tooling scope creep I usually have to push back on.

## Scope, item by item

**TOPIC-004 (the endpoint) — necessary.** This is the issue. No discussion needed.

**The new Topic Management screen — necessary, and appropriately minimal.** I want to be careful here because "we also need to build the screen it lives on" is exactly the kind of justification that precedes a scope balloon. But #51's own title says "confirmation UI missing" — a confirmation dialog needs a screen to hang off of, and there isn't one. What keeps this from being creep is the discipline in what's *excluded*: no add/reorder/annotate controls, those stay with #52–55. One list, one action, one dialog. That's the "ship something usable, iterate" instinct I ask for, applied correctly. I'd have said something if this had grown into a general-purpose topic admin console. It didn't.

**TOPIC-002's authorization correction — necessary, and low-risk in a way that matters.** The screen needs a working read endpoint to list topics before it can offer to remove one. The endpoint is unbuilt today, so "correcting" it is really "building it correctly the first time" — there's no live caller to break, no deprecation window, no coordination cost. This is the good version of "found a bug while in the neighborhood, fixed it now instead of filing it and forgetting it." If this endpoint already had traffic on it, I'd want it split out for its own review cycle. It doesn't, so I don't.

**The session-start crash fix (`facilitator-sessions.ts`) — acceptable, and I want to note *why* rather than wave it through.** Strictly, #51 doesn't require this. It's a defensive fix for a code path adjacent to what this change already touches, closing an unhandled `500` that would land in front of a facilitator at the worst possible moment — mid-session, in front of their team. That's precisely the "quiet risk nobody's hit yet" category I worry about most, and it's small: a few lines, no new mechanism, explicitly scoped to the crash and not the deeper cause (more on that below). I'm comfortable with engineers bundling a fix like this when they find it, provided — as this one does — it stays contained and doesn't quietly expand into "let's also fix the thing that caused it." It does not. Good.

**The `archived_by` provenance column — the one piece I'd have accepted a "no" on, but the "yes" is defensible.** This is the only schema change in the proposal, and it's the piece most clearly *added* rather than *required* — #51 doesn't mention provenance. The justification is a real one (standing, org-wide facilitators inherit teams with no handoff; "it's just gone" is a trust regression), and the cost is genuinely small — one additive, nullable, no-backfill column, populated in the same transaction the archive already needs. If this had needed a backfill, a new index strategy, or a second screen, I'd send it back to be split into its own issue. It doesn't. I'll allow it, but I'd flag to the team: this is the pattern to watch. "Small and justified" said three times in one proposal is still worth a second look at issue #4 or #5.

## The finding that needs to leave this document

Buried in Open Questions: *"every session created today has no `session_topics` rows until some other, unbuilt mechanism populates them, which means `SESSION-004`/begin-voting cannot succeed for any session yet, not only ones affected by this change."*

Read that again. If it's accurate, it says begin-voting is broken for every team, today, independent of anything in this change. That is not a footnote to a topic-removal design doc — that's a production-blocking gap in the core session flow, the thing three-or-more-teams-at-six-sessions success criteria actually depends on. If a team hit this in a live session, that's exactly the crisis-mode conversation I've told this team I want to catch before it happens, not after.

I don't fault the team for finding this here — it's exactly the kind of thing you find by reading a file end to end for an unrelated fix, which is what happened. What I don't accept is it staying at the visibility level of "whoever owns session-topic-lifecycle next should be made aware," sitting inside a change whose own tasks explicitly decline to fix it. That's how real gaps go quiet for two quarters.

**Ask:** file this as its own tracked issue today, sized and prioritized on its own terms, referencing this design doc for context. It does not need to block merging remove-topic — I agree with the call that fixing it here would be a materially larger, differently-scoped undertaking bolted onto a topic-removal change. But it needs a ticket with an owner and a priority conversation this week, not a sentence in a design doc that only gets read by whoever implements #52 next. If it turns out on closer inspection that begin-voting *is* somehow reachable in production today, I want to know that too — either way, this gets resolved as a tracked decision, not left ambient.

## Bottom line

Ship remove-topic as scoped. The additions beyond the literal issue text (the screen, the TOPIC-002 fix, the crash fix, the provenance column) each pass the test I actually care about: would skipping it ship something broken, contradictory, or worse than not shipping at all? Yes in every case but the provenance column, where the answer is "no, but it's cheap and it closes a real trust gap for facilitators" — that's a fine trade at this cost. Escalate the session_topics finding out of this document and into its own tracked issue before this closes out.
