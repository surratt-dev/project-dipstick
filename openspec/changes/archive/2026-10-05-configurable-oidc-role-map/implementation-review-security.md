# Implementation Review: Configurable OIDC role map (#243), Security

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-10-05
**Subject:** the uncommitted working tree on `agent-team/243-configurable-oidc-role-map`, compared with `main` (`git diff main` plus the untracked files).
**Inputs:** `design.md` (rev. 3), my `design-review-security.md`, `security-review.md` (the skeleton and the task 1.3/2.3 findings) and `follow-ups.md`.
**Code read:** `auth/role-map.ts`, `config.ts`, `auth/account-resolver.ts`, `routes/auth.ts` (callback, audit, error path), `auth/session-subscriber-access-helper.ts`, `routes/sessions.ts`, `routes/facilitator-sessions.ts` (roster, action-items-review, facilitator-gated handlers), `auth/standing-facilitator-access-helper.ts`, `realtime/{websocket-routes,ws-event-dispatcher,connection-reauthorization}.ts`, `routes/{join-links,teams,content}.ts` (admin and EM gates), `docker/oidc/accounts.js`, `docs/deployment.md` (the role-map section and the runbook).
**Executed:** the unit suites `role-map`, `config`, `account-resolver`, `session-subscriber-access-helper`, `sessions` and `auth` (271/271 pass). I also ran a scratch probe of `parseRoleMap` and `resolveGlobalRole` against bypass inputs (results below). I did not re-run the Postgres-backed integration suites; I rely on the task 2.3 record (8/8) for those.

## Verdict

**Approve. No blocking findings.**

Each required item from my design review (S1–S5, plus S6–S8) is in the code, not only in the documentation, and each one has a test that would fail if it regressed. I found no route outside E1–E4 that admits a participant or delivers live session data on the participant path without going through the patched checks. The mid-session demotion gap is real, but it predates this change. This change only makes it reachable through normal IdP operations. I record it as a non-blocking item for go-live of a second team, consistent with D-2.

---

## Verification of required items

### S1 / D11: admins excluded from live sessions (E1–E4)

| Point | Code | Test | Result |
|---|---|---|---|
| E1 registration | `sessions.ts` `isEligible` adds `global_role !== "application_admin"`. This is a DB read per request. | `admin-session-exclusion-integration.test.ts` (EM+admin claim leads to `application_admin`, a 403 at registration, a null subscriber grant and no roster entry, and the audit row shows `application_admin`) | **Verified** |
| E2 lock-in | `sessions.ts` rejection adds `\|\| global_role === "application_admin"`. The message no longer names a role. | `sessions.test.ts`: an admin with an existing participant row is rejected and no vote is written. A vote cast before promotion is kept and a later lock-in is rejected. | **Verified** |
| E3 subscriber grant | `evaluateSessionSubscriberAccess` participant path only. The facilitator path is unchanged. | Helper test; `websocket-routes.test.ts` (connect closes with the unauthorized code); `ws-event-dispatcher.test.ts` (delivery stops mid-connection with no reconnect); `connection-reauthorization.test.ts` (the sweep drops the grant) | **Verified**: connect, per-event delivery and periodic re-check all call the one helper |
| E3 HTTP reuse | `reveal-latency`, `action-items-review` and `participants-roster` all gate on the same helper | `sessions.test.ts` "D11: application_admin reveal-latency report" (403, no metric); `facilitator-sessions.test.ts` (404 for both GETs) | **Verified** |
| E4 roster | `facilitator-sessions.ts` adds `AND u.global_role != 'application_admin'` | `facilitator-sessions.test.ts` "roster query excludes application_admin rows" | **Verified** |

**Bypass sweep.** I enumerated every consumer of `session_participants` and every caller of `evaluateSessionSubscriberAccess`:
- Every live-event path (the WS connect, all `ws-event-dispatcher` cases including `vote_revealed`, and the reauth sweep) goes through the patched helper.
- Team-scoped WS events (`topic_history_update`) already reject `grant.path === "admin"` at both delivery and sweep.
- The EM views and `content.ts` already deny admins with an `admin.session_content_denied` audit row.
- `/auth/logout`'s active-session lookup is informational only.

