import { describe, it, expect, vi, afterEach } from "vitest";
import { StrictMode } from "react";
import { renderHook, act } from "@testing-library/react";
import { REAUTH_GRACE_EXPIRED_CLOSE_CODE, STALE_SIGNAL_CLOSE_CODE } from "@dipstick/shared";
import {
  useConnectionHealth,
  computeRetryDelay,
  assertExhaustiveConnectionHealthState,
} from "../connectionHealth.js";
import { FakeWebSocket } from "./fake-websocket.js";

/** Development-time placeholder mirrored from connectionHealth.ts's module-local constant (design.md Decision D3). */
const STALENESS_TIMING_FLOOR_MS = 2000;

function makeConnectSpy(): { connect: () => WebSocket; sockets: FakeWebSocket[] } {
  const sockets: FakeWebSocket[] = [];
  const connect = vi.fn(() => {
    const ws = new FakeWebSocket();
    sockets.push(ws);
    return ws as unknown as WebSocket;
  });
  return { connect, sockets };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("computeRetryDelay (design.md Decision D2)", () => {
  it("is a pure function of attempt count and Math.random, with full jitter up to a 30s cap", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(computeRetryDelay(0)).toBe(500); // upperBound 1000
    expect(computeRetryDelay(1)).toBe(1000); // upperBound 2000
    expect(computeRetryDelay(4)).toBe(8000); // upperBound 16000
    expect(computeRetryDelay(5)).toBe(15000); // upperBound capped at 30000
    expect(computeRetryDelay(10)).toBe(15000); // still capped
  });

  it("takes no rng/seed parameter — the only argument surface is the attempt count", () => {
    expect(computeRetryDelay.length).toBe(1);
  });
});

describe("exhaustiveness guard (design.md Decision D1, task 1.2)", () => {
  it("throws at the runtime default branch for a state outside the known union", () => {
    // The actual guard this proves is compile-time: assertExhaustiveConnectionHealthState's
    // `never` parameter fails to compile once ConnectionHealthState gains a fourth value
    // and a switch's default branch stops narrowing to `never` (design.md Decision D1,
    // correcting the Engineer design review's finding that a switch with no default does
    // NOT fail to compile on a missing case). This test exercises the runtime fallback the
    // same guard also provides, since a failed compilation cannot itself be asserted from
    // inside a Vitest runtime test in this repo (no dedicated type-check harness exists for
    // packages/frontend today — `vite build` does not type-check).
    expect(() =>
      assertExhaustiveConnectionHealthState("some-fourth-state" as unknown as never),
    ).toThrow(/unreachable state/);
  });
});

describe("useConnectionHealth — connect ref capture (design.md Decision D1d, task 1.1b)", () => {
  it("does not tear down or reconnect the live socket when connect's identity changes across re-renders", () => {
    const { connect, sockets } = makeConnectSpy();
    const { rerender } = renderHook(({ c }) => useConnectionHealth(c), {
      initialProps: { c: connect as () => WebSocket },
    });

    expect(sockets.length).toBe(1);
    const firstSocket = sockets[0];

    // Simulate a naive call site supplying a fresh inline closure every render.
    rerender({ c: () => connect() });
    rerender({ c: () => connect() });
    rerender({ c: () => connect() });

    expect(sockets.length).toBe(1);
    expect(firstSocket.closeCalls.length).toBe(0);
  });
});

describe("useConnectionHealth — message-stream ownership (design.md Decision D1e, task 1.1c)", () => {
  it("composes with a second addEventListener('message', ...) attached to the returned socket", () => {
    const { connect, sockets } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    const external = vi.fn();
    result.current.socket?.addEventListener("message", external);

    act(() => {
      sockets[0].emitMessage({ eventType: "reauth_required" });
    });

    expect(external).toHaveBeenCalledTimes(1);
    // The hook's own handling ran too — proof neither listener clobbered the other.
    expect(result.current.state).toBe("reauth-required");
  });
});

describe("useConnectionHealth — unmount and teardown (design.md Decision D1g, task 1.1d)", () => {
  it("does not reconnect or update state after unmount, even with a retry pending", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { connect, sockets } = makeConnectSpy();
    const { result, unmount } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitClose();
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe("connected");
  });

  it("ends with exactly one live socket after a React 18 StrictMode double-invoke", () => {
    const { connect, sockets } = makeConnectSpy();
    renderHook(() => useConnectionHealth(connect), { wrapper: StrictMode });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(sockets[0].readyState).toBe(FakeWebSocket.CLOSED);
    expect(sockets[1].readyState).not.toBe(FakeWebSocket.CLOSED);
  });
});

