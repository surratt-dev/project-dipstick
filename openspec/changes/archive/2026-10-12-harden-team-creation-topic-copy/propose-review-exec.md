# Proposal Review: Executive Stakeholder (Rachel Okonkwo)

**Change:** harden-team-creation-topic-copy (#215)
**Focus:** strategic alignment, proportionality of scope, scope creep
**Verdict:** Approve with two requested trims. Not blocking.

## Strategic alignment

Good. The proposal protects what I care about most for adoption.

- **First-team experience.** A 500 on team creation, in front of a facilitator and a brand-new team, is the worst possible adoption moment. Removing it is directly in service of my success criterion 1.
- **Common language across teams.** The default topic set is the shared vocabulary I want to point to org-wide. A silently resurrected or reordered default erodes cross-team comparability, which is the very consistency I sponsored this for. Fixing the silent case matters more than the loud one, and the proposal says so. I agree.
- **No surveillance surface.** The change reads no individual data and adds no facilitator-visible change, no manager-visible surface, and no new access path. Ritual constraints (simultaneous reveal, no-manager rule, facilitator from another team) are explicitly untouched. Good.
- **Policy clarity.** Stating that an archived template default is a data fault, and that retiring a default for new teams is an administrator decision under F5 (#216), is the right boundary. Teams must not be able to alter the shared baseline.

## Proportionality

Mostly proportional. The production change is small: one query predicate, explicit renumbering, one warn log, no migration, no endpoint, no frontend, no API shape change. That is the size of change I want for a data-integrity fix.

Concerns, in order of weight:

1. **Test and acceptance surface is heavy for the code delta.** Twelve acceptance conditions (C1-C12), a scratch-schema or index-drop harness, and a new invariants test sit against a handful of changed lines. The invariants test (C8) is a reasonable cheap substitute for a trigger and I support it. The harness for fabricating duplicate active positions (C2, C4) is the expensive part. Ask: confirm the effort is bounded, and if the scratch-schema approach grows beyond a small helper, cover duplicates with a narrower test rather than building infrastructure.
2. **C12 (snapshot order equals team order) and C11 (column-by-column equality)** look like re-asserting existing behavior. Keep them only if they are cheap assertions inside tests already being written. Do not let them become separate test files.
3. **Declined trigger and the F5 task.** Declining the trigger is the right call and the proposal records it. Fine as a short design.md section. Do not let it grow into a design discussion.

## Scope creep check

No major creep. Items I looked at:

- **Anomaly logging (`template_anomaly`).** Justified: it is the only way an operator learns the baseline is damaged. It stays operator-side with no UI, metric, or audit row. Keep it that tight. Resist any follow-on request for a dashboard or alert for this.
- **Zero-active-defaults contract (D4).** Pinned with a test only, no new status or code. Right call.
- **One-time read-only data check (D7).** Acceptable as a pre-merge task. It tells us whether the silent case already happened in any real team. Please make sure the result is acted on proportionately: if it finds rows, a remediation issue is opened, not a repair built into this change.
- **`topic-customization-lock` spec restatement.** This touches the TOPIC-002 area, which has had a long run of recent changes (#208, #232, #259, #264, #265, #263). It is a wording restatement only, but I want it confirmed that no behavior in the access-control arm changes. Anything touching who can change topics is an organizational-policy matter I am consulted on.

## Misaligned priorities / flags

- **Placeholder in the proposal:** "#TBD (filed as the first task; insert the number here)" for the D10 duplicate-restore-entry issue. A user-visible defect is being deliberately deferred. Acceptable to defer to keep the diff reviewable, but it must get a real issue number before merge, not after. A known user-visible duplicate in a restore list should not float unowned.
- **Opportunity cost.** The TOPIC-002 hardening stream has produced many consecutive small changes. I accept each on its merits, but the next items should be weighed against what gets a first team to six sessions and a visible trend. This fix earns its place because it protects every new team's first session. After it, I would want priority to return to onboarding and the dashboard rather than further provisioning hardening. A readable published list of the twelve defaults (mentioned under open decisions) should stay deferred until F5.

## Requests

1. Assign the D10 issue number before merge.
2. Keep C11 and C12 as inline assertions, not new test scaffolding. Bound the duplicate-position harness.
3. Confirm in the PR that `topic-customization-lock` changes are wording-only with no change to access rules.
4. Report the D7 data-check result to me if it is non-zero, in one line.

## Decision

Proceed. Low-risk, correctly scoped, protects the first-team experience and the shared baseline without adding any surveillance or configurability surface.
