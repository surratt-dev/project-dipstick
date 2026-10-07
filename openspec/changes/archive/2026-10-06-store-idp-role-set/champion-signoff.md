# Champion sign-off: store-idp-role-set (#245)

**Reviewer:** Devon Calloway, Internal Champion
**Date:** 2026-10-06
**Verdict:** SIGN-OFF: clean

## Did the change preserve the ritual's intent?

Yes. This is the change I proposed for a reason: the application should *know* when someone is a manager, not infer it from where admins sit in a precedence order. After this step it records every role the IdP mapped (`users.roles`), keeps that set consistent with `global_role` at the database level (`users_roles_consistent`), and writes it into the audit trail (`audit_log.actor_roles`, `metadata.roles`). No decision changed. That was the right first step.

## Core constraints

- **No-manager rule:** unaffected and still enforced from `global_role`. The new real-Postgres tests in `admin-session-exclusion-integration.test.ts` confirm that a user mapped to admin + manager is still refused participant registration, and that TEAM-006 still returns 409 for a `{application_admin, engineering_manager}` target. The manager role that used to be thrown away is now kept, which is what the next step needs before it can enforce the rule from the true role set.
- **Simultaneous reveal:** unaffected. The diff touches no session, voting, reveal or realtime code.
- **Facilitator from another team:** unaffected. No change to team membership or to how session creation checks the facilitator. A user mapped to admin + facilitator is still refused draft creation, as today. That is a known limit, and the follow-ups own it.

## No authorization decision reads `users.roles`

Confirmed. I grepped `packages/backend/src` and `packages/frontend/src` myself, and the result matches the 8.1 record in `tasks.md`. Every new read of `roles` is in `auth/role-map.ts`, `auth/account-resolver.ts` or `routes/auth.ts`. Each one resolves the set, persists it, or audits it. `shouldEmitRoleClaimMapped` decides only whether an audit row is written. The other hits are the comment and message-string hits already in the baseline.

## Notes (not blocking)

- **Contract step 1 (#251)** is where my constraints are actually at stake. The verbatim precondition in `tasks.md` is the right guard: an unresolved user's role set grants nothing new, and a role missing from the set is not proof the user lacks it. Deny rules must treat such users as possibly holding the denying role. I want to review #251 before it merges.
- **Gate 8.3** (live lobby, re-authorization sweep, in-flight sign-in, rollback) is still open apart from the exit-code leg. The product owner made it a required manual check before merge, and I support that. Live sessions must not drop during the migration.
