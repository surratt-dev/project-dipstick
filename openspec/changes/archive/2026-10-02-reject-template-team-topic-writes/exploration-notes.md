# Exploration notes: reject-template-team-topic-writes (#188)

Explored by Devon Calloway (Internal Champion), non-interactive `opsx:explore` run, 2026-10-02.
Revised the same day after reviews by Priya Nair (Facilitator, `explore-review-facilitator.md`) and
Marcus Delgado (BA, `explore-review-ba.md`). The "Decisions" section (§8) lists what I took and
what I turned down. Branch: `agent-team/188-reject-template-team-topic-writes`. Paths are relative
to repo root.

**Evidence labels used below:**
- **[verified: code]** means I read the code path end to end in this session. I did not execute it.
- **[verified: partial]** means I read the key handlers but not every step.
- **[inferred]** means I reasoned from the code and did not trace it fully.
- Nothing in these notes has been reproduced against a running system.

---

## 1. Why I care (the intent)

BRD §6.4 calls the default topic set "the shared language of the ritual". FR-8.1 says it ships
with the app and applies to every new team. FR-8.6 says it must stay visible and restorable. The
template team `__default_topics__` (`00000000-0000-0000-0000-000000000001`) holds that shared
language. If a team-scoped endpoint can edit it, every team created afterwards starts from a
different baseline, and nobody can see that it happened. Cross-team comparability is lost quietly,
which is the drift §6.4 exists to prevent. Priya added the facilitator's view: a visiting
facilitator's mental model of what a first session covers stops being true, and nothing on screen
tells them so.

My rule from the persona file applies: **a protection that only holds because some other
condition happens to be true is not a protection.** Today the template is protected only because
the customization lock happens to apply to it. That needs to become a structural rule. This is
also why the rule must **not** be filed under `topic-customization-lock` (see §6).

---

## 2. Problem statement, re-ordered by impact and likelihood

### 2.1 Headline impact: team creation can break **[verified: code]**

Priya and Marcus both asked for this to lead, and they are right. A facilitator would notice
"new teams cannot be created", and they would notice it during a first session, in front of a new
team.

The path:
1. TOPIC-004 archive on a template default sets `status = 'archived'` and **leaves
   `display_order` as it was** (`topics.ts` l.1031).
2. TOPIC-006 reorder renumbers **active** rows only, to 1..N (`topics.ts` l.1346 to 1398). An
   active row can now hold the archived row's old position. The seed positions are 1..N
   (`4_seed_data.sql` l.41 onward). Archiving any default other than the last, then reordering,
   produces a duplicate.
3. The team-creation copy (`facilitator-sessions.ts` l.652) selects `is_default = true` with
   **no `status` filter**, and inserts without a `status` column, so every row lands as `'active'`
   (the column default, `2_create_tables.sql` l.52).
4. Two copied rows share a `display_order` while both are active. That violates the partial unique
   index `topics_team_active_order ON (team_id, display_order) WHERE status = 'active'`
   (`18_topics_active_order_partial_unique.sql` l.38).
5. The 23505 is not the name-collision signal, so it reaches the generic catch and returns
   **500 "team creation failed"** (`facilitator-sessions.ts` l.746 to 750). The transaction rolls
   back.

From then on, **every `POST /api/v1/teams` fails** until someone repairs the template by hand.

### 2.2 Likely trigger: a facilitator mis-clicks in the picker (Priya's finding)

**[verified: code]** `GET /api/v1/teams/eligible-for-session` (`facilitator-sessions.ts`
l.2455 to 2506) returns every team with no live membership for the caller and
`deactivated_at IS NULL`. The seed (`4_seed_data.sql` l.27 to 32) does not set `deactivated_at`,
and nobody holds a membership on the sentinel. The frontend has no filter either (no reference to
the sentinel id or name anywhere in `packages/frontend/src`). **So `__default_topics__` appears in
every facilitator's team picker on the Session Creation page.**

**[verified: partial]** Once selected:
`POST /teams/:teamId/sessions/draft` accepts it, then `advance` snapshots the template's topics.
`reveal` (l.1716) checks only the facilitator and the session state. `complete` (l.1552) checks
only that the status is `wrap_up`. Neither handler requires participants or votes. I did not read
`start`, `begin-voting`, or `topics/advance` in full, so "nothing stops a walkthrough with no
participants" stays partly inferred.

