import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { FacilitatorConnectionHost } from "../FacilitatorConnectionHost.js";
import { FakeWebSocket } from "../../realtime/__tests__/fake-websocket.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FacilitatorConnectionHost — minimal host surface (design.md Decision D9, task 5.2)", () => {
  it("wires FacilitatorReadinessGrid to a real WebSocket connection and a stub four-state row list", () => {
    vi.stubGlobal(
      "WebSocket",
      vi.fn(() => new FakeWebSocket()),
    );

    render(
      <MemoryRouter initialEntries={["/session/session-42/facilitator"]}>
        <Routes>
          <Route path="/session/:sessionId/facilitator" element={<FacilitatorConnectionHost />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("facilitator-connection-host")).toBeInTheDocument();
    expect(screen.getByTestId("row-stub-connected-not-locked-in")).toBeInTheDocument();
    expect(screen.getByTestId("row-stub-connected-locked-in")).toBeInTheDocument();
    expect(screen.getByTestId("row-stub-disconnected-voted")).toBeInTheDocument();
    expect(screen.getByTestId("row-stub-disconnected-no-vote")).toBeInTheDocument();
  });
});
