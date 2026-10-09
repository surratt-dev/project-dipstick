# Security Design Review: 208-member-admin-topic-writes (#208)

**Reviewer:** Tomás Ferreira, Senior Application Security Analyst
**Date:** 2026-10-08
**Reviewed:** `design.md`, `proposal.md`, `tasks.md`, the `team-content-access` delta; checked against `packages/backend/src/routes/content.ts`, `routes/topics.ts`, `routes/teams.ts`, `auth/standing-facilitator-access-helper.ts`, `auth/team-content-access-helper.ts`, `auth/audit-logger.ts`, BRD SEC-13, issue #260.
**Verdict:** **Approve with changes.** None of the changes is blocking. The product owner's decision is final and I am not reopening it. Everything below is about implementing it without losing a control we did not mean to lose.

---

## 1. Scope of the decision, from a security point of view

The owner has accepted R-EXEC-1: an administrator who manages a team can read that team's definitions and change its agenda. My job is to confirm three things: the acceptance is written down, the controls that remain are real, and nothing else widens along with it. The proposal records the risk, who accepted it and why. That is enough for me.

## 2. Does the revert keep fail-closed audit behaviour on admin reads?

**Yes, provided tasks 2.3, 2.4 and 3.3 are followed as written.** I traced the admin arm after the change (design D3):

| Step | Failure | Outcome after the change | Same as today? |
|---|---|---|---|
| `checkStandingFacilitatorOrAdminAuthorization` | throws | 500, no data | Yes |
| `assertTopic002AuthorizedRole` | unknown role | 500, no row, no data read | Yes |
| `readActiveMembershipRole` | throws | 500 before any data read | Yes |
| `readActorRoleSet` | throws or zero rows | 500 before any data read, `admin.audit_write_failed` (stage `role_set_read`) | Yes |
| data reads | throw | 500, nothing sent | Yes |
| `admin.topic_config_accessed` insert | throws | 500, data already read but **not sent**, `admin.audit_write_failed` (stage `audit_insert`) | Yes |
| event, then `applyTimingFloor`, then send | n/a | insert is before the floor and the send | Yes |

The property that matters ("a read is never served unaudited") is unchanged. The revert also removes a branch whose own insert could fail. That reduces the number of fail-closed paths to test without weakening any of them.

Confirmed and correct:

- **D2 (raw `membership_role`, no allow-list).** Once nothing decides on the value, an allow-list could only add a failure mode. The value comes from a Postgres enum column, so it carries no free text or PII. A future enum value is recorded as itself, which is what an investigator needs. **Answer to design Open Question 2:** keep `membership_role`, `actor_roles` and `actor_idp_roles_include_em` on the access row. They now *are* the evidence that a reader manages the team or sits in the IdP manager group. It is fine to drop the "compensating control" framing. Leave historical `admin.topic_config_denied` rows untouched; deleting or rewriting audit rows is never acceptable.
- **D1, keeping the membership read instead of the helper's `isMember` boolean.** Agreed. A boolean would lose exactly the fact R-EXEC-1 turns on.
- **D3 timing.** After the revert every admin takes the same path whatever their membership role, so the previous difference between the deny path and the admit path (deny ran no data reads) is gone. The floor still covers every exit. This is a small improvement.

**S-1 (low, pre-existing, optional).** A failure of `readActiveMembershipRole` fails closed but emits no `admin.audit_write_failed` signal. `content.test.ts` "3.4" deliberately asserts that it emits none. Now that the membership role is audit input only, a failure to read it is an audit-input failure like the role-set read. I would wrap it in `withAdminAuditFailureSignal` with a `stage: "membership_read"`, so an operator watching that signal sees every reason an admin read was refused. This is optional and I will not hold the change for it. If it is not done here, leave the existing test as it is so the behaviour stays deliberate.

## 3. Does removing `admin.topic_config_denied` leave a SEC-13 gap?

**No.** SEC-13 requires "access control denials" to be audited. The denial row existed because the denial existed. After the revert, the shared helper admits every `application_admin` before it looks at membership (`standing-facilitator-access-helper.ts`), so no admin request to TOPIC-002 can be refused any more. With no denial event, nothing is left unaudited. Every admin outcome on TOPIC-002 is now one of three things: an audited `200`, a `500` with no data, or a `404` on a non-canonical UUID before any query (pre-auth, no data, unchanged).

