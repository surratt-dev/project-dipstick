# Persistence Layer Mapping
## Engineering Health Check — Redis / PostgreSQL Coordination

|                   |                                                                    |
|-------------------|--------------------------------------------------------------------|
| **Document Date** | 2026-03-08                                                         |
| **Version**       | 0.1 — Initial Design                                              |
| **Status**        | Working Draft — Under Review                                       |
| **Primary Author**| Marcus Oyelaran (Full Stack Engineer)                              |
| **Reviewers**     | Ingrid Sollenberger (Solution Architect), Marcus Delgado (Business Analyst) |

---

## Overview

This document maps session lifecycle events to storage operations, defines the field-level correspondence between Redis and PostgreSQL representations of key data, and provides TypeScript interface sketches that illustrate the boundary Marcus Oyelaran has designed.

The companion documents (`database-schema.md` and `redis-session-model.md`) define each store in isolation. This document shows how they coordinate.

---

## Section 1: Session Lifecycle Event → Storage Operations

For each event, the table below shows what is written to Redis, what is written to PostgreSQL, and the ordering of those writes. Ordering matters: writes that must happen before a client receives a response or a WebSocket event are noted. Writes that can happen asynchronously after the response is sent are noted.

The column "When" indicates whether the PostgreSQL write happens **before the response** (synchronous, blocking), **after the response** (fire-and-forget or queued), or **not at all** for that event.

---

### Event: Session Created

The facilitator submits a session creation request. The session enters the `lobby` state.

| Store | Operation | Details |
|-------|-----------|---------|
| **PostgreSQL** | INSERT into `sessions` | Inserts a new session row with `status = 'lobby'`, generates `join_token`, sets `facilitator_id`, `team_id`, `is_first_session`, `session_number`. |
| **PostgreSQL** | INSERT into `session_topics` | Inserts one row per topic in the team's current active topic set (in display order), snapshotting `topic_name`, `topic_prompt`, `vote_type`. All rows start with `status = 'waiting'`. |
| **Redis** | HSET `session:{id}:state` | Sets `status = 'lobby'`, `facilitator_id`, `team_id`, `facilitator_connected = 0`, `current_topic_id = ''`. |
| **Redis** | SADD `session:{id}:joined_users` | Empty set created (or first member added if the facilitator is added at creation). |
| **Redis** | SET `session:{id}:snapshot` | Initial snapshot with status `lobby`, empty participant list, topic queue. |
| **Redis** | EXPIRE (all keys) | TTL set to 8 hours on all new session keys. |

**Ordering:** PostgreSQL writes happen first (INSERT sessions, then INSERT session_topics in a transaction). On success, Redis keys are initialized. The join link (containing the `join_token`) is returned to the facilitator after both writes complete. If the PostgreSQL transaction fails, no Redis keys are created and the request returns an error.

**Why PostgreSQL first:** The session must exist in PostgreSQL before participants can join (the join endpoint validates the `join_token` against PostgreSQL). If Redis initialization fails after a successful PostgreSQL write, the session exists but has no Redis state. This is recoverable: the application can re-initialize Redis state from the PostgreSQL record on the facilitator's first WebSocket connection.

---

### Event: Participant Joins

A participant follows the join link, is authenticated, and establishes a WebSocket connection to the session.

| Store | Operation | Details |
|-------|-----------|---------|
| **PostgreSQL** | INSERT into `session_participants` | Inserts `(session_id, user_id, joined_at)`. This is the permanent participation record. Uses INSERT ... ON CONFLICT DO NOTHING to handle reconnections gracefully — if the user has joined before, the existing row is retained. |
| **Redis** | HSET `session:{id}:participants` | Sets field `{user_id}` to JSON with `display_name`, `connection_status = 'connected'`, `joined_at`, `last_seen_at`. |
| **Redis** | SADD `session:{id}:joined_users` | Adds `{user_id}` to the joined set. |
| **Redis** | SET `session:{id}:snapshot` | Updates snapshot to include the new participant. |
| **WebSocket** | Broadcast `participant.joined` | Sent to all connected session participants. Payload includes participant display name. Does NOT include vote values. |

