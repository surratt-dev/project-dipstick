# Security Review — Implementation — `pre-session-action-item-review`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Reviewed against:** `design.md`, `design-review-security.md` (my earlier design-stage review, findings F1–F4)
**Shipped code verified directly:** `packages/backend/src/routes/facilitator-sessions.ts`, `packages/backend/src/auth/session-subscriber-access-helper.ts`, `packages/backend/src/content/timing-oracle.ts`, `packages/backend/src/auth/middleware.ts`, `packages/backend/src/app.ts`, `packages/shared/src/types/session.ts`, `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts`

## Overall assessment

All four design-stage findings are closed in the shipped code, and I verified each against the actual diff and running tests rather than the design prose alone. No new attack surface. This is the review I wanted to see: the two MEDIUM findings (F1, F2) are structurally hardwired into the handler rather than left to a code-review convention, and the two LOW/documentation findings (F3, F4) are addressed exactly as I recommended. Cleared for production from a security standpoint.

---

## F1 — Timing floor: CLOSED, verified

`GET /api/v1/sessions/:sessionId/action-items-review` (`facilitator-sessions.ts:546-595`) starts `const startTime = Date.now()` at handler entry and calls `await applyTimingFloor(startTime)` immediately before every one of the three response sends — the `404` (line 556), the `409` (line 580), and the `200` (line 591). I read `timing-oracle.ts` directly: the floor is a constant minimum (`TIMING_FLOOR_MS`, currently the 150ms development placeholder, with a startup guard that throws if `NODE_ENV=production` and the placeholder hasn't been replaced — that guard is pre-existing infrastructure this endpoint correctly rides on, not something this change needed to add). The floor is applied unconditionally on every path, not just success, which is exactly what closes the timing side-channel I raised at design time.

Test coverage matches: `facilitator-sessions.test.ts:734-802` (the "F1/F2 regression coverage" describe block) asserts `mockApplyTimingFloor` is called exactly once on each of the 404/409/200 paths. I checked this isn't a rubber-stamp mock assertion — the test suite's structure (`mockApplyTimingFloor` as a real spy on the imported function, called with `expect.any(Number)`) is sufficient to catch a regression where a future edit adds a fourth response path and forgets the floor.

**No further action.**

---

## F2 — `Cache-Control: no-store`: CLOSED, verified

`reply.header("Cache-Control", "no-store")` appears on all three response paths (`facilitator-sessions.ts:557, 581, 592`), matching `content.ts`/`em-views.ts`'s blanket-policy pattern exactly as I recommended. Verified with a direct test as well: `facilitator-sessions.test.ts:775-801` asserts `res.headers["cache-control"]` is `"no-store"` on the 404, 409, and 200 responses in one test, not three separate ones that could silently drift.

**No further action.**

---

## F3 — TOCTOU trade-off: CLOSED as documentation, decision is sound

The design took option (b) from my two alternatives — keep the two-read design, document the reopened guarantee — rather than option (a) (adding `sessionStatus` to the `participant` grant variant). I verified this was the right call, not just the cheaper one: `ws-event-dispatcher.ts`'s `dispatchActionItemStatusUpdated` documents, as load-bearing rationale, that `SessionSubscriberGrant`'s `participant` branch carries no `sessionStatus` and works around that absence deliberately. Changing the shared grant type would not have broken that code, but it would have made its own comment inaccurate and reached into a sibling capability's already-shipped design for a marginal gain. Risks/Trade-offs' closing bullet in `design.md` states the reopened guarantee explicitly, not just as a performance note — which is what I asked for.

Verified the actual code matches this framing: `evaluateSessionSubscriberAccess` (`session-subscriber-access-helper.ts:57-172`) is unmodified by this change (confirmed via `git log` — its only commit is the original `b09881f`), and the route's second read (`facilitator-sessions.ts:572-575`, a single-column `SELECT status FROM sessions WHERE id = $1`) is exactly the narrow, indexed lookup the design describes. The residual window is milliseconds and the caller was already authorized at the moment the grant was evaluated — I agree with the design's low-severity framing.

**No further action.**

---

## F4 — Audit logging omission: CLOSED as documentation, reasoning holds

Design's Risks/Trade-offs section states explicitly that ordinary reads through this endpoint are not audit-logged, and gives the precedent (`content.ts`'s `member`/`facilitator` reads aren't logged either; only `evaluateTeamAccess`'s admin-path denial is) and the reason it doesn't transfer (`evaluateSessionSubscriberAccess` has no admin path and excludes EMs at the query level, via a `null` grant, not a denial branch — there's no analogous "elevated role got denied" event to record). I re-verified the EM-exclusion claim directly in this pass, not just carried it forward from the design review: `session-subscriber-access-helper.ts:155-168`'s participant path rejects on `global_role === 'engineering_manager'` OR `membership_role === 'engineering_manager'`, and there is no third path. An EM calling this endpoint gets a `404` from a `null` grant — never a read — so it is not the same shape as the case this codebase does choose to audit.

