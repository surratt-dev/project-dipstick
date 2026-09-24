# Engineer Design Review — join-link-redemption-wiring

Reviewer: Marcus Oyelaran (Full Stack Engineer)
Scope: implementability, boundary cleanliness, hidden coupling, error paths, fit against existing patterns in `join-links.ts`, `facilitator-sessions.ts`, `DraftSessionHost.tsx`.

## Verdict

Implementable, and the core decisions (get-or-create semantics, accepting the race, the two-commit migration split) are sound and well-reasoned. But three things in the "safe as long as everyone reads it the same way" category need to be nailed down before implementation starts, because they're exactly the kind of gap that produces a change that passes its own tests while quietly leaving something broken — which is the failure mode this whole change exists to close. I'd rather we catch these now than have QA or a future security review catch them later.

None of these are reasons to send the design back for another full pass. They're scoped corrections I'd want folded into `tasks.md` before task 1.1 starts.

## 1. Get-or-create race (as requested: verify no double-creation between `POST /draft` and `facilitator-state`)

Traced the actual call sequence: for the common path (facilitator creates a draft, then `DraftSessionHost` mounts and calls `facilitator-state`), these are **sequential**, not concurrent — `POST /draft`'s `withAuditTransaction` commits before the 201 response is sent, so by the time the frontend's `facilitator-state` fetch lands, the row already exists and get-or-create's SELECT finds it. No double-insert on the golden path.

