import type { Pool } from "pg";
import { DEFAULT_TOPICS_TEAM_ID } from "./default-topics.js";

// ---------------------------------------------------------------------------
// Template anomaly detection (harden-team-creation-topic-copy #215, design.md
// D3, proposal.md "Anomaly semantics" V1-V4).
//
// admin-default-topic-maintenance (#216) design.md E6: `non_active_default`
// was retired. An archived default is now VALID state (it is how an
// administrator retires a default for new teams) and is never copied, so
// warning about it on every team creation would be noise forever. The three
// remaining anomalies still cover damage.
//
// readTemplateTopicFacts reads ids and structural columns only -- never a
// name, prompt or other row text -- so nothing it returns can reach a log
// line as text. detectTemplateAnomalies is pure.
// ---------------------------------------------------------------------------

export type TemplateAnomaly =
  | "duplicate_active_order"
  | "non_contiguous_order"
  | "non_default_row";

export interface TemplateTopicFact {
  id: string;
  is_default: boolean;
  status: string;
  display_order: number;
}

export const TOPIC_IDS_CAP = 50;

/** Every template row, of any status: ids and structural columns only. */
export async function readTemplateTopicFacts(db: Pool): Promise<TemplateTopicFact[]> {
  const result = await db.query<TemplateTopicFact>(
    `SELECT id, is_default, status, display_order FROM topics WHERE team_id = $1`,
    [DEFAULT_TOPICS_TEAM_ID],
  );
  return result.rows;
}

export function detectTemplateAnomalies(facts: readonly TemplateTopicFact[]): {
  anomalies: TemplateAnomaly[];
  topicIds: string[];
} {
  // Canonical order: display_order ascending, ties by id ascending.
  const ordered = [...facts].sort(
    (a, b) => a.display_order - b.display_order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const activeDefaults = ordered.filter((f) => f.is_default && f.status === "active");

  const countByPosition = new Map<number, number>();
  for (const f of activeDefaults) countByPosition.set(f.display_order, (countByPosition.get(f.display_order) ?? 0) + 1);
  const duplicatedPositions = new Set([...countByPosition].filter(([, n]) => n > 1).map(([pos]) => pos));

  const distinct = [...countByPosition.keys()].sort((a, b) => a - b);
  const contiguous = distinct.every((pos, i) => pos === i + 1);

  const affected = new Set<string>();
  const anomalies: TemplateAnomaly[] = [];

  if (duplicatedPositions.size > 0) {
    anomalies.push("duplicate_active_order");
    for (const f of activeDefaults) if (duplicatedPositions.has(f.display_order)) affected.add(f.id);
  }
  if (!contiguous) anomalies.push("non_contiguous_order");
  const nonDefaults = ordered.filter((f) => !f.is_default);
  if (nonDefaults.length > 0) {
    anomalies.push("non_default_row");
    for (const f of nonDefaults) affected.add(f.id);
  }

  const topicIds = ordered.filter((f) => affected.has(f.id)).map((f) => f.id).slice(0, TOPIC_IDS_CAP);
  return { anomalies, topicIds };
}
