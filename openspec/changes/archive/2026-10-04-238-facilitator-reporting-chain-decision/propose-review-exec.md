# Proposal Review: Executive Stakeholder (Rachel Okonkwo, VP Engineering)

**Change:** 238-facilitator-reporting-chain-decision (#238) | **Verdict:** Approve. **I acknowledge
the decision for the 01c Status line,** with the three conditions below. None of them reopens the
decision log.

## Strategic alignment

This closes the condition I set on #235: decide the reporting-chain question and get it on record
before the first team goes live. The proposal does that, and it does it the right way.

- **No org-chart model: right call.** My deepest concern is that this app comes to look like
  management's reporting tool. An app that syncs the org chart and reasons about who manages whom
  looks exactly like that, both to engineers and to anyone asked to approve the integration. It
  would also be a months-long detour from success criterion 1 (three teams, six sessions each).
  Rejecting it protects adoption *and* trust.
- **Resolving the pair to `engineering_manager`: right direction.** When the data is ambiguous,
  the app should fail toward "no manager in the room", not toward "maybe a manager runs the room".
  The broken-EM-access finding means the old precedence also hurt the person's real job, so this
  rule costs managers nothing they should have.
- **The notice goes only to the person, and the audit records role names only.** Teammates and
  participants never see one person's misconfiguration, and nothing appears during a live session.
  That's the "signal without surveillance" line held correctly. Don't loosen it in implementation.

## Is scope proportional to value?

**This change: yes.** Documents only, four `requirements/` files, no spec delta for unbuilt
behaviour, no code. That's the cheapest way to make the decision durable, and the "someone will
'simplify' it back to plain precedence" risk is real. I've watched that happen to other rules.

**The follow-up (Appendix B): this is where I'm watching cost.** We now have two launch gates (#237
and #NNN) for a case that, after the IdP attestation, should affect nobody on day one. The decision
log makes the gate, the notice, the named stranded drafts and the audit binding, and I'm not
reopening any of them. But Appendix B already carries 11 minimum ACs, a notice with seven copy
rules, admin-specific copy, a simulator persona and a full-track pipeline. That's adequate for an
authorization boundary, and it's the ceiling. Every extra item now delays the first team directly.

The proposal itself is long (365 lines) for a documents-only change. I accept that, because the
appendices are paste-ready and save a later round trip. The 01c record itself should be something
a new EM or IdP admin can read in two minutes (see Recommendation 1).

## Adoption risk

The real adoption risk here isn't the rule. It's **calendar**. If #NNN is queued behind #237
instead of running alongside it, launch slips, and pilot champions lose momentum. That's how
rituals die before they start.

## Acknowledgment

**Acknowledged.** Proposed Status-line text for 01c:

> VP of Engineering acknowledgment: **Acknowledged 2026-10-04, Rachel Okonkwo**, subject to the
> conditions in `openspec/changes/238-facilitator-reporting-chain-decision/propose-review-exec.md`.

Conditions (to be tracked in #NNN, not in this change):

1. **Schedule #NNN to start the day #235 merges, in parallel with #237.** It must not add serial
   time to first-team launch. If it threatens the launch date, bring it to me before anyone trims
   ACs or proposes waiving the gate. The gate stays (row 8). I want to hear about the slip early.
2. **Freeze #NNN at Appendix B's minimum ACs.** No reassignment flow, no in-app "who is conflicted"
   view, no admin toggle and no alerting configuration added during apply. These are already
   non-goals, and they must stay non-goals under implementation pressure.
3. **Route Revisit-if trigger 2 to people.** "A person with line authority … is reported to have
   facilitated that team's session" must say who receives that report: Marcus Delgado (BA, owner)
   and me. A trigger with no recipient isn't a control. This is one clause in 01c's Revisit section.

## Recommendations (not conditions)

1. **Put a three-sentence summary at the top of 01c**, before the traceability header: what the
   rule is, why, and what it doesn't catch (skip-level managers and managers sent only
   `facilitator`). Most readers will stop there.
2. **Fold the Priya walk-through into #NNN's PR review** rather than keeping it as a separate
   pre-launch checkbox. Row 10 named two pre-launch items, the IdP attestation and the read-only
   check. A third gating step adds scheduling friction for little extra value. Her copy review
   (already in Appendix B scope) covers most of what the walk-through is for. If the team keeps it
   as a checkbox, timebox it to one session.
3. **I accept the residual gaps** (skip-level, managers sent only `facilitator`, stale EM
   memberships, informal authority) with the IdP attestation and the docs warning as the standing
   control. Those are org-hygiene problems. The app shouldn't pretend to solve them, and I'll own
   raising them with EMs at launch.

## Summary

Ship the record. I acknowledge the decision. Keep the follow-up running in parallel and frozen at
its minimum scope, give trigger 2 a recipient, and make 01c quick to read. #238 can close once
AC 1 (Appendix A.1 on #235) lands and this acknowledgment is on the Status line.
