// ---------------------------------------------------------------------------
// DEFAULT_TOPICS_TEAM_ID — the sentinel __default_topics__ template team
//
// The canonical default topic set lives as is_default rows on this team
// (migrations 4/11). POST /api/v1/teams copies them to a new team, and
// content.ts reads them for the topic listing. Named and shared here
// (session-topics-snapshot-at-creation design.md Decision 4) so the SQL and
// the empty-template error log line cannot drift. Not in routes/, which
// holds only Fastify route plugins.
// ---------------------------------------------------------------------------
export const DEFAULT_TOPICS_TEAM_ID = "00000000-0000-0000-0000-000000000001";
