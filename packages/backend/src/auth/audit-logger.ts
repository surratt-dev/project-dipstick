import type { FastifyBaseLogger } from "fastify";

export type AuditEventName =
  | "auth.authorization_initiated"
  | "auth.callback_received"
  | "auth.success"
  | "auth.failure"
  | "auth.first_access_created"
  | "auth.session_created"
  | "auth.session_invalidated"
  | "auth.token_refresh_success"
  | "auth.token_refresh_failure"
  | "join.link_created"
  | "join.link_redeemed"
  | "join.link_rejected";

export function emitAuditEvent(
  logger: FastifyBaseLogger,
  event: AuditEventName,
  fields: Record<string, unknown>,
): void {
  const auditLogger = logger.child({ audit: true });
  auditLogger.info({
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });
}
