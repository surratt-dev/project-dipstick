# Feature Set 7: Authentication & Access Control

This document contains use cases for authentication, role management, team membership, and permission-based access control for the Engineering Health Check Application.

---

# Use Case: UC-1 - Authenticate with Microsoft Entra ID

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User navigates to the application or initiates a login action

**Goal:** As a user, I want to authenticate using Microsoft Entra ID so that I can securely access the Engineering Health Check Application with my corporate credentials.

---

## Preconditions
- User has a valid Microsoft Entra ID (Azure AD) account
- User's account is registered in the application's tenant
- Application is configured with Microsoft Entra ID as the identity provider

## Main Flow
1. User navigates to the application URL
2. System detects user is not authenticated and redirects to Microsoft Entra ID login
3. User enters their corporate credentials on the Microsoft login page
4. Microsoft Entra ID validates credentials and returns an authorization code
5. System exchanges authorization code for access token and refresh token
6. System retrieves user profile information from Microsoft Graph API (email, display name, department)
7. System creates or updates user record in application database
8. System establishes authenticated session and redirects user to dashboard

## Alternate Flows
- **User has existing valid session:** System detects valid session token and allows access without re-authentication
- **User cancels login:** User abandons Microsoft login page; system redirects back to login page with error message
- **User credentials are invalid:** Microsoft returns authentication error; system displays "Invalid credentials" message and allows retry
- **User account is not in application tenant:** Microsoft authenticates successfully but system rejects access; system displays "Access denied - Your account is not authorized"

## Postconditions
- **Success:** User is authenticated with valid session token; user record exists in database with Entra ID identifier
- **Failure:** User remains on login page; error message displayed

---

## Acceptance Criteria
- [ ] User can authenticate using Microsoft Entra ID credentials
- [ ] Invalid credentials display appropriate error message
- [ ] Session persists across browser refreshes (within token expiry)
- [ ] User profile information (name, email) is retrieved from Entra ID
- [ ] Authentication failures are logged for security monitoring

## Out of Scope
- Multi-factor authentication configuration (handled by Microsoft Entra ID)
- Password reset functionality (handled by Microsoft Entra ID)
- Guest user access configuration

## Dependencies
- Microsoft Entra ID tenant configuration
- Application registration in Microsoft Entra ID
- Network connectivity to Microsoft identity services

## Notes
- Access token refresh should occur silently before expiry
- Session timeout should align with corporate IT policies
- Application must handle token revocation scenarios

---

# Use Case: UC-2 - Handle Session Token Refresh

## Summary
**Actor:** System (Application)

**Trigger:** Access token is approaching expiration (within 5 minutes)

**Goal:** As the System, I want to automatically refresh the access token so that the user experience remains uninterrupted.

---

## Preconditions
- User is authenticated with valid refresh token
- Refresh token has not expired
- Network connectivity to Microsoft Entra ID is available

## Main Flow
1. System detects access token is approaching expiration
2. System sends refresh token to Microsoft Entra ID token endpoint
3. Microsoft Entra ID validates refresh token and returns new access token and refresh token
4. System updates stored tokens in session storage
5. User session continues without interruption

## Alternate Flows
- **Refresh token has expired:** System clears session and redirects user to login
- **Network error during refresh:** System retries up to 3 times; on failure, redirects to login
- **Microsoft Entra ID revokes tokens:** System detects invalid token response and redirects to login

## Postconditions
- **Success:** New access token and refresh token are stored; user session continues
- **Failure:** User session is terminated; user must re-authenticate

---

## Acceptance Criteria
- [ ] Token refresh occurs automatically before expiration
- [ ] User is not required to re-authenticate during token refresh
- [ ] Expired refresh token redirects to login page
- [ ] Token refresh failures are handled gracefully

## Out of Scope
- Token refresh when user is inactive (tokens still expire)

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID

---

# Use Case: UC-3 - Logout from Application

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User clicks logout button or session expires

**Goal:** As a user, I want to logout from the application so that my session is terminated and my device is secure.

---

## Preconditions
- User is currently authenticated

## Main Flow
1. User clicks logout button (or session expires)
2. System sends logout request to Microsoft Entra ID (optional single logout)
3. System clears all session tokens and user data from client
4. System redirects user to login page
5. User session is terminated

## Alternate Flows
- **Network error during logout:** System clears local session regardless; user is logged out locally

## Postconditions
- **Success:** User session is terminated; user redirected to login page
- **Failure:** Local session cleared; user may need to manually clear cookies

---

## Acceptance Criteria
- [ ] Clicking logout terminates the session
- [ ] All session data is cleared from client
- [ ] User is redirected to login page after logout
- [ ] Previous session cannot be resumed without re-authentication

