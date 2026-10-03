SIGN-OFF: CLEAN

**Champion:** Devon Calloway (Internal Champion)
**Change:** topic-001-authz-contract-reconcile (#187)
**Date:** 2026-10-03

## Ritual intent

This change makes the ritual's intent stronger. The no-manager rule covers more than voting. It also covers the place where engineers describe their team's health in their own words. The proposal says that directly, and the code now enforces it before `teamAnnotation` ever reaches TOPIC-001. Closing the gap while the endpoint has no consumer was the right time to do it.

## Core constraints

- **No-manager rule: strengthened, and structural.** `isTopicConfigReadAdmitted` is a pure allow-list. It has no flag, env read, config or admin override. A caller counts as an EM if either signal says so: membership role OR global role. That covers path 2', a demoted global EM, and the global-facilitator-with-EM-membership case, which a global-role short-circuit would have let through. The BA's B1 catch was the important one, and the test for it is in place. A denial sends no lock state and no topic data, and it leaves a log event, so a manager probing the endpoint is visible afterwards. This is what I asked for: a rule nobody can configure away.
- **Simultaneous reveal: unaffected.** The diff touches no session, vote or reveal code. The live session still reads the `session_topics` snapshot.
- **Facilitator from another team: respected.** The facilitator arm only applies to a grant earned through `sessions.facilitator_id` with no active membership on the team. A facilitator who is also the team's EM is judged on the member path and gets denied. Nothing here makes a same-team facilitator easier.

## Follow-ups

The list is complete, each item has an owner, and a human can file it as written (proposal.md, "Follow-ups", items 1-9). One note for whoever files them:

- **File item 7 (TOPIC-002 admin/EM annotation exposure) first, and label it a no-manager-rule gap that exists today.** The proposal says it should be fixed "before `teamAnnotation` reaches any wider audience". But `TopicManagementPage` already shows annotations through TOPIC-002. So an Application Admin who also holds an EM membership on a team can read that team's definitions right now, with no audit row. Only a few people fit that description, and this change neither created nor widened the gap. Still, it is the exact exception I don't want to see turn into the norm. Give it the same priority as the other follow-ups and don't let it slide behind them.
- Item 5 (release notes must say EMs can't read team definitions) matters for adoption. Team champions will repeat that line to skeptical engineers. Keep the owner on it when `teamAnnotation` ships.
- Task 6.5 is still open, by design. The PR body has to point to the follow-up list and include the release summary line.

No changes to the archived artifacts needed.
