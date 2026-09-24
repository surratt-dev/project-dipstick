# Business Analyst Review — Exploration Notes, Inline Team Creation (#44)

**Reviewed by:** Marcus Delgado (Business Analyst)
**Reviewing:** `openspec/changes/inline-team-creation/exploration-notes.md`
**Also read:** `requirements/use cases/02 - Session Setup - Use Cases.md` (both use cases), `requirements/use cases/08 - Topic Management - Use Cases.md` (both dependent use cases), `requirements/entities-and-relationships.md`, `packages/backend/migrations/4_seed_data.sql`, and the D6 decision + trade-off record in `openspec/changes/archive/2026-09-23-session-creation-existing-team/design.md`

---

## Overall

I verified both blocking findings directly against source documents rather than taking the exploration's word for it — they're both real, and both are more precisely characterized below than "needs a decision." The exploration is unusually well-grounded for a first pass; most of what follows is sharpening rather than correcting. I have one structural gap to add that neither the exploration nor (I'd guess, though I haven't read it) Priya's review names directly: **the new-team use case as currently written has no confirmation step before team creation at all**, which is a real requirements gap independent of how the draft/lobby question gets resolved.

---

## 1. Blocking Finding §3 — Twelve topics vs. six seeded topics: **the twelve-item list is canonical. The seed migration is the bug.**

I wrote both documents this finding is caught between, so I can resolve this one directly rather than leaving it for someone else to adjudicate.

**Recommendation: the requirements AC stands as written. `migrations/4_seed_data.sql` needs a follow-up migration before #44 reads from it.**

Reasoning:

- The twelve-item enumeration in `08 - Topic Management - Use Cases.md` AC #2 is not filler — it's the direct output of the facilitator interviews described in my persona background, and the "active development" vs. "entirety of the project" split for both code and tests is a distinction I specifically remember surfacing because facilitators kept asking it as two separate questions in the room, not one. That's deliberate elicitation, not padding, and it's exactly the kind of load-bearing detail I'd be the wrong person to let get quietly overwritten by a seed file.
- I checked `requirements/entities-and-relationships.md` directly: it lists exactly five **Topic Areas** — Production Code, Test Suite, Pipeline, Technology Stack, Pairing (line 36–41) — plus Project Trend makes six. The seed migration's six rows map one-to-one onto these five Topic Areas plus Trend, **not** onto the twelve-item AC list. That's a strong signal about what happened: whoever wrote migration 4 seeded one topic per Topic Area (a coarser, earlier-stage entity concept) instead of one topic per the twelve enumerated questions the AC later locked in. This reads as scaffolding that was never reconciled against the finished use case, not a deliberate simplification.
- The wording mismatch the exploration flagged (seed: *"How easy is it to add new features to the production code?"* vs. AC: *"How easy is it to add features to production code?"*) reinforces this — it's the kind of drift you get from two people writing similar-but-independent text at different times, not from one document intentionally paraphrasing the other.

**Concrete acceptance condition to carry into the proposal:** a new migration that replaces the six `is_default = true` rows under `00000000-0000-0000-0000-000000000001` with the twelve rows, using the AC's prompt text **verbatim** (not re-paraphrased) as the source of truth for `prompt`, and preserving `vote_type` exactly as parenthetically specified per topic (Finger/Roman/Modified Roman). I'd add one more AC the exploration didn't name: **a test that asserts the seeded default topic set's prompts match the twelve AC strings verbatim**, so this specific drift can't silently recur the next time someone touches migration 4.

**Scope call:** this fix is a prerequisite for #44, not part of it. #44 depends on the default topic set being correct; it doesn't own defining what "correct" means (Topic Management does). I'd recommend it ship as its own small change ahead of #44's implementation — consistent with this codebase's established pattern of shipping enforcement/data fixes as separately-scoped, independently deployable units (see the existing-team change's `POST /draft` membership-check fix, which shipped as its own deployable step ahead of the picker UI).

---

## 2. Blocking Finding §9.6 — Draft vs. lobby landing: **skip `draft`, but the use case needs a rewrite, not a footnote.**

