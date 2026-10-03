# Proposal Review: Executive Stakeholder

*Reviewer: Rachel Okonkwo, VP Engineering (Executive Sponsor)*
*Change: `reject-template-team-topic-writes` (#188)*
*Focus: strategic alignment with adoption goals; scope proportional to value*

## Verdict

**Approve, with three conditions** (see the end). The guard itself is the right size. Two things
need attention: the test plan is heavier than the risk calls for, and the follow-up that matters most
for adoption (F1) is still only a draft.

## Does this serve adoption?

Yes. It protects two things I care about directly.

1. **The first-session experience.** I've said adoption stalls if the first session isn't
   low-friction. Under the failure the proposal describes, `POST /api/v1/teams` returns 500 for
   everyone, and a facilitator could hit that while onboarding a new team. A new champion hitting a
   500 on day one is how a team decides not to come back. Preventing that is worth an engineering
   day.
2. **Comparable trend data.** One of my success criteria is reading a team's trend history and
   learning something I didn't know. That gets weaker if teams quietly start from different
   canonical topic sets. Without a shared baseline, cross-team comparison doesn't mean much. BRD
   §6.4 is right, and this change enforces it in code instead of relying on luck.

Choosing a structural guard over the accidental lock-based protection is the correct call. I don't
want to approve a fix whose protection depends on some side condition staying true.

## Is the scope proportional?

**The production change: yes.** It is one shared check in one file, replaces an existing helper, and
needs no migration, frontend change, or API-shape change for real teams. The proposal also keeps the
picker and session-lifecycle work out (F1). That boundary is reasonable: it keeps this review
surface small and stops #188 from growing into a "the template team isn't a real team" epic.

**The test plan is more than the risk needs.** `tasks.md` has about 25 test items for a guard that
fits in a dozen lines, including:

- refactoring `buildApp()` into `registerRoutes()` just to enable a structural route test (2.1–2.4);
- running every endpoint in both lock states, for both facilitator and admin variants (4.2, 4.3);
- full-column snapshots of the template before and after each request, plus a race analysis
  against other tests (4.4, 5.3);
- non-canonical id formats, such as no hyphens and braces (4.7).

The structural route test does earn its keep, since it is what stops a future TOPIC-008 from
skipping the guard, so keep it. The 4.4 snapshot/race machinery and 4.7 are where I'd cut. A
`404` plus "the lock helper wasn't called" plus one end-to-end team-creation regression (4.9) proves
the outcome I care about. I won't block on this. But if the test matrix makes this a multi-day
change, cut it back. I've watched internal tools slow down one gold-plated PR at a time.

**Anti-enumeration on a well-known ID.** The sentinel UUID is in the seed data and shows up in every
facilitator's picker today, so hiding that it is special doesn't buy much. It costs almost nothing
because it reuses the existing 404 path, so I have no objection. Just don't let it drive extra test
work.

**The audit row is fine.** It is an operational record, it never surfaces to facilitators, and it
raises no alert. It isn't a record of what engineers said or how they voted, so it doesn't touch my
surveillance concern. Keep it that way: no dashboards or alerts built on it under this change.

## Priority concern: F1 is the adoption fix, and it's still a draft

From the sponsor's seat, #188 deals with the *consequence* and F1 deals with the *cause*. Today a
facilitator setting up their first session sees an internal `__default_topics__` "team" in the
Session Creation picker. That is confusing on its own, before anything breaks. It is exactly the
kind of rough edge that makes a new champion doubt the tool. #188 makes the harm zero, but the
confusing entry point stays.

I agree F1 shouldn't be folded in here. I'm not willing to let it drift, though. It should be filed
before #188 merges and scheduled next in the Topic Management milestone, not left in the backlog.

## Conditions for approval

1. **F1 filed with an issue number and linked before merge** (task 7.2), at high priority and
   sequenced right after #188. F2 can be folded into F1. F3 can wait.
2. **Environment data check (task 6.1) has a named owner and is completed before merge.** The
   proposal says correctly that merging over existing drift makes the drift permanent. "Pending,
   human operator" isn't an owner. If prod has drifted, I want to know before we lock it in.
3. **Trim the test plan to what proves the outcome.** Keep the structural route test, the
   per-endpoint 404 in both lock states, the 403-preserved cases, and the team-creation regression.
   Treat the 4.4 snapshot/race work and 4.7 as optional, and drop them if they add more than a few
   hours.

No objections on data-access controls, manager boundaries, or data retention. This change doesn't
touch any of them.
