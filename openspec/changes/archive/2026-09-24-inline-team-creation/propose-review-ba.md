# Business Analyst Review — Proposal Stage, Inline Team Creation (#44)

**Reviewed by:** Marcus Delgado (Business Analyst)
**Reviewing:** `proposal.md`, `design.md`, `specs/session-creation/spec.md`, `specs/default-topic-provisioning/spec.md`, `tasks.md`, `exploration-notes.md`
**Also re-read:** `requirements/use cases/02 - Session Setup - Use Cases.md`, `requirements/use cases/08 - Topic Management - Use Cases.md`, my own `explore-review-ba.md`, and Priya's `explore-review-facilitator.md`, plus `packages/backend/migrations/2_create_tables.sql` and `packages/frontend/src/pages/SessionCreationPage.tsx` to verify claims against current code.

---

## Overall

This is buildable. The spec deltas are unusually precise for a first propose pass, and — I checked this directly, point by point below — every acceptance condition either reviewer surfaced during explore made it into a testable scenario. I have one real blocker (the prerequisite gate in tasks.md 1.1 is not concrete enough to actually stop a bad merge) and one finding I want on record even though it isn't a blocker: the use-case rewrite that both reviewers asked to see *in* the proposal's own scope got pushed to a follow-up task instead, and that's a narrower commitment than what was agreed at explore.

---

## 1. Scoping the six-topic seed fix as a prerequisite, not part of this change: the call is right. The gate that enforces it is not concrete enough.

**The scoping call itself, I agree with — this is my own recommendation from explore, restated correctly.** #44 depends on the default topic set being correct; it doesn't own defining what "correct" means (Topic Management's AC does). Bundling the seed fix into this change would make one change responsible for two independently reviewable claims, and would tie a mechanism change to a content decision that's already settled. The proposal's framing (`What Changes`, item 6) and design.md's D7 both state this correctly and cite the right precedent (the existing-team change's `POST /draft` membership-check fix shipping ahead of the picker UI).

**But tasks.md 1.1, as written, cannot actually enforce the sequencing it claims to enforce.** The task reads:

> Confirm the prerequisite seed-data migration ... has landed on the target branch before this change's default-topic-provisioning work is verified against real data. If it has not landed yet, file/track it as its own change and block this change's merge on it — do not fold its migration work into this change.

Three concrete problems:

- **It names no artifact.** There is no prerequisite change filed anywhere in this repo right now — I checked `openspec/changes/` (only `inline-team-creation`, `team-membership-removal`, and `topic-skip-and-creation-time-confirmation` exist, and the latter two are empty placeholder directories with no proposal content) and `packages/backend/migrations/` (ten migrations, none of them a seed-data correction). "Confirm it has landed" presumes something to check against; right now there's nothing to check against, and the task doesn't say who files it, by when, or what its migration number/change slug will be. An implementer picking up this change today has no way to satisfy 1.1 except by going and creating the prerequisite themselves — which is fine, but the task should say that, not phrase it as a confirmation step over something that may not exist yet.
- **It's a checklist item, not a merge gate.** "Block this change's merge on it" is an instruction to a human at task-completion time, not a mechanism. There's no migration-numbering dependency, no CI check, nothing that would actually *fail* if someone merged this change first. Compare to how this codebase enforces its other sequencing-sensitive constraints — e.g., the concurrent-session block and the `POST /draft` membership check are both enforced at the database or route layer, not by a task-list instruction to "confirm X before proceeding." This is the one place in the proposal where a load-bearing constraint is enforced only by someone remembering to read tasks.md carefully.
- **The mitigation in design.md actively defeats the one check that would catch a violation.** Design.md's own risk mitigation for this exact risk says: "this change's own integration tests use a test-local fixture asserting the twelve-topic shape regardless of what's actually seeded, so the test suite doesn't silently pass against wrong data." Read that again: the fixture is *independent of what's actually seeded*. That means task 7.1/4.3's tests will pass identically whether the prerequisite migration has landed or not — they're testing the copy mechanism against a synthetic input, which is the right thing to test, but it means **no automated test in this change's own suite can ever fail because the prerequisite is missing.** The only thing standing between "merged without the prerequisite" and "shipped broken" is a person reading task 1.1 and doing the right thing by hand.

