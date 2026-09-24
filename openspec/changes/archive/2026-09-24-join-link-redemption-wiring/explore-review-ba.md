# BA Review — Exploration Notes (Issue #166: Join Link Redemption Wiring)

**Reviewed by:** Marcus Delgado, Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway)
**Verification method:** re-checked the claims against the actual migrations and route code before writing this review, not just against the prose — same discipline Devon applied to Tomás's finding.

Overall: this is unusually thorough exploration and I don't want that undersold — the shape mismatch in §1 and the #164 boundary in §3b are exactly the kind of thing that becomes a scope dispute six weeks from now if nobody wrote it down. My job here is narrower: turn the two areas flagged as needing sharper acceptance conditions (get-or-create semantics, `join_token` removal) from "the team will figure it out" into something `design.md` can be built from without a follow-up question back to whoever writes it. I found one gap Devon's own verification missed (the schema-level constraints on `sessions.join_token`), which changes the removal recommendation from "delete a dead column" to "run a migration with a defined blast radius."

---

## 1. Get-or-create join_links strategy

This is the part of the exploration that reads as a good instinct without yet being a requirement. Three things need to be pinned down before it's buildable.

### 1a. "Active" needs an explicit, single definition

The notes use "active, unexpired, unrevoked" as if it's one condition; it's really shorthand for a predicate that needs to be written down once so both the get-or-create path and any future admin/reporting query agree on it. Based on the schema (`join_links.expires_at`, `join_links.revoked_at`), the predicate is:

```sql
revoked_at IS NULL AND expires_at > NOW()
```

**Suggested rewrite for design.md:** state this predicate verbatim as the definition of "active," and note it's the same predicate `GET /api/join/:token`'s validation logic already applies (`join-link/spec.md`, "Join link validation") — so get-or-create and redemption are checking the same thing, not two independently-maintained versions of "is this link still good."

### 1b. Multiple active links can already legitimately exist — which one does get-or-create pick?

This is the gap I think matters most. `join-link/spec.md`'s own "Facilitator generates additional join link" scenario is explicit: a facilitator can create a new link while an old one is still valid, and *both remain valid*. So "does an active link exist for this team" is not reliably a yes/no question — for a team where a facilitator has manually generated more than one link (nothing stops this today), the answer can be "yes, several." The exploration notes don't say which one get-or-create should return.

**Concrete AC needed:** if more than one active `join_links` row exists for the team, get-or-create SHALL return a single, deterministically-chosen one — e.g. "most recently created" (`ORDER BY created_at DESC LIMIT 1`). Whatever the choice, it needs to be named in `design.md`, not left implicit in whatever the first implementation happens to write. Otherwise this becomes untestable: two engineers could implement "get the active one" correctly by two different orderings and both pass a test that only checks "a valid link came back."

### 1c. Race condition is real and undercuts the stated motivation, not just a theoretical nit

Exploration notes §1 gives the reason for get-or-create as avoiding "quietly multiplying credentials nobody's tracking" — but nothing in the proposed design actually prevents that. I checked: `join_links` has no unique constraint or partial index on `team_id` (only a global `UNIQUE` on `token` and an index on `token`). If get-or-create is "SELECT for active row; if none, INSERT," two concurrent requests that both see "no active row" (e.g., a `POST /draft` and a `facilitator-state` poll landing at nearly the same moment, or two browser tabs) will both insert — producing exactly the redundant-link accumulation the get-or-create strategy was proposed to solve.

