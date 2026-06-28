# Engineering Health Check — REST API Contract Validation Report

**Prepared by:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-03-15
**Input:** Engineering Health Check — REST API Contract (Marcus Oyelaran, 2026-03-08)
**BRD Version:** 1.1 — Open Questions Resolved

---

## Section 1 — Coverage Matrix

| Functional Requirement | BRD Description | API Endpoint(s) | Status |
|---|---|---|---|
| FR-1.1 | Authenticate via external OIDC only | AUTH-001, AUTH-002 | Covered |
| FR-1.7 | Teams may be created independently of session creation, by Facilitators or EMs (BRD amendment 2026-03-15) | TEAM-001 (auth expanded to facilitator or EM; zero-session state handled in TREND-005) | Covered |
| FR-1.2 | Create user record on first OIDC authentication | AUTH-002 (auto-create with `global_role = 'engineer'`) | Covered |
| FR-1.3 | Four-role model enforced | AUTH-004, Authorization Vocabulary, Appendix B | Covered |
| FR-1.4 | EM role cannot cast votes | SESSION-003 (403 for EM), VOTE-002 (EM blocked), AUTH-004 response shape | Covered |
| FR-1.5 | Display current user name and role on all screens | AUTH-004 (`GET /api/v1/users/me`) | Covered |
| FR-1.6 | Team membership managed within the application | TEAM-004, TEAM-005, TEAM-006 | Covered |
| FR-2.1 | Only a facilitator may create a session | SESSION-001 (authorization enforced) | Covered |
| FR-2.2 | Facilitator cannot create session for own team | SESSION-001 (cross-team check), TEAM-002 (filtered list) | Covered |
| FR-2.3 | Generate unique, non-guessable join link on session creation | SESSION-001 (128-bit token, full URL returned) | Covered |
| FR-2.4 | Only registered team members admitted via join link; non-members denied | SESSION-003 (403 for non-members and EMs) | Covered |
| FR-2.5 | Lobby shows real-time participant list (facilitator only) | SESSION-002 (`readinessGrid`), WebSocket (`participant.joined`) | Covered |
| FR-2.6 | Facilitator explicitly starts session | SESSION-004 (`POST /start`) | Covered |
| FR-2.7 | Facilitator may reorder topics before starting | TOPIC-006 (`PUT /topics/order`) | Covered |
| FR-3.1 | Open/in-progress action items displayed before first topic | SESSION-004 response includes `actionItems`; VOTE-001 for reconnection | Covered |
| FR-3.2 | Action item owner can update status during pre-session review | VOTE-002 (`PATCH /action-items/:id/status`) | Covered |
| FR-3.3 | Status updates visible to all participants in real time | VOTE-002 Notes: WebSocket `actionitem.updated` broadcast | Covered |
| FR-3.4 | Facilitator (only) advances past pre-session review | SESSION-005 (`POST /begin-voting`, facilitator-only) | Covered |
| FR-3.5 | Clear indication if no open action items; facilitator can proceed immediately | SESSION-004 (`hasOpenItems: boolean`); SESSION-005 accepts any `pre_session` state | Covered |
| FR-4.1 | Facilitator controls all topic progression; no auto-advance | WebSocket `topic.advance`, Appendix D; OR-4.1/4.4 in Prohibited Behaviors | Covered |
| FR-4.2 | Votes recorded server-side; lock-in irreversible | WebSocket `vote.submit` (Appendix D); vote value never returned pre-reveal | Covered |
| FR-4.3 | Three vote types: finger (1–4), roman (up/down), modified roman (up/steady/down) | Vote type enum throughout; vote value encoding in Appendix A | Covered |
| FR-4.4 | Participant may change vote before lock-in | Vote selection is client-side; lock-in is irreversible per VOTE-002 notes | Covered |
| FR-4.5 | Facilitator sees readiness grid (names, not vote values) during voting | SESSION-002 (`readinessGrid` for facilitator only, `voting` phase); WebSocket `vote.locked` | Covered |
| FR-4.6 | Reveal triggered exclusively by facilitator; simultaneous delivery | WebSocket `reveal.trigger` (Appendix D); VOTE-003 (403 on pre-reveal access) | Covered |
| FR-4.6.1 | Reveal event must reach all clients within 15 seconds; payload includes server timestamp | WebSocket layer is outside this document's scope; server-timestamp field not documented on reveal event payload | **Partial** |
| FR-4.7 | Votes immutable after reveal | VOTE-003 (reads from PostgreSQL only; pre-reveal writes blocked) | Covered |
| FR-4.8 | Post-reveal aggregate summary (average, distribution) | SESSION-002, VOTE-003 (aggregate returned) | Covered |
| FR-4.9 | Facilitator may add discussion note after reveal | SESSION-009 (`PUT /discussion-note`) | Covered |
| FR-4.10 | Late joiners not retroactively added as voter for past topics | SESSION-003 Notes: `ON CONFLICT DO NOTHING`; vote data sourced from actual submitted rows | Covered |
| FR-5.1 | Automatic individual outlier detection after reveal (±1.5 threshold) | SESSION-002 (`isOutlier` on `RevealedVoteEntry`); VOTE-003 | Covered |
| FR-5.2 | Outlier threshold configurable by Application Admin; not a magic number | TREND-003 (GET), TREND-003b (PUT, admin-only); `application_settings` table | Covered |
| FR-5.3 | Team-level threshold override (PREF) | TREND-004 (`GET /teams/:teamId/outlier-threshold`) | Covered |
| FR-5.4 | Outlier flagged in facilitator view only | SESSION-002 (`isOutlier` on revealed votes); `readinessGrid` and vote values gated to facilitator | Covered |
| FR-5.5 | Facilitator decides whether to open discussion; no automatic discussion trigger | SESSION-010 (`PUT /flagged`, boolean, facilitator-only); no automatic state change | Covered |
| FR-5.6 | Outlier flag persists on session record and visible in history | SESSION-010 persists to `session_topics`; SESSION-008 includes `flaggedForDiscussion` | Covered |
| FR-6.1 | Facilitator advances to wrap-up after final topic; participants cannot trigger | SESSION-005 → topic advance chain → wrap-up; all transitions facilitator-only | Covered |
| FR-6.2 | Wrap-up screen presents all discussion notes for review and editing | SESSION-009 allows writes during `active` or `wrap_up`; SESSION-006 response implies wrap-up state | **Partial** |
| FR-6.3 | Facilitator creates action items during wrap-up; description and owner required | ACTION-001 (wrap-up only, description and ownerUserId required) | Covered |
| FR-6.4 | Action items may have optional due date (PREF) | Not present in ACTION-001 schema | **Missing** |
| FR-6.5 | Session remains mutable until facilitator explicitly confirms close | SESSION-006 (`POST /complete`, only from `wrap_up`) | Covered |
| FR-6.6 | Session read-only once confirmed closed | SESSION-006 Notes; SESSION-009 blocks on `complete` status | Covered |
| FR-6.7 | Post-close summary view for participants (PREF) | SESSION-008 serves completed session detail to participants | Covered |
| FR-7.1 | Action items never deleted; only resolved | ACTION-003 scoped to pre-close wrap-up items only; committed records remain protected | Covered |
| FR-7.1a | Pre-close deletion of wrap-up-created items permitted (BRD amendment 2026-03-15) | ACTION-003 (`DELETE /api/v1/sessions/:sessionId/action-items/:itemId`, wrap-up only) | Covered |
| FR-7.2 | Action item fields: id, description, owner, originating session, creation date, status, last-updated | ACTION-001 response, ACTION-004 response — all fields present | Covered |
| FR-7.3 | Owner can update status at any time, inside or outside of session | VOTE-002 permits engineer updates to own items with or without `sessionId` | Covered |
| FR-7.4 | Stale flag when item open/in-progress beyond threshold (default 2 sessions) | `stalenessLevel` in all action item responses; `application_settings.staleness_threshold_sessions` | Covered |
| FR-7.5 | Admins adjust staleness threshold globally or per team (PREF) | TREND-003b (global); per-team staleness override not implemented | **Partial** |
| FR-7.6 | Participant or EM can view full action item history for their team | ACTION-004, ACTION-005 accessible to participants and EMs | Covered |
| FR-8.1 | Default topic set ships and is maintainable by Application Admin | TEAM-001 (seeds defaults on team creation); TREND-003b admin-configurable settings | Covered |
| FR-8.2 | Facilitator or Admin can add/remove/reorder topics after first session | TOPIC-003, TOPIC-004, TOPIC-006; customization lock enforced | Covered |
| FR-8.3 | Historical vote data retained when topic removed | TOPIC-004 (soft-delete only; votes unaffected) | Covered |
| FR-8.4 | Removed topics labeled "Archived" in history views | TOPIC-002 (`archived` array), TREND-001 (`topicStatus: 'archived'`) | Covered |
| FR-8.5 | Warn and confirm before removing topic with open action items (PREF) | TOPIC-004 (confirmation flow via `requiresConfirmation` response) | Covered |
| FR-8.6 | Default topic set visible and restorable at any time | TOPIC-002 (`defaultTopicsNotActive` array), TOPIC-005 (restore endpoint) | Covered |
| FR-9.1 | Trend Dashboard accessible to participants, facilitators, EMs, admins | TREND-001 authorization covers all four roles | Covered |
| FR-9.2 | Per-topic aggregate score chart; default 6 sessions; expandable | TREND-001 (`sessionLimit` param, default 6), TREND-002 (full history) | Covered |
| FR-9.3 | Archived topics accessible via toggle with historical data (PREF) | TOPIC-002 and TREND-001 include archived topic data | Covered |
| FR-9.4 | Session History view; selecting session shows full detail | SESSION-007 (list), SESSION-008 (full detail) | Covered |
| FR-9.5 | EM sees anonymous vote distribution (counts per value); no individual attribution or per-voter rows (BRD revised 2026-03-15) | SESSION-008 (`EngManagerSessionTopic.voteDistribution`), VOTE-003 (`GetRevealedVotesResponseForEM.voteDistribution`) | Covered |
| FR-9.6 | Dashboard distinguishes sessions where trend outlier was flagged (PREF) | SESSION-008 has `flaggedForDiscussion`; trend outlier explicitly out of scope | Covered |
| FR-9.7 | Insufficient data: blank graph with "Insufficient data." text | TREND-001 (`insufficientData: boolean`), TREND-002 | Covered |

