# Decision Log — README Badges

Date: 2026-09-30

| # | Question | Decision | Rationale |
|---|---|---|---|
| 1 | Which badges should the README show? | Workflow status (CI, Integration Tests, Docker Build, Release), latest release, Node version, and stack badges (TypeScript, React, Fastify, PostgreSQL). | Chosen by the project owner. |
| 2 | How should the coverage badge work? | Self-hosted via a gist and shields.io endpoint badges, written by CI. | No third-party coverage service. Needs a `gist`-scoped PAT secret. |
| 3 | One combined coverage number or one per package? | One badge per package (shared, backend, frontend). | A strong package can't hide a weak one. Needs no merge step, since each package already produces its own report. |
| 4 | Gist ID available now? | No. Use a `GIST_OWNER/GIST_ID` placeholder in the README and the `COVERAGE_GIST_ID` repo variable. The publish steps skip until the variable is set. | The gist and PAT must be created by the owner; setup steps are in `docs/ci-cd.md`. |
| — | License badge? | Not added. | The repository has no LICENSE file. |
