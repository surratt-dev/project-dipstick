// ---------------------------------------------------------------------------
// buildErrorEnvelope — the house error envelope for route handlers
//
// Moved out of topics.ts by session-topics-snapshot-at-creation (#175)
// design.md Decision 3 so facilitator-sessions.ts can use the same shape
// and categories. Not a Fastify route plugin: this file is a shared helper
// for the plugins in this directory.
//
// topic-customization-lock design.md Decision 4 (corrected per engineer
// review M1): the codebase's standard error envelope -- { error: { category,
// code, message, correlationId } } -- the same shape teams.ts's
// GLOBAL_ROLE_PRECONDITION_NOT_MET (409) and TEAM006_BURST_LIMIT_EXCEEDED
// (429) already use. Never a bare top-level { code, message } body.
//
// Coded 409s use "precondition_failed"; server-side faults that a handler
// reports itself (rather than via the global error handler) use
// "internal_error". There is deliberately no "conflict" or "server_error"
// category. No shared-package type: the frontend reads error.code ad hoc.
// ---------------------------------------------------------------------------

export type ErrorCategory =
  | "forbidden"
  | "not_found"
  | "precondition_failed"
  | "invalid_request"
  | "internal_error";

export interface ErrorEnvelope {
  error: { category: ErrorCategory; code?: string; field?: string; message: string; correlationId: string };
}

export function buildErrorEnvelope(
  category: ErrorCategory,
  message: string,
  code?: string,
  field?: string,
): ErrorEnvelope {
  return {
    error: {
      category,
      ...(code ? { code } : {}),
      ...(field ? { field } : {}),
      message,
      correlationId: crypto.randomUUID(),
    },
  };
}
