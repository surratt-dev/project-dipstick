import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { JoinErrorPage } from "../JoinErrorPage.js";

describe("JoinErrorPage", () => {
  it("renders correct primary message for ?joinError=expired", () => {
    render(
      <MemoryRouter initialEntries={["/join-error?joinError=expired"]}>
        <JoinErrorPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "This link has expired. Ask your facilitator for a new one.",
      ),
    ).toBeInTheDocument();
  });

  it("renders correct primary message for ?joinError=invalid", () => {
    render(
      <MemoryRouter initialEntries={["/join-error?joinError=invalid"]}>
        <JoinErrorPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("This link is not valid.")).toBeInTheDocument();
  });

  it("renders secondary guidance line for ?joinError=expired", () => {
    render(
      <MemoryRouter initialEntries={["/join-error?joinError=expired"]}>
        <JoinErrorPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "If this is your first time using this tool, sign out and ask the person who invited you for a new link.",
      ),
    ).toBeInTheDocument();
  });

  it("renders secondary guidance line for ?joinError=invalid", () => {
    render(
      <MemoryRouter initialEntries={["/join-error?joinError=invalid"]}>
        <JoinErrorPage />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "If this is your first time using this tool, sign out and ask the person who invited you for a new link.",
      ),
    ).toBeInTheDocument();
  });

  it("does not render a Try Again button for ?joinError=expired", () => {
    render(
      <MemoryRouter initialEntries={["/join-error?joinError=expired"]}>
        <JoinErrorPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
    // Also check for any button at all — JoinErrorPage must have no CTAs
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not render a Try Again button for ?joinError=invalid", () => {
    render(
      <MemoryRouter initialEntries={["/join-error?joinError=invalid"]}>
        <JoinErrorPage />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders invalid message as default when joinError param is missing", () => {
    render(
      <MemoryRouter initialEntries={["/join-error"]}>
        <JoinErrorPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("This link is not valid.")).toBeInTheDocument();
  });
});
