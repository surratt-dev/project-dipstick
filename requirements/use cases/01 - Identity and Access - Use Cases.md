# Identity & Access — Use Cases

---

# Use Case: Sign In (complete)

## Summary
**Actor:** Engineer | Facilitator | Engineering Manager

**Trigger:** The user navigates to the application and is not currently authenticated.

**Goal:** As an authenticated user, I want to sign in through the organization's identity provider so that I can access the application.

---

## Preconditions
- The user has valid credentials with the configured identity provider.
- The application is reachable and the identity provider is available.
- The user does not have an active authenticated session.

## Main Flow
1. The user navigates to the application.
2. The application detects no active session and redirects the user to the identity provider's authentication page.
3. The user authenticates with the identity provider using their organization credentials.
4. The identity provider validates the credentials and returns a verified identity assertion to the application.
5. The application accepts the assertion, creates an authenticated session, and identifies the user's account (creating one if none exists — see UC: First Access).
6. The application redirects the user to their default landing page.

## Alternate Flows
- **Authentication fails:** The identity provider rejects the credentials. The user remains on the identity provider's error page. The application is not reached. No session is created.
- **Identity provider unavailable:** The redirect to the identity provider fails or times out. The application displays an error indicating that sign-in is temporarily unavailable. No session is created.
- **User cancels authentication:** The user abandons the identity provider flow. The application receives no assertion. The user is returned to the sign-in page with no session created.

## Postconditions
- **Success:** The user has an authenticated session. The application knows the user's identity. The user is directed to their landing page.
- **Failure:** No session is created. The user cannot access any application content.

---

## Acceptance Criteria
- [ ] Unauthenticated requests to any application route are redirected to the identity provider.
- [ ] A successful identity provider assertion results in an authenticated session.
- [ ] A failed or cancelled identity provider flow results in no session and no access to protected content.
- [ ] The application does not store or manage passwords or credentials.
- [ ] Session is created only after a valid identity provider assertion is received.

## Out of Scope
- Credential management (password reset, MFA enrollment) — owned entirely by the identity provider.
- Account registration — there is no registration flow; identity provider validation is sufficient for access.

## Dependencies
- Identity Provider — external service that performs authentication and returns a verified identity.
- UC: First Access — handles the case where this is the user's first successful sign-in.

## Notes
- The application trusts the identity provider unconditionally. If the provider validates the user, the application grants access.
- The specific identity provider protocol (e.g., OIDC, SAML) is not specified here and is an implementation concern.

---

# Use Case: First Access

## Summary
**Actor:** Application

**Trigger:** A user completes authentication with the identity provider for the first time — the identity assertion does not match any existing account in the application.

**Goal:** As the application, I want to create an account for a newly validated user so that they can begin using the application without manual provisioning.

---

## Preconditions
- The user has successfully authenticated with the identity provider.
- The application has received a valid identity assertion.
- No existing account in the application matches the identity returned by the provider.

## Main Flow
1. The application receives a valid identity assertion from the identity provider.
2. The application checks for an existing account matching the asserted identity.
3. No match is found. The application creates a new account record for the user.
4. The new account has no team memberships and no assigned roles.
5. The application completes session creation and redirects the user to the application.
6. The application presents the user with a state indicating they have no team associations and surfaces available next steps (e.g., they have been invited to a team via a join link, or they may create a new team as part of starting a session).

## Alternate Flows
- **Existing account found:** The application skips account creation and proceeds with the existing account. This use case does not apply.
- **Account creation fails:** A system error prevents the account from being created. The session is not established. The user receives a generic error. The error is logged for operator review.

## Postconditions
- **Success:** A new account exists for the user. The user has an authenticated session. The account has no team memberships.
- **Failure:** No account is created. No session is established. The user cannot access the application.

---

## Acceptance Criteria
- [ ] A user with no existing account who authenticates successfully receives a new account automatically.
- [ ] The new account has no team memberships or role assignments at creation time.
- [ ] A user who authenticates a second time is matched to their existing account, not given a new one.
- [ ] The user is informed they have no team associations and presented with a path forward.

## Out of Scope
- Account profile editing — users cannot change their identity attributes; those are owned by the identity provider.
- Admin-initiated account provisioning — there is no manual account creation flow.

