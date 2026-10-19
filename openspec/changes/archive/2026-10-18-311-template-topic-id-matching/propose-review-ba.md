# Proposal Review: Business Analyst (Marcus Delgado)

Change: 311-template-topic-id-matching. Reviewed: `proposal.md`, `specs/*/spec.md` (three deltas), plus `design.md` and `tasks.md` for context. Checked against BRD 6.4, FR-8.1, FR-8.2, FR-8.6 (and its #218/#216/#299 traceability notes), and the code path for `assign-defaults` in `packages/backend/src/routes/topics.ts`.

## Verdict

Approve with required changes. The intent is clear, the scope exclusions are unusually good, and most scenarios are testable. I found one blocking defect (the unique index collides with `assign-defaults`), two requirements an implementer cannot build unambiguously (backfill tie-break and idempotence; the rolling-deploy verification query), and a handful of vague or untestable statements. Requirements traceability (FR-8.6 status) is also missing.

## Blocking

### B1. The unique index conflicts with zero-topic `assign-defaults`

The new rule is "a team holds at most one row per template default" (unique on `team_id, template_topic_id`). But `assign-defaults` is gated on zero ACTIVE topics (`routes/topics.ts`, `SELECT count(*) ... status = 'active'`), not zero topics. A team that archived every topic still holds archived linked rows. Assign-defaults then runs the one `INSERT ... SELECT` for all active template defaults, which inserts a second row linked to the same template default and violates the unique index. The result is a 500 on the recovery path FR-8.6 depends on.

The proposal says the callers need "no edit, but each needs its own test". That is wrong for this case. Before this change the copy produced duplicate-name rows without error, so this is a regression the change introduces.

Required: the proposal must state the intended behavior. Options for the product owner or architect:
- (a) assign-defaults skips template defaults the team already holds as a linked row (any status). That conflicts with the "one statement, no second pass" rule only if skipping needs a second statement; a `WHERE NOT EXISTS` inside the same `INSERT ... SELECT` keeps it single.
- (b) assign-defaults reactivates the team's archived linked row instead of inserting.
- (c) the index is dropped. This loses the "#310 can rely on one row" rule, so I do not recommend it.

Add a scenario: "GIVEN a team whose topics are all archived and which holds linked rows for some template defaults, WHEN an administrator assigns defaults, THEN the response is 200, no unique violation occurs, and the team holds exactly one row per template default (state which: the old row or a new row), and topicCount equals ___." Also say what `topicCount` and the audit metadata report in the skip case. The same question applies to a team creation race (none expected, but state it).

## Must fix (not buildable as written)

### M1. Backfill tie-break rules are two overlapping rules with no stated precedence

The spec says "at most one team row per team and template default (the active row, else the lowest id) and a team row to at most one template row (the active template row, else the lowest id)". When a name has two template rows (one active, one archived) and the team has two same-name rows, both rules apply at once and the outcome is under-specified. Does the active team row link to the active template row, with the other team row left NULL? Or does each team row link to a different template row? The unique index only forbids the same template row twice, so both outcomes are legal.

Required: state the algorithm in one sentence, for example "rank team rows by (active first, lowest id) and template rows by (active first, lowest id); link the top team row to the top template row per (team, name); other team rows stay NULL." Add a seeded-data scenario with two same-name template rows (active plus archived) and two same-name team rows, with the expected link for each of the four rows.

### M2. Idempotence is claimed but the re-run case is not specified

The scenario "A second run changes nothing" is true only if the statement skips (team, template) pairs already linked. Consider a team holding one linked "Pulse" and one unlinked, same-name archived "Pulse". The candidate filter is `template_topic_id IS NULL`, so the unlinked sibling is a candidate, ranks first among candidates, and gets linked to the same template row. That violates the unique index or the "at most one" rule. Rolling-deploy re-runs make this realistic.

Required: add to the spec "the backfill SHALL NOT link a row to a template default that the same team already has linked", and a scenario for the linked-plus-unlinked-sibling case (expect: the unlinked sibling stays NULL, zero errors, zero rows updated).

### M3. The rolling-deploy verification query cannot be specified as written

"Returns zero rows created after the migration with a NULL link" and "the verification query returns zero rows" mean two things. Legacy unlinked rows are expected and persist forever, so a query for "NULL link on is_default rows" is never zero. The proposal does not say how "created after the migration" is determined (a `created_at` on `topics`? the migration timestamp? where is that recorded?).

Required: give the query's predicate in the spec or runbook task, name the timestamp column or other discriminator it relies on, and say what is done if the discriminator does not exist (for example, compare the unlinked count before and after the re-run, or restrict to team ids created after a recorded cutoff). If no such discriminator exists, the "verification returns zero rows" scenario must be rewritten to the achievable condition: "after the re-run, the unlinked count equals the count reported by the migration for legacy rows".

### M4. The rename notice has no testable acceptance condition

"State, in plain words" and "no wording about matching ceasing" are not testable. The tasks say tests "pin the string", but the spec does not give the string or the forbidden phrases.

Required, concrete conditions:
- The final `RENAME_NOTICE` text is recorded in the spec (or the PR) after Priya's check, and the test asserts equality with that constant.
- Test asserts the notice does not contain (case-insensitive) "stop matching", "name-based", "no longer match" or "pair".
- Reading level and length: a single paragraph, at most 3 sentences, one per fact.
- The three facts (a), (b), (c) each appear as a distinct sentence. Priya's review is a gate, not an optional offer: make it an explicit task before merge.

## Should fix (vague language, with concrete replacements)

| Where | Vague text | Replace with |
|---|---|---|
| Proposal, Why | "a rename never changes what a team sees about its own topics" | Scope it: "never changes the name, status, order or restore offer of any topic the team holds". Offers for defaults the team never held DO change (the notice says so); say that here to avoid a reader taking the first sentence as absolute. |
| Proposal, backfill | "Near-misses (case, whitespace) are counted" | Define once: `lower(btrim(name))` equal and raw name different. Say whether the near-miss count includes rows that ARE linked by another template row (I suggest: unlinked rows only) and whether archived team rows are counted (suggest: yes, all unlinked `is_default` rows). Spec and design currently use different phrasings. |
| database-migrations spec | "IF NOT EXISTS where the repo does" | Name the objects: column and index get IF NOT EXISTS; state what happens for the CHECK constraint (Postgres has no IF NOT EXISTS for it; say "drop-if-exists then add" or "guarded by a catalog lookup"). Otherwise a second `up` after a partial failure (the migration runs `--no-single-transaction`) fails. Add a scenario: partial failure after the backfill, re-run succeeds. |
| default-topic-provisioning spec | "a delete of a template row that is referenced SHALL be refused" | Name the observable result at the API/DB layer: SQLSTATE 23503 from the database. Say what the admin API does today on delete (it archives, so no API path should be able to hit this). |
| Suppression requirement | "the name the entry would restore under" | Spell out: linked archived entry uses the team row's name; unlinked entry uses the template name. The spec text for the unlinked case does not say which name the suppression test uses. |
| Suppression requirement | "(custom or default, other than the linked row)" | State the case where the active topic is a default linked to a DIFFERENT template default (team renamed its copy of A to B's name). Confirm it suppresses B. Add as a scenario; it is a plausible real case after #216 renames. |
| Unlinked legacy scenario | "every active template default T lacks is listed" | State what "lacks" means for an unlinked team: lacks = no linked row. Then say which restore action the entry's template id triggers for TOPIC-005 (the entry carries the TEMPLATE id for unlinked defaults, not a team row id). What does restore do with a template id? If today it creates a new row, say that, and say whether the new row is created linked. If it creates an unlinked row, #310 inherits an unlinked row forever; I would require it to be linked. This is not specified anywhere in the deltas. |
| "Rename is invisible" scenario | "identical to what it was before the rename" | Add the exception explicitly: only for defaults the team holds (any status). For never-held defaults the offered name changes. Without this the scenario contradicts rename-notice fact (c). |
| Proposal, Non-goals vs Impact | "`defaultTopicsNotActive` values change as above" | Name the three observable value changes in the spec: (1) custom topics stop matching, (2) linked entries carry the team's name and row id, (3) same-name active topics suppress. Give a before/after example for each in the contract doc update. |
| tasks 5.2 | "update ... if it describes name matching" | Replace with a checklist of the exact files and sentences; "if" leaves the edit unowned. |
| Scenario "Non-goals hold" | Lists tests that "pass unmodified" | That is a verification step, not a behavior. Fine to keep, but move it to tasks 6.1 and replace in the spec with a behavior: "the template write path accepts exactly the writers it accepts today". |
| Residual risk | "Accepted; mitigated by the logged count" | Put a number on acceptability: state the threshold at which the count blocks the release announcement (suggest: any non-zero count in production requires the runbook query to be reviewed and the result noted in the PR; any count above, say, 5% of default rows triggers a decision from the product owner). Otherwise "check the log" has no pass/fail. |

## Traceability gaps

1. FR-8.6 status is not addressed. BRD FR-8.6 is "partially met" with three traceability notes. The proposal changes the BRD traceability text (l.329) but does not say whether FR-8.6/FR-8.1 status changes. State explicitly: "FR-8.6 remains partially met; this change removes the rename-induced false 'missing' and false 'held' results in `defaultTopicsNotActive` and does not close the visibility gap for unlinked legacy rows." Add a matching new traceability note under FR-8.6 so the next reader can trace #311 to the requirement.
2. `requirements/entities-and-relationships.md` does not appear in Impact. If the Topic entity is documented there, the new relationship (Topic copied-from Template Topic) must be added; if it is deliberately omitted because the column is internal, say so.
3. BRD 6.4 (copy-on-create) is cited but the proposal does not say whether its text changes. Say "no change to the requirement text; the link is identity only", matching the style of the #218/#299 notes.
4. The Issue #311 acceptance amendment (#3, "any linked default") is a scope reduction relative to the issue as filed. It should be called out as a decision for the product owner, not recorded as a housekeeping edit in the Impact list. Who approved narrowing it?
5. The proposal quotes the user outcome in the persona-neutral form ("I care that a rename never changes what a team sees"). Add the named user and the concrete user-visible symptom the fix removes: "a facilitator renames nothing and sees a baseline topic offered that the team already holds (or a held topic missing) after an admin renames a default." Without that, there is no stated user need to trace back to.

## Edge cases to cover (the "but what happens when" list)

- Team that archived all topics, then assign-defaults (B1).
- Linked row, team renames its copy to the same name as an active custom topic's name: blocked by #299 on rename already? Confirm and cite; if not blocked, state expected offer behavior.
- Template default restored from archived (active again) after being renamed while archived: team rows linked to it are unaffected; the offer uses the team's own name. Add as a scenario, since it is the exact #216 sequence.
- Two administrators rename two defaults to each other's old names in one edit: the suppression and link behavior is name-independent, so this should pass; add one scenario to prove the point of the change.
- Backfill on a deployment with zero teams or an empty template (the zero-session / empty states I care about): migration must succeed and log zero counts. Add a scenario.
- Concurrent team creation during migration (not just old instances): state whether the migration takes a lock on `topics` and for how long, since the unique index build and CHECK validation scan the table. Give an expected duration bound on the largest environment or say "unknown, measured in staging before release".
- Team deletion: does any path delete a team's topic rows (for example team removal)? RESTRICT applies to the template side only, but confirm no cascade path removes a linked team row's template row. A one-line statement suffices.

## What is good (keep)

- Explicit "link means identity, not propagation" and the BRD 6.4 guard. This is the right protection against scope creep.
- Scope Exclusions list, including the "stop if the diff touches ..." instruction. Easy to audit.
- No new API field, stated as a non-goal so nobody adds one for convenience.
- Counts-only logging with no identifiers, and a defined runbook query for the admin.
- Reuse of `normalizeTopicNameForMatch` for suppression so it cannot drift from #299.
- The correction to the exploration (Topic Management does not read the field) is clear and traceable to a spec requirement.

## Required changes checklist

1. Resolve B1 and add the scenario (assign-defaults with archived linked rows).
2. Add the single-sentence backfill algorithm and the four-row scenario (M1).
3. Add "never link to a template default the team already has linked" and the sibling scenario (M2).
4. Define the verification query and its discriminator, or rewrite the scenario (M3).
5. Record the notice text, forbidden phrases and Priya's sign-off as a gate (M4).
6. Specify what restore does with a template id for an unlinked entry, and whether the new row is linked.
7. Add the FR-8.6 / BRD 6.4 traceability statements and decide on the entities document.
8. Replace the vague phrases in the table above.
