# Executive Review: First Access Proposal
**Reviewer:** Rachel Okonkwo, VP of Engineering
**Date:** 2026-07-05
**Change:** first-access
**Status:** Approved with conditions

---

## Overall Assessment

This change is correctly scoped and strategically sound. The core promise — authenticate through the org IdP, get an account, arrive at the application — is exactly the zero-friction argument I made to the CTO when I approved headcount for this project. First Access is the foundation that makes the adoption story credible. Without it, every team adoption depends on manual provisioning, and the tool never reaches the teams that most need it.

My conditions are narrow. There are no scope concerns and no strategic objections. There are two execution risks that need to be addressed before I consider this closed.

---

## 1. Strategic Alignment with Zero-Friction Adoption

This is the right change at the right time.

The no-admin-provisioning constraint (Capability 1) is the most strategically important thing in this proposal. If getting into the application requires a ticket, an admin action, or any step that isn't "authenticate with your normal credentials," adoption stalls — particularly on teams where no one has a direct relationship with the implementation team. That constraint must be treated as load-bearing through every future refactor, not just this one.

The no-team landing page design is also correct. It gives a new user accurate information about their state, one clear instruction, and nothing else to distract or confuse. That is the right posture. An engineer who lands on that page and immediately understands "I need a join link from a facilitator" is one email away from their first session. An engineer who lands on a broken-looking screen with navigation that goes nowhere will assume the tool isn't ready and move on.

The constraint against application navigation on the no-team page is not cosmetic — it is the facilitator protection mechanism in the UX layer. A "create team" button on that page would let engineers bypass the facilitator entirely and attempt self-directed sessions with no facilitation structure. That is exactly the kind of drift that makes the ritual fail quietly. The four-element constraint is correct and should be enforced at the routing layer as specified.

---

## 2. Capability Complexity vs. User-Facing Value

All five capabilities are proportionate. None are gold-plating.

**Capability 2 (sub/iss identity matching)** may look like an edge case — who changes their email address that often? — but the failure mode is severe. A user who rejoins with a different email and gets a new account loses all session history, trend data, and team memberships with no path to recovery. The fix is buried and requires human intervention. The constraint costs very little to enforce and prevents a class of data integrity failures that would be genuinely difficult to remediate at scale.

**Capability 3 (concurrent handling via upsert)** addresses a race condition that most users will never trigger. I understand the impulse to defer it. I am not recommending that. A failed first sign-in at exactly the moment of first access — the moment when an engineer's first impression of the tool is formed — is disproportionately damaging. The cost to fix it later is higher than the cost to handle it correctly now, and the proposal indicates it is already partly implemented. Preserve the upsert pattern.

**Capability 5 (missing claims rejection)** is standard. No concerns.

---

## 3. Server-Side Redirect Decision

I want this question answered explicitly before the change closes, not because I object to the decision, but because I want to be certain it is a technical decision and not an aesthetic one.

The proposal argues that server-side redirect prevents "a window where the client might briefly render the wrong state." That argument as stated is weak — a brief flash of the wrong state is cosmetic, not functional. If that is the only justification, I would call it over-engineering.

The stronger argument is architectural: by the time account resolution completes in the callback handler, the server already has the team membership data in hand. The redirect decision falls naturally there at zero additional cost. Moving it client-side would require a round-trip — authenticate, receive a redirect to `/`, make a second API call to check team membership, redirect to `/no-team` — which is more complex, not less. The server-side approach is simpler when the data is already present.

If that is the implementation reality — and the proposal and exploration notes both suggest it is — then server-side redirect is not over-engineering. It is the natural consequence of where the data lives. I accept it on that basis.

If the implementation team discovers during task execution that server-side routing requires significant additional work that was not anticipated, that is a decision point worth surfacing. Do not absorb unexpected complexity silently.

---

## 4. Out-of-Scope Protections

The out-of-scope list is well-constructed. The decisions I most care about:

**Admin provisioning excluded:** Correct. The moment manual provisioning is possible, it becomes the path of least resistance when something seems complicated. Remove the option entirely.

**Facilitator first-access path excluded:** Correct. The facilitator's path from no-team to having a team to facilitate is a team setup problem, not an identity problem. Mixing them here would expand scope without benefit.

**Distinction between new and returning users on the no-team page excluded:** Correct, and the reasoning is sound. The condition and the next action are identical regardless of account history. Surfacing history the user cannot act on is noise, not signal.

**Single log-out excluded:** Acceptable for this stage. Note for the roadmap: if an engineer signs out of the application but remains signed into the IdP, the next authentication is frictionless. That is fine for adoption purposes. If we ever have a security posture requirement around IdP-level session termination, it needs to be addressed separately. Flag it; do not forget it.

---

## 5. Deferred Items as Future Blockers

### `isNewUser` race condition

This one concerns me, and not because of its immediate impact — the upsert handles the data correctly, and the race only affects downstream consumers of the `isNewUser` flag. My concern is discoverability.

The constraint is documented here: any downstream consumer of `isNewUser` (analytics events, welcome notifications) must handle duplicate firings, or the SELECT-before-upsert pattern must be replaced before that consumer is added. That is the right constraint. My question is: will the team adding analytics six months from now know about this?

Exploration notes files are not durable architecture documentation. If this constraint lives only here, it will be violated by the first engineer who adds an analytics event without reading this file. Before this change closes, I want confirmation that this constraint is captured somewhere that will be discovered during future work — a code comment on the `resolveOrCreateAccount` function, a known-issues section in whatever technical documentation this project maintains, or a tracked item in whatever backlog owns the analytics work. "Documented here" is not sufficient.

### `@unknown` email fallback

This is low risk. An anomalous email domain in stored data causes operational inconvenience if anything filters or sorts by email domain, but it is not a ritual concern and not an adoption concern. Address it when someone builds tooling that cares about email format. Not before.

---

## Conditions for Approval

1. **`isNewUser` race constraint must be made durable.** Before this change is marked complete, the constraint on future `isNewUser` consumers must be captured in a form that will be discovered during future work. A code comment on `resolveOrCreateAccount` is the minimum. A tracked backlog item is better.

2. **Server-side redirect complexity must be confirmed.** If the implementation team discovers during task execution that server-side routing requires significant unanticipated effort, surface that before absorbing it. Do not let this become a hidden scope expansion.

Both conditions are narrow and executable. They do not affect the substance of the proposal. The capabilities are correct, the constraints are load-bearing, and the out-of-scope list is appropriately protective. This change should proceed.