Result: one `status = 'complete'` session on the sentinel. `hasCompletedFirstSession` is
`COUNT(*) ... status = 'complete'`, so that one row unlocks every topic write against the
template. Getting there needs no API knowledge, only a dry run or a demo.

Lower-likelihood routes, kept from the issue: fixture leakage, migrations, support scripts.

### 2.3 Per-endpoint effect of a write that reaches the template

| Write on sentinel | Effect on new teams | Evidence |
|---|---|---|
| TOPIC-003 add | Inserts `is_default = false`, which is **not copied**. Pollutes the template's own list. | verified: code |
| TOPIC-004 archive | Copy ignores `status`, so the row is still copied as active. Sets up §2.1. | verified: code |
| TOPIC-005 restore | Sets `display_order = MAX(active)+1`, which carries into the copy. | verified: code |
| TOPIC-006 reorder | `display_order` copied directly, so the canonical order is gone (use case 08). Combined with 004, team creation breaks (§2.1). | verified: code |
| TOPIC-007 annotate | Annotation columns are excluded from the copy (topic-annotation Decision 9). Still a write to the template, which that spec forbids. | verified: code (copy column list) |

### 2.4 What a facilitator sees on Topic Management for the template (Priya Q5)

**[verified: code]** The page's lock state comes from `hasCompletedFirstSession` (`content.ts`
l.507/674), and edit controls render only when the team is unlocked
(`TopicManagementPage.tsx` l.1209, 1481).
- **Normal state (no completed sentinel session):** the page renders read-only with no edit
  controls, today and after #188. Nothing new to see.
- **Unlocked state (§2.2 has happened):** controls render, and after #188 each save fails with the
  server's message "Team not found." shown as a form error (l.1367). That is the "editor with
  failing controls" Priya is worried about. It is reachable only through the §2.2 entry point, and
  the follow-up closes it (§7, F1). #188 stops the damage. It does not make this state look tidy.

---

## 3. What the code does today

### The write endpoints (all in `packages/backend/src/routes/topics.ts`)

| Endpoint | Route | Auth wrapper | Who passes auth on the sentinel |
|---|---|---|---|
| TOPIC-003 add custom | `POST /api/v1/teams/:teamId/topics` (l.740) | `checkAddCustomTopicAuthorization` | any standing facilitator, any application_admin |
| TOPIC-004 archive | `DELETE .../topics/:topicId` (l.908) | `checkArchiveTopicAuthorization` | facilitator, admin |
| TOPIC-005 restore | `POST .../topics/:topicId/restore` (l.1119) | `checkRestoreTopicAuthorization` | facilitator, admin |
| TOPIC-006 reorder | `PUT .../topics/order` (l.1281) | `checkReorderTopicsAuthorization` | facilitator, admin |
| TOPIC-007 annotate | `PUT .../topics/:topicId/annotation` (l.1483) | `checkStandingFacilitatorAuthorization` (FR-8.7) | facilitator only |

All five run the same steps in the same order: `rejectNonCanonicalTeamId` (404), then auth (403),
then `checkTeamExists` (404, l.154), then `checkCustomizationLockGate` (409, l.223), then the
endpoint-specific checks and the write. Nobody holds a membership on the sentinel, so every
standing facilitator passes auth against the template, and so does every admin on 003 to 006.

### Sentinel references
- `packages/backend/src/sessions/default-topics.ts` exports `DEFAULT_TOPICS_TEAM_ID`, the single
  named constant. `topics.ts` must import it and must not add another copy of the literal.
- Used by `facilitator-sessions.ts` (team-creation copy) and `content.ts` (TOPIC-002).
- Seeded by `migrations/4_seed_data.sql` and corrected by `11_default_topics_correction.sql`.
- Tests: `helpers/real-db.ts` re-exports it as `SENTINEL_TEAM_ID`. Four other test files hard-code
  the literal.
- The literal has no hex letters, so a plain `===` cannot be bypassed by changing letter case.

### Existing test that changes
- `topics-integration.test.ts` l.747, test "5.6", asserts the accidental 409 protection. It must
  expect 404 `TEAM_NOT_FOUND` and no `topic.write_denied_locked` row (scenario R5 below).

---

## 4. Requirements, specific enough for the proposal

