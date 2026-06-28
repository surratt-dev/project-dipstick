# Redis Session State Model
## Engineering Health Check — Ephemeral Layer Design

|                   |                                                                    |
|-------------------|--------------------------------------------------------------------|
| **Document Date** | 2026-03-08                                                         |
| **Version**       | 0.1 — Initial Design                                              |
| **Status**        | Working Draft — Under Review                                       |
| **Primary Author**| Marcus Oyelaran (Full Stack Engineer)                              |
| **Reviewers**     | Ingrid Sollenberger (Solution Architect), Marcus Delgado (Business Analyst) |

---

## Overview

Redis holds state that exists only for the duration of a live session. It is intentionally non-persistent. No data that must survive a Redis restart belongs in Redis.

The design principle governing this document: **Redis is a working surface, not a ledger.** It holds the current state of a session in flight — who has joined, who has locked in, what votes have been submitted but not yet revealed. When a session ends, everything in Redis is discarded. The permanent record is PostgreSQL.

This document defines every Redis key used during a live session, the data stored at each key, the TTL policy, and the behavior when a session ends or Redis restarts unexpectedly.

---

## The Boundary Rule

This rule is stated explicitly here and must be treated as a first-class architectural constraint, not a convention.

**What belongs in Redis (and only in Redis during a live session):**
- Which participants are currently connected to the session
- Each participant's connection status (connected / disconnected-with-prior-vote / disconnected-without-vote)
- Vote values that have been submitted (locked in) but not yet revealed — these are opaque until the reveal event
- The current session phase (lobby / pre_session / active / wrap_up)
- Which topic is currently active in the voting phase
- Which topics have been revealed and when
- Reconnection state snapshots (compact state for fast delivery to reconnecting clients)

**What never goes in Redis:**
- Revealed vote values (once revealed, they are written to PostgreSQL immediately and removed from Redis)
- Action items (these are PostgreSQL entities from the moment they are created)
- Team and user records
- Session metadata that must survive beyond the session (facilitator identity, team identity, join token — these are PostgreSQL entities)
- Discussion notes (written to PostgreSQL on the session_topic record as they are captured)
- Any data that must survive a Redis restart

**What never goes in PostgreSQL (from the live session layer):**
- Pre-reveal vote values
- Per-participant connection status during a live session
- The live readiness grid (who is "ready" vs. "not yet")

**The transition point:** When the facilitator triggers a reveal for a topic, the application atomically (a) transitions the session phase in Redis, (b) broadcasts the reveal event to all clients, and (c) writes the revealed votes to PostgreSQL. After this write is confirmed, the pre-reveal vote hashes in Redis are deleted. PostgreSQL is now the system of record for those votes.

---

## Key Naming Conventions

All Redis keys for a session are prefixed with `session:{session_id}:`. The `session_id` is the UUID primary key from the PostgreSQL `sessions` table.

Placeholder notation used in this document:
- `{session_id}` — UUID of the session, e.g., `550e8400-e29b-41d4-a716-446655440000`
- `{topic_id}` — UUID of the topic (from the PostgreSQL `session_topics.id`, not `topics.id`)
- `{user_id}` — UUID of the user (from the PostgreSQL `users.id`)

---

## Key Definitions

### 1. Session State Hash

**Key pattern:** `session:{session_id}:state`

**Redis data type:** Hash

**TTL:** 8 hours from last write. This covers the longest anticipated session (90 minutes, per NFR-AUTH-005) with significant buffer for slow wrap-up and operational delays. A background task refreshes the TTL when the session transitions phases. If the session is completed or abandoned, the key is explicitly deleted; the TTL is a safety net against orphaned keys for sessions that were never cleanly closed.