---

## Section 2 — Discrepancies and Issues

**1. ACTION-003 (Delete Action Item) — RESOLVED (2026-03-15)**

FR-7.1 was amended to add FR-7.1a, which permits deletion of action items created during the current wrap-up phase before session close. The BRD now explicitly supports ACTION-003 under this narrow exception. No change to the API contract endpoint is required. Implementation constraints added to ACTION-003 (see contract): the endpoint must return `409 Conflict` if the session status is not `wrap_up`, and no `action_item_history` entry is written for a pre-close deletion.

---

**2. TEAM-001 (Create Team) — RESOLVED (2026-03-15)**

Standalone team creation is now a first-class supported path per FR-1.7 (BRD amendment 2026-03-15). A team with no sessions is a valid state. The following changes were made to the API contract:

- TEAM-001 authorization expanded from `facilitator` only to `facilitator` or `engineering_manager`.
- TREND-005 zero-session response shape documented: all history fields return empty/null; the endpoint returns `200 OK` for zero-session teams.
- TEAM-001 notes updated to clarify the topic customization lock (FR-8.2) still applies to standalone-created teams: topics cannot be customized until after the first completed session.

---

**3. TEAM-005 / TEAM-006 authorization — RESOLVED (2026-03-15)**

Decision: `application_admin` and `engineering_manager` (own team only) may both manage team membership roles. FR-1.6 updated in the BRD to reflect joint authority.

