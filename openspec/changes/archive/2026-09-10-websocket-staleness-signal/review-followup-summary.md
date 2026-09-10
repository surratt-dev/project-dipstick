# Review Follow-Up — `websocket-staleness-signal`

Addresses items 1 and 2 from `implementation-review-architect.md`'s "Required before this is considered production-ready" list. Items 3-5 (suggested, non-blocking) are out of scope for this pass.

## Item 1 — CI type-check gap

**Problem:** the CI job named "Type Check" (`.github/workflows/ci.yml`) ran `npm run build`, which for `packages/frontend` is `vite build` — esbuild-based, and esbuild strips types rather than checking them. The exhaustiveness guard (`assertExhaustiveConnectionHealthState`, task 1.2/D1) had no CI enforcement, only a runtime proxy test.

**Fix:**
- Added `packages/frontend/tsconfig.typecheck.json`, extending the existing `tsconfig.json` and excluding `src/**/__tests__/**`, `src/**/*.test.ts(x)`, and `src/test-setup.ts`.
- Added a `typecheck` script to `packages/frontend/package.json`: `tsc --noEmit -p tsconfig.typecheck.json`.
- Added a new step to the `typecheck` job in `.github/workflows/ci.yml`: `npm run typecheck --workspace=packages/frontend`, run after the existing `npm run build` step (kept, since it still validates the production bundle), with a comment explaining why it's needed and pointing at this review item.

**Verification performed:**
- `npx tsc --noEmit -p packages/frontend/tsconfig.json` (no exclusions) confirmed all pre-existing failures are `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`-class errors confined entirely to files under `__tests__` directories — matches the architect's finding exactly, nothing new.
- `npm run typecheck --workspace=packages/frontend` (the new step, as CI will invoke it) passes cleanly.
- Introduced a deliberate type error in `connectionHealth.ts` (a production file) and re-ran the new command — it failed with `TS2322` as expected, confirming the step actually catches production regressions. Reverted immediately; `git diff` on that file is empty.
- Ran `npm run test` (shared + backend + frontend): backend 449 passed / 1 skipped (pre-existing Redis/Postgres-dependent skip), frontend 171 passed — identical to the review's baseline numbers, nothing broken.
- Ran `npm run lint`: clean.

**Backend/shared were not touched** — `packages/backend`'s `build` script already runs `tsc -p tsconfig.build.json`, so its type-checking coverage was already real; only the frontend workspace had the gap.

## Item 2 — facilitator route role gate

**Investigation:** checked whether the frontend's auth state carries any usable "is this user the facilitator of this session" concept before deciding between the two options the review offered.

- `AuthSession` (`packages/shared/src/types/auth.ts`) carries only global user identity and `teamMemberships: Array<{ teamId, teamName, role: MembershipRole }>`, where `MembershipRole` is `"participant" | "engineering_manager"` — no facilitator value at that level.
- The backend's real authorization check, `evaluateSessionSubscriberAccess` (`packages/backend/src/auth/session-subscriber-access-helper.ts`, used at `websocket-routes.ts:83`), determines facilitator status from `sessions.facilitator_id === userId` — per-session backend state, queried live on every WS subscription attempt (explicitly not cacheable, per its own "Cache prohibition" comment). This is never fetched into any frontend state today.
- Checked the one other precedent for role-gated routing in this codebase — the EM routes in `App.tsx` (`/team/:teamId/em*`). They follow the same pattern already: `ProtectedRoute` (session-presence only) plus a code comment stating the backend enforces the real dual-role check, with unauthorized users seeing a 403 error state rendered from real API data. No route in this app currently does a client-side role gate ahead of a server round-trip.

**Conclusion:** no usable client-side facilitator concept exists today, and inventing one (e.g., a new endpoint to expose `sessions.facilitator_id` to the client) would be new backend API surface and its own design decision — explicitly out of scope per the task instructions.

**Fix taken: Option 2 (documented, deferred gap)** — added prominent code comments, not a client-side check:
- `packages/frontend/src/App.tsx`: an expanded comment directly on the `/session/:sessionId/facilitator` route explaining the gap, why it's harmless today (stub fixture only), what already enforces access server-side (`evaluateSessionSubscriberAccess`), and what must be added before real per-participant data is wired in. Cites `implementation-review-architect.md` item 2 by name.
- `packages/frontend/src/pages/FacilitatorConnectionHost.tsx`: a shorter comment on the component itself pointing back at the route comment, so the gap is visible from either file.

**Why not Option 1:** there is nothing to gate on client-side without adding new backend surface, which the task explicitly ruled out for this pass.

## Verification

- `npm run typecheck --workspace=packages/frontend` — passes.
- `npm run test` — shared/backend/frontend all pass (449 backend + 171 frontend, 1 pre-existing skip), no regressions.
- `npm run lint` — clean.
- `git diff` / `git status` shows exactly: `.github/workflows/ci.yml` (new typecheck step), `packages/frontend/package.json` (new `typecheck` script), `packages/frontend/tsconfig.typecheck.json` (new file), `packages/frontend/src/App.tsx` and `packages/frontend/src/pages/FacilitatorConnectionHost.tsx` (comments only, no behavioral change), and this summary file.
