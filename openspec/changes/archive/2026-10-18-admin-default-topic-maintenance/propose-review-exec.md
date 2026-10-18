# Proposal Review: admin-default-topic-maintenance (#216) - Executive Stakeholder

*Reviewer: Rachel Okonkwo, VP of Engineering (executive sponsor). Focus: strategic alignment, proportionality, scope creep, API-only decision, PO-ack items.*

## Verdict

**Approve with conditions.** The change is aligned with what I care about and I would not block it. It is bigger than I would like for something with no user-facing screen, and I want two scope trims and one sequencing commitment before I call it proportionate.

## Strategic alignment

**Serves the goals, mostly indirectly.**
- Governance and consistency: FR-8.1 [HARD] is unmet today. A common, maintainable baseline is the "common language across teams" I want. Closing the gap is justified.
- Trust and the surveillance concern: the framing is right. The proposal states the maintenance path is structural, exposes no control over the first-session lock, membership, facilitator or session rules, and says prompts must address the team and the work, never individuals. Audited, admin-only, live-role-checked writes mean nobody can quietly change what every team is asked. This reinforces "the team's data, not management's tool". I also note engineering managers are explicitly denied (403 `DEFAULT_MAINTENANCE_ADMIN_ONLY`). Good; that matches my own boundary.
- Longevity and trend integrity: votes stay attached to each team's own topic ids, history is intact, and the proposal checked that no report groups by default-topic name across teams. This protects my "review a team's trend history" success criterion. The documented risk to a future cross-team by-name view is the one I want kept visible.
- Adoption: this does not move the needle on my success criteria (three teams, six sessions each; a closed action-item loop). It is hygiene and governance, not adoption. It also does not hurt adoption, because it only affects teams created afterward. I am comfortable with it only because it is not displacing adoption work.

## Proportionality

The value is real but modest: one admin currently needs a developer, a review and a deploy to fix a prompt. The proposal's cost is large relative to that.
- Seven endpoints, five new audit operations, a new 403 code, ~8 validation error codes, a reshaped invariant test, a new structural test, a trigger reconsideration, four doc updates, and a rollout dry run.
- Fourteen numbered decisions (D1 to D14) and four follow-up issues for a change with no screen.

Much of this is defensible because the path edits the ritual itself and I want it safe. But "safe" and "gold-plated" are different, and I flag the following.

### Scope-creep flags

1. **Template audit-history read endpoint (D13).** The audit rows are required; a dedicated read API for them on day one is not. With no UI, the only consumer is a developer with database access. Recommend deferring the endpoint to the screen follow-up, keeping the audit writes. (If D13 is the only recovery path for a bad edit, say so, and I will accept it; the proposal currently implies it is.)
2. **Whole-list reorder plus `lastChangedAt`/`lastChangedBy` per-row decoration.** Reasonable, but ask whether reorder is needed in v1 when a base set of twelve is rarely reordered. Low cost; I will not insist.
3. **Rollout dry run with a facilitator.** Process overhead for an API nobody non-developer can call. Fold it into the screen release, where a facilitator can actually do it.
4. **Trigger reconsideration (D4) and test reshaping.** Necessary housekeeping from #215 and I accept it, but it should not grow. The enumerating structural test is the right size; do not add more enforcement mechanisms.
5. **Four follow-up issues with TBD numbers.** The proposal itself says numbers must be recorded before acceptance (task 1.4). They are still `#TBD`. This is a hygiene gap, not scope creep, but I want them filed before I treat the change as accepted.

### Misaligned priorities

- None that conflict with my goals. My one concern is opportunity cost: this competes with whatever helps a champion run a first session with low friction. I would want confirmation this is not ahead of onboarding or trend-dashboard work in the queue.

## API-only decision (D6): acknowledged, with a condition

I acknowledge it. I would rather ship a safe API now than a full screen with a larger surface, and "partially met, API only" in the BRD traceability is honest. It matches my ask to ship usable increments and iterate.

Condition: the screen follow-up must be a real, numbered, scheduled issue, not a parking lot. FR-8.1 is a [HARD] requirement and "partially met" must not drift into "met in practice for developers". Until the screen ships, I do not want this described to anyone as delivering administrator self-service. The proposal says the first real users are developer-level; that is the truth and it should stay in the status reporting.

## PO-ack items

These are product-owner calls, not mine, but they touch policy I am consulted on. My position on each:

1. **D2, `vote_type` immutable after creation:** Acknowledge and support. Protects comparability of trends.
2. **D3, full before/after text in audit rows:** Acknowledge. The exception is scoped to template text that is global and non-personal, so it does not create a surveillance risk. I note no undo operation exists; recovery is editing back. Acceptable for v1 because edits are rare and admin-only.
3. **D6, API only:** Acknowledged above, with the condition.
4. **D7, limits (max 15 active, 60/400/800, plain text):** Acknowledge. Lowering to 15 to protect brief sessions aligns with my "low overhead" ROI argument. Good call.
5. **D5, "canonical" means the current template, no reset-to-factory:** Acknowledge. Declining a reset toggle is consistent with "structural, not configurable".
6. **D1, archive not delete, retire `non_active_default`:** Acknowledge. Changing a shipped detector is fine provided the replacement test is in place, which the proposal specifies.

## Known consequences

I accept the mixed-wording-across-teams consequence ("integrity over uniformity"), the rename/name-join mismatch, and restore returning a team's own prior wording. My one request: the mixed-wording consequence is the one most likely to confuse me when I compare teams. The facilitator-visible "defaults last changed" follow-up should be prioritized above the other three follow-ups, because it is what lets a leader interpret cross-team differences correctly.

## Conditions summary

1. Defer the audit-history read endpoint (D13) to the screen change, or justify it as the sole recovery path.
2. Move the facilitator dry run to the screen release.
3. File the four follow-up issues with real numbers; schedule the screen issue.
4. Keep status reporting honest: FR-8.1 is partially met, API only.
5. Confirm this does not displace onboarding or dashboard work.

No objection to proceeding once 3 and 4 are done; 1, 2 and 5 are requests, not blockers.
