import { useCallback, useEffect, useRef, useState } from "react";
import type { ParticipantRosterEntry, ParticipantRosterResponse, WsClientMessage } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// useParticipantRoster — participant-readiness-roster, design.md Decisions
// D3/D3a/D4/D5, tasks.md Section 3.
//
// Host-agnostic (design.md D1): takes an existing session-scoped socket
// (from useConnectionHealth, already open on the host page -- this hook
// never opens its own connection) and a sessionId, and owns the roster's own
// state. Shared, unmodified, by DraftSessionHost's live-readiness child and
// SessionLobbyPage's lobby branch.
//
// Rows are keyed by userId (design.md D3): participant_left marks the
// existing row disconnected rather than removing it; participant_joined for
// a KNOWN userId clears the marker on the existing row (add-or-clear, never
// delete-and-reinsert) -- a participant's position never changes as a
// result of disconnecting/reconnecting, since neither path re-sorts.
//
// participant_joined for an UNRECOGNIZED userId (design.md D3a):
// ParticipantJoinedPayload carries no display name, so this hook re-fetches
// the D5 roster endpoint rather than inserting a row built from the event
// alone -- the fetch function is re-invoked here, not only on mount.
//
// Sort order (design.md D4): alphabetical by display name. The REST fetch's
// own query already orders alphabetically; this hook re-sorts its merged
// result defensively rather than trusting fetch order, since it merges
// server data with locally-preserved disconnected flags.
// ---------------------------------------------------------------------------

export interface RosterEntry {
  userId: string;
  displayName: string;
  disconnected: boolean;
}

function sortByDisplayName(entries: RosterEntry[]): RosterEntry[] {
  return [...entries].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function isParticipantJoinedMessage(
  message: WsClientMessage,
): message is Extract<WsClientMessage, { eventType: "participant_joined" }> {
  return message.eventType === "participant_joined";
}

function isParticipantLeftMessage(
  message: WsClientMessage,
): message is Extract<WsClientMessage, { eventType: "participant_left" }> {
  return message.eventType === "participant_left";
}

/**
 * The D5 initial/refresh roster fetch. Returns `null` on any non-2xx
 * response or network failure -- the hook simply skips the update rather
 * than surfacing an error state; a subsequent participant_joined/left event
 * or the next mount will retry.
 */
export async function fetchParticipantRoster(sessionId: string): Promise<ParticipantRosterEntry[] | null> {
  try {
    const res = await fetch(`/api/v1/sessions/${sessionId}/participants-roster`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as ParticipantRosterResponse;
    return body.participants;
  } catch {
    return null;
  }
}

export interface UseParticipantRosterResult {
  participants: RosterEntry[];
}

export function useParticipantRoster(
  sessionId: string | undefined,
  socket: WebSocket | null,
): UseParticipantRosterResult {
  const [participants, setParticipants] = useState<RosterEntry[]>([]);

  // Read inside the WS message handler without making it a dependency of
  // the socket-subscription effect below (mirrors SessionLobbyPage's
  // fetchReviewRef pattern) -- an unrecognized-userId re-fetch and a known-
  // userId clear both need the latest roster snapshot without tearing down
  // and re-attaching the message listener on every state change.
  const participantsRef = useRef<RosterEntry[]>(participants);
  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  const refetch = useCallback(async () => {
    if (!sessionId) return;
    const roster = await fetchParticipantRoster(sessionId);
    if (roster === null) return;

    setParticipants((prev) => {
      const prevByUserId = new Map(prev.map((entry) => [entry.userId, entry]));
      const merged: RosterEntry[] = roster.map((entry) => {
        const existing = prevByUserId.get(entry.userId);
        return existing
          ? { ...existing, displayName: entry.displayName }
          : { userId: entry.userId, displayName: entry.displayName, disconnected: false };
      });
      return sortByDisplayName(merged);
    });
  }, [sessionId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    if (!socket) return;

    function onMessage(event: MessageEvent): void {
      let parsed: unknown;
      try {
        parsed = typeof event.data === "string" ? JSON.parse(event.data) : null;
      } catch {
        return;
      }
      if (parsed === null || typeof parsed !== "object" || !("eventType" in parsed)) return;
      const message = parsed as WsClientMessage;

      if (isParticipantLeftMessage(message)) {
        const { userId } = message.payload;
        setParticipants((prev) =>
          prev.map((entry) => (entry.userId === userId ? { ...entry, disconnected: true } : entry)),
        );
        return;
      }

      if (isParticipantJoinedMessage(message)) {
        const { userId } = message.payload;
        const isKnown = participantsRef.current.some((entry) => entry.userId === userId);
        if (isKnown) {
          setParticipants((prev) =>
            prev.map((entry) => (entry.userId === userId ? { ...entry, disconnected: false } : entry)),
          );
        } else {
          // design.md D3a: no display name on the event -- re-fetch rather
          // than insert a blank/UUID row.
          void refetch();
        }
      }
    }

    socket.addEventListener("message", onMessage);
    return () => socket.removeEventListener("message", onMessage);
  }, [socket, refetch]);

  return { participants };
}
