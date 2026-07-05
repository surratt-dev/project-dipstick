# Design Review: First Access
**Reviewer:** Marcus Oyelaran, Full Stack Engineer
**Date:** 2026-07-05
**Status:** Reviewed — two gaps confirmed implementable, implementation notes added for each

---

## Summary

The design is sound. The existing implementation covers the structural requirements correctly — the upsert key is right, the session ordering is right, the layout isolation is already in place. The two confirmed gaps (missing-claims validation and server-side redirect) are both implementable within the existing handler structure without significant refactoring. Neither requires a new abstraction.

I have specific implementation guidance for each gap below, plus two issues the design documents but that deserve sharper treatment in the tasks.

---

## 1. Upsert Pattern Safety Under Concurrent Load

**Assessment: safe. One edge case the design understates.**

The `INSERT ... ON CONFLICT (oidc_subject, oidc_issuer) DO UPDATE` pattern is correct. PostgreSQL's conflict detection on a unique constraint is atomic — the lock is held at the index level during the insert attempt, so two concurrent callbacks for the same `sub`/`iss` will serialize at the database, not race past each other. One inserts, one updates. Both return the correct record. The data is always consistent.

The `isNewUser` race is documented accurately. The SELECT and the upsert are not in a transaction, so two concurrent first-access callbacks can both execute the SELECT before either executes the upsert, and both will set `isNewUser = true`. The design correctly identifies this as a constraint on future consumers, not a current defect. The code comment requirement in the tasks is the right call — this needs to be visible at the call site, not just in the proposal.

One edge case the design does not address: **no length validation on display_name or email before the insert.** If a claims value (particularly `sub`, which becomes the display_name fallback) exceeds the column type limit in PostgreSQL, the insert throws a database error that lands in the catch block and produces an error page. This is operationally correct — no partial state, no session — but it's a failure mode with no specific logging. If the column is `TEXT` (unbounded), this is moot. If it's `VARCHAR(n)`, it needs either a length guard before the call or a specific error mapping in `mapAuthError`. Worth confirming the schema type before closing the change.

---

## 2. Server-Side No-Team Redirect Feasibility

**Assessment: straightforward. Exact insertion point identified.**

The callback handler already has everything it needs. After `resolveOrCreateAccount` completes and the join flow runs (lines 176–186 in `auth.ts`), `user.id` is available and the session is populated but not yet saved. Querying team memberships at that point is a single additional database query before `session.save()`.

The implementation change is minimal:

```ts
// After the join flow block:
let redirectUrl = "/";
if (stateData.pendingJoinToken) {
  const joinResult = await executeJoinFlow(user.id, stateData.pendingJoinToken, request.log);
  if (joinResult.redirectUrl) {
    redirectUrl = joinResult.redirectUrl;
  }
}

// New: if the join flow didn't set a destination, decide based on memberships
if (redirectUrl === "/") {
  const memberships = await db.query(
    `SELECT team_id FROM team_memberships WHERE user_id = $1 AND removed_at IS NULL LIMIT 1`,
    [user.id],
  );
  if (memberships.rows.length === 0) {
    redirectUrl = "/no-team";
  } else {
    redirectUrl = `/team/${(memberships.rows[0] as { team_id: string }).team_id}`;
  }
}

await request.session.save();
return reply.redirect(redirectUrl);
```

Two ordering notes:

**Join flow interaction is clean.** When `executeJoinFlow` succeeds, it already returns `/team/:teamId` or `/session/:id`. The membership query is skipped by the `if (redirectUrl === "/")` guard. When `executeJoinFlow` fails (invalid or expired link), `redirectUrl` stays at `/`, the membership query runs, and a new user with no other memberships correctly lands at `/no-team`. This is the right behavior — the failed join is its own audit event; the user still gets an appropriate destination.

**Query throws → catch block.** If the membership query fails (DB connection drop, timeout), execution falls to the catch block, which redirects to the error page without establishing a session. This is correct per the "no session without resolved state" constraint. The `mapAuthError` path handles it generically. No additional error mapping is needed for this case specifically.

**`AuthenticatedLanding` at `/` stays.** Direct navigation to `/` after a fresh authentication will be rare once the server-side redirect is in place, but the component is a legitimate fallback for users who navigate there manually. It already does the right thing from session state. Do not remove it.

