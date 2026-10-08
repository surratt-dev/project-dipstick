# Champion sign-off: template-team-not-usable (#214)

*Devon Calloway, Internal Champion, 2026-10-07. I read the archived proposal, design, follow-ups,
the implementation reviews (architect and security), the sync review, and skimmed the working-tree
diff.*

## Verdict: clean sign-off. Open the PR.

## Did the change keep the ritual's intent?

Yes. It also restores some of it. The template was the one "team" that passed every ritual check
only because it had no people in it. Nobody could see that as a bypass, because a practice run on it
just looked like someone rehearsing. The change does not loosen any rule. It stops the template from
being treated as a team at all: it is refused at every create and redeem path, a database constraint
backs that up, and it is removed from the facilitator picker. The canonical defaults stay visible and
restorable for every real team (FR-8.6), and `POST /api/v1/teams` still copies them.

## Core constraints

- **No-manager rule (FR-1.4): kept, and stronger.** The template can no longer hold memberships, so
  TEAM-006 can no longer put an EM on a team that has no engineers. Nothing in the EM-cannot-vote
  logic was changed.
- **Simultaneous reveal: unaffected.** `reveal` only gains a guard placed before the session
  lookup, and it returns the route's existing missing-session `409`. The reveal mechanics are
  untouched.
- **Facilitator from another team (FR-2.2): kept, and stronger.** The template is refused before
  the cross-team check runs, so the rule is never "passed" by a team with no members. The cross-team
  check itself is unchanged. The facilitator-grant SQL was moved into a shared constant without
  changing what it allows (confirmed by the sync review).
- **Nothing became configurable.** The guard reads no configuration and no environment, and a source
  test enforces that. The template id is a bound constant, never a toggle. This is the structural,
  not preferential, enforcement I asked for.
- **Not a performance tool:** not touched.

The BRD gained one rationale line under FR-1.7, and no [HARD] requirement was weakened.

## Open human follow-ups: none is a reason not to open the PR

| Item | Gate | Note |
|---|---|---|
| **FU-1** (action-item routes still admit past template facilitators and owners) | **Before merge** | Architect B2. File the issue, link it to #214, and reference it in the PR. This is a real but narrow write path into frozen template content. It is not a ritual bypass: nobody can run, join or reveal a session through it. |
| **Task 10.2** (end-to-end check) | **Before merge** | Run it against a migrated stack and record (a)–(d) in the PR. |
| **H1** (pre-deploy data counts, maintenance window if any non-terminal template session exists) | **Before deploy** of migration 23 | I accept ownership pending Brian's confirmation. Nothing enforces this gate, so it must go on the release checklist. |
| **H2** (keep historical template sessions) | Before deploy | Keeping them, frozen, is the right default. History is part of what makes the ritual last. |
| **H3** (ask champions about a practice mode) | Non-blocking | Mine to do. If people want to rehearse, give them a real rehearsal mode, not a loophole. |

Before merge I would also take the architect's advisory A1 (close the two new structural-test flags)
and the security review's small should-fix items. They are a few lines each and keep the guard's
escape hatches closed.

-- Devon