**Ordering:** PostgreSQL INSERT happens first. On success, Redis is updated and the broadcast is sent. If the participant is re-joining (their UUID is already in `joined_users`), the PostgreSQL INSERT is a no-op (ON CONFLICT) and the Redis hash is updated to set `connection_status = 'connected'` — this is the reconnection path.

**Reconnection detection:** Before inserting, the handler checks `SISMEMBER session:{id}:joined_users {user_id}`. If the user is already a member, this is a reconnection, and the server delivers the current snapshot to the reconnecting client before updating the participant hash.

---

### Event: Facilitator Advances to Topic

The facilitator clicks "Next Topic" (or starts the first topic from the pre-session review).

| Store | Operation | Details |
|-------|-----------|---------|
| **PostgreSQL** | UPDATE `session_topics` | Sets `status = 'voting'` for the new topic (the one being advanced to). Also sets `status = 'complete'` for the prior topic if one was in progress and now being closed. |
| **PostgreSQL** | UPDATE `sessions` | Sets `current_topic_id` to the new topic's ID. Sets `voting_started_at` if this is the first topic in the active phase. |
| **Redis** | HSET `session:{id}:state` | Sets `current_topic_id` to the new topic's session_topic_id. |
| **Redis** | HSET `session:{id}:topic_state:{new_topic_id}` | Sets `phase = 'voting'`, `voting_opened_at`, `locked_in_count = 0`. |
| **Redis** | DEL `session:{id}:votes:{prior_topic_id}` | Deletes any unrevealed vote hash from the prior topic. (This should be empty — votes are deleted at reveal. This is a safety cleanup.) |
| **Redis** | SET `session:{id}:snapshot` | Updates snapshot with new current topic, all participants reset to `readiness = 'not_ready'`. |
| **WebSocket** | Broadcast `topic.advanced` | Sent to all clients. Payload includes new topic prompt, vote type, topic name. |

**Ordering:** PostgreSQL updates happen in a transaction before the Redis update and broadcast. If the PostgreSQL update fails, the facilitator receives an error and the session state is unchanged.

**Participant readiness reset:** When the facilitator advances to a new topic, each participant's `readiness` state resets. The participant roster hash (`session:{id}:participants`) does not need to be updated for the readiness reset — readiness is derived from whether the participant has an entry in the new topic's vote hash (`session:{id}:votes:{new_topic_id}`). On the new topic, the vote hash starts empty, so all participants are "not ready."

---

### Event: Participant Locks In Vote

A participant selects and locks in their vote for the current topic.

| Store | Operation | Details |
|-------|-----------|---------|
| **Redis** | HSETNX `session:{id}:votes:{topic_id}` | Sets field `{user_id}` to JSON with `vote_value`, `vote_type`, `locked_at`. Uses HSETNX (set if not exists) to enforce lock-in irreversibility — a second lock-in attempt for the same user/topic is a no-op. |
| **Redis** | HINCRBY `session:{id}:topic_state:{topic_id}` `locked_in_count` 1 | Increments the locked-in count. Only incremented if the HSETNX succeeded (i.e., this is a new lock-in, not a duplicate). |
| **Redis** | HSET `session:{id}:participants` | Updates the participant's entry: if `connection_status` was `disconnected_no_vote`, changes it to `disconnected_voted`. If `connected`, sets `last_seen_at`. |
| **Redis** | SET `session:{id}:snapshot` | Updates snapshot (increments locked_in_count for current topic). |
| **WebSocket** | Emit `vote.locked` to facilitator only | Payload includes only the participant's display name and readiness status. Vote value is NOT included. |

**No PostgreSQL write at lock-in time.** This is explicit and deliberate. Pre-reveal votes are ephemeral. Writing them to PostgreSQL before the reveal would make them readable via the database, which violates the ritual integrity requirement. The permanent vote record is written only at reveal time.

**Ordering:** The Redis HSETNX is atomic. If it returns 0 (field already exists), the lock-in is a duplicate and the handler returns success to the client without further action (idempotent behavior — a lock-in request that arrives twice due to network retry produces the same result as one request).

