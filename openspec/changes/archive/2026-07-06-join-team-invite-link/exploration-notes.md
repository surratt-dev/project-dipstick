# Exploration Notes: Join a Team via Invite Link
**Perspective:** Devon Calloway, Internal Champion
**Use Case Source:** requirements/use cases/01 - Identity and Access - Use Cases.md (lines 115–169)
**Prior Spec:** openspec/specs/join-link/spec.md
**Date:** 2026-07-05
**Revised:** 2026-07-05 — incorporating reviewer feedback from Priya Nair (Facilitator) and Marcus Delgado (BA)

---

## 1. Intent and Why It Matters for the Ritual

The join link is the front door to the Health Check. It is the moment a new engineer goes from knowing the ritual exists to being able to participate in it. Everything about the design of this flow should feel frictionless and trustworthy — because if an engineer clicks a link, gets confused, or lands somewhere that looks broken, they are going to tell the person who sent it to them that "the link didn't work," and that person is going to stop sending links.

There is a more important concern underneath that. I have been making the case for two years that any team in this organization should be able to adopt the Health Check without needing me to explain anything. The join link is how that actually happens. The facilitator shares one URL. The engineer clicks it. They are in. That sequence has to work without error, without admin intervention, and without any step that requires someone to look something up. The moment it requires a support request or a second email, the adoption story falls apart.

But the join link is also a permission boundary. Who ends up on a team matters. The ritual's protective constraints depend on team composition being correct: engineers participate, Engineering Managers have read-only access to history but do not sit in the room, and the facilitator is from a different team entirely. The join link is the primary mechanism for adding engineers to a team. If it is imprecise about who it lets in, it creates compositional problems that the session layer will have to compensate for — and compensation at a later layer is always less reliable than a clean boundary at the entry point.

---

## 2. What Is Already Implemented

The core of this flow is largely in place. Before calling out gaps, it is worth being precise about what already works, because a change that mostly re-verifies existing work is a legitimate and valuable use of engineering time.

**Backend — `packages/backend/src/routes/join-links.ts`:**

- `POST /api/teams/:teamId/join-links` — generates a 32-byte cryptographically random token, stores it with a 7-day expiry, requires the caller to be a team member with a facilitator-level role. Emits `join.link_created` audit event with `userId`, `teamId`, `linkId`, and `expiresAt`.
- `GET /api/join/:token` — validates the token (not found → error, revoked → error, expired → error), handles unauthenticated users by redirecting to `/auth/login?joinToken=<token>`, handles authenticated users by inserting into `team_memberships` via `ON CONFLICT (user_id, team_id) DO NOTHING`, then checks for an active session and redirects to `/session/:sessionId` or `/team/:teamId` accordingly. Appends `?alreadyMember=true` when the user is already a member.
- Audit events: `join.link_rejected` (with reason: not_found, revoked, or expired), `join.link_redeemed` (on new membership).

**Backend — through-auth path in `packages/backend/src/routes/auth.ts`:**

The `GET /auth/callback` handler stores a `pendingJoinToken` in the Redis OIDC state payload when a `joinToken` query parameter is present on the login redirect. After successful account resolution, it calls `executeJoinFlow(userId, pendingJoinToken, logger)`. That function validates the token, inserts the team membership, and returns a redirect URL. The callback uses that redirect URL directly, bypassing the membership-based routing that would otherwise route a new user to `/no-team`.

**Database — `packages/backend/migrations/5_create_join_links.sql`:**

The `join_links` table has `token` (VARCHAR 64, unique), `expires_at`, `revoked_at` (nullable), and `created_by` referencing `users`. The `idx_join_links_token` index on `token` supports the lookup pattern. The `team_memberships` table (Migration 2) has a unique constraint on `(team_id, user_id)` which enables the idempotent upsert.

**Frontend — `packages/frontend/src/pages/TeamPage.tsx`:**

Handles `?alreadyMember=true` by rendering a transient notification banner and then removing the query parameter from the URL via `replace` navigation. This matches the spec requirement for the already-a-member landing.

