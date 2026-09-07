import { describe, it, expectTypeOf } from "vitest";
import type {
  User,
  UserRole,
  MembershipRole,
  Team,
  TeamMembership,
  Session,
  SessionStatus,
  SessionTopic,
  SessionTopicStatus,
  SessionParticipant,
  Vote,
  VoteType,
  Topic,
  TopicStatus,
  ActionItem,
  ActionItemStatus,
  ActionItemHistory,
  AuthSession,
  JoinLink,
  AuthErrorCategory,
  AuthError,
} from "../index.js";

describe("User types", () => {
  it("UserRole accepts valid values", () => {
    expectTypeOf<"engineer">().toMatchTypeOf<UserRole>();
    expectTypeOf<"senior_engineer">().toMatchTypeOf<UserRole>();
    expectTypeOf<"facilitator">().toMatchTypeOf<UserRole>();
    expectTypeOf<"engineering_manager">().toMatchTypeOf<UserRole>();
    expectTypeOf<"application_admin">().toMatchTypeOf<UserRole>();
    expectTypeOf<"invalid">().not.toMatchTypeOf<UserRole>();
  });

  it("MembershipRole accepts valid values", () => {
    expectTypeOf<"participant">().toMatchTypeOf<MembershipRole>();
    expectTypeOf<"engineering_manager">().toMatchTypeOf<MembershipRole>();
    expectTypeOf<"invalid">().not.toMatchTypeOf<MembershipRole>();
  });

  it("User interface has correct shape", () => {
    expectTypeOf<User>().toHaveProperty("id").toBeString();
    expectTypeOf<User>().toHaveProperty("oidcSubject").toBeString();
    expectTypeOf<User>().toHaveProperty("oidcIssuer").toBeString();
    expectTypeOf<User>().toHaveProperty("displayName").toBeString();
    expectTypeOf<User>().toHaveProperty("email").toBeString();
    expectTypeOf<User>().toHaveProperty("globalRole").toMatchTypeOf<UserRole>();
    expectTypeOf<User>().toHaveProperty("createdAt").toEqualTypeOf<Date>();
    expectTypeOf<User>().toHaveProperty("updatedAt").toEqualTypeOf<Date>();
    expectTypeOf<User>().toHaveProperty("deactivatedAt").toEqualTypeOf<Date | null>();

    const user: User = {
      id: "u1",
      oidcSubject: "sub",
      oidcIssuer: "iss",
      displayName: "Test",
      email: "test@example.com",
      globalRole: "engineer",
      createdAt: new Date(),
      updatedAt: new Date(),
      deactivatedAt: null,
    };
    expectTypeOf(user).toMatchTypeOf<User>();
  });
});

describe("Team types", () => {
  it("Team interface has correct shape", () => {
    expectTypeOf<Team>().toHaveProperty("id").toBeString();
    expectTypeOf<Team>().toHaveProperty("name").toBeString();
    expectTypeOf<Team>().toHaveProperty("createdAt").toEqualTypeOf<Date>();
    expectTypeOf<Team>().toHaveProperty("updatedAt").toEqualTypeOf<Date>();
    expectTypeOf<Team>().toHaveProperty("createdByUserId").toBeString();
    expectTypeOf<Team>().toHaveProperty("deactivatedAt").toEqualTypeOf<Date | null>();

    const team: Team = {
      id: "t1",
      name: "Team A",
      createdAt: new Date(),
      updatedAt: new Date(),
      createdByUserId: "u1",
      deactivatedAt: null,
    };
    expectTypeOf(team).toMatchTypeOf<Team>();
  });

  it("TeamMembership interface has correct shape", () => {
    const membership: TeamMembership = {
      id: "tm1",
      teamId: "t1",
      userId: "u1",
      role: "participant",
      joinedAt: new Date(),
      removedAt: null,
      removedByUserId: null,
    };
    expectTypeOf(membership).toMatchTypeOf<TeamMembership>();
    expectTypeOf<TeamMembership>().toHaveProperty("role").toMatchTypeOf<MembershipRole>();
  });
});

describe("Session types", () => {
  it("SessionStatus accepts valid values", () => {
    expectTypeOf<"lobby">().toMatchTypeOf<SessionStatus>();
    expectTypeOf<"pre_session">().toMatchTypeOf<SessionStatus>();
    expectTypeOf<"active">().toMatchTypeOf<SessionStatus>();
    expectTypeOf<"wrap_up">().toMatchTypeOf<SessionStatus>();
    expectTypeOf<"complete">().toMatchTypeOf<SessionStatus>();
    expectTypeOf<"abandoned">().toMatchTypeOf<SessionStatus>();
    expectTypeOf<"invalid">().not.toMatchTypeOf<SessionStatus>();
  });

  it("SessionTopicStatus accepts valid values", () => {
    expectTypeOf<"waiting">().toMatchTypeOf<SessionTopicStatus>();
    expectTypeOf<"voting">().toMatchTypeOf<SessionTopicStatus>();
    expectTypeOf<"revealed">().toMatchTypeOf<SessionTopicStatus>();
    expectTypeOf<"complete">().toMatchTypeOf<SessionTopicStatus>();
  });

  it("Session interface has correct shape", () => {
    const session: Session = {
      id: "s1",
      teamId: "t1",
      facilitatorId: "u1",
      status: "lobby",
      joinToken: "tok",
      isFirstSession: true,
      sessionNumber: 1,
      currentTopicId: null,
      createdAt: new Date(),
      startedAt: null,
      votingStartedAt: null,
      wrapUpStartedAt: null,
      completedAt: null,
      abandonedAt: null,
      facilitatorAccessExpiresAt: null,
    };
    expectTypeOf(session).toMatchTypeOf<Session>();
    expectTypeOf<Session>().toHaveProperty("isFirstSession").toBeBoolean();
    expectTypeOf<Session>().toHaveProperty("sessionNumber").toBeNumber();
    expectTypeOf<Session>().toHaveProperty("facilitatorAccessExpiresAt");
  });

  it("SessionTopic interface has correct shape", () => {
    const st: SessionTopic = {
      id: "st1",
      sessionId: "s1",
      topicId: "top1",
      displayOrder: 0,
      topicName: "Topic",
      topicPrompt: "Prompt",
      voteType: "finger",
      status: "waiting",
      revealedAt: null,
      completedAt: null,
      flaggedForDiscussion: false,
      discussionNote: null,
    };
    expectTypeOf(st).toMatchTypeOf<SessionTopic>();
    expectTypeOf<SessionTopic>().toHaveProperty("flaggedForDiscussion").toBeBoolean();
  });

  it("SessionParticipant interface has correct shape", () => {
    const sp: SessionParticipant = {
      id: "sp1",
      sessionId: "s1",
      userId: "u1",
      joinedAt: new Date(),
    };
    expectTypeOf(sp).toMatchTypeOf<SessionParticipant>();
  });
});

