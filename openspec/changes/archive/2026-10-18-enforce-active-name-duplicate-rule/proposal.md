# Proposal: enforce-active-name-duplicate-rule (#299)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (revision 2) with `explore-review-ba.md` and `explore-review-facilitator.md`. Traceability: GitHub issue #299 (follow-up 9.1 from #218 / PR #298); BRD FR-8.2, FR-8.6 [HARD], BRD open question OQ-3 ("Duplicate topic names: is the application responsible for preventing duplicate active topic names within a team?"); use case `requirements/use cases/08 - Topic Management - Use Cases.md`; REST API Contract TOPIC-003, TOPIC-005; openspec specs `add-custom-topic`, `restore-topic`, `bulk-restore-default-topics`, `topic-management-screen`, `topic-customization-lock`, `topic-write-rate-limiting`, `audit-logging-operations`, `admin-default-topic-maintenance`. The openspec CLI is not installed in this environment; artifacts were written by hand in the shape of `openspec/changes/archive/2026-10-17-bulk-restore-default-topics/`.*

## Why

Three doors lead to an active topic list, and today they disagree about the same intent. Bulk restore refuses to create a second active topic with the same name (it skips and reports `NAME_ACTIVE`). Add and single restore let it happen, and the client only whispers about it with an "Add anyway" button. The same facilitator, doing the same tidy-up, gets a different answer depending on which button they pressed.

Two active topics with one name hurt the thing the ritual is for. In the room, the facilitator has to ask "which Safety are we on?" while the clock runs. In the trend view, history forks, because trends are keyed by topic id: half the team's "Safety" story lives under one id, half under another, and the sustained-negative-trend scenario I have been making the case for since the beginning gets quietly diluted.

The Product Owner has decided, as final: the rule is a rule. No override of any kind. This also answers the BRD's open question on duplicate names (it sits under OQ-3; the exploration notes cited it as OQ-4, which is the vote-visibility question): yes, the application prevents duplicate active names, on all three doors.

This is not one of the load-bearing ritual constraints (no-manager, simultaneous reveal, other-team facilitator). It touches no reveal, readiness, outlier or pacing behaviour. But my standing concern applies: once a protective rule is optional, someone configures it off. So no flag, header, role, body field or environment toggle bypasses it, and that includes `application_admin`.

Who hits it: topic management is prep work, between sessions. The likely moment is someone tidying, not someone under pressure. That means a hard reject can afford to teach: say which topic, say nothing changed, say what to do next.

## What Changes

- **Add** (`POST /api/v1/teams/:teamId/topics`): a name that duplicates an active topic in the same team is rejected `409 TOPIC_NAME_ACTIVE` (house envelope, category `precondition_failed`, `Cache-Control: no-store`), with `conflictingTopicId` and `conflictingName`. Nothing inserted, no `display_order` gap, no audit row.
- **Single restore** (`POST .../:topicId/restore`): restoring an archived topic whose name duplicates an active topic is rejected with the same `409 TOPIC_NAME_ACTIVE` body. The topic stays archived. **This reverses a deliberate #218 decision.** #218 shipped, on purpose, the requirement "single restore ignores the duplicate rule" (spec `restore-topic`, "Single restore is unchanged by the existence of bulk restore"). This change removes that requirement. Facilitators who learned the old behaviour will now see a rejection; the PR description and release notes must say so plainly.
- **Bulk restore**: behaviour unchanged (skip with `NAME_ACTIVE`). It shares the name normalizer (`normalizeTopicNameForMatch`) with the other two doors, which use the shared finder `findActiveNameConflict`; bulk keeps its own seen-set in `planDefaultRestore` (design D1), and the parity name-pair table guards against drift between the two.
- **One shared function** beside `planDefaultRestore` in `packages/shared`, using `normalizeTopicNameForMatch` (`trim().toLowerCase()`, nothing else), picks the conflicting active topic deterministically (lowest `display_order`, then lowest id). The check runs inside the existing per-team advisory lock, in application code, never SQL `lower()`.
- **Client** (full delta; the PO decided item 1 only, items 2 to 6 follow from it or are design):
  1. Remove the "Add anyway" button on an active-name match (the PO decision).
  2. Disable Submit while an active-name match shows, with the reason inline and announced (`role="alert"`/`aria-live`). An active-name block clears only when Name changes; editing Prompt alone does not clear it.
  3. Server `409 TOPIC_NAME_ACTIVE` on Add (stale list, second tab, race): show the same blocking message, keep typed input and focus, refetch the list. Necessary consequence of the server rule.
  4. Single-restore `409 TOPIC_NAME_ACTIVE`: persistent inline message at the archived row with fixed text and a stated dismissal condition (see the topic-management-screen spec). Necessary consequence of the server rule; the wording is design discretion.
  5. All callers (Add, single restore, `restoreDefaults`) branch on `code`, never on a bare 409 (the customization lock also answers 409).
  6. Refactor: `addCustomTopic.ts` imports the shared normalizer instead of its private copy; `findDuplicate` returns active-name, archived and prompt-only matches distinctly.
  Unchanged: archived-match actions ("Show it in Archived topics", "Add as a new topic anyway") and the non-blocking prompt-only warning.
