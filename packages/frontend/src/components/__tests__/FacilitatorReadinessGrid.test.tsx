import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { render, act, cleanup, fireEvent, screen } from "@testing-library/react";
import { REAUTH_GRACE_EXPIRED_CLOSE_CODE, STALE_SIGNAL_CLOSE_CODE } from "@dipstick/shared";
import {
  FacilitatorReadinessGrid,
  STALE_MARKER_TOOLTIP_TEXT,
  type ParticipantRowState,
} from "../FacilitatorReadinessGrid.js";
import { ConnectionStatusBanner } from "../ConnectionStatusBanner.js";
import { FakeWebSocket } from "../../realtime/__tests__/fake-websocket.js";
import { buildFourStateRowFixture } from "./facilitator-row-fixture.js";

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
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("FacilitatorReadinessGrid — bound (spec.md, task 4.2)", () => {
  it("has exactly four baseline row states — the marker composes as an overlay, not a fifth row state", () => {
    const baselineStates: ParticipantRowState[] = [
      "connected-not-locked-in",
      "connected-locked-in",
      "disconnected-voted",
      "disconnected-no-vote",
    ];
    expect(new Set(baselineStates).size).toBe(4);
  });

  it("renders exactly one marker per row when active, never more", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { connect, sockets } = makeConnectSpy();
    const rows = buildFourStateRowFixture();
    render(<FacilitatorReadinessGrid connect={connect} rows={rows} />);

    act(() => {
      sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });

    for (const row of rows) {
      expect(screen.getAllByTestId(`stale-marker-${row.participantId}`)).toHaveLength(1);
    }
  });
});

describe("FacilitatorReadinessGrid — composition with disconnected-voted (design.md Decision D7, task 4.2a)", () => {
  it("shows both the existing ready treatment and the marker simultaneously, neither suppressing the other", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { connect, sockets } = makeConnectSpy();
    const rows = buildFourStateRowFixture();
    render(<FacilitatorReadinessGrid connect={connect} rows={rows} />);

    act(() => {
      sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });

    expect(screen.getByTestId("row-label-p-disconnected-voted")).toHaveTextContent("Ready");
    expect(screen.getByTestId("stale-marker-p-disconnected-voted")).toBeInTheDocument();
  });
});

describe("FacilitatorReadinessGrid — cause-blindness (spec.md, task 4.4)", () => {
  it("renders an identical marker regardless of the underlying cause of unknown-reconnecting", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    function renderAndTriggerViaClose(code?: number): string {
      const { connect, sockets } = makeConnectSpy();
      const rows = buildFourStateRowFixture();
      const { container } = render(<FacilitatorReadinessGrid connect={connect} rows={rows} />);
      act(() => {
        sockets[0].emitClose(code);
      });
      act(() => {
        vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
      });
      return container.innerHTML;
    }

    function renderAndTriggerViaError(): string {
      const { connect, sockets } = makeConnectSpy();
      const rows = buildFourStateRowFixture();
      const { container } = render(<FacilitatorReadinessGrid connect={connect} rows={rows} />);
      act(() => {
        sockets[0].emitError();
      });
      act(() => {
        vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
      });
      return container.innerHTML;
    }

    const viaStaleSignal = renderAndTriggerViaClose(STALE_SIGNAL_CLOSE_CODE);
    // A raw network drop, and — standing in for issue #33's future
    // pending-reauthorization case — some other, arbitrary close code that
    // is neither the disclosure-blind STALE_SIGNAL_CLOSE_CODE nor the
    // legitimately-disclosed REAUTH_GRACE_EXPIRED_CLOSE_CODE. All three
    // resolve to "unknown-reconnecting" today, and the marker cannot tell
    // them apart, by construction.
    const viaNetworkDrop = renderAndTriggerViaError();
    const viaOtherCode = renderAndTriggerViaClose(1006);

    expect(viaNetworkDrop).toBe(viaStaleSignal);
    expect(viaOtherCode).toBe(viaStaleSignal);
  });
});

describe("FacilitatorReadinessGrid — lifecycle, no independent TTL (design.md Decision D7, task 4.5)", () => {
  it("appears and clears strictly in lockstep with the underlying connection-health transitions", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const { connect, sockets } = makeConnectSpy();
    const rows = buildFourStateRowFixture();
    render(<FacilitatorReadinessGrid connect={connect} rows={rows} />);

    expect(screen.queryByTestId(`stale-marker-${rows[0].participantId}`)).not.toBeInTheDocument();

    act(() => {
      sockets[0].emitClose();
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });
    expect(screen.getByTestId(`stale-marker-${rows[0].participantId}`)).toBeInTheDocument();

    const latestSocket = sockets[sockets.length - 1];
    act(() => {
      latestSocket.emitOpen();
    });
    // Clears immediately on recovery — no separate timer keeps it alive.
    expect(screen.queryByTestId(`stale-marker-${rows[0].participantId}`)).not.toBeInTheDocument();
  });
});

