# Sync Review: Solution Architect (Ingrid Sollenberger)

Change: `232-topic-002-admin-read-audit-no-manager`. Stage: post-sync drift check.

## Verdict

**No substantive drift.** The merged main specs, the REST API Contract, BRD FR-8.7 and Constraint 2, Use Case 08 and `docs/deployment.md` all match the code as implemented. I fixed four small problems directly: two structural, two wording. Nothing non-trivial is left open in docs or code. One operational item is still open (see the last section).

## What I checked against the code

| Claim (docs/specs) | Code | Result |
|---|---|---|
| Admin arm admitted only for live active membership `null` or `participant` (allow-list). `engineering_manager` gives `membership_em`, anything else gives `membership_unrecognised` | `evaluateAdminTopicConfigRead` (content.ts) | Match |
| The no-manager check runs only after the shared decision admits an admin, so facilitators get no extra query. Shared helper unchanged, and TOPIC-003..006 still admit | Admin branch guarded by `decision.actorGlobalRole === "application_admin"`; `standing-facilitator-access-helper.ts` not modified | Match |
| Only `facilitator` / `application_admin` reach the data. Any other role gives `500` before any read, with no role value in the message | `assertTopic002AuthorizedRole`, called right after the decision and before the membership read | Match |
| Deny path runs no topic, annotation, team-name or lock-state query. Order is insert, then event, then floor, then send | Deny branch returns before the team/topic/lock reads; `applyTimingFloor` comes after the insert and event | Match |
| 403 messages and envelope, `Cache-Control: no-store` | `ADMIN_IS_TEAM_MANAGER_MESSAGE` / `ADMIN_MEMBERSHIP_NOT_ADMITTED_MESSAGE`, `noStore(reply)` | Match (exact strings) |
| Access-row metadata keys, event payload keys, `annotated_count` over active+archived, `team_found` from the team-name lookup | `insertTopic002AdminAuditRow` call and `emitAuditEvent` in the 200 tail | Match (exact key sets) |
| Denial-row metadata has no `team_found` | Deny-branch metadata | Match |
| `actor_roles` written via `$7::text[]`, read once, "highest precedence first" | `readActorRoleSet` (`roles::text[]`, zero rows throws, `parseRoleArray`). `users.roles` is stored sorted by `RANK` (role-map.ts) | Match |
| `admin.audit_write_failed` covers the role-set read and both inserts (not the membership read), SQLSTATE only | `withAdminAuditFailureSignal`. `readActiveMembershipRole` is unwrapped | Match |
| Fail closed: insert failure gives `500` with no data | Plain awaited insert. A throw propagates to the root handler | Match |
| Non-canonical id gives `404` before any query. An unknown canonical UUID gives `200`, audited with `team_found: false` | `isCanonicalUuid` guard; `teamResult.rows.length > 0` | Match. Contract 404 row corrected accordingly |
| A global EM gets `NOT_A_FACILITATOR` whatever their membership | Shared helper returns `NOT_A_FACILITATOR` for any role that is neither admin nor facilitator | Match |
| team-content-access: admin reads write the row after the read and before the send, fail closed (generalised from the old "same transaction" text) | teams.ts `admin.membership_list_accessed` / `admin.team_detail_accessed`: awaited insert after the reads, before `reply.send` | Match. The new text is more accurate than the old "same transaction" wording |
| Audit visibility guard: non-admin `audit_log` reads filter by equality | Only non-test read: `fetchConnectionRecoveries` (`operation = 'session.connection_recovered'`) | Match |
| Frontend: 403 shows the server's `error.message`, a non-JSON body falls back to the generic text, and a 403 is never shown as a network error | `TopicManagementPage.tsx` `res.json().catch(() => null)` + `hasEnvelopeMessage` | Match |
| Team page link not hidden by role or membership | `TeamPage.tsx` renders the Topics link whenever `teamId` is set | Match |
| deployment.md log-only count (14) and `actor_roles` writers | List counted: 7 `auth.*`, 1 `join.*`, 6 others including `admin.audit_write_failed` | Match |
| deployment.md self-demotion query columns (`target_user_id`, `metadata.from_role`/`to_role`) | TEAM-005 insert in teams.ts writes those columns and keys | Match |

BRD FR-8.7 rationale, Constraint 2 and the Use Case 08 alternate flow and acceptance criterion are all consistent with the above.

## Structural soundness of the merged specs

- Every line of the four delta specs appears in the corresponding main spec. MODIFIED requirements were replaced in place, and the ADDED requirement ("audits every administrator read and every administrator denial") sits in `topic-customization-lock`.
- Each requirement has `### Requirement:` headers and at least one `#### Scenario:`. Scenario bullet style (`- **WHEN**/**THEN**/**AND**`) matches each file's existing convention: a blank line after the header in team-content-access, none in topic-customization-lock, topic-annotation and topic-management-screen.
- The `openspec` CLI is not installed in this environment, so I checked the structure with a script instead of `openspec validate`.

## Fixes applied directly (trivial)

1. **`openspec/specs/team-content-access/spec.md`**: the sync dropped the `---` separator between "Application Admin access is limited to administrative data" and "The active-topics endpoint admits only non-manager participant members...". Restored it. Every other requirement in that file is separated this way.
2. **`openspec/specs/topic-customization-lock/spec.md`**: added the missing blank line between the last scenario of the modified authorization requirement and the next `### Requirement:` header. The problem predates this change but sits right next to the merged text.
3. **Purpose lines in `restore-topic` and `reorder-topics` (the BA's flag). Decision: fix.** Both said the facilitator-or-admin model is "shared with TOPIC-002". That is now true only for the facilitator side. This is an authorization statement in a spec Purpose, and a reader auditing admin access would be misled by it, so it is worth a one-clause correction. Minimal edit: the "shared with" list now names only TOPIC-004 (restore) or TOPIC-004/005 (reorder), followed by "TOPIC-002 shares the facilitator side but adds a no-manager rule to its admin side, #232". No requirement text changed.
4. **REST API Contract**: the same stale claim appeared in TOPIC-006's Authorization line ("shared with `TOPIC-002`/`TOPIC-004`/`TOPIC-005`"). Corrected it the same way. TOPIC-002's own Authorization line now says "`application_admin` (subject to the no-manager rule below)", so the sentence no longer reads as unconditional before the qualifying paragraph.

## Noted, not changed

- **Pre-existing, unrelated to #232:** `topic-management-screen/spec.md` has three `### Requirement:` headers with no blank line before them (around lines 558, 625 and 980). These are outside the requirements this change touched, so I left them alone. They are a candidate for a whitespace-only cleanup.
- **Operational ownership is still open:** `docs/deployment.md` says the #232 review queries are "Proposed: Security (Tomás Ferreira), monthly, no alerting. Pending owner confirmation." Until an owner confirms, the compensating control for the no-manager rule's out-of-band gap (direct-DB membership removal, and admins who also manage teams) exists on paper only. Security should confirm the owner before archive. This is not docs drift; it is an unassigned operational task.
- `canAddTopics` wording ("true for every caller TOPIC-002 admits") in the contract and in the topic-customization-lock implementation note is still accurate, because admins denied by the no-manager rule never receive a body. No change needed.
