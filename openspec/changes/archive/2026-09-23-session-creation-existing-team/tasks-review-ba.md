## BA Review — Tasks: Session Creation for Existing Team

**Reviewer:** Marcus Delgado (Senior Business Analyst)
**Reviewing:** `tasks.md`
**Cross-checked against:** `proposal.md`, `design.md`, and all four spec deltas (`specs/session-creation/spec.md`, `specs/session-participation/spec.md`, `specs/first-access/spec.md`, `specs/project-structure/spec.md`)
**Prior review on file:** `propose-review-ba.md` (proposal/spec stage) — I re-checked its findings against the current spec text before starting this pass; all five items there are resolved (the `completed`/`complete` typo is fixed, the eligible-teams contradiction is resolved to "don't filter, rely on the 409" with an explicit Note in the spec, the third use-case correction is now named in `tasks.md` §0.1, the "(or equivalent)" hedge is gone from the proposal, and the `session-participation` migration note now calls the active/historical narrowing a deliberate interpretive decision). No drift to re-report here.

---

## Overall verdict

`tasks.md` is a faithful, near-1:1 translation of the spec deltas. I went scenario-by-scenario through all six requirements in `specs/session-creation/spec.md` plus the `first-access` and `project-structure` deltas, and every scenario has a corresponding numbered task — in most cases a dedicated test task, not a bundled "and also test this" afterthought. This is exactly the standard I want: an engineer working section-by-section shouldn't need to re-read the spec to know what to test.

The three specific things the team lead asked me to verify are all captured as concrete, unambiguous tasks — not just implied by a design mention. See §1–§3. I found two smaller gaps in test coverage (§4) that I'd want closed before implementation starts on the affected sections, not because anything is unbuildable, but because both gaps sit exactly on top of decisions this proposal already had to fight for once (the eligible-teams filtering question was a documented contradiction at the propose stage) — leaving them untested is how a future "obvious improvement" quietly undoes a decision that was already made deliberately.

---

## 1. The three use-case corrections — captured as one concrete task, correctly scoped as BA-owned

`tasks.md` §0.1:

> Confirm the use case amendment is merged into `requirements/use cases/02 - Session Setup - Use Cases.md`... the "at least one team membership" precondition reworded as assumed-but-unenforced; steps 5–8 amended with the draft-landing step and "Open the room" action; and the Acceptance Criteria checklist's "waiting for participants" status bullet and "participant readiness view after creation" bullet both corrected to describe draft-landing instead.

All three corrections I flagged at the propose stage — including the Acceptance Criteria checklist correction, which the proposal's Impact section originally missed and which I had to ask for by name — are named individually here, not folded into a vague "update the use case" line. The task also correctly scopes this as owned by me and tracked as a dependency rather than an engineering deliverable ("Blocks: none of the engineering groups below, but should land before this change is archived"), which matches the proposal's Impact section exactly. No gap.

---

## 2. Zero-team-membership facilitators — covered end to end, not just at the routing layer

This use case correction shows up in tasks at every layer it needs to:
- Backend: `AuthSession.canFacilitateSessions` is role-derived, independent of team membership (§5).
- Routing: `AuthenticatedLanding`'s carve-out order is a named task (§6.2), with dedicated tests for both directions — a facilitator with zero teams reaching the entry point (§6.5) and a non-facilitator never seeing it (§6.4) — plus a test that `/no-team` copy is untouched for the population it still applies to (§6.6).
- Eligible-teams data: the "zero home-team memberships still returns the full list, `callerHasTeamMemberships: false`" scenario has its own test (§3.8), distinguished from the "has a home team but zero eligible targets" case (§3.9) — these are easy to conflate and the tasks keep them separate, matching the spec.
- UI: the picker explicitly renders "the two distinct empty states from `callerHasTeamMemberships`" (§7.1), and both are covered by component tests (§7.6).

No gap. This is the one area where I'd have been most worried about the "zero-team facilitator" edge case getting flattened into a single generic empty state, and it hasn't been.

---

## 3. "Waiting for participants" / participant-readiness-view AC bullets — covered by §0.1, and the underlying behavior is independently test-covered

The AC bullet correction itself is the documentation fix in §0.1 (§1 above). Separately — and this is what actually protects the intent, since a use-case correction alone doesn't stop a build regression — the behavior those bullets used to (incorrectly) describe is pinned down by real tests: §8.7 asserts the post-creation route shows the **draft control view** with a **non-joinable** join link (not "waiting for participants" in the joinable sense), and §8.1/8.8 assert the facilitator sees their own control view, not a participant readiness view, on both initial creation and rehydration. So the correction isn't just a documentation edit sitting next to an unverified implementation — the thing the AC bullets are being corrected *to* is itself under test.