**Test coverage:**

`join-links.test.ts` covers the direct happy path, the rejection cases (not found, revoked, expired), the unauthenticated redirect, the already-a-member redirect, and the active-session redirect. `auth.test.ts` covers the through-auth happy path (valid pendingJoinToken completing the join and redirecting to `/team/:teamId`).

The implementation is solid at the core. What follows is where I have concerns.

---

## 3. Role Naming Discrepancy — Not a Bug, But a Trap

The use case says: "The application adds the user to the team with the default role of Engineer."

The database `membership_role` enum has two values: `participant` and `engineering_manager`. There is no `engineer` value in that enum.

What the use case calls "Engineer" is what the schema calls "participant." This is a vocabulary mapping, not a defect. The global `user_role` enum does have `engineer` (and `senior_engineer`, `facilitator`, `engineering_manager`, `application_admin`), but that lives on the `users` table. Team membership role is a separate concept — it is not a copy of the global role.

The implementation correctly inserts new members as `participant`, which is the right value. But anyone reading the use case and then looking at the database for the first time will be confused when they see `participant` where they expected `engineer`. And anyone who tries to "correct" this by changing the insert to match the use case wording will introduce a database error.

This vocabulary gap must be closed in two specific places:

**Task: Add role mapping comment to team membership insert sites**

- In `packages/backend/src/routes/join-links.ts`, at the `INSERT INTO team_memberships` call, add an inline comment:
  ```
  // The use case calls this role "Engineer." The team membership role enum uses
  // "participant" to distinguish this from the global user role enum, which has
  // a separate "engineer" value. These refer to the same person at different
  // levels of the model. Do not change this to "engineer" — that value does
  // not exist in the membership_role enum and will cause a database error.
  ```
- In `packages/backend/src/routes/auth.ts`, at the `executeJoinFlow` call that results in membership insertion, add the same comment.
- Acceptance: a reviewer reading either insert site sees a clear statement of the vocabulary mapping without consulting external documentation.

**Task: Add vocabulary mapping section to the join-link spec**

- In `openspec/specs/join-link/spec.md`, add a "Role vocabulary" section that states: "What the use cases call 'Engineer' is stored as `participant` in the `membership_role` enum. These are the same person at different model layers. The global `user_role` enum has a separate `engineer` value on the `users` table. These must not be conflated."
- Acceptance: the spec contains an explicit statement of the mapping that future authors can reference.

---

## 4. Ritual Constraints in Play — What Could Go Wrong

This is the section I care most about. The join link flow looks straightforward, but it sits at the entry point to a system where several load-bearing constraints must hold. Drift here is quiet and cumulative.

### 4a. The No-Manager-Participation Rule

Devon's rule, stated directly: Engineering Managers must not be able to participate in sessions. A single exception changes what engineers are willing to say. This is not a preference. It is the rule.

The join link flow does not enforce this rule. Anyone who has a valid join link can follow it. An Engineering Manager who follows a join link is inserted into `team_memberships` as `participant`. Their global role in the `users` table is still `engineering_manager`, but the membership insertion does not check this. The rule is not enforced at join time.

Here is the architecture as it currently stands:

```
User follows join link
        │
        ▼
GET /api/join/:token
        │
Token valid? ──No──▶ Error page
        │
        Yes
        │
        ▼
User authenticated? ──No──▶ /auth/login?joinToken=...
        │                            │
        Yes                          ▼
        │              Complete auth, run executeJoinFlow
        ▼
INSERT INTO team_memberships
(user_id, team_id, role='participant')
ON CONFLICT DO NOTHING
        │
        ▼  ← No check on users.global_role here
Redirect to team or session
```

The engineering_manager protection must be enforced at the **session participation layer** — the endpoint that records a user as a session participant must check `users.global_role` and reject `engineering_manager`. That layer does not exist yet. There are no session participation routes in the current implementation.

This means the constraint exists in the requirements, is not enforced anywhere in the running code, and the entry point (join link) does not reduce the risk. The join link adds EMs as participants. Whether they can then participate in a session depends entirely on a layer that has not been built.

