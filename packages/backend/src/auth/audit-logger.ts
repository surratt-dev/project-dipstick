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
  // auth.idp_logout_failed: oidc-error-log-sanitization, design.md Decision D4
  // addendum. Fired by the /auth/logout handler when getEndSessionUrl() throws
  // after the local session has already been destroyed. Distinct from
  // auth.session_invalidated (already emitted earlier in the same handler,
  // before this call) — this event exists specifically to make a dangling
  // IdP-side SSO session (the user's local session ended, but the IdP was
  // never notified) queryable rather than only discoverable by grepping error
  // logs for shape.
  | "auth.idp_logout_failed"
  // auth.audit_write_failed: http-auth-audit-log-coverage, design.md Decision
  // D5. Fired by session-invalidation-audit.ts's writeSessionInvalidatedAuditRow
  // whenever the durable `audit_log` row it attempts for an
  // auth.session_invalidated emission fails -- either the actor-global-role
  // SELECT or the INSERT itself, an explicit DB error or a timeout past
  // AUDIT_WRITE_TIMEOUT_MS. Deliberately log-only, with no `audit_log` DB row
  // of its own: if the DB is the thing that's unreachable, writing a DB row
  // about that is not a real fallback (see docs/deployment.md's "Logging"
  // section, which lists this as a 19th log-only, no-DB-backing event).
  // Never blocks or fails the triggering request -- the 401/logout response
  // proceeds regardless. No `correlationId`: none of this event's four call
  // sites (three in middleware.ts's onRequest hook, one in auth.ts's
  // /auth/logout) mints or has access to one today. metadata: { userId,
  // authSessionId, reason, failureMode: "error" | "timeout", sourceIp }.
  | "auth.audit_write_failed"
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
  // team.manager_association_rate_approaching / rate_limit_exceeded: TEAM-006
  // rate limiting (task 3.10 / GitHub issue #13), per the Q6 decision
  // (openspec/changes/archive/2026-07-07-establish-manager-team-relationship/
  // q6-rate-limit-decision.md), jointly signed off by the BA and the Senior
  // Application Security Analyst.
  //
  // team.manager_association_rate_approaching: non-blocking early-warning
  // signal fired the first time a per-actor sliding-window count reaches 80%
  // of its threshold (16/20 burst, 80/100 daily). The request still succeeds
  // normally — no audit_log DB row is written for this event, only the
  // structured log entry. metadata: { actorUserId, window: "burst" |
  // "daily", observedCount, threshold }.
  //
  // team.manager_association_rate_limit_exceeded: fired on every 429 breach
  // (burst, daily, or global limit). Deliberately a DIFFERENT string from the
  // audit_log DB row's operation column value
  // ('team.manager_association_rate_limited', written synchronously before
  // the 429 response) — the Q6 decision calls this out explicitly as "a
  // distinct structured event... separate from routine per-request audit
  // entries," tagged security-relevant so it is ready for Finding 2.3's
  // eventual monitoring/alerting work without a second pass through this
  // endpoint. metadata: { actorUserId, actorGlobalRole, actorIp, teamId,
  // limitType: "burst" | "daily" | "global", observedCount, threshold }.
  | "team.manager_association_rate_approaching"
  | "team.manager_association_rate_limit_exceeded"
  // team.manager_association_rate_limit_check_failed: architect + security
  // implementation review of task 3.10 (implementation-review-architect.md
  // Finding 1, implementation-review-security.md Finding 6). Fired when the
  // rate limiter's own Redis calls fail (outage, network partition, timeout)
  // — distinct from rate_limit_exceeded, which means the limiter ran
  // successfully and found too many requests. TEAM-006 fails closed (denies
  // the request with a 503) when this happens, by design: this is a security
  // control, and an unreachable backing store must not silently disable it.
  // This event exists so an operator (or Finding 2.3's future monitoring)
  // can distinguish "the control itself is down, denying admin traffic as a
  // precaution" from an unrelated 500 on this route. metadata: {
  // actorUserId, error }.
  | "team.manager_association_rate_limit_check_failed"
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
  | "em.action_item_accessed"
  // admin.* events are audit records for Application Admin reads of
  // administrative data (membership lists, role assignments, EM associations).
  // Decision 2 (Option B, enforce-access-control-on-team-content):
  // Admin reads of administrative data must be logged. Admin attempts to access
  // session content are denied and logged by content endpoint handlers (Group 5).
  | "admin.membership_list_accessed"
  | "admin.team_detail_accessed"
  | "admin.session_content_denied"
  // team.access_grant_mismatch: restrict-team-005-em-promotion, design.md
  // Decision E. Fired by evaluateTeamAccess (team-content-access-helper.ts)
  // whenever a team_memberships row has role = 'engineering_manager' but the
  // user's global_role does NOT also equal 'engineering_manager' — the
  // dual-control check's mismatched-state branch. The function degrades to
  // role: 'participant' rather than a hard 403; this event is the only
  // detection signal for that degrade. No synchronous audit_log DB row is
  // written for this event — evaluateTeamAccess runs on essentially every
  // content request (Decision 6, no caching), so a user parked in this
  // anomalous state would otherwise generate a DB write per page view. Same
  // log-only-given-call-volume reasoning as
  // team.manager_association_rate_approaching above. metadata: { userId,
  // teamId, globalRole, membershipRole }.
  | "team.access_grant_mismatch"
  // team.role_change_denied: restrict-team-005-em-promotion, design.md
  // Decision F. Fired by TEAM-005 (PATCH .../members/:userId/role) when an
  // otherwise-authorized actor (passed checkAssignRolesAuthorization)
  // attempts a participant -> engineering_manager transition, which is now
  // unconditionally blocked for every actor (Decision B) — establishing a
  // new EM relationship is exclusively TEAM-006's function. Unlike
  // team.access_grant_mismatch above, this DOES get a synchronous audit_log
  // DB row (denyAdminContentAccess precedent, content.ts): a blocked
  // promotion attempt is a security-relevant event at a low, human-scale
  // volume (an admin action, not a per-page-view read), and a fix that
  // closes the gap but leaves attempts against it invisible to audit
  // repeats the exact blind spot that made the original bug severe.
  // metadata: { from_role: 'participant', to_role: 'engineering_manager',
  // http_status }.
  | "team.role_change_denied"
  // session.* events are the structured-log counterparts to audit_log DB
  // rows written for WebSocket-triggered actions (SEC-13/SEC-14,
  // websocket-delivery-time-authorization design.md Decision D7). The DB
  // row (INSERT INTO audit_log) is the authoritative record, written in the
  // same transaction as the action's own state-transition write; these are
  // the operational alert path.
  //
  // session.reveal_triggered: wired to a real state-transition commit by
  // session-lifecycle-transitions (GitHub issue #26 resolved) — written in
  // the same transaction as the reveal endpoint's voting -> revealed write
  // (facilitator-sessions.ts's reveal handler).
  | "session.reveal_triggered"
  // session.state_changed: covers the lobby-advance, session-close,
  // SESSION-004/005 session-phase-entry, and SESSION-012 wrap-up-entry
  // transitions — every sessions.status change already commits a real
  // state transition. The topic-to-topic advance case (sessions.status
  // does NOT change) uses session.topic_advanced instead.
  | "session.state_changed"
  // session.vote_submitted: NOT blocked by issue #26 — the vote lock-in
  // handler's INSERT INTO votes already commits today. metadata excludes
  // vote_value and vote_type per SEC-16/SEC-22.
  | "session.vote_submitted"
  // session.topic_advanced: session-lifecycle-transitions (SESSION-012),
  // the topic-to-topic advance branch, where sessions.status does NOT
  // itself change (the wrap-up-entry branch reuses session.state_changed,
  // consistent with every other sessions.status transition already
  // audited). metadata carries completed_session_topic_id and
  // new_session_topic_id (both session_topics.id values).
  | "session.topic_advanced"
  // session.access_revoked_live: websocket-connection-reauthorization
  // (SEC-25/SEC-27), design.md Decision D2. Written by the periodic
  // per-connection re-authorization sweep (connection-reauthorization.ts)
  // immediately before closing a connection whose authorization has
  // lapsed. metadata: { scope: "session" | "team", scopeId }. Never
  // facilitator-visible — disclosing this would violate
  // STALE_SIGNAL_CLOSE_CODE's non-disclosure guarantee.
  | "session.access_revoked_live"
  // session.token_refresh_failed_live: websocket-connection-reauthorization
  // (SEC-26), design.md Decision D3b. Written by the WS-side silent-refresh
  // monitor (connection-token-refresh.ts) when refreshSessionTokens returns
  // "revoked"/"transient_failure", or a Decision D3a conditional write is
  // rejected. metadata: { scope, scopeId, failureType }. Never token
  // values, per SEC-16/SEC-22. Never facilitator-visible.
  | "session.token_refresh_failed_live"
  // session.connection_recovered: websocket-connection-reauthorization
  // (SEC-26), design.md Decision D9. Written at WS registration time when a
  // live Decision D4 grace-period correlation marker
  // (dipstick:reauth-grace:{userId}) is found and consumed for the
  // connecting user. metadata: { scope, scopeId } — no cause, no token
  // detail. This is the ONLY one of these three new operations that is
  // facilitator-visible (via content.ts's new read query) — see that
  // query's explicit non-wildcard filter requirement.
  | "session.connection_recovered"
  // session.reveal_latency_observed: FR-4.6.1 (websocket-specification
  // Decision D2). Not a security audit record — a client-reported
  // observed_latency metric (received_at - serverTimestamp) for one
  // vote_revealed delivery. Emitted via this same emitAuditEvent pipe,
  // deliberately, per Security review (Tomás Ferreira): this metric is
  // session-tagged and therefore SHALL route to a monitoring destination
  // access-controlled at least as tightly as this file's other
  // session-tagged operational logs (e.g. session.access_revoked_live) —
  // reusing this exact structured-log surface is how that bar is met by
  // construction rather than by a separate, less-controlled destination.
  // metadata: { sessionId, serverTimestamp, observedLatencyMs }. No vote
  // value or vote type — this event carries timing data only.
  | "session.reveal_latency_observed"
  // session.facilitator_connected / session.facilitator_disconnected:
  // GitHub issue #94. Distinct from participant_joined/participant_left
  // (FR-2.5's client-facing WebSocket events, which never fire for the
  // facilitator's own connection) — this is an ops/audit trail only,
  // recording when the active facilitator's own session-scoped WebSocket
  // connection registers/deregisters. Never facilitator-visible (no read
  // endpoint surfaces it), unlike session.connection_recovered. metadata:
  // { scope: "session", scopeId, teamId }.
  | "session.facilitator_connected"
  | "session.facilitator_disconnected"
  // action_item.status_changed: actionitem-updated-live-broadcast (issues
  // #64 + #65 + #95, combined), design.md Decision D13. `action_item_history`
  // (packages/backend/migrations/2_create_tables.sql:152-161) is a correctly
  // designed business record — read back by ordinary users through
  // content.ts/em-views.ts — but is not this codebase's security audit
  // trail (no actor_global_role, no actor_ip). This event's audit_log row is
  // written in the same transaction as the action_items.status update and
  // the action_item_history insert (packages/backend/src/routes/
  // action-items.ts), matching recordRevealTriggeredAudit's shape. metadata:
  // { action_item_id, previous_status, new_status, authorization_path:
  // "owner" | "facilitator", session_id? }.
  | "action_item.status_changed";

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
  //
  // This override protects against application-level log-level changes only.
  // It does NOT protect against a pino transport configured with its own
  // level filter (e.g., a shipper that drops below 'warn') — transport-level
  // filtering happens downstream of this logger and is invisible here. See
  // "Logging" in docs/deployment.md for the events at risk and what to check
  // before adopting a filtering transport.
  const auditLogger = logger.child({ audit: true });
  auditLogger.level = "info";
  auditLogger.info({
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  });
}
