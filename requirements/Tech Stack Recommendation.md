# Engineering Health Check — Tech Stack Recommendation

## Guiding Constraints

- Open source technologies preferred throughout
- Responsiveness and real-time behavior are first-class requirements
- Concurrent user load is company-scale, not internet-scale
- Single tenant (one company, multiple teams)
- Authentication delegated to an external identity provider; initial implementation targets Microsoft Entra, with an abstraction layer supporting future providers

---

## Stack Overview

| Layer | Technology |
|---|---|
| Frontend | React (TypeScript) |
| Backend | Node.js + Fastify (TypeScript) |
| Real-time | WebSockets |
| Database | PostgreSQL |
| Ephemeral session state | Redis |
| Authentication | OIDC abstraction layer, wired to Microsoft Entra |
| Deployment | Docker containers |

Using TypeScript across both frontend and backend is a deliberate choice: shared types for votes, sessions, and action items can be defined once and used on both sides, reducing the surface area for bugs at the boundary between client and server.

Fastify is chosen over Express specifically for its schema-driven request validation and response serialization. Defining the contract at the route layer — what a valid vote looks like, what a session state response contains — enforces strong contracts throughout the application and catches malformed data before it reaches business logic.

---

## Components

### Frontend

A React single-page application handles all user-facing screens. The frontend communicates with the backend over both HTTP (for standard data operations) and a persistent WebSocket connection (for live session state).

React is well-suited here because the live session room requires fine-grained, reactive UI updates — individual participant readiness indicators, the reveal animation, and real-time action item status changes all benefit from component-level reactivity without full-page reloads.

### Backend

A Node.js server built on Fastify handles HTTP requests and manages WebSocket connections. Node's event-driven model handles the concurrent WebSocket connections of a live session efficiently at company scale without requiring a more complex concurrency model.

The backend is responsible for:
- Serving the API consumed by the frontend
- Managing WebSocket connections for live sessions
- Enforcing authorization rules (who can see which team's data)
- Coordinating the voting state machine (collecting votes, triggering reveals)
- Persisting session results to the database

### Real-Time Layer

The simultaneous vote reveal requires a real-time communication channel between the server and all session participants. WebSockets provide a persistent, bidirectional connection that allows the server to push state changes to all connected clients simultaneously — the reveal event, readiness updates, and action item changes during session review all flow over this channel.

The server holds the authoritative session state. Clients do not communicate directly with each other; all state flows through the server. This ensures that the reveal is genuinely simultaneous and that no client can observe another's vote before the reveal is triggered.

### Database

PostgreSQL stores all persistent data: teams, users, sessions, votes, topics, and action items. It is open source, operationally well-understood, and well-suited to the relational structure of this domain. At company scale, a single well-provisioned PostgreSQL instance is sufficient.

### Ephemeral Session State

During a live session, fast-changing state — who has joined, who has locked in their vote, what votes have been cast but not yet revealed — is held in Redis. This data does not need to survive a server restart; it exists only for the duration of the session. Redis provides the low-latency reads and writes needed to keep the facilitator's readiness view current in real time.

Once a session concludes, the final results are written from Redis to PostgreSQL and the ephemeral session state is discarded.

### Authentication

Authentication is fully delegated to an external identity provider via the **OpenID Connect (OIDC)** protocol. The backend implements a single OIDC client interface; the identity provider is a configuration concern, not a code concern. Swapping from Microsoft Entra to another OIDC-compliant provider (Okta, Google Workspace, Auth0, etc.) requires only a configuration change, not a code change.

The initial implementation is configured against Microsoft Entra. The abstraction is provided by an open source OIDC client library rather than a proprietary SDK, which keeps the integration portable.

Sessions within the application are managed via short-lived tokens issued after successful authentication with the identity provider. The application never handles or stores user passwords.

---

## High-Level Routes

### Browser-Navigable Pages

| Route | Description |
|---|---|
| Login | Entry point; redirects to the identity provider for authentication |
| Auth Callback | Receives the identity provider's response and establishes an application session |
| Home / Dashboard | Landing page after login; shows the user's team and any active or upcoming sessions |
| Live Session Room | The real-time session interface; different views for facilitator and participants |
| Session History | A past session's full record: votes, discussion notes, action items created |
| Team Trend Dashboard | Historical trend view for a team across all sessions |
| Action Items | Full list of a team's action items across sessions, with status |
| Topic Configuration | Manage the set of topics for a team: add, remove, reorder, annotate |

### API Surface (consumed by the frontend)

| Area | Operations |
|---|---|
| Auth | Initiate login, handle callback, logout |
| Sessions | Create a session, retrieve session state, mark session complete |
| Voting | Submit a vote, trigger a reveal |
| Action Items | Create, update status, list by team or session |
| Topics | List, create, update, remove for a team |
| Teams | List teams visible to the current user |
| Users | Resolve identity provider identity to application user |

### WebSocket Events

The WebSocket channel is used exclusively for live session state. Events flowing over this channel include:

- Participant joins or leaves the session room
- A participant locks in their vote (readiness update — not the vote itself)
- The facilitator triggers the reveal (all votes become visible simultaneously)
- A topic is advanced by the facilitator
- An action item is created or updated during the session

---

## Deployment

The application is packaged as Docker containers: one for the backend (which also serves the built frontend assets), one for PostgreSQL, and one for Redis. This makes it deployable to any environment that supports containers — a cloud provider or on-premises infrastructure — without changes to the application code.

A container orchestration layer (such as Docker Compose for simpler deployments, or Kubernetes for more managed environments) handles the coordination between containers. At company scale, Docker Compose is likely sufficient for an initial deployment.

---

## What This Stack Deliberately Does Not Include

- **A managed cloud database service:** The recommendation uses self-hosted PostgreSQL. If the organization prefers a managed service (e.g., Azure Database for PostgreSQL), that is a deployment decision, not a change to the application stack.
- **A CDN or edge layer:** Not necessary at company scale.
- **A message queue:** The real-time requirements here are met by WebSockets and Redis without introducing a full message broker.
- **A search engine:** No full-text search requirements are anticipated.
