# Sync review: Solution Architect (Ingrid Sollenberger)

Change: `configurable-oidc-role-map` (#243). Scope: drift between the synced main specs and the code and docs, plus the `openspec validate --strict` length warnings.

## BLOCKER: the working tree does not hold the change's tracked edits

When I started this review (2026-10-05 21:24 EDT), `git status` showed **no modified tracked files**. `git diff main` was empty. All 33 tracked edits for this change are in **`stash@{0}`** ("WIP on agent-team/243-configurable-oidc-role-map: c00b496 …", created 21:23:40 EDT, about a minute before this review began). Those edits are the five modified main specs, `config.ts`, `account-resolver.ts`, `routes/auth.ts`, `routes/sessions.ts`, `routes/facilitator-sessions.ts`, `session-subscriber-access-helper.ts`, `docker/oidc/accounts.js`, `.env.example`, `docs/*.md`, `requirements/*` and all the modified tests. Only the untracked files are still in the tree: the new `role-map.ts`, the new tests, `openspec/specs/oidc-role-mapping/` and the change folder. The stash was most likely made by a concurrent agent checking whether the warnings already exist on main.

Consequences while the stash is not restored:
- `role-map.ts` is not wired in, so the build and tests run against main's resolver.
- `openspec validate configurable-oidc-role-map --strict` fails in place. The `local-dev-environment` MODIFIED block "omits" the old scenario "Facilitator and participant accounts remain unseeded", because main's text is back in the tree. Against the synced specs, the change validates cleanly (I checked this on a temp copy).

I did **not** pop or apply the stash, as instructed. **Action for the orchestrator:** run `git stash pop` (restore `stash@{0}`) before any further work, commit or validation. I reviewed the stash contents read-only (`git show stash@{0}:<path>`).

## Drift review (synced specs vs. stash code and docs)

I found no behavioural drift. I checked each requirement:

| Spec | Requirement / scenario | Code / doc evidence | Result |
|---|---|---|---|
| oidc-role-mapping | Format, empty/whitespace key, invisible chars, empty=unset, permitted targets (Set membership), engineer rejected, duplicate + escape-equivalent keys, fail-closed tokeniser | `role-map.ts` `parseRoleMap`, `validateEntries`, `assertUniqueTopLevelKeys`, `FORBIDDEN_IN_KEY` | Match |
| oidc-role-mapping | No echo of map; raw value not on config | Fixed messages, `q()` escapes Cf/Cc/U+2028/9; `config.ts` reads `env.OIDC_ROLE_MAP` directly, not via `optional` | Match |
| oidc-role-mapping | Production needs an EM key; real IdP needs a map in every NODE_ENV; identity default only for local issuer and non-production | `parseRoleMap` guards, `issuerIsPrivate` from `isPrivateAddress` | Match |
| oidc-role-mapping | Missing-target warnings + wording; summary line order/format; no summary on failure | `warnings[]`, `SUMMARY_ORDER`, `console.info` after the try block; `FATAL:` + `exit(1)` | Match |
| oidc-role-mapping | Normalization, own-key lookup, precedence, engineer fallback | `normalizeClaim`, `Map.get`, `RANK`, `resolveGlobalRole` | Match |
| oidc-role-mapping | Unmapped warning, overage warning, partial match silent, discard line (EM/facilitator only, no senior_engineer), correlationId as field | `account-resolver.ts` warn calls; `routes/auth.ts` passes `request.log.child({ correlationId })` | Match |
| oidc-role-mapping | Next-sign-in only; refresh does not re-resolve | Resolver called only from the OIDC callback; documented in deployment.md | Match |
| auth-error-handling | `role_claim_mapped` fires on non-engineer OR change; evaluated once; structured event carries `previousRole` | `shouldEmitRoleClaimMapped`, `emitRoleClaimMapped` gates both the audit INSERT and the post-commit event; `previousRole` added | Match |
| first-access | Mapping via role map, array claims, interactive-sign-in only, audit of demotions | As above | Match (one text inconsistency, fixed in the delta; see below) |
| local-dev-environment | facilitator-001 carries `role: facilitator`; `OIDC_ROLE_MAP` optional; production guard; local dev needs no map | `accounts.js`, `.env.example` (map commented out, issuer `http://localhost:4011`), `DEV_LOGIN_OPTIONS` seeded=true | Match |
| session-participation | Admin rejected at registration (403 `invalid_request`, audit with `actor_global_role`); lock-in rejection with a role-neutral message; prior votes kept; roster excludes admins; join unaffected | `sessions.ts` `isEligible` + lock-in check, new message; `facilitator-sessions.ts` roster SQL; no join-link change | Match |
| websocket-session-authorization | Participant grant denied to admin at subscribe, delivery and sweep; facilitator grant unchanged; HTTP reusers deny | `session-subscriber-access-helper.ts` participant branch only | Match |
| docs | deployment.md role-map section, upgrade/rollback, runbook; local-development.md stub/default map | Consistent with the specs (required conditions, warnings, summary format, 90-minute bound, lock-in message) | Match |

## Spec-text fixes made

1. **`oidc-role-mapping`, scenario "Escape-equivalent duplicate key stops startup"** (main spec and delta). The literal `E` had been decoded to `E` when the spec was written. The example therefore showed two identical keys and did not show escape-equivalence. I restored `"Eng-Managers"` and the code span `` `E` ``. Re-validated: `oidc-role-mapping` is valid under `--strict`.
2. **`first-access` item 3, delta only** (`changes/.../specs/first-access/spec.md`). "MUST NOT log a warning for it" contradicted the `claim_overage` exception in `oidc-role-mapping` "Role claim warnings at sign-in", which the code implements. I added the exception. **The synced main `openspec/specs/first-access/spec.md` is in the stash, so I could not edit it.** Re-sync this one sentence, or apply the same edit, after `git stash pop`.

## `openspec validate --strict` length warnings

I compared main's specs (`git show main:…`) with the synced versions (`git show stash@{0}:…`) in temp directories, without touching the working tree. The same requirement indices are flagged on both:

| Spec | main | synced |
|---|---|---|
| auth-error-handling | req 3–12 | req 3–12 |
| first-access | req 0–5 | req 0–5 |
| local-dev-environment | req 1 | req 1 |
| session-participation | req 0–2 | req 0–2 |
| websocket-session-authorization | req 0–7 | req 0–7 |
| oidc-role-mapping (new) | — | valid, no warnings |

All warnings are **pre-existing**. None of the requirements this change added goes over 500 characters (3 in session-participation, 2 in websocket-session-authorization, and every oidc-role-mapping requirement). Two requirements that were already over the limit got longer: auth-error-handling "First Access and role-claim-mapping events are durably recorded" and the first-access Option A requirement. Splitting those is a repo-wide cleanup, not part of this change, so I left them alone.
