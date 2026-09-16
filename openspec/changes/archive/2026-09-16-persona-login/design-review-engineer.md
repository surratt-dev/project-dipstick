# Engineering Review — Persona Login Design

Reviewer: Marcus Oyelaran (Full Stack Engineer)
Scope: `openspec/changes/persona-login/design.md`, cross-checked against `packages/backend/src/routes/auth.ts`, `packages/backend/src/auth/oidc-client.ts`, `packages/backend/src/auth/account-resolver.ts`, `packages/backend/src/config.ts`, `packages/frontend/src/auth/AuthContext.tsx`, `packages/frontend/src/App.tsx`, `packages/frontend/src/auth/ProtectedRoute.tsx`, `docker/oidc/server.js`.

## Verdict

Implementable, and the backend/security boundary is genuinely clean. Two things are underspecified relative to how much design.md implies they'll cost: the frontend "render the landing page instead of redirecting" step, and the local IdP's interaction-handler replacement. Neither is a redesign — both are scoping gaps in tasks.md that will cause a mid-implementation surprise if not called out now.

## Boundary check: does the bypass leak into auth.ts / oidc-client.ts?

No, and this is the part of the design I have the fewest notes on. I read the full callback handler (`auth.ts:61-296`) and `oidc-client.ts` end to end looking for a seam the shortcut could exploit, and didn't find one:

- `/auth/login`'s only change is one new optional querystring field forwarded into `buildAuthorizationUrl`'s params object. `login_hint` is a real, standard authorization parameter that `openid-client` already passes through untouched — no new code path, no branch on whether it's a "persona" login.
- `/auth/callback` is untouched. State `getdel`, nonce/PKCE verification, `sub`/`iss` presence checks, `resolveOrCreateAccount`, `session.regenerate()`, and every audit event fire identically regardless of how the browser arrived at the IdP's login screen. I confirmed `resolveOrCreateAccount` (`account-resolver.ts:88-153`) has zero awareness of login_hint or persona concepts — it only ever sees ID token claims, same as today.
- `/auth/dev-login-options` is a new, independent, read-only endpoint. It doesn't touch session, Redis, or DB on any path (confirmed against D2/D1.2).

D1's rejection of a backend-minted session is the correct call and matches how I'd want this scoped — the moment `auth.ts` can create a session without a token exchange, that code path is live for every login, not just the four dev buttons, and now carries production blast radius. Confining the "skip the form" behavior to the throwaway IdP container is the right boundary.

One nit on D2: the double gate is good instinct, but note it's *currently* fully redundant — `loadConfig()` already refuses to boot in production with a private-address issuer (`config.ts:85-90`), so today there is no reachable state where `NODE_ENV==="production"` and `isPrivateAddress(OIDC_ISSUER)` disagree. That's fine — D2 says as much and the insurance is cheap — just don't let anyone read this as "the endpoint is the first line of defense," it's the second, by design.

## Gap 1: the frontend "render the landing page" step needs a routing decision the design doesn't make

`AuthContext.tsx:39-60` today does a hard `window.location.href = "/auth/login"` from inside `fetchSession()` — a full browser navigation, not a React Router transition. `AuthContext` renders nothing conditionally; it's a pure provider (`<AuthContext.Provider>{children}</AuthContext.Provider>`), and the actual "show nothing until authenticated" gating lives in `ProtectedRoute.tsx`, which only wraps *some* routes (`/auth/error`, `/join-error`, `/auth/loading` are outside it, per `App.tsx`).

Task 4.3 says "on success within timeout, render the persona login landing page instead of redirecting immediately." That sentence has an implicit architectural decision buried in it: *where* does that rendering happen? Two real options, with different consequences:

