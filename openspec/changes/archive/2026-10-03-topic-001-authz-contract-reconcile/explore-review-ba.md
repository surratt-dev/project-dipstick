# BA Review: Exploration Notes for topic-001-authz-contract-reconcile (#187)

**Reviewer:** Marcus Delgado (Senior Business Analyst)
**Reviewed:** `exploration-notes.md` (Devon Calloway, 2026-10-02)
**Lens:** Is each idea specific enough to become a requirement with a testable scenario? Where it is not, what is the acceptance condition?

---

## Overall

The notes are well researched. The code-vs-contract map in sections 2 and 3 is accurate; I re-checked the handler (`content.ts` 461-526), the matrix row (contract line 3030), and the grant union (`packages/shared/src/types/team-content-access.ts`). I agree with the main position: deny EMs on TOPIC-001 now, while nothing depends on it.

Two things the notes undersell, both of which make the requirement stronger:

1. **The use cases already decide this.** `requirements/use cases/08 - Topic Management - Use Cases.md`, "View Active Topic Configuration", Out of Scope (line 487): *"Engineering Managers modifying or viewing topic management (they have read-only access to session history, not topic configuration)."* The `team-content-access` content matrix (spec line 122) says the same thing: EM column for "Topic configuration" is **None**. BRD FR-9.5 and Constraint 2 (BRD line 648) list what EMs may see, and topic configuration is not on the list. This is not a judgment call. It is a code defect against three documents that agree. The proposal should cite all three, so nobody reads the EM denial as a new policy that needs VP sign-off.
2. **One factual gap in Open Question 1.** The notes say the stricter EM check "needs no new query" because the grant carries `actorGlobalRole`. That is only half true. The degraded path 2' grant (`membership_role = engineering_manager`, `global_role` not EM) comes back as `{ path: "member", role: "participant" }` and **drops the membership role**. The grant cannot tell it apart from an ordinary participant. Denying that case needs either a grant-shape change or a second read. The requirement should state the behavior; the architect picks the mechanism. The proposal must not claim "no new query".

---

## 1. Clarifications needed (with my position on each open question)

### OQ1. EM definition for this denial: **Position: OR semantics (either signal denies).**

Grounding:
- BRD FR-1.4 defines the EM in team terms: *"any user assigned the EM role for a given team"*. That is the membership row. Under the BRD, a path-2' user (EM membership row, non-EM `global_role`) **is** the team's EM, whatever the IdP says. Degrading them to participant for TOPIC-001 contradicts FR-1.4's definition.
- The reverse state (global EM, participant membership) **is reachable today, by design, not just by accident**:
  - TEAM-005 is demotion-only (`teams.ts` ~line 626): EM to participant. It leaves `users.global_role = engineering_manager` untouched. Every demoted EM ends up in exactly this state.
  - Join-link redemption (`join-links.ts` ~line 169, `auth.ts` ~line 823) inserts `role = 'participant'` with no `global_role` check, so a global EM can join any team as a participant.
- The vote lock-in (`sessions.ts` 378-391) already treats either signal as "is an EM" and refuses the vote. It would be incoherent for the app to say "you are too much of a manager to vote here" and also "you may read the team's topic configuration as a participant". Once `teamAnnotation` lands, that is the team's own words in front of a manager.

So the requirement is: TOPIC-001 SHALL deny a caller when **either** their active membership role for this team is `engineering_manager` **or** their `global_role` is `engineering_manager`, whatever grant path they came through (member, degraded member, or facilitator).

Scope caveat: this makes TOPIC-001 stricter than the other `content.ts` handlers, which keep Decision E's "degrade to participant". That is fine for this change, because TOPIC-001 is the one endpoint whose roadmap carries the team's free text. **But record it as a deliberate, scoped divergence in design.md, and open a follow-up issue** asking whether the global-EM-with-participant-membership state should reach session history or trend data as a participant anywhere. That is a data-access policy question, so per my remit it goes to the VP of Engineering. It should not be decided inside this change.

### OQ2. Casing remap now (B) or deferred (A): **Position: A (defer), with a documented as-built note.**

