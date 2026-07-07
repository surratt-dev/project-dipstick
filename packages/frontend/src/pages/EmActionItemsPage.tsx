import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { EmActionItemsResponse, EmActionItem } from "@dipstick/shared";

// ---------------------------------------------------------------------------
// EmActionItemsPage — ACTION-004/ACTION-005 consumer
//
// Phase 3 EM read-only view (establish-manager-team-relationship, task 5.16).
// Fetches from GET /api/v1/teams/:teamId/em/action-items — net-new endpoint.
//
// ownerDisplayName IS visible per Q8 resolution and Decision 13 (design.md):
// action item ownership is work-tracking data, not vote attribution.
//
// NO write affordances: no create, no update, no delete controls.
// An EM who attempts a write via the API (not this view) receives 403 per
// task 5.7 / the em-views.ts write-rejection guards.
//
// Attribution boundary (Decision 5): no vote values, no voter IDs.
// The action item body text is visible per Decision 13.
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<EmActionItem["status"], string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};

const STATUS_COLORS: Record<EmActionItem["status"], string> = {
  open: "#e65100",
  in_progress: "#1565c0",
  resolved: "#2e7d32",
};

interface ActionItemCardProps {
  item: EmActionItem;
}

function ActionItemCard({ item }: ActionItemCardProps) {
  const createdDate = new Date(item.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      data-testid={`action-item-card-${item.id}`}
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: "6px",
        padding: "1rem 1.25rem",
        marginBottom: "0.75rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        {/* Action item body text visible per Decision 13 */}
        <div
          data-testid={`action-item-description-${item.id}`}
          style={{ fontWeight: "500", flex: 1 }}
        >
          {item.description}
        </div>
        <span
          data-testid={`action-item-status-${item.id}`}
          style={{
            marginLeft: "1rem",
            fontSize: "0.75rem",
            fontWeight: "600",
            color: STATUS_COLORS[item.status] ?? "#616161",
            whiteSpace: "nowrap",
          }}
        >
          {STATUS_LABELS[item.status] ?? item.status}
        </span>
      </div>

      <div style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#616161" }}>
        {/* ownerDisplayName visible per Q8/Decision 13 — no ownerId in the response */}
        <span data-testid={`action-item-owner-${item.id}`}>
          Owner: {item.ownerDisplayName}
        </span>
        {item.dueDate && (
          <span style={{ marginLeft: "1rem" }}>
            Due: {new Date(item.dueDate).toLocaleDateString()}
          </span>
        )}
        <span style={{ marginLeft: "1rem" }}>Created: {createdDate}</span>
      </div>

      {item.resolutionNote && (
        <div
          data-testid={`action-item-resolution-${item.id}`}
          style={{
            marginTop: "0.5rem",
            fontSize: "0.875rem",
            color: "#2e7d32",
            fontStyle: "italic",
          }}
        >
          Resolution: {item.resolutionNote}
        </div>
      )}
    </div>
  );
}

export function EmActionItemsPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const [data, setData] = useState<EmActionItemsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadActionItems = useCallback(async () => {
    if (!teamId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/teams/${teamId}/em/action-items`, {
        credentials: "include",
      });
      if (res.status === 403) {
        setError("You do not have access to this team's action items.");
        return;
      }
      if (!res.ok) {
        setError("Failed to load action items.");
        return;
      }
      const json = (await res.json()) as EmActionItemsResponse;
      setData(json);
    } catch {
      setError("Network error loading action items.");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void loadActionItems();
  }, [loadActionItems]);

  if (loading) return <p>Loading action items…</p>;

  if (error) {
    return (
      <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
        <p role="alert" data-testid="em-action-items-error">
          {error}
        </p>
        <Link to={`/team/${teamId ?? ""}/em`}>Back to team overview</Link>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div
      data-testid="em-action-items-view"
      style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}
    >
      <nav style={{ marginBottom: "1rem", fontSize: "0.875rem" }}>
        <Link to={`/team/${teamId}/em`} data-testid="back-to-em-dashboard">
          ← Team Overview
        </Link>
      </nav>

      <h1 data-testid="em-action-items-heading">Action Items</h1>

      {/* No write affordances — this is a read-only view (task 5.16, Decision 11) */}

      {data.actionItems.length === 0 ? (
        <p data-testid="em-action-items-empty">No action items for this team.</p>
      ) : (
        <div>
          {data.actionItems.map((item) => (
            <ActionItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
