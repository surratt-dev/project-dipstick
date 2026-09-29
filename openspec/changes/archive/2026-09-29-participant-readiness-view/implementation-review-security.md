# Security Review — `participant-readiness-view` Implementation (tasks.md 1.5)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** Task 1.5, a dedicated review of the D7/D2 registration-gap closure and the new roster endpoint's authorization — required to run separately from general code review, per tasks.md's explicit instruction. Not bundled with any other review.
**Reviewed against:** my design-stage findings (`design-review-security.md`, Findings 1–4), design.md's D2/D5 corrections, and the actual code as implemented, not the stated intent.
**Files read:** `packages/backend/src/routes/sessions.ts`, `packages/backend/src/routes/facilitator-sessions.ts` (lines 1022–1102), `packages/backend/src/auth/session-subscriber-access-helper.ts`, `packages/backend/src/realtime/ws-event-dispatcher.ts` (lines 298–352), `packages/backend/src/auth/audit-logger.ts`, `packages/frontend/src/pages/SessionLobbyPage.tsx` (`fetchReview`), `packages/shared/src/types/session.ts`.
**Verified, not assumed:** ran the actual test suites before writing this review, per tasks.md 1.5's own precondition ("requires 1.4's test suite green before this review starts"). Results below.

```
sessions.test.ts + facilitator-sessions.test.ts       110 passed
SessionLobbyPage / DraftSessionHost / ParticipantRosterView / participantRoster  75 passed
session-lifecycle-e2e.test.ts                            1 passed
```

All green. This review evaluates tested, passing behavior, not a diff read against stated intent.

## Verdict

**Satisfies task 1.5's gate. Not a merge blocker.** Both High findings from the design-stage review are correctly closed in the implementation, the roster endpoint's caller-level gate is correctly wired, audit logging is transactionally correct on both the success and rejection paths, and I found no new attack surface introduced by the relax-the-gate mechanism choice itself beyond one Low-severity observation (pre-existing, not introduced by this change — see below).

---

## 1. Does the corrected membership/EM check close both design-stage High findings?

**Yes, confirmed by reading the query and by the test cases that pin it.**

`sessions.ts:106-122` (`POST .../participants`) and `sessions.ts:338-354` (`.../lock-in`) both now select `membership_exists`, `membership_removed_at`, `membership_role`, and `global_role` in one query, and both gate on:

```
membership_exists &&
membership_removed_at === null &&
global_role !== "engineering_manager" &&
membership_role !== "engineering_manager"
```

This is character-for-character the same condition set as `evaluateSessionSubscriberAccess` Path 1 (`session-subscriber-access-helper.ts:155-161`) — not the old EM-only-exclusion query my design review flagged as Finding 1. The previous gap (a `LEFT JOIN` yielding `membership_role = null` for a non-member, which is not `'engineering_manager'` and so passed) is closed: `membership_exists` is now a required, independent condition, not inferred from `membership_role`'s nullness.

Test coverage confirms the fix is pinned, not just present in the diff:
- `sessions.test.ts:244-261` — a user with **no** `team_memberships` row (`membership_exists: false`) is rejected. This is exactly Finding 1's scenario and was previously absent from the test list; it is now explicit.
- `sessions.test.ts:265-282` — a user whose `team_memberships` row has `removed_at` set is rejected, even with an otherwise-eligible `membership_role`.
- `sessions.test.ts:81-114`, `152-171`, `202-239` — both EM-exclusion paths (`global_role` and `membership_role`) still reject, at every accepted status (`active`, `pre_session`, `lobby`).
- `sessions.test.ts:317-332` — `draft` status is still rejected (422) before any role check runs, and the test asserts only one `db.query` call was made — the boundary D2 correction explicitly says the new mechanism must not loosen is pinned as a negative case, not just implied by the status-gate code.

The `lock-in` handler's identical historical gap (my Finding 1's second location) is fixed with the same corrected query and the same four-condition gate (`sessions.ts:379-393`), and `sessions.test.ts`'s existing `lock-in` tests (3.4, 3.7) continue to exercise the corrected shape — a mid-session role change to EM is still caught by the per-operation DB read, unchanged from before this pass, now on top of the corrected base query.

Finding 1: **closed.**

