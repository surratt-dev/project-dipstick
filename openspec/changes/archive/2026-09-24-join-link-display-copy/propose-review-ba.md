# BA Review — Join Link Display & Copy Proposal

**Reviewed by:** Marcus Delgado (Business Analyst)
**Source reviewed:** `proposal.md`, `specs/join-link-copy/spec.md`, `design.md`, `tasks.md`
**Cross-checked against:** `requirements/use cases/02 - Session Setup - Use Cases.md` ("Copy Session Join Link"), `openspec/specs/join-link/spec.md`, `openspec/specs/session-creation/spec.md`, `exploration-notes.md`, my own `explore-review-ba.md`

**Verdict up front:** This is buildable. The delta spec's four requirements are concrete, each scenario maps to a specific, observable DOM/behavior condition, and `tasks.md` traces almost 1:1 against them — this is the outcome I want from exploration-to-proposal, and it's a big step up from the source use case's original AC language. I have one real gap (§1 — no filed tracking issue for the source use-case document edits, despite two separate reviews calling for one) and two smaller precision issues (§2, §3). Nothing here should block moving to design/implementation, but §1 should be closed out before this change is archived, not left to drift again.

---

## 1. Real gap: the use-case document follow-up still has no tracking issue

Both my own `explore-review-ba.md` (§4) and `exploration-notes.md` (§6) independently concluded that `requirements/use cases/02 - Session Setup - Use Cases.md`'s "Copy Session Join Link" use case needs a direct edit — not because this proposal got anything wrong, but because the *source document* still contains the ambiguities this proposal had to resolve by inference:

- **Precondition still says "the Facilitator is viewing the session room"** with no concrete mapping. The routing investigation (`exploration-notes.md` §1) proved this precondition doesn't correspond to any component a real Facilitator reaches during `lobby` — it's `DraftSessionHost`'s `live-readiness-view`, not `SessionLobbyPage`. This proposal correctly targets the right component, but the use case itself still points at the wrong mental model for the next person who reads it cold.
- **AC #1 still says "displayed prominently... at all times before the session begins"** — broader than the use case's own Preconditions (which scope to `lobby`), and "prominently" is exactly the kind of unmeasurable adjective I flagged in my prior review (§2d). `spec.md`'s Requirement 4 resolves this concretely (full-emphasis vs. muted styling, tied to session status) — but that resolution lives in the delta spec, not back in the source use case.
- **Alternate Flows still has no rejected-`writeText()`-promise flow.** `spec.md`'s Requirement 3 and `design.md`'s D2 correctly treat this identically to "Clipboard API unavailable," matching what both reviewers settled on — but the use case document itself is silent on it, so a future reader working from the use case alone would have to rediscover this.
- **The `draft`-state copy-button question has actually *changed* since my last review**, and the use case doesn't reflect the new answer either way. My `explore-review-ba.md` §2a recommended *withholding* the copy button during `draft`. `exploration-notes.md` §3 records that Priya (Facilitator) overrode that with a concrete staging-workflow argument, and the settled decision — copy button present in both `draft` and `lobby`+, badge (not button presence) signals joinability — is what `spec.md`'s Requirement 1 correctly implements. Good outcome, but it means the use case document is now stale in a *new* way, not just the original way: it doesn't say anything about draft-state copy availability at all, so there's no textual trace of this reversal anywhere upstream of `exploration-notes.md`.

