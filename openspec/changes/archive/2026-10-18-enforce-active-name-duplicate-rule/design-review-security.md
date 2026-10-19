# Security Review: enforce-active-name-duplicate-rule (#299) design

Reviewer: Tomás Ferreira, Senior Application Security Analyst
Inputs: `design.md`, `proposal.md`; cross-checked against `routes/topics.ts` header comments, `REST API Contract.md` (TOPIC-001/002/003/005), and the High-Level Architecture section 8.1.1 (#296 threat model).

## Verdict

Approve with conditions. The design is sound on ordering and on the audit decision. There is one real information-disclosure finding (S1, an audited-read bypass for `application_admin`), one threat-model housekeeping item (S2), and several decisions that are implicit and should be stated (S3 to S7). None blocks the server rule. S1 needs a written decision before implementation, not necessarily a code change.

## What I checked and found sound

1. **Authorization and lock ordering (focus 1).** The cascade in D-section "Verification" is: 403 role, rate limit, 404 team/template, 409 `TOPIC_CUSTOMIZATION_LOCKED`, then (restore) 404/422 topic checks, then inside the advisory lock the name check. The name check is the last gate before MAX+1. An unauthorized caller gets 403 before any team or topic query; a locked team gets `TOPIC_CUSTOMIZATION_LOCKED` before any topic row is read for name purposes. So neither an unauthorized caller nor a locked-team caller can reach `TOPIC_NAME_ACTIVE`. I agree with the design's finding that R5 holds structurally. Good: the corrective note about two different "locks" is accurate and the spec must follow the stated order.
2. **TOCTOU (D2).** Check in JS inside `lockTeamTopics`, not before it, is correct. A pre-lock check would be both a race and a name oracle without serialization. No objection.
3. **No override (D6).** Ignoring unknown body fields is the right secure default: nothing to remember. `application_admin` gets no exemption, consistent with the persona principle that a protective rule which can be optional will be configured off.
4. **Cross-team disclosure (focus 2), facilitators.** The 409 names a topic only in the target team's active list. The caller reaching that point is a standing facilitator (org-wide, non-member) or admin, both of whom may already read that list via TOPIC-002 (and TOPIC-001 for members). The 409 does not cross a team boundary: the check set is scoped by `team_id`, and the template team is rejected at 404 before it. `conflictingName` is the stored value of a topic the caller is already entitled to see, so for facilitators this adds no new data.
5. **Audit decision (focus 4), basic.** No `audit_log` row for a validation outcome is defensible, and no new operation means the #271 reader inventory is unchanged. Agreed, subject to S1 and S4.

## Findings

### S1 (Medium, decision required): 409 body is an unaudited read channel for `application_admin`

TOPIC-002 states every administrator read of topic configuration writes an `admin.topic_config_accessed` row (#232, #208); the audit exists precisely because admin access to team configuration is an accepted-but-monitored trust. The 409 returns `conflictingTopicId` (a uuid) and `conflictingName` (the stored name) to an admin, for any unlocked non-template team, with no such row. It also acts as a membership oracle: an admin can probe a team by submitting candidate names. Impact is small (the admin may read the full list anyway, audited; the reflected name differs from the submitted one only by case and surrounding whitespace). But the 409 is a path to topic ids and names that sidesteps the very control #208 put on that data, and the design asserts "validation outcome, not access-control" without considering this.

Also note: the probing is not free of side effects elsewhere: each probe spends the actor's topic-write budget (good), but nothing records it.

Options, pick one and write it down in design.md:
- (a) Accept and record: the leakage is bounded to data the admin can read through an audited path, equal or lower in fidelity, rate limited per actor. Add it to the threat model note (S2). Cheapest, my preferred outcome.
- (b) For `application_admin` only, omit `conflictingTopicId`/`conflictingName` (generic message). Costs a role-dependent response shape, which D6 and D4 argue against; I do not recommend it.
- (c) Write `admin.topic_config_accessed` on an admin-triggered 409. Heavier, and it would add an audit write on a handled-exit path and touch the #271 inventory. Not recommended.

If (a): state it explicitly. It is currently implicit.

### S2 (Low, documentation): threat-model impact is declared nil without being checked

The proposal says the #296 threat model is unrelated. I checked section 8.1.1: its reopen triggers include "any topic-writing endpoint accepts text from a caller-supplied source" (not triggered: Add already accepted caller text) and the lock carve-out count. This change adds no carve-out, no new privileged path, and does not move the rating. So "no reopen" is correct. But D6's one-line statement that the admin lock-bypass is "unrelated" should say why: assign-defaults writes canonical template names into a zero-active-topic team, so it cannot collide with an active name, and it stays outside the rule. Ask for: (1) one sentence in the design making that argument, and (2) a one-line addition to 8.2 or 8.1.1 recording the S1 decision, or an explicit statement that no threat-model edit is needed. The D8 baseline "no internal duplicate names in the default set" check is a security-adjacent invariant too: if it fails, team creation (a path with a security review of its own, `harden-team-creation-topic-copy`) would begin failing closed or silently diverge. Make the check a test, not a one-time manual step.

### S3 (Low): enumeration and timing (focus 3) are acceptable but not stated as a decision

- Enumeration: the only oracle is "does name X exist as an active topic in team T", available to callers who can already list T's topics. Team existence is not newly revealed (404 `TEAM_NOT_FOUND` already exists and is behind authorization). Fine.
- Timing: the 409 takes the same ROLLBACK plus `applyTimingFloor` path as restore's race branch. Good. Two residual points:
  - Add's *thrown-path* timing gap (#299 9.2, #305) means an Add that errors is still distinguishable. The design defers this; it is pre-existing and not made worse, but record that the new 409 is on the handled path so the 409/201 split is floored, and the deferral is a conscious one.
  - The in-lock work now includes an extra SELECT of all active names for the team. Distribution should still sit under the floor. Fine, but D5 explicitly refuses to measure the floor, so nothing verifies that. Accept, note it, and rely on #305.
- Please also state that the response for a conflict must be byte-equivalent in headers to other topic 4xx (`Cache-Control: no-store` as the other topic-config responses carry). The design is silent on this; a cacheable 409 containing a topic name is a leak on shared devices or proxies. Add to D4.

### S4 (Low): "no log line asserted" leaves a logging gap and a logging risk

D5 says no log line is required and any emitted line must not contain the submitted name. Two issues:
- The stored `conflictingName` is equally user-authored text and equally unwelcome in logs; say "neither the submitted nor the conflicting name".
- Forbidding a requirement is not a control. Because the codebase uses structured `emitAuditEvent` events for access decisions and log-only events as probing signals (e.g. `topic.config_read_unknown_team`), repeated `TOPIC_NAME_ACTIVE` from one actor is a mild probing signal. I accept "no event" for this change given the rate limit, but record it as a deliberate decision, and add a negative test (no `audit_log` row, and no log payload containing either name) rather than "none asserted". The no-audit assertion exists in the plan; extend it to logs at low cost.

### S5 (Low): rate limiting (focus 5) is correct but the fail-open/closed behaviour on 409 is unstated

Consuming budget like other 4xx is right, since it bounds oracle probing (burst and daily per actor, shared budget across topic writes). Confirm in the spec that the rate-limit step precedes the name check (it does in the cascade) and that the 503 fail-closed path (`TOPIC_WRITE_RATE_LIMIT_UNAVAILABLE`) is unchanged, i.e. when Redis is down, no name-conflict answers are given. Please add one test: limiter unavailable returns 503, never 409. The per-actor budget is the only throttle on the S1 probe, so its behaviour belongs in the threat note.

### S6 (Low): lock-and-name error disambiguation relies on client discipline

Two 409s share a status; the design correctly mandates branching on `code` and tests per caller. In the persona's terms this is a control that depends on developers remembering. Keep the test, and additionally make the shared error type a discriminated union (or an exhaustive `switch` with a `never` default) so that a bare-409 branch fails type-checking. Also a security-relevant UI point: the locked-team message and the name-conflict message must not contain each other's phrase (the design already tests this). Good.

### S7 (Info): other implicit items

- Self-reference: restore targets its own name inside the active set only if it is active; the in-lock re-read returns 422 first. Confirm the restore check excludes the target row itself (it is archived, so it is not in the active set; fine, but add a test for a hypothetical status flip race: concurrent restore of the same topic yields one 200 and one 422, not 409).
- Reflected content: `conflictingName` is user-authored. It is returned in JSON; the client must render as text (React default). The D7 copy interpolates the name; require text-node rendering, no HTML injection into `role="alert"` regions. State it.
- Message does not assume the reader belongs to the team (D7): good, and consistent with the non-member facilitator model.
- Legacy duplicates (D9): the first-by-order rule is deterministic, so which of two legacy duplicates is disclosed does not depend on caller. No concern.
- Out-of-scope but flagged: look-alike names (NFC/NFD, internal whitespace) are a known limitation. From a security standpoint they are also a homograph/spoofing vector (a facilitator could add a visually identical topic). The risk is low for an internal tool in a trusted-facilitator model and the decision is recorded; keep it on the follow-up list.

## Deferred or implicit security decisions (checklist)

| Decision | State | Needed |
|---|---|---|
| Admin 409 bypasses `admin.topic_config_accessed` | Implicit | Write the decision (S1) |
| Threat-model edit | Implicit "none" | One sentence plus S1 note (S2) |
| `Cache-Control: no-store` on the 409 | Missing | Add to D4 (S3) |
| Conflicting name in logs | Partly stated | Extend to both names, add test (S4) |
| 503 limiter-down never yields 409 | Implicit | Add test (S5) |
| Add thrown-path timing gap, floor not measured | Explicit deferral (#305) | Acknowledge in threat note (S3) |
| Baseline default set has no internal duplicates | One-time check | Make it an automated test (S2) |
| Name rendered as text, not HTML | Implicit | State it (S7) |
| Probing signal event for repeated 409 | Not decided | Record "no event" as deliberate (S4) |

## Conditions for my sign-off

1. A written decision on S1 (option (a) is acceptable).
2. `no-store` on the 409 stated in D4 and tested.
3. The 503-never-409 test and the no-name-in-logs/no-audit-row assertions (S4, S5).
4. The threat-model one-liner (S2).

Everything else is advisory. I do not need to re-review the implementation for these unless S1 goes to option (b) or (c).