**Fields:**

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `status` | string | `lobby`, `pre_session`, `active`, `wrap_up`, `complete`, `abandoned` | Current session phase. Mirrors the PostgreSQL `sessions.status` but is the authoritative live value during an active session. PostgreSQL is updated at each phase transition. |
| `current_topic_id` | string | UUID or empty string | The `session_topics.id` of the currently active topic. Empty string during lobby, pre_session, wrap_up, complete, and abandoned phases. |
| `facilitator_id` | string | UUID | User ID of the session facilitator. Used to validate facilitator reconnection. |
| `team_id` | string | UUID | Team ID. Cached here to avoid PostgreSQL lookups during WebSocket event processing. |
| `created_at` | string | ISO 8601 timestamp | Session creation time. |
| `facilitator_connected` | string | `1` or `0` | Whether the facilitator is currently connected via WebSocket. |

**Reads:** Every WebSocket event handler, every server-side state transition, every reconnection handler.

**Writes:** Session creation, every phase transition (lobby → pre_session → active → wrap_up → complete/abandoned), facilitator connection/disconnection events.

**When session ends:** Deleted explicitly by the application when the session transitions to `complete` or `abandoned`. The 8-hour TTL is a safety net only.

---

### 2. Participant Roster

**Key pattern:** `session:{session_id}:participants`

**Redis data type:** Hash

**TTL:** Same as session state hash — 8 hours from last write, refreshed on activity.

**Fields (one entry per participant, keyed by user_id):**

The hash stores one field per participant. The field name is the user's UUID (`{user_id}`). The value is a JSON-encoded string with the following shape:

```json
{
  "display_name": "string",
  "connection_status": "connected | disconnected_voted | disconnected_no_vote",
  "joined_at": "ISO 8601 timestamp",
  "last_seen_at": "ISO 8601 timestamp"
}
```

**Connection status values:**
- `connected` — participant has an active WebSocket connection
- `disconnected_voted` — participant has disconnected but had locked in a vote for the current topic before disconnecting. Their readiness status in the facilitator grid remains "ready."
- `disconnected_no_vote` — participant has disconnected without locking in for the current topic. Their readiness status in the facilitator grid is "disconnected" (distinct from "not yet" and "ready").

**Reads:** Facilitator readiness grid, reconnection handlers, participant join validation.

**Writes:** Participant join, participant disconnect, participant reconnect.

**When session ends:** Deleted explicitly with the session. The data is not written to PostgreSQL — the `session_participants` table in PostgreSQL records the fact of participation (populated at join time), but not the connection state history.

**Note on the readiness grid:** The facilitator sees three states per participant: "not yet" (connected, no vote), "ready" (voted — either connected or `disconnected_voted`), "disconnected" (`disconnected_no_vote`). The connection_status field here encodes both the connection state and the voted state in a single field. The readiness grid is derived from this field server-side before being sent to the facilitator — vote values are never included.

---

### 3. Per-Topic Vote Hash

**Key pattern:** `session:{session_id}:votes:{topic_id}`

**Redis data type:** Hash

**TTL:** 8 hours from last write.

**Fields (one entry per voter, keyed by user_id):**

The hash stores one field per voter. The field name is the user's UUID (`{user_id}`). The value is a JSON-encoded string:

```json
{
  "vote_value": 3,
  "vote_type": "finger",
  "locked_at": "ISO 8601 timestamp"
}
```

**Vote encoding:**
- Finger vote: integer 1, 2, 3, or 4
- Roman vote: integer 1 (up/good) or -1 (down/bad)
- Modified Roman vote: integer 1 (up/trending positive), 0 (steady), or -1 (down/trending negative)

The integer encoding matches the PostgreSQL `votes.vote_value` column exactly. No transformation is required when writing from Redis to PostgreSQL at reveal time.

**Reads:** Reveal handler (reads all votes for the topic, computes aggregates, writes to PostgreSQL, broadcasts reveal event).

**Writes:** Lock-in handler (participant submits and locks a vote).

**Critical security constraint:** This key must never be read by any handler that returns data to clients during the voting phase. The only handler authorized to read this key is the reveal handler, which is triggered exclusively by the facilitator's reveal action and which immediately writes the data to PostgreSQL before broadcasting. No API endpoint, WebSocket handler, or reconnection state snapshot includes vote values from this key before the reveal is triggered.

