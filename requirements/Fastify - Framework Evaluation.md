# Fastify — Framework Evaluation

## What Fastify Is

Fastify is an open source Node.js web framework focused on performance and developer experience. It handles HTTP routing, request/response lifecycle, and plugin composition. It is the backend framework recommended in the Tech Stack document in place of the more commonly known Express.

---

## Pros

**Performance**
Fastify is consistently one of the fastest Node.js frameworks in independent benchmarks. For this project, raw throughput is not the concern — company-scale load is modest — but the same design choices that produce speed also produce low latency per request, which contributes to the real-time feel of the session room.

**TypeScript support is first-class**
Fastify was designed with TypeScript in mind, not retrofitted to it. Types for routes, request/response shapes, and plugins are well-integrated and actively maintained. This matters for a project where TypeScript is used across the full stack.

**Schema-driven validation built in**
Fastify uses JSON Schema to validate incoming requests and serialize outgoing responses. This is not optional middleware — it is the default path. The result is that invalid requests are rejected before they reach application code, and response serialization is faster because the shape is known ahead of time.

**Structured logging included**
Fastify ships with Pino, a high-performance structured logger, as its default logger. Logging is often an afterthought in framework selection and then painful to retrofit. Having a capable, structured logger built in is a practical benefit from day one.

**Plugin architecture is well-designed**
Fastify's plugin system enforces encapsulation: plugins declare what they need and what they expose, and the framework manages scope. This makes it easier to organize a codebase that grows over time without plugins accidentally polluting each other's state.

**WebSocket support via official plugin**
The `@fastify/websocket` plugin is maintained by the Fastify core team. WebSocket support is not an afterthought or a community patch — it is a supported, documented extension of the framework. This matters directly for the live session room.

---

## Cons

**Smaller community than Express**
Express has been the dominant Node.js framework for over a decade. The practical consequence is that Fastify has fewer tutorials, fewer Stack Overflow answers, and fewer engineers who already know it. When a developer hits an unusual problem, the path to a solution is shorter with Express.

**Schema-first approach adds upfront overhead**
Defining JSON Schemas for every route's request and response is more work than Express's convention of just handling the request. The payoff is validation and fast serialization, but the upfront cost is real, especially when prototyping quickly.

**Plugin ecosystem is smaller**
Express has a larger selection of third-party middleware. Most common needs (auth, CORS, rate limiting) are covered by the official Fastify plugin organization, but anything less common may require a custom implementation or adapting an Express middleware, which adds friction.

**Less familiar to most Node.js developers**
Most engineers who have worked in Node.js know Express. Fastify's routing model and plugin system, while well-designed, have a learning curve. For a team picking this up, there is an onboarding cost.

---

## Alternatives

### Express

The most widely used Node.js web framework. Almost every Node.js developer knows it. The community, documentation, and middleware ecosystem are unmatched.

| | |
|---|---|
| **Choose Express if** | The team prioritizes familiarity and the largest possible pool of existing knowledge and middleware. For this project, Express is a fully capable choice — the scale does not require Fastify's performance edge, and Express supports WebSockets via compatible libraries. |
| **Trade-off** | TypeScript support is layered on via community types (`@types/express`) rather than native. The framework itself has no built-in validation or serialization. Logging and request validation require additional setup. |

### NestJS

An opinionated, Angular-inspired framework built on top of Express or Fastify. It enforces a module/controller/service architecture and is TypeScript-first by design.

| | |
|---|---|
| **Choose NestJS if** | The team is building a large application with many contributors and wants strong structural conventions enforced by the framework. NestJS has excellent built-in support for WebSockets, validation, dependency injection, and OpenAPI documentation generation. |
| **Trade-off** | NestJS is significantly more complex and opinionated. For an application of this scope, the framework introduces more ceremony than the problem warrants. It is better suited to large teams building large systems. |

### Koa

A minimal framework from the original Express authors, designed to address some of Express's limitations. Lighter than Express, relies on community middleware for most features.

| | |
|---|---|
| **Choose Koa if** | The team wants something close to Express's simplicity but with a more modern async/await-native design. |
| **Trade-off** | Koa has a smaller community than Express and fewer maintained plugins than Fastify. It does not add much for this specific use case. |

---

## Recommendation

For this project, **Fastify** and **Express** are both sound choices. The deciding factor is team familiarity. If the engineers building this application know Express well, Express is the lower-friction starting point and there is no meaningful technical reason to choose otherwise. If the team is comfortable learning a new framework, Fastify's native TypeScript support and built-in schema validation are genuine benefits that reduce boilerplate throughout the project.

NestJS is not recommended for this project — its architectural overhead is better justified by larger teams and larger systems.
