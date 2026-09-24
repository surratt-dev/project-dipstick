# Executive Stakeholder Review — Proposal, Inline Team Creation (#44)

**Reviewed by:** Rachel Okonkwo (VP of Engineering, Executive Stakeholder)
**Reviewing:** `openspec/changes/inline-team-creation/proposal.md`, skimmed `design.md` and `tasks.md` for scope context

---

## Overall: Approve. This is the right change at the right size.

I don't review PRs and I'm not going to start now, but I want to be direct about why this one clears the bar for me without much debate: the proposal's own "Why" section states that `INSERT INTO teams` does not exist anywhere in production code today. That's not a gap in a nice-to-have feature — it means my Success Criterion #1 ("three or more teams have completed six sessions") is currently unreachable for any team that hasn't already been hand-seeded. This change is the thing that makes the product usable by a second customer, let alone a third. I'd have been more worried if this proposal had been small and deferred, not the other way around.

## Strategic alignment

This is squarely in the "ship something usable to a first team quickly" mandate I gave this team. It's also the more important of the two session-setup halves for adoption specifically — the existing-team picker (#153) only helps teams that are already in the system, which today means teams I or someone on my behalf inserted by hand. A new team's only path in is through this change. Every future team's onboarding story depends on it existing. I don't need to be sold further on whether to build this; the only questions worth spending my attention on are the three scope questions below.

## 1. Prerequisite scoping — six-topic seed vs. twelve-topic AC fix as a separate change

I read this as the right call, with one condition attached.

The proposal is explicit that this change's default-topic-provisioning code has no dependency on *how* the sentinel team's topics became correct, only that they are correct when read. Splitting "build the copy mechanism" from "fix the canonical content being copied" is a legitimate separation of two independently reviewable claims, and it mirrors a pattern this team has already used once (the `POST /draft` membership-check fix shipping ahead of the picker UI). I'm not going to second-guess an engineering team for reusing a sequencing pattern that already worked.

What I do care about: task 1.1 says to block this change's *merge* on the prerequisite landing, and design.md's risk section says the same thing. That's the right mitigation on paper. My condition is that this sequencing is enforced as a release gate, not just a documented intention — because the failure mode here isn't abstract to me. If this change ships ahead of the prerequisite and someone demos it (or worse, onboards a real first team) against the current six-topic seed, that team's default topic set is wrong and locked until their first session completes. A team's very first impression of this tool being "the default topics don't match what we were told they'd be" is exactly the kind of quiet, avoidable failure that erodes the trust argument I make to the CTO about this investment. Make sure whoever merges this checks the prerequisite is actually live, not just filed.

## 2. The normalized unique index (D4) — justified, not gold-plating

I looked at this one skeptically going in, because "let's also add a database constraint" is a classic place for scope to creep on a feature that was supposed to be about unblocking a UI flow. It isn't, here, and the reason is specific to this feature rather than general caution: design.md is explicit that there is no team-rename path and no standalone team-management screen. A team name is permanent the moment this endpoint returns success. Combined with the fact that an app-level-only pre-check has a real, not theoretical, concurrent-request race for case-different duplicates, this means the failure mode being prevented is "two permanently-misnamed near-duplicate teams exist forever with no admin tool to merge or fix them." That's not a hypothetical edge case I'd wave off — it's a one-way door, and the fix is a single additive migration (new index, harmless coexistence with the existing constraint, clean down-migration). I'd have pushed back if this were a mutable field with a correction path elsewhere in the product. It isn't. Keep it.

## 3. Overall size vs. value

New endpoint, one new frontend screen reused inside the existing three-screen component rather than a parallel page, a topic-copy step, and one small index migration. Measured against what it unlocks — the entire "new team" half of session setup, without which this product cannot grow past its currently-seeded teams — this is proportional, and on the lean side if anything. I specifically want to note what this proposal did *not* do, because restraint is worth recognizing as much as scope is worth flagging: it didn't build a team-rename screen, didn't populate `session_topics` (a pre-existing gap it correctly declined to adopt), didn't resolve the member-vs-participant question, and reused the existing picker/confirm component instead of standing up a second page that could drift. That's the shape of scope discipline I asked this team for, not scope creep dressed up as thoroughness.

## One thing I'd want watched, not blocked on

The empty-state copy change ("Don't see your team? Create one to get started") is a small line item in the proposal but it's the detail that actually serves my "adoption stalls without a champion" concern — it's the moment a newly granted facilitator with zero teams either finds their way forward or bounces. I don't need this called out as its own change; I just want it to survive to shipped code and not get cut for time, since it's cheap and it's load-bearing for exactly the first-session-friction risk I worry about most.

## Verdict

Approved to proceed. My only hard ask: enforce the prerequisite-migration-before-merge sequencing as an actual gate, not a to-do list item. Everything else here is proportional, well-bounded, and directly serves adoption.