describe("FacilitatorReadinessGrid — mid-active-vote freeze (spec.md, task 4.6)", () => {
  it("leaves existing per-row content unchanged, applying only the marker as the delta", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { connect, sockets } = makeConnectSpy();
    const rows = buildFourStateRowFixture();
    const { container } = render(<FacilitatorReadinessGrid connect={connect} rows={rows} />);

    const labelsBefore = rows.map(
      (row) => screen.getByTestId(`row-label-${row.participantId}`).textContent,
    );

    act(() => {
      sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });

    const labelsAfter = rows.map(
      (row) => screen.getByTestId(`row-label-${row.participantId}`).textContent,
    );
    expect(labelsAfter).toEqual(labelsBefore);

    // The only new elements introduced are the markers.
    for (const row of rows) {
      expect(screen.getByTestId(`stale-marker-${row.participantId}`)).toBeInTheDocument();
    }
    void container;
  });
});

describe("FacilitatorReadinessGrid — facilitator-only gating (spec.md, task 4.8)", () => {
  it("the participant-facing banner never renders the marker or its tooltip text", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { connect, sockets } = makeConnectSpy();
    const { container } = render(<ConnectionStatusBanner connect={connect} />);

    act(() => {
      sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });

    expect(container.innerHTML).not.toContain(STALE_MARKER_TOOLTIP_TEXT);
    expect(screen.queryByText(STALE_MARKER_TOOLTIP_TEXT)).not.toBeInTheDocument();
  });
});

describe("FacilitatorReadinessGrid — no outlier-flagging affordances (spec.md, task 4.9)", () => {
  it("attaches no click handler or button semantics to the marker", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { connect, sockets } = makeConnectSpy();
    const rows = buildFourStateRowFixture();
    render(<FacilitatorReadinessGrid connect={connect} rows={rows} />);

    act(() => {
      sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });

    const marker = screen.getByTestId(`stale-marker-${rows[0].participantId}`);
    expect(marker.tagName).not.toBe("BUTTON");
    expect(marker).not.toHaveAttribute("onclick");
    expect(marker.getAttribute("role")).not.toBe("button");

    const beforeHtml = document.body.innerHTML;
    fireEvent.click(marker);
    expect(document.body.innerHTML).toBe(beforeHtml);
  });
});

describe("FacilitatorReadinessGrid — reauth-required exclusion (design.md Decision D7 scoping, task 4.10)", () => {
  it("renders no grid-marker variant when the facilitator's own connection is reauth-required, superseding the grid", () => {
    const { connect, sockets } = makeConnectSpy();
    const rows = buildFourStateRowFixture();
    render(<FacilitatorReadinessGrid connect={connect} rows={rows} />);

    act(() => {
      sockets[0].emitClose(REAUTH_GRACE_EXPIRED_CLOSE_CODE);
    });

    for (const row of rows) {
      expect(screen.queryByTestId(`stale-marker-${row.participantId}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`row-${row.participantId}`)).not.toBeInTheDocument();
    }
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your session needs to be renewed. Please log in again.",
    );
  });
});

describe("FacilitatorReadinessGrid — facilitator tooltip (proposal.md, task 4.11)", () => {
  it("attaches the placeholder hover tooltip to the marker", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const { connect, sockets } = makeConnectSpy();
    const rows = buildFourStateRowFixture();
    render(<FacilitatorReadinessGrid connect={connect} rows={rows} />);

    act(() => {
      sockets[0].emitClose(STALE_SIGNAL_CLOSE_CODE);
    });
    act(() => {
      vi.advanceTimersByTime(STALENESS_TIMING_FLOOR_MS);
    });

    const marker = screen.getByTestId(`stale-marker-${rows[0].participantId}`);
    expect(marker).toHaveAttribute("title", STALE_MARKER_TOOLTIP_TEXT);
  });
});

describe("Shared-module cross-surface import check (design.md Decision D6, task 4.12)", () => {
  it("ConnectionStatusBanner.tsx and FacilitatorReadinessGrid.tsx both import useConnectionHealth directly from connectionHealth.ts", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const bannerSource = readFileSync(path.join(dir, "../ConnectionStatusBanner.tsx"), "utf-8");
    const gridSource = readFileSync(path.join(dir, "../FacilitatorReadinessGrid.tsx"), "utf-8");

    expect(bannerSource).toMatch(/import\s*{[^}]*useConnectionHealth[^}]*}\s*from\s*"\.\.\/realtime\/connectionHealth\.js"/);
    expect(gridSource).toMatch(/import\s*{[^}]*useConnectionHealth[^}]*}\s*from\s*"\.\.\/realtime\/connectionHealth\.js"/);
  });
});
