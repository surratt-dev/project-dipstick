# Feature Set 2: Topic Management

---

# Use Case: Access Default Health Check Topics

## Summary
**Actor:** Participant, Facilitator, Engineering Manager

**Trigger:** User navigates to a session or topic management view

**Goal:** As a user, I want to access the default health check topics so that I can participate in or review sessions with standard topics.

---

## Preconditions
- User is authenticated via Microsoft Entra ID
- User has appropriate role (Participant, Facilitator, or Engineering Manager)
- Application has been initialized with default topics

## Main Flow
1. User navigates to a Health Check session or topic configuration view
2. System retrieves the list of topics configured for the session or organization
3. System displays the topics in the configured order with titles and descriptions
4. User can view topic details including any associated guidance or questions

## Alternate Flows
- **No topics configured:** System displays message indicating no topics are available
- **Session not started:** User views topics in read-only mode (for Facilitators/Participants in pre-session view)

## Postconditions
- **Success:** Topics are displayed to the user with appropriate metadata
- **Failure:** Error message displayed; user remains on previous screen

## Acceptance Criteria
- [ ] Default topics are visible to all authorized roles
- [ ] Topics display title, description, and any guidance text
- [ ] Topics are ordered according to configuration
- [ ] Real-time updates propagate to all connected clients

## Out of Scope
- Custom topic creation (separate use case)
- Topic reordering (separate use case)

## Dependencies
- Authentication (via Microsoft Entra ID)
- Session management
- Topic data persistence

## Notes
- Default topics are system-defined and cannot be deleted, only hidden or reordered
- Engineering Managers can only view default topics, not modify them

---

# Use Case: Initialize Default Topics

## Summary
**Actor:** System

**Trigger:** Application first-time setup or tenant initialization

**Goal:** As the System, I want to initialize default health check topics so that new organizations have standard topics available.

---

## Preconditions
- Application database is accessible
- Organization/tenant has been created
- System has default topic definitions available

## Main Flow
1. System detects new organization or first-time initialization
2. System loads predefined default topic definitions from configuration
3. System creates topic records in the database associated with the organization
4. System marks topics as default and non-deletable
5. System confirms successful initialization

## Alternate Flows
- **Organization already has topics:** System skips initialization
- **Database unavailable:** System logs error and retries with exponential backoff

## Postconditions
- **Success:** Default topics exist in the database for the organization
- **Failure:** Initialization pending flag remains; retry mechanism active

## Acceptance Criteria
- [ ] All default topics are created with correct metadata
- [ ] Topics are marked as system default
- [ ] Topics are available for all session types within the organization
- [ ] Initialization can be re-run without duplicating topics

## Out of Scope
- Custom topic creation
- Topic presets management

## Dependencies
- Database connectivity
- Organization/tenant management

## Notes
- Default topics should be customizable (title/description) but not deletable
- Consider localization support for default topic content

---

# Use Case: Create Custom Topic

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "Add Topic" in topic management interface

**Goal:** As a Facilitator, I want to create a custom health check topic so that I can address team-specific issues or add relevant discussion points.

---

## Preconditions
- User is authenticated as Facilitator
- User has an active session or is configuring a session template
- User has permission to modify topics for the session/team

## Main Flow
1. Facilitator navigates to topic management within a session or template
2. Facilitator clicks "Add Custom Topic" button
3. System displays a form with fields: Title, Description, Guidance (optional), Category (optional)
4. Facilitator enters the topic details
5. Facilitator clicks "Save"
6. System validates the input (title is required, max length limits)
7. System creates the custom topic record
8. System displays the new topic in the topic list
9. System confirms success with a toast notification

## Alternate Flows
- **Validation failure:** System displays inline validation errors; Facilitator corrects and re-submits
- **Duplicate topic:** System warns that a similar topic exists; Facilitator confirms or cancels
- **Permission denied:** System redirects to access denied page

## Postconditions
- **Success:** Custom topic is created and visible in the topic list
- **Failure:** Topic is not created; user remains on creation form with error message

## Acceptance Criteria
- [ ] Custom topic is saved to the database with all provided fields
- [ ] Topic appears in the session/topic list immediately
- [ ] Topic can be edited after creation
- [ ] Custom topics are clearly distinguished from default topics
- [ ] Real-time sync updates all connected clients

## Out of Scope
- Creating topic presets/templates (separate use case)
- Bulk topic import

## Dependencies
- Authentication and authorization
- Topic data persistence
- Real-time synchronization

## Notes
- Custom topics can be deleted by the Facilitator who created them
- Consider allowing custom topics to be marked as "reusable" across sessions

---

# Use Case: Edit Custom Topic

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "Edit" on a custom topic

