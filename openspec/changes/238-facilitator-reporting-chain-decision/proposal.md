# Proposal: 238-facilitator-reporting-chain-decision (#238)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (revised after the
Facilitator and BA explore reviews) and the binding `decision-log.md`, rows 1–11. Nothing in the
decision log is reopened here.*

## Why

When I wrote the original proposal, the facilitator rule had two halves: a senior engineer from
*another* team, and someone *not in the team's reporting chain* (`requirements/Summary.md:12`).
Both halves exist for the same reason the no-manager rule exists. People with authority over the
participants change what the participants are willing to say, whether they're voting or running
the room.

Today the application enforces only the first half: no active `team_memberships` row on the target
team (FR-2.2 [HARD]). Reporting lines aren't modelled. #235 then adds `facilitator` to the IdP
claim allowlist with the precedence `application_admin` > `facilitator` > `engineering_manager`
(#235 Decision 7). Under that order, a person the IdP sends both `engineering_manager` and
`facilitator` becomes a **facilitator**. That person can open a room on a skip-level or sibling
team, and the no-manager participation block for them rests on membership rows alone. It also
quietly breaks their real job, because their EM content access falls into the dual-check mismatch
path (`team-content-access-helper.ts`).

#235 parked the question as its Follow-up 2, with a VP condition that it be decided before the
first team goes live. The user has now decided it (decision-log rows 1–4, 8–11):

- **No reporting-chain model.** The app does not learn the org chart.
- **A narrow conflict rule instead.** If the IdP sends a user both `engineering_manager` and
  `facilitator`, they are signed in as `engineering_manager`, are told, and the conflict is
  audited. `application_admin` still wins, and the conflict is still flagged. This is the only
  reporting-chain violation the app can detect from data it already receives, and it resolves
  toward the role the ritual can live with.
- **Decision record now, code later.** The rule depends on #235's role resolution, which is on an
  unmerged branch with no code yet. Implementation is a follow-up issue, blocked by #235, that
  gates first-team launch.

If this decision lives only in a PR thread, the next person to touch role resolution will
"simplify" it back to plain precedence, or will read "error" as "fail the sign-in". The ritual
needs the decision, its reasons and its known gaps written down where the requirements live,
so that nobody has to come and ask me.

## What Changes

This change adds **documents only**. No application code, migrations, specs under
`openspec/specs/`, or `docs/` files change.

1. **New decision record** `requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`,
   modelled on 01b's deferral doc. It contains:
   - **Status and owners.** Decided 2026-10-04 by the user (product owner), decision-log rows 1–4
     and 8–11. Follow-on owner: Marcus Delgado (BA). VP of Engineering acknowledgment (Rachel
     Okonkwo): *pending*. #238 does not close until that field is filled.
   - **Traceability header.** `Summary.md:12`; BRD §6.2 and §6.3; FR-2.1 [HARD], FR-2.2 [HARD];
     #235 Decisions 7, 9 and 12; #235 design D3; #235 Security review S4.
   - **The decision**, plus a glossary line: "error" means *the conflict is never silent*, not a
     failed sign-in.
   - **The resolved-role rule** stated precisely, with the exploration §3 table (11 rows,
     including duplicates, case mismatch, string claim and admin cases).
   - **Why `engineering_manager`.** It leads with the broken-EM-access finding, then defence in
     depth for the no-manager rule, then the failure direction.
   - **How it shows up for people**: the conflicted person, the IdP/access admin and Security, and
     everyone else (nothing, ever). It covers the audit-content rule (allowlisted role names
     only, never raw claim values) and the S4 disposition (a dedicated conflict row, not
     `outrankedRoles` on `role_claim_mapped`).
   - **Sessions** (row 11). Drafts owned by a now-conflicted user stay blocked at room-open and are
     recreated by another facilitator; the notice names them. No reassignment feature. Sessions
     already past room-open stay with their facilitator via `sessions.facilitator_id`, per #235
     Decision 12. This is a stated decision, not an emergent property, so later hardening does
     not "fix" it.
   - **Rejected options:** (a) a reporting-chain model (manager-of relationships beyond TEAM-006,
     or an org-chart sync), (b) keeping #235 precedence for the pair, (c) failing the sign-in,
     (d) audit and log only with no user notice.
   - **Residual gaps** 1–6 (manager sent only `facilitator`; skip-level managers and above; missing
     or stale EM memberships; informal authority; the BA-owned "peer is not in the reporting
     chain" interpretation; the interim window), with the deployment-docs warning confirmed as the
     standing control.
   - **#238 AC disposition paragraph**, the dependency on #235, the first-team-launch gate
     (row 8), where the pre-launch items live (row 10: the follow-up issue, no checklist doc), and
     a link to the follow-up implementation issue.
   - **Revisit if:** an IdP can supply a reliable manager attribute; a person with line authority
     over a team's participants is reported to have facilitated that team's session; or the app
     gains org-structure data for another reason.
2. **Pointer from `requirements/Summary.md:12`.** A footnote marker on the facilitator line and one
   footnote at the end of the file. The sentence itself is unchanged, because it's the source
   concept.
3. **Index entries.** In `requirements/use cases/README.md`, add 01c and the missing 01b.
   In `01 - Identity and Access - Use Cases.md`, add one cross-reference line beside the existing
   "Facilitator designation … (#235)" out-of-scope note.
4. **Appendix A (below): paste-ready amendment text for #235.** This covers the Follow-up 2 link,
   the Decision 7 annotation, and the replacement deployment-docs warning together with the
   #235 spec text it depends on. #235 lives on another unmerged branch, so this change can't edit
   it.
5. **Appendix B (below): draft body for the follow-up implementation issue**, to be filed by the
   orchestrator at the end of this pipeline. It carries the first-team-launch gate, the minimum
   acceptance criteria, the pre-launch items and the normative scenarios.

## Constraints that must be preserved

- **The no-manager rule stays structural.** Nothing in the decision, the notice or the docs offers a
  setting, toggle or override. The only deployment-configured item in the follow-up is the
  *contact text* in the notice, which is display text, not behaviour.
- **Facilitator from another team stays a hard block.** The conflict rule adds to the membership
  check and does not replace it.
- **The app never writes `global_role`.** The IdP stays the single writer (01b Decision). The
  conflict rule only changes how a claim is *read*.
- **Raw claim values never reach an audit row or a log line.** The conflict record carries
  allowlisted role names only.
- **The app disappears during the ritual.** The user notice never renders on a live-session route,
  including the re-authentication return path. Teammates, participants and other facilitators are
  never told about one person's role misconfiguration.
- **Main specs describe what is built.** `openspec/specs/` gains no requirement for unbuilt
  behaviour. See `design.md` D2.
- **No team goes live in the interim window** (row 8). Until the follow-up ships, #235's warning text
  stands unchanged and, with the D3 log line, is the only control for this pair.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change edits `requirements/` documents only. There is **no `specs/` delta**: the
requirement the rule modifies ("Multi-valued role claims resolve by fixed precedence") exists only
on #235's unmerged branch, and the behaviour is not built. Any delta synced now would describe
software that doesn't exist. The future normative scenarios are in Appendix B. Precedent:
the archived `2026-09-29-join-link-use-case-sync` (also no spec delta). Rationale: `design.md` D2.

## Non-goals

- Any application code, migration, spec or `docs/deployment.md` change. All of that is in the
  follow-up issue.
- Editing #235's files. Appendix A is applied by whichever of #235 and #238 merges second.
- A reporting-chain or org-structure model (rejected).
- Draft reassignment (row 11: recreate instead).
- An in-app "who is conflicted" view. An audit-log query and a docs troubleshooting entry cover it.
- A launch-checklist document (row 10).

## Impact

- **New:** `requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`.
- **Edited:** `requirements/Summary.md` (footnote only), `requirements/use cases/README.md` (two
  index rows), `requirements/use cases/01 - Identity and Access - Use Cases.md` (one
  cross-reference line).
- **Not affected:** `packages/`, `openspec/specs/`, `docs/`, #235's branch.
- **#238 acceptance criteria:**
  - AC 1 is met when Appendix A.1 is applied to #235's proposal. Until then the #238 PR says
    "AC 1: pending amendment on #235", and #238 stays open.
  - AC 2 is met by the record plus the filed follow-up issue whose body contains Appendix B's
    minimum ACs.
- **Human actions outside this change:**
  - File the follow-up issue (orchestrator).
  - VP acknowledgment on the record's Status line.
  - GitHub comments on #235 and #238 pointing to the record.
  - Move #238 on the project board (decision-log row 7).

## Open items

1. **VP acknowledgment** (Rachel Okonkwo) on the 01c Status line. #238 doesn't close without it.
2. **`openspec validate --strict` not run.** The CLI isn't available in this environment. The artifacts
   follow the archived-change structure by hand.

*Closed since exploration:*
- Live-session rule and draft handling (row 11).
- Launch-checklist location (row 10).
- Launch gate (row 8).
- User notice (row 9).

---

## Appendix A — Paste-ready amendments to #235 (`facilitator-role-claim-allowlist`)

#235 is on branch `ccr-b594efa3-9zclgu` and isn't merged. **Who applies these:** whoever merges second.
If #238 merges second, its PR applies A.1 and A.2 to #235's files once they're on `main`. A.3 is
**not** applied by either PR; it belongs to the follow-up implementation issue (Appendix B, AC 9).
Replace `#NNN` with the follow-up issue number once it's filed.

### A.1 `openspec/changes/facilitator-role-claim-allowlist/proposal.md`, Follow-ups item 2

**Before:**

> 2. **#238: Reporting-chain enforcement (owner: BA, Marcus Delgado, with the VP of Engineering).** Decide whether "not in the team's reporting chain" (`Summary.md:12`) needs a model of its own (for example, manager-of relationships beyond TEAM-006 memberships), or whether "not a member" plus the deployment-docs warning is an acceptable standing approximation. Cite this proposal's Non-goals and Constraints. **Condition (VP of Engineering):** file it before the first team goes live, so the decision is on record. Like #237, this gates first-team launch, not this change.

**After:**

> 2. **#238: Reporting-chain enforcement (owner: BA, Marcus Delgado, with the VP of Engineering). Decided 2026-10-04**, see [`requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`](../../../requirements/use%20cases/01c%20-%20Facilitator%20Reporting%20Chain%20-%20Decision.md). No reporting-chain model is built. Instead, a user sent both `engineering_manager` and `facilitator` is signed in as `engineering_manager`, told, and audited (`application_admin` still wins and is still flagged). This supersedes Decision 7 **for that pair only**. Implementation is #NNN, blocked by this change, and like #237 it gates first-team launch. Until #NNN ships, the manager warning in Constraints stands unchanged and, with the D3 log line, is the only control for the pair. The residual gaps the decision record lists (skip-level managers and managers sent only `facilitator`) keep the warning as their standing control.

And append to the "Input to Follow-up 2" paragraph:

> *Resolved by #238:* the reporting-chain decision answers S4 with a dedicated conflict audit row rather than `outrankedRoles` on `role_claim_mapped` (decision record, "How this shows up for people").

### A.2 `openspec/changes/facilitator-role-claim-allowlist/decision-log.md`, row 7

Append to the Decision cell of row 7:

> **Superseded for the `engineering_manager` + `facilitator` pair by #238 (2026-10-04):** that pair resolves to `engineering_manager`, and the conflict is surfaced and audited. Implementation is #NNN. Precedence is otherwise unchanged.

### A.3 Deployment-docs warning and the #235 text it is pinned to (applied by #NNN, not now)

The VP made the warning a character-for-character SHALL (#235 `first-access` spec, "Deployment
documentation describes the role claim"), quoting #235 `proposal.md` Constraints. So the docs,
the quoted proposal text and the spec must all change in the **same** PR that implements the rule.
Changing the markdown alone fails #235's checklist scenario.

**Before** (in `docs/deployment.md` and #235 `proposal.md` Constraints, identical):

> Do not assign `facilitator` to anyone who manages people. If a user is sent both `engineering_manager` and `facilitator`, the application treats them as **facilitator only**. From then on, the rule that managers never participate in a Health Check is enforced only by their team memberships being recorded with the `engineering_manager` role. Keep those memberships accurate, and give managers exactly one app role.

**After:**

> Do not assign `facilitator` to anyone who manages people. If a user is sent both `engineering_manager` and `facilitator`, the application signs them in as **engineering manager**, records `<conflict audit operation>` in the audit log and tells the user. Fix the assignment in your IdP. A manager who is sent only `facilitator`, or who manages a team from above without being recorded as its engineering manager, is not detected. For them, the rule that managers never participate in or facilitate a Health Check depends on this instruction and on their team memberships being recorded with the `engineering_manager` role. Keep those memberships accurate, and give managers exactly one app role.

Edits relative to *before*: the first sentence is kept verbatim. "facilitator only" becomes the
conflict behaviour. The "From then on…" sentence is removed for the pair and re-scoped to the
residual gaps. "Keep those memberships accurate" is kept, because residual gaps 1 and 3 depend on
it. `<conflict audit operation>` is the operation name chosen in #NNN.

In the **same** PR, also amend:
- The #235 `first-access` spec, "Multi-valued role claims resolve by fixed precedence": the
  rule paragraph, the "Known consequence (accepted)" paragraph, and the scenario "Facilitator
  outranks engineering manager". See Appendix B's normative scenarios.
- The #235 `auth-error-handling` spec: the new conflict audit operation.
- The `docs/deployment.md` precedence bullet in "How the claim is read": add "except that
  `engineering_manager` together with `facilitator` resolves to `engineering_manager`".
- The line after the warning: the D3 log line now fires for this pair only when
  `application_admin` is also present.

---

## Appendix B — Draft body for the follow-up implementation issue

*Filed by the orchestrator at the end of this pipeline. Suggested title:*
**Resolve `engineering_manager` + `facilitator` role-claim conflict to engineering manager (notice + audit)**

> **Blocked by:** #235. **Gates:** first-team launch, like #237. No team goes live until this
> issue is closed (#238 decision-log row 8).
> **Decision record:** `requirements/use cases/01c - Facilitator Reporting Chain - Decision.md` (#238).
> **Track:** full. Role resolution is an authorization boundary and touches the no-manager rule.
>
> ### Why
> Under #235's precedence, a user the IdP sends both `engineering_manager` and `facilitator`
> resolves to `facilitator`. They can then open a room on teams where they hold no membership,
> the no-manager block for them rests on membership rows alone, and their own EM content access
> degrades through the dual-check mismatch path. #238 decided that this pair resolves to
> `engineering_manager`, and that the conflict is never silent: the user is told and the conflict
> is audited.
>
> ### Rule (normative)
> Among the allowlisted values in the claim: if both `engineering_manager` and `facilitator` are
> present, discard `facilitator`, then apply #235 precedence (`application_admin` > `facilitator` >
> `engineering_manager` > `senior_engineer` > `engineer`) to what remains. Whenever both were
> present, record a role conflict, whatever role was finally applied. Detection happens after
> allowlist filtering, ignores duplicates, and uses exact matching (no case-folding). Only an
> array claim can produce a conflict.
>
> | Allowlisted claim elements | Applied role | Conflict? |
> |---|---|---|
> | `engineering_manager` | `engineering_manager` | no |
> | `facilitator`, `engineering_manager` | `engineering_manager` | yes |
> | `facilitator`, `engineering_manager`, `senior_engineer` | `engineering_manager` | yes |
> | `facilitator`, `facilitator`, `engineering_manager` | `engineering_manager` | yes, one |
> | `application_admin`, `facilitator`, `engineering_manager` | `application_admin` | yes |
> | `application_admin`, `engineering_manager` | `application_admin` | no (D3 log only) |
> | `application_admin`, `facilitator` | `application_admin` | no |
> | `facilitator` | `facilitator` | no (residual gap) |
> | `facilitator`, `superuser` | `facilitator` | no (allowlist warning only) |
> | `Facilitator`, `engineering_manager` | `engineering_manager` | no (allowlist warning for `Facilitator`) |
> | string `"engineering_manager facilitator"` | `engineer` | no |
>
> ### Normative scenarios (replace #235's "Facilitator outranks engineering manager")
> - **WHEN** the role claim is `["facilitator","engineering_manager"]` **THEN** `users.global_role`
>   is `'engineering_manager'`, exactly one conflict audit row is written in the same transaction
>   as the `auth.role_claim_mapped` row, the D3 outranked warning is **not** emitted, and the user
>   sees the conflict notice on their first non-session page.
> - **WHEN** the role claim is `["application_admin","facilitator","engineering_manager"]` **THEN**
>   `users.global_role` is `'application_admin'`, the D3 outranked warning **and** one conflict
>   row are both emitted, and the notice uses admin-specific copy.
> - **WHEN** the conflict-row insert fails **THEN** the sign-in fails and neither row persists.
> - **WHEN** the role claim is the string `"engineering_manager facilitator"` **THEN** no conflict
>   is recorded.
>
> ### Scope
> - `account-resolver`: conflict detection; return a conflict flag on `ResolvedUser`.
> - `routes/auth.ts`: a new conflict audit operation (name is this issue's call, e.g.
>   `auth.role_claim_conflict`) inside the same `withAuditTransaction` as the role UPSERT, plus a
>   post-commit structured log event. Register the operation in `audit-logger.ts`. Metadata is
>   limited to `{ oidcSubject, appliedRole, conflictingRoles: ["engineering_manager","facilitator"],
>   previousRole, correlationId }`. No raw claim values, no non-allowlisted elements or their
>   counts. One row per sign-in while the conflict persists. Docs name the event as suitable for an
>   operator alert; the app configures none (#235 Decision 9).
> - **User notice**:
>   - Placement: non-blocking, never a modal, on the first non-session page after sign-in.
>   - Frequency: shown on every sign-in while the conflict persists; once dismissed, hidden until
>     the next sign-in.
>   - Never rendered on a live-session route (lobby, pre-session, active, reveal, wrap-up), including
>     the re-authentication return path.
>   - Copy rules:
>     - No "IdP", "OIDC" or "claim".
>     - Says which role goes, what still works, and how to clear it (sign out and back in after the
>       fix).
>     - Mentions the promotion case.
>     - Never blames the user.
>     - Contact text is deployment-configured display text with a generic fallback.
>   - Lists the user's stranded `draft` sessions (team and date) and asks them to arrange another
>     facilitator.
>   - Admin-specific copy for the admin case.
>   - Copy is reviewed by Priya Nair (Facilitator).
> - **Room-open:** the existing live-`global_role` check before draft → lobby stays. When the
>   user carries the conflict flag, the 403 gets conflict-specific copy (for example, "You can't
>   open this session because your account is now set up as an Engineering Manager. Another
>   facilitator will need to run it."). No workaround and no reassignment: the draft is
>   recreated by another facilitator (#238 row 11).
> - **Sessions already past room-open** stay with their facilitator via `sessions.facilitator_id`
>   (#235 Decision 12, #238 row 11). The conflict rule never interrupts them. Add a test so a later
>   hardening change can't "fix" it.
> - Session-creation entry points stay hidden for a resolved EM, as for any EM.
> - **Specs and docs:** apply #238 proposal Appendix A.3. This covers the #235 `first-access`
>   precedence requirement, `auth-error-handling`, the verbatim warning in proposal and docs, the
>   precedence bullet, and the docs troubleshooting entry:
>   - the event name;
>   - "one row per sign-in, so count distinct users, not rows";
>   - how to confirm a fix (the next sign-in shows `role_claim_mapped` with no conflict row);
>   - the "remove Facilitator from people who manage people" rule.
> - **Local dev:** a simulator persona that sends both roles.
>
> ### Minimum acceptance criteria
> 1. Every row of the rule table is a passing resolver test.
> 2. Duplicate elements produce one conflict. A string claim never produces a conflict.
> 3. One `role_claim_mapped` row plus one conflict row are written in the same transaction. A
>    failed conflict insert fails the sign-in and neither row persists.
> 4. Conflict-row metadata is limited to the fixed fields. A test asserts that a non-allowlisted
>    element (for example `superuser`) and its count are absent from the audit row and the
>    structured log.
> 5. With `application_admin` present, the D3 warn and the conflict row both fire. Without admin,
>    D3 does not fire for the pair.
> 6. First access with a conflicting claim writes `auth.first_access_created` and the conflict row.
> 7. The notice:
>    - renders on the landing page;
>    - does **not** render on any session route, including the re-auth return path (extend
>      `reauthRequiredHostParity`);
>    - reappears on the next conflicted sign-in after dismissal;
>    - is absent for a non-conflicted sign-in;
>    - uses admin-specific copy in the admin case;
>    - lists stranded drafts.
> 8. The room-open 403 carries conflict-specific copy when the flag is set, and the draft stays
>    blocked.
> 9. #238 Appendix A.3 is applied. The #235 `first-access` and `auth-error-handling` specs and the
>    verbatim docs SHALL are amended consistently, and the docs checklist scenario passes against the
>    new warning text.
> 10. A session already past room-open continues under its facilitator after that facilitator's
>     role resolves to `engineering_manager`.
> 11. The simulator has a persona that sends both roles.
>
> ### Pre-launch steps (must be done before the first team goes live; #238 row 10)
> - [ ] **IdP attestation.** The IdP administrator confirms in writing (recorded on this issue,
>   with name and date) that no current holder of `facilitator` has line-management responsibility
>   for anyone in a team using the app. This is the only control that touches residual gaps 1
>   and 2.
> - [ ] **One-time read-only interim check.** Before go-live, the deploying operator runs one
>   read-only query: `draft` or `active` sessions whose facilitator now has
>   `global_role = 'engineering_manager'` or has a conflict row. A human recreates any hits under a
>   proper facilitator. Record the operator, date, environment and result on this issue. This is
>   not shipped code.
> - [ ] **Usability walk-through with Priya Nair**, using the both-roles simulator persona with a
>   pending draft: sign in, read the notice, try room-open, "fix" the IdP, sign back in.