## Dependencies
- UC: Sign In — this use case is triggered from within the sign-in flow.
- UC: Join a Team — the next step a new user without a team will likely take.

## Notes
- The application should not silently drop a user into a blank state with no explanation. The no-team landing state should be informative.
- The identity attribute used to uniquely identify a user (e.g., email, subject claim) is an implementation concern; it must be stable across sign-ins.

---

# Use Case: Join a Team via Invite Link

## Summary
**Actor:** Engineer | Facilitator

**Trigger:** The user follows a team join link shared by a facilitator or existing team member.

**Goal:** As a user with no team association, I want to join an existing team via a link so that I can participate in that team's sessions.

---

## Preconditions
- The user is authenticated.
- The user has received a valid team join link (distributed out-of-band by a facilitator or team member).
- The team referenced by the join link exists in the application.

## Main Flow
1. The user follows the join link.
2. The application validates the link (team exists, link is valid).
3. If the user is not yet authenticated, the application redirects to sign-in and returns to this flow after authentication.
4. The application checks whether the user is already a member of this team.
5. The user is not a member. The application adds the user to the team with the default role of Engineer.
6. The application confirms the membership and presents the user with the team's current state (upcoming or active session, or team dashboard).

## Alternate Flows
- **User is already a member of this team:** The application recognizes the existing membership and redirects the user to the team view without creating a duplicate record.
- **Join link is invalid or expired:** The application displays an error indicating the link is not valid. The user is not added to any team.
- **Team no longer exists:** The application displays an error. The user is not added to any team.
- **User is unauthenticated:** The application redirects to sign-in, preserving the join link destination, and completes the join flow after authentication.

## Postconditions
- **Success:** The user is a member of the team with the Engineer role. They can participate in the team's sessions.
- **Failure:** The user's team membership is unchanged. They are shown an appropriate error.

---

## Acceptance Criteria
- [ ] Following a valid join link adds the authenticated user to the team as an Engineer.
- [ ] Following an invalid or expired join link does not add the user to any team and shows an error.
- [ ] Following a join link when already a member of that team does not create a duplicate membership.
- [ ] An unauthenticated user who follows a join link is redirected to sign-in and then returned to complete the join flow.
- [ ] After joining, the user is presented with the team's current state.

## Out of Scope
- Join link generation — that belongs to Session Setup.
- Role assignment other than the default Engineer role — that is handled separately by a team member with appropriate access.
- Notifications to existing team members that someone has joined.

## Dependencies
- UC: Sign In — required if the user is unauthenticated when following the link.
- Session Setup feature set — join links are generated as part of session creation.

## Notes
- The default role on joining is Engineer. If a different role is needed (e.g., Engineering Manager), that must be set separately after the user has joined.
- The mechanism for join link expiry (if any) is an implementation concern not defined here.

---

# Use Case: Assign a Role to a Team Member

## Summary
**Actor:** Application Admin | Engineering Manager (for their own team only)

*Q1 resolved — Option A selected (Rachel Okonkwo, VP Engineering). Facilitators cannot assign roles. Edit 1 (remove Facilitator as assignable role) applied; Edit 2 (actor field and stale AC update) applied simultaneously.*

**Trigger:** An authorized actor needs to change a team member's role from the default (Engineer) to Engineering Manager, or needs to demote an Engineering Manager back to Engineer.

**Goal:** As an authorized actor (Application Admin or Engineering Manager for this team), I want to assign or change a team member's membership role so that the application enforces the correct access and capabilities for that person.

---

## Preconditions
- The actor is authenticated.
- The actor is an Application Admin (any team) OR an Engineering Manager with an active membership on the specific team being modified.
- The target user is an existing active member of the team.
- The role being assigned is one of the valid assignable membership roles: **Engineer** (`membership_role = 'participant'`) or **Engineering Manager** (`membership_role = 'engineering_manager'`).

## Main Flow
1. The actor navigates to the team's member management view.
2. The actor selects a new role for a team member from the available options (Engineer or Engineering Manager).
3. The application validates that the role change is permitted (valid role, authorized actor, per-team verification from the database).
4. If the change would leave the team with no Engineer-role members, the application displays a warning message before the actor confirms: "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change."
5. The actor confirms the change (or cancels at the warning step).
6. The application updates the team member's `membership_role` in a database transaction that also writes an audit log entry.
7. The application confirms the change with a plain-language message: "[Member name] is now an Engineering Manager for this team" or "[Member name] is now an Engineer for this team."