What remains is not new:

- **Non-admin TOPIC-002 `403`s are still not audited** (`NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER`). This is a real SEC-13 gap, but it predates this change and is tracked in #264. This change neither widens nor narrows it. **Ask:** when #264's body is edited (exploration §7), cite the `topic.*` write-denial operations as precedent instead of `admin.topic_config_denied`, as the exploration already proposes. Do not let #264 be closed as "related to #208".
- **The visibility guard.** The delta keeps historical `admin.topic_config_denied` rows under the guard (`team-content-access` delta L25, L86). This is correct and required: those rows still exist. Note that the guard is enforced by spec and review only. The single `audit_log` reader in application code (`content.ts` ~L1199) uses an equality filter, and no automated test scans for wildcard selects. This is pre-existing and outside this change, so I am noting it only.

## 4. Does anything else silently widen?

I checked for any widening beyond TOPIC-002 for manager-admins. I found none.

- **Shared helper.** It has no diff (task 5.2 checks this). Write behaviour is byte-for-byte unchanged. Member-admins were already admitted to TOPIC-003..006 before this change.
- **The role guard that stops new roles reaching unaudited data.** `assertTopic002AuthorizedRole` stays (task 2.5), still in front of every data read, still `500` with no row on an unexpected role. Its test stays (task 3.3). On the write side no equivalent guard is needed: every `topic.*` row is written for every actor, with `actor_global_role` taken from the decision, so a hypothetical new role admitted by the helper would still leave an in-transaction row. **One ask (S-2, low):** when rewording the tripwire comment (task 2.5), keep the sentence that says *why* it exists ("a future role admitted by the shared helper must not reach the data unaudited"). Removing #232's no-manager wording must not remove the reason the guard exists. The current comment ties that reason to "#208 will reopen that helper". This change does not reopen the helper, so the reason needs restating, not deleting.
- **Other endpoints.** The admin path wins first in `evaluateTeamAccess` (`team-content-access-helper.ts` path 0), so an admin's membership role decides nothing on session, trend, action-item or note endpoints. They keep denying admins (Option B, `admin.session_content_denied`). TOPIC-001 and TOPIC-007 are untouched. Session participation checks key on `global_role` (`sessions.ts`, `session-subscriber-access-helper.ts`). An admin's membership role was a gate on TOPIC-002 only. Removing it widens nothing else.
- **`canAddTopics` / `canEditAnnotations`.** `canEditAnnotations` stays `facilitator`-only, so a manager-admin gets definitions read-only and TOPIC-007 still enforces this on the server. `canAddTopics` is presentation-only, and TOPIC-003 enforces on its own.
- **Role precedence.** Because of `application_admin > engineering_manager > facilitator`, a member-facilitator or a global EM who is also in the admin IdP group gets around the facilitator member bar and the EM exclusion on topic configuration. The design states this as intended (Context). From now on, membership in the admin IdP group *is* the control. The hygiene line in task 7.8 is the right place to say so. **Ask (S-3, low):** extend that line to mention IdP group overlap, not only `team_memberships` rows: "an administrator who is also in the manager or facilitator IdP group bypasses those groups' restrictions on topic configuration". `actor_idp_roles_include_em` on the access row already gives the evidence for the manager case.

## 5. Is #260 genuinely moot?

**Yes, for the reason it was raised.** #260 described an admin using TEAM-005 to demote their own `engineering_manager` membership to `participant` and get past the TOPIC-002 no-manager rule. After the revert there is no rule left to get past, and (section 4) no other endpoint reads an admin's membership role for authorization. The self-demotion correlation query in `docs/deployment.md` can go with it.

Two notes for the person who closes it:

- Close it as **superseded by #208**, linking 08b. Do not close it as "won't fix". The general principle (no self-approval of one's own role changes) is still reasonable segregation of duties, but nothing currently depends on it. If a future change makes an admin's membership role matter again, #260's proposal comes back with it. Record that in the closing comment.
- Self-service role changes stay **audited** (`team.role_changed` in the same transaction, `actor_user_id = target_user_id`), so nothing loses visibility.

## 6. Audit trail for admin writes: the "join" claim

