# Task Review — Solution Architect (Ingrid Sollenberger)

**Change:** `restrict-team-005-em-promotion`
**Stage:** 4 (Task Review)
**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Date:** 2026-09-16

## Scope of this review

I authored/revised design.md's Decisions (A–G) in the prior stage. This review checks
whether tasks.md sequences work in a way that respects the dependencies those decisions
imply — specifically whether any task assumes something not yet built, and whether the
ordering constraint I resolved in Decision G and the ordering constraint Security added to
Decision B are both accurately carried into the task text itself, not left as a citation
back to design.md.

I verified the concrete line references against the current code
(`packages/backend/src/routes/teams.ts`, `packages/backend/src/auth/team-content-access-helper.ts`)
rather than taking tasks.md's citations on faith.

## Verdict

**Approve with one required structural fix (4.7's placement) and one minor note (3.6's
section placement).** The dependency graph is sound everywhere else. Decision B's ordering
constraint is correctly and accurately reproduced in task 3.1's own text — this is not a
"trust design.md" citation, it restates the constraint and the exact insertion point, and
I confirmed both against the live code.

## What I checked

### 1. Decision B's ordering constraint — is it in the task text, or only cited?

Confirmed **in the task text itself**. Task 3.1 reads:

> "Per design.md Decision B's ordering note, this check must run after
> `checkAssignRolesAuthorization`'s 403 and after the no-op (`fromRole === newRole`)
> fast-path, but before the transaction opens (`client.connect()` / `BEGIN` / the
> team-level row lock) — insert it between the subject-membership lookup
> (`teams.ts:742-772`) and the transaction block (`teams.ts:789` onward)."

This is not just a pointer back to design.md — the constraint itself (after authz 403,
after no-op fast-path, before transaction) is restated in full, and the insertion point is
named concretely enough that an implementer doesn't need to re-derive it. I checked the
line numbers against `teams.ts` directly:

- `742-772`: subject-membership lookup (query + destructure of `fromRole`) — confirmed.
- `775`: `if (fromRole === newRole)` no-op fast path — confirmed, sits after the lookup.
- `789`: `const client = await db.connect();` — confirmed, transaction block begins here.

The gap between 775 and 789 (lines 776–788, currently just the no-op response body) is
exactly where task 3.1 says to insert the check, and it is architecturally the correct
gap: it's after the only two things that must happen first (authz, no-op filter) and
before the only thing that must never be reached by a rejected request (the team-level
`FOR UPDATE` lock, per Decision B's second binding reason — a rejected request must not
acquire the lock). No task assumes a different insertion point elsewhere in the document;
3.2, 3.4, and 3.6 all treat 3.1's location as settled. Good.

### 2. Does any task assume something not yet built?

Walked the dependency edges section by section:

- **§2 (read-side) and §3 (write-side)** touch different files and are independent of each
  other — no ordering constraint needed between them, and tasks.md doesn't impose one.
  Correct.
- **§4 tests** correctly depend on *both* §2 and §3 being complete. Task 4.1 in particular
  needs the read-side fix (to assert "no EM read grant results") and the write-side fix (to
  assert "no `team_memberships.role` change") simultaneously — it is sequenced after both
  sections, which is required, not incidental.
- **Task 2.3**'s code-comment instruction ("document the log-only reasoning alongside the
  existing Decision 6 no-cache note") references a comment that already exists in the file
  today (`team-content-access-helper.ts`, the "Decision 6 (no cache)" note at what is
  currently line ~154) — confirmed present. This task doesn't assume a comment some other
  task is supposed to add first.
- **Task 3.4**'s audit-row shape (`actor_user_id, actor_global_role, actor_ip, ...`)
  matches columns the existing `audit_log` INSERT at `teams.ts:849-865` already uses for
  `team.role_changed` — confirmed. No new column or migration is assumed.
- **§1 gating**: only 1.4 (facilitator sign-off on copy) remains open and it correctly
  gates only 3.3 and 5.5 — the two tasks that need exact wording — not 3.1/3.2/3.4/3.5/3.6,
  which can proceed independently. 1.6 and 1.7 are explicitly non-blocking and don't gate
  anything downstream. This is fine-grained enough that the one open decision doesn't stall
  the critical path.
- **§5 (docs)** task 5.4 requires verifying against "the shipped implementation," which
  correctly requires §3/§4 to be substantially done first — appropriately sequenced after,
  not a false dependency.
