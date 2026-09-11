# Champion Sign-off — websocket-specification (final, post-archive)

**Reviewer:** Devon Calloway, Internal Champion
**Status:** Approved. No blocking concerns.

## Context for this pass

I signed off once already at task 6.1, on the condition that the three pre-reveal-leak invariants cite FR-4.6/FR-4.7 directly rather than resting on my say-so as reviewer. I checked the live spec (`openspec/specs/websocket-specification/spec.md`) — the citations are there, on all three (lines 94, 107, 119: catalog-wide no-leak invariant, reconnection side-door invariant, facilitator elevated-visibility invariant). That's settled and I'm not reopening it.

This pass is the final, holistic one, now that the change is archived and merged into the living spec.

## Did this preserve the ritual's intent?

Yes, and it does more than preserve it — it closes a real gap I'd have been unhappy to find left open. The reveal is the one mechanic the whole ritual depends on being simultaneous and honest, and until this change, nobody was actually measuring that in production; FR-4.6.1 existed on paper and not in the shipped payload. This change fixes that in the same breath it documents it, not as a follow-up ticket. That's the right order of operations and it's the one I'd have pushed for if I'd been asked.

**Simultaneous reveal:** `serverTimestamp` is captured once, at publish time, before fan-out to any pod — not at dispatch time, which would have produced a different value per pod. That correction (design.md D2, caught at design review) mattered; a per-pod timestamp would have quietly broken the one guarantee this field exists to provide. Shipped placement is right.

**No pre-reveal vote leak:** stated as a single catalog-wide invariant, checked against every event in one pass rather than reconstructed per-event. `vote_readiness_update`'s structural exclusion of vote value is confirmed to apply identically to the facilitator's elevated grant — no special-case carve-out for facilitator visibility. Good.

**Reconnection:** explicitly closed as a side door — `session_registration_snapshot` discloses only the connecting participant's own state. This is exactly the kind of mechanism I'd expect someone to eventually get lazy about under reconnection-path pressure, and it's pinned down here.

**No-manager rule / facilitator-from-another-team:** out of scope for this document — it's a wire-protocol and session/topic mechanics spec, not session-creation policy. Correctly unaffected; nothing here touches who can join what role.

**Constraints as structural, not configurable:** the proposal states plainly that nothing in this catalog is configurable. That's the property I care about most across the whole project, and it holds here.

## The deferred and known-gap items

Two `[PREF]` events (`participant.joined`/`left`, live `actionitem.updated`) are spec-and-defer, marked NOT IMPLEMENTED, tied to specific FRs, tracked under issue #91. The cross-recipient delivery-skew measurement (the sibling requirement in `websocket-session-authorization`) was never performed, is marked DEFERRED, and now has a named owner and issue number (#92) instead of sitting as an unowned caveat. That's the accountability structure I've asked for before — a name and a ticket, not a paragraph. Good.

The `observedLatencyMs` upper-bound-validation gap (a participant could script fabricated values to pollute the metric stream) is correctly triaged as non-blocking: it can't leak vote content or enable individual-performance comparison, which are the two things I'd actually block on. Fine to leave as a cheap future improvement.

The open question of whether an SLA violation should ever become facilitator- or session-history-visible is still unresolved, routed to the BA and facilitator SME jointly. That's a real product decision, not a spec gap — I'd want to be consulted if it comes back with an answer that surfaces anything session-timing-adjacent to a facilitator mid-session, since "just monitoring" is a different animal than "visible in the room." Noting it, not blocking on it.

## Does archival change my assessment?

If anything it strengthens it. This document exists because five prior changes each shipped a slice of the real-time layer against scattered proposal/design docs, and no one ever held the full picture up against the BRD at once — that's precisely the fragility I've spent years being the informal fix for. Now that it's merged into `openspec/specs/websocket-specification/spec.md` as the living reference, a team that's never talked to me can trace any event name, old or new, back to the real mechanism, with file and function citations. That's the tool carrying the knowledge instead of me carrying it.

The post-archive refinements (the "Known gaps" section, the concrete `reveal-latency` endpoint detail) are additive only — I diffed the archived delta copy against the live spec and no invariant text was loosened; the additions are grounding detail that makes future drift easier to catch, not harder.

**Approved.** No changes requested.
