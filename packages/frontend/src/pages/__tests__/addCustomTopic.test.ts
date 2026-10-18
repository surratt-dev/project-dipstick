import { describe, it, expect } from "vitest";
import {
  EMPTY_ADD_FORM_VALUES,
  activeEmptyStateVariant,
  ACTIVE_NAME_PHRASE,
  addNameBlockedMessage,
  buildAddTopicRequest,
  parseTopicConflict,
  restoreNameActiveMessage,
  fieldErrorForServerField,
  findDuplicate,
  firstErrorField,
  isAddFormDirty,
  shouldShowCounter,
  validateAddForm,
} from "../addCustomTopic.js";
import type { AddFormValues } from "../addCustomTopic.js";
import { TOPIC_NAME_PARITY_PAIRS } from "@dipstick/shared";

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

  it("an active name match is activeName, case-insensitive after trimming, naming the stored name", () => {
    expect(findDuplicate({ name: "  pairing ", prompt: "x" }, active, [])).toEqual({
      activeName: { topicId: "a1", name: "Pairing" },
    });
  });

  it("matches a prompt with surrounding spaces and different case against an archived topic", () => {
    expect(findDuplicate({ name: "New", prompt: "  is the codebase easy to work with?  " }, active, archived)).toEqual({
      archived: { topicId: "r2", name: "Codebase Health" },
    });
  });

  it("an active name match is reported alongside an archived match (the caller lets activeName govern)", () => {
    const f = findDuplicate({ name: "Pairing", prompt: "How confident are deploys?" }, active, archived);
    expect(f.activeName).toEqual({ topicId: "a1", name: "Pairing" });
    expect(f.archived?.topicId).toBe("r1");
  });

  it("an active prompt-only match is activePromptOnly, and absent when the name also matches", () => {
    expect(findDuplicate({ name: "New", prompt: " how is pairing going? " }, active, [])).toEqual({
      activePromptOnly: { topicId: "a1", name: "Pairing" },
    });
    expect(findDuplicate({ name: "Pairing", prompt: "How is pairing going?" }, active, []).activePromptOnly).toBeUndefined();
  });

  it("with several archived matches the first in display order is returned", () => {
    expect(findDuplicate({ name: "Codebase Health", prompt: "How confident are deploys?" }, [], archived).archived?.name).toBe(
      "Deployment",
    );
  });

  it("with several active name matches the first in display order is named", () => {
    const twins = [
      { topicId: "x1", name: "Dup", prompt: "p1" },
      { topicId: "x2", name: "dup", prompt: "p2" },
    ];
    expect(findDuplicate({ name: "DUP", prompt: "z" }, twins, []).activeName?.topicId).toBe("x1");
  });

  it("internal whitespace is compared as typed", () => {
    expect(findDuplicate({ name: "Codebase  Health", prompt: "nothing" }, active, [])).toEqual({});
  });

  it("no match returns no findings", () => {
    expect(findDuplicate({ name: "Partner Integration", prompt: "How is the partner integration?" }, active, archived)).toEqual({});
  });

  // 6.4: the client hint agrees with the server doors on every shared pair.
  it.each(TOPIC_NAME_PARITY_PAIRS.map((p) => [JSON.stringify(p.existing), JSON.stringify(p.candidate), p] as const))(
    "parity %s / %s",
    (_e, _c, pair) => {
      const f = findDuplicate(
        { name: pair.candidate, prompt: "unrelated prompt" },
        [{ topicId: "t", name: pair.existing, prompt: "other" }],
        [],
      );
      expect(f.activeName !== undefined).toBe(pair.duplicate);
    },
  );
});

describe("#299 copy and conflict parsing", () => {
  it("both messages share the phrase and the locked message does not", () => {
    expect(addNameBlockedMessage("Safety").toLowerCase()).toContain(ACTIVE_NAME_PHRASE);
    expect(restoreNameActiveMessage("Safety").toLowerCase()).toContain(ACTIVE_NAME_PHRASE);
    expect("Topics can't be added to this team right now.".toLowerCase()).not.toContain(ACTIVE_NAME_PHRASE);
  });

  it("uses the exact spec text, and 'a topic with no name' for a blank stored name", () => {
    expect(addNameBlockedMessage("Safety")).toBe(
      'An active topic with this name already exists: "Safety". Choose a different name, or use the existing topic.',
    );
    expect(restoreNameActiveMessage("pairing")).toBe(
      'Not restored. An active topic with this name already exists: "pairing". Nothing was changed. Archive the active topic first if you want to restore this one.',
    );
    expect(addNameBlockedMessage("")).toContain("exists: a topic with no name. Choose");
    expect(restoreNameActiveMessage("  ")).toContain("exists: a topic with no name. Nothing was changed");
  });

  it("parseTopicConflict reads the two coded conflicts and rejects everything else", () => {
    expect(
      parseTopicConflict({ error: { code: "TOPIC_NAME_ACTIVE", conflictingTopicId: "t", conflictingName: "", message: "m", correlationId: "c" } }),
    ).toMatchObject({ code: "TOPIC_NAME_ACTIVE", conflictingName: "" });
    expect(parseTopicConflict({ error: { code: "TOPIC_CUSTOMIZATION_LOCKED" } })).toMatchObject({ code: "TOPIC_CUSTOMIZATION_LOCKED" });
    expect(parseTopicConflict({ error: { code: "TOPIC_NAME_ACTIVE", conflictingName: null, conflictingTopicId: "t" } })).toBeNull();
    expect(parseTopicConflict({ error: { code: "TOPIC_LAST_ACTIVE" } })).toBeNull();
    expect(parseTopicConflict(null)).toBeNull();
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

describe("activeEmptyStateVariant (topic-003-admin-authorization design.md D4; #200 6.2)", () => {
  // Every combination of lock, flag (true, false, absent) and archive count.
  const flags = [true, false, undefined] as const;
  const rows: Array<[boolean, number, boolean | undefined, string]> = [];
  for (const locked of [true, false]) {
    for (const archived of [0, 3]) {
      for (const flag of flags) {
        const expected = locked
          ? flag === true
            ? "locked_assign"
            : "locked"
          : archived > 0
            ? "unlocked_with_archived"
            : "unlocked_none_archived";
        rows.push([locked, archived, flag, expected]);
      }
    }
  }

  it.each(rows)("locked=%s archived=%s canAssignDefaults=%s -> %s", (locked, archived, flag, variant) => {
    expect(activeEmptyStateVariant(locked, archived, flag)).toBe(variant);
  });

  it("#218: an unlocked team with something bulk-restorable is unlocked_restorable; a locked team never is", () => {
    expect(activeEmptyStateVariant(false, 3, false, true)).toBe("unlocked_restorable");
    expect(activeEmptyStateVariant(false, 3, true, true)).toBe("unlocked_restorable");
    expect(activeEmptyStateVariant(true, 3, true, true)).toBe("locked_assign");
    expect(activeEmptyStateVariant(true, 3, false, true)).toBe("locked");
    expect(activeEmptyStateVariant(false, 3, false, false)).toBe("unlocked_with_archived");
    expect(activeEmptyStateVariant(false, 0, false, false)).toBe("unlocked_none_archived");
  });

  it("the flag is optional: the two-argument call is the non-assign variant", () => {
    expect(activeEmptyStateVariant(true, 0)).toBe("locked");
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
