## BA Review: tasks.md (persona-login) — post-revision (D9–D12)

**Reviewer:** Marcus Delgado, Business Analyst
**Scope:** Does `tasks.md`, taken together with the revised `design.md` (D9–D12) and `proposal.md`, cover every capability/requirement in the three spec deltas (`persona-login`, `oidc-auth`, `local-dev-environment`)? Does anything get lost in translation from requirement to task?

### Verdict

Coverage is thorough and traceable. I went requirement-by-requirement against all three spec deltas and every ADDED/MODIFIED requirement has at least one task that implements it, at a level of concreteness I could hand to an engineer without them needing to come back and ask "what did you mean." One real gap below; everything else is confirmed covered.

### The two items I was specifically asked to re-check

Both are still covered after the design revision:

- **Multi-persona-use sentence on both landing page and docs (exploration-notes.md Decision 3).** Task 5.5 puts the one-line note on the landing page itself ("Each button starts a normal sign-in. To run multiple personas at once, use separate browser profiles or incognito windows"); task 8.3 puts the equivalent sentence in `docs/local-development.md`. This matches the spec's own "Multi-persona note is visible on the landing page" scenario and D7's insistence that docs-only would be a silent narrowing of the original decision. Good.
- **`seeded: boolean` field as single source of truth.** Task 1.3 has the backend emit it per persona-login spec's "Dev-login-options endpoint" requirement; task 5.5 has the frontend key the Facilitator caveat off that field rather than hardcoding account ids, matching D5 and the spec's "single source of truth" language exactly. Good — this was the concern I raised at explore stage and it's held through both propose and design revisions.

### Design revision items (D9–D12) — traced to tasks

- **D9 (new public route `/auth/dev-login` outside `ProtectedRoute`, `useNavigate()` from `AuthContext`)** → tasks 5.3, 5.4. Both the navigation-source change and the new route registration are explicit, separate task items.
- **D10 (interaction handler must resolve both `login` and `consent`)** → tasks 3.3, 3.5, 3.6. This is the one place design.md calls out as "real implementation work, not a config flip," and tasks.md treats it that way — 3.3 states the two-prompt requirement plainly, 3.6 adds a manual verification step specifically confirming no intermediate consent screen survives. Good.
- **D11 (loopback-only `oidc` port binding; `postgres`/`redis` explicitly out of scope)** → tasks 4.1, 4.2, 8.4, with the out-of-scope carve-out for `postgres`/`redis` repeated verbatim in 4.1 so it doesn't silently expand later. Good.
- **D12 (`loginHint` validated against closed account-id set, `400` otherwise)** → task 2.2 (implementation) and 2.6 (test: "400 returned for an unrecognized hint"). Good.

### Gap found: frontend/logout scenarios lack an explicit test task

Sections 1–3 (backend endpoint, login-hint passthrough, OIDC stub) each end with an explicit "Add a test covering..." item (1.4, 2.6, 3.5) that enumerates the specific conditions to assert. Section 5 (frontend landing page) and section 6 (logout gating) don't follow that same pattern — 5.1–5.7 are all implementation tasks, and 6.2 reads as a manual verification step ("Verify logout lands on...") rather than an automated test task.

This matters because the `persona-login` spec delta defines five concrete Given/When/Then scenarios for the landing page (timeout-succeeds, timeout-fails-or-times-out, button-forwards-hint, manual-link-omits-hint, multi-persona-note-visible) and two for logout gating — all directly testable, none obviously harder to automate than the backend cases. As written, there's no task-level commitment that these become automated tests rather than something an engineer eyeballs once during implementation and never revisits. Given this codebase's own convention (established in sections 1–3 of this same tasks.md) of pairing implementation tasks with an explicit test task, the absence here reads as an inconsistency rather than a deliberate choice — nothing in design.md explains why frontend scenarios would be exempted.

**Recommendation:** add an explicit test task to section 5 (e.g., "5.8 Add tests covering: dev-login-options success within timeout shows landing page, timeout/404 falls through to existing redirect, persona button forwards correct loginHint, manual link omits loginHint, multi-persona note renders") and tighten 6.2 into an automated test rather than a manual-verify step, mirroring 1.4/2.6/3.5's phrasing. This is a small addition, not a scope change — the scenarios are already fully specified in the spec delta; this only makes sure a task exists to build them into the test suite rather than leaving them to be reconstructed from the spec later.

### Everything else checked, no issues

- `oidc-auth`'s modified "OIDC authentication redirect" requirement (the narrow interstitial exception) is satisfied by the combination of the double-gate (task 1.1) and the frontend pre-check (tasks 5.1–5.4), with task 7.4 explicitly manually testing the production-like case where the exception must not fire.
- `local-dev-environment`'s modified "Simulated OIDC provider" requirement (role claims on `manager-001`/`admin-001` only) is covered by tasks 3.1, 3.2, 3.7.
- `persona-login`'s "Persona login preserves the standard authentication flow" requirement (no distinct audit event, full Auth Code + PKCE flow unchanged) is covered by verification tasks 7.1 and 7.2, plus the `hasLoginHint` addition being scoped to one existing event in task 2.4 — matches D8 precisely, no scope creep into a new event type.
- No task claims more than the design decided (e.g., nothing seeds `facilitator-001`'s role, nothing builds team-scoped facilitator fixtures, nothing builds multi-session-in-one-tab machinery) — the explicit non-goals in design.md are honored by omission, not contradicted anywhere in tasks.md.
