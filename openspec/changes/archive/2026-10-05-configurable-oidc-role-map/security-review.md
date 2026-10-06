# Security review: Configurable OIDC role map (#243)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Skeleton created by:** Marcus Oyelaran (task 0.2). Statuses are left empty for the reviewer.
Each point is marked `accepted` or `accepted with follow-up <link>`. Merge is blocked until every point has a status and the file ends with a dated sign-off line.

## Review points

### 1. Permitted targets
Targets checked with `PERMITTED_TARGETS.has` (a `ReadonlySet`); `engineer`, `toString`, `__proto__` rejected (S4). `packages/backend/src/auth/role-map.ts`.

**Status:**

### 2. Production and issuer guards
Production requires a map with an `engineering_manager` key; any `NODE_ENV` with a non-local `OIDC_ISSUER` requires a map; identity default only for unset map + non-production + local issuer (D5, D6, S2). Guard proves presence, not effectiveness (P3).

**Status:**

### 3. Own-key lookup
Claim values resolved via `Map.get` over operator-written keys only (D2).

**Status:**

### 4. Precedence
Fixed `application_admin > engineering_manager > facilitator > senior_engineer > engineer` (binding user decision).

**Status:**

### 5. Discard log line
One warn `{ claimName, resolvedRole, discardedRoles }` per sign-in, value-free, carrying `correlationId` via the child logger (D7, S1).

**Status:**

### 6. Existing admin bypass of the facilitator `isMember` guard
`standing-facilitator-access-helper.ts`; unchanged by this change but more reachable once IdP groups map to admin.

**Status:**

## S1 / D11 confirmation

S1 (EM + admin resolving to `application_admin`) is closed by the admin live-session exclusion (D11, E1–E4; tasks 2.1, 2.2, 3.5).

**Status:**

## Deferred decisions (from `design-review-security.md`)

### D-1. Discard is logged, not audited (durable record deferred to #241)
**Status:**

### D-2. Mid-session facilitator demotion (task 2.3 findings below)
**Status:**

### D-4. ~90-minute revocation bound (pinned by task 4.3, `middleware.test.ts`)
**Status:**

### D-5. Duplicate-key scanner cut (only if it happened)
**Status:**

### D-7. #235 reconciliation re-runs S1 and S4 against the merged resolver
**Status:**

## Implementation findings

_Appended by tasks 1.3 and 2.3._

### Task 1.3: duplicate-key scanner (2026-10-05)
Implemented within the D3 budget as one function, `assertUniqueTopLevelKeys` in `packages/backend/src/auth/role-map.ts`. It skips escapes, uses key position at depth 1 (after `{` or `,`), decodes each key with `JSON.parse` before comparing, and fails closed with `OIDC_ROLE_MAP: could not verify that keys are unique` on an unterminated string, an undecodable key token or unbalanced depth. Tests in `auth/__tests__/role-map.test.ts`: (a) literal duplicate, (b) escape-equivalent duplicate (the raw input is checked to contain a backslash), (c) no false positive on an escaped quote inside a key, plus the pipeline-order test (duplicate is reported before the `engineer` target). **The scanner was not cut**, so deferred item D-5 does not apply.

Test-authoring note: when the test source was written with a literal `\u0045` sequence inside `String.raw`, the escape was decoded to `E` before it reached the file, and the test failed on its own backslash assertion. This is the hazard BA S1 flagged. The test now builds the escape by concatenation (`"\\" + "u0045"`), and the backslash assertion guards against it happening again.

### Task 2.3: mid-session facilitator demotion (2026-10-05)
Test: `packages/backend/src/routes/__tests__/facilitator-demotion-mid-session-integration.test.ts`, run locally against docker compose Postgres/Redis (8/8 pass). Each case drives a fresh session to the needed state as a facilitator, sets that user's `global_role` to `engineer`, then calls the action as the same user. Observed results:

| Action | After demotion |
|---|---|
| `POST /teams/:teamId/sessions/:sessionId/advance` (draft → lobby) | **Refused**, 403 (live role re-check, #175 D3a) |
| `POST /sessions/:sessionId/start` (lobby → pre_session) | **Succeeds**, 200 |
| `POST /sessions/:sessionId/begin-voting` | **Succeeds**, 200 |
| `POST /teams/:teamId/sessions/:sessionId/reveal` | **Succeeds**, 200 |
| `POST /teams/:teamId/sessions/:sessionId/topics/advance` | **Succeeds**, 200 |
| `POST /teams/:teamId/sessions/:sessionId/complete` | **Succeeds**, 200 |
| `GET /teams/:teamId/sessions/:sessionId/facilitator-state` | **Succeeds**, 200 |
| `GET /sessions/:sessionId/participants-roster` | **Succeeds**, 200 (facilitator grant is keyed on `facilitator_id`) |

So the design's expected interim behaviour ("facilitator-only actions are refused") holds only for opening the room. Once a session is open, a demoted facilitator can still run it to completion. These handlers gate on `sessions.facilitator_id` and read `global_role` only for the audit row. As task 2.3 requires, nothing was changed here. The finding goes to follow-up FU-1 (with FU-10 folded in) in `follow-ups.md`, for the deferred decision D-2.

### Implementation review follow-through (2026-10-05)
Response to `implementation-review-security.md` and `implementation-review-architect.md`:
- **N2 / C4 (runbook):** fixed in `docs/deployment.md`. The lookup is now by `oidc_subject` + `oidc_issuer` with a one-row check, and the Redis sign-out step is a followable scan that matches the `userId` inside each `dipstick:session:<id>` value. **Accepted operational gap until follow-up 7:** the manual `UPDATE users` writes no `audit_log` row. The runbook says to record it in the change log.
- **N1:** runbook step 4 added (a demoted facilitator can still run a session they already opened; end it as part of revocation). The `engineering_manager` re-map variant is added to FU-1.
- **N4:** fixed. Keys containing control characters or zero-width characters (U+200B–U+200D, U+2060, U+FEFF) now fail boot with a key-naming error. Error text escapes format characters as `\uXXXX`. Spec and design updated.
- **N3:** documented ("set `OIDC_ROLE_MAP` for any real IdP, even on a private network"). Tightening is FU-13: it needs a spec change shared with persona-login.
- **N5:** the warning already fires only when no value maps, as the spec requires. A level or volume change is FU-12.
- **Architect R1:** rollback docs corrected (deployment.md step 5, design Migration Plan step 4, PR upgrade notes). Task 7.2 now records rollback safety per deployment.
- **Architect C1:** `parseRoleMap` returns a copy of `DEFAULT_ROLE_MAP`, with a test that mutating the result does not affect the shared default.

## Sign-off

