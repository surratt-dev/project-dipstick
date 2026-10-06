# Design: Configurable OIDC role map (#243)

**Author:** Ingrid Sollenberger, Solution Architect
**Revision:** 3. Revision 2 incorporated `design-review-engineer.md` (R1–R6, C1–C8) and `design-review-security.md` (S1–S9). Revision 3 applies the binding user decision on S1: application admins are denied live-session participation (D11). See "Review disposition" at the end.

## Context

`users.global_role` has one writer, the IdP. It is re-read from the signed ID token at every **interactive** sign-in (`/auth/callback`) (first-access Decision 2). Token refresh (`refreshSessionTokens`, `auth/middleware.ts`) replaces only the access and refresh tokens. It does not read a new ID token and does not call `resolveOrCreateAccount`. Today `mapRoleClaimToGlobalRole` (`packages/backend/src/auth/account-resolver.ts`) runs `String()` on the claim and checks the result against `PERMITTED_GLOBAL_ROLES = {engineer, engineering_manager, application_admin}`. This has three consequences:

- An IdP that sends its own group names cannot grant any role.
- Array claims are flattened to `"a,b"` and never match.
- `facilitator` and `senior_engineer` can never be granted, which leaves the 01b decision (IdP designates facilitators) unimplementable.

There is also an existing defect that this change has to fix rather than copy (R2). The resolver calls `logger.warn("message", { claimName })`. The logger is Fastify's pino logger, and pino takes the fields object **first**. As written, `claimName` never reaches the log. The unit test passes only because it uses a hand-rolled `{ warn: vi.fn() }` spy.

Role checks across the backend compare `global_role` against exact strings: the no-manager checks in `session-subscriber-access-helper.ts`, `sessions.ts` and `facilitator-sessions.ts`, the facilitator gates in `standing-facilitator-access-helper.ts`, `facilitator-sessions.ts`, `topics.ts` and `content.ts`, and the admin gates. None of those checks change. This change only alters the value they are given. There is no `GlobalRole` type in the codebase today: `ResolvedUser.globalRole` and every helper use `string` (R1).

Config is loaded once at module load in `packages/backend/src/config.ts` (`loadConfig`). That function already applies production guards and exits with `console.error` + `process.exit(1)`. It runs before Fastify exists, so its output is plain `console.*` text, not pino JSON. `config.ts` also exports `isPrivateAddress`, which persona-login already uses to gate the dev-login endpoint and which fails closed. `auth.role_claim_mapped` is emitted in `packages/backend/src/routes/auth.ts` inside `withAuditTransaction`, currently when a returning user's role is not `engineer`.

**Binding user decision:** #243 ships as written. It keeps its own fixed precedence (`application_admin > engineering_manager > facilitator > senior_engineer > engineer`) and a single-value `global_role`. The overlap with #235/#238/#241 is recorded in the proposal as a risk and is not a design input. Every review item below is resolved without changing either.

## Goals / Non-Goals

**Goals**
- Per-deployment translation from IdP claim values to the five fixed internal roles. String and array claims both work.
- Every way a bad config could weaken the no-manager rule either fails at startup, is closed by enforcement, or produces a value-free warning an operator can find. The EM + admin collapse that the decided precedence produces is closed by enforcement (D11): application admins cannot take part in live sessions.
- Operators can diagnose a facilitator who cannot run a session without claim values ever being logged.
- Dev, test and the local stub work with zero configuration. Under the default map, `facilitator-001` is a real facilitator.
- A real (non-local) IdP never receives the identity default, whatever `NODE_ENV` says.

**Non-Goals**
- Changing the `user_role` enum, the API contract, or team membership roles. A `GlobalRole` TypeScript type is introduced at the resolver boundary only; widening it across the backend belongs to the "predicates" follow-up.
- Role-set storage, configurable precedence, configurable default, or case-insensitive matching.
- A user-facing notice for EM + facilitator, or a "your resolved role" indicator. Those belong to #241 or are follow-ups.
- Changing the admin bypass of the facilitator `isMember` guard. It is listed for security review only.
- Changing what admins can do outside live sessions (team administration, join-link creation, topic management, team membership). D11 is limited to session participation and live session events.
- Re-resolving roles at token refresh (S5: not every IdP returns an ID token on refresh).
- Replacing role-string comparisons with predicates (tracked separately).

## Decisions

### D1. A pure, leaf `role-map` module, called from `loadConfig`

Add `packages/backend/src/auth/role-map.ts`. It **must not import `config.js`, `db.js` or anything that does** (R4): `config.ts` imports from it, so any import in the other direction is a load-time cycle. Its only imports are type-only or Node built-ins.

It exports:

