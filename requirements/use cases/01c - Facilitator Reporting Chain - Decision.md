# Decision: Facilitator Reporting Chain

**The rule.** The application models which managers sit in each team's reporting chain. A facilitator may not run a session for, or reach the standing topics of, a team whose reporting chain includes them. **Why.** "Not a member of the team" and "not in the team's reporting chain" are different properties. Only the first is enforced today; the second rests on IdP group hygiene that the deployment docs do not even ask for. **When.** Deferred. Building it does **not** gate launch. Until it ships, and for any team with no recorded chain afterwards, the membership check and an operator rule in the deployment docs apply, so a new team needs nothing beyond its join link to run its first session.

---

## 1. Status, owners and traceability

**Status:** **Decided 2026-10-05 by the user (product owner)** (#238). Supersedes the 2026-10-04 decision recorded in closed, unmerged PR #242; see section 5.
**Follow-on owner:** the Business Analyst.
**VP of Engineering:** acknowledgment *pending* (owner: the product owner). #238 names the VP as co-owner, and reporting-line data is VP territory. Record the acknowledgment here.
**Implementation:** #247. Not yet built.
**Launch gate:** none. Revised 2026-10-06 by the product owner: making the first sessions easy (create a team, share the join link, run a session) matters more than enforcing reporting lines from day one. #247 is deferred and not scheduled.

**Traceability:**
- `Summary.md:12`: the facilitator is "a senior engineer from *another* team … **not in the team's reporting chain**" (the intent).
- BRD §6.2 (Engineering Managers never participate; "Engineering managers are in the reporting structure of the engineers on the team") and §6.3 (facilitator from a different team).
- BRD Constraint 1 (team data is "scoped to each team's reporting structure") and the §13 risk row (the cross-team facilitator requirement "must be structural, not settings").
- FR-2.1 [HARD] (only Facilitators create sessions) and FR-2.2 [HARD] (the facilitator does not belong to the target team as a Participant or EM): what is enforced today.
- #235 (facilitator role through the IdP claim), Follow-up 2; #243 (`OIDC_ROLE_MAP`, precedence); #245 (storing several roles per user); #241 and #240 (filed from the superseded decision).

---

## 2. What is enforced today, and the gap

**Enforced.** A user with `global_role = 'facilitator'` cannot create a draft session for a team where they hold an active `team_memberships` row, of any membership role. The refusal is audited as `session.draft_denied_membership_conflict` (`routes/facilitator-sessions.ts`). The standing topic and content endpoints apply the same membership check (`auth/standing-facilitator-access-helper.ts`) and return `FACILITATOR_IS_TEAM_MEMBER`, **without** an audit row.

**What the membership check covers for managers.** TEAM-006 only associates users whose `global_role` is `engineering_manager`, and such a user cannot facilitate in the first place. The membership check therefore protects a recorded manager only if they **later** resolve to `facilitator`. That works because a role change at sign-in does not remove membership rows.

**Since #243.** A user whose IdP claim maps to both `engineering_manager` and `facilitator` resolves to `engineering_manager` (`auth/role-map.ts`, fixed precedence `application_admin > engineering_manager > facilitator > senior_engineer > engineer`), so they cannot facilitate. The discard is logged (`discardedRoles`), not audited.

**Not modelled.** The application holds no reporting lines. The membership check cannot see:
- **Skip-level and higher managers.** A director or second-line manager above the team holds no membership on it.
- **Managers given only `facilitator`.** If the IdP sends a manager `facilitator` alone, nothing ties them to the teams that report to them. The exception is a TEAM-006 association left over from a time they held `engineering_manager`.
- **Missing or stale TEAM-006 associations.** A team whose manager was never associated, or was associated to the wrong team, has no membership row to block on.

**There is effectively no control for these cases.** The hygiene checklist in `docs/deployment.md` says people who facilitate must not also be in the manager or admin groups. Its reason is operational ("they resolve to the higher role and cannot run a session"). Nothing tells operators to keep skip-level managers or directors out of the facilitator group.

---

## 3. Decision

The application will model the manager-to-team reporting relationship, including managers above the team's direct manager, and check facilitator eligibility against it.

What the model must deliver (requirements for #247; the *how* is left to its design):

1. **A defined predicate.** The design defines `inChain(U, T)` ("user U is in team T's reporting chain") precisely and implements it as one shared helper. The definition must cover a team with several managers and a team with no recorded manager. It must state whether "the chain" means the chain above T's recorded manager(s) or the upward chains of T's members.
2. **In addition to the role check, whatever the role's origin.** FR-2.1 stands: the actor must still be a facilitator. On top of that, `inChain(U, T)` refuses them, however their role was derived (a single claim value, precedence, or a future role set under #245). The design decides whether the check also limits an `application_admin`'s standing topic access to teams in their chain.
3. **Every place the membership check gates facilitator access.** That means draft session creation, the standing topic and content endpoints, and `GET /api/v1/teams/eligible-for-session` (a team must not be offered if the facilitator is in its chain).
   - The draft refusal gets its own error code and its own audit operation (for example `session.draft_denied_reporting_chain`). The response must not reveal the chain.
   - Auditing standing-access refusals is new scope; the design decides it.
   - The membership check and its audit stay unchanged. The design states which refusal wins when both apply.
4. **No setup required to start.** Recording a chain is optional for a team. A team with **no recorded chain** runs sessions under the membership check alone, exactly as before #247, with no prompt or extra step for the facilitator or members. Teams without a chain must be visible to an Application Admin, so the gap is never silent. Once a team **has** a recorded chain that cannot be evaluated (source unavailable, a cycle, depth exceeded), session creation for it is refused and audited: an admin chose to record that chain, so a broken one is not passed through. (Revised 2026-10-06. It replaces "fails closed for teams with no chain", which would have made recording a chain a prerequisite for every new team.)
5. **Manager relationships only.** Store the manager's identity (who may have no Dipstick account), the relationship, its source and an as-of time. Store no title, level, org name, or HR identifier beyond the join key. The design defines who can read and who can change the chain, and changes are audited.

**Open design questions** (for #247, not decided here):
- **Source of truth.** IdP-supplied (for example a `manager` attribute or manager-hierarchy groups) or recorded in the application by an Application Admin (extending TEAM-006). The 2026-10-03 decision made the IdP the single writer of `global_role` (01b, Decision section). Whether that principle also applies to reporting lines needs to be settled.
- **Depth.** The full chain to the top of engineering, or a bounded number of levels.
- **Staleness.** How quickly a reorg reaches the check (compare the ~90-minute bound on role changes).
- **New teams.** A team created through `POST /api/v1/teams` has no chain at first and runs under the membership check (requirement 4). Who records its chain later, and is the admin prompted to?
- **Sessions already in progress.** #235 Decision 12 re-reads the role when a draft moves to the lobby, and only lobby-or-later sessions stay with their facilitator. Does that draft → lobby re-check also apply `inChain`?
- **Dual-claim audit (#235 Security review S4).** Should `discardedRoles` also go in the `auth.role_claim_mapped` audit row, as durable evidence of who was sent both `engineering_manager` and `facilitator`?

---

## 4. Until the model ships (deferred, no launch gate)

Teams go live on today's controls:
- **The membership check** (FR-2.2): a facilitator cannot run a session for a team they belong to, including as a recorded manager.
- **The #243 precedence**: anyone the IdP sends both `engineering_manager` and `facilitator` resolves to manager and cannot facilitate.
- **An operator rule in `docs/deployment.md`** ("Group hygiene checklist"): do not put any manager in the facilitator group, including skip-level managers and directors, and pick facilitators who are not in the target team's reporting chain. This covers the gap section 2 describes, by process rather than by the application.

These are an **interim** control, not a standing approximation of "not in the reporting chain". The decision to model the chain stands.

**When to schedule #247:** the product owner decides. Natural triggers are a rollout beyond the first teams, or evidence (an audit or a report) of a facilitator in a team's chain.

---

## 5. Superseded: the 2026-10-04 decision (PR #242)

On 2026-10-04 the product owner decided **not** to model the reporting chain:
- A user sent both `engineering_manager` and `facilitator` would resolve to `engineering_manager`, be told, and be audited (#241).
- Draft takeover (#240) would recover sessions stranded by that rule.
- The docs warning would stay as the standing control.

That record went into PR #242, which was closed unmerged when the product owner changed their mind. Comments on #238 and #235 still point to it.

**Why it was reversed.** The conflict rule catches only a manager the IdP sends *both* values. It cannot see a manager sent `facilitator` alone, or a skip-level manager, and those are the cases the intent in Summary.md:12 is about. A rule that catches only what the application can already see leaves the ritual's guarantee resting on IdP group hygiene.

**What remains of it.** "Manager outranks facilitator" shipped independently in #243. #241 (user notice and audit for the conflict) and #240 (draft takeover) stay open; the product owner decides separately whether they are still needed.

---

## 6. Follow-up

- **#247:** the reporting-chain model and the facilitator-eligibility check (section 3). Deferred; no launch gate.
- **#235 Follow-up 2:** #235's proposal was never merged to `main`, so the link to this record is a comment on #235.

**Revisit** only by a new product-owner decision, recorded here.
