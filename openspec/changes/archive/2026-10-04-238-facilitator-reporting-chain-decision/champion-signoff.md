Verdict: SIGN-OFF

# Champion sign-off: #238 Facilitator Reporting Chain

**Reviewer:** Devon Calloway (Internal Champion, persona review). Date: 2026-10-04.
**Read:** the archived change artifacts (proposal, design, decision log rows 1-24), `requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`, and follow-up issues #240 (draft takeover) and #241 (conflict rule).

This is a persona review. It is input to the pipeline. It is not the human VP of Engineering acknowledgment, which 01c correctly still lists as pending.

## Ritual intent

The change keeps what the ritual is for. "Not in the team's reporting chain" exists so that nobody with line authority sits in the facilitator's seat. The rule fails toward restriction. A person sent both `engineering_manager` and `facilitator` loses the ability to run sessions. They do not gain it. 01c §4 says outright that the ritual has no "manager who also facilitates" profile. I agree, and that is the right framing. Nothing in this change is an admin toggle. #241's scope freeze rules out toggles explicitly, so none of the constraints becomes configurable.

## Core constraints

| Constraint | Status | Basis |
|---|---|---|
| No-manager rule | **Strengthened** | The `global_role` check is back as a second line of defence beside `team_memberships`. A user with the conflict can no longer open rooms on any team, including skip-level and sibling teams. Draft-based team-content access now needs a live `facilitator` role (row 18). Takeover refuses a caller resolved to `engineering_manager` (#240 AC 2). |
| Simultaneous reveal | **Unaffected** | Sessions past room-open stay with their facilitator (#235 Decision 12, row 11). The conflict rule never interrupts a live session, and the notice never appears on a live-session route. Takeover applies to `draft` only. Leaving a session alone between lock-in and reveal is the right call. |
| Facilitator from another team | **Preserved** | A takeover taker must have a live `facilitator` role and no active membership on the draft's team (FR-2.2 [HARD]), checked inside the takeover transaction. Takeover cannot become a way around the cross-team rule. |

## Draft takeover (any draft, any facilitator): trust and preparation

**Already tracked as open questions in #240.** These belong to #240's design review and do not block this sign-off:
- Notifying the previous owner (Q1). This matters most for facilitator trust. A peer can take over a colleague's *active* preparation, not only a stranded draft. I strongly back the Security recommendation of at least an in-app notice. The confirmation prompt guards against mistakes, not bad faith.
- Confirmation copy: whether it names the current owner and what it says about handing over their preparation (Q3).
- The entry point, and stopping the 409 from revealing who is preparing which team (Q2).
- Whether the 24-hour window resets for the taker. This decides whether the taker gets real preparation time with the team's action items and trends (Q4).
- Auditing refused takeover attempts (Q6).

**No genuine unresolved concerns.** On the points that bear on the ritual:
- Takeover gives a facilitator no access they don't already have. Any eligible facilitator can already create a draft for a team that has none, and that grants the same pre-room access. Takeover only removes the single-slot wedge. The access path itself is not new.
- Every takeover is confirmed and audited, it fails closed, and it is atomic (compare-and-set). The decided parts are enough for me to accept "any draft" as the product owner's call.

**Non-blocking suggestions for #240's design review.** Neither is a blocker:
1. Repeated back-and-forth takeovers between two facilitators on one draft are possible. The audit and owner notice would show this. Consider whether it needs anything beyond that.
2. The team usually agrees on its facilitator in advance. If a takeover swaps that person without telling the team, the session can start on the wrong foot. Participants will see the new facilitator in the lobby, so I am not asking for a team notification, but the confirmation copy could suggest the taker contact the team.

## Pre-existing items noted, not introduced by this change

- Residual gaps 1 and 2 (a manager sent only `facilitator`, and skip-level managers or directors) are the heart of "reporting chain", and the code does not catch them. The product owner accepted them as risks (row 13), and the deployment-docs warning is the standing control. I'm uneasy relying on documentation alone. Revisit trigger 2 in 01c (a report that a line manager facilitated) must actually go to the BA and the VP when it happens.
- The human VP of Engineering acknowledgment is pending. #238 must not close until it is recorded.
- #241 gates first-team launch. That gate has to hold. Waiving it would reopen the interim window, where the role pair resolves to `facilitator`.