**Audit note:** The vote submission is logged as a structured audit event (per the security architecture): `userId`, `sessionId`, `topicId`, `timestamp`. The vote value is NOT included in the audit log at this stage.

---

### Event: Facilitator Triggers Reveal

The facilitator clicks "Trigger Reveal." This is the most critical operation in the entire application.

| Store | Operation | Details |
|-------|-----------|---------|
| **Redis** | HGETALL `session:{id}:votes:{topic_id}` | Reads all locked-in vote values. This read happens before any write and before any broadcast. |
| **Redis** | HSET `session:{id}:topic_state:{topic_id}` | Sets `phase = 'revealed'`, `revealed_at` to the current server timestamp. |
| **PostgreSQL** | INSERT into `votes` (bulk) | Inserts one row per locked-in vote. Sets `session_id`, `session_topic_id`, `voter_id`, `vote_value`, `vote_type`, `revealed_at` (same server timestamp used in the Redis write). Computes `is_outlier` and `outlier_threshold` for each vote at insert time. Uses a transaction — either all votes are written or none are. |
| **PostgreSQL** | UPDATE `session_topics` | Sets `revealed_at` and `status = 'revealed'` for this topic. |
| **Redis** | DEL `session:{id}:votes:{topic_id}` | Deletes the vote hash immediately after the PostgreSQL write is confirmed. PostgreSQL is now the system of record for these votes. |
| **Redis** | SET `session:{id}:snapshot` | Updates snapshot to reflect the topic phase as `revealed`. |
| **WebSocket** | Broadcast `session.revealed` to all clients | Payload includes: all vote values keyed by participant, aggregate (mean or tally), outlier flags, `revealed_at` server timestamp. Sent after PostgreSQL write is confirmed. |

**Ordering is critical here:**
1. Read vote hash from Redis (HGETALL)
2. Compute aggregates and outlier flags in application memory
3. Write votes to PostgreSQL (transaction)
4. On PostgreSQL commit: delete Redis vote hash, update Redis topic state, update snapshot
5. Broadcast `session.revealed` to all WebSocket clients

Steps 3–5 must happen in this order. The broadcast happens only after PostgreSQL confirms the write. If the PostgreSQL write fails, no broadcast is sent, the Redis vote hash is retained, and the facilitator receives an error with the option to retry.

**If the broadcast fails for some clients:** The reveal is still complete — PostgreSQL holds the votes. Clients that did not receive the broadcast will receive the revealed state in their next reconnection snapshot.

**Reveal timestamp:** The `revealed_at` timestamp is generated on the server at the moment of the reveal operation. It is included in the `session.revealed` event payload. Clients use this timestamp to compute observed delivery latency (FR-4.6.1). The same timestamp is written to `session_topics.revealed_at` and `votes.revealed_at` in PostgreSQL.

---

### Event: Facilitator Advances Past Reveal (Topic Complete)

After the reveal, the facilitator optionally flags the topic for discussion and then advances to the next topic.

| Store | Operation | Details |
|-------|-----------|---------|
| **PostgreSQL** | UPDATE `session_topics` | Sets `status = 'complete'`, `completed_at`, `flagged_for_discussion`, and `discussion_note` (if captured). |
| **Redis** | HSET `session:{id}:topic_state:{topic_id}` | Sets `phase = 'complete'`. |
| **Redis** | SET `session:{id}:snapshot` | Updates snapshot to move the topic to the `topics_completed` list. |

Then the "Facilitator Advances to Topic" event fires for the next topic (see above). If no topics remain, the "Facilitator Advances to Topic" event is replaced by the session transitioning to wrap-up.

**PostgreSQL is the durable record here.** The discussion note is written to PostgreSQL on this event, not left in Redis. This is correct: discussion notes must survive a Redis restart and must be recoverable in the wrap-up screen after a facilitator reconnection.

---

### Event: Action Item Created

The facilitator (during wrap-up, or via any supported action item creation flow) creates an action item.

