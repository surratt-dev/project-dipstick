# Engineering Health Check — Web Application Proposal

## Overview

This proposal describes a web application that supports the full Engineering Health Check ritual: facilitating live sessions, capturing votes in real time, surfacing outliers and trends, and tracking action items across sessions. The application replaces the spreadsheet while preserving the integrity of the ceremony — particularly its most important mechanic, the simultaneous vote reveal.

---

## Who Uses It

| Role | What They Do in the App |
|---|---|
| **Facilitator** | Runs the session: advances topics, triggers reveals, flags discussion items |
| **Engineer (participant)** | Joins a session for their team, casts votes, sees results and trends |
| **Engineering Manager** | Views their team's session history and trends; does not participate in sessions |

Metrics for a team are visible only to its members, its Engineering Manager, and the current session's facilitator.

---

## Session Flow

### Before the Session

Each session belongs to a team. The facilitator starts a session for a specific team, which generates a join link or code. Participants follow that link to enter the session room.

Before the first topic begins, the application surfaces any **open action items** from previous sessions — who owns them and their current status. The facilitator reviews these briefly with the team, and owners can update the status in real time. This closes the loop on prior sessions before the new one begins.

### During the Session

The facilitator controls the pace entirely. They advance through topics one at a time. For each topic, the sequence is:

1. The prompt and vote type appear on screen for all participants
2. Participants privately select their vote — their choice is not visible to anyone else
3. Each participant "locks in" their vote, represented by a closed fist icon that appears on the facilitator's view
4. Once all participants have locked in (or the facilitator calls it), the facilitator triggers the reveal
5. All votes appear simultaneously for everyone in the session
6. The application immediately highlights outliers and any significant change from this team's historical trend on that topic
7. The facilitator decides whether to prompt discussion; they can mark a topic for discussion or continue
8. Results are saved automatically

### After the Session

At the close of a session, the facilitator has a brief window to review the session's discussion notes and confirm any new action items — who owns them and a brief description. The session is then marked complete and its data is immediately incorporated into the team's trend history.

---

## The Voting Experience

The simultaneous reveal is the most important mechanic in this process, and the place where the application can most meaningfully elevate the experience.

### The Reveal Moment

In-person, this moment is a shared physical act: a countdown, then hands go up together. The web application should replicate that quality of simultaneity and shared disclosure. Participants see the prompt, select their response, and commit. Once committed, they see only their own vote and a view of who else has locked in — not what anyone voted. The facilitator's screen shows readiness at a glance: a grid of participant names, each going from "thinking" to "ready" as fists close.

When the reveal is triggered, votes appear for everyone at the same instant. The moment should feel like an event, not a page refresh. A brief animation — votes appearing card by card, face up — preserves the social weight of the reveal. The aggregate (average or tally) appears immediately after.

### Committing to a Vote

A participant cannot change their vote after locking in. This mirrors the in-person experience where you can't take back your hand signal once the countdown finishes. The application should make this clear before they commit: a confirmation step or a deliberate "lock in" button rather than a passive auto-submit.

### Vote Types

The application supports all three vote types without requiring participants to understand the mechanics before they arrive. The UI adapts to the vote type:

- **Finger vote (1–4):** Four clearly labeled options with a brief descriptor at each end ("Poor" / "Very good"). No middle option.
- **Roman vote (Up/Down):** Two options. Framed as a binary: the thing is working or it isn't.
- **Modified Roman (Up/Steady/Down):** Three options, used only for the Project Trend topic. Clearly labeled as direction of travel, not a quality rating.

---

## The Facilitator View

The facilitator's view is a control surface, not a participant view. It is distinct from what engineers see.

**During a topic:**
- The current prompt and vote type are displayed prominently
- A readiness grid shows each participant's status (thinking / ready) — not their vote
- A "Trigger Reveal" button becomes available once a threshold of participants are ready; the facilitator decides when to call it

**After reveal:**
- The full vote distribution is shown with the aggregate
- Outliers are automatically highlighted (see below)
- The trend for this topic is shown alongside the current result — the facilitator can see at a glance if this is a departure from the norm
- The facilitator can mark the topic for discussion or advance to the next one

