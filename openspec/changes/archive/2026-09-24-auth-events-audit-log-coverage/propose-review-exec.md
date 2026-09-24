# Executive Review — auth-events-audit-log-coverage

**Reviewer:** Rachel Okonkwo, VP Engineering
**Focus:** Strategic alignment — adoption goals, scope proportionality, scope creep, priority sequencing
**Verdict:** Conditional go. Scope discipline is genuinely good. I have one hard question on D3 before this ships, and one standing question about sequencing that I want an honest answer to, not a reflexive "it's cheap so we did it."

---

## What I read this as

This isn't a Health Check feature. It doesn't move any of my four success criteria — no team gets closer to six completed sessions, no action item gets tracked, no trend becomes visible, no engineer's trust in the tool changes because of this work. It's a durability upgrade to the auth layer's forensic trail: seven `emitAuditEvent` call sites that currently only produce a log line get a real `audit_log` row instead. I want to be clear-eyed that I'm reviewing this as *infrastructure hygiene*, not *product progress*, because the proposal itself is honest about that (no new capability, no new admin surface), and my review should be too.

## What's actually good here

- **The scope is disciplined, not padded.** Eleven candidate events, seven get a row, four are explicitly deferred with a tracked issue rather than a silent Non-Goals bullet. That's the opposite of the "ship every feature before anyone uses it" pattern I've flagged before. I'd rather see this shape of scoping discipline than a team that either gold-plates or hand-waves a Non-Goals list nobody re-reads.
- **It touches something I actually care about.** `auth.role_claim_mapped` gaining a `previousRole` field is the durable record that lets someone answer, two years from now, "did an EM's role ever get misapplied, and when." My own non-negotiable is that EMs get read-only access and never participate in sessions — if that boundary is ever violated, I want it reconstructible, not dependent on someone having thought to diff two log lines at the right moment. That's a real, if narrow, tie to organizational-policy scope I'm supposed to be consulted on. Good that it's named explicitly rather than buried.
- **No new toggle, no new interval, no new admin surface.** I don't have to worry about this becoming a second axis of configuration surface someone has to maintain.

## Where I'm not comfortable yet

**1. Decision D3's trade-off lands exactly on the friction point I've told this team to protect.**

The design is honest that coupling the audit write to the domain write means an `audit_log` outage takes down login, account creation, and join redemption outright — not just the administrative actions the precedent (`team.manager_established`) accepted this cost for. Read that against my own standing ask: *ship something usable to a first team quickly, and make the first session low-friction.* First-session onboarding is OIDC login plus learning the ritual, at the exact moment a team's champion is trying to get skeptical teammates to try this thing. If `audit_log` has a bad five minutes on the day team four is trying its first session, new users can't create accounts, existing users can't log in, and nobody can redeem a join link. That's not a hypothetical edge case — it's the literal failure mode of the tradeoff being made, stated in the design's own words.

The design's answer is "accepted, not mitigated, because `team.manager_established` already established this precedent." I don't think that's sufficient by itself. `team.manager_established` is a bounded, rare, EM-initiated administrative action — if it's briefly unavailable, one EM notices. Login and account creation being unavailable is every user, every time, including the exact first-touch moment I've said matters most for adoption. Precedent for *a* coupled-fate decision isn't the same as precedent for *this* coupled-fate decision at this blast radius.

**What I want before this ships:** an honest answer to "how reliable is `audit_log` today, actually" — not a guess. If nobody can tell me `audit_log`'s uptime history because there's no monitoring on it yet (which, given `docs/deployment.md`'s own admission that no log transport is configured anywhere in this codebase, wouldn't surprise me), then we're accepting a new login-blocking failure mode against an unknown probability. That's a scope decision with organizational-policy-adjacent consequences (it can visibly break the tool for a team mid-adoption), which is exactly the category I expect to be looped in on before it ships, not after an incident.

**2. No external forcing function, and the proposal says so itself.** "There is no scheduled security review or customer gate forcing this... it's being picked up because it's cheaper to close now than to let a fourth exploration re-derive the same call-site inventory." I don't hold that against the team's honesty — I'd rather hear that plainly than have it dressed up as urgent. But it means this is competing for engineering cycles against work that *does* move my success criteria (the champion onboarding experience, the trend dashboard, outlier detection), on a self-generated schedule rather than a real deadline. I'm not blocking on this — the proposal is small — but I want confirmation this isn't quietly becoming the team's default place to spend time between product asks, especially given this is the third installment in a chain (#27 → #30 → #132) that has now spawned a fourth (#156). Three completed hops and a fourth queued up, all in the same two files, is the shape of thing that's each individually cheap and collectively a recurring tax. I want this closed out — #156 actually resolved one way or the other — not perpetually re-deferred a fifth time.

**3. Minor: the transactional-write latency addition.** Four writes join an existing transaction, three get a new bounded round trip on already-terminating paths. The proposal says this doesn't touch any pre-auth or hot in-session path, which is the right instinct. I'm not worried about this one — flagging only because "bounded" still means "slower," and login latency is a first-impression cost during exactly the onboarding window I care about. Sounds like it was already thought through; no action needed unless the 500ms bound turns out to be optimistic in practice.

## Bottom line

Proportional in size, honest about its own trade-offs, and it doesn't compete with the roadmap in any way that alarms me on cost alone. What I'm not willing to wave through silently is D3's blast radius — an audit-log hiccup should not be able to lock a new team out of trying the product on day one. I want a real answer on `audit_log`'s operational reliability (or a monitoring commitment that closes that gap) before this merges, not after the first team hits it. Everything else here is the kind of small, well-bounded, well-documented work I'd rather see more of, not less.