**No further action.**

---

## Additional checks — attack surface not covered by the design review

I looked specifically for anything new the design review didn't already scope, per the task brief.

- **`sessionId` input validation.** No route-level schema validates `sessionId`'s shape before it reaches `evaluateSessionSubscriberAccess` or the second status query. Both queries are parameterized (`$1`/`$2` placeholders, `pg`'s driver) — no SQL injection surface regardless of input shape. A malformed value (non-UUID) would produce a Postgres type-coercion error rather than a crafted response; I checked for a global Fastify error handler that might leak driver error detail to the client and found none — this endpoint is consistent with every other session/team-scoped route in this codebase (`facilitator-sessions.ts`'s other ~15 routes take the same unvalidated `Params: { sessionId: string }` shape and rely on the same implicit behavior). This is a pre-existing pattern this change inherits rather than introduces; not a new finding against this change specifically, but worth a repo-wide note if the team ever adds route-level schema validation — it should land everywhere at once, not just here.
- **Error message content on 404/409.** The `404` body (`{ error: { category: "not_found", message: "Session not found.", correlationId } }`) and the `409` body (`{ currentSessionStatus, isFacilitator }`, no `message` field at all — `ActionItemsReviewWrongStatusResponse`, `packages/shared/src/types/session.ts:113-116`) both carry the minimum needed for the frontend's branching logic (Decision 3) and nothing else. Neither leaks the session's `teamId`, facilitator identity, participant list, or any action-item content. The `409`'s `currentSessionStatus` is the one intentional, designed information disclosure (an authenticated caller with standing on the wrong-status session learns its status) — already assessed and accepted in the design review, and I have nothing to add to that assessment.
- **Authentication is enforced globally, not opt-in per route.** Confirmed `authMiddleware` (`app.ts:101`) is registered before `facilitatorSessionRoutes` (`app.ts:111`), and the new route is not listed in `middleware.ts`'s `PUBLIC_ROUTES`. `request.session.userId` at line 550 is therefore a value the middleware has already validated, not client-controlled input — consistent with every other route in this file. No bypass path.
- **No admin/EM path exists anywhere in this endpoint's authorization chain.** Confirmed by reading the full grant helper: two paths only (`facilitator`, `participant`), no `admin` variant, and the EM-exclusion is structural (query-level `null`, not a role check downstream of a successful grant that a future refactor could accidentally leave unguarded).
- **`computeStalenessLevel`'s fix introduces no new information-disclosure surface.** It's a pure function over an integer already computed server-side (`sessionsSinceUpdate`) into one of four fixed string labels; the fix changes only the numeric boundaries (from `application_settings.staleness_threshold_sessions`-relative multipliers to fixed literals 1/2/3), not what data reaches the function, what data the function can return, or who can call it. Same caller, same authorization boundary, same data class. Verified the legend-agreement test exists as the design's own consequence required: `facilitator-sessions.test.ts:106-131` asserts `computeStalenessLevel(0|1|2|3|7)` against `none`/`yellow`/`orange`/`red`/`red` directly, so a future drift between the displayed legend and the computed level (the original bug this decision fixes) would fail a test rather than ship silently again.

## Summary for the architect

All four design-stage findings verified closed in shipped code, not just claimed closed in prose. No new findings. This endpoint is cleared from a security standpoint, contingent only on the pre-existing, already-tracked production blocker in `timing-oracle.ts` (the `TIMING_FLOOR_MS` placeholder-to-measured-value swap, gated by its own startup guard) — which is infrastructure this change correctly inherits rather than a gap it introduces.
