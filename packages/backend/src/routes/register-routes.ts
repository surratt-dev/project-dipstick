import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./health.js";
import { authRoutes } from "./auth.js";
import { joinLinkRoutes } from "./join-links.js";
import { teamRoutes } from "./teams.js";
import { sessionRoutes } from "./sessions.js";
import { emViewRoutes } from "./em-views.js";
import { contentRoutes } from "./content.js";
import { facilitatorSessionRoutes } from "./facilitator-sessions.js";
import { actionItemRoutes } from "./action-items.js";
import { topicRoutes } from "./topics.js";
import { registerTemplateConstraintErrorHandler } from "../teams/template-constraint-violation.js";

// ---------------------------------------------------------------------------
// HTTP route registration — reject-template-team-topic-writes (#188),
// design.md D4.
//
// The "Routes" block of buildApp(), moved here unchanged so the structural
// template-guard test can enumerate every registered route (via an onRoute
// hook) without importing app.ts and its session store, helmet, auth
// middleware and WebSocket layer. buildApp() calls this at the same point it
// used to register the routes inline. WebSocket routes stay in app.ts.
//
// template-team-not-usable (#214) design.md D5: the narrow error handler for
// template constraint violations is set here, before any route, rather than
// in app.ts, so buildFullApp and the structural template-guard test see the
// same handler production does.
// ---------------------------------------------------------------------------
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  registerTemplateConstraintErrorHandler(app);
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(joinLinkRoutes);
  await app.register(teamRoutes);
  await app.register(sessionRoutes);
  await app.register(emViewRoutes);
  await app.register(contentRoutes);
  await app.register(facilitatorSessionRoutes);
  await app.register(actionItemRoutes);
  await app.register(topicRoutes);
}
