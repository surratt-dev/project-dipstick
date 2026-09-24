# Executive Review — Join Link Display & Copy Proposal

**Reviewed by:** Rachel Okonkwo (VP of Engineering, Executive Sponsor)
**Source reviewed:** `openspec/changes/join-link-display-copy/proposal.md`
**Cross-checked against:** `design.md`, `tasks.md` in the same directory

**Verdict up front:** Approved. This is exactly the kind of change I want to see coming out of the team without me having to ask for it — small, self-contained, and closing a gap that would otherwise quietly cap adoption at zero real sessions. Scope is proportional to value. I have one question I want answered before this ships, not because it changes the verdict, but because it changes how urgently it should move.

---

## 1. Strategic alignment — this isn't a UX polish item, it's a precondition for adoption

My success criteria start with "three or more teams have completed at least six sessions." That number is zero if a Facilitator can't get the join link in front of their team in the first place. Reading `design.md`'s Context section closely: during `draft` status the link is at least visible (muted, but a Facilitator could hand-select and copy it). During `lobby`+ — the state where the room is actually open and people are supposed to be joining — the current `live-readiness-view` branch shows *nothing*. Not muted text, not a link, nothing. `"The room is open. Session status: X."` is the entire message.

That means today, the moment a session goes live, a Facilitator has no way to get the join link onto their screen at all short of opening dev tools and reading a network response. That's not a rough edge — that's the ritual failing to start. I'd rather the team flag things like this as "blocking" explicitly rather than let them arrive framed as routine polish alongside other backlog items. Everything else in the proposal is real value, but this specific gap is why I'm calling this a should-ship-now item rather than a nice-to-have.

I want to specifically call out the proposal's own framing in `Why`: catching "a feature that would pass every test written against the wrong component while remaining functionally invisible to the person actually running the session" is precisely the failure mode I rely on the team to catch before I have to hear about it from a frustrated facilitator three weeks in. Good instinct, and I'd like to see that kind of framing show up more often in proposals — it tells me the team is checking against real usage, not just against acceptance criteria written in the abstract.

## 2. Scope proportionality — well-bounded, no bloat

This is a small change and it reads like one:
- One new hook, two existing view branches touched, zero backend changes.
- The `draft-control-view` copy-button addition (item 2 in "What Changes") is bundled in cheaply because it reuses the same hook as the `live-readiness-view` fix — that's the right call. It's a secondary win riding on the primary fix's cost, not a separate initiative.
- Explicit non-goals in `design.md` — no QR codes, no in-app notification system, no general toast infrastructure — are the kind of boundary-setting I want to see by default, not something I have to ask for.
- `SessionLobbyPage`'s routing gap is correctly *not* fixed here. Folding that in would have turned a small, low-risk display fix into a larger change touching `TeamPage` and navigation behavior — different risk profile, different review needs. Filing it as #164 instead of quietly absorbing it or silently leaving it as dead code is the right instinct on both counts.

I don't see scope creep here. If anything, the proposal underclaims its own urgency by presenting the `draft` and `lobby`+ fixes as a single undifferentiated unit rather than naming the `lobby`+ gap as the blocking half and the `draft` extension as the bonus half.

## 3. Data access / org policy — not implicated

Nothing here touches session data visibility, team boundaries, or anything an Engineering Manager or facilitator sees that they shouldn't. This is a Facilitator looking at a link that's already theirs to share, gaining a copy button. No new data crosses any boundary I care about. No concerns from that lens, and I don't need to be consulted further on this one.

## 4. One open question before this ships

The proposal doesn't say anything about priority relative to other in-flight work — from the recent commit history, the team's also been heads-down on auth/reauth flows, audit logging, and inline team creation. I don't have visibility into relative sizing from here, but I'd like whoever's sequencing work to confirm this lands *before* the first real team's first live session, not after. A team that hits this gap on day one and has to work around it manually is exactly the "friction kills the champion" risk I flagged as a standing concern — if a senior engineer championing this internally has to tell their first participants "sorry, I can't actually send you the link yet," that's a bad first impression to recover from. This isn't a blocker on the proposal itself — it's a sequencing note for whoever owns the roadmap.

## 5. Minor observation, not a concern

The proposal and design doc are thorough — six numbered design decisions with alternatives-considered for what is, functionally, a copy button and a style tweak. I don't want to discourage that rigor; the clipboard fallback behavior (D2) in particular is worth getting right the first time since it's establishing a pattern others will copy. I'll just note I'm trusting the team's judgment that the documentation effort here was proportional to the decision, not itself a sign of scope inflation — nothing in the proposal suggests it wasn't.

---

## Summary for whoever's tracking sign-off

- **Approved** — serves the adoption goal directly, scope is appropriately small, no data-access implications.
- **Ask:** confirm this ships ahead of any team's first live session, not queued behind unrelated work.
- **No changes requested** to proposal scope, non-goals, or the #164 deferral — all three are the right calls as written.
