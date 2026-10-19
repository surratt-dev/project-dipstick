# Proposal Review: 311-template-topic-id-matching
**Reviewer:** Rachel Okonkwo, VP of Engineering (Executive Stakeholder)
**Focus:** Strategic alignment, proportionality of scope, scope creep

## Verdict: APPROVE WITH CONDITIONS

I do not review pull requests, so I will not comment on the SQL. I care about three things: does this protect the "experiment safely, restore the baseline" promise, is it sized sensibly, and does it leave the access and trust boundaries alone.

## Strategic alignment

- **Trust in the baseline.** The "quiet failure" framing is the right one. After #216, a renamed template default makes a team look like it is missing a topic it still holds. That is the kind of silent confusion that makes a facilitator stop trusting the tool. I accept the case for fixing it. It is small and it protects the ritual.
- **Adoption.** This does nothing visible for a team's first session, and the proposal says so. That is fine for a prerequisite. But it is the second consecutive change in the default-topic area (#216, #299, #296, #218, now #311, with #310 queued). My success criteria are three teams completing six sessions and one closed action-item loop. None of that depends on default-topic identity. I want the team to say plainly that this area is now in "enough" territory. After #310, I expect it to move on to onboarding and the trend dashboard, which is where my early-warning value sits.
- **Trust and access boundaries.** The exclusions are strong and I like them: no change to the first-session lock, to sessions, to the manager and facilitator boundaries, or to trends. No new API field. "If a diff touches them, stop" is the right instruction. Nothing here makes the data look more like surveillance.

## Scope proportionality

The core is proportionate: one nullable column, a backfill, a copy-time write, and one query change.

Concerns, in priority order:

1. **Backfill and runbook weight.** Near-miss counting and reporting, the rule for picking one row among same-name defaults, a re-run-after-drain step with a verification query, and a rollback paragraph add up to a lot of machinery. The proposal admits the number of unlinked rows is unknown. I would like that number before we commit to this much operational design. If production holds a handful of rows, a simple count in the migration log plus one runbook query is enough. Do not build more than the data justifies.
2. **Unique partial index and CHECK constraint.** These are justified as a rule for #310 to rely on. That is speculative support for a change that is not yet built. Accept them only if they are cheap and the architect confirms they carry no deployment risk. If either complicates the migration or the test helpers (the RESTRICT and snapshot-helper warning is a hint), drop it and let #310 add it.
3. **Defined-outcome list on `defaultTopicsNotActive`.** It has an API field with no UI consumer today. Four detailed outcome rules are a lot of polish for something no user sees. The #299 suppression rule is defensible because it avoids a dead-end click. But nobody can click on this field today, so ask whether that rule belongs here or in #310.
4. **Documentation spread.** The change touches the REST contract in three places, use case 08, BRD traceability, deployment docs and the issue text. Necessary for truthfulness, but keep these edits to wording corrections, not rewrites.

## Misaligned priorities / creep flags

- None of the exclusions is violated. The explicit deferrals (add vs restore labels, "held by N teams" count, repair UI) are correctly parked. Hold that line in review.
- The rewritten `RENAME_NOTICE` is the only part an administrator will actually see. It deserves the facilitator wording check the proposal already requests. Please do it.
- The "Topic Management needs no change" correction is the best sign of discipline in this document. It shrinks scope after investigation. Keep that habit.

## Conditions

1. Report the unlinked-row count for each environment before merge. If it is small, trim the near-miss reporting and drain-and-re-run ceremony to the minimum.
2. Architect confirms CHECK and unique index are low risk. Otherwise defer them to #310.
3. No scope additions during implementation. Anything beyond the listed files needs to come back to me as a decision.
4. After #311 and #310, the default-topic area is closed until there is adoption evidence that something here is hurting teams.

## Questions for the team

- How many teams exist today, and have any of them actually experienced the rename mismatch? Or is this protecting against a case we expect rather than one we have seen?
- What is the delivery estimate? I want to keep this to a small, short change.
