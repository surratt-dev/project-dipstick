# Exploration Notes — Join Link Redemption Wiring (Issue #166)

**Explored by:** Devon Calloway (Internal Champion / SME persona)
**Trigger:** Security review of the paused change `join-link-display-copy` (issue #45), which found the token `DraftSessionHost.tsx` displays does not correspond to a working join route.
**Related specs read:** `openspec/specs/join-link/spec.md`, `requirements/use cases/02 - Session Setup - Use Cases.md` ("Copy Session Join Link," "Join Session via Link," "Join Session with Invalid or Expired Link")
**Related artifacts read (paused branch `agent-team/45-join-link-display-copy`, not on `main`):** `openspec/changes/join-link-display-copy/exploration-notes.md`, `design-review-security.md`
**Archived change read:** `openspec/changes/archive/2026-09-23-session-creation-existing-team/` (`design.md`, `tasks.md` — task 8.2's "Partial" verification is the origin of this gap)

**Revision note:** This is the second pass on these notes, incorporating reviewer feedback from Priya Nair (`explore-review-facilitator.md`) and Marcus Delgado (`explore-review-ba.md`). I re-verified every schema and code claim Marcus made against the actual migration files and route code before accepting them — see the addendum at the end for what I checked and what I pushed back on.

---

## 0. Confirming the bug, first-hand

I re-traced everything Tomás Ferreira's security review already found, rather than taking it on faith — it's cheap to verify and this is exactly the kind of "was this actually checked" gap he called out.

**Two disconnected systems, confirmed:**

| | `join_links` (real) | `sessions.join_token` (fake) |
|---|---|---|
| Created by | `POST /api/teams/:teamId/join-links` (`join-links.ts:65`) | Draft/team creation (`facilitator-sessions.ts:303`, `:512`) |
| Token shape | `randomBytes(32).toString("base64url")` — 256 bits | `crypto.randomUUID().replace(/-/g,"").substring(0,8)` — 32 bits, truncated from a UUID, not generated for this purpose |
| Scope | `team_id` (reusable across every session that team ever runs) | one row per `sessions` row |
| Validated by | `GET /api/join/:token` (`join-links.ts:138`) — checks existence, `revoked_at`, `expires_at` | **nothing.** `grep -rn "join_token" packages/backend/src` outside `facilitator-sessions.ts` returns zero hits. |
| Audited | `join.link_created` / `join.link_redeemed`, both durably written to `audit_log` in the same transaction as the row they accompany | not applicable — never redeemed, nothing to audit |

**The URL bug is worse than "wrong token," it's also wrong path.** `DraftSessionHost.tsx:184` builds `` `${window.location.origin}/join/${data.joinToken}` ``. The only backend route that validates anything is registered at `/api/join/:token` — with the `/api` prefix. I checked both places a bare `/join/:token` could still resolve:
- `packages/frontend/src/App.tsx` — no `/join/:token` route (only `/join-error`, confirmed at line 66).
- `packages/frontend/vite.config.ts` — the dev proxy forwards `/api` and an explicit allowlist of `/auth/*` paths only (lines 16-28, with its own comment explaining exactly why it's not a blanket prefix match). `/join` is not in that list.

So even a correctly-generated `join_links.token`, dropped into today's URL-construction code unchanged, would still 404. Two independent bugs stacked on top of each other, and fixing the token without fixing the path (or vice versa) leaves the link broken either way.

**Stating this as a requirement, not a preference:** Marcus's review flagged, correctly, that an end-to-end test which calls `GET /api/join/:token` directly with a known-good token would pass *today*, even with the path bug (`/join/:token` vs `/api/join/:token`) still present — it would verify the token in isolation and miss the exact "technically complete, functionally invisible" failure this whole exploration started from. So: verification for this change SHALL exercise the actual frontend-constructed URL — whatever `DraftSessionHost.tsx` (or its replacement) renders and puts on the clipboard — not a direct call to the backend route with a pre-known-good path and token. A test that only validates the token would have passed against the original bug; the point of this issue is that both halves get exercised together, the way a real Engineer clicking a real link would.

---

## 1. The shape mismatch that matters more than the missing wiring

This is the part I don't think has been named yet anywhere, including in the paused change's notes: **`join_links` rows are team-scoped and durable, not session-scoped and single-use.**

Look at the schema (`packages/backend/migrations/5_create_join_links.sql`):

```sql
CREATE TABLE join_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id     UUID NOT NULL REFERENCES teams(id),
    token       VARCHAR(64) NOT NULL UNIQUE,
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ NULL
);
```

No `session_id` column. And the spec says so explicitly: "Facilitators SHALL be able to generate new join links at any time; previously generated links remain valid until their individual expiry" — multiple valid links can coexist for one team. That's by design: a join link is really "how do I get into this **team**," and the session-aware landing rule (`join-link/spec.md`, "Session-aware join link landing") is what routes an already-team-joined person to whatever session happens to be running.

`sessions.join_token`, by contrast, was modeled as if a join link belongs to a session — one row, one token, created alongside the session row, in lockstep with its lifecycle. That's a structurally different shape from what actually exists, and it's the shape the fix has to *not* copy forward. If the fix mints a fresh `join_links` row every time a draft session is created, we've faithfully reproduced the wrong mental model with the right token format — same bug, better entropy.

```
Wrong shape (mirrors sessions.join_token):
  session drafted --> new join_links row minted --> tied 1:1 to this session
  (next session for the same team --> another new row --> which one is "the" link?)

Right shape (matches what join_links already is):
  team has an active, unexpired, unrevoked join_links row?
    --> yes: reuse it
    --> no:  create one (same audited path POST /api/teams/:teamId/join-links already uses)
  facilitator-state returns *that* team's active link
```

### 1a. The "active" predicate, made explicit

Marcus's review is right that "active, unexpired, unrevoked" was shorthand doing the work of a requirement without being one. Stating it plainly, so get-or-create and redemption check the identical condition rather than two independently-maintained versions of it:

```sql
revoked_at IS NULL AND expires_at > NOW()
```

This is exactly the condition `GET /api/join/:token`'s validation logic already applies (`join-link/spec.md`, "Join link validation": "checking that the token exists, has not expired, and has not been revoked"). `design.md` should state this predicate verbatim as the single definition of "active" and note the two call sites (get-or-create, redemption) are checking the same thing by construction, not by convention.

### 1b. Multiple active rows: deterministic tie-break

Marcus is right that this isn't hand-wavy, it's genuinely undefined today. `join-link/spec.md`'s own "Facilitator generates additional join link" scenario confirms a team can legitimately have more than one active link at once — nothing today stops a facilitator from generating a second one while the first is still valid. So "does an active link exist for this team" is not reliably yes/no; get-or-create needs a deterministic rule for "yes, several."

**Decision:** most-recently-created wins — `ORDER BY created_at DESC LIMIT 1`. Reasoning: the most recent link is the one most likely to still be in a facilitator's clipboard history or freshly shared in a chat channel; picking an older one would mean get-or-create sometimes hands back a link the facilitator isn't actively using, in a team that has since moved on to a newer one. This needs to be named as a concrete rule in `design.md` (not left implicit) — two implementations that both correctly return "an active link" but disagree on *which* one would both pass a test that only checks "a valid link came back," and that's exactly the kind of untestable ambiguity Marcus is flagging.

### 1c. The team_id race condition: decision

Marcus is right that get-or-create as "SELECT active row; if none, INSERT" has a real race — two near-simultaneous requests (a `POST /draft` and a `facilitator-state` poll, or two browser tabs) that both observe "no active row" will both insert, producing two active rows for one team.

I checked whether there's codebase precedent either way. There is one, and it's instructive: `packages/backend/migrations/10_sessions_team_active_unique.sql` closes an analogous race for session creation with a DB-level partial unique index, and its own comment explicitly rejects an app-level check-then-insert for that case as insufficient. That precedent does not transfer here, though, and the reason matters: `sessions_team_active_unique` protects a real invariant (a team must not have two concurrently non-terminal sessions — the *system* breaks if that happens, per Decision D3). A duplicate active `join_links` row protects nothing that's currently violated — the spec already tolerates, by design, a team having multiple simultaneously-valid links (see 1b above). A race producing a second valid row doesn't create an inconsistent state; it creates the same state a facilitator could already reach on purpose by clicking "generate new link" twice.

**Decision: accept and document, do not add a constraint.** The harm is bounded (one extra normal-shaped, spec-legal row, resolved by 1b's tie-break the next time get-or-create runs) and a partial unique index isn't even cleanly available here the way it was for migration 10 — `expires_at > NOW()` isn't an immutable expression, so a static partial index can't encode "active" the way `sessions_team_active_unique` encodes "non-terminal status." Closing it properly would mean `SELECT ... FOR UPDATE` or an application-level advisory lock on the team row, which is real complexity to spend on a race whose worst outcome is "one redundant, harmless, spec-legal row." `design.md` should state this explicitly as an accepted, documented race — not a silent gap — the same way it should state the badge wording and the #164 boundary explicitly rather than leaving them implicit.

### 1d. Shared helper extraction — a requirement, not a suggestion

I originally framed this as something "whoever implements this should" do. Marcus is right to push back — the INSERT+audit-transaction logic in `join-links.ts:76-104` carries spec-governed guarantees (`join-link/spec.md`'s "Join link creation and redemption are durably recorded": transactional audit coupling, `AuditWriteError` semantics, per-call-site `actor_global_role` resolution). A second, independently-written implementation of that logic at the new internal call site is a correctness risk — the two implementations can drift on exactly those guarantees — not a style preference to clean up later.

**Restating as an explicit requirement for the proposal:** join link creation at the new internal call site (get-or-create's "no active row, create one" branch) SHALL invoke the same audited creation path `POST /api/teams/:teamId/join-links` uses — extracted into a shared function both call — not a duplicate implementation. This should be a stated acceptance condition, not a code-quality aside that can slip when the schedule gets tight.

**Why this matters concretely:** an existing team (this issue's actual scope — `POST /draft`, not new-team creation) almost certainly already has a `join_links` row from whenever it first onboarded engineers. That row may well still be valid. If the fix always creates a new row per draft session, the team accumulates redundant valid links with no session tying them together in the UI anywhere a facilitator could see or manage them (link management/revocation is explicitly deferred, per `join-link/spec.md`'s own note) — just quietly multiplying credentials nobody's tracking. A get-or-create is the correct primitive, not an unconditional create.

This also means whoever implements this must **not** duplicate the INSERT+audit-transaction logic from `join-links.ts:76-104` into `facilitator-sessions.ts` — see 1d below, where this is now stated as a requirement rather than a should.

---

## 2. Where should link creation/lookup be triggered?

Three candidate hook points, in order of when they run:

```
POST /draft (session created, status='draft')
        │
        ▼
GET .../facilitator-state  (polled repeatedly while facilitator has the page open)
        │
        ▼
POST .../advance ("Open the room": draft -> lobby)
```

- **At `POST /draft`:** matches `sessions.join_token`'s current lifecycle (created alongside the session). Simple, but ties link lookup to a code path that only runs once, so if a team's link expires between sessions, the *next* draft creation is still the right moment to check.
- **At `facilitator-state`:** this endpoint is polled repeatedly (draft-review window, then live lobby). A get-or-create here means the link is guaranteed fresh every time it's displayed, at the cost of an extra query on a hot path (mitigated: it's a cheap indexed lookup, `idx_join_links_token` exists, and get-or-create only writes on the rare miss).
- **At `advance` (open the room):** would mean no real link exists during `draft` at all — directly contradicts the `join-link-display-copy` design decision (Priya's staging workflow, §3 of its exploration notes) that the copy button and link must be present and copyable during `draft`, before the room opens.

I'd rule out the third option outright — it undoes a decision already made carefully with facilitator input on the paused change. Between the first two, `facilitator-state` is the safer anchor: it's the single place both `draft`-view and `live-readiness-view` already read `joinToken` from today, so a get-or-create there covers both branches with one code path, and it degrades gracefully if a link happens to expire mid-review (next poll just makes a new one).

**Open question I'd flag for design.md, not resolve here:** does `POST /draft` also need to eagerly create/reuse the link (so the very first response already has a working `joinToken`, matching today's behavior where `POST /draft`'s own response body includes `joinToken` — `facilitator-sessions.ts:388`), or is it acceptable for that field to be briefly absent/placeholder until the first `facilitator-state` fetch resolves it? I lean toward "yes, `POST /draft` should also call the same get-or-create helper" so the response contract doesn't quietly change shape (existing tests assert `joinToken` is present in the 201 body).

---

## 3. Ritual-fidelity read: the badge text, and a promise this issue can't actually keep alone

**a. "(not yet joinable)" becomes untrue the moment this is wired correctly, and that's worth naming out loud.**

Today, "not yet joinable" is *literally* true — nothing validates `sessions.join_token`, so the link is inert no matter what state the session is in. Once it's a real `join_links.token`, the badge is describing something that isn't so: hitting `GET /api/join/:token` during `draft` will happily add the engineer to `team_memberships` right now — team-join has never been gated on session status, by design (that's what the session-aware landing rule is *for*: it routes an already-joined person to whatever's currently running, or to the plain team page if nothing is).

I don't think this is a ritual-fidelity violation in the sense I usually watch for — no vote is revealed early, no manager sneaks into a session, nothing about the four load-bearing constraints is touched. Team membership existing a few minutes before "Open the room" is clicked is harmless on its own. But it's precisely the "the application says one thing and does another" pattern I don't like leaving unresolved, because it's exactly how trust in the tool's own on-screen claims erodes over time.

**Priya's review reframed this correctly, and I'm adopting her framing over my original one.** I'd originally posed this as a truth-in-advertising question — get the noun right (session vs. team). Priya's point is sharper: what the facilitator actually needs from this badge, at the moment they're staring at it during `draft`, is an answer to "is it safe to hand this out yet, and what happens if someone clicks it right now" — not a technically-correct description of which database row is gated. A phrase like "team access only" would satisfy my original framing while still failing hers: it's accurate and still doesn't tell a facilitator what to expect if they share it during `draft`.

Whoever writes `design.md` needs to pick one of:
- Reword the badge to answer the facilitator's operational question directly — something in the shape of "this link works now, but anyone who clicks it before you open the room won't see a waiting screen yet" — centered on what happens if it's used early, not just on which noun is gated.
- Or explicitly accept the imprecision as a known, harmless simplification and say so in `design.md`'s Risks section, the same way Tomás asked `join-link-display-copy` to name its clipboard-friction tradeoff explicitly rather than wave it off.

`design.md` should pick one, not present both as an either/or — Marcus's review is right that leaving it open in the document that ships to implementation just moves the ambiguity downstream instead of resolving it. My lean is the first option: it's the one that actually serves Priya's staging workflow (§3b below), and it's still one line of copy, not new UI chrome.

**b. This issue can close its own acceptance criteria and still not deliver what "Join Session via Link" promises — because of #164, deliberately out of scope here.**

This is the one I'd push hardest on. Trace what actually happens to an Engineer who redeems a correctly-wired link while the session is in `lobby` (the exact state the "Copy Session Join Link" use case's precondition describes — "waiting for participants"):

```
GET /api/join/:token
  --> team_memberships row inserted (success)
  --> SELECT ... WHERE status = 'active'   <-- lobby != active
  --> no row found
  --> redirect to /team/:teamId
```

`/team/:teamId` is `TeamPage` — per the paused change's own grep-verified finding, it has "zero session-awareness." The Engineer does **not** see "a session waiting screen, indicating the session has not yet begun" (the use case's step 7 and its own AC: "The Engineer sees a waiting state UI, not the live voting UI"). They see a team roster page. No live participant-presence signal reaches the facilitator's `live-readiness-view` either, because nothing routed the engineer anywhere session-aware.

This is issue #164 territory exactly (`SessionLobbyPage`'s lobby branch is unreachable dead code), and #166 is right not to fold it in — it's a separate, already-filed, already-scoped problem. But I want this stated plainly rather than discovered a third time: **#166's acceptance criteria (`GET /api/join/:token` admits a participant, verified end-to-end) is satisfiable, and will pass, while the session's actual "waiting room" experience described in the use case remains completely undelivered for any join that happens during `lobby`.** That's the identical failure shape Priya and I already flagged once on #45 — a change that is technically complete and functionally invisible to the exact workflow it's supposed to serve. I'd want `design.md` and whatever verification step replaces task 8.2's "Partial" to say, in as many words: "this fixes redemption; it does not fix landing — see #164" — so nobody reads a green checkmark here as "join links fully work now."

The only case where this issue's fix produces a *complete*, felt experience today is a join during `active` (mid-session, late-join territory) — which the use case's own Alternate Flow already covers, and which will "just work" once redemption is wired, no further gap.

**c. Sequencing against #164 — Priya's review pushed this from "named" to "a decision this exploration owes an answer to."**

Priya's read of who actually hits the `lobby`-landing gap is worth restating precisely, because it changes the stakes from "an edge case exists" to "this is the default first-session workflow": a facilitator staging a **new team** has every reason to share the link during `draft`, ahead of "Open the room," specifically so people aren't creating accounts live in front of the group. That's not a misuse of the staging feature #45 built — it's the intended use of it. And per Priya's Observation 2, the facilitator has zero visibility into any of this: no roster update, no readiness signal, nothing distinguishing "the link is still broken" from "it worked and dropped them on a page that doesn't say so." Today's fully-dead link is unambiguous and gets reported as a bug; #166 alone replaces that with something that reads as flaky, which is a worse debugging experience to have live in front of a new team.

I looked for whether #166 is already positioned to ship after, before, or alongside #164, and found nothing in either issue's tracked scope or in this repo's `openspec/` state that sequences them relative to each other — **there is no stated ship order today, and that's exactly the gap Priya is pointing at.** I'm not resolving it here — that's rightly a `design.md`/scheduling decision, not something exploration should settle unilaterally — but I don't think it's acceptable for `design.md` to stay silent on it either, given how concretely Priya has traced the harm. **`design.md` MUST state explicitly which of the following is true:**
- #166 ships after #164 lands (the clean answer — redemption and landing complete together, no gap window ever ships to a facilitator), or
- #166 ships first, as a deliberate choice, with the sequencing risk above named in its Risks section rather than discovered live.

If #166 does ship first, I'd flag — as a decision for `design.md` to weigh, not one I'm settling here — whether a cheap interim mitigation is worth building rather than shipping the gap bare. Priya's own suggestion is the right shape for one: a one-line caution under the copy button during `draft`/`lobby` ("people who click this before you open the room won't see a waiting screen yet"), which is a copy change, not new plumbing, and directly addresses the exact moment she's worried about. Her further suggestion of a minimal join-count/presence signal on `facilitator-state` is a reasonable idea but a larger one — it's new server-side tracking and a new piece of UI, which starts to trade against the "disappear into the background" property I watch for; if `design.md` wants to pursue it, I'd want it scoped and justified on its own rather than folded into #166's diff as a rider. The one-line caution costs little enough to be worth doing regardless of which way the ship-order decision goes; the presence signal is squarely a #164-or-later decision.

---

## 4. `sessions.join_token`'s fate

The issue asks this to be settled explicitly rather than left as another "not meaningful" comment nobody revisits. I'd lean toward **removal**, not documentation-in-place, and here's the reasoning rather than just a preference:

Tomás's review named the risk precisely: as long as a column named `join_token` sits on `sessions`, returned verbatim by an API response, formatted into a URL by frontend code — it *looks* like the thing to wire up. That's exactly what happened here: `DraftSessionHost.tsx` was written against it in good faith, because nothing about its name or shape signals "this is inert." Keeping the column with a better comment doesn't remove that gravitational pull for the next person skimming this code without full context — it just makes the comment's job harder ("really, still not meaningful, no really"). Removing it removes the attractive nuisance entirely, and the real mechanism (`join_links`, reused via get-or-create) fully covers what it was trying to provide.

**Marcus's review caught a real gap in my own verification here, and it changes what "removal" costs.** I'd grepped `packages/backend/src` and called it done. Marcus re-ran the check against `packages/backend/migrations/` as well, and I've now independently re-verified his findings directly against the migration files rather than taking them on faith:

```sql
-- packages/backend/migrations/2_create_tables.sql:66
join_token          text            NOT NULL,
-- packages/backend/migrations/2_create_tables.sql:76
CONSTRAINT sessions_join_token_unique UNIQUE (join_token),
-- packages/backend/migrations/3_create_indexes.sql:27
CREATE INDEX idx_sessions_join_token ON sessions (join_token);
```

Confirmed exactly as Marcus described: `join_token` is `NOT NULL`, carries its own named `UNIQUE` constraint, and has a dedicated index. I also confirmed (`grep -rln "join_links" packages/backend/migrations/`) that `join_links` appears only in `5_create_join_links.sql` — no unique constraint or partial index on `team_id` there, only the global `UNIQUE` on `token` — which is the schema fact 1c's race-condition decision above depends on.

This doesn't change the recommendation — removal is still correct, same attractive-nuisance reasoning — but it does change what removal costs: this is a migration with a defined footprint, not a documentation edit. I also independently re-verified the code-level call sites Marcus named, so `design.md`/`tasks.md` can build from this list directly rather than re-deriving it:

1. **Migration:** `DROP COLUMN join_token` on `sessions` — this takes `sessions_join_token_unique` and `idx_sessions_join_token` with it automatically; `tasks.md` should say so explicitly so nobody adds a redundant separate `DROP CONSTRAINT`/`DROP INDEX` step.
2. **Two `INSERT` sites in `facilitator-sessions.ts`** currently populate `join_token` because the column is `NOT NULL` today — confirmed at line 318 (existing-team draft creation) and line 560 (new-team draft creation), plus the token-generation line and its stale comment at line 302 ("`join_token` is required but not meaningful for draft sessions"). All three lose their `join_token` reference in the same change as the migration, or the code and schema go out of sync mid-deploy.
3. **The `facilitator-state` SELECT and response** — confirmed at line 1926 (`SELECT id, team_id, facilitator_id, status, join_token`) and line 1995 (`joinToken: sr.join_token` in the `FacilitatorSessionStateResponse`). This is the exact field get-or-create needs to repoint to the real `join_links` value — same task as the migration, not a separate one.
4. **Six test files, confirmed by direct grep against each:**
   - `packages/backend/src/realtime/__tests__/ws-pubsub-integration.test.ts` — two `INSERT INTO sessions (..., join_token, ...)` statements (lines 139, 264)
   - `packages/backend/src/routes/__tests__/facilitator-error-state-2-restricted-role.test.ts` — one (line 187)
   - `packages/backend/src/routes/__tests__/facilitator-error-states-integration.test.ts` — one (line 215)
   - `packages/backend/src/routes/__tests__/action-items-integration.test.ts` — one (line 99)
   - `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts` — line 472 asserts on the literal constraint name `"sessions_join_token_unique"` (test 2.18, verifying a 23505-on-unrelated-constraint case doesn't get mistaken for the concurrent-session 409). That assertion is exercising behavior that will no longer exist once the column and constraint are dropped — it needs to be removed, or rewritten against a different constraint name that still exists after the migration, not merely updated in place.
   - `DraftSessionHost.test.tsx` (frontend) — named in my first pass, still applies.

Four of these are raw `INSERT INTO sessions` statements that become invalid SQL the moment the column is dropped, not assertions that merely start failing — so this migration cannot land without these files changing in the same commit, or CI breaks outright on the very next test run.

**Decision record for `design.md`:** "Remove `sessions.join_token` via a new migration (`DROP COLUMN join_token`, which also drops `sessions_join_token_unique` and `idx_sessions_join_token` — no separate DROP steps needed). Both `sessions` INSERT sites (`facilitator-sessions.ts:318`, `:560`) and the `facilitator-state` SELECT/response (`facilitator-sessions.ts:1926`, `:1995`) lose the column reference in the same change. Six test files require updates, five of them (`ws-pubsub-integration.test.ts` x2, `facilitator-error-state-2-restricted-role.test.ts`, `facilitator-error-states-integration.test.ts`, `action-items-integration.test.ts`, `DraftSessionHost.test.tsx`) because they hardcode the old token shape or INSERT the column directly, and `facilitator-sessions.test.ts:472` because it asserts on a constraint name that will no longer exist. No other schema object references `sessions.join_token` — verified against `packages/backend/migrations/` in full, not only `packages/backend/src`." `tasks.md` should enumerate these by file, not compress them into a single "update tests" line item.

---

## 5. Summary — decided vs. still open for design.md

**Decided in this revision (stated as requirements/decisions, not left open):**

1. **"Active" predicate:** `revoked_at IS NULL AND expires_at > NOW()` (§1a) — the same condition redemption already checks.
2. **Tie-break for multiple active rows:** most-recently-created wins, `ORDER BY created_at DESC LIMIT 1` (§1b).
3. **Race condition on concurrent get-or-create:** accept and document, do not add a DB constraint (§1c) — the duplicate row it can produce is spec-legal and harmless, unlike the invariant `sessions_team_active_unique` protects.
4. **Shared helper extraction:** promoted from "should" to a stated acceptance condition — the new internal call site SHALL invoke the same audited creation path as `POST /api/teams/:teamId/join-links`, not a duplicate (§1d).
5. **`sessions.join_token`:** remove, via a migration with the full verified footprint enumerated (§4) — one migration, two INSERT sites, one SELECT/response, six test files, named individually.
6. **E2E verification:** SHALL exercise the actual frontend-constructed URL, not a direct `GET /api/join/:token` call with a pre-known-good token (§0) — a token-only test would have passed against the original path bug.
7. **Badge wording:** reframed around "is it safe to share yet," per Priya's review — a specific wording direction proposed, with the choice between rewording and explicit-accept still `design.md`'s to make (§3a).

**Still genuinely open, for design.md to resolve (not exploration's to settle unilaterally):**

1. **Get-or-create anchor point:** `facilitator-state` (my lean, covers both `draft` and `lobby`+ branches with one path) vs. also eagerly resolving at `POST /draft` to preserve today's response-shape contract (I lean yes to both, not either/or) (§2).
2. **Badge wording, final text:** pick one of the two options in §3a — don't ship the either/or.
3. **#166/#164 ship order:** `design.md` MUST state explicitly whether #166 ships before, after, or alongside #164, and if before, whether the one-line interim caution (or Priya's presence-signal idea, scoped separately) is worth building (§3c). This is new in this revision — my first pass named the gap but didn't push for an explicit sequencing statement.

**Not touched by this exploration, correctly out of scope:** #164's routing fix itself; join-link revocation UI (already deferred by `join-link/spec.md`); anything about the clipboard/copy UI itself (that's #45, still paused pending this).

---

## Addendum: disposition of review feedback

**Verification performed before accepting Marcus's claims (all confirmed, none required correction):**
- `sessions.join_token`'s `NOT NULL`, `sessions_join_token_unique` `UNIQUE` constraint, and `idx_sessions_join_token` index — confirmed verbatim against `packages/backend/migrations/2_create_tables.sql:66,76` and `3_create_indexes.sql:27`.
- `join_links` has no unique constraint on `team_id` — confirmed against `packages/backend/migrations/5_create_join_links.sql` (the only migration file referencing `join_links`); only a global `UNIQUE` on `token`.
- All five additionally-named test fixtures (`ws-pubsub-integration.test.ts`, `facilitator-error-state-2-restricted-role.test.ts`, `facilitator-error-states-integration.test.ts`, `action-items-integration.test.ts`, `facilitator-sessions.test.ts:472`) — confirmed by direct grep against each file, exact line numbers matched or were within one line of what Marcus cited.
- The `facilitator-sessions.ts` INSERT/SELECT line numbers (§4) — confirmed by direct grep; Marcus's approximate line numbers (~318, ~561, ~1926, ~1995) were accurate to within a line.

**Feedback incorporated:** all of it, in the sections above — the active predicate, the tie-break rule, the race-condition decision, the helper-as-requirement promotion, the full migration footprint, the e2e-must-exercise-the-real-URL requirement, the badge reframing, and the explicit #164 sequencing question.

**Feedback incorporated with a modification, and why:**
- Marcus offered "accept and document" vs. "close it" as two options and leaned toward accept. I'm adopting his lean, but I've added a reason he didn't have available to him — the `sessions_team_active_unique` migration precedent — which strengthens the case rather than just picking a side: the precedent shows this codebase *does* close races with DB constraints when they protect a real invariant, and the fact that it doesn't apply here is itself evidence the harm is genuinely bounded, not just a judgment call.
- Priya's presence-signal idea (a count of recent joins on `facilitator-state`) is a good instinct but I'm not folding it into #166's scope even as an option to build now. It's new server-side tracking plus new UI, which trades against "the application disappears into the background" — a property I watch for specifically. I'm keeping her one-line caution-text suggestion (cheap, copy-only) as the thing I'd actually recommend if an interim mitigation is wanted, and pushing the presence signal out as its own future decision, scoped and justified separately, likely alongside #164 rather than riding on #166's diff.

**Feedback not incorporated, and why:** none outright rejected. Everything from both reviews either matched the ritual's intent (Priya) or sharpened an already-correct call into a testable requirement (Marcus). Where I diverged even slightly (the two items just above), I kept the reviewer's underlying concern and changed only the reasoning or the scope it lands in — not the substance of what they were asking for.
