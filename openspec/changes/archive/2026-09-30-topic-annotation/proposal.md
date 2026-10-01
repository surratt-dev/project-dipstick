## Why

I put team annotation into the original proposal for one reason: **interpretation drift across facilitators.** The facilitator comes from another team, and a different one every few sessions. That rule is load-bearing, and it has a cost. Nobody in the room remembers what "Codebase Health" meant to *this* team last quarter. Without a written definition, each new facilitator explains the topic their own way, the team votes on a slightly different question each time, and the trend line slowly stops meaning anything. The annotation is how the team's meaning survives facilitator rotation. That is what I want from the whole application: the ritual keeps its own memory, so it doesn't depend on me or on any one facilitator.

Issue #53 says the annotation column, the write endpoint, and the rendering are all missing, "including in the live-session topic view, which otherwise already works." The first three are true. The last one is not. No page renders a topic prompt to a participant yet (#57, #56), and `session_topics` is never populated in production (#175). TOPIC-002 already has a `teamAnnotation` field, hard-coded to `null`. TOPIC-001's contract promises the field, but its handler doesn't return it. TOPIC-007 has been in the contract as a draft for a long time.

So this change ships **the management half**, and it ships it so that the session half has a correct place to land. The user has accepted this scope (H3). #53 **stays open as partially delivered**, and its body gets corrected.

What the annotation must keep intact:

1. **The first-session lock covers annotation, with no exceptions.** The use case lists "annotating" among the locked operations. The gate, the `409`, and the audit row are the same ones as on every sibling. A side effect I'm happy with: a first session can never show an annotation, so every team's first session runs the canonical baseline.
2. **It is the team's words, written down by the facilitator.** Editing is **Facilitator-only**. Application Administrators get `403`. Admins have no session context, and they are denied session content elsewhere (`denyAdminContentAccess`). This deliberately diverges from TOPIC-002/004/005/006, which admit admins under FR-8.2, so it is recorded as **proposed BRD FR-8.7** and not left as an inconsistency for someone to "fix" later (H1, decided).
3. **It never changes the question mid-session and never rewrites history.** The annotation is read in session from the **`session_topics` snapshot**, never live from `topics`, just like `topic_prompt`. An edit during a live session affects only later sessions. This change proves that against fixtures with a required negative test.
4. **It is not a performance tool.** It is free text kept indefinitely and shown to the whole team. The editor states plainly what the field is for. The text never goes into the audit log, so the audit log can't become the version history the use case rules out.

## What Changes

