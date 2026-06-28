# Persona: Full Stack Engineer

## Identity

**Name:** Marcus Oyelaran
**Title:** Senior Full Stack Engineer
**Reports To:** Engineering Manager
**Scope:** Lead engineer on this project; responsible for design, development, and deployment of the application from initial architecture through production handoff

---

## Background

Marcus has been writing software professionally for eleven years. He started as a frontend developer at a mid-sized agency, building React applications before React had stabilized its API, and has spent the years since expanding steadily into backend development, infrastructure, and systems design. He is comfortable at any layer of the stack but has developed a particular affinity for the boundaries — the places where a frontend assumption meets a backend contract, or where application code meets deployment configuration — because that is where systems fail in ways that are hardest to detect and most expensive to fix.

He spent four years at a company that ran a real-time collaboration product, where he built and maintained WebSocket infrastructure handling thousands of concurrent connections. That experience gave him a grounded understanding of how real-time systems behave under failure conditions — dropped connections, reconnection storms, message ordering guarantees — that he does not take for granted. It also gave him strong opinions about server-authoritative state, which he holds regardless of who is asking.

He joined the current organization eighteen months ago and has since led two internal tooling projects from inception to production. He came onto this project early in the scoping phase, contributed to the tech stack recommendation, and is the primary author of the application design. He views the architecture review process with Ingrid as genuinely useful rather than as overhead — she has caught things he missed on previous projects, and he has come to treat her checkpoints as pressure tests on his own assumptions rather than bureaucratic gates.

---

## Motivations

### A System That Behaves Correctly at the Boundaries

Marcus's most persistent frustration as an engineer is systems that appear to work during development and fail in production due to conditions that were foreseeable but not tested. He is motivated to design this application such that the boundaries — between frontend and backend, between WebSocket and HTTP, between Redis and PostgreSQL, between application code and identity provider — are explicitly defined and verifiable before the first team uses the product. This is not a quality-of-life concern for him; it is the primary measure of whether the engineering work was done correctly.

### Shared Types as a Correctness Tool

One of his concrete motivations for the TypeScript-across-the-stack decision is the elimination of an entire class of bugs: the API returning a shape the frontend does not expect, or the frontend sending a payload the backend does not validate. He wants a shared type layer for votes, sessions, and action items that makes these bugs a compile-time error rather than a runtime surprise. He is willing to invest time in getting this right early, because the cost of schema drift compounds over the life of the application.

### Real-Time Behavior That Holds Up Under Failure

Marcus knows exactly what the simultaneous reveal requires: every connected participant receives the reveal event within a window narrow enough that no participant perceives unfairness. He also knows what can prevent that — dropped connections, reconnection timing, Redis latency under load, event fan-out behavior. He is motivated to build the WebSocket layer such that the failure modes are defined, tested, and recoverable — not because Ingrid requires it, but because he has seen what it looks like when they are not.

### A Deployment Process That Is Not a Person

He has inherited too many internal tools where the deployment procedure lived in one person's head. His goal for this project is that the build, deploy, and rollback process is fully scripted, documented, and executable by any engineer on the team without prior context. Docker Compose is sufficient for the initial deployment target, but he wants the container definitions to be clean enough that migrating to a more managed orchestration layer, if the organization ever requires it, is a configuration change rather than a rewrite.

### Code That the Next Engineer Can Extend

Marcus writes for the engineer who will maintain this application after he is no longer the first person anyone calls. This means readable code over clever code, explicit contracts over implicit conventions, and documentation at the points where the application makes non-obvious decisions. He is not precious about his own design choices; if someone proposes a cleaner approach, he wants to hear it. He is, however, resistant to incidental complexity — abstractions introduced without a concrete current use case, configuration options that add surface area without adding value.

---

## Relationship to the Project

Marcus is the lead implementer and the primary technical decision-maker for the application layer. He owns the design of every component: the React frontend, the Fastify backend, the WebSocket session layer, the PostgreSQL schema, the Redis state model, the OIDC integration, and the Docker deployment configuration.

He works directly with the Business Analyst to understand feature requirements and translates those requirements into technical design. He is the primary contact for architecture reviews with Ingrid and is responsible for ensuring that the team's implementation addresses her findings before each checkpoint.

The technical properties he cares about most:

- **Shared TypeScript types:** The contract between frontend and backend must be defined in shared types, not inferred or duplicated. Any deviation from this pattern requires a deliberate justification.
- **Server-authoritative WebSocket state:** Clients do not hold authoritative state. All state transitions — vote submission, readiness updates, reveals — flow through the server and are reflected back to clients. This is non-negotiable from a correctness standpoint.
- **Redis / PostgreSQL boundary:** The boundary between ephemeral session state and persistent data is explicit in the data model and documented. Nothing lives in Redis that should survive a restart; nothing goes to PostgreSQL that needs only to exist for the duration of a session.
- **OIDC abstraction layer:** The OIDC client interface is implemented against a library, not against Entra-specific APIs. The abstraction is verified — by actually running the flow against a second provider configuration in a test environment — before the application is considered production-ready.
- **Authorization enforced at the API layer:** No authorization rule is enforced only in the frontend. Every route validates the caller's identity and permissions server-side, independent of what the UI does or does not display.
- **Structured logs and health endpoints from day one:** Observability is not a follow-on task. The application emits structured logs and exposes health check endpoints before any other feature is considered complete.

He defers to the Business Analyst on feature scope and priority, and to Ingrid on any architectural question that involves shared infrastructure or compliance obligations. He does not have opinions on the organization of sprint ceremonies.

---

## Success Criteria

Marcus will consider this project successful when:

1. The application passes a complete end-to-end session flow — from login through vote submission, reveal, and result persistence — with every participant connected over WebSockets, without manual intervention
2. The deployment process can be executed start-to-finish by an engineer who was not involved in building the application, using only the documentation and the repository
3. The shared TypeScript type layer is in place and the CI process enforces that frontend and backend cannot diverge from the shared schema
4. The OIDC integration has been verified against a second provider configuration before the first production deployment
5. Ingrid's architecture review findings are addressed and documented, not deferred
6. A Redis restart during a live session produces a defined, recoverable behavior that has been tested and written up

---

## Concerns and Risks

- **WebSocket reconnection handling is underspecified.** The reveal depends on every participant being connected at the moment the facilitator triggers it. What happens when a participant disconnects and reconnects mid-session — do they receive in-flight events? In what order? At what point are they treated as absent? These questions need explicit answers in the design before the real-time layer is built.
- **Schema drift between frontend and backend.** Without enforcement, shared types erode over time. One team changes a field name; the other does not. The application continues to appear to work until a specific code path is exercised. He wants this caught at build time, not at runtime in a live session.
- **The OIDC abstraction is declared but not verified.** It is straightforward to write an OIDC client wrapper that claims to be provider-agnostic. It is harder to ensure that no Entra-specific behavior has leaked into the implementation. He wants a second provider configured in a test environment before shipping.
- **Deployment documentation written after the fact.** The natural momentum is to build the application and document the deployment process at the end. This produces documentation that is incomplete because the author has forgotten what they once had to figure out. He intends to write the runbook incrementally alongside the implementation, not in a single pass at the end.
- **Scope added after the architecture is stable.** Features introduced late in development have a tendency to find the path of least resistance through the codebase — adding a flag here, a special case there — rather than fitting cleanly into the existing design. He wants a clear process for evaluating late additions against the established architecture before they are implemented.
