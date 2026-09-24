## 1. Shared clipboard hook

- [x] 1.1 Create `packages/frontend/src/hooks/useCopyToClipboard.ts` exporting a hook that returns `{ copy(text: string): Promise<void>, status: "idle" | "copied" | "unavailable" }`.
- [x] 1.2 Feature-detect via `typeof navigator.clipboard?.writeText === "function"`; if absent, `copy()` sets `status` to `"unavailable"` without attempting a write.
- [x] 1.3 On `navigator.clipboard.writeText()` success, set `status` to `"copied"`.
- [x] 1.4 On `navigator.clipboard.writeText()` rejection (caught), set `status` to `"unavailable"` — identical handling to the feature-detection-failed path, never a separate error state.
- [x] 1.5 Auto-clear `status` back to `"idle"` 8 seconds after it becomes `"copied"` (no auto-clear from `"unavailable"` — that state renders no confirmation to clear). Hold the pending timeout id in a `useRef`.
- [x] 1.6 Stacking guard: clear any existing pending timer before starting a new one on each `copy()` call, so a second copy within the 8s window resets the clock rather than letting a stale timer fire early (design-review-engineer.md Finding 2b).
- [x] 1.7 Unmount cleanup: clear the pending timer in a `useEffect` cleanup on unmount, so no `setState` runs after the consuming component unmounts (design-review-engineer.md Finding 2a).
- [x] 1.8 Unit test: `writeText` resolves → status transitions `idle` → `copied` → `idle` (after the 8s timer, using fake timers).
- [x] 1.9 Unit test: `writeText` rejects → status becomes `"unavailable"` and stays there (no auto-clear timer started).
- [x] 1.10 Unit test: `navigator.clipboard` undefined → `copy()` never calls `writeText` and status becomes `"unavailable"` immediately.
- [x] 1.11 Unit test: a second `copy()` call within the 8s window resets the clock — the first (stale) timer does not fire early and clear the banner before the second window elapses (design-review-engineer.md Finding 2b).
- [x] 1.12 Unit test: unmounting the consuming component while a clear timer is pending does not throw or trigger a `setState`-after-unmount warning (design-review-engineer.md Finding 2a). This runs against a synthetic test harness/wrapper component built for the hook in isolation — not the real `DraftSessionHost` page, which doesn't exist in this section's scope yet (that's §2/§3).

## 2. Shared join URL + `live-readiness-view` — join link and copy control

- [x] 2.1 In `packages/frontend/src/pages/DraftSessionHost.tsx`, compute the join URL once — `` `${window.location.origin}${buildJoinLinkPath(data.joinToken)}` `` (`buildJoinLinkPath` from `@dipstick/shared`) — near where `teamLabel` is already computed (`DraftSessionHost.tsx:145`), and pass that same string into both the `draft-control-view` and `live-readiness-view` branches rather than building it separately in each (design-review-engineer.md Finding 5). This is a shared prerequisite that §3.1 also depends on, not a `live-readiness-view`-only detail — do this before starting either branch. Add a join-link block to the `live-readiness-view` branch (currently only renders team label and a static "room is open" message) using this shared URL.
- [x] 2.2 Render the link in full-emphasis body text (not the `draft` branch's muted `#9e9e9e` color) — no badge (`draft-join-link-badge`) in this branch.
- [x] 2.3 Render a copy button adjacent to the link, wired to `useCopyToClipboard`.
- [x] 2.4 On `status === "copied"`, render an inline `role="status" aria-live="polite"` banner with the literal text `"Link copied"`, matching `MemberManagement.tsx`'s existing banner markup/styling convention.
- [x] 2.5 On `status === "unavailable"`, render the link as selectable text with no confirmation banner (this is the default/idle rendering too — the link is always selectable; `"unavailable"` just guarantees no false-positive banner ever appears).
- [x] 2.6 Add `data-testid` attributes for the link, copy button, and confirmation banner (e.g. `live-join-link`, `live-join-link-copy-button`, `live-join-link-copied-banner`) for test targeting.

## 3. `draft-control-view` — extend existing join-link block with copy

- [x] 3.1 Add the same copy button (reusing `useCopyToClipboard`, and the shared join URL from §2.1) adjacent to the existing `data-testid="draft-join-link"` link block in `draft-control-view`.
- [x] 3.2 Leave the existing muted styling and `data-testid="draft-join-link-badge"` badge ("This link works already — anyone who opens it before you open the room won't see a waiting screen yet.") unchanged.
- [x] 3.3 Wire the same confirmation-banner and fallback rendering used in `live-readiness-view` (§2.4–2.5) so behavior is identical across both branches — only the badge differs.
- [x] 3.4 Add matching `data-testid` attributes (e.g. `draft-join-link-copy-button`, `draft-join-link-copied-banner`).

## 4. Tests

- [x] 4.1 `DraftSessionHost.test.tsx`: copy button present and functional in `draft`-status render.
- [x] 4.2 `DraftSessionHost.test.tsx`: copy button present and functional in `lobby`-status render (currently `live-readiness-view` has no such coverage at all).
- [x] 4.3 Test: successful copy (mocked `navigator.clipboard.writeText` resolving) shows the "Link copied" banner in both branches.
- [x] 4.4 Test: `navigator.clipboard` undefined shows selectable text and never shows the confirmation banner, in both branches.
- [x] 4.5 Test: `navigator.clipboard.writeText` rejecting shows the same fallback as the undefined case (no confirmation), in both branches.
- [x] 4.6 Test: the copied URL matches `` `${window.location.origin}${buildJoinLinkPath(data.joinToken)}` `` in both branches.
- [x] 4.7 Test: `lobby`-status link does not render with the `draft` branch's muted text color or its badge (`draft-join-link-badge`, a draft-only element).
- [x] 4.8 Test: the "Link copied" banner, already showing in `draft` status, survives the transition to `lobby` (`live-readiness-view`) without resetting to idle — trigger a successful copy in `draft`, then drive the `draft`→`lobby` transition (`openTheRoom()`), and assert the banner is still shown (design.md D4).

**Note:** `specs/join-link-copy/spec.md`'s "Control persists for the full waiting window" scenario is intentionally not mapped to a discrete task above. It's an architectural property, not new behavior — the link/copy block lives in `live-readiness-view`'s standing render (§2.1–2.6), not a one-shot or dismissible element, so persistence across the `lobby` window falls out of that placement (see `design.md`). No test asserting a UI element survives for "several minutes" is meaningful, so none is added.

**Note:** `specs/join-link-copy/spec.md`'s "Manual selection always works regardless of clipboard state" scenario is likewise intentionally not mapped to a discrete task. The link is rendered as selectable text in every status by construction (§2.5, and §3.3's reuse of the same rendering) — there's no separate "manual selection" code path, interception, or `user-select` restriction added anywhere in this change, so there's no additional behavior to build or test beyond what §2.5/§3.3 already cover.

**Note:** `specs/join-link-copy/spec.md`'s prohibition on `document.execCommand('copy')` or any other unverifiable fallback is enforced by construction, not by a discrete test. Per design.md D2, `useCopyToClipboard` only ever calls `navigator.clipboard.writeText()` (§1.3–1.4) and contains no reference to `execCommand` anywhere in its implementation — there is no fallback code path that could regress into using it.

## 5. Verification

- [x] 5.1 Run the full frontend test suite and confirm no regressions in existing `DraftSessionHost.test.tsx` and `MemberManagement.test.tsx` coverage.
- [ ] 5.2 Manually verify in a browser: create a session, confirm copy works and shows "Link copied" in `draft` status, click "Open the room," confirm the link becomes full-emphasis and copy still works in `lobby` status without a page reload.
- [x] 5.3 Confirm `SessionLobbyPage` is untouched by this change (no diff in that file) and that issue [#164](https://github.com/surratt-dev/project-dipstick/issues/164) remains open and referenced from `design.md`.

**Named gap:** §1.12's unmount-cleanup test exercises the isolated hook against a synthetic harness, not the real `DraftSessionHost` page. Nothing in §4 independently re-verifies unmount safety against the actual page render (e.g., navigating away from `DraftSessionHost` mid-timer). This is an accepted gap for a change this size, not a task to add — flagged here so it isn't assumed to be covered end-to-end (tasks-review-architect.md, Observation 3).
