# BA review of exploration notes: enforce the active-name duplicate rule (#299)

Reviewer: Marcus Delgado, Senior Business Analyst
Inputs: exploration-notes.md; PO decisions (1) remove client "Add anyway" on an active-name match, (2) no override of any kind; server returns 409 on Add and single restore; bulk restore keeps skipping.

## Overall

The notes are strong on code archaeology and on the "why". They are weaker as a requirements source: most behavior is stated as recommendation or "decide in design", and several terms are used without a definition. With the PO decisions in, the open questions in section 8 are mostly closed (Q1, Q2 partly, Q6), so the notes can be rewritten as binding requirements. Items below are what still blocks a buildable requirement.

## 1. Clarifications needed (answer before specs are written)

1. **Error code name.** The notes say "suggest `TOPIC_NAME_ACTIVE`" and ask whether to reuse bulk's `NAME_ACTIVE`. These are different things (HTTP error code vs bulk skip reason). Ruling needed: one new error code, used by both Add and single restore, `TOPIC_NAME_ACTIVE`. Bulk's `NAME_ACTIVE` skip reason stays as is. Confirm.
2. **`error.field: "name"` on the Add 409 (Q3).** Not decided. Needed because the frontend needs to know where to render the message. Proposed ruling: do not add `field`; the client keys off `code`. Message is rendered next to the name input by the client for this code.
3. **Audit (Q4).** Notes recommend "no new audit operation, structured log only". "Structured log only" is not defined: which fields, which level? Proposed: no audit_log row; one structured log line at info with team id, topic id (restore) or no id (Add), and code. No submitted name in the log.
4. **Existing duplicates (Q5).** Recommend explicitly stated as out of scope and filed as a separate issue, with a requirement that enforcement does not alter or hide existing duplicate pairs. Needs PO yes/no and an issue number.
5. **What exactly is "an active name match" on the hint?** The hint matches name OR prompt, archived wins over active. With the button removed, what does an active match on the *prompt only* do? Server will not reject it (duplicate prompts allowed). So: is a prompt-only active match still a blocking hint, a non-blocking warning, or does it keep "Add anyway"? The PO decision covers "active-name match" only. Needs a ruling. Proposed: name match on active topic = blocking (submit disabled, or submit allowed but guaranteed 409; pick one, see 2.2); prompt-only active match = non-blocking warning, submit allowed.
6. **Mixed case: name matches an active topic and an archived topic.** Today "archived wins". Which message and which actions? The server will 409 regardless. Proposed: active name match takes precedence for blocking behavior; archived link may still be offered as informational ("a topic with this name is also in Archived").
7. **Which restore callers?** "Single restore" is the endpoint. Are there other UI entry points that call it (e.g. restore from an archived list row, from a detail view)? List them so each gets the error rendering.
8. **Scope of "no override of any kind".** Confirm this includes admins (notes say yes, per #208) and excludes the admin template maintenance path, which already has its own hard rule. State both in the requirement.
9. **Collision on restore: which topic is "conflicting"?** If legacy duplicates exist (two active topics with the same name), which `conflictingTopicId` is returned? Needs a deterministic rule. Proposed: lowest display_order, then lowest id.

## 2. Vague areas and what is missing

### 2.1 "Same name" is not defined in user-facing terms
The notes define it as `trim().toLowerCase()` via `normalizeTopicNameForMatch`. A requirement should state it in business language plus examples. Proposed: names are duplicates if they are equal after removing leading/trailing whitespace and ignoring upper/lower case. Accents, Unicode normalization forms and internal whitespace are NOT folded ("Équipe" and "Equipe" are different; "A  B" and "A B" are different). Say explicitly this is a duplicate rule, not a uniqueness guarantee.

### 2.2 Client behavior after removing "Add anyway" is unspecified
Removing the button leaves open: does the form block submit while the active match shows, or allow submit and show the server 409? Notes only say copy becomes "rename or choose a different name". Needs:
- Exact behavior: Submit control disabled while an active-name match is displayed (recommended; the client cannot be the authority, so the server 409 must still be handled if the hint was stale or the other tab added the topic).
- Hint copy (final text) is a requirement, not left to implementers.
- Stale hint case: user submits, server returns 409, form shows the same message naming the conflicting topic, input keeps the user's text and focus.
- The "Add as a new topic anyway" button on an ARCHIVED match remains and must still work (server accepts when no active match).

### 2.3 Single restore error rendering
"Generic fallback is not good enough: tell the user which active topic has that name" is directionally right but untestable. Proposed acceptance: the message includes the conflicting topic's name and tells the user what to do (archive or rename the active one first; note there is no rename, so "archive the active topic first" is the only available action). The archived row stays archived in the UI after the error without a page reload requirement.
Also: the notes say a locked team returns a different 409. The client must show different messages for `TOPIC_CUSTOMIZATION_LOCKED` and the new code. Make that an explicit acceptance item for each caller, not a "check each caller" to-do.

### 2.4 Check order is stated for the server, but precedence between all 4xx is not in one table
Provide a single ordered list for each endpoint so testers can build a matrix:
- Add: cascade 403, rate limit, 404, 409 locked, 422 validation, 409 name conflict.
- Restore: cascade 403, rate limit, 404 not found, 422 already active, 409 locked (confirm position; notes say lock gate is before the name check but do not place it relative to 422 TOPIC_ALREADY_ACTIVE), 409 name conflict.
Open: where does the lock gate sit relative to TOPIC_ALREADY_ACTIVE on restore today? Requirement must match current behavior; state it.

### 2.5 "Nothing changes" needs to be testable
For both rejections: no row inserted or updated, `display_order` sequence unchanged (no gap), no audit success row, topic still archived (restore). Add as acceptance conditions.

### 2.6 Concurrency is described as design, not as a requirement
Turn into observable outcomes: when two requests with names that match after normalization arrive concurrently (Add/Add, Add/restore, restore/restore, bulk/Add), exactly one succeeds and the other gets the 409 (or, for bulk, a skip with reason `NAME_ACTIVE`). Never two active topics with the same normalized name produced by these paths. Also require the notes' item: an inventory of every writer that creates or activates a team topic, with each listed as covered or exempt (with reason). That list should be a deliverable of the change, not "audit when designing".

### 2.7 Blank names
"Same here" for blank legacy names is stated as an aside. Make it a scenario: restoring an archived topic with a blank normalized name when an active blank-name topic exists returns 409; the 409 body's `conflictingName` may be empty, and the client must render a sensible message in that case ("a topic with no name"). Currently unspecified and likely to produce an empty-quote message.

### 2.8 Response envelope
Requirement should list the exact body: standard error envelope plus `conflictingTopicId` and `conflictingName`; must not echo the submitted value. For Add, the submitted name equals the conflicting name modulo case/whitespace, so clarify why echoing `conflictingName` (stored value) is acceptable and what casing the user sees (the stored casing).

### 2.9 Timing and rate limit
"Timing-indistinguishable enough" is vague. Either cite the existing floor value as the requirement ("the response is held to the same minimum duration as other handled rejections on these endpoints") or drop it from requirements and leave to security review. Rate limit: state that a rejected duplicate counts against the budget.

### 2.10 Shared rule / drift
"One shared function" is a design constraint, not a business requirement. Express the business need: bulk restore, single restore and Add produce the same duplicate decision for the same inputs. Acceptance: a single parameterized test table of name pairs run through all three paths and the client hint, with identical outcomes (except the hint's broader prompt match). Name the pairs: "Safety"/"safety", " Safety "/"Safety", "Safety"/"Safety " (trailing), "Équipe"/"Equipe" (distinct), NFC vs NFD (distinct), empty vs empty (duplicate).

## 3. Traceability and document impacts

- BRD OQ-4 can be marked resolved with the PO decision and date; the resolution text should be quoted in the change.
- Use case 08 currently states the server does not enforce uniqueness. The use case needs a new alternate flow (duplicate on add; duplicate on restore) with postconditions, not just a note edit. Include the primary actor (facilitator or application admin).
- Specs that must reverse: restore-topic "Single restore ignores the duplicate rule" scenario and its requirement; add-custom-topic gains the new requirement. Spell these out as REMOVED/MODIFIED/ADDED so nothing is left contradictory (add-custom-topic hint behavior, topic-management-screen hint).
- REST API Contract TOPIC-003/TOPIC-005: add 409 row with the new code, body, and precedence.
- A "Why" statement for the rule should cite the user need (confusing vote, forked trend history) rather than only "make the three doors agree". Per the project's trend history concern, state that archived duplicates and legacy duplicates are unaffected for historical data.

## 4. Edge cases not covered in the notes

- Whitespace-only or empty candidate name on Add: validation 422 happens first; confirm that a name that is non-empty before trimming but empty after is still 422 (not a blank-name conflict).
- Name at maximum length that differs only by trailing whitespace trimmed to the same value: duplicate.
- Restore when the active duplicate was archived by another user a moment ago (race): restore succeeds; no stale-409. Add as scenario.
- Restore when the conflicting active topic is archived in the same user flow: after archiving, retrying restore succeeds with no extra step.
- Zero-topic team recovery (#200) and "assign defaults" flow: confirm it cannot hit the new rule, or state the outcome if it can.
- Team creation copy of default topics: confirm baseline set has no internal duplicate names (a data check), since a duplicate in the baseline would break expectations for bulk restore.
- Multi-tab: user has the Add form open, another tab adds the same name; submit returns 409 and the form handles it as in 2.2.
- Accessibility: the removed button and the new inline error must be announced (role alert or aria-live) and keyboard operable. Not in the notes at all.

## 5. Suggested rewrites (requirement-ready)

**R1 Duplicate definition.** Two topic names are duplicates when they are equal after trimming leading and trailing whitespace and ignoring upper/lower case. No other normalization is applied. This is a duplicate-prevention rule, not a uniqueness guarantee.

**R2 Add.** The system SHALL reject a request to add a custom topic whose name duplicates the name of an ACTIVE topic in the same team, with HTTP 409 and error code `TOPIC_NAME_ACTIVE`, including `conflictingTopicId` and `conflictingName`. No topic is created and no audit success record is written. Archived topics are not considered. Prompt text is not considered. Validation errors (422) take precedence; a locked team returns `TOPIC_CUSTOMIZATION_LOCKED` and never `TOPIC_NAME_ACTIVE`.

**R3 Single restore.** The system SHALL reject a request to restore an archived topic whose name duplicates an ACTIVE topic in the same team, with HTTP 409, code `TOPIC_NAME_ACTIVE`, `conflictingTopicId`, `conflictingName`. The topic remains archived. `TOPIC_ALREADY_ACTIVE` (422) takes precedence.

**R4 Bulk restore.** Unchanged: a duplicate is skipped and reported with reason `NAME_ACTIVE`. Within one run, the first in restore order wins.

**R5 No override.** No request parameter, header, role, or setting bypasses R2 or R3. Application administrators are subject to the same rules.

**R6 Client.** When the entered name duplicates an active topic, the Add form SHALL show [final copy] and SHALL NOT offer a way to submit anyway. When the name matches an archived topic only, the existing "Show it in Archived topics" and "Add as a new topic anyway" actions remain. If the server returns `TOPIC_NAME_ACTIVE` (e.g. stale hint), the form shows the same message with the conflicting name and preserves the user's input.

**R7 Single restore UI.** On `TOPIC_NAME_ACTIVE` the UI shows a message naming the conflicting active topic and stating it must be archived before this one can be restored; the topic stays in the archived list.

**R8 Concurrency.** For concurrent requests that would create or activate topics with duplicate names in one team, at most one succeeds; the others receive R2/R3 rejections (or a bulk skip).

**R9 Race and audit.** Rejections write no audit_log record and consume rate-limit budget like other 4xx responses.

**R10 Legacy data.** Enforcement does not modify, hide or reject operations on existing duplicate topics other than Add and restore of names that collide (archiving an existing duplicate remains allowed).

## 6. Suggested acceptance conditions (Given/When/Then, minimum set)

1. Given an active topic "Code Quality", When a facilitator adds "  code quality ", Then 409 `TOPIC_NAME_ACTIVE` with `conflictingName` "Code Quality", no new topic, topic count unchanged.
2. Given an archived "Code Quality" only, When Add "Code Quality", Then 201.
3. Given an active topic with prompt P, When Add a new name with prompt P, Then 201 (prompt duplicates allowed).
4. Given active "Pacing" and archived "pacing", When restore archived, Then 409 with `conflictingTopicId` equal to the active one's id, archived row unchanged.
5. Given the active "Pacing" is archived afterward, When restore is retried, Then 200.
6. Given a locked team and a duplicate name, When Add or restore, Then 409 `TOPIC_CUSTOMIZATION_LOCKED`, body has no conflicting fields.
7. Given a topic already active, When restore, Then 422 `TOPIC_ALREADY_ACTIVE` even if another active topic shares its name.
8. Given an application admin, same inputs as 1 and 4, same results.
9. Given any request carrying extra body fields or headers (e.g. `force`, `allowDuplicate`), same 409.
10. Given two concurrent Adds of "X", Then exactly one 201 and one 409, and exactly one active "X".
11. Given Add concurrent with restore of an archived "X", exactly one succeeds.
12. Given bulk restore and an active topic named like an archived default, Then 200, that default skipped with `NAME_ACTIVE`, others restored (unchanged).
13. UI: typing an active name shows blocking copy, no "Add anyway" control exists in the DOM; typing an archived name shows the two existing actions; stale-hint submit shows server message and keeps input.
14. UI: single restore on 409 shows the message with the active topic name; no generic error; row remains in Archived.
15. No `audit_log` row is created by a rejected Add or restore; display_order sequence has no gap after a rejection.
16. Parameterized parity test (2.10) passes through shared rule for Add, restore, bulk.

## 7. Items to remove or demote from the requirements

- Anything under "Option B" and "Option C" in section 3 is now decided; delete from the requirements and keep only in rationale.
- Pointers to specific line numbers, `applyTimingFloor`, advisory lock, and `lockTeamTopics` belong in design, not requirements. Keep only the observable outcome.
- The Timing floor bullet and the TODO-GROUP6/#305 mention are not requirements of this change; move to risks.
- Position-base difference (#9.5) and Add thrown-path gap (#9.2): list under "explicitly out of scope" so no one folds them in.

## 8. Summary of verdict

Ready to become requirements once the following are answered: error code name, `field` yes/no, treatment of prompt-only active match, blocking vs disabled submit on the hint, final hint and restore copy, deterministic `conflictingTopicId` choice, lock-gate placement relative to `TOPIC_ALREADY_ACTIVE`, and audit/log content. Everything else can be written from sections 5 and 6 above.
