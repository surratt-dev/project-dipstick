## Why

Facilitators have always had to share the session join link by hand — that's not new. What's missing is that the application doesn't help them do it: no copy control exists anywhere in the frontend today, and worse, exploration for this change found that the one place in the codebase that *does* render a join link with any polish (`SessionLobbyPage`) is unreachable by any real navigation path during the "waiting for participants" window. A Facilitator running a session right now hits `DraftSessionHost`'s `live-readiness-view` branch and sees only "The room is open. Session status: X." — no link, no way to copy one. This is exactly the failure mode worth catching before it ships: a feature that would pass every test written against the wrong component while remaining functionally invisible to the person actually running the session. Closing this gap where the Facilitator actually is — not where the component name suggests they'd be — is what makes this change worth doing now, and it's a small, self-contained piece of plumbing for a ritual step the app already assumes happens.

## What Changes

- Add a join-link display with a copy-to-clipboard control to `DraftSessionHost`'s `live-readiness-view` branch (`lobby` status and later), which currently shows no join link at all.
- Extend the existing `draft-control-view` join-link block (currently text-only with a "not yet joinable" badge) with the same copy control, so a Facilitator can stage their share message before opening the room.
- Establish the app's first clipboard-write pattern: `navigator.clipboard.writeText()` on success shows an auto-clearing "Link copied" confirmation; on API-unavailability *or* a rejected write promise, the control falls back to selectable link text with no confirmation shown (the two failure modes are treated identically — no false-positive confirmation on a copy the application cannot verify).
- Apply a visual-prominence rule: once the link is joinable (`lobby`+), it renders in full-emphasis text, not the muted/gray treatment `draft`'s "not yet joinable" styling uses today — that muted styling stays reserved for signaling non-joinability, not as the link's default look.
- **Not in scope:** `SessionLobbyPage` is not modified by this change. Its `lobby` branch is real but unreachable by any current navigation path (confirmed against `join-link`'s "Session-aware join link landing" requirement, which only redirects to `/session/:sessionId` on `active` status, and by exhaustive grep of frontend navigation call sites). That routing gap is tracked separately as [GitHub issue #164](https://github.com/surratt-dev/project-dipstick/issues/164) and is not fixed here.
- **Not in scope:** the source use case (`requirements/use cases/02 - Session Setup - Use Cases.md`, "Copy Session Join Link") is not edited by this change. It still has a stale, unmapped precondition, an unmeasurable "displayed prominently" AC, no Alternate Flow for a rejected `writeText()` promise, and no mention of `draft`-state copy availability — all four resolved by inference in `exploration-notes.md` and this proposal's `specs/join-link-copy/spec.md`, but never propagated back to the source document. Tracked separately as [GitHub issue #165](https://github.com/surratt-dev/project-dipstick/issues/165) and is not fixed here.

## Capabilities

### New Capabilities
- `join-link-copy`: The join-link display and copy-to-clipboard affordance rendered in `DraftSessionHost`'s `draft-control-view` and `live-readiness-view` branches — link visibility rules across `draft`/`lobby`+ status, the copy button, clipboard success/failure/fallback handling, confirmation banner content and timing, and visual prominence once the link is joinable.

### Modified Capabilities
*(none — `session-creation`'s existing "Draft-status landing after session creation" requirement already permits the draft control view to display the join link; this change adds a copy affordance alongside it without altering that requirement's existing scenarios. `join-link`'s token generation, validation, and session-aware-landing behavior are unchanged.)*

## Impact

- **Frontend:** `packages/frontend/src/pages/DraftSessionHost.tsx` — both the `draft-control-view` and `live-readiness-view` branches. New shared clipboard-copy component/hook (first of its kind in this codebase — no existing wrapper to extend). No backend changes: `FacilitatorSessionStateResponse` already carries `joinToken` unconditionally for both statuses.
- **Out of scope, tracked separately:** `SessionLobbyPage` routing gap ([#164](https://github.com/surratt-dev/project-dipstick/issues/164)); source use-case document staleness ([#165](https://github.com/surratt-dev/project-dipstick/issues/165)).
- **No impact** on `TeamPage`, the join-link backend routes (`join-links.ts`, `executeJoinFlow`), or the Engineer-side join experience.
