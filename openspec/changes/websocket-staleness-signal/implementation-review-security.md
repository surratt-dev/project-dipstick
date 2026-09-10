# Implementation-Stage Security Review — `websocket-staleness-signal`

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Scope:** the shipped, uncommitted implementation on `agent-team/websocket-staleness-signal` (`git diff` against `main`), reviewed against my own `design-review-security.md` and the disposition recorded in `design-review-incorporation.md` (Decision D1c and the direct incorporation of Finding 5). Unlike my design-stage review, there is now running code and a passing test suite to verify claims against, and I did — I read the actual guard logic line by line, ran the existing test files, and additionally ran a mutation test of my own (temporarily deleting a guard, confirming the test suite catches it, then restoring the file) rather than taking the test suite's green result as sufficient on its own.

**Bottom line:** Finding 1 — the one I held this design to before calling it settled — is **Resolved** in the shipped code, and I verified the mechanism, not just its label. Finding 5 is **Resolved** and implemented more strictly than I asked for. Findings 2–4 were recorded as risks rather than fixed, which is what I asked for and what the incorporation record shows; I re-checked they're actually present in `design.md`, not just claimed in the incorporation log. I have one **new, non-blocking observation**: the Race A test (`connectionHealth.test.ts`, task 1.14) verifies the wrong half of D1c's guarantee for that specific ordering — it does not catch a mutation that leaves `state` correct while silently scheduling a phantom reconnect.

---

## Finding 1 (was: Required before implementation is considered done) — Resolved

**What I checked:** I read `packages/frontend/src/realtime/connectionHealth.ts` directly rather than trusting `implementation-summary.md`'s account of it.

**(a) `reauth-required` sticky against a later close of a different code.** `handleTerminalEvent` (line 208) opens with:

```ts
if (stateRef.current === "reauth-required") return;
```

This runs before `event.code` is even read (the `code` variable is assigned on the line after). `handleMessageEvent` (line 230) has the identical guard as its first line. Both are checked against `stateRef.current` — a ref, not React state — so the check is synchronous with respect to the event that triggered it; there's no window where a stale closure could read an outdated value. This directly closes Race A as I described it in my design review: a `STALE_SIGNAL_CLOSE_CODE` close (or any code) arriving after `reauth-required` is already entered is dropped before any branching on `event.code` occurs.

**(b) Pending retry timer cleared synchronously on entry to `reauth-required`.** `transitionTo()` (line 140) calls `applyStateEntryEffects(next, () => { clearRetryTimer(); clearFloorTimer(); })` *before* updating `stateRef.current` or calling `setState`. `applyStateEntryEffects`'s `"reauth-required"` case invokes the callback unconditionally on entry. Since JS timers are single-threaded, "synchronous with the transition" is exactly the right property — there is no tick in which a `retryTimerRef`-scheduled `openSocket()` can fire between the transition being decided and the timer being cleared, because clearing happens in the same synchronous call stack as the transition, before the function returns control to the event loop. This closes Race B as I described it: a retry timer left pending from a prior `unknown-reconnecting` episode cannot survive a subsequent transition into `reauth-required`.

**Test verification, not just code inspection.** `connectionHealth.test.ts:436-484` ("sticky-state race guards … tasks 1.14/1.15") contains both tests I asked for:
- **Race A** (line 437): drives `reauth_required` message → asserts `reauth-required` → emits a close carrying `STALE_SIGNAL_CLOSE_CODE` on the *same* socket → asserts state is still `reauth-required`. This is the exact ordering I specified, not the simpler "signal arrives first, nothing else happens" case already covered by 1.11/1.12.
- **Race B** (line 453): drives a real close → floor timer fires → `unknown-reconnecting` → retry fires (attempt 0, `connect` called a 2nd time) → the *new* socket also fails, scheduling a *second, still-pending* retry timer (attempt 1) → `reauth_required` arrives on that new socket → asserts state is `reauth-required` → advances fake timers 10s (well past the pending attempt-1 delay) → asserts `connect` was **not** called a 3rd time. This is a genuinely two-hop setup (fail → retry → fail-again → pending-retry → reauth signal), not a single-hop simplification, and it explicitly checks the call count, not just state — the correct assertion for this race.

I ran both: `npx vitest run connectionHealth.test.ts connectionHealth.grep.test.ts` → 33/33 pass, including these two.

