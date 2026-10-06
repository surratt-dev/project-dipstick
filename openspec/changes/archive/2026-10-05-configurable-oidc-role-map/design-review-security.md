# Design Review: Configurable OIDC role map (#243), Security

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-10-05
**Artifacts reviewed:** `design.md`, `proposal.md`, `tasks.md`, `specs/{oidc-role-mapping,first-access,auth-error-handling,local-dev-environment}/spec.md`; code: `auth/account-resolver.ts`, `config.ts`, `routes/auth.ts` (callback and audit), `auth/middleware.ts` (refresh), `auth/standing-facilitator-access-helper.ts`, `auth/session-subscriber-access-helper.ts`, `routes/sessions.ts`, `routes/teams.ts`.
**Scope:** This is the design-stage review. It does not replace the `security-review.md` sign-off required by task 6.1. That sign-off is against the implemented code.
**Binding decision respected:** Fixed precedence (`application_admin > engineering_manager > facilitator > senior_engineer > engineer`) and single-value `global_role` are not reopened. Where a finding comes from precedence, the remedy proposed is a signal, a doc rule or a guard, never a change to the ordering.

## Verdict

**Approve with required changes.** The design is sound on the three points #243 asked about: it fails closed on bad config, it requires the map in production, and own-key lookup is done properly. My concern is with what the design leaves implicit. I found one new fail-open path for the no-manager rule that comes from the precedence rule (S1). The identity default is reachable on a real IdP (S2). Two implementation traps would break the "no values in logs" promise (S3, S4). And the spec says refresh re-evaluates the role, which the code does not do (S5). None of these needs a redesign.

---

## The three points #243 asked about

### P1. Precedence rule: accepted with required change S1

Taking the highest-ranked role is deterministic and the result type is the closed `GlobalRole` union, so it cannot produce a role the compiler doesn't know. A claim cannot escalate past what the operator mapped: every grant comes from an operator-written key on a signed ID token. The design already covers the admin+facilitator and EM+facilitator collapses (discard log line, docs rule).

The design does **not** cover **EM + admin → `application_admin`**. The spec pins it as a scenario ("Admin and manager resolve to admin") but no risk entry analyses it. See S1. It is the most important finding in this review.

### P2. Fail at startup on bad config: accepted

Validation runs in `loadConfig` before the server listens, uses the existing `console.error` + `process.exit(1)` pattern, and stops at the first failure. That is the right shape. Some specific points I checked:

- Rejecting `engineer` as a target is a good control. Without it, one mistaken line could hide a manager group.
- Rejecting keys with leading or trailing whitespace is good. `String.prototype.trim` also strips NBSP and other Unicode whitespace, which catches copy-paste mistakes from IdP consoles.
- Treating an empty or whitespace-only value as unset is safe because in production "unset" also fails boot.
- Duplicate-key rejection matters for security. With last-wins, `{"X":"application_admin", …, "X":"senior_engineer"}` reads one way in review and behaves another way at runtime. See S6 on the scanner's fail-closed behaviour and on the cut-to-follow-up rule.

Two gaps: the `JSON.parse` error-message leak (S3) and the target-allowlist lookup (S4).

### P3. Require the map in production: accepted, with one limitation stated

Failing boot when the map is unset or has no `engineering_manager` target is the right secure default. It turns a silent fail-open into a loud deploy failure. I support the breaking change.

**Limitation that should be written down:** this guard checks only that an EM key *exists*. It cannot tell whether that key ever *matches* anyone. A typo, a case mismatch, a renamed group, an Entra overage, or the documented placeholder workaround all pass it. The guard makes the operator acknowledge the rule, and it does not prove the rule is enforced. The design half-says this under "Silent manager drop". Add one sentence to D5 that states it, so nobody later cites the guard as proof that managers are excluded. S8 suggests a follow-up that detects this at runtime.

