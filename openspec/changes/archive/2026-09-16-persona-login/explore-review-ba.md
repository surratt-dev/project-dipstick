# BA Review: Persona Login Exploration Notes

**Reviewed by:** Marcus Delgado (Business Analyst)
**Source:** `openspec/changes/persona-login/exploration-notes.md` (Devon Calloway, 2026-09-16)
**Date:** 2026-09-16

---

## Overall read

The security and architecture reasoning in these notes is strong and I have nothing to add there — the double-gate, the `login_hint`-as-inert-parameter argument, and the "callback path stays untouched" property are exactly the right things to have nailed down before anyone writes code. That said, this reads like a design document with a requirements-shaped hole in the middle. It's very precise about *how the shortcut is safe* and much vaguer about *what a developer actually sees and does*, and about one decision (seed data) that changes what this feature even means. I can't hand this to the team as-is; three areas need to be resolved or made explicit before a proposal, not left as open questions inside it.

---

## 1. Production-safety gating — mostly buildable, two gaps

The double-gate itself (`isPrivateAddress(OIDC_ISSUER)` AND `NODE_ENV !== "production"`) is specific enough to build. Two things are not:

- **No defined failure response.** "Should return fast (404 or a static 'disabled' response, no DB/Redis touch)" — pick one. A 404 and a "disabled" JSON body are different contracts for the frontend to branch on, and "or" is not something an engineer can implement. I'd write this as: *when either gate check fails, `GET /auth/dev-login-options` returns `404` with no body, with no Redis/DB access on that path.*
- **"Bounded time" has no bound.** The notes call for the check to "fail open to the existing redirect within a bounded time" but never say what the bound is. This is exactly the kind of requirement that's accurate but unbuildable — an engineer has no way to know if their implementation satisfies it. Needs a number (e.g., "frontend must proceed to the standard `/auth/login` redirect if `/auth/dev-login-options` has not resolved within Xms") or an explicit statement that this is a client-side timeout requirement, not just a server-side speed goal.

**Suggested acceptance conditions to add:**
- Given `NODE_ENV=production`, `GET /auth/dev-login-options` returns 404 regardless of `OIDC_ISSUER` value.
- Given `NODE_ENV!=production` and `OIDC_ISSUER` is not a private address, `GET /auth/dev-login-options` returns 404.
- Given both gates pass, `GET /auth/dev-login-options` returns 200 with the persona list (see §3 for what that list contains).
- The frontend's dev-login-options check has an explicit timeout; if it fires, behavior is identical to a 404 response (redirect to `/auth/login`).

## 2. The persona/seed-data gap — this is a scope decision, not a refinement

This is my biggest concern, and I think Devon undersells it by filing it under "Where I landed" as an ask rather than treating it as a blocking decision. The notes are honest that today, clicking a "Manager" button produces a brand-new user with no role — not a manager. That's not a cosmetic gap. Two of my four load-bearing product concerns are **facilitator control surface** and, more directly here, the **no-manager-participation rule** — and a "Manager" persona button that doesn't produce a manager is a dev tool that cannot test the one rule it most looks like it exists to test. Same problem, one level down, for "Admin": what does clicking Admin let a developer verify, if global_role isn't set?

This needs to be decided *before* proposal, with one of two concrete answers written down — "decide, explicitly" in the notes is not itself a decision:

- **Option A (seed roles too):** Persona login also seeds `team_memberships`/`global_role` rows for the four accounts against some fixed local-dev team. If this is the direction, the proposal needs: which team (a new fixed seed team, or whichever team exists first?), what role for `manager-001` (I'd assume the "Engineering Manager" role that triggers no-manager-participation — that should be stated, not assumed), what `global_role` for `admin-001`, and whether `facilitator-001` needs to be a member of that same team to be usable.
- **Option B (defer seeding, ship the shortcut alone):** The landing page must say, in copy the proposal specifies verbatim or near-verbatim, that clicking a button logs in as that account but does not assign the implied role — and points at TEAM-005 for manual setup. "A one-line note" is not specific enough to build from; give me the actual sentence, or at minimum the acceptance condition "a first-time reader of the landing page understands, without asking, that role assignment is a separate step."

I'd lean toward Devon's instinct (Option A is the more useful tool) but instinct isn't a requirement. Whichever way this goes, it should be a stated decision in the proposal, not a caveat under the button.

## 3. What the landing page displays/does — underspecified

This is the part of the notes that most needs BA attention, because it's almost entirely absent. "A button per persona" is not enough for the team to build from without guessing. Concretely missing:

- **Button labels/content.** Role name only ("Manager")? Role name plus account id ("Manager — `manager-001`")? If Option A above ships, does the button also show team context? Given Devon's own point (#3 in his risks) that these labels currently overpromise, the label text is not a cosmetic detail — it's where the overpromise either gets fixed or doesn't.
- **Post-click behavior / error states.** What does a developer see between clicking and landing on `/team/:id`? Nothing specified. What happens if the IdP is unreachable or the callback errors — does the user land back on this same page with an error, or see whatever `auth.ts` already does today for a failed callback? I'd expect this to just inherit the existing error path, but the notes don't say so, and "not specified" reads as "not considered" to an implementation team.
- **Manual/fallback login.** Is there still a way to reach the real username/password form from this page (e.g., for someone who wants to test the actual form, or log in as an account that isn't one of the four)? Not addressed. If the answer is "no, dev-login fully replaces the form in gated environments," that's a reasonable answer but it should be a stated decision, since it forecloses testing the generic form locally at all.
- **Concurrent/multi-persona use.** Not mentioned anywhere. My top product concern is simultaneous-reveal integrity, and the main reason a developer would want four one-click personas is to open a Facilitator session in one browser context and Participants in others to exercise reveal timing. If this page doesn't say anything about whether/how a developer runs multiple personas concurrently (separate browser profiles? does clicking a second persona button clobber the first session?), the tool may not actually serve the workflow it's implicitly justified by. I'd want at least one sentence addressing this, even if the answer is "out of scope, use separate browser profiles as today."
- **Logout landing state.** Devon covers *that* logout should route here under the same gate (§5 of his risks) but not *what the developer sees* on arrival post-logout versus on first unauthenticated load — are these the same screen, or does post-logout need a "you were logged out" acknowledgment? I'd guess "same screen" is fine, but say so.

**Suggested acceptance conditions to add:**
- The landing page is reachable only when `/auth/dev-login-options` returns 200; it renders exactly the personas that endpoint lists.
- Each button's label and any qualifying copy (per §2) is specified verbatim in the proposal, not left to implementation discretion.
- Clicking a button either lands the user on `/team/:id` (success) or surfaces the same error state the existing callback failure path produces today (no new error UI to design/build).
- The proposal states explicitly whether concurrent multi-persona testing is in scope for this change or explicitly deferred.

## 4. Traceability

None of the existing use case documents are referenced. I don't think this needs a formal UC — it's dev tooling, not a ritual feature, and I'd say so explicitly in the proposal rather than leave it implicit, so nobody later asks "which UC does this satisfy?" and gets no answer. One line in the proposal ("this is internal tooling with no corresponding UC; acceptance is defined here instead") closes that off cheaply.

## 5. What's already solid — no changes requested

- The double-gate rationale, the `login_hint`-as-inert-parameter argument, and "callback path untouched" are all specific and buildable as written.
- The audit-trail position (§6 of Devon's risks — no new audit event type) is exactly right and specific enough to build: same events, same shape.
- The "visually distinct scaffolding" instinct (§4) is right in spirit but still needs the same treatment as §3 above — I'd want at least a bullet list of what "obviously scaffolding" means concretely (e.g., a persistent banner, a non-production color treatment) rather than leaving it to whoever implements the page to invent independently.

---

## Summary of blocking clarifications before proposal

1. Define the exact failure response and timeout bound for `/auth/dev-login-options` (§1).
2. Make the seed-data decision explicit — Option A or B in §2 — with the concrete details that choice implies (team, roles). This is the one item I'd treat as a hard blocker; everything else can be refined during proposal review.
3. Specify landing page content: button labels, post-click error handling, whether a manual-login fallback exists, and whether concurrent multi-persona use is in scope (§3).
4. One line stating this change has no corresponding UC and why (§4).