---

## 3. Missing-Claims Validation

**Assessment: easy to add. Two implementation details matter.**

The validation site is lines 117–121 in `auth.ts`. Currently:

```ts
const claims = tokens.claims();
if (!claims) {
  throw new Error("No ID token claims returned");
}
```

The check for missing/empty `sub` and `iss` goes immediately after this block, before the call to `resolveOrCreateAccount`. The check itself is three lines:

```ts
const missingClaim = !claims.sub ? "sub" : !claims.iss ? "iss" : null;
if (missingClaim) {
  // log here, then throw
}
```

**The audit log path is the non-obvious part.** The spec requires logging which claim was absent without logging any other claim values. The existing catch block emits `auth.failure` with `sourceIp`, `failureCategory`, and `correlationId` — no claim values. If the validation throws a plain `Error`, that's what the catch block emits. But we lose the claim name in the log.

The clean approach: define a typed error class for this case.

```ts
class MissingClaimError extends Error {
  constructor(public readonly claim: string) {
    super(`Missing or empty required claim: ${claim}`);
    this.name = "MissingClaimError";
  }
}
```

Throw it from the validation block. In the catch block, add a type guard:

```ts
if (err instanceof MissingClaimError) {
  request.log.warn({
    event: "auth.missing_claim",
    missingClaim: err.claim,
    correlationId,
    sourceIp: request.ip,
  });
}
```

Then let the existing `auth.failure` audit event emit as usual. The claim name is in the structured log without any claim values from the token appearing anywhere.

`mapAuthError` should map `MissingClaimError` to an `invalid_token` category with a generic user-facing message. The correlation ID in the redirect ties the generic message to the specific log entry for operator lookup.

One TypeScript note: `claims.sub` from `openid-client` is typed as `string`. TypeScript won't catch an empty string. The runtime check `!claims.sub` (falsy) correctly rejects both `undefined` and `""`. The check must be runtime, not type-narrowing.

---

## 4. Bookmark Guard on `/no-team`

**Assessment: implementable without structural changes. Loading state is the edge to handle.**

The current `/no-team` route wraps `NoTeamPage` in `ProtectedRoute` only. `NoTeamPage` already imports `useAuth()` and has access to `session`. The guard can be added to `NoTeamPage` directly:

```tsx
export function NoTeamPage() {
  const { session, loading } = useAuth();

  if (loading) return <AuthLoadingPage />;
  if (!session) return null; // ProtectedRoute redirects before this fires, but guard for type safety

  if (session.teamMemberships.length > 0) {
    return <Navigate to={`/team/${session.teamMemberships[0]!.teamId}`} replace />;
  }

  // ... existing render
}
```

The loading state is the edge that the current `NoTeamPage` does not handle. `session` is null while `AuthContext` is fetching. If the guard checks `session.teamMemberships.length` before `session` is populated, it throws. `AuthenticatedLanding` handles this correctly with an explicit `if (loading)` branch — `NoTeamPage` needs the same pattern.

The alternative is a route-level guard component (a `NoTeamRoute` that wraps `ProtectedRoute` and adds the membership check). That's marginally cleaner structurally, but adds a component for a two-line concern. Adding it directly to `NoTeamPage` is the right call here — the component is already using `useAuth()` and the guard is semantically part of what this page means ("if you have a team, you shouldn't be here").

---

## 5. Layout Isolation Requirements

**Assessment: already satisfied. The regression test is the only open item.**

The current routing structure provides the isolation the spec requires. `/no-team` is:

```tsx
<Route
  path="/no-team"
  element={
    <ProtectedRoute>
      <NoTeamPage />
    </ProtectedRoute>
  }
/>
```

No layout wrapper. `ProtectedRoute` handles authentication gating only — it does not contribute navigation elements. `NoTeamPage` uses inline styles, not a shared layout component. The DOM rendered at `/no-team` contains no nav, sidebar, or header.

The risk the design correctly identifies: this is structural isolation, not enforced isolation. As the application grows and other routes get wrapped in a shared layout, an inattentive developer could accidentally add `/no-team` to that wrapper. There is nothing in the current code that makes this fail loudly.

