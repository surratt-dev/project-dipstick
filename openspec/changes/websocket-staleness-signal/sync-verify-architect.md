# Sync Verification — Solution Architect Review

Reviewer: Ingrid Sollenberger (Solution Architect). Scope per instructions: verify no drift between Marcus Delgado's spec-sync output and the shipped code, and confirm the two corrections he describes are accurately worded. I read the sync notes, both spec files in full, `connectionHealth.ts`, `ConnectionStatusBanner.tsx`, and `FacilitatorReadinessGrid.tsx` line by line, cross-referenced `design.md`'s Decisions, and checked `gate6-facilitator-signoff.md` and `tasks.md` Group 6 for the gate-status claim. I did not modify any spec, tasks.md, or design.md.

## Verdict: not clean — one finding, moderate severity

The two corrections Marcus describes are accurately worded and fully corroborated by the underlying evidence. But his claim that these were the *only* gaps is incorrect: the delta spec is missing two requirement-level behaviors that are genuinely designed (named as Decisions in `design.md`), genuinely implemented in `connectionHealth.ts`, and — correctly — present in the new main spec he wrote. He carried them into the main spec without carrying them into the delta spec first, and without noting the discrepancy in his sync notes.

## Finding: Delta spec is missing two designed, implemented behaviors that the main spec now states

`diff` between `openspec/changes/websocket-staleness-signal/specs/websocket-staleness-signal/spec.md` (delta) and `openspec/specs/websocket-staleness-signal/spec.md` (main) shows more differences than the two corrections sync-notes.md describes:

**1. `reauth-required` sticky/terminal behavior (design.md Decision D1c).**
Main spec adds to the "Legitimately-disclosed re-authentication-required state" requirement: *"Once entered, `reauth-required` SHALL be sticky and terminal for the lifetime of a given connection-health instance: any pending retry timer SHALL be cleared synchronously on entry, and no subsequent close or error event of any code SHALL be processed once this state is active."* — plus a new scenario, "A close arriving after reauth-required is already active is a no-op." Neither the sentence nor the scenario exists in the delta spec.

This is real, shipped behavior. `connectionHealth.ts`:
- `handleTerminalEvent` (line 213): `if (stateRef.current === "reauth-required") return;` — checked first, before the `REAUTH_GRACE_EXPIRED_CLOSE_CODE` check or the disclosure-blind path.
- `handleMessageEvent` (line 231) and `handleOpenEvent` (line 199) carry the same guard.
- `design.md` line 73 names this "D1c — `reauth-required` is a sticky, terminal state (race guards)" and documents the exact race (a stray retry timer or a delayed socket-close arriving after the message already transitioned state) this guards against.

**2. Floor-timer cancellation on early recovery (design.md Decision D3a).**
Main spec adds to the "Uniform timing floor" requirement: *"A successful reconnect that completes before the floor elapses SHALL cancel the pending floor timer outright — the state SHALL NOT transition to `unknown-reconnecting` for that episode at all."* — plus a new scenario, "An early recovery before the floor elapses is invisible." Neither exists in the delta spec.

Also real, shipped behavior. `connectionHealth.ts`'s `handleOpenEvent` (line 198-206) calls `clearFloorTimer()` before transitioning to `connected`, and the code comment at line 186-189 references this exact decision. `design.md` line 140 names it "D3a — Early recovery before the timing floor elapses."

**Why this matters:** the delta spec is the artifact `opsx:sync` is supposed to reconcile against the main spec and the code. Marcus's own sync-notes framing — "the delta spec already matched the implementation closely... all... accurate to the code as it stands," with exactly two named gaps — is not accurate as stated. Two more designed, shipped, CI-tested behaviors are absent from the delta spec entirely; he correctly carried them into the main spec (they are worded accurately there, matching both `design.md` and the code) but left the delta spec silently incomplete and didn't flag the discrepancy. A future reader diffing the delta spec against the main spec for this change would see unexplained new content with no record of why.

