# Q6 Resolution: Rate Limiting Threshold for TEAM-006

**Author:** Marcus Delgado, Business Analyst (in consultation with security analyst per Q6 ownership)
**Resolves:** design.md Q6 ("Required before Phase 2: Rate limiting threshold for TEAM-006")
**Unblocks:** tasks.md task 3.10
**Status:** Proposed — ready for security analyst co-sign and spec incorporation

---

## 1. Why this needs a number, not a principle

Task 3.10 has been sitting BLOCKED since the threat model landed, and the threat model (Scenario 4, Finding 3.10) is explicit that this isn't a hygiene item — it's the named compensating control for the specific risk in design.md's own risk register: *"[Risk] Bulk TEAM-006 calls under compromised admin account."* The threat model also confirms there is currently no other technical brake on this — "EM account monitoring," the third compensating control Decision 6 names, has no verified implementation in this codebase (threat-model.md Finding 2.3). Until 3.10 ships, the rate limit is the only thing standing between a compromised Application Admin credential and an unbounded number of `team_memberships` rows.

Q6 asks me to own the threshold value. "A reasonable limit" is not a requirement an engineer can build a test against — task 3.9's pattern in this same endpoint (create-new, idempotent-update, precondition failure, not-found, unauthorized, audit rollback, each with an exact expected status code) is the bar. This document gives 3.10 the same kind of exactness.

## 2. What legitimate usage of this endpoint actually looks like

TEAM-006 associates exactly one `(engineeringManagerUserId, teamId)` pair per call — there is no batch variant, and the spec is explicit that multi-team EM support is achieved "by calling the endpoint with different `teamId` values" (`openspec/specs/manager-team-association/spec.md:89`). So call volume is a direct, 1:1 proxy for the number of EM/team grants an admin is making, which is exactly the quantity the threat model's blast-radius formula (*N × T* per team, multiplied by team count) cares about. That 1:1 relationship is what makes a request-rate threshold a meaningful proxy for the thing we're actually trying to bound.

I looked at three usage shapes an Application Admin legitimately needs this endpoint for:

**a) Steady-state, one EM at a time.** A new manager is hired or reassigned; the admin associates them with their one or two teams. This is 1–3 calls, done once, at the pace of someone reading names off an email and typing them into a form. Nowhere near any threshold that also has to stop an attacker.

**b) Reorg-driven reassignment.** A round of promotions or a management reshuffle touches a handful of teams at once — an admin might work through 5–15 EM/team associations in a single sitting while going down a list from HR or an org chart. Still a manual, human-paced task: read a name, look up a team, submit, confirm, move to the next line.

**c) Initial tool rollout to a new team or organization.** This is the one that actually stresses a threshold. When Dipstick is adopted by an organization that already has an established team structure, someone — likely working from a spreadsheet or a small provisioning script rather than clicking through the UI one row at a time — needs to associate every existing team with its EM before the tool is useful to anyone. This is the legitimate "bulk" case the threshold has to accommodate without an admin having to file a ticket to get their own rollout unblocked.

I don't have a hard number for how large a single organization's team count gets in this product's actual customer base — that's a gap I'm flagging rather than papering over. Absent that data, I'm sizing the threshold against a working assumption of **organizations in the 10–150 team range** for a rollout event, consistent with the ritual's team-level design (Health Check sessions are run per-team, by a facilitator, with a handful of participants — nothing in the requirements corpus implies a single organization onboarding thousands of teams at once through this internal tool). If actual rollout data later shows organizations regularly exceeding 150 teams in a single onboarding pass, the escape-hatch procedure in Section 5 handles that case without requiring the default threshold to be loosened for everyone.

## 3. The threshold