Session creation (`facilitator-sessions.ts` lines 318 and 547) requires `global_role === "facilitator"`, so an admin cannot become `facilitator_id` and reach the facilitator path. Join-link redemption still gives an admin a membership row (`join-links.test.ts` D11). That is by design, and every downstream participation check blocks the admin. Rows written before deployment are harmless because the helper ignores the participant row once `global_role` is admin. **No bypass found.**

The resolver also emits the discard warn line with `discardedRoles: ["engineering_manager"]` for EM+admin users, value-free and with `correlationId`. The docs hygiene rule ("manager group ∩ admin group = ∅") is in `docs/deployment.md`. **S1 is closed.**

### S2 / D6: identity default only with a local issuer

`parseRoleMap` returns `DEFAULT_ROLE_MAP` only when the map is unset (including whitespace-only), `nodeEnv !== "production"` **and** `issuerIsPrivate`. `loadConfig` passes `isPrivateAddress(OIDC_ISSUER)`, which fails closed. `config.test.ts` covers a public issuer, an unclassifiable issuer, the local stub, and production with no map. Local dev, compose and CI all use `http://localhost:4011`. **Verified.** The RFC 1918 residual is covered in N3.

### S3: JSON parse errors do not echo the map

The `catch {}` discards the error and throws the fixed string `OIDC_ROLE_MAP is not valid JSON`. `RoleMapConfigError` has no `cause`. `loadConfig` prints only `err.message` for `RoleMapConfigError`, and any other error is rethrown, which is not reachable from parsing. The fragment test checks every 4-character substring of a 20-character input. My probe with `{"Very-Secret-Group-Name-Here": application_admin}` printed only the fixed string. The raw value is never stored on `config` (`config.test.ts` "carries no raw OIDC_ROLE_MAP string"). **Verified.**

### S4: target validation is own-key

`PERMITTED_TARGETS` is a `ReadonlySet` built from `RANK`, which is a `Map`. `validateEntries` uses `.has`. The tests reject `toString`, `__proto__` and `constructor` as target **values** and name key `A`. My probe confirmed that case variants (`Application_Admin`) and padded targets (`"application_admin "`) are rejected. A JSON-escaped target (`"application_admin"`) decodes to `application_admin` and is accepted, which is correct. **Verified.**

### Claim lookup is own-property only

`mapValues` uses `Map.get` over operator-written keys. Tests show `constructor`, `toString` and `__proto__` as claim values come out `unmapped`, and an operator-written `"__proto__"` key resolves as an own key. `normalizeClaim` keeps only non-empty strings, so nested arrays, numbers, `null`, objects and objects with a custom `toString` are all dropped. My probe confirmed that `[["Eng"]]` gives `missing` and that `["Eng", {toString(){return "Eng"}}]` maps only the real string. `resolvedClaims` in the callback is built from `Object.entries`/`Object.fromEntries`, which produce own properties. **Verified.**

Case and whitespace tricks: matching is exact and case-sensitive, so a variant value **fails closed** to `engineer` (no escalation). For the manager group, that fail-closed result is the silent manager drop that P3 already documents. Keys with leading or trailing whitespace, including NBSP, are rejected at boot. See N4 for invisible characters.

### No claim values in logs or audit rows

- All three resolver warn lines use pino's `(fields, msg)` order and carry only `claimName`, `resolvedRole`, `discardedRoles` and `reason`. The `correlationId` comes from `request.log.child`.
- The audit rows (`auth.first_access_created`, `auth.role_claim_mapped`) carry the subject, issuer, `globalRole`, `previousRole` (an internal role name) and `correlationId`.
- `auth.test.ts` "no logged argument contains a claim value or a map key (real resolver)" spies on every logger call in the callback.
- The callback error path logs `sanitizeOidcError(err)` and never logs claims.
- The S7 `ignoredCount` debug line was dropped.

