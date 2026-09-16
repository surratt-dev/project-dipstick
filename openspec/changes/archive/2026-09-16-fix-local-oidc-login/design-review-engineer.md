# Design Review — Full Stack Engineer (Marcus Oyelaran)

## Verdict

Implementable as written. I verified every factual claim in the design against the actual code and dependency source, not just against the narrative — they all hold. This is a one-line fix with a design doc that is arguably more thorough than the change warrants, but that's a minor complaint, not a blocker.

## What I verified directly

- `packages/backend/src/routes/auth.ts:122` does read `request.hostname` in the callback URL reconstruction, exactly as described.
- `openid-client`'s `authorizationCodeGrant` (`node_modules/openid-client/build/index.js:974`) computes `redirectUri = stripParams(currentUrl)`, and `stripParams` (line 924) clears `.search` and `.hash`, keeping origin + pathname. So the design's claim about how the token-exchange `redirect_uri` gets derived is exactly right, not an approximation.
- Fastify's `request.host` vs `request.hostname` getters (`node_modules/fastify/lib/request.js:118-254`): `hostname` is always `this.host.split(':', 1)[0]` — it unconditionally strips the port regardless of trustProxy config. `host` returns the raw `Host` header, or `X-Forwarded-Host` when `trustProxy` is configured and the socket address is trusted. This confirms both halves of the design's reasoning: (1) `request.host` is a strict superset fix — same value as `hostname` when there's no port, plus the port when there is one; (2) in production, since `app.ts:32` sets `trustProxy: 1`, `request.host` resolves through `X-Forwarded-Host` exactly like `hostname` does today, so swapping the property doesn't change production's resolution path, only whether a port (if present) survives.
- `docker/oidc/server.js:100-109` — the JWKS fix and its four-line comment already exist, from commit `4cd06e3` (`feat: add local-only persona login shortcut (closes #112)`), confirmed via `git show`. The design's "already fixed, don't re-touch" framing is accurate, not an assumption.

I didn't find anything in the design that overstates what the code does.

## Boundaries and coupling

Clean. This fix sits entirely inside `handleCallback`'s input construction in `routes/auth.ts` — it doesn't touch `auth/oidc-client.ts`, `config.ts`, or the session/audit layers at all. No new coupling introduced. The one-property swap is the smallest possible diff that closes the actual gap, and the design correctly rejected the alternative (manually reading `request.socket.localPort` or an env var) — that alternative would have reintroduced exactly the kind of proxy-topology-awareness the handler shouldn't need, which lines up with how the rest of this file already treats `request.ip` (trustProxy-aware, not manually resolved).

One thing worth flagging for the implementer, not the design: line 122's URL construction still does manual string interpolation (`${request.protocol}://${request.host}${request.url}`) rather than using Fastify's `request.originalUrl` or a URL-building helper. That's pre-existing style, not something this change should refactor — but if a future change touches this line again, it's worth asking whether reconstructing a URL from three separately-sourced pieces is the right long-term pattern versus a single request-derived URL. Not a blocker here.

## Error paths

No new error paths are introduced, and I checked that none needed to be. Today, a `redirect_uri` mismatch from the IdP surfaces as a rejected grant, which throws inside `handleCallback` → `client.authorizationCodeGrant`, caught by the existing `try/catch` in the `/callback` handler (lines 324-351), mapped through `mapAuthError`, audited via `auth.failure`, and redirected to `/auth/error`. That path is unchanged and doesn't need to be — the fix removes the condition that caused the failure rather than needing to handle it more gracefully. Good scope discipline: the design explicitly declines to add a regression test or new config surface for this, and I agree that's proportionate for a one-line fix to a boundary that's already covered by the manual verification step in tasks.md (3.1-3.3).

## On the comment requirement (Decision 3 / task 1.2)

Matching the JWKS comment's density is the right call, and having read that actual comment, I'd calibrate expectations for the implementer: the JWKS comment is four lines because it documents a bug that shipped, was silently wrong for a while, and needed a "how we found it" trail. This bug is simpler — one sentence covering the `host`-vs-`hostname` distinction and the port-matching requirement is enough; it doesn't need the JWKS comment's full incident-report shape. Worth saying explicitly since "matching the density" could be read as "write four lines" rather than "write a comment of similar seriousness."

## Non-goals — no objection

Not verifying default-port behavior, not adding e2e tooling, not touching the JWKS key — all correctly out of scope. The production-inertness argument (standard HTTPS on port 443 never appears in `Host`/`X-Forwarded-Host`) is sound and I couldn't find a topology in this repo (no k8s manifests, no reverse-proxy config in `docker-compose.yml`) that would contradict it.

## Nit

Tasks.md 1.3 asks to "record the reverse-proxy reasoning" in tasks.md itself — that reasoning is already fully written in design.md's Decisions section. Fine to leave as a pointer/duplicate for a future reader who only opens tasks.md, but not worth treating as a distinct writing task at implementation time.
