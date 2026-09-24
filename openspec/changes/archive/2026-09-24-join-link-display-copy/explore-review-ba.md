# BA Review — Join Link Display & Copy Exploration Notes

**Reviewed by:** Marcus Delgado (Business Analyst)
**Source reviewed:** `openspec/changes/join-link-display-copy/exploration-notes.md` (Devon Calloway)
**Cross-checked against:** `requirements/use cases/02 - Session Setup - Use Cases.md` ("Copy Session Join Link" and its dependencies), `openspec/specs/join-link/spec.md`

**Verdict up front:** Devon's routing finding (§1) is real, I verified it against the join-link spec, and it exposes a genuine defect in my own use case document, not just an implementation gap. That has to be fixed at the use-case level before this becomes a proposal, not patched over in design.md. Most of the rest of the notes are close to buildable already; I've flagged the specific spots that need a decision recorded as a requirement rather than left as an inference for whoever implements.

---

## 1. Confirmed: the use case has a real ambiguity, not just an implementation gap

I checked Devon's central claim against `openspec/specs/join-link/spec.md`, "Session-aware join link landing" (line 250): the redirect rule fires only when session status is `active`. `lobby` is excluded by the spec's own text. Combined with Devon's grep results (nothing navigates to `/session/:sessionId` during `lobby`), this means: **the Facilitator's precondition in my "Copy Session Join Link" use case — "the Facilitator is viewing the session room" — does not correspond to any component a real Facilitator reaches during the exact window the use case is about.** That's not a hand-wavy implementation detail Devon is speculating about; it's a traceable contradiction between two documents I own (the use case and the session-aware-landing requirement), and Devon did the work of tracing it into actual route code.

This is exactly the "edge case discovered late becomes a scope dispute" pattern I want to head off, so I'm resolving it now rather than deferring it to the proposal author's judgment call.

**Ruling:** The use case's precondition phrase "the session room" refers to *wherever the Facilitator's own control surface actually is* during `lobby` status — which is currently `DraftSessionHost`'s `live-readiness-view` branch, per Devon's trace. It does not refer to `SessionLobbyPage` merely because the component name matches "lobby." The use case text should say this explicitly so the next person who reads it doesn't have to re-derive Devon's grep — see §4 for why I'm recommending that as a follow-up rather than editing it directly in this review.