| Store | Operation | Details |
|-------|-----------|---------|
| **PostgreSQL** | INSERT into `action_items` | Inserts `team_id`, `session_id`, `session_topic_id` (if topic-linked, else NULL), `owner_id`, `description`, `status = 'open'`, `created_at`. |
| **Redis** | No Redis write | Action items are not ephemeral. They belong in PostgreSQL from the moment of creation. |
| **WebSocket** | Broadcast `actionitem.created` | Sent to all session participants. Payload includes action item ID, description, owner display name. |

**No Redis involvement.** Action items written during wrap-up are immediately durable in PostgreSQL. This is why wrap-up recovery is possible (see Session Wrap-up use case): if the facilitator's connection drops during wrap-up, their draft action items are already in PostgreSQL and the wrap-up screen can be restored by reading from PostgreSQL.

---

### Event: Session Wrapped Up / Completed

The facilitator clicks "Mark Session Complete." This is the terminal event for a live session.

| Store | Operation | Details |
|-------|-----------|---------|
| **PostgreSQL** | UPDATE `sessions` | Sets `status = 'complete'`, `completed_at`. This is wrapped in a transaction with all subsequent writes. |
| **PostgreSQL** | No additional vote writes | All votes were written at their respective reveal times. This event does not touch the `votes` table. |
| **PostgreSQL** | UPDATE `action_items` (if needed) | Any action items in a draft-like state are confirmed. In practice, action items are written to PostgreSQL at creation time, so this is a no-op if no status fields need finalizing. |
| **Redis** | DEL `session:{id}:state` | Deletes session state hash. |
| **Redis** | DEL `session:{id}:participants` | Deletes participant roster. |
| **Redis** | DEL `session:{id}:snapshot` | Deletes snapshot. |
| **Redis** | DEL `session:{id}:joined_users` | Deletes joined users set. |
| **Redis** | DEL `session:{id}:topic_state:{topic_id}` (all topics) | Deletes all topic state hashes. |
| **Redis** | DEL `session:{id}:votes:{topic_id}` (safety cleanup) | These should already be deleted at reveal time, but a safety scan ensures no vote hashes are left. |
| **WebSocket** | Broadcast session complete event | Sent to all clients. Clients navigate to the session summary view. |

**Ordering:** The PostgreSQL transaction commits first. On success, Redis keys are deleted. On PostgreSQL failure, no Redis changes are made and the session remains in `wrap_up` state (retryable).

**Redis key deletion is eventually consistent:** If the backend crashes between the PostgreSQL commit and the Redis key deletion, the Redis keys will remain until their 8-hour TTL expires. This is acceptable — the PostgreSQL `sessions.status` field is `complete`, so any system reading the session state will get the correct answer from PostgreSQL. The orphaned Redis keys are harmless (they will expire) and will be caught by the background cleanup job.

---

### Event: Redis Restart During Active Session (Failure Mode)

| Store | Operation | Details |
|-------|-----------|---------|
| **Redis** | All session keys are lost | Redis restarts with empty state. All in-flight votes, participant states, and session phase data are gone. |
| **PostgreSQL** | No write at failure time | PostgreSQL is unaffected. It holds the last confirmed state: sessions row (with status as of last phase transition), session_topics (with status as of last advance), votes (for all topics revealed before the failure). |
| **Application** | Exponential backoff retry | Backend attempts to reconnect to Redis with exponential backoff. |
| **Application (5-minute threshold)** | UPDATE `sessions` in PostgreSQL | Sets `status = 'abandoned'`, `abandoned_at = now()`. This is the only PostgreSQL write during the failure mode. |
| **WebSocket** | Notify all clients | All WebSocket connections receive an abandonment notification and are closed. |
| **Redis** | No recovery attempt | The backend does not attempt to reconstruct Redis state from PostgreSQL. The session is over. |

**Votes lost:** Any lock-in votes held in Redis vote hashes at the time of the restart are permanently lost. They will not appear in the session's vote records. The revealed vote records in PostgreSQL are complete and accurate for all topics that were revealed before the failure.

