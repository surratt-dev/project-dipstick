# Engineering Review — `join-link-display-copy` design.md

**Reviewer:** Marcus Oyelaran (Full Stack Engineer)
**Verdict:** Implementable as scoped. One factual error to fix before build, two real bugs to design around (not just note as risks), and one testid gap that needs to be closed before anyone can write tests against this. Nothing here requires re-scoping the change.

---

## 1. Factual error: cited pattern-source file path is wrong

Design.md's Context section and D4 cite `MemberManagement.tsx` as the pattern source, and the task brief for this review names it as `packages/frontend/src/pages/MemberManagement.tsx`. It's actually at `packages/frontend/src/components/MemberManagement.tsx` — it's a component, not a page (`TeamPage` renders it, it doesn't route to it directly). This doesn't block implementation since the file is easy to find either way, but fix the path before this doc is used as an implementation reference — a wrong path in a design doc that cites a specific pattern to copy is exactly the kind of small rot that costs someone real time later.

## 2. The pattern being copied has two real bugs — don't copy them verbatim

I read the actual `MemberManagement.tsx` auto-clear code (lines 186–189):

```ts
setTimeout(() => {
  setRoleChangeState({ status: "idle" });
}, 5000);
```

D4 says this change "reuses that shape verbatim... but extends the auto-clear window to 8 seconds." Verbatim reuse means inheriting two bugs that are latent-but-harmless in `MemberManagement` and would not be harmless in `useCopyToClipboard`:

**2a. No timer cleanup on unmount.** There's no `useRef` holding the timeout id and no cleanup effect. In `MemberManagement`, the component this timer belongs to is durable for the interaction — a facilitator manages roles and stays on the page. `DraftSessionHost` is different: it renders inside a route (`/team/:teamId/session/:sessionId`), and a facilitator can navigate away (back button, or clicking through elsewhere) while a "Link copied" timer is still pending. When it fires, `setState` runs on an unmounted component — a leak today, and depending on React version, a console warning that erodes trust in the app's error signal. Since D1 explicitly frames this hook as the first of a reusable pattern, this is the moment to fix it, not propagate it into shared infrastructure. Fix: hold the timer id in a `useRef`, clear it in a `useEffect` cleanup, and clear/replace it on each new copy.

**2b. No stacking guard — a double-click can defeat the 8s fix D4 exists to make.** If the timer id isn't cleared on a new copy, two rapid copy clicks schedule two independent timers. Sequence: click copy at t=0 (timer A set for t=8s), click copy again at t=3 (status re-confirms, timer B set for t=11s) — timer A still fires at t=8 and clears the banner, 5 seconds after the *second* click, not 8. This directly undermines the reason D4 exists (facilitator alt-tabs to Slack and comes back late) — the exact scenario the second click is likely to happen in, since a facilitator unsure whether the first click landed will often click again. Same fix as 2a: clearing/replacing the pending timeout on every new copy call fixes both.

Neither of these needs a design change — they're implementation details inside `useCopyToClipboard` — but they should be called out explicitly as acceptance criteria for the hook (e.g., a unit test: "second copy within the window resets the 8s clock and a stale timer does not fire early"), not left to be caught or missed during implementation. Recommend adding this to `tasks.md` as an explicit test case, not just "write unit tests for the hook."

## 3. Missing: no `data-testid` conventions specified for the new elements

The existing code has `data-testid="draft-join-link-not-joinable"` and `data-testid="draft-join-link-badge"`. Design.md and spec.md describe behavior precisely but name zero new testids — not for the copy button, not for the confirmation banner, not for the live-readiness-view's join link block. Given this codebase's existing convention (every stateful/interactive element gets a stable testid) and that Marcus's own standard is unit/component tests ship with the feature, this is a real gap: whoever implements this will invent testids ad hoc, and whoever writes the tests may invent different ones if it happens in parallel. Recommend pinning these down before implementation, e.g.:
- `join-link-copy-button` (used in both branches)
- `join-link-copy-confirmation` (the "Link copied" banner)
- `live-readiness-join-link` (the new link text in `live-readiness-view`, mirroring `draft-join-link-not-joinable`'s naming)

This is a five-minute addition to the design or spec, not a rework.

## 4. Hidden coupling: what happens to copy state across the `draft` → `lobby` transition?

`openTheRoom()` (`DraftSessionHost.tsx:112-118`) transitions `currentSessionState` via `setLoadState` in place — no remount, no navigation. `DraftSessionHost` swaps from returning `draft-control-view`'s JSX to `live-readiness-view`'s JSX within the same component instance. If `useCopyToClipboard` is invoked once at the `DraftSessionHost` level (not re-instantiated per branch, per D1's "both branches call the same hook"), its `status` state survives that transition.

Concrete scenario: facilitator copies the link while in `draft` status, sees "Link copied," then within the 8s window clicks "Open the room" → confirm. The view swaps to `live-readiness-view` mid-banner. Does "Link copied" carry over and render in the new view for the remainder of the window? Design doesn't say. It's probably harmless (the copied text is in fact still the correct URL — D1/spec confirm the URL is identical across both states), but it's the kind of boundary condition that should be a decided behavior, not an accident of shared hook state. Recommend design explicitly says one of: (a) banner is allowed to persist across the transition since the copied content is unchanged and this is correct, or (b) the hook resets to `idle` on the transition. I'd default to (a) — it's simpler, and per D1's own URL-identity guarantee it isn't actually a false statement — but it should be a stated decision, not silent.

## 5. Minor: URL derivation duplicated across branches

Proposal and spec both give the URL formula as `${window.location.origin}/join/${joinToken}` and D1 says both branches call the hook "with the same `joinToken`-derived URL" — implying the string is built twice, once per branch. Not a real risk (it's one line), but since `DraftSessionHost` already computes `teamLabel` once above both branches (`DraftSessionHost.tsx:145`) and shares it, the join URL should follow the same convention: compute once near `teamLabel`, pass the same string into both render paths. Worth a one-line note in the design so whoever implements doesn't duplicate the template literal.

## 6. What's solid

- **D2's single `"unavailable"` status collapsing feature-detection-failure and write-rejection** is the right call — matches the spec's explicit requirement that both cases get identical treatment, and avoids a branch in the UI that could accidentally diverge later.
- **D6's decision to leave `SessionLobbyPage` alone** is correct and well-evidenced — I confirmed independently that `live-readiness-view` is the only reachable surface (`DraftSessionHost.tsx:147-165` is the only branch rendering session status ≥ lobby that any router path reaches). Filing #164 instead of scope-creeping this change into a routing fix is the right boundary.
- **`joinToken: string` (non-optional) on `FacilitatorSessionStateResponse`** (`packages/shared/src/types/team-content-access.ts:226`) confirms the design's load-bearing claim that no backend change is needed — verified directly against the shared type, not just asserted.
- **D3's independence of badge vs. button** is clean and matches existing code structure — the badge is already a separate `<span>` inside the paragraph (`DraftSessionHost.tsx:185`), so adding a sibling button doesn't touch the badge's existing test coverage.
- No backend/API-layer changes, no new authorization surface — appropriately scoped as pure frontend/display.

## Recommendation

Fix #1 (path) is trivial. Fix #2 (timer cleanup + stacking guard) should be stated as explicit hook behavior/test cases in the design or tasks before implementation, not discovered during code review of the PR. Fix #3 (testids) should be pinned in spec.md or design.md so tests and implementation agree on names. Fix #4 should get one sentence resolving the ambiguity. None of these change the shape of the change or its scope — cleared to implement once these are addressed.