Changes applied to the API contract:
- **TEAM-005**: Authorization updated to `application_admin` (any team) or `engineering_manager` (own team). EMs may only assign the `participant` role; assigning `engineering_manager` via TEAM-005 is rejected with `403` (that path requires admin via TEAM-006).
- **TEAM-006**: Authorization corrected from the incorrect `facilitator` to `application_admin` only. Establishing the EM-team relationship is a privileged action that cannot be self-granted or delegated to existing EMs.

---

**4. SESSION-008 EM vote data — RESOLVED (2026-03-15)**

FR-9.5 revised: EMs may see an anonymous vote distribution (counts per value) — this is an intentional product decision, not a relaxation of privacy. The distribution is a stronger anonymity guarantee than an anonymized per-row list because it eliminates ordering as an inference vector.

Changes applied:
- FR-9.5 in the BRD updated to explicitly permit anonymous distribution (count per value), and to prohibit per-voter rows in any form.
- Section 6.2 and FR-1.3 in the BRD updated for consistency.
- SESSION-008: `EngManagerVoteRecord` replaced with `EngManagerSessionTopic` which carries `voteDistribution: Array<{ voteValue, count }>`. The `votes` field is omitted entirely for EM callers. `isOutlier` is not present in EM responses; `flaggedForDiscussion` at the topic level serves as the EM-visible outlier signal.
- VOTE-003: EM response updated to the same `voteDistribution` shape.