This is a structural gap that this change cannot close (session participation is out of scope), but it must be documented explicitly:

1. The join link flow MUST NOT check global role and silently refuse to add EMs. That would be the wrong enforcement point — it would create a state where an EM is associated with a team but not listed as a member, which is confusing and inconsistent. The join link flow should admit EMs to team membership.
2. The session participation layer, when it is built, MUST check `users.global_role` for `engineering_manager` and prevent those users from joining sessions as participants. This check must be server-side. It must not be skippable. It is the only place in the system where the no-manager-participation rule is enforceable once the join link has added the EM to the team.
3. This constraint is a hard requirement on the session participation feature and must be carried as such when that feature is designed. It will be formally captured in `openspec/specs/session-participation/spec.md` under a "Participation constraints" section. If that spec does not yet exist when session participation work begins, it must be created and this constraint must be its first entry. It is not acceptable to implement session participation without closing this requirement explicitly.

### 4b. The Facilitator-From-Another-Team Constraint

A facilitator is, by definition, from a team other than the one they are facilitating. The join link flow does not check whether the user is a facilitator. A facilitator who follows a join link for Team A is inserted into Team A's membership as `participant`.

This creates a problem: a facilitator who is now a member of Team A may attempt to facilitate a session for Team A. The facilitator-from-another-team constraint requires the facilitator to be from a different team. If the facilitator is a participant on Team A, they are no longer "from another team" — they are a member.

The session setup layer, when it enforces the facilitator-from-another-team rule, must check `team_memberships` for the facilitator, not just their `global_role`. A facilitator who is a member of the team they want to facilitate must be blocked or warned strongly. Whether the blocking is a hard server-side rejection or a strong UI warning is a decision for session setup — Devon's preference is a hard block, consistent with his position that these constraints must be structural, not preferential.

This constraint must also be captured in `openspec/specs/session-participation/spec.md`. A session setup implementation that does not include this check as a named requirement is incomplete. This is not left as an open question — it is a requirement on a future feature, stated here so it is visible when that feature is designed.

### 4c. The Through-Auth Join Failure Is Silent

When an unauthenticated user follows a join link, the token is preserved in Redis during the OIDC flow. After authentication completes, `executeJoinFlow` validates the token again. If the token has expired or been revoked between the time the user clicked the link and the time the OIDC callback fires, `executeJoinFlow` returns `{ redirectUrl: null }`.

The callback handler then falls back to membership-based routing:
- If the user has team memberships from before, they are routed to their existing team.
- If the user has no team memberships (typical for a new user), they are routed to `/no-team`.

The user who clicked a join link and completed the OIDC flow lands on `/no-team` with no explanation of why the join did not complete. The use case says: "Following an invalid or expired join link does not add the user to any team and shows an error." The direct authenticated path (GET /api/join/:token) satisfies this — it shows the error page. The through-auth path does not — it silently falls back to membership routing.

This is a gap between the use case acceptance criteria and the through-auth implementation. The user who experiences it — a new engineer who clicked a link, logged in for the first time, and arrived at a page telling them they have no team — will have no idea what happened and will contact whoever sent them the link.

**Specified fix — error delivery mechanism:**

The `GET /auth/callback` handler, when `executeJoinFlow` returns `{ redirectUrl: null }` and a `pendingJoinToken` was present in the OIDC state, MUST redirect the user to the existing join error page (the same page the direct path uses) with a `joinError` query parameter indicating the failure reason:

- `?joinError=expired` — when the token exists but `expires_at` is in the past, or `revoked_at` is set
- `?joinError=invalid` — when the token does not exist in the database

The join error page already handles these states for the direct path. No new page is needed. The through-auth path routes to the same destination with the same parameter.

**Specified fix — message mapping:**

The message displayed on the error page maps to the query parameter value:
- `joinError=expired` → "This link has expired. Ask your facilitator for a new one."
- `joinError=invalid` → "This link is not valid."

