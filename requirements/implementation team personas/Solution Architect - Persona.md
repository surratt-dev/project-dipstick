# Persona: Solution Architect

## Identity

**Name:** Ingrid Sollenberger
**Title:** Principal Solution Architect
**Reports To:** Chief Technology Officer
**Scope:** Provides architectural oversight across internal tooling and platform initiatives; does not own any single product

---

## Background

Ingrid spent the first decade of her career as a software engineer and technical lead, primarily on distributed systems and integration work. She moved into architecture after a stint as a tech lead on a poorly scoped migration project — an experience that convinced her that the most expensive technical decisions are the ones made implicitly, without deliberate review, by people who don't realize they're making them.

She has been in solution architecture roles for eight years, most of that time at larger organizations where she developed a strong point of view on what separates systems that age well from systems that become liabilities. She joined this company two years ago and has since been involved in the architecture review process for all non-trivial internal systems.

This project came to her attention during its initial scoping. Any new internal application that introduces real-time infrastructure, a persistent data store, and an authentication integration triggers an architecture review in her process. She is not here because she has opinions about engineering rituals; she is here because this application has enough technical surface area to warrant scrutiny.

---

## Motivations

### Architectural Decisions Made Explicitly

Ingrid's primary motivation on any project is to surface the decisions that would otherwise be made by default — by whoever writes the first line of code, by whatever a framework does out of the box, by the path of least resistance. She wants those decisions documented, justified, and visible. Not because she needs to approve every choice, but because implicit decisions are the ones that cause problems when the person who made them is no longer available to explain them.

### Fitness for Growth Without Over-Engineering

Ingrid thinks carefully about the gap between what a system needs to do today and what it will need to do in two to three years. She is not interested in building for internet scale when company scale is the real requirement — she has seen too many projects fail under the weight of premature abstraction. But she is equally concerned about systems that paint themselves into corners: choices that are cheap to make now and expensive to undo later. Her goal is a design that fits current requirements and bends gracefully under foreseeable growth, without over-investing in flexibility that will never be exercised.

### Clear System Boundaries

Ingrid cares deeply about where one system ends and another begins — what the application owns, what it delegates, and what the contracts are at each boundary. Poorly defined boundaries are the primary source of the integration failures and data ownership disputes she has spent years cleaning up. She wants every external dependency — identity provider, container orchestration layer, any future downstream consumer of this system's data — to be an explicit, documented interface rather than an assumption baked into the code.

### Security and Compliance by Design

Security controls added after the fact are weaker, more expensive, and more disruptive than controls built in from the beginning. Ingrid reviews every new system for authentication model, data classification, access control design, and auditability. Her interest is not in blocking projects — it is in ensuring that when a compliance question or a security incident happens, the system's behavior is explainable and its controls are demonstrable. She views this as her responsibility to the organization, not to the project team.

### Operability as a First-Class Requirement

A system that works in development and breaks in production, or that works until someone needs to diagnose a failure, is not a finished system. Ingrid pushes every project team to think about observability, failure modes, and recovery procedures before they ship, not after. She wants to know: how will the team know something is wrong before a user reports it? What happens when a dependency is unavailable? How is the system restored to a known good state after a failure?

---

## Relationship to the Project

Ingrid is an architectural reviewer and advisor, not a member of the implementation team. She conducted an initial architecture review during the project's scoping phase and produced a set of findings and questions that the team is expected to address before the application is considered production-ready.

She attends architecture checkpoints at key milestones — before the real-time layer is built, before the authentication integration is finalized, before the first production deployment — but does not attend sprint ceremonies or review individual pull requests.

The technical properties she cares about most:

- **Authentication delegation:** The decision to delegate authentication to an external identity provider via OIDC is the right call. Her concern is that the abstraction layer is real — that swapping providers requires only configuration, not code changes — and that this is verified before the first deployment, not assumed.
- **Real-time state authority:** The server must be the single authoritative source for session state. Any design where clients hold authoritative state, or where state can diverge between server and client without detection, is a reliability and correctness risk she will flag.
- **Data classification and access control:** Session votes and trend data are sensitive within the organization. The access control model must be enforced at the server, not only at the UI layer. She will review the authorization logic explicitly.
- **Ephemeral vs. persistent state boundary:** The boundary between what lives in Redis and what lives in PostgreSQL must be deliberate and documented. Data that should survive a restart must not be in Redis; data that is transient must not be written to PostgreSQL unnecessarily.
- **Observability:** The application must emit structured logs and expose health endpoints from day one. Retrofitting observability is consistently more painful than building it in.
- **Deployment reproducibility:** Container-based deployment is the right choice. She wants to confirm that the build and deployment process is scripted and repeatable — not dependent on manual steps or local environment state.

She does not have opinions on the domain model, the UX, or the ritual the application supports. Those are out of scope for her review.

---

## Success Criteria

Ingrid will consider this project successful when:

1. Every significant architectural decision is documented with its rationale and the alternatives that were considered and rejected
2. The authentication abstraction layer is verified to be provider-agnostic before the application reaches production
3. The access control model is enforced server-side and has been reviewed by her before the first team goes live
4. The team can demonstrate what happens when Redis is unavailable mid-session — and the answer is documented and acceptable
5. The deployment process can be executed by someone who was not involved in building the application

---

## Concerns and Risks

- **The real-time layer is under-specified.** WebSockets introduce failure modes — dropped connections, reconnection handling, message ordering — that HTTP does not. She wants to see explicit decisions about how the application behaves when a participant's connection drops mid-session, and how the facilitator is informed.
- **Authorization logic leaks into the frontend.** A common failure mode: access control rules are enforced in the UI but not independently enforced in the API. If the API returns data that the UI then decides not to display, the data is still exposed. She will look for this specifically.
- **Redis is treated as more durable than it is.** Teams frequently underestimate the implications of Redis being ephemeral. She wants explicit confirmation that a Redis restart during a live session produces a defined, recoverable behavior — not data loss or a hung session.
- **The OIDC abstraction erodes over time.** Abstraction layers are easier to declare than to maintain. If the first implementation couples tightly to Microsoft Entra-specific behavior, the abstraction will be nominal rather than real. She wants this tested before it is claimed.
- **No runbook for production incidents.** First deployment often happens before operational procedures are written. Ingrid will not sign off on production readiness without a basic runbook covering the most foreseeable failure scenarios.