**What is preserved:** The PostgreSQL session record (abandoned status), all revealed votes, all action items, all discussion notes, all participant records.

**What is lost:** Votes from any topic that had not yet been revealed at the time of the restart.

---

## Section 2: Field-Level Mapping Table

This table shows how key data fields are represented in Redis during a live session and in PostgreSQL in the permanent record. The transformation column describes any encoding or computation required.

| Data Element | Redis Representation | PostgreSQL Representation | Transformation |
|--------------|---------------------|--------------------------|---------------|
| **Vote value (pre-reveal)** | `session:{id}:votes:{topic_id}` hash, field `{user_id}`, JSON `vote_value: 3` (integer) | Does not exist in PostgreSQL before reveal | Written to `votes.vote_value` (integer) at reveal time, no transformation needed |
| **Vote value (post-reveal)** | Redis key deleted | `votes.vote_value` (integer column) | Direct copy; no transformation |
| **Vote type** | `session:{id}:votes:{topic_id}` hash, JSON `vote_type: "finger"` (string) | `votes.vote_type` (PostgreSQL enum `vote_type`) | String in Redis, enum in PostgreSQL; application maps "finger" → `finger` enum value |
| **Lock-in timestamp** | `session:{id}:votes:{topic_id}` hash, JSON `locked_at: "2026-03-08T14:23:11Z"` | Not stored in PostgreSQL | Redis-only; not persisted. The reveal timestamp (`revealed_at`) is stored in PostgreSQL. |
| **Reveal timestamp** | `session:{id}:topic_state:{topic_id}` hash, field `revealed_at` (ISO 8601 string) | `session_topics.revealed_at` (timestamptz); `votes.revealed_at` (timestamptz) | Same timestamp value, written to both at reveal time |
| **Participant connection status** | `session:{id}:participants` hash, field `{user_id}`, JSON `connection_status: "connected"` | Not stored in PostgreSQL | Redis-only ephemeral state |
| **Participant joined** | `session:{id}:joined_users` (Redis set member) | `session_participants` row (`session_id`, `user_id`, `joined_at`) | PostgreSQL records the fact of participation; Redis tracks the live set |
| **Topic phase (live)** | `session:{id}:topic_state:{topic_id}` hash, field `phase: "voting"` | `session_topics.status` (text: `waiting`, `voting`, `revealed`, `complete`) | Same values; Redis is authoritative during live session; PostgreSQL updated at each transition |
| **Session phase (live)** | `session:{id}:state` hash, field `status: "active"` | `sessions.status` (enum: `active`) | Same values; Redis is authoritative during live session; PostgreSQL updated at each transition |
| **Outlier flag** | Not in Redis | `votes.is_outlier` (boolean), `votes.outlier_threshold` (numeric) | Computed at reveal time in application memory; written directly to PostgreSQL |
| **Discussion note** | Not in Redis | `session_topics.discussion_note` (text) | Written to PostgreSQL when captured during live session |
| **Action item** | Not in Redis | `action_items` table (full row) | Written to PostgreSQL at creation time; no Redis representation |
| **Locked-in count** | `session:{id}:topic_state:{topic_id}` hash, field `locked_in_count` (integer as string) | Not stored in PostgreSQL directly | Computable from `COUNT(*) WHERE session_topic_id = x` in `votes` table; Redis maintains running count for low-latency reads |

---

## Section 3: TypeScript Type Sketch

These interfaces illustrate the data boundary Marcus Oyelaran has designed. They are not complete type definitions — they are sketches of the shapes that matter for the boundary. The actual implementation will expand these with additional fields and validation.

The shared type layer (imported by both backend and frontend) defines the domain types. The Redis-specific and PostgreSQL-specific shapes are backend-only and are not shared with the frontend.

### 3.1 Shared Domain Types (backend + frontend)