This is the same mapping the direct path already uses. The through-auth path adopts it without deviation.

Note on first-time users: Priya raises a valid concern that "Ask your facilitator for a new one" may be disorienting to a first-time user who went through the OIDC flow and does not yet know who their facilitator is. The error page should include a secondary line for this case: "If this is your first time using this tool, sign out and ask the person who invited you for a new link." This is context that helps without requiring any change to the primary message.

**Specified fix — landing page:**

The user MUST NOT be routed to `/no-team` when a `pendingJoinToken` was present in the OIDC state and failed validation. The join error page is the correct destination. The `/no-team` page has no join-related content and no affordance for understanding what happened.

**Acceptance scenarios:**

> Scenario: Expired pendingJoinToken at callback time
> - WHEN an authenticated user completes the OIDC flow with a pendingJoinToken that has expired
> - THEN the callback handler redirects to the join error page with `?joinError=expired`
> - AND the page displays: "This link has expired. Ask your facilitator for a new one."
> - AND the user is not added to any team
> - AND the user is not routed to /no-team

> Scenario: Revoked pendingJoinToken at callback time
> - WHEN an authenticated user completes the OIDC flow with a pendingJoinToken whose revoked_at is set
> - THEN the callback handler redirects to the join error page with `?joinError=expired`
> - AND the page displays: "This link has expired. Ask your facilitator for a new one."
> - AND the user is not added to any team
> - AND the user is not routed to /no-team

> Scenario: Nonexistent pendingJoinToken at callback time
> - WHEN an authenticated user completes the OIDC flow with a pendingJoinToken that does not exist in the database
> - THEN the callback handler redirects to the join error page with `?joinError=invalid`
> - AND the page displays: "This link is not valid."
> - AND the user is not added to any team
> - AND the user is not routed to /no-team

---

## 5. Implementation Gaps Worth Closing in This Change

Beyond the ritual constraint concerns, there are several concrete implementation gaps that this change should address.

### 5a. `executeJoinFlow` uses a literal string as `sourceIp`

In `packages/backend/src/routes/auth.ts`, when `executeJoinFlow` emits a `join.link_rejected` audit event, it passes `sourceIp: "callback"`. This is a literal string placeholder, not the actual request IP. Every other audit event in the system that includes `sourceIp` uses `request.ip`. The through-auth path does have access to the real IP — it is available on the `request` object in the callback handler. The `executeJoinFlow` function should accept the caller's `sourceIp` as a parameter and pass it through to the audit events.

### 5b. `executeJoinFlow` does not append `?alreadyMember=true`

The direct join path (`GET /api/join/:token`) appends `?alreadyMember=true` to the redirect URL when the user is already a member. The through-auth path (`executeJoinFlow`) does not. If a user who is already a member of a team authenticates via a join link (perhaps because they bookmarked the login URL with the join token), they are redirected to `/team/:teamId` without the `?alreadyMember=true` parameter. The TeamPage notification is never shown. This is a minor inconsistency but creates an asymmetry between the two join paths that will cause confusion during testing and in production.

### 5c. No test for expired/invalid `pendingJoinToken` during callback

`auth.test.ts` has one test for the through-auth join path: the happy path where the token is valid and the user is added to the team. There is no test for the case where `pendingJoinToken` is expired, revoked, or references a nonexistent token at callback time.

With the error delivery mechanism now specified (Section 4c), the correct behavior for these tests is defined. Each test should assert the correct redirect destination and the correct `joinError` parameter value:

- `pendingJoinToken` is expired at callback time → redirect to join error page with `?joinError=expired`; user not routed to `/no-team`; user not added to any team
- `pendingJoinToken` is revoked at callback time → redirect to join error page with `?joinError=expired`; user not routed to `/no-team`; user not added to any team
- `pendingJoinToken` references a nonexistent token → redirect to join error page with `?joinError=invalid`; user not routed to `/no-team`; user not added to any team

The tests in Section 4c above are the acceptance scenarios. Write them in `auth.test.ts` against the specified behavior, not against the current (incorrect) behavior.

