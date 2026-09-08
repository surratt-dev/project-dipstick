# Executive Review — websocket-delivery-time-authorization

**Reviewer:** Rachel Okonkwo, VP of Engineering (Executive Sponsor)
**Date:** 2026-09-07
**Focus:** Strategic alignment, scope proportionality, adoption risk
**Verdict:** Approve, with two conditions and one process caution. This is the right work at the right time. I want a firmer commitment on the UX staleness signal, and I want the performance-measurement rigor right-sized to a product with zero live traffic.

---

## The headline judgment

I don't review pull requests and I don't sit in Design reviews, but I was explicit when I sponsored this project about the one property that is non-negotiable: engineers have to trust that this data cannot be used to watch them. That trust is binary. It either holds from the first pilot team's first session, or the ritual is dead before it has a chance to prove itself — no amount of trend-dashboard value recovers from a first impression of "the tool leaked something."

Read against that standard, this proposal is not scope creep dressed up as security work. It is closing the one hole left in a guarantee I already told this org was load-bearing. I'm going to push back on some of the effort calibration below, but I want to be unambiguous up front: I would rather this shipped slightly heavier than I'd like than see us launch the live-session feature without it.

---

## On the four questions asked of me

### 1. Net-new WebSocket + Redis infrastructure to close a gate, pre-launch — right sequencing, or disproportionate to a gate that could ship with a risk acceptance?

Right sequencing, and I don't think "ship with a documented risk acceptance instead" is actually the cheaper alternative it sounds like.

Here's why: nothing in this codebase currently delivers `vote_readiness_update`, `session_state_change`, `vote_revealed`, or `topic_history_update` at all. The live-session experience — the simultaneous reveal, the facilitator watching readiness in real time — has never shipped. That reframes the question. This isn't "we built a feature, now we're going back to bolt security onto it." The transport and the authorization model are the same build. There is no narrower version of "ship the live session" that doesn't also mean "ship delivery-time checks," because the risk-acceptance alternative would really mean: ship the simultaneous-reveal feature to a real team's first session without enforcing who's allowed to see a live vote. I would not sign off on that trade at any stage of this product's life, and pre-launch is the cheapest moment there will ever be to not have to make it — zero migration risk, zero cutover risk, zero incident to explain to a pilot team afterward.

So: build it now, build it right the first time. That's consistent with my own standing preference for shipping fast — the fast path here is "correct on day one," not "insecure now, patched later," because patching a trust guarantee after someone has already felt the breach doesn't actually recover the trust.

Where I do want scrutiny (see Q4) is whether every piece of the acceptance-test rigor attached to this decision is proportional to a system with no live traffic yet.

### 2. D7 audit logging — absorb in-scope, or split into a follow-up to contain blast radius?

Keep it in-scope. Don't split it.

