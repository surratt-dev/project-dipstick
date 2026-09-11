import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as VoteDraftModule from "../voteDraft.js";
import type { RegistrationSnapshotForRestore, VoteValue } from "../voteDraft.js";

// ---------------------------------------------------------------------------
// voteDraft.test.ts — CONTRACT-LEVEL tests per design.md Decision D7.
//
// These tests exercise persistDraft/restoreDraft directly against fixture
// registration-payload objects standing in for what a real compose
// component and the real backend `session_registration_snapshot` message
// (tasks.md Group 7) will eventually supply. Every scenario in
// specs/vote-compose-recovery/spec.md that is testable without a real
// compose UI has a corresponding test below (tasks.md task 5.1).
//
// Explicitly NOT covered here — deferred per design.md D7 and tasks.md
// Group 8.3, owed once the real compose UI (task 8.1) and issue #32's
// redirect trigger (task 8.2) both exist:
//   - Requirement 5's "no spinner / no flash / no visible transition"
//     scenarios — these describe rendering behavior of a compose component
//     that does not exist yet.
//   - Requirement 5's "discard is indistinguishable from empty" scenario —
//     same, requires a real rendered control to compare against.
//   - Requirement 3's "a successfully-registered connection receives its
//     registration snapshot" / "a rejected connection receives no
//     snapshot" / "the snapshot discloses only the connecting
//     participant's own lock-in status" scenarios — these describe the
//     BACKEND payload's own behavior, covered instead by
//     packages/backend/src/realtime/__tests__/session-registration-snapshot.test.ts
//     (unit) and websocket-routes.test.ts (integration, tasks.md task 7.5).
//   - Requirement 1's "draft never becomes a second source of submitted
//     vote state" end-to-end, through the real lock-in submission path —
//     requires the real compose UI and submission wiring (Group 8.3).
//
// Every module-scope test below that depends on the once-per-page-load gate
// (design.md D2) resets the module via vi.resetModules() + a fresh dynamic
// import, simulating an actual page load — the only thing that legitimately
// re-arms that gate, per this module's own design.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "dipstick:vote-draft";

async function freshModule(): Promise<typeof VoteDraftModule> {
  vi.resetModules();
  return import("../voteDraft.js");
}

/**
 * jsdom's window.sessionStorage/localStorage are backed by an internal
 * Proxy whose own get-trap returns the built-in getItem/setItem/removeItem
 * implementations directly, bypassing `vi.spyOn`'s own-property override
 * (verified empirically against jsdom@29 while writing these tests). A
 * call-count-observing fake, swapped in for `window.sessionStorage` for the
 * duration of one test via `Object.defineProperty`, is used instead
 * wherever a test needs to assert something about *whether* a storage
 * method was called, not just its net effect.
 */
function installFakeSessionStorage(): {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  restore: () => void;
} {
  const backing = new Map<string, string>();
  const fake = {
    getItem: vi.fn((key: string) => (backing.has(key) ? backing.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      backing.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      backing.delete(key);
    }),
  };
  const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  Object.defineProperty(window, "sessionStorage", { value: fake, configurable: true });
  return {
    ...fake,
    restore: () => {
      if (original) {
        Object.defineProperty(window, "sessionStorage", original);
      }
    },
  };
}

