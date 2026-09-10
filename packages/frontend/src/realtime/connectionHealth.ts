import { useEffect, useRef, useState } from "react";
import { REAUTH_GRACE_EXPIRED_CLOSE_CODE, type WsClientMessage } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// Connection-health state machine — the sole implementation
//
// websocket-staleness-signal: design.md Decisions D1-D5. This is the sole
// implementation of the connected/unknown-reconnecting/reauth-required state
// machine. Issue #33 must consume this module for its reauthorization-flow
// grid work, and issue #32 must consume its `reauth-required` state for the
// SEC-26 re-login UX — neither may fork it (design.md Decision D6).
//
// THE CENTRAL RULE (restated here because this is the file where a
// well-intentioned implementation could silently regress): the
// `connected` / `unknown-reconnecting` pair never branches on close-code
// value or connection-attempt outcome type. A raw network close/error and a
// STALE_SIGNAL_CLOSE_CODE close are one undifferentiated bucket, all the way
// down to identical retry timing (design.md Decision D2) and an identical
// timing floor (Decision D3). The ONE named exception, and the only place
// this module reads `event.code` for any purpose, is the check for exactly
// REAUTH_GRACE_EXPIRED_CLOSE_CODE below (Decision D1a) — routing to the
// third, legitimately-disclosed `reauth-required` state, never altering the
// disclosure-blind pair's classification, timing, or retry behavior.
// ---------------------------------------------------------------------------

export type ConnectionHealthState = "connected" | "unknown-reconnecting" | "reauth-required";

/**
 * Development-time placeholder (design.md Decision D3) — not read from
 * process.env, a config file, or any feature-flag surface. Revisited as
 * part of Priya Nair's usability-test commitment (tasks.md Group 6), not
 * before a load test.
 */
const STALENESS_TIMING_FLOOR_MS = 2000;

/**
 * Pure retry-delay function (design.md Decision D2): full-jitter exponential
 * backoff, attempt count only. No cause, no seed, no RNG parameter — the
 * sole source of jitter is the ambient Math.random(), so there is no
 * argument surface through which a cause could leak or be injected. Tests
 * control this via vi.spyOn(Math, "random").
 */
export function computeRetryDelay(attempt: number): number {
  const upperBound = Math.min(30000, 1000 * Math.pow(2, attempt));
  return Math.random() * upperBound;
}

function isReauthRequiredMessage(
  message: WsClientMessage,
): message is Extract<WsClientMessage, { eventType: "reauth_required" }> {
  return message.eventType === "reauth_required";
}

/**
 * Shared exhaustiveness guard (design.md Decision D1, corrected per Engineer
 * design review finding 2): a `switch` with no `default` case does NOT fail
 * to compile when a case is missing — it is this `never` parameter that
 * fails to compile once ConnectionHealthState gains a fourth value and a
 * switch's `default` branch stops narrowing to `never`. Every switch on
 * ConnectionHealthState in this module, in ConnectionStatusBanner, and in
 * the grid-marker component calls this from its `default` branch (task 1.2,
 * matching the established convention in
 * packages/backend/src/realtime/ws-event-dispatcher.ts:81-88).
 */
export function assertExhaustiveConnectionHealthState(state: never): never {
  throw new Error(`connectionHealth: unreachable state ${String(state)}`);
}

/** design.md Decision D1: every switch on ConnectionHealthState carries this guard. */
function applyStateEntryEffects(next: ConnectionHealthState, onEnterReauthRequired: () => void): void {
  switch (next) {
    case "connected":
      break;
    case "unknown-reconnecting":
      break;
    case "reauth-required":
      onEnterReauthRequired();
      break;
    default: {
      const _exhaustive: never = next;
      assertExhaustiveConnectionHealthState(_exhaustive);
    }
  }
}

export interface UseConnectionHealthResult {
  state: ConnectionHealthState;
  socket: WebSocket | null;
}

/**
 * Owns the WebSocket lifecycle: initial connect, classification of every
 * close/error event, message inspection for the one recognized
 * application-level signal (Decision D1a), the timing floor
 * (Decision D3/D3a, unknown-reconnecting only), the retry loop
 * (Decision D2, unknown-reconnecting only), and silent recovery
 * (Decision D4).
 */