I confirmed the textual conflict the exploration describes: `02 - Session Setup - Use Cases.md`'s "Create Session for a New Team" Postconditions say the session lands in a "waiting for participants" state and Main Flow step 10 goes straight to the session room — both written before the `draft` status existed (the existing-team use case only gained its draft/Open-the-room addendum as a dated, explicitly-labeled "Addendum (draft-landing decision)" appended after the original main flow, which the new-team use case never received). So the exploration is right that neither document actually answers this question as currently written — it's silent by omission, not by design.

**Recommendation: land directly in `lobby`, skipping `draft`.** I read the D6 rationale in the existing-team change's design doc directly: the draft gate exists to give the facilitator "team context (name, last session date if one exists)" to review before an irreversible action, deliberately excluding any trend/history dashboard. For a brand-new team, `last session date` doesn't exist — there is categorically nothing in that review surface to show. A gate that always renders empty isn't a smaller version of the review window, it's friction with the review window's purpose already stripped out. This also matches my own Success Criteria #2 — a first-time facilitator should be able to run a complete session including the reveal, outlier flagging, and action item capture without consulting documentation; an empty confirmation screen between "I typed a team name" and "the room I'm now in" doesn't help someone get there and might read as a step they did wrong.

**But this is a use-case rewrite, not just an implementation footnote.** I'd want the proposal to update `02 - Session Setup - Use Cases.md`'s "Create Session for a New Team" explicitly:
- Postconditions: change "waiting for participants" to name the actual target status (`lobby`) so this document and the shipped state model use the same vocabulary going forward — the same kind of drift as §3, just smaller, and just as avoidable if it's named now.
- Add a note cross-referencing the existing-team flow's draft/lobby split and stating explicitly that this flow intentionally does not use `draft`, with the one-line reason (no prior-session context to review), so a future reader doesn't independently "discover" this as an inconsistency and file it as a bug.

**The gap the exploration didn't name: there is no confirmation step before team creation at all, in either draft-or-lobby version.** Look at the Main Flow as written: step 4 (enter name) flows straight into step 5 (validate uniqueness) and step 6 (create team) — there's no analog to the existing-team flow's step 4, "the application displays a confirmation screen showing the selected team name and the Facilitator's name." The existing-team flow reviews the target *before* committing (the confirm screen) *and* after (the draft control view). If this flow drops the after-commit review (my recommendation above) *and* never had a before-commit review to begin with, a facilitator can create a permanently-named team from a single keystroke-to-submit action with zero review of what they typed. I searched for a team-rename use case and found none — team names appear to be immutable once created, which makes this the one moment a typo becomes permanent.

**Concrete acceptance condition to add:** the team-name entry form must show the facilitator what they're about to commit to before the request fires — at minimum, the typed name echoed back at the point of submission (e.g., a submit control reading "Create team '<name>' and start session," not a bare "Submit"). This doesn't require a `draft` status or an extra screen — it can be satisfied inline on the existing form. I'd write it as its own AC on the "Create Session for a New Team" use case rather than leaving it to be inferred from "the exploration leaned toward lobby."

---

## 3. §6 — Team-name uniqueness: exact vs. normalized match. **Recommendation: normalized (case- and whitespace-insensitive).**

The exploration correctly identifies this as a product decision it's not positioned to make. I'll make it: the use case's own Alternate Flow only says "team name already exists" without defining equality, which is a real gap, not a stylistic one — "already in use" is an AC-testable phrase and right now two different implementations (exact match vs. normalized) would both satisfy the AC as written. Given there's no admin screen anywhere in these use cases to merge or reconcile near-duplicate teams after the fact (I checked — topic management, session setup, and the entity model have no such capability), an exact-match-only check creates a class of data-integrity problem this application has no way to clean up later. Recommend normalized comparison (trim + case-fold) and I'd add it as an explicit AC: *"Team name uniqueness is evaluated case-insensitively and after trimming leading/trailing whitespace; 'Platform Team' and 'platform team' are treated as a collision."*

