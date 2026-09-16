import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DevLoginPage } from "../DevLoginPage.js";
import type { DevLoginOption } from "@dipstick/shared";

const mockOptions: DevLoginOption[] = [
  { accountId: "participant-001", roleLabel: "Participant", seeded: true },
  { accountId: "facilitator-001", roleLabel: "Facilitator", seeded: false },
  { accountId: "manager-001", roleLabel: "Engineering Manager", seeded: true },
  { accountId: "admin-001", roleLabel: "Application Admin", seeded: true },
];

describe("DevLoginPage", () => {
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

  it("renders the LOCAL DEV ONLY banner", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ options: mockOptions }),
    } as Response);

    render(<DevLoginPage />);

    expect(screen.getByText(/LOCAL DEV ONLY/)).toBeInTheDocument();
  });

  it("renders one button per option, labeled with role and account id for seeded accounts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ options: mockOptions }),
    } as Response);

    render(<DevLoginPage />);

    await waitFor(() => {
      expect(screen.getByText("Participant (participant-001)")).toBeInTheDocument();
    });
    expect(screen.getByText("Engineering Manager (manager-001)")).toBeInTheDocument();
    expect(screen.getByText("Application Admin (admin-001)")).toBeInTheDocument();
  });

  it("wires each persona link to /auth/login with loginHint set to that account id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ options: mockOptions }),
    } as Response);

    render(<DevLoginPage />);

    await waitFor(() => {
      expect(screen.getByText("Participant (participant-001)")).toBeInTheDocument();
    });

    const link = screen.getByText("Participant (participant-001)").closest("a");
    expect(link).toHaveAttribute("href", "/auth/login?loginHint=participant-001");
  });

  it("labels the unseeded (Facilitator) option by account id alone, with an inline caveat, keyed off seeded === false, not a hardcoded id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ options: mockOptions }),
    } as Response);

    render(<DevLoginPage />);

    await waitFor(() => {
      expect(screen.getByText("facilitator-001")).toBeInTheDocument();
    });
    // Role name is NOT shown for the unseeded option.
    expect(screen.queryByText(/Facilitator \(facilitator-001\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/Role not seeded/)).toBeInTheDocument();
  });

  it("does not show the unseeded caveat when every option is seeded", async () => {
    const allSeeded = mockOptions.filter((o) => o.seeded);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ options: allSeeded }),
    } as Response);

    render(<DevLoginPage />);

    await waitFor(() => {
      expect(screen.getByText("Participant (participant-001)")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Role not seeded/)).not.toBeInTheDocument();
  });

  it("renders the multi-persona-use note", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ options: mockOptions }),
    } as Response);

    render(<DevLoginPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/separate browser profiles or incognito windows/),
      ).toBeInTheDocument();
    });
  });

  it("renders a plain manual sign-in link with no loginHint", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ options: mockOptions }),
    } as Response);

    render(<DevLoginPage />);

    const manualLink = screen.getByText("Sign in manually");
    expect(manualLink).toHaveAttribute("href", "/auth/login");
  });

  it("falls back to /auth/login when the options fetch fails (shortcut no longer available)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) } as Response);

    render(<DevLoginPage />);

    await waitFor(() => {
      expect(window.location.href).toBe("/auth/login");
    });
  });
});