This isn't the team getting excited and bolting on a feature mid-flight — it's a verified gap (not an assumed one, per D7's own text) in the audit trail for the single most sensitive action in the entire ritual: the reveal. The archived change's own champion sign-off already treated audit logging as part of how this org proves the no-surveillance guarantee is real — "an admin who systematically probes session content endpoints is detectable from the audit trail before any data is served" was the standard we set for the HTTP layer. Shipping the reveal action into any pilot environment with zero audit trail is a real gap against that standard, not a hypothetical one, and I don't want to carry it forward as "we'll fix it in a follow-up" when the fix is one additive write using an existing helper (`emitAuditEvent`) against an existing table. That's not comparable in weight to the WebSocket infrastructure itself.

My only ask here isn't about this instance — it's a standing instruction to the team: the right test for "absorb a discovered gap vs. spin it into its own change" is size and directness, not just "we happened to notice it." D7 passes that test cleanly (small, additive, directly tied to a named BRD requirement). Not every mid-proposal discovery will. Use this one as the example of judgment done correctly, not as a precedent for reflexively pulling everything found along the way into scope.

### 3. Deferring the SEC-25/26 heartbeat and the client-facing staleness UX — is that the right trade given adoption risk?

This is the one I'm pushing on hardest, and I want to be specific about where I agree and where I don't.

**Deferring the heartbeat mechanism itself:** agree completely. That's a genuinely different engineering problem (idle connections that never receive an event to check against) and the discipline of naming it, tracking it to one destination with an owner, and refusing to invent a mechanism under this proposal's time pressure is exactly right. This is the same discipline that caught "meaningful intervals" as a non-answer the first time around. Good.

**Deferring the generic client-facing staleness signal:** I'm less comfortable, and I don't think the proposal has fully weighed the cost on my side of the ledger. Walk through what actually happens under this plan: a connection gets revoked — correctly, silently, for good no-surveillance reasons — and the client shows nothing. No error, no banner, no visual change. Meanwhile everyone else in the room is voting, revealing, moving through topics live. The first time this happens to a real person in a real pilot session, what they experience is "the app just stopped working, out loud, in a room designed to feel safe." That is a support and trust cost, and it lands during exactly the fragile early-adoption window where one bad interaction can sour a team on the whole practice — this is precisely the scenario in my own concerns list: the tooling breaking quietly before anyone says something is exactly how confidence erodes.

To be clear, I am not asking to resolve *why* a connection was revoked — the non-goal on cause-disclosure is correct and I don't want it touched. I'm asking for the plain, generic "your view may be stale, refresh" signal that covers both a rejected subscription and an ordinary network hiccup identically. That's a UX decision, correctly routed to Priya's review, and I'm not asking this proposal to design it.

What I am asking for: don't let "named as a Design-stage deliverable, not resolved here" quietly become "shipped without it." Priya herself already caught this exact failure mode once in the exploration notes — a non-goal from a different context nearly got carried forward unexamined. I want a firm commitment, not a hope: the generic staleness signal ships before this reaches any real pilot team's first live session, full stop. If Design-stage work on it slips, the WebSocket authorization can still go live in a non-pilot environment, but nobody runs a real team through a live session with silent revocation until that signal exists. Make that an explicit gate alongside the SEC-25/26 tracking gate already in tasks.md Group 8 — Group 9's checklist should have the same teeth.

### 4. Is this proportional to actual current risk given there's no production traffic yet, or is the team over-engineering a gate for a threat model with no live users?

Proportional on the security substance; I want the performance-measurement rigor right-sized.

On substance: this isn't a hypothetical threat model. The roles this checks for — a removed team member, an Application Admin who happens to also be a team member, a role that changes mid-session — are structural properties of how this app already assigns access, not edge cases invented to justify work. The first pilot team's first session is exactly the highest-stakes moment for this guarantee, not the lowest, because trust has to be earned once, at the start, and there's no recovering it cheaply later. "Wait until we have real users to see if this matters" is backwards for a trust guarantee — you don't get a second first impression.

Where I want the team to pull back: the acceptance test plan (D5/D6 in design.md, Group 6 in tasks.md) is calibrated as if this system already has a real concurrent-load profile to protect. It doesn't — there's no production traffic, no known session-size distribution beyond "single digits, per the ritual's own design," and no UX-sourced skew budget or latency threshold to test against (the proposal is honest about this — both the ~100ms figure and the skew budget are explicitly placeholders pending numbers nobody has). I don't want the correctness work (the actual authorization checks, the admin-grant rejection, the reveal-serializer reuse, the pub/sub-hop drift test) held up by a fully-derived performance measurement program chasing a UX number that doesn't exist yet. Do the correctness tests at full rigor — those are cheap and non-negotiable. Treat the latency/skew measurement as a one-time sanity check with a generous, documented placeholder budget, confirm it doesn't blow up under a plausible pilot load, and move on. If real usage later shows the skew number needs tightening, that's a five-minute conversation with actual data behind it — which is a far better position than stalling launch now waiting for a number nobody can source. Don't let measurable engineering perfectionism become the reason the correctness fix — the part I actually care about — ships later than it needs to.

---

## Bottom line

Approve. Two conditions, one caution:

1. **Condition:** The generic client-facing staleness signal (not cause-of-revocation — just "this view may be stale") must ship before any real pilot team runs a live session, with an explicit gate in tasks.md alongside the existing SEC-25/26 tracking gate, not a soft "named for Design" hand-off that can quietly slip.
2. **Condition:** D7's audit logging stays in this proposal's scope, as written. Don't split it out.
3. **Caution:** Right-size Group 6's performance/skew measurement to a sanity check against a documented placeholder budget rather than a fully-derived, UX-sourced acceptance gate. Don't let the absence of a number nobody can source yet hold back the correctness work, which is what actually protects the guarantee I care about.

The SEC-25/26 heartbeat deferral is correctly scoped and should not be pulled forward into this change.
