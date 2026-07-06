# Exploration Review: Assign a Role to a Team Member
**Reviewer:** Priya Nair, Staff Software Engineer / Facilitator
**Date:** 2026-07-06

---

## Framing

Devon's analysis is technically rigorous and I appreciate that it names the ambiguities rather than papering over them. The two-layer role system, the actor conflict, the bootstrapping gap — these are real problems and I am glad they are documented before anyone writes a line of code.

But the exploration approaches this use case entirely from the data model up. The facilitator's operational workflow appears as a single subsection near the end, framed as "not having concerns" beyond vocabulary. That underweights what actually goes wrong in practice. The following observations are intended to fill that gap.

---

## Observations

**1. "Backstage infrastructure" is accurate most of the time, and wrong at exactly the moments that matter.**

Devon correctly notes that member management runs before the session, not during it. That is true in the steady state. It is not true when a new team member joined via the invite link an hour before the session, received the default `participant` role, and is actually the team's Engineering Manager. Or when I am facilitating a first session for a new team and the role state is completely unconfigured. These are not edge cases in practice — they are first-session realities. The exploration should model the role correction workflow under session-start time pressure, not just the calm pre-session scenario.

**2. The "who can assign roles" conflict is not only a security question — it is a session-continuity question.**

Devon correctly identifies Q1 as blocking. But the framing focuses on the architectural resolution. What the exploration does not address: if the resolution is "only admins and EMs can assign roles," what is the facilitator's path when she discovers a misconfigured role at session start? There is currently no description of an in-app escalation mechanism. Out-of-band escalation (Slack the admin, wait for them to log in) is a real workflow gap that will disrupt sessions and discourage adoption. The resolution of Q1 must specify not just who holds the permission, but what the facilitator sees and can do when she does not.

**3. The member management view has no described "ready to run a session" signal.**

Section 7 describes confirmation messages and vocabulary. What it does not describe is what the facilitator sees in the member list that tells her the team is correctly configured before a session can begin. Specifically: can she see, at a glance, whether the team has at least one participant-role member? Whether an EM is correctly designated and will therefore not appear in the voting list? Whether the facilitator constraint holds? The member management view should read as a pre-flight check, not just as a list with role selectors. The exploration does not address what information is visible to support that check.

**4. The "team with no engineers" warning is scoped only to the role change action. It should also fire at session initiation.**

Devon correctly argues the application should warn (not block) when a role change leaves no participant-role members. I agree. But the warning must also fire when a facilitator attempts to initiate a session for a team in that state — at that moment, blocking is appropriate. A session with zero voting participants is not a degraded session; it is not a session. The exploration does not connect the role-state warning to the session-start check. These need to be linked explicitly, or a developer will implement the warning correctly and miss the initiation guard.

**5. The mid-session role change scenario is missing the facilitator's perspective.**

Section 6d describes the behavior correctly from a data integrity standpoint: the role change takes effect on the next API request, locked-in votes are not invalidated. But it does not address what I see. If a participant's role is changed from Engineer to Engineering Manager while a session is live — by an admin acting in another browser tab, or by another facilitator managing team membership — does the readiness grid in my facilitator view reflect that change? Does a participant indicator disappear? Does the vote count at reveal change? I need the answer to be deterministic and visible, not just technically correct at the database level.

**6. The bootstrapping problem is an onboarding friction problem, not only a deployment concern.**

Devon frames the bootstrapping problem (Q3) as a question for deployment documentation. That is correct. But it is also a question I face when I am sitting with a new team in a room and someone asks how the application was set up and who configured the roles. If the honest answer is "a DBA ran a migration script," I have lost the room. The exploration should acknowledge the facilitator-facing experience of first-time team setup and specify what I can show the team about how their configuration was established.

**7. Role change history visibility for incoming facilitators is not addressed.**

One of my explicit requirements is that an incoming facilitator — someone picking up a team they have not facilitated before — can establish context from the application without a handoff conversation. Session history and trend data support this. Role history does not, currently. The exploration establishes that role changes must be audited (section 8), but it does not address whether that audit log is visible to facilitators. When I take over a team, I want to know whether roles have been recently changed, who changed them, and whether any changes are unusual. Without this, the audit log serves compliance but not operational context.

