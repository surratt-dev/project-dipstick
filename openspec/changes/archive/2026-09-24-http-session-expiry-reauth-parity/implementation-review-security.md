# Security Review — http-session-expiry-reauth-parity (Implementation)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** `returnTo` allow-list additions (Decision 3), no-partial-execution guarantee (Decisions 4/7), `role="facilitator"` usage at `submitRoleChange` (Decision 1a), and new-attack-surface check on the shared frontend helper.
**Verdict: Approved.** No findings that block. Two observations below, both informational.

---

## 1. `RETURN_TO_ALLOW_LIST` additions — verified directly in code

`packages/backend/src/routes/auth.ts:73-82`. Both new entries are anchored `^...$` (not prefix-match), UUID segments use the same `UUID_PATTERN` constant as the pre-existing entries, and the optional trailing query string is the same `(?:\\?.*)?$` suffix used everywhere else in the list. I checked this is a real anchor and not, say, a missing `$` that would let `/sessions/new/../../evil` or similar slip through via a partial match — it isn't; `test()` against a full-anchored pattern requires the entire string to match.

`validateReturnTo` (`auth.ts:110-124`) runs `rejectReturnToCharacters` before the allow-list check, unconditionally, for every value regardless of which entry it will eventually match — there's no per-entry bypass path. That function rejects raw CR/LF, backslash, `://`, and leading `//` (`auth.ts:94-100`). I confirmed both new entries are ordinary array members evaluated by `RETURN_TO_ALLOW_LIST.some(...)` on line 116 — no special-cased second code path for the new shapes that might skip the character gate.

The `/sessions/new` literal-path entry is, as design.md flags, the first non-UUID-anchored shape in the list. Verified it's exactly as restrictive as the others in practice: it's a fixed string with no variable segment, so there's no way to broaden what it accepts short of editing the literal itself. Comment at `auth.ts:77-80` explicitly names this as deliberate and narrow, consistent with the design's own risk mitigation.

Also confirmed against the frontend call sites that produce these values:
- `DraftSessionHost.tsx` computes `returnTo` as `window.location.pathname + window.location.search`, and its route (`App.tsx:124`, `/team/:teamId/session/:sessionId`) matches the new combined-path pattern exactly.
- `SessionCreationPage.tsx` computes `returnTo` as `"/sessions/new" + window.location.search`, matching the new literal entry.

No finding. Both additions are correctly anchored and go through the same rejection gate as the pre-existing entries.

## 2. No-partial-execution guarantee — test verified against real middleware, not a simulation

Read `packages/backend/src/app.ts:90-112`: `authMiddleware(app)` is registered on the root `app` instance at line 101, before `teamRoutes` (108→ actually 107) and `facilitatorSessionRoutes` (111) are registered. Fastify hook encapsulation means a hook added to a parent context runs for every child context registered afterward — so every mutating route this change touches (`advance`, `submitRoleChange`) sits behind the real `session_expired` 401 short-circuit unconditionally.

`http-session-expiry-no-partial-execution.test.ts` (`packages/backend/src/routes/__tests__/`) reproduces this ordering faithfully:
- It imports the real `authMiddleware` from `../../auth/middleware.js` (line 67) — not a hand-rolled stand-in.
- It registers `authMiddleware(app)` (line 96) before `facilitatorSessionRoutes` (97) and `teamRoutes` (98), matching `app.ts`'s actual registration order.
- What it fakes is only the session *data* shape (a plain object with `userId`, `sessionCreatedAt`, etc., installed via its own `onRequest` hook ahead of `authMiddleware`'s) — it does not fake `@fastify/session` plugin behavior, which is irrelevant here since `authMiddleware` only reads fields off `request.session`, it doesn't touch session-plugin internals directly. This is a legitimate simulation of session *state*, not a weakened simulation of the *middleware logic under test* — the 401 short-circuit itself is the real production code path.
- The assertion (`mockDbConnect` never called) is the right one: both `advance` and `submitRoleChange` open their mutation via `db.connect()` for a transaction, and the test's `db.js` mock lets `db.query` resolve normally (for `authMiddleware`'s own audit-write side effects) while asserting `db.connect` is untouched — this can only pass if the route handler body genuinely never ran.

I independently traced `authMiddleware` (`middleware.ts:155-242`) to confirm the absolute-lifetime branch (line 169-181) returns before any route-specific logic executes, and that `app.ts`'s registration order is what the test replicates. The guarantee holds as designed, and the test that certifies it is testing the real mechanism.

No finding.

