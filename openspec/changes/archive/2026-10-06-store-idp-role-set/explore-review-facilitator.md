# Explore review: store the IdP role set (#245), Facilitator lens

**Reviewer:** Priya Nair (Facilitator, SME)
**Date:** 2026-10-06
**Reviewed:** `exploration-notes.md` (Devon Calloway), issue #245
**Lens:** Does this capture real user pain and workflow friction? Usability gaps? Will the tool stay in the background during sessions?

---

## Summary

This is plumbing, and the notes are honest about that. Nothing in the expand step should change what I or a participant see in a room, and that is the right outcome for this step. My main concern is the opposite one: the notes are about auditors, operators and the no-manager rule, and say almost nothing about the people who actually run into the role collapse today. Those people are facilitators. The deployment docs already tell operators that a facilitator who is also in the admin or manager group "cannot run a session". That is the friction I would hear about in a hallway, and this change is the first step towards fixing it. The proposal should say so, and should keep the expand step from adding any new friction of its own.

---

## Observations

**O1. The user-facing pain is real, but the notes describe it only from the auditor's side.**
Section 1 and Q8 frame the cost of the collapse as "the app forgets they manage anyone" and "the conflict is only in a log line". From where I sit, the cost is this: someone who is told they are a facilitator signs in, tries to set up a session for a team, and gets a generic refusal, because they are also in an admin group for some unrelated reason. They do not know why. I do not know why. Only an operator grepping logs for `discardedRoles` can find out (`docs/deployment.md`, group hygiene checklist). The proposal's "Why" should name this case. It is the reason this work matters to the people using the product, not just to the security review.

**O2. The expand step fixes diagnosis, not the experience, and that is fine if it is stated.**
After #245, an operator can answer "why can't Sam facilitate?" from the audit trail (`roles = {application_admin, facilitator}`) instead of a log search with shorter retention. That is a real improvement for whoever supports facilitators. But Sam still cannot facilitate until the contract step. I want the proposal to say plainly: "no user-visible change; facilitators who are refused today are still refused". Otherwise someone will read "we now store all roles" and tell a facilitator their problem is fixed.

**O3. "Disappears into the background" holds, with two checks worth writing down.**
I see nothing here that adds a prompt, a re-login, a notice or a delay to anyone in a session. Two things should be confirmed rather than assumed:
- **Migration 21 during a live session.** Adding a NOT NULL column with a backfill, plus CHECK constraints, on `users` takes a lock. Sign-in, the WebSocket re-authorization sweep and every live check read `users`. On a small table this is milliseconds, but the tasks should say "deploy outside session hours" or confirm the lock is short. A reveal that stalls because the sweep waited on a migration lock is exactly the "close enough" failure I worry about.
- **No forced re-sign-in.** The notes imply that `global_role` is unchanged by backfill, so nobody is bumped. Please state it as an acceptance condition: deploying #245 does not end, re-authorize-fail, or otherwise disturb any open session or lobby.

**O4. The backfill artefact (Q4) is an auditor problem, not a room problem, as long as it stays out of any UI.**
The "looks like a role change that never happened" row matters to someone reading audit history. If FU-3 (a UI showing roles) or a facilitator-handoff view ever surfaces role-change history, a burst of fake changes the week after deploy would confuse a facilitator picking up a team. Mark the backfill origin now (Q4's `previousRolesSource: "backfill"`). It is cheap here and expensive to reconstruct later.

**O5. The contract-step capability rules quietly change who can facilitate, and the notes do not say so.**
The issue's rule "can facilitate = has `facilitator` and not `engineering_manager`" means an admin + facilitator *can* facilitate after the contract step. Today they cannot (deployment checklist). I welcome that change. But #244's D11 bars admins from "live session events", and a facilitator needs live events to run a room. So either D11 has to be narrowed to *participation* when the contract step lands, or the new facilitate rule does not work in practice for admin + facilitator users. Risk 8 notes the participation side of this dependency. The facilitation side is missing.

**O6. Risk 3 has the right polarity, and it is the one I care about most.**
An EM + facilitator person must never open a room. Copying the capability rules verbatim into follow-ups (Risk 3) is right. I would add a test-level pin in the contract step: an EM + facilitator user cannot create a draft, and the refusal does not tell the room why (no "you are a manager" message visible to others).

**O7. Facilitator continuity is helped, a little.**
When I hand a team to another facilitator, the trend data and session history should tell them everything. Role data is not part of that and should not be. But the audit trail now shows when someone's facilitator role appeared or went away, which helps answer "why did this team's sessions stop for three weeks?" without a handoff conversation. This is a small side benefit worth a line, not a goal.

---

## Questions

1. **What does a refused facilitator see today, and does anything in #245 change that message?** The upgrade notes say a refused admin sees "the generic no-access state". Is there a path, in this change or a named follow-up, to a refusal a facilitator can act on ("ask your administrator to check your group membership") without leaking role or group names to the room?
2. **Does the migration lock `users` long enough to delay the WebSocket re-authorization sweep or a vote lock-in?** If unknown, can tasks include a timing check against a seeded table of realistic size?
3. **When the contract step lands, will D11 be narrowed so that an admin + facilitator can run a session?** If not, the facilitate rule in the issue promises something the product will not deliver.
4. **Will the #241 rebase (Q8) include the stranded-draft case from the facilitator's side?** A facilitator who gains `engineering_manager` mid-week may own a draft session for a team. The stored role set makes that detectable; who tells the facilitator, and when?
5. **Is the local multi-role persona (Q9) really deferrable?** For usability testing of the facilitator view, I would want to sign in as "facilitator who is also an admin" and see the refusal I would get. Deferring to the contract step is fine as long as it lands *before* that step's usability pass, not after.

---

## Suggested additions to the proposal

- **A "Who feels this" paragraph** naming the facilitator-in-admin-group and facilitator-in-manager-group cases, what they experience today, and that #245 does not change it (O1, O2).
- **Non-goal, explicit:** "No change to what any facilitator, participant or manager sees or can do. Facilitators refused today are still refused."
- **Acceptance condition:** deploying migration 21 does not disturb any open lobby or live session (no forced re-sign-in, no failed re-authorization, no reveal delay), and the migration's lock duration on `users` is measured or bounded (O3).
- **Backfill marker** in `previousRoles` metadata, so a future history view does not show phantom role changes (O4).
- **Follow-up note on D11:** the contract-step facilitate rule requires narrowing D11 from "live session events" to "session participation" for admin + facilitator users to benefit. Record it beside Risk 8 (O5).
- **Follow-up note on refusal messaging:** a facilitator-actionable refusal reason that names no roles or groups, scheduled with the contract step (Q1).
- **Usability-test hook:** the multi-role stub persona lands before the contract step's facilitator usability pass, so a real facilitator can try the refused and allowed paths (Q5).
- **docs/deployment.md (open question 7):** yes, point the conflict-finding checklist at the audit `roles` field as well as the log search. Operators supporting facilitators need the longer retention.
