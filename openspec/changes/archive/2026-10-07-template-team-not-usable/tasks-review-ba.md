# Tasks Review: template-team-not-usable (#214)

*Reviewer: Marcus Delgado (Business Analyst). Reviewed `tasks.md` against `proposal.md` and the seven
spec deltas under `specs/`. Question asked: do the tasks, taken together, cover every capability in
the proposal, and is anything lost between the requirements and the tasks?*

**Verdict: approve with changes.** The tasks cover every capability the proposal names. I checked
the registered routes in `packages/backend/src/routes/` against the guard tasks, and the set matches:
draft, the five sub-routes, the members listing, TEAM-005, TEAM-006, join-link creation and both
redemption paths. Nothing is missing at the capability level. The gaps are in the scenarios. A few
spec scenarios have no task that would show they hold, and one claim in the proposal (the realtime
layer is closed) has no verification step. Three items below should be fixed before apply starts.
The rest are small edits to existing tasks.

---

## Coverage map (proposal → tasks)

| Proposal item | Task(s) | Status |
|---|---|---|
| UX 1: template never in picker, incl. the #237 link | 3.1, 10.2 | Covered |
| UX 2: stale selection, "no longer available" plus "Choose another team" | 7.2 | Covered |
| UX 3: old template link lands on the invalid-link page, no login detour | 4.4 | Covered in the API; the page itself is not checked (M2) |
| UX 4: Topic Management "Default topics" view | 6.1–6.3, 7.1 | Covered; breadcrumbs and back links not named (S2) |
| UX 5: no session ends with people in it (maintenance window) | Workflow H1 | Covered as a workflow note, not a gate (B3) |
| UX 6: empty state when the template was the only option, fresh install | 3.1, 7.3 | Covered |
| Owning rule, no override, FR-1.7 carve-out | 2.1 (source check), 3.1, 9.1 | Covered; admin "no override" only partly exercised (S5) |
| Database backstop: cleanup, `NOT VALID`, conditional `VALIDATE`, lock | 1.1–1.3 | Covered; 23514 not asserted on all three tables (S1) |
| `500` with `template_constraint_violation`, never `404` | 1.5 | Covered |
| App guard on every team-addressed route plus both redemption paths | 3.2, 3.3, 4.1–4.4 | Covered |
| Per-endpoint parity, incl. timing floor | 3.2–4.4, 5.1 (floor as data) | Covered |
| `team.template_access_denied` audit, dedupe, logged-out event only | 2.1 | Covered; dedupe "different endpoint / after window" not tested (S7) |
| `team.template_cleanup` audit | 1.1, 1.2, 1.3 | Covered |
| Any spelling of the template id is the template | 2.1, 5.1 | Template side covered; **"real team unchanged" and "no new rejection" are not (B1)** |
| Picker binds the shared constant; no new UUID literal | 3.1, 5.3 | Covered |
| `lockReason` from one shared function; shared types | 6.1, 6.2, 6.3 | Covered; denied-caller clause not updated (S3) |
| Structural test, fail-closed, probe self-test, `afterAll` | 5.1, 5.2 | Covered |
| Read surfaces closed by membership gating plus the clamp | 1.2, 3.4, 8.1–8.4 | REST covered; **the realtime layer is not (B2)** |
| #188 accepted difference #1 retired | 1.4 | Covered |
| BRD rationale note under FR-1.7 | 9.1 | Covered |
| H1, H2, H3 | Workflow follow-up | Recorded; H1 ownership still open (B3) |

---

## Fix before apply

### B1. Nothing tests that real teams' non-canonical ids behave as before

The proposal says "No route gains a new rejection". It also lists "Real teams are unchanged" as a
constraint that must hold. The default-topic-provisioning delta turns that into a scenario: *"A real
team's non-canonical spelling is unchanged"*. Task 2.1 checks that `isTemplateTeam` is false for a
real id, but only at unit level. No task sends a braced or unhyphenated **real** team id to a
guarded route and compares the result with the behaviour before this change. That is the
regression most likely to slip through. A normaliser that is slightly too greedy, or a guard placed
before an existing boundary check, would change real-team behaviour, and every test in the plan
would still pass.

*Change:* in 5.1, for each `audit` route, also send the braced and no-hyphen spellings of a real
team's id. Assert the same status and body the route returned before the guard existed, and no
`team.template_access_denied` row. Name the scenario in the task.

### B2. The realtime layer is claimed as closed but never checked

The proposal says membership gating plus the clamp "covers `/trends`, `/action-items`, session
history **and the realtime layer** together. Each gate is verified by a short checklist with one test
per gate." Section 8 lists REST gates only, and 8.4 is limited to `GET` routes with `:teamId`. The
code bears the claim out: `realtime/connection-reauthorization.ts` calls `evaluateTeamAccess`.
But no task shows that, after the migration, the facilitator of a clamped template session cannot
open or keep a socket on that team or session. Design D4 accepts a residual of up to 5 minutes for
sockets that are already open. A *new* subscription is a separate case, and nothing tests it.

*Change:* add 8.5. Using the 1.2 fixture, after the migration, a subscription attempt by that
facilitator for the template session is refused, and one reauthorization sweep drops an existing
connection. One test. If it fails, file an issue as 8.1 does.

