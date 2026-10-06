# Tasks Review: Business Analyst

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Artifact reviewed:** `tasks.md` (sections 1 to 6)
**Traced against:** `proposal.md` (including the "Deviations from the literal text of #243" table), the six spec deltas under `specs/`, and GitHub issue #243
**Focus:** Do the tasks, taken together, cover every capability, every spec scenario and every #243 acceptance criterion as amended? What got lost between requirement and task? Is the binding decision that `application_admin` is denied in live sessions fully covered?

---

## Verdict

**Approve with changes.** The core of this change traces cleanly. The parser, the production and issuer guards, resolution, precedence, the logging rules, the audit firing condition, the stub and the docs each have a task with a named verification. The admin exclusion is enforced at all the right places. Every entry point I found goes through either the registration and lock-in conditions in `sessions.ts` or `evaluateSessionSubscriberAccess`. Tasks 3.4 to 3.6 change both.

What is missing sits around the edges. The most important gap is about requirements, not code. **The admin exclusion is a product rule change, and no task updates the requirements documents it contradicts.** BRD FR-2.4 says any team member with the join link "shall be admitted to the session as a Participant". After this change that is false for admins, and nothing in the BRD, the use cases or the REST API contract will say otherwise. Beyond that there is one defective test case, carried over from the spec, and a handful of spec scenarios with no matching verification.

---

## 1. Admin live-session exclusion (binding user decision)

I checked the code for every way a participant reaches a live session:

| Path | Where it is decided | Task | Covered? |
|---|---|---|---|
| Register as participant (`POST /sessions/:id/participants`) | `sessions.ts` `isEligible` | 3.4 | Yes, in `lobby`, `pre_session` and `active`, with the audit row |
| Lock in a vote (`POST .../lock-in`) | `sessions.ts` lock-in condition | 3.4 | Yes, including an existing participant row and the preserved earlier vote |
| WebSocket connect | `websocket-routes.ts` through the helper | 3.5 | Yes |
| Event delivery (7 call sites in `ws-event-dispatcher.ts`) | helper | 3.5 | Yes, tested through `session_state_change`. All 7 sites call the same helper, so one test is enough |
| Re-authorization sweep | `connection-reauthorization.ts` through the helper | 3.5 | Yes |
| Action-items review (HTTP) | `facilitator-sessions.ts:1188` through the helper | 3.5 | Yes |
| Participant roster fetch (HTTP) | `facilitator-sessions.ts:1276` through the helper | 3.5 | Only the roster *query* change is tested. Denying an admin *caller* is not |
| Reveal-latency report (HTTP) | `sessions.ts:553` through the helper | none | **No test** |
| Roster listing excludes admins | `facilitator-sessions.ts:1298` query | 3.5 | Yes |
| End to end: manager + admin resolves to admin and is refused | resolver, registration gate and helper | 3.6 | Yes, at resolver and gate level |

The enforcement is complete. The remaining gaps are verification and documentation gaps:

- **A1 (must fix): requirements documents not updated.** Task 3.3 updates only the 01b note. Nobody is assigned to change:
  - BRD FR-2.4 (admission of any team member with the link). It needs an exception for Application Administrators.
  - BRD "Constraint 2" and the role definitions (§ around line 202). The Application Administrator definition should say they do not take part in sessions.
  - `requirements/use cases/01 - Identity and Access - Use Cases.md`, wherever it describes admin capabilities.
  - `requirements/design/REST API Contract.md`. The participant-registration and lock-in 403 conditions should list admins. The lock-in message text changes in 3.4, so the contract should reflect that too. The proposal says "no change to the API contract", but a changed error message and a new denied class of caller are contract-visible.

  These are the first documents the team reads when a scope question comes up. If they still say admins are admitted, the next person to touch this code will "fix" the exclusion as a bug. **Add a task 3.7** that updates these four documents and is verified by review.
