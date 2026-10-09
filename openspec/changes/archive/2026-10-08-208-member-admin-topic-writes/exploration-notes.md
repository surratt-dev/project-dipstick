# Exploration notes: #208, may an application admin who is a team member change that team's topics?

**Explorer:** Devon Calloway (Internal Champion)
**Date:** 2026-10-08
**Branch:** `agent-team/208-member-admin-topic-writes`
**Issue:** #208 (F1 from #176). Related: #232 / PR #259 (TOPIC-002 no-manager admin arm, merged as `dce3b35`, archive `openspec/changes/archive/2026-10-08-232-topic-002-admin-read-audit-no-manager/`), #176 (TOPIC-003 admin branch), #243 / #245 (IdP role set, fixed precedence), #201 (topic provenance).
**Status:** **Decided by the product owner, 2026-10-08.** Exploration only, no code written. This revision replaces the earlier recommendation (option A, bar every member-admin). The earlier position is kept as history in section 11. The two review files in this folder (`explore-review-ba.md`, `explore-review-facilitator.md`) reviewed that superseded recommendation; they are not the live position.

---

## 1. The decision

The product owner (Brian) answered the sign-off questions. Verbatim:

> "No, admins are a trusted role and should not be constrained from any features except facilitating their own team."

Chosen outcome: **"No bar, and undo #232."**

