# Engineer Design Review — `websocket-staleness-signal`

Reviewer: Marcus Oyelaran (Full Stack Engineer)

Scope of this review: implementability, boundary cleanliness, technology-choice practicality, hidden coupling, and missing error paths. I read `design.md`, `proposal.md`, `tasks.md`, the two backend modules this design consumes (`packages/backend/src/realtime/staleness-signal.ts`, `connection-token-refresh.ts`), the shared type package (`packages/shared/src/types/realtime.ts`), the existing frontend surface (`packages/frontend/src/**`, in particular `AuthContext.tsx` and `SessionLobbyPage.tsx`), and the repo's build/lint/test configuration (root `tsconfig.base.json`, `eslint.config.js`, `packages/frontend/vite.config.ts`, `packages/frontend/vitest.config.ts`). No line of `design.md`/`proposal.md`/`tasks.md` was modified.

The design's reasoning about disclosure, state-machine shape, and the D1a `reauth-required` split is sound and well-argued — I have no notes on the *policy* content. Everything below is about whether it compiles, ships, and gets tested the way the document assumes it will.

---

## 1. [BLOCKING] The close codes this design "consumes as-is" are not reachable from the frontend package

`design.md`'s Impact section says this change "Consumed, not modified: `STALE_SIGNAL_CLOSE_CODE` and `REAUTH_GRACE_EXPIRED_CLOSE_CODE`/`reauth_required` (`packages/backend/src/realtime/staleness-signal.ts`, `connection-token-refresh.ts`)." Decision D1a says the module "checks for exactly `REAUTH_GRACE_EXPIRED_CLOSE_CODE`."

I checked `packages/frontend/package.json`: frontend's only workspace dependency is `@dipstick/shared`. It has no dependency on `@dipstick/backend`, and it shouldn't get one — `connection-token-refresh.ts` imports `fastify`, `../redis.js`, `../db.js`, `../auth/middleware.js`, none of which belong in a Vite-bundled browser client. There is no legal import path from `connectionHealth.ts` to either backend file. I also checked `packages/shared/src/types/realtime.ts` — it defines `WsClientMessage` (including the `reauth_required` shape) but neither `4000` nor `4001` is defined anywhere in `packages/shared`.

As written, task 1.10's "wire `useConnectionHealth` to recognize... a raw close with `REAUTH_GRACE_EXPIRED_CLOSE_CODE` (4001)" can only be implemented by re-declaring the literal `4001` (and `4000`, for the grep-based no-branching check in task 1.9 to have anything to name) directly in `connectionHealth.ts`, with a comment pointing at the backend source of truth. That is exactly the schema-drift risk this codebase's own shared-types discipline exists to prevent — one side renumbers a close code during some future refactor and the other silently stops matching, and nothing catches it at build time because there is no shared symbol to catch it.

**Suggested change:** move `STALE_SIGNAL_CLOSE_CODE` and `REAUTH_GRACE_EXPIRED_CLOSE_CODE` into `packages/shared/src/types/realtime.ts` (or a sibling `packages/shared/src/types/ws-close-codes.ts`), and have `staleness-signal.ts` / `connection-token-refresh.ts` import them from there instead of defining them locally. This is a small, mechanical change to two files that already exist and are otherwise untouched by this proposal — it belongs in this change's task list (a new Group 1 task, since everything else depends on it) rather than being discovered mid-implementation of task 1.10.

---

## 2. [BLOCKING] Task 1.2's stated exhaustiveness mechanism does not do what it says

Task 1.2 and Decision D1 both describe the fourth-value guard as: "a `switch` with no `default` case anywhere this type is consumed, so an added fourth value fails to compile."

This is backwards from how TypeScript exhaustiveness checking actually works, and backwards from this codebase's own established convention. I read `packages/backend/src/realtime/ws-event-dispatcher.ts:81-88`, which implements this same class of guard correctly:

```ts
default: {
  // Exhaustiveness guard — a new WsEventType added to the shared union
  // without a corresponding dispatch case fails here at runtime (and,
  // if the switch above stops being exhaustive, at compile time via the
  // `never` assignment below).
  const _exhaustive: never = envelope;
  logger.warn({ envelope: _exhaustive }, "unrecognized ws:events eventType");
}
```

A `switch` with *no* `default` case does not fail to compile when a case is missing — TypeScript happily allows a non-exhaustive switch with no default; the added state simply falls through and matches nothing, silently, at runtime. The compile-time failure only happens because of the `default` branch's `const _exhaustive: never = value` assignment — that's the actual guard. Root `tsconfig.base.json` has `noFallthroughCasesInSwitch: true` (prevents accidental case fallthrough) but nothing that makes a missing case a type error on its own, and `eslint.config.js` does not enable `@typescript-eslint/switch-exhaustiveness-check` either.

