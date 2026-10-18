# Proposal Review: Executive Stakeholder (Rachel Okonkwo)

Change: 271-audit-log-reader-structural-test
Focus: strategic alignment, proportionality, scope creep

## Verdict

Approve with scope trims. The intent is right and I support it. The size and shape of the work are heavier than the issue warrants.

## Alignment: what I like

- This protects my non-negotiable. Admin and diagnostic audit rows must never reach team members or managers. If engineers believe that data can be surfaced, the ritual dies. A build-enforced guard is a better answer than "the people who reviewed #208 remember it."
- No production, migration, API or user-visible change. No adoption risk, no delay to the first teams.
- No bypass switch, and the proposal says plainly that approval is by convention, not enforcement. That candor is welcome.
- The proposal reads as a trust protection and not as a compliance exercise. Good framing.

## Concerns: scope and proportion

The issue asked for a fairly small test. The proposal delivers a small framework with its own taxonomy, procedure and governance. My top concern is over-engineering. Internal tools projects that balloon in scope are the pattern I fear most, and this change is a small instance of it.

1. **Three entry classes.** `exact-match`, `admin-only` and `mutator` are more than the task needs. Today's inventory is one non-admin reader and one admin-only file. The `mutator` class has no current entry in the stated inventory, so it exists for a hypothetical. Ask: can this ship with two classes (filtered reader, admin-only), and add `mutator` when a real one appears? Any unclassifiable statement already fails, which is a safe default.
2. **Six-step extension procedure plus reason validation rules.** Whitespace-reason checks, stale-entry checks and the procedure all add maintenance for a list of three entries. Keep the stale-entry check, since it is cheap and valuable. The rest is optional polish.
3. **Deny-list with a prefix rule and a historical operation.** The deny-list is the one extra I would keep, because it directly blocks the leak I care about (an exact match on `admin.topic_config_accessed` would otherwise pass). Keep it, but keep it to a short constant, not a mini-policy.
4. **Spec delta rewrite.** Restating the requirement to describe the test's internals ties the spec to implementation detail. A one-line link from the requirement to the test, plus honest wording about what is checked, is enough. I don't want a spec rewrite whenever the test changes.
5. **Follow-up issues (7.1, 7.2).** Four or five follow-ups are named: SELECT * check, admin-guard verification, migration view scan, CODEOWNERS, and the facilitator per-person presentation check. Listing known gaps is honest, but filing all of them now creates backlog that competes with adoption work. File only the `SELECT *` one, which is the real leak risk. Leave the rest as notes in the test header.
6. **Traceability note on archived #208 review.** Fine if it is a one-line edit. Not worth more.

## Misaligned priorities to flag

- The facilitator-facing item (connection recoveries returning `actor_user_id` and timestamp, with a possible per-person scoreboard reading) is the most strategically important thing in this document, and it is buried in a follow-up bullet. It touches "data feels like surveillance," my deepest concern. It should be a visible, decided item with an owner, not a pending note. It does not belong in this test, but it should not be lost.
- Effort spent hardening the mechanism (AST scanner, classes, procedure) is disproportionate next to that product-level question.

## Requests

1. Drop or defer the `mutator` class unless a real entry exists today.
2. Keep the deny-list; keep it minimal.
3. Shrink the spec delta to a link plus accurate scenario wording.
4. File at most one follow-up issue (`SELECT *` / column leak) now; surface the connection-recovery presentation question to the product owner separately.
5. State a rough effort bound. If this is more than a few days, the scope has drifted.

## Success-criteria fit

None of my four success criteria (three teams with six sessions, closed action loop, useful trend insight, no evaluative-use concern) depend on this change except the fourth, indirectly. It is a protective investment, not an adoption one. That supports shipping it lean and moving on.
