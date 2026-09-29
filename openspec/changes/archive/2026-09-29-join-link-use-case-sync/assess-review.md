# BA Review — 165 Join Link Use Case Sync Assessment

**Reviewed by:** Marcus Delgado (Business Analyst)
**Source reviewed:** `assess.md` (Devon Calloway)
**Cross-checked against:** `requirements/use cases/02 - Session Setup - Use Cases.md` (current lines 143-197, verified on disk), `openspec/changes/archive/2026-09-24-join-link-display-copy/specs/join-link-copy/spec.md`, my own `explore-review-ba.md` and `propose-review-ba.md` from that archived change, and `packages/frontend/src/pages/DraftSessionHost.tsx` directly (not just the archived docs' description of it).

**Verdict up front:** This closes the gap correctly. All four edits transcribe settled, shipped decisions — I traced every one back to a `spec.md` requirement and, for the two edits that hinge on a specific component/testid claim, to the actual code. Nothing here is a new judgment call. One process point: the "flagging, not fixing" call on the confirmation-banner text is *procedurally* defensible since it's outside issue #165's four named points, but the stated reason for excluding it doesn't hold up, and it repeats a pattern I already pushed back on once in `propose-review-ba.md` §1 — a deferred use-case gap with no tracking mechanism. I'm recommending it get folded in now rather than deferred again.

---

## 1. All four edits verified against ground truth

I did not take Devon's citations on faith. For each edit I checked the specific claim against `spec.md` and, where a component/testid name was asserted, against the code itself.

### Item 1 — Preconditions (concrete component mapping)

This is a direct transcription of my own `explore-review-ba.md` §1 ruling: "the session room" means the Facilitator's actual live control surface, not `SessionLobbyPage`. Devon's proposed text names `DraftSessionHost`'s `draft-control-view` and `live-readiness-view` branches explicitly and calls out that `SessionLobbyPage` is unreachable during the `lobby` window (issue #164).

I grepped the actual component rather than trust the archived docs' description of it: both `data-testid="draft-control-view"` (`DraftSessionHost.tsx:257`) and `data-testid="live-readiness-view"` (`DraftSessionHost.tsx:362`) are real, and the copy control (`renderCopyControl(...)`) is rendered in the `draft-control-view` branch at line 276 and passed through as a prop to `LiveReadinessView`. Devon's precondition text is accurate to the current code, not just to the archived spec's description of it. Good — this is exactly the kind of claim that's easy to let drift a second time by copying it forward from one document to another without re-verifying, and it didn't drift.

**No issue.**

### Item 2 — Main Flow step 1 consistency touch

Correctly scoped as a non-finding — it's just following the Preconditions rewrite's vocabulary one line down so the document doesn't contradict itself internally. Matches the muted/full-emphasis split in `spec.md` Requirement 4. **No issue.**

### Item 3 — Rejected-clipboard-promise alternate flow

This is close to verbatim my own suggested rewrite from `explore-review-ba.md` §2b, and it matches `spec.md` Requirement 3 exactly, including the explicit prohibition on `document.execCommand('copy')` as an escape hatch (not reproduced in the use case text, correctly, since the use case describes observable behavior, not implementation technique). **No issue.**

### Item 4 — Acceptance Criteria (draft-state coverage + AC #1 concreteness)

This is the one edit that had to get the *direction* of a reversed decision right, not just find a settled answer. My original `explore-review-ba.md` §2a suggestion was to withhold the copy button during `draft`. That was overridden mid-review by Priya's staging-workflow argument (`propose-review-ba.md` §1, fourth bullet), and `spec.md` Requirement 1 shipped with the button present in both states, distinguished only by the badge. Devon's proposed AC correctly reflects the *shipped* outcome — copy button present and functional in both `draft` and `lobby`+, badge presence (not button presence) as the distinguishing signal — not my superseded original recommendation. That's the right call, and it's the one place in this assessment where getting it backwards would have silently reintroduced a wrong answer into the source document instead of a stale one. Devon got it right.

I also checked the badge text claim: `DraftSessionHost.tsx:272-274` currently reads "This link works already — anyone who opens it before you open the room won't see a waiting screen yet," which is consistent with `spec.md` Requirement 1's note that the badge "no longer describes the link as 'not yet joinable'" (resolved by #166). Devon's AC text doesn't quote the badge copy, so no drift risk there.

**No issue.**

---

## 2. The one point I want pushed back on: the banner-text "flagging, not fixing" call

Devon is right that the stale `'e.g., "Link copied"'` in Main Flow step 4 is technically the same category of drift as the four items above, and right to name it rather than silently fix it or silently ignore it. Procedurally that's the correct instinct, and it's outside the four points issue #165 actually names (I checked: my `explore-review-ba.md` §4 follow-up list — the one both `propose-review-ba.md` §1 and this assessment cite as "already flagged" — has four items: session-room mapping, draft-state copy-button AC, clipboard-rejection alternate flow, and tightening "prominently." The banner-copy-string concern was raised separately in §2c of that same review, addressed *to `proposal.md`/`design.md`*, not flagged as a use-case-document edit. So it genuinely wasn't part of what either of my two reviews asked to be closed here.)

But the stated reason for leaving it out doesn't hold up: Devon writes that folding it in "would mean also deciding whether to state the 8-second duration as an AC, which starts to feel like a fifth edit rather than a small consistency pass." There's no deciding involved — `spec.md` Requirement 2 already pins both facts as settled: the literal string `"Link copied"` (no "e.g.") and the 8-second auto-clear, "following the existing auto-clearing inline banner convention (`MemberManagement.tsx`)." That's the same shape as items 1-4: a decision that's already final, just not yet transcribed. Devon's own assessment argues this exact point about the other four items and I agree with the argument — it just seems to have been set aside here for reasons that don't actually apply.

This also isn't a fresh concern on my part. `propose-review-ba.md` §1 was me pushing back on exactly this shape of deferral — a real, closed gap in the use-case document that had been "correctly deferred as separate follow-up work" across two documents with no tracking artifact, and I called that pattern out by name as the mechanism through which "edge case discovered late becomes a scope dispute" actually happens. A prose note in `assess.md` that nobody is on the hook to act on is a step better than exploration-notes-only (at least it's visible to whoever reads this change), but it isn't a tracking issue, and Devon isn't proposing to file one for it either.

