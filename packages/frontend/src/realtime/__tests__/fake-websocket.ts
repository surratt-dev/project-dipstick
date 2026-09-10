// ---------------------------------------------------------------------------
// FakeWebSocket — hand-rolled WebSocket test double
//
// websocket-staleness-signal: design.md Decision D1f, tasks.md task 1.1a.
//
// jsdom@29.1.1 does expose a global WebSocket constructor, but it is a real
// network client — it attempts an actual connection rather than behaving as
// a controllable double, which is unsuitable for deterministic, offline unit
// tests of retry timing and event sequencing (confirmed by a design-stage
// spike, design.md Decision D1f). This double implements exactly the
// surface connectionHealth.ts touches, plus test-only methods to synthesize
// events on demand.
//
// Extends the platform's EventTarget (available in jsdom) so
// addEventListener/removeEventListener/dispatchEvent behave exactly like a
// real WebSocket's — including delivering one event to every listener
// attached via addEventListener, which is what task 1.1c's test relies on.
// ---------------------------------------------------------------------------

export class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = FakeWebSocket.CONNECTING;
  readonly OPEN = FakeWebSocket.OPEN;
  readonly CLOSING = FakeWebSocket.CLOSING;
  readonly CLOSED = FakeWebSocket.CLOSED;

  readyState: number = FakeWebSocket.CONNECTING;

  /** Recorded for assertions like "connect() not called again" / "no further close call". */
  readonly closeCalls: Array<{ code: number | undefined; reason: string | undefined }> = [];

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
  }

  // --- test-only event synthesis -------------------------------------------------

  /** Simulates the connection succeeding. */
  emitOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  /** Simulates a server-initiated or network-initiated close, with an optional application close code. */
  emitClose(code?: number, reason = ""): void {
    this.readyState = FakeWebSocket.CLOSED;
    const init: CloseEventInit = { reason };
    if (code !== undefined) {
      init.code = code;
    }
    this.dispatchEvent(new CloseEvent("close", init));
  }

  /** Simulates a raw network error (e.g. a connection that never completed the handshake). */
  emitError(): void {
    this.dispatchEvent(new Event("error"));
  }

  /** Simulates an in-band application message. `data` is JSON-encoded, matching the real wire format. */
  emitMessage(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}
