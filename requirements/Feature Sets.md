# Engineering Health Check — Feature Sets

## Decisions Captured

| Topic | Decision |
|---|---|
| Authentication | Delegated to external identity provider; if the provider validates the user, they can use the application |
| Team membership | Managed by this application |
| Manager/team relationship | Managed by this application |
| Team creation | No admin role required; any authenticated user can create a team as part of creating a session |
| Notifications | Out of scope; facilitator distributes join links manually |
| First session variation | Out of scope; all sessions follow the same flow |
| Topic customization | Default set is used for a team's first session; full customization is available after the first session |

---

## Feature Sets

### 1. Identity & Access

Integration with an external identity provider for authentication. The application trusts the provider's validation — no registration or credential management. The application owns team membership, member roles (engineer, facilitator, engineering manager), and manager/team relationships.

### 2. Session Setup

A facilitator creates a new session by selecting an existing team or creating a new one. The application generates a join link. The facilitator distributes the link to participants out-of-band. Participants join the session room via that link.

### 3. Pre-Session Action Item Review

Before the first topic begins, the application surfaces all open action items from the team's prior sessions — owner, description, and current status. Owners can update status in real time during this review. This closes the loop on prior sessions before new voting begins.

### 4. Live Voting

The core session mechanic. The facilitator advances through topics one at a time. For each topic:
- The prompt and vote type are displayed to all participants
- Participants privately select and lock in their vote (irreversible after lock-in)
- The facilitator sees a readiness grid (locked in / not yet) but not the votes
- The facilitator triggers the simultaneous reveal
- All votes appear at once for everyone

Supports all three vote types: finger vote (1–4), roman vote (up/down), and modified roman (up/steady/down).

### 5. Outlier Detection & Discussion Prompts

After each reveal, the application automatically flags:
- **Individual outliers:** votes that diverge significantly from the group
- **Trend outliers:** results that represent a significant departure from the team's recent average on that topic

Outliers are surfaced visually on the facilitator's view. The facilitator decides whether to open discussion; flagging is advisory. Participants whose votes are flagged are prompted to share their perspective.

### 6. Session Wrap-up

After all topics are complete, the facilitator reviews discussion notes and confirms any new action items (owner and description). The session is then marked complete and its data is incorporated into the team's trend history.

### 7. Action Item Management

Action items are first-class objects tracked across sessions. Each has a description, an owner (an engineer on the team), a status (open / in progress / resolved), and the session in which it was created. Resolved items can include a note on what was done. Items open across multiple sessions without a status update are flagged.

Action items are visible to team members, the team's engineering manager, and the current session's facilitator. The facilitator can create and update action items during the session.

### 8. Topic Management

Each team starts with the application's default topic set. After the team's first session, the facilitator can:
- Add custom topics (with prompt, vote type, and description)
- Remove topics that don't apply
- Reorder topics within the session flow
- Annotate topics with a shared team definition

Historical data for removed topics is retained. If a topic is removed and later re-added, its history is preserved and the trend view reflects the gap.

### 9. Trend Dashboard & Reporting

Each team has a historical view of their sessions. Includes:
- **Per-topic trend charts** — results over time, defaulting to the last six sessions with full history available
- **Session history** — full detail for each past session: participants, votes, discussion notes, action items created
- **Engineering manager view** — read-only access to a team's session history and trends without session participation

The Project Trend (modified roman) is displayed as a directional indicator separate from numeric trend charts.