Whether this is acceptable is a real product decision, not an implementation detail, and I'd want it stated as one of two options in `design.md` rather than discovered later:
- **Accept it, document it:** duplicate active links from a race are harmless (both are legitimately valid per the join-link spec's own tolerance for multiple links) and rare enough not to warrant DB-level locking. State this plainly as a known, accepted race — the same way the notes already ask for the badge-honesty tradeoff and the #164 gap to be named rather than left silent.
- **Close it:** e.g. a partial unique index (`WHERE revoked_at IS NULL AND expires_at > NOW()` — not directly expressible as a static partial index since `expires_at > NOW()` isn't immutable, so this would likely need a `SELECT ... FOR UPDATE` on the team row, or an application-level advisory lock) and a defined conflict-handling path.

I'd lean toward "accept and document" — it matches the effort level of the rest of this feature and the harm is genuinely low — but that's a call for `design.md` to make explicitly, the same way Devon flagged the badge wording as "either is fine, silence isn't."

### 1d. Shared helper extraction — should be a stated requirement, not a nice-to-have

Exploration notes §1 argue convincingly *why* the INSERT+audit-transaction logic in `join-links.ts:76-104` shouldn't be duplicated, but the notes frame it as something "whoever implements this should" do rather than something the proposal commits to. Given that logic carries spec-governed guarantees (`join-link/spec.md`'s "Join link creation and redemption are durably recorded" requirement — transactional audit coupling, `AuditWriteError` semantics, specific `actor_global_role` resolution per call site) — a second, drifted implementation of that logic at the new internal call site is a real correctness risk, not a style preference. This should be promoted to an explicit acceptance condition in the proposal: *"join link creation at the new internal call site SHALL invoke the same audited creation path as `POST /api/teams/:teamId/join-links`, not a duplicate implementation."* Otherwise it's the kind of thing that quietly becomes "nice to have" the moment the schedule gets tight, and Marcus has seen that exact failure mode before (see: the reveal-mechanic concern that shows up in every feature review he does).

---

## 2. `sessions.join_token`'s fate — the removal recommendation is right, but its scope is understated

I re-ran the check the notes describe (`grep -rn "join_token"`) but against the *migrations*, not just `packages/backend/src`. That surfaces something the notes' "no reason I'm not seeing to keep it" doesn't account for:

```
packages/backend/migrations/2_create_tables.sql:66:   join_token   text  NOT NULL,
packages/backend/migrations/2_create_tables.sql:76:   CONSTRAINT sessions_join_token_unique UNIQUE (join_token),
packages/backend/migrations/3_create_indexes.sql:27:  CREATE INDEX idx_sessions_join_token ON sessions (join_token);
```

`join_token` is `NOT NULL` and carries its own `UNIQUE` constraint plus a dedicated index. This doesn't change the recommendation — I agree removal is correct, for the same reason Devon gives (attractive-nuisance risk) — but it does change what "removal" costs, and the exploration notes' framing ("a call for whoever owns the migration") undersells it as a documentation decision when it's actually a migration with a defined footprint. Concretely, `design.md`/`tasks.md` need to account for all of the following as one unit of work, not discover them one at a time during implementation:

1. **A migration** (`DROP COLUMN join_token` — which takes the `UNIQUE` constraint and index with it automatically, but should say so explicitly so nobody adds a separate `DROP CONSTRAINT`/`DROP INDEX` step redundantly).
2. **Both INSERT sites** in `facilitator-sessions.ts` (draft creation — I confirmed two call sites, ~line 318 and ~line 561) currently populate `join_token` because the column is `NOT NULL`; both must drop it from their column list in the same change, or the migration and the code go out of sync mid-deploy.
3. **The `facilitator-state` SELECT/response** (`facilitator-sessions.ts` ~line 1926 and ~1995) currently selects `join_token` and returns it as `joinToken` in `FacilitatorSessionStateResponse` — this is the exact field that needs to be repointed to the real `join_links` value, per the get-or-create wiring itself, so this isn't a separate task, but it should be named as the same task rather than two.
4. **Test fixtures — the footprint is larger than the two files the notes name.** Beyond `DraftSessionHost.test.tsx` and the facilitator-state/draft-creation tests, I found raw `INSERT INTO sessions (..., join_token, ...)` statements that will fail outright once the column is dropped (not just fail an assertion — the INSERT itself becomes invalid SQL) in: `ws-pubsub-integration.test.ts` (two inserts), `facilitator-error-state-2-restricted-role.test.ts`, `facilitator-error-states-integration.test.ts`, and `action-items-integration.test.ts`. Additionally, `facilitator-sessions.test.ts:472` asserts on the literal constraint name `"sessions_join_token_unique"` — that assertion is testing behavior that will no longer exist and needs to be removed, not just updated. `tasks.md` should enumerate these by file rather than relying on "tests will need updating" as a single line item, since that's exactly the kind of underestimated cleanup that turns into a mid-implementation scope surprise.

**Suggested rewrite for design.md's decision record:** "Remove `sessions.join_token` via migration `<N>` (`DROP COLUMN join_token`, which also drops `sessions_join_token_unique` and `idx_sessions_join_token`). Both `sessions` INSERT sites and the `facilitator-state` SELECT lose the column reference in the same change. Six test files require updates: [list]. No other schema object references `sessions.join_token` — verified against `packages/backend/migrations/` in full, not only `packages/backend/src`."

---

## 3. Everything else in the notes — assessment, no rewrite needed

- **§2 (hook point):** the reasoning for ruling out `advance` and preferring `facilitator-state` (with `POST /draft` also eagerly resolving) is sound and specific enough to build from as-is. No change requested.
- **§3a (badge honesty):** the two options offered are each concrete and testable. My only addition: `design.md` should pick one of the two, not present both — leaving it as an either/or in the document that ships to implementation is exactly the ambiguity Marcus's requirements are meant to prevent. Whichever is chosen becomes a one-line acceptance scenario ("badge text reads X during draft/lobby").
- **§3b (#164 boundary):** well-scoped and should carry into `design.md`'s Risks/Out-of-Scope section verbatim — this is a genuine "technically complete, functionally invisible" trap and it's correctly named rather than left implicit.
- **§5.6 (test fixtures):** see §2 above — the two files named are real but incomplete; the fuller list is in this review.

---

## 4. Acceptance criteria — expanding the issue's three bullets into testable form

The issue's stated ACs are directionally right but need to be operationalized before implementation can self-certify against them. Suggested expansion for `proposal.md`:

1. *"resolves to a real, redeemable `join_links` row"* → should explicitly state the get-or-create predicate (§1a above) and the tie-break rule when multiple active rows exist (§1b above), since "real and redeemable" alone doesn't specify *which* row when more than one qualifies.
2. *"`GET /api/join/:token` successfully admits a participant using the link the Facilitator was shown, verified end-to-end (not just by code inspection)"* — given Devon's finding that today's bug is actually two stacked bugs (wrong token *and* wrong path, `/join/:token` vs `/api/join/:token`), the end-to-end test needs to specifically exercise the frontend-constructed URL (whatever `DraftSessionHost.tsx` renders/copies), not call `/api/join/:token` directly with a known-good token. A test that only validates the token in isolation would pass today even with the path bug still present — which is the exact "technically complete, functionally invisible" failure pattern §3b already warns about elsewhere in these notes. Worth being just as explicit about it here.
3. *"`sessions.join_token`'s role... explicitly documented"* → per §2, this should read "removed, via migration `<N>`, with the fuller footprint (INSERT sites, `facilitator-state` response, six test files) enumerated in `tasks.md`" rather than "documented," since removal — not documentation — is the recommended and, in my read, correct path.

---

## Summary — what I'd block on before this goes to `design.md`

Not blocking, but strongly recommend resolving before proposal sign-off:
- 1a/1b: the "active" predicate and the tie-break rule for multiple qualifying rows (currently undefined — not hand-wavy so much as absent)
- 1c: an explicit accept-or-close decision on the race condition, stated in `design.md`, not left implied
- 1d: shared-helper reuse promoted from "should" to a stated acceptance condition
- 2: the fuller migration/fixture footprint (six test files, two INSERT sites, one response field) enumerated in `tasks.md` as one scoped unit of work, not discovered incrementally