```typescript
// Shared: used by both backend (to build API responses) and frontend (to render UI)
// Lives in packages/shared/src/types/

export type VoteType = 'finger' | 'roman' | 'modified_roman';

export type SessionStatus =
  | 'lobby'
  | 'pre_session'
  | 'active'
  | 'wrap_up'
  | 'complete'
  | 'abandoned';

export type TopicPhase = 'waiting' | 'voting' | 'revealed' | 'complete';

export type ActionItemStatus = 'open' | 'in_progress' | 'resolved';

export type ParticipantReadiness = 'not_ready' | 'ready' | 'disconnected';

// The vote value encoding:
// - Finger: 1 | 2 | 3 | 4
// - Roman: 1 (up/good) | -1 (down/bad)
// - Modified Roman: 1 (up) | 0 (steady) | -1 (down)
export type VoteValue = -1 | 0 | 1 | 2 | 3 | 4;

// What a client receives at reveal time
export interface RevealedVote {
  voterId: string;
  voterDisplayName: string;
  voteValue: VoteValue;
  voteType: VoteType;
  isOutlier: boolean;
}

// The payload of the session.revealed WebSocket event
export interface RevealEventPayload {
  sessionId: string;
  sessionTopicId: string;
  topicName: string;
  revealedAt: string;        // ISO 8601, server-generated timestamp
  votes: RevealedVote[];
  aggregate: number;         // Mean for finger; tally (up count) for roman/modified_roman
  outlierThreshold: number;  // The threshold used for outlier detection
}

// What a client sees in the readiness grid (facilitator only)
export interface ParticipantReadinessEntry {
  userId: string;
  displayName: string;
  readiness: ParticipantReadiness;
  // Note: no vote value or direction included. This shape is safe to send to the facilitator
  // during the voting phase.
}

// Session state as seen by a client
export interface SessionStateView {
  sessionId: string;
  teamId: string;
  status: SessionStatus;
  currentTopic: SessionTopicView | null;
  completedTopics: SessionTopicView[];
  isFirstSession: boolean;
}

export interface SessionTopicView {
  sessionTopicId: string;
  topicName: string;
  prompt: string;
  voteType: VoteType;
  phase: TopicPhase;
  // Only present for the facilitator, only during voting phase:
  readinessGrid?: ParticipantReadinessEntry[];
  // Only present after reveal:
  revealedVotes?: RevealedVote[];
  aggregate?: number;
  flaggedForDiscussion?: boolean;
}
```

### 3.2 Redis Session State (backend-only)

```typescript
// Backend-only: shapes for reading from and writing to Redis.
// Lives in packages/backend/src/session/redis-types.ts

// Stored as a JSON string in the participants hash, field key = userId
export interface RedisParticipantEntry {
  displayName: string;
  connectionStatus: 'connected' | 'disconnected_voted' | 'disconnected_no_vote';
  joinedAt: string;    // ISO 8601
  lastSeenAt: string;  // ISO 8601
}

// Stored as a JSON string in the votes hash, field key = userId
export interface RedisVoteEntry {
  voteValue: VoteValue;
  voteType: VoteType;
  lockedAt: string;    // ISO 8601
}

// The full Redis session state, assembled by reading multiple hashes.
// This is what the backend builds internally when it needs a complete view.
export interface RedisSessionState {
  sessionId: string;
  status: SessionStatus;
  currentTopicId: string | null;
  facilitatorId: string;
  teamId: string;
  facilitatorConnected: boolean;
  participants: Record<string, RedisParticipantEntry>; // keyed by userId
  joinedUserIds: Set<string>;
}

// Redis topic state hash fields
export interface RedisTopicState {
  phase: TopicPhase;
  votingOpenedAt: string | null;  // ISO 8601
  revealedAt: string | null;      // ISO 8601
  lockedInCount: number;
}

// The votes for a topic as read from Redis (pre-reveal only)
// This type is NEVER sent to clients. It exists only in the reveal handler.
export interface RedisTopicVotes {
  [userId: string]: RedisVoteEntry;
}

// The reconnection snapshot stored at session:{id}:snapshot
export interface RedisSessionSnapshot {
  sessionId: string;
  teamId: string;
  status: SessionStatus;
  currentTopic: {
    sessionTopicId: string;
    topicName: string;
    prompt: string;
    voteType: VoteType;
    phase: TopicPhase;
    lockedInCount: number;
    // No vote values — this snapshot is safe to send to any client
  } | null;
  topicsCompleted: Array<{
    sessionTopicId: string;
    topicName: string;
    phase: 'complete';
  }>;
  participants: Array<{
    userId: string;
    displayName: string;
    connectionStatus: 'connected' | 'disconnected_voted' | 'disconnected_no_vote';
    readiness: ParticipantReadiness;
    // readiness is derived: 'ready' if locked in or disconnected_voted,
    //                       'disconnected' if disconnected_no_vote,
    //                       'not_ready' otherwise
  }>;
  isFirstSession: boolean;
  snapshotGeneratedAt: string; // ISO 8601
}
```