**S-4 (medium, documentation; not blocking).** The proposal's non-goal says the `topic.*` write rows need no membership field because "`actor_user_id` + `team_id` already join to `team_memberships`". That join gives the membership role **now**, not at the time of the write. TEAM-005 updates `team_memberships.role` in place (`teams.ts` ~L889). An admin who was the team's manager when they archived a topic and was later changed to `participant` would show as `participant`. Reconstruction at a point in time is possible, but it means replaying `team.role_changed` (and manager-association) audit rows up to the write's timestamp. That only works if every way a membership is created or changed is audited. Direct database edits are not.

Now that the write rows are described as the *permanent* record of admin topic writes, the documentation must not overstate what they prove. Either:

- (a) in 08b and `docs/deployment.md`, replace the "join" wording with "the actor's membership role at the time of a write is reconstructed from `team.role_changed` / manager-association history, not from the current `team_memberships` row", **or**
- (b) open a follow-up issue to add `membership_role` (and `actor_roles`, matching the read row) to admin `topic.*` rows.

I prefer (a) in this change and (b) as a backlog item owned by Security. I agree with keeping new fields out of this change, so the write diff stays comment-only.

## 7. Deferred or implicit security decisions

| # | Decision | Status in the design | My position |
|---|---|---|---|
| D-1 | **Detection.** The remaining lookup query has no owner and no cadence (D6). | Explicit, and listed as residual risk. | Acceptable only if it is labelled correctly. 08b and `docs/deployment.md` should say the admin audit rows are **forensic** (used after an incident), not **detective** (nobody is watching them). Otherwise readers will assume monitoring that does not exist. If the manager-admin overlap ever grows beyond a handful of people, revisit this together with #201. |
| D-2 | **Scope of the owner's sentence.** Read literally, it reaches session-content denial, TOPIC-001 and TOPIC-007. | Explicit open item in 08b (task 7.1). | Agreed. **Ask:** in the 08b open item, add that relaxing any of those restrictions goes back through security review. Admin access to session content (votes, trends, notes, action items) is a different data class from topic configuration, and R-EXEC-1's acceptance does not cover it. |
| D-3 | Point-in-time membership on write rows. | Implicit (the "join" claim). | See S-4. |
| D-4 | Non-admin TOPIC-002 `403`s unaudited. | Explicit non-goal, tracked in #264. | Agreed. Keep #264 open. |
| D-5 | Visibility guard enforced by review only. | Implicit, pre-existing. | Note only. Worth an automated source scan when #264 lands. |
| D-6 | `admin.audit_write_failed` does not cover membership-read failure. | Implicit, pre-existing. | See S-1. Optional. |

## 8. Tests I want to see green (beyond the tasks as written)

All of these are already in tasks 3–4. I am listing them so they are not cut during implementation:

1. EM-member admin gets `200` with exactly one access row, `membership_role: "engineering_manager"`, `actor_roles` written, no annotation text in the row (4.1).
2. Fail-closed tests for the membership read, the role-set read and the access insert, each with no data sent (3.3). **These must not be deleted together with the denial tests.**
3. The `assertTopic002AuthorizedRole` tripwire test (3.3).
4. No `admin.topic_config_denied` insert on any path (3.2).
5. Facilitator TOPIC-002 issues no `team_memberships` query (3.6).
6. The member-admin write matrix, each with one in-transaction `topic.*` row and `actor_global_role = 'application_admin'` (4.4).

## 9. Summary of asks

| ID | Severity | Ask | Blocking? |
|---|---|---|---|
| S-1 | Low | Wrap the membership read in `withAdminAuditFailureSignal` (`stage: "membership_read"`), or leave the current behaviour and its test deliberately unchanged. | No |
| S-2 | Low | The reworded tripwire comment keeps its reason ("new roles must not reach the data unaudited"). | No |
| S-3 | Low | Hygiene line (7.8) also covers IdP group overlap (admin + manager/facilitator groups). | No |
| S-4 | Medium | Correct the "join to `team_memberships`" claim in 08b and the deployment doc to point-in-time reconstruction from audit history; optional follow-up issue for membership fields on admin write rows. | No |
| D-1 | Low | Label the admin audit rows as forensic, not monitored. | No |
| D-2 | Low | 08b open item: relaxing other admin restrictions requires security review. | No |
| #260 | n/a | Close as superseded by #208, with the note from section 5. | n/a |
| #264 | n/a | Keep open; update its precedent citation. | n/a |

— Tomás Ferreira
