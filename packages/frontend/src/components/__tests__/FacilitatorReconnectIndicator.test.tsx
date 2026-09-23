import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, act, fireEvent } from "@testing-library/react";
import { FacilitatorReconnectIndicator } from "../FacilitatorReconnectIndicator.js";
import { FakeWebSocket } from "../../realtime/__tests__/fake-websocket.js";

afterEach(() => {
  cleanup();
});

describe("FacilitatorReconnectIndicator (facilitator-reconnect-indicator, session-timeout-continuity design.md Decision 5)", () => {
  it("renders nothing before any signal is received", () => {
    const socket = new FakeWebSocket();
    const { container } = render(
      <FacilitatorReconnectIndicator socket={socket as unknown as WebSocket} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders a quiet, one-line role=status indicator when connected: false is received", () => {
    const socket = new FakeWebSocket();
    render(<FacilitatorReconnectIndicator socket={socket as unknown as WebSocket} />);

    act(() => {
      socket.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: false } });
    });

    const indicator = screen.getByRole("status");
    expect(indicator).toBeInTheDocument();
    expect(indicator.textContent).toMatch(/reconnecting/i);
  });

  it("never uses role=alert", () => {
    const socket = new FakeWebSocket();
    render(<FacilitatorReconnectIndicator socket={socket as unknown as WebSocket} />);

    act(() => {
      socket.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: false } });
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears when connected: true is subsequently received", () => {
    const socket = new FakeWebSocket();
    const { container } = render(
      <FacilitatorReconnectIndicator socket={socket as unknown as WebSocket} />,
    );

    act(() => {
      socket.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: false } });
    });
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => {
      socket.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: true } });
    });
    expect(container.innerHTML).toBe("");
  });

  it("contains no countdown, cause, or sub-cause disclosure", () => {
    const socket = new FakeWebSocket();
    render(<FacilitatorReconnectIndicator socket={socket as unknown as WebSocket} />);

    act(() => {
      socket.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: false } });
    });

    const text = screen.getByRole("status").textContent ?? "";
    expect(text).not.toMatch(/\d+\s*(s|sec|second|m|min|minute)s?\b/i);
    expect(text.toLowerCase()).not.toMatch(/network|revoked|transient_failure|reauth|stale/);
  });

  it("has no click handler or auto-notify side effect (design.md Decision 5, tasks.md task 4.13)", () => {
    const socket = new FakeWebSocket();
    render(<FacilitatorReconnectIndicator socket={socket as unknown as WebSocket} />);

    act(() => {
      socket.emitMessage({ eventType: "facilitator_connection_status", payload: { connected: false } });
    });

    const indicator = screen.getByRole("status");
    expect(indicator.tagName).not.toBe("BUTTON");
    expect(indicator.getAttribute("role")).not.toBe("button");
    expect(indicator).not.toHaveAttribute("onclick");

    const beforeHtml = document.body.innerHTML;
    fireEvent.click(indicator);
    expect(document.body.innerHTML).toBe(beforeHtml);
  });
});
