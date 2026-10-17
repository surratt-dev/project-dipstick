# Proposal Review (Business Analyst): zero-topic-team-recovery (#200)

Reviewer: Marcus Delgado, Senior Business Analyst
Scope read: `proposal.md`, the five delta specs under `specs/`, BRD (FR-8.x), `requirements/use cases/08`. No other reviews read.

## Verdict

Approve with required changes. The endpoint contract is unusually precise: the check order, status codes, error codes, concurrency scenarios and verbatim strings are all buildable as written. My concerns are about the requirement behind it, not the build detail. One is a traceability gap against a [HARD] BRD requirement, two are internal contradictions, and the rest are acceptance-criteria and wording gaps that would come back to me as "what did you mean?" during implementation.

## 1. Blocking / must-fix before build

### B1. FR-8.6 is claimed as the driver, but only a slice of it is delivered
FR-8.6 [HARD] reads: the canonical default set "must remain **visible** and **restorable** for any team at any time, regardless of how much the team has customized their topic list." The proposal says the requirement "is currently unmet for this one state" and that after this change it is met. That overstates the result:
- "Restorable at any time, regardless of customization" covers a team with 3 of 12 defaults, or one whose defaults were all archived and replaced with custom topics. Partial top-up is explicitly a non-goal. The non-goal reasoning (a policy question) is sound, but then the proposal must not present FR-8.6 as satisfied.
- "Visible" is not addressed at all. Is the canonical set viewable on the Topic Management screen for a customized team?

Required: state plainly in the proposal and in the new use case that this change closes the zero-active-topic state of FR-8.6 only. Record the residual (partial restore, and "visible") as an open requirement gap with an owner and a follow-up issue number, not just as a non-goal list. Also note that restoring archived defaults via TOPIC-005 is the existing partial answer once the team is unlocked; say so, so a later reader does not think FR-8.6 is untraced.

### B2. Contradiction on the non-admin 403 audit
- The outcomes table says the 403 gets "the same 403 audit treatment as the sibling non-admin denials."
- "Open decisions" says the siblings (TOPIC-003..006) "write no `audit_log` row for their 403s".
- Recent history (`#264 TOPIC-002: audit non-admin 403s`, `#263 machine-readable error codes on the two non-admin 403s`) suggests at least some sibling 403s now are audited.

These cannot all be true. Required: verify against the code, then state one rule with one scenario ("a non-admin 403 writes / does not write an audit row with operation X"). The delta spec has no scenario for this either way, so today the behaviour is unspecified and untestable. Because this endpoint bypasses the lock, Security will care.

### B3. The admin copy at room open may describe an impossible actor
The session-creation delta gives a specific message for "admin caller" opening the room, then says that scenario is "seeded directly in tests if the role model does not allow it through the API." Use case 01 and the BRD glossary say an Application Administrator does not take part in sessions. If an admin cannot be a session's facilitator, the admin message is dead copy and the "Locked/admin" table row is untestable through the real API. Required: confirm whether an admin can be a session facilitator. If not, drop the row (and the H1 wording for it); if so, cite the use case that allows it.

## 2. Vague or underspecified language (flagged)

| # | Where | Language | Problem | Concrete condition suggested |
|---|---|---|---|---|
| V1 | AC7 | "without a confusing reload" | Subjective, untestable | "After the admin assigns defaults, the facilitator's next `/advance` on the same session id returns 200 and the session is `lobby`; no new session row is created; the facilitator performs no step other than clicking Open room again." |
| V2 | AC9 | "Plain-words usability pass (Priya has offered)" | No pass/fail, no named owner commitment, no evidence | "A facilitator who has not seen the copy completes the blocked-open, ask-admin, return-and-open flow with no verbal help; pass if they name 'ask an application administrator' as the next step unprompted and open the room on the second attempt. Result recorded in tasks.md." |
| V3 | Success banner | "12 default topics assigned." | Hardcoded 12 in copy; the #291 commit exists precisely to harden against template data drift. Plural also breaks at 1 | Specify as `{topicCount} default topic(s) assigned`, with the singular form defined: "1 default topic assigned." Add a scenario for 1 and for n. |
| V4 | 500 copy | "Contact whoever operates this deployment and check the server logs." | This is the same vague-escalation shape the proposal condemns in the old copy. The viewer is an application admin, so name the artefact: the runbook section, or "the default topic template (team configuration)" | State what the admin is told to do and where it is written down (runbook anchor). If no runbook link is possible in-app, say so as an accepted limit. |
| V5 | Impact | "No migration expected ... (confirm in design)" | Open item sitting in the proposal | Resolve before approval: yes or no, and why. |
| V6 | Verification | "the `/start` legacy-lobby query" and "add the guard only if it returns rows" | Not defined anywhere in the proposal; a reader cannot tell what is being checked or what the guard is | One sentence each: what state a legacy lobby is, what `/start` guard would be added, and the decision rule (rows greater than 0 means a task is added; 0 means close). |
| V7 | AC1 | "exactly the template's active topics" | Template at which moment? | "as of the transaction's read, under the lock; later template edits do not affect an assignment already made." |
| V8 | Non-admin copy | "then refresh this page" | A refresh is not guaranteed to reflect the change on a cached screen; the screen design says no polling | Acceptable, but add a scenario: a refetch of TOPIC-002 after assignment returns the topics and `canAssignDefaults: false`. |
| V9 | "Rate limited: Shared topic-write limit, inherited unchanged" | The delta says "429 or 503" | Which when? A BA cannot tell the facilitator or admin what they will see | Reference the sibling endpoint rule by name and what the screen shows on each (see G3). |
| V10 | Purpose-paragraph touch-up (task 6.3) | "touched up at sync time so it does not read as contradicting" | No wording is given | Provide the replacement sentence now, since sync is mechanical and nobody will own the wording later. |