- **Documents**: REST API Contract (new 409 rows), use case 08 (alternate flows replace the "server does not enforce uniqueness" note, plus a "Known limitations" line), BRD OQ-3 marked resolved, and traceability notes on BRD FR-8.6 and FR-8.2 (see below). Writer inventory is bounded: the three user-facing doors plus a one-line note on admin and seed paths.

## Requirements traceability: FR-8.6 [HARD] and FR-8.2

FR-8.6 says the default set must remain restorable at any time. After this change a single restore of a default can be refused. Bulk restore already skipped on name collision, so FR-8.6 was already only partly met by bulk; single restore now joins it. Traceability note to add in the BRD, in the style of the #218 and #216 notes: "Restorable" means restorable when no active topic has the same normalized name. The documented route past a conflict is to archive the active topic first, then restore. FR-8.6 status after this change: still partially met (unchanged in kind, wider in reach). FR-8.2 ("restore") is narrowed in the same way. Nothing is deleted or merged, and a rejected restore leaves the archive intact. This reading is proposed, pending PO confirmation (see Product Owner confirmations).

## Known limitations

- **Look-alike names are not caught.** Normalization is `trim().toLowerCase()` and nothing else. Names that differ only in internal whitespace ("Code  Quality" with two spaces) or Unicode normalization form (NFC vs NFD "Équipe") look identical on screen but are accepted as different. This is a recorded decision: it keeps all three doors and the client hint in exact agreement with bulk restore, with no surprises. It is a residual risk against the "which Safety are we on?" motivation, accepted and out of scope here. If the PO later wants internal whitespace collapsed, that is a one-function change, but the shared function, bulk restore, the client and both server doors must change together. Recorded in use case 08 as a known limitation.
- Not a uniqueness guarantee; existing duplicates are untouched (see Out of scope).

## Product Owner confirmations

The PO decided in this session: remove "Add anyway" on an active-name match; no override of any kind; 409 `TOPIC_NAME_ACTIVE` on Add and single restore; bulk keeps skipping. The two items below were put to the PO afterwards and confirmed on 2026-10-18.

1. Look-alike names (internal whitespace, NFC/NFD) are accepted as a known limitation, out of scope (BA review M2).
2. "Restorable at any time" in FR-8.6 now means "restorable once the conflicting active topic is archived" (BA review M1).

## Scope line

Per the executive review, the must-have core is: the server rule on Add and single restore, the shared function, removal of "Add anyway", the contract and use case updates, and the flipped tests. Server and client ship together (see design "Migration Plan"): a server-only release would leave "Add anyway" on a click that now hard-fails. The cut line in `tasks.md` therefore includes the client `code` branches and "Add anyway" removal (5.1 to 5.4) and their tests (6.1 to 6.4). Only the items marked [OPT] in `tasks.md` (4.4a, 5.5, 5.6, 6.5) may be cut if time slips. The follow-up issue for legacy duplicates stays proposed and unscheduled until a team actually reports the problem.

## Capabilities

### New Capabilities
None. The rule is added to existing capabilities.

