# Champion Sign-off: fix-local-oidc-login

**Reviewer:** Devon Calloway, Internal Champion / SME
**Date:** 2026-09-16
**Verdict:** Approved. No concerns.

## Ritual-fidelity check

I ran this through the same filter I run everything through: does it touch the no-manager-participation rule, the simultaneous reveal, the facilitator-from-another-team requirement, or the non-comparability of individual data across teams?

No. This is a one-property swap (`request.hostname` → `request.host`) in the OIDC callback handler, fixing a `redirect_uri` port mismatch that broke local sign-in. It's transport-layer plumbing for authentication, nowhere near session mechanics, topic data, or participation rules. None of the load-bearing constraints are implicated, configurable, or even reachable from this code path.

## Scope discipline — this is what I actually care about here

This change is shared dev infrastructure, not ritual mechanics, so my concern isn't fidelity — it's the same "quiet erosion" pattern I flagged in exploration: a broken foundational path that people route around with workarounds until routing around it becomes normal. That's the real risk with infra like this, and the team took it seriously:

- Fixed exactly the one line that was actually broken, with a comment sized to match the existing commenting density in the sibling fix.
- Correctly identified that Bug 2 (the JWKS key) was already fixed as a side effect of `persona-login`, verified it independently against HEAD rather than trusting the issue text, and left it alone — no re-litigating the ephemeral-vs-hardcoded-key question I'd already closed.
- No new configurability introduced. A bug fix in trusted internal dev tooling did not grow a flag.
- Verified end-to-end against the real running stack (not a mock, not a stub) — a real token exchange, a real session, confirmed by a real Postgres row — with an explicit non-pass condition (landing on an error page doesn't count) rather than a vague "looks fine."
- Correctly reasoned that production is unaffected (`trustProxy: 1`, standard-port HTTPS never carries a port in `Host`), so this is genuinely inert outside local dev.

This is exactly the kind of tightly-scoped, boring fix I asked for in exploration: one bug, one line, verified, no scope creep. I don't need to be consulted again on this one.

## Success criteria impact

None of my four success criteria are affected by this change, positively or negatively — it doesn't touch adoption, the trend dashboard, or the no-manager rule. It does support the broader goal indirectly: a team can't adopt the ritual through the application if local dev sign-in doesn't work for the engineers building and testing it.
