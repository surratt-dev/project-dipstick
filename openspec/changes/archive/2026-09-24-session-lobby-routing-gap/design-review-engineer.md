## Design Review — Full Stack Engineer (Marcus Oyelaran)

**Change:** `session-lobby-routing-gap`
**Scope of this review:** implementability, boundary cleanliness, technology fit, hidden coupling, missing error paths, accuracy of the design's claims against the current codebase.

### Verdict

Not implementable as scoped without a correction. D1–D3 and D5 are accurate and low-risk — I checked them line-by-line against the actual code and they hold up. D4 does not: the design and proposal both assert this change touches **zero backend code**, and that claim is false. The join-link landing rule the delta spec rewrites is implemented server-side, in two independent places, neither of which is named anywhere in design.md, proposal.md, or tasks.md. This has to be fixed before implementation starts, not discovered mid-task.

---

### Finding 1 (Blocking) — D4 is a backend change; the design says it isn't, and misses that there are two call sites, not one

`design.md` Non-Goals: *"Any backend change. `POST /start`, `GET /action-items-review`, and join-redemption are unchanged; this is routing/wiring plus copy alignment only."*
`proposal.md` Impact: *"**Backend:** none... this is a frontend routing/wiring fix only."* Impact also files the join-link change under **Frontend**: *"the join-link post-redemption redirect logic (landing-rule replacement)."*

I read the actual redirect logic. It isn't frontend code at all — there's no client-side redirect decision to touch. It's a server-side SQL predicate plus `reply.redirect()`, and it exists in **two separate, independently-maintained locations**:

1. `packages/backend/src/routes/join-links.ts:202-216` — the direct join path (`GET /api/join/:token`, already-authenticated user):
   ```
   SELECT id FROM sessions WHERE team_id = $1 AND status = 'active' LIMIT 1
   ```
   redirects to `/session/${activeSession.id}` on a hit, `/team/${link.team_id}` otherwise.

2. `packages/backend/src/routes/auth.ts:764` (`executeJoinFlow`), lines 855-869 — the through-OIDC path (`GET /auth/callback` with a `pendingJoinToken`, used for a user who wasn't authenticated yet when they clicked the link):
   ```
   SELECT id FROM sessions WHERE team_id = $1 AND status = 'active' LIMIT 1
   ```
   same query, same redirect shape, copy-pasted rather than shared.

Both need the `status = 'active'` predicate replaced with the `IN ('lobby', 'pre_session', 'active')` check the delta spec requires. `join-link/spec.md`'s new requirement text doesn't distinguish which HTTP path it governs — correctly, since from a spec standpoint it's one requirement — but that means an implementer working strictly from design.md + proposal.md + the delta spec has no way to discover the second call site exists. Nothing in the packet points at `auth.ts` at all.

Consequence if this ships as-written: whoever implements task 5.1 ("Replace the join-link post-redemption landing logic's status check") most likely finds and fixes `join-links.ts` — it's the file literally named `join-links.ts` — and never finds `executeJoinFlow` in `auth.ts`, because nothing tells them to look. Result: a user who clicks a join link while already logged in gets routed correctly into a `lobby`/`pre_session` session; a user who clicks the same link and has to authenticate first does not. That's a silent, hard-to-notice split in behavior gated on session state at click time, and it directly undermines this change's own stated goal ("give Engineers a working landing on `/session/:sessionId` for every `SessionStatus` where a joining user should be kept with the in-progress session").

Task list confirms the gap: task 6.3 only says "run the full **frontend** test suite" for verification — there's no backend test run named for task 5, because the packet doesn't believe task 5 touches the backend.

**What needs to change:**
- Proposal.md's Impact section: move the join-link landing rule from Frontend to Backend, and name both files.
- Design.md's Non-Goals bullet needs to stop asserting "no backend change" — it's incorrect as written.
- Tasks.md 5.1 should explicitly enumerate both call sites (`join-links.ts` and `auth.ts`'s `executeJoinFlow`), and 5.2/6.3 should require both to be covered by tests and both exercised by a backend test run, not just a frontend one.
- Worth a design-level decision (not just a task note): should this duplicated query be extracted into one shared helper as part of this change, or is duplicating the fix across both sites (matching the existing duplication) acceptable? The design doc doesn't raise this question because it doesn't know the duplication exists. I'd lean toward extracting a shared `resolveJoinLandingSession(teamId)` helper now, precisely because this is the second time the two paths have had to stay in sync by hand — but I'll defer to whoever owns this decision if there's a reason to keep them separate.

---

### Verified accurate — no changes needed

- **D1 (Start Session control on `DraftSessionHost`).** `openTheRoom()` (`DraftSessionHost.tsx:98-128`) does exactly what D1 says it reuses: POST, on success `setLoadState` with `currentSessionState` overwritten in place, no navigation; on failure, `setAdvanceState({ phase: "failed", message })` with the same component staying mounted. The pattern is real and reusable as described. `FacilitatorSessionStateResponse.currentSessionState: SessionStatus` (`packages/shared/src/types/team-content-access.ts:211`) matches D1/D2's typing claims exactly. `DraftSessionHost` is confirmed facilitator-only via `facilitator_id === caller` on `GET .../facilitator-state` (per the file's own header comment) — D1's "no additional gating needed" holds.

- **D2 (navigate link, trigger condition).** The design's cited dead end is real: `data.currentSessionState !== "draft"` (`DraftSessionHost.tsx:184`) renders the same static `<p>The room is open. Session status: {data.currentSessionState}.</p>` for every non-draft status alike, with nothing actionable for `pre_session`/`active`/`wrap_up`. The trigger condition D2 specifies (`pre_session`, `active`, `wrap_up` render the link; `complete`/`abandoned` don't) is unambiguous and directly implementable as an added conditional inside the existing `data.currentSessionState !== "draft"` branch — I don't think an implementer has to guess here. One nit: design.md cites the dead-end render as `DraftSessionHost.tsx:184-208`; current file has it at 184-210 (the `renderCopyControl` closing tag pushes it two lines). Immaterial to implementation, but if this doc is meant to be a durable reference, worth a quick correction.

