# Security Design Review — `session-lobby-routing-gap`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** `design.md`, `proposal.md`, delta specs (`join-link`, `session-creation`,
`pre-session-action-item-review`), plus the relevant implementation this design packet targets
(`DraftSessionHost.tsx`, `SessionLobbyPage.tsx`, `join-links.ts`, `facilitator-sessions.ts`,
`sessions.ts`, `session-subscriber-access-helper.ts`, `websocket-routes.ts`) and their current test
coverage. This is a design-stage review based on code tracing, not a dynamic/runtime test — see
Finding 1's verification recommendation.

**Bottom line:** The authorization boundaries this change routes more traffic through
(`evaluateSessionSubscriberAccess`, `POST /start`'s `facilitator_id` check) are unchanged by this
change and are sound. I have no objection to D1–D5 on authorization-widening grounds — if anything
my finding runs the other direction (Finding 1). My two concrete asks before this ships: (1) verify
Finding 1 with a real join-link redemption by a non-facilitator account, not just the mocked unit
tests currently in the suite, and (2) correct the "no backend change" claim (Finding 2) so the
`join-links.ts` change gets the review path an auth-adjacent endpoint deserves, not the review path
of a copy tweak.

---

## Finding 1 (High — functional/authorization, not exposure) — The routing fix this change ships
may not actually be reachable by a genuine, newly-joined Engineer during `lobby` or `pre_session`

**Claim in `design.md` (D4):** *"`SessionLobbyPage` already renders correctly for `lobby` (waiting
message, no Start Session control for non-facilitators — `SessionLobbyPage.test.tsx` '6.4') ... this
is a spec-level rule change with no new frontend rendering logic required for the Engineer path."*

I traced this claim against the real authorization chain rather than taking the test file's word for
it, because `SessionLobbyPage.test.tsx`'s "6.4" and the backend's equivalent
`action-items-review` tests both **mock `evaluateSessionSubscriberAccess`'s return value directly**
(`facilitator-sessions.test.ts:1438-1443`, participant/facilitator grants supplied as literals). They
verify the branch-rendering logic given a grant — they do not verify that a real, newly-joined
Engineer would ever receive that grant. Tracing the real path:

1. `evaluateSessionSubscriberAccess` (`session-subscriber-access-helper.ts`) has exactly two paths:
   **Path 3 (facilitator)**, and **Path 1 (participant)** — which requires a pre-existing
   `session_participants` row for *this exact session* (`sp.session_id = s.id AND sp.user_id = $1`).
2. The only code in the entire backend that inserts into `session_participants` is
   `POST /api/v1/sessions/:sessionId/participants` (`sessions.ts:132-138`) — and that handler
   **rejects with 422 unless `status === 'active'`** (`sessions.ts:72-80`). There is no path to
   register as a session participant while a session is `lobby` or `pre_session`.
3. `grep` across `packages/frontend/src` turns up **zero call sites** for that endpoint. Nothing in
   the shipped frontend calls it today, for any status.
4. No DB trigger or other mechanism populates `session_participants` (checked
   `migrations/2_create_tables.sql` — plain table, no trigger).

Net effect: a non-facilitator Engineer who follows a join link into a session in `lobby` or
`pre_session` has **no `session_participants` row**, so `evaluateSessionSubscriberAccess` returns
`null` for them, not the `participant` grant. Concretely:

- `GET .../action-items-review` returns **404** (the `no-access` branch, "You don't have access to
  this session") — not the `lobby`-waiting or `pre_session`-review branch this change is meant to
  route them to.
- The WebSocket connection `SessionLobbyPage` opens in the same render pass is rejected too:
  `websocket-routes.ts:101-104` calls the same `evaluateSessionSubscriberAccess` and closes with
  `CLOSE_UNAUTHORIZED` on a null grant.

This is **not a new exposure** — it's the opposite failure mode, and it is not introduced by this
change (the same gap already applies to the currently-shipped `active`-only redirect, for the same
reason: nothing registers a participant row regardless of status, and the one endpoint that could is
itself gated to `active` and uncalled). But it directly undercuts this change's stated Goal #2
("Give Engineers a working landing on `/session/:sessionId`..."): expanding the redirect's status
enumeration doesn't help if the destination 404s for the exact user this change is meant to help.
Nothing in `design.md`, `proposal.md`, `exploration-notes.md`, or the engineer's own design review
traces this path — the design's confidence rests on unit tests that assume the grant, not on how the
grant is produced.

**Recommendation (not necessarily blocking this change, but blocking sign-off on its stated goal):**
- Before or immediately after this change ships, have engineering run one real end-to-end trace: a
  non-facilitator account redeeming a join link into a `lobby`-status session, confirmed against the
  actual database and WebSocket connection — not mocks — to see what they actually land on.
- If the trace confirms the 404/`CLOSE_UNAUTHORIZED` outcome, that is a separate, pre-existing gap
  (participant registration, not routing) and deserves its own tracked follow-up — but it should be
  named explicitly, the way this change's other named follow-ups are, rather than left for the next
  "how is this still broken" report the way the routing gap itself was (per `proposal.md`'s own
  framing of why it exists).
- Whatever fix is chosen for that follow-up (auto-registering a `session_participants` row on
  `lobby`/`pre_session` access, or loosening `evaluateSessionSubscriberAccess`'s Path 1) is an
  authorization-boundary change and should get the same design-stage security review this helper
  originally got (`websocket-delivery-time-authorization`), not an expedient patch shipped without
  review because "it's just closing a routing gap."

---

## Answering the three specific questions from the review request

### Does routing more traffic through `SessionLobbyPage`'s shared-access path change who can see what?

**No.** `SessionLobbyPage`'s authorization is entirely delegated to
`evaluateSessionSubscriberAccess` plus the response-level `isFacilitator` flag it returns; this
change does not touch either. Widening the join-link redirect's status enumeration (D4) sends more
traffic *to* this check, but it is the same check, evaluated fresh per-request (no caching, per the
helper's own documented cache prohibition) — not a new or widened grant path. The realistic risk, if
any, runs the other direction: see Finding 1.

### Does extending the redirect to `lobby`/`pre_session` expose session state to a joining Engineer earlier than intended?

**No new exposure.** The `lobby` branch renders only a static waiting message; the `pre_session`
branch's actual review data is returned only on a `200` from `action-items-review`, which is the
same `evaluateSessionSubscriberAccess`-gated call already used for the currently-shipped `active`
redirect. Nothing about this change lowers the bar for what data is returned or to whom — and per
Finding 1, the practical failure mode today is under-, not over-, disclosure for a genuinely new
participant.

### Is `POST /start` from `DraftSessionHost`'s new Start Session control appropriately gated, and consistent with `SessionLobbyPage`'s own gating?

**Yes.** `POST /api/v1/sessions/:sessionId/start` (`facilitator-sessions.ts:827-869`) independently
checks `sessionRow.facilitator_id !== session.userId` → `403` before doing anything else, regardless
of which frontend surface called it. This is the same shape of check `GET .../facilitator-state`
enforces for the rest of `DraftSessionHost` (`facilitator_id !== userSession.userId` → `403`,
`facilitator-sessions.ts:2015-2023`), and it is enforced independently of
`SessionLobbyPage`'s `isFacilitator`-gated button render. This is the correct shape per my own
standing position that UI-layer access control is UX, not a boundary (see persona) — I'd flag it if
`POST /start`'s only protection were "the button doesn't render for non-facilitators," but it isn't.

One documentation note, not a finding: D1's line *"no additional gating is needed"* is true, but for
the reason above (server-side enforcement on the shared endpoint), not because
`DraftSessionHost`'s facilitator-only framing is itself the control. Worth a one-line edit to
`design.md` so a future reader doesn't read D1 as relying on frontend gating.

---

## Finding 2 (Medium — scope/process accuracy) — The join-link landing rule is a backend change,
not the frontend-only change `proposal.md` and `design.md` claim

Both `proposal.md` ("**Backend:** none — `POST /start`, `GET /action-items-review`, and the
join-redemption endpoints are unchanged; this is a frontend routing/wiring fix only.") and
`design.md`'s Impact section (listing the join-link redirect under "Frontend") assert this change
touches no backend code. That's incorrect for the join-link piece specifically.

The actual redirect decision for a redeemed join link is made server-side, in
`GET /api/join/:token` (`packages/backend/src/routes/join-links.ts:82-217`) — a Fastify handler that
issues a real `302` based on a SQL check currently scoped to `status = 'active'`
(`join-links.ts:203`). There is no frontend routing logic for this at all (confirmed: no `/join/:id`
client route exists in `App.tsx`; the only client-side join-related route is the already-terminal
`/join-error`). Implementing D4's seven-status enumeration requires changing that SQL to an `IN`
clause over the three "live" statuses — an edit to an endpoint that:

- serves **both unauthenticated and authenticated** requests in the same handler,
- sits in the same function as the `team_memberships` INSERT and its audit-transaction (the actual
  access grant), and
- is exactly the kind of code this persona expects to see flagged for backend review, not waved
  through because a proposal document asserted "no backend change" before anyone traced the code.

**The good news, stated affirmatively:** the `team_memberships` INSERT (`join-links.ts:165-184`,
inside `withAuditTransaction`) runs and commits **unconditionally**, before and independent of the
session-status check that decides the redirect target. So the redirect destination is genuinely
cosmetic — it has no bearing on whether membership, and eventually session access, is granted. That
is the right shape (routing convenience, not an access decision), and I want that on the record as a
positive, not just the correction above.

**Recommendation:** Correct `proposal.md`'s Impact section and `design.md`'s Non-Goals framing to
list `packages/backend/src/routes/join-links.ts` under a backend-touching bullet, so implementation
and review both treat the SQL change as what it is — small and low-risk in isolation, but living
inside an auth-adjacent, unauthenticated-reachable endpoint — rather than a "copy alignment" pass.

---

## Other observations (not findings — noted for completeness)

- **D5's removal of the raw `sessionId` from non-facilitator waiting copy** is a small, genuine
  data-minimization improvement — one fewer internal identifier surfaced to a participant who has no
  use for it client-side. Worth keeping even if the rest of D5 gets simplified later.
- **Audit logging is unaffected and remains adequate for this change's scope.** `POST /start` emits
  `session.state_changed` to the existing `audit_log` pipe (`facilitator-sessions.ts:899-911,
  921-929`) regardless of which frontend surface triggered it — `DraftSessionHost`'s new control and
  `SessionLobbyPage`'s existing one converge on the same audited endpoint, so this change does not
  create a second, less-observable path to the same state transition. No new WebSocket event types
  are introduced by this change, so it does not open a new category of the WS-logging-gap concern
  I generally carry into these reviews.
- **WebSocket re-authorization for long-lived connections** is unchanged and out of this change's
  scope, correctly — D2's navigate link is a one-time client-side navigation, not a new subscription
  or connection-lifetime semantic. No new finding here; flagged only to confirm I checked.

## Summary of asks before this ships

1. **Finding 1 (High):** Verify with a real (non-mocked) join-link redemption by a non-facilitator
   account into a `lobby`-status session whether they actually land on the intended waiting
   experience or a 404/`CLOSE_UNAUTHORIZED`. If broken, name it as an explicit tracked follow-up —
   don't let it surface later as an unexplained bug report — and route any fix to
   `evaluateSessionSubscriberAccess` or participant registration through the same review rigor as
   the rest of that authorization boundary.
2. **Finding 2 (Medium):** Correct the "no backend change" claim in `proposal.md`/`design.md` so
   `join-links.ts`'s SQL change gets reviewed as the auth-adjacent backend edit it is.

Neither finding blocks the authorization shape of D1–D5 themselves, which I have no objection to.
