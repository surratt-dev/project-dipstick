# Sync Notes — `websocket-staleness-signal`

Run via `opsx:sync`, as Marcus Delgado (BA). This change is fully implemented and reviewed (see `implementation-summary.md`, `implementation-review-architect.md`, `implementation-review-security.md`, `review-followup-summary.md`); Group 6 (facilitator copy/visual-register/usability sign-off) is deliberately deferred per product-owner decision, tracked in GitHub issue #36 (`tasks.md` 6.2/6.2a/6.3/6.4, `design.md` Decision D10's 2026-09-10 update, `gate6-facilitator-signoff.md`).

## What I verified before touching anything

Read `design.md` in full (Decisions D0–D12 and all lettered sub-decisions), the delta spec, `tasks.md` Groups 0–7, `gate6-facilitator-signoff.md`, and `review-followup-summary.md`. Cross-checked all of it against the actual shipped code: `packages/frontend/src/realtime/connectionHealth.ts`, `ConnectionStatusBanner.tsx`, and `FacilitatorReadinessGrid.tsx`. The delta spec already matched the implementation closely — the state machine, timing floor, retry policy, single-shared-module requirement, and cause-blindness properties in the spec are all accurate to the code as it stands.

**Correction (post-review):** my original pass here claimed exactly two gaps (below), and that framing was wrong — it described the two corrections I made to the delta spec, not the full set of places where the delta spec and the main spec I wrote diverged. Ingrid Sollenberger's architect review (`sync-verify-architect.md`) caught two additional, real gaps I introduced without noticing: I had correctly carried two designed, shipped behaviors from `design.md` into the new main spec but silently left them out of the delta spec, with no note of the discrepancy. Both are now backfilled into the delta spec (see "Changes made," item 3 below). The two original corrections were accurately worded and are unaffected by this correction.

## Changes made

**1. `openspec/changes/websocket-staleness-signal/specs/websocket-staleness-signal/spec.md` (delta spec, edited):**

- Added a scenario to the "Facilitator-only, cause-blind grid marker" requirement stating plainly that the shipped marker is an unstyled placeholder (a bare glyph glued to the row label, no color/opacity/spacing differentiation) — not a rendering of either candidate visual register from Decision D10. This was previously implicit (you'd have to cross-reference `design.md` and `gate6-facilitator-signoff.md` to know it), and the spec as written could be read as describing a finished visual treatment.
- Rewrote the "Pilot-readiness gate" requirement to state its **current status**, not just its abstract condition: copy sign-off (6.1) is closed, but the visual-register mock sign-off, the follow-on styling task, and the live usability test are all open, tracked in issue #36 and deferred by product-owner decision. Added a scenario capturing this partial-closure state explicitly, so the gate doesn't read as a still-hypothetical future check when in fact a simulated-persona review already ran against it and partially failed it.

**2. `openspec/specs/websocket-staleness-signal/spec.md` (main capability spec, created — did not previously exist):**

No main spec existed for this capability yet (`openspec/specs/` has no `websocket-staleness-signal` directory prior to this sync). Created one following the sibling capabilities' format (see `websocket-connection-reauthorization/spec.md`): a Purpose section (dependencies on `websocket-delivery-time-authorization` and `websocket-connection-reauthorization`, scope, explicit non-scope for issues #32/#33, and an Implementation status line), followed by all nine requirements carried over from the delta spec with the same two placeholder/gate-status corrections applied as above.

**3. `openspec/changes/websocket-staleness-signal/specs/websocket-staleness-signal/spec.md` (delta spec, backfilled after architect review):**

- Added the `reauth-required` sticky/terminal sentence (design.md Decision D1c: pending retry timer cleared synchronously on entry, no subsequent close/error of any code processed once active) to the "Legitimately-disclosed re-authentication-required state" requirement, plus the "A close arriving after reauth-required is already active is a no-op" scenario — both reused verbatim from the main spec, which already had them correct.
- Added the floor-timer-cancellation-on-early-recovery sentence (design.md Decision D3a: a successful reconnect before the floor elapses cancels the pending floor timer outright, no transition to `unknown-reconnecting` occurs) to the "Uniform timing floor" requirement, plus the "An early recovery before the floor elapses is invisible" scenario — again reused verbatim from the main spec.
- Both are genuinely shipped, CI-tested behavior in `connectionHealth.ts` (guards in `handleTerminalEvent`/`handleMessageEvent`/`handleOpenEvent`, and `clearFloorTimer()` in `handleOpenEvent`), not new scope — they were already correctly stated in the main spec and are now consistent between both documents.

## What I did not touch

- `tasks.md` checkboxes and `design.md` content, per instructions — these are finalized inputs, not sync targets.
- `openspec/specs/websocket-connection-reauthorization/spec.md` and `openspec/specs/websocket-session-authorization/spec.md` — both already correctly frame the client-visible UX (this capability, plus issues #32/#33) as separate, non-blocking work relative to their own scope. Nothing in either file contradicts what was actually built here, so no edit was needed.

## Why this matters

A spec that describes the grid marker without noting it's an unstyled placeholder, or that states the pilot-readiness gate as a condition without saying where it currently stands, would read fine today but silently go stale the moment someone picks up issue #36 — they'd have no way to tell from the spec alone that a sign-off attempt already happened and was withheld for a specific, documented reason. Recording the current state explicitly, with the issue-number pointer, keeps the trace from requirement to what-was-actually-decided intact instead of requiring a re-read of `design.md` and `gate6-facilitator-signoff.md` every time.