These take in Marcus's rewrites V1 to V11 and C1 to C2. Requirements state behaviour only. Where
the guard lives in code is a design choice (§5).

- **R1 Scope.** Covers every endpoint that creates, updates, archives, restores, reorders or
  annotates a `topics` row for a `:teamId`. Today that is TOPIC-003 to 007. Any later endpoint
  that writes `topics` for a `:teamId` falls under the same rule. Read endpoints (TOPIC-001,
  TOPIC-002, the all-topics GET) are out of scope and keep serving the template (FR-8.6).
- **R2 Check order.** `rejectNonCanonicalTeamId` → auth (403) → team exists (404) → **template
  team (404)** → customization lock (409) → endpoint checks. Callers who fail auth still get 403.
  An admin calling TOPIC-007 on the sentinel still gets 403 (FR-8.7). A 403 here says nothing
  specific about the template, so putting the guard after auth leaks nothing.
- **R3 Indistinguishable response.** The response is exactly what a nonexistent team gets: `404`,
  `{ error: { category: "not_found", code: "TEAM_NOT_FOUND", message: "Team not found.",
  correlationId } }`, `Cache-Control: no-store`, and `applyTimingFloor` applied. The audit write
  (R4) happens inside the floor. No other timing guarantee is added.
- **R4 Audit.** Each rejected write writes one `topic.write_denied_template` row, with the actor,
  the role, the IP, the endpoint/operation, and `team_id = DEFAULT_TOPICS_TEAM_ID`, before the
  response is sent. It follows the lock-denial pattern. **Audience: incident review and the audit
  log only.** It is not shown to facilitators and it does not alert anyone (this answers Priya Q4).
- **R5 Independent of session history.** Each endpoint gets two scenarios that expect the same
  404. (a) No completed sentinel session: this is today's state, and it replaces test 5.6. No
  `topic.write_denied_locked` row is written. (b) A completed sentinel session is inserted: this is
  the exploit state, and it proves the guard does not depend on the lock.
- **R6 Independent of membership.** The guard holds whatever `team_memberships` contains for the
  sentinel.
- **R7 FR-8.1 boundary (spec text).** "The team-scoped topic-write endpoints are not the
  Application Administrator maintenance path that FR-8.1 refers to. If that path is built, it SHALL
  be a separate endpoint with its own authorization and audit. This guard SHALL NOT be relaxed to
  serve it." Add a one-line rationale under FR-8.1 in `requirements/BRD.md` that points here, the
  same way FR-8.7 points to #53. Priya's reason for keeping this: a relaxed guard would make the
  template editable from a screen that looks exactly like any team's Topic Management.

---

## 5. Shape of the fix (design-level, left open on purpose)

| Option | Pros | Cons |
|---|---|---|
| A. Separate `rejectTemplateTeam()` after `checkTeamExists` in each handler | Explicit and easy to grep | A future TOPIC-008 has to remember to call it |
| B. `checkTeamExists` answers 404 for the sentinel (renamed to e.g. `checkWritableTeamExists`) | Cannot be forgotten. Only `topics.ts` calls it | The rule is hidden inside an existence check and needs a comment |

Either option meets R1 to R7. The structural test (T1) is **mandatory either way**. Design notes
to carry forward: compare against a constant with no DB query, so the mock call order in
`routes/__tests__/topics.test.ts` does not shift. Import `DEFAULT_TOPICS_TEAM_ID`.

### Tests

- **T1 Structural route test.** It must get the route list from the Fastify instance (for example
  an `onRoute` hook registered before the route plugins), never from a hard-coded array. It selects
  POST/PUT/PATCH/DELETE routes whose path starts with `/api/v1/teams/:teamId/topics`, and asserts
  that the set is non-empty and contains the five known routes. It fires each one at the sentinel as
  an authorized caller, **with the sentinel locked** (no completed session), and asserts 404
  `TEAM_NOT_FOUND`. Running it locked keeps it harmless whatever body the route needs: without the
  guard the answer is 409, never a write. That makes the test both safe and able to fail. Caveat
  **[inferred]**: if any route has Fastify schema validation, bodies that fail it get 400 before
  the handler runs. Design must check this and either supply a schema-valid body per method or
  confirm validation happens inside the handler, which the 422 `VALIDATION_FAILED` codes suggest.
