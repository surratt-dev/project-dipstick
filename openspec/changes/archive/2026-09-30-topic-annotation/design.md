## Context

TOPIC-007 (Annotate Topic with Shared Team Definition) is the last topic-management operation still unbuilt. Its siblings, TOPIC-003 (add), 004 (remove), 005 (re-add), and 006 (reorder), established a shared pattern in `packages/backend/src/routes/topics.ts`: a fixed check cascade, `checkTeamExists`, `checkCustomizationLockGate` with a `topic.write_denied_locked` audit row, `checkTopicExistsAndActive`, the standard error envelope, `applyTimingFloor` on every exit, and a per-team advisory lock where position math is involved.

Current state (exploration-notes.md §1):
- `topics` has no annotation column. TOPIC-002 (`content.ts:636`) returns `teamAnnotation: null`, hard-coded. TOPIC-001 neither selects nor returns it. TOPIC-001 has **no frontend caller** (the screen only calls `/topics/all`, `/:topicId`, `/restore`, `/order`), returns raw snake_case rows, and today answers `200` to an engineering manager (`content.ts:459–500`, `content.test.ts:349`), contrary to the contract's access matrix.
- `session_topics` snapshots `topic_name`/`topic_prompt`/`vote_type` but has no annotation column. It is never populated in production (#175). Only fixtures write it.
- Begin-voting is **SESSION-005** (`facilitator-sessions.ts:1097`). The exploration notes mislabelled it SESSION-004. Topic-advance is SESSION-012 (`:1700`). Both build `currentTopic` from `session_topics`.
- The frontend has no live-session topic screen (#56, #57) and no role awareness. `TopicManagementPage.tsx` already has a `beforeunload` guard, `topicActionsLockedByDraft` (the unsaved *reorder* draft), and `LOCKED_BY_DRAFT_REASON`.
- Latest migration is `18_topics_active_order_partial_unique.sql`.

Settled human decisions: **H3**, ship the management half only, with #53 left open as partially delivered. **H1**, Facilitator-only, admins `403`, recorded as proposed BRD FR-8.7. **H2** (snapshot timing) and **H4** (post-reveal visibility) are hand-offs to #175 and #62.

## Goals / Non-Goals

**Goals:**
- Persist a team's per-topic definition with provenance, and let a standing Facilitator set or clear it after the first session.
- Make TOPIC-002, the management read surface that already promises the field, return it. TOPIC-001 deliberately does **not** gain it in this change (Decision 8).
- Put the annotation into the session payloads from the **snapshot**, and prove with a negative test that live edits don't leak into a session.
- Pin the snapshot-content rule in `session-topic-lifecycle` so #175 can't drop it.
- Give facilitators an editor that protects the team's words: plain text, clear-confirm, error-safe, and no clash with the reorder draft.

**Non-Goals:**
- Any live-session UI (#56, #57, #62), the WebSocket reconnect snapshot (#57), or writing `session_topics` (#175).
- Deciding snapshot timing (H2) or post-reveal visibility (H4).
- Version history, engineer-proposed definitions, moderation, and Markdown/HTML rendering.
- A guard against topic writes targeting the template team. That gap is shared by every sibling and gets its own issue.
- Showing the snapshotted definition in EM or facilitator session-history views.

## Decisions

### Decision 1: Facilitator-only authorization reuses TOPIC-003's identity check, with parameterized messages

TOPIC-007 calls `checkStandingFacilitatorAuthorization` (`topics.ts:95`), the facilitator-only check TOPIC-003 already uses. It rejects anyone whose `global_role` is not `facilitator` (admins included → `403 NOT_A_FACILITATOR`) and active members (`403 FACILITATOR_IS_TEAM_MEMBER`), applying the timing floor itself. Its two messages are currently hard-coded to "add a custom topic", so the function gains a `messages` parameter. TOPIC-003 passes its existing strings unchanged, and TOPIC-007 passes "Only a facilitator can edit a team's topic definition." / "A facilitator cannot edit topic definitions for a team they are a member of."

*Why not `checkStandingFacilitatorOrAdminAuthorization` like 004/005/006?* H1 decided that the definition is the team's words, recorded by the person who was in the room. Admins have no session context and are denied session content elsewhere (`denyAdminContentAccess`). This is a deliberate divergence, recorded as BRD FR-8.7 so nobody "fixes" it for consistency. *Why not a new wrapper?* The existing function already has exactly the right semantics. Only the copy differs.

### Decision 2: Cascade and helpers

The order is identity/role (D1) → `checkTeamExists` → `checkCustomizationLockGate` (with `attempted_operation: "topic.annotation_updated"`) → body validation (D3) → `checkTopicExistsAndActive` (`404 TOPIC_NOT_FOUND` / `422 TOPIC_ALREADY_ARCHIVED`, reused verbatim, its "already archived" message is accurate here) → transaction. Body validation sits after the lock and before the topic lookup, as it does in TOPIC-003, so a locked team always answers `409` whatever the body. Every handled exit applies `applyTimingFloor`.

`reply.header("Cache-Control", "no-store")` is the handler's **first statement**, before the auth check, exactly as TOPIC-006 does (`topics.ts:1138`). That is the only placement under which the auth helper's own `403`s and the global error handler's `500` also carry the header. Task 11.2 checks the `403` and `500` paths specifically.

At the topic step, a `topicId` that fails the file's existing `UUID_PATTERN` (`topics.ts:523`) answers `404 TOPIC_NOT_FOUND` (with the timing floor) instead of reaching Postgres and surfacing `22P02` as a `500`. A non-UUID `teamId` keeps the siblings' behaviour; this change does not alter the shared auth helper's query.

A code comment at the handler states that the request body must never be logged (Decision 7).

*The contract's `404` for an archived topic is replaced by the sibling `422 TOPIC_ALREADY_ARCHIVED`.* One code for one condition across the topic family.

### Decision 3: Validation, normalization, and limit

The body must be an object whose `annotation` is a `string`. A non-object body, or a missing, `null`, or non-string value → `422`, category `invalid_request`, code `INVALID_ANNOTATION`, `field: "annotation"`, message "annotation must be a string." Over-length → the same code and field with "Team definition must be 500 characters or fewer." (a dedicated code, following TOPIC-006's `INVALID_TOPIC_ORDER` rather than TOPIC-003's generic `VALIDATION_FAILED`, so a client can tell this field's failures apart). Unknown keys are ignored (TOPIC-003 precedent). Normalize with `value.replace(/\r\n/g, "\n").trim()`, then check `normalized.length <= 500` (UTF-16 units, the same unit as `prompt` and `<textarea maxlength>`). An empty normalized string means clear (store NULL). Closes Contract OQ-7.

**Disallowed characters.** After normalization and before the length check, the value is rejected with the same code and field and the message "Team definition contains characters that can't be saved." if it contains any of:
- U+0000. Postgres `text` rejects it (`22021`), which would otherwise surface as an unhandled `500` on the thrown path, with no timing floor.
- An unpaired UTF-16 surrogate (U+D800–U+DFFF not part of a valid pair). It passes `typeof` and the length check and is then rewritten to U+FFFD on encode, so what is stored would not be what was validated. Detect with `!value.isWellFormed()` (Node 20+) or `/\p{Cs}/u`.
- Any other C0 control except `\n` and `\t` (U+0001–U+0008, U+000B, U+000C, U+000D, U+000E–U+001F) and U+007F. A lone `\r` remaining after `\r\n` → `\n` falls here.
- The bidi embedding/override and isolate controls U+202A–U+202E and U+2066–U+2069. The field is displayed to a whole team as "the team's words", and these let one person make the text display differently from what was typed.

They are rejected, not stripped, so that what is stored is always what the facilitator submitted. A browser `<textarea>` does not produce any of them from normal typing, so the only realistic source is paste; the editor shows the server's message and keeps the text (the existing failed-save rule). The frontend does not replicate this check.

*Accepted residual (security implementation review N1).* The set above is deliberately the set that can make text *display differently from what was typed* or break storage. It does not reject C1 controls (U+0080–U+009F), zero-width and directional marks (U+200B–U+200F, U+061C), an interior U+FEFF, U+2028/U+2029, or Unicode tag characters (U+E0000–U+E007F). None of these can reorder displayed text the way U+202E can; tag characters are invisible and could hide content from a human reader, which matters if annotations are ever fed to a summarizer or exported. Widening the class is recorded in `handoffs/new-issues-annotation-follow-ups.md`, not done here.

*Why reject `null` instead of treating it as clear?* An explicit `""` is the only clear signal, so a client bug that drops the field can never silently wipe a team's definition. *Why trim before counting?* So that what is counted is what is stored, and so the frontend counter (on the trimmed value) and the server always agree.

### Decision 4: No DB length CHECK

`topics.team_annotation` has no CHECK constraint. Postgres `char_length` counts code points, while the handler counts UTF-16 units, so a CHECK would be a *different, looser* rule than the handler's, and `prompt` has no CHECK either. The handler is the single enforcement point. `session_topics.topic_annotation` must never have one, because a snapshot has to accept whatever the source held.

### Decision 5: The write transaction, no-op, and concurrency

```
BEGIN
SELECT t.status, t.team_annotation, t.annotation_updated_at, t.annotation_updated_by, u.display_name
  FROM topics t LEFT JOIN users u ON u.id = t.annotation_updated_by
  WHERE t.id=$topicId AND t.team_id=$teamId
  FOR UPDATE OF t
  → no row:              ROLLBACK, 404 TOPIC_NOT_FOUND, timing floor
  → status='archived':   ROLLBACK, 422 TOPIC_ALREADY_ARCHIVED, timing floor
  → stored == normalized (NULL ≡ ""): ROLLBACK, 200 with current state + provenance, no audit
WITH upd AS (
  UPDATE topics SET team_annotation=$v, annotation_updated_by=$userId, annotation_updated_at=now()
   WHERE id=$topicId AND team_id=$teamId AND status='active'
   RETURNING id, team_annotation, annotation_updated_at, annotation_updated_by)
SELECT upd.*, u.display_name FROM upd LEFT JOIN users u ON u.id = upd.annotation_updated_by
  → 0 rows: ROLLBACK, 422 TOPIC_ALREADY_ARCHIVED, timing floor (defensive; unreachable under the row
            lock; no second lookup, mirroring TOPIC-004 -- implementation review N-1 / security N3)
INSERT audit_log (operation='topic.annotation_updated', metadata={topic_id, action, length})
COMMIT
emitAuditEvent(...)
```

The in-transaction read is a **single** query that branches on whether a row came back and on its `status` (engineer review minor 3), so there is no second lookup after `ROLLBACK`. The pre-transaction `checkTopicExistsAndActive` call stays, to keep the cascade identical to the siblings; the in-transaction read is the authoritative one. The `UPDATE` repeats the `team_id` and `status` predicates (security R1, matching TOPIC-004 at `topics.ts:880`), so a cross-team write can never depend on the `SELECT` and `UPDATE` staying paired through a refactor. Provenance in every response (write and no-op) is `{ userId, displayName }` only when both are non-null, otherwise `null`, the same rule TOPIC-002 applies to `archivedBy`.

A row lock (`FOR UPDATE`) is enough: this is a single-row write with no position math, so **no per-team advisory lock** is taken. Concurrent writes are **last-writer-wins** with no precondition token (D7 in exploration). Visible provenance is the recovery path. `updated_at` is not touched, because `annotation_updated_at` is the annotation's own clock and `updated_at` describes the topic's configuration.

*Alternative considered: a stale-write token.* Rejected (exploration R5). It is close to never needed at this usage level, and it would add a 409 path and UI to a routine act.

### Decision 6: Response shape and provenance

The response is `{ topicId, teamAnnotation, annotationUpdatedAt, annotationUpdatedBy }`, with `annotationUpdatedBy` reusing `ArchivedByProvenance`. It is renamed from the contract's `annotation`/`updatedAt` so the frontend uses a single name everywhere. Clearing records the clearer as provenance, because a clear is an edit. The UI hides provenance when the text is NULL. The no-op response returns the *existing* provenance.

### Decision 7: Audit without text

`topic.annotation_updated` is added to `AuditEventName`, with `metadata: { topic_id, action: "set" | "cleared", length }`. The text is never logged. The test submits a distinctive sentinel (for example `"ZQX-annotation-sentinel-7781"`, so a short value can't match by accident) and asserts that it appears in none of: any `audit_log.metadata` value; any field of the `emitAuditEvent` payload (captured from the logger), which goes to the application log with its own retention and access; and the body of every `422` (all three validation messages). Fastify's `req` serializer (`app.ts:35–46`) logs no bodies today; a comment at the handler says the body must never be logged, so a debugging change doesn't undo that. This keeps the audit log from becoming the version history the use case excludes, and keeps team free text out of a log with a different retention and access profile.

### Decision 8: Reads

- **TOPIC-002** selects `team_annotation`, `annotation_updated_at`, and `annotation_updated_by` joined to `users` (the same LEFT JOIN pattern as `archived_by_user`) for **both** the active and archived queries, and adds a top-level `canEditAnnotations = decision.actorGlobalRole === 'facilitator'`. *Why the flag?* TOPIC-002 admits admins, but TOPIC-007 doesn't, and the frontend has no role awareness. Without the flag, an admin is shown an editor that can only `403`. The flag is presentation only, and TOPIC-007 enforces independently.
  - *Admins and annotation reads (security R4, decided):* Application Administrators **may read** annotations and their provenance through TOPIC-002, read-only. Topic configuration is administrative data that admins already read (prompts, descriptions, archive/restore provenance); `denyAdminContentAccess` guards *session content* (votes, discussion, history), which an annotation is not until it is snapshotted, and admins remain denied the snapshot-bearing session payloads. H1's admin exclusion is about **who authors** the team's words, not who may see the configuration. A test pins that an admin's TOPIC-002 response carries `teamAnnotation` and `annotationUpdatedBy`. Readers of TOPIC-002 are therefore every standing non-member facilitator in the org plus admins; the helper text ("Not for notes about people or how to vote.") is written knowing that.
- **TOPIC-001 does not gain `teamAnnotation` in this change** (security B1, engineer M1). TOPIC-001 has no frontend caller, D11 AC 1 forbids it as the source for in-session display, and no consumer of the live value is planned. Adding the field would create a new, unused read path for the team's free text, and on today's code that path is reachable by engineering managers (the handler denies only a null grant and `path === "admin"`; `content.test.ts:349` asserts EM `200`), which breaks the no-manager rule for exactly the field whose helper text has to warn about writing about people. It would also make the topic object half raw-row, half contract shape. Omitting it removes the disclosure by construction, needs no change to a shipped authorization, and leaves no hybrid casing. The contract's TOPIC-001 `teamAnnotation` line is marked "not returned; deferred until a consumer exists" (task 10.2). A test asserts that TOPIC-001's topic entries contain none of `teamAnnotation`, `team_annotation`, `annotationUpdatedBy`, or `annotationUpdatedAt` (security R7). The **pre-existing** EM-`200` defect and the snake_case-vs-contract drift are recorded as one follow-up issue draft (task 9.5), because they are a behaviour change to a shipped endpoint whose access-matrix row is out of step with the code in more than one cell (it also lists admins as "Yes", while the code denies them); that row should be reconciled in one reviewed change, not one cell at a time inside this one. Whoever later adds a TOPIC-001 consumer of the annotation must fix the EM denial first.
- **SESSION-005 / SESSION-012** add `st.topic_annotation` to their `session_topics` SELECTs and `topicAnnotation` to `BeginVotingResponse.currentTopic` and `TopicAdvanceResponse.currentTopic`. **Never** `t.team_annotation`: SESSION-005 already JOINs `topics` for `first_session_description`, so it would be easy to grab the live column by mistake. The negative test exists to catch exactly that, and it runs against **real Postgres**: the route suites `vi.mock` the db module, so a mocked "set `topics.team_annotation = 'Y'`, still get `'X'`" would prove nothing. It lives in a new `packages/backend/src/routes/__tests__/topic-annotation-integration.test.ts` following `facilitator-error-states-integration.test.ts`, which already drives SESSION-012 against real Postgres/Redis with the self-skip probe, and runs in `.github/workflows/integration.yml` (Postgres 16 on 5433). Because that job self-skips locally when Postgres is down, the mocked suite also carries a cheap guard: the SQL text SESSION-005/012 send contains `st.topic_annotation` and does not match `/\bt\.team_annotation\b/`.

### Decision 9: Seed isolation stays explicit

The new-team seed (`facilitator-sessions.ts:604`) already lists its columns explicitly. It stays that way, with a comment naming the annotation columns as deliberately excluded and a test that sets `team_annotation` on a template row and asserts the new team's rows are all NULL.

### Decision 10: Frontend editor

- Local state is `annotationEditor: { topicId, draft, phase: "editing" | "confirmingClear" | "saving", error? } | null`, so only one editor exists by construction. One `normalize(s) = s.replace(/\r\n/g, "\n").trim()` helper drives every comparison. It is the server's own: `normalizeAnnotation` and `MAX_ANNOTATION_LENGTH` are exported from `@dipstick/shared` and imported by both TOPIC-007 and the screen (architect implementation review S-2), so client/server agreement holds by construction, not by comment. The comparisons: `annotationDirty = editorRowIsActive && normalize(draft) !== (saved ?? "")`, where `editorRowIsActive` means `annotationEditor.topicId` is in `data.active`. **Orphaned editor (engineer M2):** whenever `annotationEditor.topicId` is no longer in `data.active` (after a Remove, a stale refetch, or an archive from another tab), an effect resets the editor to `null`. (A `404`/`422` save failure does not trigger this: its row stays in `data.active` until the facilitator closes the editor, which is what starts the refetch.) `annotationDirty` is `false` for an orphaned editor, so no orphan can arm `beforeunload` or disable controls with nothing on screen to save or cancel. `annotationBusy = annotationDirty || phase === "saving"`. Opening another row is blocked while dirty; focus moves to the open editor, which shows "Save or cancel this definition first." A clean editor simply closes. Esc/Cancel sets state back to `null`.
- Save when `!annotationDirty` closes the editor with no request and no confirmation (BA B4).
- `maxlength=500` stays. When the **raw** `draft.length >= 500` (what the browser enforces), the counter gets a distinguished style and an `aria-live="polite"` region reads "500 character limit reached." (BA B5). We keep `maxlength` instead of an over-limit counter because it is the smaller change and the server limit can then never be hit from the UI.
- The textarea is labelled "Our team's definition" and linked to the helper text by `aria-describedby`.
- The counter's number shows `normalize(draft).length`, matching the server. The limit-reached style and announcement key on the raw length instead (engineer minor 5): with trailing whitespace the user can be at `497 / 500` and unable to type, and must still be told why. A pasted 520-character value is truncated by the browser; the component test asserts the field holds the first 500 units, so the truncation is specified, not incidental.
- The clear-confirm is inline, and is triggered only when saved is non-null and normalized draft is empty. Its Cancel returns to `phase: "editing"` with the draft unchanged. Overwrites never confirm (exploration D8), and a code comment records why, so nobody adds one "for consistency."
- On `200`, patch that row in local state from the response. **No refetch.** That keeps any other local state intact. The "Saved." message sits in a per-row `role="status"` element and clears on the next action on that row or the next successful definition save, with no timeout, like "Order saved." Exception: after `404 TOPIC_NOT_FOUND` or `422 TOPIC_ALREADY_ARCHIVED`, closing the editor triggers a TOPIC-002 refetch, because the row is no longer active. That refetch is **quiet** (engineer M3): a failure shows an inline error and never calls `setError`, which would replace the whole screen. `reloadAfterStale` (`TopicManagementPage.tsx:483`) and this refetch share one extracted `fetchAllTopics()` helper that returns the parsed response or `null`; each caller decides what to reset (this one does not touch the reorder draft). Editing is also disabled while `topicActionsLockedByDraft` with `LOCKED_BY_DRAFT_REASON`. We take the disable option, not the "patch only" option alone, because it is the simpler rule to explain and test, and it makes the reorder-draft guarantee hold by construction. The reverse also holds, symmetrically with the reorder draft's own rule (`TopicManagementPage.tsx:603–606`, engineer M3): while `annotationBusy`, the move controls and **every** row's Remove and Restore are disabled with "Save or cancel your definition changes first." (BA B1/B2). Every row, not only the editor's row, because Remove/Restore success calls `loadTopics()`, whose failure path calls `setError(...)` and unmounts the screen, draft included. A **clean** editor closes when a move begins and when a Remove or Restore dialog opens (engineer M2). Closing it this way runs the same pending 404/422 refetch as every other close path. **The reverse also holds for dialogs (added during implementation; architect implementation review S-1):** while a Remove or Restore dialog is open or submitting, every row's "Add team definition"/"Edit" is disabled with the reason "Finish or cancel the open remove or restore first." Without this, a new editor could be opened *behind* the dialog, become dirty, and then be destroyed when the dialog's Confirm calls `loadTopics()` and its failure path calls `setError`, which is exactly the loss the "every row's Remove/Restore" rule exists to prevent. Do not remove it as an inconsistency.
- The existing `beforeunload` effect's dirty condition becomes `isDirty || annotationDirty`.
- The editor is hidden when `isCustomizationLocked` or `!canEditAnnotations`. The lock notice gains the exact sentence "Team definitions can be added after the team's first session." after its existing two sentences.
- Provenance uses the screen's existing `SAVED_DATE_FORMAT` (`en-US`, short month, day, year). The name is omitted when `annotationUpdatedBy` is null, and the line is omitted when `annotationUpdatedAt` is null or the text is null.
- Archived rows render the definition and provenance read-only with the same component, with no edit controls (BA B3).
- Rendering is plain text: React text nodes with `white-space: pre-wrap`. No `dangerouslySetInnerHTML`.

### Decision 11: Hand-off acceptance criteria for #56/#57/#62 (drafted here, posted by the team lead)

1. Render `topicAnnotation` from the SESSION-005/012 payload only, never from TOPIC-001/002.
2. Label it "Our team's definition". Order: prompt → definition → description.
3. Secondary weight: after the prompt, body size or smaller, not collapsed, with no banner, background, or border treatment.
4. No element at all when null. No placeholder or nudge.
5. Unattributed: no editor name or date in the session.
6. Shown to the facilitator (#56) as well as participants.
7. A late joiner or reconnect sees it immediately. The WS snapshot is widened by #57, not here. The widened snapshot carries the **snapshot** value (`session_topics.topic_annotation`), never the live `topics.team_annotation`, and goes through the same per-connection authorization as the rest of the snapshot.
8. (H4, #62 decides) Recommendation: visible and stationary through reveal and discussion.
9. Render as plain text: React text nodes with `white-space: pre-wrap`. No `dangerouslySetInnerHTML`, no Markdown or HTML interpretation, and no `href`, `src`, or `style` built from the text. These screens show it to every participant, and React escaping is the only XSS control while CSP stays disabled (`app.ts:64`).

This change's agents do not post to GitHub. Task 9 hands the text to the team lead.

## Risks / Trade-offs

- [A session-facing feature ships with no session display] → Stated as a Known Limitation verbatim, #53 is left open as partially delivered, its body is corrected, and the hand-off ACs are written into #56/#57/#62 so those screens are built from text that includes it.
- [#175 snapshots `session_topics` without the annotation] → The pending requirement in `session-topic-lifecycle` plus a note on #175. SESSION-005/012 already read the column, so an omission there shows up as a permanently-null field in #57's first test.
- [Divergent authorization confuses future maintainers] → FR-8.7, a contract access-matrix fix, a code comment at the call site, and an admin-`403` test.
- [The free-text field gets used for notes about people] → Helper text states its purpose, the text stays out of the audit log, and there is no moderation workflow (deliberate).
- [An overwrite loses wording with no undo] → The current text and provenance stay visible while editing. Accepted, with no version history (use case Out of Scope).
- [A future edit to SESSION-005 reads `t.team_annotation` by accident] → The required real-Postgres negative test plus the mocked SQL-text guard.
- [Harmful text persists in past sessions] → Clearing a definition does not erase it from `session_topics.topic_annotation` snapshots, by design (snapshots are immutable). There is no in-app remediation and no moderation. Removing text from past sessions is a manual production-database operation by an operator with DB access; who may request it is not defined by this change and is added to the data-retention/user-erasure follow-up (task 9.6). Accepted and stated as a Known Limitation.
- [Provenance blocks future user erasure] → `annotation_updated_by REFERENCES users(id)` with no `ON DELETE`, like `archived_by`/`restored_by`. Added to the user-erasure follow-up (task 9.6); not solved here.
- [Stored XSS on session screens once #56/#57 ship] → React escaping is the only control while CSP is disabled. This change adds the first team-authored free text shown to every participant, which raises the CSP issue's priority; task 9.6 notes it on that issue. D11 AC 9 carries the plain-text rule to the session screens.
- [Inherited, accepted, matching TOPIC-003..006] → (a) The thrown path has no timing floor (`topics.ts:1128–1130`); Decision 3's character rules close the main new way to reach it. (b) Denied attempts, including an admin probing the deliberate `403`, write no audit row. (c) No rate limit; a facilitator alternating two values grows `audit_log` one row per real change. (d) A deactivated team stays editable, because `checkTeamExists` has no `deactivated_at` filter; an annotation is configuration, so this is consistent with the siblings and acceptable. (e) A TOPIC-007 write aimed at the template team currently answers `409` only because the sentinel team has no completed sessions; the template-guard issue (task 9.4) says so and must not count on it.
- [A facilitator's open editor or screen is stale relative to another facilitator's save] → Accepted as a Known Limitation. Last-writer-wins, and the saving row is patched from the server's response, so that row's provenance is always current after a save.
- [Admin flag drifts from TOPIC-007's actual rule] → Both derive from `global_role = 'facilitator'`, and a test covers each.

## Migration Plan

`19_topics_team_annotation.sql`, using `18_topics_active_order_partial_unique.sql` as the template: its `-- Up Migration` / `-- Down Migration` markers and header style. **Do not copy migration 17**, which uses bare `-- Up`/`-- Down` markers that node-pg-migrate v7 does not recognize (migration 8 records the incident in which a runnable Down under a bare marker ran as part of Up):
- Up: `ALTER TABLE topics ADD COLUMN team_annotation text NULL, ADD COLUMN annotation_updated_by uuid NULL REFERENCES users(id), ADD COLUMN annotation_updated_at timestamptz NULL; ALTER TABLE session_topics ADD COLUMN topic_annotation text NULL;`
- Down: drop those four columns.

It is additive and nullable, with no backfill and no lock-heavy rewrite. Deploy the migration before the code. The old code ignores the new columns, so the order is safe either way. Rolling back the code without the migration is harmless.

## Open Questions

- **H2 (→ #175):** Is the whole `session_topics` row written at creation or when a session leaves `draft`? This change's spec holds either way, as long as it's one write, completed before the session's first SESSION-005 call can succeed.
- **H4 (→ #62 owner, with Priya):** Does the definition stay visible after reveal? The recommendation is yes, and stationary.
- **BRD FR-8.7 wording.** Proposed: *"[HARD] After a team's first session, the Facilitator shall be able to set, edit, or clear a team-specific definition for each active topic. Application Administrators shall not edit team definitions."* Added to the BRD as part of this change's doc task (H1 settled). Rationale to record with it: FR-8.2 ("facilitator or Application Administrator" may add, remove, or reorder) does not mention annotation, so FR-8.7 adds a rule for a new operation and does not contradict FR-8.2.

## Design review disposition

Reviews: `design-review-engineer.md` (Marcus Oyelaran, approve with revisions) and `design-review-security.md` (Tomás Ferreira, approve with one blocker). Each claim was checked against `packages/` before deciding. H1 and H3 were not reopened.

### Security

| Item | Disposition |
|---|---|
| **B1** TOPIC-001 admits EMs; design contradicted itself | **Accepted, resolved by omission.** Verified: `content.ts:459–500` denies only a null grant and admins, and `content.test.ts:349` asserts EM `200`. TOPIC-001 does **not** gain `teamAnnotation` (Decision 8): it has no frontend caller and D11 AC 1 forbids it as a display source, so the field had no consumer and only added a manager-reachable read path. The contradictory "EM still gets 403" statements are removed from design, spec, and tasks. Fixing the EM authorization itself was considered and **deferred to its own change** (task 9.5): it changes a shipped endpoint's authorization against a test that deliberately asserts `200`, and the contract's TOPIC-001 access row is out of step with the code in more than one cell (it also says admins "Yes"; the code denies them), so it should be reconciled as a whole. Nothing in this change depends on EM access either way. |
| R1 scoped `UPDATE` | Accepted (Decision 5). |
| R2 U+0000 / lone surrogates; C0 and bidi decision | Accepted, including the recommended part: other C0 controls and bidi overrides/isolates are **rejected, not stripped** (Decision 3), so what is stored is what was submitted. |
| R3 no text in structured log or `422` bodies | Accepted (Decision 7), with a sentinel value and a no-log-body comment. |
| R4 admin read via TOPIC-002 | Accepted as an explicit decision: admins **may read** annotations and provenance, read-only (Decision 8), with a test. |
| R5 `Cache-Control` first | Accepted (Decision 2). |
| R6 plain-text AC; #57 snapshot value | Accepted (D11 AC 7 and AC 9). |
| R7 TOPIC-001 carries no provenance | Accepted and widened: TOPIC-001 carries no annotation field at all, and a test asserts the absence of all four keys. |
| Deferred items 1–7 | Recorded in Risks / Trade-offs, the remediation and erasure items routed to the follow-up in task 9.6. Item 7 (deactivated teams editable) confirmed as wanted, consistent with the siblings. |

### Engineer

| Item | Disposition |
|---|---|
| **M1** TOPIC-001 casing hybrid | **Resolved by B1's decision**: TOPIC-001 gains no field, so there is no hybrid and no `GetActiveTopicsResponse` to add here. Option (a) (remap to the contract now) was **not taken**: this change no longer touches TOPIC-001's body, and the archived `topic-customization-lock-and-add-custom-topic` design declined the remap on the record; the casing drift goes into the same follow-up as the EM defect (task 9.5), where the first real consumer can set the shape. |
| **M2** orphaned dirty editor | Accepted: a clean editor closes when a Remove/Restore dialog opens, and an editor whose row leaves `data.active` resets and is never dirty (Decision 10), with a component test. |
| **M3** dirty definition disables all Remove/Restore; quiet refetch | Accepted (Decision 10), using `annotationBusy` so an in-flight save is covered too, and a shared quiet `fetchAllTopics()` helper. |
| **M4** negative test needs real Postgres | Accepted. Verified the harness exists (`topics-integration.test.ts`, `facilitator-error-states-integration.test.ts`, `.github/workflows/integration.yml`). New file `topic-annotation-integration.test.ts`; a mocked SQL-text guard is added; tasks 1.2 and 7.2 move to the same file. |
| Minor 1 migration template | Accepted: cite 18, warn against 17. |
| Minor 2 `Cache-Control` first | Accepted (same as R5). |
| Minor 3 single in-transaction read | Accepted (Decision 5). |
| Minor 4 display name in response | Accepted: CTE `UPDATE … RETURNING` + `LEFT JOIN users`; provenance `null` unless both id and name exist. |
| Minor 5 counter vs `maxlength` | Accepted: limit-reached keys on raw length; the paste test asserts truncation. |
| Minor 6 non-UUID `topicId` → `500` | Accepted for `topicId` (`UUID_PATTERN` → `404 TOPIC_NOT_FOUND`). Not extended to `teamId`, which fails inside the shared auth helper; changing that helper is out of scope. |
| Minor 7 sentinel, `emitAuditEvent` payload | Accepted (Decision 7). |
| Minor 8 fixtures | Accepted (tasks 5.1 and 6.1, where each type change lands with its producer and fixtures; moved out of section 8 at task review, R3). |
| Minor 9 domain interfaces | Accepted (task 2.1/2.2). |
| Minor 10 admin read note | Accepted (same as R4). |
| Minor 11 keep both flag tests | Accepted, no change needed. |
| Hidden coupling: #175 note | Accepted: task 9.1 names `session_topics.topic_annotation` explicitly. |
