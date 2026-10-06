# Design Review: Facilitator session entry point (#237), Engineering

**Reviewer:** Marcus Oyelaran, Senior Full Stack Engineer
**Reviewed:** `design.md` (revision 2), `proposal.md`, `specs/session-creation/spec.md`, `tasks.md`
**Checked against:** `packages/frontend/src/pages/TeamPage.tsx`, `SessionCreationPage.tsx`, `NoTeamPage.tsx`, `App.tsx`, `auth/AuthContext.tsx`, `components/SignOutButton.tsx`, their tests, `packages/backend/src/routes/auth.ts`, `routes/facilitator-sessions.ts` (`GET /eligible-for-session`), `routes/__tests__/auth.test.ts`, `auth/__tests__/`, and `migrations/2_create_tables.sql`

## Verdict: approve with changes

This is implementable as written. It touches two components, adds no new state shape and no new endpoint, and does not move the server-authoritative check. The boundary decision is right. D3 (no team context on the link) and "the picker decides only from `/eligible-for-session`" keep the one rule that matters on the server. They also let #247 change the listing without touching the UI. I'd defend both against "helpful" pre-selection in later PRs.

One finding is a hard defect: the D6 SQL fails as written (E1). One risk statement is factually wrong about how long the stale flag lasts (E2). The rest are test-harness traps that will cost the implementer an hour each if the tasks don't name them.

---

## Blocking

### E1. The D6 cleanup SQL violates a CHECK constraint and will fail
`migrations/2_create_tables.sql` defines:

```sql
CONSTRAINT sessions_abandoned_has_timestamp CHECK (
    status != 'abandoned' OR abandoned_at IS NOT NULL
)
```

D6's `UPDATE sessions SET status = 'abandoned' ...` does not set `abandoned_at`, so Postgres rejects it. Step 3 of the walkthrough breaks, and everything after it breaks too. Fix in design D6 and task 4.1 step 3:

```
docker compose exec postgres psql -U dipstick -d dipstick \
  -c "UPDATE sessions SET status = 'abandoned', abandoned_at = now() WHERE team_id = (SELECT id FROM teams WHERE name = 'Home') AND status NOT IN ('complete','abandoned');"
```

The rest of D6's reasoning holds. `abandoned` is outside the active-session unique index predicate (`migrations/10_sessions_team_active_unique.sql`: `status IN ('draft','lobby','pre_session','active','wrap_up')`), and the compose credentials are `dipstick`/`dipstick`.

### E2. The stale `canFacilitateSessions` lasts for the SPA's lifetime, not "until the next session refresh"
`AuthProvider` calls `/auth/session` once, on mount. The only other caller of `refreshSession()` is `MemberManagement` after a role change. Client-side navigation never re-fetches it. So after an IdP revocation, the revoked user can go round a loop until they hard-reload:

TeamPage (link still shown) → picker (403, "Failed to load teams…") → "Go to your team" → TeamPage (link still shown) → …

This is **not** a security problem, because the server re-reads `global_role` on every call. The loop is still worth getting right, because this design is what introduces it: the return link closes the loop. Choose one of these and say which in the design:

- **(a) Minimum.** Correct the Risks bullet to say "until a full page load". Accept the loop. Sign-out is on the page, so nobody is stranded. Spec R8 holds as written.
- **(b) Better, about 3 lines.** On a non-expiry 403 from `/eligible-for-session` (body `error.category === "forbidden"`, which `detectSessionExpiry` already returns as `body`), call `refreshSession()` as well as setting `listError`. The existing gate (`session && !session.canFacilitateSessions → <Navigate to="/">`) then sends the user to their real landing. This conflicts with R8's literal THEN for the revoked case, so R8 needs a clause: "or, if the role was revoked, the user is redirected to their landing page". It does not break the R8 tests, because `refreshSession` is a mock that does nothing.

I lean towards (a) for this bug fix and (b) as a follow-up. I won't block on the choice, only on the text being accurate.

---

## Should fix before implementation (test-harness and code-level traps)

