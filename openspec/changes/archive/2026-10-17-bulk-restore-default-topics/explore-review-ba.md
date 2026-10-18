# BA review of exploration notes: bulk-restore-default-topics (#218)

Reviewer: Marcus Delgado, Senior Business Analyst
Question asked: are the ideas specific enough to become requirements, and where are they hand-wavy?

## Verdict

The notes are strong on intent, constraints, and risks. They are weaker on testable behavior. Most of Section 5 is "watch out for X" rather than "the system shall Y". Four items cannot enter a proposal as written: the duplicate rule, the audit shape, the stale-preview behavior, and the control visibility rule. Each of those is currently "I lean" or "either is fine". Below, each is marked BLOCKER (proposal cannot be written without a decision), CLARIFY (buildable once a sentence is added), or OK.

## 1. Clarifications needed

### 1.1 Duplicate handling after zero-topic recovery (5.2) - BLOCKER
The notes call this "the sharpest edge" and offer three options without choosing. A proposal needs one. It also raises the question of how "same name" is defined: case-insensitive? trimmed? Customs renamed to a default's name? Defaults renamed by the team (is a renamed default still "default"? the notes say `is_default` is the only marker)?

Suggested rule (for the team to ratify): bulk restore skips any archived default whose name matches (trimmed, case-insensitive, same comparison as the existing add-topic uniqueness check, if one exists) an active topic on the team. Skipped topics stay archived and are listed in the response as `skipped: [{topicId, name, reason: "NAME_ACTIVE"}]`.
Acceptance conditions:
- Given archived default "Code Quality" and an active topic "code quality ", when bulk restore runs, then "Code Quality" is not restored and appears in `skipped` with reason `NAME_ACTIVE`.
- Given two archived defaults sharing one name, then at most one is restored (specify which: lowest prior display_order).
- Whether single restore enforces the same rule today must be stated. If single restore does not, the "bulk equals N single restores" principle (Section 7) is violated by this rule, and the notes must say so explicitly.

### 1.2 "Provably the same operation as N single restores" (Section 7) - CLARIFY
This is the guiding principle but not testable as stated. Rewrite as an observable condition: for any starting state, bulk restore yields the same final rows (status, display_order, restored_at/by) as restoring the same topics one at a time in the order defined in 1.3. Suggested test: a property or table test comparing the two paths.

### 1.3 Batch ordering key (4.3) - CLARIFY
"Order by the restored rows' own last display_order (then id)" is clear, but needs: ties are possible only if display_order was reused across archived rows (partial unique index allows this). State that `id` ascending breaks ties, and state the id type (uuid ordering is arbitrary but deterministic; is that acceptable?). Acceptance: given archived defaults with prior orders 4, 2, 5, the new positions are base+1 for the order-2 topic, base+2 for order-4, base+3 for order-5.

### 1.4 Position base (4.4) - CLARIFY
"Pick one base and say it matches restore" is deferred to design. Decide now: match single restore, `COALESCE(MAX(active),0)+1`. Acceptance: with zero active topics, the first restored topic gets display_order 1. Note this leaves a known inconsistency with Add (starts at 0); log it as a known, accepted discrepancy rather than leaving it implicit.

### 1.5 Audit shape (5.5) - BLOCKER (small)
"I lean one row" with a trade-off listed. Needs a decision plus a contract. Suggested: one `topic.defaults_restored` row, metadata `{restored: [{topic_id, name, new_position}], skipped: [...]}`, written in the same transaction. The empty case writes nothing (already stated, good). Acceptance: after restoring 3 topics, exactly 1 audit row exists for the request; each restored topic row has restored_at and restored_by set to the actor; no `topic.restored` rows are created by the bulk path. Also state what existing consumers of `topic.restored` (history view, reports) will see for bulk-restored topics; the notes require provenance per row, which is the right call, but confirm the history view reads the columns, not the audit rows.

### 1.6 Response contract (Section 6, "lean yes") - CLARIFY
Make it a requirement. Suggested 200 body: `{ restored: [{topicId, name, displayOrder}], skipped: [...] }`. Empty case: `restored: []`, `skipped: []`. State the status code for the empty case (200, per the issue AC) and that no 4xx/409 is returned.

