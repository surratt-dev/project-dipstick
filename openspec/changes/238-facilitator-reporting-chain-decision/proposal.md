# Proposal: 238-facilitator-reporting-chain-decision (#238)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (revised after the
Facilitator and BA explore reviews) and the binding `decision-log.md`, rows 1–11. Nothing in the
decision log is reopened here. Revised after the propose reviews (`propose-review-ba.md`,
`propose-review-exec.md`); see "Review disposition" at the end of the main body.*

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
   - **Three-sentence summary** at the top, before the traceability header: what the rule is, why,
     and what it doesn't catch (skip-level managers and managers sent only `facilitator`).
   - **Status and owners.** Decided 2026-10-04 by the user (product owner), decision-log rows 1–4
     and 8–11. Follow-on owner: the Business Analyst. VP of Engineering acknowledgment: "Persona
     review (Executive Stakeholder) approved with conditions, see #NNN; human VP of Engineering
     acknowledgment *pending* (owner: the user, as product owner)." The persona review is input to the VP,
     not the VP's sign-off. #238 does not close until the human acknowledgment is recorded.
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
     standing control. Gap 2 (skip-level managers) is controlled by the docs warning only; the
     pre-launch IdP attestation covers the both-roles pair at launch, not gaps 1 or 2.
   - **Audit-write failure line:** a failed conflict-row insert fails the sign-in as any
     transactional audit-write failure does (#235 `auth-error-handling`). This is not rejected
     option (c), which is about the conflict itself.
   - **#238 AC disposition paragraph**, naming both AC (2) branches explicitly (exploration §5):
     no reporting-chain model is chosen, so the docs warning is the standing control for residual
     gaps 1–4; a narrow code rule is chosen, so #NNN is filed. Then the dependency on #235, the first-team-launch gate
     (row 8), where the pre-launch items live (row 10: the follow-up issue, no checklist doc), and
     a link to the follow-up implementation issue.
   - **Revisit if:** an IdP can supply a reliable manager attribute; a person with line authority
     over a team's participants is reported to have facilitated that team's session (reports go to
     the Business Analyst and the VP of Engineering); or the app gains org-structure data for
     another reason.
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
  - Human VP of Engineering acknowledgment on the record's Status line (owner: the user, as product
    owner). The Executive Stakeholder persona review does not substitute for it.
  - GitHub comments on #235 and #238 pointing to the record.
  - Move #238 on the project board (decision-log row 7).

## Open items

1. **Human VP of Engineering acknowledgment** on the 01c Status line (owner: the user, as product owner).
   The Executive Stakeholder persona review approved with conditions; that is not the real VP's
   sign-off. #238 doesn't close without the human acknowledgment.
