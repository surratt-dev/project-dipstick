# Design Review: Security (Tomás Ferreira, Senior Application Security Analyst)

Change: `facilitator-role-claim-allowlist` (#235). I reviewed design.md, proposal.md, the three delta specs and decision-log.md, and checked them against `auth/account-resolver.ts`, `auth/oidc-client.ts`, `auth/middleware.ts`, `config.ts`, `routes/auth.ts` and `routes/facilitator-sessions.ts`.

**Verdict: approve with conditions.** The change fails closed: exact-match allowlist, no normalisation, the allowlist and the precedence come from one constant, and a set-equality test guards widening. It also closes an audit gap I would have raised anyway, the missing demotion row. Two findings (S1, S2) need design text before apply. Nothing here needs a user decision overturned.

## Findings

**S1 (Medium): "Read from the signed ID token" is the claim, but the code does not check the signature.** The claim is read from `tokens.claims()` on the token-endpoint ID token. That part is right: it does not come from userinfo or the access token. But openid-client v6 `authorizationCodeGrant` checks `iss`, `aud`, `exp`, `iat` and `nonce` and does **not** check the JWS signature of a token-endpoint ID token unless `enableNonRepudiationChecks` is on (OIDC Core 3.1.3.7 permits this). Today, trust rests on TLS to the token endpoint plus client authentication. That is spec-compliant, but the code comments (`account-resolver.ts:10, 38`) and the specs say "signed", and this change makes the claim carry `facilitator` and `application_admin` from arrays. Fix one of two ways, and do not leave it implicit: (a) enable `client.enableNonRepudiationChecks(oidcConfig)` in `getOidcConfig` and add a test, which is my preference since it is cheap defence in depth; or (b) correct the comments and the D2/D8 wording to "ID token from the token endpoint over TLS, `iss`/`aud`/`nonce`/`exp` validated". In non-production, `allowInsecureRequests` means plain HTTP, which is acceptable only because of the S5 guard.

**S2 (Medium, implicit): revocation does not cover sessions already created.** D7 says a revoked facilitator keeps `global_role` for up to 90 minutes and can keep creating teams until then. It doesn't say what happens to sessions they already facilitate. Opening the room re-reads the live `global_role` (`facilitator-sessions.ts:846`), but in-session control and subscriber access are keyed on `sessions.facilitator_id` alone (`session-subscriber-access-helper.ts:120`). A demoted facilitator therefore keeps control of a session they created even after the column flips. That may be the right call, because ending a live ceremony mid-reveal hurts people. It is still an authorization decision, and right now nobody has made it. Add one D7 bullet that states the behaviour, and add one sentence to the docs item 4.

**S3 (Low): `OIDC_ROLE_CLAIM` must name an admin-assigned claim.** The claim name can be configured. If an operator points it at a claim the user can edit (for example a Keycloak user attribute, or an Entra optional claim sourced from a self-service attribute), any user can grant themselves `application_admin`. D8 item 1 should add one sentence: "the claim must be one only IdP administrators can set, such as Entra app roles". That fits inside the five-item limit.

**S4 (Low, suggestion): put `outrankedRoles` in the audit row, not only the log.** I accept Decision 9: no gate, no alert. But D3's warning is the only in-app trace of the EM-plus-facilitator risk, and logs rotate faster than `audit_log`. Its values are enum strings (D3), so recording `outrankedRoles` in the `role_claim_mapped` metadata is safe and adds no alerting. That keeps the evidence an incident reviewer would need. This is optional, and it does not reopen Decision 9.

**S5 (Low, pre-existing): the dev-provider guard has holes.** The only production guard is `NODE_ENV=production && isPrivateAddress(OIDC_ISSUER)` → exit (`config.ts:95`). `isPrivateAddress` doesn't recognise `::1`, `[::1]` or bare container hostnames such as `http://oidc:4011`, so a misconfigured production deployment pointing at the simulator under a service name would start, and `facilitator-001`'s new `role: facilitator` would then be a usable privileged identity. The risk does not get worse in kind with this change, but now it involves a privileged role. Track it as a follow-up: add IPv6 loopback and single-label hostnames, or require `https:` for the issuer in production.

## Checks against the focus areas

| Area | Assessment |
|---|---|
| Claim source | ID token only, from the token endpoint, issuer pinned through discovery. No userinfo or access-token reads. Signature: see S1. |
| Precedence admin > facilitator > EM | Most-privilege-wins matches what the IdP intends. A user sent `application_admin` is meant to be an admin. The EM-below-facilitator order is **User Decision 7**. I record that it fails open on the `global_role` half of the no-manager rule, and that membership rows carry it, with a skip-level gap (Non-goals). I judge this **acceptable**, not unacceptable, *provided* Follow-up 2 is filed before the first team goes live as the VP required. If that gate is dropped, it becomes a human decision. |
| Raw values in logs/audit | Good. Warnings carry counts and `claimShape`, the outranked list holds enum values, and tests assert absence for every array element. D4 (pino arg order) matters for security, because fields will reach production logs for the first time. Tests should assert that no claim value appears in **either** argument. |
| Audit on every change | The single predicate (D5) fixes the row-and-log drift, and `previousRole` comes from the same-statement CTE, so it is race-safe. The rollback gap (old build writes no demotion row) is acceptable. Note it in the release note so an auditor isn't surprised. |
| Revocation latency | Honestly documented. It is ≤90 min, and IdP revocation is roughly no faster (D7). Follow-up 3 (mine) stays open. An emergency operator `UPDATE users` takes effect at once, because authorization reads the column live, but the next sign-in reverts it, so the IdP has to change first. The docs need not say this, but it is the real kill switch. |
| Local-dev claims in prod | `facilitator-001` exists only in `docker/oidc/accounts.js`, `dev-login-options` is double-gated, and prod exits on a private issuer. Residual gap: S5. |

## Deferred / implicit security decisions (for the record)

1. ID-token signature verification posture (S1), currently implicit.
2. A revoked facilitator keeps control of sessions they already created (S2), currently implicit.
3. Reporting-chain enforcement: deferred to Follow-up 2 (human-owned launch gate).
4. In-app revocation: explicitly out of scope. The 90-minute cap is the control.
5. Production IdP revocation timing: deferred to Follow-up 3 (owner: me).

**Conditions to proceed:** resolve S1 (pick a or b) and S2 (state the behaviour) in design.md before apply. S3 is a docs sentence. S4 and S5 are at the author's discretion and in a follow-up, respectively.