### 1.7 Stale preview (5.10) - BLOCKER (small)
"I lean first option" is a decision in waiting. Adopt it: the server computes the set inside the lock, ignores any client-supplied id list, and the result view reports actual outcomes. Acceptance: if a topic is restored singly between dialog open and confirm, bulk returns 200 with that topic absent from `restored`, no error. Also confirm the request body is empty and any body fields are ignored or rejected (pick one; "no body options that widen scope" in the constraints table implies reject unknown fields with 400 or ignore. State which).

### 1.8 Control visibility (5.9, Section 6) - CLARIFY
The notes say both "visible but disabled with reason" and "hidden otherwise" and "either is fine". Requirements cannot say either is fine. Suggested rule: the control is shown whenever the team has at least one archived default; hidden when none (no disabled-with-reason state, since "nothing to restore" is not an actionable reason). It is disabled with an explicit reason while a definition draft is dirty or another topic dialog is open. Note: the client's archived count may be stale, so the 200-empty path must still render "Nothing to restore" rather than success.

### 1.9 Definition of "archived default" - CLARIFY
Scope is `status = 'archived' AND is_default = true`. Confirm what happens to a default the team renamed or redefined before archiving: it returns with its edited name/definition (restoring the original row), not canonical text. The UI copy must not promise "canonical wording". This matters for the FR-8.6 traceability claim (see 1.12).

### 1.10 Concurrency (5.3) - CLARIFY
"Shrink the batch, not fail it" is good. Add the acceptance condition: two concurrent bulk requests on the same team yield no duplicate active rows, no display_order collision, and the second returns 200 with an empty or reduced `restored`. Also state whether a concurrent single Add during bulk can produce a unique-index violation and how that surfaces (should be serialized by `lockTeamTopics`; say so).

### 1.11 Authorization and error cascade (Section 2) - OK, add one table
The cascade is well specified in prose. For the proposal, convert to an ordered list with the status and code at each step so each is a test case: identity 401/403 -> role 403 (NOT_A_FACILITATOR / FACILITATOR_IS_TEAM_MEMBER) -> non-canonical teamId 404 -> limiter 429/503 -> writable-team 404 (TEAM_NOT_FOUND, template included, byte-identical) -> customization lock 409 TOPIC_CUSTOMIZATION_LOCKED -> transaction. The single-restore code comment is stale (notes 3); the proposal must cite the live order, not the comment. There is no topic-existence or status 422 step in bulk; say so.

### 1.12 FR-8.6 traceability (Section 6) - CLARIFY
Good instinct to say "partial". Make it a deliverable: the proposal states which clauses of FR-8.6 are advanced ("restorable" for archived default rows only) and which remain open ("visible" for teams whose defaults were edited, deleted, or never existed). This is the traceability link I care about; do not let it be implied.

## 2. Vague areas

