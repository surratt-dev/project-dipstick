# Exploration Notes: Close the TEAM-005 EM-Promotion Gap (Issue #109)

**Author:** Devon Calloway, Internal Champion (Subject Matter Expert)
**Mode:** opsx:explore
**Grounded against:**
- `openspec/changes/archive/2026-07-07-establish-manager-team-relationship/threat-model.md` (Tomás Ferreira, Scenario 1 / finding 1.3)
- `.../threat-model-review-champion.md` (my own prior review — I'm picking up a thread I already started)
- `.../threat-model-review-architect.md` (Ingrid Sollenberger)
- `packages/backend/src/auth/team-content-access-helper.ts` (current code, as of this branch)
- `packages/backend/src/routes/teams.ts` (current code, as of this branch)
- `requirements/use cases/01 - Identity and Access - Use Cases.md` (UC: Assign a Role to a Team Member; UC: Establish a Manager/Team Relationship; UC: Enforce Access Control on Team Content)
- GitHub issue #109 (full text supplied)
- `explore-review-facilitator.md` (Priya Nair) and `explore-review-ba.md` (Marcus Delgado) — review feedback on the first draft of these notes

No `restrict-team-005-em-promotion` change exists yet (`openspec list` confirms). This is exploration ahead of a proposal, not implementation.

**Revision note:** this draft incorporates feedback from `explore-review-facilitator.md` (Priya Nair) and `explore-review-ba.md` (Marcus Delgado). Both reviews are folded into the sections they touch, cited inline, rather than appended separately — see §1, §3, §4, §5, §6, §7, §8 (new), and §9 (renumbered from §8) for what changed and why.

---

## 1. First: what ritual property is actually at stake here?

I want to be careful about this before anything else, because it's the exact failure mode I watch for — mistaking a governance bug for a ritual-integrity bug, or the reverse.

This is **not** one of the four things I consider load-bearing for the ritual itself:
- Simultaneous reveal — untouched.
- No-manager-participation — untouched. Nobody gets into a live session through this gap.
- Facilitator-from-another-team — untouched, not even adjacent.
- The vote-secrecy attribution boundary (Decision 5) — untouched. I confirmed this independently in my own threat-model review (`threat-model-review-champion.md:12`) and Tomás traced it in the threat model itself (`threat-model.md:145-150`, no `voter_id` ever selected regardless of which door produced the grant). I re-checked this claim against the current `team-content-access-helper.ts` and `teams.ts` — neither file touches vote data at all. This holds.

What **is** at stake is Decision 1: that establishing an Engineering Manager's access to a team's historical data is "a deliberate, audited action... not something a passing [non-admin] can perform without institutional accountability." That's not a session mechanic, it's a data-governance mechanic — but it's the same species of thing I care about everywhere else. The Health Check works because participants trust the boundaries around who can see what and how that access came to be. If I tell a participant "an Application Admin has to make a deliberate, on-the-record decision before your manager can see your team's historical trends," that sentence needs to be *true*, structurally, not true-in-the-common-case. Right now it isn't.

**Framing I'd give the team:** this is a Decision 1 governance/audit-trail bypass, not a ritual-integrity break. Same seriousness, different shelf. Worth saying explicitly in the proposal so nobody either panics about vote secrecy (wrong) or waves this off as a nice-to-have logging gap (also wrong).

The Facilitator's review (`explore-review-facilitator.md:12`) sharpened this further and I want to fold it in rather than just gesture at "data-governance mechanic" the way I did on first pass: unaudited EM read access is the data-governance equivalent of a peeked vote. It doesn't need to be discovered by anyone in the room to already have damaged the thing that makes a team willing to give an honest number next time — a team only says the hard thing because they believe the boundaries around who sees what, and how that access came to be, are what they were told. I'm adopting that framing as stated motivation for the proposal, not just an implication to be inferred from "data-governance mechanic." It's the same species of harm as a peeked vote — silent, retroactively corrosive to trust, and not dependent on anyone noticing.

---

## 2. The shape of the bug, in my own words

```
Two doors into "EM read access for Team A":

  TEAM-006 (the front door, Decision 1's sole authorized actor)
  ┌─────────────────────────────────────────────────────┐
  │ Application Admin only                               │
  │ Requires target.global_role == 'engineering_manager'  │  ← hard precondition, 409 if unmet
  │ Writes team_memberships.role = 'engineering_manager'  │
  │ Audit: team.manager_established (same transaction)    │
  │ Rate limited (issue #13 — separate gate, not this one)│
  └─────────────────────────────────────────────────────┘

  TEAM-005 (the side door, meant for a different purpose)
  ┌─────────────────────────────────────────────────────┐
  │ Any Application Admin OR any EM already legit on      │
  │   THIS team (checkAssignRolesAuthorization,            │
  │   teams.ts:30-64 — correctly team-scoped, verified)    │
  │ NO check on target's global_role at all (by design —   │
  │   teams.ts:380-386 comment says so explicitly)          │
  │ Writes team_memberships.role = 'engineering_manager'   │
  │   for an EXISTING participant on that team              │
  │ Audit: team.role_changed  (wrong label — an             │
  │   investigator searching for team.manager_established   │
  │   will never find this)                                 │
  │ No rate limit, no admin gate, no 409 precondition        │
  └─────────────────────────────────────────────────────┘
                        │
                        ▼
         both doors terminate at the same lock:
         evaluateTeamAccess (team-content-access-helper.ts:134-141)
         grants role: 'engineering_manager' from
         membership_role ALONE — global_role is read
         into the object (actorGlobalRole) but never
         compared. Decision 14's "independent, dual
         control" is documented in the comment above
         the code (lines 124-132) and not implemented
         by the code.
```

I read the comment block at `team-content-access-helper.ts:130-132` — "the membership role governs, not the global role" — stated as if it's the design. Ingrid's review calls this exactly right (`threat-model-review-architect.md:21`): "the documentation confidently describes behavior the code doesn't have." That's a sharper problem than a missing check. It means someone reading this file today, in good faith, comes away believing Decision 14 is honored. It isn't a TODO or a known gap with a tracking comment — it's asserted as correct, next to the vulnerable line.

**Contrast that stumbles me a little:** `checkAssignRolesAuthorization`, twenty lines away in a sibling file, gets the AND-logic right —
```ts
const authorized =
  global_role === "application_admin" ||
  (global_role === "engineering_manager" &&
    membership_role === "engineering_manager");
```
Same codebase, same decision, same class of question ("can this actor act as an EM on this team"), correct in one place and wrong in the other. That's not two reasonable people reading Decision 14 differently — Ingrid's review makes this point too (`threat-model-review-architect.md:19`) — it's an inconsistency that exposes the omission as a defect. I find that reassuring in one narrow sense: the *pattern* for the correct fix already exists in this codebase, we're not inventing new judgment about what "independent, dual" means.

---

## 3. Why I already know one obvious-looking fix isn't enough (I said this once already)

I flagged this in my prior threat-model review (`threat-model-review-champion.md:35-45`) and it's worth restating here because it's the crux of why the issue asks for *both* parts, not either:

`global_role` is a **global** attribute (Decision 2 — set once per user from the IdP claim, not per team). So the read-side fix alone —

> `evaluateTeamAccess` requires `membership_role === 'engineering_manager' AND global_role === 'engineering_manager'`

— closes the case where the target is an ordinary engineer being recruited into a fake EM slot. It does **not** close the case where the target is *already* a legitimately-established EM of a different team (Team B), and someone with EM standing on Team A uses TEAM-005 to flip that same person's Team-A membership role. Both halves of the AND now pass honestly — the person really does hold `global_role = 'engineering_manager'`, just not because anyone ever decided they should see Team A's data. TEAM-006 is still never called for Team A. No admin decision, no `team.manager_established` record, for that specific relationship.

Tomás's threat model reaches the identical conclusion independently (`threat-model.md:70-72`, added after my review — good, that's the follow-up-verification loop working as intended), and Ingrid's architecture review agrees while sharpening *why* fix (2) matters even once fix (1) is in place — not as a second security layer, but because a phantom `team_memberships` row with `role = 'engineering_manager'` that was never adjudicated by an admin is a **data-integrity and UX problem** independent of the read-side fix: it renders in the `engineeringManagers` array (Decision 12, `TeamMembersResponse`, `teams.ts:600-615`) and in the team admin view's labeled EM section (Decision 7) as if it were a real, admin-established relationship. A facilitator or another admin looking at that screen has no way to tell the difference. So even in a world where the read-side AND-check perfectly neutralizes the *access* consequence, the *administrative record* is still lying.

