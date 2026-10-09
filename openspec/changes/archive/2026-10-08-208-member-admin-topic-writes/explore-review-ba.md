# BA review of the exploration notes: #208, member-admin topic writes

**Reviewer:** Marcus Delgado (Business Analyst)
**Date:** 2026-10-08
**Reviewed:** `exploration-notes.md` (Devon Calloway, 2026-10-08)
**Checked against:** `requirements/BRD.md` (FR-1.3, FR-2.2, FR-8.2, FR-8.6, FR-8.7, section 6.3, Constraint 2, SEC-13), `openspec/specs/{add-custom-topic,remove-topic,restore-topic,reorder-topics,topic-customization-lock,topic-management-screen,topic-write-rate-limiting}`, issue #208 and its comments.

## Verdict

The recommendation (option A: bar every member-admin from TOPIC-003..006 with a new `ADMIN_IS_TEAM_MEMBER` code) is well argued, and most of it can go straight into a proposal. The target matrix in section 7 and the drift list in section 8 are as precise as I would want. Five things need fixing before the proposal. Two of them are traceability problems in the core argument, not wording issues:

1. The "facilitator-from-another-team rule" that the notes rely on is not written in the BRD for topic writes (C1).
2. Open question 3 (durable vs log-only denial) is already answered by SEC-13 (C2).
3. The participant-member admin's "read-only" screen has no acceptance criteria (V1).
4. The FR-8.6 "at any time" argument needs an explicit interpretation written down (C3).
5. The issue's acceptance asks for "a recorded decision", and the notes don't say where that record goes (C5).

---

## 1. Clarifications needed

### C1. The BRD rule the notes depend on doesn't cover topic writes. Write it down as a new rule, not an existing one.

The notes say (sections 1, 4, 13) that topic writes "fall under the facilitator-from-another-team rule, which has always been 'any membership'". In the BRD, that rule is session-scoped only:

- Section 6.3: "The facilitator **who runs a session** must be a member of a different team…" Its "why" is about being uninvested and about **not removing an engineer from the participant pool**. The second reason doesn't apply to admins at all, because admins never vote (FR-1.3).
- FR-2.2: "prevent the facilitator from **creating a session** for a team to which they belong as a Participant or EM."
- FR-8.2 says only "the facilitator or Application Administrator". It has no membership qualifier on *either* role.

The member-facilitator bar on topic writes (`FACILITATOR_IS_TEAM_MEMBER`) exists in the specs (`topic-customization-lock`, "A same-team-member facilitator rejection carries a distinct reason code"; `reorder-topics`, "A facilitator who is a team member is rejected with 403") and in code. It is not in the BRD. So "agenda neutrality" is a sound rationale, but it is **new**, and the explorer introduced it. That is fine. It just has to be presented to the product owner and sponsor as a new principle being added, not as an existing one being applied.

**Ask:** the proposal must amend FR-8.2 so that *both* actors are qualified, not only the admin. That closes the existing facilitator traceability gap as well, and section 6.3 gets a sentence extending its principle to topic configuration. Suggested text is in R1.

### C2. Open question 3 is already settled by SEC-13. Durable denial rows are required.

SEC-13 lists "access control denials" among events that **must** be captured in the audit log. A log-only `ADMIN_IS_TEAM_MEMBER` denial would not meet a stated security requirement. So the question for Tomás is not "durable or log-only". It is only "which operation name and metadata".

The same reading raises a gap the notes set aside. In section 7c the notes say member-*facilitator* 403s "aren't audited, and this change shouldn't widen scope there". Under SEC-13 that is an existing non-compliance, not a design choice. I agree it is out of scope for #208, but the proposal should **file it as a follow-up issue**, not let it pass as precedent.

### C3. FR-8.6 "restorable for any team at any time" needs an interpretation recorded with it.

Section 6 of the notes argues lockout is unlikely, and I agree. But FR-8.6 is [HARD] and says "at any time". In the residual case the notes describe (outside facilitator gone, only admin is a member), *no one* can restore defaults until a facilitator or second admin is assigned. The proposal must state the interpretation explicitly: "FR-8.6 guarantees the default set is *available* to restore and is never destroyed; it does not guarantee that every caller can restore it. Restoring still requires an eligible actor under FR-8.2." Otherwise someone will later read FR-8.6 as a mandate for the override flag that drift item 5 warns against.

