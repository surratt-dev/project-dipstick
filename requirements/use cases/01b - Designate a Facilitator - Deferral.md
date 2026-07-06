# Deferral: Designate a Facilitator

**Status:** Out of scope for the `assign-role-to-team-member` change.
**Follow-on owner:** Marcus Delgado (Business Analyst)
**Confirmed deferred:** Yes — explicitly out of scope per design.md Decision 1 and the `assign-role-to-team-member` proposal.

---

## What is deferred

The ability to designate a user as a Facilitator — that is, to set `users.global_role = 'facilitator'` for an existing user account through an application UI.

This is distinct from the `assign-role-to-team-member` change, which operates exclusively on `team_memberships.role` (the membership-level role, values: `participant` / `engineering_manager`). Facilitator is a **global role** on the `users` table, not a membership role.

---

## Deferred scope

- A new privileged endpoint to write `users.global_role = 'facilitator'` for a target user.
- Authorization: only Application Admins can designate a Facilitator (consistent with the principle that global role changes are higher-privilege than membership role changes).
- A corresponding UI in the member management or admin panel surface.
- Audit logging for the global role change (separate from the `role_change_audit` table used by TEAM-005, which tracks only membership role changes).

---

## Why it is out of scope here

The `assign-role-to-team-member` change writes only to `team_memberships.role`. Writing to `users.global_role` would require a new privileged endpoint with different authorization semantics. Bundling both into this change would conflate two distinct role systems — the global role (`users.global_role`) and the membership role (`team_memberships.role`) — which the design explicitly keeps separate (see Design Decision 1 in design.md).

There is no circularity risk from deferring: the session-layer no-EM enforcement check works correctly once `team_memberships.role` is accurate, regardless of whether Facilitator designation is implemented.

---

## Follow-on requirements (to be specced by follow-on owner)

When this capability is designed, the follow-on spec must address:

1. **New endpoint:** A `PATCH /api/v1/users/:userId/global-role` (or equivalent) that only accepts `facilitator` as the writeable value via this surface (Application Admins modifying other global roles — e.g., promoting to `application_admin` — is a separate concern).
2. **Authorization:** Application Admin only. The endpoint must not be callable by Facilitators or Engineering Managers.
3. **Audit log:** Global role changes must produce an audit entry (distinct from the membership role audit) including actor ID, actor role at time of change, subject ID, from-role, to-role, and timestamp.
4. **Demotion path:** What happens when a Facilitator is demoted back to Engineer? This must be in scope for the same change.
5. **Bootstrapping:** How does the first Facilitator account get designated before there is a UI? This is the same bootstrapping question as for the first Application Admin — see proposal.md section on bootstrapping.

---

## Connection to bootstrapping

Designating the first Facilitator has the same bootstrapping problem as designating the first Application Admin: without a UI and without an existing privileged account, the first assignment must happen out-of-band (seed migration, bootstrap endpoint, or IdP role claims in First Access). The follow-on owner for this deferral must coordinate with the bootstrapping follow-on documented in proposal.md.