## 3. Acceptance criteria: explicit vs implicit

Explicit and good: AC2 (status/code matrix), AC3 (race, exactly one 201 and one 409), AC4, AC5, AC6, AC8. These map one-to-one to delta scenarios.

Implicit or missing, and the condition I would add:

1. **Order of check outcomes for combined failures.** The spec fixes the order (403 before 404, template guard before precondition). Add AC: "A non-admin on a nonexistent team gets 403 NOT_AN_ADMIN, not 404" (exists as a scenario, but not in the proposal's AC list; the AC list should be the complete contract).
2. **Result shape, not just count.** AC1 says "numbered 1..n in template order, without annotation fields". Add: each created topic carries the template's name, prompt, vote type and description (use case 08 line 23 lists prompts, vote types, descriptions), and is marked as default (use case line 24). The proposal's AC1 omits vote type and the default marker; the delta spec has the default marker only.
3. **Tenancy of the effect.** Add: assigning on team A changes no other team and not the template.
4. **UI outcomes.** AC list has no criterion for the three screen outcomes (201 banner, 409 notice, 500 message with button retained, button disabled while in flight). They are scenarios in the screen delta but not acceptance criteria; add one AC each or one AC referencing them.
5. **Unlocked zero-topic team.** `canAssignDefaults` is true for an admin on an unlocked zero-active team, yet the proposal only describes the locked variants for the button. State the acceptance behaviour: on an unlocked team with zero active topics, the admin sees the Add control and also the Assign default topics action (or only one; decide). The delta's "screen decides" delegates this without saying.
6. **Audit actor.** AC5 constrains metadata to `{ topic_count }` but never says the row records the acting admin id and team id. State which columns carry them; otherwise "who did this" (the runbook's purpose) is unanswerable.
7. **Post-COMMIT event.** The outcomes table promises `emitAuditEvent` after COMMIT. No AC covers it. Add one, or drop it from the table.
8. **Negative: no notification, no undo.** Exists as a spec scenario; promote to an AC since it is a stated product decision.

## 4. Gaps in capability definition

- **G1. Recover Zero-Topic Team use case is promised but not drafted.** The proposal gives replacement lines for two existing use cases but only a title for the new one. Use cases are my deliverable and the team builds from them. Required content: Actor (Application Administrator), Trigger, Preconditions (team exists, not the template, zero active topics), Main flow, Alternate flows (the six outcomes), Postconditions, Out of scope (customization, partial top-up), Related (Assign Default Topic Set; Customization Lock; FR-8.6; FR-8.2). Draft it before design sign-off, or attach it to this change as a deliverable with an owner.
- **G2. Who triggers the recovery in practice.** The non-admin copy tells a facilitator to "ask an application administrator", but the non-goals exclude a "who are the admins" directory. The persona context (internal tool, real users) means a facilitator in a mid-sized org may not know who that is. This is the very escalation-magnet problem the proposal wants to remove. Not asking for a directory, but the acceptance should state who is expected to know (the roles are assigned via the OIDC role map, #243) and the usability pass (V2) must test exactly this step.
- **G3. Failure states of the button other than 201, 409, 500.** The screen spec covers those three. Not covered: 403 (admin role revoked mid-session), 404 (team deleted), 429/503, network failure/timeout. Required: one sentence of expected UI behaviour for "any other failure" (generic error, button stays, no state loss).
- **G4. Accessibility of the new action and messages.** Not stated: outcome messages announced to assistive tech (live region), focus placement after the empty state is replaced by the topic list, and the disabled-while-in-flight state exposing its reason. Add one AC if the project's accessibility standard applies (check the BRD NFRs).
- **G5. Known gap D10 (session draft page copy).** The draft page still says "Add or restore a topic on Topic Management", which is wrong for a locked zero-topic team, and the facilitator cannot do that (lock). Leaving it is a defensible scope call, but the facilitator hits the 409 with the correct copy only after clicking Open room. Record who accepted this (PO or Devon) and add a trigger that reopens it (for example, any usability-pass participant stumbling on that line).
- **G6. Audit-less failure path.** The empty-template 500 is log-only. Acceptable, and I agree with not building a new audit pattern. But "compliance is informed so they can overrule" is not a requirement. Name the person/role informed and record the date or response in the change, otherwise the flag has no closure.
- **G7. Runbook content.** "A diagnostic query and how to find audit rows" is a deliverable with no acceptance condition. Add: runbook states (a) the query that lists teams with zero active topics, excluding the template, (b) the query/filter for `topic.defaults_assigned` rows, (c) what to do when the template itself is empty. The audit delta already has a scenario that an operator can recover "from the runbook alone"; carry that into the proposal AC list.

## 5. Check against requirements/

| Requirement | Status |
|---|---|
| FR-8.1 Default set applied to new teams | Untouched, consistent. |
| FR-8.2 Admins may change topics regardless of membership | Consistent (#208 respected). |
| FR-8.6 Canonical set visible and restorable at any time | Partially met; see B1. |
| FR-8.7 Admins do not annotate | Consistent; the recovery scenario correctly keeps annotation as 403 for admins. |
| Use case 08, Assign Default Topic Set, Failure/Postconditions | Stale text correctly identified; replacement line is acceptable. |
| Use case 08, Customization Lock, "no exceptions are defined" (line 101) | Amendment proposed. Also line 90 ("Failure (lock not enforced)") and the assumption at line 109 (lock based on session completion) should get a cross-reference to the exception, otherwise the lock use case contradicts itself. |
| Use case 08 line 54 ("existing teams retain their assigned configuration") | A zero-topic team gets the current template, not the template of its creation date. State this is intended. |
| Use case 08, Remove Topic: last active topic cannot be archived (`TOPIC_LAST_ACTIVE`) | Relevant: it means a zero-topic team only arises from data fault or legacy state. The proposal says so informally ("unreachable through the API"). Cite the use case and the diagnostic query decision rule (what count means "do nothing more"). |
| BA concern: "session state recovery" edge cases becoming scope disputes | This change is the right response. Confirm the failed-open leaves the session recoverable (it does; AC7). |
| BA concern: "zero sessions" states | The post-recovery team returns to `first_session` lock with zero sessions; the proposal says it behaves like a brand-new team. Good. |

## 6. Concrete conditions per capability (recommended acceptance wording)

1. **Assign-defaults endpoint**
   - Given an application_admin and a non-template team with 0 active topics (any number of archived), when POST, then 201 `{ topicCount: n }` where n equals the template's active topic count at read time; the team has n active topics, each default-marked, display_order 1..n in template order, name/prompt/vote type/description equal to the template's; archived rows unchanged; lock state unchanged; one audit row; no other team changed.
   - Given any other caller, team or state, the status/code from the outcomes table, no writes.
2. **Lock exception**
   - Given a recovered team, add, archive, restore, reorder return 409 `TOPIC_CUSTOMIZATION_LOCKED`; annotate as admin returns 403; the four lock-gated endpoints' code is unchanged (a source test asserting `checkCustomizationLockGate` is not called by the new route, and is still called by the others).
3. **canAssignDefaults**
   - Truth table, 2x2x2 (admin, zero-active, template): true only for (T,T,F). Eight rows in one table-driven test.
4. **Topic Management empty state**
   - Per viewer and lock state, exact verbatim strings from the proposal; button present only when `canAssignDefaults === true` and locked; outcome states for 201, 409, 500, and an "other failure" state (G3).
5. **Room-open message**
   - Three message rows (after B3 resolves), code unchanged, session stays `draft`, authorization before status before topic count.
6. **Audit operation**
   - Row in the same transaction, metadata exactly `{ topic_count }`, actor and team recorded (G: actor), event after COMMIT, none on any refusal.
7. **Use case amendments / runbook**
   - Use case Recover Zero-Topic Team drafted (G1); two amended lines present verbatim; the lock use case cross-referenced; runbook sections (G7).

## 7. What is well done (keep)

- Deliberate, narrowly-justified lock exception, with the precondition (not the role) as the justification. This is the right way to carve it out.
- The recovery does not unlock or offer customization; the trap I worry about most (edge case treated as out-of-scope) is addressed.
- Fail-closed UI flag, server-side independent enforcement, and the flag-agrees-with-endpoint scenario.
- Concurrency criterion stated as exactly one 201 and one 409.
- Non-goals are listed with reasons so a later sweep does not undo them.
- Facilitator-facing copy is concrete, names a role and states "Your session is saved", which is what a stuck facilitator needs.

## 8. Requested actions, in order

1. Resolve B2 (verify sibling 403 audit behaviour; fix the contradictory text; add a scenario).
2. Resolve B3 (can an admin be a session facilitator?).
3. Rewrite the FR-8.6 claim per B1 and open a follow-up for the residual.
4. Fix V1, V2, V3, V4, V5, V6 wording.
5. Add the missing ACs in section 3 and the failure-state sentence (G3).
6. Draft the Recover Zero-Topic Team use case (G1), and give the Purpose-paragraph replacement text (V10).