**Recommended fix, concrete enough to act on:** add one integration test — separate from the fixture-based unit test in 4.3 — that queries the *actual* seeded default topic set (`SELECT count(*) FROM topics WHERE team_id = '00000000-0000-0000-0000-000000000001' AND is_default = true`, or equivalent) against the real migrated test database and asserts twelve rows with the AC-verbatim prompts. That test is exactly the mechanism that would fail loudly if this change ships ahead of its prerequisite, which is the actual failure mode 1.1 is trying to prevent. This isn't new scope for #44 — it's tightening an existing task (4.3) to also cover the thing 1.1 currently only asks someone to "confirm."

---

## 2. The normalized functional unique index (D4): properly justified, and it's the right level of decision for design stage to make.

Exploration's §6 (and my own explore review, item 3) only asked for normalized *comparison* — case-fold and trim — backed by "the existing `teams_name_unique` constraint stays as the server-side backstop." Design's D4 goes further than that: it identifies that an app-level pre-check plus the *existing* exact-match constraint has a real concurrency gap (two differently-cased names both pass the pre-check, both pass the exact constraint, both insert) and closes it with a new functional index, `CREATE UNIQUE INDEX teams_name_unique_normalized ON teams (lower(btrim(name)))`.

I traced this against the actual requirement it serves, not just against the exploration notes: Priya's story (two teams signed up as "Platform" and "platform-team," undetected for weeks) is a *timing-independent* duplicate — it doesn't depend on both submissions racing each other, it depends on the normalized check working at all, ever. But the spec.md scenario "Concurrent submissions for normalized-duplicate names — only one succeeds" is a testable acceptance condition that an app-level pre-check literally cannot satisfy under concurrent load, regardless of how good the normalization logic is — only a database-level constraint can. So this isn't the design stage inventing new scope; it's the design stage noticing that the exploration's recommended mechanism (pre-check + existing exact constraint) doesn't actually satisfy the concurrent case the requirement implies once you write it as a testable scenario. That's design doing its job, not scope creep, and I'd have flagged it as a gap myself if design hadn't caught it first.

One thing worth a name-check rather than a blocker: `lower()` behavior on non-ASCII team names can vary by database collation/locale. I don't think this needs to hold up propose — team names in this application are short, facilitator-entered strings, not user-generated content at any real volume — but I'd want an engineer to confirm the target Postgres instance's default collation doesn't produce a surprising `lower()` result for anything outside ASCII before this ships, since a normalization bug in a *uniqueness* constraint fails in the least visible way possible (two teams that look distinct to Postgres but not to a human, which is exactly the failure mode this index exists to prevent in the first place).

---

## 3. Explore-stage resolved ACs against the spec deltas — I checked all six by name. All six made it in as concrete, testable requirements.

| Explore-stage resolved item | Spec delta | Testable? |
|---|---|---|
| Name-echo confirmation before submit | `session-creation/spec.md`, "New-team session lands directly in `lobby`..." — scenario "Submit control echoes the typed team name before firing" | Yes — asserts the literal typed string appears in the control's label |
| Landing acknowledgment | Same requirement — scenario "Landing view acknowledges team creation and topic assignment" | Yes, though see note below |
| `is_first_session` as a named, explicit AC | `session-creation/spec.md`'s main requirement text + design.md D3 | Yes — explicit, and explicitly not inherited from `POST /draft` |
| Empty-state copy invites new-team creation | `session-creation/spec.md`, standalone "Empty eligible-teams state invites new-team creation" requirement | Yes |
| Pre-submit back-out safety | `session-creation/spec.md`, "New-team form extends the existing session-creation screen state machine" — scenario "Backing out of the new-team form before submission is always safe" | Yes |
| Normalized uniqueness | `session-creation/spec.md`, standalone requirement with four scenarios including the concurrent case | Yes — see §2 above, this is the most rigorously specified requirement in the delta |

The one item I'd tighten, not block on: the landing-acknowledgment scenario says the view "displays an explicit acknowledgment that the team was created and that its default topics were assigned" without specifying required copy content. That's appropriately loose — Priya's request for read-only visibility into *which* topics were assigned was explicitly marked a recommendation, not a requirement, in exploration §9.6, and the spec correctly doesn't promote it to one. I'm noting this only so nobody reads the loose wording as an oversight later — it's a deliberate, already-settled scope line, and I agree with where it landed.

