# Engineering Review — session-creation-existing-team design.md

**Reviewer:** Marcus Oyelaran, Full Stack Engineer
**Status:** Approve with required clarifications before task breakdown. Nothing here blocks the migration/enforcement slice (Migration Plan steps 1–2) from starting; the items below need to be pinned down before steps 3–5.

## Summary

This is implementable, and it follows the codebase's established patterns closely enough that I don't have architectural objections. The `canAssignRoles`-precedent reuse for D4 is the right call, the partial-unique-index approach in D3 is the right call over check-then-insert, and D1's decision not to force-fit `evaluateTeamAccess` is correct — I'd have pushed back if it had gone the other way. My comments are about places where the design is one level less specific than the codebase's own conventions demand, not about the shape of the decisions themselves.

I checked this against `facilitator-sessions.ts`, `teams.ts`, and `team-content-access-helper.ts` directly, including the actual current `POST /draft` handler (not just the proposal's description of it) and the actual `AuthSession`/`checkAssignRolesAuthorization`/`evaluateTeamAccess` code, not the design's paraphrase of them.

---

## D1 — `POST /draft` enforcement

**Implementable as written.** One correction to the design's framing and two sequencing gaps to close before this goes into tasks.md.

### Correction: the "two distinct messages" requirement doesn't need two round-trips

The design frames this as "the `/draft` handler adds its own targeted query" (singular), but the enforcement as described — global_role check, then a separate membership query — is actually the same two-round-trip shape the current handler already has (it fetches `global_role` in one query, then fetches the team in a second). Adding a third query for membership is consistent with the file's existing style, so I won't block on it, but it's not the tightest option. `checkAssignRolesAuthorization` (teams.ts:326) and `evaluateTeamAccess` (team-content-access-helper.ts:65) both resolve this same shape of question — a global_role condition AND a team-scoped condition — in a single query with a LEFT JOIN, and branch on the result in application code to produce distinct messages. That pattern is available here for free:

```sql
SELECT u.global_role,
       (tm.id IS NOT NULL) AS is_member
FROM users u
LEFT JOIN team_memberships tm
      ON tm.user_id = u.id
     AND tm.team_id = $2
     AND tm.removed_at IS NULL
WHERE u.id = $1
```

One query, two branches, two distinct messages — no functional difference from the design's two-query version, one fewer DB round trip per session-creation attempt. I'd raise this at design review, not block on it; either shape passes the acceptance criteria. Worth deciding now rather than leaving it to whoever picks up the task, since it changes the shape of the unit test setup (one mocked query vs. two).

### Gap 1: ordering relative to the existing team-existence check is unspecified

The current handler (`facilitator-sessions.ts:180-229`) runs: (1) fetch actor's `global_role`, reject if not `facilitator`; (2) fetch the team by id, 404 if missing; (3) insert. D1 specifies the membership check runs "second," after the global_role check — but doesn't say whether it runs before or after step 2 (team-existence). This matters for one concrete case: a request for a `teamId` that doesn't exist. If the membership check runs before the team-existence check, the `SELECT 1 FROM team_memberships WHERE team_id = $2 ...` query simply returns zero rows (no membership found) and the request falls through correctly to the 404 — no bug, but it's a wasted query against a team that doesn't exist, and it means the membership-rejection code path is reachable with a dangling `teamId` in its audit trail (see the audit gap below). I'd put the membership check after the team-existence check, mirroring the order every other handler in this file uses (existence checks before relationship checks — see `/advance` and `/complete`, which both check `sessionRow.team_id !== teamId` and existence before authorization-adjacent checks). Not a correctness bug either way; a five-minute decision that should be made explicit before implementation rather than left to whichever engineer picks up the task first.

### Gap 2: no audit trail for the rejection or the creation itself

This is the one I'd actually push on. Every other state-changing endpoint in `facilitator-sessions.ts` — `/advance`, `/start`, `/begin-voting`, `/complete`, `/reveal`, `/topics/advance` — writes an `audit_log` row and calls `emitAuditEvent` for both its success path and, where applicable, its denial path (see `team.role_change_denied` in `teams.ts:821-877`, which exists specifically to audit a *blocked* action, not just successful ones). `POST /draft` today writes neither, and this design doesn't add either:

- **The membership-check rejection** (D1's whole point) is exactly the kind of security-relevant denial `team.role_change_denied` was built to make visible — "a facilitator attempted to create a session for a team they're a member of" is worth knowing happened, especially since the proposal's own framing is "this constraint must hold regardless of how the request is submitted," which implies someone cares about detecting bypass attempts, not just blocking them.
- **A successful draft creation** is the event that establishes the Path 3 "Active Session Facilitator" grant in `evaluateTeamAccess` — i.e., this one INSERT is the root of a content-access grant that persists for up to 24 hours (or 30 minutes post-completion). Every other event that establishes or changes an access grant in this codebase is audited. This one currently isn't, and the design doesn't correct that.

`audit-logger.ts`'s `session.*` event union has no `session.created` variant to reuse — this would need a new event name added there, plus the `audit_log` INSERT the rest of the file already does inline. I'd want this in the task list explicitly rather than have it fall out of scope because the design didn't mention it and nobody thought to check the file's own existing convention.

---

## D2 — `GET /api/v1/teams/eligible-for-session`

**Implementable, route shape is safe.** Fastify's router (find-my-way) resolves static path segments before parametric ones, so `GET /api/v1/teams/eligible-for-session` won't collide with `GET /api/v1/teams/:teamId` — no route-ordering hazard here despite the shared prefix.

One real ambiguity: **what does `lastSessionAt` mean, precisely?** The design says "at least `teamId`, `teamName`, and `lastSessionAt` (nullable)" but doesn't say which column or which statuses populate it. This isn't a cosmetic gap — it interacts directly with the "Resolved" decision immediately below it, which deliberately leaves teams with a live non-terminal session in the `eligibleTeams` list (catching them at `409` on submission instead of filtering them out). If `lastSessionAt` is computed as "most recent session by `created_at` regardless of status," a facilitator looking at the confirm screen for a team with a session currently in `active` status will see something like "Last session: today" with no indication that today's session is still running and that selecting this team will immediately 409. That's a confusing confirm-screen moment for exactly the case D2's "Resolved" note anticipated. I'd specify: `lastSessionAt` = `MAX(completed_at)` over `status = 'complete'` sessions only (mirroring `fetchPreSessionActionItems`'s own convention of sourcing only from `status = 'complete'` sessions), so a live or draft session never masquerades as "last session" context. Worth a line in the spec's scenarios, not just left to whoever writes the query.

No concerns about the query shape itself — LEFT JOIN + `WHERE membership IS NULL AND deactivated_at IS NULL` is the right inverse of `evaluateTeamAccess`'s pattern and matches the codebase's existing live-read discipline.

---

## D3 — Partial unique index + caught-violation 409

**This is the right mechanism, and it's a genuinely new pattern for this codebase** — I searched, and there is no existing precedent anywhere in `packages/backend/src` for catching a Postgres unique-violation (`23505`) and translating it into an application response. Every other uniqueness constraint in this codebase (`team_memberships_active_unique`, `sessions_join_token_unique`) is either never hit in a way that surfaces to a handler, or avoided entirely via `ON CONFLICT` (TEAM-006's upsert). That's not a reason not to do it — it's the correct mechanism for the stated race condition, and the design's own alternative-considered section already rejects the check-then-insert version for the right reason — but it means there's no copy-paste precedent to lean on, and the implementer needs to get two details right that the design doesn't spell out:

1. **`pg`'s error shape.** node-postgres surfaces this as a `DatabaseError` with a `.code` field (`'23505'`) and a `.constraint` field (the index/constraint name — `'sessions_team_active_unique'` here, since a partial unique index's backing constraint name is the index name). The design's mitigation text ("matched against this specific index's constraint name") is correct in intent but should name the concrete field (`err.constraint`, not `err.message` pattern-matching, which is the kind of brittle-and-technically-working code Marcus has seen bite people before). Worth a one-line note in tasks.md so nobody reaches for a message-substring check instead.
2. **Test coverage for the "re-throw anything else" half of the mitigation**, not just the happy 409 path. The risk section names this explicitly ("catching unique-violation errors too broadly could misreport an unrelated constraint failure") but the Migration Plan doesn't list a test for it. I'd want a test that forces a `23505` on a *different* constraint (or a non-`23505` DB error) through this code path and asserts it propagates as an unhandled 500, not a false-positive 409. This is a one-line addition to whoever writes tasks.md, but it's the kind of test that's easy to forget because the happy path is the one everyone remembers to write.

**One process gap in the Migration Plan, not the design decision itself.** The pre-check mitigation ("a pre-check query is run and confirmed clean before the index is added; violations are resolved by an operator before the migration runs") describes a *manual* runbook step that happens outside the migration file. This project uses `node-pg-migrate`, which runs each `.sql` migration inside its own transaction by default (nothing here requires `CONCURRENTLY`, so that default holds). That means the guard can be made self-enforcing instead of procedural: a `DO $$ ... IF EXISTS (...) THEN RAISE EXCEPTION ...; END IF; END $$;` block at the top of the migration file, checking for teams with more than one non-terminal session, immediately before `CREATE UNIQUE INDEX`. If it fires, the whole migration transaction rolls back atomically and the deploy fails loudly — no dependency on an operator remembering to run a separate query first. I'd rather this be a property of the migration file than a step in a document, for exactly the reason "deployment process that lives in a person's head" is on my own list of things I don't want to ship again. This doesn't change the design decision, just how Migration Plan step 1 is executed.

---

## D4 — `canFacilitateSessions` on `AuthSession`

**Implementable, low risk, and I want to flag one precision issue in the design's own justification rather than in the mechanism.**

The design cites this as following "the `canAssignRoles` precedent," but `canAssignRoles` does not exist on `AuthSession` anywhere in the current codebase — I checked `packages/shared/src/types/auth.ts` directly. It's a field on `GET /api/v1/teams/:teamId/members` and `GET /api/v1/teams/:teamId` (`LegacyTeamMembersResponse` / `TeamMembersResponse`), always evaluated per-team via `checkAssignRolesAuthorization`. The actual normative source for D4 is the `role-assignment` spec's requirement text (`spec.md:242`: *"`globalRole` MUST NOT be added to `AuthSession.user`... The `canAssignRoles` flag is more defensive: the client reacts to a server authorization result; it does not compute one."*) — which is about the *principle* (computed boolean, not raw role), not a literal reuse of an existing `AuthSession` field. The design's D4 conclusion is still correct — placing `canFacilitateSessions` at the top level of `AuthSession` (not nested under `.user`) satisfies the letter of that requirement, and computing it fresh from `global_role` on every `/auth/session` call satisfies the spirit — I just want the design doc to cite the requirement text rather than a field that doesn't exist yet, so a future reader doesn't go looking for `canAssignRoles` on `AuthSession` and come up empty the way I did.

Mechanically this is trivial: `auth.ts`'s existing `/session` handler already does one `SELECT id, display_name, email FROM users WHERE id = $1` (auth.ts:560) — this needs `global_role` added to that same `SELECT`, no new query. No Redis caching involved since this handler already reads `users` fresh on every call.

---

## D5 — `AuthenticatedLanding` carve-out

**Trivial, no concerns.** `AuthenticatedLanding` (App.tsx:18-32) is currently an unconditional two-branch component (`teamMemberships.length === 0` → `/no-team`, else → first team). The carve-out is a single `else if` inserted between the two existing branches. No structural risk. The `first-access` spec's "No-team landing page" requirement will need its "unconditionally" language corrected to reflect the carve-out — the proposal already flags this as a dependency owned by the BA, which is the right place for it (this design shouldn't be silently editing that spec's prose itself).

---

## D6 — Draft landing as an in-place control view

**This is where I have my one real implementability concern**, and it's a missing error path the design doesn't address: **what happens on page refresh (or a dropped tab, or a bookmark) while the facilitator is sitting on the draft control view?**

D6 explicitly says the confirm→draft-control-view transition happens "in place (no separate route round-trip beyond the initial navigation to the picker route)." That means, as designed, there is no unique URL that represents "I am the facilitator looking at my own draft session's control view." If the facilitator reloads the browser at that point — which is exactly the kind of foreseeable-but-easy-to-skip condition Marcus's whole engineering philosophy is built around catching before production — they land back at the picker's route (or wherever that route resolves for a facilitator with matching `canFacilitateSessions`), with no way to get back to the draft session they already created, other than manually navigating if they happen to know the session id. Given D3 now blocks a second draft session for the same team, they can't even retry the picker flow to get back to it — the picker would need to somehow surface "you already have a draft session for this team, resume it" as a distinct case, which nothing in this design describes.

Compare this to `/session/:id` and `/team/:teamId`, which are both real, bookmarkable, refresh-safe routes already in the router (App.tsx:77-90+). I'd want one of:
(a) the draft control view gets a real route (e.g. `/session/:sessionId` already resolves generically enough that it could render the draft-control variant when `status === 'draft'` and the viewer is the facilitator — `evaluateTeamAccess`'s Path 3 already grants a facilitator access to their own draft session, so the access-control machinery for this already exists), or
(b) the picker/eligible-teams flow is explicitly extended to detect "caller already has a non-terminal session for a team they'd otherwise be eligible for" and offer to resume it, which is a natural extension of the `409` body D3 already returns (it already carries the existing session's `id` and `status`).

Either is a small addition, but the design's non-goals list only excludes "the join-link landing experience for an Engineer" from scope — it doesn't mention the facilitator's own refresh path, and I don't think that's a deliberate exclusion so much as an oversight. I'd want this resolved before task breakdown, not discovered during implementation or, worse, during Priya's walkthrough.

Smaller note on the same decision: "the same view re-renders in place as the live participant-readiness view" on successful advance — this is fine mechanically (the existing `/advance` endpoint's response already carries the new `status`), but it means the participant-readiness view component needs to be reachable both via this in-place re-render path and via whatever route a participant follows into a `lobby`-status session. Worth confirming in tasks.md that this is one shared component invoked two ways, not two components that will drift.

---

## Cross-cutting: response typing consistency

The reveal/advance endpoints in this file all use dedicated shared response types for their failure states (`RevealFailureResponse`, `RevealAlreadyRevealedResponse`, `TopicAdvanceBlockedResponse`) rather than the generic `{ error: { category, message, correlationId } }` shape used for plain 403/404s. D3's `409` (existing non-terminal session) and D2's `200` empty-array-with-reason response are both exactly this kind of "structured, frontend-actionable failure/edge state," not a generic error. I'd want both typed as named interfaces in `@dipstick/shared` (e.g. `SessionAlreadyExistsResponse { existingSessionId, existingSessionStatus, teamId }`) from the start, matching the file's own convention, rather than left as an ad hoc body shape decided at implementation time — especially since D6 gap (b) above would want the frontend to act on `existingSessionId` directly.

---

## What I'm not raising

- `evaluateTeamAccess` reuse rejection (D1's alternative-considered) — correct call, agree with the reasoning as written.
- Check-then-insert rejection (D3's alternative-considered) — correct call, and appropriately consistent with the `session-participation` dual-check precedent it cites.
- Server-authoritative posture throughout (every new check reads live from the database, nothing cached) — matches the codebase's existing discipline everywhere I checked.
- OIDC/multi-provider concerns — not implicated by this change; `global_role` is already provider-agnostic (set via `resolveOrCreateAccount`'s claim mapping), and this design only reads it, doesn't touch the OIDC layer.

## Recommendation

Approve the decisions as directionally correct. Before this goes into tasks.md, I'd want: the D1 check-ordering and audit-logging gaps closed, D2's `lastSessionAt` definition pinned down, D3's migration guard written as a `DO` block rather than a runbook step, D4's design-doc citation corrected, and D6's refresh/resume path resolved one way or the other. None of these change the shape of the six decisions — they're the difference between a design that reads correctly and an implementation that doesn't quietly diverge from it three weeks from now, which is the whole reason this review step exists.
