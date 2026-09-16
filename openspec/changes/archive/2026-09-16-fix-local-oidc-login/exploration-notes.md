# Exploration Notes: fix-local-oidc-login

**Author:** Devon Calloway (Internal Champion / SME), exploring in the sense the BA and implementation team would want before this becomes a proposal.
**Source:** GitHub issue #104 — "Local OIDC login is completely broken: redirect_uri port dropped + broken simulator JWKS"

---

## First question: is the issue even still accurate?

Issue #104 was filed against a code state that has since moved — `persona-login` (#112/#113, merged as `4cd06e3`) touched both files the issue names: `packages/backend/src/routes/auth.ts` and `docker/oidc/server.js`. Before treating the issue body as ground truth, I re-derived both bugs against HEAD.

### Bug 1 — redirect_uri port drop — **still present, confirmed**

`packages/backend/src/routes/auth.ts:121-123`, unchanged by persona-login:

```ts
const callbackUrl = new URL(
  `${request.protocol}://${request.hostname}${request.url}`,
);
```

Fastify's `request.hostname` is host-header-hostname-without-port. `docker-compose.yml` sets `OIDC_REDIRECT_URI: http://localhost:3000/auth/callback` for the backend, and `oidc-client.ts`'s `getAuthorizationUrl` sends that exact value as `redirect_uri` on the authorization request. But `handleCallback` calls `client.authorizationCodeGrant(oidc, callbackUrl, {...})` with **no explicit `redirect_uri` override** — current `openid-client` derives the token request's `redirect_uri` from `callbackUrl`'s origin + pathname. With the port dropped, that becomes `http://localhost/auth/callback` — a mismatch against the `:3000` value registered at the authorization step. The IdP will reject the grant.

I found a comment in `docker/oidc/server.js` (the `conformIdTokenClaims` note) that explicitly says persona-login made **no changes to auth.ts's callback handler**, citing a proposal commitment to that effect. That explains why this bug survived persona-login untouched — it wasn't in scope, not that it was overlooked and re-broken. Good: this tells me the two changes are genuinely independent, which matches the issue's own framing ("two independent, unrelated bugs").

**This bug is real, still active, and is the actual reason a developer following the README's "Local development" section cannot sign in today.**

### Bug 2 — simulator JWKS — **already fixed, but not the way the issue proposes**

This is the one that needs correcting before this becomes a proposal. The issue asks to *drop the hardcoded `jwks` block and let `oidc-provider` auto-generate an ephemeral key*, or alternatively generate a fresh 2048-bit+ key.

Reading `docker/oidc/server.js` at HEAD: persona-login already did the second of those two options. There's a comment directly above the `jwks.keys` block:

> "Pre-existing bug found and fixed while implementing persona-login... this key was a 1760-bit RSA modulus, below the 2048-bit minimum... Regenerated as a fresh 2048-bit key, still inline and still local-dev-only."

I decoded the current `n` value myself rather than trust the comment: **256 bytes = 2048 bits.** Confirmed correct. So the *symptom* described in the issue (`500 server_error` at `/token` from `jose` rejecting the signing key) is already gone — fixed as an incidental side effect of the persona-login change, before this issue's fix would ever land.

**Implication for scope:** there is nothing left to *do* for Bug 2. The only decision left is whether to leave the current fix (fresh hardcoded 2048-bit key, stable `kid` across restarts) as-is, or additionally switch to `oidc-provider`'s auto-generated ephemeral key as the issue's primary suggestion proposed. I don't think that swap earns its keep — see below.

---

## What I think the change actually is

This is much smaller than the issue heading implies once you've re-verified against HEAD:

```
┌─────────────────────────────────────────────────────────┐
│  Bug 1: redirect_uri port drop         →  STILL BROKEN   │
│  Bug 2: JWKS key too small             →  ALREADY FIXED  │
│         (fixed as a side effect of persona-login)        │
└─────────────────────────────────────────────────────────┘
```

