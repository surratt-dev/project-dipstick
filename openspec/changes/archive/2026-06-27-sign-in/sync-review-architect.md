# Sync Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Date:** 2026-06-27
**Scope:** Spot-check of synced main specs against implementation

## Verdict: Specs accurately reflect implementation

Four specs verified against `packages/backend/src/`:

**oidc-auth** — Confirmed: auth code flow with PKCE, single-use state via Redis get-then-delete, session fixation prevention (destroy + regenerate), absolute 90-min lifetime, 5-min token refresh threshold with 2 retries, `invalid_grant` immediate session destruction, sliding TTL via `session.touch()`. All match spec.

**first-access** — Confirmed: `account-resolver.ts` uses `INSERT ... ON CONFLICT (oidc_subject, oidc_issuer) DO UPDATE` exactly as specified. Display name fallback chain (`name` -> `email` -> `sub`) and email fallback (`{sub}@unknown`) match. Returning users get profile updates.

**join-link** — Confirmed: 32-byte `randomBytes` base64url token, 7-day default expiry, `ON CONFLICT DO NOTHING` for idempotent membership, session-aware redirect (`/session/:id` vs `/team/:id`), `?alreadyMember=true` param, unauthenticated redirect to `/auth/login?joinToken=`. Error messages match spec text exactly.

**project-structure** — Confirmed: auth module structure matches spec list (7 modules). Auth routes registered at `/auth` prefix. Join link routes at `/api/`. Public route exclusions match spec.

No drift detected. Specs and code are in sync.
