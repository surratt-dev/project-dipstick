# Design: 296-threat-model-admin-canonical-topics-locked-team (#296)

Documentation only. There is no code design; this records the writing decisions so the implementer does not reopen them.

## Content source of truth

This file. The implementer writes the HLA text from the wording below. `exploration-notes.md` and the review files are history and may contain superseded drafts (for example a two-row table); on any conflict this file wins. Nothing in the HLA is "verbatim from" another file.

**Row (8.1, appended after "Dependency vulnerability")**

| Privileged topic-lock carve-out | An `application_admin` (or an attacker holding an admin session) writes topics into any zero-active-topic team of their choosing, locked or unlocked, via the single lock carve-out `POST /api/v1/teams/:teamId/topics/assign-defaults` | Preventive: role re-read from the database on each request (the stored role updates at sign-in); zero-active precondition checked under the per-team advisory lock; copies the default template only (no caller-supplied topic content). Detective: success audit row written in the same transaction (fail-closed); denial and failure audit rows are best-effort (fail-open). Abuse bound only: per-actor topic-write limiter. Regression guard (not a runtime control): source test cited in 8.2 |

Drop any mechanism in the controls cell that tasks section 1 does not confirm (in particular "re-read from the database": if the role comes from a session or token claim, say so and drop "live"/"re-read"). The limiter is a shared per-actor budget across the topic-write routes (including the #216 template routes); never present it as mitigating the chained path.

**8.1.1 caveats, item (f), one bullet each:**
- Detective, not preventive, and currently unmonitored: no monitoring consumer of the audit signals (#131, "open at time of writing"). State this in item (e) in the same sentence as the rating.
- `audit_log` is modifiable by the application DB role and no tamper evidence is claimed. This matters for a database-level or code-execution compromise, not for a stolen admin session alone; say which. A "no `audit_log` reader outside the #271 inventory" statement is about readers, as that structural test asserts, and is placed outside this bullet so it cannot read as tamper resistance.
- Denial rows are sampled per actor and are absent when the limiter store errors or the audit insert fails (this applies to this endpoint only). Suppression is logged as `topic.denial_audit_suppressed` (log only, not a durable row). Say that audit suppression and the limiter failing closed (503 on this endpoint during a Redis outage) are different effects.
- `actor_ip` depends on `trustProxy`; if misconfigured it is untrustworthy as evidence. `actor_user_id` is the primary attribution and does not depend on it. The success row and the denial/failure rows do not carry identical actor attributes; do not claim they are the same shape.
- A generic 500 leaves only a log line, no durable row; log retention is not assessed here. The failure row exists only for the handled empty-template case.
- Single admin: no second approver and no step-up or recent-authentication requirement. A stolen long-lived admin session is the most realistic route to this compromise; revoking the role at the identity provider is not immediate (it applies at the next interactive sign-in).
- Recovery is unavailable during a Redis outage, after the actor's shared write budget is spent, and while the template is empty (assign-defaults answers 500 `DEFAULT_TOPICS_UNAVAILABLE`).
- Expected affected count is documented as "none" in the `docs/deployment.md` "Zero-topic teams" section (cite by name, no number); it is an expectation, not a measurement by this change (see tasks section 1, expected-count check).
- The zero-active precondition is reachable (it is what #200 recovers from); this assessment does not enumerate every way to reach it, and the invariant tests are fixed scenarios, not an enumeration.

**Reopen triggers, item (h):** "This assessment must be revisited if any of the following occurs: a second exception to the topic customization lock is introduced; any topic-writing endpoint accepts text from a caller-supplied source (copy from another team, partial top-up, custom text); anyone other than an `application_admin` (for example a facilitator or manager) is allowed to trigger assign-defaults; the way the `application_admin` role is granted, or who can grant it, changes; who can edit the default template, or what it can contain, changes; an `application_admin` account is compromised or suspected of it, or a `topic.defaults_assigned` row does not correspond to a known recovery; audit-log hardening or monitoring (#131) lands, or the Redis limiter or `trustProxy` configuration changes materially (the rating may then move either way); a change to cookie SameSite policy or session transport; a change to how often the stored role refreshes from the identity provider; security or compliance requires a second approver or step-up authentication for admin writes; or the number of zero-active-topic teams is found to be non-trivial (for example when the 'Zero-topic teams' check in `docs/deployment.md` is run, or when `topic.defaults_assigned` rows accumulate beyond a handful). Any reopen decision must weigh recovery speed and the affected population against the exposure at that time."

"A handful" is a review-cadence judgement, not a code limit; keep it unnumbered.

**Item (g), one sentence, no line budget but one sentence:** the facilitator is the first to notice (room open answers `NO_ACTIVE_TOPICS`); recovery is an `application_admin` calling assign-defaults, which also depends on the template being non-empty; facilitators deliberately have no self-service recovery, which costs a wait on an administrator before a scheduled session; pacing, reveal, readiness and outlier behavior are unaffected.

**Content additions to items (a) to (e) (one clause each, from the design reviews):**
- (a) The precondition is reachable and not enumerated here (see caveat list). Accepted on locked and unlocked teams, so the row name undersells it as a general restore-for-empty-team path.
- (b) "No caller-supplied topic content" (the target `teamId` is caller-chosen). Copies the template's active rows; archived rows are left in place (subject to D5).
- (c) Any `application_admin`, including a member of the target team, and any team id, so one stolen session reaches every zero-topic team. Add how the role is granted and whether an admin can grant it, as confirmed in tasks section 1; if not confirmed, say nothing about provisioning. Also state that the stored role changes only at interactive sign-in, so an identity-provider demotion does not apply until the next interactive sign-in (no figure: a session-lifetime number from the deployment docs is not a rate limit, but D8 keeps the added text number-free).
- (d) The template is the trust anchor for the paths that copy or edit it: team creation (#215), assign-defaults and the #216 maintenance path. Restore-defaults (#218) re-activates a team's own archived default rows and does not copy template text; say so in a clause. "The bound is whatever the template holds" applies to the copy and edit paths, so monitoring or closing assign-defaults alone does not close the template-text risk. Name the audited template-write operations (`topic.default_*`) if tasks section 1 confirms them, and state whether template text is validated like ordinary topic text (tasks section 1). An emptied or all-archived template makes team creation roll back and assign-defaults answer 500 (cite behavior, not a path).
- (e) "Low, conditional on #208 and on the zero-topic population staying near zero; detective, not preventive, and currently unmonitored (#131)." Likelihood is low; impact if the role is compromised is not claimed to be low. The chained path, as two sentences: "... is covered by #208's trusted-role decision, which predates #216's template edit, and is not separately re-accepted. The chained path is recorded as a reopen trigger in (h)."

**8.2 bullet (exact text):** "The topic customization lock has exactly one carve-out (assign-defaults). A source test (`assign-defaults-lock-gate-source.test.ts`) pins the list of topic routes, requires the five lock-gated writes to call the lock gate, and requires assign-defaults not to." Use "pins", never "ensures" or "cannot be bypassed": the test is a source-text check on the routes file and would not catch a gate invoked through a helper elsewhere. Do not say "the only way topics enter a locked team" (team creation copy and the #216 template routes are not lock carve-outs). Re-confirm "five" from the test body at landing (currently five `GATED` entries; seven routes pinned).

## Decisions

**D1. One row, one subsection, one bullet.** Single-role compromise is covered in 8.1.1 as a residual statement, since a second row would duplicate "Insider access". 8.3 and 8.4 are untouched.

**D2. Cite mechanisms by name, not numbers or lines.** Names only: `isApplicationAdmin`, `checkCustomizationLockGate`, `enforceTopicWriteRateLimit`, operations `topic.defaults_assigned`, `topic.defaults_assign_denied`, `topic.defaults_assign_failed`, `topic.write_denied_template`, `topic.denial_audit_suppressed`. No rate-limit numbers, no line numbers. File paths only. "Confirmed" means found by grep in non-test source on the landing day.

**D3. Test claims are capped at what the test body asserts.** Only the first file is named in the HLA; the other two back behavior sentences in 8.1.1 and are checked in tasks section 1.
- `assign-defaults-lock-gate-source.test.ts`: pins the list of seven topic routes, requires the five lock-gated writes (add, archive, restore, reorder, restore-defaults) to call the lock gate, requires assign-defaults to neither call it nor read lock state. (The file's header comment says "four"; the body asserts five.)
- `assign-defaults-concurrency-integration.test.ts`: two simultaneous calls give one 201 and one 409 `TEAM_HAS_ACTIVE_TOPICS`; a queued room open snapshots the assigned rows; a room open that wins the lock is refused `NO_ACTIVE_TOPICS`. Nothing on archived topics or the template-edit chain.
- `zero-topic-invariant-integration.test.ts`: refuses add, restore, archive, reorder and annotate on a locked one-topic team, and refuses archiving the last active topic on an unlocked team. Not a sequence search; no "permanent invariant" language.

**D4. Rating and acceptance wording are fixed.** Residual risk low, with the one-sentence basis from the proposal. Chained path: "covered by #208's trusted-role decision (which predates #216's template edit; not separately re-accepted); the chained path is recorded as a reopen trigger". Recovery speed is one weighing factor in reopen decisions, alongside the affected population, not a requirement against approvers and not presupposing "near-zero" as permanent. No first-person or persona voice in HLA text.

**D5. Archived rows.** State "archived rows are left in place" only if the handler is confirmed to insert only and count only active rows. If the handler deletes or modifies archived rows, stop and raise to the BA: that would conflict with the topic-history-preservation requirement, not just a wording choice. Record keep or drop in `pr-notes.md`.

**D6. Contradiction check is a grep, not a read-through.** Outcome recorded in tasks; edit only on a named contradiction.

**D7. Onboarding claim in (d).** Engineering confirmed in code that an empty template rolls team creation back and makes assign-defaults answer 500 `DEFAULT_TOPICS_UNAVAILABLE`; tasks section 1 re-confirms on landing, citing behavior rather than the stale path in the `default-topics.ts` header comment.

## Risks

- Over-claiming. Mitigated by D3 and the D6 sweep.
- Drift between identifiers and code before landing. Mitigated by tasks section 1.
- Advisory lock wording: say "per-team advisory lock" only. It is a hashed key with no timeout; make no isolation claim between teams, and none about a template edit during the copy.
- Process weight. The change should read as a small PR; do not add checks beyond those in tasks.

## Design review resolution

Engineer review (Marcus Oyelaran): all factual corrections accepted. R1 (best-effort denial/failure rows split from the fail-closed success row in the controls cell), R2 (success is audited fail-closed; never "all outcomes are audited"), R3/G2 (limiter is a shared abuse bound, not a control on what is written, not a control on the chained path), R4 (recovery also needs a non-empty template), G1 (recovery unavailable during a Redis outage or after budget is spent), G3 (no isolation claim for the advisory lock), G4 (success row not identical in shape to denial rows), "exactly one carve-out to the customization lock" wording, cite behavior not stale paths, and the four landing checks (8.2 uses "pins"; five; invariant test unnamed; `topic.write_denied_template` not described as protecting the template).

Implementation review (Ingrid, Tomas): corrected at implementation: restore-defaults (#218) re-activates a team's own archived default rows and does not copy template text, so it is named in (d) as a non-copier rather than a copy path. Security added the identity-provider demotion clause (c, f, controls cell) and two reopen triggers (SameSite or session transport; stored-role refresh frequency).

Security review (Tomas): accepted the wording fixes (items 1, 3, 4, 5, 9, 11, 12 to 15), the extra reopen triggers (events, both rating directions, a named detector for the zero-topic count), and the verifiable claims, which become task 1 checks (role source, admin provisioning, template-write audit, template text validation, expected count, CSRF/session posture). The ten merge-gate items are carried as tasks sections 1 to 3, except as below.

Rejected or reduced, for proportionality (Rachel asked for lightweight; this stays a documentation change and does not become the SEC-31 revisit):
- Filing follow-ups as a merge gate (item 8): not accepted as a gate. The drafts, now including an `audit_log` REVOKE/immutability item, go in `pr-notes.md` and whether to file them is a question for the user at PR time. The HLA names #216 S-B/N-A/N-D and the REVOKE as known open items only if the user files them (then by issue number).
- Item 10 (D9 timeout): partly accepted. The one-business-day timeout stays for rating and wording confirmation, but an unanswered Security request is recorded as "not reviewed", not "proceeded as proposed", and the merge decision is the user's.
- Item 2 (template-edit audit coverage): accepted as a check and a named operation or an explicit "first-step audit coverage not assessed here" caveat; no assessment of the #216 endpoint is added.
- Step-up, second approver, a measured production count as a requirement, enumerating all ways to reach zero topics, a lock-timeout/hash-collision discussion, and any audit-log or CSRF hardening: out of scope. Each appears only as a stated caveat or reopen trigger; the expected-count check in tasks section 1 is a read-only count if the environment allows, otherwise recorded as "not run". No approval ceremony is added to recovery.
