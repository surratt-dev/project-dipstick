# Internal Champion Sign-Off — phantom-em-relationship-detection

**Reviewer:** Devon Calloway, Principal Software Engineer (Internal Champion / SME)
**Date:** 2026-09-29

## Ritual intent — unaffected, not just "preserved"

This change touches none of the four load-bearing constraints I actually lose sleep
over — the no-manager-participation rule, simultaneous reveal, facilitator-from-
another-team, and topic-guardrail visibility. It doesn't touch session flow, the UI,
or anything a participant or facilitator will ever see. It's two `psql` scripts and a
markdown template living in `packages/backend/migrations-manual/`, closing out a gap
in how we audit TEAM-005/TEAM-006 role-change history. Nothing here could soften,
gamify, or make optional anything about the ritual, because the ritual isn't in the
blast radius. This is the good kind of change to review: I can say "unaffected" and
mean it, not "preserved" in the sense of "we checked and it still mostly holds."

## Is this a clean pass?

Yes, with one thing said out loud rather than quietly nodded past.

**The six-day-late deadline.** I'd rather see a proposal that says "this slipped,
here's the honest new date" than one dressed up as if it were still inside the
original window — which is exactly what this proposal does (2026-10-08, stated as
committed, not a placeholder). That's the right instinct. What actually reassures me
isn't the new date, it's tasks.md 5.3: a real escalation mechanism (ticket or
calendar hold assigned to a human, not "the pipeline will notice") that fires if
2026-10-08 also slips, with a named escalation path back to Rachel. The first miss
happened because nothing was watching for it. This time something is. That's the
correct fix for the failure mode, not a promise to try harder.

**The build-vs-execute boundary.** I want to be explicit that this change delivers an
artifact, not a result. Tasks 5.2 and 5.3 are correctly left unchecked in the
archived record — that's not an oversight, that's the record being honest about what
hasn't happened yet. Decisions H and I aren't closed. I'd have been more worried if
this had been archived with those boxes checked prematurely, or if `query-result.md`
had been pre-filled with placeholder values just to make the change look finished.
It wasn't. Good.

**The append-only invariant.** `audit_log` never gets an `UPDATE` or `DELETE` in
either script — I read both files, not just the header comments claiming it. The
annotate script inserts one new row per historical match and references the original
row by id; it never touches the original. That's the right shape for an audit
system, and it's the one property I'd have blocked this change over if it had been
gotten wrong.

**`operation = 'team.role_changed'` filter.** This is the one line where a "helpful"
simplification would quietly manufacture false history — collapsing legitimate
blocked-promotion-attempt rows (`team.role_change_denied`, same metadata shape) into
annotated-as-real EM establishments. The filter is present, it's commented with why
it exists rather than just what it does, and — this is the part that matters to me —
task 4.3 pins down a fixture specifically designed so the test fails if that
predicate is ever silently dropped, rather than a fixture that would pass either way
by accident of dates. That's the difference between a test that checks correctness
and a test that just checks "did the script run."

## What I'd flag, not block on

None of this blocks sign-off, but it's the kind of thing I'd want on someone's radar:

- The detection query's known false-negative limitation (a legitimate EM row that
  was later demoted and then illegitimately re-promoted through the closed bypass is
  invisible to this join, since `team_memberships` carries no role-change history)
  is documented honestly in the script header rather than hidden. I'd rather see that
  admitted than a script that implies "0 found" means "provably clean." It does.
- I am not going to become the escalation path if 2026-10-08 slips too. That's
  Rachel's line now, by design (Decision 9, tasks.md 5.3), and I want it to stay that
  way — not because I don't care, but because "consult Devon" has a way of becoming
  "wait for Devon" if I don't push back on it early.

**Sign-off: approved.** The ritual's core mechanics are untouched by this change.
The one property this change exists to get right — that `audit_log` stays trustworthy
and append-only while closing the TEAM-005 gap — is implemented correctly and proven
by a test built to catch the specific way it could be silently broken later. The
outstanding execution work is correctly still open, not swept into "done."

— Devon
