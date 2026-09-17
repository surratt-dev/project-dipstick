# BA Review: Proposal — Close the TEAM-005 EM-Promotion Gap (Issue #109)

**Reviewer:** Marcus Delgado, Business Analyst
**Reviewing:** `proposal.md`, `design.md`, `tasks.md`, `specs/team-content-access/spec.md`, `specs/role-assignment/spec.md`
**Verdict:** The code-facing side of this proposal is buildable — capabilities are specific, acceptance criteria are explicit Given/When/Then scenarios, and every ambiguity I raised at explore stage got a named decision or an honestly-flagged open question instead of a silent assumption. My blocking item from the exploration review (the stale AC1 in the Use Cases doc) is resolved by tasks.md §5 for the document I named. But checking §5 against the full set of requirements documents that actually describe TEAM-005 turned up a second, undiscovered instance of the *same* problem in a document neither Devon's notes nor my own prior review checked. That's a new blocking finding, not a sign-off on §5 as currently scoped.

---

## 1. My original blocking item (explore-review-ba.md §1) — RESOLVED, for the document I flagged

Tasks.md §5 does what I asked: it makes the three-passage correction to `requirements/use cases/01 - Identity and Access - Use Cases.md` (AC1, Out-of-Scope, and the sibling UC's Dependencies/Notes) an explicit, blocking task group, same priority as the code fix, owned by me, with my suggested AC1 rewrite carried forward as the starting draft (exploration-notes.md §8, cited correctly in task 5.1). Two things I specifically wanted are both present:

- **Task 5.1 correctly threads the actor-scope dependency.** It flags that the "regardless of actor" clause in my draft rewrite is provisional on task 1.1's resolution, exactly the caveat I raised in explore-review-ba.md §2 and that Devon independently caught in exploration-notes.md §8. Good — nobody is locking in language a still-open design decision might contradict.
- **Task 5.4 adds something I didn't ask for and want to call out as a good addition:** verifying all corrections against the *shipped implementation*, not just design intent, before the task group is marked complete. That closes a real gap — a doc that matches this proposal's stated intent but not what actually got built is only a smaller version of the same failure mode this whole change exists to fix. I'd apply that same verification step to the addition below.

No changes needed to 5.1-5.4 as scoped against the Use Cases doc.

---

## 2. BLOCKING (new) — The requirements-doc correction is scoped to the wrong breadth. `requirements/design/REST API Contract.md` documents the same pre-fix behavior and neither exploration nor my own prior review checked it.

Per this workspace's CLAUDE.md ("read the original source file, not only derived files"), I checked every requirements doc that references TEAM-005, not just the Use Cases narrative. `requirements/design/REST API Contract.md:407-464` — the actual API contract an implementing engineer opens to wire up the endpoint, arguably more load-bearing during implementation than the use-case narrative — has its own **TEAM-005** section with its own version of this problem, and it's worse than a stale assertion: it's silent in a way that reads as actively contradicting this proposal's default.

**Line 421** ("EM role assignment constraint"):
> An Engineering Manager may only assign the `participant` role via this endpoint. Assigning the `engineering_manager` role requires `application_admin` and is performed via TEAM-006, not this endpoint. A request from an EM to set `role = 'engineering_manager'` must be rejected with `403 Forbidden`.

**Line 457** (Error Responses table, 403 row):
> Not an `application_admin` or `engineering_manager` for this team; or EM attempting to assign `engineering_manager` role

Both passages restrict the promotion path **only for EM actors**. Neither says anything about an Application Admin doing the same thing via TEAM-005 — and by omission, read literally, this document currently documents Application-Admin-initiated promotion via TEAM-005 as *permitted*. That's not a neutral silence. It's a specific, on-the-record answer to design.md's Open Question 1 — one that leans toward Option B (admin exempt), which is the opposite of the default the spec delta bakes in absent resolution ("Absent that decision resolving otherwise, the restriction is unconditional on actor" — `specs/role-assignment/spec.md:8`).

I traced this back further. `requirements/design/REST API Contract - Validation Report.md:98-104` ("TEAM-005 / TEAM-006 authorization — RESOLVED (2026-03-15)") and its OQ-6 entry (`:188-190`) are the dated decision record that produced the line-421 wording. Both use the identical "EM may only assign participant" framing with no corresponding statement for admins. This is a **prior, dated, "RESOLVED" decision** that whoever settles Open Question 1 needs to see and explicitly address — either as a reason to lean Option B after all, or as a document that itself needs correcting because the 2026-03-15 decision never actually considered the admin-actor case and just wrote EM-only language by default. I'm not making that call — Devon and I both already said this is the security analyst's/design-signoff's call — but a decision-maker should not resolve Open Question 1 without knowing this record exists and currently says something specific.

**This is the same failure mode named in section 1 of my exploration review, in a document neither that review nor Devon's notes checked.** Leaving it uncorrected means an engineer who opens the API contract instead of the use-case doc — which I'd bet is more likely, not less, since it's the document with the actual request/response types — reads authorization language that's silent on exactly the case this fix is meant to close.

**What I need added to tasks.md §5**, same blocking priority as 5.1-5.4:

> - [ ] 5.5 BA updates `requirements/design/REST API Contract.md` TEAM-005 section: rewrite the "EM role assignment constraint" note (line 421) to state the unconditional promotion block, adjusted for the actor-scope resolution from task 1.1 (same dependency as 5.1 — do not lock in "EM-only" language a decision hasn't made yet). Add the blocked-promotion case to the Error Responses table (line 457) with the status code and copy finalized in task 1.4, following the redirective-not-punitive shape (Decision D).
> - [ ] 5.6 BA adds a dated addendum entry to `requirements/design/REST API Contract - Validation Report.md` (§3, alongside the existing 2026-03-15 "TEAM-005 / TEAM-006 authorization — RESOLVED" entry, and updating the OQ-6 row) correcting the authorization scope to reflect this change's resolution of Open Question 1. This document reads as a historical decision log elsewhere in the file (each entry is dated and left in place) — append a new dated entry rather than rewriting the 2026-03-15 entry in place, consistent with that convention, unless the BA judges the original entry needs a strikethrough/correction note for someone reading it in isolation.
> - [ ] 5.7 Fold into 5.4's verification step: confirm 5.5 and 5.6 against shipped behavior before task group 5 is marked complete, same as the Use Cases doc corrections.

I'd also ask whoever owns task 1.1 (the actor-scope open question) to read `REST API Contract.md:421` and `Validation Report.md:98-104` before finalizing — not as the deciding vote, but as a fact they should have in front of them.

---

## 3. Minor — the Use Cases doc's Alternate Flows section is missing the new blocked-promotion scenario

Task 5.1-5.3 correct AC1, Out-of-Scope, and the sibling UC's Dependencies/Notes — all narrative/criteria-level fixes. But UC "Assign a Role to a Team Member"'s **Alternate Flows** section (`...Use Cases.md:201-204`) lists three alternate flows today (invalid role, unauthorized actor, zero-Engineers warning) and none of them cover "authorized actor requests a now-blocked promotion." That's a genuinely new alternate flow this change creates — a request from an actor who *is* authorized to call the endpoint, with a *valid* role value, that still gets rejected for a reason distinct from the other three. A reader building the UI's error-handling from this use case alone (which is exactly the buildable-without-asking-me standard I hold myself to) wouldn't know this case exists from the Alternate Flows list.

Suggested addition to task 5.1's scope (or a new 5.1a):

> **New Alternate Flow — Blocked promotion attempt:** An otherwise-authorized actor (Application Admin or EM for this team) requests `role = 'engineering_manager'` for a team member whose current `membership_role = 'participant'`. The application rejects the request and displays a redirective message identifying TEAM-006 / the "Establish Manager Relationship" flow as the correct path, per Decision D. The team member's role is unchanged.

This also gives the Facilitator's requested copy review (design.md Open Question 4, `explore-review-facilitator.md:16`) a concrete home in the requirements doc, not just in the error-response spec scenario.

Not blocking — the AC1 rewrite alone is sufficient to prevent the doc from asserting false behavior — but I'd want it in before I call the use case genuinely complete, since "what does the user see when this happens" is precisely the kind of thing my Alternate Flows sections exist to answer.

---

## 4. Everything else I flagged at explore stage — checked against design.md/tasks.md/specs, resolved to my satisfaction

- **Admin-actor open question (explore-review-ba.md §2).** Not silently resolved — correctly carried as design.md Open Question 1 / tasks.md task 1.1, with an explicit named owner and a default stated in the spec delta itself (`role-assignment/spec.md:8`) so the requirement isn't blocked on the decision landing before implementation can start. Good. (See §2 above for the new wrinkle this raises.)
- **Blocked-attempt audit event (explore-review-ba.md §3).** Correctly carried as Open Question 3 / task 1.3, with task 3.4 contingent on its resolution and the spec text (`role-assignment/spec.md:86`) explicitly stating it's not settled by that requirement. Matches what I asked for.
- **"No admin-configurable exception" as a testable AC (explore-review-ba.md §4).** Decision C in design.md states this almost verbatim to my suggested language, including the verification method ("code review at implementation sign-off, not a runtime test") so QA doesn't go looking for a test that can't exist. Task 3.6 mirrors it. Resolved exactly as asked.
- **Self-targeting and admin-actor regression tests (explore-review-ba.md §5).** Both present — task 4.3 (self-targeting, unconditional) and task 4.4 (admin-actor, contingent on task 1.1, with an explicit fallback if the resolution goes the other way: "pin the resolution with a test" either way). Good — this is the right shape for a test list built around an still-open decision.

---

## Summary of asks before this proposal is ready to move to design sign-off

1. **(Blocking)** Widen tasks.md §5 to include `requirements/design/REST API Contract.md` (TEAM-005 section) and a dated addendum to `REST API Contract - Validation Report.md` — both currently document EM-only promotion restriction with no corresponding statement for Application Admin actors, which reads as a prior, dated decision favoring Option B on design.md's Open Question 1. Suggested tasks 5.5-5.7 above.
2. Flag the `REST API Contract.md` / `Validation Report.md` language explicitly to whoever resolves Open Question 1 (task 1.1) as a fact in front of them, not a deciding vote.
3. (Minor) Add a "Blocked promotion attempt" entry to UC "Assign a Role to a Team Member"'s Alternate Flows, alongside the AC1 rewrite already scoped in task 5.1.

Everything else — the code-side capability descriptions, the Given/When/Then scenarios in both spec deltas, and every ambiguity I raised during exploration — is specific enough to build from without coming back to ask what a sentence meant. Item 1 is the one thing standing between this and my sign-off.
