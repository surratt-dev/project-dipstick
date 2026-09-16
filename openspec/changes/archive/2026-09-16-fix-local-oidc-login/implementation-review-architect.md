# Architecture Review — fix-local-oidc-login

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope:** Boundary/pattern conformance of the implementation against `design.md`, and independent verification of the engineer's manual verification claims.

## Verdict

**Approved.** This is a correctly scoped, boundary-respecting one-line fix. Nothing here requires my escalation.

## Diff conformance

`git diff main -- packages/backend/src/routes/auth.ts` shows exactly what was reported:

```diff
+      // Use request.host (not request.hostname) since hostname drops the port, which breaks redirect_uri matching against the value registered at authorization.
       const callbackUrl = new URL(
-        `${request.protocol}://${request.hostname}${request.url}`,
+        `${request.protocol}://${request.host}${request.url}`,
       );
```

One property swap, one sentence of comment, no other source files touched. `docker/oidc/server.js` is untouched (confirmed via `git diff main --stat -- docker/oidc/server.js` — empty), so the JWKS decision recorded as "closed" in `design.md` was in fact left alone. `tasks.md` checkboxes reflect real, verifiable work rather than a rubber stamp.

## Boundary and pattern check

- **OIDC abstraction integrity:** The fix touches only generic Fastify request-handling (`request.host` vs `request.hostname`), not anything Entra- or mock-IdP-specific. This is exactly the property I care about most on this project — that the same code path serves local and production behind config, not forked logic. The design doc's own framing ("no separate prod branch") is accurate and the fix preserves it.
- **No scope creep:** Non-Goals in `design.md` (no JWKS change, no new config flag, no e2e tooling) are all honored in the diff. Tasks 2.1/2.2 are explicit scope checks rather than filler, and they check out.
- **Trust-boundary note (non-blocking):** `request.host` under `trustProxy: 1` (`packages/backend/src/app.ts:32`) is derived from `X-Forwarded-Host` in front of a real proxy, or the raw client-supplied `Host`/`X-Forwarded-Host` header when no proxy sits in front (local dev). This was already true for `request.hostname` before this change — the fix doesn't introduce a new trust extension, it inherits the existing one. Correctly out of scope per this change's Non-Goals, but worth naming for the record since it's the kind of implicit decision I'd otherwise flag as undocumented. It isn't, here — `design.md`'s "No additional check against staging/prod topology" section already reasons through this.
- **Future Work deferral:** The `mapAuthError()` audit-category note (this bug class was invisible to log review because it shares a bucket with user-cancelled-consent) is a legitimate observability gap, correctly filed as a follow-up rather than a gate on a one-line fix. Confirmed the bucketing is real: `packages/backend/src/auth/error-handler.ts` maps both cases to `category: "authentication_failed"`.

## Independent verification of Marcus's manual walkthrough

I did not take the curl-based verification at face value; I checked each referenced piece of behavior against current code:

| Claim | Verified against | Result |
|---|---|---|
| `redirect_uri=http://localhost:3000/auth/callback` reflects the port fix | diff itself | Consistent — `request.host` includes port |
| `GET /auth/callback` → `302` to `/no-team` for zero-team-membership accounts | `packages/frontend/src/App.tsx:28,70` | Route exists; redirect logic matches description (comment at line 57 confirms intentional design) |
| `GET /auth/session` returns populated session with `user`/`teamMemberships` | `packages/backend/src/routes/auth.ts:439-456` | Endpoint exists at documented location, shape matches |
| Session regeneration produces a fresh `sessionId`, not a stale/errored one | `packages/backend/src/routes/auth.ts:253` (`request.session.regenerate()`) with surrounding comment about the prior swallowed-error bug | Consistent with a real, working session-issuance path, not a coincidental non-throw |
| JWKS key is the fixed 2048-bit key from `4cd06e3`, not re-touched | `git log` shows `4cd06e3` = "feat: add local-only persona login shortcut (closes #112)"; `docker/oidc/server.js` diff against main is empty | Confirmed |
| No reverse-proxy config in local stack (supports the prod-inertness argument) | `docker-compose.yml` has no nginx/traefik/proxy service | Confirmed |

Everything cited is real, exists where claimed, and behaves consistently with the description. I have no basis to doubt the walkthrough; the curl-based substitution for a browser is an acceptable verification method given the constraint the engineer stated (no browser available), and it exercises the actual bug (redirect_uri port mismatch) rather than a proxy for it.

## Summary

Design decisions are explicit and closed where they should be closed (JWKS key), the fix doesn't erode the provider-agnostic abstraction, no boundary is blurred, and the one deferred item (audit categorization) is correctly treated as follow-up rather than scope creep. No architectural concerns block this change.