As written, task 1.2 will produce code that looks like it enforces the "no fourth value" invariant and doesn't. This is worth catching now specifically because it's the kind of thing that passes code review by inspection — the reviewer sees "no default case" and reads that as the safety net, when the actual codebase convention requires the opposite.

**Suggested change:** correct design.md D1 and tasks.md 1.2 to mirror `ws-event-dispatcher.ts`'s pattern exactly — every `switch` on `ConnectionHealthState` (in the hook, in `ConnectionStatusBanner`, in the grid-marker component) must include a `default: { const _exhaustive: never = state; ... }` block. Task 1.2's "compile-time regression test" should be a `// @ts-expect-error`-style fixture asserting that widening the union causes exactly this line to fail, not a claim about the absence of `default`.

---

## 3. [HIGH] `connect` reference identity is a live reconnect-storm risk, and neither document mentions it

`useConnectionHealth(connect: () => WebSocket)` is described as owning "initial connect... and the retry loop." Every realistic call site (D9's host components) will construct `connect` as an inline closure, e.g. `useConnectionHealth(() => new WebSocket(url))`. If the hook's internal `useEffect` lists `connect` in its dependency array — the natural way to write this — then every render of the host component produces a *new* `connect` function reference, and since the hook's own `state` change is itself what triggers most re-renders of anything consuming it, this is close to guaranteed to fire on every state transition: the effect tears down and reconnects on every `connected` → `unknown-reconnecting` → `connected` cycle, on top of (or instead of) the intended retry loop. This would look correct in an isolated unit test that mocks `connect` as a stable `vi.fn()` and would misbehave the moment it's wired to a real component in D9.

This is exactly the class of bug the persona/team is worried about for this specific change ("no existing pattern to lean on... more places to accidentally reintroduce" — design.md Context) — it's not a disclosure bug, but it's a correctness bug unique to this being the first hook of its kind in the codebase, and no existing frontend code (`AuthContext.tsx` et al.) exercises this pattern since none of them own a retry loop against a caller-supplied factory.

**Suggested change:** design.md should state explicitly how `connect` is treated: either (a) the hook stores `connect` in a `useRef` on first render and never re-invokes its setup effect due to `connect` identity changing (effect dependency array is `[]`, `connect` is read through the ref inside retry callbacks), or (b) the contract requires callers to pass a referentially-stable `connect` (memoized with `useCallback` with an empty dependency array) and this is a documented, tested precondition. (a) is more robust since it doesn't rely on every future call site remembering to memoize correctly. Add a task: a test that passes a *fresh* `connect` closure on every re-render (simulating a naive call site) and asserts the hook does not tear down and reconnect the live socket as a result.

---

## 4. [HIGH] No specified ownership boundary for the socket's message stream

`useConnectionHealth` returns `{ state, socket }`. Decision D1a requires the hook itself to inspect incoming messages for `{"eventType": "reauth_required"}`. D9's host components, and eventually the real voting UI (explicitly out of scope here but explicitly the thing this socket exists to serve), will need to read the *other* message types on the same socket — `vote_readiness_update`, `vote_revealed`, `session_state_change`, `topic_history_update` (all defined in `packages/shared/src/types/realtime.ts`).

If the hook's internal reauth-detection wires up via `socket.onmessage = handler` (an assignment, not a listener registration), any other code that also does `socket.onmessage = otherHandler` against the same exposed socket silently replaces it — whichever assigns last wins, and there is no error, no warning, and no test in this change's own task list that would catch it, because tasks 1.10/1.11/1.12 only exercise the hook in isolation. This is a boundary the proposal's own framing ("the places where a frontend assumption meets a backend contract" is the lead engineer's stated top concern) should settle explicitly rather than leave to whichever engineer writes D9's host component or, later, the real voting UI.

**Suggested change:** state explicitly in D1 (or a new decision) that the hook's internal message handling uses `socket.addEventListener("message", ...)`, never a `.onmessage =` assignment, specifically so it composes with any other `addEventListener("message", ...)` a consumer attaches to the same exposed `socket`. Add a task/test: with the hook mounted and a second, independent `addEventListener("message", ...)` attached to the returned socket (simulating a future app-level message consumer), assert both the hook's own reauth detection and the second listener each receive every message — i.e., the hook doesn't consume/stop-propagation on messages it doesn't recognize.

---

## 5. [HIGH] No WebSocket test-double strategy named, for a test suite that requires one immediately

