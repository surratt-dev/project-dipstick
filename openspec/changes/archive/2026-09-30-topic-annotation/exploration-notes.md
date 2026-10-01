# Exploration Notes: Topic Annotation (TOPIC-007, GitHub #53)

> **Superseded in part (task review, 2026-09-30):** statements here that TOPIC-001 returns `teamAnnotation`, or that engineering managers get `403` on TOPIC-001, are superseded by design.md Decision 8. TOPIC-001 does not return the annotation, and today's handler answers EMs `200` (`content.test.ts:349`; follow-up drafted in task 9.5). Do not revive the old plan from this file.

**Explored by:** Devon Calloway (Internal Champion / founding advisor)
**Date:** 2026-09-30
**Mode:** `opsx:explore`. These are notes for thinking, not a proposal. Nothing here is decided until a proposal or design says so.
**Revision 2 (same day):** Updated after reviews by Priya Nair (`explore-review-facilitator.md`) and Marcus Delgado (`explore-review-ba.md`). §3 to §8 are rewritten. §7 records what I accepted, what I rejected, and why.

---

## 1. Where things stand (the issue is partly wrong)

Issue #53 says `topics` has no annotation column, no write endpoint, and no rendering, "including in the live-session topic view, which otherwise already works." The first three are true. The last claim is not.

