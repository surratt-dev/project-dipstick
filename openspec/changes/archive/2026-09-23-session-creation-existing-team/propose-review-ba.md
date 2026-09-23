# BA Review — Proposal: Session Creation for Existing Team

**Reviewer:** Marcus Delgado (Senior Business Analyst)
**Reviewing:** `proposal.md`, and the spec deltas in `specs/session-creation/`, `specs/session-participation/`, `specs/first-access/`, `specs/project-structure/`
**Cross-checked against:** `requirements/use cases/02 - Session Setup - Use Cases.md`, `openspec/specs/session-participation/spec.md`, `openspec/specs/role-assignment/spec.md`, `openspec/specs/first-access/spec.md`, and (for the one finding that required it) the actual `session_status` enum in `packages/backend/migrations/1_create_enums.sql`

---

## Overall verdict

This proposal is well ahead of where most proposals land after exploration — the spec deltas are written as Given/When/Then scenarios with explicit status codes, field names, and error-message rules, which is exactly the standard I hold this team to. Most of what I'd normally flag as "too soft to build from" has already been tightened.

I found two things that will actively cause build/test failures if implemented literally as written, and one internal contradiction in the eligible-teams requirement that needs a decision before anyone writes the query. I also found a real, if narrower, gap in what the proposal asks me to fix in the source use case document — it names two corrections, but there's a third. None of these are large; all of them are the kind of thing I'd rather catch now than have an engineer discover mid-build and either guess at or ping me about.

The four resolved-decision checks the team lead asked me to verify (draft-status landing with "Open the room," zero-team-membership facilitators in scope, DB-level partial unique index for concurrency, `canFacilitateSessions` replacing `AuthSession.globalRole`) all check out — see §4. No silent drift there.

---

## 1. Blocking: `completed` vs. `complete` — the spec names a session status that doesn't exist

`specs/session-creation/spec.md`, the "Concurrent active session block per team" requirement, scenario "Session creation permitted after the prior session reaches a terminal state":

> **WHEN** a team's only session has status `completed` or `abandoned` (a terminal status)

I checked the actual `session_status` enum (`packages/backend/migrations/1_create_enums.sql`): the terminal value is `'complete'`, not `'completed'`. `abandoned` is correct. Every reference to this status elsewhere in the backend (`facilitator-sessions.ts`) uses `'complete'` consistently — `SET status = 'complete'`, `WHERE ... status = 'complete'`, etc. There is no `'completed'` value anywhere in the schema.

This isn't a nitpick — it's the kind of thing that would either (a) get built literally, producing a test assertion or query against a status value that will never match anything, silently passing for the wrong reason or silently failing, or (b) get "corrected" ad hoc by whichever engineer notices, which is exactly the "come back and ask me what I meant" outcome I'm trying to eliminate.

**Same typo also appears in `tasks.md` §4.4**: "creating a session for a team whose only prior session is `completed` (or `abandoned`) → permitted." Both need the correction.

**Fix:** replace `completed` with `complete` in both places. `design.md`'s migration SQL is fine — it only lists the non-terminal statuses in its `WHERE IN (...)`, so it never names the terminal value and isn't affected.

---

## 2. Blocking: the eligible-teams requirement contradicts its own empty-state scenario

`specs/session-creation/spec.md`, "Eligible-teams listing for session creation," defines eligibility with exactly two conditions:

> A team is eligible when the caller has no active (`removed_at IS NULL`) `team_memberships` row for it and the team's `deactivated_at` is `NULL`.

`design.md`'s D2 gives the literal query for this: `teams LEFT JOIN team_memberships ... WHERE membership IS NULL AND deactivated_at IS NULL` — no reference to `sessions` at all. `tasks.md` §3.2 implements the same two-condition query.

But the spec's own scenario "Facilitator with a home team and zero eligible targets" says:

> **WHEN** a facilitator has an active team membership, and every other non-deactivated team already has a non-terminal session (see the concurrent-session requirement below) **or** the facilitator is also a member of every other team
> **THEN** the response is `200`, `eligibleTeams` is an empty array

