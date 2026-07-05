# Proposal: First Access
**Change:** first-access
**Author:** Devon Calloway, Internal Champion
**Date:** 2026-07-05
**Status:** Proposed

---

## Summary

First Access is the invisible on-ramp to the Engineering Health Check ritual. When it works correctly, an engineer authenticates through the organization's identity provider and arrives at the application without ever knowing account creation happened. That invisibility is the design goal — and it is load-bearing.

The original argument I made to the VP of Engineering was that any team in the organization should be able to adopt the Health Check without needing me to explain it, provision it, or approve anything. That argument falls apart the moment account setup requires a helpdesk ticket, an admin approval, or any manual step. First Access closes that gap permanently: successful authentication through the org's identity provider is sufficient. The application does the rest.

This change adds five capabilities to the application. Three are backend behaviors (automatic account creation, stable identity matching, and safe concurrent handling). Two define what a new user experiences once their account exists (the no-team landing page and the rejection of malformed identity tokens). Each has specific, testable constraints that must be preserved exactly as specified. Some of these constraints look like UX choices — they are not. The layout restriction on the no-team page, for example, is a structural guard against a class of drift that has destroyed similar rituals elsewhere.

Much of this is already implemented. The task list that follows this proposal focuses on verifying the implementation against the finalized requirements, closing two confirmed gaps, and adding tests for the acceptance criteria not yet covered.

---

## Capabilities

**Capability 1: Automatic account creation on first valid authentication**

When the application receives a valid OIDC identity assertion and no existing account matches the identity, it SHALL create a new user account automatically, with no team memberships and no assigned roles. Account creation requires no manual provisioning, no administrator action, and no pre-registration. The account is created as a side effect of successful authentication.

**Capability 2: Subject/issuer-based identity matching with explicit prohibition on email**

Identity assertions are matched to existing accounts using the compound key of the OIDC subject claim (`sub`) and issuer (`iss`), stored in the `users` table as `oidc_subject` and `oidc_issuer`. Email address SHALL NOT appear anywhere in the identity resolution query path — not as a primary key, not as a fallback, not as a tiebreaker. A returning user who authenticates with the same `sub`/`iss` pair but a changed email address MUST be matched to their existing account. Their email in the database SHALL be updated to reflect the new value. Historical continuity of account data (session participation, team memberships) depends on this constraint holding through every future refactor.

**Capability 3: Concurrent first-access handling via upsert pattern**

Account resolution SHALL use a database upsert (`INSERT ... ON CONFLICT DO UPDATE`) keyed on the `(oidc_subject, oidc_issuer)` unique constraint. This eliminates the race condition inherent in a check-then-insert pattern. When two concurrent authentication callbacks arrive for the same user (same `sub`/`iss`) before any account exists, exactly one account record is created and both callbacks complete successfully. Neither callback returns an error. The upsert pattern must be preserved in any future refactor of the account resolution logic.

**Capability 4: No-team landing page — persistent condition check, server-side redirect, enumerated layout constraint**

A user with no active team memberships SHALL be presented with a dedicated landing page at `/no-team`. The routing decision — whether to direct a user to the no-team page or to a team view — is made server-side in the authentication callback, against live team membership data. The client MUST NOT determine this routing by making a separate API call after receiving an initial redirect to `/`.

The no-team condition is evaluated at every sign-in, not only on first access. A previously active user from whom all team memberships have been removed will see the no-team page on their next sign-in, with the same content as a first-time user. The no-team page must show the same content regardless of whether the user is new or returning — the condition (no team membership) is the same, and the only actionable path (obtain a join link) is the same.

The no-team page SHALL present exactly four elements and nothing else:

1. The authenticated user's display name
2. A statement that the user is not yet a member of any team
3. An instruction to request a join link from a facilitator
4. A sign-out affordance

"Nothing else" means no application navigation bar, no sidebar, no header navigation links, no feature menus — not even empty, collapsed, or disabled versions of them. The sign-out affordance is the only interactive element. The page MUST NOT be rendered inside any layout wrapper that contributes additional navigation, links, or menus. This constraint applies at the routing layer, not only at the component level. A user navigating directly to `/no-team` after having joined a team SHALL be redirected to their team view.