describe("useConnectionHealth — retry-symmetry (proposal.md acceptance condition, task 1.4)", () => {
  it("schedules identical retry timing for a STALE_SIGNAL_CLOSE_CODE close and a raw network close/error", () => {
    vi.useFakeTimers();

    function runEpisode(trigger: (ws: FakeWebSocket) => void): number[] {
      const jitterSequence = [0.1, 0.25, 0.4, 0.6, 0.15];
      let index = 0;
      const spy = vi
        .spyOn(Math, "random")
        .mockImplementation(() => jitterSequence[index++ % jitterSequence.length]);

      const { connect, sockets } = makeConnectSpy();
      renderHook(() => useConnectionHealth(connect));

      act(() => {
        trigger(sockets[0]);
      });

      const checkpoints = [0, 500, 900, 1900, 3900, 7900, 15900];
      const callCounts: number[] = [];
      let elapsed = 0;
      for (const target of checkpoints) {
        act(() => {
          vi.advanceTimersByTime(target - elapsed);
        });
        elapsed = target;
        callCounts.push(connect.mock.calls.length);
      }

      spy.mockRestore();
      return callCounts;
    }

    const viaCloseCode = runEpisode((ws) => ws.emitClose(STALE_SIGNAL_CLOSE_CODE));
    const viaNetworkError = runEpisode((ws) => ws.emitError());
    const viaNetworkClose = runEpisode((ws) => ws.emitClose());

    expect(viaNetworkError).toEqual(viaCloseCode);
    expect(viaNetworkClose).toEqual(viaCloseCode);
  });
});

describe("useConnectionHealth — timing floor (design.md Decision D3, task 1.6)", () => {
  it("does not surface unknown-reconnecting before the floor elapses, for an instantly-failing close", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitClose();
    });

    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS - 1);
    });
    expect(result.current.state).toBe("connected");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.state).toBe("unknown-reconnecting");
  });

  it("holds a slower-failing network drop to the identical floor, measured from the close event", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.state).toBe("connected");

    act(() => {
      sockets[0].emitClose();
    });

    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS - 1);
    });
    expect(result.current.state).toBe("connected");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.state).toBe("unknown-reconnecting");
  });
});

describe("useConnectionHealth — early recovery before the floor elapses (design.md Decision D3a, task 1.6a)", () => {
  it("never surfaces unknown-reconnecting if reconnect succeeds before the floor elapses", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.1); // attempt-0 delay: 100ms — well inside the 2000ms floor

    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitClose();
    });
    expect(result.current.state).toBe("connected");

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(sockets.length).toBe(2);
    expect(result.current.state).toBe("connected");

    act(() => {
      sockets[1].emitOpen();
    });
    expect(result.current.state).toBe("connected");

    // Advance well past when the (now-cancelled) floor timer would have fired.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.state).toBe("connected");
  });
});

describe("useConnectionHealth — initial-connection-failure bucketing (design.md Decision D5, task 1.7)", () => {
  it("routes a first-ever rejected subscription through the identical path as a mid-session drop", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    // No prior "open" event ever fired — this is the very first attempt.
    act(() => {
      sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });

    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });
    expect(result.current.state).toBe("unknown-reconnecting");
    expect(connect.mock.calls.length).toBeGreaterThan(1);
  });
});

describe("useConnectionHealth — silent recovery (design.md Decision D4, task 1.8)", () => {
  it("emits no signal beyond the state value itself when returning to connected", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitClose();
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });
    expect(result.current.state).toBe("unknown-reconnecting");

    const latestSocket = sockets[sockets.length - 1];
    act(() => {
      latestSocket.emitOpen();
    });

    expect(result.current.state).toBe("connected");
    expect(Object.keys(result.current).sort()).toEqual(["socket", "state"]);
  });
});