**When topic is revealed:** The reveal handler reads all vote values, writes them to PostgreSQL (the `votes` table), broadcasts the `session.revealed` event including all vote values, and then deletes this key. PostgreSQL is now the system of record.

**When session ends (without reveal):** If a session is abandoned mid-voting, any unrevealed vote hashes are deleted along with all other session keys. The votes are not written to PostgreSQL because they were never revealed — this is the documented, accepted outcome for the Redis restart failure mode.

---

### 4. Topic State Hash

**Key pattern:** `session:{session_id}:topic_state:{topic_id}`

**Redis data type:** Hash

**TTL:** 8 hours from last write.

**Fields:**

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `phase` | string | `waiting`, `voting`, `revealed`, `complete` | Current phase of this topic within the session. Mirrors the session state machine for this topic. |
| `voting_opened_at` | string | ISO 8601 timestamp or empty string | When the facilitator opened voting for this topic. |
| `revealed_at` | string | ISO 8601 timestamp or empty string | When the reveal was triggered. Also written to PostgreSQL (`session_topics.revealed_at`) at reveal time. |
| `locked_in_count` | string | integer as string | Count of participants who have locked in. Maintained incrementally to avoid counting hash fields. Used to determine whether the reveal button should be enabled. |

**Reads:** Facilitator readiness grid (to show locked_in_count and enable/disable reveal button), reconnection state snapshots.

**Writes:** Facilitator advances to topic (sets phase to `voting`, sets `voting_opened_at`), participant locks in (increments `locked_in_count`), facilitator triggers reveal (sets phase to `revealed`, sets `revealed_at`), facilitator advances past reveal (sets phase to `complete`).

**When session ends:** Deleted explicitly with the session.

---

### 5. Reconnection State Snapshot

**Key pattern:** `session:{session_id}:snapshot`

**Redis data type:** String (JSON-encoded)

**TTL:** 8 hours from last write, refreshed on any state change.

**Value:** A JSON document representing the complete current state of the session, suitable for delivery to a reconnecting client. This is computed and cached to avoid re-querying multiple Redis hashes on every reconnection event.

```json
{
  "session_id": "uuid",
  "team_id": "uuid",
  "status": "active",
  "current_topic": {
    "session_topic_id": "uuid",
    "topic_name": "Production Code",
    "prompt": "How would you rate the overall quality of the production codebase?",
    "vote_type": "finger",
    "phase": "voting",
    "locked_in_count": 3
  },
  "topics_completed": [
    {
      "session_topic_id": "uuid",
      "topic_name": "Test Suite",
      "phase": "complete"
    }
  ],
  "participants": [
    {
      "user_id": "uuid",
      "display_name": "Alex Chen",
      "connection_status": "connected",
      "readiness": "ready"
    }
  ],
  "is_first_session": false,
  "snapshot_generated_at": "ISO 8601 timestamp"
}
```

**Critical constraint on snapshot content:** The snapshot never includes vote values for topics that have not yet been revealed. `readiness` is derived from the participant's connection status and whether they have locked in — it is `"ready"` or `"not_ready"` or `"disconnected"`. No vote value, vote direction, or aggregate appears in the snapshot before the reveal.

For topics that have been revealed (phase = `complete`), the snapshot does not include vote values either — those are read from PostgreSQL by the reconnecting client's subsequent API call to fetch session history. The snapshot's job is to restore the client to the correct live state, not to replay the full session history.

**Reads:** Reconnection handler for participants and facilitators.

**Writes:** Updated whenever the session state changes: participant joins/disconnects, topic advances, vote locked in, reveal triggered.

**When session ends:** Deleted explicitly with the session.

**Design rationale:** A dedicated snapshot key avoids serializing multiple hash reads into an on-the-fly aggregation on every reconnection. The snapshot is pre-computed and updated incrementally. This trades a small amount of write amplification (update the snapshot on every state change) for significantly faster reconnection delivery — an important property given that reconnecting participants need immediate state sync.

