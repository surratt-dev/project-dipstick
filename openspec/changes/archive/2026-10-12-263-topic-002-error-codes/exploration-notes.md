# Exploration notes: 263-topic-002-error-codes

Perspective: Devon Calloway, Internal Champion. Issue: #263, "TOPIC-002: add machine-readable error codes to its 403 responses".

## 1. Devon's read of the intent

This is not a ritual change. It touches no mechanic (reveal, no-manager participation, facilitator-from-another-team). It does however sit directly on the **facilitator-from-another-team rule's** user-facing edge: `FACILITATOR_IS_TEAM_MEMBER` is the system saying "a facilitator cannot manage topics for a team they belong to." Devon cares that this rule stays structural and that the refusal stays explainable (the code makes that testable; the message does the explaining), so the team does not conclude the tool is broken and go back to a spreadsheet (his "adopt without Devon explaining it" success criterion).

**User impact (added after facilitator review).** Two different people hit the two codes and need different next steps:
- `NOT_A_FACILITATOR`: the caller lacks the role (or holds the EM global role). Next step: ask an admin / a facilitator. Never explain the EM case more precisely than today.
- `FACILITATOR_IS_TEAM_MEMBER`: the caller has the role but is on this team (typically a facilitator handed back to a team they used to run, or covering for someone). Next step: ask a facilitator from another team to run it.
What the person reads is the message, not the code. The code's value is the contract: the frontend (now or later) can tell the two recoveries apart without string-matching prose. Today's member message is "A facilitator cannot view topic management for a team they are a member of." It states the rule but does not name the next step; see 8.3.

So the value to Devon is narrow and real: the frontend can distinguish the two denials by contract (`error.code`) rather than by string-matching prose. A message rewrite would otherwise silently break behaviour. Machine-readable reasons make the rule's enforcement legible and testable, which helps it "outlive him".

What Devon would NOT accept:
- Any change that turns a denial into something negotiable. Codes are labels on a refusal, not a new way through. No new override, no "retry as", no flag.
- Any change in who is denied, status, ordering or timing. Pure labelling. Testable form: for every input in the existing TOPIC-002 denial test matrix, the denied/allowed outcome, status, message and audit row are unchanged. If a request qualifies for both reasons, `decision.reason` is a single value and existing precedence stands (unchanged).

## 2. Ritual constraints in play

| Constraint | Relevance | Risk if design drifts |
|---|---|---|
| Facilitator from another team (hard block, not silent) | `FACILITATOR_IS_TEAM_MEMBER` is the denial for it on TOPIC-002 | Collapsing the two codes, or reusing a generic code, makes the block less explainable. Moving to "warn only" must never fall out of a refactor of this branch. |
| No-manager rule | EM global role gets `NOT_A_FACILITATOR` on TOPIC-002 (spec: "Engineering managers by global role") | A distinct EM-specific code would be tempting but is out of scope and would reveal role more precisely than needed. Keep the same two codes. |
| Not a performance tool / access-control hygiene | Denial responses are a probe surface | Codes must not leak more than the message already does. Testable statement: the set of distinguishable denial reasons on TOPIC-002 is unchanged, exactly two, and the two messages already differ today (content.ts ~L900), so the code adds no information. |
| Constraints structural, not configurable | The denial path has no flag | Do not add a config for "which codes are emitted". |

## 3. What the code actually looks like today

