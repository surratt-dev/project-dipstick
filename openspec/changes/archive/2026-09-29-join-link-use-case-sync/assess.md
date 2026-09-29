# Assessment: 165-join-link-use-case-sync

**Author:** Devon Calloway, Principal Software Engineer (Internal Champion)
**Track:** Light — merged Explore + Propose pass
**Date:** 2026-09-29

---

## What the change is

`requirements/use cases/02 - Session Setup - Use Cases.md`'s "Copy Session Join Link" use case (currently lines 143-197) still reads the way it did before `join-link-display-copy` (#45, archived 2026-09-24) explored and built against it. That change had to resolve four ambiguities in the use case by inference — a routing question, an unmeasurable AC, a missing alternate flow, and a mid-review reversal on draft-state behavior — and recorded the resolutions in its own archived documents (`exploration-notes.md`, `propose-review-ba.md`, `explore-review-ba.md`, `specs/join-link-copy/spec.md`). Both of Marcus Delgado's (BA) reviews on that change independently flagged the same thing: the source use case itself was never updated, so it still contains the original ambiguities even though the answers are settled and shipped. This change closes that gap — five targeted edits to the use case's Preconditions, Main Flow, Alternate Flows, and Acceptance Criteria sections, transcribing decisions that are already final, not making new ones.

This is a documentation-only change. No application code, `openspec/specs/join-link-copy/spec.md`, or the archived change directory is touched.

## Why it matters