### E3. The picker can render with `session === null`
The gate in `SessionCreationPage` is `if (session && !session.canFacilitateSessions)`. If `/auth/session` fails at the network level, `AuthContext` leaves `session` null and sets `loading` false, and the picker renders. The footer must read `session?.teamMemberships[0]` and must not dereference `session` directly. With a null session it should render sign-out only. Add this to D5 so nobody writes `session!.teamMemberships`. Use `const homeTeam = session?.teamMemberships[0];` rather than the `[0]!` non-null assertion that `App.tsx` and `NoTeamPage` use.

### E4. State that the re-auth early return has no footer
`if (reauthRequired) return <ReauthRequiredTreatment .../>` runs before the picker renders, so the new footer is absent in the session-expiry case. That is correct, because the treatment owns that path. D5 says the footer appears "in every list state", so add one line: "except the session-expiry treatment, which replaces the page". Otherwise someone writes a 2.1(h) variant for 401 `session_expired` and "fixes" it by lifting the footer above the early return.

### E5. The `SessionCreationPage.test.tsx` auth mock will leak between tests
`useAuth` is mocked once at module scope with `teamMemberships: []`. The file's `beforeEach` calls `vi.clearAllMocks()`, which clears calls but **does not** reset `mockReturnValue`. If 2.1(e)/(h) override the session with memberships, every later test in the file inherits it. Task 2.1 should require a `setSession(overrides)` helper, with `beforeEach` restoring the zero-membership default.

Other harness notes for 2.1:
- **Loading state (2.1(h)).** `mockFetchSequence` cannot express a pending request. Use `global.fetch = vi.fn(() => new Promise(() => {}))`.
- **Network error.** Use `mockRejectedValueOnce(new TypeError("Failed to fetch"))`. That reaches the existing catch and its "Network error loading eligible teams." message, so `picker-error` renders.
- **403.** `{ ok: false, status: 403, jsonBody: { error: { category: "forbidden", message: "..." } } }` matches what the backend actually sends.
- **Sign-out.** `SignOutButton` is not mocked in this file and has no test id. Do not add one to the shared component. Put `data-testid="picker-way-out"` on the footer container and query `within(footer).getByRole("button", { name: /sign out/i })`. That also makes 2.1(g)'s "not on confirm or new-team" assertion a clean `queryByTestId("picker-way-out")` check.
- **`useNavigate` is module-mocked, but `<Link>` uses router internals.** Clicking `picker-go-to-team` will not call `mockNavigate`. Assert `href`, as 2.1(e) already does. Don't assert on `mockNavigate`.

### E6. TeamPage test fixtures are stale, and 1.1(g) needs a routed render
- `mockSession` in `TeamPage.test.tsx` has no `canFacilitateSessions` and uses non-existent membership roles (`"facilitator"`, `"member"`). The new tests need a correctly typed fixture: `canFacilitateSessions: true/false` and roles `participant` / `engineering_manager`. Don't edit the existing tests' fixture. Task 1.2 says existing tests are unchanged, and they pass with the flag `undefined` because D2's check is `=== true`. Add a sibling fixture.
- **1.1(g)** compares against `nav-topic-management`, which renders only when `useParams().teamId` is set. It therefore needs the `<Routes><Route path="/team/:teamId" .../></Routes>` form, which mounts `MemberManagement` and its `fetch`. The existing Topics test (`renders a discoverable Topics nav link`) already does this, so follow that precedent.
- **1.1(a) "clicking navigates to /sessions/new"** needs a sentinel `<Route path="/sessions/new" element={<div data-testid="at-picker"/>}/>`.
- **1.1(g) has nothing to select the block by.** Add `data-testid="team-facilitator-block"` to D1 (a `<section>` with an `h2` "Facilitator") so the test asserts `compareDocumentPosition` against the "Members" heading and `block.contains(topicsLink) === false`.
- **1.1(c) "contains none of the teamName values".** Do the comparison case-insensitively, and keep fixture names that cannot collide with label words (`Alpha`/`Beta`, not `Team …`). A fixture named "Team" would fail falsely against "another team's", and a case-sensitive check would pass falsely for a real team called "another".

### E7. Pin down the block's placement
"At the top of the page, above Members" is ambiguous with the `h1 "Team"` and the two notification banners. Specify: after `<h1>Team</h1>` (and so after the banners), immediately before `<h2>Members</h2>`. The join notification ("You've joined the team…") should stay first, because it is the acknowledgement of the action the user just took.