---

### 6. Session Join Set

**Key pattern:** `session:{session_id}:joined_users`

**Redis data type:** Set

**TTL:** 8 hours from last write.

**Members:** User UUIDs of all users who have joined the session (at any point — including users who have since disconnected).

**Purpose:** Fast O(1) membership check for "has this user already joined?" Used during WebSocket connection establishment to determine whether a user is re-joining (reconnection) or joining for the first time. Prevents a user from being added to `session_participants` in PostgreSQL more than once.

**Reads:** WebSocket connection handler, join endpoint.

**Writes:** When a participant joins for the first time.

**When session ends:** Deleted explicitly with the session.

---

## TTL Summary

| Key pattern | TTL | Refresh trigger |
|-------------|-----|-----------------|
| `session:{id}:state` | 8 hours | Any phase transition |
| `session:{id}:participants` | 8 hours | Any participant event |
| `session:{id}:votes:{topic_id}` | 8 hours | Any lock-in event |
| `session:{id}:topic_state:{topic_id}` | 8 hours | Any topic event |
| `session:{id}:snapshot` | 8 hours | Any state change |
| `session:{id}:joined_users` | 8 hours | Any join event |

All keys for a session share the same 8-hour TTL window, refreshed by activity. The TTL is a safety mechanism against orphaned keys — a session that is properly closed (either completed or abandoned) deletes all its keys explicitly. The 8-hour TTL ensures that a session whose keys were not explicitly cleaned up (due to a backend crash between the session close and the key deletion) is eventually reaped.

A background job should run periodically (e.g., hourly) to scan for session keys with TTLs below a threshold and confirm that the corresponding PostgreSQL session record is in a terminal state (`complete` or `abandoned`). If a session key exists for a session in a non-terminal PostgreSQL state, it indicates an inconsistency that requires investigation.

---

## Redis Restart Failure Mode

This section was flagged as a critical unresolved risk in both the High-Level Architecture open questions and the engineering review. It is resolved here with a defined behavior.

### What Happens

A Redis restart during an active live session causes the backend to lose all in-memory session state. The backend detects the unavailability immediately (Redis connection error on any read or write attempt).

### What State Is Lost

All of the following are lost on Redis restart:
- Current session phase (which phase the session was in)
- Participant roster and connection statuses
- Per-topic vote hashes — any votes that had been locked in but not yet revealed are unrecoverable
- Topic phase states
- Reconnection snapshots

**Votes that were locked in but not yet revealed at the time of Redis restart are lost.** This is the explicit, accepted trade-off of storing pre-reveal votes only in Redis. It is documented behavior, not undefined behavior. Per NFR-DATA-003, votes held only in Redis at the time of failure are not recoverable and must not be silently counted.

### What Is Not Lost

All PostgreSQL data is unaffected:
- Session record (team, facilitator, status at last PostgreSQL write)
- Session participants (populated at join time)
- Votes for all topics that were revealed before the restart (written to PostgreSQL at reveal time)
- Action items (written to PostgreSQL when created)
- Discussion notes (written to PostgreSQL as captured)

### Recovery Behavior

1. **Detection:** The backend detects Redis unavailability immediately on the next read or write attempt. The backend begins exponential backoff reconnection attempts.

2. **Participant notification:** All connected WebSocket clients receive a system event indicating that the session has encountered an infrastructure problem. The facilitator sees a specific message indicating that the session may not be recoverable. Participants see a generic "session interrupted" message. Neither the facilitator nor participants are dismissed immediately.

3. **Five-minute threshold (NFR-REL-004):** If Redis remains unavailable for five continuous minutes, the session is formally abandoned:
   - The backend updates the PostgreSQL `sessions.status` to `abandoned` and sets `sessions.abandoned_at` to the current timestamp.
   - All connected WebSocket clients are notified with an explanatory message: the session has been abandoned due to infrastructure unavailability.
   - The WebSocket connections are closed.
   - The backend logs the abandonment event as a structured audit record.
   - Any votes that were in Redis at the time of failure are not written to PostgreSQL — they are gone.

