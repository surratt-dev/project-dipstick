# BA Review: Proposal for topic-001-authz-contract-reconcile (#187)

**Reviewer:** Marcus Delgado (Senior Business Analyst)
**Reviewed:** `proposal.md`, `specs/team-content-access/spec.md`, `specs/topic-annotation/spec.md`, `specs/topic-customization-lock/spec.md` (with `design.md` and `tasks.md` read for context)
**Checked against:** GitHub #187; BRD FR-1.4, FR-8.6, FR-8.7, FR-9.5, Constraint 2; use case "View Active Topic Configuration" (08 - Topic Management, Out of Scope and Notes); `packages/backend/src/routes/content.ts` TOPIC-001 handler (lines 461-526); `packages/backend/src/auth/team-content-access-helper.ts`; my explore review (`explore-review-ba.md`)
**Lens:** Can each capability be built and tested without coming back to ask "what did you mean?" Are the acceptance criteria explicit?

---

## Overall

This is a buildable proposal. It took up every position from my explore review: OR semantics, deferring the remap, `team-content-access` as the owning spec, an allow-list instead of a deny-list, wording the "unconditional" rule the way TEAM-005 does, and the template-team scenario. The traceability is good too. The Why section cites the contract, the content matrix, the use case, and FR-9.5 / Constraint 2, so nobody will read the EM denial as a new policy. #187's three points are all covered: EM denial (1), the matrix cells (2), and casing (3, deferred with an as-built note, as the issue itself asks).

The spec deltas mostly state their acceptance conditions explicitly. Nearly every SHALL has a scenario with an observable status, body, header, or query-count check. The MODIFIED `Application Admin access` requirement keeps all of its existing scenarios. I diffed it against `openspec/specs/team-content-access/spec.md`: the only changes are the TOPIC-002 sentence, the TOPIC-001 audit sentence, and one new scenario.

I have one blocking item. It is a wording conflict about facilitators, and on a security rule that kind of conflict can produce two different implementations. Everything else is non-blocking.

---

## Blocking

### B1. "A facilitator is never denied" contradicts the OR rule for a global facilitator who holds an EM membership

**Proposal, What Changes, bullet 3:** *"Facilitators are not denied because of their team membership. The check looks at the actor. A facilitator whose global role is `facilitator` is never denied."*
**Spec (team-content-access, ADDED):** *"A facilitator grant whose actor's global role is `facilitator` SHALL NOT be denied by this rule. Team membership never disqualifies a facilitator here, because a facilitator grant exists only when the caller has no active membership on the team."*

The spec's first sentence is correct because it is limited to *facilitator grants*. The proposal's sentence, and the spec's second sentence, read as if they are about *users whose global role is facilitator*. Those are different sets of people:

- A user with `global_role = 'facilitator'` and an active `team_memberships.role = 'engineering_manager'` on Team A never reaches path 3. The helper returns the path 2' degraded grant (`member / participant`, `actorGlobalRole: 'facilitator'`, plus a `team.access_grant_mismatch` event). Under the OR rule, which looks at membership role, this caller is **denied**. That is the right outcome under FR-1.4: they hold the team's EM role.
- This state can happen. The app cannot create a new EM membership for a non-EM user (TEAM-005 only demotes), but an IdP role change can turn a global EM into a global facilitator while their EM membership row stays. That is exactly the drift Decision E exists to handle.

An implementer who reads the proposal bullet could short-circuit "`actorGlobalRole === 'facilitator'` → admit" ahead of the membership check, and that would let this caller through. Task 3.1's predicate happens to get it right, but the proposal and spec text must not leave room to argue otherwise.

**Fix:**
1. Proposal bullet 3: replace "A facilitator whose global role is `facilitator` is never denied" with "A **facilitator grant** (path 3) whose live `actorGlobalRole` is `facilitator` is never denied by this rule. A user whose global role is `facilitator` but who holds an `engineering_manager` membership on the team reaches the member path, not the facilitator path, and is denied by the membership signal."
2. Spec: change "Team membership never disqualifies a facilitator here" to "A facilitator **grant** is never disqualified by team membership, because the helper issues one only when the caller has no active membership on the team. A caller with an active membership is judged on the member path."
3. Add a scenario to `team-content-access`:
   - **WHEN** a user with `global_role = 'facilitator'` and an active `team_memberships` row with `role = 'engineering_manager'` on Team A calls TOPIC-001 for Team A
   - **THEN** the response is `403` with the standard forbidden envelope
   - **AND** a `team.access_grant_mismatch` log event is emitted
4. Add the matching unit test to task 4.2 as case (d).

---

## Non-blocking

### N1. "No configuration admits engineering managers" cannot be tested as written

The scenario *"WHEN any feature flag, environment variable, or administrative setting is present in any state"* cannot be run. No test can enumerate "any state". The requirement is right, so turn it into conditions a reviewer can check:
- The TOPIC-001 admission predicate reads no environment variable, config object, feature-flag service, or database setting. It takes only the grant (and, under Decision 1 = B, the membership role). The security reviewer verifies this by inspection at task 6.4.
- Optionally, one test runs the EM-denial case with `NODE_ENV` set to `development` and again set to `test`, and both return `403`.

