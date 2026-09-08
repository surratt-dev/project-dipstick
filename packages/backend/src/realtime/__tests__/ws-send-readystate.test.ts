import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Empirical verification of ws's .send() behavior across CLOSING/CLOSED
// readyState (tasks.md task 3.5 / design.md Decision D2).
//
// design.md names this as a verification requirement, not an assumption:
// "ws's actual .send() behavior across CLOSING/CLOSED readyState is version-
// and call-site-dependent — ws does not uniformly throw synchronously for
// every non-OPEN state." This test exercises a REAL ws server and a REAL
// socket pair (no mocking of ws itself) against the exact version pinned by
// @fastify/websocket (^8.16.0, resolved here to 8.21.x — see package-lock),
// for both call-site shapes used in this codebase: .send(data) and
// .send(data, callback).
//
// Findings (recorded in full in connection-registry.ts's top-of-file
// comment above safeSend()): at this pinned version, ws does NOT throw
// synchronously for a CLOSED socket in the no-callback call shape — the
// send silently no-ops. It also does not throw synchronously in the
// callback call shape; instead it invokes the callback with an Error. This
// is exactly the non-uniform behavior design.md's Decision D2 named as a
// possibility rather than an assumption: a try/catch around a bare
// `.send(data)` call would NEVER observe a failure here and would never
// deregister a closed socket. This is why connection-registry.ts's
// safeSend() checks `readyState` BEFORE attempting the send, as the primary
// deregistration trigger, with try/catch kept only as defensive
// insurance against other error modes .send() might throw for synchronously
// (e.g. a malformed payload) — not as the mechanism this test's findings
// depend on.
// ---------------------------------------------------------------------------

describe("ws .send() behavior on a closed socket (empirical verification)", () => {
  let wss: WebSocketServer | undefined;

  afterEach(() => {
    wss?.close();
    wss = undefined;
  });

  async function startServerAndGetClosedServerSideSocket(): Promise<WebSocket> {
    wss = new WebSocketServer({ port: 0 });
    const port = (wss.address() as AddressInfo).port;

    const serverSideSocket = await new Promise<WebSocket>((resolve) => {
      wss!.on("connection", (socket) => resolve(socket));
      new WebSocket(`ws://127.0.0.1:${port}`);
    });

    // Close the server-side socket and wait for it to fully reach CLOSED.
    await new Promise<void>((resolve) => {
      serverSideSocket.on("close", () => resolve());
      serverSideSocket.close();
    });

    expect(serverSideSocket.readyState).toBe(WebSocket.CLOSED);
    return serverSideSocket;
  }

  it("does NOT throw on .send(data) for a CLOSED socket (no callback) — a bare try/catch would miss this", async () => {
    const socket = await startServerAndGetClosedServerSideSocket();

    // This is the finding that matters: no exception is raised. A
    // deregistration strategy relying solely on "try/catch around .send()"
    // would never fire for this call shape, leaving a dead socket in the
    // registry indefinitely. safeSend() does not rely on this — it checks
    // readyState first.
    expect(() => socket.send("hello")).not.toThrow();
  });

  it(".send(data, callback) for a CLOSED socket does not throw synchronously either — the failure surfaces asynchronously via the callback's Error argument", async () => {
    const socket = await startServerAndGetClosedServerSideSocket();

    let caughtSynchronously = false;

    const callbackErrorPromise = new Promise<Error | undefined>((resolve) => {
      try {
        socket.send("hello", (err) => resolve(err));
      } catch {
        caughtSynchronously = true;
        resolve(undefined);
      }
    });

    expect(caughtSynchronously).toBe(false);
    // The callback fires on a later tick, not synchronously — another way
    // this call shape diverges from "throws immediately," and another
    // reason safeSend() does not lean on .send()'s error-reporting timing
    // at all.
    const callbackError = await callbackErrorPromise;
    expect(callbackError).toBeInstanceOf(Error);
  });

  it("readyState is CLOSED (not OPEN) immediately after the close handshake completes", async () => {
    const socket = await startServerAndGetClosedServerSideSocket();
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(socket.readyState).not.toBe(WebSocket.OPEN);
  });
});
