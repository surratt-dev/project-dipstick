# Champion sign-off: topic002-unknown-team-404 (#265)

Devon Calloway, Internal Champion.

## Verdict: SIGN OFF. No blocking concerns.

I read the proposal, design, implementation reviews (architect, security) and the diff.

## Ritual intent
The change is one backend reorder (the existing team-name read moves ahead of the admin arm, with a 404 for an unknown team), removal of the always-true `team_found` audit key, and a "Team not found." state on the Topic Management screen. It does not touch the ritual. It stops the admin-access audit stream from recording "access" to a team that does not exist, and it stops a stale link from showing an empty, apparently valid team. Both help the guardrails read honestly.

## Core constraints
- No-manager rule: unaffected. For a non-existent team no membership can exist, so no no-manager fact is lost. Every read of an existing team (template and deactivated teams included) is still audited exactly once, with `membership_role` and `actor_idp_roles_include_em` intact.
- Simultaneous reveal: unaffected. No live-session, voting or reveal route is touched. This is a topic-config read only.
- Facilitator-from-another-team: preserved. `FACILITATOR_IS_TEAM_MEMBER` and `NOT_A_FACILITATOR` 403s (audited, #264) still come from the shared authorization check, which runs before the existence check. A participant therefore gets the same response for existing and non-existing teams, so there is no team-id enumeration by unauthorized callers. A standing facilitator gains no new query.

## Unresolved items
Blocking: none.

For the human merge gate (expected):
1. Brian to confirm the audit asymmetry: the 403 is audited, the 404 is not. If overruled, only the 404 branch changes.
2. Accepted residuals: an admin probing non-existent team ids leaves no trace. The existing unbounded 403 denial-row growth (#264 path) needs its own follow-up issue.
3. Brian to confirm that only a JSON body with `error.code === "TEAM_NOT_FOUND"` produces the "Team not found." text.
4. Before merge: fill the PR_NUMBER_PLACEHOLDER / DATE_PLACEHOLDER in the REST API Contract cutover record. The record lets an analyst read the absence of `team_found: false` correctly (architect N1).
5. Non-blocking: Priya's quick look at the one string. The stale-link and deactivated-team follow-up issue is still to be filed. The timing floor still depends on the measured value (security review; the spy test proves placement, not timing).