**I did not stop at green tests.** I temporarily deleted the `handleTerminalEvent` guard (the line quoted in (a) above), re-ran the suite, and — notably — the *existing* Race A test still passed, because `beginOrContinueUnknownEpisode()`'s floor-timer branch only fires from `state === "connected"`, so with the guard gone the state field coincidentally stays `"reauth-required"` even though the function no longer returns early. But `scheduleRetry()` at the bottom of `beginOrContinueUnknownEpisode()` runs unconditionally regardless of that branch, and with the guard removed it silently re-arms a retry. I wrote a throwaway test asserting `connect` call count after this sequence: with the guard removed, `connect` was called a 2nd time after advancing fake timers — a live reconnect against a session the user was just told to log back into. I restored the original file immediately after (`git status` on `connectionHealth.ts` now shows it unchanged from before my probe; the untracked-file marker is expected since this whole directory is new on this branch). This confirms the shipped guard is genuinely load-bearing, not incidental — but see my new observation below about what this implies for the *test's* coverage, independent of the code being correct.

**Disposition: Resolved.** Both guards exist, are structurally correct, are exercised by tests matching the exact orderings I specified, and I confirmed by direct mutation that removing either one produces the failure mode D1a was written to prevent.

---

## New observation (non-blocking): Race A's test checks the wrong signal for one mutation class

This is not a finding against the shipped code — the guard is present and correct, as verified above. It's a gap in what the **test** would catch if a future change altered `handleTerminalEvent`'s control flow without removing the guard outright (e.g., someone "simplifies" the function and the early return ends up after some other line that has a side effect).

`connectionHealth.test.ts:437-451` (Race A) asserts only `result.current.state === "reauth-required"` after the late close. My mutation experiment showed that `state` remaining correct is not, by itself, proof that no retry was scheduled — `beginOrContinueUnknownEpisode()`'s two effects (starting the floor timer vs. calling `scheduleRetry()`) are gated by different conditions, and only the first is guarded by the `state === "connected"` check that happens to save the *displayed* state in this scenario. The Race B test already does this correctly — it asserts `connect` was **not** called again after advancing timers. Race A's test should do the same: after the late close, advance fake timers well past any possible retry delay and assert `connect` was called exactly once (matching the pattern Race B already establishes). This costs one `vi.useFakeTimers()` + `vi.advanceTimersByTime(...)` + one assertion added to the existing Race A test, and it would have caught the exact mutation I introduced, which the current version does not.

**Recommendation:** extend the existing Race A test (or add a sibling) to assert `connect` call count stays at 1 after advancing timers past any retry window, mirroring Race B's assertion style. Low severity — today's guard is correct and directly tested by my manual mutation check — but it closes a real gap in the regression net for this specific invariant, which is exactly the kind of thing that produces a "flaky-looking bug during implementation" months from now that I said in my design review I wanted to avoid.

---

## Non-disclosure invariant re-verification — Confirmed holding, across all three files

I checked this independently of the grep tests, by reading the source directly, not just trusting task 1.9's pass:

- **`connectionHealth.ts`:** the only `.code` property access in the file is the single `event.code` read at line 215 (confirmed structurally by the grep test's `propertyAccesses.length === 1` check, and I independently confirmed it visually). The only close-code comparison is `code === REAUTH_GRACE_EXPIRED_CLOSE_CODE` (line 220). No literal `4000`/`4001` appears anywhere in the file.
- **`ConnectionStatusBanner.tsx`:** switches only on `state` (the disclosure-safe enum), never touches `.code`, never imports either close-code constant. Confirmed by direct read and by the grep test.
- **`FacilitatorReadinessGrid.tsx`:** same — switches only on `state`; the `showMarker` boolean passed to `GridRows` is derived from `state === "unknown-reconnecting"`, not from any close-code or outcome-type value. Confirmed by direct read and by the grep test.

I did not find any branching on close-code/outcome-type anywhere outside the one named exception. This matches what I asked for in my design review and what D1a/D1c commit to.

---

## Finding 5 (was: Low, informational) — Resolved, and implemented more strictly than requested

I asked that the grep enforcement be extended to flag `console.*` calls specifically referencing `event.code`, `event.reason`, or the parsed message body. The shipped `connectionHealth.grep.test.ts` instead bans **all** `console.*` calls, with no exception, in all three files (`connectionHealth.ts`, `ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx`) — a strictly stronger enforcement than what I asked for, since it also catches an unrelated debug `console.log("rendered")`-style leftover that wouldn't reference cause data at all but would still be a code-quality/production-noise concern.

I independently confirmed via `grep -rn "console\." packages/frontend/src/realtime packages/frontend/src/components/ConnectionStatusBanner.tsx packages/frontend/src/components/FacilitatorReadinessGrid.tsx` (plus the two host components) that there are zero `console.*` calls anywhere in the new production code, not just that the grep test happens to pass.

**Disposition: Resolved**, exceeding the original recommendation.

---

## Group 0 relocation (`ws-close-codes.ts`) — Spot-checked, no behavioral change

I read `packages/shared/src/types/ws-close-codes.ts` and the diffs to `packages/backend/src/realtime/staleness-signal.ts`, `connection-token-refresh.ts`, and `packages/shared/src/index.ts`.

- Values are unchanged: `STALE_SIGNAL_CLOSE_CODE = 4000`, `REAUTH_GRACE_EXPIRED_CLOSE_CODE = 4001`, identical to what my design review's Finding 3 cited from the pre-move location.
- Both backend files now `import` from `@dipstick/shared` and `export { X }` under the original names, so `websocket-routes.ts` (`CLOSE_UNAUTHORIZED = STALE_SIGNAL_CLOSE_CODE`, `CLOSE_FORCE_EXPIRED = STALE_SIGNAL_CLOSE_CODE`) and `connection-reauthorization.ts` (`conn.socket.close(STALE_SIGNAL_CLOSE_CODE)`) needed zero changes and still import from the original relative paths (`./staleness-signal.js`, `./connection-token-refresh.js`). I grepped every backend usage site and found no lingering hardcoded `4000`/`4001` literal outside the two constant declarations themselves.
- `packages/frontend/package.json` depends on `@dipstick/shared` only, confirming the architectural boundary D1b was written to enforce (frontend never depends on `@dipstick/backend`) is actually respected at the package-manifest level, not just asserted in a comment.
- I ran the backend realtime test suite directly (`npx vitest run packages/backend/src/realtime`) rather than trusting the implementation summary's "449 passed" claim: 88 tests passed, 1 skipped (the pre-existing Redis-dependent skip), 0 failed, including `websocket-routes.test.ts`'s test that specifically asserts the generic staleness code is used for unauthorized-subscription closes.

**Disposition: No behavioral change.** This is a pure relocation; the security-relevant comparisons and constant values are byte-for-byte identical to pre-move.

---

## Findings 2–4 (recorded risks, not fixable in this change) — Confirmed actually recorded, not just claimed

I did not re-litigate these — my design review already agreed they're out of this change's remediation scope — but I checked that `design-review-incorporation.md`'s claim of where they landed is accurate, since a recorded-risk finding that turns out not to actually be recorded anywhere is worse than one honestly left open. I ran `grep -n "DevTools\|REAUTHORIZATION_INTERVAL_MS\|aggregate.*telemetry\|non-attributable" design.md` directly against the shipped document and confirmed all three are present verbatim: a Risks-section entry (line 213) naming DevTools close-code visibility with a forward pointer to issues #32/#33 (Finding 2), a Risks-section entry (line 214) naming `connection-reauthorization.ts:25`'s fixed `REAUTHORIZATION_INTERVAL_MS` as a correlation channel (Finding 3), and a Non-Goals addition (line 34) distinguishing aggregate/non-attributable telemetry from D12's declined per-participant history (Finding 4). All three are present as durable, named risks in the design document itself, not only in the incorporation changelog — which was my actual concern (my own findings 2-4 said "provided they land somewhere durable rather than only in this file").

**Disposition: Confirmed recorded**, satisfying what I asked for. No remediation expected or required from this change for any of the three.

---

## Summary disposition

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Two unguarded state-transition races (Race A: late close after `reauth-required`; Race B: stale pending retry timer) | **Resolved** | `connectionHealth.ts:213,231` (state guards), `:140-152` (synchronous timer clearing on entry); tests at `connectionHealth.test.ts:436-484`; independently confirmed via mutation test (guard removed → real regression reproduced → restored) |
| — | *New, non-blocking:* Race A's test asserts `state` only, not retry-suppression, for the specific ordering it covers | **New observation** | My mutation test passed the existing Race A assertion while still scheduling a phantom reconnect; recommend adding a `connect`-call-count assertion mirroring Race B's style |
| 2 | DevTools close-code visibility (not fixable here) | **Recorded as designed** | `design.md` Risks section, forward-pointer to #32/#33 confirmed present |
| 3 | Fixed 5-min `REAUTHORIZATION_INTERVAL_MS` correlation channel (not fixable here) | **Recorded as designed** | `design.md` Risks section, references `connection-reauthorization.ts:25` directly, confirmed present |
| 4 | No aggregate/non-attributable telemetry for connection-health transitions (not fixable here) | **Recorded as designed** | `design.md` Non-Goals addition, confirmed present |
| 5 | Grep enforcement should cover debug-logging leaks | **Resolved (exceeded)** | `connectionHealth.grep.test.ts` bans all `console.*` in all three files, not just cause-referencing calls; confirmed zero `console.*` calls in new production code by direct grep |

Nothing in this implementation reopens Finding 1, and I verified that claim by breaking the code myself rather than by reading the test suite's summary. The one new item — Race A's test coverage gap — is low severity and cheap to close; I'm recording it rather than blocking on it, consistent with how I treated Findings 2–5 at design stage.

— Tomás Ferreira
