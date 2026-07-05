## 1. Root Workspace Setup

- [x] 1.1 Remove stale `HELP.md` from project root
- [x] 1.2 Create root `package.json` declaring npm workspaces (`packages/*`), root-level scripts (`build`, `test`, `lint`, `dev`), and dev dependencies (`typescript`, `eslint`, `vitest`, `concurrently`)
- [x] 1.3 Create `tsconfig.base.json` at project root with shared compiler options: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `target: ES2022`, `module: NodeNext`
- [x] 1.4 Create root `eslint.config.mjs` with TypeScript ESLint rules applied to all `packages/*/src/**/*.ts(x)` files
- [x] 1.5 Create `.gitignore` entries for `node_modules`, `dist`, `.env`, `*.js.map`

## 2. Shared Types Package

- [x] 2.1 Create `packages/shared/package.json` with name `@dipstick/shared`, `exports` pointing to compiled output, and no runtime dependencies
- [x] 2.2 Create `packages/shared/tsconfig.json` extending `../../tsconfig.base.json` with `declarationDir` and `outDir` set to `dist/`
- [x] 2.3 Create `packages/shared/src/types/user.ts` — `User`, `UserRole`, `MembershipRole` types
- [x] 2.4 Create `packages/shared/src/types/team.ts` — `Team`, `TeamMembership` types
- [x] 2.5 Create `packages/shared/src/types/session.ts` — `Session`, `SessionStatus`, `SessionTopic`, `SessionTopicStatus`, `SessionParticipant` types
- [x] 2.6 Create `packages/shared/src/types/vote.ts` — `Vote`, `VoteType` types
- [x] 2.7 Create `packages/shared/src/types/topic.ts` — `Topic`, `TopicStatus` types
- [x] 2.8 Create `packages/shared/src/types/action-item.ts` — `ActionItem`, `ActionItemStatus`, `ActionItemHistory` types
- [x] 2.9 Create `packages/shared/src/index.ts` re-exporting all types
- [x] 2.10 Verify `npm run build` in `packages/shared` compiles without errors

## 3. Backend Package (Fastify Shell)