### E8. D7: the precedence test already exists, so cite it and drop the conditional
- `auth/__tests__/account-resolver.test.ts` has the table row `"[engineering_manager, facilitator] returning"` → `engineering_manager`.
- `auth/__tests__/role-claim-persistence-integration.test.ts` has "a user sent both the manager and facilitator groups is stored as engineering_manager (#238)", against real Postgres.

Replace "search first; add one if none" in D7 and task 3.2 with those two citations. Only the `/auth/session` `engineering_manager → canFacilitateSessions: false` case (next to 4.4) is new.

**Task 3.1 has a trap.** `setupValidCallbackMocks` takes no `globalRole`, and its `mockResolveOrCreateAccount` result has none. Written naively, the new test is byte-for-byte the existing "should complete sign-in flow and redirect to team page for user with memberships" test, and it guards nothing. Task 3.1 must extend the helper with `globalRole?: GlobalRole` and pass `"facilitator"` into the resolved account. Even then, the landing code (`routes/auth.ts`) doesn't read `user.globalRole`, so the test guards only against a *future* branch on it. That is the stated intent, so it is fine, but say it in the test comment.

---

## Non-blocking observations

- **N1. Two sources of truth for "has memberships".** The exclusion copy keys on `listData.callerHasTeamMemberships`, which is read live from the server. The return link keys on `session.teamMemberships`, which is from the context and captured at mount. They can disagree, for example after a join in another tab or a removal. Both outcomes are harmless. Record it so nobody "harmonises" them by deriving the copy from the context, which would move a server fact onto the client. The return link needs a `teamId` that `listData` doesn't carry, so the split is forced.
- **N2. `teamMemberships[0]` now appears in three places** (`AuthenticatedLanding`, `NoTeamPage`, the picker footer). Extracting a helper would touch `App.tsx`/`NoTeamPage`, which the scope guard rules out. Inline it with a comment pointing at `AuthenticatedLanding`. That is enough.
- **N3. Copy for multi-membership facilitators.** "Your own team isn't listed" is singular. For someone on two teams, "Teams you're on aren't listed. Facilitators run sessions for teams they're not on." is accurate and still names only the membership rule. This is Priya's call, and it is non-normative.
- **N4. `callerHasTeamMemberships` counts memberships on deactivated teams** (the `EXISTS` query has no join to `teams`). The exclusion copy is still true in that case ("your team isn't listed"), so no action is needed. I'm noting it because it is the same root cause as V5.
- **N5. "Members" on TeamPage actually lists the caller's own memberships, not the team's members.** That is pre-existing and out of scope, but the new "Facilitator" heading sits right next to it. Worth a line in the follow-up for #2/#1 if anyone touches TeamPage's information architecture.
- **N6. Placing "Create a new team" inside `!listError`.** I agree. It also stays hidden during the stale re-fetch after a confirm rejection, because `listLoading` is true. The footer correctly stays visible throughout. Good.
- **N7. No live-session leakage.** I confirmed that nothing in the change set renders on `/session/:id*` or `DraftSessionHost`, and that `NoTeamPage` is untouched. Because the block is page-local and there is no layout wrapper, the `App.test.tsx` `/no-team` isolation test is unaffected.

---

## Requested edits, summarised

| # | Where | Change |
|---|---|---|
| E1 | D6, tasks 4.1 step 3 | Add `abandoned_at = now()` to the UPDATE |
| E2 | Design Risks (and R8 if option b is chosen) | "until a full page load", and choose (a) or (b) |
| E3 | D5 | Footer tolerates `session === null` (sign-out only) |
| E4 | D5 | The re-auth early-return exception |
| E5 | Tasks 2.1 | `setSession` helper and reset, pending-fetch and rejected-fetch recipes, `picker-way-out` test id |
| E6 | Tasks 1.1 | New typed fixture, routed render for (g), sentinel route for (a), case-insensitive (c) |
| E7 | D1, tasks 1.2 | Exact placement and `team-facilitator-block` test id |
| E8 | D7, tasks 3.1/3.2 | Cite the existing precedence tests; extend `setupValidCallbackMocks` with `globalRole` |
