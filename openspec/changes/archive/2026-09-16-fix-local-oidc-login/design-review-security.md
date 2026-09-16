## Security Review — `fix-local-oidc-login` design.md

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** Authentication flow correctness, host-header trust boundary, audit logging, interaction with prior TEAM-006 and persona-login work.

### Verdict: No objection. Fix is security-neutral; one non-blocking observation on audit-log detection quality.

---

### 1. Does `request.host` vs `request.hostname` change the trust boundary?

No. I traced this rather than taking the design doc's word for it.

- `node_modules/fastify/lib/request.js`: under `trustProxy`, `host` resolves from `X-Forwarded-Host` (if the socket's peer is a trusted single hop) else the raw `Host`/`:authority` header. `hostname` is defined as `this.host.split(':', 1)[0]` — it is *derived from* `host`, not from an independent, more-trusted source. Stripping the port doesn't add a validation step; it just discards data.
- Consequence: `request.host` and `request.hostname` are equally attacker-influenceable to the exact same degree, gated by the exact same `trustProxy: 1` hop-trust logic. Switching one for the other changes nothing about *what* is trusted, only *how much* of the trusted value is kept. The design doc's claim to this effect (design.md line 36, "both derived from the first hop's `X-Forwarded-Host`") is correct.
- I also want to flag precisely what "trusted" means here, since `trustProxy: 1` is easy to over-read as a security control: it tells Fastify *which hop's headers to believe for IP/host/proto resolution*, not that the value in those headers is sanitized or allow-listed against known hostnames. If the edge proxy passes through the client-supplied `Host` header into `X-Forwarded-Host` unmodified (the common default for most ingress/LB configs unless explicitly overridden), an attacker who can reach the proxy can still influence the string `request.host` resolves to. This is worth naming explicitly rather than leaving implicit in "trustProxy handles it" — not because it's a new risk from this change, but because a future reader skimming `trustProxy: 1` could mistake it for host validation.

### 2. Given the Host header is attacker-influenceable, does that matter here?

I checked how the constructed value is actually consumed, because that's what determines exploitability, not just influenceability.

- `getAuthorizationUrl()` (`oidc-client.ts:33`) sends `redirect_uri: config.OIDC_REDIRECT_URI` — a fixed, non-request-derived config value — to the IdP at the authorization step. Good: the value the IdP actually registers/compares against is never request-derived.
- `handleCallback()` passes the request-derived `callbackUrl` into `client.authorizationCodeGrant(oidc, callbackUrl, ...)`. I checked `openid-client`'s source directly (`node_modules/openid-client/build/index.js:974`, `stripParams()`): it derives the token-request `redirect_uri` as `origin + pathname` of that URL — confirming the design doc's central factual claim.
- Two things bound the blast radius of this to nothing:
  1. **No SSRF path.** The request-derived URL is only used to produce a *string* sent as a form parameter in the token POST. The actual HTTP request target (`token_endpoint`) comes from OIDC discovery against the fixed, configured issuer — never from the request-derived value. An attacker manipulating `Host` cannot redirect the server-to-server token request anywhere.
  2. **Fails closed, not open.** If an attacker's forged `Host` causes the reconstructed `redirect_uri` to diverge from the value used at authorization (`config.OIDC_REDIRECT_URI`), standard OIDC/OAuth2 redirect_uri matching means the IdP *rejects* the exchange. There's no scenario I can construct where forging Host causes the exchange to be *accepted* on more permissive terms than the fixed config value already allows — the attacker cannot make the IdP-side comparison target move, only the client-side value being compared, which just breaks their own request.
- Conclusion: this is exactly the "is this fix neutral" question I was asked to answer, and the answer is yes — pre-fix and post-fix, the host-header trust exposure at this call site is identical and non-exploitable for the reasons above. `hostname→host` is a pure bug fix with no security posture change in either direction, for local dev or production.

One adjacent thing worth double-checking at implementation time (not a blocker, not new to this change): confirm no other consumer of `request.host`/`hostname` in `auth.ts` or downstream (cookie domain, CORS reflection, post-login redirect construction) treats it as trusted for a decision that *does* matter — I checked the current file and found none (session cookie has no `domain` override, post-login redirects are relative paths, CORS origin list comes from `getAllowedOrigins()` in config, not from the request). Flagging so this doesn't need re-deriving if the file changes shape before implementation.

### 3. Audit logging

No audit logging behavior changes as part of this fix, and none should — I don't have a finding requiring a design change here. One observation for the record, not a blocker:

- A redirect_uri mismatch surfaces from `openid-client`/the IdP as some form of `invalid_grant`-shaped error, which `error-handler.ts`'s `mapAuthError()` buckets into the generic `authentication_failed` category alongside several unrelated failure modes (bad client secret, unauthorized client, invalid scope). The exact failure class that caused *every* local sign-in to break for an unknown period wasn't distinguishable in the audit trail — it took a developer noticing broken local login and filing #104, not log review, to surface it.
- This is consistent with the rest of the error-mapping design (coarse categories, no PII) and I'm not asking for a new category as part of this one-line fix. But it's the kind of gap that matters more in production against Entra than it does locally: a systemic redirect_uri misconfiguration in prod would currently present in logs as an undifferentiated wave of `authentication_failed` events, indistinguishable from users cancelling consent. Worth a follow-up ticket to give redirect_uri-mismatch-shaped errors their own category or a distinguishing field — not scope for this change.

### 4. Interaction with TEAM-006 rate limiting

None. I checked `b92a7a4` directly: the three-tier sliding-window rate limiter added under TEAM-006 is scoped entirely to `POST /api/v1/teams/:teamId/managers` (`packages/backend/src/routes/teams.ts`). It does not touch `auth.ts`, the OIDC callback path, or anything this change modifies. No shared code, no shared audit event types that this change alters. No interaction to flag.

### 5. Interaction with the persona-login dev shortcut

One factual note for the record, not a security finding: `persona-login`'s `/auth/login?loginHint=...` shortcut (auth.ts:66-114) pre-fills the local IdP's login form but still performs a full OIDC round trip through this same `/callback` handler and `handleCallback()`/`authorizationCodeGrant()`. It does not bypass the token exchange. That means the `hostname`-drops-port bug this change fixes was *also* breaking the persona-login shortcut locally, not just "plain" local OIDC login — the proposal/design only discuss persona-login in connection with the already-fixed JWKS key bug. This doesn't change my assessment of the fix (same conclusion as above applies identically to the persona-login path, since it's the same code), and doesn't require a design change — just noting it so nobody is surprised that persona-login's own verification pass apparently didn't exercise this path far enough to catch it.

### 6. Scope-discipline findings (matches my usual "internal is still a trust boundary" concern — not triggered here)

- The design explicitly closes the JWKS ephemeral-key question and forbids re-touching `docker/oidc/server.js`. Good — I independently confirmed the current key is 2048-bit (`docker/oidc/server.js:100-109`), consistent with the design's claim.
- No new configuration surface, no new trust decision, no change to token validation, claim handling, or session issuance logic. Scope is genuinely as narrow as stated.

### Summary for the implementation team

Ship it as designed. The `host`/`hostname` swap is correctly reasoned to be security-neutral, and I verified the two load-bearing claims (both properties share the same `trustProxy` resolution; `openid-client` only uses the value as a string compared server-side, never as a fetch target) against actual source rather than accepting them at face value. No changes requested to design.md or tasks.md. The one process note — coarser-than-ideal audit categorization for redirect_uri mismatches — is a candidate for a separate, small follow-up ticket, not a gate on this change.