---

**5. TOPIC-002 authorization / archived topic access — RESOLVED (2026-03-15)**

Decision: Option B — archived topic data for the trend dashboard is served exclusively by TREND-001, which already includes both active and archived topics in its `topics` array via `topicStatus: 'active' | 'archived'`. TOPIC-002 is narrowed to a topic configuration endpoint (facilitator + admin only). No authorization changes to TOPIC-002 are required.

Changes applied:
- TOPIC-002 description updated: removed trend dashboard use case; scope restricted to configuration screen only. Added explicit scope boundary note directing trend dashboard consumers to TREND-001.
- TOPIC-002 authorization updated: added `application_admin` as an additional allowed role (previously omitted).
- TREND-001 notes updated: archived topics are explicitly documented as included in the `topics` array; the archived-topic toggle is client-side filtering on the TREND-001 response.

---

**6. SESSION-009 phase guard — RESOLVED (2026-03-15)**

SESSION-009 now enforces a topic-phase guard. Permitted phases: `revealed`, `complete`. Rejected phases: `voting`, `waiting` → `409 Conflict`. Session-close lock (FR-6.6) checked first: `sessions.status = 'complete'` or `abandoned` → `409 Conflict`.

During `wrap_up`, all topics are in `complete` phase, so notes remain writable through the end of wrap-up — allowing the facilitator to capture details of any final conversation before closing the session. Notes lock only when the session is confirmed closed.

---

**7. FR-4.6.1 server timestamp on reveal event — RESOLVED (2026-03-15)**

The REST API contract is the wrong document for WebSocket payload specifications. A gap note has been added to Appendix D of the API contract, documenting the FR-4.6.1 requirement (server timestamp on `reveal.trigger`, 15-second delivery SLA, client-side latency logging) and explicitly requiring a dedicated WebSocket Specification document before the real-time layer is considered ready for implementation. See `todo.md` in the project root.

---

**8. VOTE-002 status transitions — RESOLVED (2026-03-15)**

Decision: directed transitions only. Permitted: `open` → `in_progress`, `open` → `resolved`, `in_progress` → `resolved`. Backward transitions and any change from `resolved` return `409 Conflict`. A recurring issue must be captured as a new action item.

Changes applied:
- FR-7.3 in the BRD updated to state the directed transition rule explicitly, including the rationale (recurring issues → new item).
- VOTE-002 description, `409` error row, and notes updated. A database-layer CHECK constraint is recommended as a secondary guard.
- No-op writes (same status) remain permitted for `open` and `in_progress` to reset the staleness clock; no-op writes on `resolved` are rejected since `resolved` is terminal.

---

## Section 3 — Open Questions Resolved

**OQ-1: Team join link vs. session join link — RESOLVED (2026-03-15)**

TEAM-004 removed from the API contract. SESSION-003 (session join link) is the sole entry mechanism. A non-member who follows the session join link is denied entry with an explanatory message per FR-2.4. Membership is managed by admins and EMs via TEAM-005/TEAM-006.

---

**OQ-2: The `sessions` table has no `annotation` column. A migration is required.**

Confirmed. The migration is needed and is consistent with the Trend Dashboard use cases and FR-9.4. The SA should review the migration before implementation.

---

**OQ-3: WebSocket event for delivering a discussion prompt to flagged participants.**

No such event is required. OR-4.5 explicitly states the application must not use visual treatment in the participant view that singles out individual voters. The discussion prompt, if it occurs, is a verbal exchange — not an application-delivered notification to the flagged participant.

---

**OQ-4: Project Trend computation algorithm is not specified.**

