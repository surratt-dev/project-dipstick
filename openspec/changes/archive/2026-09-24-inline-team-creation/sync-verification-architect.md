# Sync Verification — Solution Architect

**Change:** inline-team-creation
**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Verify no drift between the just-synced main specs and use-case doc and the actual implementation.

## Files compared

- `openspec/specs/session-creation/spec.md` (rewritten Purpose + 7 new requirements)
- `openspec/specs/default-topic-provisioning/spec.md` (new)
- `requirements/use cases/02 - Session Setup - Use Cases.md` (task 8.1 addendum, both use cases)
- against:
  - `packages/backend/src/routes/facilitator-sessions.ts` (`POST /api/v1/teams`, `POST /api/v1/teams/:teamId/sessions/draft`, `GET /api/v1/teams/eligible-for-session`, `POST /api/v1/teams/:teamId/sessions/:sessionId/advance`, `GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state`)
  - `packages/frontend/src/pages/SessionCreationPage.tsx`
  - `packages/frontend/src/pages/DraftSessionHost.tsx`
  - `packages/backend/migrations/11_teams_name_unique_normalized.sql`
  - `packages/backend/migrations/2_create_tables.sql` (topics/sessions schema), `packages/backend/migrations/10_sessions_team_active_unique.sql`
  - `packages/backend/src/auth/audit-logger.ts`
  - `packages/frontend/src/App.tsx` (routing)
  - `packages/shared/src/types/session-creation.ts`

## Result: No drift found

Every requirement and scenario checked against the code matches. Specifics:

- **Facilitator-from-another-team enforcement** — `POST /draft` reads `team_memberships`/`users.global_role` live on every request (no cached/client-supplied value), two independent checks in the order the spec states, both audited, with distinguishable 403 messages. Matches.
- **Audit logging** — rejection audit row written before the 403 is sent; success audit row written inside the same DB transaction as the `sessions` INSERT. Operation names (`session.draft_denied_membership_conflict`, `session.draft_created`, `team.creation_denied_role`, `team.created_with_session`) are registered in `audit-logger.ts` and explicitly follow the `team.role_change_denied` / `team.manager_established` precedent the spec cites. Matches.
- **Eligible-teams listing** — live, uncached DB read for both the `403`-vs-`200` gate and the team list; `lastSessionAt` sourced from `MAX(completed_at)` over `status = 'complete'` only; response shape (`EligibleTeamsResponse`/`EligibleTeam`) matches `packages/shared/src/types/session-creation.ts` field-for-field. Matches.
- **Concurrent active session block** — enforced by the pre-existing partial unique index `sessions_team_active_unique` (migration 10, not part of this change), caught by constraint name/code (`23505`), `409` body matches `SessionAlreadyExistsResponse` exactly. Matches.
- **Draft-status landing** — route `/team/:teamId/session/:sessionId` is wired to `DraftSessionHost` in `App.tsx`; it fetches `GET .../facilitator-state` on every mount, which enforces `facilitator_id === caller` server-side (confirmed at line ~1951) and returns `joinToken`; renders draft-control view vs. live view based on `currentSessionState`. "Open the room" requires inline confirmation before firing `POST /advance`; failure leaves the draft view intact with a retryable inline error. Matches.
- **Session-creation entry point gating** — `SessionCreationPage` gates on `session.canFacilitateSessions`; confirm screen shows team name + `lastSessionAt`, no team-history expansion; stale-list handling and the 409 "go to existing session" affordance are both present. Matches.
- **`POST /api/v1/teams`** — single transaction creates team, copies default topics, creates session with `is_first_session = true`, `session_number = 1`, `status = 'lobby'`; rolls back cleanly on any failure; audits both the role-denial and success paths with the exact actor/team/session fields the spec lists. Matches.
- **Check order (authenticate → authorize → validate → uniqueness)** — role check runs before the name is even read from the body, so a non-facilitator gets an identical 403 regardless of name collision. Matches.
- **Normalized uniqueness** — pre-check trims/lowercases; DB-level backstop is `teams_name_unique_normalized` (migration 11); any `23505` on the team INSERT (whichever constraint fires) is funneled into the same `TeamNameCollisionResponse`. Matches.
- **Draft-skip for new teams** — session created directly in `lobby`; submit button echoes the typed name (`Create team '<name>' and open session room`); landing view shows a distinct new-team acknowledgment (`newTeamCreated` nav-state flag, not present on the existing-team path). Matches.
- **New-team form as same-component state machine** — `SessionCreationPage`'s `Screen` union includes `'new-team'`; navigating back before submit creates nothing. Matches.
- **Empty eligible-teams state** — copy invites new-team creation in both `callerHasTeamMemberships` variants; "Create a new team" button is reachable regardless of list state. Matches.
- **No membership row for the creating facilitator** — confirmed no `INSERT INTO team_memberships` anywhere in the `POST /api/v1/teams` handler; `created_by_user_id` is set but is explicitly called out in the code's own comments as distinct from membership. Matches.
- **default-topic-provisioning** — the topic copy is a real row-per-row `INSERT ... SELECT` from the sentinel team (`00000000-0000-0000-0000-000000000001`) filtered on `is_default = true`, carrying exactly the six columns the spec lists, in the same transaction as team creation. No "locked" column exists on `topics` anywhere in the schema (verified against `2_create_tables.sql`). The spec's explicit disclaimer that it "has a hard runtime dependency on the sentinel team's rows being correct, but no dependency on how they became correct" is consistent with `fix-default-topic-seed-data` being tracked as a separate, still-open change — not something this spec or this change's code needs to resolve. Matches.
- **Use-case addendum text** — both addenda (draft-landing decision, draft-skip decision) describe the implementation accurately: the draft/lobby split and its rationale (no prior team context to review for a brand-new team), the inline confirmation gate, and the name-echo-as-confirmation substitute. Matches.

## Observation (not spec drift — outside this verification's scope, noted for awareness)

`DraftSessionHost.tsx`'s live-readiness-view (rendered once a session is in `lobby`, whether via "Open the room" or straight from `POST /api/v1/teams`) does not render the join link anywhere, yet the new-team acknowledgment copy it displays says "Share the link below to get started." There is no link below it. Neither `session-creation` nor `default-topic-provisioning` requires this view to display the join link — that appears to belong to the separate "participant readiness view" capability referenced in the use-case doc (not part of this change), so I'm not calling it drift against the two spec files I verified. But the acknowledgment copy currently promises something the view doesn't deliver, and is worth a follow-up ticket before it's load-bearing for a real facilitator. Flagging for the team's awareness, not blocking archive.

## Conclusion

No corrections needed before archive. The synced specs and use-case addenda are an accurate description of the implementation as it exists on this branch.