The `NODE_ENV === "production"` exact-match comparison is shared with every existing guard. `NODE_ENV=prod` or `Production` falls through to the identity default. This weakness already exists and is not introduced here, but S2 makes it matter less.

---

## Findings

### S1. [High, required] EM who is also in the admin group escapes the no-manager rule

**Path:** A user is in both `Eng-Managers` and `Dipstick-Admins`. They resolve to `application_admin`, so `users.global_role` is not `engineering_manager`. The no-manager checks compare only against `engineering_manager`: `sessions.ts` lines 150 and 382, `session-subscriber-access-helper.ts` lines 159–160, `facilitator-sessions.ts` lines 1298–1299. TEAM-006 also cannot record this person as a team manager, because its precondition is `global_role = 'engineering_manager'`. So `team_memberships.role` stays `participant` unless it was set earlier. If this person is a team member, both halves of the dual check pass. They can register as a participant, lock in votes and receive live session events.

Before this change, a single-string claim could not carry both roles, so array claims introduce this path. The design's goal "every way a bad config could weaken the no-manager rule fails at startup, or at least warns" is not met for it. It is also invisible: no log line fires, and the audit row says `application_admin`, which looks correct.

**Required (none of these changes precedence):**
1. **Manager-discard log line.** Extend the D7 discard signal to fire when the resolved role is `application_admin` and an `engineering_manager` mapping was also present. Use the same value-free shape `{ claimName, resolvedRole, discardedRole: "engineering_manager", correlationId }`, on every sign-in, for new and returning users. This could be generalised as "any mapped role discarded by precedence, except `senior_engineer`". The cost is the same as the facilitator line.
2. **Docs rule.** Add "people in the manager group must not also be in the admin group" next to the facilitator rule in task 5.2, and explain the consequence.
3. **Pin it.** Add a risk entry to design.md and a spec scenario under the discard requirement, so that #235/#241 inherit it explicitly when reconciling.
4. **Decide whether admins may participate (follow-up, not this change).** If an application admin should never vote as a participant, that is a product rule. It would also close this path regardless of precedence. File it under task 6.5 and link it from the sign-off.

### S2. [High, required] The identity default is reachable on a real IdP

Outside `NODE_ENV=production`, an unset map makes the raw strings `application_admin` and `engineering_manager` grant those roles. The design accepts this for `staging`/`uat` and mitigates it with documentation and `source=default` in the summary line. That mitigation depends on operators remembering to read the docs, and I don't accept discipline as the control here:

- Several IdPs let users or low-privilege admins write custom attributes, for example user-editable profile attributes and app metadata. If the configured claim comes from one of those, any user on a staging deployment can make themselves `application_admin` by typing the string.
- Staging environments on real IdPs often hold copies of real data and are reachable from the corporate network. "Internal" and "non-production" are not risk exemptions.
- The exact-match `NODE_ENV` check means a mislabelled production deployment (`prod`) silently gets the default *and* skips the EM guard.

**Required:** Gate the identity default the same way persona-login gates `/auth/dev-login-options` (`routes/auth.ts`, design D2 of persona-login). The default applies only when `NODE_ENV !== "production"` **and** `isPrivateAddress(OIDC_ISSUER)`. If the map is unset and the issuer is not private, fail boot with `OIDC_ROLE_MAP is required when OIDC_ISSUER is not a local address`. `isPrivateAddress` fails closed, so an unrecognised issuer requires a map, which is the safe direction. Local dev (`http://localhost:4011` in both `.env.example` and `docker-compose.yml`) and the stub are unaffected. This replaces a docs-only mitigation with a structural one, and it does not touch precedence or storage.

If the team rejects this, the minimum acceptable fallback is a **warn-level** startup line, not just `source=default` in an info line, whenever the default is active with a non-private issuer. Record the rejection as an explicit accepted risk in the sign-off.

### S3. [Medium, required] `JSON.parse` error messages echo the raw value

