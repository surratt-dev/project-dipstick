# Persistence Layer — Open Questions
## Engineering Health Check

|                   |                                                                    |
|-------------------|--------------------------------------------------------------------|
| **Document Date** | 2026-03-08                                                         |
| **Status**        | All items resolved — 2026-03-08                                    |
| **Author**        | Marcus Oyelaran, with review from Ingrid Sollenberger and Marcus Delgado |
| **Source docs**   | `database-schema.md`, `redis-session-model.md`, `persistence-layer-mapping.md` |

---

## How to Use This Document

Each item below is a design decision that cannot be resolved by the engineering team alone, or that requires explicit sign-off before implementation begins. For each item:

- **Context** summarizes the situation and why it matters.
- **Options** (where applicable) lists the available choices and their trade-offs.
- **Recommendation** is the team's current lean, if one exists.
- **Response** is blank — add your decision and any clarifying notes here.

Items are ordered by implementation urgency: items that block a specific implementation piece come before items that are lower stakes.

---

## OQ-1: Outlier Detection Threshold Formula

**Source:** `persistence-layer-mapping.md` §OQ-4 | **Blocks:** Outlier detection implementation, `application_settings` seed data
**Needs response from:** Marcus Delgado

### Context

Two definitions of the outlier threshold appear in the project documentation, and they produce different results:

- **BRD (FR-5.1):** "A vote is flagged as an outlier if it deviates more than ±1.5 from the session average." Formula: `|vote − average| > 1.5`
- **Architecture document:** "A vote is flagged if it is less than `average − 1.5 × average` or greater than `average + 1.5 × average`." Formula: `|vote − average| > 1.5 × average`

These are not the same. For a topic where the average score is 3.0 on a 1–4 finger vote scale:

| Formula | Outlier threshold | Votes flagged |
|---------|------------------|---------------|
| BRD: `\|vote − avg\| > 1.5` | ±1.5 from 3.0 → flags votes below 1.5 or above 4.5 | A vote of 1 is flagged; a vote of 4 is not |
| Architecture: `\|vote − avg\| > 1.5 × avg` | ±4.5 from 3.0 → flags votes below −1.5 or above 7.5 | No finger vote would ever be flagged |

The BRD formula is the operationally meaningful one for a 1–4 scale. The architecture document formula appears to be an error. The threshold default value of 1.5 is stored as a seed value in `application_settings` and is also overridable per team in `outlier_threshold_overrides`.

The outlier computation runs in the reveal handler, in application memory, before votes are written to PostgreSQL. The formula must be confirmed before that handler is implemented.

### Options

1. **Adopt the BRD formula:** `|vote − average| > threshold` (where threshold defaults to 1.5). This is the operationally meaningful definition for the 1–4 scale.
2. **Adopt the architecture formula:** `|vote − average| > threshold × average`. Would require a much higher threshold value to produce any flags; appears to be inconsistent with the BRD intent.
3. **Define a different formula entirely:** e.g., flag votes more than N standard deviations from the mean. Higher sophistication but also higher complexity and harder to explain to facilitators.

### Recommendation

Option 1. The BRD language is plain and matches how a facilitator would naturally reason about outliers ("someone voted very differently from the group"). Confirm this is the intent.

### Response

> use option 1

**Decision:** Formula confirmed as `|vote − session average| > threshold`, where threshold defaults to 1.5. The architecture document contained an error in its formulation. The BRD wording is authoritative. Seed value in `application_settings` (`outlier_threshold_individual = 1.5`) is correct. ADR-006 added to the High-Level Architecture document.

---

## OQ-2: Facilitator Post-Session Access to Vote History

**Source:** `persistence-layer-mapping.md` §OQ-5 | **Blocks:** Authorization layer implementation
**Needs response from:** Marcus Delgado, Ingrid Sollenberger

### Context

A facilitator runs sessions for teams they do not belong to. The cross-team constraint is enforced at session creation and is a load-bearing ritual integrity requirement. After a session completes, the architecture document states that session history is accessible to "team members, team's engineering manager, and the session facilitator."

