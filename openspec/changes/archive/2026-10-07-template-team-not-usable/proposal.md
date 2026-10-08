# Proposal: template-team-not-usable (#214)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (revised after
Priya Nair's `explore-review-facilitator.md` and Marcus Delgado's `explore-review-ba.md`). This is
follow-up F1 (with F2 folded in) from the archived change `2026-10-02-reject-template-team-topic-writes`
(#188), and it answers that change's security review item B1.*

## Why

`__default_topics__` (`DEFAULT_TOPICS_TEAM_ID`, `00000000-0000-0000-0000-000000000001`) is not a team.
It is where the canonical default topic set lives, "the shared language of the ritual" (BRD §6.4,
FR-8.1, FR-8.6). It has a `teams` row only because `topics.team_id` needs something to point at.
#188 stopped topic writes to it. Everywhere else the app still treats it as an ordinary team, and
because nobody belongs to it, it is the **easiest team in the org to facilitate**:

- With no members, the facilitator-from-another-team rule (FR-2.2) is satisfied automatically.
- With no members, there is no Engineering Manager, so the EM-cannot-vote rule (FR-1.4) has nobody
  to apply to.
- It is never deactivated, so it shows up, under its raw name, in every facilitator's session picker.
  Since #237 the team page sends facilitators straight to that picker.

A team with no people passes every ritual check we have. That tells me the checks assume they are
looking at a team, and the template breaks that assumption. The exploration found two ways in:

- **Chain A (admin-initiated):** TEAM-006 puts an EM on the template, the EM creates a join link, and
  people redeem it.
- **Chain B (facilitator-initiated, no admin needed):** a facilitator creates a draft session on the
  template, which mints a join link (FR-2.3). People join, vote and see the reveal, and the session
  completes. Chain B doesn't look like an attack. It looks like someone **practising** before a real
  session. When it finishes, the template has members, votes and a completed session, it is unlocked
  for topic writes, and the results belong to no team. If those results ever surface in an EM view
  or a trend chart, that is the "performance tool" drift I promised the VP we would not build.

I don't want to add one more check per ritual rule. The fix is to say once, structurally, that **the
template is never the subject of a ritual**: no sessions, no members, no join links, and it is never
offered in a picker. The rule is not configurable. No flag or admin override can turn it off.

## What users will see

1. **The template never appears in the session picker**, including when a facilitator arrives through
   the #237 "Facilitate another team's session" link.
2. **A stale selection fails with a message that says what to do.** The confirm screen shows *"This
   team is no longer available. Go back to choose another team."* instead of "Something went wrong …
   try again.", with a **"Choose another team"** button that returns to the picker and reloads the
   list. The same copy is correct for a team that really has gone, so it reveals nothing.
3. **An old template join link lands on the existing invalid-link page**, the same page any unknown
   token gets, even though the migration has revoked it, and without first sending a logged-out user
   to sign in ("This link is not valid … ask the person who invited you for a new link"). That copy
   doesn't change.
4. **Topic Management tells the truth about the canonical set.** It shows a readable "Default topics"
   heading in place of `__default_topics__`, the text *"These are the canonical default topics every
   new team starts from. They can't be edited here."*, and no edit controls. It no longer says
   "until this team completes its first session", which is false for the template.
5. **No session ends while people are in it.** Any cleanup of existing template sessions happens in a
   maintenance window, which is mandatory if H1 finds a non-terminal template session (the migration
   does not notify live connections).
6. **If the template was a facilitator's only eligible team**, the picker shows the existing empty
   state ("no teams you can facilitate right now … Create one"). There is no new copy. The most
   likely case is a **fresh install**, where the template is the only team: the first facilitator
   sees the zero-home-team empty state with its Create control, not `__default_topics__`.

## What Changes

- **Owning rule (`default-topic-provisioning`).** The system SHALL NOT create or revive any
  `sessions`, `team_memberships` or `join_links` row for the template team. Topic reads (TOPIC-001,
  TOPIC-002) and the copy into new teams are unchanged. No configuration, flag or administrator
  override SHALL enable the template as a session or membership subject. FR-1.7 ("a team with no
  completed session shall appear in the facilitator's list") gets an explicit carve-out for the
  template.
- **Database backstop.** One migration (a) revokes any open template join links, soft-removes any
  active template memberships, abandons any non-terminal template session and expires facilitator
  access on any terminal template session (`facilitator_access_expires_at` clamped to the migration
  time), then (b) adds a
  `CHECK (team_id <> template)` constraint `NOT VALID` on all three tables, and (c) validates each
  constraint only where that table has no template rows. New writes are refused immediately in every
  environment. Historical terminal sessions and their votes are **kept and frozen** (H2 default). If a
  route ever bypasses the app guard, the database refuses the write and the request fails as a `500`
  with a distinct `template_constraint_violation` log marker. The `500` is deliberately not
  translated into a `404`, so the bug stays visible.
- **App-layer guard on every team-addressed session, membership and join-link route**, in any HTTP
  method: everything under `/api(/v\d+)?/teams/:teamId/(sessions|members|managers|join-links)`, plus
  both redemption paths (`GET /api/join/:token` and the join that runs inside `GET /auth/callback`).
  The guard never runs as a `preHandler`. On each route it runs after authentication, and after
  whatever authorization that route can perform without template rows. On `draft`, TEAM-005,
  TEAM-006 and the members listing that means after the role or admin check. On the five session
  sub-routes (`advance`, `reveal`, `complete`, `topics/advance`, `facilitator-state`) the only
  authorization is "you facilitate this session", which needs the session row. There the guard runs
  right after authentication and before the session lookup, so **any authenticated caller** gets the
  route's "Session not found." `404` and an audit row. That is what anyone gets for a missing session.
  On join-link creation the template check precedes the membership check, because that check is the
  missing-team response itself. It **supersedes the issue's three acceptance bullets**, which miss
  `/auth/callback` (a second way to redeem a link) and `GET …/facilitator-state` (a GET that mints
  join links).
- **Per-endpoint "as if the team does not exist."** #188's rule carries over. The template gets
  exactly what *that endpoint* already returns for a missing team, including whether a timing floor
  applies. It is not a blanket `404 TEAM_NOT_FOUND`: `draft` and `managers` return `404
  TEAM_NOT_FOUND`, the session sub-routes return their "Session not found." `404`, member role
  changes return 404 "User is not an active member of this team." to admins and `403` to anyone
  else, join-link creation returns `403` "You are not a member of this team.", and both redemption
  paths redirect to `/join-error?joinError=invalid`. The template branch gets no timing floor that
  the missing-team branch doesn't already have, because that would make it distinguishable.
- **One audit operation, `team.template_access_denied`**, with `metadata.endpoint` and
  `metadata.surface ∈ {session, membership, join_link}`. It is fail-open like #188, with the
  `audit_write_failed: true` marker. At most one row per actor per endpoint per minute; every
  refusal still emits the structured event, and a logged-out caller gets the event only. The
  migration's own cleanup is recorded as `team.template_cleanup`. No dashboard or alert is built on
  either.
- **Any spelling of the template id is the template.** The check compares the value Postgres would
  store, so `{…}` or unhyphenated spellings get the same answer. No route gains a new rejection.
- **Picker.** `GET /api/v1/teams/eligible-for-session` never lists the template. The id comes from
  the shared constant and is bound as a parameter. No new UUID literal appears outside `migrations/`.
- **Topic lock reason.** TOPIC-001 and TOPIC-002 both report
  `lockReason: "first_session" | "canonical_defaults" | null` from one shared server function. The
  template is always `isCustomizationLocked: true` with `lockReason: "canonical_defaults"`, whatever
  its session history. `hasCompletedFirstSession` itself does not change, and it never learns about
  the template. The screen picks its copy from `lockReason`, never from the team id.
- **Structural test, fail-closed.** It enumerates the registered routes and selects the prefix
  above in any method, plus an explicit extra list for the two redemption paths. Each selected route
  needs an entry in a per-route actor and request table. A selected route with no entry fails the
  test. There is no exemption list. The test includes a probe self-test, lives in a sibling file to
  #188's test, and asserts in `afterAll` that no new template rows exist.
- **Read surfaces are closed by membership gating plus expiring the facilitator grant**, not by an
  exclusion filter on each surface. `evaluateTeamAccess` grants team reads without membership to the
  facilitator of a recently completed session (a 30-minute window). The migration's clamp ends that
  grant for every template session at once, and the constraint stops new ones. This covers `/trends`,
  `/action-items`, session history and the realtime layer together. Each gate is verified by a short
  checklist with one test per gate. A surface that turns out not to be gated is filed as a separate
  issue, not added to this change.
- **#188's accepted difference #1 is retired.** `403 FACILITATOR_IS_TEAM_MEMBER` on a template topic
  write can no longer happen, because no active template membership can exist.
- **Behaviour change for existing callers.** Requests that used to succeed against the template now
  return the missing-team response. No legitimate client depends on this, so it is **not BREAKING**.

## Constraints that must be preserved

- **EM-cannot-vote rule (FR-1.4).** The template must never hold an EM, because it must never hold
  anyone. The guard and the constraint enforce this together.
- **Facilitator from another team (FR-2.2).** The template is refused before this rule is checked,
  and the refusal doesn't depend on it. The template is never measured against a rule it would pass
  trivially.
- **FR-8.6.** The defaults stay visible and restorable for every real team. Only *using the template
  as a team* is blocked. `POST /api/v1/teams` still copies the template exactly as before.
- **Anti-enumeration.** On each endpoint the status and body are the same as that endpoint's
  missing-team response, and the template branch gets no timing floor the missing-team branch lacks.
  Tests compare status and body only. The template's id is public, so header-by-header and timing
  tests are not worth their cost.
- **Authorization runs first where it can.** Callers who fail authentication, or a role or admin
  check that does not need template rows, still get that endpoint's `401` or `403`. Where
  authorization depends on rows the template cannot have (session sub-routes, join-link creation),
  the guard runs first and answers as for a missing team.
- **Structural, not configurable.** There is no toggle, no "allow practice on template" option and no
  admin override.
- **Real teams are unchanged.** Every non-template team behaves exactly as it did, including the
  lock, the picker and the check order.

## Capabilities

### New Capabilities

None. The owning rule extends `default-topic-provisioning`, which already owns the template.

### Modified Capabilities

- `default-topic-provisioning`: ADDED owning rule (the template is never a session, membership or
  join-link subject, with no override and the FR-1.7 carve-out), the database backstop, the shared
  denial audit and the structural coverage. MODIFIED #188's topic-write requirement to retire
  accepted difference #1 and to replace the "known gap" read scenario with the permanent lock.
- `session-creation`: MODIFIED eligible-teams listing to exclude the template. ADDED template
  rejection on `draft` and on every team-addressed session sub-route, with per-endpoint parity, and
  the confirm-screen "no longer available" branch.
- `manager-team-association`: ADDED TEAM-006 rejects the template (`404 TEAM_NOT_FOUND`, after the
  admin `403` and the rate limiter).
- `role-assignment`: ADDED TEAM-005 and the members listing answer the template as they answer a
  missing team.
- `join-link`: ADDED join-link creation, token redemption and the through-auth join never act on the
  template.
- `topic-customization-lock`: ADDED `lockReason` and the permanent template lock, from one shared
  function used by TOPIC-001 and TOPIC-002.
- `topic-management-screen`: MODIFIED lock notice (copy chosen by `lockReason`). ADDED the canonical
  defaults view.

## Non-goals

- A facilitator practice or sandbox mode, except the conditional trigger under H1.
- A `teams.kind` column, or marking the template deactivated (overloads `deactivated_at` and fixes
  nothing else).
- A database constraint on `topics` (still F3, #215).
- Special-casing a new team named `__default_topics__`. The existing unique-name index already
  rejects it.
- Changing the invalid-join-link copy.
- Exclusion filters on individual read models (see What Changes: membership gating).

## Impact

- **Backend:** `routes/facilitator-sessions.ts` (draft, the five team-addressed sub-routes,
  eligible-teams query), `routes/teams.ts` (members, member role, managers), `routes/join-links.ts`
  (create, redeem), `routes/auth.ts` (`executeJoinFlow`), `routes/content.ts` (session-history reads
  and the TOPIC-001/TOPIC-002 lock fields), a new shared module for the template check and its audit
  writer, and a new lock-state function beside `auth/topic-lock-helper.ts`.
- **Migration:** one new numbered migration (cleanup, three `NOT VALID` constraints, and a conditional
  `VALIDATE`).
- **Frontend:** `SessionCreationPage.tsx` (404 branch), `TopicManagementPage.tsx` (copy chosen by
  `lockReason`, plus the "Default topics" heading).
- **Tests:** the new `team-template-guard-structural.test.ts` (multi-actor, with a probe self-test),
  parity tests for each endpoint, migration tests (fresh and with existing history), lock-reason API
  and UI tests, picker and empty-state tests, and membership-gate verification for the read surfaces.
- **Audit:** two new operation names (`team.template_access_denied`, `team.template_cleanup`). No
  schema change, because `audit_log.operation` is free text.
- **Shared types:** `packages/shared/src/types/topic.ts` gains `TopicLockReason`, `lockReason` on
  TOPIC-002's response and a response type for TOPIC-001.
- **Error handling:** a narrow error handler in `register-routes.ts` sanitizes and marks template
  constraint violations only; every other error response is unchanged.
- **API shape:** additive `lockReason` field on TOPIC-001 and TOPIC-002. Nothing else changes for real
  teams.

## Human follow-ups (recorded, not blocking the proposal)

- **H1. Pre-deploy data check. Owner: Devon Calloway (default, pending Brian's confirmation).**
  This had no owner from #188 until now, and "human operator" does not count. Per the Exec review
  (C1), I take it by default as the champion who framed the change. Brian confirms or names someone
  else when he approves this proposal. It must be done before deploy. In each deployed environment, before deploy, count template rows in
  `sessions` (by `status`), in `team_memberships` (active and removed) and in `join_links` (open and
  unexpired). If any non-terminal session exists, deploy in a window with no session running. Record
  the results here. **If any template `sessions` row exists**, file a "Facilitator practice mode"
  issue linked to #214 before this change is archived, and put it in the backlog for Rachel's review
  alongside onboarding work. Practice use is an adoption signal (first-session nervousness), not only
  a security finding. Otherwise record "no evidence of practice use".
  The migration is safe whatever the results are, so they decide only *when* to deploy, never *what*
  ships.
  - *Owner:* **Devon Calloway (default; Brian to confirm)** · *Results:* **pending**
- **H2. Product sign-off (Brian): keep or delete historical template sessions and votes.** **Default
  adopted: keep them**, frozen by the constraint and kept out of every view by membership gating and
  the facilitator-access clamp. Rachel supports the default in the Exec review.
  Deleting can't be undone, and these rows are the only evidence of how the template was being used.
  This only matters if H1 finds rows. If Brian chooses deletion, it becomes a separate data-remediation
  task and doesn't change this design.
  - *Decision:* **pending confirmation of the default**
- **H3. Ask the champions about rehearsal. Owner: Devon Calloway.** Whatever H1 finds, I ask the
  current champions whether they would have used a rehearsal mode before their first real session,
  and record the answer here (Exec review C2). It is a short conversation, not a build.
  - *Results:* **pending**

## Incorporated review feedback (propose stage)

Reviews: `propose-review-ba.md` (Marcus Delgado, approve with changes) and `propose-review-exec.md`
(Rachel Okonkwo, approve with conditions).

**Accepted**

- **BA B1 (guard order on session sub-routes).** Checked in the code: on all five sub-routes the
  only authorization is `sessions.facilitator_id = caller`, read after the lookup. The guard now runs
  right after authentication. Any authenticated caller gets "Session not found." plus an audit row,
  and a participant-role scenario covers this. Proposal, design D3 and the `session-creation` delta
  now say the same thing.
- **BA B2 (facilitator grant on completed template sessions), option (a).** Checked in the code:
  `evaluateTeamAccess` path 3 admits `status = 'complete' AND facilitator_access_expires_at > NOW()`,
  and the migration only abandoned non-terminal sessions. The migration now clamps
  `facilitator_access_expires_at` on terminal template sessions, before the constraints are added,
  because a `NOT VALID` check still applies to updates. A scenario and task 1.2 cover `/trends`,
  `/action-items` and session history. Task 8.4 lists the read routes outside the prefix.
- **BA V2–V10.** Non-admin members-listing scenario. One sentence on the join-link check order.
  "Choose another team" button that reloads the picker. `404`/`409`/`403` copy stated. No
  `__default_topics__` anywhere on the page or in `document.title`. TOPIC-001 check moved to unit
  level. Floor stated per route. Session-history audit behaviour stated. Fresh-install picker
  scenario.
- **BA V1, in part.** The untestable "any combination of configuration" became a source-inspection
  test showing the guard reads no config.
- **BA FR-1.4 label.** Now "the EM-cannot-vote rule (FR-1.4)".
- **BA FR-1.7 note.** Task 9.1 adds a rationale note under FR-1.7 in `requirements/BRD.md`, following
  the #188 and #243 precedent. It belongs in this change because this change makes the carve-out.
- **Exec C1.** The H1 owner defaults to Devon. Brian confirms at approval. This also meets the BA's
  "before the tasks stage".
- **Exec C2.** A practice-mode finding goes to the onboarding backlog for Rachel's review. H3 adds
  the champion conversation whatever H1 finds.
- **Exec advisories.** Parity is limited to status and body. No dashboard or alert on the audit
  operation. Read-surface verification is a short checklist, and ungated surfaces become separate
  issues.

**Rejected or narrowed**

- **BA B2 option (b), guarding `/trends` and `/action-items`, and making task 3.4 an unconditional
  guard.** A per-route guard would cover only the routes on the list. The grant comes from one helper
  with about ten consumers, including the realtime layer. Clamping the data closes it for all of them,
  and the constraint stops the grant from coming back. Task 3.4 is now an unconditional *test* using
  the facilitator-grant fixture. It adds no guard to the GET reads, which therefore write no audit row
  (BA V9, answered).
- **BA V1, second half (running the structural suite again under `NODE_ENV=production` with an
  `OIDC_ROLE_MAP`).** The source test already shows the guard reads no config, so a second full run
  adds cost without adding evidence. Declined per the Exec advisory on gold-plating.
- **Header comparisons in parity tests (current draft and TEAM-006 scenarios).** Dropped to status
  plus body, per the Exec advisory. The template's id is public.
- **Strict parity with a missing team on session sub-routes when the caller supplies a *real* session
  id from another team.** For a missing team, `advance`, `complete` and `topics/advance` answer `403`
  "Session does not belong to this team.", while the template answers `404`. Accepted and recorded
  in the design risks. Only a caller who already holds a valid foreign session id can see the
  difference, and the template's existence is no secret.
