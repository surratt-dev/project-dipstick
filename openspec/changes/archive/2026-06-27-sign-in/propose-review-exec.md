# Executive Stakeholder Review — Sign-In Change

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Date:** 2026-06-25
**Verdict:** Approved with observations

---

## Strategic Alignment

This change is correctly prioritized. Nothing else in the application matters until people can get through the door. The proposal understands this — the framing around "there is no second chance at a first impression" is exactly right. The join-link-through-authentication flow is the adoption path. If an engineer clicks a link from their facilitator and ends up confused, stalled, or staring at an error, we have lost that engineer's goodwill before the ritual has had a chance to prove itself.

The proposal also correctly identifies that sign-in is not just plumbing — it is the mechanism that makes the no-human-intervention onboarding promise from the BRD real. A facilitator shares a link, the engineer lands in the team, ready to go. That is the experience I need for the initial rollout teams.

## Scope Assessment

35 tasks across 9 groups for authentication and onboarding is a significant investment. I want to be direct about whether it is justified.

**Justified scope:**
- OIDC flow, token validation, session management — this is table stakes and non-negotiable. SEC-1 through SEC-6 require it. Cutting corners here is not an option.
- Join-link-through-authentication with destination preservation — this is the adoption path. It must work seamlessly on the first try. The `state` parameter handling, the session-aware landing — these are what make the difference between "click and you're in" and "click and figure it out."
- The no-team landing page — this is a small thing that matters. An engineer who authenticates but has no team needs to understand immediately what to do next. No empty dashboards, no confusion. Good call including this.
- The simulated OIDC provider for local development — NFR-AUTH-002 requires it, and I do not want the team blocked on an identity provider integration to start building everything else.

**Areas I want the team to watch for scope creep:**
- The 90-minute sliding window refresh is required (NFR-AUTH-005), but the implementation should be straightforward. If this is consuming disproportionate effort relative to the other tasks, flag it early.
- "Batch arrival handling" for 10+ concurrent join-link-through-auth flows — I understand why this matters (a facilitator shares a link in a team channel, everyone clicks at once), but I want to know whether the concurrency work here is engineering time well spent at this stage or whether it can be validated with a smaller threshold initially and hardened later.
- The in-transit loading state (branded, non-blank pages during redirects) is a nice touch for polish, but if it threatens the timeline, it is the first thing I would defer. A brief blank screen during a redirect is not what kills adoption. A broken join flow is.

## Risks to the Broader Initiative

**One risk I do not see addressed:** What happens when the identity provider is not yet configured in a deployed environment? The proposal covers the simulated provider for local development, but the first real deployment — the one where I put this in front of three teams — requires a real OIDC provider. The proposal should acknowledge the dependency on the identity team or infrastructure team to have a provider configured and registered. If that is not ready when the application is ready, we are blocked.

**The access model is correctly scoped.** The proposal does not attempt to implement the full role model (Participant, Facilitator, EM, Admin) in this change. It creates accounts from identity assertions and handles team membership through join links. The role enforcement comes later. This is the right sequencing — get people in the door first, enforce the rules once they are inside.

## Positioning for Initial Rollout

This change, if built as proposed, gives me what I need for the first rollout: a way for a facilitator to create a team, generate a join link, share it, and have engineers land authenticated and enrolled. That is the minimum viable adoption path.

I would ask the team to confirm one thing: after this change ships, what is the next thing that must be built before I can put a real team in front of the application? If the answer is "live voting," then we have the right sequencing. If the answer is "three more infrastructure changes," I want to know now.

## Decision

Approved. The investment is proportional to the value. This is the front door, and the front door must work. Build it, keep the scope honest, and flag the OIDC provider dependency for the deployment environment early.

---

*Rachel Okonkwo, VP of Engineering*