Confirmed gap. The BRD defines the Modified Roman vote type (FR-4.3) but provides no aggregation formula for the Project Trend indicator on the Trend Dashboard. Returning `null` is the correct fallback. The BA will produce a specification before the trend dashboard is implemented.

---

**OQ-5: ADR-007 restricts facilitator history access to active sessions, but OR-6.3 requires briefing without starting a session.**

OR-6.3 is clear and intentional — a facilitator must be able to prepare for a session without creating one. Where an architectural decision contradicts a functional requirement, the functional requirement governs. TREND-005 should be implemented per OR-6.3. ADR-007 needs to be revised or scoped to exclude the briefing endpoint. The FSE made the correct call.

---

**OQ-6: Authorization scope for role management — RESOLVED (2026-03-15)**

Decision: `application_admin` (any team) and `engineering_manager` (own team, participant role assignment only) may both manage team membership. TEAM-005 and TEAM-006 updated accordingly. FR-1.6 amended in the BRD.

---

**OQ-7: Character limits for annotations.**

- Topic annotations: 500 characters (consistent with other 500-character limits in the system).
- Session annotations: 60 characters (appropriate for a short label visible in session history list rows).

Both are confirmed.

---

**OQ-8: Whether description/owner edits during wrap-up are recorded in action item history.**

Description changes during wrap-up do not need to appear in `action_item_history` (item is not yet finalized). Owner changes during wrap-up should appear in the security audit log per SEC-13. The FSE's current approach (no product history for pre-close edits) is acceptable; the implementation team must ensure the security audit log captures ownership changes.

---

## Section 4 — Open Questions That Remain Open

**1. Role management authorization — RESOLVED (2026-03-15)**

Decision recorded. See Section 3, OQ-6 and Discrepancy 3.

**2. TEAM-004 — RESOLVED (2026-03-15)**

TEAM-004 removed. See OQ-1 in Section 3.

**3. Resolved action items — RESOLVED (2026-03-15)**

Decision: directed transitions only. See Discrepancy 8.

**4. Project Trend computation algorithm**

A genuine gap owned by the BA. A specification for how Modified Roman vote results are aggregated into the up/steady/down directional indicator is required before the trend dashboard is implemented.

**5. Session abandonment — partial session artifacts**

The API contract exposes an `abandoned` session status but does not specify what data is accessible from an abandoned session, or whether abandoned sessions appear in session history. Must be resolved before the abandonment flow is implemented.

**6. Action item ownership when a team member leaves**

VOTE-004 provides a reassignment endpoint, but the BRD does not authorize who can trigger it under what conditions, or whether removal of a member with open action items is blocked. The FSE's current implementation (facilitator-only reassignment, active session required) requires explicit BA confirmation.

---

## Section 5 — Overall Assessment

The API contract is structurally sound and demonstrates a thorough reading of the BRD. The endpoint groupings are logical, the authorization matrix is detailed, the persistence strategy is correctly documented, and the handling of the simultaneous reveal (via WebSocket, not REST) is architecturally correct and consistent with Section 6.1. The FSE correctly identified and escalated open questions rather than making unilateral decisions on ambiguous requirements.

There are, however, issues that must be resolved before this contract is ready for implementation. One is a hard-requirement violation: ACTION-003 contradicts FR-7.1 [HARD] and cannot proceed without a formal scope exception from the executive sponsor. One is a security-critical data-exposure defect: the EM variant of SESSION-008 returns individual vote values without attribution, which does not satisfy FR-9.5 [HARD]'s requirement for "aggregate scores only." These two items alone are sufficient to require a revision pass before implementation begins.

Additionally, TOPIC-002's authorization gap would prevent participants from accessing archived topic trend data they are entitled to see, and SESSION-009's missing phase-guard would allow discussion notes to be written before a reveal, violating the live session flow.

My recommendation: the FSE should not begin implementation of ACTION-003, SESSION-008's EM response shape, TEAM-004, or TEAM-005 until the blocking questions in Section 4 are resolved and the discrepancies above are corrected. The remaining 30-plus endpoints are sufficiently specified to proceed in parallel. I will schedule a working session to close the role management question, provide the Project Trend algorithm specification, and formally revise the BRD to address the action item deletion question.