**Capability 5: Missing claims rejection — no account, no session, log without PII**

If the OIDC identity assertion is missing the `sub` claim, contains an empty `sub` value, is missing the `iss` claim, or contains an empty `iss` value, the application SHALL: reject the authentication attempt, return a user-visible generic error indicating sign-in failed, create no account record or partial database state, establish no session, and log the failure including the name of the missing or invalid claim (for example, `missing_claim: sub`). No PII — including the values of any other claims present in the token — SHALL appear in the failure log entry. This validation MUST occur before `resolveOrCreateAccount` is called.

---

## Acceptance Criteria

**AC-1: Automatic account creation** *(Capability 1)*
- [ ] A user who authenticates successfully for the first time receives a new account record automatically, with no team memberships and no role assignments.
- [ ] The application creates a user account as a direct result of successful authentication, with no other preconditions required from any actor.
- [ ] A returning user who authenticates again is matched to their existing account; no second account is created.

**AC-2: Identity matching by sub/iss, never email** *(Capability 2)*
- [ ] A returning user who authenticates with the same `sub`/`iss` but a changed email address is matched to their existing account. Their email in the database is updated.
- [ ] Two identity assertions with the same email address but different `sub` values result in two separate accounts.

*Implementation note: The account lookup query must use only `oidc_subject` and `oidc_issuer` as match keys, with email absent from any query used for identity resolution. This is a code review constraint, not an executable behavioral assertion; see Implementation Notes.*

**AC-3: Concurrent handling** *(Capability 3)*
- [ ] When two concurrent authentication callbacks arrive for the same `sub`/`iss` before any account exists for that identity, exactly one account record is created and both callbacks complete without error. *(Verified via a concurrent test that fires two authentication callbacks for the same sub/iss simultaneously with no prior account record; standard unit tests will not reproduce this — a genuine concurrent or seeded-concurrency harness is required.)*

**AC-4: No-team redirect — server-side, live data** *(Capability 4)*
- [ ] When the authentication callback completes for a user with no team memberships, the server-side redirect is to `/no-team`, not to `/`.
- [ ] When the authentication callback completes for a user with at least one team membership, the server-side redirect is to `/team/:teamId`, not to `/`.
- [ ] A user whose team memberships are removed in the database is routed to `/no-team` on their next sign-in, regardless of what route they were directed to in their prior session.
- [ ] A user who navigates directly to `/no-team` after having joined a team is redirected to their team view.
- [ ] A user who previously held team memberships and from whom all memberships have been removed is routed to `/no-team` on their next sign-in.

*Implementation note: The team membership check in the callback must query live database state, not a cached session flag. AC-4c and AC-4e verify this behaviorally; the underlying implementation constraint is covered in Implementation Notes.*

**AC-5: No-team page layout** *(Capability 4)*
- [ ] The no-team page renders the user's display name, a statement of no team membership, an instruction to request a join link, and a sign-out affordance.
- [ ] The no-team page renders no application navigation bar, sidebar, header links, or feature menus. Test condition: the rendered page DOM contains no element that is a child of a shared layout component, and no element whose role or ARIA label corresponds to application navigation.

*Implementation note: The `/no-team` route in the router must not be wrapped in any layout component that contributes navigation elements. This constraint applies at the routing layer, not only at the component level; it is verified by code inspection (Task 4) and an automated regression test (Task 8) in tasks.md, not by a behavioral AC.*

**AC-6: Missing claims rejection** *(Capability 5)*
- [ ] An OIDC assertion with a missing or empty `sub` claim results in: rejected authentication, no account created, no session established, a generic user-visible error, and a log entry naming the missing claim without including any claim values or identity attributes from the token.
- [ ] An OIDC assertion with a missing or empty `iss` claim results in the same behavior.

**AC-7: Account creation failure → no session** *(Capability 1)*
- [ ] If the database operation for account creation fails, no session is established and the user receives a generic error message.
- [ ] No partial state exists after a failed account creation: no session, no incomplete account record.