- **T2 Per-endpoint unlocked tests, with harmless requests.**

  | Endpoint | Harmless request | Without guard (unlocked) | With guard |
  |---|---|---|---|
  | 003 | Empty `name` | 422 VALIDATION_FAILED | 404 TEAM_NOT_FOUND |
  | 004 | Random `topicId` | 404 topic code | 404 TEAM_NOT_FOUND |
  | 005 | Random `topicId` | 404 topic code | 404 TEAM_NOT_FOUND |
  | 006 | **Mismatched id set** (changed from "no-op order", per BA V8) | 409 STALE, no write | 404 TEAM_NOT_FOUND |
  | 007 | Random `topicId` | 404 topic code | 404 TEAM_NOT_FOUND |

  Facilitator and admin variants for 003 to 006. Facilitator only for 007, plus an admin → 403
  case.
- **T3 Unchanged-template assertion.** Before and after each request, snapshot every column of
  every sentinel `topics` row ordered by `id`, and require deep equality and the same row count.
  Also require: no success-operation audit row for the sentinel, no `topic.write_denied_locked`
  row, and exactly one `topic.write_denied_template` row.
- **T4 Fixture hygiene.** The completed-session row is inserted and deleted inside a
  `try/finally` within the test. Do not rely on `afterAll`. Fixture SQL as in
  `topics-integration.test.ts` l.478, with `team_id` set to the sentinel and status `'complete'`
  (`sessions_team_active_unique` ignores terminal statuses).
- **T5 Composition.** A non-canonical spelling of the sentinel id (no hyphens, or wrapped in
  braces) is still answered by `rejectNonCanonicalTeamId` with 404.
- **T6 End-to-end regression.** `POST /api/v1/teams` still copies the template correctly: compare
  the new team's topics with the sentinel's `is_default` rows on name, prompt, vote_type and
  display_order.
- **Task: lock-dependence audit.** Grep the test suites for the sentinel literal and
  `SENTINEL_TEAM_ID`. List every hit in tasks.md as "unaffected" or "updated", and confirm 5.6 is
  the only assertion that depends on the lock.
- **Task: existing-data check (C4, Priya Q1 to Q3).** In every environment, run read-only queries
  for (a) any `sessions` row with the sentinel `team_id`, in any status, (b) sentinel `topics` rows
  with `is_default = false` or `status = 'archived'`, and (c) a comparison of sentinel defaults
  against `4_seed_data.sql` + `11_default_topics_correction.sql`. Record the result in the
  proposal. If anything has drifted, open a remediation issue. **Do not fix data inside this
  change.** A sentinel draft would hold that facilitator's active-session slot (the draft
  uniqueness check at `facilitator-sessions.ts` l.443 includes `'draft'`), which is another reason
  to run (a) now.

---

## 6. Spec impact

- **Owning requirement goes in `default-topic-provisioning/spec.md`**, which already owns the
  template. That spec says the template's correctness is "the responsibility of the seed data", and
  this change makes that true at runtime too. **Not** `topic-customization-lock`: putting it there
  would recreate the coupling to the lock that this change exists to remove.
- **MODIFY the canonical check-order requirement** in `add-custom-topic`, `remove-topic`,
  `restore-topic`, `reorder-topics` and `topic-annotation`. Insert "(2a) template team → 404
  TEAM_NOT_FOUND" between team existence and the customization lock, citing the owning
  requirement. Otherwise those five specs contradict the new behaviour.
- R7 text goes in the owning requirement. A one-line FR-8.1 rationale goes in `requirements/BRD.md`.

---

## 7. Out of scope for #188, with proposed follow-up issues

I am **not** creating these issues. They are listed for the human to file. The proposal should
link them by number once they exist.

- **F1 (file now, high priority): "The template team is not a real team: session lifecycle and
  picker."**
  - Reject `POST /teams/:teamId/sessions/draft` (and any lifecycle entry point) for
    `DEFAULT_TOPICS_TEAM_ID`. This is the structural fix for §2.2.
  - Exclude the sentinel from `GET /teams/eligible-for-session`. This is the UX fix that
    removes Priya's mis-click path and the confusing state in §2.4.
  - Carry over the structural route-enumeration test pattern (T1) to session lifecycle routes
    (Priya suggestion 6).
  - Optionally, have the Topic Management GET report the sentinel as permanently locked, so the
    §2.4 unlocked state can never render controls.
