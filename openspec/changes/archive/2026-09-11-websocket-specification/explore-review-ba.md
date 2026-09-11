# BA Review — WebSocket Specification Exploration Notes (issue #24)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway)
**Date:** 2026-09-11

---

## Verdict up front

This is worth proposing, and I agree with the "reconciliation, not greenfield design" framing. The event-name correction table and the `serverTimestamp` finding are both specific enough to carry into a proposal as-is — they name files, they name the exact missing field, they're falsifiable. That's the standard I hold requirements to, and most of this document clears it.

What doesn't clear it yet are the three open questions and a handful of "either/or, TBD" phrasings inside the findings themselves. Those are exactly the shape of ambiguity that turns into a Slack message to me three weeks into implementation, which is the thing I'm here to prevent. Below is what needs to be pinned down before this goes into a proposal, with suggested concrete language.

---

## 1. Scope-shape consistency check against REST API Contract / Validation Report

I checked the proposed "covers / does not cover" shape against `REST API Contract.md` Appendix D and `REST API Contract - Validation Report.md` Discrepancy 7. **No contradiction found — it's consistent, and better than consistent: it's exactly what was ordered.**

Specifics:

- Validation Report Discrepancy 7 (2026-03-15) already concluded "the REST API contract is the wrong document for WebSocket payload specifications" and required "a dedicated WebSocket Specification document before the real-time layer is considered ready for implementation." Appendix D (lines 2958–2968) restates this as a named gap tied explicitly to FR-4.6.1 and lists the same minimum bar `todo.md` does. So the exploration's claim that this issue was meant to be a **gate** isn't editorializing — it's a direct quote of standing, approved documentation (`todo.md` line 43: "Blocking: Real-time layer implementation cannot begin until this document is approved"). The proposal should cite Appendix D lines 2958–2968 and `todo.md` lines 23–43 directly rather than paraphrasing Devon's summary of them — this is a case where the primary source is stronger than the exploration's restatement of it, and a future reader tracing scope back to a requirement should land on the BRD-adjacent document, not on exploration notes.
- The "does not cover" list (4 items: delivery-time authorization, idle re-auth/token refresh, client connection-health, vote draft persistence) correctly excludes exactly the four specialist changes and correctly does *not* exclude `session-lifecycle-transitions`, since that change's reveal/advance write-and-broadcast mechanics are the backbone the new catalog has to describe. That's the right cut.
- One precision gap in the exploration itself, not a scope problem: it names the five source changes as `websocket-session-authorization`, `websocket-connection-reauthorization`, `websocket-staleness-signal`, `vote-compose-recovery`, `session-lifecycle-transitions`, then separately cites `session-topic-lifecycle` as the source of the `topic.advance`/`SESSION-012` mechanics. I checked — `session-topic-lifecycle` is the **capability spec name** living inside the `session-lifecycle-transitions` change (`specs/session-topic-lifecycle/spec.md`), not a sixth undisclosed change. It's correct, but as written a reader unfamiliar with the archive will think a sixth source went unaccounted for in the "does not cover" list. **Suggested rewrite:** in the proposal, state once, explicitly: "This document draws on five archived changes; one of them (`session-lifecycle-transitions`) contains two capability specs, `session-lifecycle-transitions` and `session-topic-lifecycle` — both are in scope for citation." Small thing, but it's the kind of thing that gets asked in review if left implicit.
- Second precision gap, same category: the archived change directory is `2026-09-07-websocket-delivery-time-authorization`, but its capability spec is named `websocket-session-authorization` — the two names genuinely differ (not just a stripped date prefix). The proposal's citation list should use the capability name consistently and, once, note the directory-name mismatch so a reader searching the archive by the capability name doesn't come up empty.

**Bottom line on scope:** proceed with the covers/does-not-cover shape as drafted. Tighten the citations as above.

---

## 2. Open Question 1 — Is closing the `serverTimestamp` gap in scope, or a follow-up issue?

**This is too soft as written.** "I lean toward: the spec *requirement* belongs here... but the *implementation* task could reasonably be a scoped follow-up" is a personal inclination, not a decision the proposal can build against. Two different engineers reading that sentence will scope the change differently, and I will get asked to arbitrate it later — which is precisely the failure mode I'm trying to design out of every requirement I own.

**Required before proposal stage:** pick one, explicitly, in the proposal's Why/scope section:

- **Option A (requirement now, implementation now):** the spec states the `serverTimestamp` requirement AND this change includes the one-field serializer addition Devon already scoped as small (`vote-revealed-payload.ts`). FR-4.6.1 goes from unverified to actually satisfied in the same change that documents it.
- **Option B (requirement now, implementation deferred):** the spec states the requirement as normative, marks the current `vote_revealed` payload as **non-compliant** (not "pending" — non-compliant, stated plainly, since it's a HARD requirement currently unmet in shipped code), and opens a tracked follow-up issue *before this change is archived*, following the same numbering convention as #31/#32/#33/#36. The issue number goes in the spec, not "TBD" or "see follow-up."

Either is buildable. What's not buildable is leaving the choice open past the proposal stage. My preference, for what it's worth as an outside opinion and not a mandate: **Option A**, because Devon has already characterized it as a one-field, low-risk addition, and a spec that documents a HARD requirement as "not yet true, tracked elsewhere" for an indefinite period is exactly the kind of paper compliance I don't want my name on. But whichever way the team decides, decide it in the proposal, not the spec.

**Suggested acceptance condition for the proposal, either way:**
- AC: The new spec contains a normative statement of the `serverTimestamp` requirement citing FR-4.6.1 by ID, not a description of current behavior.
- AC: The spec states plainly whether the current shipped payload satisfies this requirement (it does not, today) — no phrasing that could be read as "effectively satisfied" or "close enough."
- AC (if Option B): a follow-up issue number exists and is cited in the spec before this change is marked complete. "Will be filed" is not sufficient at close.

---

## 3. Open Question 2 — `participant.joined`/`left` and live `actionitem.updated`: build now or spec-and-defer?

I checked the priority markings the exploration cites: **confirmed, both are [PREF].** `BRD.md` line 225 (FR-2.5) and line 237 (FR-3.3) both read `[PREF]`, not `[HARD]`. That's the right basis for treating these with less urgency than the `serverTimestamp` gap, and I want to note explicitly that this part of the exploration is *not* vague — it's correctly grounded and I'd have flagged it if the priority claim were unverified.

What's still open is the same build-vs-defer ambiguity as Open Question 1, and for these two the issue text is actually more directive than the exploration gives it credit for: `todo.md`'s "must specify, at minimum" list names `participant.joined`/`participant.left` and `actionitem.updated` explicitly (lines 33, 38) as things the document has to specify — it does not say build. Given that issue #24 was scoped from the start as a **documentation deliverable** ("Owner: Full Stack Engineer + Solution Architect... document approved" — this was never an implementation ticket), I read the original intent as: **spec-and-defer was always the plan for anything not already shipped.** None of the five prior changes picked these up, which is itself evidence nobody currently holds an implementation mandate for them.

**Suggested acceptance condition:**
- AC: The spec documents `participant.joined`/`participant.left` and live `actionitem.updated` (the pre-finalization "Open → In Progress" broadcast case) as normative future-state entries in the event catalog, each tied to its FR ID ([PREF]) and each marked **NOT IMPLEMENTED**.
- AC: For each, the spec either cites an existing follow-up issue number or states explicitly "no follow-up issue exists; implementation is unscheduled" — silence on this point is what turns into a scope dispute later, per Marcus's own stated risk about edge cases discovered late.
- Recommend against building these in this change: it's a docs-and-reconciliation change by design, and pulling in two net-new WebSocket events (with their own authorization, delivery, and reconnection-safety design work) would blow past that scope and re-create the exact "spec catches up to code written under time pressure" problem this change exists to fix.

---

## 4. Open Question 3 — Who blesses the corrected Appendix D language?

This one actually has a precedent already sitting in the document, and the exploration doesn't use it. `REST API Contract.md` already contains a live example of exactly this correction pattern: the `session-lifecycle-transitions` correction note appended directly to Appendix D and to SESSION-005 (both dated 2026-09-08, both inline, both un-gated by a new BA Validation Report cycle).

**Recommendation, stated as a decision rather than left open:** follow the existing precedent. The `websocket-specification` change, when archived, appends a dated, attributed correction note directly to Appendix D's `reveal.trigger`, `vote.submit`, `vote.locked`, `topic.advance`/`topic.advanced`, `participant.joined`/`left`, and `actionitem.created`/`updated` rows — the same mechanical move already used for the `reveal.trigger`/`topic.advance` REST-vs-WebSocket correction. It does **not** require a new Validation Report entry; the precedent shows corrections of this kind are handled inline in the contract itself, not through a fresh BA sign-off round. I'll review the correction note for accuracy when it's drafted (that's the same review role I played on the original Validation Report), but I don't need to "bless" it in a separate ceremony — the existing pattern doesn't have one, and inventing one here would be inconsistent with how the last correction of this exact kind was handled.

**Suggested acceptance condition:**
- AC: `todo.md`'s "WebSocket Specification" item (lines 23–43) is checked off and annotated with a pointer to the new spec document, the same way completed items elsewhere in that file would be — don't leave it open after the spec ships.
- AC: Appendix D gets one consolidated correction note (matching the tone/format of the existing `session-lifecycle-transitions` note at line 2947), not six scattered edits — a reader should be able to find the whole correction in one place.