- **D4's seven-value enumeration itself.** `SessionStatus` (`packages/shared/src/types/session.ts:3-10`) is exactly `draft | lobby | pre_session | active | wrap_up | complete | abandoned`, matching the delta spec's enumeration verbatim. The two-bucket partition is exhaustive over the real type. (The enumeration's *content* is right — it's only the claim about where it's implemented that's wrong, per Finding 1.)

- **D5 (copy alignment) / hidden coupling with tests.** I checked `SessionLobbyPage.test.tsx` for anything D5 would break. The `lobby`-branch tests assert on `data-testid` values (`session-lobby-info`, `session-lobby-waiting`, `start-session-button`), never on the literal heading text or the raw-`sessionId` string in the waiting copy. No test asserts `"Session Lobby"` as literal text via `getByText` or a snapshot. D5's copy/heading changes (drop raw `sessionId`, add reassurance line, align heading/label with `DraftSessionHost`) are safe against the existing suite as it stands today — I don't see a hidden snapshot-breakage risk here. `SessionLobbyPage.test.tsx`'s "6.4" test (no Start Session/advance control for non-facilitator) exists and matches design.md D4's citation.

---

### Minor observations, not blocking

- **D3's "consequence accepted" framing is honest and matches the code.** `SessionLobbyPage`'s access model is genuinely `evaluateSessionSubscriberAccess`-shaped (serves facilitator and participants from one endpoint), and `DraftSessionHost` genuinely has no WebSocket subscription today — reimplementing subscribe-before-fetch ordering there would be real, non-trivial work, not a copy-paste. Declining to take that on in this change is the right scope call.
- **Non-Goal "no backend change" for `POST /start` and `GET /action-items-review` themselves** is correct — I confirmed neither of those route handlers needs modification for anything D1–D3/D5 ask for. It's specifically the join-link landing rule (D4) that the "no backend change" umbrella incorrectly swept in.
- Once Finding 1 is corrected, I'd want task 6.3's manual/automated verification step to explicitly include "join link clicked pre-auth, forcing the OIDC round-trip, while session is `lobby`" as a scenario — today's task 6.2 doesn't distinguish pre-auth vs already-authenticated join, and that's exactly the seam Finding 1 identifies as likely to diverge.

---

### Summary for the record

Everything scoped to the frontend (`DraftSessionHost.tsx`, `SessionLobbyPage.tsx`) is well-specified, verified against the real code, and implementable without guessing. The one real defect is systemic to how D4 was scoped: the design and proposal both state, twice, in different documents, that this change makes no backend change — and the requirement they're replacing is entirely backend logic, present in two files. Fix the Impact/Non-Goals language, name both call sites explicitly in tasks.md, and add a backend test-suite run to the verification step. I don't think this requires a new design decision beyond the shared-helper question I flagged — it's a scoping correction, not a rethink of D1–D5.
