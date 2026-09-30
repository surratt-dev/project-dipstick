# BA Review: Reorder Topics Proposal (TOPIC-006, #52)

**Reviewer:** Marcus Delgado (Senior Business Analyst)
**Date:** 2026-09-30
**Reviewed:** `proposal.md`, `specs/reorder-topics/spec.md`, `specs/topic-management-screen/spec.md`, `specs/remove-topic/spec.md`, with `design.md` and `tasks.md` read for traceability
**Sources checked:** `requirements/use cases/08 - Topic Management - Use Cases.md` (Reorder Topics, `:250-305`; Re-Add AC `:420`), `requirements/BRD.md` (FR-2.7 `:229`, FR-8.2 `:323`), `requirements/design/REST API Contract.md` (TOPIC-004/005 corrections), `openspec/specs/topic-management-screen/spec.md`, `openspec/specs/session-topic-lifecycle/spec.md`, migrations 1, 8, 9, 10, `packages/backend/src/routes/topics.ts` (cascade comments), `packages/frontend/src/pages/TopicManagementPage.tsx`

---

## Overall verdict

**Approve with minor revisions.** This is one of the most buildable proposals this team has produced. Nearly every capability has an explicit, testable scenario, the check cascade is written as an ordered list, and the vague phrases I flagged at explore ("tidy", "fail cleanly", "hide or disable") have all been replaced with concrete conditions. Every one of my explore-stage recommendations made it through, and the three places where the proposal departs from them are improvements or are documented (see §1).

What remains are gaps at the edges, mostly in the UI spec: error responses that have no defined handling, two confirmation messages whose wording isn't pinned, one "reachable" condition that can't be tested as written, and a documented limitation (browser Back) that is recorded in design.md but not in the spec. None of these blocks implementation. All of them should be closed before tasks start, so no engineer has to guess.

I verified the factual claims I could check against code:
- The session statuses in the `openSessionCreatedAt` requirement (`draft`, `lobby`, `pre_session`, `active`, `wrap_up` as non-terminal) match migration 10's partial unique index exactly.
- The cascade (lock before body validation) matches the shipped TOPIC-003/004/005 handler comments in `topics.ts`.
- `audit_log` has `actor_global_role` and `actor_ip` (migration 8).
- The session-isolation scenario uses `active`, not the `in_progress` I wrote at explore. `active` is the correct enum value. Good catch.

---

## 1. Traceability: were my explore recommendations carried through?

| Explore item | Recommendation | Where it landed | Status |
|---|---|---|---|
| §1 FR-2.7 | Restate, don't retire; no per-session path | Proposal "What Changes", design Non-Goals, spec "Reorder never modifies…" ("No endpoint SHALL accept a topic order scoped to a single session"), task 9.5 | Carried. Wording gap, see G8 |
| §1 residual | Lobby-window reorder is out of scope, belongs to `topic-skip-and-creation-time-confirmation` | Proposal Known Limitations, design Non-Goals | Carried |
| C1 / Q1 | Collision fix first, own migration, own scenario | `remove-topic` delta (3 scenarios), task group 1, Migration Plan step 1 | Carried |
| C2 / Q2 | 409 stale, 422 malformed, no existence oracle | Spec "well-formed list … stale" plus "same `error.message`, none is 404" | Carried, and strengthened |
| C3 | Last-writer-wins, stated explicitly | Its own requirement with a serialized-commit scenario | Carried |
| C4 | No-op: 200, no audit | Its own requirement | Carried. See G6 on response shape |
| C5 | Cascade fixed, matches precedent | Numbered list in spec and design Decision 2; locked + empty body gives 409 scenario | Carried |
| C6 | Length cap before advisory lock | 200, `MAX_REORDER_TOPICS`, checked at step 4 | Carried |
| C7 | Archived `display_order` not meaningful, not maintained | `remove-topic` requirement text; "archived rows untouched" scenario | Carried |
| C8 | Reuse `checkStandingFacilitatorOrAdminAuthorization`; list TOPIC-003 inconsistency | Tasks 2.2 and 10.3; Known Limitations (#176) | Carried |
| C9 / Q4 | Buttons only v1 | Screen spec; top/bottom added | Carried, extended |
| V1 | Session-isolation scenarios with #175 executable form | Three scenarios including an executable form | Carried |
| V2 | Dense 1..N, pinned 1-based | Success requirement and gap-closing scenario | Carried |
| V3 | Stale: message, **discard draft**, reload | **Changed:** draft kept on screen until the facilitator selects Reload | Deviation, accepted. See G2 |
| V4 | Transient: keep draft | Scenario "A transient failure keeps the draft for retry" | Carried |
| V5 | Disable Remove/Restore while dirty, with reason | Its own requirement, pinned text | Carried |
| V6 | In-app prompt in scope; `beforeunload` optional | **Extended:** `beforeunload` required; browser Back **not** intercepted | Deviation, accepted. See G3 |
| V7 | Hide when locked or fewer than 2; disable at boundaries | Scenarios for all three | Carried |
| V8 | Pinned "created" copy | Pinned verbatim | Carried |
| V9 | Use case: start→creation, postcondition, #175 annotation | Task 9.3 | Carried. See G9 for one addition |
| V10 | No automatic ordering as a design non-goal, no negative scenario | design Non-Goals. The screen spec also has a SHALL NOT clause without a scenario | Carried. Fine as-is |
| V11 | Restore-default-order out of scope | Follow-ups | Carried |
| Q7 | Audit IDs only, before and after; denial row with no payload | Audit requirement, three scenarios | Carried |
| Q8 | Contract update in this change | Task 9.1 (full list) and 9.2 (TOPIC-005 note) | Carried |
| Q10 | #175 known limitation stating exactly what is proven | Proposal Known Limitations lists all three proven facts | Carried |
| §5 AC-1 through AC-10 | Consolidated conditions | Each maps to at least one scenario | Carried |

Two things were added that I didn't ask for, and I endorse both: `openSessionCreatedAt` (it answers the facilitator's real question, "did my change reach the session I already set up?") and task 9.4, which clears the "currently unsatisfiable" annotation on the Re-Add AC.