The regression test (Task 8) is required and must run in CI. The test should render `<App>` with a mocked authenticated session (no team memberships) at `/no-team` and assert that no element with `role="navigation"`, `aria-label` containing "nav", or known layout component test IDs is present in the output. This catches the regression before it reaches production. Without this test, the isolation guarantee is advisory.

The inline styles in `NoTeamPage` are a cleanup item but not a correctness concern for this change. Note it for the follow-on normalization pass.

---

## 6. Hidden Coupling Risks

**Assessment: no hidden coupling. Two sequencing observations worth stating explicitly.**

**Session save timing is correct.** The session is populated before `session.save()` at line 188. If any operation between `session.regenerate()` (line 144) and `session.save()` throws, execution goes to the catch block. The catch block redirects to the error page. No session is saved. This is the right behavior and it's already working correctly. Adding the membership query between these lines does not change this guarantee — a failed membership query throws, catch block fires, no session, error page. Correct.

**Join flow does not affect the membership query's correctness.** `executeJoinFlow` uses `ON CONFLICT DO NOTHING` for the team membership insert. The insert is committed immediately (not in a transaction with the session save). If we add the membership query after `executeJoinFlow`, the newly inserted membership is visible to the query. This means: a user who joins a team via invite link in the same callback will see that membership in the query and be redirected to `/team/:teamId`. This is the correct behavior. The join flow's `redirectUrl` handles this case explicitly anyway, so the membership query is not the primary mechanism for this path — it's the fallback.

**The `/auth/session` endpoint and the callback do not share team membership data.** The session object does not cache team memberships — the `/auth/session` endpoint queries them fresh from the database each time. There is no stale-session risk where the callback sets a cached membership flag that diverges from live database state. This is already correct and the proposed membership query in the callback follows the same pattern.

**One sequencing note on the audit log for missing claims.** The `first_access_created` event is emitted before the session is saved (line 131–135). If the validation gap is closed and an empty-string `sub` or `iss` throws before `resolveOrCreateAccount` is called, no `first_access_created` event fires and no account is created. The audit log path is: validation throws → catch block emits `auth.failure` (plus the new `auth.missing_claim` log if typed correctly) → redirect to error page. Clean sequence, no partial state.

---

## Implementation Checklist

Items that require specific attention when implementing the two gaps:

**Gap 1: Missing-claims validation**
- [ ] Define `MissingClaimError` with a `claim` field (typed error, not a string-based check)
- [ ] Add validation immediately after the `claims` null check, before `resolveOrCreateAccount`
- [ ] Emit a structured log entry with `missingClaim` field only (no other claim values) in the catch block, as a separate log from the `auth.failure` audit event
- [ ] Update `mapAuthError` to map `MissingClaimError` to `invalid_token` category
- [ ] Add unit tests: empty string `sub`, empty string `iss`, missing `sub`, missing `iss` — each must verify no account created, no session, correct log output

**Gap 2: Server-side redirect**
- [ ] Add membership query after the join flow block, guarded by `redirectUrl === "/"`
- [ ] Use the same query pattern as `/auth/session`: `team_memberships WHERE user_id = $1 AND removed_at IS NULL`
- [ ] `LIMIT 1` is sufficient — we only need existence, not the full list, and we're targeting the first team for the redirect
- [ ] Add unit tests: new user (no teams) → redirects to `/no-team`; user with teams → redirects to `/team/:teamId`; join flow success → redirect from join flow, membership query skipped; join flow failure (expired link) + no other teams → redirects to `/no-team`
- [ ] Update `AuthenticatedLanding` component comment to note it is now a fallback, not the primary routing path

**Gap 3 (not a gap, but required per design): `isNewUser` code comment**
- [ ] Add comment to `resolveOrCreateAccount` at the SELECT-before-upsert block documenting the race and the constraint that any downstream consumer must either handle duplicate firings or require the upsert-derived pattern first

**Inline styles in `NoTeamPage`** — defer; not a correctness concern for this change.

---

## Overall Assessment

Implementable as designed. Neither gap requires structural changes to the callback handler, the frontend router, or the component tree. The implementation work is additive, localized, and testable at the unit level. The sequencing risks are real but already handled correctly by the existing session-ordering constraints. The biggest implementation risk is the loading state in the bookmark guard — that's a one-line miss that would produce a runtime error on direct navigation to `/no-team` during session fetch. Handle it explicitly.
