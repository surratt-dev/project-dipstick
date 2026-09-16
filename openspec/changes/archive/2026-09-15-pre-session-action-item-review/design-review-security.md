# Security Review — `pre-session-action-item-review`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewed:** `design.md`, `proposal.md`, `specs/pre-session-action-item-review/spec.md`, `tasks.md`
**Also consulted (for precedent, not part of this change):** `packages/backend/src/auth/session-subscriber-access-helper.ts`, `packages/backend/src/routes/facilitator-sessions.ts`, `packages/backend/src/routes/content.ts`, `packages/backend/src/routes/action-items.ts`, `packages/backend/src/routes/em-views.ts`, `packages/backend/src/content/timing-oracle.ts`, `packages/backend/src/realtime/connection-reauthorization.ts`, `packages/backend/src/auth/audit-logger.ts`

## Overall assessment

This is a narrow, disciplined design — it correctly refuses to write a second authorization check, correctly derives `teamId` server-side from the grant rather than trusting a caller-supplied value, and correctly treats `begin-voting`'s existing `facilitator_id` enforcement as the real backstop behind the `isFacilitator` rendering signal. I verified each of those claims directly against the code, not just the prose, and they hold. The EM-exclusion guarantee this screen inherits is real, not aspirational (see Positive notes).

My findings are about what the design is silent on, not what it gets wrong. `evaluateSessionSubscriberAccess` has, until now, only ever been called from the WebSocket layer, where a different set of defensive controls apply (periodic re-authorization sweeps, delivery-time re-checks). This change is the **first HTTP route** to call it. Two controls this codebase applies to every other authorization-boundary HTTP endpoint that touches team/session content — a timing floor and `Cache-Control: no-store` — go unmentioned here, and neither is a stylistic nicety in this codebase; both were added in response to named findings on sibling endpoints. Nothing below blocks the design structurally. All four findings are cheap to close now and are exactly the kind of thing that's annoying to retrofit once a response shape and a frontend depend on it.

---

## F1 — MEDIUM: No timing floor on the new GET endpoint, despite three response paths with different query-cost profiles

**Where:** Decision 1 (handler flow), Decision 2, Risks/Trade-offs' `409` vs `404` entry; `spec.md`'s 404/409 scenarios.

Every existing HTTP endpoint that branches on the result of a live-DB-read authorization helper applies `applyTimingFloor()` (`packages/backend/src/content/timing-oracle.ts`) on **every** response path, success and denial alike — `content.ts` (`evaluateTeamAccess`), `em-views.ts`, and `action-items.ts` all do this, and `content.ts`'s own header comment names the reason: "Timing floor... to prevent timing-oracle attacks." This new endpoint is the first to build an authorization boundary on `evaluateSessionSubscriberAccess` at the HTTP layer, and the design doesn't mention timing at all.