---

## 2. Gaps and vague language, with suggested conditions

### G1. UI handling for 403, 404, and 422 on save is undefined (screen spec, "Save failures are handled by cause")
The requirement covers `409 STALE`, `409 LOCKED`, and `5xx`/network. It says nothing about `403` (for example, the facilitator was added to the team as a member while the page was open), `404`, or `422`. These are rare, but "rare" is exactly where an implementer invents behavior. Add a catch-all:

> If the save fails with any other non-2xx status, the screen SHALL show the server's `error.message` (or a generic "Unable to save the topic order." when none is present), SHALL keep the draft displayed and marked unsaved, and SHALL NOT retry automatically.

Scenario: *WHEN a save fails with `403 FACILITATOR_IS_TEAM_MEMBER`, THEN the server's message is shown AND the draft remains displayed and unsaved.*

### G2. Stale state: what can the facilitator do before selecting Reload?
Keeping the draft visible until Reload (instead of discarding it as I proposed) is better, because the facilitator can see what they were trying to do and redo it. But the spec doesn't say what state the controls are in during that window. Resending the same draft is guaranteed to return `409` again, and moving rows in a list that is known to be stale produces work that will be thrown away. Add:

> While a stale message is displayed, Save order and the move buttons SHALL be disabled. Discard and Reload SHALL both return the screen to the server's current order.

Also add "AND Save order is disabled" to the scenario "A stale save explains itself and waits for Reload". Without this, Discard would revert to the old, stale `savedOrder`, which is the list that no longer exists. That is a real bug waiting to happen, and Decision 8's state model (`savedOrder` from the last fetch) would produce it.

### G3. The browser Back limitation exists only in design.md
Design Decision 8 and Risks correctly record that `popstate` is not intercepted. The screen spec's navigate-away requirement says "an in-app navigation away from the screen SHALL prompt". A tester will reasonably treat Back as in-app navigation and file a defect. Scope the requirement to what is actually built:

> …an in-app navigation away from the screen **initiated by activating a link or control in the application** SHALL prompt… Browser Back/Forward navigation is not intercepted in this change (known limitation, design.md Decision 8).

Add the same sentence to the use case Notes resolution (task 9.3 already says this, which is good). The spec just needs to match.

### G4. The open-session confirmation wording isn't pinned (screen spec, "The screen states…")
"The confirmation SHALL state that the session already created on that date keeps its original order" can't be asserted, and the date format is unspecified. The pinned copy was pinned, and this should be too:

> "Order saved. The session created on {date} keeps its original order." where `{date}` is `openSessionCreatedAt` rendered as a local date, for example "Sep 30, 2026".

State whether this **replaces** or **follows** the plain "Order saved" message. I recommend replaces: one message, not two stacked toasts.

### G5. "Stays reachable on a long list and at tablet width" isn't testable
Rewrite as a condition:

> While the draft is dirty, the Save order / Discard bar SHALL remain within the viewport when the list is scrolled to its last row, at viewport widths down to 768px.

This is checked at task 8.1 (the tablet session). The spec is where the pass/fail line belongs.

"Transient" for "Order saved" is also unbounded. Either give a duration ("dismisses automatically after about 5 seconds, or on the next move") or state that it is announced via `role="status"` and persists until the next action. Pick one.

