# Implementation Review — Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `http-session-expiry-reauth-parity`
**Scope of this review:** architectural conformance to design.md — boundaries, the shared-helper contract, the single-gate structural home, the no-partial-execution guarantee, and the `returnTo` allow-list additions. I did not review UX copy, test naming style, or anything tasks.md already marks as a BA/human concern.

## Verdict

**Approved.** The implementation matches design.md's architectural decisions precisely, including the parts of Decisions 1, 2, and 4 that were written the way they were specifically to prevent the drift they warn about. I read the actual diffs, not the task checklist, and did not find a place where the code took a cheaper path than the one the design named.

## What I verified, decision by decision

**Decision 1 (shared helper contract) — `packages/frontend/src/http/sessionExpiry.ts`.** `detectSessionExpiry` owns the single `.json()` read, guards it with try/catch resolving `body: null` rather than throwing, checks `res.status === 401 AND` parsed `category === "session_expired"`, and returns `{ isSessionExpired, body }` — the parsed body alongside the boolean, exactly as specified, not a bare boolean. This is the detail most likely to get silently dropped by an implementer optimizing for the common case, and it wasn't. Confirmed the `provider_unavailable` non-session-expiry-401 case is exercised in the helper's own unit tests, and that call sites use the returned `body` for their generic-error fallback rather than re-reading the response.

**Decision 1a (role determination per call site).** Checked every call site against its stated rule:
- `SessionLobbyPage.tsx` `start`/`begin-voting` — `role="facilitator"` unconditionally. Correct.
- `SessionLobbyPage.tsx` `action-items-review` (`fetchReview`) and the WS-driven signal — both use `session?.canFacilitateSessions ? "facilitator" : "participant"` via the shared `reauthRoleProxy` helper (`SessionLobbyPage.tsx:66-71`), the same proxy reused in both places as design.md requires (not two independent guesses at the same rule).
- `DraftSessionHost.tsx`, `SessionCreationPage.tsx` — `role="facilitator"` unconditionally, both pages gated pre-render on `canFacilitateSessions`. Correct.
- `MemberManagement.tsx` `submitRoleChange` — `role="facilitator"`, with a comment at the state declaration correctly framing this as suppressing the vote-loss sentence, not a facilitator claim. This is the one call site where a careless implementer could have miscopied the "gated on `canFacilitateSessions`" reasoning from the other facilitator-only pages even though this page has no such gate; the code doesn't make that mistake and the comment shows it was deliberate.

**Decision 2 (single gate, structural home) — `SessionLobbyPage.tsx`.** This is the decision I was most concerned would drift, since it's the one with an explicit "here is exactly how to structure this, not left to implementation" instruction. Verified directly:
- One piece of state: `const [reauthRequired, setReauthRequired] = useState<{ role; returnTo } | null>(null)` (line ~96) — not four.
- All four signal sources write into it via `setReauthRequired((prev) => prev ?? {...})`: the `action-items-review` 401 branch (line 111), the `start` POST 401 branch (line ~207), the `begin-voting` POST 401 branch (line ~239), and the WS `state === "reauth-required"` effect (line ~254). Grepped for `setReauthRequired(` — exactly these four call sites, all using the `prev ?? ...` guard, none overwriting unconditionally.
- One top-level early return, before the `branch`/`startError`/`beginVotingError` JSX tree (line ~262): `if (reauthRequired) return <ReauthRequiredTreatment .../>`.
- The existing four render locations (`branch.kind`, `startError`, `beginVotingError`, and the previously-nonexistent WS check) are otherwise untouched and still exist for the non-expiry case, exactly as the design specifies — this isn't a case of the gate being added *alongside* four independent render paths that still also fire.
- The idempotency race is tested end-to-end, not just asserted structurally: `SessionLobbyPage.test.tsx`'s "3.5/3.8: idempotency" block actually fires the WS close event and a session-expired fetch response in both orderings and asserts exactly one `alert`-role element renders each time. This is the test I'd have pushed back on if it had only checked "the gate exists" without simulating the actual race design.md Decision 2 spent several paragraphs justifying.

