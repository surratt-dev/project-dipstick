import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthErrorPage } from "../AuthErrorPage.js";

describe("AuthErrorPage", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });

  it("shows default error message with no params", () => {
    render(
      <MemoryRouter initialEntries={["/auth/error"]}>
        <AuthErrorPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Sign-in Error")).toBeInTheDocument();
    expect(screen.getByText(/An error occurred during sign-in/)).toBeInTheDocument();
    expect(screen.getByText(/contact your IT administrator/)).toBeInTheDocument();
  });

  it("shows custom message from params", () => {
    render(
      <MemoryRouter initialEntries={["/auth/error?message=Custom+error"]}>
        <AuthErrorPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Custom error")).toBeInTheDocument();
  });

  it("shows retry button for provider_unavailable", () => {
    render(
      <MemoryRouter initialEntries={["/auth/error?category=provider_unavailable"]}>
        <AuthErrorPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Try Again")).toBeInTheDocument();
  });

  it("shows retry button for invalid_request", () => {
    render(
      <MemoryRouter initialEntries={["/auth/error?category=invalid_request"]}>
        <AuthErrorPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Try Again")).toBeInTheDocument();
  });

  it("does not show retry for non-retryable categories", () => {
    render(
      <MemoryRouter initialEntries={["/auth/error?category=authentication_failed"]}>
        <AuthErrorPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Try Again")).not.toBeInTheDocument();
  });

  it("shows correlation id when provided", () => {
    render(
      <MemoryRouter initialEntries={["/auth/error?correlationId=abc-123"]}>
        <AuthErrorPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Reference: abc-123/)).toBeInTheDocument();
  });

  it("does not show correlation id when not provided", () => {
    render(
      <MemoryRouter initialEntries={["/auth/error"]}>
        <AuthErrorPage />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
  });
});