---

## 5. Vague areas needing sharper acceptance criteria (beyond the three open questions)

**5a. The "ritual-integrity checklist" (5 items) reads as Devon's personal review criteria, not as spec requirements.** That's fine for exploration notes, but if it goes into the proposal unchanged, it's not buildable — "I'll be checking the eventual spec against this" only works as long as Devon is the one checking. Each of the five needs to become a **named, cross-cutting invariant statement inside the spec itself**, traceable to the FR it protects, so any reader (not just Devon) can verify it. Concretely:

| Checklist item | Needs to become |
|---|---|
| No pre-reveal vote value leak, anywhere in the catalog | A single stated invariant in the spec, citing FR-4.6 and FR-4.7, that a reader can check against every event in the catalog table in one pass |
| Simultaneity is measured, not assumed | **This one is still underspecified even as a checklist item.** "Measured" needs a definition: what's the exact client-side computation (presumably `received_at − serverTimestamp`), where does the result go (log line? metric? nothing user-facing?), and — `todo.md` line 40 explicitly asks for this — what happens when the 15-second SLA is violated. The exploration doesn't commit to a surfacing behavior, and this is the same "is it in scope" question as Open Question 1, just for the *consumption* side of the field rather than the field itself. Needs an explicit answer in the proposal, not just "clients log it." |
| Reconnection does not create a side door | Cite `session_registration_snapshot`'s self-disclosure-only design as the existing mechanism and state the invariant as "no reconnection payload includes another participant's vote or lock-in status before reveal" — buildable and testable as written once stated this way |
| Facilitator's readiness grid can't see vote values pre-reveal | Same treatment — cite `VoteReadinessUpdatePayload`'s structural exclusion and state it as a catalog-level invariant, not a per-event note |
| Nothing here should read as configurable | This is a watch-item for design-stage review, not a spec requirement — fine to carry forward as review guidance rather than an acceptance condition, since the exploration itself says nothing currently proposes this |

**5b. Finding 1's remediation framing ("(a) ... or (b) ...") is the same unresolved fork as Open Question 1** — I've addressed it there; flagging here only to note it shouldn't be stated twice with two different resolutions in the eventual proposal. Pick the language once and use it consistently between the Finding and the Open Question section (right now the exploration notes state the fork twice, in slightly different terms, which itself risks the proposal author resolving it two different ways in two different sections).

**5c. Finding 3's "either in-scope-to-build here or explicitly deferred with an issue number, but not silently omitted"** — good instinct, same fork as Open Question 2, already resolved above (spec-and-defer, with an explicit "no issue exists yet" statement permitted in lieu of a real issue number, since these are PREF and none of the five prior changes claimed them).

**5d. The "I didn't read every scenario in `session-topic-lifecycle` line by line" caveat (end of Finding 3) is a verification gap the proposal shouldn't inherit as-is.** Carrying "worth a second pass at design time" forward as an unowned caveat is how a real contradiction slips through. **Suggested acceptance condition:** add an explicit task to the proposal's task list — "cross-check the new catalog's non-goal boundaries against all five prior specs' stated non-goals for contradiction" — with a named owner and a checkbox, not a parenthetical aside in a Finding.

---

## 6. What's already specific enough — no changes needed

For balance, since I don't want the team over-rotating on the items above: Finding 1's factual trace (file paths, function names, the absence of `serverTimestamp` anywhere in the tree) is exactly the level of specificity I want and needs no rewrite. Finding 2's correction table (old name → real event → file) is likewise ready to become the spec's actual event catalog with no restructuring — it already has the shape of the final deliverable. The "does not cover" delegation list in Finding 3 is buildable as-is once the two naming precisions in Section 1 above are folded in.

---

## Summary of required changes before proposal stage

1. Decide Open Question 1 (build-now vs. spec-and-defer for `serverTimestamp`) — my recommendation is build-now, but decide explicitly either way, with the acceptance conditions in Section 2.
2. Confirm spec-and-defer for `participant.joined`/`left` and live `actionitem.updated` (both [PREF], confirmed against BRD.md), with the "NOT IMPLEMENTED" + issue-number-or-explicit-absence treatment in Section 3.
3. Adopt the existing inline-correction precedent for Appendix D / `todo.md` (Section 4) — no new BA sign-off ceremony needed.
4. Convert the five ritual-integrity checklist items into named, traceable invariants in the spec body, and specifically define what "simultaneity is measured" produces as an artifact (Section 5a).
5. Add an explicit, owned task to cross-check non-goal boundaries against all five prior specs before the proposal's scope is considered final (Section 5d).
6. Tighten the two naming precisions (change-ID vs. capability-name mismatches) when citing prior work (Section 1).
