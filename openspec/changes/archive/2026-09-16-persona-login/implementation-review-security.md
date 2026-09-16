# Security Implementation Review — Persona Login

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-09-16
**Scope:** Verification that the implemented code matches the security-relevant decisions in `design.md` (D1–D12), reviewed and conditionally approved at design stage.

**Verdict: Approved.** The implementation matches the design on every point I checked. No new findings. All four design-stage findings (D2, D8, D11, D12) are correctly implemented in the actual code, not just described in commit prose.

---

## What I verified

### 1. `auth.ts` — callback handler untouched

`git diff` against the working tree shows the only change inside the existing `authRoutes` function body, apart from the new `/dev-login-options` route and the `/login` route, is the import line pulling in `isPrivateAddress`. The `/callback` handler — state `getdel`, nonce/PKCE exchange via `handleCallback`, `sub`/`iss` claim validation, `resolveOrCreateAccount`, and every `emitAuditEvent` call in that path — is byte-for-byte what was there before this change. `session.regenerate()` lives inside `resolveOrCreateAccount`/session establishment, also untouched. This is the single most important property of D1 and it holds: the shortcut cannot bypass the Authorization Code + PKCE exchange because it never touches the code that performs it.

### 2. `loginHint` validation (D12)

`GET /auth/login` validates `loginHint`, when present, against a closed `SEEDED_ACCOUNT_IDS` tuple (`participant-001`, `facilitator-001`, `manager-001`, `admin-001`) via a type-narrowing `isSeededAccountId` guard, and returns `400` with a structured error body for anything else — before state/nonce/PKCE material is generated. This is a stricter implementation than D12 strictly required (D12 accepted that `URLSearchParams` encoding already removes injection risk into the URL); the allowlist is implemented anyway, which is the right call and matches what's written.

### 3. `hasLoginHint` audit field (D8)

`auth.authorization_initiated`'s `emitAuditEvent` call now includes `hasLoginHint: Boolean(loginHint)` alongside the existing `hasJoinContext: Boolean(joinToken)`, exactly mirroring the pattern D8 specified. No new event type was added, and the callback-path events remain persona-unaware, per D8's stated intent.

### 4. `isPrivateAddress` export (D2)

`config.ts`'s `isPrivateAddress` gained only an `export` keyword and a doc comment stating its known coverage gaps (no IPv6, no DNS resolution, no obfuscated IPv4 literals) — the function body is unmodified. `grep` across `packages/backend/src` confirms exactly one definition; `routes/auth.ts` imports and calls it rather than reimplementing any part of the private-address check. `GET /auth/dev-login-options` gates on `config.NODE_ENV === "production" || !isPrivateAddress(config.OIDC_ISSUER)` — logically the AND of "not production" and "is private address" that D2 calls for — and this check is the literal first line of the handler, before any Redis/DB access. On failure it does `reply.code(404).send()` with no body, matching the required bare-404 contract.

### 5. `PUBLIC_ROUTES` / `authMiddleware` (D2 boundary)

`/auth/dev-login-options` was added to `PUBLIC_ROUTES` in `middleware.ts`. `isPublicRoute` matches by `url.startsWith(route)`, a prefix match — this is a pre-existing pattern (`/auth/login`, `/auth/logout`, `/api/join/` already used it) and the new entry doesn't introduce a new class of exposure: there's nothing else under the `/auth/dev-login-options` prefix that becomes reachable as a side effect, and the route itself carries no path segments that could be spoofed to reach a different handler. The route's own double gate (independent of `authMiddleware`) is what actually determines whether it does anything when reached, so its presence on the allowlist doesn't weaken protection of any other route — it doesn't overlap with `/auth/callback`, `/auth/logout`, etc. Noting this prefix-match style as a general (pre-existing, out-of-scope) code-quality observation, not a finding: `isPublicRoute` would be more precise as an exact-match or path-segment check rather than `startsWith`. Not introduced by this change; not blocking.

### 6. `docker/oidc/interactions.js` — D10, auto-approve resolves both prompts

