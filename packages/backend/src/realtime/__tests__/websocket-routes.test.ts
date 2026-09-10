import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// registerWebSocketRoutes — three-check-point model integration tests
// (design.md Decisions D1/D8/D9, tasks.md tasks 1.2, 1.2a, 3.2, 3.3, 3.6).
//
// Boots a REAL Fastify app with @fastify/websocket registered and connects
// REAL `ws` clients over a loopback socket, so these tests exercise the
// actual upgrade handshake and connection lifecycle — not a mocked stand-in
// for it. What's mocked: the authorization helpers (evaluateSessionSubscriberAccess,
// evaluateTeamAccess — their own correctness is covered by their dedicated
// test suites) and the Redis pub/sub subscriber (createWsSubscriber /
// attachWsEventDispatcher — task 1.4/4.1's own test suites cover those; this
// file is not the place to also require a real Redis instance).
// ---------------------------------------------------------------------------

const mockEvaluateSessionSubscriberAccess = vi.fn();
const mockEvaluateTeamAccess = vi.fn();

vi.mock("../../auth/session-subscriber-access-helper.js", () => ({
  evaluateSessionSubscriberAccess: (...args: unknown[]) => mockEvaluateSessionSubscriberAccess(...args),
}));
vi.mock("../../auth/team-content-access-helper.js", () => ({
  evaluateTeamAccess: (...args: unknown[]) => mockEvaluateTeamAccess(...args),
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
// Prevent connection-token-refresh.js's/connection-reauthorization.js's real
// import chains (../redis.js, ../db.js) from constructing real ioredis/pg
// clients during this test file's module load, mirroring how ws-pubsub.js
// is already mocked for the same reason.
vi.mock("../../redis.js", () => ({ redis: {} }));
vi.mock("../../db.js", () => ({ db: {} }));
// websocket-connection-reauthorization (SEC-25/26): this file's stated scope
// is the three-check-point connection-lifecycle model, not the sweep/refresh
// mechanisms themselves — those have their own dedicated test suites
// (connection-reauthorization.test.ts, connection-token-refresh.test.ts).
// Mocked here the same way ws-pubsub.js/ws-event-dispatcher.js already are,
// so this file doesn't require a real Redis/Postgres connection.
vi.mock("../connection-reauthorization.js", () => ({
  scheduleReauthorizationSweep: vi.fn(),
}));
vi.mock("../connection-token-refresh.js", () => ({
  scheduleTokenRefreshMonitor: vi.fn(),
  consumeGraceRecoveryMarker: vi.fn().mockResolvedValue(false),
  recordConnectionRecoveredAudit: vi.fn().mockResolvedValue(undefined),
}));

import Fastify from "fastify";
import { registerWebSocketRoutes, scheduleForceClose } from "../websocket-routes.js";
import { connectionRegistry, type RegisteredConnection } from "../connection-registry.js";
import { STALE_SIGNAL_CLOSE_CODE } from "../staleness-signal.js";
import { ABSOLUTE_LIFETIME_MS } from "../../auth/middleware.js";

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

describe("registerWebSocketRoutes", () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // A rejected-upgrade test leaves an HTTP keep-alive socket the client
    // may not have fully torn down yet; without this, app.close() can hang
    // waiting for Node's http.Server to observe every connection end.
    app?.server.closeAllConnections();
    await app?.close();
    app = undefined;
  });

  describe("/ws/sessions/:sessionId — subscription-time early rejection (task 1.2 additive safeguard)", () => {
    it("closes the connection with the generic staleness code when unauthorized (grant is null)", async () => {
      mockEvaluateSessionSubscriberAccess.mockResolvedValue(null);
      const built = await buildAndListen();
      app = built.app;

      const socket = connect(built.url, "/ws/sessions/session-unauthorized");
      const [code] = await waitFor(socket, "close");

      expect(code).toBe(STALE_SIGNAL_CLOSE_CODE);
      expect(connectionRegistry.candidates("session", "session-unauthorized")).toHaveLength(0);
    });

    it("registers the connection, capturing sessionCreatedAt, when authorized", async () => {
      mockEvaluateSessionSubscriberAccess.mockResolvedValue({
        path: "participant",
        sessionId: "session-authorized",
        teamId: "team-1",
        actorGlobalRole: "engineer",
      });
      // Must be a FRESH timestamp — scheduleForceClose (task 3.6) computes
      // the remaining time until ABSOLUTE_LIFETIME_MS from this value, and
      // force-closes (deregistering) immediately if it's already expired.
      const createdAtIso = new Date().toISOString();
      const built = await buildAndListen({ sessionCreatedAt: createdAtIso });
      app = built.app;

      const socket = connect(built.url, "/ws/sessions/session-authorized");
      await waitFor(socket, "open");
      // Give the async authorization check a tick to complete and register.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const candidates = connectionRegistry.candidates("session", "session-authorized");
      expect(candidates).toHaveLength(1);
      expect(candidates[0]!.userId).toBe("user-1");
      expect(candidates[0]!.sessionCreatedAt).toBe(new Date(createdAtIso).getTime());

      socket.close();
    });

    it("deregisters the connection when the client closes it", async () => {
      mockEvaluateSessionSubscriberAccess.mockResolvedValue({
        path: "participant",
        sessionId: "session-close-cleanup",
        teamId: "team-1",
        actorGlobalRole: "engineer",
      });
      const built = await buildAndListen();
      app = built.app;

      const socket = connect(built.url, "/ws/sessions/session-close-cleanup");
      await waitFor(socket, "open");
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(connectionRegistry.candidates("session", "session-close-cleanup")).toHaveLength(1);

      socket.close();
      await waitFor(socket, "close");
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(connectionRegistry.candidates("session", "session-close-cleanup")).toHaveLength(0);
    });
  });

  describe("/ws/teams/:teamId/events — admin-grant rejection mirrors the delivery-time rule", () => {
    it("closes the connection with the generic staleness code when the grant path is admin", async () => {
      mockEvaluateTeamAccess.mockResolvedValue({ path: "admin", actorGlobalRole: "application_admin" });
      const built = await buildAndListen();
      app = built.app;

      const socket = connect(built.url, "/ws/teams/team-admin-rejected/events");
      const [code] = await waitFor(socket, "close");

      expect(code).toBe(STALE_SIGNAL_CLOSE_CODE);
      expect(connectionRegistry.candidates("team", "team-admin-rejected")).toHaveLength(0);
    });

    it("registers the connection when the grant path is member", async () => {
      mockEvaluateTeamAccess.mockResolvedValue({
        path: "member",
        role: "participant",
        teamId: "team-member-ok",
        actorGlobalRole: "engineer",
      });
      const built = await buildAndListen();
      app = built.app;

      const socket = connect(built.url, "/ws/teams/team-member-ok/events");
      await waitFor(socket, "open");
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(connectionRegistry.candidates("team", "team-member-ok")).toHaveLength(1);
      socket.close();
    });
  });

  describe("Origin check (Decision D9) is wired into the actual upgrade path", () => {
    it("rejects an upgrade from a disallowed origin before authorization is ever evaluated", async () => {
      const built = await buildAndListen();
      app = built.app;

      // Uses Node's raw http module (rather than the `ws` client) so the
      // test has direct control over the request socket's lifecycle — a
      // REJECTED upgrade never gets detached from Node's normal HTTP
      // keep-alive connection tracking, and letting the `ws` client manage
      // that socket left it lingering long enough to hang app.close().
      const { get } = await import("node:http");
      const statusCode = await new Promise<number | undefined>((resolve) => {
        const req = get(
          `${built.url.replace("ws://", "http://")}/ws/sessions/session-bad-origin`,
          {
            headers: {
              origin: "https://evil.example.com",
              connection: "close",
              upgrade: "websocket",
            },
          },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode));
          },
        );
        req.on("error", () => resolve(undefined));
      });

      expect(statusCode).toBe(403);
      expect(mockEvaluateSessionSubscriberAccess).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// scheduleForceClose — task 3.6 / design.md Decision D8's compensating
// control, and task 5.10's second half: "a test confirming the scheduled
// force-close actually closes the socket at the 90-minute mark even with
// zero events pushed during that window."
// ---------------------------------------------------------------------------
describe("scheduleForceClose", () => {
  function fakeConn(): RegisteredConnection & { socket: { close: ReturnType<typeof vi.fn>; readyState: number; OPEN: number } } {
    const socket = { readyState: 1, OPEN: 1, close: vi.fn() };
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for a `ws` socket
      socket: socket as any,
      userId: "user-1",
      sessionCreatedAt: Date.now(),
      fastifySessionId: "fastify-sess-1",
    } as RegisteredConnection & { socket: typeof socket };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not close the socket before the absolute lifetime elapses", () => {
    const conn = fakeConn();
    const onExpire = vi.fn();

    scheduleForceClose(conn, conn.sessionCreatedAt, onExpire);
    vi.advanceTimersByTime(ABSOLUTE_LIFETIME_MS - 1000);

    expect(onExpire).not.toHaveBeenCalled();
    expect(conn.socket.close).not.toHaveBeenCalled();
  });

  it("closes an OPEN socket with the generic staleness close code exactly at the absolute lifetime mark", () => {
    const conn = fakeConn();
    const onExpire = vi.fn();

    scheduleForceClose(conn, conn.sessionCreatedAt, onExpire);
    vi.advanceTimersByTime(ABSOLUTE_LIFETIME_MS);

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(conn.socket.close).toHaveBeenCalledWith(STALE_SIGNAL_CLOSE_CODE);
  });

  it("still calls onExpire (deregistration) even if the socket is already closed, but does not call close() again", () => {
    const conn = fakeConn();
    conn.socket.readyState = 3; // CLOSED
    const onExpire = vi.fn();

    scheduleForceClose(conn, conn.sessionCreatedAt, onExpire);
    vi.advanceTimersByTime(ABSOLUTE_LIFETIME_MS);

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(conn.socket.close).not.toHaveBeenCalled();
  });

  it("schedules relative to the connection's age, not a fresh 90 minutes from 'now', for a connection registered partway through its lifetime", () => {
    const conn = fakeConn();
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const onExpire = vi.fn();

    scheduleForceClose(conn, tenMinutesAgo, onExpire);

    // Only 80 minutes remain until the 90-minute mark from tenMinutesAgo.
    vi.advanceTimersByTime(ABSOLUTE_LIFETIME_MS - 10 * 60 * 1000 - 1000);
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