- Issue #187 itself says "remap the response to the contract shape **once its first real consumer exists**". The issue author already chose A. B would go beyond the issue's stated scope.
- From the requirements side, a response shape with no consumer has no user need to trace to. I cannot write an acceptance criterion for B that a user would notice. I can for the EM denial.
- Section 4 also shows that B is not a rename. It adds four columns, renames `id` to `topicId`, and drops `status`. That is a contract-shape decision and needs its own review.
- The "first consumer inherits snake_case" risk is real. Handle it with a requirement, not a remap: the contract's TOPIC-001 response block SHALL carry an explicit as-built note, and the first change that adds a TOPIC-001 consumer SHALL include the remap in its scope. Put that tripwire in the same place as the annotation tripwire (the topic-annotation spec requirement and the contract comment), so one reader finds both.

### OQ3. Admin denial message: **Position: TOPIC-001-specific message text; keep the audit operation name.**

- The current message ("Application Admins do not have access to session content.") is false for this endpoint. Topic configuration is not session content (team-content-access spec line 174 lists it as administrative metadata). Showing an admin an inaccurate reason is a support problem.
- Suggested text: `"Application Admins view topic configuration on the Topic Management screen."` This points to TOPIC-002 without naming an endpoint.
- Keep `operation = 'admin.session_content_denied'` and `metadata.endpoint`. Audit consumers can tell the cases apart by `endpoint`. `denyAdminContentAccess` today takes no message parameter, so this is a small signature change. Note it in tasks.
- If the architect considers the message change scope creep, it can be dropped. It must not block the EM fix.

### OQ4. 404 row in the TOPIC-001 error table: **Position: yes, reword it, and fix the 403 row too.**

The current table is wrong in two rows:
- `404`: reword to "`teamId` is not a canonical 8-4-4-4-12 UUID (`TEAM_NOT_FOUND`), returned before any query". Add: "A well-formed `teamId` for a team that does not exist returns `403`, the same as any unauthorized caller (authorization before lookup)." The contract's "Path id shape" note (line 1096) lists `/topics/all` and the topic write routes but not TOPIC-001, even though #184 extended it there. Add TOPIC-001 to that list.
- `403`: "Authenticated user has no authorized relationship with this team" does not describe an EM, who *does* have a relationship. Reword: "Caller is not an active participant member or an eligible session facilitator for this team; includes engineering managers of the team and Application Admins."

### OQ5. Which spec owns TOPIC-001 authorization: **Position: `team-content-access`.**

- It already owns the content-type matrix row and the grant helper. `topic-customization-lock` explicitly scopes itself to the lock flag and TOPIC-002's model (spec line 5). Putting authorization there would widen that spec's purpose statement.
- Add a new requirement to `team-content-access`, e.g. "The active-topics endpoint admits only participant members and eligible session facilitators", with the scenarios in section 3 below.
- `topic-customization-lock` line 41 ("regardless of the requesting user's role") should change to "on every successful (200) response, to every caller the endpoint admits". The current wording reads as if every role gets a 200.

### OQ6. Retire TOPIC-001 (Option C): **Position: not in this change; but log a requirements tension.**

There is a discrepancy the notes did not catch. The contract and `team-content-access` (Engineer column: "Read-only") admit participants to TOPIC-001. But the use case "View Active Topic Configuration", Out of Scope (line 486), says *"Engineers see topics only within the session room during live voting"*, and Notes (line 495) say engineers do not see the full configuration. So the use cases do not support a participant need for TOPIC-001 either. That is the strongest argument for C, and it belongs in the proposal's "considered, not chosen" line. It is a requirements gap for me to resolve with the facilitator stakeholders. It is not something this change should guess at. I will take it as a follow-up.

### Additional clarification (not in the notes)

- **Template team.** FR-8.6 / `default-topic-provisioning` line 50: members read the template team's rows through TOPIC-001. Does an EM of the template team exist, or could one? If so, they are denied under the new rule. That is fine, but the scenario should say so, so `template-team-topic-writes-integration.test.ts` 4.3 is not "fixed" by admitting EMs.

---

## 2. Vague areas (too loose to carry into a proposal as written)

