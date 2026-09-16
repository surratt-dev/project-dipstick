## Context

`packages/backend/src/routes/auth.ts`'s `GET /callback` handler reconstructs the callback URL from the incoming request to pass to `client.authorizationCodeGrant(oidc, callbackUrl, {...})`. It currently uses `request.hostname` (Fastify's host-header-hostname-without-port), which drops the port. Locally, `OIDC_REDIRECT_URI` is `http://localhost:3000/auth/callback` — registered with that exact value at the authorization step — but the reconstructed callback URL becomes `http://localhost/auth/callback`, and `openid-client` derives the token request's `redirect_uri` from the callback URL's origin + pathname. The mismatch causes the IdP to reject the grant, breaking every local sign-in.

This is the same code path used in production against Entra, gated only by different `OIDC_ISSUER`/`OIDC_REDIRECT_URI` environment values — there is no separate prod branch.

A second bug in the same GitHub issue (#104), an undersized JWKS signing key in the local OIDC simulator, was already fixed as an incidental side effect of the `persona-login` change (commit `4cd06e3`, regenerated to a fixed 2048-bit key). Verified independently against HEAD by decoding the key's modulus (256 bytes = 2048 bits). No design decisions are needed for it here.

## Goals / Non-Goals

**Goals:**
- Restore local OIDC sign-in by making the callback URL reconstruction preserve the port, so the token-exchange `redirect_uri` matches the one registered at authorization.
- Make the fix self-documenting so the same mistake (using `hostname` instead of `host`) isn't reintroduced silently a second time.

**Non-Goals:**
- Changing the JWKS signing key strategy in `docker/oidc/server.js`. The current fixed 2048-bit key stays as-is (see Decisions).
- Any change to production behavior, deploy topology, or reverse-proxy configuration.
- Any new configuration flag or option for host/port handling.
- Standing up new automated e2e/browser-driver tooling for verification.
- Specifying default-port behavior. The new spec scenario only commits to preserving a *non-default* port; it does not assert (and this change does not verify) what happens when the incoming request explicitly carries a default port (e.g. `Host: example.com:443`). That's not a gap this bug depends on, so it's left implicit — a future scenario should not be assumed to be already covered by this one.

## Decisions

### Use `request.host` instead of `request.hostname`
Fastify's `request.host` returns the `Host` header value (hostname + port, when present); `request.hostname` strips the port. Swapping the one property preserves the port the IdP needs to see in `redirect_uri`, with no other code path affected.

Alternative considered: explicitly read the port from `request.socket.localPort` or an env var and append it manually. Rejected — `request.host` already does exactly this in one property read, respecting Fastify's own trust-proxy resolution (see below), and doesn't require the handler to know about deployment topology.

### Keep the JWKS key as a fixed, hardcoded 2048-bit value (not `oidc-provider`'s auto-generated ephemeral key)
The issue's original suggestion was to drop the hardcoded key and let `oidc-provider` auto-generate one at startup. Rejected: an ephemeral key regenerated on every container restart would invalidate a developer's existing browser session/cookies signed under the previous key, adding friction to the exact workflow this fix is trying to restore. This is a local-dev-only stub; "idiomatic key generation" isn't a competing goal worth trading session stability away for. This decision is closed, not open for the implementer to revisit.

### Add a code comment at the fix site
A single-sentence comment on the `request.host` line, explaining why it isn't `request.hostname` — that `hostname` drops the port, breaking `redirect_uri` matching against the value registered at authorization. This serves the same purpose as the existing four-line comment on the JWKS block in `docker/oidc/server.js` — documenting "here's the mistake and why we didn't repeat it" — but the JWKS comment's length matches an incident that shipped silently and needed a fuller trail; this bug is simpler and one sentence is enough. The exact `hostname`/`host` confusion already shipped once undetected; the fix site is where a future reader would otherwise make the same substitution.

### No additional check against staging/prod topology before shipping
`app.ts` sets `trustProxy: 1`, so both `request.host` and `request.hostname` are derived from the first hop's `X-Forwarded-Host`/`X-Forwarded-Proto` in production, not the raw socket. A standard HTTPS deployment behind an ingress/load balancer serves on the default port 443, which is never written into `Host`/`X-Forwarded-Host` or into an Entra-registered redirect URI — so `request.host` and `request.hostname` produce identical strings in production regardless of the exact ingress topology (not inspectable from this repo — no k8s manifests here — but the port-default reasoning holds independent of topology specifics). `docker-compose.yml` has no reverse-proxy config either, confirming the local path is unaffected in the other direction. This reasoning is recorded here and in tasks.md so a future reader doesn't have to re-derive it; no separate verification against a staging/prod environment is a task of this change.

## Risks / Trade-offs

- **[Risk]** A future reader "fixes" the already-fixed JWKS key again, reintroducing the ephemeral-key trade-off debate. → **Mitigation:** proposal.md and this design doc both state the decision explicitly and mark it closed; no task in tasks.md re-touches `docker/oidc/server.js`.
- **[Risk]** The `host`/`hostname` distinction is subtle enough to get silently reverted in a future refactor of the callback handler. → **Mitigation:** the added code comment and the new spec scenario (`oidc-auth`, "Callback URL reconstruction preserves a non-default port") make the requirement explicit and testable, not just tribal knowledge.
- **[Trade-off]** No automated regression test is added for this specific bug (manual verification only, per scope decision below). → **Accepted:** matches `persona-login`'s own precedent of verifying directly against the running docker-compose stack for a comparably small, local-dev-only surface, and this is a one-line change with an explicit spec scenario to guide any future test-writing effort.

## Migration Plan

None. This is a one-line code change to a request-handling expression, with no data migration, no schema change, and no deploy-sequencing concerns. Rollback is a plain revert if needed.

## Open Questions

None outstanding for this change. Two questions raised during exploration were resolved and are recorded in `exploration-notes.md` rather than carried forward here:
- Whether the reverse-proxy/production path is affected — checked, not affected (see Decisions above).
- Whether production Entra login has been independently verified recently — a legitimate concern, but explicitly out of scope for this change (it audits a different, unaffected code path under different conditions).

## Future Work

Security review noted that `mapAuthError()` currently buckets a `redirect_uri` mismatch into the same generic `authentication_failed` audit category as a user cancelling consent, which is why this exact bug class went undetected via log review; giving redirect_uri-mismatch-shaped errors their own audit category or distinguishing field is a candidate follow-up ticket, not a gate on this change.
