# Exploration Notes: Persona Login

**Explored by:** Devon Calloway (Internal Champion / founding advisor), via `opsx:explore`
**Date:** 2026-09-16 (revised 2026-09-16 after explore-stage review)
**Status:** Pre-proposal exploration. Not yet formalized as an OpenSpec change with tasks.
**Revision note:** Updated in response to `explore-review-facilitator.md` (Priya Nair) and `explore-review-ba.md` (Marcus Delgado), both of which converged on the same core issue — persona labels overpromising roles the app doesn't grant — and pushed for firm decisions instead of "decide, explicitly." See "Response to explore-stage review" below for what's now decided, what I rejected, and why.

---

## Framing the problem

This is dev-loop friction, not a product feature. Every reload during local development throws a developer at a generic username/password HTML form and asks them to already remember which of four opaque account IDs (`participant-001`, etc.) they need, then retype it. That's a tax on the thing I actually care about here — teams adopting the ritual without needing me in the room — because it's paid by engineers *building and testing* the application, not by the engineers *using* it. It's legitimate to remove, and it's the kind of thing that quietly determines whether contributors bother running the app locally at all versus reading the diff and trusting CI.

The one thing I'm watching for reflexively: does convenience tooling like this have any gravitational pull toward loosening a real constraint? None of my four load-bearing rules (no-manager-participation, simultaneous reveal, facilitator-from-another-team, no individual-level data surfacing) live anywhere near authentication. They're enforced at `team_memberships.role` / `global_role` and in session/vote logic, not in the sign-in flow. So on the merits, this is orthogonal to the things I'd fight about. I still want to be sure it stays orthogonal in the implementation, not just in intent — see risks below.

---

## Grounding: how sign-in actually works today

```
Browser                Backend (Fastify)              Redis            Local OIDC stub (docker/oidc/server.js)
   │                        │                            │                         │
   │  GET any route         │                            │                         │
   │  (no session) ─────────▶ AuthContext: fetch          │                         │
   │                        │  /auth/session → 401        │                         │
   │  ◀──────────────────── window.location =             │                         │
   │                          /auth/login                 │                         │
   │                        │                            │                         │
   │  GET /auth/login ──────▶ generate state/nonce/PKCE   │                         │
   │                        │  store in Redis (10 min) ──▶│                         │
   │                        │  redirect → IdP authZ URL   │                         │
   │  ◀──────────────────── 302                            │                         │
   │  ─────────────────────────────────────────────────────────────────────────────▶│
   │                                                        devInteractions: plain   │
   │  ◀─────────────────────────────────────────────────────  username/password form│
   │  type "manager-001" / "password" ─────────────────────────────────────────────▶│
   │  ◀─────────────────────────────────────────────────────  302 → /auth/callback  │
   │  GET /auth/callback ───▶ getdel state (atomic,        │                         │
   │                          single-use) ◀─────────────────│                         │
   │                        │  exchange code, verify        │                         │
   │                        │  nonce/PKCE, validate sub/iss  │                         │
   │                        │  resolveOrCreateAccount        │                         │
   │                        │  session.regenerate()          │                         │
   │                        │  redirect → /team/:id           │                         │
```

Key files: `packages/backend/src/routes/auth.ts`, `packages/backend/src/auth/oidc-client.ts`, `packages/frontend/src/auth/AuthContext.tsx`, `docker/oidc/server.js`, `packages/backend/src/config.ts`.

Three things stood out as directly relevant:

1. **`isPrivateAddress()` (`config.ts:22-46`) is already load-bearing for exactly this kind of risk.** At boot, `loadConfig()` calls `process.exit(1)` if `NODE_ENV === "production"` and `OIDC_ISSUER` resolves to `localhost`/`127.0.0.1`/`0.0.0.0`/RFC1918. That's a *fail-closed, startup-time* guard against the simulated IdP ever backing a production deployment. Reusing this function for a request-time check is reusing an already-trusted judgment, not inventing a new one — I like that. It means "is this environment allowed to shortcut auth" has one definition in the codebase, not two that can drift.

2. **The devInteractions form is generic on purpose** — it's a library default (`oidc-provider`'s `features.devInteractions`), not something this codebase built or maintains. It doesn't know about "personas" at all; it's just asking for any registered account's id/password. So today there's no concept of "persona" anywhere in the system except as informal convention in `docs/local-development.md`.