- **Migration 19 (`19_topics_team_annotation.sql`).** Adds `topics.team_annotation text NULL`, `topics.annotation_updated_by uuid NULL REFERENCES users(id)`, and `topics.annotation_updated_at timestamptz NULL` (provenance, following the `archived_by`/`restored_by` precedent), plus `session_topics.topic_annotation text NULL`. All four are nullable, with no default and no backfill, so existing rows read NULL. There is no DB length CHECK (design.md Decision 4). Rollback drops exactly these four columns.
- **`PUT /api/v1/teams/:teamId/topics/:topicId/annotation` (TOPIC-007), a new endpoint.** Facilitator-only (standing, non-member). Admin → `403`. It uses the sibling cascade: `403` → `404 TEAM_NOT_FOUND` → `409 TOPIC_CUSTOMIZATION_LOCKED` (plus a `topic.write_denied_locked` audit row with `attempted_operation: "topic.annotation_updated"`) → `422 INVALID_ANNOTATION` body → `404 TOPIC_NOT_FOUND` / `422 TOPIC_ALREADY_ARCHIVED`. `applyTimingFloor` runs on every exit, and the response carries `Cache-Control: no-store`. The body is `{ annotation: string }`. A missing, `null`, or non-string value → `422`, because `null` is not an alias for clear. Every error uses the standard envelope; `401` and malformed JSON are handled as on the sibling endpoints. The value is normalized `\r\n` → `\n` and trimmed; disallowed characters (U+0000, unpaired surrogates, C0 controls other than LF and TAB, U+007F, bidi controls) are rejected before length; then it is counted: **500 UTF-16 code units** maximum (closes Contract OQ-7). Trimmed-empty → stored NULL (clear). A no-op returns `200` with no audit row and leaves provenance unchanged. Concurrent writes are last-writer-wins. A real change writes a `topic.annotation_updated` audit row with `{ topic_id, action: "set" | "cleared", length }` and **never the text**. The response is `{ topicId, teamAnnotation, annotationUpdatedAt, annotationUpdatedBy }`.
- **Reads.** TOPIC-002 returns the stored `teamAnnotation` (no longer hard-coded `null`) plus `annotationUpdatedAt`/`annotationUpdatedBy` on active **and archived** entries, and a top-level `canEditAnnotations` flag that is `false` for an Application Administrator, so the screen never offers a control that would only `403`. Admins read annotations and provenance there read-only (an explicit decision: topic configuration, not session content). **TOPIC-001 does not gain `teamAnnotation`**: it has no consumer, in-session display must not read it, and today's TOPIC-001 handler answers `200` to engineering managers, so adding the field would hand the team's free text to managers. That pre-existing EM defect and TOPIC-001's snake_case drift go to a separate follow-up (design.md Decision 8).
- **Session payloads, from the snapshot only.** Begin-voting (SESSION-005) and topic-advance (SESSION-012) gain `currentTopic.topicAnnotation: string | null`, read **only** from `session_topics.topic_annotation`. This is verified against `session_topics` fixtures. The **required negative test** is that changing `topics.team_annotation` after the fixture exists does not change either payload. (The exploration notes call begin-voting "SESSION-004". The code and the lifecycle spec say SESSION-005.)
- **Snapshot hand-off pinned in spec.** `session-topic-lifecycle` gains a requirement that when `session_topics` rows are written for a session, each row's `topic_annotation` equals the source topic's `team_annotation` at that instant, **in the same write** as name, prompt, vote type, and order. It is worded so it holds whenever #175 decides that write happens.
- **Seed isolation.** New teams never inherit an annotation from the template team. The existing explicit column list in the seed copy stays explicit, and a test guards it.
- **Management-screen editor.** Labelled **"Our team's definition"** on every screen ("annotation" stays a code/API word). It sits above the description on active and (read-only) archived rows, with a muted "Last edited {date} by {name}" line. The editor is inline, one open at a time, a labelled `<textarea maxlength=500>` with an `n / 500` counter in the server's unit that announces "500 character limit reached.", and helper text: *"What this topic means for this team, in the team's words. Not for notes about people or how to vote."* There is an inline clear-confirm (non-null → null only), no confirm on overwrite, an unchanged save sends nothing, and Esc/Cancel restore the saved text. The client compares using the server's normalization. Unsaved text arms the existing `beforeunload` guard, and disables reordering and every Remove and Restore so no draft can destroy another. A clean editor closes when a move or a Remove/Restore dialog begins, and an editor whose row leaves the active list closes rather than staying "dirty". Errors keep the text. A save updates the row in place with *"Saved. Sessions that already exist keep the previous definition."* The editor is hidden on a locked team (the lock notice gains the sentence "Team definitions can be added after the team's first session."), hidden for admins, and disabled while a reorder draft is unsaved. All text renders as plain text.
- **Requirements docs corrected in the same PR:** the TOPIC-007 contract rewrite, the access-matrix row, TOPIC-002 line 609's "TOPIC-003 through TOPIC-007", OQ-7 closed, the use case (lock wording, default/custom note resolved, session-display ACs marked "pending #175 and #56/#57"), and **BRD FR-8.7** added.

No **BREAKING** changes. Every schema change is additive and nullable. Every response change adds fields.

## Capabilities

