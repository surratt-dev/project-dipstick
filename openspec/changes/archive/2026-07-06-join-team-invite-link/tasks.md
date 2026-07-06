## 1. Fix `trustProxy` Configuration in app.ts

This is the first implementation task. Without `trustProxy` configured, `request.ip` returns the proxy IP in production rather than the real client IP. Every subsequent task that reads `request.ip` — audit events, `sourceIp` threading — tests against the correct value only after this fix is in place. It also corrects every existing audit event in the system, so it has broad value and zero risk as the first change.

- [x] 1.1 Add `trustProxy: 1` to the Fastify app configuration object in `packages/backend/src/app.ts`; this causes `request.ip` to resolve from `X-Forwarded-For` (the real client IP) rather than the raw socket's `remoteAddress` (the proxy IP in production deployments behind a load balancer or Kubernetes ingress); `trustProxy: 1` is appropriate for a single-layer proxy (one hop); without this fix, every `sourceIp` field across all audit events (`auth.authorization_initiated`, `auth.callback_received`, `auth.failure`, `auth.session_created`, `auth.first_access_created`, `join.link_created`, `join.link_rejected`, `join.link_redeemed`) carries the proxy IP instead of the client IP in production

## 2. Role Vocabulary Documentation

- [x] 2.1 In `packages/backend/src/routes/join-links.ts`, add inline comment at the `INSERT INTO team_memberships` call explaining that `role: 'participant'` is what the use case calls "Engineer," that `membership_role` is distinct from the global `user_role` enum, and that changing this value to `'engineer'` would cause a database error because that value does not exist in `membership_role`
- [x] 2.2 In `packages/backend/src/routes/auth.ts`, add the same inline comment at the membership insertion logic within `executeJoinFlow`

## 3. Fix `sourceIp` in `executeJoinFlow` Audit Events

**Coordination note: Tasks 3, 4, and 6 all modify `executeJoinFlow` in `packages/backend/src/routes/auth.ts`. Implement them sequentially — 3, then 4, then 6 — before merging. Do not branch these task groups independently; changes to the same function body will conflict.**

- [x] 3.1 Update `executeJoinFlow` in `packages/backend/src/routes/auth.ts` to accept a required `sourceIp: string` parameter; remove the `sourceIp: "callback"` literal from `join.link_rejected` audit event calls inside the function; add a `sourceIp` field to the `join.link_redeemed` audit event, which currently has no `sourceIp` at all — after this change, both `join.link_rejected` and `join.link_redeemed` carry the real requester IP
- [x] 3.2 Update the call site in `GET /auth/callback` to pass `request.ip` as the `sourceIp` argument to `executeJoinFlow`

## 4. Fix Through-Auth Path — Outcome Signals

**Prerequisite for 4.1 and 4.2:** The INSERT in `executeJoinFlow` currently uses `ON CONFLICT DO NOTHING` without `RETURNING id`, which means the insert result is discarded. New vs. existing membership cannot be detected, and `join.link_redeemed` fires unconditionally — including for users who are already members and trigger no actual insert. Complete task 4.0 before implementing 4.1 and 4.2.

**Note: Task 4.1 and Task 7 together deliver the new-member welcome banner. Neither produces user-visible behavior without the other. Validate end-to-end after both are complete.**

- [x] 4.0 In `executeJoinFlow` (`packages/backend/src/routes/auth.ts`), add `RETURNING id` to the `INSERT INTO team_memberships ... ON CONFLICT DO NOTHING` statement; capture the result as `insertResult`; gate the `join.link_redeemed` audit event on `insertResult.rows.length > 0` so it fires only when a new row was actually inserted, not for existing-member cases
- [x] 4.1 In `executeJoinFlow`, when `insertResult.rows.length > 0` (new row inserted), append `?newMember=true` to the returned `redirectUrl`
- [x] 4.2 In `executeJoinFlow`, when `insertResult.rows.length === 0` (conflict: existing membership), append `?alreadyMember=true` to the returned `redirectUrl` — matching the behavior of the direct join path

## 5. Frontend — Join Error Page (New Component)

**Must precede Task 6.** The `/join-error` route and `JoinErrorPage` component must exist before any redirect to `/join-error` can be tested end-to-end. Do not merge or deploy Task 6 without Task 5 in the same unit of change. Task 6.4 (the `join-links.ts` error redirect update) touches a different file from the `executeJoinFlow` changes and may be batched with Task 5 rather than with Tasks 6.1–6.3.

