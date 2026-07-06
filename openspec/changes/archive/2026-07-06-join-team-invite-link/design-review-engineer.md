# Design Review: Join Team via Invite Link
**Reviewer:** Marcus Oyelaran, Full Stack Engineer
**Date:** 2026-07-05
**Files reviewed:** `design.md`, `proposal.md`, `packages/backend/src/routes/auth.ts`, `packages/backend/src/routes/join-links.ts`, `packages/frontend/src/pages/TeamPage.tsx`, `packages/frontend/src/pages/AuthErrorPage.tsx`, `packages/frontend/src/App.tsx`, `packages/backend/src/routes/__tests__/auth.test.ts`, `packages/backend/src/routes/__tests__/join-links.test.ts`, `packages/frontend/src/pages/__tests__/TeamPage.test.tsx`

---

## Summary

The design is largely correct on the backend mechanics. The `ON CONFLICT DO NOTHING RETURNING id` pattern is already proven in the codebase. The `executeJoinFlow` signature extension is safe. The `?newMember=true` replace-navigation pattern is already established and can be mirrored exactly.

Two issues require resolution before implementation begins. One is a gap in the design specification that will leave the developer with an implementation choice the design should have made. The other is a factual inaccuracy in the design that, if taken at face value, will produce a broken frontend.

---

## Finding 1 (Blocking): `executeJoinFlow` return type is unspecified but load-bearing

**Design section:** Decision 3, design.md; Impact section, proposal.md

The design identifies adding `sourceIp` to `executeJoinFlow`'s parameter list. It does not address the return type, but the return type must also change for the primary routing goal to be achievable.

The current signature is:

```typescript
async function executeJoinFlow(
  userId: string,
  token: string,
  logger: FastifyBaseLogger,
): Promise<{ redirectUrl: string | null }>
```

When the function returns `{ redirectUrl: null }`, the callback handler at `auth.ts:199-208` currently falls through to the standard membership lookup. The design wants it to instead redirect to `?joinError=expired` vs. `?joinError=invalid`. But the return type carries no error information — both "not found" and "expired/revoked" return `{ redirectUrl: null }`. The callback handler has no way to distinguish them.

The design must specify how error information is communicated back. Two viable approaches:

**Option A — Extended return type:**
```typescript
type JoinFlowResult =
  | { redirectUrl: string; error?: never }
  | { redirectUrl: null; error: 'expired' | 'invalid' };
```
The callback handler checks `joinResult.error` to select the redirect target.

**Option B — Error-as-redirect:**
`executeJoinFlow` constructs the full failure redirect URL internally and returns it as `redirectUrl`. Failures return `{ redirectUrl: '/join-error?joinError=expired' }` rather than `null`. The callback handler always uses `joinResult.redirectUrl` — no conditional logic on error type needed.

Option B is consistent with how `executeJoinFlow` currently handles the success case: it already owns the redirect URL construction for `/team/:teamId` and `/session/:sessionId`. Extending that responsibility to cover failure destinations is architecturally consistent. It also keeps the `null` sentinel unused, which is cleaner.

The design must pick one of these approaches and specify it. Leaving it implicit will produce diverging implementations depending on who reads the design.

**Required action:** Update `design.md` Decision 3 to specify the extended return type or the error-as-redirect approach.

---

## Finding 2 (Blocking): The join error page does not exist with `?joinError=` semantics

**Design section:** Decision 1, design.md

Decision 1 states:

> The join error page already reads and renders these parameters for the direct path.

This is not accurate. The direct path (`GET /api/join/:token` in `join-links.ts:115-153`) redirects to:
- `/auth/error?category=invalid_request&message=This link is not valid.`
- `/auth/error?category=invalid_request&message=This link has expired. Ask your facilitator for a new one.`

`AuthErrorPage.tsx` reads `category` and `message` query parameters. It does not read `joinError`. There is no join error page component, no `/join-error` route in `App.tsx`, and no existing handling of `?joinError=expired` or `?joinError=invalid` anywhere in the frontend.

This matters for two reasons:

**First:** The frontend work required is larger than the proposal accounts for. A new component must be created, or `AuthErrorPage` must be substantially extended. If a new component is created, a new route must be added to `App.tsx` — and the direct path in `join-links.ts` must also be updated to redirect to the new route, since Decision 1's stated goal is that "both paths converge on the same destination." The proposal's impact section lists `join-links.ts` only for an inline comment — not for error redirect target changes. That's an underspecified scope.

**Second:** If the implementation takes the path of least resistance and routes through-auth failures to `/auth/error?category=invalid_request&message=...` (reusing the existing mechanism instead of implementing the specified `?joinError=` approach), the result will appear to work but will have a UX defect. `AuthErrorPage.tsx:26-39` shows a "Try Again" button whenever `category === 'invalid_request'`. For a join-error landing, this button calls `window.location.href = '/auth/login'` — which initiates OIDC without a join token. A user who followed an expired link, authenticated, and landed on the error page will see "Try Again," click it, authenticate again, and land on `/no-team` with no explanation. The secondary error line ("sign out and ask the person who invited you for a new link") and the "Try Again" button give contradictory instructions. This cannot be fixed by routing through the existing page with the existing parameters.

