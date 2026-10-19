## Context

Add, single restore and bulk restore are three writers into a team's active topic list. Only bulk restore compares names (`planDefaultRestore`, `normalizeTopicNameForMatch` = `trim().toLowerCase()`). The product decision (final) is that the rule applies to all three, with no override. This design makes that so with one shared function, evaluated inside the existing per-team advisory lock, and humane client behaviour. See `proposal.md` for why; `exploration-notes.md` for the full behaviour list R1-R8.

## Goals / Non-Goals

Goals: one rule, three doors, identical outcomes; no TOCTOU hole; no bypass; the facilitator is told which topic, that nothing changed, and what to do next.

Non-goals: rename, legacy-duplicate cleanup or indicators, locale/Unicode normalization, DB uniqueness, changing bulk behaviour, new audit operation.

## Verification of the open item (by reading code): lock gate versus TOPIC_ALREADY_ACTIVE ordering

Read of `packages/backend/src/routes/topics.ts` (single restore, ~1569-1715; `checkTopicExistsAndArchived` ~661-697). The exploration notes described "pre-lock pre-checks 404 / 422, then lock". That conflated two locks. The actual order today is:

1. `rejectNonCanonicalTeamId` (404, no query)
2. `checkRestoreTopicAuthorization` (403)
3. `enforceTopicWriteRateLimit` (429/503)
4. `checkWritableTeam` (404 `TEAM_NOT_FOUND`, incl. template team)
5. `checkCustomizationLockGate` (409 `TOPIC_CUSTOMIZATION_LOCKED`, audited via `writeLockDenialAudit`) -- the *customization* lock
6. `checkTopicExistsAndArchived` (404 `TOPIC_NOT_FOUND`, then 422 `TOPIC_ALREADY_ACTIVE`), a plain `db.query` before the transaction
7. `BEGIN`, `lockTeamTopics` (the *advisory* per-team lock), MAX+1, `UPDATE ... WHERE status='archived'`; zero rows updated is the in-transaction race branch that also answers 422 `TOPIC_ALREADY_ACTIVE` after ROLLBACK and timing floor.

Finding: the customization-lock 409 precedes both 404 and 422, matching the existing `restore-topic` spec ("lock, topic existence, topic status"). So R5 already holds structurally: a locked team can never receive `TOPIC_NAME_ACTIVE`, and the new check, placed in step 7, cannot disturb it. The 422 precedes the name check in the pre-lock path.

Decided ordering for single restore (the spec must match this):
cascade 403, rate limit, 404 team/template, 409 `TOPIC_CUSTOMIZATION_LOCKED`, 404 `TOPIC_NOT_FOUND`, 422 `TOPIC_ALREADY_ACTIVE`, then inside the advisory lock: re-read the target (status, name); if no longer archived, 422 `TOPIC_ALREADY_ACTIVE` (race branch, takes precedence over the name rule); then the active-name check, 409 `TOPIC_NAME_ACTIVE`; then MAX+1 and UPDATE.

Add: 403, rate limit, 404, 409 locked, 422 validation, then inside the advisory lock the name check (409 `TOPIC_NAME_ACTIVE`), then MAX+1 and INSERT. An empty or whitespace-only name never reaches the name check (it is 422).

## Decisions

### D1. One shared pure function
In `packages/shared/src/types/topic.ts` next to `planDefaultRestore`: `findActiveNameConflict(activeTopics: {id, name, displayOrder}[], candidateName): {id, name} | null`, using `normalizeTopicNameForMatch`; the first match by `displayOrder` ascending then `id` ascending. Used by the Add handler, the single-restore handler and the frontend hint, so client and server literally share one function (parity holds because the client calls it, not merely the normalizer). `planDefaultRestore` is NOT forced through the finder: it takes `activeNames: string[]` and keeps a growing seen-set (restored names join it); routing it through a one-conflict finder would need synthetic ids and be O(n*m). It stays unchanged apart from sharing `normalizeTopicNameForMatch` (already the case); parity with the finder is enforced by the name-pair table test (one exported fixture consumed by the pure-function, route-level and client legs), not by shared control flow. The frontend `addCustomTopic.ts` drops its private copy of the normalizer and calls the shared finder for the active-name part (the hint still also matches prompts and archived topics). New shared symbols (`findActiveNameConflict`, the `TOPIC_NAME_ACTIVE` code, the response type) must be added to the explicit named exports in `packages/shared/src/index.ts`; build order is shared, then backend and frontend.