## Out of Scope
- Revoking refresh token from Microsoft Entra ID (optional SLO)

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID

---

# Use Case: UC-4 - View Assigned Role and Permissions

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User wants to understand their access level

**Goal:** As a user, I want to view my assigned role and permissions so that I understand what actions I can perform in the application.

---

## Preconditions
- User is authenticated
- User has been assigned a role in the system

## Main Flow
1. User navigates to profile or settings page
2. System retrieves user's role assignment from database
3. System displays user's role (Participant, Facilitator, or Engineering Manager)
4. System displays permissions associated with user's role

## Alternate Flows
- **User has no role assigned:** System assigns default "Participant" role and displays this
- **User has multiple roles:** System displays all assigned roles; most permissive role determines access

## Postconditions
- **Success:** User can view their role and associated permissions

---

## Acceptance Criteria
- [ ] User's current role is displayed
- [ ] Permissions list shows what the user can and cannot do
- [ ] Role is visible on user profile page

## Out of Scope
- Role assignment functionality (UC-5)

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID

---

# Use Case: UC-5 - Assign Role to User

## Summary
**Actor:** System (Application)

**Trigger:** New user authenticates for the first time or role sync occurs from Microsoft Entra ID

**Goal:** As the System, I want to assign roles to users based on Entra ID group membership so that users have appropriate access to the application.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- Microsoft Entra ID groups are mapped to application roles
- Application has role-group mapping configuration

## Main Flow
1. User authenticates via Microsoft Entra ID (first time or recurring)
2. System retrieves user's group memberships from Microsoft Graph API
3. System compares user's groups against configured role-group mappings
4. System maps groups to application roles:
   - "EHC-Facilitators" group → Facilitator role
   - "EHC-Engineering-Managers" group → Engineering Manager role
   - No matching group → Participant role (default)
5. System assigns or updates user's role in database
6. User is granted permissions based on assigned role

## Alternate Flows
- **User is member of multiple role groups:** System assigns highest permission role (Engineering Manager > Facilitator > Participant)
- **Group mapping is misconfigured:** System defaults to Participant role and logs warning
- **Microsoft Graph API unavailable:** System uses cached group membership if available; otherwise defaults to Participant

## Postconditions
- **Success:** User has appropriate role assigned based on Entra ID group membership
- **Failure:** User is assigned default Participant role

---

## Acceptance Criteria
- [ ] Users in "EHC-Facilitators" group are assigned Facilitator role
- [ ] Users in "EHC-Engineering-Managers" group are assigned Engineering Manager role
- [ ] Users not in any mapped group are assigned Participant role
- [ ] Role changes in Entra ID are reflected on next authentication
- [ ] Role assignment is logged for audit purposes

## Out of Scope
- Manual role assignment by administrators
- Role change notifications to users

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- Microsoft Entra ID group configuration

## Notes
- Role sync happens at authentication time; no real-time sync from Entra ID
- Consider implementing a scheduled sync job for existing users

---

# Use Case: UC-6 - View Teams I Belong To

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User wants to see their team memberships

**Goal:** As a user, I want to view the teams I belong to so that I can access relevant sessions and health data.

---

## Preconditions
- User is authenticated

## Main Flow
1. User navigates to "My Teams" or dashboard
2. System retrieves user's team memberships from database
3. System displays list of teams with name and role in each team

## Alternate Flows
- **User belongs to no teams:** System displays message "You are not a member of any teams. Contact your manager to be added."

## Postconditions
- **Success:** User can view list of teams they belong to

---

## Acceptance Criteria
- [ ] All teams user is a member of are displayed
- [ ] User's role in each team is shown
- [ ] Empty state is displayed when user has no team memberships

## Out of Scope
- Creating teams
- Joining teams (self-service)

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- UC-10: Manage Team Membership

---

# Use Case: UC-7 - Join Team via Microsoft Entra ID Group Sync

## Summary
**Actor:** System (Application)

**Trigger:** Scheduled or on-demand sync with Microsoft Entra ID groups

**Goal:** As the System, I want to automatically add users to teams based on their Entra ID group membership so that team membership stays current with organizational structure.

---

## Preconditions
- Microsoft Entra ID groups are configured for team membership
- Application has team-to-group mappings configured
- Application has necessary permissions to read group memberships from Microsoft Graph

## Main Flow
1. System triggers team sync (scheduled or manual)
2. System retrieves all team-to-group mappings from configuration
3. For each mapped group, system retrieves current members from Microsoft Graph API
4. System adds users to corresponding teams in database
5. System removes users from teams that no longer belong to mapped group
6. System logs sync results and any discrepancies

