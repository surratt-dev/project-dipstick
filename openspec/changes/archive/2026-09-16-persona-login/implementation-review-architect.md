# Architect Implementation Review — persona-login

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Verification that the implementation matches design.md D1–D12, not just that it compiles and passes tests. Reviewed via `git diff` against the working tree (uncommitted changes on `agent-team/persona-login`) plus direct reads of the resulting files.

## Verdict

**Approved.** The implementation matches the design faithfully, including in the places most likely to erode under implementation pressure — the security boundary between the throwaway stub and the real auth path, and the layering boundary between `AuthContext` and the new landing-page route. Both deviations that involved judgment calls (D2's endpoint, the two stub bug fixes) were handled correctly. I have one minor finding, no blockers.

## Boundary verification (the thing I actually care about)

Read the full diffs of `packages/backend/src/routes/auth.ts`, `packages/backend/src/auth/oidc-client.ts`, and `packages/backend/src/auth/middleware.ts` line by line, not summaries.

- **`GET /auth/callback` is untouched.** Confirmed by diffing `auth.ts` and by reading the full current file (`routes/auth.ts:116-352`) — state `getdel`, nonce/PKCE verification via `handleCallback`, `sub`/`iss` claim validation, `session.regenerate()`, and every audit event (`auth.callback_received`, `auth.first_access_created`, `auth.role_claim_mapped`, `auth.session_created`, `auth.success`, `auth.failure`) are byte-for-byte what they were before this change. Nothing in the diff touches this handler.
- **`oidc-client.ts` changes are a single additive parameter.** `getAuthorizationUrl` gains an optional `loginHint` that, when present, spreads one extra key (`login_hint`) into the existing `buildAuthorizationUrl` params object. State, nonce, and PKCE code-challenge generation are unmodified. `login_hint` is inert per D1's reasoning — it can only pre-select which account the IdP's own interaction screen offers, never skip the exchange.
- **The real security boundary is `docker/oidc/interactions.js`**, which is new, local-stub-only code, not a modification to shared auth infrastructure. This is exactly where D1 says the shortcut should live.

The boundary holds. This was the thing most likely to have quietly regressed under "just add a login_hint," and it didn't.

## D2 / D5 — `GET /auth/dev-login-options`

Read the live handler (`routes/auth.ts:49-63`). Confirmed:
- Double gate is two independently-evaluated conditions in one `if`: `config.NODE_ENV === "production" || !isPrivateAddress(config.OIDC_ISSUER)`, not a single derived boolean — matches D2's "evaluated independently" intent (either condition alone is sufficient to 404).
- `isPrivateAddress` was exported with a one-line-turned-nine-line comment documenting its known coverage gaps (no IPv6, no DNS resolution, no obfuscated-literal handling) directly at the definition in `config.ts` — exactly what D2 called for, and it's honest about the limitation rather than overselling the check.
- Gate check is the literal first statement, before any `await` — `reply.code(404).send()` with no body, no Redis/DB access reachable on that path. Verified by reading the handler; also asserted in `auth.test.ts`'s three `dev-login-options` tests, one of which explicitly checks `mockDbQuery`/`mockRedisSetex`/`mockRedisGetdel` were never called on a 404.
- `seeded` flag is present per-option (`DEV_LOGIN_OPTIONS` in `auth.ts:38-43`) and matches D5: only `facilitator-001` is `seeded: false`. The frontend (`DevLoginPage.tsx:79-86`) renders the caveat purely off that field — no hardcoded account-id list on the frontend side, so the two sides can't drift, exactly as D5 requires.

## D9 — layering

This is the decision most vulnerable to scope creep in an implementer's hands, so I read it closest. `AuthContext.tsx`'s diff adds exactly one thing to `AuthProvider`'s existing responsibility: a `navigate("/auth/dev-login")` call inside the same `if (response.status === 401)` branch that already decided where to go. It does not render anything conditionally, does not grow a landing-page branch, does not touch `ProtectedRoute`. The landing page itself lives entirely in a new component (`DevLoginPage.tsx`) mounted via a new, ordinary public route in `App.tsx`, registered alongside `/auth/error` and `/auth/loading` — the existing pattern for `ProtectedRoute`-external routes. `AuthProvider`'s job is still "decide where to navigate," never "what to render." D9 holds.

The 300ms timeout (D3) is implemented via `AbortController` + `setTimeout`, fails to `false` (proceed to hard redirect) on both non-OK response and any thrown error (timeout or network), and is unit-tested with fake timers exercising the actual 300ms boundary (`AuthContext.test.tsx`, "falls through ... when dev-login-options times out"). Correct and matches D3's stated fail-open direction in every environment, not just production.

## D10 — login + consent

Read `docker/oidc/interactions.js` in full. The GET handler branches on `prompt.name`, calling `provider.interactionFinished()` for `login` when hinted, and separately for `consent` when hinted (including building the grant via `grantConsent`, which mirrors `devInteractions`' own grant-creation logic — scope, claims, resource scopes). This is exactly D10's requirement: both interaction reasons resolved, not just `login` with a stray manual consent screen. The POST handler (manual form submission) is preserved as the fallback and is structurally parallel. Also appreciated: `resolveKnownAccountId` is extracted as a pure, directly-unit-tested function, including a test for prototype-pollution resistance (`toString`/`constructor` as `login_hint` values) — attention to detail I didn't ask for but is the right instinct for anything doing an object-key lookup on unauthenticated input.

## D11 — port binding

`docker-compose.yml` diff confirmed: `"127.0.0.1:4011:4011"`, with an inline comment explaining why (loopback binding is now load-bearing, not just tidiness, once D10 ships a one-GET-request sign-in). `docs/local-development.md` is updated to state the same reasoning and explicitly names `postgres`/`redis` as the same exposure class, tracked separately, matching D11's stated scope boundary. Good.

## Deviation 1 — `/auth/dev-login-options` added to `PUBLIC_ROUTES`

Agree this is correctly in-scope. `isPublicRoute` does prefix (`startsWith`) matching against the list; I checked that `/auth/dev-login-options` doesn't accidentally fall under an existing prefix (it doesn't — nothing in the pre-existing list is a prefix of it) and that adding it doesn't broaden any other route's matching. It's a route this change introduces; gating it correctly is part of implementing it, not a separate concern. No objection.

## Deviation 2 — the two `docker/oidc/server.js` bug fixes

Agree fixing these was the right call, and agree it's distinguishable from deviation 3. The test for "is this in scope" isn't "was it broken before I got here" — it's "does leaving it broken defeat the mechanism this change is building." Both bugs meet that bar:

- The undersized JWKS key failed ID token issuance outright — not a degraded case, a hard failure on every local sign-in, persona shortcut or manual. Shipping D10's auto-approve handler on top of a container that can't issue tokens would mean the feature never demonstrably works, and no test in this change could pass without touching it anyway.
- `conformIdTokenClaims` defaulting `true` was silently stripping the `role` claim this design's D4 depends on — the entire mechanism by which `manager-001`/`admin-001` are supposed to get real `global_role` values. This isn't adjacent to the change, it *is* the change's D4 failing silently.

Contrast with deviation 3 (the `request.hostname` port-drop bug in `auth.ts`'s callback handler): that bug is in code this design explicitly committed not to touch, and — critically — the application still functions without fixing it for anything this change is responsible for demonstrating (the bug affects every sign-in equally, persona or manual, and isn't specific to or newly exposed by this change the way the JWKS/claims bugs are to D4). Both fixes here are inline-commented with the reproduction reasoning ("confirmed by reproducing against the unmodified pre-persona-login server.js") and scoped to the local-only stub file, not shared infrastructure. This is the right line, drawn in the right place, and documented well enough that a future reader doesn't have to reconstruct the reasoning from the commit.

One thing I'd have wanted made more visible: these are two *security-relevant* bugs (one defeats a role-claim mechanism, the other is silently dropping data on the floor) being fixed inside a change whose own design doc doesn't mention them, because they weren't known when design.md was written. That's unavoidable — you can't design around a bug you haven't found yet — but I'd flag to the team that `docker/oidc/server.js`'s `conformIdTokenClaims` default masking claims silently, with `resolveOrCreateAccount`'s `sub`-derived fallback quietly absorbing the loss, is exactly the kind of "implicit decision nobody noticed they were making" that's worth a follow-up glance at whether anything else in the stub is silently degrading. Not a blocker for this change.

## Consistency with existing patterns

Spot-checked against neighboring code:
- **Error handling:** `/auth/login`'s new `400` on invalid `loginHint` uses the same `{ error: { category, message, correlationId } }` shape as every other error response in `auth.ts` (`/auth/logout`, `/auth/session`). Consistent.
- **Logging/audit:** `hasLoginHint: Boolean(loginHint)` on `auth.authorization_initiated` mirrors the existing `hasJoinContext: Boolean(joinToken)` field on the same event, same boolean-presence pattern, same line. This is D8's stated intent and it reads as a natural extension, not a bolt-on.
- **Test structure:** `vi.hoisted()` for the `config`/`isPrivateAddress` mock in `auth.test.ts`, Fastify `inject()` for route tests, `vitest` + fake timers on the frontend — all consistent with pre-existing test files in the same directories.
- **Styling:** `DevLoginPage.tsx`'s inline `CSSProperties` objects match the existing convention in `AuthErrorPage.tsx`/`AuthLoadingPage.tsx` (also inline styles, no CSS-module or Tailwind usage in this package) — not a new pattern introduced for this one page.

No inconsistencies found.

## Minor finding

Marcus's report states 39 tasks completed; `tasks.md` has 38 checked items (all `- [x]`, none unchecked). Not material — likely a counting discrepancy in the handoff, not a missing task — but worth a one-line correction in the final report so the task count in the record is accurate.

## Items outside my remit

The pre-existing `request.hostname` port-drop bug in `/auth/callback` (deviation 3) is real, breaks token exchange for local sign-in today per `docs/local-development.md`'s new "Known issue" callout, and is correctly left alone per this design's explicit commitment. It should be filed as its own fix — orthogonal to this change, but it currently means the persona login feature (and manual login) may not work end-to-end against this stack until it's fixed. Someone should confirm whether that's already tracked; I didn't see an issue number referenced in the docs callout.
