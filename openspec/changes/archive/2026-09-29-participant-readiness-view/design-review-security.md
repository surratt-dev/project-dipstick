# Security Review — `participant-readiness-view` design.md

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** `proposal.md`, `design.md`, `specs/participant-readiness-roster/spec.md`, `specs/session-participation/spec.md`, plus the actual current implementation these documents build on (`session-subscriber-access-helper.ts`, `sessions.ts`, `websocket-routes.ts`, `ws-event-dispatcher.ts`, `join-links.ts`, `facilitator-sessions.ts`) to check what "replicate exactly" and "same authorization grant" actually resolve to against running code, not just prose.
**Focus, per request:** authentication flows, data access boundaries, audit logging, threat-model impact, and — specifically — whether the D2/D7 registration-gap closure replicates the Engineering Manager exclusion check exactly.

## Summary

Design.md correctly identifies that D2 is an authorization-boundary change and correctly gates it behind a dedicated, blocking security review (task 1.4) before merge. That process discipline is right, and I have no objection to leaving the D2 mechanism choice open until implementation on that basis.

But I went and read the code the design tells implementers to replicate, and the thing it says to replicate exactly is itself missing a check. **The EM exclusion logic in `sessions.ts` that design.md and the session-participation spec both point to as the pattern to mirror does not verify the registering user is actually a member of the session's team.** It only checks that they are not an Engineering Manager. A non-member currently passes it. This is a pre-existing gap in `sessions.ts`, not something this change introduces — but this change is about to either (a) make that exact code path reachable from the frontend for the first time, or (b) build a new registration point that the design explicitly instructs to copy that code path's pattern. Either way, "replicate exactly" is the wrong instruction as currently worded, because the thing being replicated is incomplete. This is my primary finding and I'm rating it High — it must be resolved as part of task 1.2/1.3, and task 1.4's dedicated review must confirm the fix, not just confirm EM-exclusion parity.

Second finding, independent of D2/D7: the new roster REST fetch endpoint (D5) is specified as applying "the same authorization grant `evaluateSessionSubscriberAccess` applies... including the Engineering Manager exclusion," but this codebase has two different existing precedents for what "same grant" means for a facilitator-only view, and they contradict each other. If the wrong one gets followed, the roster — data this feature exists specifically to keep Facilitator-only — gets served to any Engineer who calls the endpoint directly. I'm rating this High as well, for the same reason as the first finding: it's a one-line difference between "server-enforced" and "UI-enforced," and UI-enforced is not a security boundary.

Both findings are fixable without reopening D1-D6's actual decisions — they're precision fixes to D2 and D5's wording and to tasks.md's acceptance criteria, not scope changes.

---

## Finding 1 (High): The EM-exclusion pattern design.md tells implementers to replicate does not check team membership exists

**Where:** `packages/backend/src/routes/sessions.ts:86-129` (POST `/api/v1/sessions/:sessionId/participants`) and again, identically, at `sessions.ts:233-279` (POST `.../lock-in`'s own role check).

Both handlers run this query to decide EM status:

```sql
SELECT u.global_role, tm.role AS membership_role
FROM users u
LEFT JOIN team_memberships tm
      ON tm.user_id = u.id AND tm.team_id = $2 AND tm.removed_at IS NULL
WHERE u.id = $1
```

and then reject only if `global_role === 'engineering_manager' || membership_role === 'engineering_manager'`.

Because the join is a `LEFT JOIN`, a user with **no** `team_memberships` row for this team at all gets `membership_role = null` — which is not `'engineering_manager'` — and **passes**. Nothing in either handler separately checks that a `team_memberships` row exists. `POST .../participants` will happily `INSERT INTO session_participants` for a user who is not, and never was, a member of the session's team, as long as they're authenticated and the session is `active`. `POST .../lock-in` has the identical gap in its own copy of the same query, and its participant check at `sessions.ts:281-296` only verifies a `session_participants` row exists for `(sessionId, userId)` — it does not check team membership either. So a non-member who acquires a `session_participants` row can vote in a session for a team they don't belong to.

Contrast this with the helper this feature's own read path relies on, `evaluateSessionSubscriberAccess` (`packages/backend/src/auth/session-subscriber-access-helper.ts:155-161`), whose Path 1 requires **all** of:
```
row.participant_row_id !== null &&
row.membership_exists &&
row.membership_removed_at === null &&
row.global_role !== "engineering_manager" &&
row.membership_role !== "engineering_manager"
```
`membership_exists` is checked there. It is not checked in `sessions.ts`. The read side (who gets live events) is stricter than the write side (who gets registered) — an inversion that shouldn't exist.

**Why this matters now, specifically:** today `POST .../participants` has zero frontend callers (per proposal.md), so this gap is dormant — reachable only by a direct authenticated API call, not through the UI. Design.md's D2 is about to change that in one of two ways:
- **Option 2** relaxes this exact endpoint's status gate and adds a frontend caller — making the dormant gap live, reachable from the UI for the first time, for a status (`lobby`) where a first-time joiner's identity is least verified.
- **Option 1** (auto-upsert at WS-connect/join-redemption) is instructed by design.md and the session-participation spec to "replicate the Engineering Manager exclusion check exactly" — exactly meaning: as implemented in `sessions.ts`. If implemented literally as instructed, it inherits the same missing membership check, becoming a *new* code path with the *same* gap, at a moment when it's specifically being reviewed for correctness.

**Impact if uncorrected:** any authenticated user — including one who belongs to no relevant team, or belongs to a different team entirely — could register a `session_participants` row for any session whose ID they can obtain, appear in the Facilitator's roster (this feature's own output), and — via the existing `lock-in` gap — submit votes in a team's session they have no legitimate standing in. That's a cross-team data-integrity and confidentiality issue (estimation data is not meant to cross team boundaries) surfacing through the exact feature meant to give the Facilitator visibility into "who's here."

