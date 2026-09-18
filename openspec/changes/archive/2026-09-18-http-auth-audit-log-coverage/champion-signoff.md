# Champion Sign-off — http-auth-audit-log-coverage

**Reviewer:** Devon Calloway, Principal Software Engineer (Internal Champion / founding advisor)
**Date:** 2026-09-18
**Scope of this review:** Whether this change preserves the Health Check ritual's intent — specifically whether anything in the implementation could introduce session-visible friction or delay, which bears on the "disappears into the background" property I care about, even though this is backend audit infrastructure and not a facilitator-facing mechanic.

## Verdict: Sign-off. No concerns blocking.

## On the three core constraints

Not applicable in any direct way, and I want to say that plainly rather than force a fit. This change touches HTTP auth middleware and the logout route — it does not touch session creation, topic voting, reveal timing, or facilitator assignment. The no-manager-participation rule, the simultaneous reveal, and the facilitator-from-another-team requirement are untouched by this diff, and nothing here makes any of them more configurable, more skippable, or more silent than they already are. I looked for a way this could be a back door into any of the three — a new admin surface, a new toggle, anything that quietly becomes a switch someone flips later — and found none. Proposal.md says as much directly ("No new admin-facing configuration surface, no new interval, no new on/off switch"), and I confirmed it against the actual diff, not just the prose.

## On the question I was actually asked to dig into: session-visible friction

This is the right question to ask of *any* change that sits between a live session and the network, even one that's "just" audit logging. A ritual that works because it disappears can be undone by latency as easily as by a bad UX decision. So I read the design doc's reasoning and then checked it against the shipped code myself rather than taking the design doc's word for it — that's the job.

**Where the new write sits:** all four call sites (`middleware.ts`'s three `onRequest`-hook branches, `auth.ts`'s `/auth/logout` handler) are already-terminating paths — every one of them ends in a 401 or a logout response that was going to happen regardless. I traced this directly in the code (`middleware.ts:172-231`, `auth.ts:422-431`): the new `writeSessionInvalidatedAuditRow` call happens after `session.destroy()` and before the reply is sent, bounded by a single 500ms `withTimeout` that covers both DB round trips together, fails open, and never rethrows. Worst case, a user who's already being logged out or already hit an expired session waits up to half a second longer for the response that was ending their session anyway. That's not nothing, but it's not the kind of friction that would land *during* a Health Check session — a user isn't voting or watching a reveal at the moment their session is being torn down.

**Where it deliberately does NOT sit, which is the more important fact:** `auth.token_refresh_success` — the one event of the three named in the issue that fires on ordinary, successful, mid-session traffic (a vote submission, a reveal trigger, anything an authenticated participant does) — gets no new row and no new DB round trip. I checked this directly: `grep` for `token_refresh_success` in `middleware.ts` shows exactly one hit, the existing structured-log emit, untouched. This is the one place a badly-scoped version of this change could have made the ritual feel like software — a synchronous DB call quietly inserted into the path of every authenticated request, felt as a stutter mid-session with no visible cause. The design explicitly reasoned about this and excluded it for exactly that reason (Decision D1), and the implementation matches. This is the detail I'd have flagged hardest if it had gone the other way, and it didn't.

**On fail-open specifically:** I want to note this is the correct default for this event, and I'd have said so even before reading the design doc. A Postgres blip should never turn into an additional lockout on top of whatever already ended a user's session — and definitely should never be the thing that makes someone stare at a stuck loading spinner mid-retrospective while waiting on an audit write for a session that's already gone. The design got this right, and — more importantly, since I've seen good intentions not survive contact with a diff before — the shipped code matches it: I read `session-invalidation-audit.ts` directly and confirmed the `try/catch` never rethrows, and the existing structured log still fires unconditionally after the write attempt regardless of outcome. Nothing here can turn a Postgres problem into a ritual-visible problem.

## One thing worth naming, not blocking

The 500ms timeout is engineering judgment, not measured production data — the design says so itself, honestly, rather than dressing it up as calibrated. I'm fine with that as shipped, for the same reason the design gives: it's a one-line constant on paths where added latency has no plausible session-visible cost. If it ever turns out wrong in practice, it's a cheap thing to revisit. I don't need it re-litigated now.

## Process note

This is the second HTTP/WS-side gap of this shape to get closed cleanly (following `websocket-connection-reauthorization`), and this one explicitly went and found the fourth call site (`explicit_logout` in `auth.ts`) that the original issue didn't even name, rather than declaring victory on the three that were. That's the instinct I want embedded in how this team ships auth work generally — I'd rather see "we found a gap the ticket didn't mention and closed it" than a narrowly-literal reading of a ticket. Also noted and appreciated: the design corrected its own math when the two-independent-timeouts draft didn't actually add up to the stated bound, instead of just patching the prose to match the wrong number. That's the standard I want this kind of infrastructure work held to.

No escalation needed on my end. Nothing here requires me to be consulted again before this ships — which is exactly how I want infrastructure changes like this to go.

— Devon
