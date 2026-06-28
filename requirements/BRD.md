# Business Requirements Document
## Engineering Health Check — Web Application

|                            |                                                                                                                                               |
|----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| **Document Date**          | 2026-03-08                                                                                                                                    |
| **Version**                | 1.1 — Open Questions Resolved                                                                                                                 |
| **Status**                 | Draft — Open Questions Resolved; Pending Final Review                                                                                         |
| **Executive Sponsor**      | Rachel Okonkwo, Vice President of Engineering                                                                                                 |
| **Requirements Author**    | Marcus Delgado, Senior Business Analyst                                                                                                       |
| **Contributing Reviewers** | Devon Calloway (Internal Champion), Priya Nair (Facilitator SME), Ingrid Sollenberger (Solution Architect), Tomás Ferreira (Security Analyst) |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Business Objectives](#2-business-objectives)
3. [Background and Problem Statement](#3-background-and-problem-statement)
4. [Stakeholders](#4-stakeholders)
5. [Scope of the Application](#5-scope-of-the-application)
6. [Ritual Integrity Requirements](#6-ritual-integrity-requirements)
7. [Functional Requirements](#7-functional-requirements)
8. [Operational Requirements](#8-operational-requirements)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Security Requirements](#10-security-requirements)
11. [Adoption Requirements](#11-adoption-requirements)
12. [Organizational Constraints](#12-organizational-constraints)
13. [ROI Justification](#13-roi-justification)
14. [Success Criteria](#14-success-criteria)
15. [Risks](#15-risks)
16. [Open Questions and Known Gaps](#16-open-questions-and-known-gaps)
17. [Requirement Traceability](#17-requirement-traceability)

---

## 1. Executive Summary

Engineering organizations grow faster than their practices. As teams scale, the informal signals that once surfaced problems early — hallway conversations, a senior engineer's intuition, the energy in a sprint planning room — become harder to read and easier to miss. The result is that engineering health problems tend to surface late: in attrition conversations, in delivery slowdowns, in incidents that were not surprises to the people closest to the work.

The Engineering Health Check is a structured, recurring retrospective ritual in which engineering teams vote on subjective topics about their development experience. The simultaneous vote reveal, combined with facilitation by someone outside the team, creates a psychologically safe environment for engineers to signal frustration, declining confidence, or emerging technical debt — in a context that is separate from performance reviews and management reporting.

To date, this ritual has been practiced informally by individual teams using shared spreadsheets. That approach is brittle: it depends on a specific person maintaining the artifact, it does not scale across teams, it produces no cross-session trend visibility, and it creates no accountability for action items surfaced in a session. When the spreadsheet owner leaves the team or the facilitator changes, institutional continuity is lost.

This project builds a web application to replace that spreadsheet-based process. The application will host the full ritual — from session setup and live voting through outlier detection, action item tracking, and trend reporting — in a way that is durable, organizationally consistent, and capable of scaling across all engineering teams.

The investment is justified on the following grounds: the cost of building and operating this application is lower than the cost of a single preventable attrition event, and lower still than the cost of discovering a team health crisis after it has already affected delivery.

---

## 2. Business Objectives

The following outcomes define success for this project. They are measurable and will be evaluated at the end of an initial adoption phase.

**Objective 1: Demonstrated adoption across multiple teams.**
Three or more engineering teams will complete a minimum of six sessions each using the application. This threshold is not arbitrary: six sessions over a standard bi-weekly cadence represents approximately three months of data — the minimum period at which trend lines become meaningful. Fewer sessions produce noise, not signal.

**Objective 2: Closed-loop action item resolution.**
At least one team will have used the action item tracking feature to surface an issue in a session and mark it resolved in a subsequent session. This demonstrates that the application is functioning as intended — not merely capturing votes, but supporting the behavioral loop of identify, act, and verify.

**Objective 3: Trend data surfacing previously invisible signal.**
At least one instance will be documented in which a reviewer of the trend dashboard — an Engineering Manager or executive — identified a pattern or condition they would not have been aware of through normal channels. This validates the core organizational proposition: that the application surfaces real signal about team health, not just activity.

**Objective 4: No engineer perceives the data as evaluative or punitive.**
Zero engineers will raise a concern — through any channel — that session data is being used in a way that feels like individual performance evaluation or management surveillance. This outcome is binary. If a single such concern is raised and confirmed, it must be treated as a system failure, not an edge case.

---

## 3. Background and Problem Statement

The Engineering Health Check is a retrospective focused on the development experience and the codebase for engineering teams. It is not a review of test coverage or static analysis metrics — it is about the engineer's satisfaction with the codebase as a whole.

A facilitator from outside the team walks engineers through a set of questions where each participant votes, typically on a scale of 1 to 4 or using roman voting. The facilitator captures results so trends can be identified over time. The facilitator notes outliers and prompts brief discussion. Trends or conversations may result in action items for the team to address.

### 3.1 Why the Ritual Exists

You cannot have an objective conversation about the traffic in the Squirrel Hill Tunnels while sitting in stop-and-go traffic in that very tunnel. Similarly, the magnitude of satisfaction or frustration with coding may not be apparent while looking at an IDE. The act of separating from the keyboard and using facilitated prompts helps engineers think about their work objectively.

When an engineer is frustrated about how hard it is to develop, maintain, or enhance code, they might think about it during a commute or at home. Discussing this as a team allows other engineers to understand the position and potentially help. Doing it as a team encourages discussion and helps establish understanding and consensus.

### 3.2 Current State Problems

The ritual has been running at this company for several years on a shared spreadsheet. This approach has the following structural problems:

**Key-person dependency.** Every team that runs the ritual depends, directly or indirectly, on individuals who understand why it works the way it does. When those individuals are unavailable, the ritual degrades or stops. New teams cannot adopt the practice independently without someone explaining it to them.

**No reliable trend data.** The spreadsheet captures data if the facilitator is diligent. There is no enforcement, no standard format, and no shared history. Teams that have rotated facilitators have lost data. Teams that have changed spreadsheet formats cannot compare results across the break. The trend data that makes this ritual valuable — the ability to see a team's trajectory over months — is fragile and inconsistent.

**No enforcement of protective constraints.** The spreadsheet imposes nothing. A manager can sit in a session and cast votes. A facilitator from the same team can run the session. Votes can be shown one at a time instead of simultaneously. The spreadsheet does not prevent any of these failures, and people running the ritual for the first time have no way of knowing which of them matter and why.

**Hard to scale.** Adding a new team currently requires a person to explain the process, set up a new spreadsheet, find a willing facilitator, and remain available for questions. This does not scale and has already become a bottleneck.

### 3.3 Purpose of the Application

The purpose of this application is to replace the spreadsheet as the operational substrate of the ritual while preserving — and structurally enforcing — the mechanics that make it work. The goal is a tool that any engineering team can adopt without assistance, that enforces the ritual's constraints automatically, and that accumulates the trend data that justifies the practice in the first place.

---

## 4. Stakeholders

| Name                | Title                               | Role in Project                                                                                             |
|---------------------|-------------------------------------|-------------------------------------------------------------------------------------------------------------|
| Rachel Okonkwo      | VP of Engineering                   | Executive Sponsor — approved headcount and budget; non-negotiable organizational constraints owner          |
| Devon Calloway      | Principal Software Engineer         | Internal Champion and Founding Advisor — original ritual designer; consulted on intent and ritual integrity |
| Marcus Delgado      | Senior Business Analyst             | Requirements Author — primary author of functional requirements, use cases, and entity model                |
| Priya Nair          | Staff Software Engineer             | Facilitator Subject Matter Expert — consulted on live session flow, facilitator UX, and reveal mechanics    |
| Ingrid Sollenberger | Principal Solution Architect        | Architectural Reviewer — architectural oversight and non-functional requirements                            |
| Tomás Ferreira      | Senior Application Security Analyst | Security Reviewer — formal security review pre-production; security requirements author                     |

---

## 5. Scope of the Application

### 5.1 In Scope

The application is the system of record for:
- Team membership and role assignments
- Session history and voting outcomes
- Action items and their status across sessions
- Topic configuration per team
- Trend data and historical session artifacts

The application manages the full lifecycle of a session: pre-session action item review, live voting with simultaneous reveal, post-session wrap-up, and longitudinal trend analysis across sessions.

### 5.2 Decisions Table

| Decision                                                | Rationale                                                                                                                                        |
|---------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| Authentication delegated to external OIDC provider      | The application does not manage passwords, MFA, or account recovery. It consumes identity tokens and maps them to application roles.             |
| Team membership owned by the application                | Not derived from or synchronized with any external HR or directory system.                                                                       |
| Manager/team relationship managed by the application    | Not inherited from the identity provider.                                                                                                        |
| Notifications (email, Slack, calendar) are out of scope | The facilitator distributes join links manually. All communication occurs within the session interface.                                          |
| First-session flow variation is out of scope            | All sessions follow the same flow; first-session guidance is delivered contextually within the interface, not through a separate branching flow. |
| Reporting exports (PDF, CSV) are out of scope           | Trend and history data is consumed within the application.                                                                                       |
| Cross-team aggregation views are out of scope           | The Trend Dashboard is scoped to a single team.                                                                                                  |
| Team creation                                           | No admin role required; any authenticated user can create a team as part of creating a session.                                                  |

### 5.3 What the Application Must Not Become

- A performance evaluation tool for individual engineers
- A surveillance mechanism tracking participation patterns or individual response tendencies
- A general retrospective platform for other ritual types
- A system where ritual integrity constraints are configurable options that can be toggled by administrators

---

## 6. Ritual Integrity Requirements

The Engineering Health Check has properties that are not preferences — they are load-bearing. Remove them and the ritual produces different results, attracts different behavior, and eventually stops doing the thing it is supposed to do. The following constraints must be enforced by the application's structure, not offered as configurable defaults. They are stated here at the BRD level to ensure they survive into implementation as hard requirements.

### 6.1 Simultaneous Vote Reveal

**What it is.** All votes for a topic are revealed to all participants at the same instant. No participant sees any other participant's vote before the reveal is triggered.

**Why it is load-bearing.** The simultaneous reveal is the mechanism that makes individual votes honest. If votes are visible as they are cast — even to the facilitator, even one at a time — engineers who vote last will anchor to what they have already seen. The ritual produces conformity, not signal.

**Application requirement.** Votes that have been cast but not yet revealed must not be readable by any client — not the facilitator's view, not a participant's view, not via any API endpoint. The reveal must be a single, server-triggered event that makes all votes visible simultaneously. There must be no technical path by which a vote becomes visible to any party before the facilitator triggers the reveal. Once a participant has locked in a vote, that vote cannot be changed.

### 6.2 No Engineering Manager Participation as Voters

**What it is.** Engineering managers may not join a session as participants and may not cast votes. This constraint cannot be waived by request, administrative override, or facilitator discretion.

**Why it is load-bearing.** Engineering managers are in the reporting structure of the engineers on the team. Even a well-intentioned manager in the room changes what engineers are willing to say. The effect does not require the manager to say anything — their presence alone suppresses honesty.

**Application requirement.** The application must make it structurally impossible for a user with an engineering manager role to cast a vote in a session. Engineering managers have a defined and appropriate role: read-only access to their team's session history, trends, and action items after sessions are complete. Within session history, EMs may view anonymous vote distributions (counts per value) but not individual vote attribution or any per-voter representation. The read-only constraint and the vote anonymization requirement must both be enforced at the application layer, not governed by convention.

### 6.3 Facilitator Must Be from a Different Team

**What it is.** The facilitator who runs a session must be a member of a different team than the team being evaluated.

**Why it is load-bearing.** The facilitator's role is to be uninvested. A facilitator from the same team cannot be fully uninvested. All engineers on the team should be able to participate fully — if the facilitator is from the same team, one engineer is removed from the participant pool, distorting the results.

**Application requirement.** The application must check whether the facilitator's team membership overlaps with the team being evaluated before allowing the session to begin. The strong preference is a hard block. At minimum, the check must produce an explicit, prominent warning that cannot be dismissed silently.

### 6.4 Default Topic Set Must Be Preserved and Restorable

**What it is.** The application ships with a canonical default set of topics. Teams may customize their topic list. The default set must remain visible and restorable at any time, regardless of customization.

**Why it is load-bearing.** The default topic set is the shared language of the ritual. Topic customization without a preserved baseline creates drift, loses shared reference points, and eliminates cross-team comparability over time.

### 6.5 No Cross-Team Individual Comparison

**What it is.** The application must not expose data in any form that allows individual engineer votes to be compared across teams or over time in a way that identifies or profiles individual engineers.

**Why it is load-bearing.** The Engineering Health Check is a team health instrument, not a performance evaluation instrument. If session data can be used to evaluate individual engineers, engineers who know their individual votes are being tracked will vote accordingly. The ritual stops producing signal.

---

## 7. Functional Requirements

Requirements are marked **[HARD]** where the behavior is non-negotiable and cannot be relaxed without materially compromising the integrity of the ritual. Requirements marked **[PREF]** represent strong preferences that may have implementation flexibility.

### FR-1: Identity and Access

**FR-1.1** [HARD] The application shall authenticate users exclusively via an external OIDC provider. The application shall not implement its own credential storage or authentication mechanism.

**FR-1.2** [HARD] Upon successful OIDC authentication, the application shall resolve the authenticated user to an application-managed identity record. If no matching record exists, the application shall create one using identity claims from the token (at minimum: unique subject identifier, display name, email address).

**FR-1.3** [HARD] The application shall enforce the following role model:
- **Participant:** A team member eligible to vote in sessions for their assigned team.
- **Facilitator:** A user who leads sessions for teams other than their own. A facilitator may also be a Participant for their own team.
- **Engineering Manager (EM):** A user associated with a team who has read-only access to session history and trend data for that team. Within session history, an EM sees anonymous vote distributions (counts per value per topic) rather than individual vote attribution. An EM may not vote.
- **Application Administrator:** A user who may manage team definitions, assign members, and assign facilitators across all teams.

**FR-1.4** [HARD] The application shall prevent any user assigned the EM role for a given team from casting votes in sessions for that team.

**FR-1.5** [PREF] The application should display a clear indication of the currently authenticated user's name and role on all primary screens.

**FR-1.6** [HARD] Team membership is managed within the application by Application Administrators and Engineering Managers. An Application Administrator may manage membership and roles for any team. An Engineering Manager may manage membership roles (participant assignments) for their own team only; assigning the Engineering Manager role to a user requires Application Administrator authority. Membership is not derived from or synchronized with any external directory or HR system.

**FR-1.7** [HARD] The application shall support creating a team independently of session creation. A Facilitator or an Engineering Manager may create a team. A team that exists without a completed session shall appear in the facilitator's list of available teams and behave identically to any established team when a session is subsequently created for it. Creating a team without a session is a supported and valid system state; the application shall handle it gracefully in all views that reference session history or trend data (displaying empty or zero-session indicators rather than errors).

### FR-2: Session Setup

**FR-2.1** [HARD] Only a user with the Facilitator role may create a session for a given team.

**FR-2.2** [HARD] When creating a session, the facilitator shall specify the target team. The application shall prevent the facilitator from creating a session for a team to which they belong as a Participant or EM.

**FR-2.3** [HARD] Upon session creation, the application shall generate a unique, non-guessable join link. The facilitator is responsible for distributing this link to participants out-of-band.

**FR-2.4** [HARD] Any authenticated user who accesses the join link and is a registered member of the target team shall be admitted to the session as a Participant. Users who are not members of the target team shall be denied entry with an explanatory message.

**FR-2.5** [PREF] The session lobby should display a real-time list of participants who have joined, visible to the facilitator only.

**FR-2.6** [HARD] The facilitator shall explicitly start the session, transitioning it from the lobby state to the active state. Voting shall not be available until the session is in the active state.

**FR-2.7** [PREF] The application should allow the facilitator to re-order the default topic queue before starting the session.

### FR-3: Pre-Session Action Item Review

**FR-3.1** [HARD] Before the first voting topic is presented, the application shall display all open and in-progress action items from prior sessions for the target team.

**FR-3.2** [HARD] During the pre-session action item review, any participant who is the owner of an action item shall be able to update the status of that item in real time. Status transitions available at this stage: Open → In Progress, Open → Resolved, In Progress → Resolved.

**FR-3.3** [PREF] Status updates made during the pre-session review should be visible to all session participants in real time without requiring a page refresh.

**FR-3.4** [HARD] The facilitator shall have the ability to advance past the pre-session action item review to the first voting topic. Participants may not trigger this transition.

**FR-3.5** [HARD] If the team has no prior sessions or all prior action items are resolved, the pre-session review screen shall display a clear indication of this state and allow the facilitator to proceed immediately.

### FR-4: Live Voting

**FR-4.1** [HARD] The facilitator controls all topic progression. The application shall not automatically advance to the next topic or trigger a reveal without an explicit facilitator action.

**FR-4.2** [HARD] When a topic is active, each Participant shall be presented with a private voting interface. Votes shall be recorded server-side when the participant locks them in. Lock-in is irreversible.

**FR-4.3** [HARD] The application shall support three vote types, configured per topic:
- **Finger vote:** Integer values 1, 2, 3, 4 (no middle ground)
- **Roman vote:** Thumbs up / Thumbs down
- **Modified Roman vote:** Up / Steady / Down (used for Project Trend topic only)

**FR-4.4** [PREF] The application should allow a participant to change their vote at any time before they lock in.

**FR-4.5** [HARD] The facilitator's view during the voting phase shall display a readiness grid showing who has locked in versus who has not, by name. The facilitator's view shall not reveal individual vote values or the aggregate score before the reveal is triggered.

**FR-4.6** [HARD] The reveal shall be triggered exclusively by a facilitator action. At the moment of reveal, all vote values shall become visible to all session participants simultaneously. There shall be no mechanism by which any participant can see any vote value — including their own vote's relative position in the group — before the facilitator triggers the reveal.

**FR-4.6.1** [HARD] All participants must receive the reveal event within 15 seconds of the facilitator triggering the reveal. This is the maximum acceptable delivery window; the system must be designed and tested against this bound. The reveal event payload must include a server-side timestamp; clients must use this timestamp to calculate and log observed delivery latency. Latency outside the 15-second bound must be surfaced in system monitoring.

**FR-4.7** [HARD] Votes that have been revealed shall be immutable. The application shall not permit vote changes after the reveal has occurred for a given topic.

**FR-4.8** [PREF] After the reveal, the application should display a simple aggregate summary (average, distribution) alongside the individual votes.

**FR-4.9** [PREF] The facilitator should be able to add a free-text discussion note to a topic after the reveal, before advancing to the next topic.

**FR-4.10** [HARD] If a participant joins after a topic's reveal has already occurred, they shall not be retroactively added as a voter for that topic. Their participation begins at the next topic for which voting has not yet started.

### FR-5: Outlier Detection and Discussion Prompts

**FR-5.1** [HARD] The application shall automatically evaluate each topic's reveal for the following outlier condition:
- **Individual Outlier:** A single participant's vote deviates from the session average for that topic by more than ±1.5. This is the defined threshold; it is configurable at the application level by an Application Administrator (see FR-5.2).

Trend outlier detection (flagging the team's aggregate score against a rolling historical average) is explicitly out of scope at this time. FR-5.1 applies to individual vote outliers only.

**FR-5.2** [HARD] The individual outlier threshold (default: ±1.5 from the session average) shall be configurable at the application level by an Application Administrator. The default value must be documented in the application's configuration and applied at first use. The threshold must not be a magic number buried in code — it must be visible, auditable, and changeable without a code deployment.

**FR-5.3** [PREF] Outlier thresholds should be overridable at the team level by the facilitator or an Application Administrator.

**FR-5.4** [HARD] When an individual outlier condition is detected, the application shall flag it visually on the reveal screen in the facilitator view only. Trend outlier detection is out of scope; no trend outlier flag shall be displayed.

**FR-5.5** [HARD] The facilitator, and only the facilitator, shall decide whether a flagged outlier opens a discussion. The application shall not automatically open a discussion or change the session flow based on an outlier flag. The UI must not make it awkward to skip a flagged outlier.

**FR-5.6** [PREF] The outlier flag should persist on the session record and be visible in the session history detail view.

### FR-6: Session Wrap-Up

**FR-6.1** [HARD] After the final topic is voted on and revealed, the facilitator shall advance to the session wrap-up screen. Participants may not trigger this transition.

**FR-6.2** [HARD] The wrap-up screen shall present all discussion notes captured during the session for facilitator review and editing.

**FR-6.3** [HARD] During wrap-up, the facilitator shall be able to create new action items. Each action item shall require at minimum: a free-text description and an assigned owner (selected from the list of session participants).

**FR-6.4** [PREF] The application should allow action items to be created with an optional due date.

**FR-6.5** [HARD] The facilitator shall explicitly confirm and close the session. Until this confirmation, the session shall remain in the wrap-up state and data shall be mutable by the facilitator.

**FR-6.6** [HARD] Once a session is confirmed closed, it shall transition to a read-only historical state. Voting data, notes, and action items from that session shall not be modifiable except through Action Item Management (FR-7).

**FR-6.7** [PREF] After session close, participants should receive an in-application summary view of the completed session, including their own votes, revealed votes, discussion notes, and new action items.

### FR-7: Action Item Management

**FR-7.1** [HARD] The application shall maintain a persistent action item record across all sessions for each team. Action items shall not be deleted; they shall be resolved.

**FR-7.1a** [HARD] As a narrow exception to FR-7.1, the facilitator may delete an action item that was created during the current wrap-up phase, provided the session has not yet been confirmed closed. This exception exists to allow correction of data-entry errors (e.g., duplicate items, typographic mistakes, wrong owner selection) before the item enters the permanent record. Once a session is confirmed closed, all action items it produced are subject to FR-7.1 in full and may not be deleted. The delete operation must be a hard delete of the action item row; no resolution record is written in its place, and no entry in `action_item_history` is required for a pre-close deletion. The application must reject a delete request with `409 Conflict` if the session status is not `wrap_up`.

**FR-7.2** [HARD] Each action item shall carry: unique identifier, description, owner (a team member), originating session reference, creation date, current status (Open / In Progress / Resolved), and last-updated date.

**FR-7.3** [HARD] An action item's owner shall be able to update the status of items assigned to them at any time, inside or outside of a session. Status transitions are directed and may not be reversed: Open → In Progress, Open → Resolved, and In Progress → Resolved are permitted. Backward transitions (In Progress → Open, Resolved → anything) are not permitted. Once an action item is resolved it remains resolved; a recurring issue should be captured as a new action item.

**FR-7.4** [HARD] The application shall flag action items as stale when they have remained in Open or In Progress status beyond a configurable threshold (default: two sessions without a status change). A stale flag shall be visible to all team members and to the facilitator.

**FR-7.5** [PREF] Application Administrators should be able to adjust the staleness threshold globally or per team.

**FR-7.6** [HARD] Any team member with the Participant or EM role shall be able to view the full action item history for their team.

### FR-8: Topic Management

**FR-8.1** [HARD] The application shall ship with a default set of health check topics applied to all new teams. This default set shall be defined and maintainable by an Application Administrator.

**FR-8.2** [HARD] After a team's first session, the facilitator or Application Administrator shall be able to add, remove, or reorder topics for that team.

**FR-8.3** [HARD] When a topic is removed from a team's active topic list, all historical voting data for that topic shall be retained and accessible in session history and trend views. Removal from the active list does not purge historical records.

**FR-8.4** [HARD] Removed topics shall be clearly distinguished from active topics in all history views (labeled as "Archived" or equivalent).

**FR-8.5** [PREF] The application should warn and require explicit confirmation before allowing removal of a topic that has open action items associated with it.

**FR-8.6** [HARD] The canonical default topic set must remain visible and restorable for any team at any time, regardless of how much the team has customized their topic list.

### FR-9: Trend Dashboard and Reporting

**FR-9.1** [HARD] The application shall provide a Trend Dashboard accessible to Participants, Facilitators assigned to the team, EMs, and Application Administrators. This view shall not be accessible to users with no relationship to the team.

**FR-9.2** [HARD] The Trend Dashboard shall display, for each active topic, a chart of the team's aggregate score across the most recent sessions. The default view shall cover the most recent 6 sessions. The user shall be able to expand the view to include full session history.

**FR-9.3** [PREF] Archived (removed) topics should be accessible via a toggle or secondary section of the Trend Dashboard, with historical data intact.

**FR-9.4** [HARD] The Trend Dashboard shall include a Session History view presenting a chronological list of completed sessions. Selecting a session shall display the full session detail: topics voted on, revealed votes, aggregate scores, discussion notes, and action items created.

**FR-9.5** [HARD] Engineering Managers shall have access to the Trend Dashboard and Session History in read-only mode. The EM view shall not expose individual participant vote values with any attribution or ordering that could identify who cast a vote. EMs shall see an anonymous vote distribution: for each topic, the count of votes at each value (e.g., one vote at 1, three votes at 4) without any row-per-voter representation, ordering, or identity linkage. The aggregate score (mean for finger voting; net directional tally for roman and modified roman) shall also be visible. This anonymous distribution is a stronger privacy guarantee than an anonymized per-row list, as it eliminates ordering as an inference vector.

**FR-9.6** [PREF] The Trend Dashboard should visually distinguish sessions where a trend outlier was flagged for a given topic.

**FR-9.7** [HARD] When a topic has insufficient session history to render a meaningful trend chart, the chart area must display a blank graph with the placeholder text "Insufficient data." The application must not display a broken, partially rendered, or error state in place of the empty state. This applies to per-topic trend charts and the Project Trend indicator. The threshold for "insufficient data" must be defined and documented; until that threshold is met, the empty state applies.

---

## 8. Operational Requirements

*Contributed by Priya Nair, Staff Software Engineer and cross-team facilitator.*

### 8.1 Live Session Flow

**OR-1.1** The application must track and display participant readiness (locked-in status) separately and independently from vote content. Readiness state must be visible to the facilitator before any votes are revealed.

**OR-1.2** Vote content must be withheld from all views — including the facilitator view — until the facilitator explicitly triggers the reveal action for that topic.

**OR-1.3** The application must maintain a clear, persistent session state indicator accessible to the facilitator at all times: which topic is active, how many participants are locked in versus pending, and overall session progress.

**OR-1.4** The application must not advance the session state — including topic transitions — without an explicit facilitator action. No automatic advancement under any condition.

**OR-1.5** The session state must be server-authoritative. Client-side representations of session phase (voting open, locked, revealed) must be derived from server state, not maintained independently by client logic.

**OR-1.6** The application must gracefully handle participants joining mid-session without disrupting participants already locked in. Late-joining participants enter the current topic in an unlocked state; their presence must not block the facilitator from proceeding.

**OR-1.7** The application must preserve full session state across facilitator disconnects and reconnections. A facilitator who loses connectivity and reconnects must see the current session state without needing to reconstruct it from memory. When a facilitator disconnects mid-session, the session is not abandoned. Upon reconnection and successful re-authentication, the facilitator may rejoin the session they created and resume full facilitation control. The session remains in its last known state during the facilitator's absence; participants are not automatically dismissed.

### 8.2 Facilitator View

**OR-2.1** The facilitator view must be a distinct UX architecture — not a variation of the participant view with additional controls overlaid. The information hierarchy, layout, and interaction model must be designed specifically for facilitation tasks.

**OR-2.2** During the voting phase, the facilitator view must display a readiness grid showing each participant's locked-in status by name, and nothing more. Vote values, vote distributions, or any information that would allow the facilitator to infer vote content must not be displayed before reveal.

**OR-2.3** After the facilitator triggers reveal, the facilitator view must display all vote values, vote distribution, applicable outlier flags, and available trend context for that topic from prior sessions.

**OR-2.4** Outlier flagging in the facilitator view must be presented as advisory information. The display must communicate the statistical observation without visual treatment that prescribes a specific facilitation response or that would amplify discomfort for the flagged participant.

**OR-2.5** Trend context must be available to the facilitator at the point of reveal, without requiring a separate navigation action.

**OR-2.6** Facilitator action controls (reveal, open discussion, advance topic, close session) must be visually distinct, unambiguous, and not reachable by accidental interaction. Destructive or irreversible actions must require a confirmation step.

### 8.3 Participant View

**OR-3.1** For each topic, the participant view must display the topic prompt and the applicable vote type before the participant casts a vote.

**OR-3.2** Vote type display must be self-explanatory within the interface. A participant must not need to have attended a prior session or read external documentation to understand what the vote options mean.

**OR-3.3** Vote entry must be private. A participant's selected vote value must not be transmitted to or visible on any other view prior to reveal.

**OR-3.4** The lock-in action must be clearly labeled and must be accompanied by explicit indication that it is irreversible.

**OR-3.5** Upon facilitator-triggered reveal, all vote values must appear on the participant view simultaneously with other participants' views, as derived from a single server-side reveal event. All participants must receive the reveal event within 15 seconds of the facilitator triggering it (see FR-4.6.1). The reveal event payload must include a server-side timestamp to enable client-side latency measurement.

**OR-3.6** The participant view must not display any information about other participants' vote values or vote directions prior to the reveal event.

**OR-3.7** The participant view must not display outlier flags at any time, before or after reveal.

### 8.4 Prohibited Behaviors

The following behaviors are explicitly prohibited:

**OR-4.1** The application must not automatically advance from one topic to the next under any condition.

**OR-4.2** The application must not impose or display countdown timers, time limits, or time-based pressure indicators during the voting phase.

**OR-4.3** The application must not send nudges, reminders, or notifications to participants who have not yet locked in.

**OR-4.4** The application must not display participant readiness status to other participants. Only the facilitator sees the readiness grid.

**OR-4.5** The application must not use visual treatment (color coding, iconography, animations) on outlier-flagged votes in the revealed participant view in a manner that singles out individual voters.

**OR-4.6** The application must not auto-close or auto-complete a session based on elapsed time or completion of the final topic. Session close is an explicit facilitator action.

### 8.5 First-Session Support

**OR-5.1** The application must detect when a team has no prior session history and must apply first-session mode for that team's initial session.

**OR-5.2** In first-session mode, each topic must display an expanded description of the topic's intent and the dimension of engineering health it is assessing.

**OR-5.3** In first-session mode, vote type guidance must be displayed inline with the vote controls, including scale anchor explanations for each vote type.

**OR-5.4** The facilitator view in first-session mode must include a collapsible session guide panel surfacing topic intent, common facilitation notes, and suggested discussion prompts.

**OR-5.5** First-session mode must not alter the structural session flow. It augments information density; it does not change the process.

### 8.6 Facilitator Continuity

**OR-6.1** Any facilitator must be able to assume facilitation of a team's session with full access to that team's session history, without requiring a knowledge transfer from the prior facilitator.

**OR-6.2** Prior to a session, the application must surface a facilitator briefing view for the team: the last session date, open action items with owner and age, trend indicators per topic across recent sessions, and any topics flagged for follow-up in prior sessions.

**OR-6.3** The facilitator briefing view must be accessible without starting or creating a new session.

**OR-6.4** The application must support multiple facilitators per team without designating a single owner. Any authenticated facilitator with access to the team must have equivalent access to session history and the ability to start, run, and close sessions.

**OR-6.5** Session notes recorded during wrap-up must be associated with the session record and retrievable in subsequent sessions by any facilitator.

---

## 9. Non-Functional Requirements

*Contributed by Ingrid Sollenberger, Principal Solution Architect.*

### 9.1 Reliability

**NFR-REL-001** The system must handle dropped WebSocket connections without data loss. If a participant's connection drops during a live session, the server must retain that participant's submitted votes and last known state for a minimum of 60 seconds to allow for reconnection.

**NFR-REL-002** Upon WebSocket reconnection, the server must transmit the current authoritative session state to the reconnecting client. The client must not rely on locally cached state as a source of truth following a reconnection event.

**NFR-REL-003** The system must detect and record participant disconnection events. The facilitator interface must display a real-time indicator of connected versus disconnected participants.

**NFR-REL-004** When Redis becomes unavailable during an active live session, the server must attempt to restore connectivity using an exponential back-off retry mechanism. If Redis remains unavailable for five continuous minutes, the session is abandoned. Participants and the facilitator must be notified of the abandonment with an explanatory message. The abandonment event and its timestamp must be recorded in the audit log. Silently degraded behavior is not acceptable; the system must make the unavailability visible immediately to the facilitator.

**NFR-REL-005** Reconnection attempts by clients must use exponential backoff with a defined maximum retry limit. Indefinite reconnection loops are not permitted.

### 9.2 Authentication and Authorization Architecture

**NFR-AUTH-001** The authentication integration layer must be implemented as a provider-agnostic OIDC abstraction. Swapping the configured OIDC provider must require only configuration changes, not code changes.

**NFR-AUTH-002** Provider-agnosticism must be verified before production. A test must be conducted or documented evidence provided confirming that a provider swap can be executed without modifying application source code. For local development and development machine testing, a simulated OIDC provider must be used in place of any real identity provider. Real OIDC providers are used only in deployed environments (QA, staging, and production). The simulated OIDC provider must support all token flows exercised by the application and must be documented as part of the local development setup guide.

**NFR-AUTH-003** Authorization decisions must be enforced server-side on every protected request and WebSocket event. The server must not rely on the frontend to enforce access control.

**NFR-AUTH-004** The access control model — roles, permissions, and enforcement points — must be fully documented and reviewed by the architecture team before any production deployment.

**NFR-AUTH-005** Sessions must support a maximum lifetime of 90 minutes to accommodate the full range of expected session durations, including extended first-run sessions. Because a standard OIDC ID token lifetime may be shorter than 90 minutes, the application must implement a token refresh strategy that covers the full session duration without requiring the user to re-authenticate mid-session. The required approach is sliding window token refresh or silent refresh, with a 90-minute absolute maximum session lifetime. The chosen refresh strategy and its implementation must be documented and reviewed by the architecture and security teams prior to production deployment.

### 9.3 Data Architecture

**NFR-DATA-001** The boundary between ephemeral state (Redis) and persistent state (PostgreSQL) must be explicitly documented before development of the data layer begins.

**NFR-DATA-002** Any data that must survive a process restart — completed session records, submitted votes, action items, user records, team assignments — must be stored in PostgreSQL. Redis must not be used as the system of record for any data element that is not intentionally ephemeral.

**NFR-DATA-003** When Redis restarts during an active live session, the server must apply exponential back-off retry to re-establish connectivity. If Redis remains unavailable for five continuous minutes, the session is abandoned (see NFR-REL-004). All vote data submitted prior to the Redis failure must have been written to PostgreSQL before being accepted as confirmed; votes held only in Redis at the time of failure are not recoverable and must not be silently counted.

**NFR-DATA-004** Redis data structures used for live session state must include defined TTLs. Redis must not accumulate unbounded orphaned session keys.

**NFR-DATA-005** Database schema changes must be managed through a versioned migration system.

**NFR-DATA-006** The PostgreSQL instance must have a documented backup and point-in-time recovery procedure in place prior to production use.

### 9.4 Observability

**NFR-OBS-001** Structured logging must be implemented from the first deployable build. Log entries must be emitted in a machine-parseable format (JSON) and must include: timestamp, log level, request or event identifier, and a descriptive message.

**NFR-OBS-002** The application must expose a health endpoint that returns the operational status of each significant dependency — including PostgreSQL and Redis — as discrete indicators.

**NFR-OBS-003** The system must be observable to the point where a degraded or failed condition is detectable before a user submits a support report.

**NFR-OBS-004** WebSocket lifecycle events — connection established, connection dropped, reconnection attempt, message received, session state change — must be logged at a level that permits post-hoc reconstruction of a session's event sequence.

### 9.5 Deployment

**NFR-DEP-001** The application must be deployable to Kubernetes. Kubernetes is the confirmed target for the first production deployment. All runtime dependencies must be declared in container image definitions. Kubernetes manifests (Deployment, Service, ConfigMap, and related resources) must be version-controlled alongside application source code and must constitute the authoritative deployment definition.

**NFR-DEP-002** Deployment to Kubernetes must be fully scripted and repeatable using the provided Kubernetes manifests and a documented deployment runbook. Executing the deployment must not require knowledge of the internal design of the application. A qualified operations engineer with no prior involvement in the build must be able to execute a production deployment using only the provided documentation and scripts. The deployment runbook must include all required `kubectl` commands or equivalent tooling invocations.

**NFR-DEP-003** The deployment process must support on-premises execution without requiring internet access at deploy time.

**NFR-DEP-004** Environment-specific configuration and secrets must be injected at runtime via environment variables. No external secrets management system is required for the initial deployment. Configuration must not be baked into container images. The complete set of required environment variables must be documented as part of the deployment runbook.

**NFR-DEP-005** The deployment must include a defined rollback procedure, documented and executable without requiring source code access or a new build.

### 9.6 Scalability

**NFR-SCALE-001** The system is scoped for company-internal use across multiple teams. Initial design targets must be based on realistic internal load projections, not internet-scale assumptions.

**NFR-SCALE-002** Scalability design decisions must be documented with their current assumptions made explicit. Constraints on future horizontal scaling must be recorded as known limitations.

**NFR-SCALE-003** The system must be capable of supporting multiple concurrent live sessions without cross-session interference.

### 9.7 Architectural Governance

**NFR-GOV-001** Every significant architectural decision must be documented in an Architecture Decision Record (ADR) prior to implementation. Each ADR must include: the decision made, the context, alternatives considered, rationale, and known trade-offs.

**NFR-GOV-002** The following architecture checkpoints are required:
- **Checkpoint 1 — Real-Time Layer:** Prior to full implementation of the WebSocket communication layer.
- **Checkpoint 2 — Authentication Integration:** Prior to connecting to any identity provider in a non-local environment.
- **Checkpoint 3 — First Production Deployment:** Full deployment architecture, data boundary documentation, observability plan, rollback procedure, and access control review must be complete.

**NFR-GOV-003** Any deviation from a documented architectural decision during implementation must be flagged to the Principal Solution Architect before the deviation is merged.

---

## 10. Security Requirements

*Contributed by Tomás Ferreira, Senior Application Security Analyst.*

> **Foundational Position:** "Internal tool" is a risk classification, not a risk reduction. Internal applications are attacked by compromised credentials, malicious insiders, and lateral movement — not by strangers who must breach the perimeter first. The attack surface is different. The controls must be designed accordingly, not skipped because user count is small.

### 10.1 Authentication

**SEC-1** The application must validate OIDC ID tokens on every authenticated request. Validation must include: signature verification against the identity provider's published JWKS endpoint, expiry (exp claim), audience (aud claim) matching the application's registered client ID, and issuer (iss claim) matching the configured identity provider. All four validations are required.

**SEC-2** The OIDC/OAuth2 client library must be reviewed by the security team prior to integration to confirm it performs full token validation by default.

**SEC-3** The application must not cache or trust previously validated claims beyond the token's expiry.

**SEC-4** The application must implement token revocation handling. Where back-channel logout is not available, the application must enforce a maximum session lifetime of 90 minutes and require re-authentication after expiry, independent of token validity. Sessions must not remain active beyond 90 minutes from initial authentication without explicit re-authentication by the user.

**SEC-5** Refresh tokens must not be stored in browser-accessible storage. If held server-side, they must be treated as credentials.

**SEC-6** The OIDC redirect URI registered with the identity provider must be exact. Wildcard redirect URIs are not permitted.

### 10.2 Authorization

**SEC-7** Authorization must be enforced server-side on every API endpoint, independently of any access control logic in the frontend. The frontend's presentation of controls is not an authorization control.

**SEC-8** Access control checks must be performed at the data level, not only at the route level. An endpoint serving session data must confirm that the requesting user is a member of the team associated with that session, the team's EM, or the session's designated facilitator.

**SEC-9** The access control model must be formally documented and reviewed by the security team prior to production deployment. This documentation must be specific enough to serve as a test specification.

**SEC-10** No endpoint may return data belonging to a team other than the team the requesting user is authorized to access. This boundary must be enforced at the query level — not enforced solely by filtering a broader result set after retrieval.

**SEC-11** Role changes and access revocation must take effect on the next request following the change.

### 10.3 Audit Logging

**SEC-12** The audit log is a security control. It is the primary mechanism by which anomalous access patterns can be detected after the fact and by which incident response can reconstruct a sequence of events.

**SEC-13** The following events must be captured in the audit log: user authentication (login, logout, failure, expiry), session lifecycle (creation, join, close, facilitator changes), vote events (submission, reveal), access control denials, administrative actions (role or membership modifications), and any data export operations.

Each audit log entry must include: timestamp (UTC), authenticated user identity, action type, target resource identifier, and outcome. WebSocket-originated events must additionally include the WebSocket session identifier.

**SEC-14** WebSocket events must be logged with the same fidelity as HTTP requests. Vote submissions, reveals, and session state changes over WebSocket must appear in the audit log with equivalent fields.

**SEC-15** Audit logs must be written to a destination that is not modifiable by the application process. The application must have write access; it must not have delete or modify access.

**SEC-16** Audit log entries must not contain sensitive data values. The audit log records that an event occurred and by whom — it does not replicate vote or trend data.

### 10.4 Secrets Management

**SEC-17** No credentials, API keys, tokens, connection strings, or other secrets may appear in application source code.

**SEC-18** Environment files (`.env` and variants) must not be committed to source control.

**SEC-19** Automated secret scanning must be configured in the CI pipeline before any branch is permitted to merge to the main branch. Secret scanning runs on every pull request.

**SEC-20** Secrets must not appear in application logs. This includes connection strings embedding credentials and tokens passed as query parameters.

**SEC-21** Secrets required at runtime are injected as environment variables at application startup. No external secrets management system (e.g., HashiCorp Vault, cloud provider secrets managers) is required. Secrets must not be hardcoded, baked into container images, or committed to source control (see SEC-17, SEC-18). The set of required runtime secrets must be documented and provided to the operations team prior to first deployment.

### 10.5 Data Protection

**SEC-22** Vote data and trend data must not be written to application logs except where explicitly required for a documented operational need, reviewed by the security team.

**SEC-23** The application's CORS policy must explicitly enumerate permitted origins. Wildcard origins are not permitted for any endpoint returning authenticated or access-controlled data.

**SEC-24** Session data, vote records, trend data, and action items are retained for 15 months (five quarters) from the date of their creation. After 15 months, records are eligible for deletion under the defined retention policy. The deletion process must be documented, auditable, and executable without manual intervention. The retention policy must be verified to be in force prior to production deployment. Any change to the retention period requires review and approval by the executive sponsor.

### 10.6 WebSocket Security

**SEC-25** Authentication established at WebSocket connection time is not sufficient for the lifetime of the connection. The application must re-authorize the connected client at meaningful intervals — no less frequent than once per token expiry window.

**SEC-26** The application must define and implement handling for token expiry during an active WebSocket connection. Because sessions may run up to 90 minutes and token lifetimes may be shorter, the application must implement silent refresh or sliding window token refresh to maintain the connection for the full session duration without user interruption. Required behavior: notify the client that re-authentication is required if the refresh cannot be completed silently; terminate the connection if the client does not complete re-authentication within a defined grace period; session state must not be corrupted by the disconnection. The absolute maximum session lifetime of 90 minutes must be enforced even if a valid token is present.

**SEC-27** Access revocation must take effect on active WebSocket connections within a defined interval.

**SEC-28** The WebSocket handshake must be authenticated. The server must not accept a WebSocket upgrade request from an unauthenticated client.

### 10.7 Dependency Hygiene

**SEC-29** The application must have a documented, automated process for tracking known vulnerabilities in its dependency tree running as part of the CI pipeline. Manual, one-time, or pre-release-only scanning does not satisfy this requirement.

**SEC-30** A documented process must exist for responding to newly identified vulnerabilities after production deployment, defining severity thresholds, response timelines, and escalation paths.

### 10.8 Security Review Process

**SEC-31** A formal threat model must be produced during the application design phase. This threat model must be revisited against the implemented application during the pre-production security review.

**SEC-32** A formal pre-production security review gate must be completed before the application is deployed to production. Deployment is blocked pending security team sign-off.

**SEC-33** Security review findings must be tracked to resolution. Unresolved findings are not automatically accepted; they require explicit acknowledgment with a risk owner and remediation timeline.

---

## 11. Adoption Requirements

Usage is not adoption. A team that completes one session and never returns has not adopted the practice — they have run an experiment. Adoption means a team that has run enough sessions over a long enough period to have accumulated trend data that is meaningful.

**Self-service onboarding that requires no human intervention.** A team that has never used the application must be able to begin using it correctly without assistance. The knowledge that has been carried manually in this organization must be embedded in the application itself. This is not a request for tooltips — it is a requirement that the application be opinionated enough about the ritual that a team following the application's guidance will conduct a recognizable health check.

**Guided first-session experience.** The first session for any team is acknowledged to be longer than standard sessions — the ritual itself recommends an hour for the initial session. The application should support this by providing contextual guidance during the first session: topic-by-topic explanations, space to capture the team's agreed-upon definitions, and a clear indication that this session establishes the baseline from which all future trend data will be measured.

**Sustained use as the success criterion.** The project will not be considered successfully adopted if teams are completing sessions but not returning. Success requires that multiple teams sustain the practice across a minimum of six sessions each and that those sessions have produced trend data visible in the dashboard.

**No facilitation sourcing.** The application does not need to solve the problem of matching teams with facilitators from other teams. However, the application must make the requirement explicit and provide enough context that a new team understands why they need to find one before they can begin.

---

## 12. Organizational Constraints

The following constraints are non-negotiable. They reflect organizational policy decisions within the authority of the executive sponsor and will not be subject to scope trade-offs or deferral.

**Constraint 1: Data access is scoped to each team's reporting structure.**
Session data, vote history, trend charts, and action items for a given team are visible only to the engineers on that team, the team's Engineering Manager, and the facilitator assigned to a given session. No cross-team visibility. No aggregate views that expose team-level scores to individuals outside the reporting chain.

**Constraint 2: Engineering Managers have read-only access and cannot participate as session voters.**
Engineering Managers may view their team's trend history, session summaries, and action item backlog. They may not join a session as a participant, cast votes, or take actions that affect session flow. This constraint must be enforced at the application layer, not governed by convention.

**Constraint 3: Session history is retained for 15 months.**
Session data, vote records, trend data, and action items are retained for 15 months (five quarters) from their creation date. This window is sufficient to support meaningful longitudinal trend analysis across a full annual cycle and one quarter of additional context. Any change to the retention period requires explicit review and approval by the executive sponsor before implementation.

**Constraint 4: Deployment model keeps data within company infrastructure.**
This application will be deployed on-premises or within the company's controlled cloud environment. Data generated in sessions does not leave company infrastructure. The application will be built on open-source dependencies to the maximum practical extent.

---

## 13. ROI Justification

**Attrition cost baseline.** The fully loaded cost of replacing a mid-level software engineer — recruiting fees, interviewing time, onboarding, and the productivity gap during ramp-up — is conservatively estimated at 50 to 150 percent of that engineer's annual compensation. One preventable departure, where early visibility into declining team health could have triggered an intervention, represents a cost that dwarfs the investment required to build and operate this application.

**Spreadsheet overhead elimination.** The current spreadsheet-based process imposes real but diffuse costs: facilitators manually transcribe votes, maintain version history, own the artifact personally, and have no automated outlier detection or trend computation. The process breaks entirely when the spreadsheet owner leaves the team.

**Organizational scalability.** The spreadsheet model does not scale. Adding a new team requires a new spreadsheet, a new owner, and a new process — with no common format and no cross-team consistency. The application makes every additional team a first-class participant in the same system with no marginal overhead.

**Value of early warning.** Engineering health problems caught at the trend stage are far less expensive to address than the same problems discovered after they have driven attrition or delivery failure. The trend dashboard and outlier detection are an investment in earlier intervention.

---

## 14. Success Criteria

Success criteria are aggregated across all stakeholder perspectives. The project will be considered successful when all of the following conditions are met.

| Stakeholder                  | Success Criterion                                                                                                                                          |
|------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Executive Sponsor (Rachel)   | Three or more teams have completed at least six sessions with measurable trend data visible in the dashboard                                               |
| Executive Sponsor (Rachel)   | At least one team has used action item tracking to close a loop — an issue surfaced in a session was addressed and marked resolved in a subsequent session |
| Executive Sponsor (Rachel)   | A trend history review has surfaced something that would not have been known otherwise                                                                     |
| Executive Sponsor (Rachel)   | No engineer has raised a concern that the data is being used in an evaluative or punitive way                                                              |
| Internal Champion (Devon)    | A team he has never spoken to adopts the ritual using the application without needing him to explain it                                                    |
| Internal Champion (Devon)    | The ritual is still being practiced, with the same core mechanics intact, two years after launch                                                           |
| Internal Champion (Devon)    | No manager has participated in a session, and no exception to that rule has been made                                                                      |
| Requirements Author (Marcus) | The implementation team can build each feature area from the documented requirements without re-interviewing stakeholders                                  |
| Requirements Author (Marcus) | A facilitator who has never used the application can run a complete session without consulting documentation                                               |
| Facilitator SME (Priya)      | She can facilitate a complete session without referring to a spreadsheet or external notes                                                                 |
| Facilitator SME (Priya)      | The reveal moment feels like an event: votes appearing simultaneously, with aggregate and outliers surfaced immediately after                              |
| Solution Architect (Ingrid)  | Every significant architectural decision is documented with rationale and alternatives considered and rejected                                             |
| Solution Architect (Ingrid)  | The team can demonstrate what happens when Redis is unavailable mid-session                                                                                |
| Security Analyst (Tomás)     | The threat model produced during design is revisited against the implemented application before production deployment                                      |
| Security Analyst (Tomás)     | Server-side authorization is verified independently of the frontend; no endpoint returns data the requesting user is not authorized to see                 |

---

## 15. Risks

| Risk                                                                 | Severity | Owner                                   | Mitigation                                                                                                             |
|----------------------------------------------------------------------|----------|-----------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| Adoption stalls without a champion on each team                      | High     | Executive Sponsor                       | Begin rollout with teams where a willing champion has been identified; design first-session for low friction           |
| Over-engineering delays time to value                                | High     | Implementation Team                     | Ship usable application to first team quickly and iterate; defer features not needed for first six sessions            |
| Surveillance perception kills the ritual                             | Critical | Executive Sponsor + Implementation Team | Data access model, in-app framing, and outlier display must all reinforce that this is the team's data                 |
| The reveal mechanic gets simplified away                             | Critical | BA + Facilitator SME                    | Server-authoritative reveal is a hard requirement; client-side timer approximations are not acceptable                 |
| Facilitator and participant views blur                               | High     | BA + Facilitator SME                    | Facilitator view must be a distinct UX architecture, not a participant view with extra buttons                         |
| Constraints become configurable options                              | Critical | Internal Champion                       | Simultaneous reveal, no-manager rule, and cross-team facilitator requirement must be structural, not settings          |
| Edge cases discovered late become scope disputes                     | Medium   | BA                                      | Requirements cover known scenarios; implementation team should treat new edge cases as gaps to close, not out-of-scope |
| The first release ships without trend data visible                   | Medium   | BA                                      | Design for "zero sessions" and "one session" states explicitly; do not let dashboard appear broken for new teams       |
| The real-time layer is under-specified                               | High     | Solution Architect                      | Architecture checkpoint required before full WebSocket layer implementation                                            |
| Authorization logic leaks into the frontend                          | High     | Security Analyst                        | Authorization enforced server-side on every endpoint; tested independently of frontend before production               |
| Redis treated as more durable than it is                             | High     | Solution Architect                      | Explicit documentation of ephemeral vs. persistent state boundary; Redis restart recovery tested before production     |
| "It's just an internal app" becomes the answer to security questions | High     | Security Analyst                        | All SEC- requirements carry the same weight as functional requirements; deferral requires explicit risk acceptance     |
| Secrets land in source control                                       | High     | Security Analyst                        | Automated secret scanning in CI before first commit to main branch                                                     |

---

## 16. Open Questions and Known Gaps

### From Requirements Analysis (Marcus Delgado)

**OQ-1: Zero-Session State**
Should the application present a distinct onboarding experience for a team's first session, or is a set of "no data" empty states sufficient? If a distinct flow is warranted, this affects Session Setup and may require a first-session variation. Requires a product decision before design begins.

**OQ-2: Session State Recovery After Interruption — Partially Resolved**
Resolved: When a facilitator disconnects mid-session, the session is not abandoned. Upon reconnection and successful re-authentication, the facilitator may rejoin the session they created and resume full facilitation control (see OR-1.7). The session remains in its last known state during the facilitator's absence.

Remaining open: (a) Whether an Application Administrator can reassign facilitator control to another user mid-session; (b) what timeout or staleness policy applies to a session stuck in an active or wrap-up state; (c) whether partial sessions are stored as history artifacts or discarded. These items require a product decision before design of session state management is complete.

**OQ-3: Topic Management Edge Cases**
- Topic added mid-cycle: no historical data exists. How is it represented on the Trend Dashboard?
- Topic reactivation: if a removed topic is re-added, does its prior history resume or does a new record begin?
- Duplicate topic names: is the application responsible for preventing duplicate active topic names within a team?

**OQ-4: Facilitator Vote Visibility in Session History**
What are the visibility rules for individual vote values in historical session views, broken down by role: Participant (their own team's sessions), Facilitator (sessions they led vs. did not lead), EM, and Administrator?

**OQ-5: Action Item Ownership When a Team Member Leaves**
- Can an action item's owner be reassigned? If so, by whom?
- When a member is removed from a team, are their open action items orphaned, reassigned, or flagged?
- Should the application block removal of a team member who has open action items?

### From Architecture Review (Ingrid Sollenberger)

**OAQ-001: Dropped WebSocket Mid-Vote**
What is the system behavior when a participant's WebSocket connection drops after they have submitted a vote but before the facilitator has triggered vote reveal? Is the vote retained on the server and does it count toward the reveal? This must be documented as a decision, not discovered during testing.

**OAQ-002: Redis Restart Recovery During Live Session — Resolved**
If Redis becomes unavailable during an active session, the server applies exponential back-off retry. If Redis remains unavailable for five continuous minutes, the session is abandoned. Participants and the facilitator receive an explanatory notification. The abandonment event is recorded in the audit log. See NFR-REL-004 and NFR-DATA-003 for the full requirements.

**OAQ-003: OIDC Provider Swap Verification — Resolved**
The architecture's provider-agnosticism assumption must be verified before production (see NFR-AUTH-002). Additionally resolved: a simulated OIDC provider must be used for all local and development machine testing. Real OIDC providers are used only in deployed environments (QA, staging, production). See NFR-AUTH-002 for the full requirement.

**OAQ-004: Session State Recovery After Application Restart**
If the application process restarts during an active live session, what state is recoverable from PostgreSQL versus lost from Redis? Is mid-session application restart a supported recovery scenario, or does it require a new session?

**OAQ-005: Authorization Boundary for WebSocket Events**
It has not yet been confirmed that every privileged WebSocket event (reveal trigger, session close, topic advance) is subject to server-side role verification. This must be audited and confirmed before the real-time layer is considered complete.

---

## 17. Requirement Traceability

| Requirement ID | Requirement Summary                                | User Need Addressed                                                      |
|----------------|----------------------------------------------------|--------------------------------------------------------------------------|
| FR-1.1         | Authenticate via external OIDC only                | Leverage existing SSO; no separate credential management                 |
| FR-1.3         | Four-role model enforced                           | Prevent EMs from voting; ensure facilitators are external to team        |
| FR-1.7         | Teams may be created independently of session creation, by Facilitators or EMs | Support organizations that prefer to configure teams before the first session |
| FR-2.1         | Only facilitators create sessions                  | Preserve facilitator neutrality and authority                            |
| FR-2.2         | Facilitator cannot create session for own team     | Enforce cross-team facilitator requirement                               |
| FR-2.3         | Unique, non-guessable join link                    | Control who enters the session; prevent uninvited access                 |
| FR-3.1         | Open action items surface before first topic       | Ensure prior commitments are reviewed before new ones are made           |
| FR-4.5         | Facilitator sees readiness, not vote values        | Facilitator can manage pacing without biasing the reveal                 |
| FR-4.6         | Reveal is simultaneous and facilitator-triggered   | Preserve voting honesty; prevent anchoring bias                          |
| FR-4.7         | Votes immutable after reveal                       | Preserve integrity of the historical record                              |
| FR-5.5         | Facilitator decides whether to open discussion     | Preserve facilitator authority; prevent mechanical disruption of flow    |
| FR-6.5         | Session remains mutable until explicit close       | Allow facilitator to correct wrap-up data before it is locked            |
| FR-7.1         | Action items persist; resolved rather than deleted | Create accountability continuity across all sessions                     |
| FR-7.1a        | Pre-close deletion of wrap-up-created items permitted | Allow facilitator to correct data-entry errors before items enter the permanent record |
| FR-7.4         | Stale item flagging                                | Surface neglected commitments before they are forgotten                  |
| FR-8.3         | Topic removal preserves history                    | Protect longitudinal trend data after topic set changes                  |
| FR-9.5         | EM view shows aggregates, not individual votes     | Allow management visibility without exposing individual participant data |
| FR-4.6.1       | Reveal event must reach all clients within 15 seconds | Enforce simultaneity SLA; surface latency failures before production |
| FR-5.1         | Individual outlier threshold defined at ±1.5 from session average | Consistent, facilitator-independent outlier detection      |
| FR-5.2         | Individual outlier threshold configurable, default ±1.5 | Allow calibration without code changes; auditable default           |
| FR-9.7         | Trend dashboard empty state: "Insufficient data." | Prevent broken UI for teams with limited session history                 |
| NFR-AUTH-002   | Simulated OIDC provider required for local/dev testing | Isolate real identity provider from non-production environments     |
| NFR-AUTH-005   | 90-minute session lifetime; sliding/silent token refresh required | Support full session duration without mid-session reauthentication |
| NFR-DEP-001    | Kubernetes is the confirmed production deployment target | Establish unambiguous deployment target for implementation         |
| NFR-REL-004    | Redis unavailable 5 minutes → session abandoned   | Eliminate silent degradation; protect data integrity                     |
| SEC-21         | Secrets injected as environment variables at startup | No external secrets manager required; explicit injection model        |
| SEC-24         | Session data retained for 15 months (five quarters) | Define retention policy for compliance and data lifecycle management   |
| SEC-7          | Server-side authorization enforcement              | Prevent UI bypass from exposing unauthorized data                        |
| SEC-13         | Audit logging of all security-relevant events      | Enable post-hoc incident reconstruction and anomaly detection            |
| SEC-19         | Automated secret scanning in CI                    | Prevent credential leakage to source control                             |
| NFR-GOV-002    | Architecture checkpoints at key milestones         | Catch architectural risks before they are expensive to reverse           |

---

*End of Document*

*This Business Requirements Document was developed through structured collaboration with implementation team personas representing the executive, domain, operational, architectural, and security perspectives on this project. Requirements marked [HARD] are non-negotiable constraints that must not be relaxed without escalation to the executive sponsor. Requirements marked [PREF] carry strong stakeholder preference but may be subject to implementation trade-offs.*
