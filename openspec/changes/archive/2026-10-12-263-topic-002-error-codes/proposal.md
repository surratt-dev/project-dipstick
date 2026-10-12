# Proposal: 263-topic-002-error-codes (#263)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (section 8 resolutions) with `explore-review-ba.md` and `explore-review-facilitator.md`. Traceability: issue #263 and the openspec specs `topic-customization-lock` and `team-content-access`; no BRD or `requirements/` document mentions TOPIC-002 error codes.*

## Why

Honest framing first: **until the next-step copy follow-up ships, this change is API consistency and testability, not a user-visible improvement.** The message text a person reads is unchanged, and no frontend file moves. Nobody sees a difference on screen.

What it does buy: TOPIC-003..006 already return these two reasons as `error.code` (verified in `topics.ts`: add, archive, restore and reorder each call `buildErrorEnvelope("forbidden", message, decision.reason)`). TOPIC-002 builds its 403 body inline with no code, and two documents say that is by design ("reason names are internal labels"). This change makes TOPIC-002 look like its siblings, lets a client tell the two refusals apart without matching prose, stops a later rewording of a message from silently changing behaviour, and makes the rule's enforcement testable.

It sits next to one rule I care about: a facilitator must come from another team. `FACILITATOR_IS_TEAM_MEMBER` is the system saying "a facilitator cannot manage topics for a team they belong to". That block stays structural. The two denied people need different next steps (no role: ask an admin or a facilitator; facilitator who is now a member, typically handed back to a team they used to run: ask a facilitator from another team). Serving them properly needs copy, which needs an approved copy decision; that is follow-up 1, and the code is its prerequisite.

## What Changes

- TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`) 403s to non-administrators carry `error.code`: `NOT_A_FACILITATOR` or `FACILITATOR_IS_TEAM_MEMBER`, with `error.category` "forbidden".
- The 403 body for both reasons is produced by one call, `buildErrorEnvelope("forbidden", message, decision.reason)`. `decision.reason` is already typed to the two-member union and is already the audit `metadata.reason`. The code is never derived from the message.
- Labelling only: the response gains exactly one member (`error.code`). Every other response byte and header is equal; who is denied, message text, the timing-floor value and its position in the call order, the denial audit row, the structured event and the call order (insert, event, floor, send) are unchanged.
- The #264 committed 403 baseline fixture (`fixtures/topic-002-403-baseline.json`) is hand-edited, not regenerated, and its "never regenerate" comments are updated to record the deliberate change. Its diff is exactly two insertions of `"code":"<REASON>"` between `category` and `message`.
- Failure path, stated from the code: the denial audit is **fail-open** (#264 D3). A failed or timed-out denial insert never changes the 403, so the response is the same 403 with the same code whether the insert succeeds or fails. Only the insert is wrapped; anything else on the denial path that throws (helper call, floor, send) is still a 500 and returns no 403 at all. This change does not alter either behaviour. (The admin arm is fail-closed; it has no 403 and is untouched.)
- Docs: the "internal labels" sentences in the `topic-customization-lock` spec and the REST API Contract are replaced. The contract's TOPIC-002 403 rows gain the code (a Code column: code, message, trigger) and state: clients MUST NOT use `error.code` to grant, unlock or hide an access decision; clients MAY use it to choose display text; an unknown code falls back to `error.message`; the server is the sole authority.

## Ritual constraints preserved

- **Facilitator from another team.** Stays a hard 403, never a warning, never silent. The code is a label on the refusal, not a way through it. No override, no "retry as", no flag, no configuration for which codes are emitted. Probes: no request header, query parameter or body field alters the outcome (one negative test sends a spurious header and query).
- **No-manager rule.** The engineering-manager global role keeps `NOT_A_FACILITATOR`. No EM-specific code: that would reveal role more precisely than today. (`global_role` holds one value, so a global EM is never also a standing facilitator; a facilitator who holds an engineering-manager *membership* role on the team is a member and gets `FACILITATOR_IS_TEAM_MEMBER`, per the existing "any membership role" rule.)
- **Not a performance tool / probe surface.** The set of distinguishable denial reasons on TOPIC-002 is unchanged, exactly two, and their messages already differ today, so the code adds no information. A test asserts the set of distinguishable 403 bodies for non-admin callers is exactly two. Naming an admin or another facilitator in a message was declined for the same reason.
- **Constraints structural, not configurable.** The denial path stays free of flags.

## Non-goals (deliberate, so a later sweep does not "fix" them blindly)

- **TOPIC-001 stays untouched.** `denyAccess()` is deliberately one generic body (authorization before lookup). Codes there would let a caller tell "no grant" from "EM denied" from "admin denied", which is role information the generic message withholds. TOPIC-001's second inline 403, the admin one ("Application Admins do not have access to session content."), also has no code and stays that way. It is already distinguishable by message, a pre-existing wart that is not part of this change (listed as follow-up 4, low priority).
- **Correlation id is out of scope (option 1).** #264 merged, so the issue's conditional item 2 is live, but linking the envelope's `correlationId` to the audit row needs an audit-row `metadata` key or an event payload change. That contradicts "no audit-row behaviour changes" and reopens #264's pinned row shape, for a benefit nobody has asked for. The audit row, the audit event payload and the correlation linkage are all unchanged. Support can still find a facilitator's denial by user and time (the row has endpoint, status, reason and timestamp). The envelope is built at the send site, so audit, event, floor, send keep their order. Issue item 2 is closed with a comment on #263 as "not done, deliberately: #264 merged, linkage not requested" (task 6.5). Security is informed, not approver.
- **No frontend change.** `TopicManagementPage` already shows `body.error.message` on a 403. A code branch is optional in the issue, and any new copy needs an approved copy decision that does not exist yet. The code is now available for a later copy change. No frontend file is modified.
- **No shared-package type or enum.** A shared enum is a bigger decision and a place where someone later adds a bypass member. `error.code` stays read ad hoc.
- All `code(403)` sites other than the TOPIC-002 non-admin 403, TOPIC-007 (facilitator-only, not verified for this change), and the TOPIC-002 404 `TEAM_NOT_FOUND` path (#265), which is a separate branch.
- Message text. Not reworded, not hoisted into constants (a refactor that widens the diff).

## Acceptance criteria

1. Given a caller with no facilitator role (a participant, or a global engineering manager), when they GET `/api/v1/teams/:teamId/topics/all`, then 403, `error.category` "forbidden", `error.code` "NOT_A_FACILITATOR", `error.message` equal to the current text, and `Cache-Control: no-store`.
2. Given a standing facilitator who is an active member of the team, same request, then the same shape with `error.code` "FACILITATOR_IS_TEAM_MEMBER" and the unchanged message. The returning-facilitator test is titled `returning facilitator who is a member of the team gets FACILITATOR_IS_TEAM_MEMBER`.
3. For each case, the single denial audit row's `metadata.reason` equals `error.code`. The 403 body for both reasons is built by one `buildErrorEnvelope("forbidden", message, decision.reason)` call; the only branch is the existing message ternary, and nothing derives a code from a message. Verified by test (parametrised over both reasons) and by review of the diff; no compile-time exhaustiveness check is added (it would restructure the branch, see design D1).
4. Given the denial audit insert fails (or times out), the response is the same 403 with the same `error.code`, equal to the committed snapshot (existing behaviour: fail-open). A throwing helper, floor or send is still 500; unchanged.
5. Audit step, event, timing floor and send keep their order; the floor value and its position are unchanged. No existing audit-row, event, query-count, call-order or timing-floor assertion is edited or removed.
6. Tests: no existing assertion is edited or removed; new assertions and new tests are added. Named: (a) global engineering manager, (b) caller with no facilitator role, (c) facilitator who is an active member, (d) the returning-facilitator test above. Each asserts `status`, `error.category`, `error.code`, exact `error.message` and `Cache-Control: no-store`. The baseline test string-compares the body to the hand-edited fixture, so drift fails CI; the fixture changes because the baseline test reads it, which is not a loosened test. Fixture diff is exactly the two inserted `code` members.
7. Scope: `git diff --stat` lists no change to TOPIC-001, any `code(403)` site other than TOPIC-002 non-admin, `packages/frontend` or `packages/shared`.
8. No new config, flag, override or alternate path. One negative test: a spurious header and query parameter do not alter status, code or message.
9. The set of distinguishable 403 bodies for non-admin TOPIC-002 callers (after normalising per-request values) is exactly two. An Application Admin 200 response is unchanged and has no `code` member.
10. Docs: the specs and the REST API Contract state the codes. Grep of `openspec/specs` and `requirements/design` for `internal label`, `Reason names` and `differ only in` finds no sentence saying the reasons are not envelope fields or that the messages are the only difference. Scope of this edit is removing those now-false sentences only; no wider docs cleanup. `openspec validate --strict`, lint, test and build pass.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `topic-customization-lock`: the all-topics endpoint's 403s carry `error.code`; the "internal labels" paragraph is replaced; the denial-baseline requirement refers to the hand-edited snapshot (not regenerated from the handler); new scenarios for the returning facilitator, code-equals-audited-reason, audit-failure, exactly-two bodies, no-probe, removed membership, and the unchanged admin 200.
- `team-content-access`: the TOPIC-002 403 scenario for a global engineering manager asserts `error.category` and `error.code`.

## Impact

- Backend: `packages/backend/src/routes/content.ts` (TOPIC-002 denial branch only); tests in `packages/backend/src/routes/__tests__/content.test.ts`; fixture `__tests__/fixtures/topic-002-403-baseline.json`; real-Postgres test `__tests__/topic-002-denial-audit-integration.test.ts` (one added case).
- Docs: `requirements/design/REST API Contract.md` (TOPIC-002 error table and the "internal labels" sentence); the two specs above; Validation Report checked for the labels.
- No migration, no new endpoint, no new query, no frontend, no shared package.

## Follow-ups (listed here; to be filed, not filed by this change)

Filing is task 6.5, owned by the human (repo owner). Priority order below; item 1 goes ahead of every other API-consistency item in the Milestone 03 ordering.

1. **Next-step copy for the two denials** ("TOPIC-002 / topic management: next-step copy for FACILITATOR_IS_TEAM_MEMBER and NOT_A_FACILITATOR"), copy review owner Devon, filed before this change merges so the guidance is not lost. Requirements from the facilitator review: names the next step in plain English for a non-engineer; inline in the existing error area (no modal, banner or tooltip); announced like the existing 403 text (`role="alert"`); generic fallback and a non-JSON 403 (proxy page) still usable and still say who to contact; a 403 on refresh never clears loaded topics. Open question for it: can a facilitator from another team reach the page without friction (existing behaviour from #208 and siblings, not this change).
2. **Event-only correlation id** for the TOPIC-002 denial (option 2 from the exploration). Trigger: a Security request (standing request if TOPIC-002 denials are ever alerted on), or the first support case where lookup by user and time failed. Not funded before then. Until it ships, the response `correlationId` is documented as not searchable.
5. **Optional operations item:** alert on the rate of `rowWritten: false` on the TOPIC-002 denial event, the compensating control for the accepted fail-open denial audit (Security S1).
3. **Bug, only if found:** if `loadTopics` clears the list on a 403 during a refresh (checked while verifying, not fixed here).
4. **TOPIC-001 admin 403 has no code** (the inline "Application Admins do not have access to session content." body). Tracked wart, low priority, behind item 1; not a precedent for a 403 sweep.

## Open decisions

None blocking. Security is recorded as informed, not approver (Security review concurs). Security would want sign-off if the PR introduces a new reason or an EM/admin-distinguishing code, an audit-row `metadata` change, a fail-open/fail-closed change, client branching on `error.code` that changes access, or timing-floor reordering; the PR description lists these. Decision owner for whether Security sign-off is wanted: the repo owner, decided before the implement stage starts (my recommendation: not needed, since who can see what does not change). Escalate to the Executive first if anyone proposes a code that distinguishes engineering-manager or admin denials.

Time-box: one small PR, no further exploration or design rounds; a review round that yields only wording tweaks is merged.
