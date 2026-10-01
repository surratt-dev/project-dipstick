Target: NEW issue

## Topic write endpoints can target the template (`__default_topics__`) team

**Affects:** TOPIC-004 (archive), TOPIC-005 (restore), TOPIC-006 (reorder), TOPIC-007 (annotate). TOPIC-003 (add custom topic) should be checked at the same time.

The sentinel template team `00000000-0000-0000-0000-000000000001` holds the canonical default topics that new teams copy. No topic-write endpoint rejects it as a target. A standing facilitator (or, for 004/005/006, an application admin) who knows the ID can send writes against it.

**Today's accidental protection:** these writes currently answer `409 TOPIC_CUSTOMIZATION_LOCKED`, but **only because the sentinel team has no completed sessions**. That is not a guard. If a completed session row were ever associated with the sentinel team (fixture leakage, a migration, a support script), every write would go through and change what every new team receives. **TOPIC-007 against the sentinel team must not be relied on to stay `409`.** (TOPIC-007 annotations are not copied by seeding, so the blast radius there is smaller, but the same rule should cover all of them.)

**Proposed:** one shared check in `topics.ts`, run right after `checkTeamExists` on every topic write, that answers the sentinel ID with `404 TEAM_NOT_FOUND`. Add a test per endpoint, including one where the sentinel team has a completed session.

Raised by: topic-annotation (#53), design.md Risks (e). Sibling-wide, so out of scope for that change.
