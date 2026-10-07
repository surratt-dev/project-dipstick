# Propose Review: Executive Stakeholder

**Reviewer:** Rachel Okonkwo, VP Engineering (Executive Sponsor)
**Change:** `store-idp-role-set` (#245, expand step)
**Artifact reviewed:** `proposal.md` (with issue #245 for context)
**Focus:** Strategic alignment, adoption, scope proportional to value

## Verdict

**Approve with conditions.** The direction is right and it protects the thing I care about most: a manager must never be in the room, and the application should *know* who is a manager instead of inferring it from where admins sit in a precedence list. But this change delivers no user-visible value by itself. Its cost is about 29 tasks, a schema migration with a table lock, edits to about 14 test files, and five new follow-ups. I need the team to state where it sits relative to first-team launch, and to trim one piece of scope.

## What I like

1. **It is honest about value.** The proposal says plainly that facilitators refused today are still refused, and that nobody should tell a facilitator their problem is fixed. That is the right framing. Over-promising a fix to a champion and then having them hit the same refusal is how adoption dies quietly.
2. **No-manager participation stays structural.** The capability rules ("can facilitate = has `facilitator` and not `engineering_manager`"; "can participate = has neither manager nor admin") are declared non-toggleable and copied verbatim into F1. That is the guarantee I gave engineers. Keep it.
3. **Fail-closed backfill.** Under-recording roles never grants anything. Good.
4. **No surveillance surface added.** The new data is about *who holds which role*, not about what any engineer said or scored. Raw claim values are still never stored. It does not change what leadership can see about team health data.
5. **Expand/contract sequencing.** Splitting the change so no authorization decision moves in this step is a sensible way to lower risk on access control, which is the area I am least willing to see regress.

## Concerns

### C1. Launch sequencing is not stated (blocking for approval)

My standing ask is to get something usable to a first team quickly. This proposal does not say whether #245 gates first-team launch, and I should not have to infer it. #241 (which did gate launch) is closed. As far as I can tell from the proposal, nothing about a first team's experience changes whether this ships before or after launch.

**Condition:** Add one sentence to the proposal stating that #245 (and F1/F2) are **not** first-team launch gates, or, if someone believes they are, name the launch-blocking scenario. If it is not a gate, it should not displace any launch-path work in the milestone.

### C2. The real user pain is deferred to F1; make sure F1 is not orphaned

The people hurting today are facilitators who are also in the admin group. They are the champions I am counting on to run sessions. This change only lets an operator *diagnose* their refusal; the fix is F1. An expand step whose contract step never lands is pure cost: a second column to keep consistent forever.

**Condition:** F1 should be filed with a target milestone, not just a number. If F1 is not going to be scheduled soon, say so and justify spending this effort now.

### C3. `audit_log.actor_roles` is speculative scope (recommend trimming)

The proposal admits that in this step `actor_roles` duplicates metadata already on the same two rows, and that its value is "readiness for the contract step." That is building for a future we have not committed to. The `roles` and `previousRoles` metadata already make the manager + facilitator conflict auditable, and `users.roles` makes it queryable.

**Recommendation:** Defer `audit_log.actor_roles` to F1 or F2, when a check actually reads the role set and the actor's role set at decision time becomes meaningful. If the team believes it must land now (for example, to avoid a second migration lock on `audit_log`), state that reason in one line and I will accept it.

### C4. Follow-up sprawl

One issue now produces F1 through F5. F3 (multi-role local stub persona) and F5 (constraint on a role-history UI that does not exist yet) are reasonable notes, but they add tracking overhead to a project whose biggest risk is over-engineering. **Suggestion:** fold F3 into F1 and F5 into FU-3 as acceptance notes rather than filing separate issues.

### C5. Operational cost at launch time

A migration that takes an ACCESS EXCLUSIVE lock on `users` is fine, but "outside session hours recommended" should be a concrete line in the upgrade notes. That way an early-adopter team's session is never the one that hits a sign-in stall. The proposal already promises live sessions are not disturbed, and I accept that, provided the lock timeout behaviour is tested.

## Alignment with success criteria

| Success criterion | Effect of this change |
|---|---|
| 3+ teams complete 6+ sessions | Neutral now. Positive only once F1 lets admin-group facilitators run sessions. |
| Action items close a loop | Neutral. |
| I can find something in trend history I wouldn't have known | Neutral. |
| No engineer feels the data is evaluative | Mildly positive: manager status is now recorded, not just inferred, which strengthens the no-manager-in-the-room guarantee over time. |

## Summary for the team

Do it, but keep it small and keep it off the launch path. State the launch-gate status (C1), give F1 a milestone (C2), and drop or justify `audit_log.actor_roles` (C3). Everything else is sound, and the honesty about "no user-visible change" is exactly the tone I want.
