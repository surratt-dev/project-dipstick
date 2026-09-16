# Design Review: Persona Login -- Security Analysis

| | |
|---|---|
| **Reviewer** | Tomás Ferreira, Senior Application Security Analyst |
| **Review Date** | 2026-09-16 |
| **Documents Reviewed** | `persona-login/design.md`, `persona-login/proposal.md`, `persona-login/specs/persona-login/spec.md`, `persona-login/specs/oidc-auth/spec.md`, `persona-login/specs/local-dev-environment/spec.md` |
| **Code Reviewed** | `packages/backend/src/routes/auth.ts`, `packages/backend/src/auth/oidc-client.ts`, `packages/backend/src/auth/account-resolver.ts`, `packages/backend/src/auth/audit-logger.ts`, `packages/backend/src/config.ts`, `docker/oidc/server.js`, `docker-compose.yml` |
| **Verdict** | **Conditional Approval** -- the core authentication path is genuinely untouched and the double-gate design is sound; findings below should be addressed or explicitly accepted before implementation closes |

---

## Summary

I want to state the conclusion up front because it matters: I traced the actual code, not just the design's claims, and the design's central security assertion holds. `login_hint` cannot reach `account-resolver.ts` as attacker-controlled claims. The full Authorization Code + PKCE exchange -- state generation, the atomic `getdel` single-use check, nonce verification, `sub`/`iss` claim validation, `session.regenerate()`, and every audit event in the callback handler -- runs identically regardless of whether a persona button or the manual form initiated the request, because `login_hint` only ever influences which account the IdP's own interaction step resolves to *before* token issuance. Once the ID token comes back, `resolveOrCreateAccount` reads only the signed token's claims, exactly as it does today. This is the right shape for this feature: the shortcut is confined to the throwaway stub, not threaded into `auth.ts`.

That said, I have four findings. None of them require re-architecting the design -- the double-gate approach (D2) and the fail-open timeout (D3) are the correct patterns -- but one of them (Finding 1) is a real amplification of an existing exposure that this design should acknowledge even if it doesn't own the fix, and the design.md's own Risks section is otherwise more thorough than most designs I review, so I'm holding it to that bar.

---

## Finding 1 -- The Auto-Approve Handler Meaningfully Lowers the Bar for an Already-Exposed Mock IdP (Medium-High)

**Location:** `docker-compose.yml` lines 27-41 (the `oidc` service); `docker/oidc/server.js` (the new `login_hint`-aware interaction handler, not yet written)

**Observation:** `docker-compose.yml`'s `ports:` entries use short-syntax host:container mappings (`"4011:4011"`, `"5433:5432"`, `"6380:6379"`). Docker's default behavior for this syntax is to publish on **all host interfaces** (`0.0.0.0`), not just loopback. This is true today, independent of this change, and it means that on any machine where the Docker host has a routable network interface -- a shared devbox, a cloud-hosted dev VM, a laptop on an office network with client isolation disabled -- the mock IdP is already reachable by anyone else on that network, not just the developer who started the stack.

This design's double gate (D2: `isPrivateAddress(OIDC_ISSUER)` AND `NODE_ENV !== "production"`) is a real and well-reasoned control, but it protects the **Dipstick backend's** willingness to offer the shortcut. It does nothing for the **mock IdP container itself**, which has no gate of its own and is not touched by D2 at all. Today, someone who reaches the exposed stub still has to submit credentials through `devInteractions`' form (`"password"` for every account -- trivial, but still a distinct interactive step, and one visible in a version-controlled file rather than reachable via a single crafted link). After this change, the same someone can complete authentication as `admin-001` with a single unauthenticated `GET` to the authorization endpoint carrying `login_hint=admin-001` -- no form, no credential of any kind, and a request shape trivial to embed in a link or automate.

The realistic exploitation path isn't "attacker reaches production" -- `loadConfig()`'s fatal exit already prevents a production backend from trusting a private-address issuer, and that's unchanged here. It's a **shared, non-production** environment: a staging box, a shared team devbox, a cloud dev instance kept running -- `NODE_ENV` there is plausibly not `"production"`, `isPrivateAddress` may plausibly still be true, and D2's gate would pass, legitimately, by its own logic. This is precisely the "it's just internal, only a handful of people use it" scenario that tends to end up in a post-mortem: the exposure was already there, but this change removes the one piece of friction (a shared, known password) that stood between "I found an open port" and "I am authenticated as an admin."

**This is not a flaw in D1/D2's reasoning** -- confining the shortcut to the stub instead of `auth.ts` is correct, and I'd have flagged the reverse decision far more severely. But the design's Risks section addresses the auto-approve handler having a *bug* (silently accepting an unrecognized hint) without addressing that a *correctly working* auto-approve handler is itself a lower bar than what it replaces, for anyone who can already reach the container.

