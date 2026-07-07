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
  | "join.link_rejected"
  // team.role_changed is the structured-log counterpart to the role_change_audit
  // DB row (now audit_log). Both are written: the DB row is in-transaction and is
  // the authoritative audit record; this log event is the operational alert path
  // and carries the same fields so operators can correlate them.
  | "team.role_changed"
  // team.manager_established is the structured-log counterpart to the audit_log
  // DB row written by TEAM-006 (POST /api/v1/teams/:teamId/managers).
  // The DB row is the authoritative audit record (written in the same transaction
  // as the team_memberships row); this event is the operational alert path.
  | "team.manager_established"
  // auth.role_claim_mapped is emitted when a returning user's global_role changes
  // due to an updated IdP role claim (Decision 2, establish-manager-team-relationship).
  // Not emitted for new users (auth.first_access_created covers those).
  | "auth.role_claim_mapped"
  // em.* events are the structured-log counterparts to audit_log DB rows written
  // by Phase 3 EM read-only access endpoints (SESSION-007/008, TREND-001/002,
  // ACTION-004/005). The DB row is the authoritative record; these are the
  // operational alert path for EM data access monitoring.
  | "em.session_history_accessed"
  | "em.session_detail_accessed"
  | "em.trend_data_accessed"
  | "em.topic_trend_accessed"
  | "em.action_items_accessed"
  | "em.action_item_accessed";

export function emitAuditEvent(
  logger: FastifyBaseLogger,
  event: AuditEventName,
  fields: Record<string, unknown>,
): void {
  // Audit events must be written regardless of the application log level.
  //
  // Risk evaluated (Task 8): if the application log level is raised to 'warn'
  // or 'error' in production, a child logger that inherits the parent's level
  // would silently suppress 'info' audit events — causing the entire audit
  // trail to go dark without any indication that events were dropped.
  //
  // Fix: explicitly set the child logger's level to 'info' before emitting.
  // In pino, each logger instance owns its own level independently of its
  // parent; overriding it on the child ensures audit events are always emitted
  // regardless of the application-wide log level configured at startup.
  const auditLogger = logger.child({ audit: true });
  auditLogger.level = "info";
  auditLogger.info({
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });
}