This implies that a facilitator who has run sessions for multiple teams accumulates read access to those teams' vote histories over time, without being a member of any of them.

Two questions need answers:

1. **Should the facilitator retain read access to sessions they facilitated after completion?** The authorization model in `sessions.facilitator_id` supports this, but it is not explicitly confirmed in the requirements.
2. **If yes, is that access scoped to specific sessions, or to all of the team's historical sessions?** Scoping to specific sessions (only the ones they facilitated) is more defensible from an access-control standpoint.

This matters for the authorization query on every session history request. The backend must check `team_memberships` (for members and EMs) plus `sessions.facilitator_id` (for facilitators). If the scope is unbounded, a facilitator who has facilitated many teams has broad read access that may not have been intended.

### Options

1. **Facilitator retains read access to sessions they specifically facilitated.** `sessions.facilitator_id = current_user.id AND sessions.id = requested_session_id`. Narrow and defensible.
2. **Facilitator retains read access to all historical sessions for any team they have ever facilitated.** Requires tracking facilitator-team relationships separately, or querying `sessions` for all sessions where `facilitator_id = current_user.id AND team_id = requested_team_id`.
3. **Facilitator has no post-session access.** Only team members and EMs can view historical data. Simplest authorization model; may frustrate facilitators who want to review what they ran.

### Recommendation

Option 1. The facilitator's interest is in reviewing what happened in their session, not in accumulating a reporting view of teams they've touched. Scoping access to the specific sessions they facilitated is least-privilege without being punitive.

### Response

> the facilitor should have access to past seesions for the team they are leading through the ritual.  this allows them to dig deeper while talking to the team.  This is not something that needs to be controlled via a permission mechniams, but via the current context.  A failiateor should not be able to access a teams historical data outside a session.

**Decision:** Facilitator access to a team's historical session data is **session-context-scoped**, not a persistent permission. A facilitator may access the full session history for a team only while they have an active (non-terminal) session for that team — i.e., `sessions.status IN ('lobby', 'pre_session', 'active', 'wrap_up')` and `sessions.facilitator_id = current_user.id`. Outside of an active session, the facilitator has no access to that team's data. This is a meaningful change from the original architecture document, which implied persistent post-session access. ADR-007 added to the High-Level Architecture document.

---

## OQ-3: Re-Adding a Previously Removed Team Member

**Source:** `database-schema.md` (team_memberships design rationale), `persistence-layer-mapping.md` §OQ-1
**Blocks:** Team membership management implementation
**Needs response from:** Marcus Delgado

### Context

The `team_memberships` table has a UNIQUE constraint on `(team_id, user_id)`. When a user is removed from a team, `removed_at` is set on their membership row rather than deleting it. This preserves their historical participation in sessions and action item ownership.

If that user is later re-added to the team, the options are:

- **Update the existing row** (clear `removed_at`, update `joined_at`). The UNIQUE constraint requires this. But the original join date is overwritten, and the removal event is erased.
- **Insert a new row.** Requires replacing the UNIQUE constraint with a partial unique index (`WHERE removed_at IS NULL`). Preserves the full history of join → remove → rejoin, but requires the application to handle a user having multiple membership records.

The schema currently uses the UNIQUE constraint, which forces the "update the existing row" behavior.

The question is whether membership history (multiple join/remove cycles for the same user) is a requirement. If a facilitator or EM wants to understand who has been on a team and when, the current schema loses that information on re-add.

### Options

1. **Update the existing row on re-add.** Current behavior. Simpler schema; loses membership history.
2. **Replace UNIQUE constraint with a partial unique index (`WHERE removed_at IS NULL`), allow multiple rows per user per team.** Preserves full membership history. Application must handle multiple rows (take the most recent active row as the current membership).

### Recommendation

Option 1 unless there is a stated requirement for membership change history. If Option 2 is chosen, a `team_membership_history` table is probably cleaner than allowing multiple rows in `team_memberships` itself.

### Response

> option 1.  team membership history is not critical.

**Decision:** Re-adding a removed user updates the existing `team_memberships` row (clear `removed_at`). The UNIQUE constraint on `(team_id, user_id)` is retained as designed. Membership change history is not a requirement.

