# Exploration Notes — "Facilitator Team Membership Constraint Violation" (Issue #46)

**Explored by:** Devon Calloway (Internal Champion / SME), in `opsx:explore` mode.
**Use case:** `requirements/use cases/02 - Session Setup - Use Cases.md` — "Facilitator Team Membership Constraint Violation"
**Issue as filed:** GitHub #46, "Enforce cross-team facilitator constraint on session creation (server-side + team-picker exclusion)"

---

## 0. Headline finding, up front

**This gap is already closed. Issue #46 describes a problem that no longer exists on `main`.**

I was asked to explore this as if it were open work: `POST /api/v1/teams/:teamId/sessions/draft` "currently checks only `global_role === 'facilitator'` — it does not check `team_memberships` for the target team," per the issue body and my task brief, citing `facilitator-sessions.ts:187-214`. That description is accurate for the code as it stood *before* PR #153. It is not accurate for the code on `main` today. PR #153 ("Implement session-creation flow: eligible-team picker and session creation for existing teams," merged today, 2026-09-23, as `f84dd51`) added the exact server-side membership check, the exact audit logging, and the exact eligible-teams exclusion that issue #46 is asking for — as part of closing issue #43, the "Create Session for Existing Team" use case.

I want to be precise about how I know this, because "trust me, it's fixed" is exactly the kind of unverified claim I'd reject from someone else.

## 1. What I checked, and what I found

**The code.** I read `packages/backend/src/routes/facilitator-sessions.ts` on `main` (HEAD `f84dd51abdcbbad1425a03e2c60cf75866b16fab`) top to bottom. The `POST /api/v1/teams/:teamId/sessions/draft` handler (lines 198–380) runs a combined query at the top:

```sql
SELECT u.global_role,
       (tm.id IS NOT NULL) AS is_member
FROM users u
LEFT JOIN team_memberships tm
      ON tm.user_id = u.id
     AND tm.team_id = $2
     AND tm.removed_at IS NULL
WHERE u.id = $1
```

and then, after confirming the caller is a facilitator and the team exists, checks `is_member`:

```
if (is_member) {
  // INSERT INTO audit_log ... "session.draft_denied_membership_conflict"
  // return 403, "A facilitator cannot create a session for a team they are a member of."
}
```

This is a hard block, server-side, re-read live on every request — not cached, not inferred from a session token, not trusted from whatever the eligible-teams picker showed a moment earlier. It runs whether the request comes through the UI or hits the endpoint directly, because it's the only code path into session creation.

**The eligible-teams endpoint.** `GET /api/v1/teams/eligible-for-session` (same file, near the bottom) excludes the caller's own teams with the inverse query — `teams` LEFT JOIN `team_memberships` WHERE the join is null — so the picker never shows a team the facilitator belongs to in the first place. This is the UI-level exclusion half of what issue #46 asks for.

**The tests.** `packages/backend/src/routes/__tests__/facilitator-sessions.test.ts`, describe block for `POST /api/v1/teams/:teamId/sessions/draft`, has a named test (`2.3/2.6/2.7`) asserting: a facilitator with active membership on the target team gets `403` with a message containing "member of" (distinguishable from the "not a facilitator" message), no session is created (`mockDbConnect` never called), and an `audit_log` row is written with operation `session.draft_denied_membership_conflict`. There's a companion test (`2.4`) confirming a *previously removed* membership does **not** block creation — matching the use case's own note that "different team" is about current membership, not historical.

**The spec.** `openspec/specs/session-creation/spec.md` — live documentation, already merged — has a requirement section titled "Facilitator-from-another-team enforcement at session creation" with four scenarios that map almost verbatim onto issue #46's stated concern, including the exact race-condition scenario ("membership acquired after the eligible-teams list was fetched is caught at submission") and the exact direct-API-bypass scenario.

**My own prior sign-off.** The change that shipped this, `session-creation-existing-team`, is archived at `openspec/changes/archive/2026-09-23-session-creation-existing-team/`. I wrote the original exploration notes for it (§3: "Finding: the existing draft-session endpoint does not enforce the exclusion rule at all") and I wrote its champion sign-off, which opens with: *"My exploration notes flagged that the facilitator-from-another-team rule was a hard, no-exceptions requirement on paper and completely unenforced at the one endpoint that creates sessions... That gap is closed, not patched around."* I already did this work, under issue #43, and already verified the fix.

## 2. Why the issue still reads like open work

Issue #46 and issue #43 were evidently filed as two separate tracking items for what turned out to be one inseparable control — the issue body itself says as much: *"Should land together with the eligible-teams-list endpoint... since both depend on the same membership check — the server-side rejection and the UI-level exclusion from the picker are both required."* Whoever scoped #43 read that correctly and folded both into one change (the PR #153 commit message explicitly frames the enforcement gap as in-scope, not deferred). But the PR's `Closes #43` never touched #46's own open/closed state, so #46 sat there, unclosed, describing code that had already changed underneath it. My task brief inherited that stale description — the line numbers it cites (`187-214`) are from before the fix; the same handler today runs to line ~380 and the membership check lives inside that expanded range.

This is worth naming as a small process observation, not just a technical one, because it's the kind of drift that erodes trust in the tracker itself if it happens more than once: an issue whose title and body describe a gap, closed by a PR that never references it, is indistinguishable — to anyone scanning open issues — from a gap that's still real. I'd rather flag it once, now, than have someone reasonably worried in six months about whether *this* open issue means the constraint quietly regressed.

## 3. Checking my own finding against the things I actually care about

I don't want to just declare victory because the tests are green — I want to check this against the constraint itself, not the implementation of it.

