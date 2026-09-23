import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { ReauthRequiredTreatment } from "../ReauthRequiredTreatment.js";
import { voteComposeUiWiresVoteDraft } from "../../realtime/__tests__/voteComposeWiring.js";

afterEach(() => {
  cleanup();
});

describe("ReauthRequiredTreatment — no countdown or numeric grace-period value (design.md Decision D3, tasks.md task 3.3)", () => {
  it("never matches a digit-plus-time-unit pattern anywhere in its rendered output, text or attributes alike", () => {
    const { container } = render(<ReauthRequiredTreatment role="participant" />);
    // outerHTML serializes both text nodes and attribute values (aria-label,
    // title, data-*, etc.), per Tomás Ferreira's security review widening
    // this check beyond the visible text node alone.
    const html = container.innerHTML;
    const digitTimeUnitPattern = /\d+\s*(s|sec|second|m|min|minute)s?\b/i;
    expect(html).not.toMatch(digitTimeUnitPattern);
  });
});

describe("ReauthRequiredTreatment — no animation, transition, or elapsed-time-tied duration (design.md Decision D3, tasks.md task 1.2)", () => {
  it("never contains animation, transition, @keyframes, or a duration property anywhere in its rendered styling", () => {
    const { container } = render(<ReauthRequiredTreatment role="participant" />);
    // Standing, CI-enforced check replacing a one-time manual grep, so a
    // later unrelated change (a hover effect, an attention pulse) can't
    // silently reintroduce a countdown-surrogate animation. Scoped to
    // container.innerHTML because the register's styling lives entirely in
    // the component's inline `style` object today, which React serializes
    // into the DOM's `style` attribute — the same visibility the
    // digit-pattern check above relies on. If styling ever moves to an
    // external stylesheet or CSS Module, this check must be extended to
    // inspect that file directly, since innerHTML has no visibility into
    // rules defined there (design.md Decision D3).
    const html = container.innerHTML;
    expect(html).not.toMatch(/animation/i);
    expect(html).not.toMatch(/transition/i);
    expect(html).not.toMatch(/@keyframes/i);
    expect(html).not.toMatch(/duration/i);
  });
});

describe("ReauthRequiredTreatment — leaving-and-returning statement (spec.md, tasks.md task 3.5)", () => {
  it("states that continuing requires leaving and returning to the page", () => {
    const { container } = render(<ReauthRequiredTreatment role="participant" />);
    expect(container.textContent).toMatch(/leave this page and return to it/i);
  });
});

describe("ReauthRequiredTreatment — vote-loss statement consistency (design.md Decision D5, tasks.md task 3.6)", () => {
  it("includes the vote-loss statement for the participant role iff no vote-compose UI currently wires voteDraft.ts's hooks", () => {
    const { container } = render(<ReauthRequiredTreatment role="participant" />);
    const includesVoteLossStatement = /vote you haven't submitted yet will be lost/i.test(
      container.textContent ?? "",
    );

    expect(includesVoteLossStatement).toBe(!voteComposeUiWiresVoteDraft());
  });
});

describe("ReauthRequiredTreatment — facilitator role never includes the vote-loss statement (session-timeout-continuity design.md Decision 4, tasks.md task 3.7)", () => {
  it("omits the vote-loss statement for the facilitator role, regardless of the voteDraft.ts import determination", () => {
    const { container } = render(<ReauthRequiredTreatment role="facilitator" />);
    expect(container.textContent).not.toMatch(/vote you haven't submitted yet will be lost/i);
  });

  it("keeps every other required content element identical to the participant-role copy", () => {
    const { container: participantContainer } = render(<ReauthRequiredTreatment role="participant" />);
    const participantText = participantContainer.textContent ?? "";
    cleanup();
    const { container: facilitatorContainer } = render(<ReauthRequiredTreatment role="facilitator" />);
    const facilitatorText = facilitatorContainer.textContent ?? "";

    const withoutVoteLoss = participantText.replace(
      / Any vote you haven't submitted yet will be lost\./i,
      "",
    );
    expect(facilitatorText).toBe(withoutVoteLoss);
  });
});

describe("ReauthRequiredTreatment — returnTo CTA parameterization (session-timeout-continuity design.md Decision 3, tasks.md task 3.8)", () => {
  const originalLocation = window.location;

  afterEach(() => {
    Object.defineProperty(window, "location", { writable: true, value: originalLocation });
  });

  it("navigates to /auth/login?returnTo=<encoded value> when a returnTo prop is supplied", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });

    render(<ReauthRequiredTreatment role="participant" returnTo="/session/abc-123?foo=bar" />);
    fireEvent.click(screen.getByRole("button", { name: /log in again/i }));

    expect(window.location.href).toBe(
      `/auth/login?returnTo=${encodeURIComponent("/session/abc-123?foo=bar")}`,
    );
  });

  it("navigates to bare /auth/login, with no query string, when no returnTo prop is supplied", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });

    render(<ReauthRequiredTreatment role="participant" />);
    fireEvent.click(screen.getByRole("button", { name: /log in again/i }));

    expect(window.location.href).toBe("/auth/login");
  });
});

describe("ReauthRequiredTreatment — tone register (design.md Decision D4 checklist item 4)", () => {
  it("uses no exclamation and no 'error' language", () => {
    const { container } = render(<ReauthRequiredTreatment role="participant" />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/!/);
    expect(text.toLowerCase()).not.toMatch(/\berror\b/);
  });
});