### B3. H1 still has no confirmed owner, and nothing stops a deploy without it

My propose-stage review asked for H1's owner to be settled **before the tasks stage**. The
proposal's incorporated-feedback section says Exec C1 "also meets" that request. It does not.
Both the proposal and the workflow follow-up still say "Devon Calloway by default, pending Brian's
confirmation". This matters because H1 decides *when* the change can deploy: a non-terminal template
session means the deploy must run in a maintenance window, or someone's live session is abandoned
under them (proposal item 5). Today H1 is a workflow bullet with no checkbox, and only the archive
step depends on it.

*Change:* Brian confirms the owner now, and the proposal records it. Add a numbered task (for
example 10.3, "H1 counts recorded in `proposal.md` for every environment before the deploy is
scheduled") so that the check gates the deploy, not just the archive.

---

## Should fix (edit existing tasks)

- **S1. 23514 on all three tables, on update as well as insert.** The fresh-database scenario says a
  direct template `INSERT` into **any** of the three tables fails with `23514`. The history scenario
  adds that an `UPDATE` setting a template `team_id` on `sessions` fails. Task 1.1 checks only
  `convalidated`. Task 1.2 asserts `23514` on "a new template insert" without naming a table. Have
  1.1 assert an insert into each table, and 1.2 assert one `UPDATE … SET team_id = <template>`.
- **S2. "Default topics" everywhere the stored name would appear.** The topic-management-screen
  requirement lists heading, `document.title`, **breadcrumbs and back links**. Task 7.1 names only
  the heading and `document.title`. The "appears nowhere in the rendered page" check catches a
  breadcrumb only if the breadcrumb renders inside the component under test. Name breadcrumbs and
  back links in 7.1, or add them to the 10.2 manual check if they live in the layout.
- **S3. The denied-caller clause of the modified TOPIC-001 requirement.** The modified requirement
  now says neither the lock-state function **nor** the lock-check function runs for a denied
  request. The existing test spies on the lock-check function only. Task 6.1 should update that test
  to also assert `getTopicLockState` is not called.
- **S4. Actor role on the denial row.** The scenario "The denial row records the actor's real role"
  uses a `participant` on a session sub-route. Task 3.3 already has that caller. Add "row's
  `actor_global_role` is `participant`" to its assertions. 2.1 tests role resolution only in
  general.
- **S5. "An administrator has no override" for every surface.** The spec covers *any* session,
  membership or join-link request from an admin. Tasks 4.1 and 4.2 exercise an admin, but nothing
  sends an admin to join-link creation, the five sub-routes or redemption. The proposal calls the
  structural test "multi-actor", yet 5.1's table names one actor per route. Either add an admin row
  per route in 5.1, or point to the 2.1 source check as the evidence and say so in the task.
- **S6. `401` writes no denial row on every guarded route.** The scenario "Requests refused before
  the guard" says "authentication everywhere". Only 3.3 checks that an unauthenticated caller gets
  `401` and no row. Add an unauthenticated pass to 5.1 so draft, members, TEAM-005, TEAM-006 and
  join-link creation are covered too.
- **S7. Both halves of the dedupe scenario.** "Repeated refusals by one actor are bounded" has a
  second half: a refusal on **a different endpoint, or after the window**, still writes a row. Task
  2.1 tests only the suppression half. Without the second half, a dedupe key that drops the
  endpoint would pass every test.

---

## Minor (traceability and polish)

- **M1.** Task 3.1 lists three session-creation scenarios but not the default-topic-provisioning
  FR-1.7 scenario ("absent from the picker although it has no completed session"). The test is the
  same, so name the scenario anyway. The FR-1.7 carve-out is the requirement a future reader will
  trace.
- **M2.** No task looks at what the participant sees for proposal items 2 and 3 (the unavailable-team
  message and the invalid-link page from a template link). The join-link scenario "The participant
  sees the existing invalid-link page" has no test, which is low risk because the copy is unchanged.
  Add both to the 10.2 walkthrough. They are the two moments a real person runs into this change.
- **M3.** The archive bullet waits on H1 and H2 but not on H3. The proposal doesn't make H3 blocking.
  But if nothing gates H3, it stays "pending" for good, and it is the only follow-up that tells us
  whether facilitators want a rehearsal mode. Either add it to the archive gate or mark it
  non-blocking explicitly.

---

## What I checked and found sound

- The route list in 3.2–4.4 matches what is registered in `facilitator-sessions.ts`, `teams.ts`,
  `join-links.ts`, `content.ts` and `auth.ts`. 5.1's fail-closed enumeration covers future routes.
- Check order matches the parity table (design D3) on every route, including the join-link-creation
  exception and the redemption order. A revoked template link reads as invalid, not expired, and a
  logged-out user is not sent to sign in first.
- 1.4 retires #188's accepted difference #1 and stops the old tests from seeding rows the constraint
  will now refuse. Without it the suite would fail the first time it runs against the validated
  constraint.
- 9.1 carries the FR-1.7 carve-out into `requirements/BRD.md`, so the requirement and the behaviour
  agree in the place people look first.
- The tasks honour the non-goals and the Exec advisories: no per-surface exclusion filters, no
  header or timing comparison, no dashboard, and ungated surfaces go to separate issues.
