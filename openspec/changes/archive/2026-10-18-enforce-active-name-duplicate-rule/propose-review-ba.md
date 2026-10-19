# Proposal Review (Business Analyst): enforce-active-name-duplicate-rule (#299)

Reviewer: Marcus Delgado, Senior Business Analyst
Reviewed: `proposal.md` and the four delta specs (`add-custom-topic`, `restore-topic`, `bulk-restore-default-topics`, `topic-management-screen`), against BRD FR-8.2 / FR-8.6 / OQ-3, use case 08, and the #299 acceptance.

## Verdict

Approve with required clarifications (5 must-fix, 7 should-fix). The proposal is unusually specific. Most capabilities already carry testable WHEN/THEN scenarios, the check order is stated, and the "no override for anyone" constraint is explicit. The gaps are a handful of vague phrases, two internal inconsistencies, one requirements-traceability gap (FR-8.6), and one residual-risk decision that the PO should see before build.

## Acceptance coverage (issue #299)

| Acceptance item | Where it is covered | Assessment |
|---|---|---|
| Server rejects a duplicate normalized name on Add | add-custom-topic ADDED requirement, 7 scenarios | Explicit |
| Server rejects a duplicate normalized name on single restore | restore-topic ADDED requirement, 5 scenarios, plus the REMOVED "unchanged" requirement | Explicit |
| Client hint unchanged, except "Add anyway" removed on an active-name match | topic-management-screen MODIFIED requirement | Explicit, but see M3 (the proposal says "unchanged"; the spec changes more than that) |
| Bulk restore unchanged | bulk-restore spec, parity scenarios | Explicit |

## Must fix

**M1. FR-8.6 [HARD] traceability is silent about an impact it has.**
FR-8.6 says the default set "must remain ... restorable ... at any time". After this change a single restore of a default can be refused. The proposal cites FR-8.6 but never says what it does to it. Bulk restore already skips on name collision, so FR-8.6 is already only partly met. Single restore now joins it. The swap path (archive the active topic, then restore) is the mitigation.
Required condition: add a traceability note to FR-8.6, in the style of the #218 and #216 notes, with this text in substance. "Restorable" means restorable when no active topic has the same normalized name, and the documented route past a conflict is to archive the active topic first. State FR-8.6's status after this change (still partially met, or met). Also note that FR-8.2 ("restore") is narrowed in the same way. The Documents list in the proposal names OQ-3 but not FR-8.6 or FR-8.2.

**M2. Visually identical duplicates are still allowed, and the proposal's own motivation is "which Safety are we on?".**
Normalization is `trim().toLowerCase()` only. "Code  Quality" (two spaces), "Équipe" in NFC and NFD, and similar pairs all look identical on screen and are accepted by design. The scenarios record this as a decision for NFC/NFD and diacritics. For internal whitespace and NFC/NFD, though, the user cannot tell the two apart, so the facilitator is back in the room asking which one is which. I accept the "bulk parity, no surprises" rationale. It should be an explicit PO-visible residual risk, not only a test fixture.
Required condition: add a "Known limitations" line to the proposal and to use case 08 stating that look-alike names (internal whitespace, Unicode normalization form) are not caught. Add a one-line PO confirmation to the sign-off. If the PO would rather collapse internal whitespace, that is a one-function change, but bulk restore, the client and all three doors must change together.

**M3. The proposal says "client hint unchanged", but the client change is larger than that.**
The Capabilities and What Changes text implies only "Add anyway" is removed. The spec also adds the following:
- A disabled Submit with an `aria-live` reason.
- A server-409 path that keeps input and focus and refetches the list.
- A new persistent row-level message for restore.
- A changed clause about Submit staying disabled "until Name is edited".

Required condition: re-state the client delta in the proposal as a numbered list, so the PO's "removal only" decision is not read as the whole client change. Mark which items go beyond the PO's decision (the 409 handling and restore message are necessary consequences of the server rule; the rest is design).

**M4. Contradiction on when Submit re-enables.**
One sentence says "Editing Name or Prompt SHALL dismiss the warning and re-enable Submit, whichever field matched". Another says the blocking message keeps Submit disabled "until Name is edited". If Prompt alone is edited while an active name match is showing, the two sentences disagree.
Required condition: state it once. Proposed wording: an active-name block clears only when Name changes. Editing Prompt does not clear it. Add a scenario: "Editing only Prompt leaves Submit disabled".

**M5. "Persistent inline message" and "visibly different wording" have no stop condition or fixed text.**
The restore-row message is "persistent" but nothing says when it goes away. "Visibly different from the locked-team message" cannot be tested without fixed copy.
Required condition:
- The restore-row message clears on any of these: the next restore attempt on that row, a successful archive of the conflicting topic, a page reload, or an explicit dismiss. Pick one set and write it down.
- Put the exact message strings in the spec for (a) Add blocking, (b) restore-row conflict, (c) locked team. Assert that (a) and (b) share the phrase "an active topic with this name already exists" and (c) does not.