Tasks 1.4, 1.6, 1.7, 1.8, 1.11, 1.12, 1.13, 3.2, 4.2a, 4.4, 4.5, 4.6, 4.10 all require "forcing" a close, error, or message event through the real hook and asserting on the resulting state/render. None of that is possible without something that behaves like a `WebSocket` from the test's point of view (constructible, has `addEventListener`/`removeEventListener`, `close()`, `readyState`, the `CONNECTING`/`OPEN`/`CLOSING`/`CLOSED` constants) and that the test can drive by synthesizing `CloseEvent`/`MessageEvent`/`Event` dispatches on demand.

I checked: `packages/frontend/package.json` devDependencies have no `mock-socket`, no `vitest-websocket-mock`, nothing WebSocket-related. `packages/frontend/vitest.config.ts` uses `environment: "jsdom"` with no WebSocket-specific setup in `test-setup.ts`. Whether jsdom's own `WebSocket` global (if `jsdom@29` even ships one — this needs to actually be checked against the installed version, not assumed) is usable as a controllable double, or whether it tries to make a real network connection and hangs/errors in a test environment, is unverified. This is the first frontend WebSocket code in the repo, so there is zero precedent to copy, and — same shape of risk as finding 3 — this is exactly the kind of decision that will otherwise get made ad hoc by whoever picks up task 1.1, with no design-stage or review checkpoint on it.

**Suggested change:** name the approach in `design.md` (or as an explicit early task in Group 1, before 1.4): a small hand-rolled `FakeWebSocket` test double (probably living in `packages/frontend/src/realtime/__tests__/` or a shared `test-utils`) that implements exactly the surface `connectionHealth.ts` touches, with test-only methods to synthesize `open`/`close`/`error`/`message` events. This keeps the retry-symmetry and cause-blindness tests deterministic and avoids a real-network dependency in CI. If jsdom's native `WebSocket` turns out to be usable directly (worth a 10-minute spike before committing to a custom double), say so explicitly instead of leaving it to be discovered mid-task-1.4.

---

## 6. [HIGH] `computeRetryDelay`'s jitter source and how task 1.4 achieves a deterministic "identical draw sequence" is unaddressed

D2 specifies `computeRetryDelay(attempt: number): number` as "a pure function taking only the attempt count" with "actual delay drawn uniformly from `[0, upperBound)`." Task 1.4 requires the retry-symmetry test to "assert identical retry count, backoff schedule, and jitter draw sequence (seed the jitter source for determinism)."