### D2. Check inside the advisory lock, in JS
After `lockTeamTopics` and before the MAX read, the handler selects `id, name, display_order` of the team's active topics and calls D1. Never SQL `lower()` (cannot match JS `trim().toLowerCase()` without drift). The lock already serializes Add, restore, bulk restore and remove, which yields R7 (exactly one of concurrent same-name writers succeeds) with no new lock. A check before the lock would be a TOCTOU hole and is not used. No DB constraint is added: the rule is advisory-lock-serialized application code; a unique index cannot express it and legacy duplicates exist.

### D3. Target name read in lock; restore handler restructure
Names are immutable for team topics: the only `SET name` in the backend is `default-topic-maintenance.ts` (~317), which operates on the template team, and `checkWritableTeam` rejects the template team on the user routes. So reading the restore target's name inside the lock is stable. A future team-topic rename endpoint must take `lockTeamTopics` and apply this rule.

Restore handler change (verified against `topics.ts`: today the in-lock code does the MAX read and `UPDATE ... WHERE status='archived'` and infers "already active" from zero rows). New order inside the lock: (1) `SELECT id, name, status FROM topics WHERE id=$1 AND team_id=$2`; (2) row missing (not reachable today, topics are never hard-deleted; the pre-lock check found it) -> same ROLLBACK, floor and 422 `TOPIC_ALREADY_ACTIVE` as the race branch, noted in a code comment; status not archived -> the same 422; (3) select the team's active `id, name, display_order` and run D1; conflict -> 409; (4) MAX+1 and the UPDATE. The existing zero-row UPDATE branch is KEPT as a belt-and-braces fallback (it becomes unreachable, but removing it changes tested behaviour). The restore target is archived, so it is never in the active set and cannot match itself. `name` is `text NOT NULL` (`migrations/2_create_tables.sql`), so `conflictingName` is always a string, never null; a test asserts it.

### D4. Error shape
New code `TOPIC_NAME_ACTIVE`, `409`, in the house envelope built by `buildErrorEnvelope` (`routes/error-envelope.ts`), category `"precondition_failed"` (the category the existing coded 409s `TOPIC_LAST_ACTIVE` and `TOPIC_CUSTOMIZATION_LOCKED` use). Verified: the real builder is `buildErrorEnvelope(category, message, code?, field?)` returning `{ error: { category, code, field?, message, correlationId } }` with a closed `ErrorEnvelope.error` type, so the extra fields need a mechanism. Decision: add an optional fifth parameter `extra?: Record<string, string>` to `buildErrorEnvelope`, spread BEFORE the base keys so it can never overwrite `category`, `code`, `message` or `correlationId`, and widen the `ErrorEnvelope.error` type with an optional index of string extras (existing call sites compile and behave unchanged; a unit test pins that a call without `extra` is byte-identical to today). A local wrapper is not used, to keep one builder.
```
409 { "error": { "category": "precondition_failed", "code": "TOPIC_NAME_ACTIVE", "message": "...",
                  "conflictingTopicId": "<uuid>", "conflictingName": "Safety", "correlationId": "<uuid>" } }
```
The exact `error` key set is `category`, `code`, `message`, `correlationId`, `conflictingTopicId`, `conflictingName` (no `field`). `conflictingName` is a string, possibly empty, never null. Never echoes the submitted name. The response carries `Cache-Control: no-store` (a cacheable 409 containing a topic name would leak on shared devices or proxies). Verified: today only assign-defaults and restore-defaults (~1169, ~1744) and a few other routes set it, and Add and single restore do not, so the handlers set it on the 409 reply (tested; not changed on other responses). The response is identical in shape for every role: it is not role-dependent (see D5a).

Shared type: the `error-envelope.ts` comment says "No shared-package type: the frontend reads error.code ad hoc"; adding one is a small, deliberate convention break, limited to this error. It is an ADDITIVE export (existing frontend callers are untouched until the Add and restore handlers adopt it, so the frontend stays compiling in between), a discriminated union on `code` (`TOPIC_NAME_ACTIVE` carries `conflictingTopicId`/`conflictingName`; `TOPIC_CUSTOMIZATION_LOCKED` and the rest carry none), and frontend callers branch with an exhaustive `switch` with a `never` default, so a bare-409 branch fails type-checking. Bulk's `NAME_ACTIVE` stays a skip reason, not an error code. A blank legacy name colliding with another blank yields an empty `conflictingName`; the client renders "a topic with no name".

