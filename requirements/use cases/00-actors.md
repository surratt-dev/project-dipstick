# Actors

## Human Actors

---

### Engineer

An individual contributor on a product engineering team. Engineers are the primary participants in the Engineering Health Check — they cast votes, hear each other's perspectives, and own the action items that emerge from sessions.

**Goals:**
- Express an honest assessment of the team's engineering health without social pressure
- Understand how teammates perceive the same topics
- See whether conditions are improving or worsening over time
- Follow through on action items they own

**Motivations:**
- Frustrations with the codebase or process are rarely surfaced in the normal flow of work; this ritual gives them a legitimate space to name them
- Wants the team to function well and the codebase to be something they're proud of
- Values the simultaneous reveal because it removes the incentive to anchor on others' opinions before committing to a position

**Constraints:**
- Participates in sessions but has no administrative control over topics, teams, or session flow
- Cannot change a vote after locking in

---

### Facilitator

An engineer from a *different* team than the one being assessed. The Facilitator runs the session: advancing topics, triggering the vote reveal, identifying outliers, prompting discussion, and capturing action items. Because they are not on the team, they can remain neutral and ensure all voices are heard.

**Goals:**
- Keep the session focused and on time (target: 30 minutes)
- Surface outliers and prompt brief, productive discussion without taking sides
- Ensure the team leaves with clear, owned action items

**Motivations:**
- Has likely experienced the Engineering Health Check as a participant and understands its value
- Wants to create a safe, equitable environment where every engineer feels heard
- Is not responsible for solving the problems raised — only for helping the team identify and articulate them

**Constraints:**
- Must be authenticated and recognized by the application as a member of a *different* team than the one being facilitated
- Controls session pace and flow but does not vote
- Responsible for distributing the session join link to participants out-of-band
- Can create and update action items; cannot modify historical session data

---

### Engineering Manager

A manager whose direct reports include members of one or more engineering teams. The Engineering Manager does not participate in sessions — they review results afterward to monitor team health trends and follow up on action items outside the application.

**Goals:**
- Understand the trajectory of their team's engineering health over time
- Identify persistent issues that may require organizational support
- Review action items to understand what the team is working to improve

**Motivations:**
- Cannot be present in sessions (by design — their presence would inhibit honest participation)
- Relies on the application to give them visibility they would otherwise lack
- Wants to intervene when a trend signals a real problem, not just a bad week

**Constraints:**
- Read-only access to session history, trend data, and action items for their team(s)
- Cannot create sessions, cast votes, modify topics, or update action items
- Visibility is limited to teams they manage

---

## System Actors

---

### Identity Provider

An external authentication service that validates user identity before granting access to the application. The application trusts the provider's assertion — if the provider confirms the user, they are allowed in.

**Responsibilities:**
- Authenticate users via the organization's existing credentials (e.g., SSO)
- Return a verified identity to the application

**Constraints:**
- Does not manage team membership, roles, or session access — those are owned by the application
- Operates entirely outside the application's control

---

### Application

The Engineering Health Check system itself, acting as an automated actor for behaviors that occur without direct human initiation.

**Responsibilities:**
- Detect individual and trend outliers after each vote reveal
- Flag action items that have been open across multiple sessions without a status update
- Calculate and persist trend data after a session is marked complete
- Enforce vote lock-in (votes cannot be changed after submission)
- Enforce simultaneous reveal (no votes visible to others until the facilitator triggers it)
