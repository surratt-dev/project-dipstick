# Propose review (BA): template-team-not-usable (#214)

*Reviewer: Marcus Delgado (Business Analyst), 2026-10-06. I reviewed `proposal.md` and the seven
spec deltas under `specs/` against issue #214, BRD FR-1.4, FR-1.7, FR-2.2, FR-2.3, FR-8.1, FR-8.6 and
FR-8.7, and my own `explore-review-ba.md`. I spot-checked the route code the deltas depend on
(`facilitator-sessions.ts`, `teams.ts`, `content.ts`, `join-links.ts`,
`auth/team-content-access-helper.ts`). Focus: can each capability be built and tested without asking
me, and is every acceptance condition stated outright?*

## Verdict

**Approve with changes.** This is the most testable proposal I've reviewed on this project. Almost
every requirement has a scenario with a named actor, an exact request, and assertions on status, body,
headers, audit rows and table state. Most of my explore-review items are now closed (see the
traceability table below). The proposal also says plainly that it **supersedes the issue's three
acceptance bullets**. That is the right call, because those bullets miss `/auth/callback` and
`facilitator-state`.

There are two **blocking** issues. Both come from the code disagreeing with something the spec
assumes:

- **B1.** The check order on the session sub-routes cannot be built as written.
- **B2.** "Membership gating closes the read surfaces" is not true for facilitators, and the surfaces
  it leaves open are not on the task list.

The rest are vague phrases and missing edge-case scenarios, each with a concrete rewrite below.

---

## 1. Blocking issues

### B1. Session sub-routes: "after authorization, before any session lookup" contradicts the code

**Where:** `session-creation` delta, "Team-addressed session sub-routes refuse the template team before
the session lookup". The same wording is in proposal §What Changes and design D-table line 80 ("after
that route's auth and role checks, before the session lookup").

**Problem:** On `advance`, `complete`, `reveal`, `topics/advance` and `facilitator-state`, the only
authorization check is `sessions.facilitator_id = caller`. It runs **after** the session lookup,
because it reads the session row (for example `facilitator-sessions.ts:2311-2346` for
`facilitator-state`). Before the lookup there is only session authentication. So "after authorization
and before the lookup" is impossible on these routes. An implementer has to pick one, and the two
choices behave differently:

- **Guard right after authentication** (before the lookup). Any authenticated user gets the template
  `404` and an audit row, including a participant with no facilitator role. That's acceptable for
  parity, because a missing session also returns `404` to anyone, but it should be written down. It
  also means the scenario wording "an authorized facilitator" doesn't define anything.
- **Guard after the facilitator-ownership check.** This can never run, because no template session
  can be owned. The audit row would never be written, and the scenario "The guard, not the lookup,
  produced the 404" would fail.

**Rewrite (requirement text):**
> On each route under `/api/v1/teams/:teamId/sessions/:sessionId`, the template check SHALL run
> immediately after the route's authentication check and after the non-canonical-id rejection, and
> before the session lookup and before any call to `getOrCreateJoinLink`. These routes have no
> authorization check that runs without the session row. Any authenticated caller therefore receives
> that route's "Session not found." `404`, and the guard writes one `team.template_access_denied`
> row with `surface: "session"`.

**Acceptance:** Add a scenario with a **participant-role** caller (not a facilitator) sending
`POST …/sessions/<random uuid>/advance` for the template. It asserts the `404` "Session not found."
body, one audit row, and zero new rows. Change "an authorized facilitator" in the existing scenarios
to "an authenticated caller". Fix the same wording in the proposal and design D-table so all three
documents agree.

### B2. Membership gating doesn't cover the facilitator grant path to session reads

**Where:** proposal §What Changes, "Read surfaces are closed by membership gating", Non-goals
(exclusion filters), H2 ("kept out of every view by membership gating"), and tasks §8.