**Required fix:** wherever D2's chosen mechanism performs its EM-exclusion check, it must also require `membership_exists && removed_at IS NULL` for the session's team — i.e., replicate `evaluateSessionSubscriberAccess` Path 1's full condition set, not `sessions.ts`'s current (incomplete) query. I'd go further and recommend fixing `sessions.ts:86-129` and `sessions.ts:233-279`'s own queries at the same time, since D2 already requires touching this exact area and leaving the pre-existing gap in place while adding a security review specifically to this code invites the finding being rediscovered independently later.

**Where this should land:** design.md D2's "must replicate the dual-check EM-exclusion pattern... exactly" sentence should be corrected to say *membership + EM-exclusion*, not EM-exclusion alone. tasks.md 1.3 and 1.5 should add an explicit test: a user with no `team_memberships` row for the session's team is rejected at registration (currently absent from the 1.5 list, which only calls out the EM cases). Task 1.4's dedicated security review should treat this as an explicit checklist item, not something folded silently into "replicate exactly."

---

## Finding 2 (High): The new roster REST fetch endpoint's caller-side authorization is underspecified, and this codebase has two contradictory precedents for it

**Where:** design.md Decision D5; `specs/participant-readiness-roster/spec.md`, "The roster's initial fetch is authorized identically to session-scoped WebSocket access."

D5's stated authorization rule: the endpoint "applies the same EM-exclusion filter `evaluateSessionSubscriberAccess` Path 1 applies... the read side and the write side of 'who's a valid participant' must agree." The spec requirement says the same thing: response includes "only participants who would be granted session-scoped WebSocket access under `evaluateSessionSubscriberAccess`."

Read literally, both of these are about **which rows appear in the roster** (filtering out an EM who somehow has a row). Neither explicitly states the separate, more basic requirement: **who is allowed to call this endpoint at all.** The roster's first and most fundamental requirement (spec.md, "The roster is Facilitator-only") is that Engineers get no names, no count, nothing — but nothing in D5 or the spec says the endpoint must reject a caller whose own `evaluateSessionSubscriberAccess` grant is `path: 'participant'` rather than `path: 'facilitator'`.

This ambiguity is not hypothetical — this codebase already contains both a right and a wrong pattern to copy from, in the same authorization helper's two consumers:

- **Wrong-for-this-feature precedent:** `GET /api/v1/sessions/:sessionId/action-items-review` (`packages/backend/src/routes/facilitator-sessions.ts:969-1018`) calls `evaluateSessionSubscriberAccess`, accepts **both** `facilitator` and `participant` grants, and differentiates only by including an `isFacilitator` boolean in the response body for the frontend to act on (`facilitator-sessions.ts:990,1007,1016`). This is intentional and correct for that endpoint — action items are legitimately shared content. It is the literal next-door neighbor to where the new roster endpoint will likely be added, same file, same helper, same handler shape. An implementer moving fast and pattern-matching to the adjacent, already-working handler would naturally copy this shape.
- **Right-for-this-feature precedent:** `dispatchParticipantJoined` / `dispatchParticipantLeft` (`packages/backend/src/realtime/ws-event-dispatcher.ts:310-354`) — the *existing, shipped* delivery logic for the exact same data this roster reflects — explicitly checks `grant?.path === "facilitator"` and delivers to no one else. This is the correct model for this feature, and it's the one D5 needs to point to by name.

