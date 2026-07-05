# Champion Sign-Off — first-access
**Author:** Devon Calloway, Internal Champion
**Date:** 2026-07-05
**Status:** Signed off

---

## Assessment

I reviewed the archived proposal, design, both implementation reviews, the final spec, and the three implementation files directly. The change is signed off. My reasoning follows.

---

## Ritual Intent

The no-team landing state is correct in the way that matters most: it gives a new user exactly one instruction and makes fulfilling that instruction dependent on another person — the facilitator. The page tells you that you are not a member of any team, asks you to get a join link from your facilitator, and reassures you that nothing else is required on your end. That is the right thing to say, and it is the only thing the page says.

There is no "create a team" affordance, no "request access" form, no suggested next steps beyond waiting. The proposal documents the exclusion of team creation explicitly, and the reasoning is correct: offering team creation on the no-team page would give an engineer a path that bypasses the facilitator-from-another-team constraint. The omission is deliberate and I want it on record that it was the right call.

The sign-out affordance is the only interactive element. The loading guard is in place. The implementation matches what the spec describes.

---

## Core Constraints

### No manager participation

This change does not directly handle the no-manager rule — that belongs to the session join workflow — but I checked for footholds and found none. Account creation produces a record with no team memberships and no roles. There is no role-assignment logic anywhere in this code path. Nothing here makes it easier or harder to enforce the no-manager rule in subsequent work. Clean.

### Facilitator-from-another-team

Same answer: not directly in scope, and no foothold created. As noted above, the explicit exclusion of team creation from the no-team page is itself a guard. An engineer who arrives at the no-team page cannot do anything except sign out and wait. That is correct.

### No-team page — one instruction, no additional affordances

Verified against the implementation directly. The rendered page contains:
1. The user's display name
2. A statement of no team membership
3. An instruction to ask the facilitator for a join link
4. A reassurance that no further setup is required
5. A sign-out button

Nothing else. No navigation, no sidebar, no feature menus, no hidden links. The routing structure enforces this at the layer where it needs to be enforced — the `/no-team` route is not inside any layout wrapper — and a regression test locks that state so drift cannot happen silently.

---

## Constraints as Structure, Not Configuration

Every structural constraint in this change is enforced by code and database schema, not by configuration or convention.

The sub/iss identity key is enforced by the SQL ON CONFLICT clause and by a comment explicitly prohibiting email from the WHERE or ON CONFLICT path. The session creation ordering is enforced by the exception path: if account resolution throws, no session is established. The layout isolation is enforced at the routing layer with a test that will fail if a navigation element appears. The missing-claims rejection uses typed errors and fires before the database is touched. None of these are admin toggles. None of them are defaults that can be changed.

This is what I asked for when I said these constraints needed to be structural. This is what was delivered.

---

## Open Issues

Eight issues are tracked. I reviewed all of them. None threaten the ritual.

The security and audit issues (#2 through #7) are genuine and should be resolved before production deployment, but they are operational concerns — logging fidelity, audit trail completeness, test coverage for edge cases. They do not affect what a user experiences or what the application permits or prevents.

Issue #8 — the isNewUser SELECT-before-upsert race — is the one that requires ongoing vigilance. The code comment and the spec entry are clear: before any feature that consumes isNewUser is merged, the pattern must change or the consumer must treat duplicate firings as idempotent. The current consumer (the first_access_created audit event) is safe. I am flagging this because it is the kind of constraint that disappears when the engineer who wrote the comment leaves the team. It needs to be on the checklist for any PR that touches account resolution or adds a new isNewUser consumer, not just the code.

The `{sub}@unknown` email fallback is acknowledged technical debt. It is not a ritual concern. It should be cleaned up but it does not affect what engineers say or do in a session.

---

## Sign-Off

This change does what it was supposed to do. The on-ramp to the ritual is now automatic, invisible, and structurally correct. A new engineer can authenticate and land somewhere that tells them exactly what to do — ask their facilitator — without any affordance that would let them bypass that relationship or act independently.

The open issues should be closed before production deployment, not after. Issue #8 must be enforced in PR review going forward.

Signed off.
