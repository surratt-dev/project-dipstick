# Executive Review — `facilitator-error-states-e2e`

**Reviewer:** Rachel Okonkwo, VP of Engineering (Executive Stakeholder)
**Scope of this review:** strategic alignment and scope proportionality, not implementation detail. I have not reviewed the fixture SQL, the `describe.skipIf` gating, or the Redis wait-timing mitigation — that's the engineering team's job.

## Verdict

**Approve to proceed, on one condition that isn't about this proposal at all: I want a named owner and a rough date for issue #38 before I let #19 close.** The change itself is disciplined and cheap. My concern is entirely about what happens to the actual user-facing gap once a two-month-old ticket stops showing up on anyone's board.

## Why the scope split is the right call

I went looking for a reason to push the frontend work back into this change, the way I'd push back on any proposal that seemed to be carving out the hard part. I didn't find one. The four — now six, since the proposal is more precise than the ticket — error states genuinely decompose into two different questions: "does the backend produce the right event, over a real database and a real message bus, when a real transition happens?" and "does a facilitator see something sensible on screen when it does?" Those have different owners, different review surfaces, and bundling them would produce exactly the kind of PR I don't want to see — a test-infrastructure diff and a set of new UI components reviewed together, where a reviewer has to context-switch between "is this SQL fixture safe" and "is this the right empty state to show a facilitator mid-session." Splitting them is good hygiene, not scope creep dodging.

I also checked whether this change is honest about what it does and doesn't deliver, because that's where "closing a ticket" and "delivering value" can quietly diverge. It is. The proposal doesn't claim to fix anything — "no production code... changes; they are exercised, not modified" — and it doesn't check task 11.10's box. It leaves the box unchecked with a note explaining exactly what's covered and that #38 is the only change that can complete it. That's the correct instinct: a two-month-old stale checkbox is worse than an honestly-still-open one, but a checkbox marked done on the strength of better tests while the actual facilitator-facing gap remains unbuilt would be worse still. This proposal was clearly written by someone who'd already thought about that trap — it says so explicitly in its own "Why" section.

## Where my concern actually lives

None of this is a knock on the proposal's contents. It's a governance question sitting one level up: **once issue #19 closes, what keeps #38 from losing its forcing function?**

A two-month-old, gate-blocked ticket has visibility precisely because it's been stuck and annoying. The moment it closes — even closed correctly, even with an honest annotation pointing at #38 — it stops being the thing that shows up in a stale-ticket report. #38 is real, scoped, and referenced four separate times in this proposal, which is more diligence than most internal handoffs get. But a well-documented dependency in a proposal I'm reading is not the same thing as a staffed, dated piece of work. I don't have visibility into whether #38 has an owner today. If it doesn't, closing #19 is the moment the actual user-visible improvement — the thing a facilitator or a pilot team would ever notice — quietly loses its only remaining scheduling pressure.

So: before I sign off on treating #19 as done, I want to see #38 assigned and roughly dated, not just filed. If that's already true, this is a non-issue and I'd say so directly rather than hedge. If it isn't, I'd rather this proposal's merge and #38's staffing happen in the same conversation than have #38 sit in backlog picking up the same two months of dust #19 just spent.

One smaller thing worth naming out loud rather than assuming: when issue #19 is closed on GitHub, the closing comment should say plainly that this closes the backend-rigor half only and link forward to #38 — not just close silently. Anyone scanning issue history later (including me) should be able to tell from the issue itself that "closed" here doesn't mean "facilitators can now see these four states."

## What I'd want tracked, not what I'd block on

**The real-infra bug-discovery risk (design.md's third risk) is a feature, not a caveat, and I want it visible if it fires.** If a real Postgres/Redis round trip surfaces a behavior the mocked suite's assumptions missed, that's exactly the "quiet failure before it becomes a crisis" pattern I care most about catching. The design doc already commits to flagging this explicitly rather than silently adjusting the test to match — good. I'd just want that surfaced to me if it happens, not buried in a PR description nobody outside the team reads.

**Cost is proportional, and I don't want it gold-plated.** Test-only, no new CI wiring, one new file following an existing proven pattern (`ws-pubsub-integration.test.ts`), explicit rejection of both a full-file rewrite and a premature shared test-infra abstraction. This is sized right for what it's closing. I wouldn't want to see this grow — for instance, don't let "we found a bug" turn into "so we redesigned the endpoint" inside this change; that's correctly flagged as its own follow-up if it happens.

## Bottom line

The engineering judgment here — real infra over mocks for a claim that says "through the full stack," splitting UI out to avoid a bloated review, leaving the checkbox honestly unchecked — is sound, and I don't want it slowed down waiting on me. My sign-off is conditioned on the organizational follow-through, not the technical content: get #38 a name and a rough date attached before #19 closes, and make sure the closing comment on #19 says what it does and doesn't mean. Do that, and this is exactly the kind of unglamorous, correctly-scoped hygiene work I'd rather see shipped than deferred.
