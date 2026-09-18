import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ReauthRequiredTreatment } from "../ReauthRequiredTreatment.js";
import { voteComposeUiWiresVoteDraft } from "../../realtime/__tests__/voteComposeWiring.js";

describe("ReauthRequiredTreatment — no countdown or numeric grace-period value (design.md Decision D3, tasks.md task 3.3)", () => {
  it("never matches a digit-plus-time-unit pattern anywhere in its rendered output, text or attributes alike", () => {
    const { container } = render(<ReauthRequiredTreatment />);
    // outerHTML serializes both text nodes and attribute values (aria-label,
    // title, data-*, etc.), per Tomás Ferreira's security review widening
    // this check beyond the visible text node alone.
    const html = container.innerHTML;
    const digitTimeUnitPattern = /\d+\s*(s|sec|second|m|min|minute)s?\b/i;
    expect(html).not.toMatch(digitTimeUnitPattern);
  });
});

describe("ReauthRequiredTreatment — leaving-and-returning statement (spec.md, tasks.md task 3.5)", () => {
  it("states that continuing requires leaving and returning to the page", () => {
    const { container } = render(<ReauthRequiredTreatment />);
    expect(container.textContent).toMatch(/leave this page and return to it/i);
  });
});

describe("ReauthRequiredTreatment — vote-loss statement consistency (design.md Decision D5, tasks.md task 3.6)", () => {
  it("includes the vote-loss statement iff no vote-compose UI currently wires voteDraft.ts's hooks", () => {
    const { container } = render(<ReauthRequiredTreatment />);
    const includesVoteLossStatement = /vote you haven't submitted yet will be lost/i.test(
      container.textContent ?? "",
    );

    expect(includesVoteLossStatement).toBe(!voteComposeUiWiresVoteDraft());
  });
});

describe("ReauthRequiredTreatment — tone register (design.md Decision D4 checklist item 4)", () => {
  it("uses no exclamation and no 'error' language", () => {
    const { container } = render(<ReauthRequiredTreatment />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/!/);
    expect(text.toLowerCase()).not.toMatch(/\berror\b/);
  });
});
