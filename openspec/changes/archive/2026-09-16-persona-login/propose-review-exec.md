# Executive Review — persona-login

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Verdict:** No objection to shipping. One process note for the team to carry forward, not a blocker for this change.

## Strategic alignment

This doesn't move any of my four success criteria, and it isn't supposed to — it's not a product feature, it's a tool for the people building the product. I don't need it to serve the org's adoption goals for the Health Check itself; I need it to not cost more than it's worth and to stay away from the boundaries I *do* care about (team data access, manager read-only enforcement). It does. The proposal is explicit that it's orthogonal to the four load-bearing ritual rules and never touches session/vote/data-access logic — good, that's the right instinct and I don't need to see it re-litigated every time someone touches auth.

One piece is worth calling out favorably rather than flagging as creep: seeding real `global_role` claims for `manager-001`/`admin-001`. That's not login convenience, that's making it possible to actually exercise the manager-exclusion boundary locally instead of trusting an unenforced label. Given how non-negotiable that boundary is for me, I'd rather the team could test it than not. It's minimal — reuses the existing claim-mapping path, no new seed infrastructure — so it's in scope.

## Scope proportionality — this is my actual flag

Twenty-six tasks, a full explore → propose → design → tasks → implement → sync → archive pipeline, an eight-decision design doc with a risk/trade-off table, for a feature that replaces a login form with buttons and adds two claims to a stub account. Nothing here is wrong on the merits — the double-gate reasoning (D2), the fail-open timeout (D3), the "don't put this near the real auth callback" decision (D1) are all sound engineering judgment, and I'd rather see care applied to anything touching `auth.ts`'s neighborhood than not. That's not the problem.

The problem is proportionality. This is internal dev-loop convenience work with zero production behavior change and zero exposure to the boundaries I actually govern. It reads like it went through the same process weight as a change that touches data access controls or team boundaries — which is exactly the category of decision I *am* supposed to be consulted on, and this isn't in that category. I'd rather my team's process instinctively recognize "this can never run in production, touches no shared data, reversible with one revert" as a signal to lighten the pipeline — skip the standalone design doc, fold tasks into fewer buckets — than have every change default to the heaviest available process regardless of blast radius. Not asking for a redo here; asking the team to calibrate next time.

The `oidc-auth` spec delta — formalizing that production's "no interstitial" rule now has a named, double-gated local-dev exception — is the one piece of this I'd want a second look on for a different reason: it's editing a requirement that governs production auth behavior. The change itself just makes an existing, previously-implicit gap explicit rather than introducing a new one, which is the right call — silent contradictions in a spec are worse than documented exceptions. I just want it clear to whoever reviews future changes to that spec that this exception exists and why, so nobody mistakes it for precedent to loosen further.

## Bottom line

Ship it. The engineering judgment in the design doc is good — better than this class of change usually gets. My only ask is a lighter process template for dev-tooling-only changes going forward, so we're not spending review cycles on an eight-decision design doc for something with this little blast radius. That's a process note for the team, not a hold on this proposal.
