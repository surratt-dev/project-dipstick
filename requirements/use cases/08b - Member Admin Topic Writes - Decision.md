# Decision: Member Admin Topic Writes

**The rule.** Application Administrators are admitted to topic configuration (TOPIC-002 read; TOPIC-003 add, TOPIC-004 archive, TOPIC-005 restore, TOPIC-006 reorder) whatever their membership on the team: none, `participant`, `engineering_manager`, or any other value of `team_memberships.role`. **Why.** The product owner decided it (section 2). **What it reverses.** #232's bar on TOPIC-002 for an administrator who manages the team, and the "interim" status of the topic-write audit rows. **What it keeps.** Every administrator read and write is still audited, administrators still take no part in sessions, and a facilitator still cannot facilitate, or change the topics of, a team they belong to.

---

## 1. Status, owners and traceability

**Status:** **Decided 2026-10-08 by the user (product owner)** (#208).
**Implementation:** this change (`openspec/changes/208-member-admin-topic-writes`) is the implementation. #208 needs no separate implementation issue.
**Follow-on owner:** the Business Analyst.

**Traceability:**
- BRD FR-8.2 [HARD] (who may add, remove, restore or reorder topics; amended by #208 to state the administrator grant explicitly).
- BRD FR-1.3 (role model; the administrator bullet gains the positive grant next to the session exclusion).
- BRD FR-8.7 rationale and Constraint 2 (the #232 sentences are removed).
- Use Case 08 (Topic Management): the "Administrator who holds an engineering manager membership on the team" alternate flow is removed.
- REST API Contract: TOPIC-002 authorization, its `403` table and notes; TOPIC-006 authorization; Appendix B.
- #232 / PR #259 (`dce3b35`): the TOPIC-002 rule this decision reverses. #176 (TOPIC-003 admin branch). #187 (TOPIC-001 manager denial; unchanged).

---

## 2. Decision

The product owner, answering #208:

> "No, admins are a trusted role and should not be constrained from any features except facilitating their own team."

Selected outcome, in the owner's words: **"No bar, and undo #232."**

Applied here as:

1. **TOPIC-003..006 (add, archive, restore, reorder):** no behaviour change. An `application_admin` keeps every topic write on every team, whatever their membership on it. The BRD and specs now state this as a decided rule.
2. **TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`):** #232's bar on the administrator arm is removed. An administrator with an active `engineering_manager` membership (or any other membership role) is admitted, the same as any other administrator. The `ADMIN_IS_TEAM_MANAGER` and `ADMIN_MEMBERSHIP_NOT_ADMITTED` `403`s and the `admin.topic_config_denied` audit operation are removed. Historical `admin.topic_config_denied` rows are never deleted or rewritten; they record what the rule did while it existed.

---

## 3. Scope

This decision is applied to **topic configuration reads and writes (TOPIC-002..006) only.**

The following administrator restrictions are **not changed by this decision and remain in force**:

- **No session participation:** no registration, votes or live session events for an `application_admin`, even for a team they belong to (FR-1.3, FR-2.4, Constraint 2, #243 D11).
- **Session-content denial:** administrators do not read trends, sessions, action items or notes (`team-content-access` Option B).
- **TOPIC-001 denial:** TOPIC-001 still denies administrators, with an `admin.session_content_denied` row (#187).
- **No annotation authoring:** administrators do not set, edit or clear team definitions (TOPIC-007, FR-8.7). They read them read-only on the topic management screen.
- **No session creation:** administrators create no sessions (FR-2.1).

Global engineering managers (`global_role = 'engineering_manager'`) stay out of TOPIC-002..006 (`403 NOT_A_FACILITATOR`), whatever their membership.

### Open item for the owner (not in scope here)

Read literally, the owner's broader statement ("should not be constrained from any features except facilitating their own team") would reach the restrictions listed above, none of which is facilitating. Whether to revisit any of them is a separate decision for the owner. This change does not act on it.

Relaxing any of them goes back through security review. Administrator access to session content (votes, trends, notes, action items) is a different data class from topic configuration, and R-EXEC-1's acceptance (section 7) does not cover it.

---

## 4. Alternatives considered

- **(A) Bar every member-admin from topic writes.** The earlier exploration recommendation (agenda-setting belongs under the facilitator-from-another-team principle). Not chosen: the owner treats administrators as a trusted role, and the control belongs in who holds the role.
- **(B) Bar only administrators with an `engineering_manager` membership,** mirroring #232 on writes. Not chosen, for the same reason; it also kept a membership-role allow-list that a new role value would silently change.
- **(C) No bar on writes, keep #232's read bar.** Not chosen: it kept the `GET 403 / POST 201` split, where an administrator could change an agenda they were refused on screen.
- **(D) No bar, and undo #232.** **Chosen** by the owner.

---

## 5. What it reverses, and what it keeps

**Reverses:**
- #232's TOPIC-002 no-manager administrator rule (PR #259, `dce3b35`): the admission bar, its two `403` reasons, and the `admin.topic_config_denied` operation.
- The "interim compensating control" status of the in-transaction `topic.*` audit rows on administrator writes. They are now the permanent audit record of administrator topic writes.

**Keeps:**
- The durable, text-free, fail-closed `admin.topic_config_accessed` row on every administrator read of TOPIC-002, recording the reader's live membership role (`membership_role`), `actor_roles` and `actor_idp_roles_include_em`.
- The facilitator member bar: a `facilitator` with any active membership on the team gets `403 FACILITATOR_IS_TEAM_MEMBER` from TOPIC-002..006.
- Administrator exclusion from sessions (section 3).

---

## 6. Audit-row content

- The `admin.topic_config_accessed` row carries no topic names, ids or definition text.
- The `topic.*` write rows carry topic ids but no topic names or definition text: `topic.custom_added` and `topic.restored` carry `{ topic_id }`, `topic.archived` carries `{ topic_id, openActionItemCount }`, and `topic.reordered` carries `{ previous_order, new_order }` (arrays of topic ids). A write row is the record of which topic changed, so its ids are correct and are not stripped to match the read row.
- **Point-in-time membership on write rows.** The `topic.*` write rows carry no membership field. The actor's membership role at the time of a write is reconstructed from `team.role_changed` / manager-association audit history up to the write's timestamp, not from the current `team_memberships` row. This holds only for membership changes made through the application.
- **Forensic, not monitored.** The administrator audit rows are read after an incident or on request. Nobody monitors them on a cadence, and nothing here implies that anyone does.

---

## 7. Disclosed risk

**R-EXEC-1 (Executive review): holding the admin role gives a manager a way around the "managers don't see the team's own words" boundary.** After this change, an engineering manager who is also an Application Administrator can read the team's definitions through TOPIC-002 and can add, archive, restore or reorder topics on their own team before a session. #187 kept definitions from managers because they can reflect what the team said without the manager in the room. The harm is perception, and it does not depend on frequency: one engineer learning this can cool a team's candour.

- **Accepted by:** the product owner, on the premise that administrators are a small, deliberately chosen, trusted group and that the control belongs in who holds the role.
- **Mitigations:** a durable `admin.topic_config_accessed` row on every administrator read, naming the membership role; an in-transaction `topic.*` row on every administrator write; the deployment hygiene line "Keep Application Administrator team memberships rare", with its reason (`docs/deployment.md`); an honest #187 release note, re-approved by the owner before release.
- **Residual risk:** the team and its facilitator see none of this, and the remaining lookup query has no cadence or owner, so in practice nobody may run it. The control that addresses perception is #201 (facilitator-visible topic provenance); revisit it if the manager-admin overlap is ever more than a handful of people.

**Champion's risk note** (Devon Calloway, Internal Champion; recorded disagreement, decision accepted by the owner). A manager-admin can now read each topic's team definition (up to 500 characters in the team's own words, written by a non-member facilitator who was in the room) and can shape their own team's agenda: archive "Psychological safety" before a session, or move "Delivery pace" to the top. A facilitator who is also an administrator can do the same on their own team, because role precedence resolves them to `application_admin`. The facilitator-from-another-team rule exists to keep that kind of agenda-shaping out of insiders' hands. The owner accepts this because administrators are trusted and the protections the ritual depends on most are intact: no administrator takes part in a session, every session is run by a facilitator from outside the team, and every administrator read and write leaves a durable, attributed row. The champion asks, as suggestions and not conditions: keep administrator team membership rare (now in the deployment hygiene checklist), give #201 more weight, and correct the #187 release note.

---

## 8. Follow-up

- **#187 release note:** "Engineering managers, including administrators who manage the team, cannot read the team's definitions" is now false. Proposed replacement, for the owner to approve before release: "Engineering managers cannot read the team's definitions. Application administrators can, including one who manages the team; every administrator read is audited."
- **Candidate, owned by Security:** add `membership_role` and `actor_roles` to administrator `topic.*` write rows, so the write row records membership at the time of the write.
- **#201** (facilitator-visible topic provenance): suggested for higher priority (section 7).

**Revisit** only by a new product-owner decision, recorded here.
