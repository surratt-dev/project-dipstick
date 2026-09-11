# Project To-Do

## Finish open issues

prompt:
```
We have been working through a structured review of open API design issues identified in the validation report at design/Engineering Health Check - REST API Contract - Validation Report.md. The API contract is at design/Engineering Health Check - REST API Contract.md and the BRD is at Engineering Health Check - BRD.md.
```


## Open Questions Requiring Stakeholder Input

design/Engineering Health Check - REST API Contract - Validation Report.md

- **Project Trend computation algorithm** — The formula for aggregating Modified Roman votes into the up/steady/down directional indicator is not yet specified. Required before the Trend Dashboard can be fully implemented. Owner: BA (Marcus Delgado).
- **Session abandonment artifacts** — Whether abandoned sessions appear in session history and what data is accessible from them. Owner: BA.
- **Action item ownership on team member departure** — Reassignment rules, orphan handling, whether removal is blocked for members with open items. Owner: BA.



## Outstanding Documents

### WebSocket Specification [x]

**Closed by the `websocket-specification` OpenSpec change (2026-09-11):** see `openspec/specs/websocket-specification/spec.md` (synced to the main spec tree; the change directory retains a copy plus the proposal/design/tasks history at `openspec/changes/websocket-specification/`).
A WebSocket Specification document is required before the real-time layer can be implemented.

The REST API contract (Appendix D) defers all real-time behaviors to WebSocket. That document must specify, at minimum:

- **`reveal.trigger` event payload** — including the required `serverTimestamp` field (ISO 8601, UTC) mandated by FR-4.6.1 [HARD]
- **Client latency obligation** — clients must calculate and log observed delivery latency from `serverTimestamp`; the acceptable delivery window is 15 seconds
- **All other WebSocket message payload schemas:**
  - `vote.submit`
  - `topic.advance`
  - `participant.joined` / `participant.left`
  - `vote.locked`
  - `session.revealed`
  - `topic.advanced`
  - `actionitem.created`
  - `actionitem.updated`
- **Connection lifecycle** — authentication handshake, reconnection strategy, session recovery
- **Error handling** — how WebSocket errors are surfaced to clients

**Owner:** Full Stack Engineer (Marcus Oyelaran) + Solution Architect (Ingrid Sollenberger)
**Blocking:** Real-time layer implementation cannot begin until this document is approved.

---

