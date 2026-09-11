import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// session_registration_snapshot — websocket-routes.ts wiring (vote-compose-
// recovery, issue #31), design.md Decision D3, tasks.md task 7.5.
//
// Boots a REAL Fastify app with @fastify/websocket registered and connects
// REAL `ws` clients over a loopback socket — mirroring
// websocket-routes.test.ts's own approach. What's mocked: the authorization
// helper (evaluateSessionSubscriberAccess — its own correctness is covered
// by its dedicated test suite), the Redis pub/sub subscriber, the SEC-25/26
// sweep/refresh/grace-recovery mechanisms (each has its own dedicated test
// suite — connection-reauthorization.test.ts, connection-token-refresh.test.ts),
// and buildSessionRegistrationSnapshot itself (its own correctness is
// covered by session-registration-snapshot.test.ts) — this file is scoped
// to verifying the WIRING: when it's called, what happens to its result,
// and how failures in it are contained.
// ---------------------------------------------------------------------------

const mockEvaluateSessionSubscriberAccess = vi.fn();
const mockBuildSessionRegistrationSnapshot = vi.fn();
const mockScheduleReauthorizationSweep = vi.fn();
const mockScheduleTokenRefreshMonitor = vi.fn();
const mockConsumeGraceRecoveryMarker = vi.fn().mockResolvedValue(false);
const mockRecordConnectionRecoveredAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("../../auth/session-subscriber-access-helper.js", () => ({
  evaluateSessionSubscriberAccess: (...args: unknown[]) => mockEvaluateSessionSubscriberAccess(...args),
}));
vi.mock("../../auth/team-content-access-helper.js", () => ({
  evaluateTeamAccess: vi.fn().mockResolvedValue(null),
}));
vi.mock("../ws-pubsub.js", () => ({
  createWsSubscriber: vi.fn(() => ({
    subscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../ws-event-dispatcher.js", () => ({
  attachWsEventDispatcher: vi.fn(),
}));
vi.mock("../../config.js", () => ({
  getAllowedOrigins: () => ["http://localhost:5173"],
  config: { REDIS_URL: "redis://unused", DATABASE_URL: "postgres://unused" },
}));
vi.mock("../../redis.js", () => ({ redis: {} }));
vi.mock("../../db.js", () => ({ db: {} }));
vi.mock("../connection-reauthorization.js", () => ({
  scheduleReauthorizationSweep: (...args: unknown[]) => mockScheduleReauthorizationSweep(...args),
}));
vi.mock("../connection-token-refresh.js", () => ({
  scheduleTokenRefreshMonitor: (...args: unknown[]) => mockScheduleTokenRefreshMonitor(...args),
  consumeGraceRecoveryMarker: (...args: unknown[]) => mockConsumeGraceRecoveryMarker(...args),
  recordConnectionRecoveredAudit: (...args: unknown[]) => mockRecordConnectionRecoveredAudit(...args),
}));
vi.mock("../session-registration-snapshot.js", () => ({
  buildSessionRegistrationSnapshot: (...args: unknown[]) => mockBuildSessionRegistrationSnapshot(...args),
}));

import Fastify from "fastify";
import { registerWebSocketRoutes } from "../websocket-routes.js";
import { connectionRegistry, safeSend } from "../connection-registry.js";

const ALLOWED_ORIGIN = "http://localhost:5173";

async function buildAndListen(sessionData: Record<string, unknown> = {}): Promise<{
  app: FastifyInstance;
  url: string;
}> {
  const app = Fastify({ logger: false });
  app.decorateRequest("session", null);
  app.addHook("onRequest", async (request) => {
    (request as unknown as { session: unknown }).session = {
      userId: "user-1",
      sessionCreatedAt: new Date().toISOString(),
      ...sessionData,
    };
  });

  await registerWebSocketRoutes(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as AddressInfo;
  return { app, url: `ws://127.0.0.1:${address.port}` };
}

function connect(url: string, path: string): WebSocket {
  return new WebSocket(`${url}${path}`, { headers: { origin: ALLOWED_ORIGIN } });
}

function waitFor(socket: WebSocket, event: "open" | "close"): Promise<[number?, Buffer?]> {
  return new Promise((resolve) => {
    socket.once(event, (...args: [number?, Buffer?]) => resolve(args));
  });
}

function collectMessages(socket: WebSocket): unknown[] {
  const messages: unknown[] = [];
  socket.on("message", (data: Buffer) => {
    messages.push(JSON.parse(data.toString()));
  });
  return messages;
}

async function tick(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("websocket-routes.ts session_registration_snapshot wiring (design.md Decision D3, task 7.5)", () => {
  let app: FastifyInstance | undefined;
  let unhandledRejections: unknown[] = [];
  let onUnhandledRejection: (reason: unknown) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConsumeGraceRecoveryMarker.mockResolvedValue(false);
    mockRecordConnectionRecoveredAudit.mockResolvedValue(undefined);
    unhandledRejections = [];
    onUnhandledRejection = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);
  });

  afterEach(async () => {
    process.off("unhandledRejection", onUnhandledRejection);
    app?.server.closeAllConnections();
    await app?.close();
    app = undefined;
  });

  it("a successfully-registered connection receives exactly one session_registration_snapshot message before any other session-scoped event, matching the seeded fixture", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValue({
      path: "participant",
      sessionId: "session-happy",
      teamId: "team-1",
      actorGlobalRole: "engineer",
    });
    const fixturePayload = {
      sessionId: "session-happy",
      sessionStatus: "active",
      currentTopic: { sessionTopicId: "topic-A", status: "voting" },
      hasLockedInVote: false,
    };
    mockBuildSessionRegistrationSnapshot.mockResolvedValue(fixturePayload);

    const built = await buildAndListen();
    app = built.app;

    const socket = connect(built.url, "/ws/sessions/session-happy");
    const messages = collectMessages(socket);
    await waitFor(socket, "open");
    await tick();

    // Simulate a subsequent, unrelated session-scoped event arriving after
    // registration, to confirm the snapshot precedes it.
    const [conn] = connectionRegistry.candidates("session", "session-happy");
    expect(conn).toBeDefined();
    safeSend(
      connectionRegistry,
      "session",
      "session-happy",
      conn!,
      JSON.stringify({ eventType: "session_state_change", payload: { fake: true } }),
    );
    await tick();

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ eventType: "session_registration_snapshot", payload: fixturePayload });
    expect(messages[1]).toEqual({ eventType: "session_state_change", payload: { fake: true } });

    expect(mockBuildSessionRegistrationSnapshot).toHaveBeenCalledWith("user-1", "session-happy");

    socket.close();
  });

  it("a connection rejected by evaluateSessionSubscriberAccess receives no session_registration_snapshot and the snapshot is never built (design.md D3d: piggybacks on an already-made grant, never leaks past it)", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValue(null);

    const built = await buildAndListen();
    app = built.app;

    const socket = connect(built.url, "/ws/sessions/session-rejected");
    const messages = collectMessages(socket);
    await waitFor(socket, "close");
    await tick();

    expect(messages).toHaveLength(0);
    expect(mockBuildSessionRegistrationSnapshot).not.toHaveBeenCalled();
  });

  it("failure containment: buildSessionRegistrationSnapshot throwing does not prevent the sweep/refresh monitors from running, sends no snapshot, keeps the connection open, and never surfaces as an unhandled rejection", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValue({
      path: "participant",
      sessionId: "session-throws",
      teamId: "team-1",
      actorGlobalRole: "engineer",
    });
    mockBuildSessionRegistrationSnapshot.mockRejectedValue(new Error("db exploded"));

    const built = await buildAndListen();
    app = built.app;

    const socket = connect(built.url, "/ws/sessions/session-throws");
    const messages = collectMessages(socket);
    await waitFor(socket, "open");
    await tick();

    expect(mockScheduleReauthorizationSweep).toHaveBeenCalledTimes(1);
    expect(mockScheduleTokenRefreshMonitor).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(0);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(connectionRegistry.candidates("session", "session-throws")).toHaveLength(1);
    expect(unhandledRejections).toHaveLength(0);

    socket.close();
  });

  it("failure containment: buildSessionRegistrationSnapshot returning null (zero-row race) is treated identically — no snapshot sent, connection stays open", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValue({
      path: "participant",
      sessionId: "session-null-race",
      teamId: "team-1",
      actorGlobalRole: "engineer",
    });
    mockBuildSessionRegistrationSnapshot.mockResolvedValue(null);

    const built = await buildAndListen();
    app = built.app;

    const socket = connect(built.url, "/ws/sessions/session-null-race");
    const messages = collectMessages(socket);
    await waitFor(socket, "open");
    await tick();

    expect(messages).toHaveLength(0);
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(unhandledRejections).toHaveLength(0);

    socket.close();
  });

  it("D3b: every registration gets its own freshly-computed snapshot, not just the tab's first — a second registration after a state change reflects the new state", async () => {
    mockEvaluateSessionSubscriberAccess.mockResolvedValue({
      path: "participant",
      sessionId: "session-second-reg",
      teamId: "team-1",
      actorGlobalRole: "engineer",
    });
    mockBuildSessionRegistrationSnapshot
      .mockResolvedValueOnce({
        sessionId: "session-second-reg",
        sessionStatus: "active",
        currentTopic: { sessionTopicId: "topic-A", status: "voting" },
        hasLockedInVote: false,
      })
      .mockResolvedValueOnce({
        sessionId: "session-second-reg",
        sessionStatus: "active",
        currentTopic: { sessionTopicId: "topic-A", status: "voting" },
        hasLockedInVote: true,
      });

    const built = await buildAndListen();
    app = built.app;

    const firstSocket = connect(built.url, "/ws/sessions/session-second-reg");
    const firstMessages = collectMessages(firstSocket);
    await waitFor(firstSocket, "open");
    await tick();
    expect(firstMessages).toEqual([
      {
        eventType: "session_registration_snapshot",
        payload: expect.objectContaining({ hasLockedInVote: false }),
      },
    ]);
    firstSocket.close();
    await tick();

    const secondSocket = connect(built.url, "/ws/sessions/session-second-reg");
    const secondMessages = collectMessages(secondSocket);
    await waitFor(secondSocket, "open");
    await tick();

    expect(secondMessages).toEqual([
      {
        eventType: "session_registration_snapshot",
        payload: expect.objectContaining({ hasLockedInVote: true }),
      },
    ]);
    expect(mockBuildSessionRegistrationSnapshot).toHaveBeenCalledTimes(2);

    secondSocket.close();
  });
});