A function whose only input is `attempt` and which must still produce different values across calls with the same `attempt` (that's what jitter means) can only be getting its randomness from an ambient source — `Math.random()` — not from an argument, since the signature explicitly excludes one. That's a legitimate design choice, but it means "seed the jitter source for determinism" in task 1.4 can only mean globally mocking `Math.random` in the test (`vi.spyOn(Math, "random").mockReturnValue(...)` or a queued sequence of return values), not passing a seed into the function. That's workable, but it's worth stating explicitly now rather than leaving the test author to reverse-engineer it, because the alternative someone might reach for instead — adding an optional second `rng` parameter to `computeRetryDelay` "just for tests" — would quietly relax the "no cause input, attempt count only" contract D2 is built around, by giving the function a second parameter surface at all. Better to foreclose that option explicitly.

**Suggested change:** state in D2 that `Math.random()` is the sole jitter source, and that tests control it via `vi.spyOn(Math, "random")`, not via a function-signature change. Worth one sentence, but worth writing down given the adjacent temptation.

---

## 7. [MEDIUM] Unmount/teardown behavior is unspecified — leaks timers and duplicate connections

Nothing in `design.md` or `tasks.md` addresses what `useConnectionHealth`'s effect cleanup function actually does. Concretely, on unmount, does it: close the live (or in-flight) socket, clear the pending retry `setTimeout`, and clear the pending timing-floor `setTimeout`? Two concrete failure modes if not:

- A participant navigates away from the host page mid-retry-loop; the retry loop keeps running in the background (its `setTimeout` was never cleared), attempting reconnects and calling `setState` against a component that no longer exists.
- React 18 **StrictMode** (worth checking whether `main.tsx` wraps the app in `<React.StrictMode>` — I did not check this specifically, but it's the default CRA/Vite-React-template posture) double-invokes effects in development (mount → cleanup → mount). If cleanup doesn't *synchronously* close the first socket before the second mount effect runs, every dev-mode page load opens two real WebSocket connections against the backend's `ConnectionRegistry`, silently, until the first one's server-side idle/lifecycle logic notices. That's a confusing debugging experience on top of being wasted connections, and it's the kind of thing that's invisible in a unit test that only mounts the hook once.

**Suggested change:** add a decision stating the cleanup contract (close socket unconditionally, clear both timer handles, regardless of current `state`), and two tasks: an unmount-mid-retry test (assert no further reconnect attempts or state updates after unmount) and a StrictMode double-invoke test (mount, unmount, remount rapidly; assert only one live socket exists at the end).

---

## 8. [MEDIUM] Local dev's Vite proxy doesn't cover `/ws`, and D9 depends on it working

`packages/frontend/vite.config.ts`'s `server.proxy` currently has entries only for `/api` and `/auth`, both pointed at `http://localhost:3000`. There's no `/ws` entry. Vite's dev-server proxy requires an explicit `ws: true` flag on a proxy entry to upgrade and forward WebSocket connections — it isn't automatic even for entries that do exist. Without this, `npm run dev` will not be able to reach the backend's `/ws/sessions/:sessionId` route at all, which blocks D9's "wiring... to a real session WebSocket" from being verifiable in local dev (only against a built/served bundle that talks to the backend directly).

**Suggested change:** add a task under Group 5 (Minimal Host Surface) to add a `/ws` proxy entry with `ws: true` to `vite.config.ts`, so this isn't discovered by trial-and-error partway through D9 implementation.

---

## 9. Smaller items / questions

- **D3 timing-floor race with early recovery is untested.** Task 1.6 covers "instant fail, floor holds" and "slow fail, same floor" — it doesn't cover the case a 2-second wifi blip actually is: failure occurs, the floor timer starts, and the connection successfully reconnects *before* the floor elapses. Does the reported `state` ever flip to `"unknown-reconnecting"` in that case (a late, stale flash after the user is already reconnected), or does successful recovery cancel the pending floor timer outright? This is arguably the single most common real-world case the floor exists to smooth over (proposal.md's own justification #2 is "ordinary conference-room wifi flakes constantly"), and it's the one case not in the task list. Recommend an explicit decision + test.
- **D1a's message-vs-close-code race isn't fully pinned down.** The `reauth_required` message "arrives first and while the socket is still open" per D1a, with 4001 as fallback "for a client that misses or never receives the message." What happens if the message arrives, is processed (state → `reauth-required`), and then the 4001 close event *also* fires moments later (the normal, expected sequence per `connection-token-refresh.ts`'s `startGracePeriod`, which sends the message then starts the grace timer)? Presumably the close handler is a no-op once already in `reauth-required` — worth stating explicitly so it doesn't get read as "the second signal re-triggers the transition" (harmless either way here since both go to the same state, but worth being explicit given how carefully D1a reasons about every other edge of this transition).
- **Facilitator grid marker signal source (D7) reuses the facilitator's *own* connection health, not a per-row signal — confirmed sound.** I don't have a concern here, just confirming I checked `connection-registry.ts` and the shared `realtime.ts` types and agree with D7's conclusion that no additional per-participant server signal exists to compute anything finer-grained. Good call flagging this as inference-not-fact and gating it at task 4.1a rather than asserting it as settled.
- **`packages/shared/src/types/realtime.ts` already defines `WsClientMessage` including `{ eventType: "reauth_required" }`.** Worth naming this explicitly in D1a/task 1.10 as the type `connectionHealth.ts` should import and narrow against for its message check, rather than hand-rolling an inline shape check (`(msg as any).eventType === "reauth_required"` or similar) that would duplicate a contract that already exists as a shared type one import away. Related to finding 1 above but distinct — this part is already fully available in `@dipstick/shared` today, no migration needed.
- **No external WebSocket/reconnection library is introduced** (confirmed via `package.json` — no `reconnecting-websocket` or similar is added anywhere in this design). I read that as deliberate, consistent with D2/D3's "no configurability" stance and this being simple enough to hand-roll correctly with full control over the disclosure-sensitive retry symmetry a library wouldn't guarantee. Worth one sentence in design.md saying so explicitly, since "why didn't we just use an off-the-shelf reconnecting-websocket library" is a question a reviewer will ask if it isn't preempted.

---

## Summary for triage

Blocking (must resolve before task 1.1 can be completed as specified): **1** (close codes unreachable from frontend package — needs a `packages/shared` migration task), **2** (exhaustiveness mechanism is stated backwards from how TS/this codebase actually enforces it).

High (will produce real bugs or an unbuildable test suite if not settled before implementation starts): **3** (`connect` identity / reconnect-storm risk), **4** (message-listener ownership boundary), **5** (no test-double strategy named), **6** (jitter source/determinism approach).

Medium (should be decided before Group 5/6, not necessarily before Group 1): **7** (unmount teardown), **8** (Vite dev proxy `/ws` entry).

Everything in section 9 is a clarification or confirmation, not a blocker.