## 2. Does the roster endpoint's caller-level gate correctly reject participant grants?

**Yes.** `facilitator-sessions.ts:1065-1077`:

```ts
const grant = await evaluateSessionSubscriberAccess(userSession.userId, sessionId);
if (grant === null || grant.path !== "facilitator") {
  ...
  return reply.code(404).send({ ... });
}
```

This is the `dispatchParticipantJoined`/`dispatchParticipantLeft` precedent (`ws-event-dispatcher.ts:310-330`, `grant?.path === "facilitator"`), not the `action-items-review` dual-audience precedent — confirmed by reading both handlers side by side. A `participant`-grant caller gets the identical 404 a caller with no grant at all gets: same status code, same body shape (`category: "not_found"`), same header treatment. There is no `isFacilitator`-style branch anywhere in this handler that would let a participant-grant request reach the roster query.

`facilitator-sessions.test.ts:1752-1768` exercises exactly the caller-level case my design review's Finding 2 said a naive test suite could miss: a caller holding their own **valid, unmodified** `participant` grant (not a null grant, not a missing session) gets 404, and `mockDbQuery` is asserted **not** called — the roster query is never reached, so this isn't UI-layer suppression of a fetched result, it's a request that never touches the data. This is distinct from, and in addition to, the row-level EM-filtering test at `facilitator-sessions.test.ts:1774-1794`, which asserts the query text itself carries `engineering_manager`, `tm.removed_at IS NULL`, and `tm.user_id IS NOT NULL` — the two failure modes Finding 2 required be tested separately are both present as separate test cases, not one test covering both.

Row-level content filtering (`facilitator-sessions.ts:1079-1091`) is independently correct: the roster query re-applies the full membership+EM condition set via SQL (`tm.user_id IS NOT NULL`, `tm.removed_at IS NULL`, both role columns `!= 'engineering_manager'`), so even if a `session_participants` row existed for an EM (e.g., registered before a promotion), the roster would not surface them to the facilitator — this is a second, independent layer on top of the registration-time block in section 1, not a substitute for it.

Finding 2: **closed**, at both the caller-authorization and row-filtering layers, independently verified.

Disclosure-blind and timing-floor conventions (design review Finding 4) are also present on both response paths — `applyTimingFloor()` and `Cache-Control: no-store` on 200 and 404 alike (`facilitator-sessions.ts:1068-1069`, `1093-1094`), confirmed by `facilitator-sessions.test.ts:1796-1811`.

## 3. Is audit logging correctly wired, transactionally, for both success and rejection?

**Yes.**

- **Rejection** (`sessions.ts:153-186`): a synchronous, untransacted `INSERT INTO audit_log` with `operation = 'session.participant_registration_rejected'`, followed by `emitAuditEvent`, both before the 403 response. No paired state change exists on this path (nothing else is written), so the lack of a transaction wrapper is correct, not an oversight — it matches the established `session.draft_denied_membership_conflict` convention this design explicitly cites. `sessions.test.ts:81-114` confirms the DB row and the structured-log emission both fire on rejection.
- **Success** (`sessions.ts:192-239`): `BEGIN` → `INSERT INTO session_participants ... ON CONFLICT DO NOTHING` → conditional `INSERT INTO audit_log` (only when the insert actually produced a new row, i.e., `!alreadyParticipant`) → `COMMIT`, with `emitAuditEvent` fired only after the transaction commits. This is the `join.link_redeemed` pattern by construction, and it correctly avoids writing a spurious `session.participant_registered` audit row on every reconnect — `sessions.test.ts:285-313` confirms a reconnecting participant (the `ON CONFLICT DO NOTHING` no-row-returned case) produces **no** audit insert and **no** `emitAuditEvent` call, while `sessions.test.ts:117-150` and `174-199` confirm a genuine first registration does produce both.

`AuditEventName` (`audit-logger.ts:299-313`) carries both new event names with an inline comment correctly describing the corrected condition set the rejection variant covers — not just EM-exclusion, matching what I required in my design review.

Finding 3: **closed.**

## 4. Does relaxing the POST gate to lobby/pre_session introduce new attack surface beyond what D2 anticipated?

**No new gap found.** Two things I specifically checked, both closed:

- **The `draft` boundary is not loosened.** The status gate (`sessions.ts:90`) accepts exactly `lobby`, `pre_session`, `active` — `draft` is excluded, matching the reasoning `evaluateSessionSubscriberAccess` Path 3 already encodes (a `draft` session has no valid participant or facilitator grant path). This is the exact boundary D2's correction said the chosen mechanism "must not loosen," and it's pinned by a negative test (`sessions.test.ts:317-332`), not just left implicit in the status list.
- **The frontend caller (`SessionLobbyPage.fetchReview`, `SessionLobbyPage.tsx:135-159`) does not create a retry loop or an authorization bypass.** It fires the registration POST only on a 404 from `action-items-review` (i.e., no grant at all), retries the same fetch exactly once regardless of the POST's own status code, and does not branch on the POST's response body. A genuinely-ineligible caller (EM, non-member, stranger) still has no grant after the POST (since the corrected server-side check in section 1 rejected it), so the retried fetch still 404s and the UI lands on `no-access` — confirmed by `SessionLobbyPage.test.tsx`'s passing suite (35 tests, included in the run above) covering this retry-once shape. The POST call is fire-and-forget from the frontend's perspective (no `.ok` check gates the retry), which is fine precisely because the server-side authorization is what's doing the actual gating, not the frontend's handling of the POST's result — consistent with the "UI-layer access control is not access control" principle this review holds every endpoint to.

**One Low, pre-existing, non-blocking observation** (not introduced by this change, and not new attack surface D2's mechanism creates — flagging for completeness since I was already in this code): `POST .../participants` still distinguishes "session not found" (404) from "caller not eligible" (403) for an authenticated caller. This is a session-existence oracle for any authenticated user who can guess or enumerate a session ID, at any of the three now-accepted statuses. This existed before this change (previously reachable only at `active` status via direct API call, per my design review's own note that the endpoint "has zero frontend callers" today), and D2 does not change the endpoint's response-differentiation behavior — it only widens which `status` values are accepted into the same pre-existing 403/404 split. I am not blocking on this: it is not part of task 1.5's scope (registration-gap closure and roster authorization), it predates this change, and the practical exposure is narrow (session UUIDs are not sequential, and the oracle reveals existence only, not content). Worth a follow-up ticket to bring this endpoint's disclosure behavior in line with the disclosure-blind convention `action-items-review` and the new roster endpoint both follow, but it is not a reason to hold this merge.

---

## Reviewed and confirmed, no action needed

- `evaluateSessionSubscriberAccess` itself is unmodified by this change (confirmed by reading it) — the read-side helper my design review measured the write-side gap against is exactly the helper the write-side now matches.
- No caching of any authorization decision was introduced anywhere I checked in this pass — every check in `sessions.ts` and `facilitator-sessions.ts`'s new code is a live, per-request DB read, consistent with Decision 6's cache prohibition.
- The roster response shape (`ParticipantRosterEntry: { userId, displayName }`, `packages/shared/src/types/session.ts:130-133`) carries no role, email, or membership metadata — the minimum needed for the feature, nothing more.
- websocket-specification conformance (`websocket-spec-conformance.test.ts`) is unaffected, as tasks.md 6.5 states — `ParticipantJoinedPayload`/`ParticipantLeftPayload` shapes are untouched by this change, consistent with D2's mechanism touching only `sessions.ts` and `SessionLobbyPage.tsx`.

## Outstanding, not part of this review's gate

- tasks.md 6.2/6.3/6.4 (true end-to-end runs against real Postgres/Redis) remain unperformed, flagged by the implementer as requiring infrastructure not available in that session. This review evaluated the unit/component-level test suites (110 + 75 + 1 passing, listed above), which is sufficient for task 1.5's own authorization-correctness gate — those e2e tasks are a separate, already-flagged gap in tasks.md's own checklist, not something task 1.5 is positioned to close.
- tasks.md 6.1 (independent code-review confirmation that both surfaces share one roster implementation, not a fork) is explicitly self-certified by the implementer and still needs a reviewer's sign-off — outside this review's security scope, flagged only so it isn't lost.
- The Low disclosure-oracle observation in section 4 is worth a follow-up ticket, not a blocker.