This isn't only a data-integrity abstraction for the architect — the Facilitator's review names the concrete consequence for her role specifically (`explore-review-facilitator.md:14`), and it maps almost word-for-word onto her persona's Success Criteria #3 (picking up a team cold, or handing one off, and having full context from the admin view and trend dashboard without a handoff conversation). A facilitator who inherits a team and sees a person listed in the `engineeringManagers` array has no signal that the relationship was never actually adjudicated by an admin — she'd build context on a false premise, silently. That's a continuity failure, not just a database-hygiene one, and I want the proposal to name it as a facilitator-facing consequence explicitly rather than leaving it implicit in "the administrative record is still lying."

That distinction — "the AND-check is the load-bearing backstop for security; the write-side restriction is what keeps the administrative truth honest" — is the frame I'd carry into the proposal. Neither one is the "real" fix with the other as a bonus. They're answering two different questions:
- Read-side: *can this state, however it arose, grant access it shouldn't?*
- Write-side: *should this state be constructible in the first place, by an actor other than the one Decision 1 names?*

---

## 4. What "structural, not preferential" means for this specific fix

This is where my usual worry attaches. My deepest concern across this whole project (see my persona notes, and I've said versions of this to the BA before) is that a protective constraint ships as a default that's technically overridable — a flag, a config toggle, an admin override "just in case" — and then six months later someone toggles it because a real deployment hit friction, and the toggle becomes the norm.

I don't see evidence anyone's proposing that here — the issue text is refreshingly blunt ("TEAM-005 should remain able to demote... but never promote... TEAM-006's exclusive function") — but I want it stated as a hard requirement in the proposal, not left implicit:

- **No admin-configurable exception.** There should be no code path, feature flag, or admin-only override that lets TEAM-005 originate an EM relationship under any circumstance. If a legitimate operational need for a faster path ever surfaces (bulk onboarding, say), that's a *new, explicitly reviewed* capability with its own authorization story — not a relaxation of this one. The BA's review (`explore-review-ba.md:71-77`) correctly pointed out that as written this is a design principle, not something a test can verify, and it needs to be stated as a testable acceptance criterion with a named verification method:

  > AC: No feature flag, environment variable, configuration value, or admin-only override exists that permits TEAM-005 to originate a `participant → engineering_manager` transition. The restriction is unconditional in code, not gated by configuration. **Verification method: code review at implementation sign-off, not a runtime test** — this is a "does this exist" check, not a "does this behave correctly" check, and QA shouldn't go looking for a test that can't exist for it.

- **The block applies to the `participant → engineering_manager` transition specifically**, not to the endpoint's existence. TEAM-005 keeps every other job it has: demoting an existing team-EM back to participant (transition `engineering_manager → participant`) stays exactly as it is today. I want to be precise about this in the proposal so nobody over-corrects and disables role management on TEAM-005 wholesale — that would break UC "Assign a Role to a Team Member" (`requirements/use cases/01 - Identity and Access - Use Cases.md:173-236`), which is a real, in-scope use case with its own acceptance criteria (AC1 explicitly names both directions of the role change as in scope for EMs-on-this-team). Only the promotion direction is the problem. **Update, after the BA's review:** AC1 as currently written doesn't just sit adjacent to this fix, it authorizes the exact transition the fix blocks, checked off as implemented — see the new §8 below, this needs a requirements-doc correction as a first-class task, not just careful phrasing in the proposal.
- **Self-targeting isn't special-cased and shouldn't be.** The issue's regression scenario uses a colluding second account, but the fix has to block the transition regardless of whether actor and target are the same person, different people, or people who happen to already be EMs elsewhere. The write-side restriction I'd want is unconditional on identity — it's about the *role transition being requested*, not about who's asking.
- **Open question, not resolved here: does "unconditional on identity" extend to Application-Admin actors, not just EM actors?** The BA's review (`explore-review-ba.md:42-54`) caught something I underspecified: every actor/target combination I listed above is an EM-actor scenario, but §2's diagram shows TEAM-005's authorization as "Any Application Admin OR any EM already legit on THIS team" — admins can call TEAM-005 too. If an admin uses TEAM-005 to flip a participant straight to EM, they have the *authority*, but the action skips TEAM-006's precondition check, never writes `team.manager_established`, and isn't covered by the TEAM-006 rate-limit gate (issue #13). By Decision 1's own logic — TEAM-006 is "the sole authorized actor," not "any admin acting through any door" — that's still the wrong door. My own reading leans toward blocking admins too, for the same reason the BA recommends it: it's the only option that guarantees `team.manager_established` is the audit record for *every* new EM relationship rather than most of them, and it's simpler to state and test than a rule that depends on actor role. But this changes what the write-side check has to inspect (transition + target state only, vs. transition + target state + actor role), and it's a real design fork, not an obvious reading — I'm not resolving it here. **This needs to be a named decision in design.md**, the same way the mismatched-state question in §5 is, not an inference left for whoever writes the check.

---

## 5. The open question I don't think is fully mine to answer, but want flagged

Issue #109's read-side requirement says a mismatched state (`membership_role = 'engineering_manager'`, `global_role != 'engineering_manager'`) should be treated as `participant` **or** rejected with a distinguishable 403 — explicitly leaving that choice open.

Once the write-side fix lands, this mismatched state should become *unreachable through normal operation* (TEAM-005 can no longer create it, TEAM-006 can't create it either since it enforces the global_role precondition up front at `teams.ts:1109-1126`). So in the steady state, the AND-check's "else" branch is a backstop for states nobody *currently* creates — which is exactly Decision 14's point (`threat-model-review-architect.md:15`, quoting design.md: "if a future change allows `global_role = 'engineering_manager'` to be set without going through TEAM-006... consolidating these checks creates a single point of failure with no backstop"). A backstop for a hypothetical future write path (a migration, a bulk-admin tool nobody's proposed yet) is still worth designing carefully, because by construction nobody will be thinking hard about *this* file when they write that future code.

Given that framing, my instinct — and I'd want to hear the security analyst's view since this is really their call, not mine — is to lean toward the pattern this codebase already uses elsewhere for "this shouldn't happen, but if it does, don't fail silently":
- OIDC claim rejection logs a warning rather than aborting auth (Decision 2, requirement 4) — precedent for "degrade gracefully but make noise."
- TEAM-006's rate limiter emits an early-warning audit event at 80% of threshold, separate from the hard-limit breach event — precedent for "distinguish an anomaly signal from a normal-path event so monitoring can find it."

Applying that shape here: treat the mismatched state as `role: 'participant'` (graceful, doesn't 403 a legitimate user out of content they should still see under their actual standing) **and** emit a distinguishable audit/log event when the mismatch is observed, so it doesn't silently rot into invisibility the way the current `team.role_changed`-instead-of-`team.manager_established` mislabeling already has. A silent `participant` downgrade with no signal recreates a smaller version of the same "audit trail doesn't know this happened" problem the issue is trying to close. I'd rather this be a design.md decision with the security analyst's sign-off than something I settle unilaterally in exploration — flagging it here so it isn't lost.

The Facilitator's review (`explore-review-facilitator.md:30`) independently landed on the same side of this — graceful degradation with a signal over a hard 403, on UX grounds (nobody gets silently locked out of content they have a legitimate claim to mid-workflow). Worth recording as a second, independent vote for that option if the security analyst is weighing it and UX friction ends up being a tiebreaker — it isn't her call to make, but it's a data point.

**A related but distinct open question, raised by the BA (`explore-review-ba.md:57-67`) and not covered by the paragraph above:** the mismatched-state signal covers *data already at rest* that doesn't match what it should. It doesn't cover the separate event of a TEAM-005 call that *attempts* the now-blocked `participant → engineering_manager` transition and gets rejected in real time. Right now nothing in these notes says whether a blocked promotion attempt itself should produce a distinguishable audit event (something like `team.role_change_denied`, separate from the caller-facing 403/422). The BA's point about why this matters is a good one and parallels the rate-limiter precedent I already cited above: a pattern of repeated blocked-promotion attempts against TEAM-005 is itself a meaningful signal — someone probing a gap that used to exist — and if it's invisible to audit, nobody will know the fix is being tested against in production. I'd fold this into the same security-analyst decision as the mismatched-state question, but it's a separate acceptance criterion, not automatically covered by whatever gets decided for the data-at-rest case — flagging both here as design.md items, not conflating them.

---

## 6. Regression test — restating the issue's own bar because it's exactly right

The issue specifies the test precisely and I don't want to soften it in translation:

> An existing Team-A EM uses TEAM-005 to set a Team-A participant's role to `engineering_manager`, where that participant already holds `global_role = 'engineering_manager'` from legitimate EM status on a different team — assert this is rejected and no EM read grant results.

I'd add one companion case worth pinning alongside it, because it's the one Ingrid specifically recommended (`threat-model-review-architect.md:71`) and it protects the *other* half of the fix from regressing independently:

> A user with `membership_role = 'engineering_manager'` and `global_role != 'engineering_manager'` (the mismatched state, however it might arise) must **not** receive `role: 'engineering_manager'` from `evaluateTeamAccess` — this pins the read-side AND-check on its own, so a future edit to this function's comment block (the exact failure mode that produced this bug the first time) can't silently reintroduce it without failing a test that has nothing to do with TEAM-005 at all.

Two tests, not one, because the two fixes protect against different future regressions — a TEAM-005-only test wouldn't catch someone reintroducing the read-side bug via an unrelated third write path.

The BA's review (`explore-review-ba.md:81-87`) flagged that §4 explicitly calls out self-targeting as a case that must not be special-cased, but the two tests above don't actually pin it — that's a real gap, not just thoroughness for its own sake, so I'm adding a third test:

> A user with EM standing on Team A uses TEAM-005 to set their *own* `membership_role` on a different team from `participant` to `engineering_manager` — rejected the same way as the two-account case, confirming actor-equals-target isn't an implicit exception.

And a fourth, contingent on how the open question in §4 (does the block cover Application-Admin actors) resolves — if it resolves to "yes, block admins too":

> An Application Admin attempts the same `participant → engineering_manager` transition via TEAM-005 (not TEAM-006) and is rejected — distinct from the existing "unauthorized actor" tests, because this actor is fully authorized to call TEAM-005, just not for this transition. This test only applies if the admin-actor question resolves to blocking; if it resolves the other way, it becomes a test that admins *can* still do this, which is the opposite assertion — either way, the resolution needs a pinned test, not just documentation.

---

## 7. What this change is explicitly not

Keeping my own boundary discipline here, same as I asked of the threat model:

- **Not** a re-litigation of Decision 5, 6, or 13. None of those are touched by this fix and the proposal shouldn't reopen them.
- **Not** the rate-limiting fix (issue #13 / task 3.10). Tomás's threat model treats these as sibling blockers on the same Phase 2 gate, and they are — but they're independent pieces of work with independent owners. I'd resist any temptation to bundle them into one change just because they share a deployment gate. Different root causes, different files, different verification.
- **Not** an occasion to add new EM capabilities, new admin UI, or new self-service flows. Pure containment of an existing gap back to Decision 1's original shape.
- **Not** a reason to weaken TEAM-005's legitimate demotion capability, discussed above.
- **Not** a change to any live-session UI, facilitator view, or session-flow code. The Facilitator's review confirms this independently (`explore-review-facilitator.md:20`) — nothing here touches reveal simultaneity, readiness-without-spoilers, outlier flagging, or pacing. Stating it by name here, rather than leaving it as something a future reader has to re-derive by confirming an absence.

---

## 8. Requirements documentation must be corrected as part of this change (blocking)

The BA's review (`explore-review-ba.md:15-38`) caught something I should have caught myself, and I want to be direct about that rather than bury it: `requirements/use cases/01 - Identity and Access - Use Cases.md` currently documents the *pre-fix* behavior as designed, accepted fact, in three places. That's not adjacent to this change, it's the exact bug this proposal is about to reproduce one layer up — §2 above is a whole section about how dangerous it is when a comment asserts correct behavior next to code that doesn't have it. A requirements doc telling the next engineer the old, wrong story is the same failure mode in a different file. I'm not going to be the reason that happens twice in one change.

The three places, as the BA identified them:

1. **AC1** (`...Use Cases.md:213`), currently checked off (`[x]`): "An Application Admin or an Engineering Manager for this specific team can change a team member's `membership_role` between `participant` (Engineer) and `engineering_manager` (Engineering Manager)." This doesn't just sit near the bug — it's an accepted, implemented acceptance criterion that authorizes the exact transition this fix is going to block.
2. **Out of Scope** on the same UC (`...:224`): "`TEAM-006`... not called as part of this change. TEAM-005 alone is sufficient for all `membership_role` writes." False after this fix — TEAM-005 stays sufficient for the demotion direction and for role changes that were never promotions; establishing a *new* EM relationship requires TEAM-006.
3. **Dependencies/Notes** on the sibling UC, "Establish a Manager/Team Relationship" (`...:295, 300`): "TEAM-005 changes the `team_memberships.role` of an existing member and does not check `global_role`." Also false after this fix — that's the exact behavior being closed.

I checked all three citations against the current file and they're accurate as the BA stated them.

**What I'm adopting:** an explicit task in tasks.md, at the same priority as the code fix, to update all three. The BA's suggested rewrite for AC1 is good and I'd carry it forward as a starting draft, reopened as unchecked (`[ ]`) pending the new criteria being verified:

> - [ ] AC1: An Application Admin or an Engineering Manager for this specific team can change a team member's `membership_role` from `engineering_manager` back to `participant` (demotion). Only an Application Admin, acting through TEAM-006 (`POST /api/v1/teams/:teamId/managers`), can establish a new `engineering_manager` relationship for a team member (promotion). TEAM-005 (`PATCH .../role`) rejects any request that would change `membership_role` from `participant` to `engineering_manager`, regardless of actor.

That last clause — "regardless of actor" — is provisional on how the open admin-actor question in §4 resolves; if design.md lands on Option B there instead, this sentence needs to change with it. I'm noting that dependency explicitly so whoever writes the requirements-delta task doesn't lock in language that the design decision hasn't made yet. Final wording of all three corrections is the BA's call, not mine — he owns the requirements documents and I'd expect him to want to review this before it's carried into design.md verbatim — but the *task existing*, at blocking priority, isn't optional.

---

## 9. Where I'd want this to land as a proposal

I think this is ready to crystallize — the threat model, both prior reviews, and the issue text are already in strong agreement on the *what*. What's still open and belongs in design.md rather than here:

1. The mismatched-state handling question in §5 (participant-downgrade-with-signal vs. hard 403) — needs the security analyst's call. The Facilitator's review (§5 above) independently favors the graceful-degradation option on UX grounds; worth weighing as a data point, not a vote.
2. Whether a blocked promotion attempt itself produces a distinguishable audit event (§5 above, raised by the BA) — a separate acceptance criterion from item 1, likely decided alongside it by the same security analyst, but not automatically covered by it.
3. **The error message and status code a blocked actor sees is no longer purely an open question — it's a requirement, only the exact wording and status code remain open.** Both the Facilitator's review (`explore-review-facilitator.md:16, 39`) and my own read agree the message must be redirective, not punitive: a good-faith actor clicking the only button the old UI gave them shouldn't be made to feel accused, and shouldn't be left without a path to the real flow. What's still open is the exact HTTP status/error code and copy — something in the shape of "Only an Application Admin can establish a new Engineering Manager relationship for this team — use Establish Manager Relationship" rather than a bare 403, consistent with this codebase's existing pattern (the TEAM-005 authorized-actor-but-wrong-team message at `teams.ts:734-737` and the TEAM-006 admin-only message at `teams.ts:973-976`). The Facilitator has asked to review the actual copy before it ships, the same way she'd review outlier-flagging copy — I'd honor that.
4. Whether the write-side block extends to Application-Admin actors on TEAM-005, not only EM actors (§4 above) — a named design.md decision, not an inference. I've stated a leaning (block admins too) but it isn't mine to settle.
5. Whether the write-side restriction belongs purely at the application layer or also wants a defense-in-depth expression closer to the data (a check constraint, a trigger) — this one's genuinely outside my lane; I'd route it to the Solution Architect rather than guess. I'll note only that this codebase already leans on DB-level constraints elsewhere for exactly this kind of "must be true regardless of which code path writes here" property (the partial unique constraint backing TEAM-006's idempotent upsert, `migrations/7_team_memberships_partial_constraint.sql`), so it wouldn't be a foreign pattern to extend here if the architect thinks it's warranted.
6. **Is there a known population of pre-existing phantom EM relationships in production that needs remediation or a backfill query?** Raised by the Facilitator (`explore-review-facilitator.md:26`) and worth recording explicitly rather than letting it fall through the crack between explore and design, which is exactly her concern. Everything in this exploration is forward-looking — it stops new bad grants. It says nothing about whether TEAM-005 has already been used this way in production, in which case some team's admin view is wrong *today*, independent of whether the fix ships. This is outside what I can answer from exploration; someone (I'd guess the Solution Architect or whoever owns production data access) needs to confirm whether an audit query against existing `team_memberships` rows is warranted, and that confirmation — even if the answer is "checked, no action needed" — should be a recorded decision, not a silent gap.
7. **Does the historical audit-log mislabeling (`team.role_changed` instead of `team.manager_established`, §2) get corrected retroactively, or only going forward from the fix?** Also raised by the Facilitator (`explore-review-facilitator.md:28`). If a team's history already contains a mislabeled event, a facilitator or admin reconstructing "when was this EM relationship actually established, and by whom" hits a record that's still wrong for anything before the fix ships. Whether that's acceptable as-is, or whether someone needs to identify which historical `team.role_changed` events were actually promotions, is a decision I don't think belongs to exploration either — flagging it so it's answered on purpose.

None of items 1 through 5 are reasons to delay a proposal — they're the kind of question a design doc exists to resolve with the right specialist's sign-off, not blockers to writing one. Items 6 and 7 are lower-stakes in the sense that they don't block the *fix* — but they're the kind of question that's easy to lose permanently if nobody writes it down before the proposal ships, so I'd want them carried forward as recorded open questions even if design.md's answer to both turns out to be "no action needed."
