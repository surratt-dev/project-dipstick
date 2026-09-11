# Security Review — `actionitem-updated-live-broadcast`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewed:** `design.md`, `proposal.md`, `specs/action-item-status-management/spec.md`, `specs/websocket-specification/spec.md`
**Also consulted (for precedent, not part of this change):** `requirements/design/REST API Contract.md` (VOTE-002), `packages/backend/src/auth/team-content-access-helper.ts`, `packages/backend/src/auth/session-subscriber-access-helper.ts`, `packages/backend/src/realtime/ws-event-dispatcher.ts`, `packages/backend/src/realtime/connection-reauthorization.ts`, `packages/backend/src/routes/content.ts`, `packages/backend/src/routes/teams.ts`, `packages/backend/src/routes/sessions.ts`, `packages/backend/src/routes/facilitator-sessions.ts`, `packages/backend/migrations/2_create_tables.sql`, `packages/backend/migrations/8_audit_log.sql`

## Overall assessment

This design is well-run for what it says explicitly — it follows the WebSocket catalog's conventions (typed event, `ws:events` envelope, publish-after-commit, conformance test as a forcing function) and correctly reuses `evaluateSessionSubscriberAccess` for the broadcast's per-candidate delivery authorization rather than inventing a new check. I have no finding against the WebSocket delivery *mechanism* as designed.

My findings are almost entirely about the **REST mutation's authorization boundary and audit trail** — the part of this change the proposal itself calls "the larger and more valuable half." Three of my five findings (F1–F3) are not covered by any of the three Open Questions the design already flags for the architect. That matters: the design frames OQ1–OQ3 as the outstanding security-shaped decisions, with VOTE-002 supplying a ratify-or-override default for each. F1–F3 are gaps *in addition to* those three, and none of them has a stated secure-by-default fallback anywhere in this document. I'm flagging them now, before implementation, rather than at pre-production review, because two of them (F1, F2) are the kind of thing that's cheap to get right in the first implementation and expensive to retrofit once an endpoint is shipped and other code starts depending on its exact response shape.

---

## F1 — HIGH: Open Question 1's "active session" formulation risks silently widening if the natural implementation reuses `evaluateTeamAccess`

**Where:** Open Question 1 (facilitator authorization scope), D2's rationale, `websocket-specification`'s Requirement text.

The design frames Open Question 1 as choosing among three *textual* formulations of facilitator scope (UC-narrow, standing-grant, VOTE-002's "active session exists"). It doesn't name which existing authorization helper the implementation should call to enforce whichever formulation is chosen — and that matters more than the choice of wording, because this codebase already has a facilitator-authorization helper with a specific, documented shape: `evaluateTeamAccess`'s Path 3 (`team-content-access-helper.ts:38-46, 143-194`):

```
sessions.facilitator_id = userId AND sessions.team_id = teamId
AND (
  status IN ('lobby', 'pre_session', 'active', 'wrap_up')
  OR (status = 'draft' AND created_at + INTERVAL '24 hours' > NOW())
  OR (status = 'complete' AND facilitator_access_expires_at > NOW())
)
```

That's the function every other REST endpoint reaches for to answer "is this user the facilitator of this team," and the codebase's own convention (stated explicitly in `session-subscriber-access-helper.ts:10-19`) is to reuse existing authorization helpers rather than write a third implementation of the same check. If an implementer does the natural, DRY thing and calls `evaluateTeamAccess` for this PATCH endpoint's facilitator path, they inherit **two grace windows beyond "a session is actively running right now"**: a facilitator whose session for that team is sitting in `draft` (created but never started) gets write access to the team's action items for 24 hours, and a facilitator whose session already ended gets it again for the `facilitator_access_expires_at` grace window after completion.

That's a materially broader grant than VOTE-002's own text ("actively facilitating (active session exists)") reads as, and it's exactly the "standing write access to another team's action-item backlog independent of actively running a session" risk the design's own Risks section names as the thing to avoid in the worst case. `evaluateTeamAccess`'s grace windows exist for a defensible reason — they're read-content windows (a facilitator reviewing what happened in a session that just ended), not a reason to extend a *write* endpoint's authorization boundary.

**Recommendation:** whichever of the three formulations the architect ratifies, state explicitly in the decision that this endpoint's facilitator-authorization check is **not** a call to `evaluateTeamAccess` verbatim. If VOTE-002's formulation is ratified, its "active session exists" condition should map to something closer to `session-subscriber-access-helper.ts`'s `LIVE_FACILITATOR_STATUSES` (`lobby`, `pre_session`, `active`, `wrap_up` — no draft, no complete-grace) than to `evaluateTeamAccess`'s full read-access condition set. This is a one-line clarification in the design, but it's the difference between the narrow reading everyone says they want and the standing-grant reading everyone says they want to avoid.

---

## F2 — HIGH: The documented 403/404 split reintroduces an enumeration oracle this codebase has already engineered around once

**Where:** `action-item-status-management/spec.md`'s two rejection scenarios ("non-owner, non-facilitator... 403", implicit 404 for nonexistent item via VOTE-002's error table); VOTE-002's error table (`403` for "not owner", `404` for "does not exist").