**Decision 3 (`returnTo` allow-list) — `packages/backend/src/routes/auth.ts`.** Both new entries match the design's exact regex shapes: the combined `/team/:teamId/session/:sessionId` (both segments UUID-pinned, optional query) and the literal `/sessions/new` (with the design's own comment about this being the first non-UUID-anchored shape in the list, carried into the code as a comment rather than only living in design.md). Two additions, no broader wildcard, no parameterized-optionality pattern — the alternative design.md explicitly rejected. `rejectReturnToCharacters` is untouched. Regression tests for the two pre-existing entries pass alongside new accept/reject cases for both additions, including the near-miss rejections (`/sessions/new/anything`, `/sessions/newer`) that specifically guard against the literal-path shape being interpreted as a prefix match.

**Decision 4 / 7 (no-partial-execution).** Confirmed `middleware.ts` and `app.ts` have zero diff against main — the guarantee's full dependency surface (hook logic *and* registration order) is exactly as unmodified as the design assumes, not just "probably fine because I didn't touch the obvious file." `DraftSessionHost.tsx`'s `advance` and `MemberManagement.tsx`'s `submitRoleChange` are each backed by an integration test (`http-session-expiry-no-partial-execution.test.ts`, tasks 8.1/8.2) that actually re-fetches state after a simulated expired-session 401 and confirms no server-side effect occurred, not just a response-shape assertion.

**Boundaries and pattern consistency.** `ReauthRequiredTreatment` (from `session-timeout-continuity`) is consumed, not modified or duplicated — every call site imports the existing component. No new backend route, no new authorization branch anywhere in the diff; `authMiddleware` is read from, never altered. The `returnTo` round-trip stays exactly where it already lived. This change adds one new frontend module (`http/sessionExpiry.ts`) and extends an existing constant (`RETURN_TO_ALLOW_LIST`) — it does not introduce a new architectural seam, which is appropriate for a change of this shape.

## Items noted, not blocking

- **Task 4.6 (visual mock review)** is correctly left unchecked and correctly not self-graded by the implementing agent — the task's own text states a human sign-off is required and that an implementing agent cannot self-grant it. I confirmed the underlying structural claim the implementation note makes (the treatment replaces the entire page via a top-level early return, not an overlay on the confirm dialog) is true by reading `DraftSessionHost.tsx` directly — the `reauthRequired` check is a full early return before `loadState`/`advanceState` render, same pattern as `SessionLobbyPage.tsx`. This lowers the risk of what's being deferred (there's no overlapping-DOM collision to worry about, only a "does the CTA read as unmistakable" question), but it's still a human call and I'm not making it for them.
- **Deferred-scope issue #159** is filed and matches the scope proposal.md described (`MemberManagement.tsx`'s `loadMembers` GET, the three EM pages, the `teams.ts` category-label fix) — confirmed via `gh issue view 159`, open, correct title and body.
- **`SessionCreationPage.tsx`'s `confirmCreate`** checks `res.status === 401` as an `if` block that falls through to the existing `409`/`403`/generic branches rather than an early `return` on non-expiry — this is a slightly different shape than `SessionLobbyPage.tsx`'s equivalent branches, but it's correct: the generic fallback at the bottom of that function was already a static string with no body read, so there's no double-read risk, and the fall-through is explicitly commented. Not a deviation worth blocking on, just noting it's a different (still correct) shape than its siblings for anyone doing a future pass over this code.

## Test evidence

Ran both suites directly rather than trusting tasks.md's checkmarks:
- Backend: `npm test --workspace=packages/backend` — 46 files, 682 tests, all passing, including the new allow-list and no-partial-execution tests.
- Frontend: `npm test --workspace=packages/frontend` — 33 files, 329 tests, all passing, including the new `sessionExpiry.test.ts`, the `SessionLobbyPage.tsx` idempotency race tests, and the `DraftSessionHost.tsx`/`SessionCreationPage.tsx`/`MemberManagement.tsx` new coverage.

No regressions in either suite. No skipped or `.todo` tests found in the modified files.
