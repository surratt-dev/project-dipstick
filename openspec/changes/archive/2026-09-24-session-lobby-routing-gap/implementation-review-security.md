# Security Implementation Review — `session-lobby-routing-gap`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope reviewed:** the backend join-link redirect fix specifically — `packages/backend/src/auth/join-landing-path.ts` (new), `packages/backend/src/routes/join-links.ts`, `packages/backend/src/routes/auth.ts` (`executeJoinFlow`), their unit tests, the new real-Postgres `e2e-join-link-redemption.test.ts`, and `DraftSessionHost.tsx`'s new `POST /start` call. This follows my design-stage review (`design-review-security.md`), which raised two findings (Finding 1: the routing fix may not be reachable by a genuine first-time joiner; Finding 2: this is a backend change, not the frontend-only change the original proposal claimed). Both are addressed in `design.md` as D6 (shared helper) and D7 (registration gap scoped out, Goal #2 narrowed).

**Bottom line:** The implementation matches what D6/D7 committed to. No new information disclosure, no new auth bypass, no leftover duplicate logic. One open item carried forward from my design review is still open at the implementation stage, not newly introduced — see "Carried-forward item" below.

---

## Verification 1 — No new information disclosure in the shared helper

`resolveJoinLandingPath` (`join-landing-path.ts:34-50`) runs `SELECT id, status FROM sessions WHERE team_id = $1 ORDER BY created_at DESC LIMIT 1`, parameterized correctly (no injection surface), and returns only a path string — `/session/:sessionId` or `/team/:teamId`. The `status` value itself is read and compared internally but never serialized into the response; only the caller's own `?alreadyMember=true`/`?newMember=true` outcome suffix is appended by the two call sites.

The redirect destination does reveal, to whoever follows the link, whether the team's most recent session is in one of the three "live" buckets versus one of the four "not live" buckets — but this is a *coarsening*, not a widening, of what the previous `status = 'active'` check already disclosed via the same mechanism (a 302 target). Three statuses now collapse into one destination instead of being distinguishable from `draft`/`wrap_up`/`complete`/`abandoned` by a single boolean. Not a new finding.

## Verification 2 — Both call sites genuinely use the shared helper; no leftover independent status logic

Confirmed by direct read and grep:

- `join-links.ts:206` calls `resolveJoinLandingPath(link.team_id)` and redirects to the result plus its own outcome param. No independent `status` check remains in this file.
- `auth.ts`'s `executeJoinFlow` (`auth.ts:859`) calls the same helper and does the same.
- `grep -n "status = 'active'"` across `join-links.ts` and `auth.ts` turns up exactly one remaining hit — `auth.ts:577`, inside `POST /auth/logout`'s active-session-participation warning check. That's an unrelated feature (confirming-before-logout), not a second copy of the landing-path decision. No duplicate, no drift risk on this seam anymore — the exact defect Finding 2 and D6 were about is closed.

## Verification 3 — `team_memberships` insert is still unconditional, ahead of the status check

Unchanged in both files, confirmed by re-reading the control flow:

- `join-links.ts`: token validation → unauthenticated check → `actorRoleResult` SELECT → `withAuditTransaction` (the `team_memberships` INSERT + conditional audit row) → `emitAuditEvent` → **then** `resolveJoinLandingPath` → redirect.
- `auth.ts`'s `executeJoinFlow`: token validation → revoked/expired check → `withAuditTransaction` (same INSERT shape) → `emitAuditEvent` → **then** `resolveJoinLandingPath` → return.

In both, membership is granted and committed before the landing-path decision is made, and regardless of what that decision turns out to be. This matches my design review's characterization exactly: the redirect destination is cosmetic, not an access decision. Nothing in this implementation moved the INSERT after the status check or made it conditional on it. Good — this is the property I most wanted preserved.

## Verification 4 — `DraftSessionHost`'s new `POST /start` call introduces no new auth bypass

`DraftSessionHost.tsx`'s `startSession()` (`DraftSessionHost.tsx:140-169`) calls `POST /api/v1/sessions/:sessionId/start` — the pre-existing `SESSION-004` endpoint (`facilitator-sessions.ts:827-916`), the same one `SessionLobbyPage`'s `handleStartSession` already calls. I re-read that handler directly: it independently looks up the session row, checks `sessionRow.facilitator_id !== session.userId` → `403` (`facilitator-sessions.ts:861-869`) before any state change, and separately checks `status !== 'lobby'` → `409`. Both checks run regardless of which frontend surface issued the request. `DraftSessionHost`'s facilitator-only *framing* is UX; the actual boundary is unchanged, server-side, and was already there before this change. No new client-side-only authorization logic was added anywhere in this diff — the frontend does not decide who may call `/start`, it only decides when to show the button.

## Test coverage observations

- `join-landing-path.test.ts` exercises all seven `SessionStatus` values plus the no-session case against the helper directly — exhaustive per D4's own stated intent.
- `join-links.test.ts` and `auth.test.ts` each add a `lobby`-specific redirect assertion for their respective call site (direct and through-OIDC), on top of the pre-existing `active` case.
- `e2e-join-link-redemption.test.ts` adds a real-Postgres test (`6.3`) confirming a `lobby`-status session redirects a real, distinct engineer account to `/session/:sessionId` against the actual database — good, this is exactly the kind of non-mocked confirmation I asked for on the *routing* claim specifically.

**What that e2e test does not do** — and says so directly in its own comment (`e2e-join-link-redemption.test.ts:198-204`): it asserts the redirect location only. It does not call `action-items-review` or open the WebSocket connection for that redeemed session, so it does not confirm or refute whether the newly-joined engineer actually gets a working landing once there.

## Carried-forward item (not a new finding) — Finding 1's manual trace is still outstanding

My design review's Finding 1 recommended a real end-to-end trace (non-facilitator account, real join-link redemption into a `lobby`-status session, against the real database *and* WebSocket) to confirm whether `evaluateSessionSubscriberAccess` actually rejects a first-time joiner as traced. `design.md` D7 correctly scoped the *fix* out of this change, and `tasks.md` 6.4 captures exactly this trace as a task — but as of this review, tasks.md shows 6.2, 6.3, and 6.4 (the three manual-walkthrough verification tasks) still unchecked; only 6.1 (automated suite) is marked done. This is consistent with D7's framing (verify before or shortly after shipping, not necessarily before merge) and I'm not blocking on it, but I want it on record: task 6.4 is the concrete commitment that satisfies my original ask, and it should not be allowed to quietly lapse once this change merges. Whoever closes out the tasks list should either check it off with the observed result, or file the D7 follow-up immediately if the 404/`CLOSE_UNAUTHORIZED` outcome is confirmed.

---

## Summary

- No new information disclosure in the shared helper — confirmed.
- Both call sites fully migrated to `resolveJoinLandingPath`; no leftover duplicate `status` logic — confirmed, Finding 2 from my design review is closed.
- `team_memberships` INSERT remains unconditional ahead of the status check — confirmed unchanged; the redirect stays cosmetic, not an access decision.
- `DraftSessionHost`'s new `POST /start` call uses the existing, independently-gated endpoint with no new client-side authorization logic — confirmed.
- One open item, carried forward from design review and not worsened by implementation: task 6.4's manual real-database/WebSocket trace for the D7 registration gap is still unchecked. Recommend it be run and the result recorded (or the D7 follow-up filed) before this is treated as fully closed out.

No blockers to merging this implementation on the grounds reviewed here.