### New Capabilities
- `topic-annotation`: storage and provenance of a team's per-topic definition; the TOPIC-007 write endpoint (Facilitator-only authorization, cascade, lock, normalization and the 500-unit limit, no-op, last-writer-wins, audit without text); plain-text handling; preservation across archive/restore; isolation from the template team and from new-team seeding; TOPIC-001 deliberately not returning the annotation.

### Modified Capabilities
- `topic-customization-lock`: TOPIC-002's response contract gains `teamAnnotation` (populated), `annotationUpdatedAt`/`annotationUpdatedBy` on active and archived entries, and `canEditAnnotations`.
- `topic-management-screen`: adds the "Our team's definition" display and editor, the locked-notice sentence, admin read-only treatment, and the interaction with the reorder draft.
- `session-topic-lifecycle`: SESSION-005/SESSION-012 return `topicAnnotation` from the snapshot only, and adds the pending snapshot-content requirement that #175 must satisfy.

## Impact

**Code:**
- `packages/backend/migrations/19_topics_team_annotation.sql`: new.
- `packages/backend/src/routes/topics.ts`: new TOPIC-007 handler. Reuses `checkTeamExists`, `checkCustomizationLockGate`, `checkTopicExistsAndActive`, and the facilitator-only identity check TOPIC-003 already uses (its message parameterized).
- `packages/backend/src/routes/content.ts`: TOPIC-002 read wiring. TOPIC-001 is unchanged apart from a negative test.
- `packages/backend/src/routes/facilitator-sessions.ts`: SESSION-005/SESSION-012 select `st.topic_annotation`.
- `packages/backend/src/auth/audit-logger.ts`: `"topic.annotation_updated"`.
- `packages/shared/src/types/topic.ts`, `session.ts`: request/response types and new fields.
- `packages/frontend/src/pages/TopicManagementPage.tsx`: the editor. No new dependencies.

**Known Limitations (stated plainly):**
> No participant or facilitator will see a team definition in a live session until both #175 (session_topics population) and #57/#56 (session screens) are delivered. This change delivers storage, the write endpoint, the management-screen editor, and annotation-bearing session payloads verified against fixtures. Team definitions are captured after the session on the Topic Management screen, not in the room. The template team can currently be targeted by topic writes (sibling-wide gap shared with TOPIC-004/005/006; #188 (template-team write guard)).

- The WebSocket reconnect snapshot carries no prompt and so no annotation. Widening it belongs to #57.
- Overwrites are as irreversible as clears, and there is no version history (the use case rules it out). Visible current text and provenance are the mitigation.
- Last-writer-wins with no live refresh: if two facilitators work on the same team at once, one may be looking at text the other has already replaced. Only the row just saved is guaranteed current.
- After a clear, the screen shows nothing. Who cleared the definition is in the API response and audit log only.

**Hand-off notes (not decided here):**
- **H2 → #175 (snapshot timing).** Is the whole `session_topics` row written at session creation or when a session leaves `draft`? This change's only rule is that the annotation is copied **in the same write, at the same instant,** as the rest of the row, completed before the session's first SESSION-005 (begin-voting) call can succeed. #175 decides timing for the whole row, not for annotation alone.
- **H4 → #62 (post-reveal visibility).** My recommendation is that the definition stays visible and stationary from voting through reveal and discussion. The use case says "voting phase." #62's owner decides, and the use case is updated to match.
- **Session-display ACs for #56/#57/#62** (drafted in design.md, handed to the team lead to post; not posted by this change's agents): render from the session payload only, never TOPIC-001/002; label "Our team's definition"; order prompt → definition → description; secondary weight; no element when null; unattributed; shown to the facilitator too; visible immediately to late joiners from the snapshot value; rendered as plain text.