### 5d. No join link revocation endpoint

The `join_links` table has a `revoked_at` column. The validation logic in `GET /api/join/:token` correctly handles revoked links (shows an error). But there is no `DELETE /api/teams/:teamId/join-links/:linkId` or equivalent endpoint that sets `revoked_at`.

**Decision: defer revocation to a follow-on change.**

Rationale: The 7-day expiry provides time-bound protection that is sufficient for the initial implementation. The join link generation UI — the surface through which facilitators would access a revocation control — does not yet exist. Adding a revocation endpoint without the UI to expose it creates an incomplete capability with no user-visible value. The more important thing in this change is getting the error path right (Section 4c) and closing the audit gap (Section 5a).

If a facilitator believes a link has been distributed to the wrong person, the available mitigations are: (1) wait for the 7-day expiry; (2) generate a new link (which does not invalidate the old one, but does give the intended recipient a working path). These are imperfect mitigations. Revocation should be built — but it belongs in the link management UI change, not here.

The deferral rationale must be stated explicitly in the proposal for this change as a scoped-out decision, not left as an open question.

### 5e. First-time user confirmation after successful through-auth join

Priya raises a valid gap: the exploration describes what happens when through-auth fails, but not what a successful first-time through-auth join looks like from the user's perspective.

Currently, after a successful `executeJoinFlow`, the callback redirects to `/team/:teamId`. A first-time user who just completed the OIDC flow lands on the team page with no confirmation that they joined, no explanation of what the team page is, and no indication of what happens next.

The join flow should append `?newMember=true` to the redirect URL when `executeJoinFlow` results in a new membership insertion (not an already-a-member case). The team page should handle `?newMember=true` the same way it handles `?alreadyMember=true` — with a transient notification banner — but with content appropriate for a first-time arrival: "You've joined the team. Your facilitator will share what comes next."

This is a modest addition that carries significant weight for adoption. The join link is the first thing a new participant interacts with. If it ends in silence, they do not know whether it worked.

---

## 6. What This Change Must Not Do

The join link flow sits close to several ritual constraints. While working on this change, certain decisions would undermine constraints Devon considers structural.

**Do not add role-based filtering at join time.** It is tempting to prevent EMs from following join links, but this is the wrong enforcement point. The correct behavior is to admit EMs to team membership and enforce the no-participation rule at the session layer. Filtering at join time creates ambiguous half-membership states and contradicts the use case, which excludes EMs from the actor list but does not say to show them an error.

**Do not make join link expiry configurable.** Seven days is the right default. A configurable expiry that an administrator can set to "never" defeats the purpose of having expiry. The 7-day default is a reasonable, opinionated choice. If the expiry mechanism is exposed as a setting, it will be turned off. Keep it structural.

**Do not add a "request to join" flow.** The join link model is intentional: the facilitator controls who gets invited by controlling who gets the link. A "request to join" flow would invert this — engineers would be able to request membership, requiring facilitator approval before they can join. This changes the social dynamic of adoption and adds friction that the ritual's design specifically avoids. The link-based model puts the facilitator in control. Keep it.

**Do not surface join link generation in the no-team page.** A user on the no-team page has no team. They cannot generate a join link for themselves. The no-team page's content constraint (four elements: display name, no-team statement, join link instruction, sign-out) is load-bearing. Adding a "generate a link" affordance to the no-team page would be absurd and also confusing. The instruction is correct: ask your facilitator for a link.

**Do not route through-auth failures to the membership state page.** When a `pendingJoinToken` fails validation at callback time, the user must land on the join error page — not on `/no-team`, not on an existing team page, not on any page whose purpose is unrelated to the join flow. The callback handler must treat a failed join token as a first-class failure state with a first-class failure destination, not as a fallback to default membership routing.

---

## 7. Open Questions and Deferred Concerns

**Q: Who can generate a join link for a team before any session has been set up?**