`createInteractionRouter`'s `GET /interaction/:uid` handler auto-resolves the `login` prompt via `interactionFinished` when `login_hint` matches a known account, and *separately* auto-resolves the `consent` prompt on the next interaction round-trip (same hint re-read from `params.login_hint`, which persists across the login→consent transition), calling `grantConsent` to build an equivalent grant to the manual flow before finishing. This is exactly the two-prompt resolution D10 requires — not a config flip, real routing logic that intercepts before the provider's default handling (`devInteractions` is explicitly disabled in `server.js` so it can't shadow this router).

Fallback behavior is a genuine, explicit branch, not silent fail-open: when `login_hint` is absent or doesn't match a known account (`resolveKnownAccountId` returns `undefined`), the handler renders `renderLoginForm`/`renderConsentForm` — a real manual form requiring POST submission — rather than defaulting to any account. I traced both the absent-hint and unrecognized-hint cases through `resolveKnownAccountId` and confirmed both land on the same fallback branch, matching the design's explicit call-out that these are two distinct conditions deliberately not conflated (and, separately, not silently merged into an allow-all).

One observation worth naming, not a finding given the constraints: the manual POST path (`body.login`) still accepts any string as `accountId` with no password verification — but this reproduces the pre-existing `devInteractions` behavior this router replaces (the rendered form itself says "No password is verified"), it's local-stub-only, and D10's scope was replacing `devInteractions` behavior for the hinted path, not hardening the manual fallback. No regression here relative to baseline.

### 7. `docker-compose.yml` — D11 loopback binding

`oidc` service port mapping is `"127.0.0.1:4011:4011"`, confirmed in the current file, with an inline comment explaining why and explicitly naming `postgres`/`redis` as the tracked-separately, out-of-scope exposure. Matches D11 exactly.

### 8. Pre-existing bugs fixed in `docker/oidc/server.js` (JWKS key size, `conformIdTokenClaims`)

Both are security-neutral in context, and I'd call fixing them the right call rather than a scope violation:

- **JWKS key regenerated from 1760-bit to 2048-bit RSA.** This is a dev-only stub key, inline in a non-production container, whose sole purpose is to sign tokens the backend then validates. A stronger key here has no downside; the prior undersized key was actively broken (failed RS256 signing outright under the installed `jose` version), so this wasn't a hardening choice so much as a functionality fix that happens to also be the more secure value. No production key material is affected — production `OIDC_ISSUER` cannot be this stub at all, per the `isPrivateAddress`/`NODE_ENV` boot guard this change reuses (D2's premise).
- **`conformIdTokenClaims: false`.** This makes the dev stub put consented-scope claims (including this change's new `role` claim) directly on the ID token instead of requiring a `/userinfo` call this backend never makes. This is a dev-IdP-only behavior change with no production analog — production's real IdP is whatever the org's actual identity provider does, unaffected by this stub's config. Setting it to `false` is what makes D4's role-claim mechanism (the actual security-relevant mechanism: `manager-001`/`admin-001` getting real `global_role` values) work at all; without this fix, `role` claims were silently dropping and D4 would have been unverifiable. I'd flag it as a finding if this were touching a real IdP's claims configuration — it's not; it's fixing a stub to accurately simulate what a real IdP is expected to do (assert requested-scope claims in a way the RP can read them).

Both fixes are narrowly scoped to `docker/oidc/`, don't touch `auth.ts`'s claim-trust logic (claims are still validated the same way after arriving, `MissingClaimError` checks unchanged), and are called out explicitly in code comments with the reasoning — good practice for a scope-expanding fix, makes it auditable rather than buried.

### 9. Unfixed pre-existing bug — `request.hostname` drops port in `/auth/callback`

Confirmed still present and unmodified (`${request.protocol}://${request.hostname}${request.url}` at `auth.ts`'s callback handler). Checked whether the persona-login/`loginHint` path has any different exposure to this than manual login: it does not. The bug lives entirely in the callback handler's URL reconstruction, which runs identically regardless of how the authorization request was initiated — `loginHint` only affects the `/login` redirect and the IdP-side interaction screen, both of which complete before the callback handler ever runs. The callback URL, state lookup, and claim validation are indifferent to whether `login_hint` was present upstream. No interaction, confirming the design's stated boundary holds.

---

## Findings

None. This is a clean implementation of a design I already reviewed and conditionally approved; all four conditions (D2, D8, D11, D12) are verifiably satisfied in the code, not just asserted in commit messages. The two scope-expanding bug fixes in the dev-only OIDC stub are appropriately narrow, well-documented, and security-neutral-to-positive for a container that never runs in production and cannot be pointed at by a production deployment given the existing `isPrivateAddress`/`NODE_ENV` boot guard.

## Residual, out-of-scope items (tracked, not blocking this change)

- `postgres`/`redis` port bindings in `docker-compose.yml` remain `0.0.0.0`-bound. Same underlying exposure class D11 fixed for `oidc`, explicitly named as a separate follow-up in `design.md`'s Risks section. I'd like this picked up before this stack is ever run anywhere other than a fully trusted local machine.
- `request.hostname` port-drop bug in `/auth/callback` remains unfixed, by design (predates this change, out of its boundary, confirmed non-interacting above).
- `isPublicRoute`'s prefix-match (`startsWith`) route-matching style is looser than necessary; not introduced by this change, not a finding here, but worth tightening generally the next time `middleware.ts` is touched.