- [x] 3.1 Create `packages/backend/package.json` with name `@dipstick/backend`, dependencies: `fastify`, `@fastify/sensible`, `pg`, `ioredis`, `@dipstick/shared`; dev dependencies: `tsx`, `vitest`, `@types/node`
- [x] 3.2 Create `packages/backend/tsconfig.json` extending base, with `moduleResolution: NodeNext` and path alias for `@dipstick/shared`
- [x] 3.3 Create `packages/backend/src/config.ts` — reads and validates all required environment variables (`DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `NODE_ENV`); exits with descriptive error if any are absent
- [x] 3.4 Create `packages/backend/src/db.ts` — exports a `pg.Pool` instance initialized from `DATABASE_URL`
- [x] 3.5 Create `packages/backend/src/redis.ts` — exports an `ioredis` client instance initialized from `REDIS_URL`
- [x] 3.6 Create `packages/backend/src/app.ts` — builds and exports the Fastify app instance with `@fastify/sensible` registered
- [x] 3.7 Create `packages/backend/src/routes/health.ts` — registers `GET /health/live` (200 OK) and `GET /health/ready` (queries Postgres and pings Redis; returns 200 with status object or 503 if either is unreachable)
- [x] 3.8 Create `packages/backend/src/index.ts` — imports config, creates app, registers routes, starts server on `PORT` (default 3000)
- [x] 3.9 Verify backend starts successfully with Docker Compose services running and returns 200 from `/health/ready`

## 4. Frontend Package (React Shell)

- [x] 4.1 Create `packages/frontend/package.json` with name `@dipstick/frontend`, dependencies: `react`, `react-dom`, `@dipstick/shared`; dev dependencies: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `vitest`
- [x] 4.2 Create `packages/frontend/tsconfig.json` extending base with `jsx: react-jsx` and path alias for `@dipstick/shared`
- [x] 4.3 Create `packages/frontend/vite.config.ts` with React plugin, `resolve.alias` for `@dipstick/shared` pointing to workspace package, and dev server proxy: `/api/*` → `http://localhost:3000`
- [x] 4.4 Create `packages/frontend/index.html` (Vite entry point)
- [x] 4.5 Create `packages/frontend/src/main.tsx` rendering a `<App />` component into `#root`
- [x] 4.6 Create `packages/frontend/src/App.tsx` rendering a placeholder page ("Engineering Health Check — coming soon")
- [x] 4.7 Verify `npm run build` in `packages/frontend` produces `dist/` without errors
- [x] 4.8 Verify `npm run dev` in `packages/frontend` starts Vite dev server and placeholder renders in browser

## 5. Docker Compose and Local Dev Environment

- [x] 5.1 Create `docker/oidc/config.js` — `node-oidc-provider` configuration with: registered client (backend), four pre-seeded accounts (`engineer@example.com`, `facilitator@example.com`, `manager@example.com`, `admin@example.com`), authorization code flow with PKCE, refresh token grant enabled
- [x] 5.2 Create `docker/oidc/Dockerfile` — minimal Node.js image running the OIDC provider on port 4011
- [x] 5.3 Create `docker-compose.yml` with services: `postgres` (image: `postgres:16`, port: `5433:5432`, health check), `redis` (image: `redis:7-alpine`, port: `6380:6379`, health check), `oidc` (built from `docker/oidc/`, port: `4011:4011`, health check against `/.well-known/openid-configuration`)
- [x] 5.4 Create `.env.example` documenting all required variables with local dev defaults (pointing to Docker Compose service ports)
- [x] 5.5 Add `.env` to `.gitignore`
- [x] 5.6 Add `concurrently` dev script at root: `npm run dev` starts backend (`tsx watch`) and frontend (`vite`) concurrently with labeled output
- [ ] 5.7 Verify `docker compose up` starts all three services healthy

## 6. Database Migrations

- [x] 6.1 Add `node-pg-migrate` as a dependency in `packages/backend/package.json`
- [x] 6.2 Create `packages/backend/migrations/1_create_enums.sql` — all PostgreSQL enum types from the schema (`user_role`, `vote_type`, `session_status`, `action_item_status`, `topic_status`, `session_topic_status`, `membership_role`)
- [x] 6.3 Create `packages/backend/migrations/2_create_tables.sql` — all tables in dependency order: `users`, `teams`, `team_memberships`, `application_settings`, `topics`, `sessions`, `session_topics`, `session_participants`, `votes`, `action_items`, `action_item_history`, `outlier_threshold_overrides`
- [x] 6.4 Create `packages/backend/migrations/3_create_indexes.sql` — all indexes from the schema
- [x] 6.5 Create `packages/backend/migrations/4_seed_data.sql` — default topic set (5 topics with prompts, vote types, `is_default = true`, `first_session_description`) and application settings (outlier threshold: 1.5, staleness threshold: 2, trend chart minimum: 3)
- [x] 6.6 Add `db:migrate` and `db:migrate:down` npm scripts to `packages/backend/package.json`
- [ ] 6.7 Verify `npm run db:migrate` applies all migrations cleanly against the Docker Compose Postgres instance
- [ ] 6.8 Verify `npm run db:migrate:down` rolls back the most recent migration without error
- [ ] 6.9 Verify all expected tables, enum types, and seed data exist after full migration run

## 7. Verification

- [x] 7.1 Run `npm run build` from project root — all three packages compile without TypeScript errors
- [x] 7.2 Run `npm run lint` from project root — ESLint passes across all packages
- [x] 7.3 Run `npm run test` from project root — Vitest runs (zero tests pass on green; no errors)
- [ ] 7.4 Run `docker compose up` and confirm all services reach healthy state
- [ ] 7.5 Run `npm run db:migrate` against Docker Compose Postgres and confirm full schema applied
- [ ] 7.6 Run `npm run dev` from project root and confirm backend `/health/ready` returns 200 and frontend placeholder renders in browser
- [x] 7.7 Confirm `.env` is not tracked by git after copying from `.env.example`