**Goal:** As a Facilitator, I want to edit a custom health check topic so that I can update details or correct information.

---

## Preconditions
- User is authenticated as Facilitator
- Topic exists and is marked as custom (not system default)
- User has permission to edit the topic

## Main Flow
1. Facilitator navigates to topic management view
2. Facilitator locates the custom topic to edit
3. Facilitator clicks the "Edit" icon/button on the topic
4. System displays a pre-populated form with current topic values
5. Facilitator modifies the desired fields
6. Facilitator clicks "Save"
7. System validates the input
8. System updates the topic record in the database
9. System displays the updated topic in the list
10. System confirms success with a toast notification

## Alternate Flows
- **Editing default topic:** System prevents editing of system default topics; displays message
- **Concurrent edit:** System detects conflict; prompts user to reload or overwrite
- **Validation failure:** System displays inline errors

## Postconditions
- **Success:** Topic is updated with new values; all clients see the changes
- **Failure:** Topic remains unchanged; error displayed to user

## Acceptance Criteria
- [ ] All editable fields can be modified
- [ ] Changes are persisted to the database
- [ ] Changes are visible to all users with topic access
- [ ] Default topics cannot be edited (only hidden/reordered)
- [ ] Edit history is not required but recommended for audit

## Out of Scope
- Deleting topics (separate use case)
- Reordering topics (separate use case)

## Dependencies
- Authentication and authorization
- Topic data persistence
- Real-time synchronization

## Notes
- Consider implementing soft-delete rather than hard-delete for audit purposes
- Changes to topics mid-session should be handled carefully (avoid confusion)

---

# Use Case: Delete Custom Topic

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator clicks "Delete" on a custom topic

**Goal:** As a Facilitator, I want to delete a custom health check topic so that I can remove irrelevant or obsolete topics from the session.

---

## Preconditions
- User is authenticated as Facilitator
- Topic exists and is marked as custom (not system default)
- User has permission to delete the topic

## Main Flow
1. Facilitator navigates to topic management view
2. Facilitator locates the custom topic to delete
3. Facilitator clicks the "Delete" icon/button on the topic
4. System displays a confirmation dialog with warning: "This action cannot be undone"
5. Facilitator confirms deletion
6. System removes the topic from the database (soft delete)
7. System removes the topic from the topic list
8. System confirms success with a toast notification

## Alternate Flows
- **Deleting default topic:** System displays message "Default topics cannot be deleted; you can hide them instead"
- **Topic in active session:** System warns that topic is in use; requires confirmation or redirects to session management
- **Cancel deletion:** Facilitator clicks "Cancel"; no changes made

## Postconditions
- **Success:** Topic is deleted; removed from lists and future sessions
- **Failure:** Topic remains; error displayed to user

## Acceptance Criteria
- [ ] Custom topics can be deleted by authorized Facilitators
- [ ] Default topics cannot be deleted
- [ ] Confirmation dialog appears before deletion
- [ ] Deletion is reflected in real-time across all clients
- [ ] Past sessions retain the topic in their history

## Out of Scope
- Bulk deletion
- Restoring deleted topics (may be considered for future)

## Dependencies
- Authentication and authorization
- Topic data persistence
- Session topic associations

## Notes
- Soft-delete is recommended to preserve historical data in completed sessions
- Consider implementing a "hidden" status as an alternative to deletion for default topics

---

# Use Case: View Custom Topics

## Summary
**Actor:** Participant, Engineering Manager

**Trigger:** User navigates to a session or topic configuration view

**Goal:** As a Participant or Engineering Manager, I want to view custom topics so that I can understand what will be discussed or reviewed.

---

## Preconditions
- User is authenticated with appropriate role
- Custom topics exist for the session or organization

## Main Flow
1. User navigates to the Health Check session view or topic overview
2. System retrieves both default and custom topics
3. System displays topics in the configured order
4. Custom topics are visually identified (e.g., badge or icon)
5. User can view topic details including title, description, and guidance

## Alternate Flows
- **No custom topics:** Only default topics are displayed
- **Session not started:** Participant sees topics in read-only mode

## Postconditions
- **Success:** Custom topics are displayed alongside default topics
- **Failure:** Error message displayed

## Acceptance Criteria
- [ ] Custom topics are visible to authorized users
- [ ] Custom topics are distinguished from default topics
- [ ] Topic ordering is respected
- [ ] Real-time updates are received when topics change

## Out of Scope
- Creating or editing topics (Facilitator-only)
- Topic presets management

## Dependencies
- Authentication and authorization
- Topic data persistence

## Notes
- Participants cannot modify topics, only view them
- Engineering Managers view topics for awareness but cannot modify them

---

# Use Case: Reorder Topics

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator initiates drag-and-drop or uses reorder controls