**Verified.**

### Production boot fails without an `engineering_manager` target

`isProduction && !targeted.has("engineering_manager")` throws, and so does an unset or whitespace-only map in production. `loadConfig` turns that into `FATAL:` and `process.exit(1)` before listen. This is tested for production with `{}`, for a production map without a manager target, and for production with no map. As documented, the guard proves presence, not effectiveness: my probe confirmed that a placeholder `{"X":"engineering_manager"}` boots. **Verified.**

### S5: revocation bound

`middleware.test.ts` pins that `refreshSessionTokens` neither calls `resolveOrCreateAccount` nor writes `global_role`, even when it is handed a refreshed ID token that carries `application_admin`. `docs/deployment.md` states the ~90-minute bound and includes an urgent-revocation runbook. **Verified.** See N2 for a defect in the runbook.

### S6 / S8: duplicate scanner and overage

The scanner fails closed and compares decoded keys. My probe confirmed it catches `"__proto__"` against `"__proto__"`. It was not cut, so D-5 does not apply. `isClaimOverage` uses `hasOwnProperty` on a plain-object `_claim_names` and emits a value-free warn with `reason: "claim_overage"`. **Verified.**

---

## Findings

### Blocking

None.

### Non-blocking

**N1. [Medium, pre-existing, made reachable] A demoted facilitator keeps running an open session.**
Task 2.3 records that `start`, `begin-voting`, `reveal`, `topics/advance`, `complete`, `facilitator-state` and `participants-roster` all succeed after demotion. Only `advance` (draft to lobby) re-checks the live role. I confirmed the cause in code: those handlers gate on `sessions.facilitator_id === userId` and read `global_role` only for the audit row. The facilitator path of `evaluateSessionSubscriberAccess` (Path 3) checks only `facilitator_id` and status, so the demoted person also keeps the live event stream, including `vote_revealed`, until `complete`.

- **Introduced?** No. The gating predates this change, and `git diff main` touches none of those handlers.
- **Made worse?** It became reachable. Before #243 the IdP could not grant `facilitator` at all. A facilitator set directly in the database was overwritten to `engineer` at every sign-in by the `global_role = EXCLUDED.global_role` upsert, so in practice demotion was already the default. With #243, demotion becomes an ordinary IdP group change, which makes the gap operationally relevant. The worst case is revocation for cause during a live session: even after the runbook's DB update, the person can still reveal, advance and complete the session they own.
- **A variant worth naming in FU-1:** a facilitator re-mapped to `engineering_manager` mid-session keeps the Path 3 live stream. That conflicts with the spirit of the no-manager rule. It needs an IdP change plus a re-sign-in during the session, so the likelihood is low.
- **Exposure is bounded:** the person already held the facilitator view moments earlier, the demotion itself waits for a re-sign-in (≤ ~90 min), and the window ends at `complete`. Nothing grants new data access beyond what they had.
- **Disposition:** I accept this for this change, with FU-1 (FU-10 folded in) **resolved before a second team goes live**. Recommended fix: re-check the live `global_role === "facilitator"` (or admin, per FR-8.2) in every `facilitator_id`-gated handler and in Path 3, and decide the hand-off behaviour for the orphaned session in the same follow-up. Add one line to the urgent-revocation runbook: *"a demoted facilitator can continue to operate a session they already opened; end that session (or wait for completion) as part of revocation."*

**N2. [Low] The urgent-revocation runbook updates by `email`.**
`UPDATE users SET global_role = 'engineer' WHERE email = ...` targets a column that is not the identity key. Email comes from a claim, may not be unique, and falls back to `<sub>@unknown`. On some IdPs a user can change it. Using it could demote the wrong row or miss the right one. Change the runbook to `WHERE oidc_subject = $sub AND oidc_issuer = $iss`, or at least require a `SELECT` that returns exactly one row first. The Redis instruction (`dipstick:session:*`) should say how to find the user's keys, because session keys are not named by user.

