## Why

Every protective constraint in this ritual — the no-manager participation rule, the facilitator-from-another-team rule — depends on roles being accurate. Role assignment is not administrative overhead; it is the foundation that every session-layer enforcement check is built on. Without a working path to designate a user as an Engineering Manager for their team, the no-manager rule is checking a default value that was set by account creation, not by human intent. The ritual's integrity is only as strong as the accuracy of the roles underneath it.

The join-link change correctly deposits new users into teams with a default `participant` membership role. First Access correctly creates accounts. But neither of those changes provides a mechanism for an authorized actor to look at that new account and say: "This person is the Engineering Manager for this team." Until that mechanism exists, no team with an EM can run a session that correctly enforces the no-EM-participation rule. This is the blocking gap.

## What Changes

- Add a member management view for teams, accessible before sessions begin, showing each member's current role with clear labels ("Engineer" / "Engineering Manager")
- Implement role assignment for `team_memberships.membership_role` via TEAM-005 (`PATCH /api/v1/teams/:teamId/members/:userId/role`), supporting transitions between `participant` (Engineer) and `engineering_manager` (Engineering Manager)
- Surface a pre-action warning when a role change would leave the team with zero participant-role members. The warning message is: "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change." The warning fires at the confirmation step and does not block the change.
- Display a plain-language confirmation after a successful role change ("Devon Calloway is now an Engineering Manager for this team")
- Emit an audit log entry on every role change: who changed it, from what role, to what role, and when — EM designation and demotion both require a complete audit trail
- Include inline role descriptions in the role selector ("Engineer — participates in session voting" / "Engineering Manager — can view session history; will not vote") to reduce first-session confusion
- Update the `session-participation` spec to check **both** `users.global_role` and `team_memberships.membership_role` when enforcing the no-manager participation rule — this spec update is a **prerequisite** and must ship before role assignment is implemented
- The session-participation endpoint must reject a lock-in request from a user whose `team_memberships.membership_role` has been updated to `engineering_manager` since the session began. Votes already locked in before the role change are preserved. Post-change lock-in attempts from that user are rejected at the endpoint.
- Demoting an Engineering Manager to Engineer revokes read-only access to that team's session history immediately. The next request to any session history endpoint from the demoted user returns 403.
- **Use case document — two separate edits with different timelines:**
  - **Edit 1 — unblocked, actionable now:** In `requirements/use cases/01 - Identity and Access - Use Cases.md`, remove Facilitator from the list of assignable roles. Valid assignable roles in this change are Engineer and Engineering Manager only. This edit is not dependent on Q1 resolution and must be made as part of this proposal.
  - **Edit 2 — blocked on Q1 resolution:** Update the actor field and the stale acceptance criteria in the use case and the API contract to reflect the Q1 decision. These edits must be made simultaneously in both documents and reviewed together by the BA and security analyst before implementation begins. Replacement AC text is carried in the Acceptance Criteria section below.

**Out of scope for this change:**
- Facilitator designation (`users.global_role = 'facilitator'`) — requires a new privileged endpoint; deferred to a separate use case
- `TEAM-006` (`POST /api/v1/teams/:teamId/managers`) — not called as part of this change; see Design Decision 1 for rationale
- Modification of `users.global_role` for any role
- Bootstrapping the first admin or facilitator account — must be addressed as a named follow-on with a designated owner
- The "ready to run a session" pre-flight signal on the member management view — a session-initiation UX concern, not a role management concern

## Capabilities

### New Capabilities

- `role-assignment`: Team membership role management — the UI and API layer for changing a team member's `membership_role` between `participant` and `engineering_manager`. The capability is complete when each of the following conditions is independently satisfied:

  - **Member management view:** A team's members are displayed in a list view with each member's current role labeled as "Engineer" or "Engineering Manager." The view is accessible to an authorized actor before a session begins.
  - **Role selector with inline descriptions:** The role selector presents exactly two options — "Engineer" and "Engineering Manager" — each with an inline description ("Engineer — participates in session voting" / "Engineering Manager — can view session history; will not vote"). No other roles are selectable.
  - **Pre-action zero-participant warning:** When a role change would result in zero members with `membership_role = 'participant'`, the message "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change." is displayed before the confirmation step. The warning does not block the change.
  - **Plain-language confirmation:** After a successful role change, the application displays a confirmation naming the person and their new role (e.g., "Devon Calloway is now an Engineering Manager for this team").
  - **Role change immediacy:** The next API request from the affected user is evaluated against the updated `team_memberships.membership_role` value. No cached role value is used. After a role change to `engineering_manager`, that user cannot successfully lock in a vote.
  - **Audit logging:** Every role change writes a log entry containing: actor user ID, subject user ID, team ID, from-role, to-role, and timestamp. Both promotions and demotions are logged.

### Modified Capabilities

- `session-participation`: The EM non-participation enforcement requirement changes. The current spec checks only `users.global_role`. After this change, the check must cover both `users.global_role = 'engineering_manager'` AND `team_memberships.membership_role = 'engineering_manager'` for the relevant team. A user whose team membership role is `engineering_manager` must not be recorded as a session participant, regardless of their global role. This is a prerequisite for the role-assignment capability — it must be in the spec before implementation of role assignment begins.

## Acceptance Criteria

The following criteria replace the stale AC set in `requirements/use cases/01 - Identity and Access - Use Cases.md`. Items marked conditional are contingent on Q1 resolution; all others are unconditional.

