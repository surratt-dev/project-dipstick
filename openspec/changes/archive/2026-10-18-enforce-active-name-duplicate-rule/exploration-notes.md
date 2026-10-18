# Exploration notes: enforce the active-name duplicate rule (#299)

Voice: Devon Calloway (Internal Champion). Explore mode only; no code or specs changed.
Revision 2: incorporates the Facilitator (Priya Nair) and BA (Marcus Delgado) reviews and the final Product Owner decisions.
Follow-up from #218 / PR #298; draft in `openspec/changes/archive/2026-10-17-bulk-restore-default-topics/tasks.md` section 9.1.

## 0. Decided (Product Owner, final)

These are closed. They are no longer open questions.

1. The client "Add anyway" button on an ACTIVE-name match is REMOVED. The rest of the hint stays (the explanation, and the archived-match actions "Show it in Archived topics" and "Add as a new topic anyway").
2. NO override of any kind. The server returns `409 TOPIC_NAME_ACTIVE` on both Add and single restore. Bulk restore keeps skip-and-report (`NAME_ACTIVE` skip reason, unchanged). `application_admin` gets no exemption.
3. Resolves BRD OQ-4 ("is the application responsible for preventing duplicate active topic names?"): yes, for active names, on all three doors.

Rulings I am making on the BA's clarification list (Devon's recommendations; consistent with the decisions above, flagged for the PO only if they disagree):