- **A2 (should fix): the team-join scope has no test.** The `session-participation` spec says "Application Admin may still join the team": the join link still creates a team membership. No task verifies it. The exclusion was deliberately scoped to sessions, not teams, so pin that with a regression test. Add it to 3.4: an admin redeems a valid join link and the membership row is created.
- **A3 (should fix): incomplete coverage of HTTP endpoints that reuse the grant.** The `websocket-session-authorization` requirement names three endpoints: action-items review, roster fetch and reveal-latency. Task 3.5 tests only the first. Add an admin-caller denial test for `participants-roster` and `reveal-latency`. The spec scenario names only action-items, but the requirement text covers all three.
- **A4 (should fix): the structured event is not asserted.** The spec says a registration rejection writes "the same `session.participant_registration_rejected` audit row **and structured event**" with `actor_global_role = 'application_admin'`. Task 3.4 asserts only the audit row. Add an assertion on the event.
- **A5 (consider): what the admin actually sees.** In the frontend, `SessionLobbyPage.tsx` sends a denied caller to its generic `no-access` branch. The only access-model copy in the UI is "Your Engineering Manager can see session history but cannot join or observe live sessions" (lobby and `MemberManagement.tsx`). An admin who is also a team member will now hit a dead end, and nothing will tell them why. FR-2.4 asks for "an explanatory message" when someone is denied entry. You can accept the generic state for this release, but record that as a decision: either a task to adjust the copy, or a one-line follow-up in the proposal. No task currently mentions the frontend at all, apart from 4.3.
- **A6 (note): meaning of "join".** The user's decision was "denied in live sessions (join, vote, live events)". The proposal reads "join" as *session participant registration* and keeps *team* join links open. I agree that is the right reading, and A2 pins it. If the decision was relayed second-hand, confirm it once with the user.

---

## 2. Spec scenarios without a matching verification

Each of these is a scenario or a SHALL in a delta that no task's "Verify" clause exercises.

| # | Spec / scenario | Gap | Suggested fix |
|---|---|---|---|
| S1 | `oidc-role-mapping`, "Escape-equivalent duplicate key stops startup" | **Defective as written.** The spec and the second test in task 1.3 show both keys as the plain `Eng-Managers`, so the JSON escape was lost in rendering. The task's version has even been corrupted to `"…"` values. As written, this test is the same as the first one and never exercises decoding. This is the one part of the S6 duplicate check that matters for security | Write the literal out unambiguously in both the spec and 1.3, e.g. `{"Eng-Managers":"engineering_manager","Eng-Managers":"senior_engineer"}`, and say in prose "the second key uses a `\u` escape" |
| S2 | "Unknown target stops startup" and "Inherited property names": error **lists the permitted targets** | Task 1.2 asserts only that the key is named | Add "and lists the four permitted targets" to the 1.2 assertions |
| S3 | "Non-object value stops startup": array, **string, number**, null | 1.2 tests only array and `null` | Add `"\"x\""` and `1` |
| S4 | "Key with surrounding whitespace" (leading **or trailing**) | 1.2 tests only leading | Add `"Eng-Managers "` |
| S5 | "Production map with no manager target does not boot" (non-empty map) | 1.4 tests only production `{}` | Add the spec's admin + facilitator map |
| S6 | "Empty value in production is treated as unset" | 1.4 says "including empty/whitespace", but only "production unset" is tested | Add production `""` and `"  "` |
| S7 | "Missing-target warning wording": the manager warning says **managers will be treated as engineers** | 1.4 fixes the facilitator wording only | Add the manager wording and assert it |
| S8 | "No summary line on a failed boot" | Neither 1.5 nor 1.6 tests it | In 1.6, assert that `console.info` was not called on the FATAL path |
| S9 | "A real IdP always requires a role map": **an unclassifiable issuer is treated as not local** | No test. It depends on how `isPrivateAddress` handles malformed input | Add a 1.4 or 1.6 case with a malformed `OIDC_ISSUER` |
| S10 | "Missing claim is silent", "Partial match is not warned", and `["", 42, null]` "no role-claim warning" | 2.3 states the rules, but its logger-spy list covers only the cases that *do* warn | Add zero-warn spy tests for missing, partial and all-invalid-array |
| S11 | "Map change without restart has no effect" | No task | Low risk because `config` is a module constant. A one-line review check in 1.6 is enough |
| S12 | "Token refresh does not re-resolve the role" | 2.4 only updates a comment | Add a test that the refresh path does not call `resolveOrCreateAccount`, or point to an existing test that already proves it |
| S13 | `first-access`, "Group-style array claim is mapped" with `OIDC_ROLE_CLAIM=groups` | Unit-level only (2.1). Nothing runs the callback with a non-default claim name and an array | Add one route test in 2.3 with `OIDC_ROLE_CLAIM=groups` and an array claim |

S1 is a must-fix. The others are should-fix, and together they are small: a few lines of test each.

---

## 3. Lost in translation