This isn't a defect in this proposal — `spec.md` gets all four of these right, and I verified each requirement against my own prior concerns and found them resolved correctly. My concern is **traceability**, which is the thing I care about most (see my persona notes): `SessionLobbyPage`'s routing gap got a real, numbered tracking artifact (#164), cited directly in `design.md`. The use-case document gap — which is arguably the more foundational fix, since it's the document a future exploration pass will start from — has no equivalent. It's been "correctly deferred as separate follow-up work" across two documents now, and deferred-with-no-ticket is how the "edge case discovered late becomes a scope dispute" pattern I'm explicitly watching for actually happens.

**Ask:** File a tracking issue for the use-case document edit, mirroring #164's pattern, and reference it from `proposal.md` or `design.md` the same way #164 is referenced. I'd rather this proposal spend one more line pointing at a real issue number than have the next exploration pass re-derive all of §1 from scratch again.

---

## 2. Minor precision issue: `proposal.md`'s Impact section hedges on a path `design.md` already nails down

`proposal.md`'s Impact section reads:

> **Frontend:** `packages/frontend/src/.../DraftSessionHost.tsx` (or wherever it currently lives)

I confirmed the file exists at exactly `packages/frontend/src/pages/DraftSessionHost.tsx` (verified on disk), and `design.md`'s Context section already states this precise path with no hedge. The "or wherever it currently lives" qualifier reads like it was written before the path was confirmed and never tightened up once `design.md` nailed it down. Since I'm reviewing for exactly this kind of ambiguity: this should be the concrete path, full stop. Small fix, but it's an easy one to leave in and it costs nothing to correct before this becomes the record other documents cite.

---

## 3. Minor: one scenario in `spec.md` isn't mapped to a discrete test in `tasks.md`

Requirement 1's "Control persists for the full waiting window" scenario (`spec.md` lines 19-21) is the only one of the delta spec's eleven scenarios that doesn't have an obvious 1:1 task in `tasks.md` §4. Every other scenario maps cleanly (e.g., the URL-consistency scenario → task 4.6, the muted-vs-full-emphasis scenario → task 4.7). `design.md` explains this one "falls out of where the control lives" rather than requiring new logic, which I agree with — it's an architectural property (the control lives in `live-readiness-view`'s standing render, not a one-shot element), not new behavior to build. I'm not asking for a new task that asserts a UI element survives for "several minutes" — that's not a meaningful test. But I'd rather `tasks.md` say so explicitly (a one-line note under §4 or §5: "Persistence across the lobby window is structural — see design.md D-note — no discrete test required") than have this scenario sit unmapped with no explanation visible in `tasks.md` itself, which is the document an implementer actually works from task-by-task.

---

## 4. Where the proposal is precise enough — confirmed against my own concerns and the source specs

- **Scope citation is accurate.** I verified `proposal.md`'s "Not in scope" bullet against `openspec/specs/join-link/spec.md`'s "Session-aware join link landing" requirement directly (line 249-250 in that file) — the redirect-to-`/session/:sessionId`-only-on-`active` claim is exactly right, not paraphrased loosely.
- **"Modified Capabilities: none" claim is accurate.** I checked `openspec/specs/session-creation/spec.md`'s "Draft-status landing after session creation" requirement (line 127) directly — it already specifies the control view "SHALL display... the generated join link (visibly marked as not yet joinable)," so this change genuinely is additive to that requirement's existing scenarios, not a silent modification that should have been declared. Good catch by whoever wrote this citation instead of just asserting it.
- **All four `spec.md` requirements are concrete and testable**, and each resolves a specific ambiguity flagged during exploration/review rather than leaving it implicit:
  - Requirement 1 (render in both `draft` and `lobby`+) — settles my original §2a concern (now correctly superseded) and states the badge/button independence explicitly (D3), not just implied by the scenarios.
  - Requirement 2 (confirmation banner) — pins the exact literal string ("Link copied," no "e.g." qualifier — settles my §2c concern) and the exact timing (8s, with stated rationale for departing from `MemberManagement.tsx`'s 5s).
  - Requirement 3 (unavailable/rejected-write fallback) — settles my §2b concern; explicitly prohibits `document.execCommand('copy')` as an escape hatch, which is exactly the failure mode both reviewers were worried about.
  - Requirement 4 (visual prominence) — settles my §2d "prominently displayed is not measurable" concern with an actual style rule (drop `#9e9e9e`, use default body color) instead of an adjective.
- **The Capabilities section in `proposal.md`** is specific enough to implement from — it enumerates the concrete behaviors (link visibility rules, copy button, clipboard success/failure/fallback, banner content and timing, visual prominence) rather than a one-line capability name with no delta description.
- **Out-of-scope boundaries hold up.** No new touch on `join-links.ts`, `executeJoinFlow`, token generation/validation, or the session-aware-landing rule — confirmed against `join-link`'s spec directly, matches what I'd expect from an additive display-only change.

---

## 5. Summary for whoever picks this up next

1. **File a tracking issue for the source use-case document edits** (§1) and reference it in `proposal.md`/`design.md`, the same way #164 is referenced. This is the one open item I'd treat as a real gap, not a nice-to-have.
2. **Tighten the Impact section's file path** in `proposal.md` (§2) — drop the "or wherever it currently lives" hedge.
3. **Add a one-line note in `tasks.md`** clarifying that the "control persists for the full waiting window" scenario is structural, not a discrete test target (§3).

None of these block implementation. §1 is the one I'd want closed before this change is archived — everything else can be picked up opportunistically.