function fixturePayload(
  overrides: Partial<RegistrationSnapshotForRestore> = {},
): RegistrationSnapshotForRestore {
  return {
    sessionId: "session-1",
    sessionStatus: "active",
    currentTopic: { sessionTopicId: "topic-A", status: "voting" },
    hasLockedInVote: false,
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("persistDraft (design.md D1, spec.md Requirement 1)", () => {
  it("writes the expected record shape and key; a subsequent call with a new value overwrites rather than appends (task 2.2)", async () => {
    const { persistDraft } = await freshModule();

    persistDraft("session-1", "topic-A", 3);
    const firstRaw = window.sessionStorage.getItem(STORAGE_KEY);
    expect(firstRaw).not.toBeNull();
    const first = JSON.parse(firstRaw!) as { sessionId: string; sessionTopicId: string; value: VoteValue };
    expect(first.sessionId).toBe("session-1");
    expect(first.sessionTopicId).toBe("topic-A");
    expect(first.value).toBe(3);
    expect(typeof (JSON.parse(firstRaw!) as { composedAt: string }).composedAt).toBe("string");

    persistDraft("session-1", "topic-A", 5);

    // Overwrite, not append: exactly one key, and its value reflects only
    // the latest call.
    expect(window.sessionStorage.length).toBe(1);
    const secondRaw = window.sessionStorage.getItem(STORAGE_KEY);
    const second = JSON.parse(secondRaw!) as { value: VoteValue };
    expect(second.value).toBe(5);
  });

  it("makes no network call and touches no other storage key (task 2.3)", async () => {
    const fake = installFakeSessionStorage();
    try {
      const { persistDraft } = await freshModule();
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      persistDraft("session-1", "topic-A", 2);

      expect(fetchSpy).not.toHaveBeenCalled();
      // Exactly one write, to exactly the one key this module owns.
      expect(fake.setItem).toHaveBeenCalledTimes(1);
      expect(fake.setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
    } finally {
      fake.restore();
    }
  });
});

describe("restore-once-per-load gate (design.md D2, spec.md Requirement 2)", () => {
  it("two simulated registrations within the same simulated page load result in exactly one restore attempt; the second is a no-op that never reads storage (task 3.2)", async () => {
    const fake = installFakeSessionStorage();
    try {
      const { persistDraft, restoreDraft } = await freshModule();
      persistDraft("session-1", "topic-A", 4);
      fake.getItem.mockClear(); // persistDraft itself never calls getItem; clear defensively anyway.

      const first = restoreDraft(fixturePayload());
      expect(first).toBe(4);
      expect(fake.getItem).toHaveBeenCalledTimes(1);

      fake.getItem.mockClear();
      const second = restoreDraft(fixturePayload());
      expect(second).toBeNull();
      expect(fake.getItem).not.toHaveBeenCalled();
    } finally {
      fake.restore();
    }
  });

  it("clears the stored entry after the one attempt regardless of whether the draft was restored or discarded (task 3.3)", async () => {
    // Restored case.
    {
      const { persistDraft, restoreDraft } = await freshModule();
      persistDraft("session-1", "topic-A", 1);
      restoreDraft(fixturePayload());
      expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    }

    window.sessionStorage.clear();

    // Discarded case (topic mismatch).
    {
      const { persistDraft, restoreDraft } = await freshModule();
      persistDraft("session-1", "topic-A", 1);
      restoreDraft(fixturePayload({ currentTopic: { sessionTopicId: "topic-B", status: "voting" } }));
      expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    }
  });
});

describe("restoreDraft decision logic (design.md D3/D4, spec.md Requirements 3 and 4)", () => {
  it("discards when the topic has advanced (task 4.5 / spec.md Requirement 4 scenario)", async () => {
    const { persistDraft, restoreDraft } = await freshModule();
    persistDraft("session-1", "topic-A", 9);

    const result = restoreDraft(
      fixturePayload({ currentTopic: { sessionTopicId: "topic-B", status: "voting" } }),
    );

    expect(result).toBeNull();
  });

  it("discards when the topic matches but is no longer accepting votes (revealed/complete) (task 4.5)", async () => {
    const { persistDraft, restoreDraft } = await freshModule();
    persistDraft("session-1", "topic-A", 9);

    const revealed = restoreDraft(
      fixturePayload({ currentTopic: { sessionTopicId: "topic-A", status: "revealed" } }),
    );
    expect(revealed).toBeNull();
  });

  it("discards a second, independent draft when the topic status is complete (task 4.5)", async () => {
    const { persistDraft, restoreDraft } = await freshModule();
    persistDraft("session-1", "topic-A", 9);

    const complete = restoreDraft(
      fixturePayload({ currentTopic: { sessionTopicId: "topic-A", status: "complete" } }),
    );
    expect(complete).toBeNull();
  });

  it("discards when the session has moved to wrap_up with no current topic (task 4.5)", async () => {
    const { persistDraft, restoreDraft } = await freshModule();
    persistDraft("session-1", "topic-A", 9);

    const result = restoreDraft(fixturePayload({ sessionStatus: "wrap_up", currentTopic: null }));

    expect(result).toBeNull();
  });

  it("discards when the session no longer matches — a defensive race window (session closes between connect and restore), not a normal-path trigger (task 4.5)", async () => {
    const { persistDraft, restoreDraft } = await freshModule();
    // Draft was composed against session-1. By the time this tab's restore
    // attempt runs, the registration payload it receives reports a
    // DIFFERENT sessionId — the only way this module can observe "the
    // session no longer matches," since evaluateSessionSubscriberAccess
    // (backend) already prevents a closed session's connection from ever
    // reaching a successful registration in the first place (design.md D4).
    persistDraft("session-1", "topic-A", 9);

    const result = restoreDraft(
      fixturePayload({ sessionId: "session-1-superseded", currentTopic: { sessionTopicId: "topic-A", status: "voting" } }),
    );

    expect(result).toBeNull();
  });

  it("discards regardless of topic/status match when the payload reports an existing lock-in — server state wins (task 4.6)", async () => {
    const { persistDraft, restoreDraft } = await freshModule();
    persistDraft("session-1", "topic-A", 9);

    const result = restoreDraft(fixturePayload({ hasLockedInVote: true }));

    expect(result).toBeNull();
  });

  it("restores the draft value when the topic matches, status is voting, and no lock-in exists (task 4.7)", async () => {
    const { persistDraft, restoreDraft } = await freshModule();
    persistDraft("session-1", "topic-A", 7);

    const result = restoreDraft(fixturePayload());

    expect(result).toBe(7);
  });

  it("returns null (never a value) when no draft was persisted at all, even for an otherwise-matching payload", async () => {
    const { restoreDraft } = await freshModule();

    const result = restoreDraft(fixturePayload());

    expect(result).toBeNull();
  });

  it("cannot apply a value before a registration payload is supplied — restoreDraft requires the payload argument and degrades to discard rather than throwing or optimistically returning a value if that discipline is ever violated at a call site (task 4.8)", async () => {
    const { persistDraft, restoreDraft } = await freshModule();
    persistDraft("session-1", "topic-A", 9);

    // restoreDraft's TypeScript signature requires `payload` — no call site
    // in this codebase can compile without supplying one, which is the
    // actual ordering guarantee (task 4.4/4.8). This test additionally
    // confirms there is no runtime fallback path that would apply a value
    // if that type-level discipline were ever bypassed (e.g. via `any`).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately simulating a bypass of the required-parameter guarantee
    expect(() => restoreDraft(undefined as any)).not.toThrow();
  });
});
