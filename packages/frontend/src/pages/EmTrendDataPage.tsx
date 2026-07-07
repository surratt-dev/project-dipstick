import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { EmTrendResponse, EmTopicTrend } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// EmTrendDataPage — TREND-001/TREND-002 consumer
//
// Phase 3 EM read-only view (establish-manager-team-relationship, task 5.15).
// Fetches from GET /api/v1/teams/:teamId/em/trends — a net-new endpoint that
// enforces the vote attribution boundary at the serialization layer (Decision 5).
//
// Attribution boundary: statistical aggregates only, no participant labels.
// Displays averages, medians, trend direction WITHOUT identifying who voted.
// No write affordances (Decision 11 / task 5.16).
// ---------------------------------------------------------------------------

const TREND_DIRECTION_LABELS: Record<number, string> = {
  1: "↑ Improving",
  "-1": "↓ Declining",
  0: "→ Stable",
};

interface TopicTrendCardProps {
  topic: EmTopicTrend;
  teamId: string;
}

function TopicTrendCard({ topic, teamId }: TopicTrendCardProps) {
  const trendLabel =
    topic.trendDirection !== null
      ? TREND_DIRECTION_LABELS[topic.trendDirection] ?? "—"
      : "Insufficient data";

  const trendColor =
    topic.trendDirection === 1
      ? "#2e7d32"
      : topic.trendDirection === -1
        ? "#c62828"
        : "#616161";

  return (
    <div
      data-testid={`trend-card-${topic.topicId}`}
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: "6px",
        padding: "1rem 1.25rem",
        marginBottom: "1rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontWeight: "600" }}>{topic.topicName}</div>
        <Link
          to={`/team/${teamId}/em/trends/${topic.topicId}`}
          data-testid={`topic-trend-detail-link-${topic.topicId}`}
          style={{ fontSize: "0.875rem", color: "#1565c0" }}
        >
          View detail
        </Link>
      </div>

      <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
        {topic.overallAverage !== null && (
          <span data-testid={`trend-avg-${topic.topicId}`}>
            Average: <strong>{topic.overallAverage.toFixed(2)}</strong>
          </span>
        )}
        {topic.overallMedian !== null && (
          <span data-testid={`trend-median-${topic.topicId}`}>
            Median: <strong>{topic.overallMedian}</strong>
          </span>
        )}
        <span
          data-testid={`trend-direction-${topic.topicId}`}
          style={{ color: trendColor, fontWeight: "500" }}
        >
          {trendLabel}
        </span>
      </div>

      {/* Session-by-session data points — aggregate stats only, no participant labels */}
      {topic.sessions.length > 0 && (
        <div style={{ marginTop: "0.75rem" }}>
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: "600",
              color: "#757575",
              marginBottom: "0.25rem",
            }}
          >
            SESSIONS ({topic.sessions.length})
          </div>
          <div
            data-testid={`session-data-points-${topic.topicId}`}
            style={{ fontSize: "0.8125rem", color: "#555" }}
          >
            {topic.sessions.map((dp) => {
              const date = new Date(dp.sessionDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              });
              return (
                <div
                  key={dp.sessionId}
                  data-testid={`data-point-${topic.topicId}-${dp.sessionId}`}
                  style={{ marginBottom: "0.125rem" }}
                >
                  #{dp.sessionNumber} ({date}):
                  {dp.average !== null && ` avg ${dp.average.toFixed(1)}`}
                  {dp.median !== null && ` · median ${dp.median}`}
                  {/* Aggregate participant count — not individual names */}
                  <span style={{ color: "#9e9e9e" }}>
                    {" "}· {dp.participantCount} participant{dp.participantCount !== 1 ? "s" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function EmTrendDataPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const [data, setData] = useState<EmTrendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadTrends = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/em/trends`, {
        credentials: "include",
      });
      if (res.status === 403) {
        setError("You do not have access to this team's trend data.");
        return;
      }
      if (!res.ok) {
        setError("Failed to load trend data.");
        return;
      }
      const json = (await res.json()) as EmTrendResponse;
      setData(json);
    } catch {
      setError("Network error loading trend data.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void loadTrends();
  }, [loadTrends]);

  if (loading) return <p>Loading trend data…</p>;

  if (error) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <p role="alert" data-testid="em-trend-data-error">
          {error}
        </p>
        <Link to={`/team/${teamId ?? ""}/em`}>Back to team overview</Link>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div
      data-testid="em-trend-data-view"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}
    >
      <nav style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link to={`/team/${teamId}/em`} data-testid="back-to-em-dashboard">
          ← Team Overview
        </Link>
      </nav>

      <h1 data-testid="em-trend-data-heading">Trend Data</h1>

      {data.dateRangeStart && data.dateRangeEnd && (
        <p
          data-testid="trend-date-range"
          style={{ color: "#616161", fontSize: "0.875rem", marginBottom: "1rem" }}
        >
          {new Date(data.dateRangeStart).toLocaleDateString()} –{" "}
          {new Date(data.dateRangeEnd).toLocaleDateString()}
        </p>
      )}

      {data.topics.length === 0 ? (
        <p data-testid="em-trend-data-empty">No trend data available yet.</p>
      ) : (
        <div>
          {data.topics.map((topic) => (
            <TopicTrendCard key={topic.topicId} topic={topic} teamId={teamId!} />
          ))}
        </div>
      )}
    </div>
  );
}