## 3. `role="facilitator"` at `MemberManagement.tsx`'s `submitRoleChange` — confirmed non-authorization use, no confused-deputy risk

`MemberManagement.tsx:203-204` renders `<ReauthRequiredTreatment role="facilitator" returnTo={...} />` on a disclosed session-expiry 401 from the role-change PATCH. Traced `ReauthRequiredTreatment.tsx`: `role` is consumed in exactly one place (line 135-140) — to decide whether to append the vote-loss sentence to the displayed copy. It has no other effect: no prop threading into a fetch, no conditional CTA behavior, no authorization check anywhere in that component.

Confirmed the actual role-change authorization is fully separate and server-side: `checkAssignRolesAuthorization` (`packages/backend/src/routes/teams.ts:326-359`) does its own DB lookup of `users.global_role` and `team_memberships.role` for the *actor*, independent of anything the frontend sent or rendered. The PATCH body's `role` field (the *target* member's new role) and the frontend's `role="facilitator"` UI-copy prop share a name but are unrelated values on unrelated sides of the request — there's no code path where the copy prop influences the authorization check or vice versa.

This is a UI-label choice, not a claim asserted to the server, and it cannot be leveraged to imply facilitator status for any actual authorization decision. No finding.

## 4. New attack surface via `sessionExpiry.ts` — none found

Reviewed `packages/frontend/src/http/sessionExpiry.ts` in full (37 lines). It does exactly one thing: reads a `Response` body once (guarded try/catch, falls back to `body: null` on parse failure — no throw path that could be abused to bypass a caller's error handling) and returns a boolean plus the raw parsed body. It does not:
- Perform any navigation itself (navigation stays in `ReauthRequiredTreatment`, unchanged from prior shipped code, going only to same-origin `/auth/login?returnTo=...`).
- Render anything (no JSX, no string interpolation into HTML).
- Read or write `returnTo` — every caller computes that from `window.location.pathname + window.location.search` (or the fixed `/sessions/new` literal), matching pre-existing call sites exactly; the helper never sees or touches it.

Checked `ReauthRequiredTreatment.tsx`'s message rendering: all display text (`REAUTH_REQUIRED_TEXT_BASE`, the vote-loss sentence) is a compile-time constant, not derived from the fetched body — the `body`/`message` value the helper returns is used by callers only inside `setRoleChangeState`/`startError`/etc. for their own *generic-error* branches (non-session-expiry case), rendered via ordinary JSX text interpolation (`{message}`), which React escapes by default. Grepped all four touched files plus `ReauthRequiredTreatment.tsx` for `dangerouslySetInnerHTML` — zero matches.

`returnTo` itself never determines client-side navigation directly — it's appended to a same-origin `/auth/login` URL via `encodeURIComponent`, and the actual cross-page redirect happens only after the backend re-validates it against `RETURN_TO_ALLOW_LIST` server-side (§1 above). Even a caller that computed a malicious `returnTo` (none do, since all values come from `window.location`, not user input) could not achieve an open redirect through this path — the backend allow-list is the enforcement point, and it's unchanged in mechanism, only additive in entries.

No new attack surface introduced. No finding.

---

## Informational observations (non-blocking)

1. **Pre-existing gap, correctly left out of scope.** `AuthContext.tsx`'s `/auth/session` 401 handling still does an unconditional `window.location.href` navigation with no `returnTo`, noted as a forward note in design.md. This is a real behavioral seam (silent bounce on page refresh vs. a disclosed banner on an in-flight action) but is explicitly not touched by this change, and I agree it's reasonable to defer — it's not a regression this change introduces.
2. **`session?.canFacilitateSessions` role proxy (Decision 1a).** I confirm, as design.md states, that a wrong guess here only changes which sentence renders in `ReauthRequiredTreatment` — it has no bearing on any authorization decision. This is consistent with my read of the component (§3 above). Acceptable as designed.

## Summary

Verified directly against the code, not just against the design narrative:
- Allow-list additions are exact-match, UUID/literal-anchored, and share the existing character-rejection gate.
- The no-partial-execution test exercises the real `authMiddleware` ahead of the real route plugins, in the same registration order as `app.ts`, and asserts the correct signal (`db.connect()` never called).
- `role="facilitator"` at `submitRoleChange` is UI-copy-only and cannot be used as, or confused with, a facilitator authorization claim.
- The shared `sessionExpiry.ts` helper introduces no navigation, rendering, or redirect logic of its own, and no XSS or open-redirect path was found across the four touched call sites.

No blocking findings. Implementation matches the security-relevant design decisions.
