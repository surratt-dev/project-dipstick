import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProtectedRoute } from "../ProtectedRoute.js";

vi.mock("../AuthContext.js", () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from "../AuthContext.js";

describe("ProtectedRoute", () => {
  it("shows loading when loading is true", () => {
    vi.mocked(useAuth).mockReturnValue({ loading: true, session: null });
    render(<ProtectedRoute><div>child</div></ProtectedRoute>);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders null when not loading and no session", () => {
    vi.mocked(useAuth).mockReturnValue({ loading: false, session: null });
    const { container } = render(<ProtectedRoute><div>child</div></ProtectedRoute>);
    expect(container.innerHTML).toBe("");
  });

  it("renders children when session exists", () => {
    vi.mocked(useAuth).mockReturnValue({
      loading: false,
      session: {
        user: { id: "u1", displayName: "Alice", email: "a@b.com" },
        teamMemberships: [],
        sessionCreatedAt: "",
        expiresAt: "",
      },
    });
    render(<ProtectedRoute><div>child</div></ProtectedRoute>);
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