Two limits, both scoped **per actor** (the calling Application Admin's `user_id`, read from `session.userId` — the same identity already used for the authorization check at `teams.ts:654-657`), not per IP and not per team. Per-actor is the correct scope because the asset being protected is the admin *credential*; per-IP would both under-throttle a compromised credential used from the admin's normal location and over-throttle legitimate multi-admin or shared-network usage.

| Window | Limit | Rate | Purpose |
|---|---|---|---|
| Burst | **20 requests per rolling 10 minutes** | ~1 every 30 sec | Bounds how fast any single sitting can run, including scenario (c) worked manually |
| Sustained | **100 requests per rolling 24 hours** | — | Bounds total same-day volume; caps a single compromised credential's same-day blast radius at 100 teams regardless of how the 20/10-min windows are spent |

**Why these two numbers work for the legitimate cases in Section 2:**

- (a) and (b) never come close to either limit — 15 calls in one sitting is comfortably inside the 20/10-min burst window.
- (c), the rollout case: a rollout of up to 100 teams in a single day fits entirely inside the sustained cap, and — paced at roughly one call every 30–60 seconds, which is realistic for someone running a small script that iterates a spreadsheet with a short delay, or for two admins splitting the list — comfortably clears the burst window too. An admin who *is* moving faster than that (a script with no throttling of its own, or several admins hammering the endpoint concurrently) will hit the burst limit first, get a 429 with a `Retry-After`, and can simply pace the script — this is friction, not a wall, for the legitimate case.

**Why these numbers work against the threat:** 100 associations/day is a hard ceiling on how many teams a single compromised Application Admin credential can be used to expose *in one day*, full stop — down from the current unbounded number. Combined with the transactional audit write already required by Decision 9 (every call, success or precondition failure, produces a reviewable row), 100/day means a security analyst reviewing `audit_log` the day after a compromise is dealing with "at most 100 teams, in a pattern that also tripped a 429" rather than an open-ended number. It does not eliminate the risk — Decision 6's acceptance of undated historical access is unchanged — but it converts an unbounded amplifier into a bounded, auditable one, which is exactly what the risk register asked this control to do.

If, once usage data exists, 100/day proves too tight for a recurring legitimate pattern (rather than a one-time rollout, which Section 5 already covers), that's a number to revisit with real data — I'd rather ship a specific, testable number now and adjust from evidence than leave 3.10 blocked waiting for a number nobody can produce yet.

## 4. What happens when the limit is exceeded

**HTTP 429 Too Many Requests.** Not a silent failure, not a lockout, not a CAPTCHA.

- **`Retry-After` header**, in seconds, indicating when the relevant window (burst or sustained, whichever was hit) next has capacity.
- **Response body** uses the same error envelope already established at this endpoint (`teams.ts:660–667`, `671–679`, etc. — `category`, `message`, `correlationId`), with a new category and a machine-readable code that distinguishes which of the two limits was hit, following the same pattern Decision 4 already established for 409 responses (a caller-facing UI needs to know *which* condition it's showing, not just that "something" failed):

```json
{
  "error": {
    "category": "rate_limited",
    "code": "TEAM006_BURST_LIMIT_EXCEEDED",
    "message": "You've reached the limit of 20 manager-association requests per 10 minutes. Wait a few minutes and try again. If you're onboarding a large number of teams at once, contact [security/support channel] about a scoped, time-limited increase.",
    "correlationId": "..."
  }
}
```

(`TEAM006_DAILY_LIMIT_EXCEEDED` for the sustained-window case, with equivalent wording pointing at the next-day reset and the same escalation path.)

This mirrors the standard Decision 1 already set for the "you don't have permission" case — a grayed-out control or a bare failure with no explanation is not acceptable there, and it isn't here either. An Application Admin running a legitimate rollout who hits the limit needs to immediately understand three things: that it's a rate limit and not a bug, when they can resume, and what to do if their legitimate need genuinely exceeds the limit. All three belong in the error body, not in a support ticket the admin has to file to find out what happened.

**No account lockout or suspension on limit breach.** A rate limit throttles; it does not disable the account. Locking out an Application Admin mid-rollout because they were moving faster than the burst window allows would turn a legitimate, if uncommonly heavy, workday into a self-inflicted outage — and Application Admin is already a small, high-accountability population (Decision 1's own rationale), so a false-positive lockout has an outsized operational cost relative to the security benefit, given the sustained cap is already doing the hard bound-the-blast-radius work. Suspected-compromise account lockout is a separate, security-analyst-owned decision that should be driven by richer signal (anomalous IP, impossible travel, IdP-side alerts) than "hit a rate limit while doing a bulk operation the product explicitly needs to support" — conflating the two would make the rate limit punitive for the exact legitimate workflow it has to accommodate.

**Every 429 gets logged**, structured log at minimum (this is a rejected request, not a state change, so it does not need Decision 9's transactional `audit_log` treatment — but it does need to be visible to whoever eventually builds the monitoring that threat-model.md Finding 2.3 says doesn't exist yet). A burst of 429s against a single admin account is exactly the kind of signal that monitoring, whenever it's built, should treat as a first input — I'm flagging this so 3.10's implementation doesn't ship the throttle without also shipping the breadcrumb an investigator will want later.

## 5. Reconciling the large-rollout case

The sustained cap (100/day) is deliberately not raised to accommodate a hypothetical very-large rollout, for the same reason Decision 2 rejected a bootstrap endpoint and Decision 9 rejected extending an existing table with nullable columns: don't weaken a default control to serve an edge case when a scoped exception mechanism serves the edge case without weakening anything for everyone else.

**Escape hatch for a rollout genuinely larger than 100 teams in a day:** the admin (or their security analyst, on their behalf) requests a time-boxed increase — e.g., "raise the sustained cap to N for this specific admin account for the next 24 hours" — through whatever mechanism the security analyst already uses for equivalent exceptions (this is an operational/tooling decision I'm deferring to the security analyst, consistent with how Q6 splits ownership). The requirement I'm setting here is only that any such increase:

1. Is explicitly time-boxed (expires automatically; is not a silent permanent change to that admin's limit),
2. Is itself logged to `audit_log` (who requested it, who approved it, what the temporary value was, when it expires) — an unaudited way to raise the control that protects against unaudited bulk access would defeat the purpose,
3. Reverts to the default 20/10-min and 100/day thresholds automatically at expiry, with no manual step required to restore the default.

This keeps the default posture tight for the case that matters (a credential compromise, which by definition doesn't come with a pre-approved exception) while giving legitimate large rollouts a documented, audited path that doesn't require permanently loosening the number every other admin account is held to.

## 6. What this resolves and what it doesn't

- **Resolves Q6** with a specific, buildable number: 20 requests / rolling 10 minutes and 100 requests / rolling 24 hours, per Application Admin `user_id`, enforced at `POST /api/v1/teams/:teamId/managers`.
- **Unblocks task 3.10.** The threshold values above are ready to drop into the rate-limiting middleware already stubbed at `teams.ts:637–641`.
- **Does not relitigate Decision 6.** Undated historical access from association date is unchanged; this control bounds how many associations a compromised admin credential can create, not what any single association exposes.
- **Does not by itself close threat-model.md Finding 1.3** (the `evaluateTeamAccess` gap allowing an EM to originate an EM grant on their own team via TEAM-005 without ever calling TEAM-006, bypassing this rate limit entirely). That finding is a separate, higher-severity gap the security analyst has already flagged as blocking Phase 2 production deployment on its own; a TEAM-006 rate limit does nothing to close a path that never calls TEAM-006. I'm noting this explicitly so this document isn't later read as "the rate limiting risk is closed, therefore Phase 2 is clear" — it closes the *bulk-admin-compromise* risk this Q6 was scoped to, not the full set of Phase 2 production-readiness gaps in the threat model's Findings Summary.

## Acceptance criteria (for task 3.10's test coverage)

- A test asserting the 21st TEAM-006 call from the same actor within a 10-minute window receives 429 with `code: "TEAM006_BURST_LIMIT_EXCEEDED"` and a `Retry-After` header.
- A test asserting the 101st TEAM-006 call from the same actor within a rolling 24-hour window receives 429 with `code: "TEAM006_DAILY_LIMIT_EXCEEDED"`.
- A test asserting calls from a different actor (different `user_id`) are not affected by another actor's rate limit state.
- A test asserting a 429 response does not write a `team_memberships` row or an `audit_log` row (the rejected request produces no side effect other than the rate-limit log entry itself).
- A test asserting the limit resets correctly at window boundary (the 21st call succeeds once the oldest call in the rolling window ages out).