2. **Broader line-management attestation (new question for the user, not drafted into #NNN).**
   Should the pre-launch IdP attestation also confirm that no `facilitator` holder line-manages
   anyone on a team using the app? Row 10 decided only "no one holds both roles". The broader
   version would be the only pre-launch control touching residual gaps 1 and 2. Ask before adding.
3. **`openspec validate --strict` not run.** The CLI isn't available in this environment. The artifacts
   follow the archived-change structure by hand.

*Closed since exploration:*
- Live-session rule and draft handling (row 11).
- Launch-checklist location (row 10).
- Launch gate (row 8).
- User notice (row 9).

## Review disposition

Propose-stage reviews: `propose-review-ba.md` (BA) and `propose-review-exec.md` (Executive
Stakeholder persona). BA R1–R4 trace to decision-log rows 10 and 11 or to #235's design; I checked
R4 against #235 `design.md` (`shouldRecordRoleClaimMapped` returns `false` for a new user) and it
holds.

| Point | Disposition | Rationale / where |
|---|---|---|
| BA R1: attestation must match row 10 ("no one holds both roles") | Accepted | It's what the user decided. Appendix B attestation reworded; "only control for gaps 1 and 2" removed; 01c gap 2's control is the docs warning only (What Changes item 1, task 1.6). The broader line-management version goes to the user as Open item 2, not into #NNN. |
| BA R2: interim check covers drafts only, and finds not-yet-re-signed-in users | Accepted | `active` contradicted row 11 / #235 Decision 12, and the `global_role` query missed exactly the first-session case. Replaced with the BA's (a)/(b)/(c) draft query, run after deploy and after the attestation. |
| BA R2 (last bullet): walk-through misattributed to row 10 | Accepted (via Exec rec. 2) | Walk-through moved out of the pre-launch section into a "PR review" section with its own source (Facilitator suggestion 11). |
| BA R3: define the terms the notice ACs depend on | Accepted | Every row of the BA's table is now a definition or AC in Appendix B (live-session route, sign-in, placement, copy rules, admin copy, draft list, non-blocking, contact fallback, copy-review checkbox). Route paths are left for #NNN to list; I don't invent them here. |
| BA R4: first-access vs. returning sign-in | Accepted | Verified against #235 D5. Scenario 1 and AC 3 scoped to returning sign-ins; new first-access scenario; AC 6 asserts `previousRole: null`. |
| BA S1: say why a failed audit insert fails sign-in | Accepted | One line in Appendix B Scenario 3 and in the 01c plan. Stops the next reader confusing it with rejected option (c). |
| BA S2: AC for "never silent" | Accepted | Folded into AC 3 rather than a new AC, keeping the count at 11 (Exec condition 2). |
| BA S3: log field set equals metadata set | Accepted | Scope bullet and AC 4. Cites #235 S4/Constraints as the source. |
| BA S4: room-open 403 condition | Accepted | AC 8 reworded. |
| BA S5: AC-disposition names both branches | Accepted | 01c plan (What Changes item 1) uses the exploration §5 wording. |
| BA S6: trigger 2 owner and channel | Accepted (merged with Exec condition 3) | Recipients named by role: "the Business Analyst and the VP of Engineering". |
| BA S7: `grep -c "row 10"` ≥ 2 | Accepted | Added to task 3.2. |
| Exec: "Acknowledged … Rachel Okonkwo" for the 01c Status line | **Modified** | This is a persona review, not the real VP's sign-off. Status line reads "Persona review (Executive Stakeholder) approved with conditions; human VP of Engineering acknowledgment pending (owner: the user, as product owner)". Open item 1 and #238's open state are kept. |
| Exec condition 1: start #NNN when #235 merges, parallel with #237; escalate slips | Accepted | "Schedule" line in Appendix B header. |
| Exec condition 2: freeze #NNN at minimum ACs | Accepted | "Scope freeze" line in Appendix B header. BA additions went into existing ACs, not new ones. |
| Exec condition 3: trigger 2 recipients | Accepted | See BA S6. Roles, not persona names, in the requirements doc. |
| Exec rec. 1: three-sentence summary at top of 01c | Accepted | What Changes item 1 and task 1.1; design D1 section order. |
| Exec rec. 2: fold Priya walk-through into #NNN PR review, timebox it | Accepted | Matches row 10, which names only two pre-launch items. Design D4 updated. |
| Exec rec. 3: accepts residual gaps with attestation + docs warning as standing control | Modified | Agreed on substance, but per BA R1 the attestation covers the pair at launch, not the residual gaps. The docs warning alone is their standing control. |

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
> **Schedule:** start the day #235 merges, in parallel with #237, so this adds no serial time to
> first-team launch. If it threatens the launch date, raise it with the VP of Engineering before
> anyone trims ACs or proposes waiving the gate. The gate stays (#238 row 8).
> **Scope freeze:** scope is frozen at the minimum ACs below. No reassignment flow, no in-app
> "who is conflicted" view, no admin toggle and no alerting configuration is added during apply.
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
> - **WHEN** a **returning** user's role claim is `["facilitator","engineering_manager"]` **THEN**
>   `users.global_role` is `'engineering_manager'`, exactly one conflict audit row is written in the
>   same transaction as the `auth.role_claim_mapped` row, the D3 outranked warning is **not**
>   emitted, and the user sees the conflict notice on the first non-session page after sign-in.
> - **WHEN** a **first-access** user's role claim is `["facilitator","engineering_manager"]`
>   **THEN** one `auth.first_access_created` row and one conflict row are written in the same
>   transaction (no `auth.role_claim_mapped` row, per #235 D5), and the conflict row's
>   `previousRole` is `null`.
> - **WHEN** the role claim is `["application_admin","facilitator","engineering_manager"]` **THEN**
>   `users.global_role` is `'application_admin'`, the D3 outranked warning **and** one conflict
>   row are both emitted, and the notice uses admin-specific copy.
> - **WHEN** the conflict-row insert fails **THEN** the sign-in fails and neither row persists.
>   This is #235's transactional-audit rule (`auth-error-handling`, `AuditWriteError`), not rejected
>   option (c), which is about the conflict itself.
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
>   counts (#235 Security S4 and Constraints). The post-commit structured log event carries exactly
>   the same field set as the audit-row metadata. One row per sign-in while the conflict persists.
>   Docs name the event as suitable for an operator alert; the app configures none (#235 Decision 9).
> - **User notice** (terms used by the ACs):
>   - *Live-session route:* the lobby, pre-session, active, reveal and wrap-up routes. This issue
>     lists their paths.
>   - *Sign-in:* a completed OIDC callback that runs account resolution. A mid-session re-auth
>     counts; the notice is deferred to the next non-session page.
>   - Placement: the first page rendered after sign-in that is **not** a live-session route. The
>     notice is dismissible and doesn't block navigation (no modal or overlay).
>   - Frequency: shown on every sign-in while the conflict persists; once dismissed, hidden until
>     the next sign-in.
>   - Never rendered on a live-session route, including the re-authentication return path.
>   - Copy rules:
>     - No "IdP", "OIDC" or "claim".
>     - Names Facilitator as the role not applied; states that Engineering Manager access to their
>       team(s) still works; states that they can't open or run new sessions; says how to clear it
>       (sign out and back in after the fix).
>     - Includes a sentence telling the user that if they have recently become a manager, this is
>       expected.
>     - Never blames the user.
>     - Contact text is deployment-configured display text, rendered verbatim as plain text (not
>       HTML), with a generic fallback when none is configured.
>   - Lists every session with `state = 'draft'` and `facilitator_id` = the user, with no cap,
>     showing team name and scheduled date (not created date), and asks them to arrange another
>     facilitator.
>   - Admin case: copy states that administrator access is unaffected and that the
>     Facilitator/Engineering Manager assignment still needs fixing.
>   - Copy review by the Facilitator role (Priya Nair) is a checkbox on this issue, with name and
>     date.
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
> 3. On a **returning** sign-in, one `auth.role_claim_mapped` row and one conflict row are written
>    in the same transaction. A failed conflict insert fails the sign-in and neither row persists.
>    No code path applies `engineering_manager` because of the pair without writing the conflict row.
> 4. Conflict-row metadata is limited to the fixed fields, and the structured-log field set equals
>    the metadata set. A test asserts that a non-allowlisted element (for example `superuser`) and
>    its count are absent from the audit row and the structured log.
> 5. With `application_admin` present, the D3 warn and the conflict row both fire. Without admin,
>    D3 does not fire for the pair.
> 6. On **first access** with a conflicting claim, one `auth.first_access_created` row and one
>    conflict row are written in the same transaction, and the conflict row's `previousRole` is
>    `null`.
> 7. The notice:
>    - renders on the landing page **and** on one other non-session route reached first after
>      sign-in;
>    - is dismissible and doesn't block navigation (no modal or overlay);
>    - does **not** render on any session route, including the re-auth return path (extend
>      `reauthRequiredHostParity`);
>    - reappears on the next conflicted sign-in after dismissal;
>    - is absent for a non-conflicted sign-in;
>    - uses admin-specific copy in the admin case;
>    - lists every stranded draft (team name, scheduled date);
>    - renders the generic contact fallback when no contact text is configured, and the configured
>      text verbatim as plain text when it is.
> 8. The room-open 403 response contains the conflict-specific message **only** when the user's
>    last sign-in recorded a conflict, and the generic 403 copy otherwise. The draft stays blocked.
> 9. #238 Appendix A.3 is applied. The #235 `first-access` and `auth-error-handling` specs and the
>    verbatim docs SHALL are amended consistently, and the docs checklist scenario passes against the
>    new warning text.
> 10. A session already past room-open continues under its facilitator after that facilitator's
>     role resolves to `engineering_manager`.
> 11. The simulator has a persona that sends both roles.
>
> ### PR review (not a pre-launch step; Facilitator review suggestion 11)
> - [ ] **Notice copy reviewed** by the Facilitator role (Priya Nair). Record name and date.
> - [ ] **Walk-through** by the Facilitator role, timeboxed to one session, using the both-roles
>   simulator persona with a pending draft: sign in, read the notice, try room-open, "fix" the
>   IdP, sign back in.
>
> ### Pre-launch steps (must be done before the first team goes live; #238 row 10)
> - [ ] **IdP attestation.** The IdP administrator confirms in writing (recorded on this issue,
>   with name and date) that, at the time of attestation,
>   no user is assigned both `engineering_manager` and `facilitator` in the IdP.
>   (#238 decision-log row 10.)
> - [ ] **One-time read-only draft check.** After this issue is deployed and after the IdP
>   attestation above, the deploying operator runs one read-only query: sessions in `draft` whose
>   `facilitator_id` belongs to a user who (a) has `global_role = 'engineering_manager'`, or
>   (b) has any `<conflict audit operation>` row, or (c) appears on the IdP administrator's list of
>   users who held both roles at any time since #235 was deployed. A human arranges for another
>   facilitator to recreate each hit (row 11; no reassignment). Sessions past room-open are out of
>   scope (row 11, #235 Decision 12). Record the operator, date, environment, query and result on
>   this issue. This is not shipped code. (#238 decision-log row 10.)
