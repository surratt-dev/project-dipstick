# BA Review — WebSocket Specification Tasks (`tasks.md`)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `tasks.md`, cross-checked against `proposal.md` and `design.md`
**Date:** 2026-09-11

---

## Verdict up front

This is close to done. The skew-measurement gap (5.4/6.5) now gets the accountability treatment I asked for when this was still a naming paragraph — named owner, filed-issue requirement, hard archiving gate, worded almost line-for-line against the PREF-event pattern (5.3/6.4) it's modeled on. Task 5.3 itself still says what I need it to say. I checked the actual spec.md draft, not just tasks.md's description of it, and the content tasks.md is meant to protect — the five invariants, the PREF entries, the skew-gap callout — is already there, correctly worded, correctly citing task numbers back at itself.

One real gap: two design.md commitments — the audit-log pointer table (D3) and the access-controlled-monitoring requirement on `observed_latency` (D2) — are both already written into spec.md, but neither has a task in tasks.md protecting it the way task 3.3 explicitly protects the five invariants from being "folded into prose." That's an inconsistency in how thoroughly this task list guards its own content, not a missing deliverable. Detail below.

---

## 1. Does task 5.3 still say what I need it to say?

Yes. Re-reading it against what I flagged in `explore-review-ba.md` Section 3 — "silence on this point is what turns into a scope dispute later" — task 5.3 now has everything that section asked for:

- **Named owner** (me), not a diffuse "someone should file this."
- **No target date required** — correctly keeps this from turning into a scheduling fight over two PREF items nobody has resourced.
- **Explicit trigger condition**: "so each gap has an address rather than remaining an unowned, unnumbered 'no follow-up issue exists' statement" — this is exactly the failure mode I was naming.
- **Stated as an archiving condition**, attributed to Executive review (Rachel Okonkwo) — not just a nice-to-have.
- **A closing-the-loop step**: once filed, the issue number replaces "no follow-up issue currently exists" in both the spec's NOT IMPLEMENTED entries and this change's proposal.md/design.md.

I checked that last point against the actual text: `proposal.md` line 14 currently reads "each marked NOT IMPLEMENTED, each stating plainly that no follow-up issue currently exists" — that's the exact phrase 5.3 commits to overwriting once the issues exist. No drift between what 5.3 promises to fix and what's actually sitting in proposal.md today.

**No changes needed here.**

---

## 2. Is the 5.4/6.5 accountability treatment actually equivalent to 5.3/6.4, or does it fall short?

I compared these clause by clause rather than trusting the framing language ("same teeth," "same accountability structure").

