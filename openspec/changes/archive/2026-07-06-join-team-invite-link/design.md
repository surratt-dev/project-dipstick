## Context

The join link is the primary enrollment mechanism for the Engineering Health Check. An engineer receives a URL from their facilitator, clicks it, and should be on their team's page within seconds — no support requests, no ambiguity about whether it worked. The core implementation is largely correct: the direct authenticated path (`GET /api/join/:token`), the unauthenticated redirect to OIDC, the `ON CONFLICT DO NOTHING` upsert, and session-aware landing all work as specified.

The through-auth path (`GET /auth/callback` with a `pendingJoinToken` in OIDC state) has correctness gaps: join failures after the OIDC flow are swallowed silently and rerouted to membership-state pages unrelated to the join flow; audit events carry a literal string placeholder for `sourceIp`; the `?alreadyMember=true` signal sent by the direct path is not sent by the through-auth path; and successful first-time joins land the user on the team page with no confirmation that the join occurred.

A vocabulary mismatch between the use case ("Engineer") and the schema (`participant`) creates a latent defect trap at every membership insert site. Two load-bearing ritual constraints — EM non-participation and facilitator-from-another-team — are requirements on the not-yet-built session participation feature and must be formally captured now, where the join link analysis surfaced them, not left to be discovered when that feature is designed.

## Goals / Non-Goals

**Goals:**
- Route through-auth join failures to the join error page with a `?joinError=` query parameter, not to `/no-team` or an existing team page
- Surface the same error messages on the through-auth failure path as the direct path: `?joinError=expired` → "This link has expired. Ask your facilitator for a new one."; `?joinError=invalid` → "This link is not valid."
- Add `?newMember=true` to the through-auth success redirect so first-time joiners receive a confirmation banner on the team page
- Add `?alreadyMember=true` to the through-auth already-a-member redirect, matching the direct path behavior
- Replace `sourceIp: "callback"` in `executeJoinFlow` audit events with the real requester IP
- Add inline role vocabulary comments at both membership insert sites (`join-links.ts`, `auth.ts`) and a role vocabulary section to the join-link spec
- Formally document EM protection and facilitator-on-own-team constraints in `openspec/specs/session-participation/spec.md` as hard requirements on that future feature
- Document join link revocation as explicitly deferred to a follow-on change

**Non-Goals:**
- Join link revocation endpoint — deferred to the link management UI change; 7-day expiry is sufficient protection for initial deployment
- Session participation enforcement — EM non-participation and facilitator-on-own-team rules are enforced by the session layer, not the join layer; adding role-based filtering at join time would create ambiguous half-membership states and is the wrong enforcement point
- Mid-session arrival UX — the join link flow's responsibility ends when it routes the user to the session URL; what the session page shows a mid-session arrival is determined by the session participation layer
- Join link generation UI — not in scope; the endpoint exists and functions correctly
- Pre-session facilitator roster view — the team page's content before a session is session setup territory

## Decisions

### Decision 1: Error delivery via query parameter on redirect to a new dedicated join error page

The direct path (`GET /api/join/:token`) redirects to an error page when a token is invalid, expired, or revoked. The through-auth path exits via `GET /auth/callback`, which issues a redirect to a frontend URL. Three options were considered for surfacing the error:

- **Query parameter on redirect URL to a new dedicated join error page** (chosen): `?joinError=expired` or `?joinError=invalid` appended to the redirect URL, targeting a new `JoinErrorPage` component at `/join-error`. The existing `/auth/error` page (`AuthErrorPage`) does not read `?joinError=` parameters — it reads `category` and `message` params, and its "Try Again" button re-initiates OIDC without join context, producing a second confusing failure for anyone who authenticated and then landed on an error with no path forward. A dedicated `JoinErrorPage` avoids contaminating `AuthErrorPage` with join-specific conditional logic and removes the misleading "Try Again" CTA from the join failure experience entirely. Both the direct path (`GET /api/join/:token` in `join-links.ts`) and the through-auth path (`GET /auth/callback`) redirect to `/join-error?joinError=...`: the direct path's existing error redirects to `/auth/error?category=...&message=...` must be updated to use the new route. The `/join-error` route must be accessible without authentication, analogous to `/auth/error`. No server-side session state is required. The parameter survives the redirect and is readable by the frontend. Both paths converge on the same destination with the same parameter.
- **Session-stored flash message**: Would require coordinating between the callback handler and the frontend session; adds infrastructure complexity and makes the error state ephemeral in a way that interacts poorly with browser refresh.
- **Dedicated callback-only error route**: A route that serves only the through-auth failure path would split the error handling surface, requiring two separate error experiences to be maintained and leaving the direct path's `/auth/error` redirect in place. The `/join-error` route chosen serves both paths, ensuring convergence on the same component.

The query parameter approach is consistent with `?alreadyMember=true` and `?newMember=true` — the same pattern the application uses throughout the join flow for transient state signals.

### Decision 2: `?newMember=true` as a parallel to `?alreadyMember=true`

The team page already handles `?alreadyMember=true` with a transient banner. Adding `?newMember=true` uses the same pattern with different banner content. The alternative — a dedicated "welcome" page or modal — would add a navigation step between joining and arriving on the team page, which contradicts the design goal of making the join flow disappear into the background. A transient banner that auto-dismisses is the right signal: it confirms the join without becoming a blocker.

