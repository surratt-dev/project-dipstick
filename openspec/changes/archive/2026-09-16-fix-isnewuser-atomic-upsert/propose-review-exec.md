# Executive Review — Rachel Okonkwo (VP Engineering)

**Change:** `fix-isnewuser-atomic-upsert`
**Verdict:** Not blocking. Approve if the team believes it's the best use of a cycle right now — but I don't think it is, and I want that judgment made explicitly rather than by default.

## Strategic alignment

This has no adoption story. Nothing in it touches a screen a team lead or engineer will ever see, and it doesn't move any of my four success criteria — session counts, closed-loop action items, trend visibility, or the "does this feel like surveillance" question. That's fine; not everything has to. But it means I can't evaluate this on adoption value at all — only on risk reduction, and the risk it reduces is narrow: today, the only consumer of `isNewUser` is an audit log line, and a duplicate `true` on that line is explicitly called harmless in issue #8 itself. There is no live defect. Nothing is broken for anyone today.

So the entire case for doing this now rests on the second-order argument: institutional memory is a bad place to store a constraint. I agree with that as a general principle. I don't agree it's automatically urgent.

## Is scope proportional to value?

The *ticket* is proportional — I want to say that clearly because it's not automatic. Single file, proven pattern already shipped and reviewed in `teams.ts`, no schema change, no new dependency, no transaction needed, explicit non-goals (no new consumer, `auth.ts` diff must be zero), and a task list that checks itself against scope creep (task 1.4, task 2.4). If this is done, it should be done exactly the way it's scoped here. I have no notes on the design itself.

The question isn't "is this ticket bloated" — it isn't. The question is "why this ticket, this week, ahead of what else is sitting open in the same milestone."

## Sequencing against the rest of "01 - Identity and Access"

I pulled the open issues in this milestone before writing this. Sitting open alongside #8:

- **#18** — WebSocket delivery-time authorization / access control enforcement is not implemented.
- **#2** — potential token content leakage in logs.
- **#3** — audit logger level fix doesn't cover transport-level log filtering.
- **#4, #5, #30** — audit events missing `sourceIp`/`correlationId`, hardcoded `sourceIp`, HTTP-side auth events not landing in `audit_log` at all.

Data access controls are the one thing in this entire project I've called non-negotiable. #18 is that concern, unimplemented, in the same milestone. #2 is a live exposure risk, not a guardrail against a hypothetical future one. Ranked against those, #8 is the least urgent item on this list — it's a race in a flag with one harmless consumer, guarded by a mechanism (the comment + issue) that has, by its own account, worked: no feature has tripped it, and none is proposed here that would.

I'd want #2, #3, and #18 addressed first. If the team has capacity to spare beyond those, fine — but I don't want this one picked because it's cheap and satisfying to close, while a real access-control gap and a log-leakage risk sit untouched in the same milestone.

## On "cheaper to fix now than under pressure of an in-flight feature"

I don't think this framing holds up as written, and I want to name why rather than wave it through.

The guardrail's own stated trigger is: fix this *before* a non-idempotent consumer of `isNewUser` is merged. The proposal itself says no such feature exists and none is proposed here. So there's no in-flight feature creating pressure — the "under pressure" scenario is hypothetical. That's the tell. "Cheaper to fix now than later, under pressure" is true of almost any piece of tech debt at almost any time; it's not a reason to schedule the work today rather than in the sprint where the actual feature shows up. If anything, fixing it *as part of* that future feature's proposal is better than fixing it in isolation now: it gets validated against a real consumer instead of against mocks, and the person adding the non-idempotent side effect is the person best positioned to confirm the fix actually closes the case they're introducing.

I read this as a legitimate-sounding rationalization for doing comfortable, well-understood cleanup work instead of the harder, more urgent items above — not because anyone's being lazy, but because closing a guardrail ticket with a proven pattern is a satisfying unit of work in a way that "audit the OIDC library for token leakage" isn't. That instinct is exactly what I'd expect a strong engineer to have, and exactly what I'd want a lead to redirect.

## Bottom line

- No objection to the design or scope if this gets built.
- Object to the sequencing: this should sit behind #2, #3, and #18 in this milestone, not ahead of or alongside them by default.
- If there's a concrete near-term feature on the roadmap that will consume `isNewUser` non-idempotently, that changes my answer — tell me what it is and I'll treat this as timely, not premature. Absent that, this is optional hardening dressed as urgent guardrail work, and I'd rather see the cycle spent on #2 or #18.
