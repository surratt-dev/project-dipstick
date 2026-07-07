import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type {
  EmSessionHistoryResponse,
  EmSessionHistoryEntry,
  EmSessionTopicSummary,
} from "@dipstick/shared";

// ---------------------------------------------------------------------------
// EmSessionHistoryPage — SESSION-007/SESSION-008 consumer
//
// Phase 3 EM read-only view (establish-manager-team-relationship, task 5.14).
// Fetches from GET /api/v1/teams/:teamId/em/sessions — a net-new endpoint that
// enforces the vote attribution boundary at the serialization layer (Decision 5).
//
// Attribution boundary constraints enforced in this view (Decision 5):
//   - Aggregate vote distributions only (how many people voted what value)
//   - Session date, participant COUNT (not names), facilitator name, topic names
//   - NO per-participant vote values anywhere in the display
//   - NO voter IDs, names, or any field that identifies who cast which vote
//
// This is a NET-NEW view — not a modification of the participant session view.
// Per Decision 11: the backend writes an audit_log record on every EM data access
// that returns data; 403 responses do not produce audit records.
// ---------------------------------------------------------------------------

interface TopicRowProps {
  topic: EmSessionTopicSummary;
}

function TopicRow({ topic }: TopicRowProps) {
  return (
    <div
      data-testid={`topic-row-${topic.topicId}`}
      style={{
        padding: "0.5rem 0.75rem",
        marginBottom: "0.25rem",
        border: "1px solid #e0e0e0",
        borderRadius: "4px",
        backgroundColor: "#fafafa",
      }}
    >
      <div style={{ fontWeight: "500" }}>
        {topic.topicName}
        {topic.flaggedForDiscussion && (
          <span
            style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#e65100" }}
            title="Flagged for discussion"
          >
            ⚑ flagged
          </span>
        )}
      </div>
      <div
        data-testid={`vote-distribution-${topic.topicId}`}
        style={{ marginTop: "0.25rem", fontSize: "0.875rem" }}
      >
        {/* Aggregate vote distribution — no voter identity (Decision 5) */}
        {topic.voteDistribution.length === 0 ? (
          <span style={{ color: "#9e9e9e" }}>No votes recorded</span>
        ) : (
          <span>
            Votes:{" "}
            {topic.voteDistribution.map((bucket) => (
              <span
                key={bucket.voteValue}
                data-testid={`vote-bucket-${topic.topicId}-${bucket.voteValue}`}
                style={{ marginRight: "0.75rem" }}
              >
                {bucket.voteValue} × {bucket.count}
                {bucket.containsOutlier && (
                  <span style={{ color: "#f57c00", marginLeft: "0.25rem" }} title="Outlier">
                    ↑
                  </span>
                )}
              </span>
            ))}
          </span>
        )}
        {topic.average !== null && (
          <span style={{ marginLeft: "0.5rem", color: "#616161" }}>
            avg {topic.average.toFixed(1)}
          </span>
        )}
        {topic.median !== null && (
          <span style={{ marginLeft: "0.5rem", color: "#616161" }}>
            median {topic.median}
          </span>
        )}
      </div>
    </div>
  );
}

interface SessionCardProps {
  session: EmSessionHistoryEntry;
  teamId: string;
}

function SessionCard({ session, teamId }: SessionCardProps) {
  const sessionDate = new Date(session.sessionDate).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      data-testid={`session-card-${session.sessionId}`}
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: "6px",
        padding: "1rem 1.25rem",
        marginBottom: "1rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: "600", fontSize: "1rem" }}>
            Session #{session.sessionNumber}
          </div>
          <div
            data-testid={`session-date-${session.sessionId}`}
            style={{ color: "#616161", fontSize: "0.875rem" }}
          >
            {sessionDate}
          </div>
        </div>
        <Link
          to={`/team/${teamId}/em/sessions/${session.sessionId}`}
          data-testid={`session-detail-link-${session.sessionId}`}
          style={{ fontSize: "0.875rem", color: "#1565c0" }}
        >
          View details
        </Link>
      </div>

      <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#555" }}>
        {/* Facilitator name is permitted per Decision 5 */}
        <span data-testid={`session-facilitator-${session.sessionId}`}>
          Facilitator: {session.facilitatorName}
        </span>
        <span style={{ marginLeft: "1rem" }}>
          {/* Aggregate participant count — not names (Decision 5) */}
          <span data-testid={`session-participant-count-${session.sessionId}`}>
            {session.participantCount} participant{session.participantCount !== 1 ? "s" : ""}
          </span>
        </span>
      </div>

      {session.topics.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ fontSize: "0.75rem", fontWeight: "600", color: "#757575", marginBottom: "0.25rem" }}>
            TOPICS
          </div>
          {session.topics.map((topic) => (
            <TopicRow key={topic.topicId} topic={topic} />
          ))}
        </div>
      )}
    </div>
  );
}

export function EmSessionHistoryPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const [data, setData] = useState<EmSessionHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/em/sessions`, {
        credentials: "include",
      });
      if (res.status === 403) {
        setError("You do not have access to this team's session history.");
        return;
      }
      if (!res.ok) {
        setError("Failed to load session history.");
        return;
      }
      const json = (await res.json()) as EmSessionHistoryResponse;
      setData(json);
    } catch {
      setError("Network error loading session history.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  if (loading) return <p>Loading session history…</p>;

  if (error) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <p role="alert" data-testid="em-session-history-error">
          {error}
        </p>
        <Link to={`/team/${teamId ?? ""}/em`}>Back to team overview</Link>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div
      data-testid="em-session-history-view"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}
    >
      <nav style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link to={`/team/${teamId}/em`} data-testid="back-to-em-dashboard">
          ← Team Overview
        </Link>
      </nav>

      <h1 data-testid="em-session-history-heading">Session History</h1>

      {data.sessions.length === 0 ? (
        <p data-testid="em-session-history-empty">No completed sessions yet.</p>
      ) : (
        <div>
          {data.sessions.map((session) => (
            <SessionCard key={session.sessionId} session={session} teamId={teamId!} />
          ))}
        </div>
      )}
    </div>
  );
}