**Problem:** `team-content-access-helper.ts` (lines 197-241) gives a **facilitator grant** with no
membership at all. The grant is based on `sessions.facilitator_id = caller` and on one of these:
a non-terminal status, a recent draft, or **`status = 'complete' AND facilitator_access_expires_at >
NOW()`**. H2 keeps completed template sessions, and the migration only abandons non-terminal ones. So a
facilitator who completed a "practice" session on the template recently still has a valid grant until
`facilitator_access_expires_at` passes. That grant opens these routes:

- `GET /api/v1/teams/:teamId/trends` (`content.ts:398`). This is **outside** the structural prefix
  and not in tasks §8.
- `GET /api/v1/teams/:teamId/action-items` (`content.ts:465`). This is **outside** the prefix and not
  in tasks §8, because 8.2 covers `/api/v1/action-items/:id/*`, which is a different route.
- `GET /api/v1/teams/:teamId/sessions` and `…/sessions/:sessionId`. These are inside the prefix, but
  task 3.4 says "add a guard only if the test shows a difference". The test fixture (a facilitator
  with no template sessions) will **never** show the difference, so the guard won't be added.

This is exactly the "results belong to no team and surface in a trend chart" drift the proposal says
it prevents. The window is short and only applies if H1 finds rows, but "kept out of every view" is
stated as fact, and right now it isn't true.