| Location | Phrase | Problem | Fix |
|---|---|---|---|
| 1 | "make the guardrail promise actually true in practice" | Motivation, not measurable | Add a success measure: restoring N archived defaults requires one confirmation and one request, regardless of N (max 12 today). |
| 1 | "Say that plainly in the UI copy" | No copy specified | Provide draft copy for button, dialog title, dialog body, empty result, and result list. Require the dialog to name what is not changed (custom topics, order, annotations). |
| 2 | "Same authorization helper semantics" | Fine for engineers, not for a requirement | State outcome per role: app admin (any team), facilitator non-member: allowed; facilitator who is a member: 403 FACILITATOR_IS_TEAM_MEMBER; non-facilitator member: 403 NOT_A_FACILITATOR. Verify these four against TOPIC-005 and #208. |
| 2 | "Keep the new handler inside routes/topics.ts" | Design constraint, listed as ritual constraint | Restate as testable: the existing structural test (limiter not imported by session code) still passes. |
| 5.4 | "Quiet" empty case | Undefined | 200, `restored: []`, no audit row, no state change, one limiter unit consumed. Done in notes; just promote to a requirement. |
| 5.6 | "Do not change numbers" | Negative requirement | Acceptance: TOPIC_WRITE_LIMITS values unchanged in the diff. Also say whether bulk shares the existing counter (the AC says one unit; confirm the same actor bucket, not a separate one). |
| 5.7 | "Bounded, acceptable" | Assertion | State the bound: at most the number of archived defaults on the team, and that the handler issues a bounded number of statements independent of N (single UPDATE). |
| 5.8 | "Copy TOPIC-005's discipline, including known-gap thrown path" | Unspecified by reference | List the timing and enumeration behaviors as individual acceptance items, and name the known gap so the proposal does not silently inherit or fix it. |
| 5.9 | "No toast confetti, quiet control" | Subjective | Replace with: after success, show a result list of restored topics with new positions; no other celebratory UI. |
| 5.12 | "Must not claim anything new about trends" | Negative | Acceptance: no trend-related copy or behavior in the dialog or response. |
| 6 | "Check route ordering" | Left as a to-do | Requirement: POST `/topics/restore-defaults` resolves to the new handler, and `/topics/order` and `/topics/:topicId/restore` still resolve to theirs. Add a routing test. |
| 7 | "Duplicate rule from 5.2" | In scope but undefined | See 1.1. |

## 3. Items to carry as requirements (suggested wording)

1. The system SHALL provide `POST /api/v1/teams/:teamId/topics/restore-defaults` that restores all archived default topics of the team in one transaction.
2. The operation SHALL reactivate the original rows (no inserts), set `restored_at` and `restored_by` per row, and SHALL NOT modify custom topics, names, definitions, annotations, or the order of active topics.
3. Restored topics SHALL be appended after the highest active display_order, ordered by prior display_order then id.
4. The operation SHALL skip archived defaults whose name matches an active topic and report them as skipped. (pending 1.1)
5. The operation SHALL apply the same authorization, rate limiting, writable-team, and customization-lock checks, in the same order and with the same codes, as single restore, and SHALL consume one rate-limit unit.
6. With nothing to restore the operation SHALL return 200 with empty lists and SHALL NOT write an audit row.
7. A successful non-empty operation SHALL write exactly one `topic.defaults_restored` audit row in the same transaction. (pending 1.5)
8. The UI control SHALL be unavailable while a definition draft is dirty or another topic dialog is open, and the confirmation SHALL list the topics expected to return and state they will be added to the end.
9. The operation SHALL be all-or-nothing; a failure leaves every topic unchanged.

## 4. Out of scope - confirm listed explicitly in proposal
Reset-to-canonical-order, restoring custom topics, template edits, limiter changes, configuration toggles, trend treatment. Add: per-topic selection ("restore these three of the five") is also out of scope; the notes imply it but do not say it, and it will be requested.

## 5. Edge cases not yet covered (Marcus's usual list)
- Team with archived defaults and a customization lock: unreachable per notes, but confirm a team that is locked and has archived defaults is impossible, or the 409 is still correct.
- All 12 defaults archived and zero active topics: the result is a valid session set; confirm and test (relates to #200 zero-topic recovery overlap, and the empty-state UI offering two buttons: state which is primary and the difference in copy).
- A team with a draft session or session in progress: single restore's behavior is the precedent; state whether bulk is blocked, allowed, or irrelevant (FR-2.7 says order in effect at room open is the session's order, so a mid-session restore could matter).
- Restoring when the number of active topics would exceed any existing maximum topic count, if one exists.
- Multi-tab / two facilitators: covered by 1.10.
- Accessibility of the dialog list and result announcement (focus, live region) is not mentioned.

## 6. Priority order for resolving
1. Duplicate rule (1.1)
2. Audit shape (1.5) and response contract (1.6)
3. Stale-preview and body handling (1.7)
4. Control visibility (1.8)
5. Remaining CLARIFY items, which are wording only

Once 1.1 through 1.8 are decided, the notes are sufficient to write the proposal and specs without further stakeholder interviews.