---

## OQ-4: Redis State Reconstruction After Short Outage

**Source:** `persistence-layer-mapping.md` §OQ-6, `redis-session-model.md` (Failure Mode section)
**Blocks:** Nothing immediately; affects failure mode policy
**Needs response from:** Ingrid Sollenberger, Marcus Delgado

### Context

The current design abandons a session if Redis is unavailable for more than 5 minutes — even if Redis recovers before the threshold. The rationale: pre-reveal votes cannot be reconstructed from PostgreSQL because they were never written there. Resuming the session would mean the server cannot know what was voted, so the results would be wrong.

One alternative: write lock-in events to a `session_events` table in PostgreSQL at the moment of lock-in (not the vote value, just the fact that the user locked in). After a Redis restart, the server could reconstruct *who had locked in* for the current topic. Vote values would still be lost, but the session could continue by asking those participants to re-vote for the affected topic. The facilitator would know which topic was in flight and could re-open it.

This is a significant scope expansion. The current accepted behavior is: **session is abandoned; start a new one; revealed topics' data is preserved in PostgreSQL**. The question is whether that behavior is acceptable to the product owner and operations team, or whether the effort to make recovery possible is warranted.

### Options

1. **Accept current behavior.** Session is abandoned on Redis unavailability. Revealed topics are preserved. No implementation change needed.
2. **Write lock-in events to PostgreSQL.** Adds a `session_events` table. On Redis recovery, the server can reconstruct readiness state (not vote values) and continue the session with a re-vote for the in-flight topic.

### Recommendation

Option 1 for the initial release. Redis restarts during a session should be rare. The additional complexity of Option 2 is better justified by an operational incident than by a precautionary design.

### Response

> option 1

**Decision:** Session abandonment on Redis unavailability is accepted as designed. No reconstruction attempt; no `session_events` table. This confirms the behavior already documented in `redis-session-model.md` and §12 of the High-Level Architecture document.

---

## OQ-5: Staleness Computation for Action Items

**Source:** `persistence-layer-mapping.md` §OQ-7
**Blocks:** Action item backlog query implementation
**Needs response from:** Marcus Oyelaran (performance assessment)

### Context

The staleness indicator for an action item is defined in the use cases as the number of completed team sessions that have occurred since the item was last updated. An item is flagged as stale after a configurable threshold (default: 2 sessions).

Computing this at query time requires a correlated subquery: for each action item, count the number of completed sessions for the team where `completed_at > action_items.updated_at`. This runs on every backlog page load. At current anticipated scale (a handful of teams, bi-weekly sessions), this is not a concern. At scale with many teams and large session histories, it could be.

### Options

1. **Compute at query time.** Simple; no additional schema. Acceptable at current scale.
2. **Store `sessions_since_last_update` on `action_items`.** Updated after each session completes. Adds a write dependency (session completion must update all open action items for the team). Faster reads; more complex writes.
3. **Materialized view.** Refreshed on session completion. Good balance; more operational complexity.

### Recommendation

Option 1 for the initial implementation. Measure before optimizing.

### Response

> go with option 1

**Decision:** Staleness is computed at query time via correlated subquery. No schema change required. Performance is acceptable at current scale; revisit if backlog queries become a measured bottleneck.

---

## OQ-6: Reconnection Loading State (UI Gap)

**Source:** `redis-session-model.md` (Marcus Delgado domain validation notes)
**Blocks:** Frontend reconnection flow specification
**Needs response from:** Marcus Delgado (requirements), Marcus Oyelaran (implementation)

### Context

When a participant reconnects mid-session, the reconnection snapshot (from Redis) delivers the current live state: which topic is active, who has locked in, what phase the session is in. However, the snapshot does not include vote results for topics that were already revealed before the reconnection — those are stored in PostgreSQL and require a separate API call to retrieve.

This creates a window after reconnection where the client has the live session state but not the historical topic results. During this window, the "completed topics" section of the participant's view would either show an empty state or a loading indicator, until the PostgreSQL fetch completes.

