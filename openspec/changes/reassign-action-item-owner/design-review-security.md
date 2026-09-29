## Security Review — VOTE-004 / `reassign-action-item-owner`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** `design.md`, `proposal.md`, `specs/action-item-owner-reassignment/spec.md`, cross-checked against the shipped `VOTE-002` implementation (`packages/backend/src/routes/action-items.ts`), `evaluateTeamAccess` (`packages/backend/src/auth/team-content-access-helper.ts`), `applyTimingFloor` (`packages/backend/src/content/timing-oracle.ts`), `audit-logger.ts`, and `requirements/design/REST API Contract.md`.

**Overall assessment:** The authorization model is sound. Reusing `VOTE-002`'s session-scoped `EXISTS` check verbatim, dropping the owner-authorized fork entirely (privileged-only, no self-service path), and pinning the no-manager check to `role = 'participant'` exactly rather than "membership exists" are the right calls, and the design's own risk log already names the `role = 'participant'` precision as load-bearing. I have no objection to any of D1–D10 as authorization *decisions*. My findings are about three things this design is silent on that its own precedent (`VOTE-002`, shipped and reviewed) does not leave silent: the timing side-channel, the audit trail's blind spot on the no-op path, and a stale authorization description in the contract document this change touches but does not fully correct. I also flag one implementation pitfall in the new-owner cascade's query shape that isn't a design flaw but will become a vulnerability if the obvious-looking shortcut is taken.

None of these are blocking in the sense of "the authorization model is wrong." All of them are the kind of thing that's cheap to fix now and expensive to discover in an incident postmortem later.

---

### Finding 1 (Medium) — No mention of the timing-floor requirement for this endpoint's enumeration-safety checks

`design.md` Decision D2 adopts `VOTE-002`'s Decision D12 anti-enumeration ordering "directly," and the spec's scenarios pin down the 404-vs-403 status codes precisely. But status-code ordering is only half of `VOTE-002`'s actual anti-enumeration control. The other half — `applyTimingFloor`, described in its own file header as a "BLOCKING design requirement" — is called explicitly at every short-circuit return in `action-items.ts`'s shipped handler: before the item-not-found 404 (line 80), before the no-relationship 404 (line 114), before the invalid-`sessionId` 422 (line 134), and before the not-authorized-facilitator 403 (line 165). It is *not* mentioned anywhere in `design.md`, `proposal.md`, or the spec for this change.

This matters because the reason the floor exists is precisely the scenario D2 is trying to close: a 404 response (item lookup only) and a 403 response (item lookup + `evaluateTeamAccess` + an extra "ever facilitated" query, possibly + a facilitator-authorization query) do different amounts of work and will have measurably different latency distributions unless something pads the fast path. Correct status codes without the timing floor re-open the exact oracle the status codes were designed to close — an attacker can still distinguish "doesn't exist" from "exists, no access" by response time, just not by status code or body.

Since this is reused code living in the same file (`action-items.ts`) and reusing the same helper functions, it's likely an implementer would naturally reuse `applyTimingFloor` too — but "likely" is not what this codebase's own stated policy asks for. The design should say so explicitly, the same way it explicitly restates D12's ordering rather than assuming reuse-by-proximity. Tasks.md should carry an explicit item: apply `applyTimingFloor` at every early-return point in the new handler (item-not-found, no-relationship, `sessionId` 422, not-authorized 403), consistent with `VOTE-002`.

**Recommendation:** Add an explicit design decision (or an amendment to D2) stating the timing floor applies to this endpoint's early-return paths, and add a corresponding task. This is a "secure default that shouldn't depend on an implementer noticing it," which is exactly the category of finding I weight heavily.

---

### Finding 2 (Medium) — The no-op reassignment path is a zero-audit-trail staleness-clock reset

