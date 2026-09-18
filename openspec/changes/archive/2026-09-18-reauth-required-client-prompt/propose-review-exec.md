# Executive Review — Rachel Okonkwo (VP Engineering)

**Change:** `reauth-required-client-prompt` (issue #32)
**Lens:** Strategic alignment, scope proportionality, process overhead

## Bottom line

Approve. This is a well-bounded fix to a real gap, not a scope-creeping rewrite. The two items I was asked to scrutinize both hold up — one because it reuses an existing bar rather than inventing a new one, the other because it's cheap enough that calling it "scope creep" would be a stretch.

## Strategic alignment

The problem being closed is legitimate and not cosmetic: a connection state that ends unconditionally in ~30 seconds is currently rendered identically to a state that resolves itself. That's not a copy nit, it's a silent-failure risk dressed up as a placeholder string. Fixing it is the kind of small, high-leverage UX correction I want engineering time spent on — it directly protects trust in a flow (reauth) we already shipped and are relying on working correctly. I'd rather see this land than sit open as a known gap someone eventually hits mid-session.

The proposal is also disciplined about *not* doing more than that. No fork of `connectionHealth.ts`, no role-specific branching, no new route, no reveal-aware special casing, explicitly declining several plausible-looking extensions (D6, D7, D8). That restraint is exactly what I look for — it would have been easy to let "let's finally do reauth UX right" balloon into a redesign of the banner system. It didn't. Good.

## Pilot-readiness gate extension (mock sign-off + usability test)

Proportionate, not process for its own sake — with one caveat.

What makes it proportionate: it's not a new bar invented for this change. It's the same gate `websocket-staleness-signal` already set for the sibling banner (issue #36), applied consistently rather than waived here because this change is smaller. If I let teams skip the gate whenever the change *feels* small, the gate stops meaning anything. And the mechanism/role/CTA work is explicitly allowed to ship to staging ahead of the mock (task 4.4/6.6) — the gate blocks *pilot exposure of unvalidated visual treatment*, not engineering progress. That's the right thing to block on: this is the one state in the whole reauth effort where getting the "does a person actually notice this" question wrong means someone gets silently disconnected mid-session. A live usability check earns its keep here.

The caveat: I don't want this precedent read as "every banner copy change now needs a live usability test." It's justified *because* the failure mode is a forced disconnect, not because it's a UI change. If a future, genuinely low-stakes copy tweak gets stalled behind this same ceremony by default, that's the over-engineering pattern I actually worry about. Whoever scopes the next one of these should be asked to justify the gate against the actual risk, not copy-paste it because it's now "how we do banners."

## Vote-loss conditional-disclosure gate (task 1.1/1.2)

Not scope creep. This is a single grep check and a one-line commit note, explicitly deferred to implementation time because the answer depends on a UI that doesn't exist yet — the design is honest that deciding it now would just be guessing. It doesn't build, wire, or design anything; it reads one fact and picks between two pre-written sentences. That's proportionate to a "write better banner copy" change in a way a real dependency on `vote-compose-recovery` landing first would not have been.

The one real risk here isn't scope, it's staleness: the check happens once, and nothing forces a re-check when the vote-compose UI eventually ships. The design names that risk (Risks section) but the mitigation is "we wrote it down," which is thin. I'd want whoever eventually builds vote-compose UI to be told, in that change's own proposal, to come back and re-run this check — not rely on someone remembering this document exists. Worth a line in tasks.md rather than trusting institutional memory.

## Net

Ship it. Scope matches value, the two gates in question are both earning their cost rather than padding it, and the non-goals list shows the team said no to the right things. Only ask: make the D5 re-check a forward-pointing task on the vote-compose UI change itself, not just a paragraph in this one.
