import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignOutButton } from "../SignOutButton.js";

describe("SignOutButton", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });

  it("renders sign out button", () => {
    render(<SignOutButton />);
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("redirects to redirectUrl on successful sign out", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ redirectUrl: "/goodbye" }),
    } as Response);

    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByText("Sign out"));

    await waitFor(() => {
      expect(window.location.href).toBe("/goodbye");
    });
  });

  it("redirects to / when no redirectUrl", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByText("Sign out"));

    await waitFor(() => {
      expect(window.location.href).toBe("/");
    });
  });

  it("shows confirmation dialog when confirmRequired", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ confirmRequired: true }),
    } as Response);

    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByText("Sign out"));

    await waitFor(() => {
      expect(screen.getByText("Yes, sign out")).toBeInTheDocument();
    });
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("confirms sign out from dialog", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ confirmRequired: true }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ redirectUrl: "/done" }),
      } as Response);

    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByText("Sign out"));

    await waitFor(() => {
      expect(screen.getByText("Yes, sign out")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Yes, sign out"));

    await waitFor(() => {
      expect(window.location.href).toBe("/done");
    });
    expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
      "/auth/logout?confirmed=true",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("cancels confirmation dialog", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ confirmRequired: true }),
    } as Response);

    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByText("Sign out"));

    await waitFor(() => {
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Cancel"));
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });

  it("shows error on failed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as Response);

    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByText("Sign out"));

    await waitFor(() => {
      expect(screen.getByText(/Sign-out failed/)).toBeInTheDocument();
    });
  });

  it("shows error on network failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));

    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByText("Sign out"));

    await waitFor(() => {
      expect(screen.getByText(/Unable to reach the server/)).toBeInTheDocument();
    });
  });
});