**8. The vocabulary concern is correct but not complete.**

Devon is right that "Engineer" and "Engineering Manager" must be shown in the UI, not "participant" and "engineering_manager." I would add: the role selector must also convey what each role means for that person's experience of sessions. "Engineering Manager" is not self-explanatory to a new team member who does not yet know what EMs do in this ritual. A brief, inline description — "can view session history; will not vote" — would reduce first-session confusion without requiring a separate tutorial.

---

## Questions

**Q-F1. If the Q1 resolution is admin-only role assignment, what does a facilitator see when she needs a role changed?**

Is there an in-app path to request a change? Or is the facilitator expected to reach out to an admin out-of-band? If it is the latter, the application should at minimum indicate who the admin is and that they should be contacted. An opaque "403 Forbidden" or a grayed-out role selector with no explanation is a session-disrupting dead end.

**Q-F2. Does the readiness grid update in real time when a role changes during an active session?**

If someone is removed from the expected voter set because their role was changed while a session was live, I need my facilitator view to reflect that. Does the grid rerender? Does the vote count denominator change? This is not a data integrity question — it is a facilitator control surface question.

**Q-F3. Is a session for a team with no participant-role members blocked at initiation, not just warned at role change time?**

The exploration addresses the warning. I want to confirm: can I accidentally start a session for a team with zero engineers? If yes, what happens at voting time? If no, what does the session-start error say?

**Q-F4. When a new team is being onboarded and no roles have been configured yet, what does the member management view show?**

If everyone defaults to `participant` on join, the view might look correct (a list of engineers) but not have the EM designated. Is there any indication that the EM field is unset? Is there a "no EM assigned" state that is visually distinguishable from "EM assigned"?

**Q-F5. Can an incoming facilitator view role change history for a team?**

Not the full audit log with timestamps and actor identities — I understand that may be admin-level access. But can I see "last changed X days ago" or "no changes since team was created"? Enough to know whether the current role state reflects current team reality or was set up a long time ago and may be stale.

---

## Suggested Additions

**1. Add a pre-session role verification workflow to the UX section.**

Describe what the facilitator does, sees, and acts on when she opens the member management view before a session. This does not need to be a full UX spec — a brief workflow description is enough. The goal is to establish that the view is designed for pre-session verification, not just ad hoc role editing.

**2. Specify the facilitator's escalation path for the admin-only resolution of Q1.**

If role assignment is restricted to admins, the exploration must name this as a UX gap and propose a resolution. Options include: in-app role-change request; surfacing admin contact in the member management view; or acknowledging that this will require out-of-band coordination and documenting that dependency. Leaving it unstated means it will be discovered in the first real session.

**3. Connect the "no engineers" warning to the session-initiation guard.**

Add an explicit note that the session-initiation flow must check for at least one participant-role member on the team, and return a specific, actionable error if none exist. This check is different from the role-change warning and must be implemented independently.

**4. Address what the facilitator sees during a mid-session role change.**

Section 6d handles data integrity. Add a companion note about the facilitator view: does the readiness grid update? Does the expected voter count change? The facilitator must not be left with a stale control surface while the underlying data has changed.

**5. Address role change history visibility as part of the facilitator handoff story.**

The exploration mentions audit logs for compliance. Add a note about whether any summarized role history is surfaced to facilitators, and how this supports the "incoming facilitator establishes context without a handoff conversation" requirement. If the answer is "audit logs are admin-only," that should be a documented decision, not an omission.

**6. Add descriptive text to role options in the role selector.**

Recommend that each role option in the member management view include a brief consequence summary ("will not vote; can view session history") rather than just a label. This reduces facilitator errors on first-session teams who have not internalized the role meanings yet.

---

## Summary Assessment

The exploration correctly identifies the blocking issues and does not understate the ambiguity. My concern is that the facilitator operational workflow — the circumstances under which role assignment actually happens, and the failure modes that will disrupt sessions — is treated as secondary to the data model questions. It should be co-primary. The data model questions determine whether the feature is correct. The operational workflow questions determine whether the feature is usable under the conditions where it matters most: time pressure, first sessions, and handoffs between facilitators. Both need to be answered before the proposal is written.
