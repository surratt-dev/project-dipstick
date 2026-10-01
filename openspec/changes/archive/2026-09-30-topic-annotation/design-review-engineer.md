# Design Review: topic-annotation (Full Stack Engineer)

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Reviewed:** `design.md`, `proposal.md`, `tasks.md`, and `specs/*` deltas, checked against `packages/` at `d252f00`
**Verdict:** **Approve with revisions.** Nothing blocks. Four items (M1–M4) should be settled in design.md/tasks.md before implementation starts, because each one either ships a bug or makes a required test prove nothing. The rest are minor.

Settled and not reopened: management-half scope (H3); Facilitator-only editing with admins getting `403` (H1).

---

## What I verified holds up

- **The cascade reuse is real.** `checkStandingFacilitatorAuthorization` (`topics.ts:95`), `checkTeamExists` (`:147`), `checkCustomizationLockGate` (`:216`), and `checkTopicExistsAndActive` (`:373`) all exist with the signatures the design assumes. A `messages` parameter on the first is a small, safe change. The other three can be reused verbatim. Using the facilitator-only check (not the `OrAdmin` one) is the right call for H1, and a reviewer can see why.
- **Row lock, not advisory lock (D5), is correct.** There is no position math. TOPIC-004's archive `UPDATE` and TOPIC-005's restore `UPDATE` take the same row lock, so a `FOR UPDATE` read serializes cleanly against both. I see no deadlock path: the annotation write locks one row, and the siblings take the advisory lock before any row lock.
- **The snapshot reads are a two-line change.** SESSION-005 (`facilitator-sessions.ts:1186`) and SESSION-012 (`:1851`) both select from `session_topics`. SESSION-005 already JOINs `topics` for `t.first_session_description`, which is exactly the trap D8 warns about. The warning comment and the negative test are justified.
- **Seed isolation (D9) is already true.** The copy at `facilitator-sessions.ts:602–608` lists its columns explicitly. A comment plus a test is the right amount of work.
- **The migration is additive, nullable, with no backfill.** Deploy order is safe either way.
- **The template-team gap is smaller than stated.** `hasCompletedFirstSession` counts `complete` sessions, and the sentinel team has none, so every topic write against it, TOPIC-007 included, gets `409` today. The Known Limitation is still worth filing, but in practice the gap is closed until someone runs a session on the sentinel team.

---

## Must address before implementation

### M1. The TOPIC-001 response is snake_case today, so `teamAnnotation` would be the only camelCase key (D8, task 5.2, task 2.1)

`content.ts:486` returns raw rows: `{ id, name, prompt, vote_type, display_order, status }`. `content.test.ts:380–381` asserts `vote_type`/`display_order`. The contract (`REST API Contract.md:563`) specifies camelCase `topicId`/`voteType`/... and the code has never matched it. Adding `team_annotation AS "teamAnnotation"` produces an object that is half contract and half raw row. Task 2.1 also says "Add `teamAnnotation` to the TOPIC-001 topic shape", but **no shared TOPIC-001 type exists** (`GetActiveTopicsResponse` is not in `packages/shared`).

Nothing in the frontend calls `GET /teams/:teamId/topics` (only `/topics/all`, `/:topicId`, `/restore`, and `/order`), so the cheap option is available. Pick one and write it down:
- **(a) Recommended:** map TOPIC-001 to the contract shape now, add `GetActiveTopicsResponse` to `shared/src/types/topic.ts`, and update the two `content.test.ts` assertions. It has no consumers, so it can't break anyone, and it gives a typed contract to #56/#57, which will consume this endpoint.
- (b) Emit `team_annotation` to match the existing raw shape, and file the contract drift separately. Then task 2.1's TOPIC-001 clause goes away.

Don't ship the hybrid.

### M2. An editor whose row disappears stays "dirty" and leaves the screen jammed (D10)

