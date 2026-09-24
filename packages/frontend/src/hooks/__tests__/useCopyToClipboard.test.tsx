import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCopyToClipboard } from "../useCopyToClipboard.js";

// ---------------------------------------------------------------------------
// useCopyToClipboard — join-link-display-copy tasks.md §1.8-1.12.
//
// Exercised through a synthetic harness component (tasks.md 1.12 note: this
// section tests the hook in isolation, not the real DraftSessionHost page).
//
// fireEvent (not userEvent) is used once fake timers are active -- userEvent's
// internal delay/timer usage hangs when combined with vi.useFakeTimers(),
// the same reason ConnectionStatusBanner.test.tsx does the same.
// ---------------------------------------------------------------------------

function Harness() {
  const { copy, status } = useCopyToClipboard();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <button data-testid="copy-btn" onClick={() => void copy("https://example.test/api/join/tok")}>
        Copy
      </button>
    </div>
  );
}

function setClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

async function clickCopy() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("copy-btn"));
    // Flush the microtask queue so the writeText promise settles before
    // assertions run.
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setClipboard(undefined);
});

describe("useCopyToClipboard", () => {
  // 1.8
  it("writeText resolves -> status transitions idle -> copied -> idle after 8s", async () => {
    vi.useFakeTimers();
    setClipboard(() => Promise.resolve());

    render(<Harness />);
    expect(screen.getByTestId("status").textContent).toBe("idle");

    await clickCopy();
    expect(screen.getByTestId("status").textContent).toBe("copied");

    await act(async () => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });

  // 1.9
  it("writeText rejects -> status becomes unavailable and stays there (no auto-clear)", async () => {
    vi.useFakeTimers();
    setClipboard(() => Promise.reject(new Error("permission denied")));

    render(<Harness />);
    await clickCopy();
    expect(screen.getByTestId("status").textContent).toBe("unavailable");

    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    expect(screen.getByTestId("status").textContent).toBe("unavailable");
  });

  // 1.10
  it("navigator.clipboard undefined -> copy() never calls writeText and status becomes unavailable immediately", async () => {
    setClipboard(undefined);
    expect(navigator.clipboard).toBeUndefined();

    render(<Harness />);
    await userEvent.click(screen.getByTestId("copy-btn"));

    expect(screen.getByTestId("status").textContent).toBe("unavailable");
  });

  // 1.11
  it("a second copy() within the 8s window resets the clock instead of letting the stale timer fire early", async () => {
    vi.useFakeTimers();
    setClipboard(() => Promise.resolve());

    render(<Harness />);

    await clickCopy();
    expect(screen.getByTestId("status").textContent).toBe("copied");

    // Advance 6s (within the window), then copy again.
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    await clickCopy();
    expect(screen.getByTestId("status").textContent).toBe("copied");

    // 4s further (10s total from first copy, but only 4s from the second) —
    // the stale first timer must not have fired at the 8s-from-first mark.
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByTestId("status").textContent).toBe("copied");

    // 4s further still (8s from the second copy) -> now it clears.
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });

  // 1.12
  it("unmounting while a clear timer is pending does not throw or warn about setState after unmount", async () => {
    vi.useFakeTimers();
    setClipboard(() => Promise.resolve());
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<Harness />);
    await clickCopy();
    expect(screen.getByTestId("status").textContent).toBe("copied");

    expect(() => unmount()).not.toThrow();

    await act(async () => {
      vi.advanceTimersByTime(8000);
    });

    const setStateAfterUnmountWarning = consoleError.mock.calls.some((call) =>
      String(call[0]).includes("setState") || String(call[0]).includes("unmounted"),
    );
    expect(setStateAfterUnmountWarning).toBe(false);
  });
});