Banner content for `?newMember=true`: "You've joined the team. Your facilitator will share what comes next."

The team page removes `?newMember=true` from the URL via `replace` navigation after rendering the banner, consistent with how it handles `?alreadyMember=true`.

### Decision 3: `executeJoinFlow` signature extended with `sourceIp` and updated return type

The `executeJoinFlow` function is called from one site: `GET /auth/callback`. Adding a `sourceIp` parameter to the function and threading `request.ip` through from the call site is the minimal correct fix. The alternative — having `executeJoinFlow` accept the full request object — introduces a tighter coupling between the route layer and the join logic. A single string parameter is sufficient and keeps the function portable.

The function's return type must also be updated to communicate failure reason to the callback handler. The current signature is `Promise<{ redirectUrl: string | null }>`, where `null` signals failure but carries no error detail — the callback handler cannot distinguish "expired" from "invalid" without a separate error field. Two approaches were considered: (1) an extended discriminated union where `{ redirectUrl: null; error: 'expired' | 'invalid' }` is returned on failure, requiring the callback handler to inspect `.error` and construct the redirect; (2) error-as-redirect, where `executeJoinFlow` constructs the full failure redirect URL and returns it as `redirectUrl`. Error-as-redirect is adopted. This is consistent with how the success case already works — the function already owns the construction of success redirect URLs (`/team/:teamId`, `/session/:sessionId`). Extending that responsibility to failure destinations eliminates the null sentinel and keeps the callback handler's logic simple: it redirects unconditionally to `joinResult.redirectUrl` with no conditional branching on error type. The updated return type is `Promise<{ redirectUrl: string }>`. On expired or revoked token, the function returns `{ redirectUrl: '/join-error?joinError=expired' }`. On token not found, it returns `{ redirectUrl: '/join-error?joinError=invalid' }`. The `{ redirectUrl: null }` sentinel is eliminated.

### Decision 4: EM enforcement belongs at the session participation layer, not the join layer

An Engineering Manager who follows a join link is inserted into `team_memberships` as `participant`. Their `global_role` on the `users` table is `engineering_manager`. The join flow does not check this, by design.

Filtering EMs at join time was considered and rejected for two reasons: (1) it would create a state where an EM is associated with a team but not listed as a member, which is inconsistent and confusing; (2) the use case for "Join a Team via Invite Link" does not list EMs in the actor set but does not say to show them an error. The correct enforcement point is the session participation endpoint, which must check `users.global_role` server-side before recording any user as a session participant.

This is not an open question — it is a deferred requirement. It is formally captured in `openspec/specs/session-participation/spec.md` so it cannot be missed when that feature is designed.

### Decision 5: Join link revocation explicitly deferred

The `revoked_at` column exists. The validation logic handles it. There is no write endpoint to set `revoked_at`. Adding the endpoint without a UI to expose it creates an incomplete capability with no user-visible value. The facilitator has no surface in the current application to manage or revoke links. The 7-day expiry provides time-bounded protection that is adequate for initial deployment. Revocation belongs in the link management UI change, which will also provide the surface where the endpoint can be exposed.

The deferral is documented here and in the proposal so it is not mistaken for a gap in this change.

## Risks / Trade-offs

**Through-auth path now has two additional outcomes (newMember, error) that the team page and the new join error page must handle.** The team page handles two query parameters (`alreadyMember`, and now `newMember`). The new `JoinErrorPage` handles two error states (`expired`, `invalid`). The risk is that future changes to either component forget to preserve these handlers. Mitigation: the spec requirements and test coverage lock in the expected behavior; the inline code comments explain the intent.

**`executeJoinFlow` signature change is internal and non-breaking, but it is a contract change.** Only one call site exists today. If a second call site is added in the future without passing `sourceIp`, the audit event will be incorrect. Mitigation: the function's `sourceIp` parameter should be required (not optional), so omitting it is a type error.

**`?newMember=true` is not authenticated or signed.** A user who manually appends `?newMember=true` to the team page URL will see the welcome banner. This is cosmetic and harmless — the banner is transient and non-functional. No mitigation needed.

**The session-participation spec documents constraints that will not be enforced until that feature is built.** Until session participation exists, an EM who joins via a link can be on a team's membership list with no enforcement preventing them from attempting to participate. The 7-day link expiry limits the window, but the structural gap exists. Mitigation: the constraint is formally documented in a named spec artifact so it cannot be overlooked when session participation is designed; it is a first-entry hard requirement, not a recommendation.

## Open Questions

**Q: Should the join error page include a secondary line for first-time users on the through-auth failure path?**

A new user who clicked a link, completed OIDC for the first time, and landed on the error page does not know who their facilitator is. The error message "Ask your facilitator for a new one" may be disorienting. The proposed secondary line: "If this is your first time using this tool, sign out and ask the person who invited you for a new link." This is additive and does not change the primary message. It should be included if the frontend team considers it implementable within this change's scope; otherwise it belongs in the UX polish pass.

**Q: Who can generate a join link before session setup exists?**

The `POST /api/teams/:teamId/join-links` endpoint requires the caller to be a team member with a facilitator-level role. Session setup, which bootstraps initial team membership, is not yet implemented. Until it is, the join link generation endpoint is present but cannot be meaningfully used without manual database intervention. This is a known dependency on the session setup feature, not a gap in this change.