- **L1:** The `first-access` delta keeps the constraint "Teams MUST NOT be promised EM history access until ... a passing CI test (see tasks 2.3 and 2.4)". That reference points at the *original* change's tasks. In this change, 2.3 and 2.4 are logging and comment updates. When the spec is archived, a reader will follow the wrong pointer. Reword it to name the test, or drop the task reference.
- **L2:** The `local-dev-environment` delta lists `OIDC_ROLE_MAP` among the "optional variables". Task 1.6 says "Do **not** add `OIDC_ROLE_MAP` to `optional`", meaning the code's optional list. Both are correct, but an implementer reading them side by side will stop and ask. Add a half-sentence to 1.6 saying it is optional in the spec sense and read directly so that the empty-means-unset rule and the issuer gate apply.
- **L3:** #243 AC 7 asks for unit tests of `mapRoleClaimToGlobalRole`, and 2.2 deletes that function in favour of `resolveGlobalRole`. Task 6.3 updates the ACs only against the deviations table, and the rename is not in that table. Add the rename to the 6.3 AC update so the issue can be closed against what was built.
- **L4:** #243 AC 9 ("the `first-access` spec is updated") is only met when the delta is synced or archived into `openspec/specs/`. Task 6.4 begins "After archive", but no task performs the archive or sync. Either add it as 6.0 or 6.6, or state that the agent-team workflow's archive stage owns it.
- **L5:** The proposal's Impact section says "No change to ... the API contract". Task 3.4 changes the lock-in error message, and admins become a newly denied class of caller (see A1). Correct the proposal line when A1 is added.

---

## 4. #243 acceptance criteria (as amended by the deviations table)

| #243 AC | Tasks | Status |
|---|---|---|
| Parsed and validated at startup; invalid JSON or unknown target stops the process | 1.2, 1.3, 1.6 | Covered (see S1 to S4) |
| Production fails when unset; amended: also with no manager target, and a non-local issuer without a map fails everywhere | 1.4, 1.6 | Covered (see S5, S6, S9) |
| No map matches today for engineer/EM/admin, plus facilitator and senior_engineer; amended: local issuer only | 1.4, 2.2, 4.1, 4.2 | Covered |
| Arrays work; highest role wins | 2.1, 3.6 | Covered (see S13 for the route level) |
| Unmapped claim warns without the value; amended: missing claim is silent, overage warns | 2.3 | Covered for the warning cases (see S10 for the silent cases) |
| Group change applies at next sign-in; `previousRole` capture works | 3.1 | Covered. The demotion-to-`engineer` audit is an improvement on #243 |
| Unit tests for the mapper and for config validation | 1.x, 2.1, 2.2 | Covered (see L3 for the rename) |
| `docs/deployment.md` with a groups example; `docs/local-development.md` default-map note | 5.1, 4.4 | Covered |
| `first-access` spec updated | delta exists | Covered once archived (see L4) |
| Issue notes: security review, case sensitivity, check existing IdPs before release | 6.1, 5.1, 6.2 | Covered |
| Deviation: admin cannot register, vote or receive live events | 3.4 to 3.6, 5.2, 5.3 | Enforcement covered. Requirements documents not updated (A1) |

---

## 5. Proposal capabilities

Every bullet under "What Changes" and every capability listed under "Capabilities" maps to at least one task:

- configuration and validation: 1.1 to 1.6
- production and issuer rules: 1.4 and 1.6
- warnings and summary: 1.4 and 1.5
- identity default: 1.4 and 2.2
- resolution: 2.1 and 2.2
- logging: 2.3
- discard line: 2.1 and 2.3
- admin exclusion: 3.4 to 3.6
- audit: 3.1 and 3.2
- stub: 4.1 to 4.3
- docs and release notes: 5.1 to 5.3
- security sign-off: 6.1
- IdP release check: 6.2
- follow-ups: 6.5

Things I am glad to see and would not change:

- the explicit 3.4 case where a vote locked in before the user became an admin is still counted
- the honest framing of 4.5 ("pin the observed result" rather than asserting refusal)
- the budget-and-cut rule on the duplicate scanner

---

## Summary of requested changes

**Must fix**
1. **A1:** Add task 3.7 to update the BRD (FR-2.4, Constraint 2 and the Application Administrator role definition), use case 01 and the REST API contract for the admin session exclusion. Correct the proposal's "no API contract change" line (L5).
2. **S1:** Repair the escape-equivalent duplicate-key test literal in both the spec and task 1.3.

**Should fix**
3. A2: test that an admin can still redeem a team join link.
4. A3: test that `participants-roster` and `reveal-latency` deny an admin caller.
5. A4: assert the structured rejection event as well as the audit row.
6. S2 to S10, S12 and S13: add the missing assertions and cases listed in section 2.
7. L1 to L4: fix the stale task reference, the "optional" wording, the AC rename and the archive ownership.

**Consider**
8. A5: decide what an admin sees when they are denied entry to a session, and record it as either a task or a follow-up.