This is not a data model problem — it is a specified behavior of the reconnection design. It requires the frontend to handle a two-phase reconnection: (1) apply the Redis snapshot immediately, (2) fetch historical topic results from the PostgreSQL API and populate the completed topics section when available.

The requirement to handle this gracefully needs to be made explicit in the frontend specification so it is not discovered during implementation.

### Options

1. **Show a loading indicator for historical topic results on reconnection.** Snapshot is applied immediately; a spinner or skeleton appears in the completed topics section until the API call resolves.
2. **Delay rendering the reconnection state until both snapshot and historical data are available.** Slower to restore, but the client never sees a partial state.
3. **Include revealed vote results in the reconnection snapshot (from PostgreSQL via the server).** The server fetches historical results and merges them into the snapshot before sending it. Slower snapshot delivery; avoids the two-phase problem on the client.

### Recommendation

Option 1. The live session state (current topic, readiness grid) is the priority. Historical topic results can load a moment later without disrupting the participant's ability to vote.

### Response

> option 1

**Decision:** Two-phase reconnection is the specified behavior. The client applies the Redis snapshot immediately and shows a loading state for historical topic results until the PostgreSQL fetch completes. This is a named frontend requirement to be carried into the UI specification.

---

## OQ-7: Session Number Gaps from Abandoned Sessions

**Source:** `database-schema.md` (sessions table design rationale)
**Blocks:** Nothing; display/UX question
**Needs response from:** Marcus Delgado

### Context

The `session_number` column on `sessions` records the ordinal position of the session in the team's history (1st, 2nd, 3rd...). It is computed at session creation from the count of prior completed sessions for the team.

If a session is created and then abandoned before completion, the next successful session will reuse the same session number (because the abandoned session does not count toward the completed session total). This means session numbers are always sequential among completed sessions, but abandoned sessions are effectively invisible in the numbering.

Alternatively, if session numbers counted all created sessions (completed or abandoned), the numbers would have gaps: the team might have sessions 1, 2, 4 if session 3 was abandoned.

Neither behavior is wrong — but the display implication (does the team see "Session 3 of 5" or "Session 3 of 4") depends on which sessions count.

### Options

1. **Current behavior:** Session numbers count completed sessions only. No gaps; abandoned sessions are invisible in the numbering. A team always sees a clean sequence.
2. **Count all created sessions.** Numbers may have gaps if abandoned sessions occurred. Provides a more complete picture of session history (an abandoned session represents a real event).

### Recommendation

Option 1. Gaps in session numbering are confusing to end users. Abandoned sessions are an infrastructure event, not a ritual event, and should not disrupt the team's sense of their session history.

### Response

> session numbers are an ordering tool.  we will likely not display it to the user, but the date value.  use option 1.

**Decision:** Session numbers count completed sessions only (no gaps from abandoned sessions). The primary user-facing display for session identification is the session date, not the session number. `session_number` is an internal ordering field.

---

## Resolved Items (For Reference)

These items were raised during the design session and have since been resolved. They are recorded here for traceability.

| Item | Decision |
|------|----------|
| `session_topics.status` column type | `session_topic_status` enum added; column updated. See `database-schema.md` v0.2. |
| Action item draft visibility | No schema change. Backlog queries filter by `sessions.status = 'complete'`. See `database-schema.md` v0.3. |
| OQ-1: Outlier detection formula | `\|vote − average\| > 1.5` (BRD formula). Architecture doc error corrected. ADR-006. |
| OQ-2: Facilitator post-session access | Session-context-scoped only. Facilitator accesses team history only while an active session exists. No persistent permission. ADR-007. |
| OQ-3: Re-adding a removed team member | Update existing row (clear `removed_at`). Membership history not required. |
| OQ-4: Redis state reconstruction | Session abandonment accepted. No reconstruction attempt. Confirmed in `redis-session-model.md`. |
| OQ-5: Staleness computation | Compute at query time. No schema change. |
| OQ-6: Reconnection loading state | Two-phase reconnection. Show loading state for historical topics. Named frontend requirement. |
| OQ-7: Session number gaps | Count completed sessions only. Primary display is session date, not session number. |