## Alternate Flows
- **Invalid role selection:** The application rejects the change and displays an error.
- **Unauthorized actor:** A Facilitator, Engineer, or Engineering Manager not affiliated with this team attempts to change a role. The application rejects the request with 403. If the actor is a Facilitator viewing the member management view, the application displays a plain-language explanation: "Only an Application Admin or an Engineering Manager for this team can change roles. Contact your admin to update this before the session."
- **Role change would leave zero Engineers:** The application returns 422 on the first submission and requires explicit confirmation before applying the change (see Main Flow step 4–5).

## Postconditions
- **Success:** The team member's `membership_role` is updated. The new role takes effect immediately on the next authenticated request from the affected user. An audit log entry is written in the same transaction.
- **Failure:** The team member's role is unchanged. An error is shown.

---

## Acceptance Criteria
- [x] AC1: An Application Admin or an Engineering Manager for this specific team can change a team member's `membership_role` between `participant` (Engineer) and `engineering_manager` (Engineering Manager).
- [x] AC2: The role change takes effect immediately. No cached role value is used.
- [x] AC3: An actor who does not hold the required authorization sees a plain-language explanation of why the action is unavailable. A grayed-out control with no explanation does not satisfy this criterion.
- [x] AC4: A role change to `engineering_manager` that would leave the team with zero `participant`-role members displays the message "This change will leave [team name] with no Engineers. A session cannot start without at least one Engineer. You can still make this change." before the confirmation step.
- [x] AC5: Every role change produces an audit log entry containing: actor user ID, actor's `global_role` at the time of the change, actor IP, subject user ID, team ID, from-role, to-role, and timestamp.
- [x] AC6: A user whose `membership_role` is updated to `engineering_manager` cannot lock in a vote in that team's next session.
- [x] AC7: A user whose `membership_role` is updated from `engineering_manager` to `participant` loses access to that team's session history on their next request (403).
- [x] AC8: A role change applied during an active session does not retroactively invalidate votes already locked in. A lock-in request submitted after the role change is rejected.

## Out of Scope
- Facilitator designation (`users.global_role = 'facilitator'`) — deferred; see "Designate a Facilitator — Deferral" stub.
- `TEAM-006` (`POST /api/v1/teams/:teamId/managers`) — not called as part of this change. TEAM-005 alone is sufficient for all `membership_role` writes.
- Modification of `users.global_role` for any role — this change writes only to `team_memberships.role`.
- Removing a user from a team — separate use case.
- Defining new role types — the set of membership roles is fixed: `participant` and `engineering_manager`.

## Dependencies
- UC: Join a Team via Invite Link — a user must be a team member before a role can be assigned.

## Notes
- This change operates exclusively on `team_memberships.role`. It does not touch `users.global_role`.
- The Engineering Manager role carries read-only access to session history for that team; that access is enforced by the application based on the membership role value, checked at each request from the database.
- Bootstrapping the first Application Admin account is a named follow-on item. Owner: Marcus Delgado (BA). Target: Q3 2026. See proposal.md for options (seed migration, bootstrap endpoint, IdP role claims in First Access).

---

# Use Case: Establish a Manager/Team Relationship

*Edit applied per Decision 1 (design.md): Actor corrected from Facilitator to Application Admin. Precondition corrected to state that `users.global_role = 'engineering_manager'` must pre-exist before TEAM-006 is called — TEAM-006 writes only the `team_memberships` row, it does not set `global_role`. Both corrections applied simultaneously per task 1.1.*

## Summary
**Actor:** Application Admin

**Trigger:** An Application Admin needs to associate an Engineering Manager with one or more teams they oversee, so the manager can access those teams' session history and trends.

**Goal:** As an Application Admin, I want to link an Engineering Manager to the teams they manage so that the manager has appropriate read-only visibility into those teams' data.

---

