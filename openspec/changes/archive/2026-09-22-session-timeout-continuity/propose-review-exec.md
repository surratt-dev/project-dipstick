# Executive Review: session-timeout-continuity

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Reviewing:** proposal.md, design.md, tasks.md (issue #133)
**Lens:** Strategic alignment to adoption goals; is scope proportional to value?

## Bottom line

Approve. This is the follow-on I asked for by name in my `http-auth-audit-log-coverage` review — "that follow-on issue is more adoption-relevant than the change we're approving today" — and I'm glad to see it show up with an owner, a design, and a bounded scope rather than sitting nameless at the bottom of a backlog. This is the right work at the right time.

## Strategic alignment

This is squarely an adoption feature, not hygiene. A facilitator or participant who ages out mid-session today doesn't get logged out cleanly — they get stuck retrying forever, staring at a connection that looks broken rather than expired, with no path back into the room even if they notice and re-login by hand. That is precisely the kind of felt interruption that makes a team's second or third session feel less safe than the first, and it's invisible to me until someone complains. Fixing it protects the ritual's felt reliability, which is upstream of my "three teams, six sessions" criterion, not a compliance box next to it.

I also want to note what this change resists doing: it reuses the SEC-26 `reauth-required` prompt and state machine wholesale rather than inventing a new one, and it explicitly declines to build a pre-expiry warning or HTTP-side parity as part of this change. That is the discipline I keep asking for, applied to a change that actually moves the adoption needle — better than getting it applied only to the low-stakes audit-logging ticket.

## Scope proportionality

The code surface is larger than the audit-logging change (four call sites there; here it's a close-code constant, an OIDC state round-trip, a copy conditional, and a new one-bit broadcast), but it's still tightly bounded, and importantly it's bounded to what SEC-26 and `join-link` already built — everything here is described as reuse of an existing pattern, not new mechanism. I don't see scope creep. The two BREAKING spec reversals (disclosure symmetry, role-blind copy) are the kind of thing I want written down carefully rather than discovered later, so the weight of design.md's decision log here is earned, not process-for-its-own-sake the way I flagged last time.

## On splitting out OR-1.7 state-restoration

I think this is the right call, and I don't read it as under-scoping the risk I care about. The reason is structural, not a judgment call this team is making to save time: `SessionConnectionHost.tsx`/`FacilitatorConnectionHost.tsx` — the live-voting UI a restored topic position or vote state would need to rejoin a user *into* — are explicitly stubbed and don't exist yet. There is no UI to restore state into. Building "restore vote state" against a host component that doesn't render votes yet would mean building speculative plumbing for a screen nobody can see, which is exactly the over-engineering-delays-value failure mode I've asked teams to avoid.

What matters to me is whether the *interim* experience is good enough to protect trust until that UI exists, and I think it clears the bar: nobody sits stuck in an infinite retry loop, the CTA lands them back in the actual room instead of a generic team page, and — the detail I like most — participants now get a quiet "facilitator reconnecting" signal instead of silence they have to interpret as "stuck" on their own. Losing an unsubmitted vote or topic position on a rare 90-minute-boundary reconnect is a real but bounded cost; being unable to tell a stall from a hang at all was the bigger trust risk, and that's the one this change actually kills. I'd flag it as under-scoping only if the deferred piece were cheap and being skipped for convenience — it isn't; it's blocked on infrastructure that doesn't exist.

One thing I do want tracked, not blocking: the design doc's own open question about whether HTTP-side 401 handling needs equivalent treatment is left for "a future reviewer" to decide explicitly. I'd rather that get a real answer — even if the answer is "not yet, here's why" — before this is treated as fully closing the continuity gap, since a session that runs partly over HTTP polling today could still strand someone the WebSocket fix doesn't reach.

## Decision

Approved to proceed as scoped. No changes requested. Confirm at close that the HTTP-side open question gets an explicit answer (follow-up issue or documented non-issue), not left implicit.

— Rachel Okonkwo, VP Engineering
