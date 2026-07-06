# Executive Review — Assign Role to Team Member
**Reviewer:** Rachel Okonkwo, VP Engineering
**Date:** 2026-07-06

---

## Overall Assessment

This change is the right one to build next. I am approving it with one conditional: the Q1 decision must be made correctly, and I have a view on it.

The "Why" section says something I want to reinforce before we go further: role assignment is not a configuration detail. The no-manager participation rule is one of the two or three properties of this tool that I will defend to the CTO if anyone pushes back on them. If an Engineering Manager can be miscategorized as a participant — because no one ever set their role — that rule is a fiction. This change closes that gap. It is foundational and it belongs in this sequence.

---

## Strategic Alignment

Strong. The proposal correctly treats EM designation as a prerequisite to any meaningful session enforcement, not as a feature to build "eventually." I would have flagged it as a blocker if it weren't in the near-term plan.

The scope boundary is appropriate. Removing Facilitator designation from this change is the right call. Trying to solve both EM assignment and Facilitator provisioning in one change is how we end up with a six-week cycle before any team can run a session. Keep them separate.

---

## The Q1 Decision: Who Can Assign Roles

This is the part of the proposal that requires my input, and I want to be direct about where I land.

**The question in plain terms:** When a new team member needs their role updated before a session — say, the Engineering Manager joined via the team link and was assigned "Engineer" by default — who is allowed to make that correction?

Option A says: only an Application Admin or an existing Engineering Manager for that team.
Option B says: the Facilitator visiting from another team can also do it.
Option C says: anyone can. (Not seriously on the table.)

**My position: Option A, but only with the escalation path built into this change.**

Here is my reasoning, and it is not primarily a security argument — it is an organizational one.

Engineering Manager designation grants read access to a team's full session history. That is sensitive data. The decision about who holds that designation for a team should be a deliberate act by someone with an ongoing stake in that team — an existing EM or an admin with organizational authority. A visiting Facilitator does not have that stake. Facilitators are operational stewards of the session; they should not be the mechanism through which we grant standing data access to people. Option B creates a shortcut that undermines the data access model I care most about.

Devon's security framing of this is correct — it calls Option B a privilege escalation risk. I agree. But even without the security label, it is the wrong organizational model.

What makes Option A viable is the escalation UX. If a Facilitator arrives at a team's member management view and sees a grayed-out control with no explanation and no path forward, that Facilitator will not recommend this tool. The proposal acknowledges this clearly and specifies the minimum requirement: the view must display who the admin is and provide an in-app path to contact them. That is not optional. If the team scopes Option A without the escalation UX, I want to know before implementation starts — not after.

**I am signing off on Option A with the escalation UX built in this change.** The BA and security analyst should document this resolution in the use case and API contract before any implementation work begins.

---

## Adoption Risk I Need Named Before We Close This

The proposal notes that bootstrapping — how the first Application Admin and first Facilitator accounts are provisioned — is out of scope and deferred. I understand why it is deferred. I need it to not be invisibly deferred.

Here is the adoption sequence as I understand it: a new team wants to use this tool. Someone joins via a link, lands as a Participant. They need an Engineering Manager designated. Under Option A, that requires an Application Admin. But if no Application Admin exists yet — because bootstrapping is deferred — we are at a standstill before the first session.

I am not asking to solve bootstrapping in this change. I am asking for two things: first, the deferral artifact the proposal mentions must name a specific owner and a target date, not just "to be addressed." Second, I want the team to confirm that early adopter teams will have a provisioned admin before they try to run their first session, even if that means a manual seed step in the short term. The adoption risk here is that we hand this tool to a team that cannot configure it.

---

## Scope and Proportionality

The scope is proportional. The new capability is narrow and well-bounded. The modifications to session-participation enforcement are correctly called out as a prerequisite rather than an afterthought. The audit logging requirement is appropriate given what we are changing — EM designation is a consequential act and should have a complete trail.

I have no scope concerns. The out-of-scope list is the right list.

---

## Summary of Actions Required

1. **Q1 decision:** Document resolution as Option A with escalation UX. BA and security analyst must sign off and update use case and API contract before implementation begins. I am providing executive sign-off on this direction.

2. **Bootstrapping deferral:** Assign a named owner and target date for the bootstrapping follow-on. Confirm that early adopter teams will have an admin provisioned before their first session attempt — even via a manual interim process.

3. **Escalation UX is a hard requirement for Option A:** The member management view must surface the admin contact and an in-app message path for Facilitators who cannot edit roles. This is not a "nice to have." If it ships without this, Option A is not viable and we have undermined our own adoption goals.

These are the conditions for my full approval. The change can proceed to implementation planning once Q1 is resolved and documented.