The three outcomes here have genuinely different cost:
- `null` grant → `404`: one query (the helper's own).
- Grant exists, wrong status → `409`: the helper's query, plus Decision 1 step 2's separate `sessions.status` read.
- Grant exists, `pre_session` → `200`: both of the above, plus `fetchPreSessionActionItems`'s two queries (threshold lookup + item join).

The design's own Risks section already accepts that `409` vs `404` leaks "session exists but wrong status" vs "no access at all," and reasons that's low severity because the caller must already be authenticated. I agree with that reasoning as far as it goes — but a timing side channel doesn't require the response body or status code to differ at all. It's the same authorization boundary that motivated the timing floor everywhere else, and an authenticated-but-unauthorized caller (e.g., a facilitator or participant probing a session ID belonging to a different team, or an EM probing their own team's session) could use response latency to distinguish these three cases even if the status codes were made identical.

**Recommendation:** apply `applyTimingFloor()` to this endpoint the same way `content.ts` does — start the clock at handler entry, float every response path (including the `404` and `409`) to a fixed minimum. This is a copy of an existing pattern, not new design work.

---

## F2 — MEDIUM: No `Cache-Control: no-store` on the response

**Where:** Decision 1 (response shape), `spec.md`'s response requirements.

`content.ts` and `em-views.ts` both apply `Cache-Control: no-store` to every response they send, specifically because their payloads carry team/session content — action item descriptions, owner names, statuses — that shouldn't be cached by a browser, a corporate proxy, or a shared-machine disk cache. `em-views.ts`'s comment frames this as blanket, scope-level policy ("ALL handlers apply Cache-Control: no-store"), not a per-endpoint judgment call.

This new endpoint returns the same class of data (`ownerDisplayName`, `description`, `status`, per-item staleness) to a broader audience than the facilitator-only `POST /start` response it's meant to parallel, and the design doesn't mention response headers at all.

**Recommendation:** add the header, matching `content.ts`'s pattern. One line in the handler, one line added to Decision 1 or the spec so it isn't left to whoever implements task 3.4 to notice on their own.

---

## F3 — LOW: Decision 1's separate `sessions.status` read reopens the exact TOCTOU gap the helper's single-query design states it avoids

**Where:** Decision 1 step 2; Risks/Trade-offs' last bullet ("One additional DB read per GET call").

`session-subscriber-access-helper.ts`'s own header comment is explicit about why it's a single query: *"the authorization decision is made on a consistent snapshot (no TOCTOU gap between separate reads)."* The query already selects `s.status AS session_status` for every row — it's simply discarded when building the `participant` grant variant, which is why Decision 1 needs a second, separate read to get it back.

That second read is a genuine (if narrow) reintroduction of the gap the helper was built to close: authorization is evaluated against one snapshot, and the `pre_session` gate is evaluated against a possibly-later one. The design's Risks section already names this as an accepted trade-off, but frames it purely as a performance cost ("one additional DB read... Accepted"), not as a re-opening of a TOCTOU property the sibling module's own documentation treats as a design goal worth a single query to preserve.

The practical impact is low: this is a read-only endpoint, the race window is milliseconds, and the worst outcome is a participant briefly seeing `pre_session` data for a session that transitioned to `active` a moment earlier — not unauthorized data exposure, since the caller was already authorized at the moment the helper ran. I'm not asking for a redesign.

**Recommendation:** either (a) have the `participant` grant variant also carry `sessionStatus` — cheap, restores single-query consistency, removes the extra read Decision 1 currently pays for — or (b) keep the two-read design but add one sentence acknowledging this reopens the helper's stated TOCTOU guarantee, not just an efficiency question, so a future reader of `session-subscriber-access-helper.ts` doesn't assume every caller gets the consistent-snapshot property its own comment promises.

---

## F4 — LOW / INFORMATIONAL: Audit logging for this endpoint is unaddressed — confirm the omission is deliberate, not overlooked

**Where:** Decision 1; no mention in Impact or tasks.md.

I checked whether this is actually a gap. It isn't, by existing precedent: `content.ts`'s ordinary `member`/`facilitator` reads are **not** written to `audit_log` — only the `admin`-path denial is (`admin.session_content_denied`), because `evaluateTeamAccess` has an admin path that has no legitimate claim to session content and denial of it is the security-relevant event worth recording. `evaluateSessionSubscriberAccess` has no admin path at all, and structurally excludes EMs at the query level rather than via a post-hoc denial branch — so there's no analogous "elevated role got denied" case here to audit the way `content.ts` does.

That said, this codebase does audit action-item *reads* specifically when the reader is an EM viewing across the normal boundary (`em.action_items_accessed`, `em.action_item_accessed` in `audit-logger.ts`) — action item data is treated as sensitive enough to log access to it in at least one path already. This design doesn't discuss that precedent or explain why it doesn't apply here (it doesn't — EMs get `404`, not a read), but the reasoning should be stated rather than left for a reviewer to reconstruct, per the standard this project has otherwise held itself to (e.g. Decision 7's alternatives-considered treatment).

**Recommendation:** no code change requested. Add one sentence to Decision 1 or the Impact section stating explicitly that ordinary authorized reads through this endpoint are not audit-logged, consistent with `content.ts`'s precedent, and that this is deliberate rather than an oversight.

---

## Positive notes (no action needed)

- **EM exclusion is real, not just documented.** I read `session-subscriber-access-helper.ts` directly: the `participant` path rejects if either `users.global_role` or `team_memberships.role` is `engineering_manager`, and there is no third `admin`-equivalent path. An EM has no route to this endpoint's data. Confirmed.
- **`begin-voting`'s server-side facilitator check is real.** `facilitator-sessions.ts`'s `POST /begin-voting` handler independently checks `sessionRow.facilitator_id !== session.userId` → `403`, regardless of what `isFacilitator` the client was told. Decision 4's claim that a client-side bypass of the rendering signal "is not a security hole" is correct as written.
- **No IDOR surface on `teamId`.** `fetchPreSessionActionItems` is called with `grant.teamId` — derived server-side from the session row inside the authorization helper — never a caller-supplied value. There's no path for a caller to request one session's grant and another team's action items.
- **The WebSocket re-authorization concern I'd normally raise here is already solved upstream.** This screen subscribes to the existing `session_state_change` event over the session's WebSocket channel, which already goes through `websocket-connection-reauthorization`'s periodic sweep (`connection-reauthorization.ts`, every 5 minutes, `evaluateSessionSubscriberAccess` re-run per connection, with its own `audit_log` write on revocation). This change adds no new long-lived connection and doesn't need to re-solve that problem; it correctly rides on infrastructure that already exists for exactly this reason.
- **The `404`-vs-`409` gating (Decision 2) follows established precedent** (`session-topic-lifecycle`'s `already_revealed`/`advance_blocked` split — authorization before precondition, precondition failures get their own status). I agree with the design's own low-severity assessment of the residual information leak this creates, independent of F1's timing concern.
- **Decision 7's staleness-mapping fix has no authorization or data-exposure surface** — it changes a color computation, not who can see what. Out of my scope, correctly reasoned in the design.

---

## Summary for the architect

Four findings, none structural:

1. **F1 (MEDIUM):** Add `applyTimingFloor()` to the new endpoint — it's the first HTTP consumer of `evaluateSessionSubscriberAccess`, and every sibling content endpoint applies this control at exactly this kind of authorization boundary.
2. **F2 (MEDIUM):** Add `Cache-Control: no-store` to the response — matches `content.ts`/`em-views.ts`'s blanket policy for team/session content.
3. **F3 (LOW):** Either give the `participant` grant variant `sessionStatus` (removing the extra read) or explicitly name that Decision 1's two-read design reopens the TOCTOU property `session-subscriber-access-helper.ts` was built to avoid — currently framed only as a performance trade-off.
4. **F4 (LOW/INFORMATIONAL):** State explicitly that ordinary reads through this endpoint are not audit-logged, and why that's consistent with `content.ts`'s precedent rather than an oversight.

F1 and F2 are the two I'd want closed before this reaches implementation-ready — both are one-line additions that copy an existing pattern, and both are the kind of gap that's easy to miss in review once the endpoint exists and other code depends on its current shape. F3 and F4 are documentation-only asks.