## Alternate Flows
- **User already in team:** System skips adding; no duplicate created
- **Team does not exist in application:** System logs warning and skips group mapping
- **Microsoft Graph API error:** System retries up to 3 times; on continued failure, logs error and skips sync for that group

## Postconditions
- **Success:** Team memberships reflect current Microsoft Entra ID group membership
- **Failure:** Partial sync completed; errors logged for review

---

## Acceptance Criteria
- [ ] Users are added to teams based on Entra ID group membership
- [ ] Users are removed from teams when removed from Entra ID group
- [ ] Sync runs on schedule (recommended: every 15 minutes)
- [ ] Sync can be triggered manually by administrators
- [ ] Sync results are logged

## Out of Scope
- Manual team membership management
- Creating teams via sync

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- Microsoft Entra ID group configuration

---

# Use Case: UC-8 - Manually Add User to Team

## Summary
**Actor:** Engineering Manager

**Trigger:** Engineering Manager needs to add a user to their team

**Goal:** As an Engineering Manager, I want to manually add a user to my team so that they can participate in Health Check sessions.

---

## Preconditions
- User is authenticated as Engineering Manager
- Engineering Manager has an active team in the system
- Target user exists in the application (has authenticated before)

## Main Flow
1. Engineering Manager navigates to team management page
2. Engineering Manager clicks "Add Member"
3. Engineering Manager searches for user by name or email
4. System displays matching users
5. Engineering Manager selects user to add
6. System adds user to team with Participant role
7. System confirms addition to Engineering Manager
8. Target user is notified of team addition (optional)

## Alternate Flows
- **User does not exist in system:** System displays message "User not found. User must first sign in to the application."
- **User is already in team:** System displays message "User is already a member of this team"
- **Engineering Manager has no team:** System displays message "You must have an active team to add members"

## Postconditions
- **Success:** User is added to team and can access team sessions
- **Failure:** User is not added; error message displayed

---

## Acceptance Criteria
- [ ] Engineering Manager can search for users by name or email
- [ ] Selected user is added to Engineering Manager's team
- [ ] Added user receives appropriate permissions for the team
- [ ] Duplicate memberships are prevented
- [ ] User is notified of team addition (email or in-app notification)

## Out of Scope
- Adding users to multiple teams simultaneously
- Bulk import of team members

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- UC-4: View Assigned Role and Permissions

---

# Use Case: UC-9 - Remove User from Team

## Summary
**Actor:** Engineering Manager

**Trigger:** Engineering Manager needs to remove a user from their team

**Goal:** As an Engineering Manager, I want to remove a user from my team so that they no longer have access to team sessions and data.

---

## Preconditions
- User is authenticated as Engineering Manager
- Engineering Manager has an active team in the system
- Target user is a member of the Engineering Manager's team

## Main Flow
1. Engineering Manager navigates to team management page
2. Engineering Manager views list of team members
3. Engineering Manager selects user to remove
4. Engineering Manager confirms removal
5. System removes user from team
6. System confirms removal to Engineering Manager

## Alternate Flows
- **User has active session in progress:** System warns Engineering Manager; session data remains but user cannot rejoin
- **Engineering Manager tries to remove themselves:** System prevents self-removal; must transfer management first

## Postconditions
- **Success:** User is removed from team; no longer has access to team sessions
- **Failure:** User remains in team; error message displayed

---

## Acceptance Criteria
- [ ] Engineering Manager can view all team members
- [ ] Selected user is removed from team
- [ ] Removed user loses access to team sessions
- [ ] Removal is confirmed with success message

## Out of Scope
- Removing users from multiple teams simultaneously

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- UC-8: Manually Add User to Team

---

# Use Case: UC-10 - Leave Team

## Summary
**Actor:** Participant

**Trigger:** Participant wants to leave a team they belong to

**Goal:** As a Participant, I want to leave a team so that I am no longer a member and no longer receive notifications or have access to team data.

---

## Preconditions
- User is authenticated as Participant (or any role)
- User is a member of the team

## Main Flow
1. Participant navigates to "My Teams" page
2. Participant selects team to leave
3. Participant clicks "Leave Team"
4. System prompts for confirmation
5. Participant confirms
6. System removes user from team
7. System confirms removal to user

## Alternate Flows
- **User is the only manager:** System warns that team will be without manager; requires explicit confirmation
- **User is the only member:** System warns that team will be deleted; requires explicit confirmation

## Postconditions
- **Success:** User is removed from team
- **Failure:** User remains in team; error message displayed

---

