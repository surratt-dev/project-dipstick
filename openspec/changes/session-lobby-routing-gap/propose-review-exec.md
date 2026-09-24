# Executive Review — session-lobby-routing-gap

**Reviewer:** Rachel Okonkwo, VP Engineering
**Verdict:** Approve. Treat as urgent — this blocks success criterion #1 entirely, not partially.

## Strategic alignment

This is not the "dead code cleanup" the originating issue (#164) described. Exploration found that no session created today can progress past `lobby` through any path a real user can click. That means the core ritual this whole application exists for — a team completing a session — cannot happen at all right now, for anyone, regardless of how good onboarding is. My own success criterion #1 ("three or more teams have completed at least six sessions") is not at risk of being slow to reach; it is currently unreachable. This is the highest-priority item this team could be working on, full stop, and I'd want it framed internally as a severity-1 fix, not routed through normal backlog prioritization.

I want to flag the framing gap upward, not just note it here: if a structural break this severe sat in the backlog under a "dead code" label, that's a signal our triage is under-weighting "can a user complete the core loop" as a severity signal. Worth a retro question, separate from approving this change.

## Scope proportionality

**Core fix (D1, D2, D4 — the Start Session control, the navigate link, the seven-status enumeration):** Right-sized. This is the minimum wiring needed to make `lobby → pre_session → active` reachable from the two places real users actually land (`DraftSessionHost` for facilitators, join-link redemption for everyone). No backend changes, no new capability surface. I'd have pushed back hard if this had come in bigger.

**Copy alignment (D5):** I read this as proportionate, not scope creep, and the design doc's own reasoning is why: before this change, the mismatched heading/copy between `DraftSessionHost` and `SessionLobbyPage` was latent, because nothing routed a real facilitator between them. D1–D3 make that handoff a normal-use path. Shipping the routing fix without touching the copy would hand every facilitator a jarring "did I land on the right product" moment on the very first session anyone runs through this — the opposite of the low-friction first-session experience I've asked this team to protect. The scope is also genuinely narrow (labels, headings, two copy lines), explicitly not a shared-component refactor. That restraint is the right call; I don't need a component consolidation to ship alongside an urgent unblock.

**Named-but-not-scheduled follow-ups (DraftSessionHost-native `pre_session` review, facilitator-aware join-link routing, presence signal):** Correctly excluded, and I want to specifically endorse *how* they were excluded. Naming them in the proposal instead of silently absorbing or silently dropping them is exactly the discipline I want — it means a future planning conversation starts from "here's what we deliberately deferred and why" instead of someone re-discovering the gap from scratch. Bundling the `DraftSessionHost`-native review into this change in particular would have been a mistake: the design doc is explicit that it requires reimplementing subscribe-before-fetch WebSocket ordering, which is correctness-sensitive, non-trivial work with its own risk profile. That doesn't belong in an urgent-unblock change. Ship the fix, take the follow-up through normal scoping.

## Things to watch, not blockers

- **`TeamPage` remains session-blind (non-goal).** Accepted as out of scope here, correctly. But I'll note this quietly caps adoption for any team member who doesn't personally hold a fresh join link — which is most of a team, most of the time, after the first session. I'd want this filed and prioritized soon after this change ships, not left to surface again as its own "how is this still broken" report.
- **Open design question (tasks.md 1.1, `wrap_up` landing) is unresolved and gates implementation start.** That's fine as sequencing, but I don't want a genuinely urgent fix stalled waiting on a persona review cycle for one enumeration cell. If Priya's input isn't available quickly, make the call, document the reasoning, and let implementation proceed — the design doc's own recommendation (decide it now, don't defer) is right; don't let "decide it now" become "wait indefinitely for sign-off."

## Data access / trust check

None of my non-negotiables are touched: no new data exposure, no change to who can see what, no backend or authorization change at all. This is routing and copy. Low risk on the axis I care most about.

## Bottom line

Approve as scoped. Escalate the priority — this should be worked next, not queued normally, given it currently caps total product usage at zero completed sessions regardless of anything else the team ships. Don't let the deferred follow-ups drift into silent backlog; revisit `TeamPage` session-awareness soon.
