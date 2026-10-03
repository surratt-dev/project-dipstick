# Decision Log — facilitator-role-claim-allowlist (#235)

Questions and decisions reached while running the agent-team pipeline for this change.

| # | Date | Question | Decision | Decided by |
|---|------|----------|----------|------------|
| 1 | 2026-10-03 | Track classification | Full track — fails "no security-sensitive surface" (role mapping is an authorization boundary). | Pipeline (automatic) |
| 2 | 2026-10-03 | Branch | Work on the session-designated branch `ccr-b594efa3-9zclgu` instead of `agent-team/235-…` (environment restricts pushes). | Environment constraint |
| 3 | 2026-10-03 | Project board status → In Progress | Not possible from this session (GitHub GraphQL blocked); user to move manually. | Environment constraint |
| 4 | 2026-10-03 | Demotion audit: issue AC requires `auth.role_claim_mapped` to record `facilitator → engineer`, but it currently fires only when the new role ≠ `engineer` and the `auth-error-handling` spec says reversion writes no row. | **Fire on any change**: `role_claim_mapped` fires when the new role ≠ `engineer` OR differs from the previous role. Amend the `auth-error-handling` "Reversion…not represented" scenario. Applies to EM/admin demotion too. | User |
| 5 | 2026-10-03 | Facilitators with a team membership are redirected to their team view and have no in-app link to `/sessions/new` (`App.tsx:34-41`). Fix in #235? | **No — file follow-up.** Filed #237. #235 stays scoped to role persistence. | User |
| 6 | 2026-10-03 | Array role claims (Entra sends `roles` as an array): how to handle? | **Explicit handling with precedence.** Accept a string or an array; non-allowlisted elements are ignored (warning, raw value never audited); among allowlisted values pick the highest by precedence. | User |
| 7 | 2026-10-03 | Precedence order for multi-valued claims | **application_admin > facilitator > engineering_manager > senior_engineer > engineer.** (Note: a user holding both facilitator and EM resolves to facilitator; ritual safety then rests on team-membership checks — the no-manager rule is enforced by memberships, see exploration Finding 3.) | User |
| 8 | 2026-10-03 | Allowlist `senior_engineer` even though it grants nothing beyond `engineer`? | **Yes** — explicitly in #235 scope; behaves like other non-default roles (a `role_claim_mapped` row each sign-in, as EM/admin already do). | Pipeline (per issue scope) |
| 9 | 2026-10-03 | Manager switched to facilitator in the IdP (Finding 3) — code change or docs? | **Docs warning only** in deployment docs; no new alerting. Team-membership hard-blocks already prevent facilitating own teams. | Pipeline (Devon's recommendation, unopposed) |
| 10 | 2026-10-03 | Misleading `/no-team` copy for a user expecting facilitator but not receiving it (Priya) | **Docs troubleshooting entry only** in this change; no UI copy change (no new UI surface in #235). | Pipeline (scope discipline) |
