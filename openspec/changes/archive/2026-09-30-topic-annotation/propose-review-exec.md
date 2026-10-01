# Proposal Review: topic-annotation (Executive Stakeholder)

**Reviewer:** Rachel Okonkwo, VP Engineering (Executive Sponsor)
**Artifact:** `openspec/changes/topic-annotation/proposal.md`
**Focus:** Strategic alignment with adoption goals; scope proportional to value
**Verdict:** **Approve with conditions.** The rationale is right, the guardrails are right, and the scope is mostly disciplined. My conditions are about sequencing and being honest about value, not about the design.

---

## 1. Strategic alignment

**The "Why" is the right reason, and it ties to my success criteria.** Interpretation drift across rotating facilitators directly threatens Success Criterion 1 ("measurable trend data"). If the team is effectively answering a slightly different question each quarter, the trend line I plan to review (Criterion 3) means less than it seems to. The annotation protects data longevity, which I care about. That is a real strategic link, not a nice-to-have dressed up as one.

**The trust posture matches my non-negotiables.** Specifically:
- Admins get `403`, recorded as BRD FR-8.7 instead of left as an inconsistency. Good. Session content stays the team's.
- The annotation text never enters the audit log. Audit records only `set`/`cleared` and length. That closes a quiet route by which leadership could read the team's words through an admin tool. Keep this.
- Helper text says *"Not for notes about people or how to vote."* That is exactly the framing I want. This field must never turn into a place where people are assessed.
- The snapshot-only read means history is never rewritten. That protects trust in past results.

No concerns here. If anything gets cut, it must not be these.

## 2. The value problem: zero user-visible value in the room until two other issues ship

The proposal is candid about this, and I appreciate that. But I want it stated at the level I would report it:

> After this ships, a facilitator can type a definition on the management screen. **No engineer will see it during a session**, and by the proposal's own admission sessions can't reach voting in production at all until #175 lands.

#175 ("session_topics is never populated... begin-voting cannot succeed for any session") is still **open**. From an adoption standpoint that is not a sibling gap. **It blocks a first team from completing a single session**, which means it blocks every one of my success criteria. #56 and #57 (the participant prompt UI and topic-advance UI) are also open.

So the strategic question isn't "is annotation worth building?" It is. The question is **"is it worth building before the path to a first completed session works?"** My answer: it is acceptable only if it is **not taking capacity away from #175/#56/#57**. Annotation also has a natural delay built in. The first-session lock means no team can show a definition in session 1, and drift only appears after facilitators have rotated a few times. That makes it **inherently a session-3-and-later feature**. There is no adoption cost to it landing after the live-session path.

**Condition C1:** The team lead confirms that #175 (and ideally #56/#57) is the next priority, and that this change does not delay it. If they compete for the same people, #175 goes first and this waits.

## 3. Scope proportionality

Overall the scope is **proportional**. It reuses the sibling cascade (`checkTeamExists`, the lock gate, `applyTimingFloor`, the existing facilitator-only check), adds one migration of nullable columns, and needs no new dependencies. The "management half only" cut is the right shape, and the user has settled it, so I won't relitigate it.

Items I examined for creep:

| Item | Assessment |
|---|---|
| Provenance columns + "Last edited {date} by {name}" | **Keep.** There's no version history, and overwrites can't be undone. Visible provenance is the cheap mitigation, and it supports team ownership. |
| `canEditAnnotations` flag | **Keep.** Small, and it prevents a UI that promises an action the server will `403`. |
| SESSION-005/012 payload wiring + required negative test, built against fixtures ahead of #175/#57 | **Borderline but acceptable.** This is speculative work against surfaces that don't run in production yet. It's justified only because it pins the snapshot-only rule (no history rewrite) before someone builds it wrong. Keep it small. If #175 or #57 reshape those payloads, expect some rework. |
| Snapshot hand-off requirement in `session-topic-lifecycle` | **Keep.** It's a spec sentence, not code, and it gives #175 a contract to meet. |
| Same-PR docs corrections (contract, access matrix, use case, FR-8.7) | **Keep.** It's cheaper now than as drift later. |
| Drafted session-display ACs for #56/#57/#62, H4 post-reveal recommendation | **Fine as hand-off notes.** Make sure they are *only* notes. No design work for #62 should happen inside this change. |
| Follow-ups (template-team write guard, session-history display, wrap-up capture prompt) | **Correctly deferred.** Don't let any of them grow back into this change. |

Overall: 45 tasks for a single free-text field is on the heavy side. Most of that is the sibling pattern's tests and cascade, not invented features, so I accept it. I'd push back if the count grows during design or implementation.

## 4. Adoption and onboarding notes

- **Capture happens after the session, on the management screen, not in the room.** That's the right call for now. But it means the feature only gets used if someone remembers to go and do it. A definition nobody writes protects nothing. **Condition C2:** Keep the "post-session capture prompt on a future wrap-up screen" follow-up as a filed issue, not just a bullet here. It's the piece that turns this from a field into a habit.
- **Issue #53 stays open, with its body corrected.** Good. I don't want a "done" status on the board for something no engineer can see yet. **Condition C3:** The corrected #53 body states plainly that annotations are not visible in sessions until #175 and #56/#57 ship, so status reporting up to the CTO stays accurate.
- The label "Our team's definition" is good. It names ownership clearly and avoids jargon.

## 5. Risks

1. **Shipping invisible value delays the first team.** Mitigated by C1.
2. **An unused field.** Mitigated by C2.
3. **The free-text field becomes an evaluative channel**, for example "Codebase Health = Bob's module." The helper text and plain-text rendering help. Facilitators should also hear the "not about people" framing in onboarding, not only in the UI. This doesn't block, but I'm noting it for whoever owns facilitator guidance.

## Conditions summary

- **C1:** Prioritization: #175 (and #56/#57) are not displaced by this change.
- **C2:** File the post-session capture prompt follow-up as a real issue.
- **C3:** The corrected #53 body states the "not visible in sessions yet" limitation plainly.

With those, I approve.