- **§6 (sign-off)** tasks each cite the specific upstream task they're confirming (6.1→1.1-
  1.3, 6.2→1.4/3.3, 6.3→3.5/3.6/§5) — no sign-off task is asked to confirm something that
  isn't a real, prior task.

No task in the document assumes unbuilt state. The one real defect is a **section-placement
mismatch**, not a missing or reversed dependency:

### 3. Task 4.7 — sequenced correctly in dependency terms, mis-sequenced in document structure

Task 4.7's own text is explicit that it is **not** a §4 activity in the way its neighbors
are: "as part of implementing tasks 3.1/3.2 (not discovered incidentally when CI goes
red)." That sentence is doing real work — it's overriding the section boundary by telling
the implementer these three test edits must land in the *same* change as 3.1/3.2, not
afterward. That's the right call substantively (retiring `teams.test.ts:336, 423, 460` in
a separate, later step would leave CI red between the two commits, which is exactly the
"discovered incidentally" failure mode the task is trying to prevent).

But the document's structure doesn't enforce what the text asks for. As written, 4.7 sits
five tasks after 3.6 in the numbering, inside a section titled "Tests — regression suite,"
alongside genuinely-new tests (4.1–4.6) that *do* correctly wait for §2/§3 to be complete.
A reader executing top-to-bottom, or an implementer who splits work by section number
(easy to do when 3.x and 4.x look like separate PRs), has no structural signal that 4.7 is
different in kind from 4.1–4.6 — only a parenthetical they have to notice and weigh against
the section heading.

**Recommendation:** move 4.7 into §3, immediately after 3.2 (as 3.7 or similar), since it
is a required part of the same edit that makes those three existing tests fail, not a
follow-on regression addition. If the team prefers to keep the existing numbering stable
at this stage, the minimum fix is to add an explicit note to 3.1/3.2 pointing forward
("see 4.7 — the three tests it retires must be updated in this same commit"), so the
cross-reference exists in both directions instead of only in 4.7's text. Either fix is
small; I'd rather see the task moved, since a forward-reference from 3.x is easy to miss
symmetrically to how the backward-reference in 4.7 is easy to miss today.

This is the one place where I'd block sign-off on task *sequencing* specifically — not
because the substance is wrong (it's correct and well-reasoned), but because the
document's structure and its own stated dependency disagree, and tasks.md is the artifact
whose job is to make execution order unambiguous without requiring the reader to catch a
parenthetical.

### 4. Minor note — task 3.6's section placement

Task 3.6 ("Verify no feature flag... gates the check... Verification method: code review
at sign-off, not a runtime test") states its own verification happens *at sign-off*, which
is what §6 is for. It's currently numbered under §3 (implementation) rather than §6. This
is much lower-stakes than 4.7 — task 6.3 already references 3.6 by number and treats it as
a completed precondition to the champion's confirmation, so the dependency is tracked
correctly even with the current placement. I'm flagging it only for consistency, not
blocking on it: either leave it (6.3's citation already carries the real dependency) or
renumber it to 6.x to match its own stated verification method. No action required before
implementation starts.

### 5. Decision G / task 1.5–1.6 sequencing (my own resolved decision)

Confirmed tasks.md correctly reflects Decision G's resolution: no new task was invented
for a trigger or check constraint (correctly, since I resolved that a transition-aware
trigger would break TEAM-006's own upsert and a CHECK constraint can't see prior state),
and task 1.6 is correctly scoped to build the detection-control query as reusable/re-
runnable rather than as a one-off — this is stated in both 1.5's resolution note and 1.6's
task text, consistently. No gap between what I decided and what the task asks the
implementer to build.

## Summary for the team

- Decision B's ordering constraint: **accurately reflected in task 3.1's text**, verified
  against live code line numbers. No change needed.
- Dependency graph across §1–§6: **sound**. Nothing assumes unbuilt state.
- Task 4.7: **move into §3** (or add an explicit forward-reference from 3.1/3.2) so the
  "must ship in the same change as 3.1/3.2" requirement is structural, not just a
  parenthetical inside a section that otherwise means "do this after §3."
- Task 3.6: optional renumber to §6 for consistency with its own stated verification
  timing; not blocking.
- Decision G (mine) is correctly and completely carried into tasks 1.5/1.6 with no
  invented follow-on work and no omitted one.
