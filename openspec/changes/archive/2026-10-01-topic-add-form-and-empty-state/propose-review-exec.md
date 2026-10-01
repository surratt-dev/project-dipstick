# Proposal Review: Executive Stakeholder

**Reviewer:** Rachel Okonkwo, VP Engineering (executive sponsor)
**Artifact:** `proposal.md` (topic-add-form-and-empty-state, re-scoped #55)
**Focus:** Strategic alignment with adoption goals; scope proportional to value
**Date:** 2026-10-01

## Verdict

**Approve with conditions.** The change is strategically correct and its guardrails are the right ones. My concerns are about **sequencing** and **weight**, not direction. The proposal is honest about both, which is why I'm approving it and not sending it back.

---

## What serves adoption

1. **Teams can make the ritual their own.** My first adoption risk is "no champion on the team". A champion keeps a practice alive when it fits *their* team, and the on-call rotation or the legacy system is exactly what fit means. Today, adding a team-specific topic takes a hand-crafted API call, so in practice nobody will do it. Closing that gap is real value, and it costs one inline form.
2. **Defaults stay the centre of gravity.** The "Custom" tag, the empty state pointing to Archived first, and the duplicate check that points to an archived topic all protect cross-team consistency. That is the common language I need to compare teams. The duplicate check also protects **trend continuity**: restoring keeps one trend line, recreating splits it. My success criteria depend on six-plus sessions of continuous trend data, so this is not polish. It protects the thing I'm paying for.
3. **The trust boundaries are untouched.** No-manager rule, facilitator-from-another-team rejection, engineers/EMs blocked at the route, and no "disabled teaser" button on locked teams. Nothing here widens who sees or changes team data. Good.
4. **Honest copy over aspirational copy.** The form promises nothing about sessions it can't deliver. The locked empty state tells people who can actually fix the problem, not a button or role that doesn't exist. Copy that over-promises is how a team decides the tool is unreliable, and from there it's a short step to the ritual dying.

## Concerns

### C1. Priority: #175 blocks every session, and this change cannot deliver value until #175 is fixed (strategic, not a blocker for this proposal)

The proposal lists #175 as a known deviation: `session_topics` is never populated. The issue title says what that means: **begin-voting cannot succeed for any session.** That isn't a footnote about custom topics. It means no team can complete a session today, so success criterion 1 (three teams with six sessions) is at zero and stays there until #175 lands.

This change makes topic *configuration* better for a product that can't yet *run*. The work is cheap and well-bounded, so I won't stop it. But I want the team lead to confirm explicitly that #175 is the next priority, or already in flight, and that this change isn't displacing it. **Condition:** don't describe this change as an adoption win in release notes or status updates until #175 is closed. Today a custom topic is something a facilitator can type in and nobody will ever vote on.

### C2. The process is heavy for the size of the feature (proportionality)

The user-facing delivery is one form, one tag, one count, and one empty state. The artifacts behind it run to roughly 1,400 lines: a 329-line delta spec, six handoff drafts, a five-row decision table, an eight-cell interlock matrix, and 32 tasks. A lot of that is justified:

- The interlocks are **inherited** complexity from #51–#54 (reorder drafts, definition edits). Adding a write path to a stateful screen has to respect them, and the proposal relaxes none. Fine.
- The quiet-refetch change to Remove and Restore is a small, honest fix ("don't let a refetch destroy what someone typed"). Fine.

Where I'd push back:

- **A five-row empty state for a state the UI can't reach.** I accept the locked/provisioning row because it is a real dead end with no in-app recovery. The other rows are reasonable, but this is the ceiling. Don't add illustrations, onboarding flows, or a "restore default set" action in this change. (The proposal already rules that out. Hold the line.)
- **Six handoffs.** Only two of them matter to me before ship: the in-session description defect (already gated by Marcus C1) and the zero-topic recovery path (a team with zero topics is a team that silently stops running sessions). The other four are hygiene. File them, but they don't need sponsor attention or ship gating.
- **The signal in the trend.** This screen now carries reorder, annotation, remove/restore, add, and their cross-locks. Each piece is justified on its own, but the screen is getting dense for a page a facilitator visits a few times a quarter. I'm not asking for changes. I'm asking that the next topic-management proposal start by asking whether the screen should get *simpler*.

### C3. Admins can't add topics until #176 is fixed (accepted)

Labelling the admin `canAddTopics: false` as "temporary, #176" in the spec text is the right call. It stops a defect from becoming policy at archive time. I'm fine with no in-app explanation. Admins are a handful of people and #176 is open. **Ask:** make sure #176 is triaged with a real target date, not left open indefinitely.

### C4. Pre-ship check (endorsed)

Priya's 15-minute hands-on check is the cheapest, highest-signal gate in the proposal. Keep it as a ship gate and not a task gate, exactly as written. If she finds the form or the duplicate warning confusing, that matters more to me than any test count.

## Scope creep check

| Item | In or out | My view |
|---|---|---|
| Add form, Custom tag, heading count | In | Core to #55's re-scoped intent |
| Duplicate check (exact match only) | In | Justified by trend continuity; exact-only is the right restraint |
| Empty-state decision table | In | Acceptable; this is the ceiling |
| Remove/Restore quiet refetch | In | Small, necessary enabler; not creep |
| `canAddTopics` API flag | In | Minimal, additive, non-breaking |
| Use-case and API-contract doc edits | In | Surgical; appropriate |
| Fuzzy matching, topic library, restore-defaults endpoint, vote-type editing | Out | Correct. Vote-type editing in particular would break trend history. Keep it out. |

No scope creep that I'd remove. The out-of-scope list is disciplined.

## Conditions for approval

1. Team lead confirms #175 is the next priority (or in flight) and isn't displaced by this work. No "adoption" framing for this change until #175 is closed.
2. The zero-topic recovery handoff is filed alongside the description defect, not left as a draft.
3. #176 gets a target, so "temporary" stays temporary.
4. Hold the empty-state and handoff scope where they are: no additions during implementation.
