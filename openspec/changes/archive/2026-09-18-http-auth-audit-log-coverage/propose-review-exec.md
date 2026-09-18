# Executive Review: http-auth-audit-log-coverage

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Reviewing:** proposal.md, design.md, tasks.md (issue #30)
**Lens:** Strategic alignment to adoption goals; is scope proportional to value?

## Bottom line

Approve. This is a well-bounded, low-risk change and the team should ship it. But I want to be honest about what kind of value it is, because it isn't the kind that gets us to three teams and six sessions, and I don't want us quietly treating "closed a clean, well-defined ticket" as equivalent to "moved the product forward." Two things below I want an answer to before I stop thinking about this — not because they should block shipping, but because they tell me something about how we're sequencing work right now.

## Strategic alignment

I'll say plainly what this is: it's compliance hygiene, not an adoption feature. Nobody signs up for a second Health Check session because `auth.session_invalidated` now writes a Postgres row instead of just a log line. My own success criteria — three teams at six-plus sessions, a closed-loop action item, a trend I wouldn't have otherwise seen, zero "this feels like surveillance" complaints — aren't touched by this change in either direction.

That's fine, as far as it goes. SEC-12/13 aren't optional — they're in the BRD, and "we can't reconstruct what happened to a user's session during an incident" is exactly the kind of gap that turns into a very bad afternoon later, and potentially into a blocked rollout if a team's security function ever asks us to show our audit trail before they'll let their engineers put real morale data into this tool. I said in my own notes that I care about keeping data inside our infrastructure and not looking like surveillance — a durable, tamper-resistant record of who authenticated and when is part of *earning* that trust with a skeptical security reviewer, not just an engineering nicety. So I'm not against doing this work. I want it correctly labeled: this is infrastructure that protects the option to adopt at scale later, not a lever that pulls adoption forward now.

**Ask:** is there an actual gate this clears — a specific team or a security review on the calendar that needs this — or are we doing it now because the ticket was well-defined and ready, not because it's this quarter's highest-leverage use of the same engineer's time? If it's the latter, say so and I'll live with it; I'd just rather hear "we picked the clean ticket" than have it dressed up as more urgent than it is.

## Scope proportionality — the code change is disciplined; the process around it is heavier than the change

The thing I actually want to praise: this proposal does exactly what I keep asking teams to do. It closes one named, specific gap (four call sites, one event), explicitly declines to also fix `token_refresh_failure` and `token_refresh_success` with real, stated reasons instead of "let's be consistent," and pushes three adjacent gaps — the much bigger `auth.ts`/`join-links.ts` gap, the token-rotation risk (#34), the WS sweep's unhandled-rejection gap — into their own follow-on issues instead of absorbing them here. No schema migration, no new config surface, no new toggle. That is a team that knows how to say no to its own scope creep, and I don't want that discipline to go unnoticed just because I'm raising other questions.

The thing I want us to notice about ourselves: the documentation for this change is now several times longer than the code it describes — an exploration doc, two exploration reviews, a design doc with seven numbered decisions and named alternatives-considered, a proposal, and now this review. The change itself is: an INSERT at four call sites, wrapped in a timeout and a try/catch, reusing an existing helper. I'm not saying the reasoning in design.md is wrong — it's actually good, careful reasoning, and I'd rather have it written down once than re-litigated in a PR comment thread six months from now. But I want someone to have their eye on whether our process is scaling proportionally to the size of the changes going through it. A four-call-site instrumentation fix generating this much artifact is itself a scope-proportionality question, just at the process layer instead of the code layer. If this is what it costs us to ship *every* small, well-scoped backend fix, that's a throughput problem I'd rather catch now than discover in a quarter where we needed to move faster.

**Ask:** rough order of magnitude — how much calendar time, across however many people touched exploration notes through this proposal, did this ticket consume end to end? I'm not asking to grade anyone's work; I'm asking because if the answer surprises us, that's worth a conversation about how we scope process for tickets of this size, separate from whether we approve this one.

## One sequencing flag from the facilitator review

I read Priya's review of the exploration notes, not just this proposal. She flagged that the 90-minute absolute session timeout could force-log-out a facilitator or participant mid-Health-Check session — a real, felt interruption to the ritual, which is exactly the kind of thing that erodes the trust I care most about protecting. This proposal correctly declines to solve that here (it's a UX/session-continuity question, not an audit-logging one) and names it as a follow-on issue. I agree with keeping it out of this change.

But I'll note the asymmetry: that follow-on issue is more adoption-relevant than the change we're approving today, and it's the one being waved through as "worth its own future issue" with no owner or timeframe attached, while the less adoption-relevant audit-logging work gets a fully staffed proposal. I don't need it fixed in this change. I do want tasks.md's item 5.3 — filing that follow-on issue — to actually happen at close, with enough specificity that it doesn't quietly sit at the bottom of a backlog. If a facilitator gets kicked out of a live session before we've even looked at that problem, that's the kind of thing that shows up in my inbox as a complaint, not a ticket.

## Decision

Approved to proceed as scoped. No changes requested to the technical design — that's not my lens and the team clearly did the work. I want a one-line answer to the "why now" question above, and confirmation that the session-continuity follow-on gets filed with real specificity, not just named in a doc.

— Rachel Okonkwo, VP Engineering