| Piece | State today | Where |
|---|---|---|
| `topics` annotation column | **Missing.** Columns stop at `first_session_description`, `archived_*`, `restored_*` | `migrations/2_create_tables.sql:45-59`, `16_*`, `17_*` |
| `session_topics` annotation snapshot | **Missing.** Snapshots `topic_name`, `topic_prompt`, `vote_type` only | `2_create_tables.sql:86-101` |
| TOPIC-002 `teamAnnotation` | Field exists in the response, **hard-coded `null`** | `routes/content.ts:636`, `shared/src/types/topic.ts` |
| TOPIC-001 `teamAnnotation` | Contract promises it; the handler does not select or return it | `content.ts:461-520`, `REST API Contract.md` TOPIC-001 |
| TOPIC-007 write endpoint | **Missing.** Drafted as `PUT /api/v1/teams/:teamId/topics/:topicId/annotation` | `REST API Contract.md` TOPIC-007 |
| Topic Management screen | Built. Each active row shows name, prompt, vote type, description; Move and Remove controls when unlocked | `frontend/src/pages/TopicManagementPage.tsx:655-730` |
| Live-session topic view (backend) | Begin-voting (SESSION-004) and advance (SESSION-012) return `topicName`/`topicPrompt`/`voteType` read from `session_topics` | `facilitator-sessions.ts:1181-1257`, `:1847-1914`; `shared/src/types/session.ts:140-160` |
| Live-session topic view (frontend) | **Does not exist.** No page renders a topic prompt to a participant. Tracked as #57 (participant vote-prompt UI) and #56 (topic-advance UI), both open | `frontend/src/pages/` has no session-room page |
| WS reconnect snapshot | Carries only `{ sessionTopicId, status }` for the current topic. No prompt, so no annotation either | `shared/src/types/realtime.ts:116`, `realtime/session-registration-snapshot.ts` |
| `session_topics` population | **Never populated** in production code (#175, open). Only test fixtures write it | — |

So the live-session half of this issue has nowhere to land in the UI yet, and its data source (`session_topics`) is empty for every real session. This is the same #175 shadow that Remove, Re-Add, and Reorder all inherited. What this change *can* do is put the annotation into the backend payloads that a future #57 screen will read, and test it against fixtures.

---

## 2. What the ritual needs (Devon's read)

### Why annotation exists at all

I put this in the original proposal for one reason: **interpretation drift across facilitators.** The facilitator comes from another team, and it's a different one every few sessions. That rule is load-bearing, and it has a cost. Nobody in the room carries the history of what "Codebase Health" meant to *this* team last quarter. Without a written definition, each new facilitator re-explains the topic their own way, the team votes against a slightly different question each time, and the trend line quietly stops meaning anything.

The annotation is how the team's meaning survives facilitator rotation. It's the same thing I want from the whole application: the ritual carries its own memory, so it doesn't depend on me or on any one facilitator.

That gives me three things I care about:

1. **It must be visible at the moment of voting**, next to the prompt, to everyone in the room. An annotation that only shows on the management screen fails the purpose. The management screen is only half of this feature.
2. **It must be the team's words, not the facilitator's.** The use case trigger says it right: "the Facilitator (or the team during a session) agrees on what a topic means." The facilitator is the scribe. That matters because the facilitator is by design *not* on the team. If a facilitator can quietly rewrite the definition to fit their own view, we've swapped interpretation drift for facilitator drift, and made it permanent.
3. **It must not change the question mid-session or rewrite history.** A definition that changes between the first and last voter on a topic, or that changes what an old session appears to have asked, damages the trend data. That's the thing the feature exists to protect.

### Guardrails it touches

- **First-session lock: applies, no exceptions.** The use case says the lock covers "adding, removing, reordering, and annotating." Same `hasCompletedFirstSession` gate, same `409 TOPIC_CUSTOMIZATION_LOCKED`, same `topic.write_denied_locked` audit row with `attempted_operation: "topic.annotation_updated"`. No separate lock path. A side effect I'm happy with: a first session can never show an annotation, so the first session always runs the canonical baseline.
- **No-manager rule: not touched directly**. EM visibility of team definitions is out of scope; TOPIC-001 still returns `403` to EMs (§3f).
- **Not a performance tool.** Annotation is a 500-character free-text field shown to the whole team and kept indefinitely. It's an obvious place for someone to write "slow reviews = Alex" or "thumbs down here means you aren't trying." I don't think we can or should filter content. The editor copy should say plainly what the field is for: *the team's shared meaning of the topic*, not notes about people or vote guidance. One line of helper text is enough. No moderation workflow.
- **Doesn't make the app feel like software.** In the session view, the annotation should be visually secondary to the prompt: readable, not collapsed behind a click, not styled as a banner. "No annotation" means no element at all, per the use case. No placeholder, no "Add a definition!" nudge to participants.

---

## 3. Hidden complexity found in the code

### 3a. Snapshot vs. live read: the real design decision

There are two ways for the session view to get the annotation:

```
 Option A: LIVE READ                     Option B: SNAPSHOT (recommended)
 ─────────────────────                   ──────────────────────────────────
 begin-voting / advance                  session creation (#175)
   └─ JOIN topics t                        └─ copy topics.team_annotation
        └─ t.team_annotation                    → session_topics.topic_annotation
                                         begin-voting / advance
                                           └─ read st.topic_annotation
```

- **The contract already chose B:** TOPIC-007 Notes say "the annotation is included in session topic snapshots… Changes apply to future sessions only; historical sessions retain the annotation as it was at session creation time." The use case says "during *future* sessions."
- **B matches the prompt.** `topic_prompt` is snapshotted precisely so history shows "what participants actually saw and voted on" (`database-schema.md`, `session_topics` rationale). The annotation is part of what they saw, so it belongs in the snapshot too.
- **A has a real hazard.** The lock only prevents edits *before* the first completed session. After that, TOPIC-007 can be called while a session is live. The live session's own facilitator is a standing facilitator and a non-member, so they pass auth. With a live read, the definition could change between topic N's voting and a late joiner's view, or between Engineer A seeing it and Engineer B seeing it. That's a mid-vote change to the question. With B, an edit during a live session only affects the next session, the same model Reorder already uses ("order in effect at creation is the order that session uses").
- **Cost of B:** a second column on `session_topics`, and the snapshot write itself belongs to #175, which doesn't exist yet. This change would add the column, read it in SESSION-004/SESSION-012 responses, and make sure #175's eventual INSERT copies it. #175 is still open, so that needs either a note on #175 or a task in this change that pins the expectation in the `session-topic-lifecycle` spec ("the snapshot includes the topic's current annotation").

**Decided: B.** Recorded as a Known Limitation until #175 lands.

**Snapshot timing (from Priya, O2).** Sessions have a `draft` status, so a facilitator can create Thursday's session on Monday. If the snapshot is taken at creation, a Tuesday edit won't show on Thursday. Priya is right that this is the most natural editing window. But I won't let annotation snapshot at a different moment from the rest of the row. If the prompt is frozen on Monday and the definition on Thursday, the session record no longer describes one coherent question, and that matters more than the convenience. The rule I'll hold: **the annotation is snapshotted in the same write, at the same instant, as `topic_name`/`topic_prompt`/`vote_type`/order.** *When* that write happens (at creation, or when the session leaves `draft`) is #175's decision for the whole row, not this change's. It goes to #175 as a question (§8, H2). The spec scenario in this change is worded to hold either way: "when `session_topics` rows are written for a session…".

From the ritual's side, "freeze when the session leaves `draft`" is acceptable. Nobody has seen the question yet, so changing it can't move a vote. The line I care about is that nothing changes once a participant can see it.

### 3b. Migration 19

- `topics.team_annotation text NULL`. Nullable, no backfill, no default. NULL means none.
- `topics.annotation_updated_by uuid NULL REFERENCES users(id)` and `topics.annotation_updated_at timestamptz NULL`. **No longer optional.** Provenance is in (Decision D6). Follow the `archived_by`/`restored_by` precedent (migrations 16, 17).
- `session_topics.topic_annotation text NULL`. **No length CHECK.** A snapshot has to accept whatever the source held.
- DB `CHECK` on `topics.team_annotation`: left to the engineer, but the proposal must state which way it went. If added, it must not be described as "the same rule" as the handler. Postgres `char_length` counts code points, the handler counts UTF-16 units, so the CHECK is looser. Only add it if `prompt` gets the same treatment.
- Rollback drops these four columns and nothing else. Copy the header style from `17_topics_restored_by.sql`.

### 3c. Seed isolation

`facilitator-sessions.ts:604` seeds new teams from the template team with an explicit column list, so the new column won't be copied. Keep it explicit and add a test: set `team_annotation` on a template-team row, create a team, assert every new team topic has `team_annotation IS NULL`.

Template-team targeting: confirmed that `routes/topics.ts` has no guard against `teamId = 00000000-…-0001`. This is a sibling-wide gap shared by TOPIC-004/005/006, so it is out of scope here. File an issue and reference it in Known Limitations (Marcus, C5).

### 3d. Contract corrections (decided)

| Item | Decision |
|---|---|
| Lock | `409 TOPIC_CUSTOMIZATION_LOCKED` + `topic.write_denied_locked` audit row, `attempted_operation: "topic.annotation_updated"` |
| Authorization | Standing facilitator, not a team member. **Admins excluded** (D1). Admin → `403`, with a test |
| Topic not on team | `404 TOPIC_NOT_FOUND` |
| Topic archived | `422 TOPIC_ALREADY_ARCHIVED` (sibling code, not the contract's 404) |
| Cascade | 403 → 404 team → 409 lock → 422 body → 404/422 topic. `applyTimingFloor` on every exit. Standard error envelope |
| Body | `{ annotation: string }`. Missing, `null`, or non-string → `422`, `field: "annotation"`. `null` is **not** an alias for clear |
| Normalization | Normalize `\r\n` → `\n`, trim leading/trailing whitespace, then count. Interior whitespace and line breaks are preserved. Trimmed-empty → store NULL |
| Limit (closes Contract OQ-7) | 500 UTF-16 code units (JS `.length`) after trim. Same unit as `prompt` and `<textarea maxlength>`. An emoji counts as 2, and the contract says so |
| No-op | If the normalized value equals the stored value (NULL ↔ empty included): `200`, current state, **no audit row, provenance unchanged** |
| Response | `{ topicId, teamAnnotation: string \| null, annotationUpdatedAt: string \| null, annotationUpdatedBy: { userId, displayName } \| null }`. Renamed from the contract's `annotation` so the frontend has one name. `annotationUpdatedBy` reuses `ArchivedByProvenance` |
| Clear provenance | Clearing sets `annotation_updated_by/_at` to the clearer and time (a clear is an edit). The UI shows no provenance when the text is NULL |
| Headers | `Cache-Control: no-store` |
| Concurrency | Last-writer-wins, no precondition token, same as Reorder. Stated as a decision (D7) |
| Advisory lock | Engineer's call. Single-row UPDATE probably doesn't need it. design.md states it |
| Rendering | Plain text everywhere. No Markdown, no HTML. Escaped, line breaks preserved. Test: `<script>` round-trips as literal text |

### 3e. Audit

`operation: "topic.annotation_updated"`, `metadata: { topic_id, action: "set" | "cleared", length }`. **Never the text.** A test asserts that no metadata key holds the text. This keeps the audit log from turning into the version history the use case puts out of scope.

### 3f. Reads

- **TOPIC-002** returns the stored `teamAnnotation` for active topics, plus `annotationUpdatedAt`/`annotationUpdatedBy`. **Archived entries also return `teamAnnotation`** (Marcus, C9). One read shape, and it tells the facilitator what will come back on restore. Archived entries are read-only, so this exposes nothing new.
- **TOPIC-001** returns `teamAnnotation` per the contract. EM → `403` still holds after the field is added (test, C7).
- **SESSION-004 / SESSION-012** return `topicAnnotation` read **only** from `session_topics.topic_annotation`.
- **Hand-off rule for #56/#57 (Marcus, C4):** in-session display reads the annotation only from the session payload, never from TOPIC-001/002. TOPIC-001 returns the *live* value to participants, so reading it in-session would quietly bypass the snapshot.

### 3g. Archive/restore and first session

- Archive then restore preserves the annotation. Scenario: annotate 'X', archive, restore, TOPIC-002 returns 'X'.
- **First session never carries an annotation.** That's an explicit scenario, not a side effect: writes are rejected (`409`) until a session has completed.
- Annotating a team's copy of a default topic leaves the template-team row unchanged (FR-8.6). Default and custom topics can both be annotated (C2, resolved).

---

## 4. Management screen (decided)

**Label.** User-facing name is **"Our team's definition"** on every screen (Priya, O5/S5). "Annotation" stays a code/API word. On the row, it appears **above** the description, with its own label. The team's words outrank the generic text.

**Display.**
- Non-null: the row shows the text under the label, plus one muted line in the archived/restored metadata style: "Last edited {date} by {displayName}".
- Null: no text, no provenance, only an "Add team definition" control (when unlocked).
- Locked (`isCustomizationLocked`): no edit control and no annotation text, because none can exist. The existing lock notice adds one sentence saying team definitions become available after the first session (Priya, O8).

**Editor.**
- Inline, one open at a time. Opening a second closes the first only if it has no unsaved changes. Otherwise the open one has to be saved or cancelled first.
- `<textarea maxlength=500>` with an `n / 500` counter in the same unit as the server.
- The current saved text and its provenance are visible while editing, so the facilitator knows whose wording they're replacing (Priya, Q4/Q5).
- Helper text, editor only: *"What this topic means for this team, in the team's words. Not for notes about people or how to vote."* (Priya's S7 wording; see §7 R3 for why not Marcus's.)
- Esc or Cancel restores the saved text with no prompt.
- Unsaved annotation text triggers the existing `beforeunload` guard.
- On error: the editor stays open with the user's text intact plus an error message. The stored value is unchanged.

**Saving.**
- Success updates that row in place, without a full reload.
- Save confirmation: **"Saved. Sessions that already exist keep the previous definition."** That's true under the snapshot model whatever #175 decides about timing, and true before #57 exists (§7 R2).
- **Clear-confirm:** an inline confirm (not a modal) appears **only** when the save would change non-null to null. Copy: "Remove this team's definition? This can't be undone." Non-empty edits save without a confirm. Clearing an already-empty annotation shows nothing (no-op).
- **No confirm on overwrite.** This is deliberate (D8). Overwrites are as irreversible as clears, but visible current text and provenance make them safe enough. A confirm on every edit is friction on a routine act. Record it so nobody adds one later "for consistency."

**Reorder-draft interaction (Priya O6, Marcus §4).** `topicActionsLockedByDraft` is the **unsaved reorder draft** (`isDirty || isSaving`), not a draft session. My original Q9 misread it. Requirement: while the reorder draft is dirty or saving, either disable annotation editing with the existing `LOCKED_BY_DRAFT_REASON`, **or** update only that row in local state without refetching. Engineer picks one. A test asserts that an unsaved reorder survives an annotation save.

**Usability pass (Priya, S8).** A 10-minute walkthrough with Priya on the branch covering clear-confirm, provenance placement, and label. It's a task, not a gate on merge.

---

## 5. Session display: handed off, written down

This change builds no session screen. The display requirements go **into the issues that build those screens, as written acceptance criteria**, posted as a task in this change (Priya, S4; Marcus, §6.1). A Known Limitations paragraph alone isn't enough, because those screens will be built from their own issue text.

**AC block to post on #57 (participant vote prompt), #56 (facilitator topic-advance), and #62 (reveal/discussion):**
1. Renders `topicAnnotation` from the SESSION-004/012 payload only, never from TOPIC-001/002.
2. Labelled "Our team's definition". Order: prompt, then team definition, then description.
3. Secondary weight: after the prompt, body text size or smaller, not collapsed, no banner/background/border treatment, never larger or bolder than the prompt.
4. **No element at all when null.** No placeholder, no nudge.
5. **Unattributed.** No editor name or date in the session view.
6. Shown to the facilitator as well as participants (#56). The facilitator is the outsider in the room and needs it most.
7. Late joiner / reconnect sees it immediately (#57's reconnect AC). The WS snapshot is **not** widened in this change.
8. Visibility after reveal: recommendation is **visible and stationary from voting through reveal and discussion**. The reveal must not move, collapse, or reflow it. #62's owner makes the final call (see §8, H4).

---

## 6. Scope boundary for #53 (converged)

**#53 is DONE when all of these pass:**

1. **Persistence.** Migration 19 per §3b. Existing rows read NULL. Rollback drops only the new columns.
2. **Write.** TOPIC-007 per §3d. One integration test per cascade row, plus no-op, normalization, limit boundary (500/501, trim-then-count, 250/251 emoji), admin `403`, and literal `<script>` round-trip.
3. **Audit.** Per §3e, including the no-text assertion and no audit on no-op.
4. **Reads.** TOPIC-002 (active and archived) and TOPIC-001 per §3f. EM `403` on TOPIC-001 still holds.
5. **Session payloads, against fixtures.** With a `session_topics` fixture row whose `topic_annotation = 'X'`, SESSION-004 and SESSION-012 return `'X'`. NULL returns `null`. **Required negative test:** set `topics.team_annotation = 'Y'` after the fixture exists. Both still return `'X'`. This test is the proof that we chose the snapshot model, and it must not be dropped.
6. **Hand-off pinned in spec.** `session-topic-lifecycle` gains a pending requirement: *"WHEN `session_topics` rows are written for a session, THEN each row's `topic_annotation` equals the source topic's `team_annotation` at that instant, in the same write as the name, prompt, and vote-type snapshot."* #175 gets a comment linking to it, plus the timing question (H2).
7. **Seed isolation, archive/restore, first-session, default-topic scenarios** per §3c/§3g.
8. **Management UI** per §4, with component tests.
9. **Hand-off ACs** from §5 posted on #56, #57, #62.
10. **Docs** in the same PR: contract (TOPIC-007 rewrite per §3d, TOPIC-002 line 609 "TOPIC-003 through TOPIC-006", OQ-7 closed), use case (409 wording, default/custom note closed, Out-of-Scope line rewritten per Marcus C3, session-display ACs annotated "delivered via #57/#56 and #175"), BRD FR-8.7 (subject to H1).

**Out (and where it went):** participant/facilitator session screens (#57/#56/#62), writing `session_topics` (#175), WS snapshot widening (#57), EM/facilitator session-history display (follow-up), version history (use case: out), engineer-proposed definitions (out), template-team guard (new sibling-wide issue), post-session capture prompt (follow-up, §7 A9).

**#53 closes as partially delivered.** The PR description and issue close-out say so plainly, and #53's body is corrected. It currently claims the live-session topic view "otherwise already works," which is false.

**Known Limitations (verbatim for the proposal):**
> No participant or facilitator will see a team definition in a live session until both #175 (session_topics population) and #57/#56 (session screens) are delivered. This change delivers storage, the write endpoint, the management-screen editor, and annotation-bearing session payloads verified against fixtures. Team definitions are captured after the session on the Topic Management screen, not in the room. The template team can currently be targeted by topic writes (sibling-wide, issue #TBD).

---

## 7. Review response

### Accepted

| # | From | What | Where now |
|---|---|---|---|
| A1 | Marcus §1 | Testable done-list and reassignment table | §6 |
| A2 | Marcus §2 | 500, trimmed, UTF-16 units; CHECK caveat on code points | §3b, §3d |
| A3 | Marcus §3 | `null` ≠ clear, no-op writes nothing, `\r\n` normalization, `teamAnnotation` response name, plain-text rendering test | §3d |
| A4 | Marcus C4 | In-session display reads only the session payload | §3f, §5 |
| A5 | Marcus C9 | Archived entries return the annotation | §3f |
| A6 | Marcus C8, C2, C7 | First-session, default-topic, EM-403 as explicit scenarios | §3g, §6 |
| A7 | Both | My Q9 misread `topicActionsLockedByDraft`. Corrected | §4 |
| A8 | Priya O4/O5/S4/S5 | Facilitator view is a consumer (#56). Label "Our team's definition". Order prompt → definition → description. ACs written into issues, not just a limitation paragraph | §4, §5 |
| A9 | Priya O1/S1 | Capture gap named. Took **(c)**, accept and state it, now. There is no completed-session/wrap-up page in `frontend/src/pages/` to link from, so (b) has nowhere to land. (a) and (b) go to whichever issue builds session wrap-up, as a follow-up note | §6 Known Limitations |
| A10 | Priya O3/S3 | Save confirmation states effective scope | §4 |
| A11 | Priya O6/O7/S6 | One editor at a time, `beforeunload`, Esc restores, reorder-draft safety | §4 |
| A12 | Priya/Marcus | Provenance stored and shown on the management screen, **never** in session view. Clear-only confirm, with reasoning recorded | §4, D6, D8 |
| A13 | Priya S2 | Snapshot timing raised to #175 | §3a, H2 |
| A14 | Priya S8 | Usability walkthrough | §4 |

### Rejected or modified

- **R1. Snapshot the annotation when the session leaves `draft`, if that differs from the rest of the row (Priya O2, modified).** I accept the concern and send the question to #175. I reject solving it for annotation alone. A session record whose prompt and definition were frozen at different moments isn't a record of one question. The fidelity of the historical record is the reason the snapshot exists, so it's the constraint I won't trade. Timing is decided once, for the whole row.
- **R2. Save copy "Shows from the next session" (Priya O3, modified).** Until #175 and #57 land, that sentence is false, and if #175 keeps creation-time snapshots it stays false for sessions already drafted. The first thing the tool says about this feature shouldn't be untrue. I replaced it with "Saved. Sessions that already exist keep the previous definition," which is true in every case.
- **R3. Helper text "Shown to everyone during future sessions" (Marcus §4, modified).** Same reason as R2: it promises display that doesn't exist yet. I used Priya's S7 wording, which describes the field's purpose without promising a screen. It can gain a display sentence when #57 ships.
- **R4. Application Administrator may annotate "for consistency" with TOPIC-002 line 609 and siblings 004–006 (implicit in the contract).** Rejected. The definition is the team's words, captured by the person in the room with them. Admins have no session context and are denied session content elsewhere (`denyAdminContentAccess`). Both reviewers agree. Line 609 gets corrected, not TOPIC-007.
- **R5. Stale-write token (offered as optional by Priya Q7).** Not taken. LWW plus visible provenance is enough at this usage level, and adding it would grow the change for a case that is close to never.

---

## 8. Decisions (D) and questions that need a human (H)

**Decisions recorded for design.md:**
- **D1** Facilitator-only authorization. Admins excluded deliberately. Test asserts admin `403`.
- **D2** Snapshot model. Annotation is snapshotted in the same write as the rest of the `session_topics` row.
- **D3** First-session lock applies, same gate/code/audit as siblings.
- **D4** No annotation text in audit.
- **D5** 500 UTF-16 units after trim. Trimmed-empty → NULL. `null` body → 422.
- **D6** Provenance stored and shown on management screen only, never in session view.
- **D7** Last-writer-wins. No token.
- **D8** Confirm on clear only, never on overwrite.
- **D9** Plain text only.
- **D10** #53 closes partially delivered. Session-display ACs live in #56/#57/#62.

**Needs a human:**
- **H1. BRD FR-8.7 and admin exclusion [Marcus + VP Eng].** Marcus proposes FR-8.7 [HARD] with Application Administrators deliberately excluded. This sets an authorization rule that breaks the sibling pattern in the BRD, so it needs VP sign-off, not just mine. My recommendation is to approve as drafted.
- **H2. Snapshot timing [#175 owner].** Is the whole `session_topics` row written at session creation or when the session leaves `draft`? I'm fine with either, as long as it happens before any participant can see the session and is the same instant for every field. This change's spec wording works with both.
- **H3. Shipping a session-facing feature with no session display [product owner / VP Eng].** Both reviewers and I recommend shipping the management half now and closing #53 as partially delivered. Someone with sign-off authority should explicitly accept that, so it isn't discovered at a demo.
- **H4. Post-reveal visibility [#62 owner, with Priya].** I recommend visible and stationary through reveal and discussion. The use case says "voting phase." The #62 owner decides, and the use case is updated to match.
