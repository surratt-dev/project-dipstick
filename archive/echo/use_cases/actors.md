# Actors - Engineering Health Check Application

## 1. Participant (Team Member)

**Description:** A software engineer or team member who participates in Engineering Health Check sessions for their team.

**Goals:**
- Participate in voting sessions to share honest feedback about team health
- View historical trends to understand team's progress over time
- Add notes during sessions to contribute to discussion
- Track and complete action items assigned to them

**Motivations:**
- Wants a safe, anonymous way to express concerns about codebase, tooling, or processes
- Desires visibility into team health trends to validate improvements or identify issues
- Wants accountability for improvements through action items
- Benefits from collaborative problem-solving during sessions

---

## 2. Facilitator

**Description:** A team member from another team (or designated person) who leads and coordinates Health Check sessions.

**Goals:**
- Create and manage voting sessions for assigned teams
- Guide the session through topics in a timely manner
- Ensure all participants have an opportunity to contribute
- Create and assign action items based on discussion
- Add session notes to capture context

**Motivations:**
- Wants to help other teams improve by facilitating objective feedback
- Needs efficient controls to manage session pacing
- Values building trust through neutral facilitation
- Seeks to track action items to ensure follow-through

---

## 3. Engineering Manager

**Description:** The manager of a team who monitors team health metrics after sessions conclude. They do NOT attend live sessions to ensure participants have emotional safety to vote and communicate honestly.

**Goals:**
- View complete session results (including individual votes) after sessions conclude
- View team health trends over time without influencing votes
- Review and track action items assigned to their team
- See aggregate health metrics to make informed decisions
- Ensure their team has access to necessary resources for improvement

**Motivations:**
- Wants objective insight into team health without introducing bias
- Values ensuring team has safe space to express concerns honestly
- Needs data to support team improvements and resource allocation
- Values tracking progress on team health initiatives
- Cares about team well-being and removing blockers

---

## 4. System (Application)

**Description:** The web application itself, handling authentication, real-time synchronization, and data persistence.

**Goals:**
- Authenticate users via Microsoft Entra ID
- Enforce role-based access control
- Synchronize real-time state across all connected clients
- Calculate voting results and identify outliers
- Store and retrieve session data, trends, and action items
- Manage session lifecycle (create, active, concluded)

**Motivations:**
- Ensures security through proper authentication and authorization
- Maintains data integrity for accurate trend analysis
- Provides responsive real-time experience for live sessions
- Supports multiple teams and facilitators efficiently
