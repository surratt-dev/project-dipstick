## MODIFIED Requirements

### Requirement: The add-custom-topic control appears only on an unlocked team for a caller who can add, with no disabled or teaser variant

The screen SHALL render an "Add custom topic" control if and only if `isCustomizationLocked` is `false` **and** `canAddTopics` is `true` in the TOPIC-002 response. In every other case the screen SHALL render no add control at all: no disabled button, no placeholder, and no explanatory note. On a locked team the existing lock notice is the explanation. `canAddTopics` is `true` for every caller TOPIC-002 admits, standing facilitators and application administrators alike, so on an unlocked team an application administrator sees the same add control a facilitator does. This gating is a UX convenience; `POST /api/v1/teams/:teamId/topics` enforces authorization and the lock independently.

Engineers and engineering managers never reach this screen (TOPIC-002 rejects them before it renders), so the use case's "Engineers cannot add topics" criterion is met by the existing access-denied state and its existing scenario "An ineligible caller sees an access-denied state, not the topic list".

#### Scenario: An eligible facilitator on an unlocked team sees the add control
- **WHEN** a standing facilitator views an unlocked team and the response has `canAddTopics: true`
- **THEN** an "Add custom topic" control is shown

#### Scenario: A locked team shows no add control of any kind
- **WHEN** a facilitator views a team whose `isCustomizationLocked` is `true`
- **THEN** no "Add custom topic" control is present in the page, enabled or disabled
- **AND** the existing lock notice is shown

#### Scenario: An administrator on an unlocked team sees the add control
- **WHEN** an application administrator views an unlocked team that has active topics and the response has `canAddTopics: true`
- **THEN** the "Add custom topic" trigger is shown in the Active Topics heading row

#### Scenario: An administrator on a locked team sees no add control
- **WHEN** an application administrator views a team whose `isCustomizationLocked` is `true`
- **THEN** no "Add custom topic" control is present in the page, enabled or disabled
- **AND** the existing lock notice is shown

### Requirement: The add form collects name, prompt, vote type, and an optional description with copy that promises no in-session display

The add form SHALL contain, in this order:

- **Name** (required), helper text exactly "A short label for this screen and trend views.", `maxLength` 100.
- **Prompt** (required), helper text exactly "The question you'll read aloud for people to vote on.", `maxLength` 500.
- **Vote type** (required): a radio group with **no option selected by default**, preceded by the group helper text exactly "You can't change the vote type after the topic is created. Changing it later means removing this topic and adding a new one, which starts a new trend." Each option SHALL show its label and explanation exactly:
  - "Finger Voting": "Everyone shows 1 to 4 fingers, where 1 is poor and 4 is good. There's no middle option, so people have to lean one way."
  - "Roman Voting": "Thumbs up or thumbs down. Use it for yes-or-no questions."
  - "Modified Roman Voting": "Thumbs up, sideways, or down. Use it for whether something is getting better, staying the same, or getting worse."
- **Description**, labelled exactly "Description (optional, shown on this screen only)", helper text exactly "Engineers won't see this during sessions. Use it as a note for whoever facilitates this team. A team definition is the place to explain what this topic means for this team.", `maxLength` 500.

Name, Prompt, and Vote type SHALL be marked required and Description marked optional. Each field SHALL show a character counter once its length reaches 80% of its limit. The counter SHALL read "<n> / <limit>" (for example "80 / 100"), SHALL NOT be a live region, and SHALL be referenced by the field's `aria-describedby` while it is shown. The form SHALL NOT require that the name and prompt differ (the use case's "distinct from the name" means a separate field). No copy in the form or its outcomes SHALL state or imply that the topic, its description, or a team definition will appear in a session. The form creates new topics only; it SHALL NOT edit an existing topic.

#### Scenario: No vote type is preselected
- **WHEN** a facilitator opens the add form
- **THEN** no vote-type option is selected
- **AND** the text "You can't change the vote type after the topic is created. Changing it later means removing this topic and adding a new one, which starts a new trend." is shown above the options

#### Scenario: The description is labelled as screen-only
- **WHEN** a facilitator opens the add form
- **THEN** the description field is labelled "Description (optional, shown on this screen only)"
- **AND** its helper text reads "Engineers won't see this during sessions. Use it as a note for whoever facilitates this team. A team definition is the place to explain what this topic means for this team."

#### Scenario: A counter appears at 80% of a limit
- **WHEN** a facilitator has typed 80 characters into Name
- **THEN** a character counter for Name reads "80 / 100"
- **AND** the counter is not a live region
- **AND WHEN** Name holds 79 characters
- **THEN** no counter is shown for Name