**Goal:** As a Facilitator, I want to reorder health check topics so that I can prioritize discussion items or customize the session flow.

---

## Preconditions
- User is authenticated as Facilitator
- User is configuring or managing a session or template
- At least one topic exists

## Main Flow
1. Facilitator navigates to topic management or session setup
2. Facilitator views the current topic order
3. Facilitator drags a topic to a new position OR uses up/down controls
4. System updates the display order in real-time
5. System highlights the new position
6. Facilitator confirms the new order (or auto-saves)
7. System persists the new order to the database
8. System confirms success with a toast notification

## Alternate Flows
- **Active session reordering:** System warns that reordering during an active session may confuse participants; requires confirmation
- **Concurrent reorder:** System resolves conflict using last-write-wins or notifies user
- **Invalid position:** System rejects invalid drop targets

## Postconditions
- **Success:** Topic order is updated and persisted; reflected in all views
- **Failure:** Order remains unchanged; error displayed

## Acceptance Criteria
- [ ] Topics can be reordered via drag-and-drop
- [ ] Topics can be reordered via up/down controls
- [ ] New order persists across page reloads
- [ ] Order is respected in live sessions
- [ ] All connected clients see the new order in real-time

## Out of Scope
- Bulk reorder operations
- Saving reorder as a preset

## Dependencies
- Authentication and authorization
- Topic data persistence
- Real-time synchronization
- Session state management

## Notes
- Consider allowing different topic orders for different sessions/templates
- The order should be session-specific or template-specific, not global

---

# Use Case: Apply Topic Preset

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator selects a topic preset to apply

**Goal:** As a Facilitator, I want to apply a topic preset so that I can quickly configure a session with a pre-defined set of topics.

---

## Preconditions
- User is authenticated as Facilitator
- At least one topic preset exists
- User is creating or configuring a new session

## Main Flow
1. Facilitator navigates to session creation or template configuration
2. Facilitator clicks "Apply Preset" or "Load Template"
3. System displays a list of available topic presets with names and descriptions
4. Facilitator selects a preset
5. System displays the topics included in the preset
6. Facilitator confirms the selection
7. System populates the session/template with the preset topics
8. System displays the applied topics in the topic list
9. System confirms success with a notification

## Alternate Flows
- **No presets available:** System displays message "No presets available; create one first"
- **Confirm replacement:** System warns if applying preset will replace existing topics; requires confirmation
- **Preset with missing topics:** System indicates which topics from preset are unavailable

## Postconditions
- **Success:** Session/template is populated with preset topics
- **Failure:** No changes made; user remains on preset selection

## Acceptance Criteria
- [ ] All available presets are displayed with names and descriptions
- [ ] Preset topics are applied correctly
- [ ] Existing topics can be replaced or merged based on configuration
- [ ] Applied preset topics can be further customized
- [ ] Real-time updates propagate to all views

## Out of Scope
- Creating new presets (separate use case)
- Editing presets (separate use case)

## Dependencies
- Preset data persistence
- Topic data persistence
- Real-time synchronization

## Notes
- Presets should include both default and custom topics
- Consider allowing presets to be session-type specific

---

# Use Case: Create Topic Preset

## Summary
**Actor:** Facilitator, Engineering Manager

**Trigger:** User clicks "Create Preset" in preset management

**Goal:** As a Facilitator or Engineering Manager, I want to create a topic preset so that I can save a reusable configuration of topics for future sessions.

---

## Preconditions
- User is authenticated as Facilitator or Engineering Manager
- User has permission to manage presets for the organization
- Topics exist to include in the preset

## Main Flow
1. User navigates to preset management or topic configuration
2. User clicks "Create Preset" button
3. System displays a form: Preset Name, Description, Select Topics
4. User enters preset name and description
5. User selects topics from available list (checkboxes or multi-select)
6. User can reorder selected topics within the preset
7. User clicks "Save Preset"
8. System validates input (name required, at least one topic)
9. System creates the preset record with associated topics
10. System confirms success with a toast notification

## Alternate Flows
- **No topics selected:** System displays validation error
- **Duplicate preset name:** System warns; user confirms or renames
- **Permission denied:** System redirects to access denied

## Postconditions
- **Success:** Preset is created and available for use
- **Failure:** Preset not created; error displayed

## Acceptance Criteria
- [ ] Preset is saved with name, description, and topic list
- [ ] Preset appears in preset selection list
- [ ] Preset can be applied to new sessions
- [ ] Preset can be edited after creation
- [ ] Preset can be deleted (unless in use)

## Out of Scope
- Bulk import of presets
- Sharing presets across organizations

## Dependencies
- Authentication and authorization
- Preset data persistence
- Topic data persistence