describe("Vote types", () => {
  it("VoteType accepts valid values", () => {
    expectTypeOf<"finger">().toMatchTypeOf<VoteType>();
    expectTypeOf<"roman">().toMatchTypeOf<VoteType>();
    expectTypeOf<"modified_roman">().toMatchTypeOf<VoteType>();
    expectTypeOf<"invalid">().not.toMatchTypeOf<VoteType>();
  });

  it("Vote interface has correct shape", () => {
    const vote: Vote = {
      id: "v1",
      sessionId: "s1",
      sessionTopicId: "st1",
      voterId: "u1",
      voteValue: 3,
      voteType: "finger",
      isOutlier: false,
      outlierThreshold: null,
      revealedAt: new Date(),
      createdAt: new Date(),
    };
    expectTypeOf(vote).toMatchTypeOf<Vote>();
    expectTypeOf<Vote>().toHaveProperty("voteValue").toBeNumber();
    expectTypeOf<Vote>().toHaveProperty("isOutlier").toBeBoolean();
  });
});

describe("Topic types", () => {
  it("TopicStatus accepts valid values", () => {
    expectTypeOf<"active">().toMatchTypeOf<TopicStatus>();
    expectTypeOf<"archived">().toMatchTypeOf<TopicStatus>();
  });

  it("Topic interface has correct shape", () => {
    const topic: Topic = {
      id: "top1",
      teamId: "t1",
      name: "Topic",
      prompt: "Prompt",
      voteType: "finger",
      displayOrder: 0,
      status: "active",
      isDefault: true,
      firstSessionDescription: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    };
    expectTypeOf(topic).toMatchTypeOf<Topic>();
    expectTypeOf<Topic>().toHaveProperty("isDefault").toBeBoolean();
  });
});

describe("ActionItem types", () => {
  it("ActionItemStatus accepts valid values", () => {
    expectTypeOf<"open">().toMatchTypeOf<ActionItemStatus>();
    expectTypeOf<"in_progress">().toMatchTypeOf<ActionItemStatus>();
    expectTypeOf<"resolved">().toMatchTypeOf<ActionItemStatus>();
  });

  it("ActionItem interface has correct shape", () => {
    const item: ActionItem = {
      id: "ai1",
      teamId: "t1",
      sessionId: "s1",
      sessionTopicId: null,
      ownerId: "u1",
      description: "Do something",
      status: "open",
      resolutionNote: null,
      resolvedInSessionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expectTypeOf(item).toMatchTypeOf<ActionItem>();
  });

  it("ActionItemHistory interface has correct shape", () => {
    const history: ActionItemHistory = {
      id: "aih1",
      actionItemId: "ai1",
      changedByUserId: "u1",
      previousStatus: "open",
      newStatus: "in_progress",
      resolutionNote: null,
      sessionId: null,
      changedAt: new Date(),
    };
    expectTypeOf(history).toMatchTypeOf<ActionItemHistory>();
  });
});

describe("Auth types", () => {
  it("AuthErrorCategory accepts valid values", () => {
    expectTypeOf<"provider_unavailable">().toMatchTypeOf<AuthErrorCategory>();
    expectTypeOf<"authentication_failed">().toMatchTypeOf<AuthErrorCategory>();
    expectTypeOf<"session_expired">().toMatchTypeOf<AuthErrorCategory>();
    expectTypeOf<"invalid_request">().toMatchTypeOf<AuthErrorCategory>();
  });

  it("AuthSession interface has correct shape", () => {
    const authSession: AuthSession = {
      user: { id: "u1", displayName: "Test", email: "test@example.com" },
      teamMemberships: [{ teamId: "t1", teamName: "Team", role: "participant" }],
      sessionCreatedAt: "2024-01-01",
      expiresAt: "2024-01-02",
    };
    expectTypeOf(authSession).toMatchTypeOf<AuthSession>();
    expectTypeOf<AuthSession>().toHaveProperty("user").toHaveProperty("id").toBeString();
  });

  it("JoinLink interface has correct shape", () => {
    const link: JoinLink = {
      id: "jl1",
      teamId: "t1",
      token: "tok",
      expiresAt: "2024-01-02",
      createdAt: "2024-01-01",
    };
    expectTypeOf(link).toMatchTypeOf<JoinLink>();
  });

  it("AuthError interface has correct shape", () => {
    const err: AuthError = {
      error: {
        category: "session_expired",
        message: "Session expired",
        correlationId: "corr1",
      },
    };
    expectTypeOf(err).toMatchTypeOf<AuthError>();
  });
});
