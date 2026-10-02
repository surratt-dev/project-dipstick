# Champion Sign-off: topic-003-admin-authorization (#176)

**Reviewer:** Devon Calloway (Internal Champion)
**Date:** 2026-10-01
**Verdict:** SIGN-OFF: CLEAN

## Does this preserve the ritual's intent?

Yes. This change lets an Application Administrator add a topic to a team, which FR-8.2 [HARD] already promised. It doesn't make anything protective optional, skippable or easy to work around. The admin path keeps a team's topic list repairable without first finding a cross-team facilitator, so the ritual depends less on any one person. That was the reason the admin branch exists.

## Core constraints

| Constraint | Status | Evidence |
|---|---|---|
| **No-manager rule** | Respected | `engineering_manager` still gets `403 NOT_A_FACILITATOR` on TOPIC-003. Tests 2.5 and 2.6 check this against locked and nonexistent teams, and the 403 doesn't reveal lock state or whether the team exists. The exclusion is now written down in design D2 and in the use case Notes, so nobody has to infer it from a reason code. `canEditAnnotations` stays `false` for admins, and TOPIC-007's admin-403 tests pass unmodified, so the team's own words (FR-8.7) are still written only by a facilitator. |
| **Simultaneous reveal** | Unaffected | The change touches topic configuration only, not voting or reveal. Integration test 2.7 shows that an admin adding a topic while a room is open leaves that session's `session_topics` unchanged (the #175 snapshot holds). The new topic only shows up from the next room. |
| **Facilitator from another team** | Respected | A member-facilitator still gets `403 FACILITATOR_IS_TEAM_MEMBER` with unchanged copy. The admin arm doesn't give anyone session-running authority. It only covers topic list repair, the same arm TOPIC-004/005/006 already use. |
| **First-session canonical set** | Respected | The customization lock applies to admins too: 409, with an audited `topic.write_denied_locked` row that names `application_admin`. |

## Accepted risks (recorded, not blocking)

- **The no-manager boundary for topic writes now partly depends on policy.** If `application_admin` were ever given to Engineering Managers, this change would let management push topics into a team's ritual. The design states this plainly, names Rachel Okonkwo as policy owner, and requires the IdP role-assignment owner for each configured OIDC provider to be named before merge (6.5). I'd still prefer a structural guard eventually (F5). For #176, writing the risk down with named owners is enough.
- **Member-admins are admitted** (F1). The audit row is the interim control and is checked for member-admins in both test layers. The rule should be decided once across TOPIC-003 to 006, not on one endpoint alone. I agree with deferring it.
- **Facilitators can't see which topics an admin added** (F2). Teams should be able to tell which topics are theirs. F2 is targeted at the next milestone, which is acceptable.

## On the open [HUMAN] tasks

The PR can be opened with 6.4 to 6.6 still open. It must not **merge** until 6.4 (F1 and F2 filed, numbers recorded) and 6.5 (IdP role-assignment owner named for each provider) are done. Those two gates are what keep the policy-dependent boundary above from becoming something nobody owns.

Minor: `design.md` still refers to "task 6.3" for these gates. After renumbering they are 6.4 and 6.5. Fix this in the PR description so reviewers aren't sent to the wrong task.