**Recommendation:** either (a) add these two passages and their scenarios to the delta spec so it matches what was actually carried forward, or (b) if the delta spec is being treated as a frozen historical artifact of the original proposal rather than a live sync target, say so explicitly in sync-notes.md rather than asserting parity that doesn't hold. I have not made this edit myself, per instructions — flagging for Marcus or for whoever owns delta-spec maintenance in this workflow.

## Everything else checked clean

**The two corrections Marcus describes, verified accurate:**
- **Placeholder marker scenario:** `FacilitatorReadinessGrid.tsx` renders the marker as a bare `"○"` glyph in a sibling `<span>` with no CSS class, no color, no spacing styling — JSX's whitespace collapsing means it renders adjacent to the label with no visible gap, matching "glued directly to the row label" in both spec files. This is corroborated word-for-word by Priya Nair's own description in `gate6-facilitator-signoff.md` ("`ConnectedO`, `ReadyO`... rendered in the exact same weight and color as the label it's glued to"). Not overstated, not understated.
- **Gate-status correction:** Cross-checked against `gate6-facilitator-signoff.md` and `tasks.md` Group 6 (tasks 6.1–6.4). Task 6.1 is checked off and signed off; 6.2, 6.2a, 6.3, 6.4 are unchecked and explicitly marked "tracked in #36" / "deferred... per product owner decision (2026-09-10)" in tasks.md itself. Both spec files' "Current status" language matches this exactly — copy sign-off closed, visual-register mock sign-off/follow-on styling/usability test open, issue #36, product-owner-accepted deferral. Accurate on both counts.

**Requirement-by-requirement check against code, remainder:**
- Undifferentiated state machine, single `event.code` check for `REAUTH_GRACE_EXPIRED_CLOSE_CODE` only — matches `connectionHealth.ts` exactly (the file's own header comment names this as "the ONE named exception").
- Initial-connection failure uses the same `beginOrContinueUnknownEpisode` path as a mid-session close — confirmed, no separate branch exists.
- Silent recovery — `handleOpenEvent` transitions to `connected` with no distinct event — confirmed.
- `reauth-required` reachable only via message or `REAUTH_GRACE_EXPIRED_CLOSE_CODE`, never via the disclosure-blind path and vice versa — confirmed, and cause-blindness among the three SEC-26 sub-causes holds (the module never reads or stores anything that would distinguish them).
- Timing floor: fixed `STALENESS_TIMING_FLOOR_MS = 2000` module-local constant, not env/flag-configurable — confirmed.
- Rendered treatment: `ConnectionStatusBanner` renders one fixed string per state via a single switch, no cause-dependent branching — confirmed. Distinct text for `reauth-required` vs. `unknown-reconnecting` — confirmed.
- Single shared implementation: both `ConnectionStatusBanner.tsx` and `FacilitatorReadinessGrid.tsx` import `useConnectionHealth` from the same `../realtime/connectionHealth.js` module, no parallel implementation found.
- Grid marker cause-blindness, non-suppression of `disconnected_voted`'s "ready" label, non-activation on facilitator's own `reauth-required` (renders top-level text instead, superseding the grid entirely), lockstep appearance/clearing driven directly off `state` with no independent timer/flag, no click/ping affordance on the marker `<span>` — all confirmed against `FacilitatorReadinessGrid.tsx`.
- "Freezes rather than visually mutates" scenario: not an explicit freeze mechanism in this component — it's an emergent property of `rows` being an external prop that only changes when the (now-stale) connection would otherwise push updates. Nothing in the code contradicts the spec's description; this is consistent, not drift.

**Main spec's structural conventions:** compared against `openspec/specs/websocket-connection-reauthorization/spec.md`. The new `websocket-staleness-signal/spec.md` follows the same shape — Purpose paragraph, "additive to, and depends on" dependency framing, "This spec covers" / "This spec does NOT cover" pair, bolded "Implementation status" line, `---`, then `## Requirements`. Consistent with the sibling.

**What Marcus said he didn't touch:** confirmed `websocket-connection-reauthorization/spec.md` and `websocket-session-authorization/spec.md` already correctly scope issues #32/#33 as separate, non-blocking work — no edit needed there, no drift found.
