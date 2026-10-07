import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { DatabaseError } from "pg";
import { buildErrorEnvelope } from "../routes/error-envelope.js";

// ---------------------------------------------------------------------------
// Template constraint violations — template-team-not-usable (#214),
// design.md D5.
//
// The database backstop for the template guard (template-team-guard.ts),
// kept in its own file on purpose (D1): the guard gives each route its
// parity answer; migration 23's sessions/team_memberships/join_links
// _not_template_team CHECKs make a route that forgot the guard fail closed.
// Such a failure stays a 500. It is never translated into a 404, which would
// hide the bug the constraint exists to expose. What this file adds:
//
//   - one predicate, matched on the DatabaseError's fields (as POST /draft's
//     23505 handling is), never on message text;
//   - one logger, which writes the stable marker template_constraint_violation;
//   - a narrow application error handler that answers a template violation
//     with a fixed 500 body that does not name the constraint (Fastify's
//     default handler echoes err.message, which does) and rethrows every
//     other error to Fastify's default handler, so every other 500 body is
//     unchanged. A general error handler stays release-notes follow-up 6.
//
// Routes that already catch and answer a fixed 500 call the logger in their
// catch; /auth/callback calls it before mapAuthError.
// ---------------------------------------------------------------------------

const TEMPLATE_CONSTRAINT_SUFFIX = "_not_template_team";

/** Fixed copy for the narrow handler's 500. Names nothing about the cause. */
export const TEMPLATE_CONSTRAINT_VIOLATION_MESSAGE = "Something went wrong. Try again.";

/** A 23514 from one of migration 23's <table>_not_template_team constraints. */
export function isTemplateConstraintViolation(err: unknown): err is DatabaseError {
  return (
    err instanceof DatabaseError &&
    err.code === "23514" &&
    typeof err.constraint === "string" &&
    err.constraint.endsWith(TEMPLATE_CONSTRAINT_SUFFIX)
  );
}

/**
 * Logs the marker for a template constraint violation. Carries the route and
 * the constraint name (the log may name it; a response body never does), and
 * no other error detail.
 */
export function logTemplateConstraintViolation(
  log: FastifyBaseLogger,
  err: DatabaseError,
  route: string,
  correlationId?: string,
): void {
  log.error(
    {
      template_constraint_violation: true,
      route,
      constraint: err.constraint,
      ...(correlationId !== undefined ? { correlationId } : {}),
    },
    "template team constraint violation: a write reached the database without the template guard",
  );
}

/**
 * Registers the narrow handler on `app`. Called first in registerRoutes, so
 * every route plugin (and buildFullApp in tests) inherits it.
 */
export function registerTemplateConstraintErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(async (err, request, reply) => {
    if (!isTemplateConstraintViolation(err)) {
      // Fastify hands an error thrown here to the parent handler, which for
      // the root instance is its default handler: the response is exactly
      // what it was before this handler existed.
      throw err;
    }
    const body = buildErrorEnvelope("internal_error", TEMPLATE_CONSTRAINT_VIOLATION_MESSAGE);
    logTemplateConstraintViolation(
      request.log,
      err,
      `${request.method} ${request.routeOptions.url ?? request.url}`,
      body.error.correlationId,
    );
    return reply.code(500).send(body);
  });
}