The current `POST /api/teams/:teamId/join-links` endpoint requires the caller to be a team member with a facilitator-level global role or an engineering_manager team membership role. Team creation and initial team membership setup belong to the session setup feature, which is not yet implemented. Until that feature exists, the join link generation endpoint is present but cannot be meaningfully used. This is not a defect — it is a dependency on session setup. The join link change should not try to solve the bootstrapping problem; it should note it as a dependency.

**Q: What is the correct behavior when a facilitator joins a team as a participant?**

If a user with global_role `facilitator` follows a join link for a team, they are added as a `participant` member. Their global role does not change. Can they then facilitate a session for that team? The facilitator-from-another-team constraint says no — they are now a member of that team. The session setup layer must enforce this check against `team_memberships`. This is not an open question about whether enforcement will happen — it will. The open question is the UX of enforcement (hard block or strong warning), which is session setup's decision. Devon's preference is a hard block.

**Q: Should the `pendingJoinToken` TTL in Redis (currently the same as the OIDC state TTL, 10 minutes) be extended?**

The exploration concludes that 10 minutes is appropriate and the question is closed. A user who takes longer than 10 minutes to complete the OIDC flow will fail at the state validation step, not at the join step. They will see an auth error, not a join error. This is correct behavior. The proposal should carry this as a closed decision, not restate it as open.

**Q: Should join links be revokable? If so, by whom?**

Deferred to the link management UI change. See Section 5d for rationale.

**Q: What does a user experience when they land on `/session/:sessionId` as a new arrival mid-session?**

This question is out of scope for this change. The join link flow's responsibility ends when it successfully routes the user to the session URL. What the session page shows — whether the new arrival can vote on the current topic, observes, or is held in a waiting state — is determined by the session participation layer. However, this is load-bearing for the reveal mechanic (simultaneous reveal is structural, not optional), and the session participation spec must answer this question before any session participation implementation begins. Specifically: a user who arrives mid-vote must not be able to reveal their vote alongside users who voted before the topic opened, unless they also voted before the reveal. The session participation layer must define how mid-session arrivals interact with the vote state for the current topic. This is a hard requirement on that feature, not an implementation detail.

**Q: Does the facilitator's readiness grid update in real time when a new participant joins mid-session?**

Also out of scope for this change. This is a session layer UI question. The join link flow routes the user to the session; the readiness grid is session infrastructure. The session participation spec should address real-time grid updates as part of defining how the facilitator's view of participant state is maintained. If the grid does not update in real time, the facilitator may start a reveal before all participants have voted — which compromises the reveal mechanic. That consequence belongs in the session participation requirements, not here.

---

## 8. Structural Summary

The join link flow is the ritual's enrollment mechanism. The core implementation is solid. The gaps I have identified divide into three categories:

**Ritual-critical (must be documented even if not fixed here):**
- EM protection is not enforced at join time — deferred to session participation layer, which must include this as a hard requirement when built. Constraint is formally owned by `openspec/specs/session-participation/spec.md`.
- Facilitator-on-own-team risk — deferred to session setup layer, which must enforce the check via `team_memberships`. Same spec artifact owns this constraint.
- Mid-session arrival UX — out of scope for this change; must be closed as a requirement on the session participation feature before that feature is implemented. The reveal mechanic depends on it.

**Implementation correctness (should be closed in this change):**
- Silent join failure on through-auth path — now specified: error delivery via `?joinError=` parameter, dedicated error page, message mapping defined, acceptance scenarios written
- First-time user confirmation after successful through-auth join — `?newMember=true` parameter triggers welcome banner on team page
- `sourceIp: "callback"` in executeJoinFlow audit events
- Missing `?alreadyMember=true` in through-auth redirect

**Missing capability (scoped decision made):**
- Join link revocation endpoint — explicitly deferred to link management UI change; 7-day expiry is sufficient for initial implementation

**Documentation gaps (must be closed in this change):**
- Role naming discrepancy — specific files named, specific comment text specified, spec section specified
- Cross-feature constraints for EM protection and facilitator-on-own-team — artifact named: `openspec/specs/session-participation/spec.md`