**Recommended action:** At minimum, add this as an explicit, named risk in design.md's Risks/Trade-offs section (it's a legitimate scope call that the fix belongs to `docker-compose.yml`'s general port-binding posture, not to this change -- but the design should say so rather than being silent). If a fix is wanted in this change's scope, it's a one-line change per service: bind host-only (`"127.0.0.1:4011:4011"`, etc.) instead of the current short syntax. I'd treat that as a SHOULD FIX for this change and a MUST FIX for the repository generally, tracked separately if declined here.

---

## Finding 2 -- No Audit Signal Distinguishes a Persona-Shortcut Login, Even as a Boolean (Low-Medium)

**Location:** `routes/auth.ts` lines 50-54 (`auth.authorization_initiated`); design.md Decision D8

**Observation:** D8's reasoning -- "the audit log shouldn't need a special case to describe a real OIDC assertion accurately" -- is correct as far as it goes, and I agree a `via: "persona-shortcut"` field stamped onto `auth.success`/`auth.session_created` would be the wrong kind of special-casing (those events describe what *did* happen, which is identical either way).

But Finding 1 changes the calculus slightly: this feature introduces a strictly weaker authentication step at the IdP (no credential at all, vs. a shared password) for a subset of logins. If that weaker step is ever abused per Finding 1, "which sign-ins arrived via the persona shortcut" is exactly the forensic signal an investigator would want, and today there is no way to reconstruct it -- not even by inference -- because nothing records that `loginHint` was present.

The codebase already has the right idiom for this: `auth.authorization_initiated` (`auth.ts:50-54`) already logs `hasJoinContext: Boolean(joinToken)` -- a boolean presence flag, not the token value. Adding `hasLoginHint: Boolean(loginHint)` to that same event follows the identical pattern, costs nothing in the audit trail's shape, is `false` on every production request as a structural fact (the field reflects whether the query param was present, which is meaningless noise in prod but free), and doesn't touch `auth.success`, `auth.session_created`, or any other event D8 is protecting from persona-awareness. This isn't a new event and isn't a value that only fires in an unaudited environment -- it's one boolean field on an event that already fires for every login.

**Recommended action:** Add `hasLoginHint: Boolean(loginHint)` to the existing `auth.authorization_initiated` event in `GET /auth/login`. This is narrow enough that I don't think it conflicts with D8's intent, and I'd like the design to consider it rather than have it fall out during implementation review.

---

## Finding 3 -- D2 Extends `isPrivateAddress` to a Second Security Purpose Without Re-Examining Its Coverage (Low)

**Location:** `config.ts` lines 22-46

**Observation:** `isPrivateAddress` currently only recognizes IPv4 literals (`10.x`, `172.16-31.x`, `192.168.x`) and the literal strings `localhost`/`127.0.0.1`/`0.0.0.0`. It has no IPv6 handling (`::1`, `fc00::/7`, `fe80::/10` all fall through to `false`), no DNS resolution (a hostname that resolves to a private address via `/etc/hosts` or split-horizon DNS is not detected), and no handling of the classic IP-obfuscation tricks (decimal, octal, or hex-encoded IPv4 literals). Today this function backs exactly one security decision: the production-boot fatal exit in `loadConfig()`. Its `catch { return false }` on a malformed issuer URL is fail-closed for *that* use (an unparseable production issuer fails open into "not private," which correctly does *not* suppress the fatal exit's sibling checks, though it also means the private-address check itself silently no-ops on a malformed URL).

D2 proposes exporting this same function and using it as one half of a new gate deciding whether to expose `/auth/dev-login-options`. For that gate, the fail-closed direction is the same one that matters (an unrecognized-as-private issuer causes the endpoint to 404, which is the safe failure mode) -- so I'm not calling this a MUST FIX. But the design is now depending on `isPrivateAddress`'s completeness for two independent purposes instead of one, and neither this design nor (as far as I can find) any prior review has verified the function against IPv6 or DNS-based private addressing. If a future change (this one or another) ever configures the local stack with an IPv6 issuer or a hostname alias, D2's gate would silently fail open in the sense of never granting the shortcut -- not a vulnerability by itself, but exactly the kind of "assumed correctness of an existing control extended to a new purpose" I'd want on record.

**Recommended action:** No change required for this design to proceed. I'd like a short comment added at `isPrivateAddress`'s definition noting its known scope (IPv4 literals + the three localhost spellings, no IPv6, no DNS) now that it backs two call sites, so the next person reusing it doesn't have to re-derive this by reading the implementation.

---

## Finding 4 -- No Stated Validation on `loginHint` Before It's Forwarded (Low, Informational)

**Location:** proposal.md "Add optional `loginHint` passthrough on `GET /auth/login`"; not yet implemented in `oidc-client.ts`

**Observation:** Neither the design nor the spec states any length or character constraint on the `loginHint` query parameter before it becomes the `login_hint` authorization parameter. I don't think this is exploitable in any serious way -- `openid-client`'s `buildAuthorizationUrl` constructs the URL via standard `URLSearchParams` encoding, so there's no injection risk into the URL structure itself, and `login_hint` is inert for a spec-compliant IdP by design (D1's reasoning here is sound). This is a low-severity, informational note rather than a required action: an unbounded string reflected into a redirect to a third-party endpoint is the kind of thing I'd want a sanity length cap on (a few hundred characters) purely as hygiene, not because I have a concrete attack in mind.