- **AC1:** An authorized actor [actor field determined by Q1 resolution — see Q1 section below] can change a team member's `membership_role` from `participant` to `engineering_manager`, and from `engineering_manager` to `participant`.
- **AC2:** The role change takes effect on the next authenticated request from the affected user. No cached role value is used.
- **AC3 [required if Q1 resolves to Option A]:** An actor who does not hold the required authorization for role assignment sees a plain-language explanation of why the action is unavailable AND the Application Admin's name with an actionable in-app path to contact them. A grayed-out control with no explanation does not satisfy this criterion.
- **AC4:** A role change to `engineering_manager` that would leave the team with zero `participant`-role members displays the message "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change." before the confirmation step. The warning does not block the change.
- **AC5:** Every role change produces an audit log entry containing: actor user ID, subject user ID, team ID, from-role, to-role, and timestamp.
- **AC6:** A user whose `membership_role` is updated to `engineering_manager` cannot lock in a vote in that team's next session; the session-participation endpoint rejects the attempt.
- **AC7:** A user whose `membership_role` is updated from `engineering_manager` to `participant` loses access to that team's session history on their next request; the session history endpoint returns 403 for that user.
- **AC8:** A role change applied to a user during an active session does not retroactively invalidate votes that user has already locked in for the current session. A lock-in request submitted after the role change to `engineering_manager` is rejected at the session-participation endpoint.

## Impact

- **API endpoint used:** TEAM-005 (`PATCH /api/v1/teams/:teamId/members/:userId/role`) — no new endpoint required for the `team_memberships` change; authorization rules for this endpoint are subject to the Q1 decision (see below). **TEAM-006 (`POST /api/v1/teams/:teamId/managers`) is not called as part of this change. TEAM-005 alone is sufficient for all `membership_role` writes. See Design Decision 1 for rationale.**
- **Session participation endpoint:** Must be updated to query both `users.global_role` and `team_memberships.membership_role` before recording a participant; this is a server-side enforcement change, not a client-side change
- **Database:** No schema changes — `team_memberships.membership_role` enum already includes `participant` and `engineering_manager`; audit logging writes to the existing audit trail
- **Frontend:** New member management view component; role selector with two options (Engineer, Engineering Manager); pre-action warning modal; confirmation notification
- **Use case document:** See "Use case document — two separate edits" in What Changes above. Edit 1 (remove Facilitator as assignable role) is unblocked. Edit 2 (actor field and stale AC replacement) is blocked on Q1 resolution and must be made simultaneously with the API contract update.
- **Deferral artifact — "Designate a Facilitator":** A stub must be created as an explicit deferral — not silently omitted — naming what is deferred (`users.global_role = 'facilitator'` designation, the new privileged endpoint required, and why it is out of scope here). **Owner: Marcus Delgado (BA).** The stub must exist before this change is marked complete.
- **Bootstrapping documentation:** An explicit out-of-scope note naming the bootstrapping problem (how the first Application Admin and Facilitator accounts are provisioned), the viable options (seed migration, bootstrap endpoint, IdP role claims in First Access), and a confirmed interim path for early adopter teams. **Owner: Marcus Delgado (BA). Target: Q3 2026.** Early adopter teams must have a provisioned Application Admin before their first session attempt — even if the interim path is a manual seed step — and this must be confirmed before first-team onboarding.

---

## Q1 — Who Can Assign Roles

**Executive decision received.** Rachel Okonkwo (VP Engineering) has approved **Option A** — only Application Admins and Engineering Managers can assign roles — with the escalation UX built into this change as a hard requirement. This decision is not a preference or a recommendation; it is signed off. Option A does not ship without the escalation UX.

**Remaining prerequisite before implementation begins:** The BA and security analyst must document the Q1 resolution by updating the use case actor field and the API contract simultaneously as a single coordinated change. Both updates must be reviewed together and signed off before implementation of role assignment begins.

---

### Option A — Only Application Admins and Engineering Managers can assign roles *(selected)*

EMs can assign roles for their own team; Application Admins can assign roles for any team. Facilitators cannot.

**Escalation UX — minimum-acceptable hard requirement. Must ship with this change. Not deferrable.**

The member management view must not present a Facilitator or other unauthorized actor with a grayed-out control and no explanation. The following is the minimum-acceptable implementation:

> When an actor who does not hold the required authorization accesses the member management view, the view displays: (a) a plain-language explanation that role assignment requires an Application Admin or an existing Engineering Manager for this team, and (b) the Application Admin's name and an actionable in-app path to contact them.

**Acceptance criterion for escalation UX:** The above two conditions — explanation and actionable contact path — must both be present. A grayed-out control with no explanation does not pass acceptance. If this ships without the escalation UX, Option A is not viable and the adoption goal is undermined.

The preferred implementation goes further — surfacing an in-app message path rather than just a contact name — but the minimum criterion above is the floor. A Facilitator who dead-ends at session-start time with no actionable path will not recommend this tool.

### Option B — Facilitators can assign roles for teams they do not belong to *(not selected)*

Not selected. EM designation grants read access to a team's full session history. That decision should be a deliberate act by someone with an ongoing stake in that team — an existing EM or an Application Admin with organizational authority. A visiting Facilitator does not have that stake. Option B creates a privilege escalation path: a Facilitator assigning `engineering_manager` grants standing data access to potentially sensitive session history. Option A with a working escalation path is the correct model.

### Option C — Any authenticated user can assign roles *(not selected)*

Not selected. Widest attack surface for privilege escalation. Not seriously considered.

---

**Implementation is blocked until:**
1. BA and security analyst sign off on the Q1 resolution and update the use case and API contract as a single simultaneous change
2. The `session-participation` spec is updated (prerequisite — must precede role-assignment implementation)
