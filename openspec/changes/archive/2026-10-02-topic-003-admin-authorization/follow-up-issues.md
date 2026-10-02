# Follow-up issue drafts for #176 (topic-003-admin-authorization)

These are ready to file by a human. Filed 2026-10-02: F1 #208, F2 → existing #201 (comment), F3 #209, F4 → comment on #200, F5 #210, F6 #211, F7 #212. F5–F7 were added in response to the design reviews and are not merge-gating. **F1 and F2 must be filed before #176 merges** (exec review condition 1). After filing, record the numbers in `tasks.md` 6.4 and in the proposal's Follow-ups section.

---

## F1

**Title:** Decide whether an application admin who is a team member may change that team's topics (TOPIC-003/004/005/006)

**Milestone:** needs an owner and a decision date. Suggested: same milestone as F2.

**Body:**

FR-8.2 [HARD] lets "the facilitator or Application Administrator" add, remove or reorder a team's topics after its first session. FR-8.2 puts no membership restriction on the administrator, so TOPIC-003 (add, from #176), TOPIC-004 (archive), TOPIC-005 (restore) and TOPIC-006 (reorder) all admit an `application_admin` who has an active membership on the target team.

Facilitators are treated differently. A facilitator who is a member of the team gets `403 FACILITATOR_IS_TEAM_MEMBER`, because someone from inside the team shaping what the team discusses is the social pressure the facilitator-from-another-team rule is meant to prevent. A member-admin carries the same pressure, and maybe more of it.

**Question to decide:** should a member-admin be barred from topic writes on their own team, the same way a member-facilitator is?

**Constraints:**
- Decide once and apply it to TOPIC-003/004/005/006 together. Don't change one endpoint at a time.
- If barred: pick a reason code (reuse `FACILITATOR_IS_TEAM_MEMBER` or add a new one), update TOPIC-002 `canAddTopics` and the parity test (`topic-add-flag-parity.test.ts`) in the same change, and update the BRD/contract prose.
- TOPIC-007 (team definition) is already facilitator-only under FR-8.7 and is not in scope.
- **Interim compensating control.** Until this is decided, the in-transaction audit rows (`topic.custom_added`, and the archive / restore / reorder rows) carrying `actor_global_role = 'application_admin'` and the `team_id` are the **only** safeguard against a member-admin shaping their own team's topics. Nothing blocks the write; the audit row is the sole record. #176's tests assert that row for both non-member and member admins, and those assertions must not be weakened while this issue is open (security review N4).
- Implementation note: the four per-endpoint wrappers (`checkAddCustomTopicAuthorization`, `checkArchiveTopicAuthorization`, `checkRestoreTopicAuthorization`, `checkReorderTopicsAuthorization`) are the same ~15 lines with different strings. If this decision changes all four, collapse them into one factory (e.g. `makeFacilitatorOrAdminCheck({ notAFacilitator, isTeamMember })`) in the same change (engineer review N1).

**References:** #176, `openspec/changes/topic-003-admin-authorization/design.md` D5, BRD FR-8.2.

**Acceptance:** a recorded decision (with rationale) and, if the answer is "bar", a linked implementation issue covering all four endpoints.

---

## F2

**Title:** Show facilitators who added a topic and when ("added by / added on") on the Topic Management screen

**Milestone:** the milestone after #176's. Not the general backlog.

**Body:**

From #176, an application administrator can author a custom topic (name, prompt, first-session description) for any unlocked team. Participants answer that prompt in the room. Right now a facilitator can't tell whether a topic came from the team's facilitator, an admin, or the canonical set. If a facilitator can't say where a prompt came from, engineers may read it as someone above them deciding what they talk about. That erodes the trust the ritual depends on.

The data already exists: the `topic.custom_added` audit row records the actor and `actor_global_role`. The audit log isn't visible to facilitators.

**Scope:**
- Show the origin of each custom topic on the Topic Management row, for example "Added by <name> (application admin) on <date>" or "Added by facilitator on <date>". Canonical topics need no label, or "Default topic".
- Decide whether the source is a stored column on `topics` (`created_by`, `created_by_role`) or a read from the audit log. A column is probably simpler and doesn't need audit-log read access. It also means audit-retention policy can't erase provenance: today the `topic.custom_added` row is the only durable record of who authored a topic, and it outlives the topic only if audit retention does (security review N1).
- Visible to whoever can already view the screen. No new access.
- Must not become a way to compare individuals. It describes topic provenance, not participant behaviour.

**Out of scope:** surfacing provenance inside the live session room (the tool should stay out of the room). If that's wanted later, it needs its own issue.

**References:** #176, `openspec/changes/topic-003-admin-authorization/design.md` risks, exec review condition 1.

**Acceptance:** a facilitator viewing a team's topics can see, for each custom topic, the role of the person who added it and the date.

---

## F3

**Title:** Tell editors that topic changes take effect from the next session room, not one already open

**Milestone:** backlog.

**Body:**

Since #175, `session_topics` is snapshotted when a room opens, so add, archive, restore and reorder edits made while a room is open don't affect that session. That's correct. But the Topic Management screen doesn't say so. A facilitator or admin who edits during an open room may think the change is live.

**Scope:** when the team has an open session room, show a short, non-alarming notice on the Topic Management screen, for example "A session is in progress. Changes apply from the next session." This applies to all roles and all topic write endpoints (TOPIC-003/004/005/006). Keep it quiet. No modal, no notification.

**References:** #175, #176.

**Acceptance:** with a room open for the team, the notice appears on the Topic Management screen. With no room open, it doesn't.

---

## F4 (comment on #200, not a new issue)

**Post as a comment on:** #200

**Body:**

From #176 (admin can add custom topics), two points for this issue:

1. **Admin viewer copy.** The locked empty-state message ends "Ask the people who run this application for your organization to restore this team's default topics." Since #176, application administrators see this variant too, and for them the sentence tells them to ask themselves. #176 deliberately didn't assert the message text for administrators (the `topic-management-screen` scenario "Locked team with no topics, administrator" checks structure only), so this issue owns the admin-facing copy.

2. **FR-8.6 gap.** On a *locked* team with zero active topics, nobody can add, restore or reorder, admins included, because the customization lock gates every write. FR-8.6 [HARD] says the canonical default set "must remain visible and restorable for any team at any time". #176 didn't create this gap and didn't try to close it, but the resolution here should cover more than wording. It needs to decide who, if anyone, may restore defaults through the lock, and how that stays consistent with "the first session runs the canonical set".

---

## F5

**Title:** Decide who may assert `application_admin` through each OIDC provider's role claim

**Milestone:** identity/IdP backlog. Not merge-gating for #176.

**Body:**

`account-resolver.ts` maps `users.global_role = 'application_admin'` directly from the signed ID token's `OIDC_ROLE_CLAIM` and re-applies it on every sign-in. So the real control over who holds `application_admin` is whoever administers role-claim (app-role or group) assignment in the IdP, not this application. Since #176, an `application_admin` can create participant-visible topics on every team, so an admin grant is worth more than it was.

The application supports multiple OIDC providers: Entra ID is primary, not the only one. Every configured provider whose role claim can yield `application_admin` is an independent grant path with its own assignment administrator.

**Question to decide:**
- Should `application_admin` be accepted only from an allowlisted provider (or providers), configured per provider rather than globally?
- Should anything structurally prevent an account that holds `engineering_manager` authority from also holding `application_admin` (exec review C2)?
- Who is the named role-assignment owner for each provider, and where is that recorded operationally?

**Constraints:** provider-agnostic. No Entra-specific code path; any restriction must be expressible as per-provider configuration.

**References:** #176, `openspec/changes/topic-003-admin-authorization/design.md` Risks, security review S1, `openspec/specs/first-access/spec.md` (role-claim mapping).

**Acceptance:** a recorded decision. If the answer includes a restriction, a linked implementation issue.

---

## F6

**Title:** Re-evaluate `global_role` promptly when a role is revoked in the IdP

**Milestone:** identity/session backlog. Not merge-gating for #176.

**Body:**

`users.global_role` is rewritten only at sign-in. Authorization reads it live, but the value can be stale for the whole application session. A user whose `application_admin` (or `engineering_manager`) role is removed in the IdP keeps that authority until their session ends or they sign in again. This already applied to TOPIC-004/005/006 and to team administration. #176 adds topic *creation* on every team to that window.

**Scope:** decide on an acceptable revocation window and a mechanism that works for **every** configured OIDC provider, not just Entra. Options include shorter session lifetimes for elevated roles, periodic re-validation against the provider, or provider-specific revocation signals behind a provider-agnostic interface. Document the chosen window.

**References:** #176 design Risks, security review S2.

**Acceptance:** the revocation window is documented and, if it is shortened, a linked implementation issue.

---

## F7

**Title:** Alert on unusual volume of application-admin topic writes

**Milestone:** ops/monitoring backlog. Not merge-gating for #176.

**Body:**

Topic writes have no rate limit or per-team cap. A facilitator reaches only the teams they facilitate, but since #176 an application admin can add topics on every team. A compromised admin session could inject prompts org-wide. Audit rows would record it, but nothing would alert anyone.

**Scope:** a detection rule on `audit_log` for `action = 'topic.custom_added'` (and, optionally, archive/restore/reorder) with `actor_global_role = 'application_admin'`, firing when the row count or the distinct `team_id` count for one actor exceeds a threshold within a window. Pick the thresholds from real usage. Detection only: no rate limit.

**References:** #176, security review N2.

**Acceptance:** the rule exists, and a synthetic burst triggers it.

---

## PR description section (draft, tasks.md 6.2)

Copy into the PR description. Fill the blanks; do not merge with any merge-gate line still blank.

### Follow-ups and merge gates

- **[MERGE GATE] F1** (member-admin across TOPIC-003/004/005/006): #208
- **[MERGE GATE] F2** (added-by display, milestone after this one): #201 (pre-existing)
- F3 (next-room notice): #209 (not merge-gating)
- F4: comment on #200 (FR-8.6 admin viewer) (not merge-gating)
- F5, F6 (identity/session backlog): #210, #211 (not merge-gating)
- F7 (ops/monitoring detection rule): #212 (not merge-gating)

### IdP role-assignment administrators (`application_admin`) — [MERGE GATE]

Every configured OIDC provider whose role claim (`OIDC_ROLE_CLAIM`) can yield `application_admin` is an independent grant path for topic-write authority on every team (design.md Risks). Name the person who administers that role assignment for each provider in each deployment environment.

Providers enumerated from the repo's deployment config (`OIDC_ISSUER`):

- Local development (`.env.example`, `docker-compose.yml`): simulated OIDC provider at `http://localhost:4011` (`docker/oidc/server.js`; refused in production by `config.ts`). IdP role-assignment administrator: n/a, test-only provider (confirm: ____)
- CI integration lane (`.github/workflows/integration.yml`): same simulated provider at `http://localhost:4011`. IdP role-assignment administrator: n/a, test-only provider (confirm: ____)
- Production, Microsoft Entra ID (primary provider; issuer supplied at deploy time, not in the repo): IdP role-assignment administrator: ____
- Production, any other configured OIDC provider (Entra is primary but not the only supported provider; list each one): provider ____, IdP role-assignment administrator: ____