describe("useConnectionHealth — reauth-required detection and no-retry (design.md Decision D1a, tasks 1.10/1.11)", () => {
  it("transitions to reauth-required via the reauth_required message, calling computeRetryDelay zero times", () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random");

    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitMessage({ eventType: "reauth_required" });
    });

    expect(result.current.state).toBe("reauth-required");
    expect(randomSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("transitions to reauth-required via a REAUTH_GRACE_EXPIRED_CLOSE_CODE close, calling computeRetryDelay zero times", () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, "random");

    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });

    expect(result.current.state).toBe("reauth-required");
    expect(randomSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe("useConnectionHealth — malformed or unrecognized messages", () => {
  it("ignores a non-JSON message body without crashing or changing state", () => {
    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].dispatchEvent(new MessageEvent("message", { data: "not json" }));
    });

    expect(result.current.state).toBe("connected");
  });

  it("ignores a JSON message with no eventType field without crashing or changing state", () => {
    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitMessage({ foo: "bar" });
    });

    expect(result.current.state).toBe("connected");
  });

  it("ignores a recognized-but-different eventType without changing state", () => {
    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitMessage({ eventType: "vote_readiness_update", payload: {} });
    });

    expect(result.current.state).toBe("connected");
  });
});

describe("useConnectionHealth — reauth-required sub-cause-blindness (task 1.13)", () => {
  it("exposes no information beyond the reauth-required state value itself", () => {
    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });

    expect(result.current.state).toBe("reauth-required");
    expect(Object.keys(result.current).sort()).toEqual(["socket", "state"]);
  });
});

describe("useConnectionHealth — no-fallthrough between the disclosure-blind pair and reauth-required (task 1.12)", () => {
  it("never reaches reauth-required via STALE_SIGNAL_CLOSE_CODE or a raw close/error", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.1);

    const a = makeConnectSpy();
    const { result: resultA } = renderHook(() => useConnectionHealth(a.connect));
    act(() => {
      a.sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });
    expect(resultA.current.state).toBe("unknown-reconnecting");

    const b = makeConnectSpy();
    const { result: resultB } = renderHook(() => useConnectionHealth(b.connect));
    act(() => {
      b.sockets[0].emitError();
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });
    expect(resultB.current.state).toBe("unknown-reconnecting");
  });

  it("never reaches unknown-reconnecting via a reauth_required message or a REAUTH_GRACE_EXPIRED_CLOSE_CODE close", () => {
    const c = makeConnectSpy();
    const { result: resultC } = renderHook(() => useConnectionHealth(c.connect));
    act(() => {
      c.sockets[0].emitMessage({ eventType: "reauth_required" });
    });
    expect(resultC.current.state).toBe("reauth-required");

    const d = makeConnectSpy();
    const { result: resultD } = renderHook(() => useConnectionHealth(d.connect));
    act(() => {
      d.sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });
    expect(resultD.current.state).toBe("reauth-required");
  });
});

describe("useConnectionHealth — sticky-state race guards (design.md Decision D1c, tasks 1.14/1.15)", () => {
  it("Race A: a late close carrying STALE_SIGNAL_CLOSE_CODE after reauth-required is already entered does not revert state", () => {
    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitMessage({ eventType: "reauth_required" });
    });
    expect(result.current.state).toBe("reauth-required");

    // The socket's own eventual, expected 4001 close — or a coincident SEC-25 sweep tick.
    act(() => {
      sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    expect(result.current.state).toBe("reauth-required");
  });

  it("Race B: a pending retry timer from unknown-reconnecting is cancelled the instant reauth-required is entered and never fires connect() again", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const { sockets, connect } = makeConnectSpy();
    const { result } = renderHook(() => useConnectionHealth(connect));

    act(() => {
      sockets[0].emitClose(); // schedules floor timer + retry attempt 0 (delay 900ms)
    });

    act(() => {
      vi.advanceTimersByTime(900); // retry fires -> a second socket is opened
    });
    expect(connect).toHaveBeenCalledTimes(2);

    act(() => {
      sockets[1].emitClose(); // this attempt also fails -> schedules retry attempt 1 (delay 1800ms), a PENDING timer
    });

    act(() => {
      sockets[1].emitMessage({ eventType: "reauth_required" });
    });
    expect(result.current.state).toBe("reauth-required");

    act(() => {
      vi.advanceTimersByTime(10000); // well past when the pending retry timer would have fired
    });
    expect(connect).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("reauth-required");
  });
});