- Types (R1): `GlobalRole = "engineer" | "senior_engineer" | "facilitator" | "engineering_manager" | "application_admin"` and `MappableRole = Exclude<GlobalRole, "engineer">`. A `GLOBAL_ROLES` readonly array carries the same labels at runtime. A unit test reads `packages/backend/migrations/1_create_enums.sql`, extracts the `user_role` labels, and asserts they equal `GLOBAL_ROLES`. That test is the only thing tying the TS union to the Postgres enum.
- `PERMITTED_TARGETS: ReadonlySet<MappableRole>` (S4) and `RANK: ReadonlyMap<MappableRole, number>`. `RANK` is built from a `Record<MappableRole, number>` literal so a missing or extra role is a compile error, then frozen into a `Map` so no lookup ever reaches `Object.prototype`.
- `DEFAULT_ROLE_MAP` (D6), exported for tests (R4). `parseRoleMap` returns a fresh `Map` copy of it, never the shared instance, because `ReadonlyMap` is a compile-time guarantee only (implementation review C1).
- `RoleMapConfigError`: message only; never carries the raw value, a `JSON.parse` message, or a `cause` (S3).
- `parseRoleMap(raw: string | undefined, env: { nodeEnv: string; issuerIsPrivate: boolean }): { map: ReadonlyMap<string, MappableRole>; source: "configured" | "default"; warnings: string[]; summary: string }`. `issuerIsPrivate` is computed by `loadConfig` with the existing `isPrivateAddress(OIDC_ISSUER)`, so the module stays a leaf.
- `normalizeClaim(claim: unknown): string[]` and `mapValues(values, map): MappableRole[]`, exported separately so a later #235 rebase only touches the `max` step.
- `resolveGlobalRole(claim: unknown, map): { role: GlobalRole; discardedRoles: ReadonlyArray<"engineering_manager" | "facilitator">; outcome: "missing" | "unmapped" | "mapped" }`. `discardedRoles` drives a log line only; it is never written to audit metadata (D8).
- `isClaimOverage(claims: Record<string, unknown>, claimName: string): boolean` (S8): true when `claims._claim_names` is a plain object with an own property `claimName`.

`parseRoleMap` treats an empty or whitespace-only `raw` as unset. This matches `loadConfig`, which already skips falsy optional variables, and extends it to whitespace so `OIDC_ROLE_MAP= ` in a compose file behaves the same as an undeclared variable.

*Why:* pure functions are unit-testable without spawning processes or mocking env, and the exit behaviour matches the existing guards. *Alternative rejected:* parsing lazily in `account-resolver.ts`. A bad map would then surface only at the first sign-in, not at boot.

### D1a. Config wiring (R5, R6, C3)

`OIDC_ROLE_MAP` is **not** added to `loadConfig`'s `optional` list. The generic loop would copy the raw JSON string onto the exported `config`, and anything that later logs `config` would print the whole map. Instead `loadConfig` reads `env.OIDC_ROLE_MAP` directly, calls `parseRoleMap` after the three existing production guards, and returns `FullConfig & { roleMap: ReadonlyMap<string, MappableRole>; roleMapSource: "configured" | "default" }`.

On a `RoleMapConfigError` it prints `console.error("FATAL: " + message)` and exits with code 1, like the existing guards. Otherwise it prints each warning with `console.warn` and the summary with `console.info`. Every line starts with the fixed prefix `OIDC_ROLE_MAP:` (for example `OIDC_ROLE_MAP: source=configured engineering_manager=2 facilitator=1 application_admin=0 senior_engineer=0`). These are plain-text lines on stdout/stderr, not pino JSON. The docs tell operators to grep for the prefix. Vitest workers that import the real `config.js` print the default summary once per worker; that is noise, not a defect.

**Test harness (R6):** `loadConfig` becomes `export function loadConfig(env: NodeJS.ProcessEnv = process.env)`, and `export const config = loadConfig()` stays as it is. `__tests__/config.test.ts` calls `loadConfig({...})` directly with `vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit") })` and a `console.error` spy. Production cases must satisfy the earlier guards first (`APP_ORIGIN` set, a `SESSION_SECRET` of at least 32 characters, a public `OIDC_ISSUER`), and every exit assertion checks for the `FATAL: OIDC_ROLE_MAP` text, so a test cannot pass by exiting for the wrong reason. The existing module-level `process.env["OIDC_ISSUER"] ??= "https://idp.example.com"` in that file means its real-import cases now need `OIDC_ROLE_MAP` set (see D6 and S2). That file is the only test that imports the real config with a public issuer. Every other test either mocks `config.js` or uses `http://localhost:4011`.

### D2. Own-key lookup on both sides: claim values and targets

The parsed map is a `Map<string, MappableRole>` built from `Object.entries` of the parsed JSON. Lookups use `map.get(value)`, so claim values like `constructor`, `__proto__` and `toString` only resolve if the operator wrote them. `JSON.parse` turns a literal `"__proto__"` key into an own property, so `Object.entries` picks it up correctly. A test covers an operator who deliberately writes `"__proto__"` as a key.

The **target** side gets the same treatment (S4). A target is valid only if `PERMITTED_TARGETS.has(target)`. `target in RANK`, `RANK[target]` and plain-object allowlists are forbidden, because they would accept `"toString"`, `"constructor"` and `"__proto__"` as targets. Those would pass boot and fail later as a 500 at sign-in when Postgres rejects the enum value. Tests: `{"A":"toString"}` and `{"A":"__proto__"}` (the target **value** is `__proto__`) each fail boot naming key `A`.

*Alternative:* a null-prototype object or `Object.hasOwn`. Both work, but `Map`/`Set` makes the intent obvious and is hard to undo by accident.

### D3. Duplicate-key detection by scanning top-level keys

`JSON.parse` silently keeps the last duplicate. After a successful parse to a plain object, `parseRoleMap` runs a small string-aware scanner over the raw text. It has to handle three things (C4):