`content.ts` has an explicit, commented precedent for exactly this shape of endpoint (item-scoped, not just team-scoped, authorization) and deliberately does **not** let resource-existence and authorization-failure produce distinguishable responses for a caller outside the resource's team:

> "Decision 7 / Blocking Issue 2: filter by BOTH id AND team_id so that a session belonging to a different team returns the same 404 as a session that does not exist anywhere. Without team_id = $2, an authorized Team A member could probe whether a Team B UUID exists by observing 403 vs 404." (`content.ts:523-526`)

The load-bearing detail there is the *ordering*: `content.ts` checks team-level authorization first (`grant === null` → 403, before any query touches the target resource), and only for a caller who already has *some* relationship to the team does it then distinguish 404 (genuinely missing, or belongs to a different team — deliberately made indistinguishable) from success.

Neither `design.md` nor the spec delta states this ordering for the new endpoint. VOTE-002's error table lists 403 ("not owner") and 404 ("does not exist") as flat, independent rows, which is exactly the shape that produces an oracle if implemented as "look up the action item by ID first (404 if no row), then check ownership/facilitator scope (403 if found)": **any authenticated user in the system, regardless of team, could distinguish "this actionItemId exists" from "it doesn't" by watching 403 vs. 404** — with no team-membership check gating that distinction at all, which is a strictly worse version of the exact probe `content.ts` was written to close off.

**Recommendation:** state explicitly that this endpoint follows `content.ts`'s ordering — resolve the caller's authorization relationship to the item's *team* first (owner-of-item check requires loading the item, but the "does this user have any standing here at all" check should not depend on whether the item exists), and collapse "item doesn't exist" with "item exists but belongs to a team this user has zero relationship to" into the same 404, the same way session IDs are already handled. Only once a caller has some relationship to the team should not-owner/not-facilitator produce a distinguishable 403. `content.ts` also applies a timing floor on denial paths for the same reason (`applyTimingFloor`, cited near the enumeration comment) — worth the same consideration here if the lookup-then-check ordering can't fully avoid a timing difference.

---

## F3 — HIGH: No `audit_log` write is planned — `action_item_history` is a domain record, not this codebase's security audit trail

**Where:** D5 ("`action_item_history` contract for this change"), Migration Plan, Impact section — none mention `audit_log` (the table, `packages/backend/migrations/8_audit_log.sql`) or a new `AuditEventName`.

D5 treats `action_item_history` as *the* audit trail for this mutation, and on its own terms it's well-designed — same-transaction write, correct actor attribution, atomic with the status update. But it is not the same thing as this application's security audit log, and every other sensitive write path in this codebase writes to both:

- `teams.ts` (role changes): `INSERT INTO audit_log (...)` in the same transaction as the `team_memberships` update, plus `emitAuditEvent(..., "team.role_changed", ...)` (`teams.ts:546-568`).
- `sessions.ts` (vote submission): same pattern, `"session.vote_submitted"` (`sessions.ts:299, 358-380`).
- `facilitator-sessions.ts` (reveal): `recordRevealTriggeredAudit`, same pattern, `"session.reveal_triggered"`.
- `connection-reauthorization.ts` (SEC-25/27 live access revocation): same pattern, `"session.access_revoked_live"` — added, per that file's own comment, specifically because "a SEC-25 revocation close is a genuine, security-relevant event... not only the `emitAuditEvent` structured log."

The distinction that last example makes is the one that applies here: `action_item_history` is read back by ordinary application users through `content.ts`/`em-views.ts` — it's a *business* record ("who resolved this and when"), not an access-controlled security record. It carries no `actor_global_role` and no `actor_ip`, both of which `audit_log`'s schema exists specifically to hold (`8_audit_log.sql:29-34`) and both of which matter if this endpoint's authorization boundary is ever the subject of an incident review — e.g., "did a facilitator use the grace-window gap in F1 to modify another team's backlog, and from what IP, under what claimed role." A row in `action_item_history` alone can't answer that; a row in `audit_log` can, because that's the table every other authorization-sensitive write in this system reports to.

**Recommendation:** add a new `AuditEventName` (e.g. `action_item.status_changed`) and an `INSERT INTO audit_log` in the same transaction as the `action_items.status` / `action_item_history` writes, following the `team.role_changed` / `session.vote_submitted` shape exactly (`actor_user_id`, `actor_global_role`, `actor_ip`, `operation`, `team_id`, `metadata` carrying at minimum `action_item_id`, `previous_status`, `new_status`, and whether the actor took the owner or facilitator authorization path — the metadata should make F1's boundary auditable after the fact even if it's never exercised maliciously). This is a small addition and it's the one this persona will not accept "the domain history table covers it" as a substitute for, per this codebase's own established pattern.

---

## F4 — MEDIUM: Open Question 2 and D7 are in tension, and the design doesn't state which wins

