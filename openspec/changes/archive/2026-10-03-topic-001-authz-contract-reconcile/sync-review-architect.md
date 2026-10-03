# Sync Review: Solution Architect

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Change:** `topic-001-authz-contract-reconcile` (#187)
**Stage:** Post-sync drift check (docs vs. code)
**Date:** 2026-10-03

## Scope

I compared the synced main specs (`openspec/specs/team-content-access`, `topic-annotation`, `topic-customization-lock`), `requirements/design/REST API Contract.md` (TOPIC-001 section, path-id note, access matrix), the event list in `docs/deployment.md`, and this change's `design.md` against the working-tree code: `packages/backend/src/routes/content.ts`, `packages/backend/src/auth/team-content-access-helper.ts`, `packages/backend/src/auth/audit-logger.ts`, and `packages/shared/src/types/topic.ts`. I also ran `content.test.ts` and `team-content-access-helper.test.ts`: 83/83 pass.

## Verdict

**Pass, after one fix to the docs.** The code and the normative docs agree. I found one counting error in `docs/deployment.md` prose and fixed it. No code changes.

## Check ordering

| Step | design.md Decision 2 | content.ts handler | Spec |
|---|---|---|---|
| 1 | Canonical id → 404 `TEAM_NOT_FOUND` | `isCanonicalUuid` before any query, timing floor | "Unchanged" clause; scenario "Non-canonical teamId is rejected before the admission gate" |
| 2 | `evaluateTeamAccess` | yes | yes |
| 3 | `null` → `denyNullGrant` | yes (keeps cross-team facilitator message) | yes |
| 4 | admin → `denyAdminContentAccess` | yes, `endpoint = "GET /api/v1/teams/:teamId/topics"` | Admin requirement + scenarios |
| 5 | `readActiveMembershipRole` for member grants only, not caught | yes, uncaught (rejection → 500) | "failed membership read" scenario |
| 6 | predicate deny → event → timing floor → `denyAccess` | yes, in that order | Denial response bullets |
| 7 | topics query, then `hasCompletedFirstSession` | yes | lock spec: lock check never runs on a denied request |

The helper checks `application_admin` before membership, so the "admin with EM membership takes the admin path" scenario holds. It issues a facilitator grant only when there is no active membership, which matches the spec's statement that membership never disqualifies a facilitator grant.

## Predicate

`isTopicConfigReadAdmitted` matches Decision 2 exactly: it is not exported, it is synchronous with no I/O, env or config reads, it switches on `path` with a `never` default, the member arm uses equality on `grant.role` and the live role plus `actorGlobalRole !== "engineering_manager"`, the facilitator arm checks only the global role, and the admin arm returns `false`. This satisfies the spec's allow-list and "unconditional" clauses.

## Status codes and response bodies

- EM / not-admitted denial: `403`, `Cache-Control: no-store`, the standard forbidden envelope with a fresh `correlationId` (`denyAccess`). This is never the cross-team message. It matches the spec and the contract's 403 row.
- Admin: `403` plus one `audit_log` row with operation `admin.session_content_denied` and `metadata.endpoint`. The operation name is unchanged. The admin message ("Application Admins do not have access to session content.") is not the standard one. The spec does not claim it is, and Decision 4 records rewording it as a follow-up.
- `404`: non-canonical id only. A well-formed id for a nonexistent team gets a `null` grant and a `403`. The contract row now says this correctly.
- `200`: `{ teamId, topics, isCustomizationLocked }`. The topics are raw snake_case rows (`id, name, prompt, vote_type, display_order, status`) with no annotation columns. This matches the contract's "As built (#187)" note, the topic-annotation requirement, and the tripwire test "does not remap existing snake_case fields to camelCase". The remap is still deferred, as Decision 5 says.

## Event

`topic.config_read_denied_role` is in the `AuditEventName` union with a comment citing #187. It is emitted once, before the timing floor. Fields: `userId, teamId, grantPath, globalRole, membershipRole, reason`. Reason precedence: `membership_em` > `global_em` > `not_admitted`. No topic data is included, and there is no `audit_log` write. This matches Decision 6 and the spec's denial-response bullet. `team.access_grant_mismatch` still fires from the helper on path 2'. `docs/deployment.md` lists the event as log-only.

## Access matrix

The TOPIC-001 row says EM "No (403, #187; membership or global role)", Admin "No (403 + audit; reads via TOPIC-002)", and "EM denied unconditionally; no override". This matches the code. The Facilitator cell ("Teams with active session") is older shorthand for the full eligibility window (draft under 24h, grace period). That is already the "facilitator-window prose" follow-up and is not drift from this change.

## Drift found and fixed

- **`docs/deployment.md`, log-only paragraph.** The prose said "Six further events unrelated to the auth/join trail", but the list holds 13 events, and only 6 of them are named earlier in the paragraph. That leaves seven: the two `auth.token_refresh_*` events plus five non-auth/join events. The error predates this change: the old "Five further / 12 total" was already off by one, and this change carried it forward. I reworded the sentence to "Seven further events are also log-only: the two `auth.token_refresh_*` events and five unrelated to the auth/join trail." The 13-item list and the total are unchanged.

## Not drift (noted)

- The comment on `evaluateTeamAccess` now limits its "single consistent snapshot" claim to the helper itself and names TOPIC-001's second read. This is consistent with Decision 1, which accepts that the two reads can disagree and that a disagreement fails closed.
- The `Topic` type comment in `packages/shared` agrees with the topic-annotation requirement.