#### Scenario: Identical name and prompt are allowed
- **WHEN** a facilitator submits a valid form whose name and prompt are the same text and no duplicate exists
- **THEN** the request is sent

### Requirement: An empty active-topics list shows a small, honest state derived from the lock, the archive, and the add flag

When the active list is empty, the screen SHALL show one of exactly three variants, determined by `isCustomizationLocked` and the number of archived topics:

| `isCustomizationLocked` | archived count | Content |
|---|---|---|
| true | any | "This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics." and no actions |
| false | > 0 | "This team has no active topics." with "Show archived topics (n)" and "Add custom topic" |
| false | 0 | "This team has no active topics." with "Add custom topic" |

The "Add custom topic" action in the table above is conditional: like the heading trigger, it SHALL render only when `canAddTopics` is `true` and `isCustomizationLocked` is `false`, and the screen SHALL use one gate for both. The variant determines only the message and the "Show archived topics (n)" action; it SHALL NOT by itself cause the add action to render. Every caller TOPIC-002 admits receives `canAddTopics: true`, so no separate message variant exists for `canAddTopics: false` on an unlocked team. If the flag is nevertheless `false` or absent (for example, a frontend deployed ahead of its backend, or a backend rollback), the screen SHALL fail closed: it shows the unlocked variant's message and archive action, with no add action and no explanatory note.

The copy SHALL NOT name an application role, a support channel, or a control that does not exist. "Show archived topics (n)" SHALL expand the Archived section and move focus to the Archived section's show/hide control, and SHALL NOT add restore actions of its own. "Add custom topic" SHALL open the same add form as the heading trigger; while the empty state is shown the heading trigger SHALL NOT be shown. After a successful restore or add, the active list SHALL replace the empty state without a full-screen reload. The state SHALL contain no illustration. The Active Topics heading SHALL read "Active Topics (0)" while the empty state is shown.

#### Scenario: Locked team with no topics
- **WHEN** a facilitator views a team with `isCustomizationLocked: true` and no active topics
- **THEN** the screen shows "This team has no active topics, so its sessions can't run. Topics can't be assigned from this screen. Ask the people who run this application for your organization to restore this team's default topics."
- **AND** no "Show archived topics" or "Add custom topic" action is shown

#### Scenario: Unlocked team with archived topics, facilitator
- **WHEN** a standing facilitator views an unlocked team with no active topics, 3 archived topics, and `canAddTopics: true`
- **THEN** the screen shows "This team has no active topics." with "Show archived topics (3)" and "Add custom topic"
- **AND** the Active Topics heading reads "Active Topics (0)" and shows no add trigger

#### Scenario: Unlocked team with archived topics, administrator
- **WHEN** an application administrator views an unlocked team with no active topics, 3 archived topics, and `canAddTopics: true`
- **THEN** the screen shows "This team has no active topics." with "Show archived topics (3)" and "Add custom topic"

#### Scenario: Unlocked team with nothing archived, facilitator
- **WHEN** a standing facilitator views an unlocked team with no active and no archived topics
- **THEN** the screen shows "This team has no active topics." with "Add custom topic" only

#### Scenario: Unlocked team with nothing archived, administrator
- **WHEN** an application administrator views an unlocked team with no active and no archived topics, and `canAddTopics: true`
- **THEN** the screen shows "This team has no active topics." with "Add custom topic" only

#### Scenario: A missing add flag fails closed in the empty state
- **WHEN** the screen renders an unlocked team with no active topics and 2 archived topics, and the TOPIC-002 response has no `canAddTopics` field or has `canAddTopics: false`
- **THEN** the screen shows "This team has no active topics." with "Show archived topics (2)"
- **AND** no "Add custom topic" control is present anywhere on the page

#### Scenario: Locked team with no topics, administrator
- **WHEN** an application administrator views a team with `isCustomizationLocked: true` and no active topics
- **THEN** the locked variant is shown, with no "Show archived topics" action and no "Add custom topic" action
- **AND** the variant's message text is not asserted for administrators by this scenario; administrator-specific copy for the locked variant is owned by #200

#### Scenario: Show archived topics expands and focuses the archive
- **WHEN** a facilitator selects "Show archived topics (3)"
- **THEN** the Archived section is expanded and focus is on the Archived section's show/hide control

#### Scenario: Restoring from the empty state replaces it without a reload
- **WHEN** a facilitator restores an archived topic while the empty state is shown
- **THEN** the restored topic appears in the active list and the empty state is no longer shown
- **AND** the screen is not reloaded through the full-screen loading or error path
