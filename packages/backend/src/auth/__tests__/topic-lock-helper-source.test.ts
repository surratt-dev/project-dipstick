import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { DEFAULT_TOPICS_TEAM_ID } from "../../sessions/default-topics.js";

// ---------------------------------------------------------------------------
// template-team-not-usable (#214) tasks.md 6.2, topic-customization-lock "The
// lock-check function stays template-agnostic": hasCompletedFirstSession's
// module never mentions the template. The template's permanent lock lives in
// getTopicLockState (auth/topic-lock-state.ts); #188's topic-write guard and
// the lock are deliberately independent.
// ---------------------------------------------------------------------------

describe("auth/topic-lock-helper.ts is template-agnostic (#214 6.2)", () => {
  it("does not reference DEFAULT_TOPICS_TEAM_ID, default-topics, the template guard or the template id", async () => {
    const text = await readFile(fileURLToPath(new URL("../topic-lock-helper.ts", import.meta.url)), "utf8");
    expect(text).toContain("export async function hasCompletedFirstSession");
    expect(text).not.toContain("DEFAULT_TOPICS_TEAM_ID");
    expect(text).not.toContain("default-topics");
    expect(text).not.toMatch(/isTemplateTeam|template-team-guard/);
    expect(text.toLowerCase()).not.toContain(DEFAULT_TOPICS_TEAM_ID);
    expect(text.toLowerCase()).not.toContain(DEFAULT_TOPICS_TEAM_ID.replace(/-/g, ""));
  });
});