| # | Notes wording | Why it is too vague | What it needs |
|---|---|---|---|
| V1 | "Allow-list style preferred" / "I lean toward the allow-list" | A preference, not a requirement. A reviewer can't fail a PR against "lean". | State the rule as an allow-list in the spec: "SHALL return 200 only when ...; every other grant SHALL receive 403." Then a fifth grant variant is denied by the spec, not just by code style. |
| V2 | "Apply the timing floor" | Which floor, and measured against what? | Acceptance: the EM-denial response time is no faster than the null-grant 403 (same `applyTimingFloor(startTime)`, applied once before send), checked the way `topic-customization-lock`'s timing scenario does. |
| V3 | "Return the existing generic `denyAccess` 403" | Does not say which body. `denyNullGrant` has two bodies (generic vs cross-team facilitator). | Acceptance: EM denial body is exactly `denyAccess`'s envelope (`category: "forbidden"`, message "You do not have access to this team's content.", fresh `correlationId`), `Cache-Control: no-store`, and never the cross-team-facilitator message. |
| V4 | "assert that no topics query ran" | Good instinct, needs to be explicit on both queries. | Acceptance: on EM denial, neither the `topics` SELECT nor `hasCompletedFirstSession` runs. The lock flag must not leak to a denied caller either. |
| V5 | "Add an EM-denial scenario to a spec, probably ..." | Owner undecided. | Resolved above: `team-content-access`. |
| V6 | "No flag, no admin override... The spec should say so in the same words" | Good, but no exact text. | Use TEAM-005's wording verbatim: "unconditionally, for every actor, with no feature flag, configuration setting, or administrative override". |
| V7 | "Refresh the stale 'currently admits EMs' comments" | "Three places" is listed, but section 6.6 names five locations. | Enumerate in tasks: (a) contract TOPIC-001 `teamAnnotation` comment (line ~575-578); (b) `topic-annotation` spec requirement (line ~232), both sentences "admits engineering managers" and "does not alter TOPIC-001's authorization"; (c) `content.ts` SQL comment (~line 499); (d) `packages/shared/src/types/topic.ts` lines 18-22; (e) the S1 comment in `topic-annotation-integration.test.ts`. Acceptance: `grep -rn "admits engineering managers"` over `openspec/specs`, `requirements/`, and `packages/` returns nothing after the change. |
| V8 | "Optionally align facilitator prose with ... grace window" (6.7) | "Optionally" will become an untracked drift. | Decide in the proposal. I recommend doing it: it is one sentence, and contract drift is how #187 started. Text: "`facilitator` of a session for the team that is in lobby, pre_session, active, or wrap_up; a draft under 24 hours old; or a completed session inside the facilitator grace window." |
| V9 | Matrix cell "No (reads via TOPIC-002)" | The EM cell is also right only by accident of meaning. | Also make the EM cell explicit: "No (403, #187)". Add a Notes-column entry: "Participant member or eligible facilitator only; EM denied by membership or global role". |

---

## 3. Suggested rewrites (proposal/spec-ready)

### R1. New requirement for `team-content-access`

> ### Requirement: The active-topics endpoint admits only participant members and eligible session facilitators
>
> `GET /api/v1/teams/:teamId/topics` (TOPIC-001) SHALL return `200` only to (a) a caller with an active `participant` membership on the team, or (b) a caller holding a facilitator grant for the team from `evaluateTeamAccess`. In both cases the caller must NOT be an engineering manager under this rule. A caller is an engineering manager for this rule when their active membership role for the team is `engineering_manager` **or** their `users.global_role` is `engineering_manager`, whatever grant path they came through (BRD FR-1.4, the same OR semantics as the vote lock-in). Every other caller SHALL receive `403` with the generic content-denial envelope. This rule applies unconditionally, for every actor, with no feature flag, configuration setting, or administrative override. Application Admins SHALL continue to receive `403` here and read topic configuration through TOPIC-002.

Scenarios:

1. **Dual-check EM denied.** WHEN a user with `global_role = engineering_manager` and an active `engineering_manager` membership requests TOPIC-001 for that team, THEN the response is `403`, the body is the generic `denyAccess` envelope, `Cache-Control: no-store` is set, and neither the topics query nor the lock-check function runs.
2. **Degraded-grant EM denied.** WHEN a user with an active `engineering_manager` membership and a non-EM `global_role` requests TOPIC-001, THEN the response is `403` (not `200` as a degraded participant).
3. **Global EM with participant membership denied.** WHEN a user with `global_role = engineering_manager` and an active `participant` membership (for example, after a TEAM-005 demotion or a join-link redemption) requests TOPIC-001, THEN the response is `403`.
4. **Participant still admitted.** WHEN a non-EM user with an active `participant` membership requests TOPIC-001, THEN the response is `200`, with `teamId`, `topics`, and `isCustomizationLocked`.
5. **Facilitator still admitted.** WHEN a facilitator holding a grant for the team requests TOPIC-001, THEN the response is `200`.
6. **Admin still denied, audited.** WHEN an `application_admin` requests TOPIC-001, THEN the response is `403` and one `audit_log` row with operation `admin.session_content_denied` and `metadata.endpoint = "GET /api/v1/teams/:teamId/topics"` is written before the response.
7. **Timing.** WHEN an EM is denied, THEN the response is not observably faster than a null-grant denial for the same team.
8. **No leak, even when annotated.** WHEN an EM requests TOPIC-001 for a team whose topic carries annotation `"X"`, THEN the response is `403` and the body contains no topic names, no `"X"`, and no `isCustomizationLocked`. (This is the S1 canary in its stronger form. Flip the status; keep the body assertion.)

### R2. Rewrite of `topic-annotation` spec requirement (line ~232)

> TOPIC-001 SHALL NOT include the team annotation or its provenance. Engineering managers are denied on TOPIC-001 (`topic-001-authz-contract-reconcile`, #187), so the precondition this spec set for adding the annotation is now met. The annotation is still not returned, because TOPIC-001 has no consumer of it. A future change that adds it SHALL name that consumer and SHALL also remap TOPIC-001 to the contract's camelCase shape.

### R3. Rewrite of `topic-customization-lock` line 41

> ... This field SHALL be present on every `200` response from this endpoint, for every caller the endpoint admits (see `team-content-access`). A denied caller receives no lock state.

### R4. Contract, TOPIC-001 section

- Authorization: add "**Corrected (#187):** the handler admitted engineering-manager members; it now denies them, by membership role or global role, as this section always stated. Application Admins are denied and read topic configuration via TOPIC-002."
- Response block: add "**As built (#187):** topic entries are returned as raw rows (`id`, `name`, `prompt`, `vote_type`, `display_order`, `status`). The camelCase shape above is the target. The first change that adds a TOPIC-001 consumer SHALL perform the remap."
- Error table: per OQ4.
- Matrix line 3030: `| TOPIC-001 | Own team (read; participant membership) | Teams with an eligible session (active, recent draft, or grace window) | No (403, #187; membership or global role) | No (403 + audit; reads via TOPIC-002) | EM denied unconditionally; no override |`

### R5. Proposal "Out of scope" (make it explicit, so it does not creep back)

- Adding `teamAnnotation` to TOPIC-001.
- The camelCase remap (deferred to first consumer; tripwire recorded).
- Admitting admins to TOPIC-001.
- Retiring TOPIC-001 (considered; see the OQ6 follow-up on participant need).
- Changing Decision E's degrade-to-participant behavior on any endpoint other than TOPIC-001 (follow-up issue, VP policy question).
- Renaming the `admin.session_content_denied` audit operation.

---

## 4. Traceability summary for the proposal

| Behavior | Traces to |
|---|---|
| EM denied on TOPIC-001 | BRD FR-9.5, Constraint 2 (line 648); UC "View Active Topic Configuration" Out of Scope (line 487); `team-content-access` matrix (EM: None); contract TOPIC-001 prose |
| EM by membership OR global role | BRD FR-1.4 ("assigned the EM role for a given team"); `sessions.ts` vote lock-in precedent |
| No override | BRD 6.2 ("cannot be waived by request, administrative override, or facilitator discretion") |
| Admin denied, reads via TOPIC-002 | Contract TOPIC-002 Notes (line 677); `team-content-access` line 174 (admin may read topic metadata, served by TOPIC-002) |
| Annotation still withheld | `topic-annotation` spec; UC "Annotate a Topic" (display via session snapshot) |

Pipeline classification: I agree with **lightweight** under Option A, with a security reviewer. Scenarios 1-3 and 8 are the security-relevant ones.