The only real race window is true concurrent requests (e.g., two `facilitator-state` polls overlapping, or a poll landing mid-flight during `POST /draft`'s own transaction). Design.md Decision 3's reasoning holds: this reaches the same spec-legal multi-link state a facilitator can already produce by hand, and isn't worth a lock. Agreed, no changes needed here.

## 2. Shared audited helper extraction — the line-range boundary is too narrow

Decision 2 and Task 1.1 scope the extraction to `join-links.ts:76-104` — the `withAuditTransaction` call itself. But the surrounding code that actually has to run identically at both call sites for the audit guarantee to hold isn't fully inside that range:

- **Token generation and `expiresAt` computation** (lines 65-68) sit *before* line 76, outside the stated extraction boundary. If each call site (POST /join-links and get-or-create's miss branch) independently regenerates these, that's fine for `randomBytes(32)` (no drift risk), but it's inconsistent scoping — either both pre-transaction steps are part of "the creation logic" or neither is, and right now the design draws the line in a way that doesn't match either reading cleanly.
- **`emitAuditEvent(...)` for `join.link_created`** (lines 117-122) runs *after* line 104, also outside the stated boundary. This one matters: it's the structured-log half of the audit guarantee, and if it's left for each call site to invoke independently (or, worse, forgotten at the new get-or-create call site because it "wasn't in the extracted function"), that's precisely the second-independently-written-copy drift risk this decision's own rationale says it's trying to avoid.

**Recommendation:** extract a single function that owns token generation through `emitAuditEvent`, not just the transaction call — e.g. `createJoinLink({ teamId, createdByUserId, actorGlobalRole, actorIp, logger }): Promise<JoinLink>`. Both `POST /api/teams/:teamId/join-links` and the get-or-create miss branch call this one function and get a `JoinLink` back; neither reimplements any piece of it, including the log emission. Update Task 1.1's line-range framing accordingly — the current phrasing will lead an implementer to extract only the DB half and leave the audit-log half duplicated.

## 3. `facilitator-state`'s get-or-create call site has no `actor_global_role` to pass

The extracted helper needs `actor_global_role` for the `audit_log` INSERT (it's a required column, not optional metadata). Look at where each caller gets that value today:

- `POST /api/teams/:teamId/join-links` resolves it via an explicit query before reaching the transaction (`userRole` at join-links.ts:44-53).
- `POST /draft` (facilitator-sessions.ts:214-239) also resolves it already — `global_role` is fetched and confirmed `=== "facilitator"` before the session INSERT even runs. Wiring get-or-create here is free; the value is already in scope.
- `GET .../facilitator-state` (facilitator-sessions.ts:1912-1999, current code) **never queries `global_role` at all.** It authorizes purely on `sr.facilitator_id === userSession.userId` — no `SELECT global_role FROM users` anywhere in this handler today.

Task 2.3 ("Wire `GET .../facilitator-state` to call get-or-create") doesn't account for this. On a cache-miss inside this handler, the get-or-create helper needs an `actor_global_role` value it currently has no way to obtain without adding a new query this handler doesn't otherwise need. Two honest options, and the design should pick one explicitly rather than leaving it to whoever implements Task 2.3:

- (a) Add a `SELECT global_role FROM users WHERE id = $1` in `facilitator-state`, paid only on the (rare) miss path, mirroring the pattern already used elsewhere in this file (e.g. the `/advance` and `/start` handlers both do exactly this before their own audit writes).
- (b) Hard-code `"facilitator"` as the actor role at this call site, on the reasoning that only a facilitator could have created this session's draft state in the first place (enforced at `POST /draft` time) — cheaper, but it's an assumption about role stability between draft-creation and now that should be written down, not implied.

I'd take (a) — it's one indexed lookup on a rare path, and it matches the "authorization enforced fresh, not cached in session state" pattern already used everywhere else in this file (e.g. `eligible-for-session`'s comment on why it re-reads `global_role` live rather than trusting `request.session`). But either way, this needs a line in `tasks.md`, not silent implementer's choice.

## 4. Two facilitator-state unit tests break in Commit 1, not Commit 2 — missing from the footprint

Decision 6's "Full footprint" and tasks.md's Section 4 enumerate five backend test files that break in Migration B (the actual `DROP COLUMN`, because their raw SQL becomes invalid). That enumeration is accurate for what it covers, but it's missing two files that break **in Commit 1**, for a different reason — the `facilitator-state` handler's data source changes, independent of the column ever being dropped:

- `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts:2205-2231` — mocks the `sessions` SELECT to return `join_token: "join-token-abc"` and asserts `body.joinToken` equals that literal.
- `packages/backend/src/routes/__tests__/http-session-expiry-no-partial-execution.test.ts:150-163` — same pattern, mocks `join_token: "tok"` on the SELECT and asserts a 200 with `currentSessionState: "draft"` (doesn't assert the token value directly, but the mock only stages one `mockDbQuery` resolution for what will become at least two calls — the sessions SELECT plus get-or-create's join_links lookup).

Once Task 2.3 rewires `facilitator-state` to source `joinToken` from get-or-create instead of the SELECT's `join_token` column, both tests break: the first on a stale assertion, the second because its single staged mock resolution isn't enough for the new call count (get-or-create's `join_links` SELECT has nothing queued to resolve, which will either throw or return `undefined` depending on the mock's default behavior). These aren't in Decision 6's footprint because they have nothing to do with the schema drop — they need updating the moment Task 2.3 lands, i.e. in Commit 1.

**Recommendation:** add both files to Task 2.3 or 2.4's scope explicitly (update their mocks to stage a `join_links` lookup resolution and assert against that value instead of the old `join_token` literal), so this isn't discovered mid-implementation when these tests start failing for a reason that looks unrelated to what the implementer is touching.

## 5. `POST /api/v1/teams` (new-team creation) isn't an anchor point, but it shares the same INSERT site

Decision 1 anchors get-or-create at exactly two call sites: `POST /draft` and `facilitator-state`. But `POST /api/v1/teams` (facilitator-sessions.ts:435-612, the new-team creation flow) has its own, third, independent `join_token` generation (line 512: `crypto.randomUUID().replace(/-/g, "").substring(0, 8)`) and its own session INSERT that writes it (line 558-564), and its own response field that returns it (line 610). Task 4.2 does correctly catch this INSERT site for the column-value removal ("existing-team and new-team draft creation" — the second half of that phrase refers to this handler, even though the session it creates is `status: 'lobby'`, not `'draft'`).

But after Task 4.2 removes `join_token` from this INSERT, the local `joinToken` variable (still generated at line 512) becomes pure fiction — it's returned in the 201 response's `joinToken` field, but no longer written anywhere, matching nothing in the database. I checked whether anything downstream reads it: `SessionCreationPage`'s new-team submission doesn't consume `joinToken` from this response (confirmed by reading the frontend call site and its test — the frontend navigates straight to `DraftSessionHost`, which independently re-fetches `facilitator-state` for its own copy of the token). So this is not a live bug today. But it is exactly the shape of thing Decision 6 says it's trying to eliminate — "a column... that looks like the thing to wire up... nothing about its shape signals inert" — except now it'd be a *response field* with that same property, freshly created by this very change, in the same commit that removes the old one.

**Recommendation:** pick one, explicitly, in `design.md`:
- Wire this endpoint's response as a third get-or-create call site too (consistent, but Decision 1 should say so and Task 2.x should cover it), or
- Drop `joinToken` from this endpoint's response shape entirely, since nothing consumes it and keeping a fabricated value around contradicts the change's own stated rationale, or
- Explicitly note it as an accepted, temporary loose end (with the same rigor Decision 5 applies to the #164 gap) if there's a reason to defer it.

Silence on this one specific call site, given the other two are handled carefully, reads as an oversight rather than a decision.

## 6. Minor: cross-route-file import is a new pattern for this codebase

Wiring the extracted helper from `join-links.ts` into `facilitator-sessions.ts` means one route file importing from another. I checked — no existing route file in `packages/backend/src/routes/` currently imports from a sibling route file; every reusable piece of cross-cutting logic (`withAuditTransaction`, `emitAuditEvent`, `evaluateSessionSubscriberAccess`, `applyTimingFloor`) lives in a dedicated non-route module (`auth/`, `content/`) and is imported into route files, never the other way around. Not a blocker, but I'd put the extracted `createJoinLink` helper in a new small module (e.g. `auth/join-link-creation.ts`, alongside `withAuditTransaction` which it wraps) rather than exporting it out of `join-links.ts`, so `routes/` stays a leaf layer and we don't start a precedent of route files depending on each other.

## 7. Minor: stale type and doc drift not in the footprint

- `packages/shared/src/types/session.ts:19` — the `Session` interface still declares `joinToken: string` as a required field. Confirmed nothing imports this type today (only `AuthSession` is used elsewhere), so it's dead, not breaking — but the proposal's own bar is "every code and schema reference to it" removed. Should be in the footprint list.
- `packages/shared/src/types/team-content-access.ts:219-224` — `FacilitatorSessionStateResponse.joinToken`'s JSDoc explicitly says "sessions.join_token, for the draft control view's not-yet-joinable join link." That sentence becomes false the moment Task 2.3 lands (real source is `join_links`, and Decision 4 removes the "not yet joinable" framing too). Small, but worth a one-line update alongside the code change rather than shipping a comment that immediately contradicts the code it documents.

## 8. Migration A/B sequencing — verified correct

Confirmed the `NOT NULL` relax is safe against the `sessions_join_token_unique` constraint specifically: Postgres treats multiple `NULL`s as non-conflicting under a `UNIQUE` constraint, so once new code omits `join_token` (leaving it `NULL`), concurrent new-code inserts won't collide against each other or against old-code rows that still populate a real value. No guard migration (in the style of migration 10's `DO $$` pre-check) is needed here, unlike migration 10 — that guard exists because migration 10 *tightens* a constraint against pre-existing data; migrations A and B only *relax*/*remove*, which can't fail against existing rows the way a new `UNIQUE` index can. Sequencing and rollout-safety reasoning in Decision 6 checks out.

## Summary of asks before implementation starts

1. Widen the extraction boundary (Decision 2 / Task 1.1) to include token/expiry generation and `emitAuditEvent`, not just the transaction call.
2. Decide and document how `facilitator-state`'s get-or-create call resolves `actor_global_role` on a miss (Task 2.3) — recommend a live query, matching this file's existing pattern.
3. Add `facilitator-sessions.test.ts` (~line 2205) and `http-session-expiry-no-partial-execution.test.ts` (~line 150) to Commit 1's scope (Task 2.3/2.4) — they break when the data source changes, not when the column drops.
4. Make an explicit call on `POST /api/v1/teams`'s now-fabricated `joinToken` response field (Task 4.2's second INSERT site).
5. (Nice-to-have) Place the extracted helper in a non-route module rather than exporting cross-route-file.
6. (Nice-to-have) Fold the two stale-doc/type items into the footprint list so cleanup doesn't get missed.
