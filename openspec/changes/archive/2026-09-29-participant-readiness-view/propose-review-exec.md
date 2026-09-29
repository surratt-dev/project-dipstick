# Executive Review — Participant Readiness View
**Reviewer:** Rachel Okonkwo, VP Engineering
**Focus:** Strategic alignment and scope proportionality

## Verdict: Approve, with two scope notes for visibility (not blocking)

## Strategic alignment: strong

This lands squarely in my "adoption stalls without low friction" risk bucket, not in "nice to have." The Facilitator's entire job during the wait is deciding when to start, and today they're deciding blind — no roster, no live signal, on either landing page. That's not a missing polish item, it's a missing control for the one decision this screen exists to support. If a Facilitator's first session opens on a page that gives them nothing to look at while people trickle in, that's exactly the kind of first-run friction that keeps a champion from becoming a habit. Fixing it serves adoption directly.

I also want to flag what this proposal does *not* do, because the restraint is deliberate and I want it recognized as such: no quorum counter, no "N of M expected," no participant-facing roster, no facilitator-initiated removal. Each of those would have been easy to wave through as "while we're in there," and each was named and explicitly declined with a reason. That's the discipline I asked for — ship what the use case needs, not what's adjacent to it.

The access-control handling is exactly right for my non-negotiable. The Engineering Manager exclusion is required to replicate the existing dual-check pattern exactly, at whatever new registration point is chosen, with its own dedicated security review gated before merge — not bundled into general code review. Tasks 1.4 and 6.4 make that concrete rather than aspirational. This is the one area where I'd have killed the proposal outright if it had been hand-waved, and it wasn't.

## Scope proportionality: two things I want said out loud, not just absorbed silently

**1. This proposal closes a previously-deferred gap from a different change.** The `session_participants` registration fix (D7) and `DraftSessionHost`'s WebSocket subscription (D3) were both explicitly deferred by `session-lobby-routing-gap`. This proposal pulls both back in as blocking, in-scope work. I understand the logic — a roster that can never show a real first-time joiner isn't a feature, it's a demo — and I'd rather see that argued explicitly than see the team ship a roster that quietly stays empty for every real team. I'm not asking to cut this. I am asking that whoever tracks velocity against the original estimate for *this* change knows that two IOUs from a prior change are riding along in it. That's a sequencing fact, not a scope objection — don't let it get lost when someone asks why this took longer than "add a roster" sounds like it should.

**2. Both surfaces, not one plus a fast-follow.** The proposal explicitly rejects shipping the roster only on `SessionLobbyPage` (where the WebSocket plumbing already exists) and fast-following on `DraftSessionHost`. The reasoning — that `DraftSessionHost` is the page the Facilitator is actually on per the source use case's own flow — is sound, and I'd rather trust the use case than optimize for whichever page happened to be cheaper to build on. But I want to name the alternative that was on the table: ship the cheaper surface first, get one real team using it this week, and land the second surface a few days later. That would have gotten value in front of a user faster, which is the thing I actually care about. If the team judged that a single-surface interim state would look broken or inconsistent enough to undermine trust in the tool, that's a legitimate reason to reject it — I just want that judgment made explicitly by whoever owns the build, not defaulted into "do both" because it's tidier.

Neither of these is a scope cut I'm requesting. They're the kind of thing I'd ask about if someone showed me a burndown three weeks from now and I didn't already have the answer.

## What I'm not going to ask for

I'm not going to ask this proposal to move the needle on my dashboard/trend success criteria — it doesn't, and it isn't supposed to. It sits under my "onboarding experience" and "first session low-friction" concern, not under "trend data visible" or "action item loop closed." Holding it to the wrong bar would be my mistake, not the team's.

I also note the named deferral on blocked/failed joins (an Engineer stuck on a `no-access` screen is invisible to the Facilitator in this change) is stated as a decision for design.md to settle explicitly, not left as an implicit gap. That's the right way to carry a known limitation forward — I don't need it solved here, I need it written down so it doesn't get rediscovered as a surprise.

## Bottom line

Approve. The core scope is proportional to the value — this removes a real adoption blocker with appropriate restraint on what it doesn't try to do. The two absorbed-gap items should be named in the team's own tracking so the schedule story stays honest, and I'd like whoever owns delivery to confirm the two-surface decision was a deliberate call and not the default path.
