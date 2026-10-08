# Exploration notes: template-team-not-usable (#214)

*Explored by Devon Calloway (Internal Champion), 2026-10-06. Follow-up F1 (with F2 folded in) from
`openspec/changes/archive/2026-10-02-reject-template-team-topic-writes/` (#188, PR #213).
Security review requested (design-review-security.md B1). Everything below was found by reading code
on branch `agent-team/214-template-team-not-usable`. Nothing was run. Claims are marked
**code-verified** (I read the line) or **inferred**.*

*Revised 2026-10-06 after explore reviews by Priya Nair (`explore-review-facilitator.md`) and
Marcus Delgado (`explore-review-ba.md`). The open questions are now recommendations for the proposal
(§9). What I accepted and rejected, and why, is in §10. The items that need a human are in §11.*

---

## 0. What users will see (carry this into the proposal ahead of the route tables)

Priya is right that the proposal should open with what changes on someone's screen. Then the
plumbing.

1. **The template never appears in the session picker.** This comes first because #237's "Facilitate
   another team's session" link on `TeamPage` sends facilitators straight to that list.
2. **A stale selection fails with a message that tells the facilitator what to do.** The confirm
   screen gets a 404 branch: *"This team is no longer available. Go back to choose another team."*
   It no longer falls through to "Something went wrong … try again" (`SessionCreationPage.tsx:273`).
3. **An old template join link lands on the existing invalid-link page**, the same page any unknown
   token gets.
4. **Topic Management describes the canonical set honestly**: a readable "Default topics" heading,
   "these are the canonical defaults" copy, and no "until first session" promise.
5. **This change ends no session while people are in it.** Any cleanup of existing template
   sessions runs in a maintenance window (§9 R3, §11 H1).
6. **When the template was a facilitator's only eligible team, the picker shows the existing
   empty state** ("no teams you can facilitate right now … Create one",
   `SessionCreationPage.tsx:443-447`). No new copy and no special case.

---

## 1. What this is really about

`__default_topics__` (`00000000-0000-0000-0000-000000000001`, exported once as
`DEFAULT_TOPICS_TEAM_ID` in `packages/backend/src/sessions/default-topics.ts:11`) is not a team. It is
where the canonical default topic set lives, the "shared language of the ritual" (BRD §6.4, FR-8.1,
FR-8.6). It only has a `teams` row because `topics.team_id` needs somewhere to point.

#188 made the template unwritable through the five topic-write routes. It did nothing else. Every
other part of the app still treats the template as an ordinary team, and because nobody is a member
of it, the template is the **easiest** team in the org to facilitate:

- No member means the facilitator-from-another-team rule is satisfied by default.
- No member means no Engineering Manager, so the no-manager rule never comes up.
- It is never deactivated, so it appears in every facilitator's picker.

A team with no people would pass every ritual check we have. That tells me the checks assume the
thing being checked is a team, and the template breaks that assumption. The fix is not one more
check for each ritual rule. The fix is to say once, structurally, that **the template is never a
subject of the ritual**: no sessions, no members, no join links, never offered in a picker.

```
                 ┌──────────────────────────────────────────────┐
                 │   __default_topics__  (sentinel, 0…0001)     │
                 │   role: source of the canonical topic set    │
                 └──────────────────────────────────────────────┘
   allowed  ──▶  read topics (FR-8.6), copy into new teams (POST /api/v1/teams)
   blocked  ──▶  topic writes ............ #188 (done)
   blocked  ──▶  sessions ................ #214 (this change)
   blocked  ──▶  memberships / join links  #214 (this change)
   hidden   ──▶  session picker .......... #214 (this change)
   locked   ──▶  Topic Management UI ..... #214 (this change)
```

---

## 2. Where #188's guard lives and how it works (code-verified)

- `packages/backend/src/routes/topics.ts:188` `checkWritableTeam(request, reply, ctx, startTime)`
  replaced `checkTeamExists`. It runs `SELECT id FROM teams WHERE id = $1`, answers the normal
  404 for no row, then compares `ctx.teamId === DEFAULT_TOPICS_TEAM_ID`. On a match it builds
  `teamNotFoundEnvelope()`, writes a `topic.write_denied_template` audit row (`writeTemplateDenialAudit`,
  l.~265, fail-open with an `audit_write_failed: true` log marker), applies the 150 ms timing floor,
  and sends the 404.
- Order: canonical-id check → authorization (403) → `checkWritableTeam` → customization lock (409).
  The guard runs after auth on purpose (a `preHandler` hook was rejected because it would run first).
- The helper is **local to `topics.ts`** and typed on `TopicWriteDenialContext`. Nothing else
  can reuse it as it stands.
- Structural test: `packages/backend/src/routes/__tests__/topic-write-template-guard-structural.test.ts`.
  It collects routes with an `onRoute` hook over `registerRoutes()` (`routes/register-routes.ts`),
  selects `^/api(/v\d+)?/teams/:[^/]+/topics(/|$)` with write methods (`POST/PUT/PATCH/DELETE/ALL/*`), and
  sends each one `{}` with the template as the first path param. It asserts `404`,
  `code === "TEAM_NOT_FOUND"`, exactly one `topic.write_denied_template` row, and that the template
  is unchanged (snapshot and restore). `EXTRA_IN_SCOPE_ROUTES` is empty, and there is no exemption list.
- The harness (`__tests__/helpers/real-db.ts:149` `buildFullApp(mods, userId, onRoute)`) injects
  **one fixed actor** per app instance. That matters for §6.
- Response parity is defined **per endpoint**: the template gets whatever that endpoint already
  sends for a missing team. I want to keep that rule here, and it has consequences (§5).

---

## 3. Route inventory: what accepts the template today

### 3a. Session lifecycle (`routes/facilitator-sessions.ts`)

| Route | Line | Missing-team response today | Template today | Notes |
|---|---|---|---|---|
| `POST /api/v1/teams/:teamId/sessions/draft` | 285 | 404 `TEAM_NOT_FOUND` (after 401, 403 not-facilitator) | **201, draft created** | Entry point. **Also mints a join link** through `getOrCreateJoinLink` (l.463) and returns `joinToken`. |
| `POST /api/v1/teams/:teamId/sessions/:sessionId/advance` | 774 | (session lookup) | accepted if a sentinel session exists | |
| `POST /api/v1/sessions/:sessionId/start` | 1039 | session-scoped, no `:teamId` | accepted | Not under a `/teams/` prefix |
| `POST /api/v1/sessions/:sessionId/begin-voting` | 1330 | session-scoped | accepted | Not under a `/teams/` prefix |
| `POST /api/v1/teams/:teamId/sessions/:sessionId/reveal` | 1540+ | session lookup | accepted | |
| `POST /api/v1/teams/:teamId/sessions/:sessionId/complete` | 1540 | session lookup | **accepted, and this is what unlocks the template** (`hasCompletedFirstSession`) | |
| `POST /api/v1/teams/:teamId/sessions/:sessionId/topics/advance` | 1938 | session lookup | accepted | |
| `GET /api/v1/teams/:teamId/sessions/:sessionId/facilitator-state` | 2302 | 404 "Session not found." | accepted | **A GET that writes:** it calls `getOrCreateJoinLink` (l.2388) and mints a join link when none is active. A write-method filter will not select it. |
| `GET /api/v1/sessions/:sessionId/action-items-review`, `/participants-roster` | 1181, 1269 | session-scoped reads | — | |
| `POST /api/v1/sessions/:sessionId/participants`, `.../lock-in`, `.../reveal-latency` | `sessions.ts` 56, 268, 556 | session-scoped | — | Joining or voting requires membership, so blocking membership closes these |

### 3b. Picker

`GET /api/v1/teams/eligible-for-session` (`facilitator-sessions.ts:2445`). The query (l.~2485) is
`FROM teams t LEFT JOIN team_memberships … WHERE tm.id IS NULL AND t.deactivated_at IS NULL`.
There is **no sentinel filter** (code-verified). The template is offered to every facilitator,
named `__default_topics__`. `SessionCreationPage.tsx:88` renders whatever this returns, and
`TeamPage.tsx:101` (#237) explicitly relies on this list being correct.

### 3c. Membership and join links

| Route | File:line | Auth | Missing-team response today | Template today |
|---|---|---|---|---|
| `POST /api/v1/teams/:teamId/managers` (TEAM-006) | `teams.ts:987` | `application_admin` only, rate limited | 404 `TEAM_NOT_FOUND` (l.1126) | **creates an EM membership row** (l.1202 INSERT) |
| `PATCH /api/v1/teams/:teamId/members/:userId/role` (TEAM-005) | `teams.ts:653` | admin, or EM *on this team* | admin: **404 "User is not an active member of this team."** (no code, not `TEAM_NOT_FOUND`); others: 403 | demotion only (#109); harmless while there are zero sentinel members |
| `POST /api/teams/:teamId/join-links` (unversioned) | `join-links.ts:11` | **must already be a member** | **403 "You are not a member of this team."** | 403 today; reachable once TEAM-006 or a redemption puts anyone on the team |
| `GET /api/join/:token` | `join-links.ts:84` | token holder | redirect `/join-error?joinError=invalid` | **INSERTs `team_memberships` (l.169)** for the link's team |
| `GET /auth/callback` → `executeJoinFlow` | `auth.ts:839`, INSERT l.896 | token carried through login | redirect `/join-error?joinError=invalid` | **second redemption path**, also inserts membership. **Not named in #214.** |

Every `team_memberships` writer in the backend (grep for `INSERT INTO`/`UPDATE team_memberships`):
`join-links.ts:169`, `auth.ts:896`, `teams.ts:844` (role update), `teams.ts:1202` (managers). All four are in scope.

---

## 4. The chains (the security review saw one, there are two)

```
Chain A (security review B1, admin-initiated):
  admin ─POST /teams/S/managers─▶ EM membership on S
        ─POST /api/teams/S/join-links─▶ token
        ─GET /api/join/:token  or  /auth/callback─▶ participant memberships on S

Chain B (NEW, facilitator-initiated, no admin needed):
  any facilitator ─POST /teams/S/sessions/draft─▶ 201 { joinToken }   ← get-or-create mints a link
                  ─share link─▶ GET /api/join/:token ─▶ participant memberships on S
                  ─advance / start / begin-voting / reveal / complete─▶ completed session on S
                  ⇒ template unlocked, members exist on the template, votes stored against it
```

Chain B is the one I worry about, because it doesn't look like an attack. It looks like a
facilitator **practising**: "let me do a dry run on that odd team in the picker so I don't
embarrass myself on Tuesday." Members join through the link, they vote, the reveal happens,
the session completes. Now:

- the template has members, votes and a completed session (so it is unlocked);
- `403 FACILITATOR_IS_TEAM_MEMBER`, which #188 accepted as "theoretical", is reachable for anyone
  who redeemed the link;
- session data sits on a "team" whose data-access boundary nobody designed (EM views, trend data).

Blocking `draft` closes Chain B at its root, because a draft is where the join link is minted.
Blocking TEAM-006 plus both redemption paths closes Chain A. Blocking `join-links` create is
defence in depth, because it already 403s for non-members.

---

## 5. Ritual constraints in play (Devon's view)

- **Facilitator from another team.** This rule exists to put an outside eye on a real team. A team
  with no members satisfies it trivially, which tells us the template should never be evaluated
  against it at all. I don't want a check like "is the facilitator a member of S?" to be the reason
  the template is refused. The refusal comes earlier and is unconditional.
- **No manager participates.** TEAM-006 can put an EM onto the template. Today nothing harmful
  follows, but "an EM on a team with sessions" is exactly the configuration this rule exists to
  watch. The template must never have an EM, because it must never have anyone.
- **Simultaneous reveal and session integrity.** A practice session on the template produces real
  `votes` rows and a real reveal against the canonical set. Those results don't belong to any team.
  If they ever show up in trend data or an EM view, that is the "performance tool" drift I
  promised the VP we wouldn't build.
- **Topic flexibility within guardrails (FR-8.6).** Defaults must stay visible and restorable. Reads
  stay untouched (TOPIC-001, TOPIC-002, `/topics/all`). Only *use as a team* is blocked.
- **Constraints are structural, not configurable.** No flag, no admin override, no "allow practice
  on template" toggle. If facilitators need a practice space, that is a separate, designed feature
  (see §8). It is **not** something we get by leaving the canon reachable.

### Response semantics: "respond as if the team does not exist"

I'd hold to #188's rule: **per-endpoint parity with that endpoint's missing-team response.** That
means the template response is *not* always `404 TEAM_NOT_FOUND`:

| Route | Template must look like |
|---|---|
| `POST …/sessions/draft` | 404 `TEAM_NOT_FOUND` (after the 401 and the not-facilitator 403) |
| `POST …/managers` | 404 `TEAM_NOT_FOUND` (after the admin 403 and the rate limiter, as missing teams are) |
| `PATCH …/members/:userId/role` | 404 "User is not an active member of this team." for admins; 403 for others |
| `POST /api/teams/:teamId/join-links` | 403 "You are not a member of this team." |
| `GET /api/join/:token` and the `/auth/callback` join | redirect `/join-error?joinError=invalid` (treated as an unknown token) |
| `…/sessions/:sessionId/*` with `:teamId = S` | that route's "Session not found." 404 |

Spelled out for the two session routes the BA flagged:

| Route | Template response |
|---|---|
| `GET …/sessions/:sessionId/facilitator-state` with `:teamId` = S | 404 "Session not found." after the 401 and the role 403, and **no join link minted** |
| `POST …/sessions/:sessionId/complete` with `:teamId` = S | that route's "Session not found." 404, and `hasCompletedFirstSession(S)` stays false |

**Timing is part of parity.** The template branch applies a timing floor exactly where that
endpoint's missing-team path already applies one, and nowhere else (see §10, rejection X2).
Code-verified: `applyTimingFloor` is used by `action-items-review`/`participants-roster`
(`facilitator-sessions.ts:1176`, `:1265`), the EM views and the #188 topic guard. It is not used by
`draft`, `managers` or the join routes.

That has a consequence for the structural test: "assert `TEAM_NOT_FOUND`" works for two routes
only. See §6.

### Traceability

- **FR-2.2** (no session for a team you belong to) is the "facilitator from another team" rule the
  template satisfies trivially.
- **FR-1.4** (an EM can't vote on their own team) is the no-manager rule.
- **FR-2.3** says creating a session mints a join link. That is why `draft` is Chain B's root.
- **FR-1.7** says a team with no completed session "shall appear in the facilitator's list of
  available teams". The template is the one row that FR-1.7 must **not** cover. The
  `default-topic-provisioning` requirement should state this carve-out explicitly, so nobody
  reads the picker filter as an FR-1.7 violation.
- **FR-8.1 and FR-8.6** cover what the template is for (§1).

---

## 6. The structural test: what carrying the #188 pattern over really involves

The #188 test works because all five routes share one prefix, one actor (a standing facilitator),
one response code and one audit operation. None of those holds here:

1. **Actors differ.** Draft needs a facilitator, managers needs an admin, join-links create needs a
   member of S, and redemption needs a token for S. `buildFullApp` takes one `userId`, so the test
   needs an actor for each route.
2. **The guard has to be observable.** For join-links create, a guarded route and an unguarded one
   both return 403 to a non-member. Seeding a sentinel membership to tell them apart would recreate
   the forbidden state. The evidence is therefore a guard-specific audit row, as in #188:
   `team.template_access_denied` (§9 R4).
3. **Selecting by prefix and write method is not enough:**
   - `GET …/facilitator-state` writes (it mints a join link) but is a GET.
   - `GET /api/join/:token` writes a membership but has no `:teamId` in its path.
   - `/auth/callback` writes a membership and has no team in its path at all.
   - `/api/v1/sessions/:sessionId/*` routes are team-scoped by their data, not by their path.
4. **Session sub-routes.** When the guard runs on `:teamId` *before* the session lookup (§9 R2),
   the test needs no sentinel session. The audit row shows that the guard, and not the lookup,
   produced the "Session not found." 404. That settles the problem I left open in the first draft.

The shape is settled in §9 R5.

---

## 7. Design options

### Where the rule lives

| Option | What | For | Against |
|---|---|---|---|
| A. App-layer guard per route | A shared helper generalised from `checkWritableTeam`, called after auth in each route | Matches #188, gives per-endpoint parity, writes audit rows | Relies on every author calling it, so the structural test carries the weight |
| B. DB constraint | `CHECK (team_id <> '00000000-0000-0000-0000-000000000001')` on `sessions`, `team_memberships`, `join_links` | Truly structural. It covers every path, including `/auth/callback`, migrations and ad-hoc SQL | Without A, a violation surfaces as a 500. Validation fails if sentinel rows exist, which is handled with `NOT VALID` (§9 R1) |
| C. Mark the sentinel deactivated | `UPDATE teams SET deactivated_at = …` | One line fixes the picker | Deactivated teams still "exist" everywhere else (`topics.ts:171`), so it fixes nothing else and overloads the meaning of `deactivated_at`. **Rejected.** |
| D. `teams.kind = 'system'` column | Explicit type | Self-describing and filterable | A schema change for one row, when the constant is already the single source of truth. **Out of scope.** |

**Decision: A + B** (§9 R1, R2). A gives the user-facing behaviour and the audit trail. B means a
route someone forgets fails closed (a 500, nothing written) instead of failing open.

### Picker

Filter `t.id <> $n` in the eligible query, binding the imported `DEFAULT_TOPICS_TEAM_ID`. This is a
list filter, not a 404, so parity questions don't apply. Acceptance is in §9 R7.

### Topic Management: "permanently locked"

- Today `content.ts:764` (TOPIC-002) and `content.ts:597` (TOPIC-001) both compute
  `isCustomizationLocked = !(await hasCompletedFirstSession(teamId))`. For the template that says
  "locked" now and could say "unlocked" later. The copy at `TopicManagementPage.tsx:1506` promises
  "until this team completes its first session", which is false for the template.
- **Do not** put the sentinel check into `hasCompletedFirstSession` (`auth/topic-lock-helper.ts`).
  #188 decoupled the template rule from the lock on purpose, and the write gate shares that helper.
- The decision is in §9 R6.

---

## 8. Risks and what could go wrong if the design drifts

- **Guarding only `draft`.** An environment that already has a non-terminal sentinel session could
  still drive it to `complete`. This is closed by guarding every team-addressed session route (R2)
  and by the cleanup migration (R3).
- **Forgetting `/auth/callback`.** The issue names `GET /api/join/:token` only. The login-then-join
  path (`executeJoinFlow`) is a second door into the same room. It is named in R2 and in
  `EXTRA_IN_SCOPE_ROUTES`.
- **Forgetting `facilitator-state`.** A GET that mints join links would slip past any "write methods
  only" selection. That is why the test selects routes in any method.
- **Generalising the guard into a `preHandler`.** This is the trap #188 rejected: it would run
  before authorization and turn 403s into 404s.
- **A blunt "always 404 TEAM_NOT_FOUND".** That would make join-link create and TEAM-005 answer
  differently for the template than for a missing team. Hold the per-endpoint rule.
- **Practice need goes underground.** If facilitators were using the template as a sandbox,
  removing it pushes them to rehearse on a real team. That is worse, because a dry run leaves real
  history that the next facilitator reads. This is handled by a conditional deliverable (R9).
  Practice must never touch the canon or a real team's history.
- **Test data leakage.** A test that seeds sentinel rows makes CI fail the invariant. The
  constraint is VALIDATED on a fresh CI database (R1), so the database rejects such a seed outright.
- **Adding exclusion filters to read models one by one.** That is an opt-in pattern, the same
  failure mode as an opt-in route tag. Read surfaces are closed by membership gating instead (R8).

---

## 9. Recommendations for the proposal stage

These replace the first draft's open questions. Each one is a position the proposal should adopt
unless someone shows me a reason not to.

### R1. DB constraint: in scope, unconditionally, and safe whatever the data check finds (was OQ1, BA C2)

One migration, in this order:

1. **Cleanup (it only does anything if sentinel rows exist):**
   - `UPDATE join_links SET revoked_at = now() WHERE team_id = S AND revoked_at IS NULL`. Revoke the
     links, don't delete them.
   - `UPDATE team_memberships SET removed_at = now() WHERE team_id = S AND removed_at IS NULL`.
     This is a soft remove.
   - Set any **non-terminal** sentinel session (`draft`, `lobby`, `pre_session`, `active`,
     `wrap_up`) to `status = 'abandoned', abandoned_at = now()`. Terminal sessions and their votes
     are left untouched (R3).
2. `ALTER TABLE … ADD CONSTRAINT <table>_not_template_team CHECK (team_id <> S) NOT VALID` on all
   three tables. `NOT VALID` makes Postgres enforce the check on every new INSERT and UPDATE
   immediately while tolerating rows that already exist. Historical sentinel rows are therefore
   frozen: they can't be revived, re-joined or completed.
3. A `DO` block that runs `VALIDATE CONSTRAINT` for each table **only if that table has zero
   sentinel rows**. On a fresh database (CI, new installs) all three constraints become fully
   valid. In an environment with history they stay `NOT VALID` but are still enforced.

So the requirement no longer depends on the data check. The only thing the check gates is *when*
the deploy runs (H1). The sentinel UUID literal is unavoidable in the migration SQL, as it already
is in `4_seed_data.sql`. A comment there points at `DEFAULT_TOPICS_TEAM_ID`, and the grep check
for new literals in R7 excludes `migrations/`.

**Violations of the constraint.** If a route bypasses the guard, the constraint raises SQLSTATE
23514 and the request fails with a 500. Do **not** translate that into the endpoint's 404. It would
hide the bug the constraint exists to expose. Log it with a distinct marker
(`template_constraint_violation`) so Ops can see it. In answer to Priya's Q4: a facilitator can only
reach this through a hand-typed URL, because the template is no longer in the picker. The
structural test (R5) is what keeps facilitator-facing routes from ever getting there.

### R2. Which routes get the app-layer guard (was OQ2, BA C4)

The guard sits on **every** route under
`/api(/v\d+)?/teams/:teamId/(sessions|members|managers|join-links)`, in any method, plus the two
redemption paths. I go one step past the BA's three session routes. The fail-closed structural test
(R5, which I accept) selects all of these routes. Leaving `advance` or `reveal` unguarded would
need an exemption list, and an exemption list is a quiet way of making the rule optional. Each
guard is one helper call.

| Route | Template response |
|---|---|
| `POST /api/v1/teams/:teamId/sessions/draft` | 404 `TEAM_NOT_FOUND` |
| `POST …/sessions/:sessionId/advance`, `/reveal`, `/complete`, `/topics/advance` | that route's "Session not found." 404 |
| `GET …/sessions/:sessionId/facilitator-state` | "Session not found." 404, no link minted |
| `GET /api/v1/teams/:teamId/members` | that route's missing-team response |
| `PATCH /api/v1/teams/:teamId/members/:userId/role` | admin: 404 "User is not an active member of this team."; others: 403 |
| `POST /api/v1/teams/:teamId/managers` | 404 `TEAM_NOT_FOUND`, after the admin 403 and the rate limiter |
| `POST /api/teams/:teamId/join-links` | 403 "You are not a member of this team." |
| `GET /api/join/:token` (token resolves to S) | redirect `/join-error?joinError=invalid` |
| `GET /auth/callback` (pending token resolves to S) | redirect `/join-error?joinError=invalid` |

These routes rely on the constraint and on having no membership, with no guard: the
session-addressed `/api/v1/sessions/:sessionId/{start,begin-voting,action-items-review,participants-roster}`
and the `sessions.ts` routes `participants`, `lock-in` and `reveal-latency`. No new sentinel
session can exist (draft is guarded and the constraint blocks it), any old non-terminal one has
been abandoned (R1), and joining or voting requires an active membership.

**Placement.** The guard goes inside each route's existence or lookup step, after authentication
and authorization and *before* the session lookup, the same way `checkWritableTeam` is placed. It
is never a `preHandler`. The shared module provides `isTemplateTeam(id)` and the audit writer. Each
route keeps building its own missing-team response.

**Timing.** The template branch applies `applyTimingFloor` only where that endpoint's missing-team
path already does (§5).

### R3. What happens to existing sentinel rows (was OQ5, BA C3, Priya Obs 8)

- **Join links** are revoked, not deleted. **Memberships** are soft-removed.
- **Terminal sessions and their votes are preserved and frozen.** They are not deleted. Deletion
  can't be undone, and if the rows exist they are the only evidence of how people were using the
  template (R9).
- **Non-terminal sessions are abandoned by the migration**, and only inside a maintenance window
  with no session running (H1). Nothing should end a session while people are in it.
- A participant still holding a sentinel link gets the existing invalid-link page. Its copy is
  code-verified (`JoinErrorPage.tsx:21-30`): "This link is not valid." and "…ask the person who
  invited you for a new link." It doesn't blame the participant and it tells them who to ask, so
  it stays unchanged.

Preserving the rows rather than deleting them needs product sign-off (H2).

### R4. Audit operation (was OQ3, BA C5)

Use one operation, **`team.template_access_denied`**, with `metadata.endpoint` (method plus route
pattern) and `metadata.surface ∈ {session, membership, join_link}`. One name gives Ops a single
query. It says "access" rather than "write" because the guard also covers GETs. It is fail-open
with the `audit_write_failed: true` marker, as in #188. `topic.write_denied_template` stays as it is.

### R5. Structural test (was OQ4, BA V6)

I accept the BA's rewrite as written. Routes are enumerated with `onRoute`. The selection is
`^/api(/v\d+)?/teams/:[^/]+/(sessions|members|managers|join-links)(/|$)` in any method, plus
`EXTRA_IN_SCOPE_ROUTES` containing `GET /api/join/:token` and `GET /auth/callback`. A per-route
table gives each route its actor and request builder, and a selected route with no table entry
fails the test, with no exemption list. For each route the test asserts:

- the R2 parity response;
- exactly one `team.template_access_denied` row;
- zero sentinel rows in the three tables.

It also includes a probe self-test: a temporary unguarded `POST …/sessions/__probe` must make the
suite fail. It lives in a **sibling file**, `team-template-guard-structural.test.ts`, because the
multi-actor model would make #188's file harder to read. The zero-sentinel-rows assertion also
runs in that file's `afterAll`, which covers the BA's V8 without adding a separate CI step.

### R6. Topic Management lock (was OQ6, BA C6/V5, Priya Q3)

- **A server field.** One shared server function returns
  `{ isCustomizationLocked, lockReason: "first_session" | "canonical_defaults" | null }`, where
  `null` means unlocked. Both TOPIC-001 and TOPIC-002 use it, so the two can't disagree. Including
  TOPIC-001 is a one-line change at the same call site, and it keeps the endpoints consistent.
- For S the answer is always `true` / `"canonical_defaults"`, whatever the session history.
- The UI chooses copy from `lockReason`, never from the id. For `canonical_defaults` it shows the
  heading "Default topics" instead of the raw `__default_topics__` name, the text *"These are the
  canonical default topics every new team starts from. They can't be edited here."*, and no edit
  controls. It does not show the "until first session" copy.
- `hasCompletedFirstSession` is unchanged. A source-level test asserts that
  `topic-lock-helper.ts` doesn't reference `DEFAULT_TOPICS_TEAM_ID`.
- The BA's three API acceptance cases (template, a normal locked team, a normal unlocked team) and
  the UI test for each reason are carried as written.

### R7. Picker and confirm screen (Priya Obs 6, 7, 12; BA V4)

- **Picker acceptance:** a facilitator with zero memberships never sees S. A team the facilitator
  doesn't belong to is still listed. The constant is bound as a parameter, and there are no new
  UUID literals outside `migrations/`.
- **Confirm screen (frontend task, in scope):** add a 404 branch in `SessionCreationPage` with the
  copy *"This team is no longer available. Go back to choose another team."* The same copy is
  correct for a team that really is missing, so parity holds. Test it.
- **Regression test:** when S was the caller's only eligible team, the existing empty state
  renders.

### R8. Read surfaces (BA C8, Priya Obs 11)

Read models are closed by **membership gating, not by per-surface exclusion filters**:

| Surface | Gate | Status |
|---|---|---|
| EM sessions, trends and action items (`em-views.ts`) | `evaluateTeamAccess` member grant with role EM | code-verified for the gate. That it ignores rows with `removed_at` set is **inferred**, so verify |
| Picker `last_session_at` | S filtered out (R7) | — |
| Team page and session history | links only to the caller's own teams (`TeamPage.tsx:138`) | code-verified |
| Action-item routes (`/api/v1/action-items/:id/*`) | membership | **inferred**, so verify |
| Cross-team admin session or trend views | none found in the route list | **inferred** |

The proposal adds one verification task per row. An explicit exclusion requirement is added only
for a surface that turns out not to be membership-gated.

### R9. Practice mode as a conditional deliverable (BA V7, Priya Obs 3)

If the pre-deploy data check (H1) finds **any** sentinel `sessions` rows, a "Facilitator practice
mode" issue linked to #214 is filed before this change is archived. If it finds none, the proposal
records "no evidence of practice use". In either case, practice never touches the canon or a real
team's history.

### R10. Spec homes and acceptance (was OQ7, OQ8; BA traceability)

- The owning rule goes in `default-topic-provisioning`, using the BA's V1 wording with the
  FR-1.7 carve-out (§5). It includes a requirement that "no configuration, flag or admin override
  SHALL enable use of the template team as a session or membership subject".
- Check-order deltas go in `session-creation` (guards plus the picker filter), `manager-team-association`,
  `role-assignment` and `join-link`. Lock-reason deltas go in `topic-customization-lock` and
  `topic-management-screen`.
- **Retire #188's accepted difference #1** (`403 FACILITATOR_IS_TEAM_MEMBER`). Once memberships are
  soft-removed and the constraint is in place, no active sentinel member can exist.
- The proposal states that it **supersedes** the issue's three acceptance bullets and says why:
  the issue's list misses `/auth/callback` and `facilitator-state`.
- **Out of scope**, to be stated in the proposal: practice or sandbox mode (except the R9 trigger);
  a `teams.kind` column; deactivating the sentinel; a constraint on `topics` (still F3); and the
  `POST /api/v1/teams` name collision on `__default_topics__` (Priya Obs 10, see §10 X5).

---

## 10. Review disposition

**Accepted:** the user-visible outcomes section (§0), the confirm-screen 404 branch, the
empty-state regression test, the readable heading, picker priority, explicit dispositions for edge
surfaces, "Session not found." parity rows for `facilitator-state` and `complete`, the
`lockReason` enum, the single audit name with metadata, the fail-closed structural test with a
probe self-test in a sibling file, retiring accepted difference #1, the extra spec homes,
superseding the issue's acceptance bullets, the out-of-scope list, "no configuration SHALL enable"
written as a requirement, the conditional practice-mode issue, FR traceability, and settling
TOPIC-001.

**Rejected or modified, with rationale:**

- **X1. "The constraint is conditional on the data check returning zero rows" (BA C2). Modified.**
  The constraint ships unconditionally, `NOT VALID` plus a conditional `VALIDATE` (R1). If the
  protection depends on a check nobody has owned since #188, it can slip indefinitely. A
  structural rule shouldn't wait on an operational task.
- **X2. "Apply the 150 ms floor to every template denial for consistency" (BA V3). Rejected.**
  Parity includes timing. A floor added only to the template branch of `draft` or `managers` would
  make the template slower than a missing team and *create* the distinction we are trying to hide.
  Each branch matches its endpoint's existing behaviour.
- **X3. "Guard three session routes, constraint only for the rest" (BA C4). Modified upward.** Every
  team-addressed session route is guarded (R2), because the BA's own fail-closed test would
  otherwise need an exemption list.
- **X4. "Exclude preserved sentinel sessions from every read model" (BA C3/C8). Modified.**
  Per-surface exclusion filters are opt-in, and every new read model would have to remember them.
  Membership gating closes all of them at once. Each gate is verified (R8), and an exclusion
  requirement is added only where a surface isn't gated.
- **X5. Special-casing the new-team name collision (Priya Obs 10). Rejected; current behaviour is
  kept.** The `teams_name_unique_normalized` index (migration 12) rejects the name anyway, and
  letting a real team be called `__default_topics__` would cause more confusion than the message.
- **X6. Changing the join-error copy (Priya Obs 9). No change needed.** The copy has been verified
  as neutral and tells the reader to ask the person who invited them. Changing it would affect
  every invalid token.
- **X7. A separate CI step for zero sentinel rows (BA V8). Folded in.** A validated constraint on
  the CI database plus the structural test's `afterAll` already enforce this.
- **Tagging routes in `config` instead of selecting them by path (my own first draft). Rejected.**
  Tagging is opt-in, the same failure mode as above.

---

## 11. Needs a human decision or action

- **H1. Pre-deploy data check (operator; still has no owner since #188).** In each deployed
  environment, before deploy, run counts for team id `00000000-0000-0000-0000-000000000001` on:
  `sessions` grouped by `status`, `team_memberships` split by whether `removed_at IS NULL`, and
  `join_links` where `revoked_at IS NULL AND expires_at > now()`. If any non-terminal session
  exists, deploy in a window when no session is running, because the migration abandons those
  sessions. Record the result in the proposal or change notes. It also triggers R9. The migration
  is safe whatever the result, so the result does not change the design. **Someone must be named
  to own this.**
- **H2. Product sign-off (Brian): preserve or delete historical template sessions and votes.**
  I recommend keeping them frozen and unreachable rather than deleting them (R3). The decision
  only matters if H1 finds rows.
