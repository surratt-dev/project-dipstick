# BA Review: Exploration Notes — Close the TEAM-005 EM-Promotion Gap (Issue #109)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway, Internal Champion)
**Verdict:** Strong exploration — the *what* and the two-part fix shape are ready to carry into a proposal. But it has one blocking gap and a couple of ambiguities that need to be closed before this becomes buildable requirements, because they're exactly the kind of thing that turns into a mid-implementation "wait, what did you mean by this?" conversation. Framing note below first, then clarifications in priority order.

---

## Framing: what I'm checking for

My job here isn't to re-litigate the security analysis — Devon, Tomás, and Ingrid have that well in hand and I have nothing to add on the read-side/write-side split, which is correctly reasoned and precisely stated (section 3 is genuinely excellent — I'd change nothing about it). My job is: can the implementation team build this from what's written without coming back to ask what a sentence meant, and does every claim about "this doesn't affect requirement X" actually check out against the requirement it names. That second part is where I found the one real problem.

---

## 1. BLOCKING — The fix contradicts a currently-`[x]`-checked acceptance criterion, and the notes don't flag it

Section 4, bullet 2 says:

> I want to be precise about this in the proposal so nobody over-corrects and disables role management on TEAM-005 wholesale — that would break UC "Assign a Role to a Team Member" (`...01 - Identity and Access - Use Cases.md:173-236`), which is a real, in-scope use case with its own acceptance criteria (AC1 explicitly names both directions of the role change as in scope for EMs-on-this-team). Only the promotion direction is the problem.

This cites AC1 to justify *not* breaking the demotion path. But read AC1 as it's actually written today (`01 - Identity and Access - Use Cases.md:213`):

> - [x] AC1: An Application Admin or an Engineering Manager for this specific team can change a team member's `membership_role` between `participant` (Engineer) and `engineering_manager` (Engineering Manager).

That's not a AC that happens to be adjacent to the bug — it's an AC that **currently authorizes the exact transition the fix is going to block**. It's checked off (`[x]`), meaning it's marked as implemented and accepted. If this proposal ships the write-side restriction without also revising AC1, we end up with a requirements document asserting a capability the code no longer has — which is precisely the failure pattern the whole exploration is about (section 2: "someone reading this file today, in good faith, comes away believing Decision 14 is honored. It isn't... it's asserted as correct"). Same shape of problem, one layer up, in my documents instead of Ingrid's code comments. I don't want to be the second instance of that bug in the same change.

It's not only AC1. Two more places in the same UC file assert the pre-fix behavior as designed fact, not as a known gap:

- Same UC, **Out of Scope**: "`TEAM-006`... not called as part of this change. TEAM-005 alone is sufficient for all `membership_role` writes." — false after this fix. Establishing a *new* EM relationship will require TEAM-006; TEAM-005 becomes sufficient only for the demotion direction and for role changes that were never promotions in the first place.
- UC "Establish a Manager/Team Relationship," **Dependencies/Notes** (`...:299, 305`): "TEAM-005 changes the `team_memberships.role` of an existing member and does not check `global_role`." — also false after this fix; that's the exact behavior being closed.

**What I need in the proposal:** an explicit requirements-delta task that updates all three of these, not just a code change. Suggested rewrite for AC1:

> - [ ] AC1: An Application Admin or an Engineering Manager for this specific team can change a team member's `membership_role` from `engineering_manager` back to `participant` (demotion). Only an Application Admin, acting through TEAM-006 (`POST /api/v1/teams/:teamId/managers`), can establish a new `engineering_manager` relationship for a team member (promotion). TEAM-005 (`PATCH .../role`) rejects any request that would change `membership_role` from `participant` to `engineering_manager`, regardless of actor.

And the Out of Scope / Dependencies lines need the "TEAM-005 alone is sufficient for all `membership_role` writes" and "does not check `global_role`" claims struck and replaced with the corrected division of labor. I'd flag AC1 as re-opened (`[ ]`, not `[x]`) until the new acceptance criteria are verified, per our usual convention.

This isn't a reason to hold the proposal — it's a reason to make "update UC 'Assign a Role to a Team Member' AC1, Out of Scope, and the sibling UC's Dependencies/Notes" an explicit task in tasks.md, at the same priority as the code fix. A security fix that leaves the requirements doc telling the next engineer the old, wrong story is only half fixed.

---

## 2. Ambiguity — does the write-side block apply when the actor is an Application Admin, not just an EM?

Section 4, bullet 3 says the restriction is "unconditional on identity — it's about the role transition being requested, not about who's asking," and lists actor/target combinations (same person, different people, already-EM-elsewhere) — but every example in that list is an **EM-actor** scenario. The diagram in section 2 shows TEAM-005's authorization as "Any Application Admin OR any EM already legit on THIS team." Application Admins can call TEAM-005 too.

