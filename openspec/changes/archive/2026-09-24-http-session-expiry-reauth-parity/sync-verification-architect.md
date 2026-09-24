# Sync Verification — http-session-expiry-reauth-parity

**Reviewer:** Ingrid Sollenberger, Solution Architect
**Date:** 2026-09-24
**Scope:** Verify no drift between the synced main specs (`http-session-expiry-signal`, `reauth-return-to`) and the shipped implementation, following Marcus Delgado's `opsx:sync` pass.

## Verdict

No drift found. The synced specs accurately describe the implementation as it exists in `packages/frontend/src/http/sessionExpiry.ts`, `SessionLobbyPage.tsx`, `DraftSessionHost.tsx`, `SessionCreationPage.tsx`, `MemberManagement.tsx`, and `packages/backend/src/routes/auth.ts`. Task 4.6's human sign-off is present and complete; tasks.md is fully checked off (7.1's follow-up issue filed as #159).

## What I verified

**The one drift Marcus's sync already fixed.** Confirmed correct: `spec.md` line 50 now states `SessionLobbyPage.tsx`'s `start` and `begin-voting` POSTs are `role="facilitator"` unconditionally. The shipped code (`handleStartSession`, `handleBeginVoting`) hardcodes `role: "facilitator"` in both `setReauthRequired` calls with no conditional — matches. No further trace of the earlier-draft "conditionally participant vs. facilitator" language remains in spec.md or design.md.

**Shared detection helper (`sessionExpiry.ts`).** Matches `http-session-expiry-signal` spec's first requirement exactly: `status === 401 && category === "session_expired"`, single `res.json()` read guarded against throw (resolves `body: null`), returns `{ isSessionExpired, body }`, no pre-parsed body accepted. Confirmed `AuthErrorCategory` in `packages/shared/src/types/auth.ts` includes both `"session_expired"` and `"provider_unavailable"`, and `middleware.ts`'s `onRequest` hook (lines 156-242) produces both on the branches design.md's Context section describes — the `provider_unavailable` branch this design's Decision 1 is built around is real and reachable (line 231).

**No-partial-execution guarantee's structural dependency.** Design.md Decision 4 claims this guarantee holds because `authMiddleware`'s `onRequest` hook is registered on the root `app` before `teamRoutes`/`sessionRoutes`/`facilitatorSessionRoutes`. Confirmed directly in `app.ts`: `authMiddleware(app)` at line 101, all three route registrations after it. This is the one claim in this design that would silently break the "cannot be undone" copy on `DraftSessionHost.tsx` if a future refactor reordered registration — worth an architectural note (see below), not a drift finding.

**Call-site-by-call-site `role`/`returnTo` wiring**, all matching spec.md and design.md Decision 1a exactly:
- `SessionLobbyPage.tsx`: `action-items-review` GET and the WS-driven detector both use `reauthRoleProxy(session)` (`canFacilitateSessions` proxy); `start`/`begin-voting` POSTs hardcode `"facilitator"`. Single shared `reauthRequired` gate via `prev ?? {...}`, one top-level early return before the four-branch render tree — matches Decision 2's "structural home for the gate" prescription precisely, including the idempotency-by-construction property.
- `DraftSessionHost.tsx`: both call sites `role="facilitator"`, no-partial-execution verified in code (the 401 branch returns before any `setLoadState`/`setAdvanceState` success mutation).
- `SessionCreationPage.tsx`: both call sites `role="facilitator"`, `returnTo` hardcoded to `"/sessions/new" + window.location.search` rather than `window.location.pathname + window.location.search`. This looks like a deviation from spec.md's general wording ("the current page's path and query string (`window.location.pathname + window.location.search`)") but is not: `tasks.md` 5.1/5.2 explicitly specify this exact formula for this page ("`/sessions/new` (this page's fixed route) + current query string"), and the route is mounted at the literal static path `/sessions/new` with no dynamic segment (confirmed in `App.tsx`), so the two formulas are always equal in practice. Not a drift — a sanctioned, harmless special case, already recorded in a synced artifact. One nit: the code comment attributes this to "design.md Decision 3," which only covers the allow-list regex, not returnTo computation — the correct citation is tasks.md 5.1/5.2. Cosmetic; not worth a follow-up task.
- `MemberManagement.tsx`: `submitRoleChange` PATCH, `role="facilitator"` (suppression semantics, not a facilitator claim, per Decision 1a/7 — code comment states this correctly), `returnTo` = `window.location.pathname + window.location.search`, no new allow-list entry (existing `/team/:id` already covers `/team/:teamId`) — confirmed no allow-list change was made for this call site.

**`reauth-return-to` / `auth.ts`.** `RETURN_TO_ALLOW_LIST` has exactly the four entries spec.md's allow-list requirement names, in the same order design.md Decision 3 specifies. Character-rejection checks run before the allow-list match, on the raw value, per spec. `GET /callback` retrieves `returnTo` from the same `redis.getdel` call that reads the rest of the state payload (one atomic read, not a second lookup) — matches the "same atomic read" claim literally. Precedence order (`pendingJoinToken` before `returnTo`) matches code exactly (`if (stateData.pendingJoinToken) {...} else if (stateData.returnTo) {...}`).

**Out-of-scope surfaces stayed out of scope.** `MemberManagement.tsx`'s `loadMembers` GET still uses its pre-existing generic `setFetchError("Failed to load team members.")` with no `detectSessionExpiry` call — correctly left alone, consistent with spec.md's "does NOT cover" list and tasks.md 7.1's filed follow-up (issue #159).

**Task 4.6.** Both screenshots present (`4.6-confirm-step-before.png`, `4.6-reauth-required-after.png`); tasks.md records a human sign-off dated 2026-09-24 with the specific visual-distinction findings (label text, amber border, lock icon, position — not color alone) design.md Decision 6 called for. No open items remain in tasks.md.

## Architectural note (non-blocking)

The no-partial-execution guarantee this change's `DraftSessionHost.tsx` copy depends on is correctly implemented today, but its safety rests on hook *registration order* in `app.ts`, not on anything enforced by a test or a type. Design.md already names this risk explicitly ("a future refactor that moved a route plugin's registration ahead of `authMiddleware`... would silently reintroduce a partial-execution race without touching `middleware.ts` at all"). I have no action to request here — this is a known, named, accepted risk, not an undocumented one — but flagging it as the kind of implicit architectural decision (hook ordering as a correctness dependency) that's easy to violate by accident in an unrelated future PR. Worth a lightweight regression test asserting registration order if this area is touched again; not blocking for this change.

## Items requiring no further action

- The `/sessions/new` returnTo comment citation nit above.
- The deferred `loadMembers`/EM-pages/`teams.ts` category-fix scope is correctly tracked (issue #159), not silently dropped.
