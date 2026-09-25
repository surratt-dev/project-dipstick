# Architecture Review — Implementation: session-lobby-routing-gap

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Implementation against `design.md` (D1–D7) and `tasks.md`

## Verdict

Approved. The implementation matches the design faithfully — no scope creep, no undocumented drift, no boundary violations. One open item (unchecked manual walkthroughs, tasks 6.2–6.4) is not a code defect but needs disposition before this is called production-ready; noting it below for the team lead, per instruction, without attempting to run it myself.

## Findings

**D6 (shared helper eliminates duplication) — verified, no drift.**
`packages/backend/src/auth/join-landing-path.ts` implements the full seven-`SessionStatus` bucket logic once, keyed off a single `SELECT id, status FROM sessions WHERE team_id = $1 ORDER BY created_at DESC LIMIT 1` query. Both call sites import and call it directly:
- `join-links.ts:206` (`GET /api/join/:token`) — `const landingPath = await resolveJoinLandingPath(link.team_id);`
- `auth.ts` (`executeJoinFlow`) — identical call, same comment referencing D6.

Neither call site retains its own inline `status = 'active'` check or any parallel bucket logic. This is the real thing, not a nominal extraction with a leftover shadow copy. Unit coverage (`join-landing-path.test.ts`) exercises all seven statuses plus the no-session case — matches task 5.2 exactly, and is a stronger test than the design doc strictly required (each status parametrized individually rather than sampled).

**D7 (no scope creep into the participant-access gap) — verified, boundary held.**
Grepped `packages/backend/src/routes/sessions.ts`: the `POST /api/v1/sessions/:sessionId/participants` handler's `422` gate on `status === 'active'` is untouched — same line range, same condition, no relaxation. No new code anywhere creates or upserts a `session_participants` row. The implementer correctly resisted the temptation to "just fix it while I'm in here," which is exactly the failure mode D7 was written to prevent. Good discipline.

**D1/D2 (Start Session control + navigate link) — verified against actual render logic, not just tasks.md checkmarks.**
`DraftSessionHost.tsx:247–269` renders the Start Session control only when `currentSessionState === 'lobby'`, calls `POST /api/v1/sessions/:sessionId/start`, and on success does an in-place `setLoadState` update to `'pre_session'` — no navigation, matching `openTheRoom`'s established pattern exactly (confirmed by direct comparison, lines 104–134 vs 140–169). The navigate link (D2) at lines 271–280 correctly spans `pre_session | active | wrap_up`, and the terminal-status branch (`complete | abandoned`) at 282–284 is left as static text, matching the design's explicit "not a new dead end" reasoning.

I also confirmed the frontend gating is genuinely cosmetic, not load-bearing: `facilitator-sessions.ts:861` (`sessionRow.facilitator_id !== session.userId` → `403`) is present and independent of which frontend surface calls `POST /start`. The design's D1 clarification ("do not read this decision as relying on frontend gating") is actually true of the shipped code, not just asserted.

**Error handling on the new `POST /start` call — verified real, not just claimed.**
The implementer's summary claim of "inline retry on failure" checks out against both the code and a test that would fail if it didn't work as described: `DraftSessionHost.test.tsx` test "2.6" (lines 199–213) asserts that after a failed `POST /start`, `live-readiness-lobby` stays mounted and `start-session-button` is `not.toBeDisabled()` — i.e., the same control, still live, ready to be clicked again, not a dead-end error screen. This is a meaningful test (it would catch a regression where failure left the button permanently disabled or swapped in a non-actionable error view), not a token assertion. Session-expiry handling (`detectSessionExpiry` → `ReauthRequiredTreatment`) is also wired consistently with the rest of the page's existing pattern.

**D3/D5 (copy alignment, SessionLobbyPage untouched beyond D5's stated scope) — verified.**
`SessionLobbyPage.tsx`'s non-facilitator lobby copy (lines 306–314) drops the raw `sessionId` and adds the reassurance line, exactly per D5/task 4.2. The facilitator-facing branch (line 303–305, still showing the raw `sessionId`) is explicitly left alone per the code comment — correctly scoped, not a missed spot. `DraftSessionHost`'s `lobby` heading/button label (`"Session Lobby"` / `"Start Session"`) now reads as the same product as `SessionLobbyPage`'s equivalent branch, per D5's stated goal. No shared component was introduced — correct, since D5 explicitly ruled that out for this change.

**Test additions match what tasks.md called for, not a superset invented by the implementer or a subset that quietly drops a case.**
- `join-landing-path.test.ts` — new, covers 5.2.
- `auth.test.ts` — a route-level test for the through-OIDC path (5.6) exists at line 1795, distinct from `join-links.test.ts`'s coverage, addressing the design's explicit warning that 5.4's coverage does not imply 5.6's.
- `join-links.test.ts` — the `"should redirect to active session if one exists"` mock at line 425 now includes `status: "active"`, exactly the fix task 5.3 called out as necessary (the mock would otherwise silently pass against the new helper's shape without exercising the redirect it claims to cover).

No architectural concerns here. This is a routing/copy change layered correctly on top of two pre-existing, deliberately-different authorization models (`facilitator_id`-based for `DraftSessionHost`, `evaluateSessionSubscriberAccess`-based for `SessionLobbyPage`) without attempting to unify them — consistent with D3's reasoning for why that unification is out of scope here.

## Open item for the team lead (not a code defect)

Tasks 6.2, 6.3, and 6.4 (manual live-UI walkthroughs) are unchecked. The implementer's stated reason — an ambiguous-ownership dev server already running on port 3000 that they didn't want to disrupt — is a reasonable instinct but leaves a real gap: 6.4 in particular is the only step in this entire change that verifies D7's analysis against a live database and WebSocket connection rather than a code trace. I have not attempted to start or drive a browser session myself, per instruction. This needs disposition — either someone runs 6.2–6.4 against a clean environment, or the team lead explicitly accepts the code-trace-only verification of D7 as sufficient for now. I'd lean toward not calling this change production-ready until at least 6.4 is run once for real, since D7's whole justification for deferring the participant-access gap rests on the claim being independently confirmed, not just traced.