### D5. Handled exits, timing floor, rate limit, audit
The 409 is a handled exit, not a throw: `ROLLBACK`, then `applyTimingFloor`, then `return reply` (as restore's race branch does). In Add this means the early return sits inside the `try` BEFORE the outer `let topicId/createdAt/displayOrder` assignments, performs its own single ROLLBACK, and is never implemented as throw-and-catch (the catch also ROLLBACKs, and a thrown rollback after a handled one would mask). Deliberate deferral: the Add thrown-path timing gap (#299 9.2, TODO-GROUP6 / #305) is untouched, so an Add that errors remains timing-distinguishable from the floored 201/409 split; and the floor is asserted as "called", not measured, so the extra in-lock SELECT staying under the floor is unverified and left to #305. Both are recorded as conscious deferrals, not oversights. Rejections consume rate-limit budget like other 4xx (the limiter runs before the name check); when the limiter is unavailable the existing fail-closed 503 `TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE` is unchanged and no name-conflict answer is ever given (tested: 503, never 409). No `audit_log` row: a name conflict is a validation outcome, not an access-control event (unlike `topic.write_denied_locked`). Logging decision: no new log line and no probing-signal event for repeated `TOPIC_NAME_ACTIVE` (accepted given the per-actor rate limit; deliberate). Neither the submitted name nor the conflicting name may appear in any log line; tests assert no `audit_log` row and that no captured log payload contains either name. No new audit operation, so the #271 reader inventory is unchanged. The timing-floor test asserts that `applyTimingFloor` is called on the 409 path, not a measured latency.

### D5a. Security decision: unaudited admin read through the 409 (security review S1)
ACCEPTED, option (a). TOPIC-002 audits administrator reads of team topic configuration (`admin.topic_config_accessed`); the 409 returns a topic id and stored name to an `application_admin` for any unlocked non-template team without such a row, and acts as a name-existence oracle. Accepted because: the leakage is bounded to data the admin can read through the audited path at equal or higher fidelity; the reflected name differs from the submitted one only by case and surrounding whitespace; each probe spends the actor's rate-limit budget (burst and daily), which is the only throttle and is fail-closed. Not chosen: omitting the fields for admins (role-dependent response shape, contradicts D4/D6) and writing an audit row on the 409 (an audit write on a handled exit, touches the #271 inventory). The response is NOT role-dependent. Facilitators see no new data (the same list is readable via TOPIC-002/001). Recorded in the threat model (one line in HLA 8.1.1/8.2 at implementation: "TOPIC_NAME_ACTIVE 409 returns the conflicting active topic's id and name to application_admin unaudited; accepted, bounded by the per-actor topic-write rate limit; no reopen trigger hit").

### D6. No override
No parameter, header, role or setting alters the outcome. `application_admin` is not exempt (the #296 threat model's lock-bypass path for admins is unrelated: assign-defaults writes canonical template names into a zero-active-topic team, so it cannot collide with an active name and stays outside the rule; the name rule on Add and restore applies after the lock gate, which admins do not bypass there; admin template maintenance keeps `DEFAULT_NAME_DUPLICATE`; this change adds no carve-out and hits no reopen trigger). Unknown body fields (`force`) are ignored by the existing body handling.

### D7. Client
- `findDuplicate` new signature: returns `{ activeName?, archived?, activePromptOnly? }` (all distinct, replacing the single archived-wins `DuplicateMatch`); `activeName` comes from `findActiveNameConflict`, and an active-name match governs over an archived one.
- Active-name match blocks Submit with an inline, announced reason (`role="alert"` or `aria-live`); no "Add anyway" element exists in the DOM for an active match. The archived-match flow is unchanged, and archived wins only when no active name matches (an active name match governs; an archived link may be shown as information).
- Prompt-only active match stays a non-blocking warning with wording visibly different from the blocking one ("same question, you can still add").
- `conflictingName` is user-authored text: rendered as a React text node only, never as HTML, including inside `role="alert"` regions (tested with markup in the name).
- Server 409 `TOPIC_NAME_ACTIVE` on Add: same message naming the conflicting topic, input and focus kept, topic list refetched so the hint reflects current data.
- Single restore 409: persistent inline message at the row (not a toast) with client-owned fixed text (see the topic-management-screen spec), clearing on the next restore attempt on that row, a successful archive in the team, or reload. No Dismiss control. The row stays under Archived without reload. Implementation notes (verified against `TopicManagementPage.tsx`): `submitRestore` today shows `topicWriteErrorMessage(...)`, i.e. server text; add a `code` branch before the generic fallback producing client copy (the server message is contract text, same stance as `SERVER_FIELD_MESSAGES`). `restoreState` is a single slot, so a second row's failure replaces the first row's message (acceptable; "at the row" is singular). `submitArchive` success must reset `restoreState` (it does not today). The row message must stay visible while the confirm dialog is closed; check how `restore-error-${topicId}` is rendered relative to dialog state.
- Active-name block clears only when Name changes; editing Prompt alone does not clear it. Non-blocking warnings clear on a Name or Prompt edit.
- Submit disabled-reason precedence when the active-name block and an existing interlock (dirty reorder, dirty definition, open Remove/Restore) coincide: both conditions disable Submit and nothing is hidden. The blocking message is inline at the Name field and always visible; Submit's own disabled reason is the interlock reason when one applies, otherwise the active-name reason. Rationale: interlock reasons are actions the user can take right now to unblock themselves and are already first in the existing "first applicable reason" order, so the existing requirement stays unchanged; the name block is a field-level error that the inline message already explains, and it cannot be cleared by the interlock action, so showing it at the field loses nothing.
- All callers (Add, single restore, restoreDefaults) branch on `code`, never bare 409 (enforced by the D4 discriminated union). Lock and name-conflict messages are worded visibly differently.
- Copy shares one phrase, "an active topic with this name already exists", between the Add and restore-row messages (tests assert it by phrase, case-insensitively; the locked-team message must not contain it), and does not assume the reader belongs to the team. Final copy is tried with Priya for ten minutes before ship (not a gate).

### D8. Writer inventory (deliverable)
Bounded: a short table of the three user-facing doors (Add, single restore, bulk restore) confirming each takes `lockTeamTopics` (Remove takes the same lock, which is what makes the archive-then-restore swap safe across tabs; confirm by reading), plus a one-line note that assign-defaults (#200), team-creation default copy and admin template routes are admin/seed paths outside this rule (admin templates have their own `DEFAULT_NAME_DUPLICATE`). If reading turns up a new unguarded writer, file a separate issue; do not fix it here. Plus an automated unit test (not a one-time manual check) that the canonical baseline default set has no internal duplicate names under `findActiveNameConflict`: `copyCanonicalDefaults` bulk-INSERTs with no name check, so a baseline duplicate would silently seed legacy duplicates in every new team.

### D9. Legacy duplicates
Not modified, hidden or rejected beyond Add and restore of a colliding name. Archiving a legacy duplicate stays allowed; restoring it later is blocked by the other one (correct, if surprising). The follow-up issue covers visibility.

## Risks / Trade-offs

- Any writer that bypasses `lockTeamTopics` defeats R7: mitigated by the D8 inventory and concurrency tests.
- Two 409s share a status: callers branching on bare 409 would mislabel. Mitigated by the discriminated-union type plus a per-caller test.
- `buildErrorEnvelope` is shared by every route: the optional `extra` parameter is additive and pinned by a no-`extra` byte-equality test.
- Unicode/locale weakness (NFC vs NFD, accents, internal whitespace) is accepted and recorded as a known limitation, out of scope (look-alike names are not caught): server is exactly as weak as the old hint, and bulk restore.
- A hard reject on restore can feel stuck when a legacy duplicate exists: the message gives the next step.

## Migration Plan

No data migration. Ship server and client together. No graceful degradation is claimed for an old client: old `submitRestore` would show the server message verbatim and old Add would treat the unknown 409 as retryable (`refetchThenOfferRetry`, which 409s again). Harmless given ship-together. Rollback is reverting the change; no state to unwind.

## Open Questions

None blocking. Rulings from the exploration notes (single error code, no `field`, no audit, prompt-only stays a warning, deterministic conflicting-topic choice) stand unless the PO objects. Follow-up issue for legacy duplicates is proposed, not created.