export function useConnectionHealth(connect: () => WebSocket): UseConnectionHealthResult {
  const [state, setState] = useState<ConnectionHealthState>("connected");
  const [socket, setSocket] = useState<WebSocket | null>(null);

  // Decision D1d: connect is captured by ref, never a dependency of the
  // setup effect below, so a fresh inline closure supplied on every render
  // never tears down or reconnects the live socket.
  const connectRef = useRef(connect);
  useEffect(() => {
    connectRef.current = connect;
  });

  const stateRef = useRef<ConnectionHealthState>("connected");
  const attemptRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const unmountedRef = useRef(false);
  const listenersRef = useRef<{
    onOpen: () => void;
    onCloseOrError: (event: Event) => void;
    onMessage: (event: MessageEvent) => void;
  } | null>(null);

  useEffect(() => {
    unmountedRef.current = false;

    function clearRetryTimer(): void {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    }

    function clearFloorTimer(): void {
      if (floorTimerRef.current !== null) {
        clearTimeout(floorTimerRef.current);
        floorTimerRef.current = null;
      }
    }

    function transitionTo(next: ConnectionHealthState): void {
      // Decision D1c: clearing timers on entry to reauth-required happens
      // here, before stateRef/setState are updated, so it is synchronous
      // with the transition itself.
      applyStateEntryEffects(next, () => {
        clearRetryTimer();
        clearFloorTimer();
      });
      stateRef.current = next;
      if (!unmountedRef.current) {
        setState(next);
      }
    }

    function teardownCurrentSocket(): void {
      const ws = socketRef.current;
      const listeners = listenersRef.current;
      if (ws && listeners) {
        ws.removeEventListener("open", listeners.onOpen);
        ws.removeEventListener("close", listeners.onCloseOrError);
        ws.removeEventListener("error", listeners.onCloseOrError);
        ws.removeEventListener("message", listeners.onMessage);
      }
      listenersRef.current = null;
    }

    function scheduleRetry(): void {
      if (unmountedRef.current) return;
      const attempt = attemptRef.current;
      attemptRef.current += 1;
      const delay = computeRetryDelay(attempt);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        openSocket();
      }, delay);
    }

    // Decision D5: reachable from either the initial connect() or a
    // reconnect attempt — there is no separate "couldn't connect" branch.
    function beginOrContinueUnknownEpisode(): void {
      // Decision D3: the floor starts once per episode, on the first
      // failure after a connected state — not restarted on every
      // subsequent retry failure within the same episode.
      if (stateRef.current === "connected" && floorTimerRef.current === null) {
        floorTimerRef.current = setTimeout(() => {
          floorTimerRef.current = null;
          // Decision D3a: a reconnect completing before the floor elapses
          // cancels this timer outright (via clearFloorTimer in
          // handleOpenEvent) before it ever fires, so reaching this point
          // means the episode is still live.
          if (stateRef.current === "connected") {
            transitionTo("unknown-reconnecting");
          }
        }, STALENESS_TIMING_FLOOR_MS);
      }
      scheduleRetry();
    }

    function handleOpenEvent(): void {
      if (stateRef.current === "reauth-required") return;
      // Decision D3a: cancels a pending floor timer before it can fire.
      clearFloorTimer();
      clearRetryTimer();
      attemptRef.current = 0;
      // Decision D4: silent recovery — no separate signal beyond this.
      transitionTo("connected");
    }

    function handleTerminalEvent(event: Event): void {
      // Decision D1c: reauth-required is sticky/terminal — checked first,
      // before any other branching, including for the socket's own
      // expected close arriving after the message already transitioned
      // state.
      if (stateRef.current === "reauth-required") return;

      const code = event instanceof CloseEvent ? event.code : undefined;

      // Decision D1a: the ONE narrow, named exception to "never read
      // event.code" — checking for exactly this value, and only to route
      // to reauth-required.
      if (code === REAUTH_GRACE_EXPIRED_CLOSE_CODE) {
        transitionTo("reauth-required");
        return;
      }

      // Disclosure-blind path from here on: nothing below reads `code`,
      // and nothing distinguishes a "close" from an "error" outcome.
      beginOrContinueUnknownEpisode();
    }

    function handleMessageEvent(event: MessageEvent): void {
      if (stateRef.current === "reauth-required") return;

      let parsed: unknown;
      try {
        parsed = typeof event.data === "string" ? JSON.parse(event.data) : null;
      } catch {
        return;
      }
      if (parsed === null || typeof parsed !== "object" || !("eventType" in parsed)) {
        return;
      }

      const message = parsed as WsClientMessage;
      if (isReauthRequiredMessage(message)) {
        transitionTo("reauth-required");
      }
    }

    function openSocket(): void {
      if (unmountedRef.current) return;
      teardownCurrentSocket();

      const ws = connectRef.current();
      socketRef.current = ws;
      setSocket(ws);

      // Dedup guard: a real WebSocket connection failure fires both
      // "error" and "close" for the same underlying failure. Only the
      // first of the two, per socket instance, drives the state machine.
      let handledTerminal = false;

      function onOpen(): void {
        handleOpenEvent();
      }

      function onCloseOrError(event: Event): void {
        if (handledTerminal) return;
        handledTerminal = true;
        handleTerminalEvent(event);
      }

      function onMessage(event: MessageEvent): void {
        handleMessageEvent(event);
      }

      listenersRef.current = { onOpen, onCloseOrError, onMessage };
      ws.addEventListener("open", onOpen);
      // Decision D1e: addEventListener, never `.onmessage =`, so this
      // composes with any other listener a consumer attaches to the same
      // returned socket.
      ws.addEventListener("close", onCloseOrError);
      ws.addEventListener("error", onCloseOrError);
      ws.addEventListener("message", onMessage);
    }

    openSocket();

    // Decision D1g: unconditional teardown regardless of current state —
    // closes the live/in-flight socket and clears both timers.
    return () => {
      unmountedRef.current = true;
      clearRetryTimer();
      clearFloorTimer();
      teardownCurrentSocket();
      if (socketRef.current) {
        socketRef.current.close();
      }
      socketRef.current = null;
    };
    // Decision D1d: connect is read through connectRef, intentionally not a dependency of this effect.
  }, []);

  return { state, socket };
}