**AC-8: Audit logging** *(Capabilities 1 and 5)*
- [ ] When a new account is created via first access, a `first_access_created` event is emitted containing the user id, oidc subject, and oidc issuer.
- [ ] No claim values or identity attributes from the token appear in authentication failure log entries.

---

## Out of Scope

- **Account profile editing.** Users cannot change their display name or email through the application. Those attributes are owned by the identity provider and updated automatically on each authentication.
- **Admin-initiated account provisioning.** There is no manual account creation flow. Administrators cannot create accounts on behalf of users.
- **The `${sub}@unknown` email fallback.** The current implementation stores `{sub}@unknown` when no email claim is present. This is a known operational anomaly (anomalous email domain in any sort or filter by email) but is not a ritual constraint. It is deferred as separate technical debt.
- **`isNewUser` flag reliability under concurrent load.** The current implementation determines `isNewUser` with a SELECT before the upsert. Two concurrent callbacks for the same user could both set `isNewUser = true`. The upsert handles data correctly, but downstream consumers of `isNewUser` could fire twice. This is a hard constraint on future work, not advisory guidance: before any feature that consumes `isNewUser` is merged, the SELECT-before-upsert pattern MUST be replaced with a pattern that derives `isNewUser` from the upsert result, or the consuming feature MUST be designed to treat duplicate firings as an idempotent operation. This change does not address the race. To ensure this constraint is discoverable during future work, a code comment documenting it must be added to `resolveOrCreateAccount` before this change closes (see tasks.md).
- **The "create a new team" path referenced in the use case main flow.** The use case main flow step 6 describes presenting a user with available next steps, including the ability to create a new team. This proposal intentionally excludes any "create team" affordance from the no-team page. A user who arrives at the no-team page is in a waiting state — team creation is the facilitator's responsibility and is handled through the team creation workflow. Offering team creation on the no-team page would allow engineers to bypass the facilitator-from-another-team constraint, which is load-bearing. This is a deliberate departure from the use case main flow text; the traceability gap is acknowledged here and the reason is recorded.
- **Facilitator first-access path.** A facilitator signing in for the first time also has no team memberships and also lands on the no-team page. This is correct behavior. The facilitator's path from no-team to having a team to facilitate is handled by team creation and session setup workflows, which are out of scope here.
- **Distinction between new and returning users on the no-team page.** The no-team page shows identical content regardless of account history. A returning user who has lost all team memberships sees the same page as a first-time user. Their history is preserved and accessible once they rejoin a team; the no-team page is not the place to surface it.
- **Single log-out from the identity provider.** This change is scoped to application session behavior; IdP-level sign-out is addressed separately.

---

## Implementation Notes

**Identity resolution query (from AC-2):** The account lookup query must use only `oidc_subject` and `oidc_issuer` as match keys. Email must not appear in any query used for identity resolution. No executable behavioral test can directly observe the query path — this constraint is enforced by code review.

**No-team route layout isolation (from AC-5):** The `/no-team` route in the router must not be wrapped in any layout component that contributes navigation elements. This constraint applies at the routing layer, not only at the component level. Verification is covered by Task 4 (code inspection) and Task 8 (automated regression test) in tasks.md.

**Team membership check must use live database state (from AC-4):** The routing decision in the authentication callback must query live team membership data, not a cached flag from the session. A test for this constraint must create a discrepancy between session state and database state and confirm that the callback reflects the database.

**Server-side redirect complexity:** The server-side redirect is justified by where the data lives — account resolution and team membership state are both available in the callback handler, making the redirect decision a natural consequence of operations already performed. If implementation reveals that server-side routing requires significant unanticipated work beyond what the exploration notes describe, that complexity must be surfaced before it is absorbed. Do not let this become a hidden scope expansion.

---

## Dependencies

- **UC: Sign In** — First Access is triggered from within the sign-in flow. The authentication callback is the entry point for account resolution.
- **UC: Join a Team via Invite Link** — The only actionable path available to a user on the no-team page. First Access creates the account; Join a Team creates the first team membership.