`annotationDirty = normalize(draft) !== (saved ?? "")`, where `saved` comes from `data.active`. Walk through it: open the editor on row A (clean, draft `"X"` equals saved `"X"`) → click Remove on row A (allowed, because the design only disables Remove while *dirty*) → success → `loadTopics()` → A moves to `archived[]`. `annotationEditor.topicId` still points at A. `saved` is now `undefined`, which becomes `""`, and `"X" !== ""`, so **`annotationDirty` becomes true with no visible editor**. `beforeunload` is armed, the move controls are disabled with "Save or cancel your definition changes first.", and the user has nothing to save or cancel. The same thing happens after Q2's refetch, and whenever A is archived from another tab and a later refetch removes it.

Fix it in the design:
1. Close a **clean** editor whenever a Remove or Restore dialog opens, the same way D10 already closes it when a move begins.
2. Derive `annotationDirty` as `false` and reset the editor to `null` whenever `annotationEditor.topicId` is not in `data.active`. Use an effect or a derived guard, and add a component test that archives the editor's row.

### M3. A dirty definition must disable *all* Remove/Restore, not just that row's (D10, BA B1/B2)

The reorder draft's precedent (`TopicManagementPage.tsx:603–606`) disables Remove and Restore **on every row** while the draft is dirty. It does that because their success path calls `loadTopics()`, and on failure `loadTopics()` calls `setError(...)`, which replaces the whole screen (`:558`) and unmounts everything, the definition draft included. D10 disables only *that row's* Remove. So a dirty definition on row A plus a Remove on row B followed by a failed refetch destroys the facilitator's text. That is the outcome the proposal says this feature exists to prevent. Make the rule symmetric with the reorder draft: while `annotationDirty`, disable every Remove and Restore with "Save or cancel your definition changes first." It is also the simpler rule to explain and test, which is the same argument D10 makes for the reverse direction.

Related: Q2's "refetch TOPIC-002 when the editor closes" should not use `loadTopics()` either, because a failure there turns a recoverable 404 into a full-page error. Use a quiet refetch like `reloadAfterStale` (`:478`) that sets an inline error. Pull the fetch into a shared helper rather than writing a third copy.

### M4. The required negative test can't prove anything in the mocked suite (task 6.3)

`facilitator-sessions.test.ts` (and `topics.test.ts`, `content.test.ts`) `vi.mock` the db module. In that harness, "set `topics.team_annotation = 'Y'` and assert the payload is still `'X'`" proves nothing, because the mock returns whatever the test feeds it, whatever SQL the handler sends. The test D8 calls "required" has to be a **real-Postgres integration test**. The harness already exists (`topics-integration.test.ts` with its reachability probe, and `.github/workflows/integration.yml` runs Postgres 16 on 5433). Say so in task 6.3, and name the file. Two more things:
- Also add a cheap unit-level guard in the mocked suite: assert that the SQL text sent by SESSION-005/012 contains `st.topic_annotation` and does **not** match `/\bt\.team_annotation\b/`. That catches the regression even when the integration job is skipped locally.
- Tasks 7.2 (seed isolation) and 1.2 (down/up) also need a real database, so mark them as integration too.

---

## Minor