Rephrase the scenario as **WHEN** the admission decision for TOPIC-001 is evaluated, **THEN** its only inputs are the access grant and the caller's live membership/global role, and no configuration value is read. Then add 6.4's inspection as the check.

### N2. Pin admin-over-EM precedence

The helper checks `application_admin` before membership (helper line 116). So an admin who also holds an EM membership on the team gets the admin grant, the admin 403, and the audit row. They do not get the plain EM 403. The proposal depends on this: "exactly one `audit_log` row". But no scenario pins it, so a later reordering would quietly drop the audit row. Add:
- **WHEN** a user with `global_role = 'application_admin'` and an active `engineering_manager` membership on Team A calls TOPIC-001 for Team A
- **THEN** the response is `403` **AND** exactly one `admin.session_content_denied` audit row is written.

### N3. No scenario covers the "Unchanged" 404-first ordering

The spec says *"The non-canonical `teamId` check (`404 TEAM_NOT_FOUND` before any query) SHALL still run first,"* but no scenario covers it. Add: an EM calling TOPIC-001 with a non-canonical `teamId` gets `404 TEAM_NOT_FOUND`, not `403`, and `evaluateTeamAccess` is not called. That proves the new gate went in after the route boundary and not before it.

### N4. The proposal's reworded 403/404 rows are vague. The tasks are not.

The proposal says only "reworded 403/404 rows". Task 5.3 has the exact text, which matches my explore review. That is fine for implementation, but the proposal is what reviewers approve. Either quote the 5.3 text in the proposal or write "reworded 403/404 rows (exact text in tasks.md 5.3)".

### N5. "Every place that says..." needs its acceptance check in the proposal

"Stale rationale removed. Every place that says TOPIC-001 admits engineering managers..." becomes testable only through task 6.3's grep. Add one clause to the proposal: "verified by `grep -rn "admits engineering" requirements packages/*/src` returning no hits." Note that the grep string should also catch "currently admits engineering managers", which is the wording in the `content.ts` comment at line 501. "admits engineering" does match it, so no change is needed, just a confirmation.

### N6. Follow-ups are named but not filed

`design.md` (lines 99, 108-110) lists four follow-ups: Decision E policy elsewhere (VP of Engineering), participant need for TOPIC-001 (mine), facilitator-window prose, and the TOPIC-001-specific admin message. `tasks.md` has no step to file them. Edge cases that are not filed become scope disputes later. Add task 6.5: "Open GitHub issues for the four follow-ups in design.md Open Questions and record their numbers there before archive." I will own the participant-need issue: reconcile the use case's "engineers see topics only in the room" with the contract and the content matrix.

### N7. Add a participant regression for the global-facilitator-with-participant-membership state

A user with `global_role = 'facilitator'` and a `participant` membership gets `member / participant` with `actorGlobalRole: 'facilitator'`, and should get `200`. Task 4.3 covers the plain participant and the path-3 facilitator, but not this mix. It is cheap to add, and it guards the allow-list against a "global role must be participant" over-correction.

### N8. Small wording items

- Proposal, What Changes bullet 1: "(a) an active `participant` member of the team" reads as if the degraded path 2' grant qualifies. Add "(by membership role, not by grant role)" so the bullet agrees with the spec's EM definition.
- `topic-customization-lock` MODIFIED: "the lock-check function SHALL NOT run for a denied request" is good. Its scenario uses only an EM. Say "any denied caller (null grant, admin, or engineering manager)" in the requirement text so nobody reads it as EM-only. The current handler already behaves this way.
- `topic-annotation` MODIFIED: "That change SHALL also convert TOPIC-001's topic entries to the contract's camelCase shape" puts a duty on a future change. That is acceptable as a tripwire. Its enforcement point is task 4.9's "does not remap" test, which that future change will have to flip on purpose. Say so in one sentence, so the reader knows how the tripwire fires.

---

## Requirement-by-requirement acceptance check

| Capability / requirement | Acceptance explicit? | Notes |
|---|---|---|
| `team-content-access` ADDED: allow-list admission | Yes, with B1 fixed | Allow-list stated as SHALL; deny-list explicitly fails it. Add the B1, N2, N3, and N7 scenarios. |
| ADDED: OR-semantics EM definition | Yes | All four EM states have scenarios. B1 adds the fifth (global facilitator + EM membership). |
| ADDED: Unconditional | No | N1. Restate as verifiable inputs. |
| ADDED: Denial response (envelope, no-store, timing, no query) | Yes | Exact message, header, floor, and query-not-run all observable. |
| ADDED: Mismatch log still fires | Yes | Covered by the path 2' scenario. |
| ADDED: Admin denial + audit | Yes | Add N2 for precedence. |
| MODIFIED: Application Admin access | Yes | Existing scenarios preserved; new TOPIC-002 vs TOPIC-001 scenario is concrete. |
| `topic-annotation` MODIFIED | Yes | No-annotation and EM-403 scenarios are concrete. N8 on the tripwire. |
| `topic-customization-lock` MODIFIED | Yes | N8: widen the requirement text to every denied caller. |
| Contract reconciliation (no spec) | In tasks only | N4. Exact cell text is in the proposal (matrix) and tasks (error rows). |

---

## Verdict

**Approve once B1 is fixed.** The fix is two sentences plus one scenario and one test. N1-N8 should be done in this change if it is cheap. None of them changes behaviour.
