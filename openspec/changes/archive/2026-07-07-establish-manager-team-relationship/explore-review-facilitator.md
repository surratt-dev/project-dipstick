# Facilitator Review: Explore Notes — Establish Manager/Team Relationship
**Reviewer:** Priya Nair, Staff Software Engineer / Facilitator
**Date:** 2026-07-06
**Source:** exploration-notes.md

---

## What the Exploration Gets Right

The exploration correctly identifies the foundational purpose of this use case: giving EMs what they need without giving them what they cannot have. Section 1 articulates the ritual logic clearly — read-only historical access, no live session presence — and I agree with the framing. Section 5a's note about doubly-redundant enforcement (both `global_role` and `team_memberships.role` block session participation) is exactly right and should be preserved regardless of how the bootstrapping question is resolved.

The warning against conflating TEAM-005 and TEAM-006 in Section 8 is important. These are easy to mix up, and mixing them up produces real bugs. That distinction belongs prominently in any proposal.

---

## Observations

### 1. The actor conflict is not just a security question — it is a workflow failure for facilitators

Section 3 correctly identifies the Q2 conflict but frames it primarily as an authorization design question. From my side of the table, it is an operational problem with a session clock attached to it.

I am the person who knows which manager belongs with which team. I do this during onboarding. When a team is preparing for their first session, I am the one setting up the context: who facilitates, who participates, which manager has history access. If establishing the EM relationship requires an admin escalation, I lose the ability to complete that setup myself — and more importantly, I lose the ability to confirm it is done before the session starts.

The exploration acknowledges this friction and says the minimum requirement is "a plain-language explanation of why the action is unavailable, plus a contact path to the admin." That is better than a silent failure. But it does not solve the pre-session setup problem. If the admin turnaround is slow, the EM either misses early sessions or the team waits. Neither outcome is acceptable for a ritual that depends on consistent follow-through to build trust.

The exploration says the facilitator rationale is "weaker here" because this use case establishes access for someone never previously on the team. I understand that argument. But the operational reality is that facilitators are the ones doing team setup. If facilitators cannot do this step, the admin becomes a bottleneck in every team onboarding. That cost needs to be weighed alongside the security analysis, not treated as an afterthought.

### 2. There is no facilitator-side confirmation that the EM relationship was established

Once TEAM-006 succeeds, who tells me? The exploration correctly says EMs should not receive in-application notifications (Section 8 — I agree with this). But that discussion says nothing about what the facilitator sees.

When I finish configuring a team for their first session, I need to confirm that the EM relationship is set up. Right now I have no way to do that from within the application. Is the EM listed somewhere on the team view? Is there a confirmation state I can check? If not, I am managing this out of band — which is exactly what the application is supposed to eliminate.

The facilitator control surface must include a visible indicator of the EM associated with each team. "EM: [Name]" or equivalent. If the relationship is not established, the team view should make that visible too — not as an error, but as an incomplete setup state. This is a missing piece of the facilitator UX that the exploration does not surface.

### 3. The multi-team EM landing experience is flagged but not treated as urgent enough

Section 5c and Q5 correctly identify this as an unresolved UX gap. I want to reinforce the severity of it.

I manage three teams. The EMs for those teams sometimes manage more than one team themselves. What an EM sees when they sign in determines whether the tool is usable for them — and it determines how I explain it to them during onboarding. Right now the exploration says this is "a UX gap I want to flag early." I would say it is a design-blocking question for the EM-facing view. Without it answered, I cannot tell an EM what to expect when they first log in.

The exploration defers this to "must be answered before design is written." I agree. But it should be escalated from a deferred question to a prerequisite for the design phase. If it falls through the cracks until implementation, someone will invent an answer without EM input.

### 4. Participants need a way to verify that their manager cannot attend sessions

This is missing entirely from the exploration and from the use case.

When I run a first session with a new team, the moment of highest anxiety is usually when someone asks: "Can our manager see this?" I explain the ritual design — historical aggregate access, not live presence. That explanation currently depends entirely on my credibility and the team trusting me.

The application should let participants verify this themselves. Not a prominent UI element — just something available if they want to look. "Your Engineering Manager has read-only access to session history but cannot join or observe live sessions." That statement, surfaced somewhere in the team view or the session lobby, lets me point to the tool instead of relying on my say-so. It also survives handoffs to new facilitators who haven't built that trust yet.

The exploration builds the enforcement. It does not build the communication surface that makes the enforcement legible to participants. That is a gap.

