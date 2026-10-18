# Proposal Review: bulk-restore-default-topics (#218)

**Reviewer:** Rachel Okonkwo, VP Engineering (Executive Stakeholder)
**Focus:** Strategic alignment, proportionality of scope
**Verdict:** APPROVE WITH CONDITIONS. Direction is right; the delivery surface is larger than the value statement needs, and I want two items trimmed or justified before build.

## Strategic alignment

- **Adoption link is credible.** The failure moment (a rushed facilitator the day before a session, facing twelve dialogs) is a real adoption leak, and the proposal ties it to FR-8.6 [HARD]. Cheap return to the shared baseline protects the "common language across teams" I care about. Good.
- **Measurable form is good.** "N restores = one confirmation, one request" is a testable outcome, not a feature list.
- **Honest about the limits.** FR-8.6 is stated as "partially met" with an explicit table. I appreciate not being told this is done when it is not.
- **Trust properties preserved.** No toggle, no participant-visible trace, no "who restored" surface, audit holds actor and team only, no manager path, customization lock unchanged. These are my non-negotiables and the proposal respects them. The ids-only audit metadata is the right call for the same reason.
- **Caveat on priority.** I cannot tell from this document how many teams are tailoring and regretting. My success criteria are three teams at six sessions and one closed action loop. Restore ergonomics only matters after the first session lock lifts and teams customize. Please state, in one line, the evidence that this is blocking adoption now (a facilitator complaint, a support request, a usability finding). If it is anticipatory, it should rank behind anything blocking first-session onboarding or the trend dashboard.

## Proportionality

Core (proportional): one endpoint, same guards as single restore, one confirmation, one result line, one audit row. This is the minimum that delivers the value.

**Shared planner in `@dipstick/shared`: acceptable, with a condition.** The reason (preview cannot drift from the server rule) is sound, and a pure function is cheap. But it exists only because of the preview. Condition: keep it a single small function with no new abstraction layers or configuration. If the preview slips, the planner stays server-side.

**Additive `displayOrder` on archived items in `GET /topics/all`: acceptable but it is the real scope question.** It is a contract change to a shared read endpoint, added so a dialog can show order. Ask: does the facilitator need to see the order to confirm, or only the names and count? If names and count suffice, drop the field, drop the preview ordering, and the planner shrinks to a duplicate check. I lean toward asking the team to justify order preview with usability evidence. Additive and low risk, so I will not block, but it should be explicitly optional.

**Scope creep flags:**
1. **Transient highlight on restored rows (frontend).** Polish. Defer unless trivial.
2. **Empty-state variant interacting with #200 (D6 visibility rules).** Added coupling to a just-shipped recovery path. Keep to the minimum needed so bulk is not offered when nothing is restorable.
3. **Docs/runbook, use-case edits, usability-test item, four spec deltas.** Documentation breadth is large for a one-button change. Fine if mechanical, but the `restore-topic` cross-reference-only delta and the runbook line should not become review burden.
4. **Four "known gaps" inherited.** Correctly deferred. I want them filed as tracked follow-ups, not left as prose, so they do not become a hidden tax on this change.

## Risks to adoption and trust

- **Names in HTTP response and dialog preview** are team free text shown only to the facilitator; acceptable.
- **"Skipped" duplicates** could confuse a rushed facilitator ("I clicked restore and some did not come back"). Result copy must explain skips in plain language. Cheap to get right, expensive to get wrong.
- **Customs-first, defaults-last ordering** puts the shared baseline at the bottom of the list, which mildly undercuts the "common baseline" purpose. Accepted by the proposal for ratification; I agree to defer, but track reset-to-canonical-order.

## Conditions for approval

1. Add one line of evidence or rationale for prioritizing this now versus first-session onboarding and dashboard work.
2. Mark `displayOrder` on archived items and the order preview as optional/droppable, with the team stating what usability signal justifies keeping it.
3. Defer the transient highlight unless it is under a trivial effort.
4. File the four inherited gaps as tracked issues.
5. Ship as one small PR sequence (backend endpoint + audit, then frontend), not a bundle with the doc and spec sweep blocking the merge.

## Ratification items (the proposal's three)

- Ids-only audit metadata: **Agree.** Protects the "team's data, not management's" principle.
- Stricter duplicate rule than single restore: **Agree**, provided the follow-up to align single restore is filed.
- Customs-first ordering cost: **Agree to accept now**, track the fix.
