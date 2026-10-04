# Tasks review: Solution Architect (Ingrid Sollenberger)

Scope: dependency ordering, TDD red/green integrity, and what can be verified in the current environment. The section order is right at the macro level: signature verification (S) comes first, then the resolver (1), the audit seam (2), real-Postgres (3), pins (4), local dev (5), docs (6) and gates (7). Section 3 correctly comes after the module it imports (2.2). The problems are inside sections, where a green step either does more than its name says or comes before its red step.

## Blocking: ordering and TDD violations

**A1. Task 1.2 is not "no behaviour change".** Building `PERMITTED_GLOBAL_ROLES` from the five-element `ROLE_PRECEDENCE` lets `facilitator` and `senior_engineer` through immediately (today `String(raw)` is checked against that set). Two consequences:
- 1.3's stated red ("fails on the two new allowlisted values") will already be green.
- Any existing test that expects `facilitator` to map to `engineer` breaks in 1.2, not in a red task.

Fix: put 1.3 before 1.2, so one red covers both the export and the values. Or have 1.2 export `ROLE_PRECEDENCE` while the filter keeps its three-role set until 1.5. Either way, 1.2 has to stop claiming "existing tests still pass" until the old `facilitator → engineer` test is identified and rewritten in a red task.

**A2. Task 2.2 changes the INSERT gate before 2.3 writes the failing test.** 2.2 is described as a move "unchanged except gated by the predicate". That gate is the behaviour change, so 2.3(a)/(b) INSERT assertions pass on first run. Worse, between 2.2 and 2.4 the row uses the new predicate while `emitAuditEvent` still uses the old condition. That is exactly the row/log drift D5 exists to prevent. Split it this way:
- 2.2a: a pure extract-move that keeps the old condition, needs no new tests, and leaves all of `auth.test.ts` green.
- 2.3: the red step.
- 2.4: switch **both** sites to `shouldRecordRoleClaimMapped` in one step.

The 2.1 → 2.2 unit-level red/green on the predicate itself is fine.

**A3. Task 3.5's red is red for the wrong reason.** "Check out `main`" fails at import, because `account-resolution-audit.ts` doesn't exist there. That proves nothing about persistence. Once A2's split is in place, run 3.1–3.4 against the 2.2a commit instead: the pure move is present, and the allowlist and gate are pre-change. Then the failures are the real assertions. Relabel 3.1–3.4 as "red (retroactive)" rather than "pin". A pin that is expected to fail on old code isn't a pin.

**A4. Task 1.4 refers ahead to 1.6 and 1.8.** "For every rejected input in 1.3 and 1.6" can't be written before 1.6 exists. Move the array raw-value check into 1.6. The 1.8 order note is already restated in 1.8, so delete it from 1.4. Otherwise 1.5's claim that "1.4 passes" is ambiguous.

## Should fix

- **B1. De-risk task S.3 early.** Task 5.6 is the only end-to-end proof that the local `oidc-provider` key (A6, a derived `kid`) verifies. If it fails, every local sign-in breaks, and that wouldn't surface until section 5. Add a sub-step to S.3: one local sign-in smoke test, or a note that 5.6 must run before section 1 is merged.
- **B2. Task 5.1 is outside the root test gate.** `docker/oidc` has its own `package.json`/vitest and isn't in the root `workspaces` (`packages/*`). No workflow references it either. So `npm run test` (7.2) never runs 5.1. Add to 7.2: `npm --prefix docker/oidc ci && npm --prefix docker/oidc test`.
- **B3. Tasks 5.5 and 1.10 have no label.** 5.5 is a frontend fixture change that should pass on first run: label it **(pin)**. 1.10 (comments only) is fine unlabelled, but 6.5's grep depends on it, so keep 6.5 last.
- **B4. Task S.5 already passes before S.3** (it mocks `handleCallback`). That's correct for a pin, but say so explicitly, so nobody reads a green S.5 as evidence that S.3 works.
- **B5. Task S.4 must stay after S.3.** It does today: no JWKS fetch happens until verification is enabled. Keep that ordering if anyone reshuffles.

## Verifiability in this environment

There is no `node_modules` anywhere (root, `packages/*`, `docker/oidc`). The Docker daemon is unreachable, Postgres and Redis aren't running, and the `openspec` CLI isn't installed.

| Tasks | Blocker | Can be done now? |
|---|---|---|
| 0.1, 7.4 | `openspec` CLI | No. Record UNMET, as the tasks already say |
| S.1–S.5, D9 A1–A7 | `openid-client`/`oauth4webapi` source plus vitest | Write only; A1–A7 can't be confirmed |
| 1.1–1.9, 2.1–2.5, 4.1–4.4, 5.3–5.5 | vitest (and `@dipstick/shared` for `satisfies`) | Write only; no red/green evidence |
| 3.1–3.5 | Postgres + Redis (`probeInfra`) | No; they would silently skip without `REQUIRE_DB=1` |
| 5.1 | `docker/oidc` deps | Write only |
| 5.6 | Docker daemon, compose stack | No |
| 7.1–7.3 | eslint, tsc, vitest | No |
| 1.10, 6.1–6.4, 6.5 grep, 7.5–7.7 | none | Yes |

Recommendation: with no `node_modules`, no task marked red or green can honestly be ticked, because a "fails for the stated reason" step that never ran is an unverified claim. The implementer should write the code and leave every red/green/pin task unticked. Tick only the documentation tasks and the inspection-only tasks (7.5, 7.6), and record in the PR that the TDD evidence is outstanding.