## Acceptance Criteria
- [ ] Participant can leave any team they belong to
- [ ] Confirmation dialog prevents accidental departure
- [ ] User loses access to team immediately upon leaving

## Out of Scope
- Leaving teams where user is the only Engineering Manager

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- UC-6: View Teams I Belong To

---

# Use Case: UC-11 - Access Session Based on Role

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User attempts to access a Health Check session

**Goal:** As a user, I want to access sessions appropriate to my role so that I can perform my responsibilities.

---

## Preconditions
- User is authenticated
- User has been assigned a role

## Main Flow
1. User attempts to access a session (via URL, link, or dashboard)
2. System identifies user's role and team membership
3. System checks permissions based on role:
   - **Participant:** Can access if member of the session's team; can participate in active sessions
   - **Facilitator:** Can access if assigned as facilitator; can manage session
   - **Engineering Manager:** Can access results after session concludes
4. System grants or denies access based on permission check

## Alternate Flows
- **User is not a team member:** System displays "You do not have access to this session"
- **Session is active but user is not a participant:** System displays "You are not a participant in this active session"
- **Engineering Manager accesses active session:** System redirects to message "Managers cannot view active sessions to ensure participant anonymity"
- **User has no role:** System assigns default Participant role and checks team membership

## Postconditions
- **Success:** User can access session features appropriate to their role
- **Failure:** Access denied; appropriate message displayed

---

## Acceptance Criteria
- [ ] Participants can access sessions for their team
- [ ] Facilitators can access sessions they are assigned to
- [ ] Engineering Managers cannot access active sessions
- [ ] Engineering Managers can access concluded session results
- [ ] Unauthorized access attempts are logged

## Out of Scope
- Session creation (covered in other feature sets)

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- UC-5: Assign Role to User
- UC-6: View Teams I Belong To

---

# Use Case: UC-12 - View Session Results Based on Role

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User attempts to view Health Check session results

**Goal:** As a user, I want to view session results appropriate to my role so that I can understand team health metrics.

---

## Preconditions
- User is authenticated
- Session has concluded

## Main Flow
1. User navigates to session results
2. System identifies user's role
3. System determines visibility level based on role:
   - **Participant:** Sees aggregate results only (no individual votes)
   - **Facilitator:** Sees aggregate results and action items
   - **Engineering Manager:** Sees complete results including individual votes and full details
4. System displays results appropriate to role

## Alternate Flows
- **Session still active:** Participant sees "Voting in progress"; Facilitator sees live vote counts; Engineering Manager redirected to results available after conclusion
- **User is not a team member:** No results displayed; access denied message

## Postconditions
- **Success:** User views session results at their permission level
- **Failure:** Access denied; message displayed

---

## Acceptance Criteria
- [ ] Participants see aggregate team health scores and trends
- [ ] Facilitators see aggregate results plus action items
- [ ] Engineering Managers see complete results including individual votes
- [ ] Role-based visibility is enforced in API responses
- [ ] Active session results are not accessible to Engineering Managers

## Out of Scope
- Historical trend visualization
- Export functionality for results

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- UC-11: Access Session Based on Role

---

# Use Case: UC-13 - Request Facilitator Role

## Summary
**Actor:** Participant

**Trigger:** Participant wants to become a Facilitator

**Goal:** As a Participant, I want to request a Facilitator role so that I can lead Health Check sessions.

---

## Preconditions
- User is authenticated as Participant

## Main Flow
1. Participant navigates to profile or role settings
2. Participant clicks "Request Facilitator Role"
3. Participant fills out request form (experience, motivation)
4. System submits request to administrators
5. System displays confirmation "Your request has been submitted"
6. Administrator reviews and approves/rejects request
7. System notifies user of decision

## Alternate Flows
- **User already has Facilitator role:** System displays "You already have Facilitator role"
- **Request is rejected:** System notifies user with reason; user can submit another request after 30 days

## Postconditions
- **Success:** Request is submitted for administrator review
- **Failure:** Request is not submitted; error message displayed

---

## Acceptance Criteria
- [ ] Participant can submit Facilitator role request
- [ ] Request includes justification/motivation field
- [ ] User receives notification of approval/rejection
- [ ] Rejected users can reapply after 30 days
- [ ] Facilitator role is assigned upon approval

## Out of Scope
- Self-service role upgrade without approval

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- UC-4: View Assigned Role and Permissions

---

# Use Case: UC-14 - Handle Unauthorized Access Attempt

## Summary
**Actor:** System (Application)

**Trigger:** User attempts to access a resource they are not authorized for

**Goal:** As the System, I want to handle unauthorized access attempts gracefully so that users understand why access was denied.

---