## Should fix

**S1. Response body is described in prose only.** Add one JSON example to the spec and to REST API Contract TOPIC-003/005:
```
409 { "error": { "code": "TOPIC_NAME_ACTIVE", "message": "...", "conflictingTopicId": "<uuid>", "conflictingName": "Safety" } }
```
Confirm whether the two extra fields sit inside `error` or beside it (the spec says "standard error envelope plus"; "plus" is ambiguous). State that `conflictingName` is a string, possibly empty, never null. A scenario should assert the exact key set.

**S2. Concurrency scenarios are missing two cases.**
Present: Add vs Add, Restore vs Add, bulk vs Add. Missing:
- Two single restores of two same-named archived topics, run concurrently. Expected: one 200, one `TOPIC_NAME_ACTIVE`.
- Single restore vs bulk restore of the same-named default.
- Whether Archive (Remove) takes the same per-team advisory lock. If it does not, the "swap" flow races with itself in a second tab. State it.

**S3. "Possibly empty for a legacy blank name" is ambiguous.** Spell out the scenario: restore of a blank-named archived topic while a blank-named active topic exists gives `TOPIC_NAME_ACTIVE` with `conflictingName: ""`, and the UI says "a topic with no name". The parity table includes empty/empty, so add the restore scenario too.

**S4. Timing floor wording is not testable.** "A constant minimum response-time floor ... at the `TOPIC_NAME_ACTIVE` rejection" gives no number and #305 (measurement) is out of scope. Either reference the existing floor constant by name and assert it is applied, or say that the assertion is "`applyTimingFloor` was called" and not a latency measurement. Do not let it read as a measured guarantee.

**S5. The optional log line is a MAY with no owner.** "A structured log line ... is permitted" is neither required nor forbidden for tests. Decide: required (with fields `teamId`, `code`, no name), or not specified. Pick one so a reviewer can pass or fail it.

**S6. Audit asymmetry should be justified in one sentence.** Lock denials write `topic.write_denied_locked`; name conflicts write nothing. That is a reasonable call (a conflict is not an access-control event), but a reader will ask. Add the rationale to the proposal's audit line (the #271 inventory note covers only the "no new operation" half).

**S7. Terminology.** The screen spec says "case-folded" but defines it as `toLowerCase()`. Case folding and lowercasing differ ("ß"). Use "lowercased" everywhere. Also, "Add anyway" versus "Add as a new topic anyway" (archived match, kept) are easy to confuse in tests and release notes. Name both explicitly in the Out of scope / Constraints sections.

## Items checked and fine

- Check order is explicit for both endpoints: role, rate limit, team, template, lock, then body or topic existence/status, then name. A locked team never learns names, and a scenario covers it.
- Already-active (`422`) beats the name rule (legacy duplicates). Good, and tested.
- No override for `application_admin`; ignored `force` field is tested on both doors.
- Archived and prompt-only matches are correctly left out of the server rule.
- Existing legacy duplicates are untouched, and archiving one stays allowed. Follow-up issue is proposed, not created. Appropriate for scope.
- Preserves ritual constraints: no reveal, readiness, outlier or pacing impact. No Marcus-level concern about the load-bearing mechanics.
- Topic history preservation: nothing is deleted or merged. Rejecting a restore keeps the archive intact, which is the point of the swap path.

## Concrete conditions to add per capability (summary)

1. **add-custom-topic**: add the exact JSON body (S1); add the Prompt-only edit scenario on the client (M4); add a "look-alike names accepted" scenario for double-space and NFC/NFD (already partly present, keep it explicit and link it to the limitation in M2).
2. **restore-topic**: add the blank-name conflict scenario (S3); add restore-vs-restore and restore-vs-bulk concurrency (S2); add the FR-8.6/FR-8.2 note (M1).
3. **bulk-restore-default-topics**: no behavior change. Add a sentence that the response contract is byte-for-byte unchanged (`NAME_ACTIVE`, not `TOPIC_NAME_ACTIVE`) so the two codes are not unified by accident.
4. **topic-management-screen**: fix the Submit re-enable rule (M4); fixed message strings and dismissal conditions (M5); numbered client delta (M3).
5. **Docs**: also update FR-8.6 and FR-8.2 traceability in the BRD (M1), and add a "known limitations" line to use case 08 (M2).

## Open questions for the PO (via Devon)

1. Confirm that look-alike names (internal whitespace, NFC/NFD) are accepted as a residual risk (M2).
2. Confirm that "restorable at any time" in FR-8.6 now means "restorable once the conflicting active topic is archived" (M1).