Also worth naming since it's a negative AC and those are easy to under-test: **team creation not inserting a `team_memberships` row** (D6, spec.md's "Team creation does not establish membership" requirement) is written as a testable scenario, and tasks.md 3.8/7.1 both call it out explicitly. Good — this is exactly the kind of requirement that gets silently violated by a well-meaning implementer reaching for `teams.created_by_user_id` as if it implied membership, and it's specified precisely enough that a test can catch it.

---

## 4. Task 8.1 (use-case doc rewrite, tracked as BA-owned follow-up): under-scoped relative to what both reviewers actually asked for at explore.

This is the one place where the proposal is *less* than what was agreed during explore, not just appropriately deferring something new.

My own `explore-review-ba.md` (§2, "Blocking Finding §9.6") said explicitly: *"this is a use-case rewrite, not just an implementation footnote"* and listed exactly what the rewrite needed to contain — Postconditions naming `lobby`, and a note cross-referencing the existing-team flow's addendum with the one-line reason this flow skips `draft`. My summary at the bottom of that review went further and called this out as needing to be resolved **"in the proposal's stated scope... as a use-case rewrite"** — i.e., I was asking for the actual rewritten text to land as part of getting to propose, the same way the existing-team change got its dated "Addendum (draft-landing decision)" appended as part of *that* change's own work, not tracked as a separate follow-up ticket after the fact.

What the proposal actually does (item 19 in `What Changes`, and tasks.md 8.1) is track this as a dependency to be filed later — 8.1 says "File/flag the BA-owned correction," which commits to raising it, not to writing it. That's a real narrowing of scope from what both reviews converged on, and I want it on record as a deliberate choice the team is making, not an oversight, since the proposal doesn't call out that it's diverging from the explore-stage resolution.

**I'm not blocking on this** — the precedent the proposal cites (existing-team change shipped its own use-case addendum as part of that change) actually argues for tightening 8.1, but the practical case for deferring is reasonable too: the person best positioned to write the addendum text quickly is me, and I can do it as a fast follow the moment `draft`-skip lands, without holding up the mechanism work. What I want instead of blocking: **8.1 should be rewritten so it isn't just "file/flag."** Concretely, 8.1 should either (a) include the actual Postconditions/Main-Flow-note text as an addendum ready to paste in, gated only on this change merging, or (b) if it stays a tracked follow-up, be given an explicit trigger ("write this addendum within the same PR wave that merges `inline-team-creation`, not on a separate future timeline") so it doesn't drift the way the seed-migration content it's structurally similar to almost did. Right now 8.1 has no trigger condition at all — "file/flag" with no deadline is exactly the kind of documentation debt that becomes permanent.

I'd also note: this is a smaller version of the same pattern as §1 above — a real requirement gets correctly identified, correctly scoped as *not blocking this change's merge*, and then the enforcement mechanism for actually following through is softer than the finding deserves. Neither is a reason to hold up propose. Both are reasons to tighten the follow-through before I'd call either one closed.

---

## Summary

**Not blocking, ready to move forward on:**
- Prerequisite-vs-in-scope call for the seed-data fix (§1) — correct.
- Normalized functional unique index (§2) — properly justified, correctly scoped to design stage, spec-aligned.
- All six explore-stage resolved ACs (§3) — present and testable in the spec deltas.

**Wants addressed before I'd sign off on propose being fully closed out:**
1. **Tighten tasks.md 1.1.** Name the prerequisite change explicitly (file it now, or say who files it and when), and add a real-data integration test (extending 4.3, not new scope) that would actually fail if this change ships ahead of its prerequisite — the current fixture-based test cannot, by design, ever catch that.
2. **Tighten tasks.md 8.1.** Either include the use-case addendum text now (my preference, and consistent with both reviewers' explore-stage position) or give the follow-up an explicit trigger so "file/flag" doesn't quietly become "never."

Neither of these is a redesign — both are making an already-correct decision enforceable the way the rest of this proposal already is.
