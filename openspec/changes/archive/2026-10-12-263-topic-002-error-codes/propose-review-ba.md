# Proposal Review (BA): 263-topic-002-error-codes

*Reviewer: Marcus Delgado, Business Analyst. Inputs: `proposal.md`, both spec deltas, issue #263 (body and rescope comment), the REST API Contract and current `topic-customization-lock` spec.*

## Verdict

**Approve with required clarifications (3 must-fix, 5 should-fix).** The change is small and well bounded. The ritual-adjacent concern (facilitator from another team stays a hard block) is protected and I have no objection on product grounds. The two deliberate deviations from the issue are justified (see below). The gaps are about testability wording: a few acceptance criteria are implicit or contradict each other, and a few phrases will make an implementer ask "what did you mean".

## Are the capabilities specific enough to implement?

Mostly yes. There is one capability: "TOPIC-002 non-admin 403 carries `error.code`". It names the endpoint, the two values, the category, the source of the value (`decision.reason`), and what must not move. That is buildable.

Two spec-delta statements need to be pinned down because they are the places an implementer would guess.

### Must-fix

**M1. AC5 contradicts the issue's acceptance criteria and the spec deltas.**
AC5 says existing tests pass unmodified except the fixture. Issue #263 says "existing TOPIC-002 tests pass unmodified apart from the added `code` assertions" and "unit tests in `content.test.ts` assert `error.code` and the exact `error.message` for both reasons". The proposal's Impact section lists `content.test.ts` as changed, and the deltas add or alter scenarios. So tests are being added or extended. State it plainly:
- "No existing assertion is edited or removed. New assertions and new tests are added."
- Name the tests: (a) EM global role, (b) caller with no facilitator role, (c) facilitator who is an active member, (d) returning-facilitator test by name. Each asserts `status`, `error.category`, `error.code`, exact `error.message`, and `Cache-Control: no-store`.
- Reconcile "regenerated fixture" with "no assertion edited": the baseline test reads the fixture, so it stays green only if the fixture is regenerated. Say that explicitly so the reviewer does not read it as a loosened test.

**M2. "Taken from `decision.reason` with no parallel ternary or second mapping" (AC3) is not verifiable as written.**
Give a concrete condition. Suggested: "The 403 body for both reasons is produced by one call, `buildErrorEnvelope("forbidden", message, decision.reason)`, and the type of `decision.reason` is the two-member union. A test (or type-level check) fails to compile or fails at runtime if a third reason is added without a message." If a code review is the only check, say "verified by review of the diff" instead of implying automation. Also decide: is `message` still chosen by a branch on reason? The proposal says messages are unchanged and not hoisted, so a message branch will remain. Say that this branch is the only one, and that code never derives from the message.

**M3. Failure-path behaviour is unspecified for the code.**
The deltas say the baseline holds "with the audit succeeding or failing". Does a failed denial-audit insert still return the 403 with the code, or does it return 500 (fail-closed is the admin-read rule only)? State the current behaviour and assert the code is present on the 403 in both cases. Otherwise the implementer may add the code only on the happy branch.

### Should-fix

**S1. Vague language to replace.**
| Phrase | Problem | Replace with |
|---|---|---|
| "Pure labelling" | not testable | "Adds exactly one member (`code`) to `error`; every other response byte and header is equal" |
| "unchanged ... timing" | no measure | "the floor value and its position in the call order are unchanged; existing floor tests untouched" |
| "a reviewer verifies by diff" (AC5) | only as good as the reviewer | add: the baseline test does a string-equality check against the regenerated fixture, so drift fails CI |
| "advisory for display only" | could be read as "clients may ignore it" or "must not branch on it" | "Clients MUST NOT use `error.code` to grant, unlock or hide an access decision. Clients MAY use it to choose display text." |
| "discloses no more than the two distinct messages already do" | a claim, not a condition | add a scenario or test asserting the set of distinguishable 403 bodies for TOPIC-002 non-admin callers is exactly two |
| "no way through it" | negative, open ended | list the probes: no request header, query param or body field alters the outcome. One negative test with a spurious `X-...` header and query is enough |
| "named test covers the returning-facilitator case" | name not given | give the test title |
| "roughly 47 `code(403)` sites" | unverified count | "all `code(403)` sites other than TOPIC-002 non-admin" |

**S2. Incomplete delta scenarios.**
- "A caller who is neither a standing facilitator nor an admin is rejected" has no `category` or `code` assertion. Add `error.code` "NOT_A_FACILITATOR". This is the main participant case and should not rely on the EM scenario.
- Scenario "A participant gets the same code for an existing and a non-existent team" should name the post-#265 context: a canonical UUID with no team is a 403 for this caller (authorization before lookup) and a 404 `TEAM_NOT_FOUND` only for authorized callers. Make that link explicit so the two changes are not read as conflicting.
- Add a scenario that an Application Admin (the 200 path, no 403) response is unchanged and carries no `code` member. Cheap guard against code leaking into success bodies.
- Add the template-team or archived-team case only if they can reach the 403 branch; if they cannot, state so in the design to close the question.

**S3. Contract and doc criteria (AC8).**
The grep condition names `internal label` and `Reason names`. The actual sentences are `Reason names are internal labels.` in `openspec/specs/topic-customization-lock/spec.md` (line 125) and `Reason names (...) are internal labels, not envelope fields` in `requirements/design/REST API Contract.md` (line 700). Good, but also grep for "differ only in `error.message`" since the contract sentence continues with that claim, which becomes false. Specify what the Contract's TOPIC-002 error table gains: two rows or a Code column, with the code, the message, and the trigger.

