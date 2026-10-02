import { describe, it, expect } from "vitest";
import {
  EMPTY_ADD_FORM_VALUES,
  activeEmptyStateVariant,
  buildAddTopicRequest,
  fieldErrorForServerField,
  findDuplicate,
  firstErrorField,
  isAddFormDirty,
  shouldShowCounter,
  validateAddForm,
} from "../addCustomTopic.js";
import type { AddFormValues } from "../addCustomTopic.js";

// topic-add-form-and-empty-state task 4.1 (design.md Decision 10): table
// tests for the add form's pure logic.

const values = (overrides: Partial<AddFormValues> = {}): AddFormValues => ({ ...EMPTY_ADD_FORM_VALUES, ...overrides });

describe("isAddFormDirty", () => {
  it.each([
    [{}, false],
    [{ name: "   " }, false],
    [{ prompt: "\n\t" }, false],
    [{ description: "  " }, false],
    [{ name: "x" }, true],
    [{ prompt: "x" }, true],
    [{ description: "x" }, true],
    [{ voteType: "roman" as const }, true],
  ])("%j -> %s", (overrides, expected) => {
    expect(isAddFormDirty(values(overrides))).toBe(expected);
  });
});

describe("validateAddForm / firstErrorField", () => {
  it("reports every missing required field with its message, in form order", () => {
    const errors = validateAddForm(values({ name: "  ", prompt: "", description: "" }));
    expect(errors).toEqual({
      name: "Enter a topic name.",
      prompt: "Enter a prompt.",
      voteType: "Choose a vote type.",
    });
    expect(firstErrorField(errors)).toBe("name");
  });

  it("the first failing field is the vote type when only it is missing", () => {
    const errors = validateAddForm(values({ name: "A", prompt: "B" }));
    expect(errors).toEqual({ voteType: "Choose a vote type." });
    expect(firstErrorField(errors)).toBe("voteType");
  });

  it("a complete form has no errors; the description is optional", () => {
    expect(validateAddForm(values({ name: "A", prompt: "B", voteType: "finger" }))).toEqual({});
    expect(firstErrorField({})).toBeNull();
  });
});

describe("findDuplicate", () => {
  const active = [
    { topicId: "a1", name: "Pairing", prompt: "How is pairing going?" },
    { topicId: "a2", name: "Codebase Health", prompt: "Active codebase prompt" },
  ];
  const archived = [
    { topicId: "r1", name: "Deployment", prompt: "How confident are deploys?" },
    { topicId: "r2", name: "Codebase Health", prompt: "Is the codebase easy to work with?" },
  ];

  it("matches a name case-insensitively after trimming", () => {
    expect(findDuplicate({ name: "  pairing ", prompt: "x" }, active, [])).toEqual({ kind: "active", topicId: "a1", name: "Pairing" });
  });

  it("matches a prompt with surrounding spaces and different case against an archived topic", () => {
    expect(findDuplicate({ name: "New", prompt: "  is the codebase easy to work with?  " }, active, archived)).toEqual({
      kind: "archived",
      topicId: "r2",
      name: "Codebase Health",
    });
  });

  it("an archived match wins over an active match", () => {
    expect(findDuplicate({ name: "Pairing", prompt: "How confident are deploys?" }, active, archived)?.kind).toBe("archived");
  });

  it("with several archived matches the first in display order is returned", () => {
    expect(findDuplicate({ name: "Codebase Health", prompt: "How confident are deploys?" }, [], archived)?.name).toBe(
      "Deployment",
    );
  });

  it("internal whitespace is compared as typed", () => {
    expect(findDuplicate({ name: "Codebase  Health", prompt: "nothing" }, active, [])).toBeNull();
  });

  it("no match returns null", () => {
    expect(findDuplicate({ name: "Partner Integration", prompt: "How is the partner integration?" }, active, archived)).toBeNull();
  });
});

describe("buildAddTopicRequest", () => {
  it("trims name, prompt, and description", () => {
    expect(
      buildAddTopicRequest(values({ name: "  A  ", prompt: " B ", voteType: "roman", description: "  note  " })),
    ).toEqual({ name: "A", prompt: "B", voteType: "roman", firstSessionDescription: "note" });
  });

  it.each(["", "   ", "\n "])("sends a description of %j as null", (description) => {
    expect(buildAddTopicRequest(values({ name: "A", prompt: "B", voteType: "finger", description })).firstSessionDescription).toBeNull();
  });

  it("refuses to build without a vote type", () => {
    expect(() => buildAddTopicRequest(values({ name: "A", prompt: "B" }))).toThrow();
  });
});

describe("fieldErrorForServerField", () => {
  it.each([
    ["name", "Enter a topic name of up to 100 characters."],
    ["prompt", "Enter a prompt of up to 500 characters."],
    ["voteType", "Choose a vote type."],
    ["firstSessionDescription", "Keep the description to 500 characters or fewer."],
  ])("maps %s to the screen's own message", (field, message) => {
    expect(fieldErrorForServerField(field)).toEqual({ field, message });
  });

  it.each([undefined, null, "teamId", 42])("an absent or unknown field (%j) is a fixed form-level message", (field) => {
    expect(fieldErrorForServerField(field)).toEqual({
      field: null,
      message: "The topic couldn't be added. Check each field and try again.",
    });
  });
});

describe("activeEmptyStateVariant (topic-003-admin-authorization design.md D4)", () => {
  it.each([
    [true, 0, "locked"],
    [true, 3, "locked"],
    [false, 3, "unlocked_with_archived"],
    [false, 1, "unlocked_with_archived"],
    [false, 0, "unlocked_none_archived"],
  ] as const)("locked=%s archived=%s -> %s", (locked, archived, variant) => {
    expect(activeEmptyStateVariant(locked, archived)).toBe(variant);
  });
});

describe("shouldShowCounter", () => {
  it("shows from 80% of the limit", () => {
    expect(shouldShowCounter(79, 100)).toBe(false);
    expect(shouldShowCounter(80, 100)).toBe(true);
    expect(shouldShowCounter(399, 500)).toBe(false);
    expect(shouldShowCounter(400, 500)).toBe(true);
  });
});