On Node 20 and later (this repo runs v25), `JSON.parse` includes a fragment of the input in its error message. I checked: `Unexpected token 'x', ..."k-Admins":x}" is not valid JSON`. If `parseRoleMap` builds its "not valid JSON" error from `err.message`, or `loadConfig` logs the caught error, map content reaches stdout and breaks the "Startup errors do not echo the map" requirement. For a short map, the fragment *is* the full value.

**Required:** The invalid-JSON error must be a fixed string, optionally with the character position. It must never include `err.message` or `err.cause`. Add a unit test with a short invalid value (under 30 characters) and assert that no substring of length 4 or more from the input appears in the thrown message. The current task 1.5 test, "full raw string absent", would pass even while a fragment leaks.

### S4. [Medium, required] The target allowlist check must also be own-key

D2 handles prototype keys on the *lookup* side well: the `Map` is right, and the `__proto__`-as-written-key test is right. The *target* side and `RANK` are not covered. If the target check is written as `target in RANK`, `RANK[target] !== undefined`, or against a plain-object allowlist, then the targets `"toString"`, `"constructor"` and `"__proto__"` pass validation. The resolver then puts a non-role string into `global_role`. The Postgres enum would reject it, but only at sign-in, as a 500, after boot was declared healthy.

**Required:** Validate targets against a `ReadonlySet` of the four permitted strings. Make `RANK` a `Map` or a null-prototype object. Add the scenarios `{"A":"toString"}` and `{"A":"__proto__"}`, where `"__proto__"` is the target *value*, and expect a boot failure naming key `A`.

### S5. [Medium, required spec fix] Revocation timing is misstated, and the real bound is implicit

`first-access` item 5 (delta) says re-evaluation happens on "both initial sign-in and token refresh / re-login". The code disagrees. `refreshSessionTokens` (`auth/middleware.ts` around lines 88–105) updates the access and refresh tokens only. It does not read the refreshed ID token or call `resolveOrCreateAccount`. Roles are re-resolved only in `/auth/callback`.

The real behaviour is acceptable, but nobody has written it down:
- Authorization reads `users.global_role` from the database on each request and on WebSocket re-authorization. Once the row changes, revocation is immediate everywhere. Good.
- The row changes only at interactive re-sign-in. The 90-minute absolute session lifetime (`ABSOLUTE_LIFETIME_MS`) forces one. **So the worst-case latency for an IdP-side demotion is about 90 minutes**, including demotion of an `application_admin`. A backend restart after a map change does not shorten this, because sessions live in Redis.

**Required:** Change item 5 to say re-evaluation happens at each interactive sign-in, not at token refresh. State the 90-minute bound in the "Role map changes take effect at next sign-in" requirement and in `docs/deployment.md`. Add a runbook line for urgent revocation, such as an admin removed for cause: invalidate that user's sessions as well as changing the group. If no operator tool exists to do that, file a follow-up. I am not asking for refresh-time re-resolution in this change. Not every IdP returns an ID token on refresh, and doing it on some IdPs and not others would be worse than one documented bound.

### S6. [Low, required] The duplicate-key scanner must fail closed, and its cut must not be silent

- When the scanner hits input it cannot tokenise but `JSON.parse` accepted, it must **fail boot**, not skip the check.
- Keys must be compared *after* JSON decoding, as D3 says, so `"Eng-Managers"` and `"Eng-Managers"` count as duplicates. Make this the second test in task 1.3, or a third: it is the bypass case.
- If the scanner is cut under the D3 budget rule, that decision changes how a security control behaves. It must be recorded in the security sign-off as an accepted risk with a follow-up link, not only in the proposal.

### S7. [Low, should] Logging and claim-value hygiene