**S4. The `engineering_manager` case wording.**
"A caller without the role (or holding the engineering-manager global role) should ask an admin or a facilitator" is in the Why section but AC1 says "non-facilitator or global engineering manager". Align: an EM who is also a standing facilitator is a corner case. State which code that person gets (by the existing decision order). One scenario, one line.

**S5. Follow-up filing.**
Follow-up 1 says "filed before this change merges". Make this an explicit task with an owner, not a note, since it is the only home for the next-step copy requirements. Same for follow-up 2 (correlation id) since the issue item is being closed as "not done".

## Judgment on the deliberate deviations

### Correlation id (issue item 2): not done. Justified.
- The issue itself made item 2 conditional ("applies only if #264 adds a durable denial row first"). #264 did, so the condition is met, and the proposal says so honestly rather than hiding it.
- The reasoning is sound: linking requires either a new audit `metadata` key or an event payload change. That conflicts with the issue's own "no audit-row behaviour changes" and with the pinned row shape from #264. Two of the issue's constraints beat one conditional nicety.
- Support impact is acceptable: the row has user, endpoint, status, reason and timestamp.
- Conditions I would add so this stays a decision and not a drop:
  1. Close issue item 2 with an issue comment, not only in the proposal.
  2. File follow-up 2 with a named trigger (Security request, or first support case where user-and-time lookup failed).
  3. Security "informed" is fine for non-approval, but the proposal says "if sign-off is wanted, ask before implementation". Record who decides that. I recommend: the owner makes the call before the implement stage starts, so it is not left open.

### Frontend (issue item 3, optional): not done. Justified.
- Issue wording is "Optionally, branch on `error.code`". Skipping is within scope.
- No approved copy exists, and inventing copy in an engineering change is the larger risk. `TopicManagementPage` already displays `error.message` on 403, so no user-visible regression.
- My concern is user value: the user-facing benefit of this change is nil until the follow-up copy ships. The Why section leans on "a team that has never spoken to me does not conclude the tool is broken", but the message text that serves that goal is unchanged. Be candid in the Why section that this change is API consistency and testability; the user-facing improvement is the follow-up. Otherwise a reader will expect a UX change.
- The follow-up 1 requirements (plain English, inline, `role="alert"`, fallbacks, refresh does not clear topics) are good and traceable to the facilitator review. Keep them.

### Other deviations I checked
- TOPIC-001 left generic: agrees with the issue's recommendation (Decision 2) and with the authorization-before-lookup principle. The pre-existing inline admin 403 on TOPIC-001 being left uncoded is called out as a wart; I would file it as a tracked item rather than leave it as prose.
- No shared type: agrees with the issue's Decision 3.

## Traceability

The proposal states no BRD or `requirements/` document mentions TOPIC-002 error codes, other than the REST API Contract, which it does edit. That is correct for the BRD. The chain is: issue #263, BA review V2 of #232, to the two specs and the Contract. It is traceable. No ritual requirement (simultaneous reveal, facilitator control surface, topic history) is touched.

## Missing edge cases ("but what happens when...")

1. Facilitator is a member in a removed or inactive state. Is that `FACILITATOR_IS_TEAM_MEMBER`? The spec says "active member". Add a scenario for a removed membership (expected: not blocked, i.e. 200). Existing admin scenario covers removed membership for admins but not for facilitators.
2. Deactivated team plus facilitator-member: which reason wins? Probably unchanged, but pin it.
3. Client receives a code it does not know in future. Not this change, but the Contract sentence "advisory" should say unknown codes must fall back to `error.message`.

## Acceptance criteria rewritten as concrete conditions (suggested)

1. Given a caller with no facilitator role (participant, or global EM), when GET `/api/v1/teams/:teamId/topics/all`, then status 403, `error.category` "forbidden", `error.code` "NOT_A_FACILITATOR", `error.message` equal to the current text, `Cache-Control: no-store`.
2. Given a standing facilitator with an active membership on the team, same request, then 403, `error.code` "FACILITATOR_IS_TEAM_MEMBER", message unchanged. Test title fixed in tasks.
3. For each case above, the single denial audit row's `metadata.reason` equals `error.code`, and the body is built by one `buildErrorEnvelope(..., decision.reason)` call.
4. Given the denial audit insert fails, the response is the same 403 with the code (or state the actual current behaviour).
5. Call order (insert, event, floor, send), query counts, floor value: existing assertions unedited; new assertions added only for `code`.
6. Baseline fixture regenerated; diff is exactly two inserted `"code"` members; baseline test passes by string equality.
7. No change to TOPIC-001, other 403 sites, frontend, or shared package (verified by `git diff --stat` file list).
8. No new config or flag. Negative test: spurious header/query/body fields do not alter the outcome.
9. Contract and both specs list the codes; the "internal label" and "differ only in `error.message`" sentences are gone; `openspec validate --strict`, lint, test and build pass.

## Summary of requested changes

Must: M1 (AC5 vs issue and tests), M2 (verifiable single-source condition), M3 (audit-failure path).
Should: S1 to S5, plus the three edge cases and the candour edit in the Why section.
