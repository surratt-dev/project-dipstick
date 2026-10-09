# Exploration notes: #232, TOPIC-002 admin read audit and the no-manager rule

**Explorer:** Devon Calloway (Internal Champion)
**Date:** 2026-10-08 (revised the same day after the explore reviews)
**Branch:** `agent-team/232-topic-002-admin-read-audit-no-manager`
**Issue:** #232 (bug, security, no-manager rule). Related: #208 (member-admin topic **writes**, undecided), #187 / PR #230 (TOPIC-001 reconcile), #53 (topic-annotation), #243/#245 (IdP role set), #238 (reporting chains, deferred).
**Reviews addressed:** `explore-review-facilitator.md` (Priya Nair), `explore-review-ba.md` (Marcus Delgado). The disposition of every review point is in section 12.
**Status:** exploration only. No code written.

---

## 1. Why this matters to the ritual

The no-manager rule isn't only about voting. In #187 we said plainly that it also covers the place where engineers describe their team's health in their own words. "Our team's definition" (`team_annotation`) is exactly that place. If an engineer suspects their manager can read it, they'll write it for their manager, and then the definition stops being worth anything.

This is a candour problem, not just an access-control gap. The proposal has to keep that framing. If it gets written up as "close an authz gap", stripping the annotation fields (option B below) starts to look like an equivalent fix, and it isn't one. A manager who sees the topic names, the prompts and the archive history is still a manager shaping how the team thinks about itself. (Priya, observation 1.)

Today, TOPIC-002 serves those definitions on the Topic Management screen, and it has a door the TOPIC-001 fix didn't close:

```
                         TOPIC-001 (/topics)             TOPIC-002 (/topics/all)
                         evaluateTeamAccess + #187        checkStandingFacilitatorOrAdminAuthorization
caller                   allow-list                      (admin short-circuit first)
─────────────────────────────────────────────────────────────────────────────────────────────
admin, no membership     403 + admin.session_content_    200, annotations, NO audit   ← gap (a)
                         denied row
admin + participant mbr  403 + audit row                 200, annotations, NO audit   ← gap (a) (+ #208 territory)
admin + EM membership    403 + audit row                 200, annotations, NO audit   ← gap (b): the manager reads it
global EM, no mbr        403 + config_read_denied_role   403 NOT_A_FACILITATOR        ok
global EM + participant  403 + config_read_denied_role   403 NOT_A_FACILITATOR        ok (reverse case already closed)
global EM + EM mbr       403 + config_read_denied_role   403 NOT_A_FACILITATOR        ok
facilitator + EM mbr     403 (member path, membership)   403 FACILITATOR_IS_TEAM_MEMBER ok
facilitator + part. mbr  200                             403 FACILITATOR_IS_TEAM_MEMBER ok
facilitator, non-member  200 only with a session grant   200 (standing model)          ok
engineer / senior eng.   200 if participant member       403 NOT_A_FACILITATOR         ok
```

So the only route a manager has to annotations is the **admin arm**. Every non-admin manager shape is already denied, because TOPIC-002 admits only `facilitator` and `application_admin` global roles.