**Across the session:**
- A session progress indicator shows which topics have been completed
- Topics marked for discussion are collected in a sidebar for easy reference

---

## Outlier Detection and Discussion Prompts

The application removes the cognitive burden of outlier identification from the facilitator. After each reveal, the system automatically flags:

- **Individual outliers:** A vote that diverges from the group by a defined threshold (e.g., more than 1.5 points from the group average on a finger vote)
- **Trend outliers:** A result that represents a significant departure from this team's recent average on this topic (e.g., more than 1 point below the trailing 4-session average)

These are surfaced visually — not buried in a table — so the facilitator can immediately see whether a discussion is warranted. The flagging is advisory, not prescriptive: the facilitator always decides whether to open the floor.

When an outlier is flagged, the participant whose vote was flagged is gently prompted to share their perspective. The experience should feel like an invitation, not a spotlight. Other participants are cued to listen.

---

## Trend Dashboard

Each team has a historical view of their sessions. This is where the value of consistent tracking compounds over time.

### Per-Topic Trends

Each topic is shown as a line over time, session by session. The trend view makes visible what a spreadsheet obscures: the shape of a team's trajectory. A score of 2.5 means something different if it follows six sessions at 3.8 than if it follows three sessions at 2.0.

The dashboard defaults to showing the last six sessions, with the ability to see the full history. The "Project Trend" (Modified Roman) is displayed separately as a directional indicator rather than a numeric trend.

### Session Summaries

Each historical session is accessible in full — who participated, what the votes were, which topics triggered discussion, and what action items were created. This gives the facilitator context before each new session and allows Engineering Managers to review sessions they weren't present for.

### Significant Moments

The trend view highlights notable events: the first session after a new feature push, a session where Project Trend went to thumbs down for the first time, or a sustained improvement following an action item. These provide narrative context that raw scores don't convey. Teams can annotate sessions with a brief label (e.g., "post-launch cleanup sprint") to make these moments legible in retrospect.

---

## Action Items

Action items are created during or immediately after a session. They are first-class objects, not notes.

Each action item has:
- A description of the issue or improvement
- An owner (an engineer on the team)
- A status (open, in progress, resolved)
- The session it was created in
- Optionally, the session in which it was resolved and a brief note on what was done

### Continuity Across Sessions

Every session begins with a review of open action items. Owners can update status in real time during this review. If an action item is marked resolved, the owner can add a brief note on what was done — this feeds back into the team's understanding of what actually moves the needle.

Action items that have been open for multiple sessions without a status update are flagged. This is not punitive — it surfaces the item for the team to reassess whether it is still relevant or should be closed.

### Visibility

Action items are visible to team members, their Engineering Manager, and the current facilitator. Engineering Managers can see the full backlog across sessions without being able to modify them. The facilitator can create and update action items during the session.

---

## Topic Management

Each team starts with the default set of topics drawn from the Engineering Health Check process. Teams are expected to review and adapt these to their context.

### Team-Owned Topics

The team (or facilitator on their behalf) can:
- Add new topics with a custom prompt, vote type, and description
- Remove topics that don't apply to their context
- Reorder topics within their session flow
- Annotate each topic with a shared team definition — what this topic means *to us*, which prevents drift in interpretation across facilitators

### Topic History

When a topic is removed, its historical data is retained. If a team removes a topic and later re-adds it, the history is preserved. The trend view makes clear where a topic was paused and restarted.

### First Session Handling

The first session for a team is longer by design (the process recommends an hour). The application can support this by providing an optional onboarding mode for the first session: topic-by-topic explanations, space to capture the team's agreed definitions, and a lower-pressure pacing for the facilitator. Subsequent sessions default to the standard flow.

---

## What This Application Does Not Try to Solve

- **Facilitator sourcing and matching:** Finding a facilitator from another team is a human and organizational process. The application does not model or assist with this.
- **Conflict resolution:** When a significant conflict surfaces in a session, that is escalated to the Engineering Manager outside the tool.
- **Onboarding:** Teams are assumed to understand the process before they begin using the application.
- **Scheduling:** The application does not manage calendar invitations or meeting cadence. Sessions are created manually by the facilitator when they are ready to begin.