- **F2: Other team-scoped writes against the sentinel** (unverified): `POST /api/teams/:teamId/join-links`,
  `POST /api/v1/teams/:teamId/managers`, `PATCH /api/v1/teams/:teamId/members/:userId/role`. These
  can be folded into F1 as one "not a real team" rule (BA C6 says one issue is enough). I lean
  toward folding them in.
- **F3: Harden the team-creation copy** so it filters `status = 'active'`, and make `content.ts`'s
  `defaultTopicsNotActive` filter `dt.status`. Defence in depth against §2.1 if the template is
  ever altered by migration or by hand.
- **F4 (conditional): Template data remediation**, only if the existing-data check finds drift.
- Noted, no issue proposed: TOPIC-001/002 reads against the sentinel (public defaults, low risk).
  Seeded system user `0001` with OIDC subject `system`: worth a look under the multi-provider OIDC
  direction, but unrelated to this change.

---

## 8. Decisions

### Accepted
| From | Item | Where |
|---|---|---|
| Priya 2, 5; BA C5 | Lead with the 500-on-team-creation impact and the picker mis-click path. Every claim labelled with its evidence. | §2 |
| Priya Q1, Q5 | Checked the picker and the Topic Management behaviour in code. | §2.2, §2.4 |
| BA C1, Priya Q4 | Audit rejected writes as `topic.write_denied_template`, used for incident review only. | R4 |
| BA C2, edge 2 | Guard sits after auth. 403 is kept for unauthorized callers and for admin on 007. | R2 |
| BA C3 | A versus B is a design choice. Requirements stay behavioural. Structural test is mandatory. | §5 |
| BA C4, Priya 4, Q2, Q3 | Existing-data check task. No data fix inside this change. | §5 tasks |
| BA V1 to V7, V11 | Precise scope, test, response, snapshot, audit and fixture wording. | R1 to R6, T1 to T4 |
| BA V8 | TOPIC-006 harmless request changed to a mismatched set. | T2 |
| BA V9 | Owning rule in `default-topic-provisioning`. Five check-order specs modified. Not in the lock spec. | §6 |
| BA V10, Priya 6 | FR-8.1 boundary sentence in the spec, plus a BRD rationale line. | R7 |
| BA edge 1, 3, 4 | Membership-independence, non-canonical id composition, end-to-end copy regression. | R6, T5, T6 |
| Priya 6 | Structural-test pattern carried to session lifecycle routes. | F1 |

### Rejected or modified
| From | Suggestion | Decision and rationale |
|---|---|---|
| Priya suggestion 2 | Bring the picker exclusion into #188 | **Out of scope, filed as F1 instead.** On its own, a picker filter is a preferential protection: it hides the entry point but leaves `POST /draft` open, which breaks my "structural, not preferential" rule if it is shipped as the fix. The structural fix (reject sentinel drafts) belongs with it, and together they change `session-creation-existing-team` and the frontend. That is a different capability and review surface from #188. #188 already makes the harm zero whichever path is used. To answer Priya's "not later": F1 should be filed now, at high priority. |
| Priya suggestion 3 | Spec scenario: Topic Management for the template shows team-not-found | **Modified.** The reads stay in scope as they are (R1, FR-8.6), so the page does not show team-not-found. In the normal locked state it renders read-only, which is fine. The unlocked "failing controls" state is real but can only be reached through §2.2, so the scenario goes in F1, not here. §2.4 documents what happens after #188. |
| BA C6 | Acceptance condition: the follow-up issue exists and the proposal links it by number | **Modified.** I was told not to create issues. The proposal links them once the human files them. Until then the list in §7 stands in. |
| BA C5 | Run the spike before the proposal | **Not done, labelled instead** (the BA offered this as the alternative). §2.1 is verified through the code; §2.2 is partially verified. Neither was executed. The fix is justified either way. |

---

## 9. Needs a human (not judgment calls)

1. **Existing-data check in shared/dev/prod environments.** I have no access. If a sentinel
   session or drifted topic exists anywhere, #188 locks that damage in, and F4 becomes urgent.
2. **Filing F1 to F3** (and F4 if needed). Of these, F1 is the one that closes the realistic
   trigger path.
