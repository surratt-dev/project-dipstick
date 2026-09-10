# Design Review Incorporation — `websocket-staleness-signal`

Reviewer of this changelog's own work: Ingrid Sollenberger (Solution Architect). This document records what changed in `design.md`/`tasks.md` in response to `design-review-engineer.md` (Marcus Oyelaran) and `design-review-security.md` (Tomás Ferreira), and why, following this change's own practice of naming disagreements rather than silently accepting or rejecting feedback. No line of `design-review-engineer.md` or `design-review-security.md` was modified; `proposal.md` and `exploration-notes.md` were left untouched as instructed.

## Blocking findings — all three resolved

1. **Engineer finding 1 (close codes unreachable from frontend).** Added Decision D1b: `STALE_SIGNAL_CLOSE_CODE` and `REAUTH_GRACE_EXPIRED_CLOSE_CODE` relocate to a new `packages/shared/src/types/ws-close-codes.ts`, re-exported from `packages/shared/src/index.ts` as plain runtime `export const` values (a first for this package — every existing export there is `export type`). `staleness-signal.ts` and `connection-token-refresh.ts` import from `@dipstick/shared` instead of declaring locally. Values and semantics are unchanged; only the module of record moves. New prerequisite `tasks.md` Group 0 (task 0.1), which Group 1 now formally depends on. I did not touch `proposal.md`'s "Consumed, not modified" Impact-section language directly (out of scope per my instructions); instead D1b clarifies, from `design.md`'s side, that the phrase remains accurate at the semantic level while the constants' physical location is a design-stage addition.

2. **Engineer finding 2 (exhaustiveness mechanism stated backwards).** Corrected D1's description and task 1.2: the actual guard is a `default: { const _exhaustive: never = state; ... }` block (matching `ws-event-dispatcher.ts:81-88`), not "no default case." Task 1.2's compile-time regression test now targets that `never` assignment specifically.

3. **Security finding 1 (unguarded state-transition races).** Added Decision D1c: `reauth-required` is a sticky, terminal state for the lifetime of a `useConnectionHealth` instance — any pending retry timer is cleared synchronously on entry, and no subsequent close/error event of any code is processed afterward. New tasks 1.14 (Race A: late close after `reauth-required` already entered) and 1.15 (Race B: stale pending retry timer), both added to the 7.2 hard gate alongside the retry-symmetry and no-retry tests.

## Non-blocking findings incorporated directly

- **Engineer #3 (`connect` identity / reconnect-storm risk).** New Decision D1d: `connect` is captured via `useRef`, setup effect has an empty dependency array. New task 1.1b.
- **Engineer #4 (message-stream ownership).** New Decision D1e: `addEventListener("message", ...)`, never `.onmessage =`. New task 1.1c.
- **Engineer #5 (no WebSocket test-double strategy).** New Decision D1f: hand-rolled `FakeWebSocket` double. Confirmed by a quick spike that `jsdom@29.1.1` does expose a global `WebSocket`, but it's a real network client, not a controllable double — consistent with the reviewer's suspicion. New task 1.1a, which the rest of Group 1's event-forcing tests now depend on.
- **Engineer #6 (jitter/RNG determinism).** D2 now states `Math.random()` is the sole jitter source and forecloses an `rng` parameter; task 1.3/1.4 updated to reference `vi.spyOn(Math, "random")` explicitly.
- **Engineer #7 (unmount/teardown).** New Decision D1g: cleanup unconditionally closes the socket and clears both timers. New task 1.1d (unmount-mid-retry test, StrictMode double-invoke test).
- **Engineer #8 (Vite dev proxy missing `/ws`).** Added to D9; new task 5.1a.
- **Engineer #9, "early recovery before the floor elapses."** New Decision D3a: a successful reconnect before the floor elapses cancels the floor timer outright — `state` never flips to `unknown-reconnecting`. New task 1.6a.
- **Engineer #9, shared `WsClientMessage` type.** D1a now states explicitly that `connectionHealth.ts` narrows against the existing shared type rather than hand-rolling a shape check; task 1.10 updated to name it.
- **Engineer #9, no external reconnect library.** Added one sentence to D2's alternatives explaining the rejection (byte-for-byte retry-timing symmetry is not a guarantee a general-purpose library provides or tests for).
- **Security finding 5 (grep should cover debug-logging leaks).** Task 1.9's grep extended to flag `console.*` calls referencing `event.code`, `event.reason`, or the parsed message body.

## Non-blocking findings recorded as named risks, not fixed here

- **Security finding 2 (DevTools close-code visibility).** Added as a Risk in `design.md`. Not fixable at this layer — the close code is visible on the wire beneath the JS layer this design controls. Forward-pointer left for issue #32/#33 and the two backend changes that chose the close codes.
- **Security finding 3 (SEC-25's fixed 5-minute sweep interval as a correlation channel).** Added as a Risk, referencing `connection-reauthorization.ts:25` directly. Not this document's mechanism to fix — jittering the interval is a backend decision with its own trade-offs against `websocket-connection-reauthorization`'s reveal-timing guarantees.
- **Security finding 4 (no aggregate/non-attributable telemetry).** Added one sentence to Non-Goals distinguishing this from Decision D12's declined per-participant history, and naming it as an out-of-scope gap rather than an oversight.

## What I did not change, and why

- **Engineer's confirmation on D7 (grid marker signal source)** and the **"no external library" observation** required no design change beyond the one-sentence additions above — the reviewer had no objection, only asked that the reasoning be stated explicitly, which is now done.
- I left `unknown-reconnecting`'s and `reauth-required`'s numbering (D1–D12) intact rather than renumbering the whole Decisions section, using lettered sub-decisions (D1b–D1g, D3a) instead — consistent with this document's own existing convention of lettered sub-decisions (D1a was already one). This keeps every existing cross-reference in `design.md` (e.g., "task 1.10," "Decision D3," "task 6.2") valid without a repo-wide renumbering pass, at the cost of a slightly denser D1 sub-section. I judged this the right trade-off given the number of insertions required by three independent reviews landing at once; a future editor is free to flatten the lettering if the D1-cluster becomes unwieldy.
- I did not add a fourth reauth-required grid-marker variant or otherwise touch D7/D10 — no reviewer asked for that, and Marcus Oyelaran's review explicitly confirmed D7 as sound.