I've watched this exact failure mode before — it's the reason `fix-default-topic-seed-data` (#... archived 2026-09-24) existed at all: a source-of-truth document drifts out of sync with what the application actually settled on, and the drift is invisible until someone reads the two side by side. Here the risk is narrower but the mechanism is identical. The use case document is what the *next* exploration pass reads first, cold, before it ever opens an archived change's exploration notes. Right now that next reader would re-derive all four of these findings from scratch — including re-discovering that `SessionLobbyPage` is a red herring, and re-litigating whether the draft-state copy button should exist at all, a question that already flipped once mid-review (Marcus's `explore-review-ba.md` §2a recommended withholding it; Priya, in exploration for #45, gave the concrete staging-workflow argument that reversed it; `spec.md` Requirement 1 shipped with the button present). Leaving the use case stale doesn't just cost re-reading time — it actively points the next reader at the wrong answer on that fourth item, since the current text is silent rather than neutral.

Marcus's `propose-review-ba.md` §1 called this the one real gap in an otherwise clean proposal, and flagged it as the item he wanted "closed out before this change is archived, not left to drift again." It wasn't closed before archiving. This is that follow-up.

## No architectural decision needed — confirmed

I read all four sources of ground truth before drafting anything below: `specs/join-link-copy/spec.md`'s four requirements, `exploration-notes.md`, `explore-review-ba.md`, and `propose-review-ba.md`. Every one of the five edits below transcribes a decision that is already settled, shipped, and (per `champion-signoff.md`, my own prior review) verified in the actual diff:

- **The routing mapping (item 1)** is a traced fact, not a judgment call — `join-link`'s "Session-aware join link landing" requirement (redirect fires only on `active` status) plus an exhaustive grep of navigation call sites, both independently confirmed by Marcus in `explore-review-ba.md` §1.
- **The AC concreteness (item 2)** replaces an adjective with `spec.md` Requirement 4's already-decided style rule (drop the muted `#9e9e9e` treatment once joinable). Nothing to weigh.
- **The rejected-promise alternate flow (item 3)** is `spec.md` Requirement 3, agreed by both reviewers, already implemented and tested (`champion-signoff.md` confirms the hook treats rejection and unavailability identically, explicitly to avoid a false-positive confirmation).
- **Draft-state copy availability (item 4)** is `spec.md` Requirement 1's settled outcome, reached after the one real back-and-forth in this whole thread (Marcus's original recommendation, reversed by Priya's staging-workflow argument). The reversal already happened and shipped; this change just writes down where it landed.
- **The confirmation-banner text (item 5)** is `spec.md` Requirement 2's settled outcome: the literal string `"Link copied"` (no "e.g." qualifier) and an 8-second auto-clear, both verified directly against `spec.md` lines 27 and 32-35, not just cited secondhand. I'd originally held this one out as a flag rather than an edit — see Marcus's review of this assessment (`assess-review.md` §2) for why that call was wrong. He's right: nothing about stating an already-pinned exact string and an already-pinned duration requires deciding anything. I was treating "there are two facts to state" as "there's a decision to make," and those aren't the same thing when both facts are already final. Folded in below as item 5.

Nothing here trades off two live options or picks a technology. It's propagation, not design. If a real design question surfaces during implementation, I have not seen one — this assessment doubles as the light-track proposal for that reason.

## Proposed replacement text

All five edits below apply to `requirements/use cases/02 - Session Setup - Use Cases.md`. Line numbers are current as of this assessment (verify before editing — earlier use cases in the same file are out of scope and could shift these numbers if touched by unrelated work first).

### 1. Preconditions (currently lines 154-157) — name the concrete component

**Current:**
```
## Preconditions
- A session has been created and is in a "waiting for participants" state.
- The Facilitator is viewing the session room.
- A join link has been generated and is displayed in the session room.
```

**Proposed:**
```
## Preconditions
- A session has been created; the join link exists and is copyable whether the session is in `draft` status (not yet open to participants) or has reached `lobby` status or later (waiting for participants).
- The Facilitator is viewing their own control surface for the session — concretely, `DraftSessionHost`'s `draft-control-view` branch while the session is in `draft` status, or its `live-readiness-view` branch once the session reaches `lobby` status or later. This is *not* `SessionLobbyPage`, which shares the word "lobby" in its name but is unreachable by any live navigation path during the `lobby` window (tracked separately as issue #164). **Keep this mapping in sync if `DraftSessionHost`'s branching or the app's routing changes** — it is stated explicitly here so the next reader doesn't have to re-derive it from route code.
- A join link has been generated.
```

This also folds in item 4 (draft-state scope) at the precondition level, since the use case's scope now legitimately spans both states rather than `lobby` alone.

### 2. Main Flow, step 1 (currently line 160) — small consistency touch

The Preconditions rewrite above drops the ungrounded phrase "the session room." Main Flow step 1 currently still uses it. Leaving one section grounded and the other not would reintroduce the same ambiguity one line down, so I'm proposing a minimal matching edit — not a new finding, just consistency:

**Current:**
```
1. The Facilitator views the session room, where the join link is displayed.
```

**Proposed:**
```
1. The Facilitator views their session control surface (see Preconditions), where the join link is displayed — as muted, selectable text alongside the `draft`-status badge while in `draft`, or as the full-emphasis primary link once `lobby` or later.
```

### 3. Alternate Flows (currently lines 166-168) — add the rejected-promise flow

**Current:**
```
## Alternate Flows
- **Clipboard API unavailable (browser or OS restriction):** The application falls back to displaying the join link as selectable text so the Facilitator can copy it manually. No confirmation of successful copy is shown.
- **Facilitator manually selects and copies the link text:** The application does not interfere. The link is visible and selectable at all times.
```

**Proposed:**
```
## Alternate Flows
- **Clipboard API unavailable (browser or OS restriction):** The application falls back to displaying the join link as selectable text so the Facilitator can copy it manually. No confirmation of successful copy is shown.
- **Clipboard API available but the write call rejects at runtime (permission denied, insecure context, or any other runtime rejection):** Treated identically to "Clipboard API unavailable." The application falls back to displaying the join link as selectable text. No confirmation of successful copy is shown.
- **Facilitator manually selects and copies the link text:** The application does not interfere. The link is visible and selectable at all times.
```

### 4. Acceptance Criteria (currently lines 176-181) — replace the unmeasurable bullet, add draft-state coverage

**Current:**
```
## Acceptance Criteria
- [ ] The join link is displayed prominently in the session room at all times before the session begins.
- [ ] A copy button is present adjacent to the join link.
- [ ] Activating the copy button places the full join link URL on the system clipboard.
- [ ] A visible confirmation is shown after a successful copy.
- [ ] The join link remains visible and manually copyable regardless of clipboard API availability.
```

**Proposed:**
```
## Acceptance Criteria
- [ ] While the session is in `draft` status, the join link is displayed using muted/de-emphasized styling alongside the existing `draft`-status badge, with a functional copy button present adjacent to it — copying is available before the room opens, so a Facilitator can stage a share message in advance.
- [ ] Once the session reaches `lobby` status or later, the join link is displayed using full-emphasis body text styling (not the muted `draft` treatment), without the `draft`-status badge, and the same copy button remains present and functional adjacent to it. The badge's presence — not the copy button's presence — is what distinguishes the two states.
- [ ] Activating the copy button places the full join link URL on the system clipboard.
- [ ] A visible confirmation is shown after a successful copy.
- [ ] The join link remains visible and manually copyable both when the Clipboard API is unavailable and when an available `navigator.clipboard.writeText()` call rejects at runtime — neither case shows a copy-success confirmation.
```

The first two bullets replace the single "displayed prominently... at all times before the session begins" bullet: they cover the same ground (link visibility across the pre-session window) with concrete, testable conditions instead of an adjective, and they resolve item 4 (draft-state copy-button availability) explicitly rather than leaving it unaddressed. The last bullet absorbs the rejected-promise case so the AC list and the new Alternate Flow stay in agreement.

### 5. Main Flow, step 4 (currently line 163) — pin the confirmation text and duration

`spec.md` Requirement 2 pins the confirmation banner to the literal string `"Link copied"` (no "e.g." qualifier) and an 8-second auto-clear following the existing `MemberManagement.tsx` convention, both settled per Marcus's `explore-review-ba.md` §2c and verified directly against `spec.md` lines 27 and 32-35 for this assessment. The use case's Main Flow step 4 still reads the pre-decision phrasing. This is the same category of drift as items 1-4 — a decision that's already final, not yet transcribed — so it belongs in the change rather than left as a note. (I'd originally held it out on the reasoning that stating the 8-second duration meant deciding something; Marcus's review of this assessment, `assess-review.md` §2, is right that it doesn't — both facts are already pinned in `spec.md`, so there's nothing left to weigh.)

**Current:**
```
4. The application displays a brief confirmation (e.g., "Link copied") to acknowledge the action.
```

**Proposed:**
```
4. The application displays an inline confirmation banner reading exactly "Link copied," which clears automatically after 8 seconds.
```

## Recommendation

Proceed on the light track. Apply the five edits above directly to `requirements/use cases/02 - Session Setup - Use Cases.md`. No design stage needed — every answer here is already shipped and verified against the archived change's spec; this assessment's job was to locate the settled answers and put them in the form the use case document needs, not to decide anything new.
