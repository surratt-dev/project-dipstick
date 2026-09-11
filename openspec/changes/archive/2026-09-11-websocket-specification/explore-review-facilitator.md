# Facilitator Review — WebSocket Specification Exploration Notes

**Reviewer:** Priya Nair, Staff Software Engineer / Facilitator SME
**Reviewing:** `exploration-notes.md` (Devon Calloway, explore stage)
**Lens:** Does this reconciliation work actually serve the person running the session, or is it an internal engineering exercise that happens to touch the reveal mechanic?

---

## Overall take

Devon's instinct not to paper over the `serverTimestamp` gap is the right one, and I want that on record before I raise anything else — I would much rather see a named gap than a spec that quietly describes non-compliant behavior as compliant. That said, this document is written entirely from the wire-protocol side: payload shapes, event names, REST-vs-WS routing. It never asks what any of this looks or feels like to someone running a session. For a document whose stated job is to protect the integrity of *the ritual*, not just the integrity of *the message catalog*, that's a gap I'd want closed before this goes into the proposal.

My biggest concern isn't anything Devon got wrong. It's that the notes stop at "is the guarantee technically true" and never ask "what happens in the room when it isn't, or when a connection hiccups on the way to being true."

---

## What's genuinely aligned with what I care about

- **Finding 1 (missing `serverTimestamp`)** lands squarely on my first concern: reveal simultaneity has to be a technical impossibility, not a "looks fine in the demo" property. I'm glad this was traced all the way to a specific missing field rather than left as a vague worry.
- **Checklist item 1** ("no pre-reveal vote value leak, anywhere in the catalog, stated as one cross-cutting invariant") is exactly the kind of thing I want to be able to point to in one place instead of trusting that five separate specs add up correctly.
- **Checklist item 4** (facilitator's readiness grid structurally cannot see vote values pre-reveal) is my second-biggest concern, called out explicitly. Good.
- **Checklist item 5** (watching for "the SLA is configurable" language creeping in later) — yes. Nothing about session integrity should ever become a deployment toggle.

Those four points tell me Devon is tracking the right invariants. What's missing is everything downstream of them: what a facilitator or participant actually sees when the system is working, degrading, or recovering.

---

## What's missing: the lived experience of reconnection, latency, and errors

### 1. Connection health never reaches my control surface

The notes treat `websocket-staleness-signal` as a purely client-side, participant-facing concern ("client connection-health rendering"). But I already carry a full mental model of the room during a session — who's voted, who looks confused, whether an outlier needs inviting to speak. If a participant's connection goes stale mid-vote, does that show up anywhere in *my* readiness grid, or does a stale participant just look identical to someone who's still thinking?

That distinction matters. A participant who's silently disconnected reads to me as "still deliberating" unless the tool tells me otherwise, and I might wait on them, or worse, call on them, when the actual problem is their connection. This is exactly the cognitive-load problem the readiness grid was supposed to solve, and the exploration doesn't ask whether staleness needs to be a facilitator-visible signal, separate from and without leaking into the vote-readiness signal.

**Ask:** should the spec require that connection-health state (not vote state) be exposed to the facilitator view as a distinct signal, the same way readiness and vote-value are already required to be distinct?

### 2. Reconnection-mid-session has no described room experience

`vote-compose-recovery` and the idle-sweep/token-refresh work in `websocket-connection-reauthorization` are both about *preserving state* across a disruption. Neither the shipped specs (as summarized here) nor this exploration document asks what the reconnect looks like to the person it's happening to, in front of their team, live. Does their screen show a spinner? A "reconnecting..." banner? Does their vote silently reappear, or do they have to notice and re-submit? If the idle sweep force-refreshes a token mid-session, is that ever visible, and could it ever look like something the facilitator did?

This is the "disappears into the background" question directly. A technically correct recovery that produces a visible, unexplained hiccup on someone's screen during a live retro is still a UX regression, even if no data was lost and no vote leaked. I don't see this asked anywhere.

**Ask:** for each of the three recovery/health mechanisms (staleness signal, idle re-auth, vote-compose-recovery), what is the *visible* behavior during the disruption, and has anyone looked at whether it's disruptive to a live session versus just correct?

### 3. What happens when the simultaneity guarantee is violated — is there a room-facing consequence, or only a log line?

Finding 1 treats `serverTimestamp` purely as a monitoring/SLA-compliance gap: without it, "nobody is currently measuring whether the ritual's simultaneity guarantee holds in production." Fair. But suppose it's added, and suppose a session's reveal skew does blow the 15-second budget one day. What happens? Does anything reach me, the facilitator, in that session or afterward? Or does this become a metric an SRE dashboard shows to nobody who was in the room?

If a reveal was materially non-simultaneous, that's not just an SLO breach, it's a session where I might have data I should treat as suspect — someone may genuinely have seen votes trickle in unevenly. I'd want to know that happened, even after the fact, so I can decide whether to revisit that topic with the team. Right now the spec's ambition seems to stop at "detectable by engineering," not "actionable by the person running the ritual."

**Ask:** does closing the `serverTimestamp` gap come with any facilitator- or session-history-visible consequence when the budget is exceeded, or is this purely backend telemetry?

### 4. Error-state disruption during a live session isn't evaluated against "does this feel like surveillance or breakage"

The notes list "error handling / close-code taxonomy" as a catalog item to assemble from the three shipped specs. That's the right engineering move, but nothing here asks the question I'd ask in usability testing: when a participant's connection errors out mid-topic, does the resulting UI look alarming? A big red banner, a forced logout, a disruptive modal — any of those would land the same way my "Concerns and Risks" section already flags for outlier flagging: it should inform, not perform for the room. I'd extend that principle to connection errors generally. A participant whose WebSocket drops shouldn't visibly become a spectacle for the rest of the team.

**Ask:** when this becomes a design-stage document, can the error/close-code section include a stated principle — error and reconnection states should be recoverable and low-drama by default, not just "handled" — the same way outlier flagging already has an explicit non-spotlight requirement?

### 5. First-session and continuity concerns are correctly out of scope, but worth a one-line acknowledgment

I don't think this spec needs to touch onboarding or the trend dashboard, and I'm glad the "does not cover" list is disciplined. I'd just want a short explicit note that connection/error UX during someone's *first* session isn't being re-litigated here, since a first-time team is the group least equipped to correctly interpret an ambiguous reconnect banner. Not a scope change, just a pointer so a future reader doesn't assume it was considered and dropped.

---

## Summary for the proposal stage

This exploration does the right engineering-integrity work: closing the `serverTimestamp` gap, correcting five documents' worth of stale event names, stating the cross-cutting no-leak invariant. I don't want any of that softened.

But as written, the document would produce a spec that is fully verifiable by engineers and silent on what any of it looks like to the people actually running or attending a session. Before I'd sign off on the eventual spec, I want:

1. Connection-health (staleness) surfaced to the facilitator view as a distinct signal from vote-readiness.
2. A described (not just implied) visible behavior for each reconnection/recovery path, evaluated for whether it's disruptive mid-session.
3. An answer to whether an SLA-budget violation on reveal simultaneity ever becomes visible to a facilitator or session record, not only to backend monitoring.
4. A stated low-drama/non-spotlight principle for connection and error states, mirroring the one that already exists for outlier flagging.

None of this requires re-opening the five shipped specs. It requires this connective document to spend at least as much attention on what the guarantees look like from inside a session as it spends on what they look like on the wire.