- The value-free rules (claim name, internal role name, `correlationId`) are correct, and so is the decision to keep claim values out of audit. Keep them.
- The optional D7 debug line `{ ignoredCount }`: drop it, or keep it at debug level and never enable it in production. The number of groups a user belongs to is a weak fingerprint and nobody needs it for operations.
- Task 2.3's "no logged field contains a claim value" test should spy on **every** logger call during the callback, not only the role-mapping calls. That catches a future `log.warn({ claims })`.
- Operator key names in boot-failure messages are acceptable. They are configuration, and the boot failed. Note in `docs/deployment.md` that group names will appear in deploy logs on a failed boot.

### S8. [Low, follow-up] Silent manager drop needs a runtime signal

The startup guard (P3) cannot see a key that never matches. One case is cheap to detect: **Entra group overage**. When a user is in too many groups, the token carries `_claim_names.groups` and no `groups` claim. Today that normalises to "missing", which is silent and produces `engineer`, so a manager over the limit drops through the no-manager rule with no signal. **Should:** when `claims._claim_names?.[claimName]` is present, log one value-free warn `{ claimName, correlationId, reason: "claim_overage" }`. That is a few lines and fits in this change. **Follow-up:** a periodic count of sign-ins by resolved role, so that "zero `engineering_manager` resolutions in 30 days" on a deployment that has managers is something an operator can see.

### S9. [Info, follow-up] Map configuration is not an audited event

Map changes are recorded only in deploy history and the startup summary, which has counts only. Who granted admin to which group, and when, cannot be reconstructed from the app. Follow-up: include a short fingerprint of the canonicalised map in the summary line, for example the first 12 hex characters of a SHA-256, so map changes show up in logs over time without printing keys. Group names are not secrets, so a hash is enough.

---

## The six sign-off points in task 6.1 (pre-assessment)

| # | Point | Design-stage position |
|---|---|---|
| 1 | Permitted targets | Accept, subject to S4 (own-key target check) |
| 2 | Production guards | Accept. Add the "presence, not effectiveness" sentence (P3). S2 widens the guard to non-private issuers |
| 3 | Own-key lookup | Accept (D2 is correct). S4 covers the target side |
| 4 | Precedence | Accept as decided, **conditional on S1** (manager-discard signal and docs rule) |
| 5 | Discard log line | Accept. Generalise it to cover the EM discard (S1). The audit flag is deferred to #241: accept with follow-up |
| 6 | Admin bypass of facilitator `isMember` guard | Accept with follow-up. The bypass is FR-8.2 [HARD] and unchanged. With group mapping, the number of admins is now set by IdP group size, which the app cannot see. The docs warning about broad groups and the summary-line admin count are the only controls. Add S9's fingerprint so admin-mapping changes can be detected. If admins become barred from participating (S1.4), revisit then |

## Decisions that are deferred or implicit

The sign-off has to cover each of these explicitly:

1. **Discard is logged, not audited.** The durable record is deferred to #241. Logs and audit have different retention, so for that whole period the conflict can only be reconstructed while the logs are retained. Accept with a link to #241.
2. **Mid-session facilitator demotion** (proposal follow-up 1). The interim behaviour is "expected but not verified end to end". Before go-live I want one integration test that demotes a facilitator during a `live` session and asserts that facilitator-only actions return 403. "Not verified" is not something I'll sign off on for an authorization path.
3. **Identity default on non-production real IdPs.** It is implicit that docs are the control. S2 makes it structural.
4. **Revocation latency of about 90 minutes.** Implicit today, and misstated in the spec (S5).
5. **The duplicate-key scanner cut rule.** If it is cut, the sign-off has to record it (S6).
6. **The EM + admin collapse.** It is pinned as a scenario but has not been analysed (S1).
7. **Reconciling with #235.** Whichever change lands second has to re-run this review's S1 and S4 checks against the merged resolver. Add that to the #235/#241 hand-off.

## Required before implementation starts

S1 (items 1–3), S2, S3, S4, and the spec wording in S5. S6 and S7 can be handled in tasks. S8's overage warning is recommended for this change. The remaining items are follow-ups to file under task 6.5.