- [x] 5.1 Create `packages/frontend/src/pages/JoinErrorPage.tsx`; the component reads `?joinError=` from the URL search params; when `joinError=expired`, display the primary message "This link has expired. Ask your facilitator for a new one." followed by the secondary line "If this is your first time using this tool, sign out and ask the person who invited you for a new link."; when `joinError=invalid`, display the primary message "This link is not valid." followed by the same secondary line; do not include a "Try Again" CTA
- [x] 5.2 Add a `/join-error` route to `packages/frontend/src/App.tsx` pointing to `JoinErrorPage`; the route must be accessible without authentication — do not gate it behind session or auth middleware (analogous to how `/auth/error` is currently configured)

## 6. Fix Through-Auth Path — Join Failure Error Routing

- [x] 6.1 In `executeJoinFlow` (`packages/backend/src/routes/auth.ts`), when the token lookup returns an expired or revoked result, return `{ redirectUrl: '/join-error?joinError=expired' }` — not `null`; the function owns this redirect URL construction consistent with how it constructs success redirect URLs
- [x] 6.2 In `executeJoinFlow`, when the token is not found in the database, return `{ redirectUrl: '/join-error?joinError=invalid' }` — not `null`
- [x] 6.3 In the `GET /auth/callback` handler, update the join flow branch: since `executeJoinFlow` now always returns a non-null `redirectUrl` (the return type is `Promise<{ redirectUrl: string }>`), remove the null-check and redirect unconditionally to `joinResult.redirectUrl`; the user is never routed to `/no-team` when a `pendingJoinToken` was present

  **Prerequisite for 6.3: Both 6.1 and 6.2 must be complete before applying this task. The null-check removal is only safe when all return paths from `executeJoinFlow` return a non-null URL. Applying 6.3 after only one of the two null-return cases is fixed will silently fall through to the membership query for the remaining null case — the user is routed to `/no-team` or `/team/:teamId` instead of `/join-error?joinError=invalid`, which is incorrect behavior that does not crash and will not be caught without running the test suite.**

- [x] 6.4 In `GET /api/join/:token` in `packages/backend/src/routes/join-links.ts`, change the direct path error redirects from `/auth/error?category=invalid_request&message=...` to `/join-error?joinError=expired` (expired/revoked) and `/join-error?joinError=invalid` (not found); both paths must converge on `JoinErrorPage` at `/join-error`; this subtask is structurally independent of 6.1–6.3 (different file, different code path) and may be batched with Task 5 rather than with the `executeJoinFlow` changes

## 7. Frontend — New-Member Welcome Banner

**Note: Task 7 and Task 4.1 together deliver the new-member welcome banner. Neither produces user-visible behavior without the other. Validate end-to-end after both are complete.**

- [x] 7.1 In `packages/frontend/src/pages/TeamPage.tsx`, add a handler for `?newMember=true` that renders a transient notification banner with the content: "You've joined the team. Your facilitator will share what comes next."
- [x] 7.2 After rendering the banner, remove `?newMember=true` from the URL via `replace` navigation, consistent with the existing `?alreadyMember=true` handler

## 8. Fix Non-Atomic Redis State Retrieval

- [x] 8.1 In the `GET /auth/callback` handler in `packages/backend/src/routes/auth.ts`, replace the `redis.get(stateKey)` call followed by `redis.del(stateKey)` with a single `redis.getdel(stateKey)` call (available in ioredis); this is a one-line change that eliminates the non-atomic window between retrieval and deletion — a concurrent second callback for the same OIDC state key can read the token before the first request deletes it; `redis.getdel` performs both operations atomically, closing that window without any behavioral change in the happy path

## 9. Update `openspec/specs/join-link/spec.md`

The proposal names `openspec/specs/join-link/spec.md` as a file that changes in this PR. The current spec describes error scenarios as redirecting to "an error page" without specifying the URL or query parameter mechanism, and is missing the `?joinError=` mechanism, the `?newMember=true` requirement, through-auth parity for `?alreadyMember=true`, and the role vocabulary section.