### C4. "Active membership" needs one sentence on timing.

"Active membership" is `removed_at IS NULL`, evaluated **per request**. The proposal should say so, and add a scenario mirroring #232's "admin whose engineering-manager membership was removed is admitted". Without it, nobody knows if a cached session role or the TOPIC-002 flag from page load governs.

### C5. Where does "the recorded decision" live?

Issue #208's acceptance is "a recorded decision (with rationale) and, if the answer is 'bar', a linked implementation issue". The notes don't name the artifact. The #238 precedent (`c6e1ad4`) is a numbered decision record. The proposal should name:

- the decision-record file to add;
- whether this change *is* the implementation (then no separate issue is needed, and that should be said on #208), or whether it is decision-only plus a new issue.

### C6. The product-owner sign-off needs the questions put in a form that can be answered.

Section 12 Q1 is phrased as "approve narrowing FR-8.2". Put it to Brian and the sponsor as three yes/no items, so a partial answer can't come back ambiguous:

1. Topic configuration is agenda-setting and falls under the outside-facilitator principle (C1). Yes/no.
2. "Outside" means *no active membership of any role*, not "not the manager". Yes/no.
3. The accepted residual: a team with no eligible non-member writer waits until a facilitator or admin is assigned; there is no override (C3). Yes/no.

### C7. The rate-limit interaction with durable denial rows is unaddressed.

`topic-write-rate-limiting`: "A request rejected with `403` … SHALL NOT be counted." Combined with C2 (one durable row per denial), a member-admin can write audit rows without limit. Volume is realistically tiny, but the proposal must state either that this is accepted, or a cap (e.g., per-episode like the 429 audit). Don't leave it implicit.

---

## 2. Vague areas (with suggested acceptance conditions)

### V1. "The participant-member admin sees the list read-only" (sections 7b, 9) has no definition.

This is the most hand-wavy part of the notes, and it is user-facing. Today's `topic-management-screen` spec says the add control has "no disabled button, no placeholder, and no explanatory note". That works on a locked team because the lock notice explains. A member-admin on an **unlocked** team would see a full topic list with no controls and **no explanation**. The notes' own drift item 4 says "broken-looking rules get 'fixed'".

Suggested acceptance conditions:

- **WHEN** an application admin with an active membership of any role on the team views an unlocked team's Topic Management screen, **THEN** no add, archive, restore or move control is present, enabled or disabled.
- **AND** a single notice explains why, e.g. "You're a member of this team, so you can view its topics but not change them. A facilitator from another team can make changes." Product owner to approve the copy.
- **AND** the archived-topics list is still shown, read-only.
- **AND** definitions remain read-only (FR-8.7, unchanged).
- **WHEN** the same admin's membership is added after page load and they activate a stale control, **THEN** the server's 403 message is shown inline and the topic list is unchanged.

If the team prefers no notice, record that as a decision with a reason. Don't leave it as an omission.

### V2. The error messages are given "for example" only.

Section 7a gives one sample message. The contract needs all four, word for word. Suggested wording, parallel to #232's copy:

| Endpoint | Message |
|---|---|
| TOPIC-003 | "An application admin can't add a custom topic to a team they are a member of." |
| TOPIC-004 | "An application admin can't archive a topic for a team they are a member of." |
| TOPIC-005 | "An application admin can't restore a topic for a team they are a member of." |
| TOPIC-006 | "An application admin can't reorder topics for a team they are a member of." |

### V3. The denial audit metadata is half-specified.

`{ endpoint, http_status, attempted_operation, reason: "membership", actor_idp_roles_include_em }` raises three questions:

- **`reason: "membership"`** duplicates the error code. Use `reason_code: "ADMIN_IS_TEAM_MEMBER"` so audit and envelope can be joined.
- **`actor_idp_roles_include_em`** is sourced from `users.roles`. Section 11 says that source is incomplete for backfilled rows and must not drive authorization. If it is kept as metadata, say it is informational and may be `null`, or drop it.
- **The membership role** (`participant` / `engineering_manager`) is the more useful triage field. The notes avoid reading it on the write path to save a query. Either accept the query in the denial branch only (it runs after the decision, so it costs nothing on success), or state that the role is deliberately not recorded.

Acceptance condition: "Each `ADMIN_IS_TEAM_MEMBER` 403 writes exactly one `audit_log` row, before the response is sent, with operation `admin.topic_write_denied`, actor id, global role, IP, target team id, and metadata {listed fields}. No topic row changes."

### V4. "Gate all four write controls on the server flag": which controls exactly?

List them so a tester can check off each one: the add trigger (heading and empty-state variants), the per-row Remove/archive action, the per-row Restore action in the archived list, the per-row move-up/move-down controls, and any "restore defaults" action if one exists. The FR-8.5 confirmation dialog can't be reached when Remove is absent, so say that.

### V5. "Spec changes" in section 9 lists capabilities, not scenarios.

Several existing scenarios assert the *opposite* of the new rule. They must be MODIFIED or REMOVED, not just added to:

- `add-custom-topic`: "An application administrator who is a team member creates a custom topic" (expects 201).
- `remove-topic`: "An application administrator is exempt from the team-membership check".
- `restore-topic`: "An application administrator is exempt from the team-membership check".
- `reorder-topics`: "An application administrator can reorder any team's topics" ("any" must become "any team they are not a member of").
- `topic-management-screen`: "An administrator on an unlocked team sees the add control" (narrow to non-member admins), and the requirement prose "`canAddTopics` is `true` for every caller TOPIC-002 admits".
- `topic-customization-lock`: add an "admin member rejection carries a distinct reason code" scenario next to the facilitator one.

Name these in the proposal so the delta specs aren't additive-only, which would leave contradictory scenarios in main specs.

### V6. Out-of-scope items should be stated, not implied.

Add an explicit "not affected" list: TOPIC-007 (already facilitator-only); FR-8.1 default-set maintenance on the template team (admin capability, no team membership involved after #257); TOPIC-002 reads (unchanged from #232); admin self-editing membership (section 6, separate issue if Security wants it); member-facilitator denial auditing (C2 follow-up).

---

## 3. Suggested rewrites

### R1. BRD FR-8.2

> **FR-8.2** [HARD] After a team's first session, a Facilitator or an Application Administrator who **holds no active membership on that team, in any role,** shall be able to add, remove, restore, or reorder topics for that team. A Facilitator or Application Administrator who is a member of the team shall be refused.
>
> *Rationale (added by #208):* choosing which topics a team discusses, and in what order, shapes the session as much as running it does. The outside-facilitator principle (section 6.3) therefore applies to topic configuration too. Membership in any role disqualifies, as it does under FR-2.2. Because a user who holds both the Facilitator and Application Administrator roles resolves to Application Administrator, a manager-only bar would let any facilitator-admin change their own team's topics. FR-8.6 is unaffected: the default set always remains available to restore by an eligible actor.

Note the addition of "restore". FR-8.2 currently says "add, remove, or reorder", but TOPIC-005 restore exists and is covered by this decision.

### R2. BRD section 6.3, one added paragraph

> **Topic configuration.** The same principle applies outside the session: a user who is a member of a team, in any role, cannot change that team's topic list or its order (FR-8.2).

### R3. BRD FR-1.3, Application Administrator bullet, after "They may still hold team membership."

> …but cannot change that team's topics (FR-8.2) or, if they are its engineering manager, read its topic configuration (#232).

### R4. Traceability table row for FR-8.2 (currently missing)

> | FR-8.2 | Facilitator or non-member admin customizes topics after first session | Let teams adapt topics while keeping the agenda out of insiders' hands |

### R5. Notes section 12, Q3

Replace it with: "**Security (Tomás):** confirm operation name and metadata for the SEC-13-required denial row; confirm whether per-denial rows need a cap (C7)."

---

## 4. Things I checked and agree with (no change needed)

- The precedence bypass (section 4) is the decisive argument against option B. Keep the side-by-side example in design.md, as drift item 3 asks.
- Writes ⊆ reads is a principled ordering, and it removes the `{ get: 403, post: 201 }` anomaly, including the `displayOrder` residual read flagged in the #232 hand-off (a).
- Converting the N4 member-admin success assertions into denial assertions (7c) keeps the issue's "must not be weakened" constraint, because the compensating control is replaced by a structural one. The PR text must say this.
- A new code rather than reusing `FACILITATOR_IS_TEAM_MEMBER` is right. An envelope code must be true.
