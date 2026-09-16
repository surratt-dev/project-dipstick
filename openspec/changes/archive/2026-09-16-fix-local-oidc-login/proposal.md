## Why

Local OIDC sign-in is broken for every developer following the README's "Local development" section: the callback handler reconstructs the token-exchange `redirect_uri` from `request.hostname`, which drops the port, so it no longer matches the `redirect_uri` (`http://localhost:3000/auth/callback`) registered at the authorization step and the IdP rejects the code grant. Issue #104 also reported a second bug (an undersized JWKS signing key causing a `500` at `/token`), but that was already fixed as an incidental side effect of the `persona-login` change (commit `4cd06e3`) before this change was scoped — re-verified against HEAD by decoding the current key's modulus (256 bytes = 2048 bits, above the minimum). Nothing is left to do for that bug here; it's called out below only so it isn't re-litigated or "re-fixed" into a regression.

This is worth fixing now, not just working around, because the workarounds available (temp local patches, running a second disposable OIDC instance, manually overriding the port) are exactly the kind of quiet erosion that makes "local login doesn't really work, just route around it" become normal — which is a bad habit to let take hold in shared dev infrastructure that every team's manual QA depends on.

## What Changes

- Fix `packages/backend/src/routes/auth.ts`'s callback URL reconstruction: use `request.host` (hostname + port) instead of `request.hostname` (hostname only), so the token-exchange `redirect_uri` matches the one registered at the authorization step.
- Add a short code comment at the fix site explaining why `request.host` is used and not `request.hostname`, matching the commenting density of the existing JWKS-fix comment in `docker/oidc/server.js`.

Not in scope, and explicitly not changing:
- The already-fixed JWKS signing key in `docker/oidc/server.js` (commit `4cd06e3`) — kept as its current fixed 2048-bit key. Switching to `oidc-provider`'s auto-generated ephemeral key was considered and rejected: an ephemeral key would invalidate a developer's existing IdP session on every container restart, and this is a local-dev-only stub where "idiomatic key generation" isn't a competing goal worth trading that away for. This is a closed decision, not an open option.
- Any change to production behavior. The callback handler runs the same code path in production (`trustProxy: 1` in `packages/backend/src/app.ts`), but production is served over standard-port HTTPS behind an ingress, so no port ever appears in `Host`/`X-Forwarded-Host` — `request.host` and `request.hostname` produce identical strings there. The fix is behaviorally inert in production.
- Any new configurability (e.g., a flag to control host/port handling). This is a bug fix in trusted internal dev tooling, not a candidate for a new option.

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `oidc-auth`: the "OIDC callback and token validation" requirement states the application exchanges the authorization code for tokens, but never specified that the reconstructed callback URL must preserve a non-default port so the token-exchange `redirect_uri` matches the one registered at the authorization step. This was exactly the gap this bug fell through. The delta spec adds a scenario making that requirement explicit, the same way `local-dev-environment`'s requirement was extended (in the "ID token issuance succeeds on every exchange" scenario) to document the sibling bug fixed under `persona-login`. This is not new functionality — it's precisely specifying behavior the code was already supposed to have.

## Impact

- Code: `packages/backend/src/routes/auth.ts` (one-line fix plus a comment, in the `GET /callback` handler's URL reconstruction, ~line 122).
- Spec: `openspec/specs/oidc-auth/spec.md` (delta: one new scenario under the existing "OIDC callback and token validation" requirement).
- No other files, no schema changes, no dependency changes, no production configuration changes.
- Verification: manual, against the running `docker compose up` + `npm run dev` stack — a browser completing `/auth/login` through the mock IdP and landing on an authenticated page (e.g. `/team/:id`), with no manual patching, no port override, and no second OIDC instance.
