# Decision: Facilitator Reporting Chain

**The rule.** If the IdP sends a user both `engineering_manager` and `facilitator`, the application signs them in as `engineering_manager`, tells them, and audits the conflict; `application_admin` still wins and the conflict is still flagged. **Why.** This is the only reporting-chain violation the application can detect from data it already receives, it keeps the manager's real Engineering Manager access working, and it fails toward the role the ritual can live with. **What it doesn't catch.** A manager who is sent only `facilitator`, and skip-level managers and above who hold no Engineering Manager role on the teams below them; for those the deployment-docs warning is the standing control.

---

## 1. Status, owners and traceability

**Status:** **Decided 2026-10-04 by the user (product owner)**, decision-log rows 1–4, 8–11 and 13–18 of change `238-facilitator-reporting-chain-decision` (#238). Decision-log row 19 is cited separately: pipeline default, accepted; subject to change by the product owner (the interim operator's audit identity and the notice's contact text, see "Sessions" and "How this shows up for people").
**Follow-on owner:** the Business Analyst.
**VP of Engineering (decision-log row 12):** Persona review (Executive Stakeholder) approved with conditions; human VP of Engineering acknowledgment *pending* (owner: the user, as product owner). The persona review is input to the VP, not the VP's acknowledgment. #238 does not close until the human acknowledgment is recorded here.
**Implementation:** #NNN (conflict rule; blocked by #235; gates first-team launch).
**Draft takeover:** #MMM (separate issue; no launch gate).

**Traceability:**
- `Summary.md:12`: the facilitator is "a senior engineer from *another* team … not in the team's reporting chain" (the intent).
- BRD §6.2 (Engineering Managers never participate) and §6.3 (facilitator from another team).
- FR-2.1 [HARD] (only Facilitators create sessions) and FR-2.2 [HARD] (the facilitator holds no membership on the target team): what is enforced today.
- #235 (`facilitator-role-claim-allowlist`): Decisions 7 (role-claim precedence), 9 (a manager switched to `facilitator` gets a docs warning only, with no alerting) and 12 (an existing session stays with its facilitator); design D3 (the outranked-role log line); Security review S4 (where a role conflict is recorded).

---

## 2. Decision

The application does **not** model the reporting chain. Instead it enforces a narrow conflict rule: a user the IdP sends both `engineering_manager` and `facilitator` is signed in as `engineering_manager`, is told, and the conflict is audited. If the claim also contains `application_admin`, the user is signed in as `application_admin` and the conflict is still told and audited.

**Glossary.** In #238 and the decision log, "error" and "flag" mean *the conflict is never silent*: the user is told and the conflict is audited. They do **not** mean a failed sign-in.

**Relation to #235.** This rule supersedes #235 Decision 7 **for this pair only** (`engineering_manager` together with `facilitator`). #235 precedence is otherwise unchanged (decision-log row 3), including `application_admin` winning over every other value (row 4).

The rule only changes how the role claim is *read*. The application still never writes `global_role`; the IdP stays its single writer (see "Designate a Facilitator — Deferral", Decision section). The rule adds to the "not a member of the team" check (FR-2.2 [HARD]) and does not replace it.

---

## 3. Resolved-role rule

Among the allowlisted values in the claim: if both `engineering_manager` and `facilitator` are present, discard `facilitator`, then apply #235 precedence (`application_admin` > `facilitator` > `engineering_manager` > `senior_engineer` > `engineer`) to what remains. Whenever both were present, record a role conflict, whatever role was finally applied.

- Detection happens after allowlist filtering, ignores duplicates, and uses exact matching (no case-folding).
- Only an array claim can produce a conflict. A single string cannot carry both values (#235 does not split on commas or spaces).
- #235 D3's outranked-role log line is computed from the allowlisted set *before* `facilitator` is discarded. For the plain pair, `engineering_manager` is applied, so it is not outranked and D3 does not fire. With `application_admin` present, both the D3 line and the conflict fire.
- First access is covered: a brand-new user whose first claim conflicts gets the first-access record *and* the conflict record.

| Allowlisted claim elements | Applied role | Conflict? |
|---|---|---|
| `engineering_manager` | `engineering_manager` | no |
| `facilitator`, `engineering_manager` | `engineering_manager` | yes |
| `facilitator`, `engineering_manager`, `senior_engineer` | `engineering_manager` | yes |
| `facilitator`, `facilitator`, `engineering_manager` | `engineering_manager` | yes, one |
| `application_admin`, `facilitator`, `engineering_manager` | `application_admin` | yes |
| `application_admin`, `engineering_manager` | `application_admin` | no (D3 log only) |
| `application_admin`, `facilitator` | `application_admin` | no |
| `facilitator` | `facilitator` | no (residual gap) |
| `facilitator`, `superuser` | `facilitator` | no (allowlist warning only) |
| `Facilitator`, `engineering_manager` | `engineering_manager` | no (allowlist warning for `Facilitator`) |
| string `"engineering_manager facilitator"` | `engineer` | no |

---

## 4. Why `engineering_manager`

1. **#235 precedence breaks the manager's real job.** A manager resolved to `facilitator` loses Engineering Manager content access on their own teams: the dual check (`global_role` and `membership_role`) no longer agrees, so every content request drops to the access-grant mismatch path and degrades to participant-level access. Resolving to `engineering_manager` keeps that access intact. So the rule is the *correct* resolution, not only the safer one.
2. **Defence in depth for the no-manager rule.** It restores defence in depth. Under #235 precedence, the block on a manager participating rests on `team_memberships` alone, which is the "keep memberships accurate" dependency the #235 docs warning admits to. Resolving to `engineering_manager` puts the `global_role` signal back, so both checks hold. The person also can no longer create or open sessions on any team, including skip-level and sibling teams where they hold no membership.
3. **Failure direction.** #235 precedence fails toward privilege (the person can run sessions). This rule fails toward restriction (the person can't). There is no legitimate "manager who also facilitates" profile in the ritual: the facilitator is a senior engineer. The person loses an ability they should not have had.

---

## 5. How this shows up for people

Both halves of "never silent" are required: the user is **told**, *and* the conflict is **audited** (decision-log row 9). Audit and log only, with no user notice, is rejected (see "Rejected", option (d)).

| Audience | What they see |
|---|---|
| The conflicted person | One plain, non-blocking notice outside sessions on every sign-in while the conflict persists, and a conflict-specific refusal if they try to open a room. The notice never appears on a live-session route. |
| The IdP or access administrator, and Security | A dedicated conflict audit row and a structured log event, plus a troubleshooting entry in the deployment documentation. The event is named as suitable for an operator alert. The application configures none (#235 Decision 9). |
| Everyone else: the team, participants and other facilitators | Nothing, ever. |

**Audit content.** The conflict record carries allowlisted role names and identifiers the application already audits, and nothing else. It never contains raw role-claim values: no non-allowlisted elements, no counts of them, no case variants. The conflicting pair is a fixed code constant, never built from the claim.

**Security S4 disposition.** #235's Security review S4 asked where a role conflict is recorded. The answer is a dedicated conflict audit row, written in the same transaction as the sign-in's role audit row. The outranked roles are **not** added to the existing role-mapping audit row; one purpose-built row is clearer to an incident reviewer than a general field.

**Contact.** The notice's "who to ask" text is the existing `APPLICATION_ADMIN_CONTACT_EMAIL`, with a generic fallback when it is unset; no new setting is added (decision-log row 19). Contact text is display text, not behaviour.

**Copy.** The exact notice and room-open copy is decided in #NNN, reviewed by a human facilitator (not the implementer). This record fixes only the rules above.

---

## 6. Sessions

These are stated decisions (decision-log rows 11 and 14–19), not emergent properties, so a later hardening change does not "fix" them.

**Drafts.**
- A draft created by a user the conflict rule now resolves to `engineering_manager` stays blocked at room-open: the live-role check before draft → lobby stays, because a manager must not open a room (row 11). The user's conflict notice names these drafts.
- A stranded draft can't be recreated in the app while it holds the team's single open-session slot: a draft counts as the team's one non-terminal session, and nothing in the app abandons a draft.
- **Draft takeover** is the unblock path (rows 14–16). Another facilitator can take over **any draft**, not only stranded ones, after a **confirmation prompt**, and every takeover writes an **audit event**. The taker passes the usual checks: a live `facilitator` role and no membership on the draft's team. Takeover is tracked in #MMM, a separate issue with **no launch gate** (row 17).
- **Until #MMM ships** (row 17): the **pre-launch draft check** in #NNN (row 10) covers drafts that exist at launch. A draft stranded after launch is cleared by a documented, audited operator step (#NNN), after which a facilitator creates a new draft. The operator records **their own app user id** as `actor_user_id` on the audit row, so the operator needs an app account (row 19).
- Draft-based access to the target team's content (action items, trends) requires a live `facilitator` role (row 18). A draft creator who is no longer a facilitator gets none.
- There is no reassignment feature in #NNN. Takeover belongs to #MMM and is initiated by the taker.

**Sessions past room-open** (lobby or later) stay with their facilitator via `sessions.facilitator_id`, per #235 Decision 12 (row 11). The conflict rule never interrupts them; the role change takes effect at the next draft creation or room-open. Pulling a facilitator out between lock-in and reveal does more damage to the ritual than letting one brief session finish, and the audit row records the conflict either way. What this covers, per #235 Security review S3, so the extent is decided rather than emergent:
- session control and live-event delivery;
- per-voter attribution for that session;
- the team's action items (with owner names) and trends;
- for 30 minutes after the session completes;
- with no time limit while the session is non-terminal.

Facilitator surfaces that need a live standing `facilitator` role (topic management, annotations, session eligibility) do change with the role. They are not session control.

---

## 7. Rejected

- **(a) A reporting-chain model**: manager-of relationships beyond TEAM-006 Engineering Manager memberships, or an org-chart sync from the IdP. The application has never modelled org structure, a model adds a second source of truth that drifts, and it is disproportionate before the first team is live.
- **(b) Keeping #235 precedence for the pair** (the pair resolves to `facilitator`). It breaks the manager's own Engineering Manager access and fails toward privilege (see "Why `engineering_manager`").
- **(c) Failing the sign-in on conflict.** It denies a legitimate manager their Engineering Manager access over an IdP mistake they don't control, when `engineering_manager` is already the restrictive outcome.
- **(d) Audit and log only, with no user notice.** The user must be told (decision-log row 9).

**Audit-write failure is not option (c).** A failed conflict-row insert fails the sign-in, as any transactional audit-write failure does (#235 `auth-error-handling`). That rule is about the audit trail, not about the conflict itself, and is not rejected option (c).

---

## 8. Residual gaps and standing control

The rule does not close these gaps. They are stated so they are not discovered later.

1. **Manager sent only `facilitator`.** The IdP administrator replaces Engineering Manager with Facilitator instead of adding it. There is no conflict to detect. The person can facilitate any team where they hold no membership, including skip-level and sibling teams. The no-manager participation block survives only if their Engineering Manager memberships are still recorded. **Accepted risk** (decision-log row 13).
2. **Skip-level managers, directors and above.** They usually hold no Engineering Manager role and no memberships on the teams below them. If given `facilitator`, nothing distinguishes them from a senior engineer. This is the heart of "reporting chain", and the rule doesn't touch it. **Accepted risk** (decision-log row 13).
3. **Engineering Manager memberships not recorded or stale.** A manager whose memberships are missing for a team is invisible to every membership-based check. The conflict rule helps only by removing their facilitator ability while both roles are sent.
4. **Informal authority.** Tech leads and "acting" managers without the Engineering Manager role. The ritual cares about them, but the application has no signal at all.
5. **Interpretation of "not in the team's reporting chain"** (owned by the Business Analyst): it means not holding line authority over any participant, directly or through a skip level. A peer who shares a manager with the team is not in its reporting chain, so a sibling-team senior engineer is an acceptable facilitator.
6. **The interim window.** Between #235 merging and #NNN shipping, the pair resolves to `facilitator` per #235 Decision 7. This gap is closed by the first-team-launch gate (decision-log row 8): no team goes live in that window.

**Standing control.** The deployment-docs warning ("Do not assign `facilitator` to anyone who manages people …") is the standing control for gaps 1–4; for gap 1 this is #235 Decision 9 (docs warning only, no alerting), which this rule leaves in force. Gaps 1 and 2 are accepted risk: they have no pre-launch control, and the docs warning is their only control. The pre-launch IdP attestation in #NNN covers the both-roles pair at launch, not gaps 1 or 2, and no broader line-management attestation is required (row 13). Gap 5 is owned by the Business Analyst. Gap 6 is closed by the launch gate.

---

## 9. AC disposition, dependency and launch gate

**#238 acceptance criteria.** #238 AC 2 offers two branches. This decision meets both. **No reporting-chain model is chosen**, so the #235 deployment-docs warning is confirmed as the standing control for residual gaps 1–4. **A narrow code rule is chosen**, so implementation issue #NNN is filed. It is blocked by #235 and gates first-team launch (decision-log row 8). #238 AC 1 (the link from #235's Follow-up 2 to this record) is met when the amendment text in the #238 proposal, Appendix A.1 (archived at `openspec/changes/archive/2026-10-04-238-facilitator-reporting-chain-decision/proposal.md`), is applied to #235.

**Dependency.** #NNN depends on #235's role resolution (the `facilitator` allowlist entry, array claims and precedence), and must not ship before #235 is merged and archived, including #235's ID-token signature verification: the conflict row is only evidence if the claim is verified.

**Launch gate.** #NNN gates first-team launch, like #237 (decision-log row 8). No team goes live until it is closed.

**Pre-launch items.** Both live in #NNN as pre-launch steps (decision-log row 10); there is no separate launch-checklist document:
- the IdP administrator's written attestation that no user is assigned both `engineering_manager` and `facilitator`;
- the one-time pre-launch draft check for drafts owned by now-conflicted users, with each hit taken over (#MMM) or cleared by the audited operator step.

**Records on public issues.** The repository is public. What these steps (and every later use of the operator step) record on a GitHub issue is limited to: the operator's GitHub handle, the date, an environment *label* (for example `production`, never a hostname or connection string), the hit count, and the action per hit keyed by session id. People's names or emails, the IdP administrator's list of users, the attestation itself and any query output go in an internal ticket. The issue carries only that ticket's reference, which is also the `ticket` value on the operator audit row.

**Interim.** Until #NNN ships, the #235 warning text stands unchanged and, together with the #235 D3 log line, is the only control for this pair. No team goes live in that window (decision-log row 8).

---

## 10. Revisit if

1. A supported IdP can supply a reliable manager attribute (for example, a directory `manager` relationship).
2. A person with line authority over a team's participants is reported to have facilitated that team's session. Reports go to the Business Analyst and the VP of Engineering.
3. The application gains org-structure data for another reason.

---

## 11. Consequences for other documents

- **`requirements/Summary.md`:** the facilitator line (line 12) gains a footnote pointing here. The sentence itself is unchanged, because it is the source concept.
- **`requirements/use cases/README.md`:** index rows for 01b and this record.
- **`01 - Identity and Access - Use Cases.md`:** a cross-reference line beside the "Facilitator designation … (#235)" out-of-scope note.
- **#235 (`facilitator-role-claim-allowlist`):** the Follow-up 2 link (#238 proposal Appendix A.1) and the Decision 7 annotation (Appendix A.2), applied by whichever of #235 and #238 merges second.
- **Deployment-docs warning:** its new text, and the #235 spec text pinned to it, are applied by #NNN (#238 proposal Appendix A.3, archived at `openspec/changes/archive/2026-10-04-238-facilitator-reporting-chain-decision/proposal.md`), not before, so the docs never describe behaviour that doesn't exist.
