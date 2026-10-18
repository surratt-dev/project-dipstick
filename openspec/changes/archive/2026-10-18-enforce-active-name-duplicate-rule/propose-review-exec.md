# Proposal Review: Executive Stakeholder (Rachel Okonkwo)

Change: enforce-active-name-duplicate-rule (#299). Focus: strategic alignment and proportionality.

## Verdict

Approve the intent, with one condition: hold the line on scope. The rule is right and the Product Owner has settled it. My concern is the size of the package around a small follow-up.

## Strategic alignment

- **Serves adoption.** The first session has to be low-friction. A facilitator asking "which Safety are we on?" with the clock running is exactly the kind of small embarrassment that makes a champion stop championing. Consistent behavior across Add, single restore and bulk restore removes that.
- **Serves early warning.** Trends are keyed by topic id. Duplicate active names fork a team's history and dilute the sustained-negative-trend signal, which is the feature I care about most. Preventing the fork protects the product's core value.
- **No effect on trust properties.** It touches no access control, manager boundary, reveal or retention behavior. It adds no data visibility. I have no policy concern.
- **No-override stance is correct.** I support no flag and no admin bypass. A protective rule that can be configured off will be. Keep it.

## Proportionality

The user-visible change is small: two server checks, one removed button, one inline message. The proposal also carries:

- A shared function, a new response type and a new error code.
- Edits to four capability specs, including a REMOVED requirement.
- A parameterized parity test table and real-Postgres concurrency tests.
- No-audit and no-gap assertions.
- A writer inventory covering every code path that creates or activates team topics.
- Four document updates: REST contract, use case 08, BRD and the inventory.
- A proposed follow-up issue.

Most of this is justified. Consistency across three doors is the point, and a shared comparison function is the cheapest way to get it. My concern is the extras that grow the change without moving adoption.

## Flags

1. **Writer inventory (moderate).** A "covered or exempt" audit of every topic-creating writer is open-ended. Bound it to the three user-facing doors plus a one-line note on admin and seed paths. If it turns up a new unguarded writer, file a separate issue. Do not fix it here.
2. **Concurrency tests on real Postgres.** Worth keeping only because the advisory lock already exists and the check sits inside it. If this needs new test infrastructure, drop it to a single test.
3. **Client polish (minor).** Server-409 handling that keeps input and focus, refreshes the list, and shows a persistent row-level message with next-step guidance is more than the minimum. The disabled submit with an inline reason and one shared 409 message are enough. Treat the persistent row message wording and any scroll or highlight behavior as design discretion, and cut them if time slips.
4. **Legacy duplicates (important).** Existing duplicates stay untouched and are left to a follow-up. That is the right call. Do not let it expand into a rename tool or cleanup UI in this change. I would not prioritize that follow-up until a team actually reports the problem.
5. **Document edits.** The REST contract and use case updates are necessary. Marking BRD OQ-3 resolved is cheap and worth doing. Keep these edits to factual changes only.
6. **Single-restore reversal.** #218 explicitly shipped "single restore ignores the duplicate rule", and this reverses it. That is acceptable, but release notes or the PR description should say so plainly. Facilitators who learned the old behavior will see a new rejection.

## Priority check

Nothing in this change competes with, or delays, getting a first team through six sessions. Provided it stays a quick follow-up, it is a fair use of time. If it starts to stretch past that, ship Add and single-restore enforcement with the shared function first, and defer the extended client states and inventory.

## Requests

- State in the tasks which items are must-have (server rule on two doors, shared function, button removal, contract and use case updates, flipped tests) and which are optional polish.
- Confirm that the follow-up issue stays unscheduled until there is evidence of real-world legacy duplicates.
- No further executive review needed unless scope grows or any override path is proposed.