Decision 1 (quoted in section 1) says establishing an EM relationship must be "a deliberate, audited action" through TEAM-006 specifically — not just "performed by an admin." If an Application Admin uses TEAM-005 to flip a participant to EM, they have the *authority* to do it, but the action doesn't go through TEAM-006's precondition check, doesn't write `team.manager_established`, and isn't rate-limited under the TEAM-006 gate (issue #13). By Decision 1's own logic, that's still the wrong door, even though the person opening it is allowed in the building.

**I need this stated explicitly**, one way or the other, because it changes what the write-side check has to look at (transition + target state only, vs. transition + target state + actor role):

- Option A: Block the `participant → engineering_manager` transition on TEAM-005 for *every* actor, including Application Admins — admins wanting to promote must use TEAM-006 even though they technically could self-authorize on TEAM-005. Cleanest, matches "one door for this specific action" and the section-1 framing exactly.
- Option B: Block it only for EM-actors, and let Application Admins keep using TEAM-005 to promote directly since they already hold the authority TEAM-006 would check for.

My read of Devon's own framing in section 1 ("Decision 1's sole authorized actor" is TEAM-006, not "any Application Admin acting anywhere") points to Option A, and I'd recommend it — it's simpler to state, simpler to test, and it's the only option that guarantees `team.manager_established` is the audit record for *every* new EM relationship, not most of them. But the notes don't say this, and I don't think it's safe to assume the obvious answer here given how much weight this proposal puts on the audit trail being reliable. This should be a named decision in design.md, not an implicit inference from the fix diagram.

---

## 3. Gap — no requirement for what happens on a *blocked* promotion attempt, audit-wise

Section 5 proposes an audit/log signal for the *mismatched-state* case (membership says EM, global_role doesn't) so it "doesn't silently rot into invisibility." That's good, and correctly routed to the security analyst.

But there's a second, distinct event this proposal creates that isn't addressed at all: a TEAM-005 call that *attempts* the now-blocked promotion transition and gets rejected. Right now nothing in the notes says whether that rejected attempt should itself produce an audit event (e.g., `team.role_change_denied` or similar), separate from the plain 403/422 response to the caller.

This matters for the same reason issue #13's rate limiter emits an 80%-threshold warning event (cited approvingly in section 5 as the right shape for "distinguish an anomaly signal from a normal-path event so monitoring can find it") — a pattern of repeated blocked-promotion attempts against TEAM-005 is a meaningful security signal (someone probing the gap that used to exist), and if it's invisible to audit, nobody will ever know the fix is being tested against in production. I'd want an explicit acceptance criterion here, something like:

> AC: A TEAM-005 request that would transition `membership_role` from `participant` to `engineering_manager` is rejected with [status TBD per section 8 item 2] and produces an audit log entry distinct from a successful role change (e.g., `team.role_change_denied`), containing actor, target, team, and reason, in the same manner as a successful change.

This can piggyback on whatever the security analyst decides for section 5's signal, but it should be asked as its own question, not assumed to be covered by it — they're different states (mismatched-data-at-rest vs. rejected-write-attempt).

---

## 4. Minor — "no admin-configurable exception" needs to become a testable acceptance criterion, not stay as prose

Section 4, bullet 1 is exactly the right instinct (this is precisely the drift-to-toggle pattern I always flag), but as written it's a design principle, not something a test can verify. I'd want it translated into something like:

> AC: No feature flag, environment variable, configuration value, or admin-only override exists that permits TEAM-005 to originate a `participant → engineering_manager` transition. The restriction is unconditional in code, not gated by configuration. (Verified by code review at implementation sign-off, not by a runtime test — this is a "does this exist" check, not a "does this behave correctly" check.)

Small thing, but "verified by code review" vs. "verified by test" needs to be said somewhere or QA will go looking for a test that can't exist for this one.

---

## 5. Minor — regression test list (section 6) should add the self-targeting and (pending item 2's resolution) admin-actor cases

Section 4 states the fix must be "unconditional on identity" and explicitly calls out self-targeting as a case that must not be special-cased. Section 6's two pinned tests don't include a self-targeting variant. Given section 4 goes out of its way to name this scenario, I'd expect a third test pinning it:

> A user with EM standing on Team A uses TEAM-005 to set their *own* `membership_role` on a different team (or attempts to no-op their own role) where the transition would be `participant → engineering_manager` — same rejection as the two-account case.

And if item 2 above resolves to Option A (block for admins too), a fourth test belongs alongside it: an Application Admin attempting the same transition via TEAM-005 is also rejected, distinct from the existing "unauthorized actor" tests which cover actors who lack *any* standing to call TEAM-005 at all — this is an actor who's fully authorized to call the endpoint, just not for this transition.

---

## What's already well-specified — no changes needed

- The read-side/write-side distinction (section 3) — precise, correctly reasoned, and I wouldn't touch a word of it.
- The "not touched" boundary list (section 7) — clear, and correctly keeps issue #13 as a sibling rather than bundling it in.
- The three open items routed to design.md (section 8) — appropriately scoped to the specialists who own them, not left for the proposal to guess at. Item 2 already includes drafted UI copy, which is the right level of specificity.
- Section 5's framing of the mismatched-state question as the security analyst's call, with a reasoned recommendation attached rather than a shrug — this is the standard I want every open question held to.

---

## Summary of asks before this becomes a proposal

1. **(Blocking)** Add a task to update UC "Assign a Role to a Team Member" AC1, its Out of Scope line, and UC "Establish a Manager/Team Relationship"'s Dependencies/Notes — all three currently assert the pre-fix behavior as designed and correct. Reopen AC1 as unchecked pending the new criteria.
2. Get an explicit decision (design.md) on whether the write-side block applies to Application-Admin actors on TEAM-005, not only EM actors. I'd recommend yes, but it needs to be a stated decision, not an inference.
3. Add an acceptance criterion for whether a blocked promotion attempt itself produces a distinguishable audit event, and route it to the security analyst alongside section 5's mismatched-state question.
4. Convert "no admin-configurable exception" into a testable/verifiable acceptance criterion with a stated verification method (code review, not runtime test).
5. Add the self-targeting regression test explicitly (and the admin-actor test, contingent on item 2).