**Where:** Open Question 2 ("session-context plumbing"), D7 ("mutation success is never coupled to broadcast success").

VOTE-002's error table asserts `403` for "facilitator attempting to update outside an active session context" — that's an *authorization*-layer rejection: no valid session context, no facilitator authority, full stop. D7 states a general principle that a missing or invalid session context "only ever affects whether the broadcast fires — never whether the PATCH succeeds." Open Question 2 names this exact tension but doesn't resolve it, and leaves it to the architect without stating which reading is the secure default in the meantime.

The risk if this ships ambiguous: D7's framing is broad and easy to over-apply. If an implementer reads D7 as "session context is never blocking" and applies that uniformly, a facilitator PATCH with no valid `sessionId` would succeed on authorization grounds alone — which quietly converts whichever narrow formulation Open Question 1 settles on back into something closer to the standing-grant reading everyone is trying to avoid, because the one thing tying facilitator authority to "a session is actually happening" (the session-context check) would have been reclassified as merely a broadcast concern.

**Recommendation:** state explicitly, ahead of the architect's ratification, that these are two different failure domains and D7 does not extend to the facilitator authorization check: session-context *validation for the facilitator authorization path* happens before and independently of D7's broadcast-is-best-effort carve-out, which only applies once authorization has already passed. An owner acting on their own item is unaffected either way (VOTE-002 doesn't require session context for the owner path). This should be a sentence added to D7 or Open Question 2, not left for the architect to infer from the tension the design itself identified but didn't close.

---

## F5 — LOW / INFORMATIONAL: Consider a delivery-time re-check of `pre_session` status, not only a publish-time gate

**Where:** D2 ("gated to `pre_session`"), the new `websocket-specification` Requirement ("Delivery is gated to sessions in `pre_session` status").

The existing dispatcher discipline for `vote_readiness_update` doesn't stop at "the grant exists" — it re-checks `grant.sessionStatus` per-candidate, at delivery time, immediately before `.send()` (`ws-event-dispatcher.ts:138-142`). The design's language for this new event ("gated to `pre_session`") doesn't say whether that gating is enforced only at publish time (the triggering mutation checks current session status before calling the publish wrapper) or also re-checked per-candidate inside the new dispatch case, the way `vote_readiness_update` does.

This is a narrow race window — a session leaving `pre_session` in the instant between a status-change publish and delivery — and the information at stake (a status transition on a team's own action item) is not highly sensitive relative to what the recipient is already authorized to see. I'm not blocking on it, but it's a one-line inconsistency worth closing given the header comment in `ws-event-dispatcher.ts` states the per-candidate, every-single-time discipline as "the tell in code review" for a regression here. Recommend the new dispatch case re-check `grant.sessionStatus === 'pre_session'` the same way `vote_readiness_update` does, rather than trusting publish-time gating alone.

---

## Positive notes (no action needed)

- **D4's payload minimalism** (no `resolutionNote`, no `resolvedInSessionId` on the wire event) is the right call and matches this catalog's existing data-classification discipline (`VoteReadinessUpdatePayload` never carrying a vote value is the precedent). A resolution note can contain free-text team commentary that doesn't need to fan out to every session connection the instant it's written; keeping it behind the authenticated re-fetch path is correct.
- **D8's non-spotlight constraints** bind the payload/event contract now, ahead of #69's build — this is good practice independent of security, but it also reduces the chance a later UI implementation adds client-side caching or local state that outlives the authorization that justified receiving the event in the first place.
- **Reuse of `evaluateSessionSubscriberAccess` for broadcast delivery** (rather than a new helper) is exactly the pattern this codebase's own comments call for, and it's the correct authorization surface for this event's recipient set.

---

## Summary for the architect

Three findings (F1–F3) sit outside the three Open Questions this design already flags, and none has a stated secure-by-default fallback:

1. Don't let the facilitator-authorization implementation reach for `evaluateTeamAccess` unmodified — its grace windows are broader than "active session" and would widen this endpoint's write access beyond what any of the three OQ1 formulations intend.
2. Resolve the item's team-authorization relationship before distinguishing 403 from 404, mirroring `content.ts`'s already-established anti-enumeration ordering — the current error table, read literally, reopens a probe this codebase closed once already.
3. Add an `audit_log` row (new `AuditEventName`) alongside `action_item_history` — the latter is a business record, not this application's security audit trail, and every other sensitive mutation in this codebase writes both.

F4 asks the design to state explicitly that D7's "broadcast never blocks the mutation" principle does not also mean "session-context validation never blocks a facilitator's authorization" — those are being treated as the same kind of leniency when they're not. F5 is a minor consistency recommendation, not a blocker.

None of this is a case for slowing the change down structurally — the mutation, the transition rules, and the broadcast delivery mechanism are all sound. These are boundary-precision issues in exactly the two places (facilitator scope, error-response shape) that are hardest to fix once client code and this endpoint's own documentation have settled around whatever ships first.