**My recommendation:** fold it in as a fifth edit to Main Flow step 4, since the replacement text is fully known and zero-risk (matches Devon's own assessment of the other four items' risk level):

**Current:**
```
4. The application displays a brief confirmation (e.g., "Link copied") to acknowledge the action.
```

**Proposed:**
```
4. The application displays an inline confirmation banner reading exactly "Link copied," which clears automatically after 8 seconds.
```

If the implementer prefers to keep this change scoped strictly to the four named points, that's a defensible call too — but in that case it needs a filed tracking issue mirroring #164's pattern, not just a paragraph in `assess.md`, per the same standard I held the prior proposal to. Leaving it as an unticketed note is the one outcome I'd actually object to.

---

## 3. Confirmed: no design decision anywhere in this change

I read the same four ground-truth sources Devon cites (`spec.md`, `exploration-notes.md`, `explore-review-ba.md`, `propose-review-ba.md`) independently before checking the proposed text against them, not after. Every one of the four edits is a transcription of a decision I can point to a specific settled requirement or scenario for. The one place a live decision *could* have leaked back in — the draft-state copy-button direction, given that my own original recommendation was overridden — was handled correctly, using the shipped answer rather than my superseded one. Light track is the right call. Confirmed, same as Devon's own conclusion, for the same reasons.

---

## 4. Summary for whoever picks this up next

1. **Items 1-3 and the AC rewrite in item 4: approved as written.** Verified against `spec.md` and, for the component-naming claims, against `DraftSessionHost.tsx` directly.
2. **Fold the banner-text tightening in as a fifth edit** (text proposed above in §2) rather than leaving it as a flagged-only note — the reason given for excluding it doesn't apply, since both facts it would state are already settled in `spec.md` Requirement 2, not newly decided. If it's deferred anyway, it needs a filed tracking issue, not a prose flag.
3. No new design or architectural decision surfaced anywhere in this review. Proceed on the light track as recommended.