## Preconditions
- User is authenticated

## Main Flow
1. User attempts to access restricted resource or performs unauthorized action
2. System checks user permissions
3. System determines access is denied
4. System returns 403 Forbidden or redirects to appropriate page
5. System displays message explaining why access was denied
6. System logs the unauthorized access attempt

## Alternate Flows
- **User is not authenticated:** System redirects to login page
- **Session has expired:** System redirects to login with "Session expired" message

## Postconditions
- **Success:** User sees access denied message; attempt is logged
- **Failure:** N/A

---

## Acceptance Criteria
- [ ] Access denied message is clear and helpful
- [ ] User is provided option to request access if appropriate
- [ ] Unauthorized attempts are logged with user ID, resource, and timestamp
- [ ] Repeated unauthorized attempts from same user trigger account review (after 5 attempts in 1 hour)

## Out of Scope
- Rate limiting (handled by infrastructure)
- Account lockout functionality

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID

---

# Use Case: UC-15 - Manage Team as Engineering Manager

## Summary
**Actor:** Engineering Manager

**Trigger:** Engineering Manager needs to manage their team's settings

**Goal:** As an Engineering Manager, I want to manage my team's settings so that I can ensure my team is properly configured for Health Check sessions.

---

## Preconditions
- User is authenticated as Engineering Manager
- User has an active team

## Main Flow
1. Engineering Manager navigates to team management page
2. Engineering Manager views current team settings (name, description, members)
3. Engineering Manager can modify:
   - Team name and description
   - Add/remove team members (UC-8, UC-9)
   - Set team meeting schedule (optional)
4. System saves changes
5. System confirms changes to Engineering Manager

## Alternate Flows
- **Engineering Manager has no team:** System prompts to create team or link to existing team via Entra ID group
- **User lacks permission to edit:** Only team admins can modify team settings

## Postconditions
- **Success:** Team settings are updated
- **Failure:** Changes not saved; error message displayed

---

## Acceptance Criteria
- [ ] Engineering Manager can view team details
- [ ] Engineering Manager can edit team name and description
- [ ] Engineering Manager can add/remove team members
- [ ] Changes are saved and reflected immediately
- [ ] Audit log records team configuration changes

## Out of Scope
- Creating new teams from scratch (must link to Entra ID group)
- Deleting teams

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- UC-8: Manually Add User to Team
- UC-9: Remove User from Team

---

# Use Case: UC-16 - View Team Members

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator needs to see who is in a team they are facilitating

**Goal:** As a Facilitator, I want to view team members so that I can prepare for Health Check sessions.

---

## Preconditions
- User is authenticated as Facilitator
- Facilitator is assigned to a team for facilitation

## Main Flow
1. Facilitator navigates to team dashboard
2. System displays list of team members
3. System shows member names, roles, and last active date

## Alternate Flows
- **Facilitator is not assigned to team:** System displays "No team assigned for facilitation"

## Postconditions
- **Success:** Facilitator can view team members

---

## Acceptance Criteria
- [ ] Facilitator can see all members of their assigned team
- [ ] Member list shows names and roles
- [ ] Facilitator cannot see individual voting history before session concludes

## Out of Scope
- Modifying team membership (Engineering Manager only)

## Dependencies
- UC-1: Authenticate with Microsoft Entra ID
- UC-6: View Teams I Belong To

---

# Use Case: UC-17 - Permission Matrix Reference

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User wants to understand what actions they can perform

**Goal:** As a user, I want to understand the permission matrix so that I know my access rights across the application.

---

## Preconditions
- User is authenticated

## Main Flow
1. User navigates to help or permissions page
2. System displays permission matrix by role:
   | Permission | Participant | Facilitator | Engineering Manager |
   |------------|-------------|-------------|---------------------|
   | Participate in team sessions | ✓ | ✓ | - |
   | View own team's aggregate results | ✓ | ✓ | ✓ |
   | View complete results (after session) | - | ✓ | ✓ |
   | View individual votes | - | - | ✓ |
   | Create/manage sessions | - | ✓ | - |
   | Assign action items | - | ✓ | - |
   | Add/remove team members | - | - | ✓ |
   | View team trends | ✓ | ✓ | ✓ |
   | Request Facilitator role | ✓ | - | - |

## Postconditions
- **Success:** User can view permission matrix

---

## Acceptance Criteria
- [ ] Permission matrix is accessible from help/documentation section
- [ ] Current user's permissions are highlighted
- [ ] Matrix is accurate and matches implemented permissions

## Out of Scope
- Custom permissions per user (role-based only)

## Dependencies
- UC-4: View Assigned Role and Permissions
