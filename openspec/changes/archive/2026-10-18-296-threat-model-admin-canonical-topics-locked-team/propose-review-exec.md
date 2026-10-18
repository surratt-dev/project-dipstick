# Proposal Review: Executive Stakeholder (Rachel Okonkwo)

**Change:** 296-threat-model-admin-canonical-topics-locked-team
**Focus:** Strategic alignment, proportionality of scope, scope creep
**Verdict:** APPROVE WITH CHANGES (trim ceremony; no blocking objections)

## Strategic alignment

- This serves my stated concerns indirectly but legitimately. I care about who can see and write what, and about team boundaries being enforced. A privileged write path that exists only in an archived change is the kind of thing that surprises me in a pre-production review. Writing it down in the one document a reviewer reads is worth doing.
- It does not move adoption directly. No team gets onboarded faster, and none of my success criteria (three teams, six sessions, a closed action loop) change. I accept that as a trust and defensibility item, and I want it treated as one: cheap, done once, and not allowed to compete with onboarding work.
- Good: the proposal keeps the lock structural (no toggle) and keeps recovery lightweight. It explicitly refuses to recommend a second approver, ticket or step-up. That is the right call for a low-residual-risk path. Adding friction to restoring a broken team would hurt the champions I depend on.
- Good: no change to manager read-only, reveal, or facilitator behavior. Confirmed in "Constraints preserved".

## Proportionality

The value is a paragraph or two plus one table row. The proposal wraps it in:

- 9 acceptance conditions (D1 to D9), including a grep-based over-claim sweep and a byte-identical check on seven existing rows.
- A subsection with eight labelled items (a to h).
- A contradiction grep over all of `requirements/`.
- Two drafted follow-up issues.
- Two-persona sign-off (Security and BA).
- Same-day re-verification of every cited control and test.

For a documentation-only change rated low residual risk, this is heavy. The rigor is not wrong in itself, and the claim-matches-code discipline is sensible for a security document. But the review and process cost may exceed the cost of the risk being documented. My bar: the whole change should be a small PR a reviewer reads in ten minutes.

## Scope-creep flags

1. **Item (g), "Operator and facilitator experience" in a threat model.** This is UX content in a security section, and it is the seed of the second follow-up (facilitator empty-team messaging). Of everything here, it is closest to my real concern, because a facilitator stuck on a zero-topic team is an adoption failure at the worst moment: the first session. But it belongs in a product issue, not in 8.1.1. Recommend: one sentence in 8.1.1 pointing at the follow-up, or drop (g) and keep the follow-up.
2. **Follow-up 1 (S-B, N-A, N-D from #216)** is explicitly out of scope, yet drafted here. Drafting is harmless. Make sure it stays unfiled and does not become a gate for this change.
3. **Item (h), reopen triggers, and the test-citation bullet in 8.2.** Reasonable, but the 8.2 test-citation bullet is process-in-the-spec. If the test is cited and later renamed, the document rots. Ask whether this bullet earns its maintenance cost. I would accept dropping it.
4. **SEC-31 framing.** The proposal says #296 is "a legitimate input" to the 8.4 revisit. Fine, but do not let this change grow into the revisit itself. D7 guards this well.

## Priority concerns

- **Opportunity cost.** Three agent personas are consulted at the proposal stage for a doc edit. I would like the pipeline for this change to be the lightweight one. Do not expand it into a full seven-stage run.
- **Sign-off latency.** D9 requires Tomas and Marcus. If either is unavailable, this should not sit. Define a default (for example, proceed after one business day with the rating recorded as proposed).
- **Language about trust.** The text says the risk is low partly because `application_admin` is "already an accepted trusted role (#208)". Keep the HLA wording factual and neutral. Nothing in it should read as a statement that admins can or will look at team data. Given my deepest concern (the data must never feel like surveillance), the section should say plainly that the carve-out writes topic rows only and exposes no session, score, or reveal data. If that is true per the code, say it in item (b).

## Requests

1. Fold (g) into a single pointer sentence, or move it wholly to the follow-up issue.
2. Reconsider the 8.2 test-citation bullet, or accept it with a note that it is maintenance debt.
3. Add the "topic rows only, no team data exposure" statement to (b) if verified.
4. Define a sign-off timeout for D9.
5. Keep this on the lightweight pipeline and land it quickly.

## Bottom line

Worth doing, small in value, and it should be small in cost. Strategic fit is acceptable as a defensibility and trust investment. Trim the process weight and the UX content, and ship it.