This settles Devon's Option (b) vs (a) question in §1 of the exploration notes: **(b), scope this change to `DraftSessionHost`.** Reasoning, for traceability: the use case's postcondition requires the AC to be verifiable "for real users right now" (my Success Criteria #2 — a facilitator should be able to run a session without consulting documentation). An AC that only passes in a component nothing routes to does not satisfy that criterion; it satisfies the letter of a checkbox while failing the thing the checkbox exists to protect. That's the same failure shape I already flagged in my own concerns list around the facilitator/participant view blur — a component that *looks* like a complete control surface but isn't the one in the live path.

**What I need in the proposal, concretely, not just "named":**
- `proposal.md` scope section states plainly: this change modifies `DraftSessionHost`'s `live-readiness-view` branch. It does not modify `SessionLobbyPage`.
- A separate, filed follow-up issue (not just a notes reference) for the `SessionLobbyPage` routing gap, so it doesn't silently become permanent dead code. I'll want the issue number in `design.md` once it exists.
- The AC I'm adding in §4 below makes this an explicit, testable condition rather than an inference from the design doc.

---

## 2. Vague areas that need to become explicit requirements before implementation

### 2a. "Before the session begins" (AC #1) doesn't say whether it includes `draft`

The use case's Preconditions section scopes this use case to "waiting for participants state" (`lobby`). Its Acceptance Criteria then broadens to "at all times **before the session begins**" (line 177), which literally includes `draft` too. That's an inconsistency in my own document — Devon caught it (§3) but treated it as an open design question rather than naming it as what it is: **the use case's AC is broader than its precondition, and that gap was never resolved when I wrote it.**

Devon's proposed default (copy button appears at `lobby`+, text-only stays for `draft`) is reasonable and I'm adopting it, but "reasonable default noted in exploration notes" is not the same as a requirement. If this ships as an inferred behavior with no AC covering it, the first support question about "why can't I copy the link before I open the room" becomes a scope dispute with no document to point to.

**Suggested rewrite** — add to "Copy Session Join Link" AC list:
> - [ ] While the session is in `draft` status, the join link is displayed as text (existing "not yet joinable" treatment) with no copy button present.
> - [ ] Once the session reaches `lobby` status or later (join link is usable), the copy button appears adjacent to the link.

### 2b. Clipboard write rejection (promise rejects after feature-detection passes) has no owning AC

Devon is right that the use case's Alternate Flow language ("Clipboard API unavailable (browser or OS restriction)") is ambiguous about whether it covers a *runtime rejection* of an available API versus the API being *absent*. This is a real gap in the use case text, not an implementation nuance — the use case as written doesn't tell an implementer what to do when `navigator.clipboard.writeText()` exists but throws. Devon's proposed resolution (treat identically to "unavailable") is the right call and matches the spirit of the existing alternate flow, but it needs to be a documented AC, because it changes observable behavior (no confirmation banner shown) — that's exactly the kind of thing that gets "simplified away" under time pressure if it's only living in exploration notes.

**Suggested rewrite** — add to Alternate Flows:
> - **Clipboard API available but the write call fails (permission denied, insecure context, or other runtime rejection):** Treated identically to "Clipboard API unavailable." The application falls back to the selectable-text state. No confirmation of successful copy is shown.

### 2c. The confirmation banner's exact copy is unspecified

Devon anchors the confirmation pattern to `MemberManagement.tsx`'s auto-clearing banner convention, which I agree is the right precedent to reuse. But the notes don't propose literal banner text, and the use case only offers "Link copied" as an example ("e.g."), not a specified string. Every other user-facing message in the join-link spec is a literal, quoted string (e.g., "This link has expired. Ask your facilitator for a new one.") — that consistency matters for a facilitator building a mental model of the app's voice. Leaving this as "e.g." invites the implementer to invent copy.

**Clarification needed:** proposal.md or design.md should pin the exact string (I'd default to "Link copied" as written, dropping the "e.g." qualifier) and the auto-clear duration (Devon's notes assume 5 seconds by analogy to `MemberManagement.tsx` but don't state it as a requirement for this feature — confirm it's intentionally inherited, not just visually similar).

### 2d. "Prominently displayed" (AC #1) is not measurable

This one predates Devon's notes — it's in my own use case text — but since we're formalizing ACs for this proposal anyway, "displayed prominently" isn't testable as written. Devon's notes implicitly resolve this by anchoring to the existing `draft`-state visual treatment (label + link text, per the `DraftSessionHost` code excerpt in §2) as the pattern to extend. I'd rather make that explicit than leave "prominently" as a subjective term a reviewer has to interpret later.

**Suggested rewrite:** Replace "displayed prominently" with: "displayed using the same visual treatment as the existing `draft`-state join link block (label + link text), with the copy button and no 'not yet joinable' badge once the link is usable." This ties the AC to a concrete, already-reviewed precedent instead of an adjective.

---

## 3. Where Devon's notes are already precise enough — no changes needed

- The Clipboard API / no-confirmation-on-fallback distinction (§4) is exactly the kind of fidelity I want protected, and Devon's ASCII decision tree is precise enough to build from directly once 2b above is folded into the use case text.
- The out-of-scope callouts (no QR codes, no in-app notifications) are already covered by the existing use case's Out of Scope section and don't need re-litigating.
- The observation that no clipboard-handling code exists anywhere in the frontend (§2) is a useful, verifiable fact (confirmed via the grep Devon ran) and correctly raises the bar on getting the fallback right since it'll set precedent — I'd keep that framing in the proposal as rationale for why this is worth getting right the first time, not a note that only lives in exploration.

---

## 4. Recommended follow-up to the use case itself (not actioned in this review)

This review's assigned scope is the exploration notes, not a rewrite of the source use case, so I'm not editing `requirements/use cases/02 - Session Setup - Use Cases.md` here. But the gaps in §1 and §2 above live in that document, not in Devon's notes, so they should be corrected there before or alongside this proposal — otherwise the next exploration pass rediscovers the same ambiguity from scratch. Recommended changes, as a separate, explicitly-scoped task:
1. Clarify that "the session room" means the Facilitator's actual live control surface, not a specific component name, and note the current concrete mapping (`DraftSessionHost`'s `live-readiness-view`) as of this writing so it doesn't silently drift out of sync with the app again.
2. Add the `draft`-state copy-button-absence AC (§2a above).
3. Add the clipboard-rejection alternate flow (§2b above).
4. Tighten "displayed prominently" per §2d.

I'll pick this up as its own task if asked; flagging it here rather than doing it silently as a side effect of this review.

## 5. Open items for whoever writes `proposal.md`

1. Confirm the exact confirmation-banner string and auto-clear duration (§2c) — I don't have strong opinions here beyond "pick one and write it down."
2. File the `SessionLobbyPage` routing-gap follow-up issue and reference its number in `design.md` (§1) — this cannot be a dangling reference to "exploration notes" in the shipped proposal.
3. Confirm with whoever owns `DraftSessionHost` that adding the copy control to `live-readiness-view` doesn't collide with any near-term work already planned against that component (Devon's notes don't raise a conflict, but I haven't checked a roadmap for it either — outside my scope to verify).
