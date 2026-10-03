# Deferral: Designate a Facilitator

**Status:** **Decided: Option A, facilitator designation through the IdP role claim** (2026-10-03, PR #230 Follow-up 8). Implementation is tracked in #235. The in-app designation endpoint described below is **not required** and is kept only as a possible later convenience.
**Follow-on owner:** Marcus Delgado (Business Analyst)
**Confirmed deferred:** Yes. The in-app UI and endpoint stay out of scope (design.md Decision 1 of `assign-role-to-team-member`). Designation itself is now provided by the IdP; see the Decision section below.

---

## Decision (2026-10-03): the IdP is the source of truth for `facilitator`

**The problem it resolves.** `users.global_role` is re-mapped from the IdP role claim on every sign-in (first-access Decision 2), and the claim allowlist (`PERMITTED_GLOBAL_ROLES`, `account-resolver.ts`) did not include `facilitator`. So no supported path could produce a facilitator who stays one past their next sign-in. A manual `UPDATE users` is undone at the next sign-in. Because FR-2.1 [HARD] limits session creation to Facilitators, that blocks running a real Health Check.

**What was decided.** `facilitator` is assigned the same way as `engineering_manager` and `application_admin`. An IdP administrator gives the user the `facilitator` value in the configured role claim (`OIDC_ROLE_CLAIM`). The application adds `facilitator` to the claim allowlist, along with `senior_engineer`, which had the same gap. The application itself never writes `global_role = 'facilitator'`.

**Why:**
- **One writer for `global_role`.** The IdP sets it and the application re-reads it at every sign-in. No precedence rule is needed between an app-assigned value and the IdP claim.
- **Demotion and audit already exist.** Removing the claim demotes the user at their next sign-in, and `auth.role_claim_mapped` records the prior and new role. That covers follow-on requirements 3 and 4 below without new work.
- **Bootstrapping is solved.** The first Facilitator is designated in the IdP, which is the IdP role-claim route the "Connection to bootstrapping" section already lists. That covers follow-on requirement 5.
- **BRD alignment.** "Application Administrator … may assign facilitators" (BRD, FR-1: Identity and Access, Application Administrator role) is met by an administrator assigning the role or group in the IdP.
- **Not tied to one IdP.** The claim name is configurable, so this works for every supported OIDC provider, not only the primary one.

**Rejected:**
- **Option B, app-owned designation.** An admin endpoint would set `facilitator`, and sign-in would have to keep that value. This means two writers for one column, a precedence rule, and a new privileged endpoint, UI and audit table.
- **A separate "can facilitate" flag, independent of `global_role`.** It avoids B's precedence problem, but every `global_role = 'facilitator'` check across the application would have to be rewritten.

**Revisit if** a supported IdP cannot send a custom role claim. The in-app designation described below would then become the fallback for that provider.

**Consequence for this document.** Follow-on requirements 1 and 2 below (the `PATCH /api/v1/users/:userId/global-role` endpoint, admin-only) are no longer needed for the product to work. They describe a possible later convenience, not a gap.

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
