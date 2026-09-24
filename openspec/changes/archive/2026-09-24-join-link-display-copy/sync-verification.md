# Sync verification: join-link-display-copy

**Result: clean.** No drift found between the synced specs and shipped code.

## Verified matches

- **URL path**: both specs state `${origin}${buildJoinLinkPath(joinToken)}` = `${origin}/api/join/${token}`. `buildJoinLinkPath` (packages/shared/src/types/auth.ts:64) returns `/api/join/${token}`. Test assertions confirm this exact string (DraftSessionHost.test.tsx:60, :292, :299).
- **Badge text**: both specs (and session-creation/spec.md:131) require "This link works already — anyone who opens it before you open the room won't see a waiting screen yet." with no "not yet joinable" wording. Matches DraftSessionHost.tsx:231 verbatim, and test asserts both the positive match and the negative regex (test.tsx:61-64).
- **Testids**: `draft-join-link-badge`, `draft-join-link-copy-button`, `live-join-link`, `live-join-link-copy-button`, `draft-join-link`, `live-readiness-view`, `draft-control-view` all present in code and exercised by tests, matching the main spec's citations.
- **Banner text/styling**: "Link copied" exact text, `role="status"` `aria-live="polite"` (DraftSessionHost.tsx:166-167), matches main spec Req 2 (line 41).
- **8s timer, stacking guard, unmount cleanup**: `useCopyToClipboard.ts` implements `CONFIRMATION_CLEAR_MS = 8000`, clears any pending timer before starting a new one (stacking guard, lines 43-46), and clears on unmount (lines 34-40) — matches main spec Req 2's SHALL clauses.
- **Draft→lobby persistence**: `copy`/`copyStatus` lifted to component level (DraftSessionHost.tsx:66), so the banner survives the in-place `draft`→`lobby` transition. Covered by test 4.8 (test.tsx:315-334) and main spec's "Banner survives the draft-to-lobby transition" scenario.
- **session-creation/spec.md** (lines 131, 165-173) agrees with the corrected badge text and the "no caution on live view" behavior — no contradiction.

## Minor observation (not drift, not blocking)

The main spec's stacking-guard/timer-reset scenario ("a second copy within the 8-second window resets the timer") and the 8-second auto-clear scenario are implemented correctly in `useCopyToClipboard.ts` but have no fake-timer test exercising them directly in `DraftSessionHost.test.tsx` — the test file never calls `vi.useFakeTimers()`. Spec and code agree; only test coverage for that specific timing edge is thin. Not a spec/code discrepancy, so not counted as drift.

## Note on delta spec vs. main spec

The change's delta spec (specs/join-link-copy/spec.md) is narrower than the newly-created main spec — it omits the `role="status"`/`aria-live="polite"` attribute mention, the stacking-guard/unmount-cleanup sentence, and two scenarios (second-copy timer reset, banner survives transition) that the main spec includes. This isn't a contradiction (nothing in the delta is wrong), just less complete than the main spec/code. Since the main spec is now the canonical synced artifact, this is cosmetic and doesn't block archiving.
