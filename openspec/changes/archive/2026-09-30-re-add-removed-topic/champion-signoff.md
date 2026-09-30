# Champion Sign-Off — Re-Add a Previously Removed Topic (#54)

**Reviewer:** Devon Calloway, Internal Champion
**Verdict:** Clean pass. Shipping.

## Ritual intent

This change is pure back-office bookkeeping for a facilitator managing topic configuration between sessions. It never runs inside a live session, and nothing in it is reachable by an Engineer or an Engineering Manager. The no-manager-participation rule, the simultaneous reveal, and the facilitator-from-another-team requirement are unaffected — not "not regressed," genuinely untouched. I said as much in exploration §7 before design started, and nothing that came out of design, implementation, or the security/architecture reviews put a hand anywhere near those properties. This is exactly the kind of change I want to see more of: it makes an existing guardrail (topic flexibility) actually trustworthy — a remove that can't be undone isn't a safe experiment, it's a decision — without touching anything load-bearing to do it.

## The scope-split call

Pulling the trend-gap signal into a follow-up was the right call, and I'd have made the same one even without Rachel's review forcing the question — my exploration notes should have caught it myself; I said so on the record rather than let it pass quietly. Three things make this a real split, not a convenient excuse to ship less:

- Restore has zero dependency on it in either direction. A facilitator restores a topic, it reappears, its history is intact — the gap marker is a nice-to-have for a *different* reader (an EM reconstructing history), not a precondition for restore's own correctness.
- The use case document itself named a different owner for this ("should be designed in conjunction with the Trend Dashboard feature set") before this change ever touched it. Building it here anyway would have been me overriding a scoping decision the requirements already made, not making a judgment call.
- It literally can't be demonstrated against a real session today (#175 still open). Shipping unverifiable behavior to hit a scope target I set for myself would be the wrong kind of discipline.

Does the shipped feature still deliver real value without it? Yes, unambiguously. The thing facilitators were actually missing — a working undo — ships complete. What's deferred is a *different* audience's *different* problem (an EM piecing together history from a gap they can't currently see at all, on a trend view they couldn't reach with any tool before this). Nobody loses anything they had. I'd be more concerned if this were a change that shipped restore "mostly working" and called the trend signal the missing 20% — it isn't. It's two separable features that happened to get explored together.

## Things I checked rather than assumed

- **Authorization correction propagated correctly.** TOPIC-005 as drafted in the contract repeated TOPIC-004's pre-correction mistake (facilitator-only, no admin branch). Every stage of this pipeline — design, implementation, both security reviews — confirms the shipped handler calls the same shared, already-corrected function rather than re-deriving the gap a third time. This is the discipline I most wanted proven out, since it's the difference between a pattern that scales and one that has to be independently re-fixed on every sibling endpoint.
- **Provenance is honest, not performative.** `restored_by`/`restored_at` are server-set only, no client-forgery path, and `archived_at`/`archived_by` are preserved through restore rather than cleared — a facilitator inheriting a team gets the real history, not a laundered one.
- **No individual-performance surface reopened.** Nothing here adds any cross-team or cross-person comparison capability. Still narrowly team-topic-configuration data, visible only to the standing facilitator/admin population that could already see it.
- **The feature stayed small.** One button, one confirmation dialog, reusing an already-built pattern. No bulk restore, no history timeline, no reason field. That was my own standing concern going in, and it held all the way through — the tasks list didn't grow scope along the way, which is the thing I'm usually most worried about.

## One thing to watch, not a blocker

The follow-up trend-gap issue needs an owner named before it's designed — I flagged this explicitly rather than filing it myself, since assigning Trend Dashboard ownership isn't my call. If that issue sits unowned for a long stretch, the "EM inheriting a team without a handoff conversation" problem it's meant to solve stays open indefinitely. Worth a nudge from whoever tracks the backlog, not something that should block this change.

Nothing here gives me pause. This is a small, well-scoped change that closes a real trust gap in a guardrail I care about, built by reusing already-proven patterns instead of re-deriving them, with the one deferred piece deferred for reasons that hold up independently of who raised them.