D9 requires every accepted reassignment — no-op included — to bump `action_items.updated_at`. D6/D10 confirm the no-op path writes neither `action_item_history` nor `audit_log`. Individually, both decisions are reasonable and each cites a real, consistent precedent (`VOTE-002`'s same-status no-op).

Combined, they produce a gap: a facilitator (or a client that retries/double-submits) can repeatedly call this endpoint with `newOwnerUserId` set to the item's current owner and reset the item's staleness clock on demand, with **no record anywhere** — not `action_item_history`, not `audit_log` — that this happened, how many times, or when. The only observable trace is the current value of `updated_at`, which is overwritten by the next no-op call. This is different in kind from `VOTE-002`'s status no-op: a status no-op can't be used to manipulate a dashboard signal that other people rely on for decisions (per this application's own pre-session review screen, which the proposal's Context section explicitly names as the motivating consumer of `updated_at` staleness). A no-op reassignment can.

This isn't a request to reject same-owner reassignments — D6's reasoning for accepting them is fine. It's a request to reconsider *only* the audit-blind-spot half of D6/D10 for this endpoint's specific no-op: a lightweight `audit_log` write (or at minimum a structured `emitAuditEvent` call, without necessarily writing the business-record `action_item_history` row) on the no-op path would close this without reopening D6's actual concern (treating it as a "real" reassignment for `action_item_history` purposes). Given Tomás's stated position that audit logging is a security control for reconstructing "a permission that was exercised in a suspicious pattern" — repeated staleness-clock resets on a specific item is exactly that pattern, and today it would be invisible.

**Recommendation:** Either (a) write a minimal `audit_log`/`emitAuditEvent` record even on the no-op path (metadata: `action_item_id`, `owner_id` unchanged, `session_id`), or (b) explicitly accept this gap in writing in the Risks section, the way the design already does for other accepted limitations, so it's a named decision rather than an emergent side effect of composing D6 and D9.

---

### Finding 3 (Medium) — The REST API Contract's `Authorization` line is not corrected, and remains actively wrong relative to the shipped mechanism

`design.md`'s Migration Plan states the contract correction for this change covers exactly two things: the 403→409 resolved-item fix and the `sessionId` optional→required wording. It does not touch VOTE-004's existing **`Authorization`** line, which currently reads:

> **Authorization:** `global_role = 'facilitator' only`. The facilitator must have an active session for the team this action item belongs to.

`global_role = 'facilitator'` is a real, distinct enum value in this schema (`user_role` in `migrations/1_create_enums.sql`) — this is not a typo that resolves to nonsense, it describes a *different, weaker, standing* authorization model than the one this design actually implements (a session-scoped `EXISTS` check that is deliberately narrower than any standing role, per the file-header comment in `action-items.ts` itself: "deliberately narrower than a standing 'I am a facilitator' role check"). A reader of the contract alone — which is this codebase's stated source of truth for the endpoint shape — would come away believing that holding the global `facilitator` role is sufficient, full stop, with the active-session clause read as a loose qualifier rather than the actual enforcement mechanism.

This is not a hypothetical concern about documentation hygiene. `VOTE-002`'s own contract entry (same file, `### VOTE-002 — Update Action Item Status`) was fully rewritten when it shipped: it now states the actively-facilitating definition precisely, cites design.md's Decision D10 by name, explains why the endpoint intentionally excludes `evaluateTeamAccess`'s broader grace windows, and links to the implementing file. That is the established precedent for "how this codebase documents a session-scoped authorization model in the contract," set by this exact endpoint's sibling. VOTE-004's plan reverts to a narrower "add a correction footnote" treatment for two unrelated fields while leaving the one line that actually describes the security boundary untouched and wrong.

**Recommendation:** Extend the Migration Plan's contract correction to rewrite VOTE-004's `Authorization` line to match `VOTE-002`'s precedent — state the session-scoped `EXISTS` mechanism precisely, note there is no owner-authorized fork (unlike `VOTE-002`), and cite the design decision by name. This is a two-sentence fix; leaving it as-is means the contract will actively mislead the next engineer who reads it without also reading design.md.

---

### Finding 4 (Low, implementation-pitfall flag) — The new-owner cascade's steps 3/4 query must not reuse `evaluateTeamAccess`'s `removed_at`-filtered join pattern

D5/spec steps 3–4 depend on distinguishing "no `team_memberships` row at all for this team" (404) from "a row exists but is soft-removed or `role = 'engineering_manager'`" (422). That distinction only holds if the query used to answer it fetches the membership row **without** filtering on `removed_at` in the `WHERE`/`JOIN` condition. `evaluateTeamAccess` — the most obvious existing helper to reach for, and already imported in this same file — does exactly that filtering (`LEFT JOIN team_memberships tm ON ... AND tm.removed_at IS NULL`), which would silently fold a soft-removed member into "no row" (wrong code: 404 instead of 422) if reused here as a shortcut. This wouldn't be a broken authorization outcome (both codes reject the reassignment), but it would be a wrong signal on exactly the enumeration boundary the design otherwise treats carefully, and it would misclassify a soft-removed member as "never existed" — inconsistent with the "never a member" vs. "soft-removed member" distinction the design explicitly says it's borrowing from `team-membership-removal`'s partial-unique-index precedent.

**Recommendation:** Name this explicitly as an implementation note in tasks.md: the steps-3/4 membership lookup must be its own query (`SELECT role, removed_at FROM team_memberships WHERE user_id = $1 AND team_id = $2`, no `removed_at` filter), not a reuse of `evaluateTeamAccess`'s grant-shaped query. This is a one-line task addition, not a design change.

---

### Finding 5 (Low, observation, not a blocker) — Malformed `newOwnerUserId`/`sessionId` input reaches raw SQL with no global error handler to sanitize the failure

The proposal already names, plainly, that this route has no request-schema validation layer and that a malformed `newOwnerUserId` (not a UUID, or absent) has no stated status code — an accepted, inherited gap, not new to this change. I confirmed the severity side of that gap: `packages/backend/src/app.ts` registers no `setErrorHandler`, and I found no global Fastify error handler anywhere in `packages/backend/src`. A non-UUID string bound to a parameterized query against a `uuid`-typed column will throw a Postgres driver error (`invalid input syntax for type uuid`) that propagates as an *unhandled* exception. Fastify's default error handler will return that as a 500 with the underlying error message unless something upstream of this route already normalizes it — meaning a malformed request body from an already-authenticated facilitator could surface a raw Postgres error string (revealing column types/query shape) rather than a clean `422`.

This is genuinely a pre-existing gap (`VOTE-002`'s handler has the identical exposure for `resolutionNote`/`status`/`sessionId` today) and I'm not asking this change to fix the whole codebase's missing validation layer. But I want it on record that "accepted gap, named here" is doing more work in the proposal than it states: the failure mode isn't just "no stated status code," it's "an unhandled DB-level exception with no sanitizing layer between it and the HTTP response." If this change is the first one to add a security review of this specific finding, I'd rather it be named precisely than carried forward as vague.

**Recommendation:** No change required to this endpoint specifically beyond what's already planned, but I'd like a follow-up ticket (not blocking this change) for a global Fastify error handler that maps unexpected exceptions to a generic `500` without leaking the underlying error message — this closes the gap for every write endpoint in this file at once rather than per-endpoint.

---

### Non-findings — things I checked and are correctly handled

- **`role = 'participant'` precision (D5 step 4):** Confirmed exact in the spec's normative language ("checked precisely against `role = 'participant'`, not merely 'a membership row exists'"), and the design's own risk log already names this as load-bearing with a dedicated test scenario. No further concern.
- **Global user-existence enumeration via steps 2/3:** D5 collapses "user doesn't exist at all" (step 2) and "user exists but has no membership for this team" (step 3) into the identical `404`. This correctly prevents a facilitator from using this endpoint as a cross-team user-existence oracle. I flag only the implementation risk in Finding 4 above — the design's intent here is correct.
- **D1's removal of the owner-authorized fork:** Reduces attack surface relative to `VOTE-002` by construction — no self-reassignment path exists at all, and step 1 of D5 independently blocks a facilitator naming themselves. Good defense in depth even though the two checks overlap.
- **Transactional dual-write (`action_item_history` + `audit_log`):** Matches `VOTE-002`'s already-reviewed pattern exactly; atomicity is stated as a normative SHALL with its own scenario.
- **No WebSocket broadcast (D8):** Correctly avoids inventing an event with no consumer; not a security concern as scoped.

---

### Summary for the record

Findings 1 and 3 are the ones I'd want addressed before this ships: the timing floor because it's a previously-litigated, blocking requirement in this exact file that isn't carried forward in writing, and the contract's `Authorization` line because it will otherwise document a materially weaker and incorrect authorization model right next to the endpoint that correctly implements a stronger one. Finding 2 (no-op audit blind spot) I'd like a decision on either way, in writing. Findings 4 and 5 are implementation-guidance notes for tasks.md, not design objections.