- `packages/backend/src/routes/error-envelope.ts`: `buildErrorEnvelope(category, message, code?, field?)`. Key order of the output is `category`, `code`, `field`, `message`, `correlationId`. Note: `code` is inserted before `message`. This matters for the byte snapshot (below).
- `packages/backend/src/routes/content.ts`, TOPIC-002 handler (~L845-905, the `!decision.authorized` branch): after the #264 audit step (`runDenialAuditStep`, then `emitAuditEvent`), then `applyTimingFloor`, then an **inline** 403 body with `category`, `message`, `correlationId` and a ternary on `decision.reason` for the message. Note `decision.reason` is already typed to exactly the two names, and it is already used as the audit `metadata.reason`.
- `topics.ts` already does `buildErrorEnvelope("forbidden", message, decision.reason)` for TOPIC-004/005 (~L481, L518) and `NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER` literals in `checkStandingFacilitatorAuthorization` (~L127, L137). So the pattern exists, and TOPIC-002 is the odd one out. The change is essentially "make TOPIC-002 look like its siblings".
- Frontend `TopicManagementPage.loadTopics` (~L677): 403 branch shows `body.error.message` via `hasEnvelopeMessage`. Already has `hasEnvelopeCode(body, code)` (used for 404 `TEAM_NOT_FOUND`, #265) so a code branch has an existing, tested idiom. The issue says branching is optional.
- Docs that currently say the reasons are NOT fields: REST API Contract ("Reason names ... are internal labels, not envelope fields; the 403s differ only in error.message", just under TOPIC-002's error table) and `openspec/specs/topic-customization-lock/spec.md` ("**Reason names are internal labels.**" paragraph, ~L125). Those become false and must go.

## 4. Things the issue underplays or gets wrong (worth surfacing to the team)

### 4.1 The "existing tests pass unmodified apart from added code assertions" criterion collides with a byte snapshot
`content.test.ts` has "403 baseline snapshot (#264 task 0.2)" (~L1336). It replaces the correlationId with a placeholder and compares the **whole body string** to a committed snapshot. Adding `code` changes the bytes (and its key order is fixed by `buildErrorEnvelope`: `category, code, message, correlationId`). So the committed `baseline403` fixture has to be regenerated, a modification beyond "added assertions". **Decision: regenerate the fixture; do not soften the criterion.** Replacement criterion: existing tests pass unmodified, except the #264 baseline 403 fixture, which is regenerated. The fixture diff consists solely of inserting `"code":"<REASON>"` between `category` and `message` in each of the two bodies (two insertions). Status, `content-type`, `Cache-Control: no-store`, message text, audit row and query counts are byte-identical. Reviewer verifies by diff. Key order is incidental to the JSON contract; only the fixture pins it. Also: `content-type` and status in the snapshot must stay identical. That is the real "nothing else moved" proof.

### 4.2 Issue item 2 (correlation id) is live, not conditional, and it conflicts with another criterion
The issue says item 2 applies "only if #264 adds a durable denial row first". #264 has merged (commit 6d7627f). The denial row exists. But:
- `insertTopic002DenialAuditRow` writes `metadata = { endpoint, http_status, reason }`. No correlation id column or key.
- Passing the envelope's correlationId into the row means adding a key to `metadata` (or to the event). That is an audit-row **content** change, and the acceptance criteria say "no ... audit-row ... behaviour changes".
- The audit step runs before the floor and before the send, and today the correlationId is generated at send time (`crypto.randomUUID()` inline). To correlate, the envelope has to be built before the audit step (as `checkWritableTeam` does at topics.ts ~L208: "Envelope first, so the audit's correlationId matches the response").

Options:
1. Out of scope: build the envelope at the send site, leave audit row and event untouched. Smallest, honours the "no audit-row change" criterion literally. Loses the correlation benefit.
2. Build envelope first and add `correlationId` to the structured **event** only (log-only, `emitAuditEvent`), not the durable row. Sibling behaviour in topics.ts passes it to the event and the failure log, so this has precedent. No DB shape change. Changes the event payload, which tests may assert exactly.
3. Add to the durable row `metadata`. Most useful for incident review, but a schema-adjacent behaviour change; `metadata` is JSONB so no migration, but the SQL parameter and its tests change and the #264 spec pins the row's shape.

**Decision: option 1, out of scope (agreed with BA review).** Only option 1 keeps "no audit-row behaviour changes" literally true; 2 and 3 amend that criterion and 3 reopens the #264 row-shape contract, for a benefit nobody has asked for. The audit trail's job here (spot probing) works without the id. Follow-through so this is a decision, not a silent drop:
- The proposal's out-of-scope section states that audit row, audit event payload and correlation linkage are unchanged, and why.
- Issue item 2 is closed explicitly as "not done, deliberately: #264 merged, linkage not requested".
- A follow-up issue is filed for option 2 (event-only correlation id, the cheap and precedented variant), with Security named as the trigger. Record its number in the proposal.
- Security is recorded as informed, not as approver. If sign-off is wanted, ask it before the proposal stage.
Facilitator review point on support lookup ("it said forbidden, I'm a facilitator"): the response already carries a `correlationId`, and the audit row has endpoint, status, reason and timestamp, which is enough for support to find a facilitator's denial by user and time. That is why option 1 is acceptable. Pushback: I do not add UI to surface or copy the id; that is frontend scope.

### 4.3 Timing floor and ordering
Building the envelope (a `crypto.randomUUID()` call and an object) before or after the floor makes no measurable difference, but ordering is a documented contract ("The insert never sits between the floor and the send"). Keep: audit, event, floor, send. Build the envelope at the same place the body is built today unless option 4.2(2/3) is picked.

### 4.4 Code derivation: avoid a second mapping
Today the message is chosen by `decision.reason === "FACILITATOR_IS_TEAM_MEMBER" ? ... : ...` and the audit uses `decision.reason` as a string. The code should be `decision.reason` itself (as topics.ts does), not a new parallel ternary. One source of truth means the code, the audit `metadata.reason` and the message can never disagree. Add a test that asserts `error.code === audit metadata.reason` for both.

### 4.5 The `Cache-Control: no-store` header
`noStore(reply)` is applied today and must remain. A test asserts it indirectly via the snapshot; keep it explicit.

## 5. Decisions in the issue, from Devon's chair

1. **Reuse the existing two codes.** Agree. Same reason, same code, across TOPIC-002..007. A new code for the same refusal would fragment the vocabulary the frontend learns once.
2. **TOPIC-001 stays out.** Agree, strongly. `denyAccess()` is deliberately a single generic body (authorization before lookup, Decision 7). Giving it codes would let a caller distinguish "no grant" from "EM denied" from "admin denied", which is information about roles and about the no-manager rule's enforcement that the generic message exists to withhold. Note TOPIC-001 has a second inline 403 (admin: "Application Admins do not have access to session content.") that also has no code; also out of scope, same reasoning, and it is already distinguishable by message, which is a pre-existing wart not for this change. Name it explicitly in the proposal's "Out of scope" (TOPIC-001's second 403, the admin message, by name) and record that this is deliberate, not an omission, so a later sweep does not "fix" it blindly.
3. **No shared-package type.** Agree. Keep `error.code` read ad hoc. A shared enum is a bigger decision (and a place where someone later adds a "SKIP_FACILITATOR_CHECK" member).

## 6. What could go wrong

- Code strings drift between backend (`decision.reason`), docs and frontend. Mitigation: derive from `decision.reason`; one parametrised test over both reasons asserting `error.code`, `error.message`, `error.category` and status.
- The "internal labels" sentences survive somewhere. Mitigation (as acceptance, not process): after the change, a grep for `internal label` and `reason name` across `openspec/specs` and `requirements/design` returns no sentence saying reasons are not envelope fields. Known hits to fix: topic-customization-lock spec, REST API Contract near the TOPIC-002 error table. Note: `team-content-access/spec.md` has the TOPIC-002 403 scenario (~L241) that mentions `metadata.reason`; its 403 scenarios need `error.code` added.
- Frontend branches on code and loses the fallback. Mitigation: keep generic fallback; if copy is branched, `FACILITATOR_IS_TEAM_MEMBER` copy should explain the rule's reason in ritual terms ("a facilitator must come from another team"), not just repeat the refusal. But optional, and a message-only fallback must keep working for a non-JSON 403 (proxy page).
- Someone treats the code as an authorization input client-side (e.g. hide UI based on code). Mitigation: add to the REST API Contract text: "`error.code` is advisory for display only; the server is the sole authority."
- Frontend loses loaded data on a 403. Not changed here (frontend untouched), but record the existing behaviour as the bar for any later change: a denial, including one from a refresh while a session is live (membership changed mid-session), keeps already-loaded topics and shows the error alongside; it must never look like data loss. Check the current `loadTopics` behaviour while verifying, and file a bug rather than fixing it here if it clears the list.
- Scope creep into the 47 other `code(403)` sites. Explicitly out.
- Documentation drift: REST API Contract TOPIC-002 403 row needs the two codes as a list; Validation Report may mention the labels.

## 7. Suggested shape of the change (for the proposal stage)

- Backend: replace the inline body with `buildErrorEnvelope("forbidden", message, decision.reason)`; message strings byte-identical. Hoisting messages to named constants is dropped (refactor, widens the diff; "ideally" is not a requirement). Envelope is built at the send site, so audit step, event, floor, send keep their order. The 404 `TEAM_NOT_FOUND` path (#265) is not touched (confirm it is a separate branch when implementing).
- Code mapping (normative): `NOT_A_FACILITATOR` for a caller without the facilitator role, including the EM global role; `FACILITATOR_IS_TEAM_MEMBER` for a facilitator who is a member of the target team. These are exactly the members of `Topic002DenialReason`. The admin arm is admitted (per #208), so it produces no denial and no code. Verify the admin claim against the handler before the proposal states it.
- Consistency claim: "same reason, same code" is evidenced for TOPIC-004/005 (topics.ts). Verify 003, 006, 007 before the proposal repeats it, or narrow the claim to what was checked.
- Tests (content.test.ts): parametrised over both reasons asserting status 403, content-type, `Cache-Control: no-store`, `error.category`, `error.code`, exact `error.message`; `error.code` equals the audit row's `metadata.reason`; baseline fixture regenerated per 4.1. No audit-row, query-count or timing-floor assertion is edited. Add one handoff-story test name/scenario: a facilitator who is a member of the team gets `FACILITATOR_IS_TEAM_MEMBER` (the returning-facilitator case).
- Frontend: unchanged (see 8.3). Acceptance: no frontend file modified; no shared-package change.
- Specs: delta for `topic-customization-lock` (remove "internal labels" paragraph, scenarios assert `error.code`) and `team-content-access` (the TOPIC-002 403 scenarios, ~L241, as WHEN/THEN with the literal code). The proposal lists the exact scenarios touched. REST API Contract TOPIC-002 error table lists the two codes.
- Done gate: `openspec validate --strict`, lint, test, build all pass in CI.

### Acceptance conditions (consolidated)

1. Denied non-facilitator or EM: 403, category "forbidden", `error.code` "NOT_A_FACILITATOR", message unchanged, `no-store`.
2. Denied team-member facilitator: same shape, `error.code` "FACILITATOR_IS_TEAM_MEMBER", message unchanged.
3. `error.code` equals audit `metadata.reason` and is sourced from `decision.reason` with no second mapping.
4. Audit step, event, timing floor and send keep their order; no audit/event/query-count assertion changes.
5. Baseline fixture diff is exactly the two added `code` members.
6. No change to TOPIC-001, any `code(403)` site outside TOPIC-002, the frontend, or the shared package.
7. No new config, flag, override or alternate path through the denial. (Keep verbatim: the guard against softening the facilitator-from-another-team block.)
8. Specs and REST API Contract state the codes; "internal labels" language gone; done gate passes.

## 8. Open questions, resolved

1. **Correlation id: option 1, out of scope.** See 4.2. Follow-up issue for the event-only variant, Security informed.
2. **Snapshot fixture: regenerate, with a strict diff criterion.** See 4.1.
3. **Frontend branching: not in this change.** Reasons: the issue marks it optional; the gate I set ("only if the copy genuinely explains the rule") needs approved copy and none exists; the frontend already shows `body.error.message`, so a UI change is unrequested behaviour. Facilitator review is right that the current member message states the rule but does not name the next step ("ask a facilitator from another team"). I take that seriously, but the fix is a copy decision (message text and possibly a code branch), and changing the message here would break the "message unchanged" labelling guarantee and widen scope past #263. So: file a follow-up issue, "TOPIC-002 / topic management: next-step copy for FACILITATOR_IS_TEAM_MEMBER and NOT_A_FACILITATOR", owner for copy review Devon, with the requirements the facilitator review set: names the next step in plain English (read by a non-engineer), inline in the existing error area (no modal, banner or tooltip), announced like the existing 403 text (role=alert), generic fallback and non-JSON 403 (proxy page) still usable and still telling the user who to contact, and a 403 on refresh never clears loaded topics. Proposal wording: "Frontend is unchanged. The code is now available for a later copy change." The follow-up issue is filed before this change merges so the guidance is not lost.

Pushbacks, for the record:
- Facilitator's "make the branch conditional on copy review; if the message lacks the next step, do it now": declined for this change, for the reason above. The follow-up carries it.
- Marking which calls return these codes: TOPIC-002 is the topic list read, so a denial surfaces at page load, before any edit begins. Edit calls are other topics (004/005, unchanged). Confirm when writing the proposal.
- Whether a facilitator from another team can reach the page without friction is a separate existing behaviour (#208 and siblings), not this change; note it as a question for the follow-up.
- Naming an admin or other facilitator in the message: declined; it would leak role information. A static "ask a facilitator from another team" is the model.

## 9. Escalation note

Nothing here needs Devon as a decision-maker. The only item he would want to hear about is anything that makes the facilitator-from-another-team block softer or silent; this change does not.
