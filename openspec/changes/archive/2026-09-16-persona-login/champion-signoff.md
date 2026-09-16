# Internal Champion Sign-off — persona-login

**Reviewer:** Devon Calloway
**Date:** 2026-09-16
**Verdict: Approved. No concerns that block this change.**

## Did this preserve the ritual's intent?

Yes, cleanly. This is dev-loop tooling — it removes the tax of retyping opaque account IDs against a generic OIDC form — and it never got near the four things I actually watch: no-manager-participation, simultaneous reveal, facilitator-from-another-team, no individual-level data comparison. Those live in `team_memberships`/`global_role` and session/vote logic, nowhere near sign-in, and every stage of this pipeline (exploration through sync) confirmed that boundary held rather than just asserting it. `auth.ts`'s callback handler — state/nonce/PKCE, claim validation, `session.regenerate()`, audit events — is byte-for-byte untouched; the entire shortcut lives in `login_hint` (an inert, standard OIDC parameter) plus IdP-side auto-approve in the throwaway local stub. The one thing I'd have fought — a backend-minted session skipping the IdP round-trip — was considered and explicitly rejected (D1) for exactly the reason I'd have given.

I'll also note: giving `manager-001`/`admin-001` real `global_role` values through the existing claim mechanism is a genuine improvement. It makes those buttons honest instead of aspirational, and it's the kind of fixture a team testing the no-manager rule will actually need. `facilitator-001` was correctly left unseeded rather than expanding the role-claim allowlist as a login-convenience side effect — that's a role-assignment decision, and it was recognized as one and deferred, not smuggled through.

The landing page itself did the right inverse of my usual complaint: I want the *session* UI invisible once a ritual is underway, and this page instead leans hard into looking like scaffolding — unpolished, clearly labeled, no shared chrome — precisely so nobody mistakes it for a pattern worth carrying anywhere real. That's the correct instinct applied correctly.

## Issue #104

Correctly left alone, and correctly documented as such throughout — design.md states the boundary explicitly, and both the security and architect implementation reviews independently traced the code path and confirmed the `login_hint`/persona-shortcut logic completes before the callback handler's URL reconstruction ever runs, so there's no interaction. One of #104's two bugs (the broken JWKS test key) got fixed here as a genuine scope-expansion call, not scope creep — it was blocking this change's own mechanism (D4's role claims) from being verifiable at all, was narrowly confined to the disposable local stub, and was reviewed and endorsed by both Tomás and Ingrid with the reasoning on record. The remaining bug (`request.hostname` dropping the port in `auth.ts`) is real, unrelated to authentication convenience, and correctly out of bounds for a change that committed not to touch the callback handler. I'd like to see #104 picked up soon — it currently blocks anyone from completing a real local login end-to-end, persona shortcut or manual — but that's a priority note for whoever triages the backlog next, not something this change should have absorbed.

Nothing here requires my involvement going forward. That's the outcome I want from a change like this.
