# Engineering Review — `join-link-display-copy` design.md (re-review, post-#166)

**Reviewer:** Marcus Oyelaran (Full Stack Engineer)
**Verdict:** Cleared to implement. All four original findings are resolved, and the #166 token/URL reality is accurately reflected. No blocking issues.

---

## Finding 1 (path citation) — RESOLVED

Design.md line 51 now cites `packages/frontend/src/components/MemberManagement.tsx:186-189 — a component, not a page`. Verified against the actual file: lines 186-189 are exactly the `setTimeout(() => { setRoleChangeState({ status: "idle" }); }, 5000);` block. Path, line range, and the "component not page" clarification are all correct.

## Finding 2 (timer cleanup + stacking guard) — RESOLVED

D4 (design.md:51-61) now states both fixes explicitly and ties them to my original finding by name. Tasks.md operationalizes them as implementation steps, not just prose:
- 1.5: hold pending timeout id in a `useRef`.
- 1.6: stacking guard — clear existing timer before starting a new one on `copy()` (Finding 2b).
- 1.7: unmount cleanup via `useEffect` cleanup (Finding 2a).
- 1.11 / 1.12: dedicated unit tests for the stacking-reset behavior and the no-`setState`-after-unmount behavior.

This is exactly the fix I recommended (hold ref, clear/replace on each call, clear on unmount), and it's scoped to the new `useCopyToClipboard` hook rather than propagated from `MemberManagement`'s buggy pattern — D4 is explicit that this hook does *not* reuse the source pattern verbatim, only its visual/aria shape. `packages/frontend/src/hooks/` doesn't exist yet, consistent with this being pre-implementation; nothing here to verify against running code.

## Finding 3 (testid conventions) — RESOLVED

D1 (design.md:37) pins six testids: `draft-join-link-copy-button`, `draft-join-link-copied-banner`, `live-join-link`, `live-join-link-copy-button`, `live-join-link-copied-banner`, and `live-readiness-view`'s existing container. Tasks 2.6 and 3.4 reference the same names. I checked these against every existing testid in `DraftSessionHost.tsx` (`draft-join-link`, `draft-join-link-badge`, `draft-control-view`, `live-readiness-view`, `draft-session-host-error`, `draft-last-session-context`, `advance-error`, `open-the-room*`, `new-team-landing-acknowledgment`) — no collisions, and the naming mirrors the existing `draft-join-link`/`draft-join-link-badge` convention as I suggested.

## Finding 4 (draft→lobby transition persistence) — RESOLVED

D4's final paragraph (design.md:59) makes this an explicit, argued decision rather than leaving it silent: since the hook is invoked once at the `DraftSessionHost` level and both branches read the same `status`, the "Link copied" banner persists across `openTheRoom()`'s in-place `setLoadState` transition, and the design states this is correct because the copied URL is identical in both states. This is option (a) from my original review, which I said I'd default to. No reset-on-transition logic is added, matching the decision.

## Token/URL reality — accurately reflected

Verified independently:
- `DraftSessionHost.tsx:184` builds the link exactly as cited: `` `${window.location.origin}${buildJoinLinkPath(data.joinToken)}` ``, and imports `buildJoinLinkPath` from `@dipstick/shared` (line 3).
- `buildJoinLinkPath` (`packages/shared/src/types/auth.ts:63-65`) returns `/api/join/${token}` — confirmed.
- `FacilitatorSessionStateResponse.joinToken: string` at `packages/shared/src/types/team-content-access.ts:227`, with the JSDoc at lines 218-226 confirming it's sourced from `join_links` via get-or-create and is non-optional/always-populated — confirmed, matches design.md's Context section claim word-for-word.
- `teamLabel` computation cited at `DraftSessionHost.tsx:145` and `openTheRoom()` at lines 112-118 — both line citations are accurate.

Design.md correctly stops treating the link as unverified/non-functional and correctly scopes the remaining risk (early-click lands on an incomplete `lobby` UX, not a dead link) to the already-filed #164, which D6 leaves out of scope for the same reasons as my original review accepted.

## Recommendation

Cleared to implement. Nothing in the revision reopens D1/D2/D5/D6, and the four items I flagged are now correctly and specifically resolved in both design.md and tasks.md, with line-level citations that check out against current `main`. Proceed to build against tasks.md as written.
