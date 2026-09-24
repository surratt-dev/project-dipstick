import { describe, it, expect } from "vitest";
import pg from "pg";

// ---------------------------------------------------------------------------
// Pins the twelve default-topic rows seeded for the sentinel
// `__default_topics__` team (migration 11_default_topics_correction.sql)
// against the real database, so any future drift between the Topic
// Management use case's Acceptance Criteria and the seed fails this test
// instead of going unnoticed (fix-default-topic-seed-data design.md's
// "Risks / Trade-offs").
//
// Requires a REAL Postgres with migrations applied (docker compose up, then
// npm run db:migrate — see .env.example for the expected local port). Self-
// skips with a clear console message when Postgres is unreachable, rather
// than failing the suite or silently passing — same pattern as
// facilitator-error-states-integration.test.ts.
// ---------------------------------------------------------------------------

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://dipstick:dipstick@localhost:5433/dipstick";
const PROBE_TIMEOUT_MS = 750;
const SENTINEL_TEAM_ID = "00000000-0000-0000-0000-000000000001";

async function isPostgresReachable(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: PROBE_TIMEOUT_MS });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const infraAvailable = await isPostgresReachable();

if (!infraAvailable) {
  console.warn(
    `[default-topics-seed-integration.test.ts] SKIPPED — Postgres (${DATABASE_URL.replace(/:[^:@]+@/, ":****@")}: unreachable). ` +
      "Run `docker compose up` (repo root) and `npm run db:migrate` (packages/backend), then re-run this file.",
  );
}

// Pinned per specs/database-migrations/spec.md's "Default topics are
// seeded" scenario (this change) — item-for-item, in display_order.
const EXPECTED_TOPICS = [
  {
    name: "Production Code — Adding Features",
    prompt: "How easy is it to add features to production code?",
    voteType: "finger",
    displayOrder: 1,
  },
  {
    name: "Production Code — Reasoning",
    prompt: "How easy is it to reason about production code?",
    voteType: "finger",
    displayOrder: 2,
  },
  {
    name: "Production Code — Active Development",
    prompt: "How would you rate the code under active development?",
    voteType: "finger",
    displayOrder: 3,
  },
  {
    name: "Production Code — Entire Project",
    prompt: "How would you rate the code for the entirety of the project?",
    voteType: "finger",
    displayOrder: 4,
  },
  {
    name: "Test Suite — Effectiveness",
    prompt: "Is the test suite effective?",
    voteType: "finger",
    displayOrder: 5,
  },
  {
    name: "Test Suite — Consistency",
    prompt: "Is the test suite consistent?",
    voteType: "roman",
    displayOrder: 6,
  },
  {
    name: "Test Suite — Active Development",
    prompt: "How would you rate the tests under active development?",
    voteType: "finger",
    displayOrder: 7,
  },
  {
    name: "Test Suite — Entire Project",
    prompt: "How would you rate the tests for the entirety of the project?",
    voteType: "finger",
    displayOrder: 8,
  },
  {
    name: "Pipeline",
    prompt: "Confidence in the pipeline",
    voteType: "finger",
    displayOrder: 9,
  },
  {
    name: "Technology Stack",
    prompt: "Are you comfortable with the technology stack?",
    voteType: "roman",
    displayOrder: 10,
  },
  {
    name: "Pairing",
    prompt: "How effective is pairing?",
    voteType: "finger",
    displayOrder: 11,
  },
  {
    name: "Project Trend",
    prompt: "Overall, is this project trending up, steady, or down?",
    voteType: "modified_roman",
    displayOrder: 12,
  },
];

describe.skipIf(!infraAvailable)("default topics seed (default-topics-seed-integration)", () => {
  it("seeds exactly the twelve canonical default topics for the sentinel team, in order", async () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL });
    try {
      const result = await pool.query<{
        name: string;
        prompt: string;
        vote_type: string;
        display_order: number;
      }>(
        `SELECT name, prompt, vote_type, display_order
         FROM topics
         WHERE team_id = $1 AND is_default = true
         ORDER BY display_order`,
        [SENTINEL_TEAM_ID],
      );

      expect(result.rows).toHaveLength(12);

      result.rows.forEach((row, index) => {
        const expected = EXPECTED_TOPICS[index]!;
        expect(row.name).toBe(expected.name);
        expect(row.prompt).toBe(expected.prompt);
        expect(row.vote_type).toBe(expected.voteType);
        expect(row.display_order).toBe(expected.displayOrder);
      });
    } finally {
      await pool.end();
    }
  });
});