4. **If Redis recovers before five minutes:** The backend re-establishes its Redis connection. However, all session state in Redis is gone. The application cannot reconstruct the session because the pre-reveal vote hashes are unrecoverable without the votes themselves. The backend treats this as equivalent to an abandonment: the session is marked `abandoned` in PostgreSQL and clients are notified.

   **Rationale for this behavior:** Attempting to "resume" a session after a Redis restart would require the server to know which participants had locked in and what they voted, which it cannot know. Allowing the session to continue in this state would either silently lose votes (unacceptable — the results would be wrong) or require a full re-vote for the affected topics (complex, confusing, and potentially disruptive to ritual integrity). Abandonment and re-creation is the cleaner outcome.

5. **What facilitators and participants should do:** Create a new session. Votes from topics that were revealed before the failure are preserved in PostgreSQL and will appear in the team's session history as a partial session (status: `abandoned`). The new session can cover the remaining topics.

### What Must Be Tested

Per Marcus Oyelaran's review note in the architecture document: this failure mode must be induced deliberately in a test environment. The test must verify:
- Redis unavailability is detected within one second
- Exponential backoff retry begins immediately
- Participants and the facilitator receive a notification within five seconds of detection
- After five minutes of unavailability, the session is abandoned in PostgreSQL
- No votes are written to PostgreSQL that were not yet revealed at the time of failure
- After abandonment, WebSocket connections are closed with an explanatory close reason

---

## Explicit Boundary Statements

These are stated in the form of invariants that must hold true in the implementation. They are checkable by code review and testable by inspection of data written to each store.

**Invariant 1:** No vote value appears in a Redis key after the reveal event is broadcast. The vote hash `session:{id}:votes:{topic_id}` must be deleted within the same server-side operation that broadcasts the reveal event.

**Invariant 2:** No vote value appears in a Redis key before the facilitator triggers the reveal. The vote hash stores values only for participants who have locked in, and that hash is inaccessible to any handler that returns data to clients during the voting phase.

**Invariant 3:** No participant connection status is stored in PostgreSQL during a live session. The `session_participants` table records participation (user joined the session), not the live connection state. Connection state lives only in the participants hash in Redis.

**Invariant 4:** No action item is stored exclusively in Redis. Action items are written to PostgreSQL as soon as they are created (during wrap-up). Draft action items (during wrap-up before session completion) exist in PostgreSQL with the `sessions.status = 'wrap_up'` parent session — they are accessible if the session's wrap-up state needs to be recovered.

**Invariant 5:** When the session transitions to `complete` or `abandoned`, all Redis keys for that session are explicitly deleted. The TTL is a safety net, not the primary cleanup mechanism.

---

## Architectural Validation Notes — Ingrid Sollenberger

**Boundary compliance:** I reviewed every key defined in this document against the boundary rule. No key stores data that belongs in PostgreSQL. No key stores data that must survive a Redis restart. The vote hash (`session:{id}:votes:{topic_id}`) is the most sensitive key — it holds unrevealed vote values — and it is correctly scoped: it is created on the first lock-in, read only at reveal time, and deleted immediately after the reveal write to PostgreSQL is confirmed. This is correct behavior.

**TTL policy:** The 8-hour TTL on all session keys is appropriate for the expected session duration (90-minute maximum, per NFR-AUTH-005). The TTL refresh mechanism (any state change resets the TTL) means that an actively running session will not expire mid-session. The orphaned-key background job is a necessary operational complement to the TTL — without it, a crash between session completion and key deletion would leave keys in Redis indefinitely until TTL expiry.

**Failure mode coverage:** The Redis restart failure mode is now fully specified: state lost, behavior on recovery attempt, five-minute abandonment threshold, audit record, and prohibition on writing unconfirmed votes to PostgreSQL. This resolves the open risk that was flagged in the architecture document. The behavior is deterministic and testable.

