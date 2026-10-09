# Champion Sign-off: 232-topic-002-admin-read-audit-no-manager (#232)

**CLEAN PASS**

*Devon Calloway, Internal Champion. Reviewed the archived artifacts and the working-tree `git diff` on `agent-team/232-topic-002-admin-read-audit-no-manager`.*

## Did this preserve the ritual's intent?

Yes, and it makes it stronger. "Our team's definition" is the team's own words. If engineers think their manager reads it, they write it for the manager. This change closes the last route a manager had to those words, which was holding the `application_admin` role. It closes it the way I asked in the proposal:

- **The whole response is denied, not just the annotation fields.** `evaluateAdminTopicConfigRead` is an allow-list: admitted only when the live membership is `null` or `participant`. `engineering_manager` and any future role value get `403`. The deny branch returns before any team-name, topic or lock-state query. A future free-text field cannot leak by default.
- **It is structural, not configurable.** There is no flag, env switch, override or "unless" clause. The predicate is pure and not exported. `assertTopic002AuthorizedRole` fails closed if the shared helper ever admits a third role (#208), so a new role cannot skip the check unaudited.
- **It is not silent.** The dual-hat admin sees "Topic configuration for this team isn't available to its engineering manager." rather than a generic error that reads as a bug, so the rule explains itself.
- **The audit can't become surveillance in the other direction.** Rows hold counts only, never text, topic names or ids. The visibility guard keeps them away from team members and EMs, and the PR-time sweep checks it.
- **It is consistent with the precedent.** This is the same manager-plus-admin resolution as #243/D11 (FR-2.4), and it is now stated in BRD FR-8.7 and Constraint 2, where a future reader will look.

## Core constraints

| Constraint | Status |
|---|---|
| No-manager rule | **Strengthened.** A dual-hat admin/EM can no longer read the team's topic configuration. A global `engineering_manager` is still `403 NOT_A_FACILITATOR` whatever their membership (pinned by regression tests). |
| Simultaneous reveal | **Unaffected.** No session, live-room, readiness, reveal, outlier or action-item code is in the diff. |
| Facilitator from another team | **Unaffected.** The facilitator branch never reaches the new code (pinned by SQL-text test). Member-facilitators keep `403 FACILITATOR_IS_TEAM_MEMBER`. Non-member facilitators keep `200` and the handoff continuity they had. `standing-facilitator-access-helper.ts` and the `topics.ts` wrappers have an empty diff. |

Architect and Security implementation reviews both approve with no blockers. The sync review found no substantive drift.

## Tracked, not blocking (human decisions and follow-ups)

These are already recorded in the proposal's Follow-ups and `handoff-drafts.md`. I list them so they don't get lost:

1. **#208: the write side is the worse half.** An admin with an EM membership still gets `201` from TOPIC-003..006. That means the manager can still shape what the team talks about. This split is recorded in the parity test and must be a temporary state. I want #208 scheduled in the current milestone, with escalation to the executive sponsor if it touches who shapes topics.
2. **Release-note wording.** Use only: "Engineering managers, including administrators who manage the team, cannot read the team's definitions." Do not claim managers cannot change topics until #208 lands.
3. **Owner for the compensating-control review queries** in `docs/deployment.md`: proposed as Security, monthly. Brian must confirm it. Until then, the self-demotion and out-of-band gaps are covered only on paper.
4. **PR description** must carry the AC1 deviation sentence (Q1 decided independently of #208), and someone must run `openspec validate --strict` where the CLI is available.
