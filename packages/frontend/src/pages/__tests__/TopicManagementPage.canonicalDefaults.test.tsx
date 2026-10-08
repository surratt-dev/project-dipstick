import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { activeTopic, archivedTopic, installFetch, makeTopics, mockFetchResponse, renderPage } from "./topicManagementTestUtils.js";

// ---------------------------------------------------------------------------
// TopicManagementPage — template-team-not-usable (#214) tasks.md 7.1,
// specs/topic-management-screen "The canonical default topics are shown as a
// read-only reference". TOPIC-002 answers the __default_topics__ template
// with lockReason "canonical_defaults"; the screen shows "Default topics" in
// place of the stored name everywhere (heading, tab title, back link; no
// breadcrumb component exists), the canonical-defaults notice, and no write
// or definition control. The treatment follows lockReason, never the id.
// ---------------------------------------------------------------------------

vi.mock("../../auth/AuthContext.js", () => ({
  useAuth: vi.fn().mockReturnValue({
    session: {
      user: { id: "facilitator-1", displayName: "Marcus", email: "marcus@test.com" },
      teamMemberships: [],
      sessionCreatedAt: "",
      expiresAt: "",
    },
    loading: false,
    refreshSession: vi.fn(),
  }),
}));

const STORED_TEMPLATE_NAME = "__default_topics__";
const NOTICE = "These are the canonical default topics every new team starts from. They can't be edited here.";
const FIRST_SESSION_NOTICE =
  "Topics cannot be customized until this team completes its first session. Topics are shown read-only below. Team definitions can be added after the team's first session.";

function canonicalDefaults(teamId = "template-team") {
  return makeTopics({
    teamId,
    teamName: STORED_TEMPLATE_NAME,
    isCustomizationLocked: true,
    lockReason: "canonical_defaults",
    canEditAnnotations: true,
    canAddTopics: true,
    active: [
      activeTopic("topic-1", "Pairing Effectiveness", { displayOrder: 1, teamAnnotation: "A note" }),
      activeTopic("topic-2", "Pipeline", { displayOrder: 2 }),
    ],
    archived: [archivedTopic("topic-old", "Codebase Health")],
  });
}

const text = (testId: string) => screen.getByTestId(testId).textContent?.replace(/\s+/g, " ").trim();

describe("TopicManagementPage — the canonical default topics (#214)", () => {
  const originalTitle = document.title;
  afterEach(() => {
    document.title = originalTitle;
  });

  it("a facilitator opening the template sees 'Default topics', the notice, and never the stored name (page, title, back link)", async () => {
    installFetch({ gets: [mockFetchResponse(canonicalDefaults())] });
    const { container } = await renderPage("template-team");

    expect(text("topic-management-heading")).toBe("Default topics");
    expect(text("canonical-defaults-notice")).toBe(NOTICE);
    expect(text("back-to-team-page")).toBe("← Default topics");
    expect(document.title).toBe("Default topics");
    // Open every collapsible region before searching the whole page.
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));
    expect(container.textContent).not.toContain(STORED_TEMPLATE_NAME);
    expect(container.innerHTML).not.toContain(STORED_TEMPLATE_NAME);
    expect(document.title).not.toContain(STORED_TEMPLATE_NAME);
  });

  it("the active topics are listed read-only: no Remove, Restore, move, Add custom topic, Add team definition or Edit control", async () => {
    installFetch({ gets: [mockFetchResponse(canonicalDefaults())] });
    await renderPage("template-team");
    fireEvent.click(screen.getByTestId("toggle-archived-topics"));

    expect(screen.getByTestId("topic-row-topic-1")).toBeInTheDocument();
    expect(screen.getByTestId("topic-row-topic-2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Restore$/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^move-/)).not.toBeInTheDocument();
    expect(screen.queryByText("Add custom topic")).not.toBeInTheDocument();
    expect(screen.queryByText("Add team definition")).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^edit-definition-/)).not.toBeInTheDocument();
  });

  it("the first-session copy never appears for the canonical defaults", async () => {
    installFetch({ gets: [mockFetchResponse(canonicalDefaults())] });
    const { container } = await renderPage("template-team");
    expect(screen.queryByTestId("customization-lock-notice")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("until this team completes its first session");
  });

  it("the treatment follows lockReason, not the id: any team id with canonical_defaults gets it", async () => {
    installFetch({ gets: [mockFetchResponse(canonicalDefaults("team-1"))] });
    await renderPage("team-1");
    expect(text("topic-management-heading")).toBe("Default topics");
    expect(text("canonical-defaults-notice")).toBe(NOTICE);
  });

  it("and any team id with first_session gets the existing notice, heading and name, and the tab title is left alone", async () => {
    document.title = "Dipstick";
    installFetch({
      gets: [
        mockFetchResponse(
          makeTopics({ teamId: "template-team", isCustomizationLocked: true, lockReason: "first_session" }),
        ),
      ],
    });
    await renderPage("template-team");
    expect(text("topic-management-heading")).toBe("Topic Management");
    expect(text("customization-lock-notice")).toBe(FIRST_SESSION_NOTICE);
    expect(screen.queryByTestId("canonical-defaults-notice")).not.toBeInTheDocument();
    expect(text("back-to-team-page")).toBe("← Platform Squad");
    expect(document.title).toBe("Dipstick");
  });
});