If the roster fetch endpoint is built on the first precedent instead of the second, the result is a facilitator-only feature whose backend serves the full participant list — names — to any Engineer who inspects the network tab or calls the endpoint directly with their own valid, unmodified session cookie. No privilege escalation needed; they already hold a legitimate `participant` grant for the session they're sitting in. This is precisely the "the frontend doesn't render it, but the API still returns it" failure mode.

**Required fix:** D5 should say explicitly: *reject any request where the caller's `evaluateSessionSubscriberAccess` grant is not `path: 'facilitator'`* (403/404, disclosure-blind, matching the null-grant handling convention already established at `facilitator-sessions.ts:978-988` and `sessions.ts:439-448`) — citing `ws-event-dispatcher.ts`'s `grant?.path === "facilitator"` check as the pattern to mirror, not `action-items-review`'s dual-audience pattern. tasks.md 2.3's test list ("roster excludes a user who would fail session-subscriber authorization") should be split into two explicit cases: an EM who somehow has a row (content-filtering, D5's original framing) **and** a legitimately-registered Engineer participant calling the endpoint directly (caller-authorization, this finding) — those are different failure modes and a test suite that only covers the first could pass while this gap ships.

---

## Finding 3 (Medium): No audit logging is specified for the new registration point, and none exists today at the endpoint being extended

**Where:** `sessions.ts:40-145` (POST `.../participants`) currently writes no `audit_log` row and calls `emitAuditEvent` nowhere in that handler — on success or on EM rejection. Compare this to its neighbors in the same file and area, which all audit both outcomes: `lock-in`'s vote submission (`sessions.ts:357-369`, `session.vote_submitted`), and join-link redemption/rejection (`join-links.ts:104-108, 125-129, 179-184, 193-200`, `join.link_redeemed` / `join.link_rejected`).

This is a pre-existing gap, not introduced by this change — but D2/D7 is the moment to close it, not defer it further. Whichever mechanism is chosen is a new or newly-reachable admission point onto the no-manager rule's most visible surface. An EM's registration attempt being *rejected* is itself a security-relevant event worth a durable record — it turns "an EM tried repeatedly" from invisible into detectable.

**Recommendation:** task 1.3/1.4 should require an `audit_log` row at the new registration point, at minimum on EM-rejection (e.g. `session.participant_registration_rejected`), following the exact `join.link_redeemed`/`join.link_rejected` transactional pattern already established in `join-links.ts` (INSERT + audit row in one transaction, `emitAuditEvent` fired only after commit). Auditing successful registration too would bring this in line with every other participation-affecting write in this codebase and is worth doing in the same pass rather than as a follow-up.

---

## Finding 4 (Low): Disclosure-blind / timing-floor conventions aren't mentioned for the new roster endpoint

`GET .../action-items-review` applies `applyTimingFloor()` and `Cache-Control: no-store` on every response path (success, 404, 409) as a stated design requirement carried over from that capability's own security review (`facilitator-sessions.ts:964-967`). The new roster fetch endpoint is materially the same shape — a facilitator-sensitive, session-scoped GET — but D5 doesn't mention either convention. Recommend explicitly extending both to the new endpoint rather than leaving them to be independently rediscovered (or missed) during implementation.

---

## Reviewed and accepted, no action needed

- **D3's multi-tab presence edge case** (a closed second tab marking a still-present participant disconnected until self-correction) is a UX/data-freshness accuracy question, not a security boundary — no participant identity or data crosses an access boundary it shouldn't. Correctly scoped as an accepted v1 limitation.
- **D2's decision to defer the exact mechanism past design.md**, gated on a blocking, dedicated security review (tasks.md 1.4) separate from general code review, is the right process. My findings above are inputs to that review, not an objection to deferring the choice itself.
- **`evaluateSessionSubscriberAccess`'s own cache prohibition and live-DB-read requirement** (Decision 6, inherited) is correctly stated and, on inspection of the actual helper, correctly implemented — no caching of the grant result anywhere in its call sites I checked (`websocket-routes.ts`, `ws-event-dispatcher.ts`, `facilitator-sessions.ts`, `sessions.ts`).

---

## Verdict

Not a blocker on design.md proceeding to implementation as a whole — D1, D3, D4, D6 are sound and don't touch authorization surface. But **Findings 1 and 2 must be resolved as explicit corrections to D2 and D5's wording, and as explicit line items in tasks.md's Group 1 and Group 2 test lists,** before task 1.4's dedicated security review can be considered satisfied. Task 1.4 should not sign off on "replicated the EM exclusion check exactly" without also confirming team-membership is checked (Finding 1), and should not sign off on the roster fetch endpoint without confirming it rejects non-facilitator callers server-side (Finding 2), independent of whatever the response body's content-filtering does.
