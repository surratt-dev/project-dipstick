import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NoTeamPage } from "../NoTeamPage.js";

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: vi.fn(() => ({
    loading: false,
    session: {
      user: { id: "u1", displayName: "Bob", email: "bob@test.com" },
      teamMemberships: [],
      sessionCreatedAt: "",
      expiresAt: "",
    },
  })),
}));

vi.mock("../../components/SignOutButton.js", () => ({
  SignOutButton: () => <button>Sign out mock</button>,
}));

describe("NoTeamPage", () => {
  it("displays user name and instructions", () => {
    render(<NoTeamPage />);
    expect(screen.getByText("Welcome, Bob")).toBeInTheDocument();
    expect(screen.getByText(/not yet a member of any team/)).toBeInTheDocument();
    expect(screen.getByText("Sign out mock")).toBeInTheDocument();
  });
});
