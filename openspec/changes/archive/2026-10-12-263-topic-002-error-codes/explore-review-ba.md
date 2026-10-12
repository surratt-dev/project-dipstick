# BA review of exploration notes: 263-topic-002-error-codes

Reviewer: Marcus Delgado, Senior Business Analyst
Scope: Is the exploration specific enough to become requirements? Where is it vague? What are the acceptance conditions?

## Verdict

Mostly buildable. The core requirement (TOPIC-002 403s carry `error.code` equal to `decision.reason`, nothing else moves) is clear and traceable. The weak spots are the three open questions, the acceptance wording around "nothing else moved", and a few untestable phrases. Recommendations on the open questions are in section 1.

## 1. Recommendations on the open questions

### 1.1 Correlation id: choose option 1 (out of scope)

- Option 1 is the only one that keeps the stated acceptance criterion ("no audit-row behaviour changes") literally true. Options 2 and 3 each need that criterion amended, and 3 also reopens the #264 row-shape contract. I would not trade that for an unrequested benefit.
- No stated user need for forensic linkage exists. The notes say "if Security wants it". Absent that, it is speculative.
- Required follow-through (this is what makes option 1 a decision rather than a deferral):
  - The proposal's out-of-scope section states that audit row, audit event payload and correlation linkage are unchanged, and says why.
  - The issue's item 2 is marked "not done, deliberately; #264 merged but linkage not requested". The notes call it "live, not conditional", so the proposal must close it explicitly, not silently drop it.
  - A follow-up issue is filed (title and link recorded in the proposal) so the decision is traceable. Security is named as the party who would trigger it.
- Open clarification: the notes say this needs "BA and Security", but no Security persona has weighed in. I am making the BA call; the proposal should record Security as informed, not as having approved. If the team wants Security sign-off, it is a one-line question and should be asked before proposal, not after.

### 1.2 Snapshot fixture: regenerate it, do not reword the criterion

- The criterion "existing tests pass unmodified apart from added code assertions" is wrong as written, because a byte-for-byte fixture cannot absorb a new key. Rewording it to something softer ("tests pass") loses the point. Replace it with a stronger, testable form.
- Suggested rewrite of the criterion:
  > Existing tests pass unmodified, except the #264 baseline 403 fixture, which is regenerated. The fixture diff must consist solely of the insertion of `"code":"<REASON>"` between `category` and `message` in each of the two bodies. Status, `content-type`, `Cache-Control: no-store`, message text, and the audit row and query counts are byte-identical to the prior baseline.
- Acceptance conditions:
  - AC: the PR diff of the fixture shows only the added `code` member, two occurrences (one per reason). Reviewer verifies by diff, not by trust.
  - AC: the test asserts status, content-type and `no-store` explicitly, not only via the snapshot (notes 4.5 already imply this; make it a requirement).
  - AC: no audit-row assertion, query-count assertion, or timing-floor assertion is edited.

### 1.3 Frontend branching: later, not now

- Reason: the issue says branching is optional, and the notes' own gate ("only if the copy genuinely explains the rule") is not met. No copy has been written or approved. A requirement without agreed copy is not a requirement.
- The value this change delivers is the contract. The frontend today shows `body.error.message`, which is already correct text for both cases. Behaviour change in the UI would be unrequested.
- Proposal wording: "Frontend is unchanged. The code is now available for a later copy change; that change needs its own approved text for `FACILITATOR_IS_TEAM_MEMBER`." Record it as a follow-up with an owner (Devon is the natural reviewer of the copy).
- If the team overrides me and does it now, then the following must be specified before it can be built: exact user-visible copy for each code, and which component renders it. See section 3.

## 2. Vague or untestable phrases to fix