## 4. §5 — Empty-state copy. **Agree with the exploration; needs to be a named AC, not left as a note.**

The Preconditions of "Create Session for a New Team" explicitly carve out "a newly granted Facilitator who hasn't yet been added to any team" as a supported case — that's precisely the person who will see the empty eligible-teams state with the new "create a new team" affordance for the first time. I'd add this as its own acceptance criterion on the *existing-team* use case (since that's where the empty-state copy lives): *"When the eligible-teams list is empty, the displayed message directs the Facilitator to the 'create a new team' option rather than stating only that no teams are available."* Leaving this as implementation-detail prose risks it landing as a one-line copy change nobody traces back to a requirement.

## 5. §7 — "Locked" as a derived state, not a stored column. **Confirmed: this matches original intent.**

I can confirm directly (I wrote this use case): "marked as locked" in "Assign Default Topic Set to New Team" was always meant to describe the *effect* of having no completed session, consumed by the separate "Enforce Topic Customization Lock for First Session" use case, which independently derives its check from session-completion history ("The Application checks whether the team has at least one completed session on record"). There was never an intent for a stored per-team lock boolean. This resolves the exploration's open question 5 — no requirements change needed, just confirmation for whoever implements, which I'd add as a one-line note in the proposal so it isn't re-litigated.

## 6. §4 — `is_first_session`. Correct catch; needs to be named as its own AC, not inherited from reuse.

This flag isn't mentioned by name in either use case document — it's downstream implementation vocabulary for something the use cases *do* require: the Topic Management dependency chain assumes a team's "first session" is unambiguous and gates both the customization lock and the onboarding copy on it. I agree with the exploration that this needs to be a named, explicit acceptance criterion on "Create Session for a New Team" rather than something implicitly inherited by whichever code path an implementer reuses. Suggested AC text: *"The session created for a new team is recorded as that team's first session, and this determination does not depend on reusing logic written for the existing-team flow."*

## 7. Not addressed by the exploration, worth naming: the "member vs. participant" open question already flagged in the use case's own Notes.

`02 - Session Setup - Use Cases.md`'s Notes on this use case flag as unresolved: "What makes someone a 'member' of the new team vs. just a participant in one session is an open question that may affect how team membership is assigned at join time." Out of scope for #44's own AC (membership assignment happens at join time, a different use case), but I'd want it named explicitly as a **carried-forward dependency risk** in the proposal's Non-Goals, the same way the exploration already flags the `session_topics` population gap in §7 — not because #44 needs to resolve it, but so it doesn't get silently assumed as "already handled" by whoever picks up the join-link flow next.

---

## Summary — recommendations for propose stage

1. **§3 (blocking):** The twelve-topic AC is canonical. Ship a follow-up migration correcting `4_seed_data.sql` to the twelve topics with AC-verbatim prompt text, as a prerequisite change ahead of #44, with a regression test asserting the seed matches the AC strings exactly.
2. **§9.6 (blocking):** Skip `draft`, land in `lobby` — but rewrite "Create Session for a New Team"'s Postconditions/Main Flow to say so explicitly (don't leave the "waiting for participants" / direct-to-room text standing as if it were still current), and add a named AC requiring the typed team name be echoed back at the point of submission, since this flow — unlike the existing-team flow — has no other review point before an irreversible, unrenamable team name is committed.
3. **§6:** Normalize team-name uniqueness (case/whitespace-insensitive) — add as an explicit AC, not left as an unstated implementation choice.
4. **§5:** Add the empty-state copy requirement as a named AC on the existing-team use case, not just implementation guidance.
5. **§7:** Confirmed — "locked" is derived, no schema change needed. No action beyond a note in the proposal.
6. **§4:** Add `is_first_session` correctness as its own named AC, independent of code-reuse specifics.
7. **New:** Name the team-membership-at-join-time open question as a carried-forward dependency risk in the proposal's Non-Goals.

Nothing here should block moving to propose — items 1 and 2 are the two that need to be resolved *in* the proposal's stated scope (one as a prerequisite migration, one as a use-case rewrite) rather than discovered during implementation.