3. **The four seeded accounts are IdP-only, not application-seeded.** `docker/oidc/server.js:8-33` seeds `participant-001` / `facilitator-001` / `manager-001` / `admin-001` into the stub IdP's *in-memory* account store. There is no matching row in `packages/backend/migrations/4_seed_data.sql` or anywhere else in the repo for these four identities — I grepped for all four account IDs across `.sql`/`.ts`/`.js`/`.md` and the only hits are `docker/oidc/server.js` and `docs/local-development.md`. And `docs/local-development.md:114` already says this explicitly: *"the application-level role... is assigned separately and may differ from the account's implied role above until seed data is applied."* So today, logging in as `manager-001` doesn't make you an Engineering Manager in the app — it makes you a brand-new user with no team memberships, same as any other First Access (per `UC: First Access`). The "Manager" label is aspirational, describing what the account is *for*, not a guarantee of what `resolveOrCreateAccount` will produce.

That last point matters for **this** feature's honesty. If the persona-login landing page presents a "Manager" button, a developer will reasonably expect clicking it gets them a user who behaves like a manager (e.g., to test the no-manager-participation rule). Today it won't, unless they've separately used TEAM-005 (`Assign a Role to a Team Member`) to set that up by hand for that account in their local DB. That's a pre-existing gap, not something this change introduces — but this change is exactly the kind of surface that will make people *notice* the gap, because it's inviting them to treat these four accounts as ready-made role fixtures. Worth deciding whether "Persona Login" quietly also implies seeding matching `team_memberships`/`global_role` rows for these four accounts in local dev, or whether the landing page should be explicit that role assignment is a separate step. I'd lean toward the former eventually (it's the more useful dev tool) but it's a scope question, not a blocker for the login-shortcut mechanism itself.

---

## Evaluating the sketch

The sketch given to me (before this exploration) proposes:

- `GET /auth/dev-login-options` — new endpoint, gated by `isPrivateAddress(config.OIDC_ISSUER)`
- `AuthContext.tsx` — check that endpoint before its current unconditional `401 → window.location.href = "/auth/login"` (`AuthContext.tsx:45-49`)
- `/auth/login` — gains optional `loginHint`, passed through as the standard OIDC `login_hint` param
- `docker/oidc/server.js` — replace `devInteractions` with a `login_hint`-aware auto-approve interaction handler; falls back to the real form when `login_hint` is absent/unrecognized

I like this shape a lot, for a specific reason: **it keeps the entire security-relevant path in `auth.ts` and `oidc-client.ts` completely untouched.** State generation, nonce, PKCE, the atomic `getdel` single-use state check, claim validation (`MissingClaimError` for empty `sub`/`iss`), `session.regenerate()`, audit events — none of it changes. The shortcut only ever decides *which account the IdP's interaction screen auto-selects*; the callback still runs the full Authorization Code + PKCE exchange and the app still can't tell a persona-login from a manually-typed one. That's the property I actually care about: the acceptance criteria in `UC: Sign In` ("Session is created only after a valid identity provider assertion is received") stay true without qualification, dev shortcut or not. If a future engineer proposed instead having the *backend* mint a session directly for a `loginHint` and skip the IdP round-trip entirely, I'd push back hard — that's a different, much riskier shape, because it puts a live bypass of the OIDC exchange inside `auth.ts` itself rather than confined to the throwaway container. `login_hint` is the right lever specifically because it's a standard, inert OIDC parameter that a real IdP either respects cosmetically (pre-fills a login field) or ignores — it can never cause a real IdP to skip authentication.

That gives two independent gates that both have to be true for the shortcut to activate at all:

```
                    ┌─────────────────────────────┐
                    │ isPrivateAddress(OIDC_ISSUER) │  ← backend: is /auth/dev-login-options
                    │   (config.ts, already exists) │    even exposed?
                    └──────────────┬────────────────┘
                                   │
                    ┌──────────────▼────────────────┐
                    │ IdP recognizes login_hint AND   │  ← only docker/oidc/server.js
                    │ has auto-approve interaction     │    has this behavior at all
                    │ handler wired up                 │
                    └──────────────┬────────────────┘
                                   │
                          auto-login succeeds
```

Even in the unlikely case where a shared, non-production environment legitimately points `OIDC_ISSUER` at a private-address IdP (e.g. an internal staging IdP on a VPN, not this repo's stub), gate 1 would open but gate 2 would not — a real IdP has no reason to implement this repo's `login_hint` auto-approve convention, so it just renders its real login screen. The two gates fail closed independently, which is the property I want from defense-in-depth: no single mistake collapses it.

---

## Risks and open questions I'd flag before this becomes a proposal

1. **Belt-and-suspenders at the endpoint itself.** `isPrivateAddress(config.OIDC_ISSUER)` alone is currently *equivalent* to `NODE_ENV !== "production"` in practice, because production refuses to boot with a private-address issuer. But that equivalence is enforced by a *different* function (`loadConfig`'s fatal exit) than the one `/auth/dev-login-options` would check. If someone later refactors `loadConfig()` and drops that exit — plausible, it's just one `if` block among several production guards — the runtime endpoint becomes the only remaining line of defense, and it'd be silently relying on an invariant that's no longer enforced anywhere. I'd want `/auth/dev-login-options` to check **both** `isPrivateAddress(config.OIDC_ISSUER)` **and** `config.NODE_ENV !== "production"` explicitly, redundantly, at the point of use. Two independent checks that happen to agree today is cheap insurance against one of them being removed tomorrow without anyone noticing this endpoint depended on it.

2. **The extra round-trip on every unauthenticated load, in every environment.** The sketch has `AuthContext.tsx` call `/auth/dev-login-options` before its existing redirect-to-login-on-401 logic — for *all* users, not just local dev ones, since the frontend can't know in advance whether it's talking to a gated-off backend. In production this endpoint should return fast (404 or a static "disabled" response, no DB/Redis touch) so it doesn't add meaningful latency or a new failure mode to the real sign-in path. Worth stating as an explicit requirement: this check must fail open to the existing redirect within a bounded time, and a slow/unreachable `/auth/dev-login-options` must never block or delay production sign-in.

3. **Persona labels currently overpromise a role the app doesn't grant.** Covered above — flagging again here because it's the kind of drift that's easy to backfill later ("we'll fix the seed data eventually") and easy to forget once the login buttons exist and *look* authoritative. If this ships without matching `team_memberships` seed data, the landing page copy should say so plainly (e.g., a one-line note under the Manager/Admin buttons) rather than implying the click alone tests those role's restrictions.

4. **Visual distinctness, deliberately in the opposite direction from the rest of the product.** Elsewhere in this project I want the *session* UI to disappear into the background so the ritual feels like a conversation, not software. This page is the inverse case: I want it to look obviously like scaffolding — clearly labeled as a local-dev tool, visually distinct from anything a real user would see — specifically so nobody on the team builds muscle memory that mistakes it for how sign-in is "supposed" to work, and so it can never be mistaken for a UX pattern worth carrying into a real environment. A shortcut that looks too polished is more likely to get proposed for staging "just for demos" someday. Keep it looking like a harness.

5. **Logout destination change is in-scope and needs the same gate, not a separate one.** The request routes logout back to this landing page instead of the generic OIDC form. That's a frontend routing decision downstream of the same `/auth/dev-login-options` check — it shouldn't introduce a second, independently-maintained notion of "are we local." One source of truth for "is the dev shortcut active," checked wherever the frontend needs to branch (initial 401 redirect, post-logout redirect).

6. **Audit trail stays honest.** Because the callback path is untouched, `auth.success`, `auth.first_access_created`, `auth.session_created` etc. all fire exactly as they would for a manually-typed login — there's no separate "dev login" audit event and I don't think there needs to be one. It's a real OIDC assertion from the app's point of view; the audit log shouldn't need a special case to describe it accurately. Worth confirming this stays true rather than someone adding a `via: "persona-shortcut"` audit field that then has to be maintained forever for an event that only ever fires in an environment nobody audits.

---

## Response to explore-stage review (Priya Nair, Marcus Delgado)

Both reviews landed on the same thing from different angles: the persona labels currently overpromise, and "decide, explicitly" wasn't itself a decision — fair. Deciding now, and I went back into the code and specs rather than just asserting, because the actual mechanism underneath each answer changes what's cheap and what's scope creep.

### Decision 1 — seed data: yes for `manager-001` and `admin-001`, explicitly no for `facilitator-001`

I found something that changes the shape of "Option A" from Marcus's framing: it's much cheaper than a new seed script, at least for the two accounts that matter most.

`resolveOrCreateAccount` (`packages/backend/src/auth/account-resolver.ts:88-133`) already re-derives `users.global_role` from an ID token role claim (`OIDC_ROLE_CLAIM`, default `role`) on **every** login, allowlisted to `engineer` / `engineering_manager` / `application_admin` (`PERMITTED_GLOBAL_ROLES`, `account-resolver.ts:44-48`). That's the existing mechanism from `establish-manager-team-relationship` (Decision 2). And per `openspec/specs/session-participation/spec.md:13`, the no-manager-participation check is `users.global_role = 'engineering_manager' OR team_memberships.role = 'engineering_manager' for that team` — an OR. **`global_role` alone is sufficient to trigger the block.** No `team_memberships` row, no seed team, no new database seeding mechanism required.

So the actual change: add a `role` claim to `manager-001` (`engineering_manager`) and `admin-001` (`application_admin`) in `docker/oidc/server.js`'s account definitions (today they carry no role claim at all — I checked). On next login, the existing `mapRoleClaimToGlobalRole` path sets the correct `global_role` automatically, re-evaluated every sign-in, exactly as it would from a real IdP asserting the claim. This is the same move as reusing `isPrivateAddress()` — an already-built, already-trusted mechanism, not a new one — and it's two lines in a test-fixture file, not a seed script. It directly answers Priya's sharpest point: click "Manager," get an account the session-participation endpoint will actually reject as a participant. That's a real test of the rule, not a simulated one.

This does **not** extend to `facilitator-001`. `facilitator` is not in `PERMITTED_GLOBAL_ROLES` — the claim allowlist stops at the three roles above. Getting `facilitator-001` an actual `global_role = 'facilitator'` would mean either (a) expanding that allowlist, which changes what a real IdP's role claim is trusted to assert — a `role-assignment`/`session-participation` decision, not something to smuggle into a login-convenience change — or (b) a bespoke database seed path that the manager/admin case doesn't need at all. I'm rejecting both here. `facilitator-001` keeps behaving exactly as it does today: a fresh `engineer`-role account with no team memberships on first login. The landing page must say so for that one button specifically, not lump it in with the other three as "seeded" — see Decision 6.

`participant-001` needs no change — the default (`engineer`, no team membership) already matches its label honestly.

### Decision 2 — facilitator-from-another-team fixtures: rejecting the scope expansion, on the record

Priya's ask for a second, team-scoped facilitator identity so "does the app block same-team facilitation" is actually testable: I agree it's a real gap, and I'm saying no to closing it in this change. It would require a fixed local-dev team to scope against, plus a facilitator identity that's actually a *member* of that team to exercise the blocked case — and per Decision 1, `facilitator` isn't even reachable through the claim mechanism, so this would need real seed infrastructure the login shortcut doesn't otherwise require. That's a second, separable piece of work — richer local-dev fixture data — riding in on a login-convenience change. If it's worth having, it earns its own proposal.

What ships instead: the landing page notes, directly next to the Facilitator button, that a single facilitator identity doesn't exercise cross-team enforcement, and that constructing that scenario today means manually creating a second facilitator via the role-assignment tooling that already exists (TEAM-005/TEAM-006). Known limitation, stated, not silently assumed away — the minimum bar Priya asked for even where she doesn't get the fixture.

### Decision 3 — concurrent multi-persona use: in scope as a documented pattern, out of scope as new engineering

Marcus is right this is arguably the main reason a 4-button tool like this exists — open a Facilitator session in one browser context, Participants in others, and watch reveal timing. The good news: nothing needs to be built. Sessions are ordinary cookie-scoped backend sessions; separate browser profiles or incognito windows already get independent sessions today, with the manual form, exactly as they would with persona buttons — this is unrelated to the shortcut mechanism. I'm rejecting any bespoke multi-session-in-one-tab machinery for this change: that would mean the login shortcut carrying its own session-switching logic, real new surface area for a tool that's supposed to disappear into the background, in service of a problem the browser already solves. What I am committing to: one explicit sentence, on the landing page and in `docs/local-development.md`, saying so — "each button starts a normal sign-in; to run multiple personas at once, use separate browser profiles or incognito windows." Silence was the actual bug here, not missing functionality.

### Decision 4 — `/auth/dev-login-options` failure contract

Adopting Marcus's suggested contract as written: `404`, no body, whenever either gate fails (`NODE_ENV === "production"`, or `isPrivateAddress(config.OIDC_ISSUER)` false), with no Redis/DB access on that code path. And a number for the bound: the frontend's fetch gets an explicit 300ms client-side timeout; if it hasn't resolved by then, behavior is identical to a 404 — proceed straight to the existing `/auth/login` redirect. 300ms because this is a same-origin call to a server that's either saying "no" instantly (production) or sitting right in the local dev stack — anything slower is itself a signal something's wrong, and production sign-in shouldn't be made to wait on it either way.

### Decision 5 — manual login stays reachable

Yes. The landing page keeps a plain link to the real `/auth/login` flow (no `login_hint`), both so the generic form itself stays testable locally and so someone can sign in as an account that isn't one of the four. Cheap to keep, forecloses nothing, and Marcus is right that silently dropping it would be a real decision dressed as an omission.

### Decision 6 — landing page, concretely

Per Priya's ask for something checkable instead of a vibe:

- A full-width banner at the top, high-contrast/non-product color treatment — deliberately not the app's session-UI palette — reading "LOCAL DEV ONLY — PERSONA LOGIN." This banner is the "obviously scaffolding" bar: if a screenshot of this page could pass for a screenshot of the product, it's failed.
- Four buttons, one per account, each labeled with role name **and** account id: "Engineering Manager — manager-001", "Application Admin — admin-001", "Participant — participant-001". The Facilitator button is labeled with the account id alone — "facilitator-001" — not the role name (see Decision 1), with a one-line caveat directly beneath it, not a tooltip or footnote: "Role not seeded — signs in as a default user, not a Facilitator. Single identity; does not test cross-team facilitation (see docs)."
- Below the four buttons, a plain-text link: "Sign in manually" → `/auth/login` with no `login_hint`.
- Nothing else. No app navigation, no styling shared with any real screen.

### Decision 7 — no new UC

Agreeing with Marcus: this is internal tooling with no corresponding use case. One line to that effect goes in the proposal so nobody goes looking for one later.

---

## Where I landed

The overall shape (`login_hint` passthrough + IdP-side auto-approve + reused `isPrivateAddress` gate) is sound and doesn't touch anything I'd consider load-bearing to the ritual's integrity. Going into the propose stage, these are now decisions, not open questions:

- Double-gate `/auth/dev-login-options` on `isPrivateAddress(OIDC_ISSUER)` AND `NODE_ENV !== "production"`, not either alone. On failure: `404`, no body, no Redis/DB access (Decision 4).
- Frontend's dev-login-options check carries an explicit 300ms client-side timeout; a miss behaves identically to a 404 (Decision 4).
- `manager-001` and `admin-001` get real `global_role` values via the existing IdP-role-claim mechanism (no new seed infrastructure); `facilitator-001` and `participant-001` do not — the landing page says so per-button where it matters (Decisions 1, 6).
- Team-scoped facilitator fixtures for testing facilitator-from-another-team are explicitly out of scope for this change — documented as a known limitation, not built (Decision 2).
- Concurrent multi-persona use needs zero new engineering — separate browser contexts already provide it — but the landing page and docs must say so explicitly rather than stay silent on it (Decision 3).
- Manual login (`/auth/login`, no `login_hint`) stays reachable from the landing page (Decision 5).
- Landing page layout is specified concretely, not left to implementation discretion (Decision 6).
- No new UC; one line in the proposal says so (Decision 7).
- Keep the landing page visually unmistakable as dev-only scaffolding.
- No new/divergent audit-event path for persona logins — same events, same shape, as any other sign-in.

None of these are blockers to starting a proposal — they're the refinements that now belong in `design.md`, decided rather than deferred.