That scenario asserts a **third** condition — a team with an existing non-terminal session is excluded from the list — that appears nowhere in the requirement's own eligibility definition, the design's SQL, or the task's implementation query. If an engineer builds the two-condition query exactly as specified in the requirement text and in D2, this specific scenario becomes untestable as written: a team with a live `lobby` session but no membership row for the caller *would* still appear in `eligibleTeams`, and the "zero eligible targets" empty state would never trigger for the reason the scenario names.

This also traces back to the exploration notes (§6.2's own empty-state copy: *"Facilitator with a home team but zero eligible targets (every other team already has a live session, or no other teams exist yet)"*), so the intent behind the scenario is real — it just never made it into the actual eligibility definition or query.

**This needs an explicit decision, not an inference:**
- **Option A (filter it out):** Add a third condition — no non-terminal session exists for the team — to the eligibility query (a join or subquery against `sessions` filtered to `draft, lobby, pre_session, active, wrap_up`). Update the requirement text, D2's SQL, and task 3.2 to state it, and add a dedicated scenario ("Team with an existing non-terminal session is excluded from eligible-teams") alongside the existing ones.
- **Option B (don't filter it; rely on the 409 at submission):** The list stays two-condition. A team with a live session still appears; selecting it and submitting hits the already-specified 409 concurrent-session rejection (which the confirm screen already handles per the "Race-condition rejection is shown inline" scenario). In this case, the "zero eligible targets" scenario needs to be reworded to drop the non-terminal-session clause — it would only ever be empty because "the facilitator is also a member of every other team."

Either is defensible and consistent with the rest of the proposal's philosophy (Option B is actually more consistent with the "always re-validate at submission, never trust the list" posture the rest of this document insists on — see the membership race-condition scenario in the same spec file). But right now the document asserts both at once, and whichever way it's resolved, `design.md`'s Open Questions section should record it — it currently lists three open items and this isn't one of them, which means it would otherwise get decided by accident by whoever writes the query first.

---

## 3. The use case document needs a third correction, not two

The proposal's Impact section says:

> `requirements/use cases/02 - Session Setup - Use Cases.md` needs two corrections... the "at least one team membership" precondition should read as assumed-but-currently-unenforced, and the main flow's steps 5–8 need an addendum describing the draft-landing step and the "Open the room" action.

I checked the use case's own **Acceptance Criteria** checklist (not just the Preconditions and Main Flow prose), and two of its five bullets are also contradicted by the draft-landing decision, not just the narrative steps:

- "Selecting a team and confirming creates a session record with status **'waiting for participants.'**" — under this proposal, the session is created with status `draft`, which is explicitly *not* joinable and not "waiting for participants" in the sense the use case means (no participant can join until "Open the room" is activated).
- "The Facilitator sees the session room (**participant readiness view**) after creation." — under this proposal, the facilitator sees their own draft control view, not the participant readiness view; the readiness view only appears after the room is opened.

Both of these are permanent, intentional divergences from the use case as written (the proposal is explicit and correct that this is a deliberate reversal, and I agree with the ADR-007 reasoning). But if only the Preconditions and Main Flow sections get corrected and the Acceptance Criteria checklist is left as-is, the use case document will permanently contain two checklist items that no shipped build will ever satisfy — which is exactly the kind of drift between requirements and reality that undermines the "requirements are the first place the team looks" goal.

**Ask:** add the Acceptance Criteria checklist (specifically the two bullets above) to the list of things I need to correct in `02 - Session Setup - Use Cases.md`, alongside the precondition and main-flow addendum already scoped. I'll own the actual edit per the existing dependency in `tasks.md` §0.1 — this just needs to be named so it doesn't get missed.

---

## 4. Resolved-decision drift check — all four confirmed, no silent drift

I checked each of the four items the team lead flagged as resolved during exploration against what the proposal and its spec deltas actually say:

- **Draft-status landing with an explicit "Open the room" action.** Correctly carried forward. `specs/session-creation/spec.md`'s "Draft-status landing after session creation" requirement matches `design.md`'s D6 exactly — lands in `draft`, not auto-advanced, explicit action, in-place update on success, inline retryable error on failure, no side effects on the draft row from a failed advance. The proposal is also transparent (not silent) about this being a deliberate reversal of the use case's literal wording, with the ADR-007 rationale stated plainly. Good — this is exactly how a reversal of documented behavior should be surfaced, not buried.
- **Zero-team-membership facilitators in scope.** Correctly carried forward. `specs/first-access/spec.md`'s carve-out, the `session-creation` capability's "gated on facilitator eligibility... regardless of whether the user has any team memberships" language, and the corresponding scenarios all agree with each other and with the exploration conclusion that this is a real, currently-reachable state (not a hypothetical). No drift.
- **Concurrent-session policy as a DB-level partial unique index.** Correctly carried forward. Requirement text, `design.md` D3, and `tasks.md` §1 and §4 all specify the same mechanism (`sessions_team_active_unique`, matched by constraint name on `23505`, not a check-then-insert), including the pre-check migration safeguard. No drift. (The only issue here is the `completed`/`complete` typo in §1 above, which is independent of the mechanism itself.)
- **`canFacilitateSessions` replacing the rejected `AuthSession.globalRole` approach.** Correctly carried forward, and the proposal does the right thing by naming the rejected approach explicitly rather than silently swapping it in: "**This is not the raw `globalRole` field the exploration notes proposed**." `design.md` D4 gives the correct reasoning (the `role-assignment` `canAssignRoles` precedent), and `specs/project-structure/spec.md` states the same constraint the `role-assignment` spec already establishes (raw `global_role` must never land on `AuthSession`). I checked the current `AuthSession` type (`packages/shared/src/types/auth.ts`) — it does not carry `globalRole` today, so there's no existing violation this proposal needs to also clean up. No drift.

---

## 5. Smaller vagueness worth tightening

- **Proposal bullet on the eligible-teams endpoint says `GET /api/v1/teams/eligible-for-session` "(or equivalent)."** The spec delta commits to this exact path with no hedge. The proposal should match — drop "(or equivalent)" so there's one stated contract, not a summary that reads as more negotiable than the thing it summarizes.
- **The `session-participation` REMOVED-requirement migration note slightly overstates equivalence.** It says: *"No behavior described by the original stub is dropped — it is superseded by a more complete version."* That's not quite accurate: the original stub said any row in `team_memberships` (with no `removed_at` qualifier) permanently disqualified a user from facilitating that team. The new capability narrows this to an *active* row (`removed_at IS NULL`), explicitly making a previously-removed member eligible again (see the "Previously removed member is eligible to facilitate" scenario). That's a good decision — it matches how membership is checked everywhere else in the codebase, and nothing in the requirements ever asked for permanent disqualification — but it is a substantive interpretive decision, not a pure elaboration of the same rule. I'd rather this migration note say so directly ("this also resolves an ambiguity in the original stub, which did not distinguish active from historical membership, in favor of active-only") than describe it as strictly non-dropping, since a future reader diffing the two versions could reasonably conclude I'm wrong about that if they read the old text literally.

---

## Summary of clarifications needed (in priority order)

1. **Blocking:** Fix `completed` → `complete` in `specs/session-creation/spec.md` (concurrent-session-block scenario) and `tasks.md` §4.4 (§1 above).
2. **Blocking:** Decide whether the eligible-teams query excludes teams with an existing non-terminal session, and make the requirement text, `design.md` D2, `tasks.md` §3.2, and the "zero eligible targets" scenario all agree with whichever answer is chosen (§2 above).
3. Add the use case's Acceptance Criteria checklist (the "waiting for participants" and "participant readiness view" bullets) to the set of corrections I need to make, alongside the precondition and main-flow addendum already scoped in `tasks.md` §0.1 (§3 above).
4. Drop "(or equivalent)" from the proposal's eligible-teams endpoint bullet so it matches the spec's firm commitment (§5).
5. Reword the `session-participation` migration note to name the active-vs-historical-membership narrowing as a deliberate interpretive decision rather than pure non-dropping equivalence (§5).

None of this requires new exploration — it's precision work on documents that are already close, plus one real decision (#2) that needs to be made explicitly rather than inherited by accident from whoever writes the query first.