1. **Escape sequences inside strings.** On `\` it skips the next character, so `"a\"b"` is one token.
2. **Key position versus value position.** At depth 1, a string is a key only if the previous significant token was `{` or `,`. A string after `:` is a value. Depth tracking on its own is not enough.
3. **Escape-equivalent keys (S6).** Each key token is decoded with `JSON.parse` before comparison, so `"Eng-Managers"` and `"Eng-Managers"` count as duplicates.

It fails on the first repeat, naming the decoded key (escaped per D4). It **fails closed** (S6): if it meets input it cannot tokenise even though `JSON.parse` accepted it, boot fails with `OIDC_ROLE_MAP: could not verify that keys are unique`. It never skips the check.

*Alternative rejected:* a third-party JSON parser with duplicate detection. A new dependency on the auth path is not worth it for a few lines of scanner.

*Budget:* one small function with three tests: a real duplicate, an escape-equivalent duplicate (the bypass case, S6), and duplicate-looking text containing an escaped quote inside a key string that must not false-positive (C4). If it grows beyond that or stalls security review, it moves to a follow-up and the "Duplicate map keys are rejected" requirement is dropped from this change. The cut must be recorded in **both** the proposal and `security-review.md` as an accepted risk with a follow-up link, because it changes how a security control behaves (S6). The per-target counts line remains the operator's fallback check.

### D4. Validation order and messages

Validation runs in this order, stopping at the first failure:

1. JSON parse
2. Object (not array or `null`)
3. Duplicate keys
4. For each entry: non-empty key, no leading or trailing whitespace in the key, no control or zero-width characters (U+200B–U+200D, U+2060, U+FEFF) anywhere in the key (added after implementation review N4), string target, non-empty target, permitted target (with `engineer` called out specifically)
5. Deployment guards:
   a. `NODE_ENV === "production"`: map set, and at least one `engineering_manager` target.
   b. Any other `NODE_ENV`: if the map is unset and `issuerIsPrivate` is false, fail (D6).

Each message names the rule and at most one key and target, e.g. `OIDC_ROLE_MAP: key "Eng-Managers" targets "engineer", which is not permitted (engineer is the fixed default)`. Keys and targets are interpolated with `JSON.stringify(...)` (C2), so a key containing a newline, a quote or an ANSI escape cannot split or forge lines in the boot log. The implementation also escapes the characters `JSON.stringify` leaves raw (Unicode format characters, C1 controls and U+2028/U+2029) as `\uXXXX`, so an invisible character in a key is visible in the error.

The invalid-JSON message is a **fixed string** (S3): `OIDC_ROLE_MAP is not valid JSON`, optionally followed by a character position. It never includes `err.message` or `err.cause`. On Node 20 and later, `JSON.parse` messages quote a fragment of the input, and for a short map the fragment is the whole value. Test: an invalid value under 30 characters, asserting that no substring of length 4 or more from the input appears in the thrown message. The full raw value never appears in any message, and a test asserts this too.

Operator-chosen key names do appear in errors. That is acceptable: they are configuration, not claim values from tokens, and they are printed only on a failed boot. `docs/deployment.md` says that group names can appear in deploy logs on a failed boot (S7).

### D5. Production rules: boot failure for managers, warnings for facilitator and admin

With `NODE_ENV=production`, startup fails if the map is unset (including empty or whitespace-only) or no key targets `engineering_manager`.

Whenever the map is **configured**, in any `NODE_ENV`, startup warns once for each of `engineering_manager` (non-production only; production fails instead), `facilitator` (*"no IdP value maps to facilitator; no user will be able to run a session"*) and `application_admin` that no key targets. The built-in default targets all four roles, so it never warns. A developer testing a real IdP map locally sees the same warnings production would show.

*Why the asymmetry:* a missing manager mapping silently opens the room to managers, which damages trust in the ritual and is invisible. A missing facilitator mapping stops sessions, which is loud and recoverable. Only the silent failure earns a boot failure. A deployment with genuinely no managers maps a placeholder group that nobody belongs to (for example `{"Dipstick-No-Managers":"engineering_manager"}`). `docs/deployment.md` states this in one sentence as a documented choice.

**What this guard does not prove (P3):** it checks that an `engineering_manager` key *exists*, not that it ever *matches* anyone. A typo, a case mismatch, a renamed group, an Entra overage, or the placeholder workaround all pass it. It makes the operator acknowledge the no-manager rule. It is not evidence that managers are excluded, and nobody should cite it as such. S8's overage warning covers one of those cases at runtime. The rest are a follow-up (periodic resolution counts).

`NODE_ENV` is matched exactly against `"production"`, the same as every existing guard. `NODE_ENV=prod` is not production. D6's issuer gate is what keeps such a mislabelled deployment from getting the identity default.

### D6. Identity default, only for a local issuer outside production (S2)

The built-in default is used only when **all three** hold: the map is unset, `NODE_ENV !== "production"`, and `isPrivateAddress(OIDC_ISSUER)` is true. It is the same two-part gate persona-login uses for `/auth/dev-login-options`. If the map is unset and the issuer is not private in any non-production `NODE_ENV`, boot fails with `OIDC_ROLE_MAP is required when OIDC_ISSUER is not a local address`. `isPrivateAddress` fails closed (IPv6, hostnames and obfuscated literals return false), so an issuer it does not recognise requires a map, which is the safe direction.

*Why structural rather than docs:* several IdPs let users or low-privilege admins write custom attributes. On a staging deployment pointed at such an IdP, the identity default would let anyone type `application_admin` into their own profile and become an admin. A mislabelled production deployment (`NODE_ENV=prod`) would get the same default and also skip the manager guard. Documentation is not a control for either case. Local dev (`http://localhost:4011` in `.env.example`, `docker-compose.yml` and CI's `integration.yml`) and the stub are unaffected.

The default map is `new Map([["application_admin","application_admin"], ["engineering_manager","engineering_manager"], ["facilitator","facilitator"], ["senior_engineer","senior_engineer"]])`. It is built in code, not parsed from a string, so the parser's rules never need an exception for it. A claim of `engineer` falls through to the fallback, which gives the same result as today without making `engineer` a valid target.

### D7. Resolution algorithm and sign-in logging

```
normalize(claim):
  string, non-empty        -> [claim]
  array                    -> claim.filter(isString).filter(nonEmpty)
  anything else / "" / []  -> []          (an array with no non-empty strings also normalizes to [])
mapped = values.map(v => map.get(v)).filter(defined)
if values empty            -> engineer, outcome "missing"
if mapped empty            -> engineer, outcome "unmapped"
role = argmax(mapped) by RANK.get   (application_admin 4, engineering_manager 3, facilitator 2, senior_engineer 1)
discardedRoles = ["engineering_manager", "facilitator"]
                   .filter(r => mapped.includes(r) && RANK.get(role) > RANK.get(r))
```

The precedence is a constant in `role-map.ts`, and the returned type is `GlobalRole` (D1), so the compiler rejects any new string. `senior_engineer` is never reported as discarded: no gate or rule depends on it.

**Wiring (R3, R4):** `resolveOrCreateAccount(claims, { logger, roleMap, client })` takes an options object. `logger` is typed `Pick<FastifyBaseLogger, "warn">` (R2), and `roleMap` is required. If `roleMap` is missing at runtime, the resolver throws. There is **no silent fallback to `DEFAULT_ROLE_MAP`**, which would be exactly the fail-open path this change exists to close. `routes/auth.ts` passes `request.log.child({ correlationId })` as `logger` and `config.roleMap` as `roleMap`. Every resolver line therefore carries `correlationId` without the resolver knowing about it. The resolver no longer reads `config.roleMap`. Tests pass `DEFAULT_ROLE_MAP` or a custom map and do not need `roleMap` on their `config.js` mocks.

**Log lines (all pino, fields object first, message second, R2):**

- `missing`: no log, **except** when `isClaimOverage(claims, claimName)` holds (S8). Then one warn `{ claimName, reason: "claim_overage" }`. This catches the Entra case where a user in too many groups gets `_claim_names.groups` and no `groups` claim, which would otherwise drop a manager to `engineer` silently.
- `unmapped`: one warn `{ claimName }` per sign-in attempt.
- `discardedRoles` non-empty: one warn `{ claimName, resolvedRole, discardedRoles }` on every sign-in where it holds, new or returning user, with no de-duplication. `resolvedRole` and `discardedRoles` are internal role names, not claim values. This covers admin + facilitator, EM + facilitator, and **admin + EM** (S1).
- Partial match: no log. The previously optional `debug { ignoredCount }` line is **dropped** (C6, S7): a group count is a weak fingerprint and nobody needs it.

`correlationId` arrives on every line through the child logger's bindings. The existing unmapped warn is rewritten in the same object-first form, which fixes today's dropped `claimName`.

**Test rules:** every logger-spy assertion checks `calls[i][0]` is the fields object and `calls[i][1]` is the message string, so the test enforces pino's argument order. The resolver tests prove the fields. One `auth.test.ts` test proves the route wiring: the logger handed to the mocked `resolveOrCreateAccount` was created by `request.log.child({ correlationId })` with the callback's id, and `roleMap` is `config.roleMap`. The "no claim value in logs" test spies on **every** logger method for the whole callback, not just the role-mapping calls (S7), so a future `log.warn({ claims })` fails it.

A rolled-back sign-in still leaves its warn line, because the resolver runs inside `withAuditTransaction` before commit and that helper has no retry loop. That is correct for a diagnostic line, which makes no claim about committed state.

### D8. Audit firing condition (no discard flag)

In `routes/auth.ts`, the returning-user branch moves from `globalRole !== "engineer"` to a single helper (C1):

```ts
function shouldEmitRoleClaimMapped(u: ResolvedUser): boolean {
  return !u.isNewUser && (u.globalRole !== "engineer" || u.globalRole !== u.previousGlobalRole);
}
```

The helper is called once, its result is stored in a `const`, and that value drives both the transactional `audit_log` INSERT and the post-commit `emitAuditEvent`, so the two cannot drift. The structured `auth.role_claim_mapped` event also gains `previousRole` (C1). It is an internal role name, so it is safe, and an operator reading the log stream can then see a demotion's previous role.

No discard is added to audit metadata on either `auth.role_claim_mapped` or `auth.first_access_created`. *Why:* #241 owns the durable, user-visible record of the EM/admin + facilitator conflict. A flag added here would be a new audit contract field that #241 must inherit or migrate. The value-free log line (D7) answers the operator's question for new and returning users without that cost. Logs and audit have different retention, so for now a discard can be reconstructed only while logs are retained. That is recorded for the security sign-off.

This makes demotion to `engineer` auditable, which is what the 01b decision already assumed. It replaces the "reversion is not represented" scenario in `auth-error-handling`.

### D9. Local stub

`docker/oidc/accounts.js` gives `facilitator-001` `role: "facilitator"`. Its header comment, which names `PERMITTED_GLOBAL_ROLES`, is rewritten. Under the default map, `facilitator-001` resolves to `facilitator`. Places that change in lockstep (C7):

- `routes/auth.ts` `DEV_LOGIN_OPTIONS`: `facilitator-001` goes from `seeded: false` to `seeded: true`. `seeded` is the single source of truth for the frontend's unseeded-role caveat.
- `packages/frontend/src/pages/__tests__/DevLoginPage.test.tsx`, `packages/backend/src/routes/__tests__/auth.test.ts`, `docker/oidc/__tests__/interactions.test.js`.
- `.env.example`: the `OIDC_ROLE_MAP` line stays **commented out**. A live example map without the identity entries would break persona login for `manager-001` and `admin-001`.

**Acceptance check for R15, at honest scope (C8):** two tests that together prove the path, both importing `accounts` from the stub so the fixture cannot drift. (1) Mapping: `resolveGlobalRole(accounts["facilitator-001"].role, DEFAULT_ROLE_MAP).role === "facilitator"`. (2) Gate: a real-DB route test seeds a `users` row with `global_role = 'facilitator'` and creates a draft session through the session-create route. The backend suite mocks `handleCallback`, so no single test is a browser-to-database end-to-end run, and the task does not claim to be one.

### D10. Spec placement

The new mapping behaviour is its own capability, `oidc-role-mapping`. `first-access` keeps the "mechanism for assigning global_role" requirement and points to it. The MODIFIED blocks in `first-access`, `auth-error-handling` and `local-dev-environment` keep existing scenario titles: the validator refuses to drop scenarios from a MODIFIED block. Retained titles that no longer match their bodies are renamed in the main specs after archive (task 7.6).

### D11. Application admins do not take part in live sessions (binding user decision on S1)

`application_admin` gets the same treatment as `engineering_manager` under the no-manager rule. An admin cannot be registered as a session participant, cannot lock in a vote, and does not receive live session events. Precedence is unchanged. The check sits where the `engineering_manager` check already sits, so a manager who resolves to `application_admin` because they are also in the admin group is excluded by the admin check. Signing in, team membership and join-link redemption are not affected, the same as for managers: the session-participation spec deliberately enforces at session participation, not at team join.

It is a narrow check on the existing condition, not a new helper. Enforcement points, at commit `c00b496`:

| # | Point | Today | Change |
|---|---|---|---|
| E1 | `packages/backend/src/routes/sessions.ts`, `POST /api/v1/sessions/:sessionId/participants`, `isEligible` (around lines 147–151) | `membership_exists && membership_removed_at === null && global_role !== "engineering_manager" && membership_role !== "engineering_manager"` | add `&& global_role !== "application_admin"` |
| E2 | `packages/backend/src/routes/sessions.ts`, `POST /api/v1/sessions/:sessionId/topics/:sessionTopicId/lock-in`, rejection condition (around lines 380–385) | rejects on missing/removed membership or either EM signal | add `\|\| global_role === "application_admin"` |
| E3 | `packages/backend/src/auth/session-subscriber-access-helper.ts`, `evaluateSessionSubscriberAccess`, participant path (lines 155–161) | requires participant row, active membership, and neither EM signal | add `&& row.global_role !== "application_admin"` |
| E4 | `packages/backend/src/routes/facilitator-sessions.ts`, participant roster query (lines 1298–1299) | excludes `u.global_role = 'engineering_manager'` and `tm.role = 'engineering_manager'` | add `AND u.global_role != 'application_admin'` |

E3 is the single WebSocket gate. Every live-session path calls it, so the one change covers all of them:
- connection: `realtime/websocket-routes.ts` line 101 (`/ws/sessions/:sessionId`, closes with `CLOSE_UNAUTHORIZED` on `null`);
- per-event delivery: every `evaluateSessionSubscriberAccess` call in `realtime/ws-event-dispatcher.ts` (lines 143, 175, 228, 322, 345, 398, 442);
- the periodic re-authorization sweep: `realtime/connection-reauthorization.ts` line 75, which closes a connection that already exists;
- the HTTP endpoints that reuse the grant: `GET /api/v1/sessions/:sessionId/action-items-review` and the roster endpoint (`facilitator-sessions.ts` lines 1188 and 1276), and `POST /api/v1/sessions/:sessionId/reveal-latency` (`sessions.ts`).

E3 changes only the **participant** path. The session-facilitator path (`facilitator_id = userId`, evaluated first) is untouched, which matches the manager rule. An admin cannot create a session, because draft creation requires `global_role = 'facilitator'` (`facilitator-sessions.ts` line 318). So the facilitator path is reachable by an admin only if a facilitator becomes an admin mid-session, and in that case they keep facilitator access to the session they are running, exactly as a facilitator who became a manager would.

**Error shape:** reuse what the manager denial already returns. There are no dedicated error codes.
- E1: HTTP 403, `{ error: { category: "invalid_request", message: "You are not eligible to participate as a voter in this session.", correlationId } }`, plus the existing synchronous `audit_log` row and structured event `session.participant_registration_rejected`. `actor_global_role` records `application_admin`, so admin denials can be told apart from manager denials without a new operation name.
- E2: HTTP 403 with the same envelope. The current message, `"Engineering Managers cannot lock in votes."`, would be wrong for an admin, so it becomes `"You are not eligible to lock in votes in this session."`. Category and status are unchanged. No backend or frontend code matches on the old text. No audit row, as today.
- E3: `null` grant. The WebSocket closes with the existing undisclosed close code, events are silently not delivered, and the HTTP endpoints that reuse the grant return their existing 403/404.
- E4: the admin is simply absent from the roster.

**Mid-session and existing rows:** like the manager rule, the checks read `users.global_role` live on every request and event. An admin's `session_participants` row from before this release, or from before a mid-session promotion, is not deleted. It no longer grants event access or lock-in, and votes already locked in are kept and counted at reveal, as they are for a manager. Because roles change only at interactive sign-in, a user who becomes an admin at the IdP is excluded at their next sign-in (at most about 90 minutes later, see Risks).

**Why not change `evaluateTeamAccess` or add a predicate:** team-content access already returns the admin path first and denies content. The gap was only in the four places above, which compare `global_role` against a single string. A shared `isExcludedFromParticipation(globalRole, membershipRole)` predicate would be cleaner, but it belongs to the "predicates" follow-up. Here the four conditions are edited in place, and a test pins each one.

## S1 premise check: what an `application_admin` can reach

The binding decision makes EM + admin resolve to `application_admin`. Security finding S1 says this lets such a person escape the no-manager rule. I checked that claim against the code at commit `c00b496`.

**Session history and retrospective content: protected. The premise does not hold here.** `evaluateTeamAccess` (`auth/team-content-access-helper.ts`) returns `{ path: "admin" }` for any `application_admin` **before** it looks at membership, so an admin who is also a team member never gets a member grant. Content endpoints (`routes/content.ts`: session history, trends, topic-config reads) reject admin grants with 403 and write `admin.session_content_denied` to `audit_log`. The EM views (`routes/em-views.ts`) require `grant.path === "member" && grant.role === "engineering_manager"`, which an admin can never satisfy.

**Live sessions: exposed before D11. The premise holds here.** Before this revision, the live-session no-manager checks compare only against the string `engineering_manager` and require only an active team membership. They had no admin branch (these are E1–E4 in D11):

- `routes/sessions.ts` participant registration (`isEligible`, around lines 147–151) and vote lock-in (around lines 380–385).
- `auth/session-subscriber-access-helper.ts` participant path (lines 155–161), which authorises live WebSocket events: state changes, vote readiness, and the reveal.
- `routes/facilitator-sessions.ts` roster query (lines 1298–1299).

A person whose IdP groups include both the manager and admin groups resolves to `application_admin`. TEAM-006 cannot record them as a team manager, because its precondition is `global_role = 'engineering_manager'`. So their `team_memberships.role` stays `participant` if they join through a join link, which any user can redeem. Admins can also create join links for a team they belong to. With a participant membership, they can register in a live session, lock in a vote that counts in the aggregate, receive the live events including the reveal, and appear on the roster. Nothing is logged, and the audit row says `application_admin`, which looks correct. If the person had already been recorded as a team manager while their `global_role` was `engineering_manager`, the `membership_role` half of the dual check still excludes them. The gap is new memberships.

Before this change, a single-string claim could not carry both roles. Array claims create this path, and the decided precedence fixes the outcome.

**What this change does about it (precedence untouched):**

0. **Enforcement (D11, binding user decision):** application admins are denied participant registration, vote lock-in and live session events at E1–E4. This closes the path for everyone resolved to `application_admin`, whether or not they are also in the manager group.
1. The precedence-discard warn line (D7) fires with `discardedRoles` containing `engineering_manager` on every such sign-in.
2. `docs/deployment.md` adds a rule next to the facilitator rule: *people in the manager group must not also be in the admin group*. It explains the consequence in one sentence: they are recognised only as admins, so they cannot be associated as team managers or use the manager views, and (D11) they cannot take part in sessions.
3. A pinned spec scenario (oidc-role-mapping, "Manager who is also in the admin group") and the risk entry below. #235/#241 inherit both and must re-run this check when they reconcile.

**What remains:** the person is still recorded as `application_admin`, not `engineering_manager`. TEAM-006 still cannot record them as a team manager, and they do not get the manager history views. That is a recognition gap, not a participation gap: they can neither take part in nor watch a live session, and admins are already denied session content. The discard warn line and the docs rule tell operators to fix the IdP groups. Role-set storage (#235) would resolve it properly.

## Risks / Trade-offs

- **[EM + admin resolves to admin]** → Follows from the decided precedence. Live-session participation is **closed by enforcement** (D11). The remaining effect is recognition only: no TEAM-006 manager association and no manager views (see "S1 premise check"). Mitigations: discard warn line, docs rule, pinned scenario.
- **[Admins who are genuine team members can no longer vote]** (D11) → An engineer who is also an app admin cannot take part in their own team's retro. That is the deliberate cost of the user decision. The release note says so, and the docs recommend that the admin group hold only people who administer Dipstick and are not participants. A participant who needs admin rights temporarily signs in again after leaving the admin group.
- **[Silent manager drop from a renamed or over-limit group]** → The startup guard checks presence, not effectiveness (D5). Mitigations: per-target counts at startup, the Entra overage warn (S8), a docs warning, and a recommendation to use app roles for Entra. Follow-up: periodic resolution counts by role.
- **[Broad group mapped to an elevated role]** (`"Everyone": "application_admin"`) → Validation cannot know group size. Mitigation: a docs warning, and the counts line makes an unexpected admin mapping visible. Follow-up (S9): a map fingerprint in the summary line so admin-mapping changes show up over time.
- **[Admin + facilitator resolves to admin, so the person cannot run a session]** → Follows from the decided precedence. Mitigations: a pinned test, the discard signal, and a docs rule ("don't put facilitators in the admin or manager groups"). Admins also bypass the facilitator `isMember` guard, which goes to security review.
- **[EM + facilitator resolves to EM with no user-facing notice]** → Pinned as known behaviour. The notice belongs to #241.
- **[Divergence from #235/#241]** → Whichever lands second reconciles its resolver with the other and re-runs security checks S1 (EM + admin) and S4 (own-key targets) against the merged resolver. Owned by #235/#241. If #235 merges first, this change's `first-access` delta is rebased onto it.
- **[Revocation latency]** (S5) → Authorization reads `users.global_role` live on every request and WebSocket re-check, so once the row changes, revocation is immediate everywhere. The row changes only at interactive sign-in. Token refresh does not re-resolve. The 90-minute absolute session lifetime (`ABSOLUTE_LIFETIME_MS`) forces a new sign-in, so **an IdP-side demotion, including removal of an `application_admin`, can take up to about 90 minutes to apply.** A backend restart after a map change does not shorten this, because sessions live in Redis. There is no operator tool today that invalidates one user's sessions. The runbook says so, and a follow-up is filed for one.
- **[New grants at next sign-in]** → Any deployment whose IdP already sends `facilitator` or `senior_engineer` on the configured claim grants those roles once this ships. Mitigation: a release-blocking checklist (task 7.2) owned by the release owner, with one line per deployment.
- **[Mid-session demotion]** → A map or group change plus a re-sign-in during a live session can strip the facilitator role. Facilitator-gated checks read the live `users.global_role`, so the expected behaviour is that the session continues but the demoted facilitator's facilitator-only actions are refused. That is not yet established for every handler: some live-session actions in `facilitator-sessions.ts` gate on `sessions.facilitator_id` and read `global_role` only for the audit row. Task 2.3 adds an integration test that pins the actual behaviour of each action (security deferred decision 2), and any action that still succeeds goes to the sign-off and the follow-up. Nothing ends or reassigns the session. That gap is a follow-up that must be resolved before a second team goes live. Docs tell operators not to change the map while sessions are live.
- **[Non-production deployment on a real IdP]** → Closed structurally by D6: an unset map with a non-local issuer fails boot in every `NODE_ENV`.
- **[Breaking boot]** → Intentional, for production and now also for non-production deployments on a real IdP. Mitigation: upgrade notes, and a post-deploy check that a facilitator can create a draft session (not just that the app boots).
- **[Duplicate-key scanner cut]** → If cut under the D3 budget, recorded as an accepted risk in `security-review.md` with a follow-up link.
- **[Audit volume]** → The firing condition widens only by role changes to `engineer`. That is rare, and each one is an event worth keeping.

## Migration Plan

1. Before upgrading, operators of **every deployment whose `OIDC_ISSUER` is not a local address**, whatever its `NODE_ENV`, set `OIDC_ROLE_MAP`. Production also needs at least one `engineering_manager` key. Normally they add `facilitator` and `application_admin` keys too. A deployment whose IdP already sends internal strings can use `{"application_admin":"application_admin","engineering_manager":"engineering_manager","facilitator":"facilitator","senior_engineer":"senior_engineer"}`.
2. Deploy. Grep the boot output for `OIDC_ROLE_MAP:`. Check that it shows `source=configured` with the expected counts, and look for the facilitator and admin warnings.
3. Post-deploy check: a designated facilitator signs in again and creates a draft session.
4. Rollback (corrected after implementation review R1). The old code ignores `OIDC_ROLE_MAP`, and no schema changed. It is safe only for a deployment whose IdP already sends the internal role strings as a single string claim (identity map): users granted `facilitator` or `senior_engineer` by the new code drop back to `engineer` at their next sign-in under the old allowlist. **For a deployment with a translating map (IdP group names, array claims), rollback demotes every mapped user to `engineer` at their next sign-in, including every manager and admin.** Managers would then be admitted to live sessions with no error and no audit signal, so the no-manager rule fails open. Such a deployment must not roll back until the IdP sends `engineering_manager`/`application_admin` as a single string on the configured claim and that has been verified on the current release with an identity map. `docs/deployment.md` "Upgrading" step 5 holds the procedure, and `release-check.md` (task 7.2) records per deployment whether rollback is safe.

## Open Questions

None blocking. Precedence, storage and admin participation (D11) are decided. Follow-ups are listed in the proposal's "Follow-ups" section.

## Review disposition

Reviews: `design-review-engineer.md` (Marcus Oyelaran, Senior Full Stack Engineer) and `design-review-security.md` (Tomás Ferreira, Senior Application Security Analyst). Fixed precedence and single-value `global_role` were out of scope for both by user decision. Nothing below changes them.

### Engineer: required

| # | Disposition | Where |
|---|---|---|
| R1 | **Accepted.** The claim that the compiler rejects new role strings was false. `role-map.ts` now defines `GlobalRole`/`MappableRole`, with `RANK` built from a `Record<MappableRole, number>`, and adds a test tying the union to `1_create_enums.sql`. Narrowed at the resolver boundary only. | D1, task 1.1 |
| R2 | **Accepted.** Confirmed in `account-resolver.ts`: `warn("msg", { claimName })` drops the fields under pino. All resolver lines, including the existing unmapped warn, become `warn(fields, msg)`. The logger is typed from `FastifyBaseLogger`, and tests assert the argument order. | D7, task 2.3 |
| R3 | **Accepted.** One mechanism: `request.log.child({ correlationId })`. Tested in both the resolver and route test files. | D7, task 2.3 |
| R4 | **Accepted.** The map is injected through an options object. No default fallback; a missing map throws. `role-map.ts` is a leaf with no `config.js`/`db.js` import. `DEFAULT_ROLE_MAP` exported. | D1, D7, task 2.2 |
| R5 | **Accepted.** `OIDC_ROLE_MAP` stays out of `optional`. The exported type is extended with `roleMap`/`roleMapSource`. The raw string is never on `config`. | D1a, task 1.6 |
| R6 | **Accepted** with the cleaner option: `loadConfig(env = process.env)` is exported and called directly in tests, with the earlier production guards satisfied and the `FATAL: OIDC_ROLE_MAP` text asserted. | D1a, task 1.6 |

### Engineer: recommended

| # | Disposition | Where |
|---|---|---|
| C1 | **Accepted.** `shouldEmitRoleClaimMapped` computed once. `previousRole` added to the structured event as well. | D8, task 3.1, auth-error-handling delta |
| C2 | **Accepted.** `JSON.stringify` for keys and targets in messages. | D4, task 1.2 |
| C3 | **Accepted.** Startup lines are described as plain `console.*` with a fixed `OIDC_ROLE_MAP:` prefix. The spec no longer says "info-level line" in a way that implies pino. | D1a, oidc-role-mapping delta, task 5.1 |
| C4 | **Accepted.** The scanner's three edge cases are listed. The test budget goes from two to three, adding the escape-equivalent case S6 asked for. | D3, task 1.3 |
| C5 | **Accepted.** The logging requirement is scoped to "at sign-in". | oidc-role-mapping delta |
| C6 | **Accepted.** Optional debug line deleted. | D7 |
| C7 | **Accepted.** Lockstep files named. | D9, task 4.3 |
| C8 | **Accepted.** Two tests (mapping and gate), honest scope, fixture imported from the stub. | D9, task 4.2 |

### Security

| # | Disposition | Where |
|---|---|---|
| P3 | **Accepted.** D5 now says the guard proves presence, not effectiveness. | D5 |
| S1 | **Resolved by enforcement (revision 3, binding user decision).** Item 4 is adopted in this change: application admins are denied participant registration, lock-in and live session events (D11, E1–E4). Items 1–3 are kept as well. The discard signal is generalised to `discardedRoles` (`engineering_manager`, `facilitator`). There is a docs rule (manager group ∩ admin group = ∅), a pinned scenario, and a risk entry. Precedence is unchanged. **Premise verified, with a correction:** admins cannot reach session *history* or EM views (admin path is evaluated first and denied with an audit row), but they **can** register, vote and receive live events in a team they belong to. That path is now closed by D11. Revision 2's "signalled, not prevented" disposition is superseded. | D7, D11, "S1 premise check", tasks 2.1, 2.3, 3.4–3.6, 5.2, 6.1 |
| S2 | **Accepted (the structural option).** Identity default only when the map is unset, `NODE_ENV !== "production"` **and** `isPrivateAddress(OIDC_ISSUER)`. Otherwise boot fails. This replaces the earlier docs-only mitigation and the "staging uses the default" scenario. Cost: `config.test.ts`'s real-import cases must set a map. | D4, D6, task 1.4, oidc-role-mapping delta |
| S3 | **Accepted.** Fixed invalid-JSON message, no `err.message`/`cause`, and a fragment test. | D4, task 1.2 |
| S4 | **Accepted.** `PERMITTED_TARGETS` as a `ReadonlySet`, `RANK` as a `Map`, and `toString`/`__proto__` target tests. | D1, D2, task 1.2 |
| S5 | **Accepted.** The first-access item 5 claim about token refresh was wrong (`refreshSessionTokens` does not re-resolve) and is corrected to "each interactive sign-in". The 90-minute bound is stated in the spec and docs. A runbook line covers urgent revocation. No per-user session-invalidation tool exists, so a follow-up is filed. Refresh-time re-resolution is not added. | Context, Risks, first-access and oidc-role-mapping deltas, task 5.1, follow-ups |
| S6 | **Accepted.** The scanner fails closed, compares decoded keys (escape-equivalent test), and a cut must be recorded in `security-review.md`. | D3, task 1.3 |
| S7 | **Accepted.** Debug line dropped, the claim-value test spies on every logger call in the callback, and the docs note that group names can appear in failed-boot logs. | D4, D7, tasks 2.3, 5.1 |
| S8 | **Overage warn accepted in this change.** Periodic resolution counts go to a follow-up. | D1, D7, tasks 2.1, 2.3, oidc-role-mapping delta |
| S9 | **Deferred to a follow-up.** A map fingerprint in the summary line. The reviewer rated it informational. It is cheap, but it adds a hashing contract to the summary line that the counts already partly cover. | Follow-ups |
| Deferred decisions 1–7 | **Accepted** as sign-off agenda items (task 6.1). Item 2 (mid-session demotion) gets an integration test in this change (task 4.5). Item 7 (#235 hand-off re-runs S1/S4) is added to the divergence risk. | Risks, tasks 4.5, 6.1 |

**Rejected:** none. **Narrowed:** S9 is a follow-up, not a change in this release. (S1 item 4 was a follow-up in revision 2 and is implemented in revision 3.) Engineer R6 took the `loadConfig(env)` option, not `vi.resetModules()`.