- Error code: one new code, `TOPIC_NAME_ACTIVE`, used by Add and single restore. Bulk's `NAME_ACTIVE` is a skip reason, not an error code, and stays.
- No `error.field` on the 409. The client keys off `code` and renders next to the name input.
- Audit: no new audit operation, no `audit_log` row. One structured info log line with team id, topic id (restore only) and code. Never the submitted name. (A new operation would also add to the #271 reader inventory for no security benefit.)
- Prompt-only active match on the client hint: non-blocking warning, submit allowed. The server rule is name only; duplicate prompts remain allowed.
- Name matches both an active and an archived topic: the active match governs (blocking). An archived link may be shown as information only.
- Conflicting topic choice when legacy duplicates exist: deterministic, lowest `display_order`, then lowest id.
- Admin scope: "no override" includes `application_admin` (per #208) and does not touch the admin template maintenance path, which has its own hard rule (`DEFAULT_NAME_DUPLICATE`).
- Legacy duplicates: out of scope. I propose a separate follow-up issue (not created here): "Surface existing duplicate active topic names to facilitators (read-side indicator; consider rename)". This change must not modify, hide or reject operations on existing duplicates, other than Add and restore of a colliding name. Archiving a legacy duplicate stays allowed. Historical and archived data is unaffected.

## 1. What the code does today

| Path | File | Name check? | Notes |
|---|---|---|---|
| Add `POST /teams/:teamId/topics` | `packages/backend/src/routes/topics.ts` ~978-1130 | None | Cascade 403, rate limit, 404, 409 lock, 422 validation, then BEGIN, `lockTeamTopics`, MAX(display_order)+1 (base 0), INSERT, audit `topic.custom_added` in-tx, COMMIT. Timing floor on handled exits; thrown path rethrows with no floor. |
| Single restore `POST .../:topicId/restore` | same file ~1569-1715 | None, by explicit spec | Pre-lock pre-checks 404 TOPIC_NOT_FOUND / 422 TOPIC_ALREADY_ACTIVE, then lock, MAX+1 (base 1), UPDATE guarded by `status='archived'`, audit `topic.restored` in-tx. |
| Bulk restore `.../restore-defaults` | same file ~1739-1910 | Yes, skip-and-report | `planDefaultRestore` in `packages/shared/src/types/topic.ts` (~303-348) uses `normalizeTopicNameForMatch` = `trim().toLowerCase()`, reason `NAME_ACTIVE`. |
| Client hint | `packages/frontend/src/pages/addCustomTopic.ts` `findDuplicate` + `AddCustomTopicForm.tsx` ~279-325 | Hint only | Own copy of the normalizer. Matches name OR prompt, archived wins over active. Active match currently shows "Add anyway". |
| Admin template maintenance | `openspec/specs/admin-default-topic-maintenance/spec.md` | Yes, hard | `409 DEFAULT_NAME_DUPLICATE` with `conflictingTopicId`/`conflictingName`. In-repo precedent for reject. |

Facts that matter:
- No DB uniqueness on name (only the `display_order` partial unique). A DB index cannot express JS `trim().toLowerCase()` without drift, so the rule lives in app code under the per-team advisory lock, which already serializes Add, restore, bulk restore and remove.
- No rename endpoint, so a topic's name is immutable. Reading the target's name inside the lock is stable.
- Use case 08 says "The server still does not enforce uniqueness" and `restore-topic` has a requirement and scenario ("Single restore ignores the duplicate rule") that this change reverses.
- Legacy active duplicates may already exist. The only fix today is archiving one.

## 2. Why (user need)

Two active topics with the same name confuse the vote (a facilitator has to ask the room "which one are we on?" while the clock runs) and fork the trend history, because trends are keyed by topic id. Bulk restore already treats this as a rule; Add and single restore contradict it, so the same intent behaves differently depending on the door. One rule, applied identically.

Not a ritual constraint like no-manager or simultaneous reveal; it does not touch reveal, readiness, outlier flagging or pacing (Priya confirms). Still, no flag, header, role or env toggle bypasses it. Once optional, it is configured off.

Who hits it, and when (Priya): topic management is prep work, between sessions. The likely trigger is a person tidying (restore old topic while a same-named one is active, or Add a name that already exists), not a person under live pressure. That lowers the stakes of a hard reject and means the message can afford to teach.

## 3. Behavior (requirement-ready)

Definition. Two topic names are duplicates when equal after trimming leading and trailing whitespace and ignoring upper/lower case (`normalizeTopicNameForMatch`). Nothing else is folded: "Équipe" vs "Equipe" are different; NFC vs NFD are different; internal whitespace differs ("A  B" vs "A B"). Blank normalized names are duplicates of each other. This is a duplicate-prevention rule, not a uniqueness guarantee; copy and specs must not call names "unique".

R1 Add. Reject a name that duplicates an ACTIVE topic in the same team: 409 `TOPIC_NAME_ACTIVE` with `conflictingTopicId` and `conflictingName` (stored value and casing). Archived topics and prompt text are not considered. No row inserted, no `display_order` gap, no audit success row. A whitespace-only or empty-after-trim name is 422 validation, not a blank-name conflict.

R2 Single restore. Reject restoring an archived topic whose name duplicates an ACTIVE topic: 409 `TOPIC_NAME_ACTIVE` with the same body. The topic stays archived. `TOPIC_ALREADY_ACTIVE` (422) takes precedence. A blank legacy name colliding with an active blank name is rejected the same way; `conflictingName` may be empty and the client renders "a topic with no name".

R3 Bulk restore. Unchanged: skip with `NAME_ACTIVE`; first in restore order wins within a run.

R4 No override, including admins. No parameter, header, role or setting changes R1 or R2. Extra body fields such as `force` are ignored; same 409.

R5 Locked team. The lock gate stays first: `TOPIC_CUSTOMIZATION_LOCKED` is returned and never `TOPIC_NAME_ACTIVE`, with no conflicting-topic fields in the body.

R6 Response body. Standard error envelope plus `conflictingTopicId`, `conflictingName`. Never echoes the submitted value. Echoing the stored active name is fine; the caller can already list the team's topics.

R7 Concurrency (observable). When requests whose names match after normalization arrive concurrently (Add/Add, Add/restore, restore/restore, bulk/Add), exactly one succeeds and the others get the 409 (bulk: skip with `NAME_ACTIVE`). These paths never produce two active topics with the same normalized name.

R8 Rejections consume rate-limit budget like other 4xx. They write no audit row.

Check order (to be confirmed against current code in design; the requirement must match today's behavior):
- Add: cascade 403, rate limit, 404, 409 locked, 422 validation, 409 `TOPIC_NAME_ACTIVE`.
- Restore: cascade 403, rate limit, 404 not found, 422 `TOPIC_ALREADY_ACTIVE`, 409 locked (placement relative to the 422 to be read from the current handler and stated as-is), 409 `TOPIC_NAME_ACTIVE`. The name check is in-lock; the pre-lock checks are advisory only.

## 4. Client behavior (what the facilitator sees)

Priya's point stands: the notes were strong on server mechanics and thin on the human moment. Intent, not final copy (final copy is settled in design and tried with Priya for ten minutes before ship):

Add form, ACTIVE name match:
- Hint states the block and the way out: an active topic with this name already exists; choose a different name, or use the existing topic. Quote the existing name as stored, so a case/whitespace match is legible.
- Submit is disabled while the match shows, with the reason visible inline. The server 409 is the backstop (stale list, second tab, race), not the normal path.
- No "Add anyway" control exists in the DOM for active matches. The archived-match "Add as a new topic anyway" remains and works.
- Prompt-only active match: stays a non-blocking warning, worded so it is visibly different from the blocking name message ("same name, cannot add" vs "same question, you can still add").

Add form, server 409 (stale hint): show the same message naming the conflicting topic, keep the user's input and focus, and refresh the topic list so the hint now reflects current data.

Single restore, 409: inline, persistent message at the row (not a transient toast), naming the conflicting active topic and saying nothing was changed, with the next step: "Archive the active topic first if you want to restore this one." The row stays in Archived with no reload needed. Retrying after archiving the active topic succeeds (the swap path; one spec scenario).

Shared vocabulary across Add error, restore error and the bulk skip report: "an active topic with this name already exists". Copy must not assume the reader is the team's own facilitator (admins hit it too). The locked-team message and the name-conflict message must be visibly different in wording, and every caller branches on `code`, never on bare 409 (explicit acceptance item for Add, single restore, and restoreDefaults).

Accessibility: the inline error is announced (role alert / aria-live) and the controls are keyboard operable.

## 5. Shared rule and drift

A small shared function next to `planDefaultRestore`: given active names and a candidate, return the first conflicting active topic (lowest `display_order`, then id) or null, using `normalizeTopicNameForMatch`. `planDefaultRestore` calls the same primitive. Backend reads `id, name` of the team's active topics inside the lock and compares in JS (never SQL `lower()`). The client hint imports the shared normalizer instead of its local copy (refactor only, no behavior change).

Acceptance: one parameterized table of name pairs run through Add, single restore, bulk restore and the client hint, with identical outcomes (the hint's broader prompt match aside). Pairs: "Safety"/"safety", " Safety "/"Safety", "Safety"/"Safety " (trailing), "Équipe"/"Equipe" (distinct), NFC vs NFD (distinct), empty vs empty (duplicate).

Compare against ACTIVE topics only. Two archived same-named defaults restored one after another: the second is rejected.

## 6. What could go wrong

- Races / unlocked writers. Any writer that creates or activates team topics without `lockTeamTopics` defeats the rule. Deliverable of the change: a short inventory of every such writer (Add, restore, bulk restore, assign-defaults for zero-topic teams (#200), team-creation copy, admin template routes) marked covered or exempt with a reason. Also a one-time data check that the baseline default set has no internal duplicate names.
- Check before lock is a TOCTOU hole. The name check must be in-lock.
- Timing floor. The Add reject is a handled exit and applies `applyTimingFloor` after ROLLBACK, like restore's race branch. Stated as design; not a business requirement. The Add thrown-path gap (#9.2) and TODO-GROUP6 / #305 are separate.
- Application admin and the #296 threat model: the name rule does not interact with the lock-bypass path there. One line in design.
- Two 409s on one status: callers must not treat any 409 as "locked" (see section 4).
- Stale list on Add: handled by refresh-on-409 (section 4).
- Unicode/locale: stay with the recorded decision (no locale, no normalization form). The server is exactly as weak as the hint; acceptable for a duplicate rule.
- Legacy duplicates: archiving one and later restoring it is blocked by the other. Correct, but surprising; the follow-up issue (section 0) addresses visibility.

## 7. Explicitly out of scope

- Rename endpoint and any cleanup tool for legacy duplicates (follow-up issue).
- Read-side indicator for existing duplicates (follow-up issue).
- Position-base difference between Add (0) and restore (1) (#9.5).
- Add thrown-path timing gap (#9.2); timing-floor measurement (#305).
- Changing bulk restore behavior.
- Scrolling to / highlighting the conflicting row via `conflictingTopicId`: nice to have, left to design, not a requirement (naming the topic in text is the requirement).

## 8. Feedback considered and not taken (or reduced)

- Facilitator: scroll/highlight conflicting row. Reduced to optional (above); text naming the topic meets the need.
- Facilitator: ship-blocking usability pass. Accepted as a ten-minute copy check, not a gate or a new task phase.
- BA: exact timing-floor wording as a requirement. Not taken; it is a design/security-review detail. Rate-limit and no-audit behavior are kept as R8.
- BA: a full precedence matrix per endpoint. Reduced to the two ordered lists in section 3, to be verified against code.
- BA: line numbers, advisory lock, `applyTimingFloor` kept out of requirements and left in design, as suggested.
- Facilitator: rename. Agreed, out of scope. Facilitator: create follow-up issue now. I propose the issue; I do not create it.

## 9. Artifacts that would change if this proceeds

- `openspec/specs/add-custom-topic/spec.md`: ADDED name-conflict requirement (409, after validation, lock first); keep "duplicate prompts are not rejected"; MODIFIED hint behavior (no "Add anyway" on active match).
- `openspec/specs/restore-topic/spec.md`: REMOVED "Single restore ignores the duplicate rule" requirement/scenario; ADDED reject, `TOPIC_ALREADY_ACTIVE` precedence, swap scenario (archive the active one, retry, succeed).
- `openspec/specs/bulk-restore-default-topics/spec.md`: reference the shared rule; behavior unchanged.
- `openspec/specs/topic-management-screen/spec.md`: MODIFIED active-name hint and restore error rendering.
- `requirements/design/REST API Contract.md` (TOPIC-003, TOPIC-005): new 409 row with code, body, precedence.
- `requirements/use cases/08 - Topic Management - Use Cases.md`: replace the "server does not enforce" note with alternate flows (duplicate on Add; duplicate on restore, including the swap path), postconditions, actors (facilitator or application admin).
- `requirements/BRD.md` OQ-4: mark resolved with the PO decision and date.
- Code: `packages/shared/src/types/topic.ts` (helper, error code, response type), `packages/backend/src/routes/topics.ts` (two handlers), `packages/frontend` (`addCustomTopic.ts`, `AddCustomTopicForm.tsx`, `TopicManagementPage.tsx`).
- Tests: real-Postgres concurrency (Add/Add, Add/restore, restore/restore, bulk/Add), the parity table, no-audit-row and no-order-gap assertions, UI tests (no "Add anyway" in DOM for active matches only; archived actions intact; 409 keeps input; restore message names the active topic), lock-vs-name 409 separation per caller, and flipping `topic-add-flag-parity.test.ts` and the existing "single restore ignores duplicate" tests.

## 10. Devon's bottom line

Fine to do, small, and it makes the three doors agree. The product calls are made. Hold the line on: one shared function, check inside the advisory lock, applies to admins too, no bypass of any kind, no new audit operation, lock check still first. The new work beyond the server rule is making the rejection humane: say which topic, say nothing changed, say what to do next. Keep it that size.
