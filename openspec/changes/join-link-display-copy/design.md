## Context

`DraftSessionHost` (`packages/frontend/src/pages/DraftSessionHost.tsx`) is the real, refresh-safe route (`/team/:teamId/session/:sessionId`) a Facilitator lands on after creating a session and stays on through `draft` → `lobby` → later states. It already fetches `GET .../facilitator-state` on mount, which returns `joinToken` unconditionally regardless of session status (`FacilitatorSessionStateResponse`, `packages/shared/src/types/team-content-access.ts:226`). Today:
- `data.currentSessionState === "draft"` renders `draft-control-view`, which shows the join link as muted, badge-marked text (`data-testid="draft-join-link-not-joinable"`) — no copy button.
- Any other status renders `live-readiness-view`, which shows only `"The room is open. Session status: {status}."` — no join link at all.

Exploration for this change (`exploration-notes.md`) traced the real navigation graph and confirmed that `SessionLobbyPage`, the only other component in the codebase with a built `lobby`-status join-link-adjacent view, is unreachable by any current navigation path during the `lobby` window — nothing routes to `/session/:sessionId` until a session reaches `active` status (per `join-link`'s "Session-aware join link landing" requirement). `live-readiness-view` is therefore the only real surface to build on; this design targets it exclusively.

No clipboard-handling code exists anywhere in the frontend today (`grep -rl clipboard packages/frontend/src` returns nothing). This change establishes that pattern for the first time, so its shape is likely to be reused (e.g., the deferred join-link revocation UI named in `join-link`'s spec will likely want the same copy affordance).

## Goals / Non-Goals

**Goals:**
- Render the join link with a working copy-to-clipboard control in `live-readiness-view` (currently entirely absent there).
- Extend the same copy control to `draft-control-view` so a Facilitator can stage a share message before opening the room.
- Establish a clipboard-copy pattern (success confirmation, unavailable/rejected fallback, no false positives) reusable by future features.
- Fix the visual weight of the joinable-state link so it reads as the primary actionable element, not an inherited footnote style.

**Non-Goals:**
- Modifying `SessionLobbyPage` or fixing its routing gap — tracked separately as [GitHub issue #164](https://github.com/surratt-dev/project-dipstick/issues/164).
- Any change to join-link token generation, validation, or the session-aware-landing redirect rule (`join-link` capability) — this change is purely additive display/copy UI on the Facilitator-facing surface.
- QR codes, in-app link sharing/notifications, or any other alternate distribution mechanism (already excluded by the source use case's Out of Scope section).
- A general-purpose toast/notification system — the confirmation reuses the existing inline auto-clearing banner convention.

## Decisions

### D1: Build a shared `useCopyToClipboard` hook, not a component-local `onClick` handler

Both `draft-control-view` and `live-readiness-view` need identical copy behavior (feature-detect → write → success/failure branching → confirmation state), so the logic lives in one hook (`packages/frontend/src/hooks/useCopyToClipboard.ts`) rather than being duplicated per view. It returns `{ copy(text): Promise<void>, status: "idle" | "copied" | "unavailable" }`. Both `DraftSessionHost` branches call the same hook with the same `joinToken`-derived URL. This is the first clipboard-handling code in the app; keeping it in one place is what makes it reusable for the deferred link-revocation UI later, per the exploration notes' framing.

**Alternative considered:** inline the logic directly in `DraftSessionHost` since it's currently the only consumer. Rejected — the two branches (`draft-control-view`, `live-readiness-view`) already need the identical behavior today, not hypothetically later, so the duplication cost is immediate, not speculative.

### D2: Feature-detect via `typeof navigator.clipboard?.writeText === "function"`, never `document.execCommand('copy')`

`execCommand('copy')` can report success without the application being able to verify the copy actually happened, which would violate the "no confirmation on fallback" requirement. The hook feature-detects `navigator.clipboard.writeText` at call time; if absent, it never attempts a copy and never shows a success confirmation. If present but the call rejects (permission denied, insecure context, etc.), the hook treats that identically to "unavailable" — same fallback state, same suppressed confirmation. This is one status value (`"unavailable"`), not two, by design: the UI must not be able to accidentally special-case a rejection into a false-positive path.

**Alternative considered:** a three-state model (`idle`/`copied`/`api-missing`/`write-failed`) with the same suppressed-confirmation behavior for both failure cases. Rejected as unnecessary complexity — both reviewers (BA and Facilitator personas) confirmed the same UI treatment applies to both, so a single `"unavailable"` state is sufficient and less error-prone to implement correctly.

### D3: Copy button and badge are independent — badge signals joinability, button signals copy-affordance

The `draft`-status badge (`data-testid="draft-join-link-badge"`, "(not yet joinable)") stays exactly as-is. The copy button is added alongside it in both states, and its presence/behavior is identical in `draft` and `lobby`+ — same hook, same confirmation, same fallback. Nothing about the copy control itself changes based on session status; only the badge's presence differs.

**Alternative considered:** withholding the copy button entirely during `draft` (the exploration's original default). Superseded during review — see `exploration-notes.md` §3 for the facilitator-workflow rationale (staging a Slack message before opening the room).

### D4: Confirmation banner reuses `MemberManagement.tsx`'s inline auto-clearing pattern, with an 8s clear instead of 5s

`MemberManagement.tsx`'s role-change confirmation (`role="status"`, `aria-live="polite"`, `setTimeout`-based auto-clear) is the established convention for "acknowledge a successful action without a toast library." This change reuses that shape verbatim — `role="status"`, `aria-live="polite"`, literal text `"Link copied"` — but extends the auto-clear window to 8 seconds. `MemberManagement`'s 5s assumes the user is watching the screen after the action; this control's actual usage pattern is copy → alt-tab to Slack/email → paste → return, which can exceed 5 seconds before the user looks back. 8s is a directional fix for that gap, not a re-litigation of `MemberManagement`'s own timing.

**Alternative considered:** no auto-clear, dismiss-on-next-copy only. Rejected — leaves a stale confirmation on screen indefinitely if the Facilitator never triggers another copy, which drifts toward the "software feels like it's running a process" concern this project's SME (Devon) explicitly watches for.

### D5: Joinable-state link styling breaks from `draft`'s muted treatment; badge keeps its own style

`draft-control-view`'s existing `<p data-testid="draft-join-link-not-joinable" style={{ color: "#9e9e9e" }}>` treatment is deliberately de-emphasized and stays exactly as-is while the badge is present. Once the session reaches `lobby`+ (badge absent), the link renders in the page's default body text color — full emphasis, matching its status as the primary actionable element on the page. This is a one-line style change (drop the muted color when not in `draft`), not a new visual system.

**Alternative considered:** keep the muted style everywhere for visual consistency between `draft` and `lobby`+. Rejected per facilitator-persona review — the muted treatment reads as "don't bother with this yet," which is actively wrong messaging once the link is the thing the Facilitator most needs to act on.

### D6: `SessionLobbyPage` is untouched; the routing gap is out-of-scope by design, not oversight

Confirmed via `join-link`'s "Session-aware join link landing" requirement (redirect to `/session/:sessionId` fires only on `active` status) and exhaustive grep of frontend navigation call sites: nothing routes any user to `SessionLobbyPage` during `lobby` status today. Implementing this change there would satisfy the acceptance criteria against a component nothing reaches — passing tests while remaining invisible to a real Facilitator. `live-readiness-view` is the only surface a Facilitator actually reaches during the window this use case is about. The routing gap is filed as [#164](https://github.com/surratt-dev/project-dipstick/issues/164) rather than fixed here, since resolving it is a larger, separately-risked change (touching `TeamPage`, `DraftSessionHost`'s post-advance behavior, and possibly the join-link landing rule itself).

## Risks / Trade-offs

- **[Risk] A Facilitator copies the link during `draft` and shares it before opening the room; a participant clicks it and finds it doesn't work yet.** → Mitigation: the "not yet joinable" badge is still visible next to the link when it's copied during `draft`, so the Facilitator has the same visual cue they'd have had if they'd read the link before copying. Not a new risk this change introduces — a Facilitator could already manually select and copy the muted text today; this just adds a button for the same action.
- **[Risk] 8-second auto-clear is a judgment call, not user-tested.** → Mitigation: it's a small, easily-tunable constant in one hook; not a structural commitment. Flagged in design rather than silently defaulted so it can be revisited if real usage shows it's still too short (or too long).
- **[Risk] `useCopyToClipboard` becomes a de facto shared primitive before its second real consumer exists.** → Mitigation: kept intentionally minimal (feature-detect, write, one status enum) — no speculative configuration options added for hypothetical future consumers (e.g., the deferred link-revocation UI), consistent with the project's guidance against premature abstraction.
- **[Risk] `SessionLobbyPage`'s `lobby` branch remains dead code indefinitely if #164 isn't prioritized.** → Mitigation: this change does not make that worse — the branch is already unreachable today. Filing #164 makes the gap visible and trackable instead of silently absorbed, which was the explicit ask from both reviewers.
