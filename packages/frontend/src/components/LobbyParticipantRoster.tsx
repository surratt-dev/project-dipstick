import { useParticipantRoster } from "../realtime/participantRoster.js";
import { ParticipantRosterView } from "./ParticipantRosterView.js";

// ---------------------------------------------------------------------------
// LobbyParticipantRoster — participant-readiness-roster, tasks.md 6.1.
//
// The one shared mount point for useParticipantRoster + ParticipantRosterView
// together, used by both DraftSessionHost's live-readiness child and
// SessionLobbyPage's lobby branch -- not two independently-drifting copies.
//
// Deliberately its own component, not called inline at a parent's top
// level: useParticipantRoster's initial D5 fetch fires on mount, so it must
// only mount while the roster is actually meant to be visible (lobby status,
// facilitator-only) -- the same mount/unmount discipline design.md D1
// applies to the WebSocket subscription itself.
// ---------------------------------------------------------------------------

export interface LobbyParticipantRosterProps {
  sessionId: string;
  socket: WebSocket | null;
  joinUrl?: string;
}

export function LobbyParticipantRoster({ sessionId, socket, joinUrl }: LobbyParticipantRosterProps) {
  const { participants } = useParticipantRoster(sessionId, socket);
  return joinUrl === undefined ? (
    <ParticipantRosterView participants={participants} />
  ) : (
    <ParticipantRosterView participants={participants} joinUrl={joinUrl} />
  );
}