### G6. The no-op response shape isn't fully stated
The no-op requirement says "`200 OK` with the current list". Task 3.2 also returns `openSessionCreatedAt`. The spec should say the no-op response has **the same shape as a changed save**, `{ topics, openSessionCreatedAt }`, so API clients don't need a second parser. One clause.

### G7. The locked-save error copy doesn't match the screen's existing lock notice
The proposed text "Topics can't be customized until the first session is complete." differs from the shipped notice on the same screen, "Topics cannot be customized until this team completes its first session." Two phrasings of the same rule on one screen invite a "which is right?" question. Reuse the existing sentence verbatim. (This path is practically unreachable, because the lock only releases and never re-engages, but if we render it, it should match.)

### G8. FR-2.7 restatement: keep the two sentences that carry the meaning
The proposal's paraphrase ("set order by reordering the team configuration before a session is created; the first session always uses canonical order; there is no per-session reorder path") is correct in substance. Task 9.5's wording drops two things from my explore text that matter for traceability:
- the `[PREF]` tag must be kept (restating does not promote it to HARD), and
- "The order in effect when a session is created is the order that session uses." This is the sentence that ties FR-2.7 to the snapshot-at-creation rule, and it is what the session-isolation scenarios test.

Please use the explore §1 wording verbatim in 9.5, or I'll make the edit myself as owner.

### G9. Use case actor and AC don't reflect the admin branch
FR-8.2 [HARD] names "the facilitator or Application Administrator", and the endpoint admits admins. The Reorder Topics use case's Actor is "Facilitator" only, and its AC reads "Reorder controls are only available to the Facilitator, not to Engineers." Add to task 9.3: the Actor becomes "Facilitator (or Application Administrator, per FR-8.2)", and that AC is annotated to show that the screen's access rule is inherited from the existing `topic-management-screen` access-denied requirement. That keeps the AC traceable to a scenario, since the reorder spec doesn't restate it.

### G10. `draft` sessions and the open-session hint: confirm the snapshot timing
`openSessionCreatedAt` includes `draft` sessions. That is correct only if a `draft` session already has its `session_topics` snapshot, meaning SESSION-001 creates in `draft` and snapshots at that point. If the snapshot is taken at the `draft`→`lobby` transition instead, the UI would tell the facilitator that a draft session "keeps its original order" when in fact it will pick up the new one. I couldn't settle this from `session-topic-lifecycle` (it says "at session creation (`SESSION-001`)" but never mentions `draft`). **Question for Devon:** confirm which status SESSION-001 snapshots at. If it's `lobby`, drop `draft` from the status list. Whichever it is, record the answer in design Decision 7.

---

## 3. Smaller observations (no action strictly required)

- **Unknown body keys.** The spec doesn't say whether `{ orderedTopicIds, foo }` is a 422 or whether extra keys are ignored. Follow whatever TOPIC-003 does and say so in the contract (task 9.1).
- **Stale while the page also refetches.** After a successful Remove or Restore, the page calls `loadTopics()`. Because both actions are disabled while the draft is dirty, the draft can't be clobbered by the page's own refetch. Good. Please keep a one-line comment in the code saying the disable rule is what protects the draft, so nobody "simplifies" it away later.
- **Add Custom Topic isn't on this screen,** so a facilitator can't make their own save stale from the same page. A concurrent add from another tab or colleague is covered by the stale path. No change needed.
- **Last-writer-wins scenario** says "serialized so that B commits after A". That is testable only if the test controls ordering (for example, sequential awaits or a held lock). Task 3.8 says "concurrent". Make sure the test forces the order rather than racing, or it will be flaky.
- **The `remove-topic` delta** states the rollback behavior only in design. That's fine, since rollback is an ops concern, not a behavior requirement.

---

## 4. Recommended edits before `tasks.md` is started

| # | File | Edit |
|---|---|---|
| 1 | `specs/topic-management-screen/spec.md` | Add the catch-all failure clause and scenario (G1) |
| 2 | same | Disable Save and moves while stale; Discard/Reload go to the server order; amend the scenario (G2) |
| 3 | same | Scope the navigate-away prompt to link/control activation; state the Back limitation (G3) |
| 4 | same | Pin the open-session confirmation text and replace-vs-follow behavior (G4) |
| 5 | same | Replace "stays reachable" with a viewport condition; bound "transient" (G5) |
| 6 | same | Align the lock-error copy with the existing notice (G7) |
| 7 | `specs/reorder-topics/spec.md` | No-op response includes `openSessionCreatedAt`, same shape (G6) |
| 8 | `design.md` Decision 7 and spec | Confirm the `draft` snapshot timing; adjust the status list if needed (G10) |
| 9 | `tasks.md` 9.3 / 9.5 | Admin in the use case actor and AC annotation (G9); FR-2.7 keeps [PREF] and the "order in effect at creation" sentence (G8) |

With these edits, I'd consider the requirements side complete for this change.

— Marcus