## Notes
- Engineering Managers may want to create organizational presets for consistency
- Facilitators may want to create team-specific presets
- Consider preset categories (e.g., "Retro", "Quarterly Planning", "Incident Review")

---

# Use Case: Manage Topic Presets

## Summary
**Actor:** Facilitator, Engineering Manager

**Trigger:** User navigates to preset management

**Goal:** As a Facilitator or Engineering Manager, I want to manage topic presets so that I can view, edit, and delete existing presets.

---

## Preconditions
- User is authenticated as Facilitator or Engineering Manager
- User has permission to manage presets

## Main Flow
1. User navigates to "Presets" or "Templates" management section
2. System displays a list of all presets with name, description, topic count, and created date
3. User can perform the following actions:
   - **View:** Click on preset to see included topics
   - **Edit:** Modify preset name, description, or topics
   - **Delete:** Remove a preset (with confirmation)
   - **Duplicate:** Copy an existing preset as a starting point

## Alternate Flows
- **Delete preset in use:** System warns that preset is used by existing sessions; requires strong confirmation
- **No presets exist:** System displays empty state with "Create your first preset" CTA
- **Permission denied:** System shows read-only list or access denied

## Postconditions
- **Success:** Preset changes are persisted and reflected in preset selection
- **Failure:** Changes not saved; error displayed

## Acceptance Criteria
- [ ] All presets are listed with metadata
- [ ] Edit functionality allows modifying all preset fields
- [ ] Delete requires confirmation and warns if preset is in use
- [ ] Duplicate creates a copy with "(Copy)" appended to name
- [ ] Changes propagate to all users in real-time

## Out of Scope
- Sharing presets between organizations
- Version history for presets

## Dependencies
- Authentication and authorization
- Preset data persistence
- Session preset associations
- Real-time synchronization

## Notes
- Consider implementing soft-delete for presets to preserve historical session data
- Engineering Managers may have broader preset management across all teams
- Facilitators may only manage presets for their teams

---

# Use Case: Hide Default Topic

## Summary
**Actor:** Facilitator

**Trigger:** Facilitator toggles visibility on a default topic

**Goal:** As a Facilitator, I want to hide default health check topics so that I can customize which topics appear in a session without deleting them.

---

## Preconditions
- User is authenticated as Facilitator
- User is configuring a session or template
- Default topic exists

## Main Flow
1. Facilitator navigates to topic management in session configuration
2. Facilitator views the list of default topics
3. Facilitator clicks the visibility toggle (eye icon) on a default topic
4. System hides the topic from the session/topic list
5. System persists the visibility state
6. System confirms with visual indicator (strikethrough or hidden section)

## Alternate Flows
- **Topic in active session:** System warns that hiding during session may cause confusion; allows override
- **Re-enable visibility:** Facilitator clicks toggle again; topic reappears

## Postconditions
- **Success:** Topic is hidden from current session view; persists across saves
- **Failure:** Visibility state unchanged; error displayed

## Acceptance Criteria
- [ ] Default topics can be hidden per session/template
- [ ] Hidden topics do not appear in voting or discussion
- [ ] Visibility state persists
- [ ] Hidden topics remain in other sessions where not hidden
- [ ] Visual indication of hidden status is clear

## Out of Scope
- Permanently deleting default topics

## Dependencies
- Topic visibility data per session/template
- Real-time synchronization

## Notes
- Hiding is preferable to deletion for default topics to preserve consistency
- Consider a "Show hidden topics" toggle for easy management

---

# Use Case: View Topic History

## Summary
**Actor:** Engineering Manager

**Trigger:** Engineering Manager selects a topic to view its history

**Goal:** As an Engineering Manager, I want to view topic history so that I can understand how topic scores have changed over time.

---

## Preconditions
- User is authenticated as Engineering Manager
- At least one session has been completed with the topic

## Main Flow
1. Engineering Manager navigates to team health dashboard
2. Manager selects a specific topic or clicks "View History"
3. System retrieves all historical scores for that topic across sessions
4. System displays a trend chart showing topic scores over time
5. System displays session dates and scores in tabular format

## Alternate Flows
- **No historical data:** System displays message "No data available yet; complete a session first"
- **Topic deleted:** System indicates topic is no longer available; shows last known data

## Postconditions
- [ ] Historical data is displayed to the Engineering Manager

## Acceptance Criteria
- [ ] Trend visualization shows topic scores over time
- [ ] Individual session scores are accessible
- [ ] Data can be exported (optional)
- [ ] Access is restricted to Engineering Managers

## Out of Scope
- Modifying historical data
- Comparing topics across different teams

## Dependencies
- Session result data
- Trend calculation service

## Notes
- This use case ensures Engineering Managers can track team improvement over time
- Consider allowing filtering by date range