## Preconditions
- The Application Admin is authenticated.
- The target Engineering Manager has an account in the application (has signed in at least once).
- The target Engineering Manager's `users.global_role` is already set to `engineering_manager` — this is a hard precondition that TEAM-006 checks and enforces. TEAM-006 does NOT set `global_role`; that is the responsibility of the IdP role claim mapping in the First Access flow (see UC: First Access). If the precondition is not met, TEAM-006 returns 409.
- The target team exists in the application.

## Main Flow
1. The Application Admin navigates to the team's administration view.
2. The Application Admin selects the option to associate an Engineering Manager with the team.
3. The Application Admin identifies the Engineering Manager by name or identifier within the application.
4. The application verifies the Engineering Manager's `global_role` precondition, then creates the manager/team relationship (`team_memberships` row with `role = 'engineering_manager'`).
5. The Engineering Manager now has read-only access to that team's session history, trend data, and action items.
6. The application confirms the relationship has been established and records an audit log entry.

## Alternate Flows
- **Engineering Manager account does not exist:** The Engineering Manager has never signed in. The Application Admin cannot complete the association. The Application Admin must ask the Engineering Manager to sign in first, then retry.
- **Engineering Manager lacks `global_role = 'engineering_manager'`:** TEAM-006 returns 409 Conflict with a machine-readable error code identifying the `global_role` precondition failure. The Application Admin must ensure the Engineering Manager's IdP role claim is correctly configured and the EM has re-authenticated before retrying.
- **Relationship already exists:** The application recognizes the existing relationship (idempotent behavior). Returns 200 OK with the same response body as a new creation.
- **Unauthorized actor attempts this action:** The application rejects the request with 403. Facilitators, Engineers, and Engineering Managers who view the team administration page see a plain-language explanation: "Associating an Engineering Manager requires Application Admin access. Contact your admin to complete this before the session."

## Postconditions
- **Success:** The Engineering Manager has read-only access to the team's session history, trends, and action items. An audit log entry records the association (actor, target, team, timestamp).
- **Failure:** No relationship is created. The Engineering Manager's access is unchanged.

---

## Acceptance Criteria
- [ ] An Application Admin can associate an Engineering Manager with a team via `POST /api/v1/teams/:teamId/managers` (TEAM-006).
- [ ] After the relationship is established, the Engineering Manager can view that team's session history, trends, and action items.
- [ ] The Engineering Manager cannot be given write access to any team data through this relationship.
- [ ] An Engineering Manager can be associated with more than one team.
- [ ] The association can only be made if the Engineering Manager has an existing application account with `global_role = 'engineering_manager'`.
- [ ] Calling TEAM-006 for a user who lacks `global_role = 'engineering_manager'` returns 409 Conflict with a specific error code.
- [ ] Facilitators, Engineers, and Engineering Managers cannot establish this relationship (403 returned).
- [ ] Every successful TEAM-006 call produces an audit log entry in `audit_log` within the same database transaction as the `team_memberships` write.

## Out of Scope
- The Engineering Manager participating in sessions — that is explicitly not permitted regardless of team association.
- Notifications to the Engineering Manager that they have been given access.
- Removal of an EM/team relationship — that is a separate use case (follow-on change; see design.md Q4).

## Dependencies
- UC: First Access — the Engineering Manager must have an account and `global_role = 'engineering_manager'` set via IdP claim mapping before they can be associated with a team.
- UC: Assign a Role to a Team Member — distinct from this use case; TEAM-005 changes the `team_memberships.role` of an existing member; TEAM-006 establishes the relationship for a user who was not previously a team member.

## Notes
- An Engineering Manager may manage multiple teams. The application must support one-to-many manager/team relationships.
- The reverse — removing a manager/team relationship — is not described in this use case and should be addressed separately. An interim administrative procedure for removal exists in design.md Q4.
- TEAM-006 is distinct from TEAM-005. TEAM-005 changes the `team_memberships.role` of an existing member and does not check `global_role`. TEAM-006 establishes the relationship for a user who was not previously a team member and requires `global_role = 'engineering_manager'` as a hard precondition.

---

# Use Case: Enforce Access Control on Team Content

## Summary
**Actor:** Application

**Trigger:** Any authenticated user attempts to access content belonging to a specific team (session data, trend history, action items, topic configuration).

**Goal:** As the application, I want to enforce that only authorized users can access a team's content so that session data remains private to the team, its manager, and the current facilitator.