1. **Migration markers: cite 18, not 17.** D-Migration and task 1.1 say "`-- Up Migration` / `-- Down Migration` markers and the header style of `17_topics_restored_by.sql`." The markers are right, but 17 uses bare `-- Up`/`-- Down`, which node-pg-migrate v7 does not recognize. Migration 18's header says so explicitly, and migration 8 records the incident where a runnable Down under a bare marker ran as part of Up. Point the implementer at `18_topics_active_order_partial_unique.sql` as the template so nobody copies 17's markers.
2. **Set `Cache-Control: no-store` as the handler's first statement**, as `PUT /topics/order` does (`topics.ts:1138`). `checkStandingFacilitatorAuthorization` writes its own `403` and does not set the header (TOPIC-003's `403`s go out without it today). The global error handler's `500` only carries the header if it was set first. Task 11.2 should check the `403` and `500` paths specifically.
3. **Use one read for the in-transaction topic check.** Rather than `... AND status='active' FOR UPDATE` → "0 rows → re-run the 404/422 distinction", do `SELECT team_annotation, status FROM topics WHERE id=$1 AND team_id=$2 FOR UPDATE` and branch on whether a row came back and on its `status`. That is one query and one code path, with no second lookup after `ROLLBACK`.
4. **The response needs a display name the `UPDATE` can't return.** `annotationUpdatedBy: { userId, displayName }` needs a join to `users`. Use `WITH u AS (UPDATE ... RETURNING ...) SELECT ... FROM u LEFT JOIN users ...`, or the request session's display name if it is reliably present. Write the choice down, and match TOPIC-002's rule that provenance is `null` unless both id and name are present.
5. **The counter unit and `maxlength` disagree near the limit.** `maxlength=500` limits the *raw* value. The counter shows the *trimmed* length. With trailing spaces or newlines, the user can be stuck at, say, `497 / 500`, unable to type, and never hear "500 character limit reached." Key the limit-reached style and announcement on `draft.length >= 500` (what the browser enforces), and keep the counter on the normalized value. Also, B5's paste test (520 characters) should assert that the pasted text is truncated, so the silent truncation is at least specified.
6. **Non-UUID path params produce a 500.** `topicId = "order"` (that is, `PUT /topics/order/annotation`) passes the cascade and then hits Postgres `22P02`, which becomes a `500`. A non-UUID `teamId` fails earlier, in the auth query. The siblings behave the same way, so "follow the siblings" really means "500". Either state that plainly, or reuse the file's existing `UUID_PATTERN` to return `404 TOPIC_NOT_FOUND` for a malformed `topicId` at the topic step. That is one line, and I'd do it.
7. **Make the audit "no text" test robust.** "No metadata value contains the submitted text" passes or fails by accident for short inputs (`"a"` is contained in `"cleared"`). Use a distinctive sentinel (for example `"ZQX-annotation-sentinel-7781"`), and extend the walk to the `emitAuditEvent` payload, not only the `audit_log` row.
8. **Update the fixtures.** Adding required fields (`canEditAnnotations` and the archived provenance) to `GetAllTopicsResponse` breaks the typed fixtures in `TopicManagementPage.test.tsx:36` and `TopicManagementPage.reorder.test.tsx:43` at typecheck. It also changes the mocked rows in `content.test.ts`. Put that in tasks 5/8 so it isn't discovered as "unrelated test breakage."
9. **The shared domain interfaces drift.** `Topic` (`shared/src/types/topic.ts:5`) and `SessionTopic` (`shared/src/types/session.ts:32`) mirror the tables but won't gain `teamAnnotation`/`topicAnnotation`. Add them, nullable, so the domain types keep matching the schema.
10. **Note for security, not a change request.** TOPIC-002 will return team free text and editor names to Application Administrators read-only. That fits "admins can view topic management," but it sits next to the "admins are denied session content" rationale H1 relies on. One sentence in D8 saying it is intentional saves a future reviewer from reading it as a leak.
11. **The `actorGlobalRole` returned by the facilitator-only check is always `"facilitator"`.** That's fine for the audit row. It also means `canEditAnnotations` and TOPIC-007 derive from the same `global_role` read, which supports the design's "flag can't drift" claim. Keep both tests.

---

## Hidden coupling to keep an eye on

- **#175 is the real consumer of the pending snapshot requirement.** The SESSION-005/012 reads are now wired to a column that nothing writes. That's acceptable only because the spec pins the contract. Make sure the #175 note in task 9.1 names `session_topics.topic_annotation` explicitly, so its INSERT … SELECT includes it.
- **SESSION-005's live JOIN to `topics`** for `first_session_description` stays in place. That inconsistency predates this change, but it is the reason the negative test (M4) has to run against a real DB.
