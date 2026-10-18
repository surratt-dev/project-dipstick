# Proposal Review: zero-topic-team-recovery (#200)

Reviewer: Rachel Okonkwo, VP Engineering (Executive Stakeholder)
Focus: strategic alignment, proportionality, scope creep

## Verdict

Approve with conditions. The core is right and defensible. The proposal is larger than its own "near zero affected" argument justifies in several places, and two items need a decision before build starts.

## What I agree with

- Splitting the issue. Not rebuilding the half #175/#215 already delivered is the discipline I want.
- Grounding the work in FR-8.6 [HARD] ("restorable for any team at any time"). A hard requirement that is unmet for one state is a legitimate reason to build even for a population of zero. I would rather close that gap than explain it in an audit.
- Admin-only, no facilitator or manager trigger, no flag, no notification, no persistent chrome. This keeps the app out of the way and does not widen who can touch team data. It honors my access-control and no-manager concerns.
- The explicit non-goals list (no top-up, no repair framework, no template editor). Good fences.
- Replacing "ask the people who run this application". That phrase lands on my desk, and naming a role fixes it.

## Concerns

### 1. Proportionality: the surface is bigger than "one endpoint, one button"

The proposal says it is deliberately small, then lists: a new endpoint with 7 outcome rows, a TOPIC-002 field, two empty-state variants plus three outcome messages, three room-open message variants, a H1 policy loosening, three use-case edits, a new use case, a runbook, a spec Purpose rewrite, five modified specs, and nine acceptance criteria including a usability pass. For a state the advance handler itself calls "unreachable through the API", that is a lot of review and test surface. Each piece is small, but together they are a feature, not a patch.

Ask: confirm the team has priced this honestly and cut what is not needed for FR-8.6 compliance. Candidates:
- The three-way room-open message split (non-admin, admin, unlocked). One message naming "an application administrator" serves both roles. The admin-specific variant is polish for a state nobody should reach.
- Separate 201/409/500 on-screen outcome strings with refetch behavior. A refetch plus one generic error line covers it.
- Acceptance criterion 9 (staged usability pass with a real admin) for a state with an expected population of zero. Reasonable to keep only if it is cheap; do not let it gate the merge.

### 2. The sequencing of verification is backwards

The diagnostic query (how many teams are actually affected) is listed as "does not gate the build". I understand FR-8.6 is the justification, but running a one-line query before committing is the cheapest strategic input available. If it returns zero, I still approve the minimal endpoint, but I would want the extras in concern 1 deferred. If it returns rows, the picture changes (a bulk script may be warranted, which the proposal currently declines). Run it first and record it in the proposal.

### 3. Policy changes ride along with a bug fix

Three decisions here are organizational policy, not engineering detail, and they were made by a stand-in for the PO:
- Loosening H1 to allow naming a role in user-facing copy.
- A deliberate, permanent exception to the customization lock. I accept the reasoning (it only restores the canonical set and cannot customize), but this is a precedent. "The lock has exactly one carve-out" needs to stay true. I want the spec wording to make any future carve-out require explicit sign-off.
- Amending the Customization Lock use case to remove "no bypass or override mechanism".

I am fine with all three on the merits, but they should be ratified by the actual PO, not left as "PO may overturn". Do not merge until that happens. This is the real blocking item.

### 4. Compliance gap accepted by the author

The empty-template 500 leaves no durable audit row. The author declines to fix it and "informs" compliance. That is acceptable for an admin-only failure, but "informed so they can overrule" is not a sign-off. Get a recorded yes from compliance, or the first audit finding becomes my problem.

### 5. Non-admin 403 audit

For an endpoint that bypasses the lock, I lean toward auditing denied attempts. A non-admin trying to reach a lock-bypassing endpoint is more interesting signal than a denied add-topic. The proposal says it is one added operation. If Security asks, do it; I would not argue for building it speculatively either. Just decide, do not leave it open.

### 6. Adoption alignment (limited)

This change does not move my success criteria (3 teams x 6 sessions, a closed action-item loop, a trend insight, no evaluative-use concerns). Its adoption value is protective: a team that hits this state at its first session would stall and likely abandon the ritual. That is real but rare. Therefore this must not displace work on onboarding and first-session friction, which is what actually drives adoption. Keep it time-boxed.

## Scope-creep flags

- H1 loosening and use-case rewrites: policy riding on a bug fix (see 3).
- Role-specific copy variants beyond the minimum (see 1).
- Spec Purpose paragraph rewrite and five-spec fan-out: documentation cost is high for one endpoint.
- Runbook: keep it, but a half page, not a document.

## Conditions for my approval

1. Run the diagnostic query and record the count before build; if zero, defer the extra copy variants and the usability gate.
2. Obtain actual PO ratification of the lock carve-out, H1 loosening, and use-case amendments.
3. Obtain a recorded compliance response on the unaudited empty-template failure.
4. Decide the non-admin 403 audit question now.
5. Time-box the change; it must not delay first-team onboarding work.

None of these conditions block the design direction. The endpoint, its admin-only boundary, and its zero-active precondition are the right shape.