---

## Preconditions
- The user is authenticated.
- The user is requesting access to content associated with a specific team.

## Main Flow
1. The user navigates to or requests team-specific content.
2. The application checks the user's relationship to the team:
   - Is the user a member of the team (Engineer, Facilitator, or Engineering Manager role on this team)?
   - Is the user the Engineering Manager associated with this team?
   - Is the user the facilitator of an active session for this team?
3. If any of the above conditions are true, the application grants access appropriate to the user's role.
4. The application serves the requested content.

## Alternate Flows
- **User has no relationship to the team:** The application denies access. The user is shown an error indicating they do not have access to that team. The content is not served.
- **User is an Engineer attempting to access another team's content:** Access is denied. Engineers see only the content of their own team(s).
- **User is an Engineering Manager attempting to access content for a team they do not manage:** Access is denied. The manager sees only the teams they are explicitly associated with.
- **User is a Facilitator attempting to access content for a team they are not facilitating:** Access is denied. A facilitator's access to a team's content is scoped to sessions they are actively facilitating. Within that scope, they may access both the current session and the team's full historical data (session history, trends, action items) to support facilitation.

## Postconditions
- **Success:** The user accesses content appropriate to their role and team relationship.
- **Failure:** The user is denied access. No content is disclosed. The denial is not exploitable to infer what teams or sessions exist.

---

## Acceptance Criteria
- [ ] Team content is inaccessible to authenticated users who have no relationship to that team.
- [ ] Engineers can access only the content of teams they are members of.
- [ ] Engineering Managers can access only the session history, trends, and action items of teams they explicitly manage; they cannot access other teams' data.
- [ ] A facilitator can access the current session and the facilitated team's full historical data (session history, trends, action items) for the duration of their facilitation; this access does not extend to other teams' data.
- [ ] A facilitator retains read-only access to the facilitated team's historical data for 30 minutes after the session closes (`facilitator_access_expires_at` grace window). After 30 minutes, access is denied until a new session is created.
- [ ] Access control is enforced server-side; it is not dependent solely on UI visibility.
- [ ] Denied access results in a clear error, not a disclosure of existence or content.
- [ ] An Application Admin with no team membership cannot access session content (votes, trend data, action items) for any team; admin access is limited to administrative data (membership lists, role assignments, EM associations, team metadata).

## Out of Scope
- Authentication itself — that is handled at sign-in.
- What content each role can see within their permitted team — that is defined per feature set (e.g., Engineering Manager sees trends and history but not live session votes).

## Dependencies
- UC: Sign In — the user must be authenticated before access control is evaluated.
- UC: Join a Team via Invite Link — team membership is established here.
- UC: Establish a Manager/Team Relationship — manager access is established here.

## Notes
- Access control must be enforced at the API/data layer, not only in the UI.
- A facilitator has full read access to the facilitated team's historical data (session history, trends, action items) for the duration of the session they are running. This access enables them to reference prior session context during facilitation.
- **Amendment (2026-07-07 — enforce-access-control-on-team-content change):** A facilitator's read-only access to historical data persists for 30 minutes after the session transitions to `complete`. This grace window allows the facilitator to review and finalize notes, action items, and session outcomes immediately after closing the room. The window is enforced via `sessions.facilitator_access_expires_at`, set server-side to `completed_at + 30 minutes` at session completion. After the window expires, the facilitator has no access to the team's historical data until a new session is created. The grace window is read-only; no write operations are permitted during it. See design decision 4 in `openspec/changes/enforce-access-control-on-team-content/design.md` for full rationale. (Task 0.1 — Owner: Marcus Delgado)
- Additionally, a facilitator may create a `draft` session before opening a session to participants, which grants read-only access to the team's historical data during preparation. A `draft` session that is not advanced to `lobby` within 24 hours expires automatically (lazy expiry via SQL check). See the team-content-access spec for the full `draft` session behavior.

---

# Use Case: Sign Out

## Summary
**Actor:** Engineer | Facilitator | Engineering Manager

**Trigger:** The user explicitly chooses to sign out of the application.

**Goal:** As an authenticated user, I want to sign out so that my session is terminated and my account is not accessible from this device.

---

## Preconditions
- The user is authenticated and has an active session.

