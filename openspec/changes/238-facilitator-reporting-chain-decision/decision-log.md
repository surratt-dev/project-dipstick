# Decision Log — facilitator-reporting-chain-decision (#238)

Questions and decisions reached while running the agent-team pipeline for this change.

| # | Date | Question | Decision | Decided by |
|---|------|----------|----------|------------|
| 1 | 2026-10-04 | How to resolve #238 | **Raise an error when the IdP sends a user both `engineering_manager` and `facilitator`**, rather than modelling the reporting chain. | User |
| 2 | 2026-10-04 | #238's fix depends on #235 (facilitator role, array claims, precedence), which isn't merged and has no code yet. Amend #235, stack on it, or record the decision only? | **Decision record only now.** Record the decision in `requirements/`; defer implementation until #235 lands (follow-up implementation issue). | User |
| 3 | 2026-10-04 | What does the "error" do at sign-in? | **Sign in as `engineering_manager` + flag the conflict** (the more restrictive role for the ritual; conflict is surfaced and audited). Supersedes #235 Decision 7 for this pair only. | User |
| 4 | 2026-10-04 | Claim also contains `application_admin`? | **Admin wins, still flag.** #235 precedence for admin is unchanged; the EM+facilitator conflict is still audited and surfaced. | User |
| 5 | 2026-10-04 | Track classification | **Full track** — fails "no security-sensitive surface" (role resolution is an authorization boundary) and "no ritual surface" (no-manager rule). | Pipeline (automatic) |
| 6 | 2026-10-04 | Branch | Work on the session-designated branch `ccr-0a503dba-mlcpjd` instead of `agent-team/238-…` (environment restricts pushes; same as #235). | Environment constraint |
| 7 | 2026-10-04 | Project board status → In Progress | Not possible from this session (`gh` not authenticated; no project-board MCP tool). User to move manually. | Environment constraint |
