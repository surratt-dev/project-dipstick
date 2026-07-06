# Champion Sign-Off — join-team-invite-link

**Reviewer:** Devon Calloway, Principal Software Engineer
**Date:** 2026-07-06

---

## Sign-Off

This change does what it needed to do. The ritual's load-bearing constraints are either properly handled or formally documented at the right location with the right weight. My sign-off comes with two unresolved findings from the implementation reviews that are not blocking from a ritual integrity standpoint, but one of them carries enough security risk that it should not be left open past the next deployment window.

---

## Evaluation by Constraint

### 1. No-manager-in-sessions rule

Handled correctly. EMs are admitted to team membership via the join link — which is the right behavior — and the constraint against EM session participation is documented in `openspec/specs/session-participation/spec.md` as a hard requirement. The spec language is explicit: the check is "not skippable and not configurable" and "must be structural (server-enforced), not preferential (a UI toggle or admin override)." That is exactly the framing I would use.

The decision to enforce this at the session participation layer rather than the join layer is correct. Filtering at join time would create a half-membership state that is both confusing and inconsistent. Documenting the deferral here, in the change that surfaced the question, is the right practice — it is not deferred into someone's memory, it is deferred into a named spec artifact that the session participation feature cannot ignore.

Traceable. Hard requirement. No concerns.

### 2. Facilitator-from-another-team constraint

Also formally captured in `openspec/specs/session-participation/spec.md` as a hard block — not a warning, not a default. The spec specifies that the enforcement requires checking both `global_role` (confirms facilitator status) and `team_memberships` (confirms which team they belong to), which is the correct two-part check. A facilitator who joined Team A via a join link cannot facilitate Team A's sessions. That is exactly the intent.

Devon's position has always been that a warning that can be dismissed defeats the purpose. The spec says "hard block, not a soft warning." That language is in the spec now, not in my head. Adequate protection.

### 3. Simultaneous reveal mechanic

The mid-session arrival question is formally out of scope with a documented requirement that the session participation feature must answer it before implementation begins. The spec does not leave the options ambiguous — it enumerates three candidate approaches, requires the design to choose one explicitly, and requires the facilitator's readiness grid update behavior to be specified alongside that choice. The latter matters: if the grid does not update in real time when someone joins mid-vote, the facilitator can trigger a reveal before all participants have voted, which directly breaks the mechanic.

Scoping this out of the join-link change is the right call. The join link's job ends when it routes the user to the session URL. What happens to that user in relation to an active vote is session participation territory, and the decision must be made deliberately by the team building that feature — not inherited as an implicit default. The spec ensures that deliberateness is required, not optional.

Adequately protected.

### 4. Join link as the ritual's front door

The silent failure bugs are fixed comprehensively. A user who follows an expired or revoked link gets a clear error message and a path forward. A user who follows a link that does not exist sees a distinct message. Both error states display the secondary guidance line — "If this is your first time using this tool, sign out and ask the person who invited you for a new link" — which is the right call for initial deployment when some fraction of first-time users will be arriving on a link they received by email days ago.

First-time joiners on the through-auth path get a confirmation banner. The banner content ("Your facilitator will share what comes next") is correct — it does not overexplain or prompt action the user should not take on their own. The decision not to show this banner when landing directly in an active session is also correct; the session context is confirmation enough, and the banner content would be actively misleading.

The user is no longer silently routed to `/no-team` when a join token was present and failed. That was the most important fix in this change, and it is done.

Trust in the tool's first impression is improved. No concerns.

---

## Outstanding Findings — Not Blocking, But Tracked

Two findings from the implementation reviews were dispositioned as follow-on work rather than blockers. I am noting them here because one carries real risk and should not slide.

**Finding: Join token appears unredacted in `/auth/login` server logs** (security review, Finding 1, medium severity). The logger serializer redacts the `/api/join/<token>` URL pattern but not `/auth/login?joinToken=<value>`. A valid, unexpired join token is written to server access logs in plaintext. The fix is a one-line regex extension, as specified in the security review. Anyone with log access can extract an active join token and use it to join a team they were not intended to join. The 7-day TTL limits the window, but "limited window" is not the same as "acceptable." This should be resolved before the join link path sees significant production traffic.

**Finding: Direct path `join.link_redeemed` audit event missing `sourceIp`** (architect review Finding 1, security review Finding 2, low severity). The through-auth path emits `sourceIp` in `join.link_redeemed`; the direct path does not. This is an audit consistency gap, not a correctness or ritual integrity issue. It should be resolved in the same pass as the log redaction fix.

Neither finding touches ritual integrity. Both are operational and security concerns. I am signing off on the ritual evaluation; I am not signing off on these findings being permanently deferred.

---

## Summary

The ritual's intent is preserved. The load-bearing constraints are structural in the spec, not preferential. First-time user trust in the tool's front door is materially improved. The session participation feature has formally documented hard requirements it must satisfy before implementation begins — requirements that are named, reasoned, and not buried.

This change does not accidentally undermine anything the ritual depends on. The outstanding findings should be closed before deployment.

— Devon Calloway
