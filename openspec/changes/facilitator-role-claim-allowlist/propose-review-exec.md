# Proposal Review: Executive Stakeholder (Rachel Okonkwo, VP Engineering)

**Change:** facilitator-role-claim-allowlist (#235) | **Verdict:** Approve. Two conditions sit outside this change.

## Strategic alignment

This is the blocker between us and success criterion 1 (three teams, six sessions each). Today no team can run a session without someone typing SQL, so we have no sessions, no trend data and nothing to show the CTO. Using the IdP as the single writer is the right policy call. With no in-app "make facilitator" button, nobody can ever quietly promote a manager into a session from inside the app. That protects trust, and trust is what the ritual depends on.

## Is scope proportional to value? Mostly yes.

- **Array claim and precedence: keep it.** It isn't gold-plating. Entra sends `roles` as an array. Without this handling, the first real deployment drops the role back to `engineer` and we're blocked again. That makes it part of the core fix.
- **Audit firing on any role change: keep it.** I've been asked to defend this data over the long term, and "who could run sessions last quarter" is a question I'll be asked. A demotion with no audit row recreates the spreadsheet gap. The change is small: one shared predicate, no new module. I accept the cost of a `senior_engineer` row on every sign-in. It's noise, but it's consistent with EM and admin.
- **No new audit module, no new UI, no migration.** That's good discipline, and I want it held through implementation.
- **The outranked-EM log line is fine.** It's one log call, and I don't want a code gate or alerting added on top of it.
- **Docs volume is the one place to trim.** The deployment.md role-claim section is warranted, since it's the first one we've had and operators will need it. Keep it to the five items listed plus the verbatim warning. Don't let it turn into an IdP tutorial. One Entra example is enough. Skip Okta and Keycloak walkthroughs until a customer asks for them.
- **43 tasks is heavy for a role allowlist.** But this is an authorization boundary, and the tests are where that weight belongs. I'm not asking for cuts. I am asking that nothing gets added during apply.

## Where my priorities differ

- **Precedence puts facilitator above EM (Decision 7).** My deepest concern is a manager in the room. Under this order, if one person is sent both roles, the no-manager rule depends entirely on their team-membership rows being accurate. The user decided this and I won't reopen it. But the verbatim docs warning is now load-bearing policy, not a nice-to-have. It must ship in this change and stay word for word.
- **Reporting-chain gap (Follow-up 2).** A manager given `facilitator` could run a session for a skip-level team. I'm named co-owner with Marcus and I accept that. **Condition:** file the issue before the first team goes live, so the decision is on record.

## Adoption

- **#237 as a release gate: strongly agree.** A facilitator with a home team is our normal champion profile. If they hold the role but can't find the session-creation page, a pilot team stalls in its first week. **Condition:** #237 must close before the first team goes live.
- `facilitator-001` working with no psql step makes onboarding demos low-friction. Good.

## Summary

Ship it as scoped. Trim the docs to what operators need. Don't let the task list grow. #237 and the reporting-chain issue gate the first-team launch, not this change.
