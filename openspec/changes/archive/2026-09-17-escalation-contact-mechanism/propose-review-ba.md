# BA Review — Proposal: Escalation Contact Mechanism (GitHub #15)

**Reviewed by:** Marcus Delgado (Business Analyst), 2026-09-16
**Source:** `proposal.md`, `design.md`, `tasks.md`, `specs/role-assignment/spec.md`, `specs/manager-team-association/spec.md`

I re-verified the code claims against the current tree (`MemberManagement.tsx`, `MemberManagement.test.tsx`, `teams.ts`, `account-resolver.ts`, `4_seed_data.sql`) rather than trusting the carried-forward exploration findings a second time. They hold up. FR-1.6a's text is quoted verbatim and correctly in both specs. This is a strong proposal — most of what I pushed for at exploration stage made it through. One new, concrete gap below needs to close before this is buildable as written.

---

## How the exploration-stage asks fared

| # | My ask | Outcome |
|---|---|---|
| 1 | Get the real Application Admin headcount, or state it's unknown and must be gathered | **Honored as a named blocking gate**, not dropped. `tasks.md` 1.1 and `design.md` Open Question #1 both mark it `[BLOCKING]` before implementation, correctly tied to Decision 3's format choice. This is the right compromise — the number genuinely isn't in this repo (I checked `requirements/` again; it isn't there either), and blocking implementation on it is stronger than what I originally asked for (block the proposal). Good. |
| 2 | Resolve zero-admin reachability against the schema/bootstrap code now | **Fully resolved.** `design.md` Context cites `account-resolver.ts:118-130` correctly — I verified the upsert rewrites `global_role` unconditionally on every login with no DB invariant guaranteeing an admin exists. Fallback copy is specified (Decision 4). Closed, not carried as a question. |
| 3 | Escalate the security reconfirmation to "resolve before proposal," not "carry as an open question" | **Partially honored.** It wasn't resolved before the proposal was written — it's still open, but it *was* escalated to a named `[BLOCKING]` pre-implementation gate item (`tasks.md` 1.2), not left as a soft "ask later" open question. Functionally this means nothing ships without it either way. I'll accept this, but flag it: neither `design.md` nor `tasks.md` says *who* on the team is responsible for pinging the security analyst or by when. A blocking task with no owner tends to sit. Suggest tasks.md 1.2 name an owner the way 1.3 names Priya Nair for copy review. |
| 4 | Add an explicit TEAM-005 stacked-case acceptance scenario (no permission AND no EM) | **Fully honored**, and well done — `specs/role-assignment/spec.md` scenario "TEAM-005 escalation falls back to Application Admin contact when no EM is associated" plus the zero-admin scenario directly beneath it cover this precisely, with an explicit "no attempt is made to reference Engineering Manager data" assertion. |
| 5 | State plainly that `mailto:` satisfies "email address" | **Fully honored.** `design.md` Context: "It's the more actionable rendering of the same mechanism, not a weaker substitute requiring 'equivalent mechanism' justification." Exactly the preemption I asked for. |
| 6 | Task list should specify what the rewritten task-4.3 assertion must check | **Fully honored and then some** — `tasks.md` 5.1 names the exact assertion shape (`mailto:` href or rendered identity, not the literal phrase), and 5.2–5.7 add six new named test cases covering every scenario in both delta specs. This is buildable directly from the task list. |

---

## New finding: the proposal assumes exactly one EM per team, but the data model doesn't guarantee that

This is the one gap I'd stop the proposal for. Every version of the TEAM-005 EM-fallback language — `proposal.md` ("reference that EM's existing on-page name/email"), `design.md` Decision 2 ("resolves to that EM's identity"), and `specs/role-assignment/spec.md` (scenario: "the associated Engineering Manager's name and email are shown as the contact mechanism") — is written in the singular, as if a team has at most one associated EM.

That's not what the code supports. I checked directly:

- `team_memberships_active_unique` (migration 7, referenced at `teams.ts:1236`) is a partial unique constraint on **`(user_id, team_id) WHERE removed_at IS NULL`** — unique per *user*-team pair, not per team. Nothing prevents two different users from each holding an active `engineering_manager` row for the same team.
- The existing UI already renders this as a **list**: `MemberManagement.tsx` does `{engineeringManagers.map((em) => (...))}` with a `<li key={em.userId}>` per manager (`:451` on, verified this session) — the component was built expecting zero-to-many EMs per team, not zero-or-one.
- `TeamMembersResponse.engineeringManagers` in `packages/shared/src/types/team.ts:73` is typed `TeamMember[]`, plural, consistent with the above.

So "the associated Engineering Manager" is not a well-defined thing to resolve to when a team has two or three. Whichever one gets rendered (first in array order? most recently associated? all of them?) is currently implementer's choice, not a spec decision — which is exactly the kind of ambiguity I don't want a task list to ship with. None of `exploration-notes.md`, `design.md`, or the delta specs mention this possibility at all; the multi-*admin* case got a fully worked-out resolution (Decision 3: comma-separated single line), but the parallel multi-*EM* case was never noticed.

**Suggested fix**, and I think it's a small one: extend Decision 2/3's existing multi-admin pattern to the EM branch rather than inventing something new — *"when more than one EM is associated with the team, the TEAM-005 escalation lists all of them, comma-separated, in the same single-inline-line format as the Application Admin fallback."* That's consistent with the rest of the design's rendering philosophy and should be a small diff to Decision 2's prose, one added sentence to the `role-assignment` spec's contact-resolution bullet, and one added scenario + one added test case (a `5.2a`, alongside the existing single-EM case). I don't think this needs new exploration — the resolution logic is a direct extension of a pattern the design already committed to for the admin side.

## Minor: task-4.3 line range doesn't cover the full block it names

`proposal.md`, `design.md`, and `tasks.md` (5.1) all cite the existing test block to rewrite as `MemberManagement.test.tsx` `:483-537`. I checked: the `describe("4.3: ...")` block actually runs `483-559` — four `it` blocks, not three. The range as written stops right before the fourth case ("does NOT show the TEAM-006 escalation when `canAssociateManagers` is true (admin path)"). Low risk since 5.6 separately asks for a TEAM-006-never-shows-EM test that covers similar ground, but an implementer skimming the cited range could plausibly leave that fourth case unexamined during the rewrite. One-line fix: update the citation to `:483-559` wherever it appears.

## Minor: proposal.md's open item #4 is stale relative to design.md

`proposal.md` Impact section, open item 4, still frames "whether TEAM-005 and TEAM-006 share one contact-resolution component" as an outstanding architect/design call. `design.md` Decision 2 already resolved this (separate resolution logic, shared rendering markup only) with a stated rationale. Not a blocker — proposals precede design in this workflow — but worth a pass to mark that item resolved-by-design rather than leaving it looking open to anyone who reads proposal.md on its own.

---

## Summary of requested changes before this moves to design sign-off / implementation

1. **Blocking:** Resolve the multi-EM-per-team ambiguity in `design.md` Decision 2, `specs/role-assignment/spec.md`, and `tasks.md` — extend the existing multi-admin comma-separated pattern to cover the multi-EM case, with an explicit scenario and test case.
2. Name an owner for the security-reconfirmation gate (`tasks.md` 1.2), not just a blocking checkbox.
3. Fix the task-4.3 test-block line citation to `:483-559` in all three files.
4. Mark `proposal.md` open item #4 as resolved-by-`design.md`-Decision-2, or remove it.

Everything else — the admin-count gate, the zero-admin resolution, the TEAM-005 stacked case, the `mailto:` clarification, and the test-rewrite specificity — is buildable as written. This is close.