---

## 4. Audit logging, the resumable draft route, and D6's confirm-before-open — each has dedicated implementation and test tasks, not just a design reference

Checked each against `design.md` and the spec text directly:

- **Audit logging.** Not a design-only mention — it's a full numbered subsection (§4a) plus the denial-side pieces folded into §2: new `AuditEventName` values (§2.2, §4a.1), the transactional write on the success path (§4a.2, coordinated explicitly with §4.2's transaction), and three dedicated tests (§2.3 denial-path audit row, §4a.3 success-path audit row in the same transaction as the insert, §2.5 explicitly asserting *no* audit row for the declined non-facilitator case — which correctly encodes D1's "Declined" note rather than silently dropping it).
- **Resumable draft route.** §8.1–§8.2 build the real route and the rehydration-via-`facilitator-state` mechanism as their own tasks, not folded into the create-flow task. §8.7/§8.8 test the two entry paths (fresh creation, refresh/direct-hit) render the same view, and §8.12 tests the server-side facilitator check is what actually gates it (no client-side gate assumed). The 409-resume affordance is wired through the same route (§7.4, §8.2) rather than as a separate mechanism, matching D6's explicit point that one route serves both cases.
- **D6's confirm-before-open.** §8.5 builds the inline confirmation as a named implementation task ("not a modal round-trip"), and §8.9–§8.11 give it three dedicated tests: confirmation is required before the request fires, success transitions in place, and failure leaves the draft session intact and the action retryable.

None of these three are design-only mentions that implementation tasks silently assume. Each has its own line.

---

## 5. Two smaller gaps worth closing before the affected sections are built

**5.1 — No task locks in "a team with a live non-terminal session still appears in `eligibleTeams`."**

This is the exact scenario that was a documented contradiction at the propose stage (see `propose-review-ba.md` §2): the spec's own eligibility definition and D2's query are two-condition (membership + deactivation), and the spec now carries an explicit Note stating this is deliberate — a team with a live session is *not* filtered out of the list, and the 409 at submission is the only enforcement point. That Note exists specifically because someone could reasonably "fix" this the other way, having watched it be treated as a bug the first time around.

`tasks.md` §3 tests every other eligible-teams scenario in the spec (non-facilitator rejection, deactivated exclusion, both empty states, `lastSessionAt` sourcing, live role-downgrade), but none of §3.1–§3.11 asserts the positive case — that a team with an active `lobby`/`draft`/etc. session, and no membership row for the caller, *does* still show up in the response. Without a test for this, an engineer (or a future refactor) adding the "obvious" join-against-`sessions` filter wouldn't break anything currently specified — which is exactly how this got contradicted once already.

**Ask:** add a task under §3, e.g. "§3.12 Write test: a team with a live non-terminal session and no membership row for the caller still appears in `eligibleTeams` (submission-time `409` is the only enforcement point for this, not list-filtering)."

**5.2 — No dedicated test task for "confirm screen shows more than the bare team name."**

The spec (`specs/session-creation/spec.md`, "Session-creation entry point..." requirement) has a named scenario for this: "Confirm screen shows more than the bare team name." §7.2 builds the confirm screen to include `lastSessionAt`, and §7.6 says "component/integration tests for both empty states and both rejection paths" — which doesn't name this scenario. It's minor (the build task and the scenario are one screen, and it would likely get incidentally exercised by other tests), but every other scenario in this requirement has an explicit task-level callout, and this is the one exception. For consistency with how the rest of `tasks.md` traces to spec scenarios one-to-one, I'd rather this be named rather than assumed.

**Ask:** fold an explicit mention into §7.6 (or add a §7.6a) — "Write test: confirm screen displays team name plus `lastSessionAt` context, not the bare team name alone."

---

## Summary (in priority order)

1. **Add §3.12** (or equivalent): a test asserting a team with a live non-terminal session and no caller membership still appears in `eligibleTeams` — this is the one behavior in the whole task list that was previously contested and has no regression test protecting the resolved answer (§5.1).
2. **Name the confirm-screen-context scenario explicitly** in §7.6, so every scenario in the "Session-creation entry point" requirement has a 1:1 task reference, matching the rest of the document's pattern (§5.2).

Neither of these blocks starting implementation on the sections that are unaffected (§1, §2, §4, §4a, §5, §6, §8 are all clean). I'd want both added before §3 and §7 respectively are picked up, since they're small additions now and regression gaps later.
