import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthLoadingPage } from "../AuthLoadingPage.js";

describe("AuthLoadingPage", () => {
  it("renders signing in text", () => {
    render(<AuthLoadingPage />);
    expect(screen.getByText("Signing you in...")).toBeInTheDocument();
    expect(screen.getByText("Engineering Health Check")).toBeInTheDocument();
  });
});