- **(a) AuthContext/AuthProvider grows the ability to render a full-page UI itself** (branch on landing-page-vs-children inside the provider). This works, but it's a layering change — the context that's supposed to carry auth *state* starts making page-level rendering decisions, and it would fire for every route AuthProvider wraps, including ones outside ProtectedRoute. Concretely: `AuthErrorPage.tsx` is already inside `AuthProvider` and already gets clobbered by today's unconditional redirect-on-401 (an existing behavior, not introduced by this change) — option (a) would mean the persona landing page could render on top of the error page too, unless something explicitly excludes it.
- **(b) Keep AuthContext's existing responsibility (decide where to navigate) and add a new client-side route** (e.g. `/auth/dev-login`, public like `/auth/error`) that owns the landing page component. `fetchSession()`'s 401 branch calls `/auth/dev-login-options`; on success, navigate to the new route instead of straight to `/auth/login`; on miss/timeout, unchanged. This is a much smaller, more consistent-with-existing-patterns change and doesn't touch how any other page renders.

I'd push for (b) — it's less code, doesn't change what AuthContext is responsible for, and doesn't reopen the `/auth/error`-gets-clobbered question that already exists independent of this change. tasks.md 4.1–4.3 should say this explicitly rather than leaving "render... instead of redirecting" to be resolved improvisationally during implementation.

## Gap 2: `docker/oidc/server.js`'s interaction handler is more than task 3.3 implies

Task 3.3 reads as a one-line swap: "Replace the `devInteractions` feature with a custom interaction handler." In `node-oidc-provider` (v8, per `docker/oidc/package.json`), `devInteractions` isn't just a login form — it also serves the **consent** prompt (the app is requesting `offline_access`, which routes through the consent interaction on top of login). Today, a manual sign-in through the stub likely already clicks through two devInteractions-rendered screens, not one.

To get the "one click, instant sign-in" outcome the landing page promises, the custom interaction handler needs to resolve *both* the `login` and `consent` interaction reasons via `provider.interactionFinished()` when `login_hint` matches a known account — not just auto-fill the login step and fall through to a manual consent click. If it only handles login, every persona button still ends on a manual "allow access" screen, which technically satisfies "falls back to a form" per task 3.4's letter but defeats the feature's actual goal. Worth adding to task 3.3/3.5 explicitly: verify (or write the interaction handler to confirm) that resolving login auto-resolves consent for this client, or resolve both in the same `interactionFinished()` call.

This is real implementation work — registering an interaction route that intercepts before oidc-provider's own devInteractions router, calling `interactionDetails()`/`interactionFinished()` correctly, and falling back cleanly — not a config flag flip. Sizing it accordingly avoids a mid-sprint surprise.

## Answering the specific "hidden coupling" question

The `/auth/dev-login-options` succeeds → subsequent `/auth/login` redirect 404s scenario the design was asked to consider: this can't actually happen at runtime. Both checks read the same in-process `config` object, computed once at boot (`config.ts:48-93`) and never mutated. There's no window where the gate passes and then the route it gates disappears — `/auth/login` is unconditionally registered regardless of environment. Not a gap; confirming this is worth stating in design.md's Risks section so a future reader doesn't go looking for a race that isn't there.

The "mock IdP's login_hint doesn't match any account" path is handled correctly by task 3.4's explicit fallback — the one thing I'd add is a test asserting *unrecognized* hint (not just absent hint) exercises the same fallback branch, since those are two different code conditions that are easy to accidentally conflate into one `if (login_hint)` check.

## Tech choices

`login_hint` as a passthrough param and `buildAuthorizationUrl`'s params object accepting it directly — both correct and idiomatic for `openid-client`; no concerns. D4's reuse of the existing role-claim mechanism instead of new seed infrastructure is the right call and is exactly the kind of "don't build machinery two accounts don't need" instinct I'd apply myself.

## Summary of asks

1. tasks.md 4.1–4.3: specify the routing mechanism (recommend a new public client route, not AuthProvider-level render branching).
2. tasks.md 3.3/3.5: call out that the interaction handler must resolve consent as well as login to deliver true one-click sign-in; add explicit verification for this.
3. tasks.md 3.4: add a test case for *unrecognized* (not just absent) `login_hint`, distinct from the absent case.
4. design.md Risks: note that the dev-login-options-succeeds/then-login-404s scenario is structurally impossible given config is computed once at boot — worth stating so it's not re-litigated later.
