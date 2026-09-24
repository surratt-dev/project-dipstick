## 1. Shared clipboard hook

- [ ] 1.1 Create `packages/frontend/src/hooks/useCopyToClipboard.ts` exporting a hook that returns `{ copy(text: string): Promise<void>, status: "idle" | "copied" | "unavailable" }`.
- [ ] 1.2 Feature-detect via `typeof navigator.clipboard?.writeText === "function"`; if absent, `copy()` sets `status` to `"unavailable"` without attempting a write.
- [ ] 1.3 On `navigator.clipboard.writeText()` success, set `status` to `"copied"`.
- [ ] 1.4 On `navigator.clipboard.writeText()` rejection (caught), set `status` to `"unavailable"` — identical handling to the feature-detection-failed path, never a separate error state.
- [ ] 1.5 Auto-clear `status` back to `"idle"` 8 seconds after it becomes `"copied"` (no auto-clear from `"unavailable"` — that state renders no confirmation to clear).
- [ ] 1.6 Unit test: `writeText` resolves → status transitions `idle` → `copied` → `idle` (after the 8s timer, using fake timers).
- [ ] 1.7 Unit test: `writeText` rejects → status becomes `"unavailable"` and stays there (no auto-clear timer started).
- [ ] 1.8 Unit test: `navigator.clipboard` undefined → `copy()` never calls `writeText` and status becomes `"unavailable"` immediately.

## 2. `live-readiness-view` — join link and copy control

- [ ] 2.1 In `packages/frontend/src/pages/DraftSessionHost.tsx`, add a join-link block to the `live-readiness-view` branch (currently only renders team label and a static "room is open" message), using `data.joinToken` (already destructured for the draft branch, now also read here).
- [ ] 2.2 Render the link in full-emphasis body text (not the `draft` branch's muted `#9e9e9e` color) — no "not yet joinable" badge in this branch.
- [ ] 2.3 Render a copy button adjacent to the link, wired to `useCopyToClipboard`.
- [ ] 2.4 On `status === "copied"`, render an inline `role="status" aria-live="polite"` banner with the literal text `"Link copied"`, matching `MemberManagement.tsx`'s existing banner markup/styling convention.
- [ ] 2.5 On `status === "unavailable"`, render the link as selectable text with no confirmation banner (this is the default/idle rendering too — the link is always selectable; `"unavailable"` just guarantees no false-positive banner ever appears).
- [ ] 2.6 Add `data-testid` attributes for the link, copy button, and confirmation banner (e.g. `live-join-link`, `live-join-link-copy-button`, `live-join-link-copied-banner`) for test targeting.

## 3. `draft-control-view` — extend existing join-link block with copy

- [ ] 3.1 Add the same copy button (reusing `useCopyToClipboard`) adjacent to the existing `data-testid="draft-join-link-not-joinable"` link block in `draft-control-view`.
- [ ] 3.2 Leave the existing muted styling and `data-testid="draft-join-link-badge"` "(not yet joinable)" badge unchanged.
- [ ] 3.3 Wire the same confirmation-banner and fallback rendering used in `live-readiness-view` (§2.4–2.5) so behavior is identical across both branches — only the badge differs.
- [ ] 3.4 Add matching `data-testid` attributes (e.g. `draft-join-link-copy-button`, `draft-join-link-copied-banner`).

## 4. Tests

- [ ] 4.1 `DraftSessionHost.test.tsx`: copy button present and functional in `draft`-status render.
- [ ] 4.2 `DraftSessionHost.test.tsx`: copy button present and functional in `lobby`-status render (currently `live-readiness-view` has no such coverage at all).
- [ ] 4.3 Test: successful copy (mocked `navigator.clipboard.writeText` resolving) shows the "Link copied" banner in both branches.
- [ ] 4.4 Test: `navigator.clipboard` undefined shows selectable text and never shows the confirmation banner, in both branches.
- [ ] 4.5 Test: `navigator.clipboard.writeText` rejecting shows the same fallback as the undefined case (no confirmation), in both branches.
- [ ] 4.6 Test: the copied URL matches `${window.location.origin}/join/${data.joinToken}` in both branches.
- [ ] 4.7 Test: `lobby`-status link does not render with the `draft` branch's muted text color / "not yet joinable" badge.

**Note:** `specs/join-link-copy/spec.md`'s "Control persists for the full waiting window" scenario is intentionally not mapped to a discrete task above. It's an architectural property, not new behavior — the link/copy block lives in `live-readiness-view`'s standing render (§2.1–2.6), not a one-shot or dismissible element, so persistence across the `lobby` window falls out of that placement (see `design.md`). No test asserting a UI element survives for "several minutes" is meaningful, so none is added.

## 5. Verification

- [ ] 5.1 Run the full frontend test suite and confirm no regressions in existing `DraftSessionHost.test.tsx` and `MemberManagement.test.tsx` coverage.
- [ ] 5.2 Manually verify in a browser: create a session, confirm copy works and shows "Link copied" in `draft` status, click "Open the room," confirm the link becomes full-emphasis and copy still works in `lobby` status without a page reload.
- [ ] 5.3 Confirm `SessionLobbyPage` is untouched by this change (no diff in that file) and that issue [#164](https://github.com/surratt-dev/project-dipstick/issues/164) remains open and referenced from `design.md`.
