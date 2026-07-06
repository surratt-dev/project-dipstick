# Implementation Review — Architect
## Change: join-team-invite-link
**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Date:** 2026-07-05

---

## Summary

The implementation is largely correct and aligns with the design decisions documented in `design.md` and `proposal.md`. All eight verification points specified for this review pass. Two findings require attention: one is a gap between a task's stated outcome and what was actually implemented; the other is a behavioral asymmetry between the two join paths that is design-intentional but warrants explicit documentation.

---

## Verification Results

### 1. `executeJoinFlow` return type — PASS

`packages/backend/src/routes/auth.ts`, line 446:
```
async function executeJoinFlow(...): Promise<{ redirectUrl: string }>
```

All return paths return a non-null string. The `{ redirectUrl: null }` sentinel is eliminated. The callback handler at line 206 uses `let redirectUrl: string | null = null` as a local variable — this is correct, not a type leak. The null state represents "no join token was present, use the default membership routing," which is a distinct condition from `executeJoinFlow` failing.

### 2. `JoinErrorPage` accessible without authentication — PASS

`packages/frontend/src/App.tsx`, line 39:
```
<Route path="/join-error" element={<JoinErrorPage />} />
```

The route is not wrapped in `ProtectedRoute`. An explanatory comment is present and accurate. Structurally analogous to `/auth/error`. Correct.

### 3. Error redirects converge on `/join-error?joinError=...` — PASS

Direct path (`join-links.ts`): `not_found` → `/join-error?joinError=invalid` (line 124); revoked → `/join-error?joinError=expired` (line 140); expired → `/join-error?joinError=expired` (line 149). The `/auth/error?category=...` redirects are gone from this path.

Through-auth path (`auth.ts` / `executeJoinFlow`): `not_found` → `/join-error?joinError=invalid` (line 459); revoked or expired → `/join-error?joinError=expired` (line 475).

Both paths converge on `JoinErrorPage`. Correct.

### 4. `trustProxy: 1` in `app.ts` — PASS

`packages/backend/src/app.ts`, line 25:
```
trustProxy: 1,
```

The explanatory comment is precise about what this does (X-Forwarded-For resolution), why it is correct for a single-layer proxy topology, and what happens without it. Correct and appropriately documented.

### 5. `?newMember=true` handler uses replace navigation — PASS

`packages/frontend/src/pages/TeamPage.tsx`, line 34:
```
setSearchParams(searchParams, { replace: true });
```

Consistent with the `?alreadyMember=true` handler at line 18. Correct.

### 6. `RETURNING id` on INSERT, `insertResult` drives branch logic — PASS

`packages/backend/src/routes/auth.ts`, lines 489–518:
```sql
INSERT INTO team_memberships (user_id, team_id, role)
VALUES ($1, $2, 'participant')
ON CONFLICT (user_id, team_id) DO NOTHING
RETURNING id
```

`insertResult.rows.length > 0` gates the audit event (line 499) and determines `outcomeSuffix` (`?newMember=true` vs `?alreadyMember=true`) at line 517. The detection mechanism is reliable under concurrent inserts: `RETURNING` only emits rows for rows actually written.

The direct path in `join-links.ts` at line 164 also has `RETURNING id`, with `isAlreadyMember = insertResult.rows.length === 0` at line 172 gating the audit event correctly.

### 7. `join.link_redeemed` gated on `insertResult.rows.length > 0` — PASS

`auth.ts`, lines 499–505: event fires only inside `if (insertResult.rows.length > 0)`.
`join-links.ts`, lines 174–179: event fires inside `if (!isAlreadyMember)`, which is equivalent.

Both paths suppress the audit event for the existing-member case. Correct.

### 8. `redis.getdel` used (not `get` + `del`) — PASS

`packages/backend/src/routes/auth.ts`, line 87:
```
const stateDataRaw = await redis.getdel(stateKey);
```

The mock in `auth.test.ts` (line 5, 23) confirms `getdel` is tested and that `get` and `del` are not present as separate calls in the mock registry. The atomic operation closes the race window described in the design. Correct.

---

## Findings

### Finding 1 — GAP: Direct path `join.link_redeemed` audit event lacks `sourceIp`

**Severity:** Low. Does not affect correctness of the join flow; affects audit completeness only.

**File:** `packages/backend/src/routes/join-links.ts`, lines 174–179.

The `join.link_redeemed` event emitted by the direct path (`GET /api/join/:token`) does not include a `sourceIp` field:

```typescript
emitAuditEvent(request.log, "join.link_redeemed", {
  userId: session.userId,
  teamId: link.team_id,
  linkId: link.id,
  // sourceIp absent
});
```

The through-auth path's `join.link_redeemed` in `auth.ts` at line 500 includes `sourceIp`. The two paths produce structurally inconsistent audit events for the same semantic action.

Task 3.1 states: "after this change, both `join.link_rejected` and `join.link_redeemed` carry the real requester IP." This is true for the through-auth path. It is not true for the direct path's `join.link_redeemed`. The `sourceIp` is available at the call site as `request.ip` — it was not threaded through.

The test at `join-links.test.ts` line 252 asserts that `join.link_redeemed` is emitted with `userId` and `teamId` but does not assert the presence of `sourceIp`, so the gap is not caught by the test suite.

**Required action:** Add `sourceIp: request.ip` to the `join.link_redeemed` call at `join-links.ts` line 175 and add a corresponding assertion in the `join-links.test.ts` test for the join-and-redirect case.

---

### Finding 2 — OBSERVATION: Direct path does not append `?newMember=true` for first-time members

**Severity:** Informational. Design-intentional; documented here for the record.

The through-auth path appends `?newMember=true` to the redirect URL when `executeJoinFlow` inserts a new membership row. The direct path (`GET /api/join/:token`) does not — for a new member, it redirects to `/team/:teamId` with no suffix.

This creates a behavioral asymmetry: an already-authenticated user joining a second team via the direct path will not see the "You've joined the team" welcome banner. An unauthenticated first-time joiner, who always takes the through-auth path, will see it.

The proposal explicitly scopes `?newMember=true` to the through-auth path ("Add `?newMember=true` to the through-auth success redirect"). The asymmetry is intentional and the practical impact is limited: truly first-time joiners are always unauthenticated and always take the through-auth path. The gap only affects authenticated users joining an additional team.

The `join-links.test.ts` test at line 229–256 asserts the new-member direct path redirects to `/team/team-1` (no suffix), confirming this is tested behavior. The asymmetry is correctly captured.

**No action required.** If the team later decides to extend the welcome banner to the direct path, the pattern is established in `executeJoinFlow` and can be applied to `join-links.ts` without ambiguity.

---

### Finding 3 — OBSERVATION: `?newMember=true` appended to session redirect URL without a cleanup contract for the session page

**Severity:** Informational.

When a new member joins via the through-auth path and an active session exists, `executeJoinFlow` returns `/session/<id>?newMember=true`. The design says the session page explicitly ignores `?newMember=true`. The current session page is a placeholder that does not read search params, so the parameter is ignored in practice. The parameter remains visible in the browser URL bar.

When the session page is implemented, it must explicitly not render a welcome banner for `?newMember=true` — the design rationale is that the banner content ("Your facilitator will share what comes next") is misleading when the session is already in progress. This requirement is captured in the design doc but is not yet enforced by a test.

**Recommended action:** When the session page is built, add a test asserting that `?newMember=true` does not render a notification banner on that page. This is a constraint for the session page implementation, not for this change.

---

## Architecture Assessment

The change is well-bounded. `executeJoinFlow` owns its redirect URL construction for both success and failure outcomes, which keeps the callback handler's control flow simple and correct. The null sentinel removal is clean and the updated return type is enforced by TypeScript.

The `trustProxy: 1` addition is overdue and its documentation is accurate. Its effect is broad — it corrects `sourceIp` in every audit event across the entire application, not just the join flow — which is the right outcome. The placement in `app.ts` at the Fastify constructor is correct; this cannot be configured per-route.

The atomic `redis.getdel` is the minimal correct fix for the state-key race condition. No other Redis operation changes were needed.

The `INSERT ... ON CONFLICT DO NOTHING RETURNING id` pattern for membership detection is idiomatic and correct. It avoids a separate SELECT round-trip and handles concurrent inserts correctly.

The `JoinErrorPage` placement outside `ProtectedRoute` is correct. The comment in `App.tsx` explains the reasoning clearly: a user who authenticated and then got a join error may not have an active session, and requiring auth would produce a redirect loop.

The role vocabulary comments at both insert sites are an appropriate use of inline documentation. They are explicit about the constraint (do not change `'participant'` to `'engineer'`), give the reason (enum value does not exist), and distinguish `membership_role` from `global_role`. The test at task 11.9 provides automated backstop.

**The one item that must be resolved before this change is considered complete is Finding 1.** The direct path's `join.link_redeemed` audit event must include `sourceIp`. This is a two-line code change and a one-assertion test addition. All other findings are informational.