**Not touched:** the no-manager rule (no manager-reachable surface gains the annotation; TOPIC-001's existing EM access is a pre-existing defect filed separately), simultaneous reveal, the facilitator-from-another-team requirement, `session_topics` writes (#175), trend/EM views, and the WebSocket payloads.

**Follow-ups:** the template-team write guard (sibling-wide), TOPIC-001's EM authorization defect and casing drift, data-retention/erasure of annotation text and provenance (including remediation of snapshotted text) plus a note raising the CSP issue's priority, EM/facilitator session-history display of the snapshotted definition, a post-session capture prompt on a future wrap-up screen, display copy that promises session visibility once #57 ships, and facilitator onboarding guidance that repeats "not about people" (Executive risk 3; owner: whoever owns facilitator guidance).

**Follow-ups for the human (Executive conditions; agents do not act on these):**
- **C1. Prioritization.** The team lead confirms that #175 (and ideally #56/#57) is next, and that this change takes no capacity from it. If they compete for the same people, #175 goes first and this waits. Annotation is a session-3-and-later feature, so landing it after the live-session path costs adoption nothing.
- **C2. File the capture-prompt issue.** File "post-session capture prompt on a future wrap-up screen" as a real GitHub issue, not only a bullet here. A definition nobody writes protects nothing.
- **C3. Rewrite #53's body.** Using the draft from task 9.3, state plainly that team definitions are not visible in sessions until #175 and #56/#57 ship, so status reported upward stays accurate. #53 stays open.

## Review disposition

Reviewed by Marcus Delgado (BA, approve with minor revisions) and Rachel Okonkwo (VP Engineering, approve with conditions). Management-half scope and Facilitator-only editing were settled before review and are not reopened.

**Accepted into the specs:**
- **B1–B2.** Definition drafts and reorder drafts now protect each other in both directions, and Remove and Restore are disabled on every row while a definition is dirty (revised at design review to match the reorder draft's rule). I chose disabling over "discard the text": a facilitator's wording is exactly what this feature exists to keep.
- **B3.** Option (a). Archived rows show the definition read-only. That is the reason the API carries it, and the restore decision is when it matters.
- **B4.** An unchanged save sends nothing and shows nothing. The client uses the server's normalization for every comparison.
- **B5.** `maxlength` stays, and reaching 500 shows and announces "500 character limit reached." This is the smaller change, and it keeps the server limit unreachable from the UI.
- **V1, V3, V4, V5, V6, V7, V11, V12.** Exact lock-notice text; focus plus "Save or cancel this definition first."; clear-confirm Cancel returns to the editor; the screen's existing `en-US` short date; post-clear and null-user provenance stated as a table; `now()`; the snapshot boundary is "before the first SESSION-005 can succeed."
- **V8–V10.** Code `INVALID_ANNOTATION` with three exact messages (type, disallowed characters, over-length; corrected from "two" at task review, F1); every non-2xx uses the envelope; `401` comes from the shared auth layer; malformed JSON and non-UUID params follow the siblings; a non-object body is a `422`.
- **Q1.** Added as a Known Limitation. A refetch-after-save does not fix a stale *open* editor, so it isn't worth the lost local state.
- **Q2.** On `404 TOPIC_NOT_FOUND` / `422 TOPIC_ALREADY_ARCHIVED`, the text stays in the editor and the list refetches when the editor closes, so the facilitator can copy their words first.
- **Q3–Q4.** Two-row `canEditAnnotations` truth table; the textarea is labelled and described.
- **FR-8.2 note.** FR-8.7's rationale now says it adds a rule for a new operation and does not contradict FR-8.2.

**Accepted with modification:**
- **V2.** `role="status"` in the row, as asked, but with **no 5-second timeout**. The existing "Order saved." has none, so it clears on the next action on that row instead. Two different persistence rules on one screen would be the real inconsistency.

**Not done here, by design:**
- **V13.** No change, as the BA noted. The spec governs.
- **Executive C1–C3** are prioritization and GitHub actions. They are recorded above as follow-ups for the human, and no agent performs them.
- **Executive scope notes.** The SESSION-005/012 payload work stays fixture-only and small. The #62 material stays hand-off notes, with no design work in this change. On task count: the review added tests for rules that were already implied, folded into existing tasks, and added no new features. I'll hold that line through implementation.
