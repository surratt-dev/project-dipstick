# Security Review — `http-session-expiry-reauth-parity`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewed:** `design.md`, `proposal.md`, `tasks.md`
**Also consulted (for direct verification, not part of this change's own scope):** `packages/backend/src/auth/middleware.ts`, `packages/backend/src/app.ts`, `packages/backend/src/routes/teams.ts` (`checkAssignRolesAuthorization`, the `PATCH .../role` handler), `packages/backend/src/routes/auth.ts` (`RETURN_TO_ALLOW_LIST`, `rejectReturnToCharacters`, `validateReturnTo`), `packages/frontend/src/App.tsx`, `packages/frontend/src/components/MemberManagement.tsx`, `packages/frontend/src/components/ReauthRequiredTreatment.tsx`, and the archived `2026-09-22-session-timeout-continuity` and `2026-09-24-auth-events-audit-log-coverage` changes.

## Overall assessment

This is a client-side routing change riding on top of authorization and audit-logging machinery that already shipped, correctly, in prior changes. It introduces no new authorization decision, no new backend route, and — as designed — no new attack surface beyond two additive, narrowly-scoped `returnTo` allow-list entries. I went and checked the four things I was asked to check directly against the running code rather than the design's prose, and all four hold. I have no blocking findings. Two informational notes below are worth one sentence each in the design so a future reader doesn't have to re-derive them the way I just did.

---

## Verification 1 — No-partial-execution guarantee for `submitRoleChange` (and the pre-existing mutating call sites): CONFIRMED, and it's an architectural guarantee, not a per-route one

Decision 4 and Decision 7 both assert that a `session_expired` 401 on a POST/PATCH means the mutation never ran server-side, because `authMiddleware`'s check happens in `onRequest`, before any route handler. I verified this three ways:

1. **The hook itself.** `middleware.ts:156` (`authMiddleware`) registers `app.addHook("onRequest", ...)`. The `!session?.userId` check (line 164), the absolute-lifetime check (line ~180), and the `revoked` refresh-result branch (line ~215) are the only three places `category: "session_expired"` is produced, and all three `return reply.code(401).send(...)` immediately — there is no code path in this hook that falls through to a route handler after sending a 401.
2. **Registration order.** `app.ts:101` calls `await authMiddleware(app)` directly on the root `app` instance — not inside a scoped `app.register(...)` block — and every route plugin this change touches (`teamRoutes`, `sessionRoutes`, `facilitatorSessionRoutes`) is registered *after* that call (`app.ts:107-111`). Fastify's hook encapsulation model means a hook added to a parent context is inherited by every child context registered afterward. This isn't something that needs re-verifying per route file; it's a property of where the hook lives in `app.ts`, and it applies uniformly to `start`, `begin-voting`, `advance`, `sessions/draft`, and `submitRoleChange` alike.
3. **The handler itself has no independent session-expiry path to race against.** I read `teams.ts`'s `PATCH /api/v1/teams/:teamId/members/:userId/role` handler (lines 714–950) end to end. It reads `request.session` only to get `session.userId` for `checkAssignRolesAuthorization` — it does not re-check expiry, and there is no alternate 401 it could produce for the same cause. The zero-participant 422/confirm flow (lines 943–946) and the transactional audit write (per its own header comment, "written in the same DB transaction as the UPDATE") both sit well after where `onRequest` would already have short-circuited.

Conclusion: the guarantee is real, and it's real for the same structural reason across every in-scope mutating call site, not something that happens to hold four times by coincidence. Nothing in this design needs to change here.

**One thing worth stating explicitly in Decision 4 (currently only stated for `advance`):** the guarantee's dependency is "the hook stays registered on the root `app` instance, ahead of every route plugin." Decision 4 already flags what breaks the guarantee at the `authMiddleware` level ("moves any part of the session-expiry check into the route handler itself"); it's silent on the app-wiring level. A future refactor that moves `teamRoutes` registration earlier, or wraps `authMiddleware` in its own scoped `register()` block, would silently reintroduce a race without touching `middleware.ts` at all. This is unlikely and not something I'd block on — just worth one clause so the guarantee's real dependency surface is written down somewhere, not only inferred from reading `app.ts`.

---

## Verification 2 — `/sessions/new`'s literal-path allow-list shape: safe, and not a different attack surface

I checked `auth.ts` directly. `RETURN_TO_ALLOW_LIST` entries are matched with `RegExp.test()` against patterns anchored `^...$` (`auth.ts:74-75`), and `rejectReturnToCharacters` — which rejects raw CR/LF, backslash, `://`, and leading `//` — runs *before* the allow-list check, unconditionally, on the raw value (`validateReturnTo`, `auth.ts:104-114`). Both of these apply to any new entry exactly as they apply to the existing two; the design doesn't propose changing either.

Given that, `new RegExp('^/sessions/new(?:\\?.*)?$')`:
- Is an **exact match**, not a prefix match — the trailing `$` (after the optional query-string group) means `/sessions/new/anything` and `/sessions/newer` do not match, matching tasks.md 2.3's stated test cases. There's no way for this shape to degrade into a prefix match without someone deliberately removing the `$` anchor, which would be an obvious diff to catch in review.
- Is **strictly more restrictive** than a UUID-anchored entry, not less — a UUID-anchored pattern accepts an unbounded set of values (any well-formed UUID); a literal-path pattern accepts exactly one string (plus its query-string tolerance). "First non-UUID shape in the list" is a style observation, not a weaker security property, and the design already frames it that way (Decision 3, Risks section) rather than glossing over it.
- Gets no benefit and no exposure from being case-sensitive or Unicode-normalization-naive — a decoded value that isn't byte-for-byte `/sessions/new` simply fails the regex and falls through to rejection, same as today's `/session/:id` handling of a malformed UUID.

I don't have a finding here. The design's own Risk entry ("a future contributor could read it as license to add other loose literal paths") is the right thing to flag, and it's already mitigated the right way — by naming it explicitly as a deliberate, narrow exception rather than leaving it to be inferred from the diff. I'd suggest keeping that framing intact through implementation (e.g., a one-line comment at the new entry itself, not just in `design.md`), but that's already what tasks.md 2.1/2.2 imply and I'm not asking for more than what's planned.

---

## Verification 3 — Routing `submitRoleChange`'s 401 through the shared reauth UI: no information leak, no confused-resubmission risk

Two sub-questions here, both checked against real code rather than assumed from the design's prose:

**Does it leak what operation was in flight?** No new disclosure to anyone. `ReauthRequiredTreatment` (I read the component directly) renders one fixed, cause-blind sentence plus an optional vote-loss clause gated only on `role` — it has never taken a prop describing which call site triggered it, and this design adds none. The only party who can see this treatment is the same authenticated user who was already looking at `MemberManagement.tsx` a moment earlier; nothing about *which* page/action produced the 401 is exposed to any other actor. This is a same-user UX question, not a cross-boundary disclosure one, and it's out of scope for what I'd normally flag as a leak.

**Does it risk a confused re-submission?** I read `MemberManagement.tsx`'s `submitRoleChange` (lines 122–186) and `teams.ts`'s two-step confirm flow (422 `requiresConfirmation` → re-submit with `confirmedZeroParticipant: true`, `teams.ts:943-946`) directly, and Decision 7 / tasks.md 6.4's claim holds: `roleChangeState.status === "awaiting_confirmation"` is plain `useState`, not persisted anywhere. A session expiring mid-confirm and later returning via `returnTo` lands the user on `MemberManagement.tsx` with `roleChangeState` reset to its initial `{ status: "idle" }` — there is no code path that could replay the pending PATCH automatically, confirmed or not. The user has to click through the whole two-step flow again, deliberately, with the server re-running `checkAssignRolesAuthorization` and the zero-participant check fresh each time against current data. There's no "stale confirm state fires an unintended write" scenario here — the worst case is the user has to re-click, which is the correct and already-named trade-off (Decision 7's "named limitation").

No finding. This is the right design for the failure mode it's addressing.

---

## Verification 4 — Audit-logging posture: consistent, and correctly requires no new work here

I checked this against `middleware.ts` directly rather than taking the design's claim at face value. Both `category: "session_expired"` branches this design's detection helper cares about — the absolute-lifetime cutoff (`middleware.ts:~180`) and the `revoked` refresh outcome (`middleware.ts:~215`) — already call `writeSessionInvalidatedAuditRow(...)` (a durable `audit_log` row, per the archived `2026-09-18-http-auth-audit-log-coverage`/`2026-09-24-auth-events-audit-log-coverage` work) and `emitAuditEvent(..., "auth.session_invalidated", ...)`, **at the moment the 401 is produced on the server**, entirely independent of whether, or how, any client ever reacts to that 401. This design adds a client-side *reader* of an event that is already fully audited before this change's code runs at all. There is no new audit-log expectation for this change to satisfy, and the design is correct not to invent one — I checked for a gap and didn't find one.

**One thing worth one sentence in the design, informational only, not a finding against this change:** the third `session_expired` branch — `!session?.userId` (`middleware.ts:164`, no session/user at all) — does **not** call `writeSessionInvalidatedAuditRow` or `emitAuditEvent`. That's pre-existing behavior in a file this design doesn't touch, and it's consistent with the same reachability reasoning the archived `auth-events-audit-log-coverage` change used to defer `auth.authorization_initiated`/`callback_received` (this branch is reachable by any request with no valid session cookie at all — including unauthenticated probing — so a durable row per occurrence would be an attacker-triggerable write). I'm not asking this change to fix that; it's out of scope by design (`design.md`'s own Non-Goals already excludes "any change to `authMiddleware`'s detection logic"). I'm naming it only so nobody reads this design's audit-logging silence as covering *all three* `session_expired` branches equally — it covers the two that are already durably audited, and the third was never in question because it isn't reachable from any of this change's six call sites in a way that matters (a genuinely session-less request never gets far enough to hit `SessionLobbyPage.tsx`'s or `MemberManagement.tsx`'s fetch calls in the first place — this only matters for someone reading `middleware.ts` cold and assuming uniform coverage).

---

## Positive notes (no action needed)

- **`returnTo` still does exactly what it says: a destination, not a grant.** I re-confirmed nothing in this design's allow-list additions or call-site wiring touches authorization. Every destination this change can route to re-runs its own server-side checks on landing (`SessionCreationPage.tsx`'s `canFacilitateSessions` gate, `DraftSessionHost.tsx`'s facilitator-state fetch, `MemberManagement.tsx`'s mount-time `loadMembers`), exactly as `reauth-return-to`'s existing "does not grant, infer, or bypass any authorization" requirement demands. This design changes nothing about that guarantee's mechanism — it only adds two more values that can be *stored* in it.
- **Provider-agnosticism holds.** Consistent with the standing project constraint that OIDC support isn't Entra-only: `/auth/login?returnTo=...` and the `RETURN_TO_ALLOW_LIST` check are both IdP-blind (the allow-list matches application route shapes, not anything provider-specific), and this design adds no IdP-aware code anywhere, as it claims.
- **The shared-helper approach is the right secure-default shape.** Six call sites independently re-implementing `status === 401 AND category === "session_expired"` is exactly the kind of duplicated security-relevant check that drifts — one site correctly checks `category`, another checks bare `status === 401` and mis-routes an unrelated 401, and nobody notices until it's inconsistent in production. One shared, owns-the-body-read helper (Decision 1) closes that off structurally rather than relying on six implementers getting it right independently.
- **The dual-signal idempotency design on `SessionLobbyPage.tsx` (Decision 2) doesn't create a new race to worry about.** Both signals are independently authoritative evaluations of the same real fact (session age vs. `ABSOLUTE_LIFETIME_MS`), not two unreliable guesses arbitrated against each other — there's no scenario where the "wrong" one fires and does something the "right" one wouldn't have. The first-wins/second-no-op gate is a UI-flicker concern, not a security one, and I have nothing to add here beyond agreeing with the design's own reasoning.

---

## Summary for the architect

No blocking findings. Two informational notes, both one sentence each, neither changes any decision in this design:

1. Decision 4's no-partial-execution guarantee depends on `authMiddleware`'s hook staying registered ahead of every route plugin at the `app.ts` wiring level, not only on `middleware.ts`'s own internals staying unchanged — worth naming as part of what would need re-verifying, alongside the condition already stated.
2. The audit-logging note in Decision-adjacent text (or Impact) could clarify that the two `session_expired` branches this change's detection actually encounters are already durably audited server-side; the third (`!session?.userId`) isn't part of that guarantee, isn't reachable from any of this change's six call sites in a way that matters, and was never a gap this change needed to close.

This is implementation-ready from a security standpoint as written.
