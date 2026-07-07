import { Link, useParams } from "react-router-dom";

// ---------------------------------------------------------------------------
// EmTeamDashboardPage — Engineering Manager team landing page
//
// Phase 3 EM landing (establish-manager-team-relationship, task 5.14).
// Provides navigation to the three EM read-only views:
//   - Session history (SESSION-007/008)
//   - Trend data (TREND-001/002)
//   - Action items (ACTION-004/005)
//
// This page is the landing for an EM who has been associated with a team via
// TEAM-006. The association means they have read-only access to session history,
// trend data, and action items — but they CANNOT join or observe live sessions.
// ---------------------------------------------------------------------------

export function EmTeamDashboardPage() {
  const { teamId } = useParams<{ teamId: string }>();

  if (!teamId) return null;

  return (
    <div
      data-testid="em-team-dashboard"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}
    >
      <h1 data-testid="em-dashboard-heading">Team Overview</h1>

      <nav
        data-testid="em-dashboard-nav"
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxWidth: "400px" }}
      >
        <Link
          to={`/team/${teamId}/em/sessions`}
          data-testid="nav-session-history"
          style={{
            display: "block",
            padding: "0.75rem 1rem",
            border: "1px solid #e0e0e0",
            borderRadius: "6px",
            textDecoration: "none",
            color: "#1565c0",
          }}
        >
          <div style={{ fontWeight: "600" }}>Session History</div>
          <div style={{ fontSize: "0.875rem", color: "#616161", marginTop: "0.25rem" }}>
            View aggregate results from completed sessions
          </div>
        </Link>

        <Link
          to={`/team/${teamId}/em/trends`}
          data-testid="nav-trend-data"
          style={{
            display: "block",
            padding: "0.75rem 1rem",
            border: "1px solid #e0e0e0",
            borderRadius: "6px",
            textDecoration: "none",
            color: "#1565c0",
          }}
        >
          <div style={{ fontWeight: "600" }}>Trend Data</div>
          <div style={{ fontSize: "0.875rem", color: "#616161", marginTop: "0.25rem" }}>
            Track how topics are trending over time
          </div>
        </Link>

        <Link
          to={`/team/${teamId}/em/action-items`}
          data-testid="nav-action-items"
          style={{
            display: "block",
            padding: "0.75rem 1rem",
            border: "1px solid #e0e0e0",
            borderRadius: "6px",
            textDecoration: "none",
            color: "#1565c0",
          }}
        >
          <div style={{ fontWeight: "600" }}>Action Items</div>
          <div style={{ fontSize: "0.875rem", color: "#616161", marginTop: "0.25rem" }}>
            Review action items committed to by your team
          </div>
        </Link>
      </nav>
    </div>
  );
}
