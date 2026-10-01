# Champion Sign-off: topic-add-form-and-empty-state (#55)

**Reviewer:** Devon Calloway, Principal Engineer (Internal Champion)
**Date:** 2026-10-01
**Verdict: CLEAN SIGN-OFF** (with the conditions-for-ship listed below, none of which I consider a merge blocker)

---

## Did the change preserve the ritual's intent?

Yes. This is the "topic flexibility within guardrails" property I asked for in the original proposal, and it was built as a between-sessions tool, not a session feature. Nothing it adds reaches the room. Teams can now add the one topic that fits their context, while the defaults stay in view: the custom topic is tagged "Custom", the empty state points to Archived before it offers "add your own", and the duplicate check sends a facilitator back to an archived topic so the team keeps one trend instead of splitting it. That last detail is the one I'd have asked for if nobody had thought of it.

## Core constraints

| Constraint | Status | Basis |
|---|---|---|
| **No-manager rule** | Unaffected | The change adds no participation surface. Engineers and EMs are still rejected by the TOPIC-002 route guard before the screen renders. `canAddTopics` is true only for `global_role = 'facilitator'` (`packages/backend/src/routes/content.ts`), and TOPIC-003 still enforces on its own. The parity test (`topic-add-flag-parity.test.ts`) includes an EM caller. |
| **Simultaneous reveal** | Unaffected | No session, vote, or reveal code was touched. The form creates configuration rows only. |
| **Facilitator from another team** | Respected | TOPIC-003's `FACILITATOR_IS_TEAM_MEMBER` 403 is unchanged. The form shows it as a form-level alert and does not work around it. `canAddTopics` is presentation-only and is not an authorization path. The spec's authorization model still requires a non-member facilitator. |
| **First-session lock** | Respected, structurally | A locked team gets no add control at all, not a disabled one. A greyed-out button would just invite people to ask for an exception. The server still returns 409, and the UI handles that by closing the form and refetching. |

None of these became toggles. I see no new configuration surface, admin override, or "skip" path.

## In-session visibility copy vs. #175

I read the shipped strings in `AddCustomTopicForm.tsx`, `ActiveTopicsEmptyState.tsx`, `addCustomTopic.ts` and the page diff. None of them promises that a topic, its description, or a team definition will appear in a session:

- The description is labelled "Description (optional, shown on this screen only)", and its helper says "Engineers won't see this during sessions." That is accurate, and it stays accurate after #175, because descriptions only go out in a team's first session and a custom topic can't exist until after it.
- The success line ("Added '<name>' to the end of the list. Use the move buttons…") is about list position only. The spec requires that no outcome message mention sessions.
- Empty-state row 1 says "…so its sessions can't run". That states the current situation, not a promise.
- Nit, not a blocker: the active-duplicate warning says two similar topics "can confuse people during the vote." This is general guidance about why duplicates are bad, not a claim that this topic will be voted on soon. I'm fine shipping it as is.
- The use case's "It will appear in the next session run" postcondition stays in the requirements doc, with an explicit note that it is pending #175. That is the right place for it: it documents intent and is not UI copy.

## Conditions for ship (human items, not merge blockers)

1. **File the handoffs.** File `custom-topic-description-never-shown-in-session.md` and `zero-topic-team-recovery-path.md` first (Marcus C1, Rachel condition 2), then the four hygiene handoffs. Put the issue numbers into the use-case notes that currently say "issue number pending".
2. **Priya's 15-minute hands-on check** on a test team: add one fresh custom topic, and add one that collides with an archived default.
3. **#175 sequencing.** The team lead confirms #175 is next or already in flight. Until it closes, this change is not described as an adoption win. Today a custom topic is one nobody can vote on, and I'd rather we say that than have a team discover it in the room.
4. **#176 date.** Agree on a target for fixing admin add rights (FR-8.2 [HARD]). Empty-state rows 3 and 5 and the temporary `canAddTopics` admin exclusion get removed in that fix.

## One thing I'm watching (not a concern for this change)

FR-8.6 [HARD], "defaults visible and restorable at any time", is still unmet for a team with zero archived topics (the provisioning-gap case). The empty-state copy is honest about it and names a human group to ask, which is the best we can do without a restore-defaults action. That gap belongs to the zero-topic recovery handoff, and it should not slide past the next topic-management change.

---

**Summary**
- Verdict: CLEAN SIGN-OFF. The ritual's intent is preserved, and this delivers "flexibility within guardrails".
- No-manager rule and simultaneous reveal are unaffected. Facilitator-from-another-team and the first-session lock are respected structurally, not as toggles.
- Shipped copy makes no promise of in-session visibility. The description is labelled "shown on this screen only", and no outcome message mentions sessions.
- Conditions for ship: file the handoffs (description gap and zero-topic recovery first), Priya's hands-on check, #175 confirmed next with no "adoption win" framing, a #176 date.
- Watch item: FR-8.6 for zero-archived teams stays open until the recovery-path handoff lands.