| Where | Phrase | Problem | Suggested rewrite |
|---|---|---|---|
| 1 | "a caller who trips it understands why" | Not testable on a backend-only change; it is a UX outcome | Drop from requirements, or restate as: "the 403 body carries a code that uniquely identifies the refusal reason" |
| 1 | "Pure labelling" / "any change in who is denied, status, ordering or timing" | Good intent, no check | "For every input in the existing TOPIC-002 denial test matrix, the denied/allowed outcome, status, message and audit row are unchanged." Name the matrix (the existing tests) |
| 2 table | "Codes must not leak more than the message already does" | Claim of "verified in section 4" but section 4 contains no verification | Add a testable statement: "The set of distinguishable denial reasons on TOPIC-002 is unchanged: exactly two, as before." Either point at the evidence or remove the claim |
| 6 | "one test table of reason -> code -> message" | Fine in idea; not located | State the test: parametrised over both reasons, asserts `error.code`, `error.message`, `error.category`, status |
| 6 | "grep for `internal label` and `reason name`" | Process step, not an acceptance condition | AC: a grep for those phrases across `openspec/specs` and `requirements/design` returns zero hits in the sentence form that says reasons are not envelope fields. List known hits (topic-customization-lock spec, REST API Contract) |
| 7 | "messages unchanged and ideally hoisted to named constants" | "ideally" is not a requirement | Decide. Either require constants (and a test that spec strings match) or drop the hoisting as out of scope. I recommend drop: it is refactoring, not labelling, and widens the diff |
| 7 | "Run `openspec validate --strict`, lint, test, build" | Fine, but state it as the done gate | AC: all four pass in CI |
| 6 | "Frontend ... non-JSON 403 (proxy page) must keep working" | Only relevant if the frontend changes | Moot under 1.3; if the frontend is untouched, add AC: no frontend file modified |
| 6 | "Someone treats the code as an authorization input client-side" | Risk with no mitigation beyond a sentence | Add to the REST API Contract text: "`error.code` is advisory for display only; the server is the sole authority" |

## 3. Clarifications needed

1. Exact code strings and where they are normative. The notes say "the two codes" but the requirement should list them verbatim: `NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER`. Confirm these are exactly `decision.reason`'s union members and that the proposal states a mapping: which condition produces which (EM global role and non-facilitator produce `NOT_A_FACILITATOR`; a facilitator who is a member of the team produces `FACILITATOR_IS_TEAM_MEMBER`). Is that the complete mapping? Admin on TOPIC-002 falls under which? State it.
2. "Same reason, same code, across TOPIC-002..007" is asserted as agreement. Is it already true for 003, 006, 007? The notes only evidence topics.ts for 004/005. Verify and record, or narrow the claim to what was checked. Otherwise the consistency requirement is unverified.
3. Which spec scenarios change? The notes name `team-content-access` (~L241) and `topic-customization-lock` generally. The proposal needs the exact list of scenarios gaining `error.code`, otherwise the delta spec is unbounded. Each should be a WHEN/THEN with the literal code.
4. Does the 404 `TEAM_NOT_FOUND` path (#265) sit on the same handler? Confirm the change does not touch it, and state so.
5. Key order. The notes make the byte order `category, code, message, correlationId` an effect of `buildErrorEnvelope`. Is key order part of the contract? I assume not (JSON), but the fixture does depend on it. State that order is incidental to the contract and only the fixture pins it.
6. TOPIC-001's second 403 (admin message). Marked "pre-existing wart, not for this change". Fine, but the proposal should list it in out of scope by name so it is not rediscovered as a gap.

## 4. Suggested acceptance conditions (consolidated)

Given the recommendations above:

1. WHEN a user who is not a standing facilitator, or who holds the EM global role, calls TOPIC-002 and is denied, THEN status 403, `error.category` "forbidden", `error.code` "NOT_A_FACILITATOR", `error.message` unchanged from today, `Cache-Control: no-store`.
2. WHEN a facilitator who is a member of the target team calls TOPIC-002, THEN the same, with `error.code` "FACILITATOR_IS_TEAM_MEMBER" and its existing message.
3. For both, `error.code` equals the audit row's `metadata.reason` (test asserts equality; code is sourced from `decision.reason`, with no second mapping).
4. Audit step, event emission, timing floor and send keep their current order; no audit-row, audit-event or query-count assertion changes.
5. The baseline fixture diff is exactly the two added `code` members.
6. No change to TOPIC-001 responses, to any `code(403)` site outside TOPIC-002, to the frontend, or to the shared package.
7. No new config, flag, override or alternate path through the denial.
8. REST API Contract, `topic-customization-lock` and `team-content-access` specs state the codes; the "internal labels" language is gone; `openspec validate --strict`, lint, test and build pass.

## 5. Traceability notes

- Requirement source: issue #263, item 1 (codes), item 2 (correlation, closed as out of scope), item 3 (frontend, deferred).
- Ritual link: facilitator-from-another-team hard block. Acceptance condition 7 is the guard against any softening; keep it in the proposal verbatim, since this is the one thing I would not want lost.
- Edge case I did not see covered: a request that is denied for both reasons simultaneously. `decision.reason` is a single value, so the existing precedence stands. Add one sentence naming it ("precedence is unchanged") or point to the spec statement that defines it.
- Notes section 1 and 9 speak for Devon. Those are persona opinion, not requirements; the proposal should cite them as rationale only.