## Main Flow
1. The user selects the sign-out option in the application.
2. The application invalidates the user's session server-side.
3. The application clears any session identifiers from the client (cookies, tokens).
4. The application redirects the user to the sign-in page or a signed-out confirmation page.

## Alternate Flows
- **User is a facilitator mid-session:** The application does not block sign-out, but should warn the facilitator that signing out will end their ability to control the session. If the facilitator confirms, the session is left without a facilitator. The behavior of an in-progress session without a facilitator is an implementation concern.
- **Session has already expired:** The application treats the user as unauthenticated. If the user attempts to sign out, the application redirects them to the sign-in page as if they were already signed out.

## Postconditions
- **Success:** The server-side session is invalidated. Client-side session identifiers are cleared. The user must re-authenticate to access the application again.
- **Failure:** If the sign-out request fails (e.g., network error), the session may persist. The user should be advised to close the browser as a fallback.

---

## Acceptance Criteria
- [ ] Signing out invalidates the session server-side; subsequent requests with the old session identifier are rejected.
- [ ] Signing out clears client-side session identifiers.
- [ ] After signing out, the user is redirected to the sign-in page or a signed-out state.
- [ ] Navigating back in the browser after sign-out does not restore access to protected content.
- [ ] If the user is a facilitator mid-session, they receive a warning before sign-out completes.

## Out of Scope
- Single log-out from the identity provider (signing out of the identity provider itself) — the application terminates its own session only.
- Automatic session expiry — that is a separate system behavior not initiated by the user.

## Dependencies
- UC: Sign In — the inverse of this use case.

## Notes
- Whether sign-out propagates to the identity provider (global sign-out / single log-out) is an implementation decision with security implications. At minimum, the application's own session must be invalidated.
- The behavior of an active session when its facilitator signs out mid-session should be explicitly resolved before implementation.

---

# Use Case: Session Expiry (Automatic Sign-Out)

## Summary
**Actor:** Application

**Trigger:** An authenticated user's session reaches its maximum idle duration or absolute expiry time without explicit sign-out.

**Goal:** As the application, I want to automatically expire inactive sessions so that unattended accounts are not left accessible.

---

## Preconditions
- The user has an authenticated session.
- The session has been idle for the configured maximum period, or its absolute lifetime has elapsed.

## Main Flow
1. The application detects that the session has expired (on the next request from the client, or via a background check).
2. The application invalidates the session server-side.
3. On the user's next interaction with the application, the application detects no valid session.
4. The application redirects the user to the sign-in flow.

## Alternate Flows
- **User is actively using the application:** The application refreshes the session expiry timer on each authenticated request, preventing expiry during active use.
- **User is a facilitator mid-session when expiry occurs:** The session expires and the facilitator loses control of the session. The behavior of a live session without an authenticated facilitator is an implementation concern that should be resolved.

## Postconditions
- **Success:** The expired session is invalidated. The user must re-authenticate to continue.
- **Failure:** If expiry detection fails, a stale session may persist. This is a security concern and should be monitored.

---

## Acceptance Criteria
- [ ] Sessions that exceed the idle timeout are invalidated server-side.
- [ ] After session expiry, any request using the expired session identifier is rejected and the user is redirected to sign-in.
- [ ] Active sessions are not expired prematurely due to normal application use.
- [ ] Session expiry does not result in loss of unsaved data without appropriate warning to the user.
- [ ] Sessions must support a maximum lifetime of 90 minutes to accommodate extended sessions without requiring re-authentication.

## Out of Scope
- Configuring the expiry duration — that is an operational/infrastructure concern.
- Notifying the user in advance that their session is about to expire — this may be a desirable enhancement but is not required here.

## Dependencies
- UC: Sign In — required to re-establish access after expiry.

## Notes
- The session expiry duration must support the full range of session lengths: 30 minutes for a standard session, up to 90 minutes for extended sessions. A short expiry could interrupt active sessions.
- A facilitator mid-session losing their session due to expiry is a high-impact failure mode. The implementation must ensure session lifetime is sufficient to cover a full session — up to 90 minutes — without requiring re-authentication. For sessions longer than the OIDC token lifetime, a token refresh strategy must be implemented to maintain the session without interruption.