The proposal should probably:
1. Fix Bug 1: `request.hostname` → `request.host` in the callback URL reconstruction. One line, matches the issue's own confirmed-in-isolation fix.
2. Note (not "fix") Bug 2 as already resolved by an unrelated change, with a pointer to where/why, so nobody re-does the work or reopens dead debate about auto-generated vs. hardcoded keys. **Decision on where this lives:** `proposal.md` (or `design.md`, whichever this change produces) states, as a dated line citing commit `4cd06e3` and the existing comment in `docker/oidc/server.js`, that Bug 2 was already fixed as a side effect of persona-login and is out of scope here — with no corresponding task in `tasks.md` to re-fix it. That's the stated home; nowhere else needs to carry this claim.
3. **Decision:** keep the current fixed 2048-bit key rather than switching to `oidc-provider`'s auto-generated ephemeral key. A stable key across restarts avoids invalidating a developer's IdP session/cookies on every container restart under a previously-signed ephemeral key; this is a local-dev-only stub, so "idiomatic key generation" isn't a competing goal worth trading that away for. This is now closed, not an open option for the implementation team to relitigate.

---

## Ritual-fidelity read: does this touch anything load-bearing?

Running my usual filter on this — the no-manager-participation rule, simultaneous reveal, facilitator-from-another-team, and non-comparability of individual data across teams — none of those are anywhere near this code. This is transport-layer plumbing for local dev sign-in, not session mechanics. I don't have a strong opinion in the sense I'd have about, say, whether a manager could join a session roster. That said, a few things are worth saying out loud because they're exactly the kind of "nobody was watching, so it drifted" issue I care about:

- **This bug silently invalidated manual QA for an unknown period.** The issue says this was discovered *incidentally*, while someone was doing unrelated manual verification. That's the pattern I worry about most — not a single dramatic failure, but a broken path that everyone routes around quietly (temp patches, disposable second OIDC instances, per the issue's own "Not fixed here" section) until it becomes normal that "local login doesn't really work, just work around it." If working around a broken foundational path becomes tribal knowledge, that's exactly the kind of erosion that eventually costs the ritual itself elsewhere — not in this bug, but in the general muscle of "does anyone actually click through the real app before shipping." I'd want this fixed promptly and not just quietly patched-around-forever, for the same reason I don't want teams quietly not-following the simultaneous-reveal rule "just this once."
- **Scope discipline matters here precisely because this is shared infra.** Both bugs sit in auth/dev-infrastructure code that every team's manual QA depends on. This is a good candidate for a tightly-scoped, boring fix — not a moment to also refactor the callback handler, change token TTLs, or "while we're in here" touch anything else. The persona-login change already showed good discipline about this (explicitly *not* touching the callback handler to stay in scope) — I'd want this fix to hold the same line: one bug, one line, plus documentation that Bug 2 is a non-issue now.
- **On the ephemeral-vs-hardcoded JWKS question:** resolved above as a stated decision — keep the fixed 2048-bit key. I raised this initially as a coin flip and the BA review correctly called that out: an "either is fine" reads to an implementer as permission to relitigate mid-build, which is exactly the kind of scope creep I don't want on a fix this small. It's closed now, not carried forward as an option.
- **Open-source / on-prem angle:** nothing here changes external dependencies or introduces new ones — `oidc-provider`, `openid-client`, `jose` are all already in use. No new footprint. Fine as-is.

---

## What I'd want in the proposal so this doesn't come back to me

Consistent with wanting requirements thorough enough that the team doesn't need to loop me in on every edge case:

- **State explicitly, with evidence, that Bug 2 is already fixed** — otherwise someone re-litigates the ephemeral-vs-hardcoded-key question as if it's still open, or worse, "fixes" an already-fixed thing and introduces a regression.
- **Scope the fix to the one-line change** in `auth.ts` (`request.host` instead of `request.hostname`). The reverse-proxy/production question this raised is now checked and closed — see "Open questions — resolved" item 1 below — so the task-list line item is to record that reasoning, not to perform a further check before shipping.
- **A verification task that actually completes a real browser login end-to-end**, and it needs to say exactly what that means rather than leave it to whoever writes tasks.md: **manually** verify, against the running `docker compose up` + `npm run dev` stack (the exact path documented in the README's "Local development" section) — not a new automated e2e/browser-driver setup. This matches persona-login's own precedent (its tasks.md verified directly against the running docker-compose service rather than standing up new tooling), and holds the same scope-discipline line for a comparably small, local-dev-only surface. **Pass condition:** a browser navigating to `/auth/login` and completing the mock IdP flow lands on an authenticated `/team/:id`, with no manual patching, no port override, and no second OIDC instance — the workarounds the issue's own "Not fixed here" section describes teams currently using. Landing on a redirected error page does not count as pass, even if the redirect itself "completes."
- **No new configurability.** This isn't a case where anyone would be tempted to make port-handling configurable, but as a general rule I'd flag it if I saw one: a bug fix in trusted internal dev tooling shouldn't grow a flag.

---

## Open questions — resolved

Both the BA review and the facilitator's review pushed on these; I went back and checked rather than leave either as a carried-forward "worth a note." Both are now closed:

1. **Reverse-proxy / production Entra edge case — checked, not affected, here's the evidence.** The facilitator was right to press on this: `auth.ts`'s callback handler is the *same code path* for both the local simulator and production Entra — there's no separate prod branch, just different `OIDC_ISSUER`/`OIDC_REDIRECT_URI` values. But the `request.host` vs `request.hostname` distinction only produces different behavior when the reconstructed URL carries a non-default port (that's exactly why this bug shows up locally at `:3000` and nowhere else). `packages/backend/src/app.ts:32` sets `trustProxy: 1`, so in production `request.hostname`/`request.host` are derived from the first hop's `X-Forwarded-Host`/`X-Forwarded-Proto`, not the raw socket — and a standard HTTPS deployment behind an ingress/load balancer serves on the default port 443, which is never written into `Host`/`X-Forwarded-Host` headers or into an Entra-registered redirect URI. No port means `request.host` and `request.hostname` produce identical strings, so the fix is behaviorally inert in production regardless of the exact ingress topology (which isn't in this repo — no k8s manifests here — so I can't inspect it directly, but the port-default reasoning holds independent of that). This repo also has no reverse-proxy config in `docker-compose.yml`, confirming the local path is unaffected too. **Task-list line item, not a redesign:** note this reasoning in `tasks.md` so a future reader doesn't have to re-derive it, but no additional check against staging/prod is required before this change ships.
2. Confirm with whoever files/triages issues whether #104's Bug 2 description should be corrected/closed-as-already-fixed at the issue level, separate from this change, so the tracker doesn't carry a stale claim indefinitely. (Still an action for the issue triager, not a task in this change — unchanged from my original read, and the BA review agreed this framing was already correct.)
   (The facilitator review also asked whether anyone's independently confirmed a real Entra login in production recently, given this bug's "silently broken, nobody noticed" pattern. That's a legitimate worry but it's a separate question from this change's scope — this change fixes a local-dev-only symptom of a code path that, per the reasoning above, isn't actually exposed to the same failure mode in production. Auditing whether production login has its own undetected problem is worth someone doing, but it isn't a task this bug-fix should carry.)
3. **Code comment — decided, yes.** Add a one-line comment on the `request.host` line explaining why it's not `request.hostname`, consistent with the existing four-line comment on the JWKS block in `docker/oidc/server.js` that documents the same kind of "here's the mistake and why we didn't repeat it." This exact mistake already shipped once and went unnoticed; the file's own commenting density argues for closing that gap rather than leaving it to whoever reviews the PR to have an opinion about later.

## What I'm not worried about

This doesn't touch session mechanics, participation rules, topic data, or anything cross-team-comparable. It's a two-file, effectively one-line, local-dev-only fix. I don't need to be consulted again once the proposal states the Bug 2 finding clearly — this is exactly the kind of self-contained bug fix I'd want the team to resolve without looping me in further.