### Modified Capabilities
- `add-custom-topic`: ADDED the name-conflict requirement and its position in the check order; the "duplicate prompts are not rejected" behaviour is kept.
- `restore-topic`: REMOVED "Single restore is unchanged by the existence of bulk restore" (it carries the "ignores the duplicate rule" scenario); ADDED the reject requirement, precedence against `TOPIC_ALREADY_ACTIVE` and the lock, and the archive-then-restore swap scenario.
- `bulk-restore-default-topics`: MODIFIED to reference the shared rule; observable behaviour unchanged. Adds the concurrency parity statement.
- `topic-management-screen`: MODIFIED the duplicate-hint requirement (no "Add anyway" on an active name match; blocking message; server-409 handling) and the restore error rendering.

## Impact

- Code: `packages/shared/src/types/topic.ts` (helper, error code, response type), `packages/backend/src/routes/topics.ts` (two handlers), `packages/frontend` (`addCustomTopic.ts` imports the shared normalizer; `AddCustomTopicForm.tsx`; `TopicManagementPage.tsx`).
- Tests: flip the existing "single restore ignores duplicate" tests and `topic-add-flag-parity.test.ts`; add a parameterized parity table, real-Postgres concurrency, no-audit/no-gap assertions, UI tests.
- No migration. No new audit operation (so the #271 audit-reader inventory is unaffected). No new rate-limit bucket (rejections spend budget like other 4xx).
- API: additive error code; callers must branch on `code`, never on bare 409 (the lock also answers 409). Bulk restore's response contract is byte-for-byte unchanged (`NAME_ACTIVE` skip reason, not `TOPIC_NAME_ACTIVE`); the two vocabularies are deliberately not unified.
- Audit asymmetry: lock denials write `topic.write_denied_locked` because a lock denial is an access-control event. A name conflict is a validation outcome, not an access-control event, and changes no state, so it writes no audit row. The same reasoning is why no new audit operation exists. No test asserts a log line; any log emitted must not contain the submitted name.

## Constraints preserved

- No override for anyone, `application_admin` included. Extra body fields such as `force` are ignored.
- The customization-lock gate stays ahead of the name check: a locked team gets `TOPIC_CUSTOMIZATION_LOCKED` and never learns about topic names.
- Admin template maintenance keeps its own hard rule (`DEFAULT_NAME_DUPLICATE`); untouched.
- No change to reveal, readiness, outlier flagging, pacing, or session snapshots. No change to historical or archived data.
- Not a uniqueness guarantee: copy and specs say "duplicate prevention", never "unique names".
- Terminology: "lowercased" (`toLowerCase()`), not "case-folded". "Add anyway" is the removed override on an active-name match; "Add as a new topic anyway" is the kept action on an archived match. They are different controls and must not be confused in tests or release notes.

## Out of scope

- Rename endpoint and any cleanup tool for legacy duplicates. Proposed follow-up issue (not created by this change): "Surface existing duplicate active topic names to facilitators (read-side indicator; consider rename)". Existing duplicates are not modified or hidden; archiving one stays allowed.
- Position-base difference between Add (0) and restore (1) (#299 section 9.5), Add thrown-path timing gap (9.2), timing-floor measurement (#305).
- Changing bulk restore behaviour. Scrolling to or highlighting the conflicting row (optional, design discretion).
- Look-alike name detection (internal whitespace, Unicode forms): known limitation above.
- Fixing any unguarded topic writer the inventory might turn up: file a separate issue.
- An explicit Dismiss button on the restore-row message, new concurrency test infrastructure, and measuring the timing floor (the assertion is that `applyTimingFloor` is called, not a latency).

## Review feedback disposition

Accepted from the BA review: M1 to M5; S1 (409 JSON example), S2 (restore concurrency scenarios), S3 (blank-name restore scenario), S5 (no log line required), S6 (audit rationale), S7 (wording), S4 (floor assertion is "called", not measured), bulk byte-for-byte sentence. Accepted from the executive review: bounded inventory, must-have/optional marking, cheap concurrency tests, plain statement of the #218 reversal, unscheduled follow-up.
Declined, with rationale: an explicit Dismiss control on the restore message (adds UI for no adoption gain; the message clears on the next restore attempt, a successful archive, or reload); a server-side exhaustive concurrency matrix (Add/Add and Add/restore are the must-have tests; restore/restore and restore/bulk are specified as scenarios but their tests are optional because the single existing advisory lock already serializes them); a blocking PO sign-off gate for the two proposed items above (they are surfaced in the PR for review instead).