### 3.3 PostgreSQL Query Result Shapes (backend-only)

```typescript
// Backend-only: shapes for results returned by database queries.
// These are raw query results, before transformation into shared types.
// Lives in packages/backend/src/db/query-types.ts

// Result of: SELECT * FROM sessions WHERE id = $1
export interface DbSession {
  id: string;
  team_id: string;
  facilitator_id: string;
  status: SessionStatus;
  join_token: string;
  is_first_session: boolean;
  created_at: Date;
  started_at: Date | null;
  voting_started_at: Date | null;
  wrap_up_started_at: Date | null;
  completed_at: Date | null;
  abandoned_at: Date | null;
  current_topic_id: string | null;
  session_number: number;
}

// Result of: SELECT st.*, t.is_default FROM session_topics st
//            JOIN topics t ON t.id = st.topic_id
//            WHERE st.session_id = $1 ORDER BY st.display_order
export interface DbSessionTopic {
  id: string;
  session_id: string;
  topic_id: string;
  display_order: number;
  topic_name: string;
  topic_prompt: string;
  vote_type: VoteType;
  status: string;
  revealed_at: Date | null;
  completed_at: Date | null;
  flagged_for_discussion: boolean;
  discussion_note: string | null;
}

// Result of: SELECT v.*, u.display_name FROM votes v
//            JOIN users u ON u.id = v.voter_id
//            WHERE v.session_topic_id = $1
export interface DbVoteWithVoter {
  id: string;
  session_id: string;
  session_topic_id: string;
  voter_id: string;
  display_name: string;      // From the joined users row
  vote_value: number;
  vote_type: VoteType;
  is_outlier: boolean;
  outlier_threshold: number | null;
  revealed_at: Date;
  created_at: Date;
}

// Result of: SELECT ai.*, u.display_name as owner_name FROM action_items ai
//            JOIN users u ON u.id = ai.owner_id
//            WHERE ai.team_id = $1 AND ai.status IN ('open', 'in_progress')
//            ORDER BY ai.created_at
export interface DbActionItemWithOwner {
  id: string;
  team_id: string;
  session_id: string;
  session_topic_id: string | null;
  owner_id: string;
  owner_name: string;        // From the joined users row
  description: string;
  status: ActionItemStatus;
  resolution_note: string | null;
  resolved_in_session_id: string | null;
  created_at: Date;
  updated_at: Date;
}
```

### 3.4 The Boundary in Practice: Reveal Handler Shape

The reveal handler is the most critical piece of application logic in the system. Its type signature illustrates the boundary:

```typescript
// The reveal handler reads from Redis, writes to PostgreSQL, then broadcasts.
// The types involved make the data flow explicit and type-safe.

async function handleReveal(
  sessionId: string,
  sessionTopicId: string,
  facilitatorId: string
): Promise<void> {

  // Step 1: Read from Redis — this is the ONLY place pre-reveal votes are readable.
  const redisVotes: RedisTopicVotes = await redis.hgetall(
    `session:${sessionId}:votes:${sessionTopicId}`
  );
  // redisVotes is { [userId]: RedisVoteEntry } — never leaves this function pre-broadcast

  // Step 2: Compute aggregates and outlier flags in application memory.
  const outlierThreshold = await getEffectiveOutlierThreshold(sessionId);
  const aggregate = computeAggregate(redisVotes);
  const voteRows = computeOutliers(redisVotes, aggregate, outlierThreshold);

  // Step 3: Write to PostgreSQL (transaction).
  // Input: RedisVoteEntry[] + computed outlier flags
  // Output: void (committed to DB)
  const revealedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.insertVotes(voteRows.map(v => ({
      session_id: sessionId,
      session_topic_id: sessionTopicId,
      voter_id: v.userId,
      vote_value: v.voteValue,       // number from RedisVoteEntry
      vote_type: v.voteType,         // string from RedisVoteEntry → enum in DB
      is_outlier: v.isOutlier,
      outlier_threshold: outlierThreshold,
      revealed_at: revealedAt,
    })));
    await tx.updateSessionTopicRevealed(sessionTopicId, revealedAt);
  });
  // PostgreSQL is now the system of record.

  // Step 4: Clean up Redis.
  await redis.del(`session:${sessionId}:votes:${sessionTopicId}`);
  await redis.hset(`session:${sessionId}:topic_state:${sessionTopicId}`, {
    phase: 'revealed',
    revealed_at: revealedAt.toISOString(),
  });

  // Step 5: Build the broadcast payload (shared type — safe for clients).
  const payload: RevealEventPayload = {
    sessionId,
    sessionTopicId,
    topicName: /* from session topic record */ '',
    revealedAt: revealedAt.toISOString(),
    votes: voteRows.map(v => ({
      voterId: v.userId,
      voterDisplayName: v.displayName,
      voteValue: v.voteValue as VoteValue,
      voteType: v.voteType,
      isOutlier: v.isOutlier,
    })),
    aggregate,
    outlierThreshold,
  };

  // Step 6: Broadcast to all clients.
  // The payload type (RevealEventPayload) is the shared type — same definition
  // on backend and frontend, enforced by TypeScript compilation.
  await broadcastToSession(sessionId, 'session.revealed', payload);
}
```

The TypeScript type system enforces that `RedisTopicVotes` never crosses the WebSocket boundary — it is an internal type, not exported from the backend, and its shape is not compatible with `RevealEventPayload`. The only path from Redis votes to clients is through the reveal handler, which transforms the data into the shared `RevealEventPayload` type after writing to PostgreSQL. A developer cannot accidentally expose pre-reveal vote values to clients without breaking the type system.

---

## Section 4: Design Decisions

The following items were identified during the design session as requiring sign-off. All have been resolved. The authoritative record of decisions is `persistence-layer-open-questions.md`. Decisions with architectural implications are recorded as ADRs in the High-Level Architecture document.

| Item | Decision | ADR |
|------|----------|-----|
| **Re-adding a removed team member** | Update existing `team_memberships` row (clear `removed_at`). Membership change history is not a requirement. UNIQUE constraint on `(team_id, user_id)` retained. | — |
| **Action item draft visibility** | Filter by `sessions.status = 'complete'` at query time. No `is_draft` column. The wrap-up phase is short and facilitator-controlled. | — |
| **`session_topics.status` column type** | Resolved: `session_topic_status` enum added. Column updated. See `database-schema.md` v0.2. | — |
| **Outlier detection formula** | `\|vote − session_average\| > threshold` (absolute deviation). Default threshold: 1.5. Architecture document contained an error; BRD wording is authoritative. | ADR-006 |
| **Facilitator data access scope** | Session-context-scoped. Facilitator may access team history only while an active session (`status IN ('lobby', 'pre_session', 'active', 'wrap_up')`) exists for that team. No persistent post-session access. | ADR-007 |
| **Redis state reconstruction** | Session abandonment accepted as designed. No reconstruction attempt after Redis restart. | — |
| **Staleness computation** | Compute at query time via correlated subquery. No schema change. Revisit if measured as a bottleneck. | — |
| **Reconnection loading state** | Two-phase reconnection: apply Redis snapshot immediately; fetch historical topic results from PostgreSQL API separately, showing a loading state until resolved. Named frontend requirement. | — |
| **Session number gaps** | Session numbers count completed sessions only. Primary user-facing display is session date, not session number. | — |
