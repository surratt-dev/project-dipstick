# Business Analyst Review: tasks.md — websocket-connection-reauthorization

**Reviewer:** Marcus Delgado (Business Analyst)
**Reviewing:** `tasks.md` against `proposal.md` and `specs/websocket-connection-reauthorization/spec.md`

## Overall take

Coverage is strong — every ADDED requirement in the spec delta traces to at least one task, and the narrowed diagnostic-trace scope (SEC-26-recovery-only, not the original three-way claim) is actually *tested for the negative case*, not just the positive one, which is the discipline I'd have flagged as missing if it weren't already there. But I found one real, load-bearing gap: a second spec.md requirement — not the one already corrected during design review — still describes behavior the redesigned Decision D4 doesn't produce. I traced it, confirmed it against the current design.md, and corrected it directly rather than just flagging it, since it's the same class of error the Security Analyst's Finding 2 already caught once in this same file and I didn't want to leave a second instance of it sitting unresolved for someone else to trip over.

## Finding 1 (found and corrected, not just flagged): spec.md's "Silent token refresh" requirement still claimed the original connection "remains open" after a successful grace-period recovery

The design-review pass corrected the *diagnostic-trace* requirement (the one Security Finding 2 caught) but missed a second place spec.md asserted the same now-false claim: the "Silent token refresh for active WebSocket connections" requirement's grace-period scenario said *"if the client completes re-authentication within the grace period, the connection remains open."* That's the pre-redesign behavior. Under the rebuilt Decision D4, the original connection is **never** kept open in place — it's unconditionally closed once the grace timer fires (and in practice usually torn down earlier, by the client's own page navigation). A client that successfully re-authenticates gets a *new* connection, not a resumed one.

I corrected the requirement text and the scenario directly (spec.md, "Silent token refresh" section) to state the connection always closes at grace expiry, and added a new scenario describing recovery as a fresh connection registering under the new session — consistent with how the diagnostic-trace requirement already describes it two sections later. spec.md is now internally consistent on this point; it wasn't before this pass.

## Finding 2 (validated, no gap): every ADDED requirement/scenario maps to a task

Traced each of the five requirements and their scenarios:
- **Periodic re-authorization** (4 scenarios: session-scoped close, team-scoped close, EM-promotion, unaffected-connection) → Group 2 (2.1–2.5) covers all four, including the specific EM-promotion case as its own named test.
- **Silent token refresh** (3 scenarios, now corrected per Finding 1) → Groups 3–4 cover refresh-success (3.8), grace-period-close (4.3/4.6), and the absolute-lifetime-untouched case (3.3, 3.8).
- **Revocation/re-auth-signal non-conflation** → Group 4 (4.5, 4.6) — both the negative and positive disclosure-boundary scenarios are present, and Group 8 (8.2) re-confirms them as a hard gate.
- **In-flight state survives both mechanisms** → Group 5 (5.4) covers the structural backend argument; 5.5 correctly scopes the *known gap* (page-reload-based recovery doesn't preserve compose state) as frontend follow-up rather than silently claiming full coverage.
- **Facilitator-visible diagnostic trace** (now 3 scenarios post-correction: fires-for-recovery, doesn't-fire-for-other-causes, grid-uniform-treatment) → Group 5 (5.1–5.3) covers the first two directly. The third (readiness-grid uniform treatment) is UI work outside this change's backend scope — correctly not claimed as covered by a backend task, and correctly left as Open Question 2 for Priya Nair rather than silently dropped. Worth naming explicitly rather than leaving implicit: no task in this document implements or tests that scenario, and none should — but tasks.md itself never states "this scenario is spec'd but intentionally not this change's job," it only shows up as an open question two sections later in a way that requires cross-referencing to connect back to the specific spec.md scenario it resolves. A one-line note at task 5.6 naming the scenario by its spec.md title would close that traceability gap without changing scope.

No scenario found without a traceable task.

## Finding 2a (minor, should fix): task 2.5's test list doesn't name the admin-path-rejection case its own implementing task already requires

Task 2.2 implements admin-path rejection for the team-scoped sweep ("additionally reject `path === \"admin\"`"), matching spec.md's team-scoped scenario, which explicitly names this case ("a grant whose path is `admin` is rejected, exactly as at delivery time"). Task 2.5's test enumeration — `removed_at`, team-scoped removal, EM-promotion, healthy-connection — never calls out testing the admin-grant-rejection path specifically, even though it's a distinct scenario from an ordinary team-scoped `removed_at` revocation (an `application_admin` can have `evaluateTeamAccess` return a non-null `admin`-path grant while never having had `team_memberships.removed_at` set at all). Recommend adding it to 2.5's list explicitly, the same way the delivery-time equivalent of this case already has its own named regression test in the archived change.

## Finding 3 (validated, no gap): the narrowed diagnostic-trace scope is tested for absence, not just presence

This was my specific concern going in, given the scope-narrowing correction spec.md just went through: task 5.3 explicitly requires confirming the `session.connection_recovered` event does **not** fire for a SEC-25 non-revocation sweep pass and does **not** fire for an ordinary network drop — not just that it fires when it should. Given the whole point of the correction was "this event's presence discloses something spec.md previously claimed it wouldn't," a positive-only test would have been a real gap; it isn't one here.

## Finding 4 (should fix): the frontend follow-up items are documented in the task list, but nowhere more durable than that

Tasks 5.5 (in-flight vote state doesn't survive a page-reload recovery) and 5.6 (the two Priya Nair UX open questions) both say "document in this change's PR description." That's fine as a mechanism for *this* PR, but a PR description isn't discoverable once the PR merges and the branch is gone — and both of these are real, unresolved product gaps, not just internal implementation notes. The archived change handled its own equivalent UX gate (the staleness-signal client work) by naming it as a standing gate in a persistent file (`staleness-signal.ts`'s own header comment, plus the champion sign-off process this workflow already uses at Archive stage). Recommend the same here: at minimum, confirm these three items (5.5's compose-state gap, and Open Questions 1–2) are captured somewhere that survives this PR closing — a linked GitHub issue, or explicit carry-forward into this capability's spec.md as a stated, tracked gap — not just prose in a PR description that becomes unsearchable in a few months.

## Finding 5 (validated, no scope creep): task 8.6 is correctly scoped as "file the issue," not "fix the issue"

"File a tracking issue for the pre-existing HTTP-side audit-log gap... named but explicitly out of scope in design.md's Non-Goals — same pattern as this effort's own parent issue." This mirrors exactly how this effort itself originated (a scoped-out gap from the archived change, filed rather than absorbed) and doesn't ask this change to also fix the pre-existing gap. Correctly scoped.

## Summary

One real defect found and fixed directly (spec.md's stale "connection remains open" claim). One process gap worth closing before this ships (Finding 4 — frontend follow-ups need a home more durable than a PR description). Everything else — requirement-to-task traceability, the narrowed-scope negative testing, and task 8.6's scope discipline — checks out.
