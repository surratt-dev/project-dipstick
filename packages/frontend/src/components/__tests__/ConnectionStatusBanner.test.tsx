import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, cleanup, screen, fireEvent } from "@testing-library/react";
import { REAUTH_GRACE_EXPIRED_CLOSE_CODE, STALE_SIGNAL_CLOSE_CODE } from "@dipstick/shared";
import { useConnectionHealth } from "../../realtime/connectionHealth.js";
import { ConnectionStatusBanner } from "../ConnectionStatusBanner.js";
import { FakeWebSocket } from "../../realtime/__tests__/fake-websocket.js";

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

// session-timeout-continuity (design.md Decision 6, tasks.md task 4.2): this
// component no longer calls useConnectionHealth itself — SessionConnectionHost
// does, passing state/socket down as props. This harness reproduces that
// call-site relocation exactly, so every existing socket-driven test below
// (emitClose/emitError/emitMessage) continues to exercise the same real
// state machine, unchanged.
function ConnectionStatusBannerHarness({ connect }: { connect: () => WebSocket }) {
  const { state, socket } = useConnectionHealth(connect);
  return <ConnectionStatusBanner state={state} socket={socket} />;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ConnectionStatusBanner — rendered-output identity (spec.md, task 3.2)", () => {
  it("renders byte-for-byte identical output for unknown-reconnecting whether triggered by a close code or a raw network error", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const a = makeConnectSpy();
    const { container: containerA } = render(<ConnectionStatusBannerHarness connect={a.connect} />);
    act(() => {
      a.sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });

    const b = makeConnectSpy();
    const { container: containerB } = render(<ConnectionStatusBannerHarness connect={b.connect} />);
    act(() => {
      b.sockets[0].emitError();
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });

    expect(containerA.innerHTML).not.toBe("");
    expect(containerA.innerHTML).toBe(containerB.innerHTML);
  });

  it("renders byte-for-byte identical output for reauth-required whether triggered by a 4001 close or a reauth_required message, and it differs from unknown-reconnecting's output", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const viaClose = makeConnectSpy();
    const { container: closeContainer } = render(<ConnectionStatusBannerHarness connect={viaClose.connect} />);
    act(() => {
      viaClose.sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });

    const viaMessage = makeConnectSpy();
    const { container: messageContainer } = render(<ConnectionStatusBannerHarness connect={viaMessage.connect} />);
    act(() => {
      viaMessage.sockets[0].emitMessage({ eventType: "reauth_required" });
    });

    expect(closeContainer.innerHTML).not.toBe("");
    expect(closeContainer.innerHTML).toBe(messageContainer.innerHTML);

    const unknownReconnecting = makeConnectSpy();
    const { container: unknownContainer } = render(<ConnectionStatusBannerHarness connect={unknownReconnecting.connect} />);
    act(() => {
      unknownReconnecting.sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });

    expect(unknownContainer.innerHTML).not.toBe(closeContainer.innerHTML);
  });

  it("renders nothing while connected", () => {
    const { connect } = makeConnectSpy();
    const { container } = render(<ConnectionStatusBannerHarness connect={connect} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ConnectionStatusBanner — plain, non-blaming, non-urgent language (design.md Context constraints, task 3.3)", () => {
  it("uses no exclamation, no 'error' language, and no alarm-red inline styling for unknown-reconnecting", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const { connect, sockets } = makeConnectSpy();
    const { container } = render(<ConnectionStatusBannerHarness connect={connect} />);
    act(() => {
      sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/!/);
    expect(text.toLowerCase()).not.toMatch(/\berror\b/);
    expect(container.innerHTML.toLowerCase()).not.toMatch(/color:\s*red|#f00|#ff0000/);
  });

  it("uses no exclamation, no 'error' language, and no alarm-red inline styling for reauth-required", () => {
    const { connect, sockets } = makeConnectSpy();
    const { container } = render(<ConnectionStatusBannerHarness connect={connect} />);
    act(() => {
      sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });

    const text = container.textContent ?? "";
    expect(text).not.toMatch(/!/);
    expect(text.toLowerCase()).not.toMatch(/\berror\b/);
    expect(container.innerHTML.toLowerCase()).not.toMatch(/color:\s*red|#f00|#ff0000/);
  });
});

describe("ConnectionStatusBanner — reauth-required call-to-action (design.md Decision D2, tasks.md tasks 2.4-2.5)", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", { writable: true, value: originalLocation });
  });

  it("renders an enabled call-to-action from first render, whether entered via the grace-expired close code or a reauth_required message", () => {
    const viaClose = makeConnectSpy();
    render(<ConnectionStatusBannerHarness connect={viaClose.connect} />);
    act(() => {
      viaClose.sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });
    const closeButton = screen.getByRole("button", { name: /log in again/i });
    expect(closeButton).toBeInTheDocument();
    expect(closeButton).not.toBeDisabled();
    cleanup();

    const viaMessage = makeConnectSpy();
    render(<ConnectionStatusBannerHarness connect={viaMessage.connect} />);
    act(() => {
      viaMessage.sockets[0].emitMessage({ eventType: "reauth_required" });
    });
    const messageButton = screen.getByRole("button", { name: /log in again/i });
    expect(messageButton).toBeInTheDocument();
    expect(messageButton).not.toBeDisabled();
  });

  it("activating the control sets window.location.href to /auth/login?returnTo=<current path and query>, and triggers no other navigation (session-timeout-continuity design.md Decision 3)", () => {
    const expectedReturnTo = originalLocation.pathname + originalLocation.search;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });

    const { connect, sockets } = makeConnectSpy();
    render(<ConnectionStatusBannerHarness connect={connect} />);
    act(() => {
      sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });

    fireEvent.click(screen.getByRole("button", { name: /log in again/i }));

    expect(window.location.href).toBe(`/auth/login?returnTo=${encodeURIComponent(expectedReturnTo)}`);
  });

  it("the returnTo value passed through is exactly the current page's path and query string — nothing derived from connection state or cause (design.md Decision 3's disclosure bound, tasks.md task 3.9)", () => {
    const expectedReturnTo = originalLocation.pathname + originalLocation.search;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });

    const { connect, sockets } = makeConnectSpy();
    render(<ConnectionStatusBannerHarness connect={connect} />);
    act(() => {
      sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });

    fireEvent.click(screen.getByRole("button", { name: /log in again/i }));

    const hrefUrl = new URL(window.location.href, "http://localhost");
    const returnToParam = hrefUrl.searchParams.get("returnTo");
    expect(returnToParam).toBe(expectedReturnTo);
    expect(returnToParam).not.toMatch(/reauth|unknown-reconnecting|revoked|transient_failure/i);
    expect(Array.from(hrefUrl.searchParams.keys())).toEqual(["returnTo"]);
  });
});

describe("ConnectionStatusBanner — ARIA role identity (spec.md, tasks.md task 4.5)", () => {
  it("gives unknown-reconnecting role=status and reauth-required role=alert", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const unknown = makeConnectSpy();
    render(<ConnectionStatusBannerHarness connect={unknown.connect} />);
    act(() => {
      unknown.sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    cleanup();

    const reauth = makeConnectSpy();
    render(<ConnectionStatusBannerHarness connect={reauth.connect} />);
    act(() => {
      reauth.sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("ConnectionStatusBanner — reauth-required persistence and non-modal bound (spec.md, tasks.md tasks 4.3, 4.6)", () => {
  it("stays rendered with no dismiss affordance, and uses no dialog/focus-trap mechanism", () => {
    const { connect, sockets } = makeConnectSpy();
    const { container } = render(<ConnectionStatusBannerHarness connect={connect} />);
    act(() => {
      sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector("[aria-modal]")).toBeNull();
    // Only the call-to-action button is present — no separate dismiss control.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