The dual-hat person isn't hypothetical. The BRD's FR-2.4 rationale (#243, D11) says: "a person in both the manager and the admin IdP groups resolves to Application Administrator under the fixed role precedence. Excluding administrators from session participation means such a person cannot get around the no-manager rule." The BRD has already settled the dual-hat conflict once, **against the admin capability**, so the manager can't route around the rule. #232 is the same conflict on a different surface.

## 2. What the code does today

- `packages/backend/src/routes/content.ts` ~L649–L830 (TOPIC-002 handler): canonical-UUID 404 → `checkStandingFacilitatorOrAdminAuthorization` → team name → active topics (with `team_annotation`, `annotation_updated_at`, `annotation_updated_by` + display name) → archived topics (same fields, plus archived/restored provenance) → `defaultTopicsNotActive` → `getTopicLockState` → flags (`canEditAnnotations = actorGlobalRole === 'facilitator'`, `canAddTopics = facilitator || application_admin`). No `audit_log` write and no `emitAuditEvent` call. The existing 403 branch calls `applyTimingFloor(startTime)` and `noStore(reply)`, and sends `{ error: { category: "forbidden", message, correlationId } }`. **The forbidden envelope carries no machine-readable `code` field.** The decision reasons (`NOT_A_FACILITATOR`, `FACILITATOR_IS_TEAM_MEMBER`) are internal, and the endpoint shows them only by picking which message to send.
- `packages/backend/src/auth/standing-facilitator-access-helper.ts`: `evaluateStandingFacilitatorAccess` returns `{ globalRole, isMember }`, a boolean only, with no membership role. `checkStandingFacilitatorOrAdminAuthorization` returns `authorized` on `application_admin` **before** looking at `isMember`. Callers: TOPIC-002 (content.ts) and TOPIC-003/004/005/006 through per-endpoint wrappers in topics.ts.
- `packages/backend/src/auth/team-content-access-helper.ts` `readActiveMembershipRole(userId, teamId)` (L275) is a read, not a policy. It returns the raw active `team_memberships.role` or null, is uncached, and throws if the query fails, so it fails closed. PR #230 exported it for exactly this kind of reuse.
- **Membership role values today** (`migrations/1_create_enums.sql`, `membership_role` enum): exactly `participant` and `engineering_manager`. No later migration adds a value. So the allow-list in section 5 newly denies only `engineering_manager`. The "unrecognised role" branch is purely defensive, for a value added later. (BA C2.)
- `packages/backend/src/auth/audit-logger.ts` documents the two patterns this issue asks us to choose between:
  - **Durable row + event, for admin reads of administrative data:** `admin.membership_list_accessed`, `admin.team_detail_accessed` (teams.ts L432–L454, L590–L618). A plain `INSERT INTO audit_log`, awaited before `reply.send`, **not** wrapped in a transaction ("written immediately (not in a transaction) because this is a read operation"). A failed insert throws, so the endpoint returns 500 and sends no data. That's fail-closed.
  - **Durable row + event, for admin denials:** `admin.session_content_denied` (content.ts `denyAdminContentAccess`).
  - **Log-only, for high-volume or hot-path signals:** `team.access_grant_mismatch` (evaluateTeamAccess runs on every content request) and `topic.config_read_denied_role` (TOPIC-001 can be polled). Each one says explicitly that log-only is justified **by call volume**.
  - Membership role edits already write an in-transaction `audit_log` row plus a `team.role_changed` event. That matters for the self-demotion edge in section 5.
- `packages/backend/src/auth/role-map.ts` / #245: `users.roles` now stores the full IdP role set. `global_role = roles[0]` by fixed precedence (admin 4 > EM 3 > ...). So for a dual-hat person, `roles` contains `engineering_manager`, while `global_role` is `application_admin`. Migration 21 backfilled existing rows to `ARRAY[global_role]`, so the full set is only accurate as of the user's first login after #245. It also states "nothing reads roles for authorization in this step".
- Frontend: `TeamPage.tsx` always shows the "Topics" link (the server gates). `TopicManagementPage.tsx` renders `TeamDefinition` only when `teamAnnotation !== null`, so a null annotation looks exactly like "the team hasn't written one". `TopicManagementPage` is the **only** frontend consumer of `/topics/all`: the initial load (`loadTopics`, ~L659) and the quiet refetch after a write (~L698). On a 403, `loadTopics` **ignores the response body** and always shows the fixed string "You do not have access to this team's topic management." (L662–L663). The page already has a `hasEnvelopeMessage` parser (L214) that the write paths use. (Priya, observations 2 and 4. My earlier note that "a 403 already lands in the existing access-denied state" was correct, but it didn't say the server message is thrown away.)

## 3. What the specs and requirements say

- `team-content-access` content matrix (spec L126): **Topic configuration: EM = "None"**, Admin = "Read-only (metadata, no session data)". So an EM gets *no* topic configuration at all, not just no annotations.
- `team-content-access`, "Application Admin access is limited to administrative data" (L169–L189): "Every Application Admin read of administrative data SHALL be logged in the `audit_log` table … The audit write MUST execute in the same database transaction as the data access operation." L178 already admits that TOPIC-002 doesn't meet this and points to Follow-up 7. That sentence has to be rewritten in this change. The requirement also lists audit fields `action`, `resource_type`, `resource_id`, but the real table uses `operation`, `team_id`, `metadata` (BA C6).
- `team-content-access`, TOPIC-001 requirement (L215+): OR semantics (membership role **or** global role), an allow-list, unconditional, no override, and "An implementation SHALL NOT admit a caller on their global role being `facilitator` before checking the membership signal." Gap (b) is the same mistake made with `application_admin` in place of `facilitator`.
- `topic-customization-lock` "all-topics endpoint uses the standing … model" (L112): spells out the admin arm. It needs an exception added.
- `topic-management-screen` truth table (L490+): "Caller reaching TOPIC-002" lists facilitator and admin. Add a note that an admin who holds an EM membership doesn't reach it.
- `topic-annotation`: covers TOPIC-001 only. TOPIC-002's annotation fields belong to `topic-customization-lock`. #187 Follow-up 5 says release notes must say plainly that EMs can't read team definitions. **That sentence isn't true until #232 ships.**
- REST API Contract (`requirements/design/REST API Contract.md`), TOPIC-002 (L620–L700): Authorization, the 403 row, and the "Annotation fields" note ("returned … to administrators alike") all need updating. The TOPIC-001 note at L566 ("this note makes no claim that TOPIC-002 is audited") can be cleared. **Appendix B** (L3063) does list TOPIC-002 ("Admin: Yes (read-only for annotation fields)"), so that cell changes too (BA V6).
- `openspec/specs/audit-logging-operations/spec.md` doesn't enumerate operations (BA checked it), so it needs no change. The registry is `AuditEventName` in `audit-logger.ts`.
- BRD Constraint 2 (L161–L165): EMs get read-only access to session history, trends and action items, not to topic configuration. FR-2.4 rationale: dual-hat resolves against the admin capability. FR-8.2: admin may add/remove/reorder (writes, which is #208). **FR-8.7 rationale (BRD L341): "Administrators may still read team definitions on the topic management screen."** That sentence is now unconditional and has to gain a qualifying clause (BA section 5).

## 4. Tests that exist for TOPIC-002 today

- `routes/__tests__/content.test.ts`: `describe("GET …/topics/all (design.md Decision 9)")` (L894). It covers facilitator 200, **"an application_admin can list any team's topics, including one they are an active member of"** (L915; a mocked `isMember = true` with no role, which this change has to split), and engineer 403. The annotation block (L1010+) covers admin receives `teamAnnotation` read-only (security R4, L1170), `canEditAnnotations`/`canAddTopics` for admin, and null provenance. A non-canonical-teamId block is at L1251.
- `topic-add-flag-parity.test.ts`: the caller-class table (L119–L130) uses a SQL-routing fake that returns `{ global_role, is_member }`. The rows are admin non-member, admin member (both `ADMITTED_CAN_ADD`), EM (isMember true), engineer, member-facilitator, and no user row. The fake has no membership-role column, so an "admin + EM membership" row needs the fake extended.
- Integration (real Postgres): `topic-annotation-integration.test.ts` (L316: annotation read via TOPIC-002 by facilitator **and admin**; L415 archive/restore), `remove-topic-integration`, `restore-topic-integration`, `topics-integration`, `template-team-*-integration`, `session-topic-snapshot-integration`, `topic-write-rate-limit-thresholds-integration`, `topic-add-admin-integration`.
- **Missing:** any admin-read audit assertion, any admin + EM-membership case on TOPIC-002, and an explicit global-EM + participant-membership regression on TOPIC-002 (the parity "engineering manager" row only covers it indirectly, and its fake doesn't model the membership role).
- Frontend: `TopicManagementPage.annotation.test.tsx` and `.reorder.test.tsx` mock TOPIC-002. The 403-copy decision in section 5a needs one small frontend change and one new test row.

---

## 5. Question 1 (gap b): deny the whole response, or omit the annotation fields?

### Options

```
          ┌───────────────────────────┐
admin ──▶ │ live membership role?     │
          └───────────┬───────────────┘
        null / participant │ engineering_manager (or anything else)
                 ▼                      ▼
        200 + admin audit row    A: 403 whole response (+ durable denial row)
                                 B: 200, annotation fields stripped/nulled
```

| | A. Deny whole response (403) | B. 200 without annotation fields |
|---|---|---|
| Matches content matrix (EM: topic config "None") | **Yes** | No. The manager still gets names, prompts, archived/restored-by names |
| Matches TOPIC-001 for the same caller | **Yes** (both deny) | No. The endpoints still disagree, just more quietly |
| Matches the FR-2.4 dual-hat precedent (resolve against admin) | **Yes** | Partly |
| Truthful response | **Yes** | Null redaction reads as "the team wrote nothing", which isn't true. Making the fields optional changes the shared type and needs new UI copy |
| Effect on facilitators | None | Indirect harm. If a dual-hat admin passes the team's state to an incoming facilitator ("they have no definitions yet"), that facilitator starts from a false picture (Priya, observation 9) |
| Surface area | One new deny branch, existing access-denied UI | Branching serializer, a type change or a silent lie, a frontend notice, and two shapes to test forever |
| Effect on #208 | Takes away the *screen* (not the API) for one narrow subclass: an admin who is also the team's manager | None |
| What drifts later | Nothing obvious | A future field (`teamAnnotation` on another list, a new free-text column) has to be stripped too, or it leaks. A deny-list of fields, which is exactly the shape #187 rejected |

### Decision: **A, deny the whole response**, decided by an allow-list on the admin arm

Requirement wording (adopted from BA R1, with the reason name filled in):

> TOPIC-002 SHALL admit a caller whose global role is `application_admin` only when that caller's live active membership role on the target team is absent or `participant`. Any other membership role, including `engineering_manager` and any role value not listed here, SHALL receive `403`, and the handler SHALL NOT execute any topic, annotation, or lock-state query for that request. The membership role SHALL be read live per request (no cache). This rule SHALL NOT change the authorization of TOPIC-003, TOPIC-004, TOPIC-005, or TOPIC-006.

Outcome by membership role value (BA C2). These are all the values the enum has today, plus the defensive branch:

| Admin's active membership role on the team | TOPIC-002 | Audit |
|---|---|---|
| none | 200 | `admin.topic_config_accessed` |
| `participant` | 200 | `admin.topic_config_accessed` (`membership_role: "participant"`) |
| `engineering_manager` | 403, reason `ADMIN_IS_TEAM_MANAGER` | `admin.topic_config_denied` (`reason: "membership_em"`) |
| any future value | 403, reason `ADMIN_MEMBERSHIP_NOT_ADMITTED` | `admin.topic_config_denied` (`reason: "membership_unrecognised"`) |

- **Rationale, as the champion.** The person in question is *this team's manager*. That they also hold the admin role is the exact thing the BRD already said must not become a way around the rule (FR-2.4). For a manager, the matrix says topic configuration is "None", not "None except the free text". Omitting fields is a deny-list of columns, and deny-lists rot: the next free-text field someone adds to TOPIC-002 leaks by default. I'd rather the dual-hat admin lose the Topic Management screen for their own team than have an exception that needs a field-by-field audit every time the response grows.
- **Leave admin + participant membership admitted** (200 + audit row). Reading the team's definitions as a participant member isn't a no-manager problem. Whether that person may *shape* topics is #208's question. Denying them here would pre-empt it.
- **Mechanics.** Keep the shared helper untouched. Add a TOPIC-002-local policy in content.ts (a sibling of `isTopicConfigReadAdmitted`, pure, no flag or env, not exported). After `decision.authorized && decision.actorGlobalRole === 'application_admin'`, call `readActiveMembershipRole` and admit only on `null | 'participant'`. This is the "TOPIC-002-specific wrapper" the issue's own suggested fix names. Only admins pay for the extra query. That belongs in design.md as commentary, not in the spec (BA V3). I'm not widening `evaluateStandingFacilitatorAccess` to return `tm.role`: it would save a round trip but touch the session-draft and topic-write callers.
- **Deny-branch mechanics, made testable (BA V1).** Use the same calls as the existing TOPIC-002 403 branch: `await applyTimingFloor(startTime)` before replying, and `noStore(reply)`. Send the same envelope shape: `{ error: { category: "forbidden", message, correlationId } }`. Tests assert three things: the `Cache-Control: no-store` header is present, `applyTimingFloor` is awaited on the branch (spied the same way the existing `NOT_A_FACILITATOR` test does it), and zero topic / lock-state / team-name queries run.
- **Reason name and envelope (BA V2, partly accepted).** The reason is named `ADMIN_IS_TEAM_MANAGER` (and `ADMIN_MEMBERSHIP_NOT_ADMITTED` for the defensive branch). It goes in the contract's 403 table and in the audit row's `metadata.reason` mapping, the same way `NOT_A_FACILITATOR` and `FACILITATOR_IS_TEAM_MEMBER` are named today. **I'm not adding a machine-readable `code` field to the forbidden envelope in this change.** No other TOPIC-002 403 has one, and adding it to one branch would make the endpoint's error shape inconsistent. If we want codes on forbidden envelopes, that's a contract-wide change and should get its own issue.
- **Messages.**
  - `ADMIN_IS_TEAM_MANAGER`: "Topic configuration for this team isn't available to its engineering manager." The caller knows their own membership, so this leaks nothing, and it states the rule rather than suggesting a bug.
  - `ADMIN_MEMBERSHIP_NOT_ADMITTED`: "Topic configuration for this team isn't available to you." It's neutral and doesn't claim the caller is the manager (BA V2).

### 5a. What the dual-hat admin sees (decision, moved out of open questions)

Priya is right that this was the weakest part of my first pass. I asked the BA for copy that the screen throws away.

- **Decision: `TopicManagementPage.loadTopics` renders the server envelope's `message` on a 403 when it parses (using the existing `hasEnvelopeMessage`), and falls back to the current generic string otherwise.** It's a few lines, and it improves every 403 on that screen (the member-facilitator gets "A facilitator cannot view topic management for a team they are a member of." instead of a generic "no access").
- **Why the champion wants this, not generic copy.** FR-2.4's generic copy covers a session the person was never invited to. This is a screen the admin uses routinely on every other team. A bare "no access" on their own team reads as a bug, and that leads to one of two things. Either it becomes a support ticket that ends up with me, or the admin "fixes" it, which is worse. The rule should explain itself in the tool. Carrying that explanation is the whole point of putting the ritual into software.
- **The "Topics" link stays visible on `TeamPage` for this person.** The server gates the screen, and the link is a deliberate discovery point (TeamPage ~L128). The `topic-management-screen` spec should say that a dual-hat admin sees the link and lands on the explained denied state, so nobody later "fixes" it by hiding the link client-side based on a role guess (Priya, observation 5).
- **Refetch edge, known and accepted (Priya, observation 6).** If the admin's membership changes to `engineering_manager` while the screen is open, the next write lands (201, the #208 split) and the quiet refetch fails with "Unable to reload topics." over a stale list. It's rare, it fails closed, and it doesn't need its own handling. List it in design.md as an accepted edge so QA doesn't rediscover it.
- **Self-demotion edge, known and accepted.** An admin with an EM membership can manage memberships, so they could change their own membership to `participant` and then read the screen. That isn't a silent bypass. The membership edit writes an in-transaction `audit_log` row plus `team.role_changed`, and every subsequent read writes `admin.topic_config_accessed` with `membership_role: "participant"` and `actor_idp_roles_include_em: true` (section 6). The trail shows the whole sequence. Blocking admins from editing their own membership is outside #232's scope. If Security wants it, it's a separate issue.

### Does deciding (b) here pre-empt #208? (BA C1, stated as a deliberate deviation)

**This change decides #232 Q1 independently of #208.** The issue asks for (b) to be decided "together with #208". I'm deviating from that on purpose, for these reasons:

1. **They're different rules.** #208 asks whether a *member*-admin may **write**, under facilitator-from-another-team. #232 denies a *manager*-admin a **read**, under the no-manager rule, which is HARD and not open to a judgement call. No outcome of #208 could make it acceptable for a team's manager to read the team's definitions, so waiting adds nothing except more time with the gap open.
2. **The issue's own suggested fix anticipates this.** It says to check membership "in a TOPIC-002-specific wrapper ... so the TOPIC-004 and other write callers keep their behaviour until #208 is decided." That's the mechanism here.
3. **Consistency is shown, not assumed.** (i) The parity test gets an explicit `{ get: 403, post: 201 }` row for "admin + EM membership", with a comment citing #208. (ii) A comment on #208 records the split and links this change. (iii) `standing-facilitator-access-helper.ts` and the four topics.ts wrappers have **no diff** in this change, which is cheap for a reviewer to check (BA V4).

**Proposal Non-goals (adopted from BA R6):**
> This change does not decide #208. After it, an `application_admin` with an `engineering_manager` membership is denied TOPIC-002 (read) and still admitted by TOPIC-003..006 (writes) via the API. The parity test records this as `{ get: 403, post: 201 }` with a comment citing #208. A comment on #208 records the split as evidence for that decision.

**Stronger #208 hand-off (Priya, observation 7, accepted).** I undersold this. From the room's point of view, the half left open is the worse half. A manager who can add, archive and reorder their own team's topics through the API is *shaping what the team talks about*. That's closer to the core harm of the no-manager rule than reading the definitions. The #208 comment should say that, and it should ask for #208 to be **prioritised**, not just "informed". It shouldn't recommend a specific answer; that's for #208's own review.

### The reverse case: a global EM who holds a participant membership

Adopted as a requirement (BA R5):
> A caller whose global role is `engineering_manager` SHALL receive `403 NOT_A_FACILITATOR` from TOPIC-002 regardless of membership (none, `participant`, or `engineering_manager`). No code change; covered by unit and parity regression rows.

- A global **facilitator** with an EM membership is denied as a member-facilitator. That's the right outcome, for the wrong reason, which is fine. Pin it too.

### The case nobody named: an admin whose IdP role set includes EM but who has no EM membership on this team

- **Admission doesn't key on `users.roles`.** It's an expand-step column that migration 21 says nothing reads for authorization. It isn't team-scoped, so using it would deny dual-hat admins *every* team's topic screen. And backfilled rows only hold `{global_role}` until the user's next login. The membership row is the only team-scoped manager fact we have. (Both reviewers agreed.)
- **It goes in the audit metadata instead** (section 6, resolving my earlier "leans yes"). This is a compensating control we can actually see, for the dual-hat manager we can't see structurally. When #238 lands (reporting chains), revisit whether admission should use it. Record that as a follow-up on #238.

---

## 6. Question 2 (gap a): what does an admin read record?

### Decision

- **A durable `audit_log` row plus a structured `emitAuditEvent`, not log-only.** Use the existing admin-read precedent (`admin.membership_list_accessed`, `admin.team_detail_accessed`), not the log-only pattern.
  - Log-only exists for **call volume** on hot paths. TOPIC-002 isn't one: it's loaded on screen mount and on refetch after a write, by a small population.
  - The spec says "SHALL be logged in the `audit_log` table". A log line doesn't meet that, and Security B2 on #187 called this gap out specifically.
  - For the no-manager rule, the durable row is the only after-the-fact evidence that would show a dual-hat manager reading their team's words.

Requirement wording (BA R3, adopted with the two fields added below):

> Every TOPIC-002 response of `200` to an `application_admin` SHALL write exactly one `audit_log` row with `operation = 'admin.topic_config_accessed'`, `actor_user_id`, `actor_global_role = 'application_admin'`, `actor_ip`, `team_id`, and `metadata = { endpoint, http_status: 200, membership_role: null | "participant", actor_idp_roles_include_em, active_count, archived_count, annotated_count }`, and SHALL emit the matching structured event. This applies to every team, including the template team, regardless of whether any topic has a definition. Metadata SHALL NOT contain annotation text, topic names, or topic ids. A `200` to a non-admin caller SHALL write no `admin.*` row.

- **`actor_idp_roles_include_em` (boolean), decided in (BA C4, my open question 1).** It records `'engineering_manager' = ANY(users.roles)` at the time of the read. I went with a boolean rather than the full `roles` array because it answers the only question anyone will ask ("was this person also a manager?") and puts less into the trail. It's written on both the access row and the denial row. It's metadata only and never used for admission, so it doesn't break migration 21's "nothing reads roles for authorization" boundary. Its known limit, a false negative for a user who hasn't logged in since #245, is documented in the operation's comment block. I'm deciding this myself rather than handing it to Security. If Tomás objects at proposal review, removing a metadata field is cheap. Leaving the dual-hat manager invisible isn't.
- **`annotated_count` definition (BA V8):** the number of topics in the response, active and archived, with a non-null `team_annotation`. Archived entries carry annotation fields too, so counting only active topics would under-report exposure.
- **Fire on every admin 200, not only when annotations are returned.** The requirement is "every Application Admin read of administrative data". A conditional record ties the audit to data state, so a reviewer can't tell "didn't read" from "read when it was empty". `annotated_count` gives the "were definitions exposed?" signal without making the record conditional. Include the template team (`DEFAULT_TOPICS_TEAM_ID`).
- **One row per request, not per user action (BA V7; Priya Q4).** Each admin write on the screen triggers a refetch, which writes its own access row. So an admin editing topics produces pairs: write row, read row. Tests assert "exactly one `admin.topic_config_accessed` row **per TOPIC-002 request**", so nobody later dedupes it.
  - **Rejected: `reason: initial | refetch` in metadata** (Priya Q4). The server can't know which one it is unless the client tells it. A client-supplied hint would be an untrusted field in an audit record, plus new API surface, just to tidy the trail. Reviewers can already tell a browse from an edit session by correlating with the write rows (same actor, team, seconds apart). The volume is small, so the pairs stay readable.
- **Transaction wording, decided (BA C3; my open question 2).** For a read, "same database transaction" is really trying to guarantee one thing: *the record exists if and only if the data was served*. A transaction around SELECTs adds nothing toward that, because there's nothing to roll back. What matters is that the insert happens before the send and a failed insert stops the send. The teams.ts precedent already does exactly that. The spec sentence is replaced (BA R4, adopted):
  > For an Application Admin read, the audit row SHALL be written after the data has been read and before the response is sent. If the audit write fails, the request SHALL fail with `500` and the response SHALL contain none of the data read.

  Scope: the spec wording applies to all admin reads. **Code changes are limited to TOPIC-002.** `admin.membership_list_accessed` and `admin.team_detail_accessed` already satisfy the new wording, so they need no retrofit; the spec simply stops contradicting them. Write-side audit rows keep their in-transaction rule, which is unaffected. I'm making this call myself rather than routing it to the Solution Architect: it codifies what the code already does and changes no code outside TOPIC-002. Ingrid can override it at design review if she sees something I don't.
- **Spec field names (BA C6, accepted).** While the L178 paragraph is being rewritten, correct the requirement's field list (`action`, `resource_type`, `resource_id`) to the real columns (`operation`, `team_id`, `metadata`, plus `actor_*`).
- **The denial branch** (admin + non-admitted membership → 403): write a durable **`admin.topic_config_denied`** row plus event, metadata `{ endpoint, http_status: 403, reason: "membership_em" | "membership_unrecognised", actor_idp_roles_include_em }`. Admin denials are durable, as with `admin.session_content_denied`, and the volume is tiny. Don't overload `topic.config_read_denied_role`: it's TOPIC-001's log-only event, and its `grantPath` field means nothing here. Don't reuse `admin.session_content_denied` either, because topic configuration isn't session content.
  - **Consequence, stated (BA C5).** "Admin denied topic configuration" now has two operation names: `admin.session_content_denied` from TOPIC-001 (which the spec forbids renaming) and `admin.topic_config_denied` from TOPIC-002. A consumer looking for denied topic-config reads queries both and tells them apart by `metadata.endpoint`, which is present on both. I accept that cost. Merging them would mean renaming a spec-protected operation.
  - Considered: one operation with an `http_status` field for both outcomes. Rejected, because a consumer counting `*_accessed` would count denials as reads.
- **Audit visibility guard (Priya Q3, accepted).** Add one sentence to the requirement: `admin.topic_config_accessed` and `admin.topic_config_denied` rows SHALL NOT be exposed through any endpoint or screen available to team members or engineering managers. Today no route reads `audit_log` back at all, so this is a guard for the future, not a fix. A "who read your team's config" view for managers would turn a compensating control into surveillance in the other direction.

---

## 7. Facilitator and session impact (new, from Priya's review)

The proposal should say this outright:

- TOPIC-002 is consumed only by `TopicManagementPage`. **No live-session endpoint changes.** Readiness, reveal, outliers and action items don't call TOPIC-002.
- The facilitator branch never reaches the new membership read. **Facilitator paths gain no query, no audit row, no new state and no added latency.** Non-member facilitators keep 200 and `canEditAnnotations`.
- **Handoff continuity is preserved.** A facilitator inheriting a team still gets the definitions and archive history from TOPIC-002 without needing a handoff conversation.
- **Answer to Priya Q1:** the dual-hat admin/EM has no legitimate facilitation reason to see their own team's screen. Facilitator-from-another-team means they'd never facilitate their own team.
- **Answer to Priya Q2 (fallback for first-session preparation):** if the only admin available is also the team's EM, a **non-member standing facilitator, or another admin**, prepares the topic set. Neither path is affected by this change, so onboarding isn't blocked.
- Regression tests that prove it are listed in section 10.

## 8. What could go wrong if the design drifts

1. **Someone "fixes" the parity test by making TOPIC-003..006 deny admin + EM membership too.** That's #208's decision, made by accident. The split row must say *why* it diverges and point to #208.
2. **The membership check gets added to the shared helper without a flag**, which silently changes TOPIC-003..006 and violates #208's "decide once, for all four" constraint. Keep it TOPIC-002-local, and keep the helper's diff empty.
3. **Omit-fields gets chosen "to keep the screen working"**, and the next free-text field leaks. Deny-lists of columns are the failure mode #187 rejected.
4. **The audit becomes conditional** (only on annotations, or skipped for the template team), and then later "only for non-members". Every condition is a gap someone will want widened.
5. **Audit metadata starts carrying annotation text "for forensics".** It must never. Counts only.
6. **The admin arm gets reordered ahead of the membership read in a later refactor.** That's the exact bug. A test has to pin admin + EM membership → 403 **and** zero topic queries run (the same no-leak assertion as #187's S1).
7. **The release-note line ships before #232, or overclaims after it.** See section 9's release-note gate.
8. **The "Topics" link gets hidden client-side from a role guess**, which puts a second source of truth for authorization into the frontend. The server gates. The spec note in section 5a prevents this.
9. **Audit rows get surfaced to a team-facing view.** The visibility guard in section 6 prevents this.

## 9. Docs to change in the same change

- `team-content-access`: rewrite L178 (BA R7: "TOPIC-002 writes an `admin.topic_config_accessed` row on every admin read it serves, and denies an admin who holds an active membership on the team other than `participant` (see topic-customization-lock)."). Replace the "same database transaction" sentence with the section 6 wording. Correct the audit field list. Add the visibility guard. Add scenarios: admin non-member 200 + exactly one `admin.topic_config_accessed` row; admin + participant membership 200 + row; admin + EM membership 403 + one `admin.topic_config_denied` row + no topic data; global EM + participant membership 403.
- `topic-customization-lock`, all-topics authorization requirement: add the admin allow-list (section 5 wording) and the audit requirement. The response requirement is unchanged.
- `topic-management-screen`: truth table notes that an admin with an EM membership on the team doesn't reach the screen. The 403 state renders the server's message when present. The "Topics" link stays visible (section 5a).
- `topic-annotation`: add one sentence that engineering managers, including an admin who holds an EM membership, don't receive annotations from TOPIC-002 either (with a cross-reference), so the claim "EMs never see the team's definition" is true across both reads.
- `requirements/design/REST API Contract.md`, TOPIC-002: Authorization; 403 rows for `ADMIN_IS_TEAM_MANAGER` and `ADMIN_MEMBERSHIP_NOT_ADMITTED` with their messages; the "Annotation fields" note becomes "administrators *without a non-participant membership on the team*"; the audit note. Clear the TOPIC-001 L566 caveat. Update the **Appendix B** TOPIC-002 row (L3063): admin "Yes, unless they hold an EM membership on the team (403); every read audited".
- **BRD FR-8.7 rationale (L341):** "Administrators may still read team definitions on the topic management screen" gains ", except an administrator who holds an engineering manager membership on that team (no-manager rule; #232)". (BA section 5.)
- `audit-logger.ts` `AuditEventName`: register `admin.topic_config_accessed` and `admin.topic_config_denied` with the standard comment blocks, including the `actor_idp_roles_include_em` false-negative note. `audit-logging-operations` spec: no change.
- **Release-note gate (BA C7; Priya).** #187 Follow-up 5 lives in `openspec/changes/archive/2026-10-03-topic-001-authz-contract-reconcile/proposal.md`. It has no tracking issue, so the gate goes in two places: this change's proposal, and the #208 comment / PR description. The text: "Follow-up 5's release-note line is blocked on #232 merging." Once #232 ships, the approved wording is: "Engineering managers, including administrators who manage the team, cannot read the team's definitions." It must **not** say "managers cannot change topics", because that stays untrue until #208.

## 10. Test plan

**AC-mandated (from #232):**
- Unit (`content.test.ts`): split L915 into admin non-member / admin + participant / admin + EM membership. The EM case asserts 403, `no-store`, the timing floor awaited, zero topic/lock/team-name queries, and one denial row. Admin 200 asserts exactly one `admin.topic_config_accessed` insert per request, with text-free metadata and correct counts (`annotated_count` across active + archived).
- Integration (real Postgres) on a team with at least one active and one archived topic carrying a definition: admin + EM membership → 403. The test greps the body and the denial row for the definition text and topic names and finds neither, and asserts exactly one `admin.topic_config_denied` row (BA R2). Admin non-member → 200 plus one access row whose metadata contains no annotation text.
- Regression, unchanged behaviour: non-member admin 200; non-member facilitator 200 **with no `admin.*` row**; member-facilitator `403 FACILITATOR_IS_TEAM_MEMBER`; TOPIC-004 admin member (participant and EM membership) still 200 with its write audit row. The #208 N4 assertions must not weaken.

**Additional requirements of this change (deliberate, beyond the ACs; BA V5):**
- Fail-closed audit: audit insert failure → 500 with no topic data in the body.
- Durable denial row on the new 403.
- `annotated_count` and `actor_idp_roles_include_em` in metadata. A unit test covers both values of the boolean.
- Template team included in the audit.
- Global EM regression (BA R5): unit rows for global EM with none / participant / EM membership → `403 NOT_A_FACILITATOR`. Real-Postgres row for global EM + participant membership.
- Parity (`topic-add-flag-parity.test.ts`): extend the fake with a membership role. Add the "admin + EM membership" row `{ get: 403, post: 201 }` with a comment citing #208. Existing rows stay unchanged.
- **TOPIC-003..006 regression scope (BA V4, decided).** TOPIC-003 is pinned by the parity row. TOPIC-004 gets the explicit AC regression above. TOPIC-005/006 are covered by two things: the reviewable condition "`standing-facilitator-access-helper.ts` and the topics.ts wrappers have no diff in this change", and their existing admin-member integration suites (`restore-topic-integration`, `topics-integration`) passing unmodified. I'm not adding new 005/006 tests: no code on their path changes, and #208 will rewrite those wrappers anyway.
- Frontend (`TopicManagementPage` tests; Priya): a 403 with an envelope message renders that message. A 403 without one renders the fallback. In both cases there's no topic list, no "Our team's definition" block, and no write controls. That's cheap insurance against the page later caching data across teams.

## 11. Open questions

Resolved in this revision (no longer open): `actor_roles` in metadata (boolean, in), the transaction wording (amend the spec to the teams.ts precedent; code changes limited to TOPIC-002), the reason names and messages, the frontend 403 copy (render the server message), TOPIC-003..006 regression scope, `annotated_count`, the denial-name split, the Appendix B and BRD targets, the release-note gate, and deciding (b) independently of #208.

**Needs a human decision:**

1. **Product owner (Brian), at proposal review:** acknowledge that #232 Q1 is decided independently of #208 (section 5, deviation stated with rationale), and decide whether #208 moves up in priority given that the half left open, a manager *writing* their own team's topics through the API, is the more harmful half for the ritual. I'm not asking for #208 to be decided inside this change. I'm asking whether it gets scheduled next.

Everything else is the implementation team's to settle in proposal and design. Security (Tomás) and the SA (Ingrid) can override the two calls I made on their behalf (`actor_idp_roles_include_em`; the transaction wording), but neither needs a decision before the proposal is written.

## 12. Review disposition

| Point | Disposition |
|---|---|
| BA C1 (state the #208 deviation) | Accepted. Section 5, plus open question 1 for the owner's acknowledgement |
| BA C2 (membership role values) | Accepted. The enum is `participant`, `engineering_manager`. Outcome table in section 5 |
| BA C3 (decide the transaction wording) | Accepted. Section 6. Spec amended; code changes limited to TOPIC-002 |
| BA C4 (`actor_roles` in or out) | Accepted. In, as the boolean `actor_idp_roles_include_em` |
| BA C5 (two denial names) | Accepted. Consequence stated; split kept |
| BA C6 (spec field names) | Accepted. Corrected in this change |
| BA C7 (release-note gate) | Accepted. Section 9 |
| BA V1 (testable deny mechanics) | Accepted. `applyTimingFloor`, `noStore`, assertions named |
| BA V2 (machine-readable code) | **Partly rejected.** Reason names go in the contract and audit metadata. No `code` field added to the envelope, because no other TOPIC-002 403 has one; a contract-wide change belongs in its own issue. The neutral message for the unrecognised branch is accepted |
| BA V3 (extra-query note to design) | Accepted |
| BA V4 (TOPIC-003..006 regression scope) | Accepted. Section 10 |
| BA V5 (separate ACs from additions) | Accepted. Section 10 split |
| BA V6 (doc targets) | Accepted. Appendix B lists TOPIC-002 and is updated; audit-logging-operations unchanged |
| BA V7 (one row per request) | Accepted |
| BA V8 (`annotated_count` definition) | Accepted. Active + archived |
| BA R1–R7 | Adopted, with the reason names filled in and the `actor_idp_roles_include_em` field added |
| BA section 5 (BRD FR-8.7 qualifier) | Accepted. Section 9 |
| Priya obs 1 (candour framing) | Accepted. Section 1 |
| Priya obs 2, 8 (facilitator paths, handoff) | Accepted. Section 7 |
| Priya obs 4 (403 copy thrown away) | Accepted. Section 5a; the frontend renders the envelope message |
| Priya obs 5 (Topics link) | Accepted. Spec note in section 5a |
| Priya obs 6 (refetch edge) | Accepted as a known edge |
| Priya obs 7 (#208 is the worse half) | Accepted. Stronger hand-off; prioritisation goes to the owner |
| Priya obs 9 (option B misleads facilitators) | Accepted. Added to the comparison table |
| Priya Q1, Q2 | Answered in section 7 |
| Priya Q3 (audit visibility) | Accepted. Guard sentence in section 6 |
| Priya Q4 (`initial \| refetch` reason) | **Rejected.** The server can't know which it is without an untrusted client hint in an audit record. The pairs stay readable by correlating with the write rows |
| Implicit: bar admin + EM-membership writes here too | **Rejected** (neither reviewer asked for it, but Priya's obs 7 points that way). It would break #232's "TOPIC-004 unchanged" AC and #208's "decide once, for all four". It's raised for prioritisation instead |

## 13. Champion's bottom line

- **Q1:** deny the whole response (403, `ADMIN_IS_TEAM_MANAGER`) to an admin whose live membership role on the team isn't null or `participant`. It's an allow-list, unconditional, local to TOPIC-002, and decided independently of #208 on purpose. The screen explains the rule instead of looking broken. The reverse case (global EM with a participant membership) is already denied, so pin it with tests.
- **Q2:** a durable `audit_log` row plus an event, `admin.topic_config_accessed`, on **every** admin 200. Metadata is text-free, with counts and `actor_idp_roles_include_em`. It's written before the response, and the request fails closed if the write fails. The spec's transaction sentence is amended to say exactly that. It's paired with a durable `admin.topic_config_denied` row on the new 403, and neither row is ever shown to a team or its manager.
- Writes (TOPIC-003..006) are untouched. #208 stays open, gets told it's guarding the more harmful half, and should be scheduled next.
