# Propose Review: Executive Stakeholder (Rachel Okonkwo, VP Engineering)

**Change:** 208-member-admin-topic-writes (#208)
**Artifact reviewed:** `proposal.md` (with `exploration-notes.md` §9 and the `tasks.md` outline for context)
**Focus:** Strategic alignment with adoption goals; whether the scope fits the value.
**Verdict:** **Approve.** One disclosed risk for the owner and two small asks, none of them blocking.

The product owner's decision is final, and I am not reopening it. This review checks whether the proposal carries out that decision in a way that keeps what I sponsored this project for: a ritual engineers trust, run by teams themselves, with low overhead.

---

## 1. Strategic alignment

**What serves adoption**

- **One answer instead of two.** Today a manager-admin gets `GET 403 / POST 201` on the same team. The screen says no, but the write goes through. It protects nothing and it confuses people. Teams adopt a tool that behaves predictably, so removing the split is a real gain, even though it goes in the permissive direction.
- **The rule gets written down.** Putting the admin grant into FR-8.2 and a decision record (08b) stops this argument from coming back every few months. Re-litigating access rules costs the team more than the rule itself does. I support the decision record.
- **The parts of the ritual I care most about are untouched.** Sessions are still run by a facilitator from another team. Admins still cannot register, vote or receive live session events. Global engineering managers are still kept out of TOPIC-002..006. TOPIC-001's #187 denial stands. These are what my "manager read-only, no participation" property depends on, and the proposal lists each one as a constraint pinned by a test. That is the right framing.
- **Every admin read and write stays audited.** The proposal keeps `admin.topic_config_accessed` on every admin `200`, recording the reader's `membership_role`, and treats the `topic.*` write rows as the permanent record. If an engineer ever asks me "did a manager look at this?", I can answer. That matters for success criterion 4.

**Where it touches my non-negotiables**

My persona's access rule is that team data is visible to the team's reporting structure, the EM and the current facilitator, and that managers are read-only and stay out of sessions. This change does not break either. It does give a manager who also holds the admin role two new abilities: they can read the team annotation, and they can shape the agenda (archive, reorder). See the disclosed risk in §3.

## 2. Is the scope proportional?

Yes. It is, if anything, a model of restraint.

- **Code:** removes one predicate, two `403` messages, one deny branch and one audit operation. Topic writes have no behaviour change, and the shared helper has no diff. No migration. Most of the cost is docs and tests, which is the right place for it: the decision is a policy change, so most of the work is in how the policy is written down.
- **Non-goals are well chosen.** Declining the wrapper refactor (N1) and the new `membership_role` field on `topic.*` rows keeps the diff easy to review and stops this change becoming a vehicle for adjacent work. I agree with both.
- **No scope creep found.** The docs list (BRD, UC 08, 08b, REST contract, deployment guide) is long but required. Every item is a place that would otherwise state the old rule. Leaving any of them stale would bring back exactly the "silence invites fixes" problem the proposal names.
- **One caution:** the Champion's ask #2 (give #201 more weight) is a good idea but belongs in backlog prioritisation, not this change. The proposal already treats it as a suggestion. Keep it that way.

This change will not delay getting value to first teams. It is small, and it takes away a confusing behaviour that a first team's admin could plausibly hit.

## 3. Disclosed risk for the owner (recorded, not reopening the decision)

**R-EXEC-1: Holding the admin role gives a manager a way around the "managers don't see the team's own words" boundary.**

- After this change, an engineering manager who is also an Application Administrator can read the team annotation through TOPIC-002. #187 kept that text from EMs because it can reflect what the team said when the manager was not in the room. The same person can also archive or reorder topics on their own team before a session.
- **Why it matters to me:** my deepest concern is that the data starts to feel like surveillance. The harm does not depend on frequency. One engineer finding out that "my manager can read our team's definition of psychological safety, and could have pulled that topic" is enough to cool a team's candour. Success criterion 4 ("no engineer has raised a concern that the data is being used in a way that feels evaluative") is the criterion this puts at risk.
- **Why it is acceptable:** the owner's premise is that admins are a small, deliberately chosen, trusted group, and that the control belongs in who holds the role, not in per-feature exceptions. I accept that. But it moves the protection from the product into operational practice, so that practice has to actually exist.
- **Mitigations already in the change:** a durable audit row on every admin read, naming the membership role; in-transaction audit rows on every admin write; the hygiene line "keep admin team membership rare" (task 7).
- **Residual risk:** the team and its facilitator cannot see any of this. The audit trail is only useful if someone reads it. The proposal retires the #232 review cadence and keeps "one uncadenced lookup query". In practice, that means nobody will run it.

## 4. Asks (non-blocking)

1. **Make the hygiene line slightly sharper.** In `docs/deployment.md`, next to "keep admin team membership rare", add one sentence saying that an admin who is an engineering manager of a team can read that team's definitions and change its agenda, and that this is the reason to keep the overlap rare. Operators follow a rule more reliably when they know why it exists. This costs a sentence, not a task.
2. **Get the #187 release note corrected before it ships.** The approved line becomes false with this change. The proposed replacement ("Application administrators can, including one who manages the team; every administrator read is audited") is accurate and honest, and I would approve it. Being open about this protects trust far better than a claim that later turns out wrong. Please make sure it reaches the owner for sign-off and is not left in the exploration notes.

Optional, for later and not this change: if the overlap is ever more than a handful of people, revisit #201 (facilitator-visible provenance) so the team itself can see when an insider changed the agenda. That is the control that addresses perception, which is the risk I care about. Audit rows only address accountability.

## 5. Summary

The proposal implements the owner's decision cleanly and keeps every boundary the ritual depends on. It is proportional to its value, and it removes a confusing behaviour without adding scope. The strategic cost is a trust and perception risk that sits with manager-admins. It is disclosed above (R-EXEC-1) for the owner to own, and it is mitigated mainly by keeping the overlap rare and by an honest release note. **Approved.**