### 5. The vote attribution constraint needs to be treated as a ritual integrity requirement, not just a spec note

Q3 says individual vote attribution must not be surfaced to EMs and must be a named acceptance criterion. I agree completely. But the exploration frames this as a documentation gap — "the constraint exists in intent but is not named explicitly in any spec."

From where I sit, this is not a documentation gap. It is a ritual integrity requirement that the application must demonstrate before I recommend it to any team. The difference matters: a spec note gets reviewed at proposal time. A demonstrated requirement gets tested.

Before any team goes live with EM history access enabled, I need to be able to verify — with an account in EM role, looking at actual session history — that individual vote attribution is not visible. That is part of the usability testing I have agreed to do. The proposal must include it as an explicit test case in the acceptance criteria, not just as a constraint in the spec prose.

### 6. What does Priya do if the bootstrapping problem is not resolved?

Section 4 makes clear that TEAM-006 is unusable without a path to `global_role = 'engineering_manager'`. I agree, and I support Devon's position that a proposal written without resolving this is a proposal for an unusable feature.

But the exploration does not address what happens to teams in the interim. If a team completes their first session and the EM association cannot be established because the bootstrapping problem is unresolved, what is the fallback? The EM either has no history access, or we revert to sending exports out of band. The exploration should explicitly name this as an interim-state gap and state that teams should not go live until Q1 is resolved — not just that the feature cannot be implemented, but that the feature should not be promised to teams until it works end-to-end.

---

## Questions for the BA and Design Team

**Q-F1.** Is there a facilitator-visible indicator of whether the EM/team relationship has been established for each team I manage? If not, this must be added to the facilitator view scope.

**Q-F2.** When I complete team setup and establish (or confirm) the EM association, is there a moment of confirmation in the tool? Or must I verify this by checking a team detail view separately?

**Q-F3.** If the authorized actor ends up being admin-only, what is the explicit escalation path for facilitators? Is there a button, a form, a contact mechanism built into the tool? "Contact the admin" is insufficient without a clear mechanism.

**Q-F4.** What does the team view look like to participants after the EM relationship is established? Can participants see that an EM is associated with their team? Can they understand what that means — read-only history, no session presence — without asking me?

**Q-F5.** For the multi-team EM landing experience: is a team selector the assumed first design? Has the design team been asked to weigh in, or is this still fully open?

**Q-F6.** When I hand a team off to another facilitator, does the new facilitator see the EM association as part of the team context they inherit? This is the continuity question the exploration does not address.

---

## Suggested Additions to the Proposal

1. **Facilitator-visible EM status in team view.** The team configuration view should show the associated EM (name, not just userId) and indicate whether the association is established. An unestablished state should be visually distinct — not an error, but an incomplete setup indicator.

2. **Participant-facing access model statement.** The team view or session lobby should surface a brief statement of what the EM can and cannot access. This can be simple: "Your Engineering Manager can see session history but cannot join or observe sessions." The goal is participant self-service verification, not a prominent disclosure.

3. **Vote attribution as an explicit test case.** The acceptance criteria must include: "A user with EM access on a team cannot see individual vote attribution in session history views." This should be a testable, demonstrable criterion — not spec prose. I expect to verify this during usability testing.

4. **Named interim-state constraint.** The proposal should explicitly state: "Teams should not be onboarded with EM history access promised until Q1 (global role bootstrapping path) is resolved." This protects teams from being given commitments that cannot be fulfilled.

5. **Multi-team EM landing experience as a design prerequisite.** Elevate Q5 from a flagged gap to a required input before the design phase starts. The product designer should have an answer before wireframes are drawn.

6. **Facilitator handoff context.** The proposal should name as an acceptance criterion that an incoming facilitator can see the EM association for a team they are picking up, without a handoff conversation. This is consistent with the broader continuity goal and directly affects my ability to hand off gracefully.

---

## What Would Make This Disappear Into the Background

The exploration captures the structural dependencies well. What it does not yet capture is the facilitator's operational experience around this feature.

Done right, establishing the EM/team relationship is something I do once per team, confirm in the team view, and never think about again. The EM sees what they need. Participants trust the boundary. I can point to the tool when someone asks how it works. That is the version that disappears into the background.

Done wrong, it becomes something I manage through workarounds: admin escalations before every team onboarding, out-of-band confirmation that the association was set up, and manual reassurance to participants that their manager isn't watching. That is the version that creates friction instead of absorbing it.

The exploration has the technical foundations. The proposal needs the facilitator workflow layer on top of them.