1. **TOPIC-003, -004, -005, -006 (add, archive, restore, reorder):** no behaviour change. An `application_admin` keeps every topic write on every team, whatever their membership on it (none, `participant`, or `engineering_manager`). FR-8.2 is made explicit about this.
2. **TOPIC-002 (`GET /api/v1/teams/:teamId/topics/all`):** revert the no-manager rule #232 put on the admin arm. An admin with an active `engineering_manager` membership (or any other membership role) is admitted, the same as any other admin. The `ADMIN_IS_TEAM_MANAGER` and `ADMIN_MEMBERSHIP_NOT_ADMITTED` 403s and the `admin.topic_config_denied` audit operation are removed.
3. **Kept from #232:** the durable `admin.topic_config_accessed` row on every admin `200`. Auditing what a trusted role reads is consistent with SEC-13 and costs nothing in trust. The row keeps recording `membership_role`, which now matters more, not less (section 5).
4. **Untouched:** an admin still cannot take part in sessions, even for a team they belong to (FR-1.3, FR-2.4, Constraint 2, #243 D11). Only facilitators create sessions (FR-2.1), and a facilitator still cannot facilitate, or write the topics of, a team they belong to (FR-2.2, `FACILITATOR_IS_TEAM_MEMBER`). That is the one place the owner said admins stay constrained, and it is already enforced.

The decision is made. My disagreement is recorded once, in section 9, and is not an open question.

## 2. What the code does today, and after this change

```
                                   TOPIC-002 read (/topics/all)                 TOPIC-003..006 writes
caller                             today (after #232)  →  after #208             today = after #208
───────────────────────────────────────────────────────────────────────────────────────────────────────
facilitator, non-member            200 (no audit)          unchanged             201/200
facilitator + any membership       403 FACILITATOR_IS_TEAM_MEMBER  unchanged     403 FACILITATOR_IS_TEAM_MEMBER
admin, non-member                  200 + accessed row      unchanged             201/200 + topic.* row
admin + participant membership     200 + accessed row      unchanged             201/200 + topic.* row
admin + EM membership              403 ADMIN_IS_TEAM_MANAGER → 200 + accessed row (membership_role "engineering_manager")
                                                                                 201/200 + topic.* row
global EM / engineer               403 NOT_A_FACILITATOR   unchanged             403 NOT_A_FACILITATOR
```

`canAddTopics` stays `facilitator || application_admin`. After the revert it is `true` for every admin TOPIC-002 admits, which is every admin, and that now matches TOPIC-003 exactly. The parity test's `{ get: 403, post: 201 }` exception disappears.

Key files:

- `packages/backend/src/routes/content.ts` (TOPIC-002). Everything #259 added, and what happens to it, is in section 4.
- `packages/backend/src/auth/standing-facilitator-access-helper.ts`: `checkStandingFacilitatorOrAdminAuthorization` admits `application_admin` before looking at membership. **Unchanged.** It already gives the decided answer for both reads and writes.
- `packages/backend/src/routes/topics.ts`: the four write wrappers (`checkAddCustomTopicAuthorization` L463, `checkArchiveTopicAuthorization` L497, `checkRestoreTopicAuthorization` L575, `checkReorderTopicsAuthorization` L653). **Unchanged** apart from comments (section 6).
- `packages/backend/src/auth/role-map.ts`: fixed precedence `application_admin > engineering_manager > facilitator`. A person in both the facilitator and admin IdP groups resolves to `application_admin`, so they can change their own team's topics. Under this decision that is intended (section 9).

## 3. Requirements, before and after

- **FR-8.2 [HARD]** today: "After a team's first session, the facilitator or Application Administrator shall be able to add, remove, or reorder topics for that team." It has no membership qualifier, so the code already matches the decision. The change makes that explicit, so nobody reads the silence as an oversight and "fixes" it.
- **FR-8.7 rationale** and **Constraint 2**: #232 added a sentence to each saying an admin who manages the team cannot read its topic configuration. Both sentences are removed.
- **FR-1.3 / FR-2.4 / Constraint 2 (#243 D11)**: admins do not take part in sessions "even for a team they belong to". **Untouched.** This is the owner's "except facilitating their own team".
- **FR-2.2 [HARD]**: a facilitator cannot create a session for a team they belong to "as a Participant or EM". **Untouched.**
- **FR-8.6 [HARD]**: defaults restorable "for any team at any time". Unaffected; if anything, easier to satisfy, because any admin can restore.

## 4. Code: what #259 added to TOPIC-002, and what this change does with it

From `git show dce3b35 -- packages/backend/src`:

| #259 addition (content.ts unless stated) | Fate |
|---|---|
| `evaluateAdminTopicConfigRead` + `AdminTopicConfigRead` type (allow-list: `null`/`participant` admitted, `engineering_manager` → `membership_em`, anything else → `membership_unrecognised`) | **Remove.** No admission decision depends on the membership role any more. |
| `ADMIN_IS_TEAM_MANAGER_MESSAGE`, `ADMIN_MEMBERSHIP_NOT_ADMITTED_MESSAGE` (exported constants) | **Remove**, with the tests that import them. |
| The deny branch: `admin.topic_config_denied` insert, its event, timing floor, `403` | **Remove.** |
| `Topic002AdminOperation` union (`accessed` \| `denied`) and `dueOperation` selection | **Narrow** to `"admin.topic_config_accessed"` only. |
| `readActiveMembershipRole(session.userId, teamId)` call on the admin arm | **Keep**, as audit input only (see below). |
| `readActorRoleSet` (`users.roles`), `actor_roles` column, `actor_idp_roles_include_em` metadata | **Keep.** They are audit context. They were introduced as the #238 compensating control, and that framing goes (section 7), but changing a live audit row's shape is churn with no benefit. |
| `insertTopic002AdminAuditRow`, `withAdminAuditFailureSignal`, `admin.audit_write_failed` (log-only) | **Keep.** The `operation` field of `admin.audit_write_failed` can now only be `admin.topic_config_accessed`. |
| The `admin.topic_config_accessed` insert + event on every admin `200` (text-free counts, fail closed) | **Keep unchanged**, except that `membership_role` can now be `"engineering_manager"`. |
| `assertTopic002AuthorizedRole` (500 if the shared helper ever admits a role other than `facilitator`/`application_admin`) | **Keep.** It still ensures a new role cannot reach the data without the admin audit. Reword its comment: it no longer guards a "no-manager admin arm", it guards the audited admin arm. |
| Handler comment block "the administrator arm's no-manager rule and its audit" and "Do NOT move this check into the shared helper" | **Rewrite** to describe the audit only. |
| `canAddTopics` comment about the EM-member admin never reaching it and the "GET 403 / POST 201" exception | **Remove.** The expression is unchanged. |
| `audit-logger.ts`: `admin.topic_config_denied` union member and its comment block | **Remove.** Edit the `admin.topic_config_accessed` comment (`membership_role` values) and the `admin.audit_write_failed` comment (one operation). |
| `TopicManagementPage.tsx`: on a TOPIC-002 `403`, show the envelope `message` if the body is an envelope, else the generic text; tolerate a non-JSON body | **Keep the code.** It is correct generic 403 handling, not admin-specific. Only the comment ("e.g. the no-manager rule's message…") changes. |
| `TeamPage.test.tsx` comment: the Topics link must not be hidden by role or membership | **Keep the assertion**, reword the comment. The link now leads to a working screen for every admin. |

**Does `readActiveMembershipRole` stay?** Yes. I considered dropping it and recording only the helper's existing `isMember` boolean, which would save one query per admin read. I'm against that. Once the guard is gone, the row's `membership_role` is the only durable evidence that the reader manages the team. It is the fact a reviewer would ask about first. The query runs on the admin arm only (facilitators gain no query), so the cost is one small read on a screen-mount endpoint. Record the raw value (`null`, `participant`, `engineering_manager`, or a future enum value) without an allow-list, since nothing decides on it. A failed membership read stays fail closed (`500`, no data), the same as a failed role-set read or insert. A read is never served unaudited.

**No migration.** `audit_log.operation` is free text. Historical `admin.topic_config_denied` rows stay in `audit_log` untouched. They record what the rule did while it existed.

**Tests (converted, not deleted):**

- `content.test.ts`: the "engineering_manager membership gets 403 with no topic/team/lock query" test becomes "gets 200 and one access row with `membership_role: "engineering_manager"`". Delete the denial-specific tests: the denial insert failure, the denial tail order, `membership_unrecognised`, and the message constants. Keep the fail-closed tests for the access row, and the `assertTopic002AuthorizedRole` tripwire test (L1942 area; reword its "#208" comment).
- `topic-002-admin-audit-integration.test.ts`: L118 (EM membership → 403 + denial row) becomes 200 + one access row with `membership_role: "engineering_manager"` and the topic data present. L238 ("removed EM membership is admitted") stays as a `removed_at` regression, with its rationale reworded. L215 (global EM with a participant membership → 403, no `admin.*` row) is **unchanged**: that is the `NOT_A_FACILITATOR` path, not the admin arm.
- `topic-add-flag-parity.test.ts`: delete the `{ get: 403; post: 201 }` variant from `Expected` and its exception branch. The "application_admin with an engineering_manager membership" row becomes `ADMITTED_CAN_ADD`. Keep the `servedMembershipRoles` proof: the membership read still runs on every admin GET.
- `topic-annotation-integration.test.ts`: unchanged. The #259 addition only asserts one text-free `admin.topic_config_accessed` row for a non-member admin read, and that row is kept.
- Frontend `TopicManagementPage.test.tsx`: the "renders that exact message" test uses the #232 manager message as its fixture. Re-anchor it on any envelope message; the behaviour under test is generic.

## 5. TOPIC-003..006: no behaviour change, and the audit rows become the permanent record

- No authorization change on any write endpoint. No new reason code. `canAddTopics` semantics are unchanged.
- The in-transaction `topic.*` rows (`topic.custom_added`, archive, restore, reorder) carrying `actor_global_role = 'application_admin'` and `team_id` were described in #208 and #176 as the **"interim compensating control"** (security review N4). They are now the **permanent record** of admin topic writes. That is not a weaker status: the assertions stay exactly as strong. Only the framing changes.
  - `topic-add-admin-integration.test.ts` L19 ("F1's interim compensating control — do not weaken these assertions") and `topics.test.ts` L844 ("F1's interim compensating control"): reword to "the permanent audit record of admin topic writes (#208 decision)". Keep the "do not weaken" instruction. The member-admin cases ("member admin (2.2)" and the remove/restore/reorder integration cases) **stay**.
  - The write rows do not record the actor's membership role. I recommend **not** adding it in #208. The rows already carry `actor_user_id` and `team_id`, which join to `team_memberships` for any review. Adding a field to four in-transaction inserts is scope with no decision behind it. If Security wants it, it gets its own issue.
- **Wrapper-collapse factory (engineer review N1): recommend not doing it.** #208's own wording ties it to "if this decision changes all four", and the decision changes none of them. A pure refactor of four authorization paths, in a change whose point is "nothing changes on writes", would make the diff harder to review for exactly the property reviewers need to confirm. Leave it for a refactor issue if anyone still wants it. The comment fixes in the three wrappers ("admits application_admin") are fine: they become accurate statements of a decided rule.

## 6. Docs, specs and contract to change in the same change

**Decision record (new):** `requirements/use cases/08b - Member Admin Topic Writes - Decision.md`, following the `01c` precedent (#238). Contents:
- The rule: an Application Administrator may read and change any team's topic configuration, whatever their membership on that team. The only admin constraint in this area is the existing one: admins do not take part in sessions, and only a non-member facilitator runs them.
- Rationale, in the owner's words: "admins are a trusted role and should not be constrained from any features except facilitating their own team."
- Alternatives considered: (A) bar every member-admin from writes, the earlier recommendation; (B) bar only EM-member admins, mirroring #232; (C) no bar on writes but keep #232's read bar; (D, chosen) no bar, and undo #232. One line each on why the owner did not choose them.
- What it reverses: #232's TOPIC-002 no-manager admin rule (PR #259, `dce3b35`), and the "interim" status of the topic-write audit rows.
- What it keeps: the `admin.topic_config_accessed` audit row; the facilitator member bar; admin exclusion from sessions.
- The champion's risk note (section 9), recorded as accepted by the owner.
- #208 needs no separate implementation issue: this change is the implementation.

**BRD (`requirements/BRD.md`):**
- **FR-8.2:** "After a team's first session, the facilitator or an Application Administrator shall be able to add, remove, restore, or reorder topics for that team. An Application Administrator may do so whether or not they hold a membership on the team, in any role." Add "restore", which TOPIC-005 already does. Short rationale paragraph, labelled "added by #208": admins are a trusted role; the facilitator member bar (FR-2.2's principle, enforced on topic writes as `FACILITATOR_IS_TEAM_MEMBER`) applies to facilitators only.
  - Optional traceability fix, with no behaviour change: qualify the facilitator as "a facilitator who is not a member of the team" so the member-facilitator bar finally has a BRD source (the gap BA C1 found). I recommend including it, because it costs one clause and closes a gap that otherwise invites someone to "harmonise" the two actors later.
- **FR-8.7 rationale (L341):** delete ", except an administrator who holds an engineering manager membership on that team (no-manager rule; #232)".
- **Constraint 2 (L652):** delete the final sentence "An administrator who holds an engineering manager membership on a team cannot read that team's topic configuration (#232)." The D11 sentence about session participation stays word for word.
- **FR-1.3 admin bullet:** leave the session-exclusion text untouched. Optionally add "They may read and change any team's topic configuration (FR-8.2)." I'd add it, so the positive grant sits next to the exclusion and the two are read together.
- **Traceability table:** add the missing FR-8.2 row.

**Use cases (`requirements/use cases/08 - Topic Management - Use Cases.md`):** delete the alternate flow "Administrator who holds an engineering manager membership on the team" (L472). Keep the #259 acceptance criterion "Every administrator view is recorded in the audit log, without topic names or definition text."

**REST API Contract (`requirements/design/REST API Contract.md`):**
- TOPIC-001 corrected note (L566): "…TOPIC-002, which audits every administrator read (see TOPIC-002's Notes; #232, #208)". Drop "applies the administrator no-manager rule".
- TOPIC-002 Authorization (L632): drop "(subject to the no-manager rule below)". **Remove** the "Administrator no-manager rule" paragraph (L634). Replace it with one sentence: "An `application_admin` is admitted whatever their membership on the team (#208, reversing #232's no-manager rule)."
- TOPIC-002 403 table: **remove** the `ADMIN_IS_TEAM_MANAGER` and `ADMIN_MEMBERSHIP_NOT_ADMITTED` rows (L696–697) and both names from the reason-names sentence (L700). Keep the #259 `404` row clarification: it is accurate and #265 depends on it.
- TOPIC-002 Notes: the annotation-fields note (L703) goes back to "to standing facilitators and to administrators". The audit note (L706) drops every `admin.topic_config_denied` mention and "every no-manager 403"; `membership_role` is documented as `null | "participant" | "engineering_manager"`.
- TOPIC-006 Authorization (L913): drop "; `TOPIC-002` shares the facilitator side but adds a no-manager rule to its admin side, #232".
- Appendix B: the TOPIC-002 row (L3070) becomes "Yes; every read audited" with "TOPIC-003..006 unchanged pending #208" removed. The TOPIC-003 row's "admin (any team, per FR-8.2)" becomes "admin (any team, any membership, per FR-8.2 / #208)". Do the same for the TOPIC-004..006 row.

**Specs (`openspec/specs/*`).** Delta specs must **MODIFY or REMOVE** these, not only add. Otherwise main specs contradict themselves and the old scenario wins the next argument:
- `topic-customization-lock`: the requirement text at L115–140 ("subject to the no-manager rule", the "No-manager rule on the administrator arm (#232)" paragraph, the reason-name list and the two messages at L125–134, the "Boundary with the topic-write endpoints … until #208" paragraph, and the timing-floor mention of the no-manager rule). Scenarios: L154 (EM-member admin denied → **MODIFY** to admitted and audited with `membership_role: "engineering_manager"`); L161 (unrecognised membership role denied → **REMOVE**); L166 (removed EM membership admitted → **REMOVE** as moot, or keep as a `membership_role: null` audit scenario); L191 (failed denial insert → **REMOVE**); L204 ("no-manager rule does not change the topic-write endpoints" → **MODIFY**: GET 200, POST 201); L290 `canAddTopics` prose (true for every admin, now with no exception); L304–307 (parity exception → **MODIFY**: no exception); the audit requirement titled "…every administrator read and every administrator denial" at L313 → reads only; remove the denial-row block (L330–342) and the scenario at L382; adjust the failure scenario at L373.
- `team-content-access`: the audit-visibility guard (L191) names only `admin.topic_config_accessed`. L229 (EM-member admin denied TOPIC-002) → **MODIFY** to admitted and audited. L248 (failed denial insert) → **REMOVE**. L258 drops `admin.topic_config_denied`. **Not** L347 ("Application Admin with an engineering manager membership takes the admin path"): that is TOPIC-001 (#187) and is unaffected.
- `topic-annotation`: the L234 prose drops "It also rejects an `application_admin` who holds an active `engineering_manager` membership…". The L245 scenario → **MODIFY**: such an admin receives the annotation, read-only (`canEditAnnotations: false`), and the read is audited without the text.
- `topic-management-screen`: L36 (access-denied state shows the server's reason) → re-anchor on a non-admin 403 message. L159 (admin who manages the team sees an explained denial) → **MODIFY**: they see the screen. L530 (admin who manages the team sees no definitions) → **MODIFY**: sees them read-only.
- `reorder-topics` and `restore-topic` Purpose (L5): drop "TOPIC-002 shares the facilitator side but adds a no-manager rule to its admin side, #232".
- `add-custom-topic`, `remove-topic`, `restore-topic`, `reorder-topics`: the existing "administrator who is a team member … is exempt" scenarios already assert the decided behaviour. Add "in any membership role, including `engineering_manager`" so the exemption reads as decided rather than incidental.

**`docs/deployment.md`:**
- L291: drop `admin.topic_config_denied` from the durable admin-read list and from the `actor_roles` writers list.
- L302: `admin.audit_write_failed` fires on the access-row path only.
- **"Review queries (#232 compensating control)" (L308 onward):** remove the section as a compensating control. There is no longer a rule for it to compensate. Query 2 (self-demotion correlation) has nothing left to detect: demoting yourself no longer unlocks anything. Query 1 can stay as an on-demand lookup, with no cadence and no named owner, rewritten to key on what the row now records directly:
  ```sql
  SELECT * FROM audit_log
   WHERE operation = 'admin.topic_config_accessed'
     AND (metadata->>'membership_role' = 'engineering_manager'
          OR 'engineering_manager' = ANY(actor_roles));
  ```
  The "Proposed: Security (Tomás Ferreira), monthly" line and the "Until #238 revisits admission" line both go.

## 7. Downstream impact (for the human; not acted on here)

No issue was edited. Searches: `gh issue list --state open --search` for `ADMIN_IS_TEAM_MANAGER`, `ADMIN_MEMBERSHIP_NOT_ADMITTED`, `topic_config_denied`, `topic_config_accessed`, `#232`, `PR #259`, plus the #232 archive `handoff-drafts.md`.

| Issue | Effect | Suggested action |
|---|---|---|
| **#260** Bar an admin from changing their own membership role (self-service bypass of the TOPIC-002 no-manager rule) | **Moot.** Nothing is left to bypass. | Close as superseded by #208, linking the decision record. |
| **#263** TOPIC-002 machine-readable 403 codes | Loses the `ADMIN_IS_TEAM_MANAGER` / `ADMIN_MEMBERSHIP_NOT_ADMITTED` table row. Still valid for `NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER` and TOPIC-001. | Edit the body; land #208 first. |
| **#264** Audit TOPIC-002's non-admin 403s per SEC-13 | Still valid. Its context cites `admin.topic_config_denied` as a precedent and says "an admin who manages the team [leaves a trace]". | Edit the context; cite `topic.write_denied_lock` etc. as precedent instead. |
| **#265** `404` for an unknown team id on TOPIC-002 | Still valid. Its `admin.topic_config_accessed`, `team_found: false` reference is still accurate. | None, beyond "depends on #208 merged" if both touch the handler. |
| **#262** Generalise the audit-visibility guard | Still valid. The guard now covers one TOPIC-002 operation instead of two. | Minor wording. |
| **#261** Root error handler for `500`s | Still valid (the access row is still fail closed). | None. |
| **#238** (closed) | Its posted "please revisit TOPIC-002 admission when reporting chains land" comment is now moot for TOPIC-002. | Optional note on **#247** (reporting chains, deferred) that TOPIC-002 admission is no longer on its list. |
| **#201** Topic provenance | The earlier plan said "land #208 first; #201 then has only non-member admin writes to show". Under the decision, member-admin writes stay, so facilitator-visible provenance is now the only way a team sees that an insider admin changed its agenda. | Raise #201's priority, or at least re-read it with that in mind (section 9). |
| **#225** Audit 403 denials on topic endpoints | Related to #208 but unaffected. | None. |
| **#208** | Decision recorded; this change implements it. | Comment with the decision and a link to the record when the PR opens. |
| **#187 Follow-up 5** (release-note line, from the #232 handoff) | The approved wording "Engineering managers, **including administrators who manage the team**, cannot read the team's definitions" becomes **false**. | Revise to "Engineering managers cannot read the team's definitions. Application administrators can, including one who manages the team; every administrator read is audited." Owner approves the wording. |

## 8. Test plan sketch

- TOPIC-002 unit (`content.test.ts`): an admin with each of no membership, `participant`, `engineering_manager` gets `200` with topic data and exactly one `admin.topic_config_accessed` row whose `membership_role` matches; insert < event < floor < reply; no `admin.topic_config_denied` insert on any path. Fail-closed tests for the access row and `assertTopic002AuthorizedRole` stay.
- TOPIC-002 integration (real Postgres): an EM-member admin gets `200`; the annotation text is in the response and **not** in the audit row (text-free assertion kept); `actor_roles` written.
- Parity: every admin row is `ADMITTED_CAN_ADD`; the exception type is gone; `servedMembershipRoles` still proves the membership read ran.
- Writes: every existing member-admin test on TOPIC-003..006 passes unmodified. That is the evidence for "no behaviour change". `git diff main -- packages/backend/src/auth/standing-facilitator-access-helper.ts` should be empty, and `topics.ts` should show comment changes only.
- Frontend: the generic 403 message test passes with a re-anchored fixture; TeamPage link test unchanged.
- Regression: facilitator paths gain no query; global EM still `NOT_A_FACILITATOR`; TOPIC-001's #187 admin denial (`admin.session_content_denied`) unchanged; TOPIC-007 still refuses admins.

## 9. Champion's risk note (recorded disagreement, decision accepted)

I recommended the opposite (section 11), and I'm recording why once, so the next person who reads this knows the trade was made with open eyes. I'm not reopening it.

**What a manager-admin can now read.** TOPIC-002 returns each topic's prompt, vote type and order, and the **team annotation** ("Our team's definition") with its provenance (`annotationUpdatedBy`, `annotationUpdatedAt`). The annotation is up to 500 characters of plain text, written by a non-member facilitator who was in the room. It records what a topic *means for this team*, in the team's own words. For topics like "Psychological safety" or "Speaking up", that wording can reflect what the team said when the manager wasn't there: "we mean being able to push back on deadlines without it coming up in reviews". It is not vote data and not individual attribution. It is still the closest thing in the topic configuration to the team's candid voice, which is why #187 kept it from engineering managers and #232 extended that to admins who manage the team. TOPIC-001 still denies EMs (#187); after this change, holding the admin role is the route around that for a manager.

**What a manager-admin can now do.** Add, archive, restore and reorder their own team's topics. For example, archive "Psychological safety" before a session, or move "Delivery pace" to the top. A facilitator who is also an admin can do the same on their own team (fixed precedence, section 2). The facilitator-from-another-team rule exists to keep that kind of agenda-shaping out of insiders' hands.

**Why the owner accepts it, as I understand it.** Admins are a small, deliberately chosen, trusted group. Constraining them in the product is the wrong control. If an admin can't be trusted with a team's topic wording, the fix is who holds the admin role, not a per-feature exception. The protections the ritual depends on most are intact: no admin, manager or not, takes part in a session, votes, or receives live session events, and every session is still run by a facilitator from outside the team. Every admin read and every admin write leaves a durable, attributed row, and the read row now names the reader's membership role.

**What I'd ask in return** (suggestions, not conditions):
1. Keep admin membership in a team rare, and say so in the deployment hygiene checklist next to the existing "facilitators should not also be in the manager or admin groups" line.
2. Give #201 (facilitator-visible provenance) more weight. Audit rows are read by auditors; the team and its facilitator see nothing when an insider admin changes the agenda.
3. Correct the #187 release note (section 7), so the claim about who can read definitions stays true.

## 10. Open items for a human

1. **Product owner:** approve the revised #187 release-note line (section 7), and confirm the docs choices in section 6: the optional FR-8.2 facilitator qualifier, the optional FR-1.3 sentence, and keeping review query 1 as an uncadenced lookup.
2. **Security (Tomás):** confirm that keeping `membership_role`, `actor_roles` and `actor_idp_roles_include_em` on the access row, with the compensating-control framing and cadence removed, is acceptable. Confirm that historical `admin.topic_config_denied` rows stay as they are.
3. **Whoever triages:** the issue actions in section 7.

Everything else can be settled in proposal and design.

## 11. Superseded recommendation (history)

Before the owner's decision, this exploration recommended **option A: refuse TOPIC-003..006 to any `application_admin` with an active membership on the team**, with a new `ADMIN_IS_TEAM_MEMBER` code, a durable `admin.topic_write_denied` row, a read-only notice on the screen for participant-member admins, and #232's read rule left in place. That made the write set strictly smaller than the read set.

The argument was:
- topic writes are agenda-setting, so they belong under the facilitator-from-another-team principle, which bars any membership;
- fixed role precedence means the admin role removes that bar for a facilitator who is also an admin, on their own team;
- lockout was not a real risk, because a team can only write topics after a session run by a non-member facilitator, who can still make every change.

The facilitator (Priya Nair) and BA (Marcus Delgado) reviews supported A and refined it: notice copy, SEC-13 denial auditing, FR-8.6 interpretation, MODIFIED scenarios, and follow-up issues. Options B (bar only EM-member admins) and C (bar nothing on writes, keep #232) were rejected in that analysis.

The owner chose a fourth outcome, no bar and undo #232, on the ground that admins are a trusted role. Option A's artifacts (the new reason code, the denial row, the notice, the factory, the rollout query) and its proposed follow-ups (naming the facilitator on screen, the member-admin denial cap) are **dropped**. The follow-up "audit member-facilitator 403s on TOPIC-003..006" (an existing SEC-13 gap) stands on its own merits and is already covered in spirit by #225.
