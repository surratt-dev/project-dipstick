# BA Review — Proposal, Issue #47: Participant Readiness View

**Reviewed by:** Marcus Delgado (Business Analyst)
**Reviewing:** `proposal.md`, cross-checked against `design.md`, `specs/*/spec.md`, `tasks.md`
**Grounded against:** `02 - Session Setup - Use Cases.md`, "View Participant Readiness Before Session Begins" (lines 374-429) and "Create Session for Existing Team" / "Create Session for a New Team"

## Overall assessment

This proposal, and the design/spec work that came with it, closed nearly everything I flagged at exploration stage (`explore-review-ba.md`): the facilitator-only decision is recorded with rationale, the hold-the-slot behavior is a stated decision rather than an inferred schema convenience, the per-row status ambiguity is resolved, disconnect/reconnect is now testable (`specs/participant-readiness-roster/spec.md` has real Given/When/Then scenarios), sort order is decided and justified, the `#33` boundary is named explicitly, and the registration gap is elevated to a first-class, do-first, security-reviewed blocking item in `tasks.md`. I verified the factual claims underpinning the registration-gap argument directly against the code (`packages/backend/src/routes/sessions.ts:72` does 422 on any non-`active` status; `facilitator-sessions.ts:1002` does 409 `action-items-review` on any non-`pre_session` status; both pages' `lobby`-branch rendering matches what `design.md` describes) — the grounding is accurate, not asserted.

Four things remain before I'd call this fully buildable without a "what did you mean" round-trip.

---

## 1. The "open question 1 / open question 2" cross-references don't match the source numbering — fix before this ships as the record of what was decided

`proposal.md` says "**Decision, resolving open question 1**" (line 7) and "**Decision, resolving open question 2 (sort order)**" (line 11). `design.md` mirrors this ("Resolves proposal.md's open question 1" / "open question 2"). But the actual numbered list these are presumably drawn from — `exploration-notes.md` §9 — has **six** open questions, and the numbers don't line up:

- Exploration's Q1 ("where does the roster render") and Q4 ("does `DraftSessionHost` get a WebSocket subscription") are two separate questions that proposal.md's "open question 1" collapses into one resolution.
- Exploration's Q5 is sort order — not Q2. Exploration's actual Q2 is the registration-gap mechanism, which the proposal does *not* resolve (it's explicitly deferred to design/security-review — correctly, but that makes "open question 2" a confusing label for the sort-order decision when Q2 in the source list means something else entirely).
- Q3 (REST endpoint shape) and Q6 (blocked-join visibility) are addressed elsewhere in the proposal but never referenced by number.

This isn't pedantry — it's exactly the traceability chain I care about. A reader six months from now who goes looking for "open question 2" in the exploration notes to understand why sort order was decided the way it was will land on the registration-gap question instead and conclude the wrong thing got resolved, or that something is missing. **Fix:** either drop the numeric references and let the inline restatement of the question stand on its own (the prose in both bullets is actually clear enough to not need the number), or renumber to match `exploration-notes.md` §9 exactly (Q1+Q4, and Q5) so the cross-document trail actually resolves.

---

## 2. An unreconciled tension between this use case's own AC and the Existing-Team flow's draft-landing decision

Source AC (line 410): "The participant readiness view is displayed **immediately after session creation**, before any participants join."

But per "Create Session for Existing Team," Addendum step 8/10 (the draft-landing decision, already implemented and referenced throughout `design.md`), a Facilitator creating a session for an *existing* team lands on the **draft control view** first — not the participant readiness view — and the roster only appears after they explicitly activate "Open the room." For the *new*-team flow (Addendum, draft-skip decision), the Facilitator does land in `lobby` immediately, so the AC holds there. For the existing-team flow, it does not: the roster is not visible immediately after session creation, only after a subsequent, separate, explicit action.

The proposal implements the correct behavior (roster gated on `currentSessionState === 'lobby'`, which is right — it should not render during `draft`), but it never states, in so many words, that this AC from the source use case is satisfied only conditionally (new-team flow: yes, immediately; existing-team flow: only after "Open the room," and the more specific, later-written draft-landing decision supersedes the older, more general AC wording here). Without that sentence, an implementer or a future auditor comparing this change against the source AC checklist could reasonably flag it as unmet for the existing-team path. **Suggested addition to proposal.md** (near the Capabilities or Impact section):

> Note on AC reconciliation: "View Participant Readiness Before Session Begins" AC1 ("displayed immediately after session creation") is satisfied as written for the new-team flow, which lands directly in `lobby`. For the existing-team flow, the roster begins at "Open the room," not at session creation, per that use case's own draft-landing decision — the more specific, later requirement, which takes precedence over the general AC wording here.

---

## 3. Missing acceptance criterion: the empty-roster prompt

Source Alternate Flow (lines 398-399): "No participants have joined yet: the application displays the participant readiness view in an **empty state with a prompt indicating no one has joined yet**. The join link is still displayed."

`specs/participant-readiness-roster/spec.md` has no requirement or scenario for the empty state. `tasks.md` 2.3 tests an "empty roster (no participants yet)" case, but only as a backend API contract test ("no participants yet returns an empty array," presumably) — there's no corresponding frontend requirement for what the Facilitator actually sees when the roster is empty. Right now an implementer could satisfy every written scenario by rendering nothing at all when the list is empty, which is not what the source use case asks for. The join-link-remains-visible half is already covered by prior work (commit `f60bbd8`), so this is narrowly about the roster's own empty-state copy. **Suggested addition to `specs/participant-readiness-roster/spec.md`:**

> ### Requirement: The roster shows an explicit empty-state prompt when no one has joined
> **WHEN** the Facilitator views the roster for a `lobby`-status session with zero participants
> **THEN** the roster area displays a prompt indicating no one has joined yet, rather than an empty or blank list

---

## 4. Missing negative-case scenario for the registration-gap fix (D2)

`specs/session-participation/spec.md`'s new requirement says registration is supported for `lobby` or `pre_session` status, "not only `active`" — correctly scoping it away from `draft`. But there's no scenario confirming registration is still *rejected* during `draft` status. Given that D2 is explicitly named in `design.md` as an authorization-boundary change getting its own dedicated security review, a negative test that pins down the boundary (not just describes it in prose) is worth having on the record now rather than left to whoever implements D2 to infer. This is the same category of gap I'd flag in any change that loosens a status gate: the positive cases are well covered, the boundary itself isn't. **Suggested addition:**

> #### Scenario: Registration is still rejected for a session in `draft` status
> - **WHEN** a user attempts to be registered as a session participant while the session is in `draft` status
> - **THEN** the registration is rejected
> - **AND** no `session_participants` row is created

---

## Items I'm satisfied with as-is

- **The registration-gap framing (`Why` section, D2, tasks.md §1)** — correctly elevated to the reason this change exists, not a side effect; sequenced first and blocking; security review made an explicit task, not a follow-up. This is exactly the rigor I asked for at exploration stage.
- **Facilitator-only visibility, hold-the-slot, and per-row-status decisions** — all now recorded as explicit decisions with stated rationale, not inferred from implementation convenience. Matches what I asked for in `explore-review-ba.md` §1.1-2 nearly verbatim.
- **Sort order (D4)** — legitimately re-decided from my exploration-stage suggestion (join-order) to alphabetical, on Priya Nair's facilitator-experience rationale, with the one hard invariant (no reorder on disconnect/reconnect) preserved either way. This is a facilitator-experience call, not a ritual-fidelity one, and I have no objection to it landing differently than my own lean.
- **`#33` boundary and Out-of-Scope restatements** (visual continuity, no removal control, no quorum counter) — all carried forward explicitly as named, reasoned exclusions rather than silent gaps.
- **`participant-readiness-roster` spec.md overall** — apart from the two additions above, this is genuinely buildable as written: every requirement has a Given/When/Then scenario an engineer can write a test against without guessing.