- **Is it structural, not configurable?** Yes. It's a `LEFT JOIN ... removed_at IS NULL` read on every request, inside the same handler that performs the insert. There's no settings row, no feature flag, no admin toggle anywhere near this path. Nothing about it can be "turned off" without editing this file's SQL directly — which is the bar I want for a rule like this.
- **Is it silent?** No, and this matters more than it might look. There are two separate things "silent" could mean here, and both are covered:
  - *Silent to the facilitator making the attempt* — no. The `403` names the rule ("A facilitator cannot create a session for a team they are a member of"), distinct from the generic "not a facilitator" message. Whoever hits this gets an answer, not a mystery.
  - *Silent to the org* — no. Every denial writes an `audit_log` row with the actor, their global role, their IP, and the team, in the same code path as the rejection. If someone tries this and gets blocked, there's a record, not just a dropped request.
- **Does the rejection message leak anything that would undermine trust?** I checked this specifically because it's the failure mode I was asked to watch for. It doesn't. The message states the rule by name and stops there — it doesn't explain *why* the rule exists, doesn't hint at a workaround, doesn't reveal anything about the target team's other members or state. And the picker-level exclusion doesn't require an explanation at all: a facilitator's own team simply isn't in the list, the same way any filtered-out option in any list requires no justification — they already know they're on that team. There's no scenario here where the application tells a facilitator *why* they can't see or select something in a way that could feel like a judgment about them. That's the trust concern I'd have flagged hardest, and it isn't present.
- **Does a stale picker state create a bypass window?** No — checked directly. The scenario ("Membership acquired after the eligible-teams list was fetched is caught at submission") is in the spec and the check re-reads `team_memberships` at request time, not at list-fetch time. A facilitator can't join a team via a join link and then race a stale picker into creating a session for it.

## 4. What, if anything, is left to do under #46

Nothing that requires new application code. What I'd actually recommend:

1. **Close #46** with a comment pointing at PR #153 / the archived `session-creation-existing-team` change, noting it was resolved as part of #43 rather than separately. Don't leave it open as a phantom tracking item.
2. **No new `openspec` change is warranted** for this issue as scoped. I'm creating this `cross-team-facilitator-constraint` change directory only to hold these exploration notes as the record of *why* — not because there's a proposal, design, or tasks list to write. I'd stop here rather than manufacture a proposal for work that's already shipped; writing one would imply there's a decision left to make, and there isn't.
3. **One narrow thing genuinely worth a fresh pair of eyes, but not from me and not blocking:** I'm the person who wrote both the original gap-finding and the fix's sign-off. That's a good chain of custody for continuity, but it's also exactly the kind of self-review Marcus or Priya should sanity-check independently before anyone treats "Devon says it's fixed" as sufficient — I'd want a second reviewer (Marcus, on the use-case/AC mapping; or whoever picks up #46) to independently confirm the spec scenarios in `session-creation/spec.md` actually match what's asked in the "Facilitator Team Membership Constraint Violation" use case's own acceptance criteria, line by line, rather than taking my word that they do. I believe they do (I checked above), but I'm the least independent verifier available for that specific claim.

## 5. The one thing I'd still want on record from the use case itself

Small, not blocking anything: the use case's Notes section says *"If the Facilitator is listed as a member of multiple teams, they are excluded from facilitating any of those teams."* The implemented check handles this correctly by construction — it's a per-`:teamId` query against `team_memberships`, not a "facilitator's single home team" assumption, so a facilitator with three team memberships is blocked from all three independently, with no special-casing needed. I checked the query shape specifically for this because "multiple team memberships" is exactly the kind of edge case that breaks an implementation that assumed one facilitator = one home team. It doesn't, here. Nothing further needed.

---

## Summary

Issue #46 is a duplicate of already-completed work, not a new gap. The facilitator-from-another-team constraint is enforced server-side, hard-blocked, audited on both denial and success, re-validated live against race conditions, and its rejection messaging names the rule without leaking anything that would undermine trust or suggest a workaround. The UI-level exclusion from the eligible-teams picker is also in place. I verified this against the code, the tests, the merged spec, and my own prior sign-off on the change that shipped it (`session-creation-existing-team`, archived 2026-09-23). My recommendation is to close #46 as resolved by PR #153 and not carry this forward as a new change.

## Addendum — scope decision after review (2026-09-23)

Both reviewers (Priya, facilitator lens; Marcus, BA lens) independently confirmed the finding above against primary sources. Marcus's independent AC review surfaced two narrow, non-blocking gaps that don't change the verdict but are worth closing out:

1. **Test-coverage gap.** The eligible-teams query's membership-exclusion predicate (`LEFT JOIN team_memberships ... WHERE tm.id IS NULL`) and the draft-session query's `removed_at IS NULL` predicate are both correct on direct code inspection, but neither has an explicit query-text assertion the way the adjacent `deactivated_at IS NULL` predicate does (test 3.7, in the same file). Add the same treatment for these two predicates.
2. **Unverified note.** The use case's Notes section states: "if a Facilitator later joins the facilitated team, the historical session is not invalidated." This is true by absence of any mechanism that touches `sessions` on a membership change, but nothing in `spec.md` or the test file addresses it explicitly. Add a test (or, if a test isn't a natural fit, a spec.md note) making this explicit.

**User decision:** rather than closing #46 with no PR, ship a small PR that adds these two test-coverage items, then close #46 referencing that PR. This changes the change's scope from "no code needed" to "small, additive test-only change" — still bounded, still no new capability, still no design decision (the two gaps and their fixes are already fully specified above). Carrying forward on the full track already chosen at kickoff, using this addendum as the scope for the Propose stage.
