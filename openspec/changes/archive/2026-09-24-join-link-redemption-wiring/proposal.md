## Why

Every join link a facilitator sees today is inert. `DraftSessionHost.tsx` displays and copies a URL built from `sessions.join_token` — a column no backend route validates (`grep -rn "join_token" packages/backend/src` outside `facilitator-sessions.ts` returns zero hits) — assembled at a path (`/join/:token`) that isn't registered anywhere either; the only working redemption route is `/api/join/:token`. A correctly-generated token dropped into today's URL code would still 404. Meanwhile a real, audited, spec'd join-link system (`join_links`, `POST /api/teams/:teamId/join-links`, `GET /api/join/:token`) already exists and already works — it's just never been connected to the session-creation flow that's supposed to hand a link to a facilitator. This means "Join Session via Link," the use case the entire onboarding path depends on, cannot be exercised today by any facilitator using the product as built, and no test in the suite would catch that unless it walks the same URL the frontend actually constructs.

This change wires the two systems together and removes the dead one, so a link a facilitator copies from a draft session is the same link the backend can redeem.

## What Changes

- `facilitator-state` (and `POST .../sessions/draft`'s own response) return a `joinToken` sourced from a real `join_links` row, obtained via get-or-create: reuse the team's active link if one exists, mint one via the existing audited creation path if not.
  - "Active" is defined identically to the predicate `GET /api/join/:token` already checks: `revoked_at IS NULL AND expires_at > NOW()`.
  - When a team has more than one active link (already possible today via repeated manual "generate new link" calls), get-or-create deterministically picks the most-recently-created row.
  - The concurrent-request race on get-or-create (two near-simultaneous callers both observing "no active row" and both inserting) is accepted and documented, not constrained at the database level — the resulting duplicate row is the same spec-legal state a facilitator can already reach on purpose, not a violated invariant.
  - Link creation on the "no active row" branch SHALL invoke the same audited creation logic `POST /api/teams/:teamId/join-links` already uses (extracted into a function both call), not a second, independently-written INSERT+audit-transaction implementation.
- The frontend join-link URL construction is corrected to the backend's actual registered route (`/api/join/:token`, not `/join/:token`), so the link a facilitator copies is one the backend can redeem, not a second, independent bug stacked on the first.
- The draft-session "not yet joinable" badge is reworded to answer what a facilitator actually needs to know at that moment — what happens if the link is used before "Open the room" is clicked — rather than a technically-precise but operationally unhelpful description of which row is gated.
- **BREAKING (schema):** `sessions.join_token` is removed entirely — column, its `UNIQUE` constraint, and its index — via migration, along with every INSERT/SELECT site and test fixture that references it. It is not deprecated in place: a `NOT NULL` column that looks like the thing to wire up is exactly how this bug was introduced, and keeping it as a documented-but-inert field preserves that same attractive nuisance for the next person who touches this code without full context.
- End-to-end verification for this change SHALL exercise the actual frontend-constructed URL (whatever the draft-session view renders and puts on the clipboard), not a direct `GET /api/join/:token` call seeded with a pre-known-good token and path — a token-only test would have passed against the original bug.

## Capabilities

### New Capabilities
_None. This change wires two existing systems (`join-link`, `session-creation`) together and removes a dead one; it introduces no new domain capability._

### Modified Capabilities
- `join-link`: adds get-or-create semantics for a team's active link (the active predicate, the most-recently-created tie-break, the accept-and-document race decision, and the requirement to reuse the existing audited creation path rather than duplicate it) as the mechanism by which draft-session creation obtains a `joinToken`.
- `session-creation`: the "Draft-status landing after session creation" requirement's join-link badge copy is revised to reflect what actually happens if the link is redeemed before "Open the room" is clicked, and this requirement's relationship to session-lobby landing (issue #164) is stated explicitly rather than left implicit.

## Impact

- **Affected code:** `packages/backend/src/routes/facilitator-sessions.ts` (draft creation and `facilitator-state`, both INSERT and SELECT/response sites), `packages/backend/src/routes/join-links.ts` (creation logic extracted into a shared, reusable function), `packages/frontend/src/.../DraftSessionHost.tsx` (URL construction, badge copy).
- **Database:** new migration dropping `sessions.join_token`, `sessions_join_token_unique`, and `idx_sessions_join_token` (the latter two are dropped automatically with the column).
- **Tests:** six backend/frontend test files that construct or assert against `sessions.join_token` directly (enumerated in `design.md`) require updates in the same change, or CI breaks on invalid SQL the moment the migration lands.
- **Out of scope, stated explicitly:** issue #164 (`SessionLobbyPage`'s lobby-branch routing is unreachable, so a join redeemed during `lobby` still doesn't land the Engineer on a working waiting screen) is a separate, already-filed problem. This change makes redemption itself work; it does not make the full "Join Session via Link" experience complete for a `lobby`-state join. `design.md` states the ship-order relationship between the two explicitly, and its Risks section is explicit that relying on the `draft`-stage badge alone as mitigation is an interim stopgap, not a permanent answer — #164 should be scoped and scheduled as a follow-up change promptly after this one ships, not left indefinitely unscoped. Join-link revocation UI and the clipboard/copy UI itself (issue #45) are unaffected by this change.