The correct resolution is to create a dedicated join error component and route. This avoids contaminating `AuthErrorPage` with join-specific conditional logic, and it means the "Try Again" CTA is not present for join failures. The route should be explicitly added to `App.tsx` (unauthenticated, analogous to `/auth/error`), and both the direct path and the through-auth path should redirect there.

**Required action:** Correct the design's claim about the existing error page. Specify the new component and route explicitly. Confirm that `join-links.ts` error redirects also change to the new route, or document why they do not.

---

## Finding 3 (Confirmed clean): `executeJoinFlow` call site analysis

**Design section:** Decision 3 risk section, design.md

`executeJoinFlow` is a non-exported module-private function defined at `auth.ts:424`. It is called at exactly one location: `auth.ts:200-204`. There are no external callers. Adding `sourceIp` as a required parameter is safe — TypeScript will enforce it at the single call site, and the function is not accessible outside the module. The design's observation that "the function's `sourceIp` parameter should be required, not optional, so omitting it is a type error" is correct and easy to enforce.

---

## Finding 4 (Confirmed clean): `INSERT ... ON CONFLICT DO NOTHING RETURNING id`

**Design section:** What Changes — new membership detection, proposal.md

This pattern is already in production use in this codebase. `join-links.ts:161-169` contains:

```sql
INSERT INTO team_memberships (user_id, team_id, role)
VALUES ($1, $2, 'participant')
ON CONFLICT (user_id, team_id) DO NOTHING
RETURNING id
```

with `const isAlreadyMember = insertResult.rows.length === 0;` immediately after. The through-auth path in `executeJoinFlow` uses the same INSERT without `RETURNING id` (line 461-466). Adding `RETURNING id` is a one-line change. The pg client returns rows as an array; empty array means the conflict path fired; non-empty means a new row was written. No ORM concerns — the project uses raw `pg` queries throughout.

The existing membership detection logic in the direct path is the canonical reference for the through-auth implementation. The semantics are identical; only the call site differs.

---

## Finding 5 (Confirmed clean): `?newMember=true` replace-navigation pattern

**Design section:** Decision 2, design.md

`TeamPage.tsx:11-22` already implements the exact pattern:

```typescript
if (searchParams.get("alreadyMember") === "true") {
  setShowNotification(true);
  searchParams.delete("alreadyMember");
  setSearchParams(searchParams, { replace: true });
  const timer = setTimeout(() => setShowNotification(false), 4000);
  return () => clearTimeout(timer);
}
```

Adding `?newMember=true` handling is a direct parallel — same hook, same delete-and-replace, same auto-dismiss timer, different banner text. The session page is currently a placeholder div with no component file of its own. There is nothing to add or guard against there until the session page is built.

The design's requirement that the session page "explicitly ignores" `?newMember=true` is correct but has no implementation surface today. The session participation change will need to enforce this when a real `SessionPage` component is created.

---

## Finding 6 (Confirmed clean): Through-auth redirect constraints

**Design section:** Risks/Trade-offs, design.md

The OIDC callback handler (`GET /auth/callback`) issues redirects via `reply.redirect()`, the standard Fastify pattern used throughout. There are no OIDC-specific constraints on where the callback can redirect after `handleCallback` completes. The library does not restrict the post-callback redirect target.

One structural property worth confirming explicitly: join failures occur after authentication succeeds. The user gets a valid session regardless of join outcome (the session is saved at `auth.ts:232` before the redirect). A user who follows an expired link through the auth flow will land on the error page authenticated. This is correct — don't reject their authentication because their join link was stale. The error page must be accessible without a session requirement (like `/auth/error` currently is), and whatever new join error route is created must also be unauthenticated.

---

## Finding 7 (Test coverage gap): `auth.test.ts` mocks need updating for new membership detection

**File:** `packages/backend/src/routes/__tests__/auth.test.ts:472-476`

The existing test for a successful through-auth join flow mocks the membership INSERT as:

```typescript
// 2. INSERT INTO team_memberships (ON CONFLICT DO NOTHING)
mockDbQuery.mockResolvedValueOnce({ rows: [] });
```

This returns an empty row set, which under the proposed `RETURNING id` addition would be interpreted as "already a member." The test will need two variants once `RETURNING id` is added:
- New membership: mock returns `{ rows: [{ id: 'membership-1' }] }` → expect `?newMember=true` in redirect
- Already a member: mock returns `{ rows: [] }` → expect `?alreadyMember=true` in redirect

The test infrastructure for the through-auth join path is in place and well-structured; this is a straightforward extension. New tests are also needed for expired and invalid token cases in the through-auth path (these are currently untested).

---

## Verdict

Do not start implementation until Findings 1 and 2 are resolved in `design.md`. Both are design decisions, not implementation choices — leaving them to the implementer produces divergent or incorrect outcomes.

Findings 3 through 6 are clean. The mechanical work (RETURNING id, sourceIp threading, replace-navigation) is straightforward given the existing patterns in the codebase. Finding 7 is pre-flagged work for the test update pass.