| | 5.3 / 6.4 (PREF events, mine) | 5.4 / 6.5 (skew gap, Marcus Oyelaran's) |
|---|---|---|
| Named owner | Marcus Delgado (BA) | Marcus Oyelaran (FSE) |
| Filing requirement | File follow-up issue(s), "no target date required" | File a tracking issue "citing that change by name, not a generic 'measure performance' issue" |
| Attribution for why it's owned | Per Executive review (Rachel Okonkwo) | Per Security review (Tomás Ferreira) |
| Archiving gate | 6.4, explicit: "a filed intent to file the issue is not the same completion condition as the issue existing" | 6.5, explicit, same sentence structure: "a stated intent to file is not the same completion condition as the issue existing" |
| Post-filing update obligation | Update spec's NOT IMPLEMENTED entries **and** proposal.md/design.md | Update spec.md's callout **and** design.md's D4 invariant #2 |

The one asymmetry — 5.4 doesn't name proposal.md as something to update — is not a shortfall. I checked: proposal.md never mentions the skew gap, the Group 6 measurement work, or "no budget has ever been set" anywhere in its text. Only design.md (D4, invariant #2) and spec.md carry that language. 5.4 citing exactly those two documents and not a third that was never in play is correct scoping, not a gap.

I also checked spec.md itself (line 64) rather than trusting tasks.md's description of what spec.md will say: the skew-gap paragraph is already drafted there, already names Marcus Oyelaran as owner, already cites tasks.md 5.4/6.5 by number, and already carries the same "mitigating factor, not a substitute control" framing design.md uses. If 5.4 gets executed as written, there's nothing left dangling.

**Conclusion: 5.4/6.5 is genuinely equivalent to 5.3/6.4, not a lighter-weight cousin of it. No changes needed.**

---

## 3. Design.md commitments that don't show up as their own task

I read every Decision in design.md (D1–D6) against the task list looking for anything stated as a `SHALL`/"confirmed at implementation review" commitment with no corresponding checkbox. Most content-heavy decisions (D1's catalog, D4's five invariants, D5's four facilitator requirements) are covered either by the generic "finalize spec.md" task (3.1) plus a specific protective check (3.3 for the five invariants, 6.2 for D5's four items at sign-off). Two items don't get that second layer:

**3a. D3's audit-log pointer table has no protective task at all.** Design.md is explicit that this table exists because Tomás Ferreira asked for it on security review ("per Security review, Tomás Ferreira... the table above is that pointer, not a redefinition"). It's already written into spec.md (lines 132–138, the three `audit_log` rows). But nothing in tasks.md section 3 or section 6 checks that it's present, complete, or accurate — unlike the five ritual-integrity invariants, which get their own explicit task (3.3) precisely so they can't get "folded into prose" during finalization. The audit-log table is exactly the kind of three-row reference table that's easy to trim or lose in an editing pass with no one assigned to notice. I'd add one line to task 3.3 (or a new 3.4): confirm the three audit-log rows from D3 appear in spec.md as a standalone table, correctly attributed to `websocket-connection-reauthorization` and not redefined.

**3b. D2's access-controlled-monitoring requirement has no implementation-review check.** Design.md doesn't just state this in passing — it says the monitoring destination "SHALL route to a monitoring destination access-controlled at least as tightly as the application's other session-tagged operational logs... **confirmed at implementation review rather than assumed**." That's Tomás Ferreira's language, and "confirmed... rather than assumed" is about as direct as a reviewer can be about wanting a checkbox, not a promise. Task 2.5 ("wire the computed latency value into the existing system-monitoring surface... add a test confirming the value is emitted") tests that the value is emitted, not that the destination meets the access-control bar. The task 2 header's general process note (design-review + implementation-review gates apply to this code change like any other) probably catches this in practice, since Security Analyst sits in both gates — but it's implicit where the skew-gap and PREF-event items got explicit, named, gated treatment. Given this is a `SHALL` tied to a stated security concern about a metrics pipeline having broader read-access than application logs, I'd rather see it as its own line — something like: "2.7 Confirm at implementation review that the `observed_latency` monitoring destination is access-controlled at least as tightly as session-tagged audit logs (per Security review, Tomás Ferreira); do not accept 'uses the existing pipeline' as sufficient without that confirmation."

Neither of these is a missing deliverable — I checked the actual spec.md draft and both pieces of content are already there, correctly worded. This is about tasks.md's own internal consistency: it's meticulous about protecting some review-sourced commitments (the five invariants, the skew-gap accountability) with explicit, named tasks, and silent about two others from the same reviewers. If the standard is "review-sourced SHALL statements get a checkbox," these two should get one; if the standard is "generic gates cover it," that's a defensible call too, but it should be a stated call rather than an inconsistency that happens to fall on two Security-review items specifically.

---

## 4. Everything else I checked and found consistent

- **Task 5.1 vs. 5.3 sequencing**: 5.1 confirms the spec states "no follow-up issue currently exists" (the pre-filing state); 5.3 files the issue and updates that same text afterward. The order in the task list matches the actual chronology — no risk of the tasks being read out of sequence.
- **Task 6.3 (my own sign-off)**: the citation precisions it names — change-directory vs. capability-spec name mismatches, and `session-topic-lifecycle` as a second capability spec inside `session-lifecycle-transitions` — are the exact two precision gaps I flagged in `explore-review-ba.md` Section 1. I checked design.md's Context section: both are stated correctly there. Nothing for me to re-litigate at sign-off; 6.3 is a real check, not a formality.
- **Task 1 (non-goal cross-check)** matches the "named owner, checkbox, not a parenthetical aside" fix I asked for in `explore-review-ba.md` Section 5d, now generalized correctly to cover all five source specs, not just `session-topic-lifecycle`.
- **Open Question 1 (SLA-violation visibility)** is correctly carried as an open question in task 6.2, not silently resolved — matches design.md's Non-Goals and Open Questions sections.
- **Task 4 (Appendix D / todo.md correction)** matches D6's stated precedent exactly: one consolidated note, no new Validation Report cycle, review-not-sign-off by me.

---

## Summary of required changes

1. Add a task (extend 3.3 or add 3.4) confirming D3's audit-log pointer table appears in spec.md, correctly attributed and not redefined.
2. Add a task (in section 2, e.g. 2.7) confirming, at implementation review, that the `observed_latency` monitoring destination meets D2's access-control bar — not covered by task 2.5's emission test.

Neither blocks moving forward — the underlying spec content is already correct — but both should get the same explicit-checkbox treatment this tasks.md already gives every other review-sourced `SHALL` statement, for the same reason I've asked for it elsewhere: a gap that's merely implicit is the gap that turns into a Slack message to me (or to Tomás) after this archives.