**N3. [Low, accepted residual of S2] "Local issuer" means any RFC 1918 address.**
`isPrivateAddress` returns true for `10/8`, `172.16/12` and `192.168/16`. A non-production deployment pointed at a real self-hosted IdP on a private address, such as an internal Keycloak at `10.x`, with no map, gets the identity default. If that IdP lets users edit the configured attribute, a user can make themselves `application_admin` on that deployment. This is the gate I asked for, and it matches persona-login, so I accept it. Add one sentence to the `docs/deployment.md` role-map section: *"any deployment using a real IdP must set `OIDC_ROLE_MAP`, even on a private network; the default exists only for the bundled stub."* A later hardening option is to also require `OIDC_ISSUER`'s host to be `localhost`/`127.0.0.1` for the default, which persona-login could share.

**N4. [Low] Invisible non-whitespace characters in keys are accepted.**
`String.prototype.trim` does not strip U+200B (zero-width space), U+2060 or the BOM inside a key. My probe confirmed that `{"Eng​":"engineering_manager"}` boots. The key then never matches, so this is a silent manager drop that copy-paste from IdP consoles can produce. It passes the production guard. It fails closed, so it is not an escalation path. Option: reject keys that match `/[​-‍⁠﻿]/` with a key-naming error. This can go to a follow-up.

**N5. [Low, operational] The unmapped warn line will be noisy on `groups` claims.**
With `OIDC_ROLE_CLAIM=groups`, every ordinary engineer carries groups such as "All-Staff" and gets `outcome: "unmapped"`, which logs one warn per sign-in. That trains operators to filter `OIDC role claim present but no value is in OIDC_ROLE_MAP`, which is the same line that would reveal a misspelled manager key. This is not a vulnerability. Consider `info` level for `unmapped` when the claim is an array, and keep `warn` for the string-claim case. Alternatively, rely on the follow-up's periodic per-role counts. Record it in the follow-ups.

**N6. [Info] Boot-failure text echoes the offending target value.**
`targets ${q(target)}` prints the operator's target string. That is configuration, it is JSON-escaped so it cannot forge a log line, and it appears only on a failed boot. This is consistent with the accepted key-name echo (S7). No action.

**N7. [Info] The claim-name lookup is not own-key, and that is harmless.**
`claims[ROLE_CLAIM_NAME]` would reach `Object.prototype` if an operator set `OIDC_ROLE_CLAIM=constructor` or `__proto__`. `normalizeClaim` discards functions and objects, so the result is `missing` and the user gets `engineer`. It is operator-controlled and fails closed. No action.

---

## Proposed statuses for `security-review.md`

I am writing them here because this task permits only this file. Marcus or I can transfer them at sign-off.

| Point | Proposed status |
|---|---|
| 1 Permitted targets | accepted |
| 2 Production and issuer guards | accepted (presence, not effectiveness, is documented; N3 doc sentence recommended) |
| 3 Own-key lookup | accepted |
| 4 Precedence | accepted (conditional S1 satisfied by D11 + discard line + docs rule) |
| 5 Discard log line | accepted with follow-up #241 (durable record) |
| 6 Admin bypass of facilitator `isMember` guard | accepted with follow-up (S9 fingerprint). Admin cannot create sessions, so the bypass is limited to team topic and content management |
| S1 / D11 | accepted, verified at E1–E4 and every reuse site |
| D-1 Discard logged, not audited | accepted with follow-up #241 |
| D-2 Mid-session demotion | accepted with follow-up FU-1 (FU-10 folded), **must resolve before a second team goes live**; add the N1 runbook line |
| D-4 ~90-minute revocation bound | accepted, pinned by `middleware.test.ts`; fix the runbook per N2 |
| D-5 Scanner cut | not applicable (not cut) |
| D-7 #235 reconciliation | accepted with follow-up (#235/#241 re-run S1 and S4) |

New follow-ups to file under task 6.5: N2 (runbook keying, which can be fixed in this change since it is docs-only), N4 (invisible-character key check) and N5 (unmapped warn level).
