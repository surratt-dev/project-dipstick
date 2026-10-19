# BA review: 311 exploration notes (Marcus Delgado)

Verdict: the notes are strong on mechanism and risk, and mostly specific enough to carry into a proposal. The weak spots are (a) behavior changes that the notes call "accepted side effects" without a testable statement, (b) several open questions that are decisions, not data questions, and (c) two traceability gaps (which requirement each change serves, and what the user actually sees). Items below are ordered by how much they would hurt a proposal.

## 1. Clarifications needed

1. **What does "pairing" mean to a user?** The issue and the notes use "Pairing", "restore pairing" and "join" interchangeably, and the notes themselves say the issue blurs two things (own-row reactivation vs. template-join). The proposal must define one term: "A team default row is *linked* to a template default when its `template_topic_id` equals that template row's id." Use "linked/unlinked" everywhere, drop "pairing".
2. **Who is the consumer of `defaultTopicsNotActive`?** The notes never state what the facilitator/admin sees or does with it (restore offers, admin UI). Acceptance must be phrased in user-visible terms, not only SQL terms. Please name the screen/endpoint and the sentence the user reads.
2a. **Issue acceptance #3 ("#310 can read the template row for any default a team holds") conflicts with decision 2(a)/item 7.** Unlinked legacy rows cannot satisfy it. The notes resolve this as a hand-off constraint; the proposal must restate acceptance as "for any *linked* default", and get the issue text amended so the change is not judged against a criterion it cannot meet.
3. **Which requirement is this serving?** Devon's lens cites the "baseline is visible and easy to restore" promise and BRD 6.4 (copy-on-create). The proposal should cite BRD/use-case IDs (TOPIC-002, TOPIC-005, the Recover Zero-Topic Team use case) so scope disputes can be traced.
4. **Behavior change vs. "no visible change on day one".** The notes claim the migration reproduces today's list "except where today's join mis-links a custom topic". That is a visible change (decision 3). It needs to be stated once, as a requirement, not as an exception to a safety property.

## 2. Vague areas and suggested rewrites

| Vague text in notes | Problem | Suggested rewrite (testable) |
|---|---|---|
| "keep an invariant that template_topic_id IS NOT NULL implies is_default = true (CHECK candidate)" | "Candidate" is not a requirement. | "A team topic row has a non-null `template_topic_id` only if `is_default = true`. A template-team row never has one. The database rejects violations." (Decide CHECK vs test; see Q-A.) |
| "link deterministically (prefer active, then lowest id) and leave the rest NULL" | Good, but unscoped. | "For each team and each template default, at most one team row is linked. If several `is_default` rows of that team share the template default's name, the active one is linked, else the lowest id; the others stay unlinked." |
| "tolerate that, not 500" (restore offered while active custom topic has same name) | Behavior undefined beyond "not 500". | "When a team has an active custom topic named X and the default X is unlinked-or-not-held, the default appears in `defaultTopicsNotActive`. Restoring it returns the existing duplicate-name rejection (#299) with its standard error code and message; no state changes." Name the status code. Also decide whether the UI should still offer it (Q-C). |
| "Rename of a template default must not change any team's defaultTopicsNotActive" | Lacks the exact before/after. | "Given a team created before an admin renames default D to D', the team's `defaultTopicsNotActive` is identical before and after the rename; it neither lists D' as missing (while the team holds D) nor lists D." Cover active, archived-by-team, and team-renamed variants (team renames its own copy, then admin renames template). |
| "archived template defaults drop out of the list, same as today. Confirm that is wanted" | Unresolved but answerable. | See Q-D: confirm; write as a scenario. |
| "migration-time report (count and team ids logged...or via a read-only query documented in the runbook)" | "Or" leaves two deliverables. | Pick one: "The migration logs the count of unlinked `is_default` rows; the runbook provides a read-only query listing team id, row id, name." Team ids in logs may be a data-access concern (persona defers to VP Eng); counts in logs, ids via query is safer. |
| "Rolling-deploy window ... rerun the backfill or document it" | Either/or. | Require: backfill statement is idempotent (only touches rows where `template_topic_id IS NULL`), and deployment.md lists the re-run step after old instances drain, with a verification query returning zero expected rows created post-migration. |
| "Fixture churn... keep mechanical" | Not verifiable. | Drop from requirements; it is an implementation concern. Keep only "no existing test is deleted or weakened". |
| "the number is known rather than discovered" | Intent, not criterion. | Tie to the open question on counts: the proposal states the measured count per environment or states it is unknown and blocks release on measuring it. |

## 3. Suggested acceptance conditions (to replace/extend the issue's three)

Scenario form so each maps to a test.