**Recommended action:** Consider a simple length cap (e.g., reject or truncate `loginHint` over ~256 characters) at implementation time. Not blocking.

---

## Controls Confirmed Present

- **PKCE, state, nonce, and the atomic single-use state check are untouched.** Traced `auth.ts:23-58` (`/auth/login`) and `auth.ts:60-296` (`/auth/callback`) directly -- `randomBytes(32)`, `randomNonce()`, `randomPKCECodeVerifier()`, the `redis.getdel` atomic consume, and `handleCallback`'s `expectedNonce`/`expectedState`/`pkceCodeVerifier` arguments are all present in the code as it stands today, and nothing in the design proposes touching this path. A `loginHint` param on `/auth/login` is additive to the querystring type and does not appear anywhere near state/nonce/PKCE generation.
- **`login_hint` cannot inject claims into `account-resolver.ts`.** `resolveOrCreateAccount` (`account-resolver.ts:88-133`) only ever reads from `tokens.claims()` -- the signed ID token returned after the full code exchange. `login_hint` is consumed entirely within the IdP's own interaction step, before any token is issued, and the design's own fallback requirement (unrecognized hint -> existing password form) confirms the intended auto-approve handler is meant to do an exact lookup against the closed, four-entry `accounts` map in `docker/oidc/server.js:8-33`, not construct claims from arbitrary hint input. I'd want to verify this exact-match behavior in code review when the handler is written, but the design's stated contract is the correct one.
- **`session.regenerate()` and every callback-path audit event are unaffected.** Confirmed by direct reading of `auth.ts:187-225` -- nothing in the design touches this sequence.
- **The double gate (D2) is independently evaluated and fails closed.** `isPrivateAddress` returning `false` on a malformed/non-private issuer and `NODE_ENV === "production"` are both checked explicitly per the spec's scenarios, matching the pattern `loadConfig()` already uses (`config.ts:85-90`) rather than trusting that guard transitively -- this directly addresses the residual risk named in the Risks section.
- **D3's fail-open timeout is the correct failure direction.** A timeout or non-200 on `/auth/dev-login-options` degrades to today's behavior (immediate `/auth/login` redirect), never to a hang or a silent grant.
- **D5's `seeded` boolean as single source of truth** correctly avoids a second, driftable list of which persona is unseeded on the frontend.
- **D6 (one gate for both login-redirect and logout-redirect decisions)** avoids the classic two-copies-of-the-same-check drift.
- **D7 is correctly self-identified as a non-technical control** in the design's own Risks section -- I have nothing to add there.
- **Manager/admin role assignment reuses the existing, already-reviewed claim mechanism** (`PERMITTED_GLOBAL_ROLES`, re-evaluated every sign-in) rather than new seed infrastructure -- this is the right call; it exercises the same code path a real IdP's claim would, rather than routing around it.

---

## Summary of Findings

| # | Finding | Severity | Classification |
|---|---|---|---|
| 1 | Mock IdP's already-exposed port + new auto-approve handler = a materially lower bar for anyone reaching a shared/non-production stack | Medium-High | SHOULD FIX (this change) / MUST FIX (repo-wide port binding, separately tracked if declined here) |
| 2 | No audit signal, not even a boolean, for persona-shortcut-initiated logins | Low-Medium | SHOULD FIX |
| 3 | `isPrivateAddress` extended to a second security purpose without documenting its known coverage gaps (no IPv6, no DNS) | Low | ACCEPTABLE WITH NOTE |
| 4 | No stated length/character bound on `loginHint` before forwarding | Low | ACCEPTABLE WITH NOTE |

Nothing here blocks implementation from starting. Finding 1 is the one I'd push hardest on -- not because this design got it wrong, but because it's the one place where "this is dev-only" is doing more load-bearing work than the design's own double-gate reasoning accounts for, and that's exactly the phrase I don't accept at face value.

---

*Review conducted by Tomás Ferreira, Information Security. Available for consultation during implementation, particularly on the auto-approve handler's exact-match lookup (Finding confirms the intended contract; I want to see the actual code) and on Finding 1 if the team wants to scope a docker-compose fix into this change versus tracking it separately.*
