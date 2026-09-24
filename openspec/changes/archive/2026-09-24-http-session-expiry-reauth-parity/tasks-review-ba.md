# Tasks Review — Business Analyst (Marcus Delgado)

Reviewed: `tasks.md` against `proposal.md`, cross-checked against `design.md` and both `specs/*/spec.md` deltas, as of the current revision (post design-stage restructure of section 3, post return-type fix on 1.1).

## Overall

Traceability holds. Every call site proposal.md commits to has a task, its own acceptance condition, and its own test coverage. The two propose-stage revisions I flagged in `propose-review-ba.md` (query-string tolerance as a real test case, CTA-distinguishability-beyond-color as a stated criterion) survived the section-3 restructure intact. No regression from the two design-stage fixes (helper return type, single structural gate) either — both are threaded consistently through every downstream task that depends on them, not just stated once at the top and forgotten.

## Call-site coverage check

| Call site (proposal.md) | Wiring task | Own acceptance condition | Test task |
|---|---|---|---|
| SessionLobbyPage `action-items-review` GET | 3.1 | Yes — role via `canFacilitateSessions` proxy, no new `branch.kind` | 3.6 (both proxy branches) |
| SessionLobbyPage `start` POST | 3.2 | Yes — `role="facilitator"`, body-derived message on non-401 | 3.6 |
| SessionLobbyPage `begin-voting` POST | 3.3 | Yes | 3.6 |
| SessionLobbyPage `useConnectionHealth` state | 3.4 | Yes | 3.7 |
| DraftSessionHost `facilitator-state` GET | 4.1 | Yes | 4.4 |
| DraftSessionHost `advance` POST | 4.2 | Yes — names `provider_unavailable` explicitly | 4.5 |
| SessionCreationPage `eligible-for-session` GET | 5.1 | Yes | 5.4 |
| SessionCreationPage `sessions/draft` POST | 5.2 | Yes — doesn't disturb 409/403 branches | 5.4 |
| MemberManagement `submitRoleChange` PATCH | 6.1 | Yes — both submission legs, `.catch` guard fix named | 6.3 |

All nine in-scope call sites from proposal.md's "What Changes" and Capabilities section are present. 3.6 and 5.4 are each a single test task covering multiple call sites rather than one task per site, but both enumerate every call site's expected behavior individually within that task, so I'm not treating this as a gap — it mirrors how 6.3 and 4.4/4.5 are written elsewhere and doesn't drop any site's coverage.

The idempotency gate itself (design.md Decision 2's restructuring driver) gets its own structural test (3.5) and its own race test (3.8), separate from the four signal-source tests — that's the right shape given BA Finding 2 was specifically about a signal not having a clear home.

## Two survival checks (explicitly requested)

- **`/sessions/new?foo=bar` query-string tolerance** — present, task 2.3: "`/sessions/new?foo=bar` is accepted (exercises design.md Decision 3's query-string-tolerance clause as an actual accepted-case test, not just prose)." Survived the restructure verbatim, including the callback to why it's there.
- **CTA distinguishable from confirm dialog by more than color** — present, task 4.7: explicit acceptance criterion "the distinction must hold on more than color alone (e.g., label text, position, or shape)... a color-only difference is not sufficient." Survived.

## Deferred-scope follow-up

Task 7.1 covers all three pieces named in proposal.md's scope decision — `MemberManagement.tsx`'s `loadMembers` GET, the three EM pages, and the `teams.ts` category-label fix — bundled as one filed issue, linked from the PR. Matches proposal.md's reasoning for bundling them (same "no ritual action, no mutation" class, per proposal.md's EM-pages paragraph) rather than splitting into three separate follow-ups. No task lost here.

## Design-stage fixes, checked for downstream consistency (not just stated once)

- **Helper return type** (`{ isSessionExpired, body }`, design.md Decision 1): task 1.1 states the contract; every wiring task that needs a non-401 error message (3.2, 3.3, 4.1, 4.2, 6.1) explicitly derives it "from the helper's returned `body`" rather than re-reading `res.json()`. Consistent everywhere it needed to be, including 6.1's incidental fix to `submitRoleChange`'s previously-unguarded second read.
- **Single structural gate on SessionLobbyPage** (design.md Decision 2): task 3.0 states the gate exactly as designed (shared `reauthRequired` state, `prev ?? {...}` guard, one top-level early return ahead of the existing `branch`/`startError`/`beginVotingError` tree). Tasks 3.1–3.4 all route through it explicitly ("via 3.0's gate") rather than rendering `ReauthRequiredTreatment` independently — this is the exact failure mode Decision 2 was written to prevent, and 3.5 tests for it structurally.

## One gap worth naming (non-blocking)

`specs/http-session-expiry-signal/spec.md`'s "guarantees the action did not execute server-side" requirement carries two scenarios: the `advance` POST didn't advance session state, and the `submitRoleChange` PATCH didn't apply the role change, both checkable by re-fetching state after a simulated 401. Neither is named as its own task. Task 8.1 ("manual or integration-test confirmation... that the fix resolves the actual observed... behavior against a real expired session") could satisfy this, but it's written as a general end-to-end smoke check for "at least one call site," not as coverage for these two specific guarantee scenarios design.md Decision 4 and Decision 7 both call load-bearing (the "cannot be undone" copy on `DraftSessionHost.tsx`'s confirm step depends on it literally being true).

This is defensible as out-of-scope test work — the guarantee comes from `authMiddleware`'s `onRequest` ordering, which is backend behavior this change doesn't modify (proposal.md's Impact section: "already shipped and unmodified") — but since `spec.md` states it as a formal scenario of the capability being added, not just background context, I'd want either 8.1 reworded to name these two scenarios explicitly, or a one-line acknowledgment in tasks.md that they're intentionally left to the backend's own existing test coverage rather than re-verified here. Flagging so it's a decision, not a silent gap.

## Conclusion

No blocking findings. Tasks.md, as it now stands, covers every capability proposal.md commits to, with per-call-site acceptance conditions and test tasks intact through both rounds of revision. One non-blocking note above on the no-partial-execution guarantee's test coverage.