1. **Rename is invisible to existing teams.** Given team T holds linked default "Pulse"; when an admin renames the template default to "Heartbeat"; then T's `defaultTopicsNotActive` is unchanged and T's own topic name remains "Pulse".
2. **New teams are linked on both paths.** Given team creation, and given zero-topic recovery `assign-defaults`, every copied row has `template_topic_id` equal to the id of the template row it was copied from, and no row of a custom topic has one. (Two separate tests, one SQL function.)
3. **Copy stays atomic.** `copyCanonicalDefaults` issues exactly one `INSERT ... SELECT` that includes `template_topic_id`; a concurrent admin edit yields a complete before-set or after-set (existing E8 test extended).
4. **Backfill, seeded.** On a seeded dataset containing: matched default, renamed-template unmatched default, custom topic with default's name, two same-name default rows (active + archived; two archived), default whose template row is archived, already-linked row: the migration links exactly the expected rows and no others; running it twice changes nothing.
5. **Custom topics are never linked**, and a custom topic named like a default no longer hides that default from `defaultTopicsNotActive` (documented behavior change from #197).
6. **Unlinked defaults.** An `is_default` row with no link is not treated as holding any template default; the migration reports their count; the offered-duplicate case is rejected on restore by the #299 rule.
7. **Reversible.** Down then up on a seeded database restores the schema; down loses no user data.
8. **Non-goals hold.** No change to first-session lock, zero-topic exception, session snapshot, `planDefaultRestore`, template writers allowlist, or any API response shape. Verified by existing structural tests passing unmodified.
9. **User-facing copy is truthful.** `RENAME_NOTICE`, REST contract (l.1196, 1226, 707), BRD traceability (l.329) no longer say existing teams stop matching after rename. State the replacement wording in the proposal (draft: "Existing teams keep their copy and its current name; renaming a default here does not change or rename any team's topic.").

## 4. Recommended answers to open questions

- **Backfill against archived template rows?** Yes. Link is identity, not "currently offered". Requirement support: topic history preservation (archived topics retain history); an unlinked-because-archived row would later be offered as "never seeded", a quiet failure. Scenario 4 covers it.
- **Raw equality vs normalized name match?** Raw equality, as Devon says; it reproduces today's behavior and cannot invent identity. One caution: confirm `normalizeTopicNameForMatch` is not what the current join effectively relies on; the notes say the current join is raw `=`, so raw is consistent. Record that unmatched near-misses (case/whitespace) are reported, not linked.
- **FK ON DELETE: RESTRICT vs SET NULL?** RESTRICT. Requirement basis: history preservation and the "no quiet failure" promise; a loud block beats silent loss of identity. This is a technical choice, so Architect confirms, but BA position is: silent degradation is unacceptable. Add the requirement "template defaults are archived, never deleted".
- **Option 2 (non-backfillable rows)?** (a) acceptable, conditional on the count being measured and the #299 backstop being tested. If count is zero, record it and reduce to a documented note. Reject (c).
- **Should #197 mis-match fix be in this PR?** Yes, as an explicit requirement (scenario 5), not a side effect. Because it makes a default reappear in restore offers for a team that "already has" a same-named custom topic, the reviewing stakeholder (Devon/Brian) should acknowledge it.
- **Unique (team_id, template_topic_id) index now?** Yes; it makes "one team row per default" a stated rule, and the backfill is specified to never violate it. Requirement: the rule is stated in the spec so #310 may rely on it.
- **Archived template default drops out of the list?** Yes, keep today's behavior; archiving a default means "no longer offered". Scenario required.
- **Expose id in API?** No new field; agree. Note as an explicit non-goal in the spec so no one adds it for convenience.
- **Count of unlinked rows in real environments?** Cannot be answered from requirements; this is a data question for Brian. It is the only blocking input and should be a gate before implementation, not after.

## 5. Residual concerns (Marcus's lens)

- **Edge cases found late.** Add scenarios for: team renames its own copy, then admin renames template (link must survive both); team archives its copy (link retained, restore reactivates same row); two teams; team created during the migration window.
- **Topic history preservation.** Confirm the migration and the FK never delete or relabel archived team rows.
- **Decision 3 "CHECK team_id <> sentinel"** relies on a magic sentinel; the spec should name where the sentinel is defined rather than restate its value.
- **Item 10 (test snapshot helper deleting/reinserting template rows)** is a risk that the spec must close: requirement "test template snapshot/restore preserves template row ids", or the suite goes red under RESTRICT. Flag for Tess/Architect, not a BA decision.
- Good: explicit non-goals, ranked risks, and the single-statement constraint are all carry-ready. Suggest the proposal copy the "must not touch" list verbatim as a Scope Exclusions section.
