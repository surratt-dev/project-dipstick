// ---------------------------------------------------------------------------
// TopicWriteDenialContext — the per-request context every topic-write gate
// helper takes: the lock gate and its denial audit, the template guard and
// its denial audit (routes/topics.ts), and the topic-write rate limiter
// (routes/topic-write-rate-limit.ts).
//
// harden-topic-write-endpoints (#184) task 5.2: moved out of topics.ts, where
// it was module-private, so the limiter helper can share it without importing
// topics.ts. A pure type move. Not a Fastify route plugin.
//
// teamId is the lowercase canonical spelling (#184 Decision 9). actorGlobalRole
// is required because audit_log.actor_global_role is NOT NULL and the session
// does not carry it.
// ---------------------------------------------------------------------------
export interface TopicWriteDenialContext {
  actorUserId: string;
  actorGlobalRole: string;
  teamId: string;
  endpoint: string;
  attemptedOperation: string;
}