**Pick one (my recommendation is option a, because it's the smallest):**
- **(a)** The migration also sets `facilitator_access_expires_at = LEAST(facilitator_access_expires_at,
  NOW())` on terminal template sessions. Add to the "Existing template rows are neutralised"
  requirement: "and every terminal template session's `facilitator_access_expires_at` is set to no
  later than the migration time". Add a scenario with a completed template session whose access
  expires tomorrow. After migration, its facilitator receives no data from `/trends`, `/action-items`
  or `/sessions`.
- **(b)** Put the same template guard on `/trends` and `/action-items`, and make 3.4 an
  unconditional guard.

**Also add to tasks §8:**
> 8.4 Enumerate every registered `GET` route with a `:teamId` parameter outside the structural prefix
> (today: `/teams/:teamId`, `/trends`, `/action-items`, `/em/trends`, `/em/trends/:topicId`,
> `/em/action-items`, `/em/action-items/:actionItemId`, `/topics`, `/topics/all`). For each, record
> which gate closes it for the template. Add an integration test for the facilitator-grant path
> (completed template session, unexpired access).

---

## 2. Vague language and missing conditions

| # | Location | Vague text | Concrete rewrite / acceptance |
|---|---|---|---|
| V1 | `default-topic-provisioning`, "No configuration enables…", scenario "No setting re-enables the template" | "starts with **any combination** of supported configuration values" | You can't test every combination. Rewrite it as: "The template guard module and the eligible-teams query SHALL read no configuration value, environment variable or flag." **Acceptance:** a source-inspection test, like the one already used for `hasCompletedFirstSession`, asserts that the guard module doesn't import the config module or `process.env`. Then run the structural test once with `NODE_ENV=production` and an `OIDC_ROLE_MAP`, and once with local defaults. |
| V2 | `role-assignment`, members listing | Only the admin case is specified. What happens to a non-admin non-member is not stated. | `GET …/members` returns `403` "You are not a member of this team." to non-admins **before** the team lookup (`teams.ts:351`). State it: "For a caller who is not an `application_admin`, the existing `403` is returned and no `team.template_access_denied` row is written." Add that scenario. Also add the table entry in the structural test that marks this route as refused-before-guard for that actor. |
| V3 | `join-link`, "The refusal is observable as the guard's" | Guard order is "after authentication and before the membership check", while proposal §What Changes says the guard runs "after authentication **and authorization**" | On this route the membership check *is* the authorization. Say it once, in the proposal: "On join-link creation the template check precedes the membership check, because that check is the missing-team response itself." Otherwise a reviewer will flag the inconsistency during implementation. |
| V4 | `session-creation`, "The confirm step explains a team that is no longer available" | "with **a way back** to the team list" | Name the control and where it goes: "a button labelled 'Choose another team' that returns to the picker step and reloads `eligible-for-session`". **Acceptance:** a UI test clicks it and asserts that the picker re-fetches (so a stale template entry can't reappear from cache). |
| V5 | Same requirement | "The same copy SHALL be used for **any `404`**" | The draft endpoint also returns `404` for a non-canonical id. That's fine, but say so explicitly, and say that `409` (live session) and `403` keep their existing copy. Add a scenario: "draft returns `409` → existing concurrent-session copy, unchanged". |
| V6 | `topic-management-screen`, canonical defaults | "heading 'Default topics' **in place of the team's stored name**" | The stored name may show in more places than the heading: document `<title>`, breadcrumbs, back links. **Acceptance:** "the string `__default_topics__` does not appear anywhere in the rendered page or in `document.title`." |
| V7 | `topic-customization-lock`, template scenario | "TOPIC-001 … **would report** the same values through the same function" | This can't be tested over HTTP, because TOPIC-001 admits no caller for the template. Rewrite it as a unit-level condition: "Both route handlers call the shared lock-state function. A test asserts that TOPIC-001's handler imports and calls it." Or delete the AND clause. |
| V8 | `session-creation`, "No timing floor is added" | "applied only if the endpoint's missing-team path applies one" | Name the result for each endpoint, so the tester doesn't have to work it out: draft has none, the session sub-routes have none, `GET …/sessions` has the `content.ts` floor, members/TEAM-005/TEAM-006 have none, join-link create has none, and the redemption paths have none. One line per route belongs in the structural test's per-route table. Say so. |
| V9 | `session-creation`, session-history reads | It doesn't say whether the guard writes an audit row. | State it: "If the guard is added (see B2), it writes one `team.template_access_denied` row with `surface: "session"` for a caller who passes `resolveTeamContentAccess`." The structural "GET refused before guard" exemption should apply only where the route really is refused earlier. |
| V10 | proposal §What users will see #6, picker scenario | "If the template was a facilitator's only eligible team" | Only the "member of every real team" case is covered. **The most likely real case is missing: a fresh install**, where the template is the only `teams` row and the facilitator has zero memberships. Add the scenario: "GIVEN only the template team exists, WHEN a zero-membership facilitator calls the endpoint, THEN `eligibleTeams = []`, `callerHasTeamMemberships = false`, and the picker shows the zero-home-team empty state with its Create control." This is the first screen a new organisation sees. |

---

## 3. Acceptance conditions per capability (consolidated)

The implementer and the QA reviewer should be able to tick these off:

| Capability | Explicit acceptance (done when…) |
|---|---|
| `default-topic-provisioning` (owning rule + DB) | (1) Fresh DB: three constraints are validated, and a direct template `INSERT` returns `23514` on each table. (2) DB with history: the migration succeeds, terminal rows are byte-identical, the constraint is `NOT VALID`, and new writes return `23514`. (3) Migration no-op: a row-level diff of the three tables shows no change. (4) **Add, per B2(a):** terminal template sessions have expired facilitator access. (5) After the structural suite, `count(*) = 0` new template rows. (6) A bypass yields `500` with log `template_constraint_violation`, not `404`. |
| `session-creation` | (1) Picker excludes the template, in a test with zero memberships **and** in a fresh-install test (V10). (2) Draft parity with missing-team `404` and audit row. No `joinToken`. The FR-2.2 check is not evaluated. (3) Each of the five sub-routes: "Session not found." `404` for any authenticated caller (B1), one audit row, no `join_links` row. (4) Confirm-screen copy for `404`, unchanged copy for `409` and `5xx` (V5). |
| `manager-team-association` | Admin gets `404 TEAM_NOT_FOUND`, plus an audit row, and no `team.manager_established`. A non-admin gets the existing `403` with no audit. The rate limit is hit first. *(Complete as written.)* |
| `role-assignment` | TEAM-005: admin gets `404` "User is not an active member…" plus an audit row, and a non-admin gets `403` with no audit. Members `GET`: admin gets the missing-team `404` plus an audit row, and a non-admin gets `403` with no audit (V2). |
| `join-link` | Create: `403` "You are not a member of this team." plus an audit row (`join_link`), and no row. Redeem via `/api/join/:token` and via `/auth/callback`: redirect to `/join-error?joinError=invalid`, login succeeds, no membership, and an audit row **without the token**. |
| `topic-customization-lock` | Three API cases (template → `true`/`canonical_defaults`, real team with no session → `true`/`first_session`, real team with a completed session → `false`/`null`). A substitution test shows the template stays locked when the helper reports unlocked. A source test shows `hasCompletedFirstSession` has no template reference. |
| `topic-management-screen` | `lockReason` drives the copy (a test renders `canonical_defaults` with a *non-template* id). There are no write controls. `__default_topics__` appears nowhere on the page (V6). The first-session copy is never shown for `canonical_defaults`. |
| Structural test | It selects any method under the prefix, plus the two redemption paths. A missing table entry fails and names the route. The probe route fails the suite. `afterAll` finds zero template rows. A "refused before guard" exemption is allowed only on `GET`. |

---

## 4. Traceability

**Closed from my explore review:** C2 (constraint in scope), C3 (keep, revoke, soft-remove, with H2 for
sign-off), C4 (all five sub-routes guarded, which is better than my recommendation), C5 (audit name and
metadata), C6 (`lockReason` enum), C7 (accepted difference #1 retired), V1, V2, V4, V5 (including the
TOPIC-001 decision), V6 (probe, sibling file, any method), V7 (practice-mode trigger is binary), V8
(`afterAll` plus the constraint). V3 (timing) is resolved by parity rather than a blanket floor. I
accept that, because a floor the missing-team path doesn't have would itself be a tell.

**Still open:**
- **C1 / H1 owner.** It is still "not yet named". I accept that the migration is safe whatever the
  data shows, so this doesn't block the proposal. But H1 gates the practice-mode issue and the
  deploy window. **Name an owner before the tasks stage starts, not before archive.** By then nobody
  will remember to run it.
- **C8 / read surfaces.** This is only partly closed. See B2.

**BRD references:**
- **FR-1.4 is mislabelled.** The proposal calls it "the no-manager rule" in §Why and §Constraints.
  FR-1.4 says an EM can't **vote** in their team's sessions. The rule the template trivially passes is
  that FR-1.4 has no EM to apply to. Reword it to "the EM-cannot-vote rule (FR-1.4)", so the
  traceability holds when someone looks it up.
- **The FR-1.7 carve-out amends a [HARD] BRD requirement**, but only in a spec delta. Precedent: FR-8.7
  added a *Rationale* note to `BRD.md` when `topic-annotation` adjusted scope. Add a task to append a
  one-line note under FR-1.7 in `requirements/BRD.md`: "*The `__default_topics__` template row is not a
  team for this requirement (#214).*" Otherwise the BRD and the spec disagree, and the next reader of
  the BRD will file a bug.
- FR-2.2, FR-2.3, FR-8.1, FR-8.6 and FR-8.7 are cited correctly and preserved.
- **Issue scope item 5** ("show as permanently locked") is fully covered. Issue scope items 1 to 4 are
  covered and extended.

---

## 5. Summary of requested changes

1. **B1:** Rewrite the check order for the sub-routes as "after authentication, before the lookup".
   Add a scenario with a participant caller. Align the proposal and design.
2. **B2:** Expire facilitator access on terminal template sessions in the migration (or guard
   `/trends` and `/action-items`). Make task 3.4 unconditional. Add task 8.4 to enumerate the read
   surfaces.
3. V1 to V10: apply the rewrites in §2, and in particular add the fresh-install picker scenario
   (V10).
4. Fix the FR-1.4 label. Add the FR-1.7 note to `BRD.md` as a task.
5. Name the H1 owner before the tasks stage.