- [x] 9.1 Add a through-auth error delivery section covering: the `?joinError=` mechanism (both `expired` and `invalid` values), the message mapping for each value ("This link has expired. Ask your facilitator for a new one." for `expired`; "This link is not valid." for `invalid`), the secondary guidance line displayed for both states, and the hard requirement that the user must not land on `/no-team` when a join token was present in the OIDC state
- [x] 9.2 Add an already-a-member through-auth parity requirement specifying that the through-auth path must append `?alreadyMember=true` to the redirect URL when the membership already exists, matching the behavior of the direct join path
- [x] 9.3 Add a new-member confirmation section covering: the `?newMember=true` requirement appended to the redirect URL on new membership; the welcome banner content ("You've joined the team. Your facilitator will share what comes next."); the auto-dismiss and replace-navigation behavior; the session page's explicit non-handling of `?newMember=true` with the rationale (banner content "Your facilitator will share what comes next" is misleading when a session is already in progress); and the new-vs-existing detection mechanism (`INSERT ... ON CONFLICT DO NOTHING RETURNING id`)
- [x] 9.4 Add a role vocabulary section mapping "Engineer" (use case language) to `participant` (schema value in `membership_role`), explaining that `membership_role` is distinct from the global `user_role` enum; document the deferral of the join link revocation write endpoint with rationale and the name of the follow-on change that will close it

## 10. Create `openspec/specs/session-participation/spec.md`

The proposal names `openspec/specs/session-participation/spec.md` as a new file this change creates. The directory does not yet exist. The stub's purpose is to make EM enforcement and facilitator-on-own-team constraints visible when the session participation feature is designed — not to pre-decide its implementation.

- [x] 10.1 Create `openspec/specs/session-participation/spec.md` as a stub containing at minimum one scenario skeleton for EM enforcement that names: the enforcement point (the session participation endpoint, server-side), the trigger (a `global_role = 'engineering_manager'` check on the `users` table), and the constraint outcome (the user must not be recorded as a session participant); specific HTTP status codes, redirect behavior, and user-facing error content are session-participation design decisions — do not specify them here

## 11. Tests

- [x] 11.1 In `packages/backend/src/tests/auth.test.ts`, add test: expired `pendingJoinToken` at callback time → callback redirects to `/join-error?joinError=expired`; user not added to any team; user not routed to `/no-team`
- [x] 11.2 In `packages/backend/src/tests/auth.test.ts`, add test: revoked `pendingJoinToken` at callback time → callback redirects to `/join-error?joinError=expired`; user not added to any team; user not routed to `/no-team`
- [x] 11.3 In `packages/backend/src/tests/auth.test.ts`, add test: nonexistent `pendingJoinToken` at callback time → callback redirects to `/join-error?joinError=invalid`; user not added to any team; user not routed to `/no-team`
- [x] 11.4 In `packages/backend/src/tests/auth.test.ts`, add test: successful through-auth join for a new member (mock INSERT returns `{ rows: [{ id: 'membership-1' }] }`) → redirect URL includes `?newMember=true`; `join.link_redeemed` audit event is emitted
- [x] 11.5 In `packages/backend/src/tests/auth.test.ts`, add test: through-auth join for already-a-member user (mock INSERT returns `{ rows: [] }`) → redirect URL includes `?alreadyMember=true`; `join.link_redeemed` audit event is NOT emitted
- [x] 11.6 In `packages/backend/src/tests/auth.test.ts`, add test: `executeJoinFlow` audit events (`join.link_rejected` and `join.link_redeemed`) contain `sourceIp` equal to `request.ip`, not the string `"callback"`; `join.link_redeemed` emits `sourceIp` when a new membership is created
- [x] 11.7 In `packages/backend/src/tests/auth.test.ts` or `join-links.test.ts`, add test: `GET /api/join/:token` with an expired token redirects to `/join-error?joinError=expired`, not to `/auth/error?category=...`; add equivalent test for an invalid (not-found) token redirecting to `/join-error?joinError=invalid`
- [x] 11.8 In `packages/frontend/src/pages/__tests__/`, add tests for `JoinErrorPage`: renders correct primary and secondary message for `?joinError=expired`; renders correct primary and secondary message for `?joinError=invalid`; does not render a "Try Again" button for either state
- [x] 11.9 In `packages/backend/src/tests/auth.test.ts`, add test: a successful join (new member path) writes a `team_memberships` row with `role = 'participant'`; assert the value directly from the captured INSERT arguments — this is the automated backstop for the vocabulary fix in Tasks 2.1 and 2.2 and the only check that would catch a future regression where the role value is changed to a non-existent enum value
- [x] 11.10 In `packages/frontend/src/pages/__tests__/`, add tests for the new-member welcome banner in `TeamPage.tsx`: renders the banner with the content "You've joined the team. Your facilitator will share what comes next." when `?newMember=true` is present in the URL; removes `?newMember=true` from the URL via replace navigation after rendering; does not render the banner when `?newMember=true` is absent