**Reconnection snapshot design:** The snapshot key is a pragmatic performance decision. An alternative (re-read and assemble from individual hashes on every reconnection) is functionally equivalent but slower. The snapshot approach introduces a consistency risk: if the snapshot update fails after a state change, a reconnecting client could receive stale state. The application must update the snapshot atomically with the state change (write the state hash, then update the snapshot in a single pipeline) or accept that the snapshot may lag by one event. Lagging by one event is acceptable for reconnection — the client will receive subsequent state updates via WebSocket events. This should be documented in implementation notes.

**Operational observability:** The Redis keyspace for a session is bounded and predictable: one state hash, one participant hash, one or more vote hashes (one per topic), one snapshot, one joined_users set. The total number of keys per session is `4 + N_topics`. With five topics (the default set), a session occupies nine Redis keys. This is easily monitored via `SCAN` for operational health checks and for the orphaned-key cleanup job.

**No Redis persistence required:** Redis must be deployed without AOF or RDB persistence for this application. Enabling persistence would not solve the failure mode (the data is still lost if the process restarts) and would create false expectations that Redis state is durable. The deployment configuration must explicitly disable persistence. This should be included in the Kubernetes ConfigMap for the Redis deployment.

---

## Domain Validation Notes — Marcus Delgado

**Readiness grid integrity (OR-2.2):** The participant roster hash encodes three states per participant: `connected`, `disconnected_voted`, and `disconnected_no_vote`. These map correctly to the three facilitator grid states: "ready" (`disconnected_voted`), "ready" (connected + locked in — derivable from locked_in_count), "disconnected" (`disconnected_no_vote`), "not yet" (connected, not locked in). The facilitator never sees vote values. Confirmed.

**Simultaneous reveal (FR-4.6):** The reveal handler reads all votes from the vote hash, writes them to PostgreSQL, and broadcasts the single `session.revealed` event. This is a single server-side operation that produces one broadcast. The reveal event is not sent per-client; it is sent to all clients simultaneously from a single broadcast call. The vote hash is deleted after the broadcast. This architecture correctly enforces the simultaneous reveal property.

**Late join behavior (FR-4.10):** A participant who joins after a topic has been revealed sees the snapshot, which does not include vote values for completed topics. They retrieve historical vote data via a separate PostgreSQL API call. They cannot vote on already-revealed topics. The Redis model correctly supports this: the vote hash for a revealed topic is already deleted; even if a late joiner somehow triggered a lock-in request for a revealed topic, the server would reject it based on the topic's phase (`complete`) in the topic state hash.

**Lock-in irreversibility (FR-4.2):** Once a vote is written to the vote hash in Redis, it is immutable from the participant's perspective. The lock-in handler writes the vote once; subsequent lock-in requests for the same participant on the same topic are rejected (HEXISTS check before HSET). The UNIQUE constraint on the PostgreSQL `votes` table provides a second layer of enforcement at reveal write time.

**Disconnection with prior vote (OR-1.3):** The `disconnected_voted` connection status in the participant hash correctly preserves the "ready" readiness indicator for a participant who disconnected after locking in. Their vote remains in the vote hash. When they reconnect (or if they do not reconnect before the reveal), their vote is included in the reveal results. Confirmed correct.

**Pre-session action item state:** The Redis model does not include any keys for the pre-session action item review. This is correct — action items are PostgreSQL entities, and real-time updates to action item status during the pre-session review are written directly to PostgreSQL and broadcast via WebSocket events. Redis holds no action item state.

**Gap noted:** The snapshot key design notes that vote values for completed (revealed) topics are not included in the snapshot — reconnecting clients must make a subsequent PostgreSQL API call to retrieve them. This creates a small window during reconnection where the client has session state but not vote history. The application must handle this gracefully (e.g., showing a loading state for historical topic results until the API call completes). This should be flagged as a UI requirement for the reconnection flow.
