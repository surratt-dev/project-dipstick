# Proposal: 238-facilitator-reporting-chain-decision (#238)

*Framed by Devon Calloway (Internal Champion). Builds on `exploration-notes.md` (revised after the
Facilitator and BA explore reviews) and the binding `decision-log.md`, rows 1–18. Nothing in the
decision log is reopened here. Revised after the propose reviews (`propose-review-ba.md`,
`propose-review-exec.md`); see "Review disposition" at the end of the main body. Appendices B and C
revised after the design reviews (`design-review-engineer.md`, `design-review-security.md`) and
decision-log rows 13–18; see `design.md`, "Design review disposition". Appendices A–C revised after
the implementation reviews (`implementation-review-architect.md`, `implementation-review-security.md`)
and decision-log row 21; see `design.md`, "Implementation review disposition".*

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
first team goes live. The user has now decided it (decision-log rows 1–4, 8–11, 13–18):

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
   - **Status and owners.** Decided 2026-10-04 by the user (product owner), decision-log rows 1–4,
     8–11 and 13–18. Follow-on owner: the Business Analyst. VP of Engineering acknowledgment: "Persona
     review (Executive Stakeholder) approved with conditions, see #241; human VP of Engineering
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
   - **Sessions** (rows 11, 14–18; `design.md` D5). Drafts owned by a now-conflicted user stay
     blocked at room-open; the notice names them. They can't be recreated in the app (the team's
     single open-session slot is held by the draft), so another facilitator **takes the draft
     over** (#240, separate issue, no launch gate). Until #240 ships, a stranded draft is cleared
     by a documented, audited operator step. Draft-based team-content access also requires a live
     `facilitator` role (row 18). Sessions already past room-open stay with their facilitator via
     `sessions.facilitator_id`, per #235 Decision 12, and the record lists what that covers
     (control, live events, per-voter attribution, action items and trends, 30 minutes after
     completion, no limit while non-terminal). These are stated decisions, not emergent
     properties, so later hardening does not "fix" them.
   - **Rejected options:** (a) a reporting-chain model (manager-of relationships beyond TEAM-006,
     or an org-chart sync), (b) keeping #235 precedence for the pair, (c) failing the sign-in,
     (d) audit and log only with no user notice.
   - **Residual gaps** 1–6 (manager sent only `facilitator`; skip-level managers and above; missing
     or stale EM memberships; informal authority; the BA-owned "peer is not in the reporting
     chain" interpretation; the interim window), with the deployment-docs warning confirmed as the
     standing control. Gaps 1 and 2 are **accepted risk** (decision-log row 13, the user): the
     docs warning is their only control, and the pre-launch IdP attestation covers the both-roles
     pair at launch, not gaps 1 or 2.
   - **Audit-write failure line:** a failed conflict-row insert fails the sign-in as any
     transactional audit-write failure does (#235 `auth-error-handling`). This is not rejected
     option (c), which is about the conflict itself.
   - **#238 AC disposition paragraph**, naming both AC (2) branches explicitly (exploration §5):
     no reporting-chain model is chosen, so the docs warning is the standing control for residual
     gaps 1–4; a narrow code rule is chosen, so #241 is filed. Then the dependency on #235, the first-team-launch gate
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
6. **Appendix C (below): draft body for the separate draft-takeover issue (#240)** (rows 14–17),
   filed by the orchestrator alongside #241. No launch gate.

## Constraints that must be preserved

- **The no-manager rule stays structural.** Nothing in the decision, the notice or the docs offers a
  setting, toggle or override. The only deployment-configured item the notice uses is the
  existing admin contact (`APPLICATION_ADMIN_CONTACT_EMAIL`), which is display text, not
  behaviour.
- **Facilitator from another team stays a hard block.** The conflict rule adds to the membership
  check and does not replace it.
- **The app never writes `global_role`.** The IdP stays the single writer (01b Decision). The
  conflict rule only changes how a claim is *read*.
- **Raw role-claim values never reach an audit row or a log line.** The conflict record carries
  allowlisted role names only, as a code constant. (`oidcSubject` and `oidcIssuer` stay, as in every auth row.)
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
- Draft reassignment in #241. Draft takeover is its own issue, #240 (rows 14–16).
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
  - File the follow-up issue #241 (Appendix B) and the draft-takeover issue #240 (Appendix C)
    (orchestrator).
  - Human VP of Engineering acknowledgment on the record's Status line (owner: the user, as product
    owner). The Executive Stakeholder persona review does not substitute for it.
  - GitHub comments on #235 and #238 pointing to the record.
  - Move #238 on the project board (decision-log row 7).

## Open items

1. **Human VP of Engineering acknowledgment** on the 01c Status line (owner: the user, as product owner).
   The Executive Stakeholder persona review approved with conditions; that is not the real VP's
   sign-off. #238 doesn't close without the human acknowledgment.
2. **`openspec validate --strict` not run.** The CLI isn't available in this environment, and the
   validator would likely flag a change with no deltas anyway (`design.md` D2). The artifacts
   follow the archived-change structure by hand; archive as documents-only.

*Closed since exploration:*
- Broader line-management attestation (former Open item 2): **no**, row 10 attestation only
  (row 13). Residual gaps 1–2 are accepted risk.
- Stranded-draft unblock path: draft takeover in #240, interim audited operator step (rows 14–17).
- Draft read grant after re-resolution: live-role check added to #241 (row 18).
- Live-session rule and draft handling (row 11; drafts amended by rows 14–17).
- Launch-checklist location (row 10).
- Launch gate (row 8).
- User notice (row 9).

## Review disposition

Propose-stage reviews: `propose-review-ba.md` (BA) and `propose-review-exec.md` (Executive
Stakeholder persona). BA R1–R4 trace to decision-log rows 10 and 11 or to #235's design; I checked
R4 against #235 `design.md` (`shouldRecordRoleClaimMapped` returns `false` for a new user) and it
holds.

Design-stage reviews (Engineer, Security) are dispositioned point by point in `design.md`,
"Design review disposition". The rows below that changed this proposal are summarised at the end
of the table.

| Point | Disposition | Rationale / where |
|---|---|---|
| BA R1: attestation must match row 10 ("no one holds both roles") | Accepted | It's what the user decided. Appendix B attestation reworded; "only control for gaps 1 and 2" removed; 01c gap 2's control is the docs warning only (What Changes item 1, task 1.6). The broader line-management version goes to the user as Open item 2, not into #241. |
| BA R2: interim check covers drafts only, and finds not-yet-re-signed-in users | Accepted | `active` contradicted row 11 / #235 Decision 12, and the `global_role` query missed exactly the first-session case. Replaced with the BA's (a)/(b)/(c) draft query, run after deploy and after the attestation. |
| BA R2 (last bullet): walk-through misattributed to row 10 | Accepted (via Exec rec. 2) | Walk-through moved out of the pre-launch section into a "PR review" section with its own source (Facilitator suggestion 11). |
| BA R3: define the terms the notice ACs depend on | Accepted | Every row of the BA's table is now a definition or AC in Appendix B (live-session route, sign-in, placement, copy rules, admin copy, draft list, non-blocking, contact fallback, copy-review checkbox). Route paths are left for #241 to list; I don't invent them here. |
| BA R4: first-access vs. returning sign-in | Accepted | Verified against #235 D5. Scenario 1 and AC 3 scoped to returning sign-ins; new first-access scenario; AC 6 asserts `previousRole: null`. |
| BA S1: say why a failed audit insert fails sign-in | Accepted | One line in Appendix B Scenario 3 and in the 01c plan. Stops the next reader confusing it with rejected option (c). |
| BA S2: AC for "never silent" | Accepted | Folded into AC 3 rather than a new AC, keeping the count at 11 (Exec condition 2). |
| BA S3: log field set equals metadata set | Accepted | Scope bullet and AC 4. Cites #235 S4/Constraints as the source. |
| BA S4: room-open 403 condition | Accepted | AC 8 reworded. |
| BA S5: AC-disposition names both branches | Accepted | 01c plan (What Changes item 1) uses the exploration §5 wording. |
| BA S6: trigger 2 owner and channel | Accepted (merged with Exec condition 3) | Recipients named by role: "the Business Analyst and the VP of Engineering". |
| BA S7: `grep -c "row 10"` ≥ 2 | Accepted | Added to task 3.2. |
| Exec: "Acknowledged … Rachel Okonkwo" for the 01c Status line | **Modified** | This is a persona review, not the real VP's sign-off. Status line reads "Persona review (Executive Stakeholder) approved with conditions; human VP of Engineering acknowledgment pending (owner: the user, as product owner)". Open item 1 and #238's open state are kept. |
| Exec condition 1: start #241 when #235 merges, parallel with #237; escalate slips | Accepted | "Schedule" line in Appendix B header. |
| Exec condition 2: freeze #241 at minimum ACs | Accepted | "Scope freeze" line in Appendix B header. BA additions went into existing ACs, not new ones. |
| Exec condition 3: trigger 2 recipients | Accepted | See BA S6. Roles, not persona names, in the requirements doc. |
| Exec rec. 1: three-sentence summary at top of 01c | Accepted | What Changes item 1 and task 1.1; design D1 section order. |
| Exec rec. 2: fold Priya walk-through into #241 PR review, timebox it | Accepted | Matches row 10, which names only two pre-launch items. Design D4 updated. |
| Exec rec. 3: accepts residual gaps with attestation + docs warning as standing control | Modified | Agreed on substance, but per BA R1 the attestation covers the pair at launch, not the residual gaps. The docs warning alone is their standing control. |
| *Design stage* — Eng F1 / Sec S1: "recreate" blocked by the unique index | Accepted; user decided rows 14–17 | Sessions bullet; Appendix B (copy, room-open, operator step, pre-launch); new Appendix C (#240). |
| *Design stage* — Sec S2: draft read grant | Accepted; user decided row 18 | Appendix B Scope and new AC 12. Exceeds the Exec scope freeze by one AC; the user's decision overrides it. |
| *Design stage* — Eng F2–F9, M1–M6; Sec S3–S6 | Accepted | Appendix A.3 and Appendix B text; folded into existing ACs. See `design.md` disposition. |
| *Design stage* — row 13: broader attestation | Closed (No) | Open item 2 removed; gaps 1–2 recorded as accepted risk. |
| *Design stage* — Facilitator Q3 (exploration §4): live-session rule | Confirmed by Security (Claim A), with S2 and S3 attached | Sessions bullet; `design.md` D5. |

---

## Appendix A — Paste-ready amendments to #235 (`facilitator-role-claim-allowlist`)

#235 is on branch `ccr-b594efa3-9zclgu` and isn't merged. **Who applies these:** whoever merges second.
If #238 merges second, its PR applies A.1 and A.2 to #235's files once they're on `main`. A.3 is
**not** applied by either PR; it belongs to the follow-up implementation issue (Appendix B, AC 9).
The follow-up issue is #241 (filed 2026-10-04).

### A.1 `openspec/changes/facilitator-role-claim-allowlist/proposal.md`, Follow-ups item 2

**Before:**

> 2. **#238: Reporting-chain enforcement (owner: BA, Marcus Delgado, with the VP of Engineering).** Decide whether "not in the team's reporting chain" (`Summary.md:12`) needs a model of its own (for example, manager-of relationships beyond TEAM-006 memberships), or whether "not a member" plus the deployment-docs warning is an acceptable standing approximation. Cite this proposal's Non-goals and Constraints. **Condition (VP of Engineering):** file it before the first team goes live, so the decision is on record. Like #237, this gates first-team launch, not this change.

**After:**

> 2. **#238: Reporting-chain enforcement (owner: BA, Marcus Delgado, with the VP of Engineering).** **Decided 2026-10-04 by the product owner** (human VP of Engineering acknowledgment pending; see the decision record's Status), see [`requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`](../../../requirements/use%20cases/01c%20-%20Facilitator%20Reporting%20Chain%20-%20Decision.md). No reporting-chain model is built. Instead, a user sent both `engineering_manager` and `facilitator` is signed in as `engineering_manager`, told, and audited (`application_admin` still wins and is still flagged). This supersedes Decision 7 **for that pair only**. Implementation is #241, blocked by this change, and like #237 it gates first-team launch. Until #241 ships, the manager warning in Constraints stands unchanged and, with the D3 log line, is the only control for the pair. The residual gaps the decision record lists (skip-level managers and managers sent only `facilitator`) keep the warning as their standing control.

And append to the "Input to Follow-up 2" paragraph:

> *Resolved by #238:* the reporting-chain decision answers S4 with a dedicated conflict audit row rather than `outrankedRoles` on `role_claim_mapped` (decision record, "How this shows up for people").

### A.2 `openspec/changes/facilitator-role-claim-allowlist/decision-log.md`, row 7

Append to the Decision cell of row 7:

> **Superseded for the `engineering_manager` + `facilitator` pair by #238 (2026-10-04):** that pair resolves to `engineering_manager`, and the conflict is surfaced and audited. Implementation is #241. Precedence is otherwise unchanged.

### A.3 Deployment-docs warning and the #235 text it is pinned to (applied by #241, not now)

The VP made the warning a character-for-character SHALL (#235 `first-access` spec, "Deployment
documentation describes the role claim"), quoting #235 `proposal.md` Constraints. So the docs and
the spec must change in the **same** PR that implements the rule. Changing the markdown alone fails
#235's checklist scenario.

**Single source (`design.md` D3).** By the time #241 lands, #235 is archived. #241 does **not**
edit the archived `proposal.md`. Its delta MODIFIES the requirement "Deployment documentation
describes the role claim" so the warning text below is inlined in the spec, and the scenario
compares `docs/deployment.md` to the spec.

**Before** (in `docs/deployment.md` and #235 `proposal.md` Constraints, identical):

> Do not assign `facilitator` to anyone who manages people. If a user is sent both `engineering_manager` and `facilitator`, the application treats them as **facilitator only**. From then on, the rule that managers never participate in a Health Check is enforced only by their team memberships being recorded with the `engineering_manager` role. Keep those memberships accurate, and give managers exactly one app role.

**After:**

> Do not assign `facilitator` to anyone who manages people. If a user is sent both `engineering_manager` and `facilitator`, the application signs them in as **engineering manager**, records `<conflict audit operation>` in the audit log and tells the user. Fix the assignment in your IdP. A manager who is sent only `facilitator`, or who manages a team from above without being recorded as its engineering manager, is not detected. For them, the rule that managers never participate in or facilitate a Health Check depends on this instruction and on their team memberships being recorded with the `engineering_manager` role. Keep those memberships accurate, and give managers exactly one app role.

Edits relative to *before*: the first sentence is kept verbatim. "facilitator only" becomes the
conflict behaviour. The "From then on…" sentence is removed for the pair and re-scoped to the
residual gaps. "Keep those memberships accurate" is kept, because residual gaps 1 and 3 depend on
it. `<conflict audit operation>` is the operation name chosen in #241.

In the **same** PR, also amend:
- The #235 `first-access` spec, "Deployment documentation describes the role claim": inline the
  warning (above), and add to its "exactly these items" list the conflict troubleshooting entry
  (including the operator draft-clearing step) and the mention that the conflict event is suitable
  for an operator alert. Without this, the new docs content breaks "exactly".
- The #235 `first-access` spec, "Deployment documentation describes the role claim", item 2 (the
  precedence order stated verbatim): add the same exception as the docs precedence bullet below,
  so the spec and the docs say the same thing.
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

> **Blocked by:** #235 **merged and archived**, so its precedence requirement exists in
> `openspec/specs/` and this issue's delta can MODIFY it (#238 design D2). This includes #235
> Decision 11 / D9 (`enableNonRepudiationChecks`, ID-token signature verification): the conflict
> row is only evidence if the claim is verified, so this issue must not ship ahead of D9 if #235 is
> ever split.
> **Gates:** first-team launch, like #237. No team goes live until this issue is closed (#238
> decision-log row 8).
> **Related:** #240 (draft takeover, no launch gate) is the in-app unblock path for drafts this
> rule strands (#238 rows 14–17). Until #240 ships, this issue's documented operator step is the
> unblock path.
> **Decision record:** `requirements/use cases/01c - Facilitator Reporting Chain - Decision.md` (#238).
> #238's proposal (Appendix A.3, cited below) is archived at
> `openspec/changes/archive/2026-10-04-238-facilitator-reporting-chain-decision/proposal.md`.
> **Public repository.** Everything recorded on this issue is world-readable. Record here only
> GitHub handles, dates, environment *labels* (for example `production`), hit counts and actions
> keyed by session id. Names, emails, the IdP administrator's list of users, attestations and
> query output go in an internal ticket; this issue carries only the ticket reference.
> **Track:** full. Role resolution is an authorization boundary and touches the no-manager rule.
> **Schedule:** start the day #235 is archived, in parallel with #237, so this adds no serial time
> to first-team launch. If it threatens the launch date, raise it with the VP of Engineering before
> anyone trims ACs or proposes waiving the gate. The gate stays (#238 row 8).
> **Scope freeze:** scope is frozen at the minimum ACs below. No reassignment or takeover flow (that
> is #240), no in-app "who is conflicted" view, no admin toggle and no alerting configuration is
> added during apply. AC 12 was added after the freeze by the user's decision (#238 row 18), which
> overrides the freeze for that AC only.
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
> array claim can produce a conflict. #235 D3's `outrankedRoles` is computed from the
> **pre-discard** allowlisted set, so the log still shows that `facilitator` was sent.
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
>   `users.global_role` is `'application_admin'`, the D3 outranked warning (with `outrankedRoles`
>   `["facilitator","engineering_manager"]`) **and** one conflict row are both emitted, and the
>   notice uses admin-specific copy.
> - **WHEN** the conflict-row insert fails **THEN** the sign-in fails and neither row persists.
>   This is #235's transactional-audit rule (`auth-error-handling`, `AuditWriteError`), not rejected
>   option (c), which is about the conflict itself.
> - **WHEN** the role claim is the string `"engineering_manager facilitator"` **THEN** no conflict
>   is recorded.
> - **WHEN** a draft's `facilitator_id` user no longer has live `global_role = 'facilitator'`
>   **THEN** the draft grants them no team-content access (#238 row 18).
>
> ### Scope
> - **Resolver.** `mapRoleClaimToGlobalRole` returns `{ role, roleConflict }`; `ResolvedUser`
>   gains `roleConflict: boolean`.
> - **Audit row.** A new conflict audit operation (name is this issue's call, e.g.
>   `auth.role_claim_conflict`). The INSERT goes in `writeAccountResolutionAuditRow`
>   (`auth/account-resolution-audit.ts`, #235 D5), after the `first_access_created` or
>   `role_claim_mapped` INSERT, inside the same `withAuditTransaction` as the role UPSERT. Columns:
>   `actor_user_id` = the signing-in user, `actor_global_role` = applied role, `team_id` NULL,
>   `target_user_id` NULL. Metadata is limited to `{ oidcSubject, oidcIssuer, appliedRole,
>   conflictingRoles, previousRole, correlationId }`.
>   `conflictingRoles` is the code constant `["engineering_manager","facilitator"]`, never built
>   from the claim array. **No raw role-claim values**, no non-allowlisted elements or their counts
>   (#235 Security S4 and Constraints); `oidcSubject` and `oidcIssuer` stay, as in every auth row
>   (a subject is unique only within its issuer). The post-commit
>   `emitAuditEvent` stays in `routes/auth.ts` and carries exactly the same field set. One row per
>   sign-in while the conflict persists. Register the operation in `AuditEventName`
>   (`audit-logger.ts`) with a comment block in the house style, and add it to the transactional
>   `auth.*` list in the `docs/deployment.md` Logging section. Docs name the event as suitable for
>   an operator alert; the app configures none (#235 Decision 9).
> - **Notice state (server-side).** At callback, after `regenerate()`, set
>   `roleConflict: { applied: "engineering_manager" | "application_admin" }` on the Redis session
>   blob (`SessionData`). This is a sign-in event fact that grants nothing, so it doesn't break the
>   `AuthSession` rule against caching authorization signals in the blob; say so in a code comment.
>   The flag is never taken from the client (no query parameter, no local storage).
>   - `GET /auth/role-conflict-notice` returns `null` or `{ adminCase, strandedDrafts: [{ sessionId,
>     teamName, createdAt }], contactEmail | null }`, typed in `packages/shared`. It is separate from
>     `/auth/session`; if it fails, the notice is skipped and the failure logged, nothing else.
>   - `POST /auth/role-conflict-notice/dismiss` clears the field (server-side, so another tab
>     doesn't show it again). It sits behind the same CSRF and same-origin protections as the
>     other state-changing `/auth/*` routes.
> - **User notice** (terms used by the ACs):
>   - *Live-session route:* any path matching `/session/*` or `/team/:teamId/session/*` (the
>     draft host included). Implemented as one exported `isLiveSessionPath(pathname)`. It must
>     **not** match `/sessions/new` (`App.tsx`), which shares a prefix with `/session/*`; a naive
>     `startsWith("/session")` gets this wrong.
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
>     - Contact: the existing `APPLICATION_ADMIN_CONTACT_EMAIL` (`applicationAdminContactEmail`),
>       rendered as a plain-text React node, with a generic fallback when unset. No new setting. If
>       the copy review needs free text, add one optional, length-capped env var rendered the same
>       way, and record that on this issue.
>   - Lists every session with `status = 'draft'` and `facilitator_id` = the user, with no cap,
>     showing team name and created date (labelled "created"). Asks them to contact the
>     administrator so another facilitator can run it. The copy doesn't promise a mechanism
>     (takeover via #240, or the operator step until then).
>   - Admin case: copy states that administrator access is unaffected and that the
>     Facilitator/Engineering Manager assignment still needs fixing.
>   - Copy review by a human facilitator (not the implementer) is a checkbox on this issue,
>     recorded with their GitHub handle and date. A persona review does not satisfy it (#238 row 21).
> - **Room-open:** the existing live-`global_role` check before draft → lobby stays, and it alone
>   decides the 403. When `session.roleConflict` is set on the current app session, the 403 gets
>   conflict-specific copy (for example, "You can't open this session because your account is now
>   set up as an Engineering Manager. Another facilitator will need to run it."). The copy branches
>   on `roleConflict.applied`, as the notice does: when it is `application_admin`, the copy says
>   administrator access is unaffected and does not say the user is now an Engineering Manager.
>   The copy is chosen from the session blob, never from `audit_log`. Two browsers with different sign-ins may
>   show different copy; that is accepted. Optionally add `roleConflict: true` to the
>   `session.advance_denied_role` metadata so a refused room-open joins to its cause.
> - **Stranded drafts — interim operator step** (#238 row 17, until #240 ships). Documented in the
>   `docs/deployment.md` troubleshooting entry and used by the pre-launch draft check. In one
>   transaction:
>   - `UPDATE sessions SET status = 'abandoned', abandoned_at = now() WHERE id = $1 AND status =
>     'draft' RETURNING team_id, facilitator_id` (roll back unless exactly one row);
>   - one `audit_log` row: operation e.g. `session.draft_abandoned_by_operator` (registered in
>     `AuditEventName`), `actor_user_id` = the operator's own `users.id`, `actor_global_role` =
>     `(SELECT global_role FROM users WHERE id = $operator)` read inside the transaction (roll back
>     if no row: this also validates the operator id; the role is never hand-typed), `team_id` and
>     `target_user_id` from the RETURNING row, metadata
>     `{ sessionId, reason: "role_conflict" | "role_revoked", ticket }`. `ticket` is an internal
>     ticket reference only, never free text or personal data. No raw role-claim values.
>
>   Then another facilitator creates a new draft. Record each use on the relevant issue using only
>   the public-record fields in the header (handle, date, environment label, session id, action)
>   plus the internal ticket reference.
> - **Draft read access (#238 row 18).** `evaluateTeamAccess` Path 3(b)
>   (`team-content-access-helper.ts`) also requires live `global_role = 'facilitator'`. Gate the
>   draft clause on the `global_role` the helper already reads on its consistent snapshot, or put
>   the role predicate in the Path 3 SQL; don't add a third read, so the helper's no-TOCTOU comment
>   stays true. Paths for sessions past room-open are unchanged.
> - **Sessions already past room-open** stay with their facilitator via `sessions.facilitator_id`
>   (#235 Decision 12, #238 row 11). The conflict rule never interrupts them. Add a test so a later
>   hardening change can't "fix" it.
> - Session-creation entry points stay hidden for a resolved EM, as for any EM.
> - **Specs and docs:** apply #238 proposal Appendix A.3 (archived path above; warning inlined in the #235
>   `first-access` spec; its "exactly these items" list amended). This covers the #235
>   `first-access` precedence requirement, `auth-error-handling`, the verbatim docs warning, the
>   precedence bullet, and the docs troubleshooting entry:
>   - the event name;
>   - "one row per sign-in, so count distinct users, not rows";
>   - how to confirm a fix (the next sign-in shows `role_claim_mapped` with no conflict row);
>   - the "remove Facilitator from people who manage people" rule;
>   - the interim operator step above;
>   - a read-only query for non-terminal sessions whose `facilitator_id` has a conflict row.
> - **Local dev:** a simulator persona that sends both roles (`docker/oidc/accounts.js`,
>   `DEV_LOGIN_OPTIONS`). Update persona-count assertions (for example `interactions.test.js`).
> - **Rollback:** rolling back this issue returns the pair to `facilitator` at the next sign-in.
>   Conflict rows stay in `audit_log`, and the room-open copy reverts to the generic message.
>
> ### Minimum acceptance criteria
> 1. Every row of the rule table is a passing resolver test.
> 2. Duplicate elements produce one conflict. A string claim never produces a conflict.
> 3. On a **returning** sign-in, one `auth.role_claim_mapped` row and one conflict row are written
>    in the same transaction, via `writeAccountResolutionAuditRow` in the real-Postgres integration
>    test. A failed conflict insert fails the sign-in and neither row persists. No code path applies
>    `engineering_manager` because of the pair without writing the conflict row.
> 4. Conflict-row metadata is exactly `{ oidcSubject, oidcIssuer, appliedRole, conflictingRoles,
>    previousRole, correlationId }`, `actor_user_id` is the signing-in user, `conflictingRoles`
>    equals the constant,
>    and the structured-log field set equals the metadata set. A test asserts that a
>    non-allowlisted element (`superuser`) and its count, the case variant `Facilitator`, and the
>    string-claim form are absent from the audit row and the structured log.
> 5. With `application_admin` present, the D3 warn (`outrankedRoles` exactly
>    `["facilitator","engineering_manager"]`) and the conflict row both fire. Without admin, D3
>    does not fire for the pair.
> 6. On **first access** with a conflicting claim, one `auth.first_access_created` row and one
>    conflict row are written in the same transaction, and the conflict row's `previousRole` is
>    `null`.
> 7. The notice:
>    - renders on the landing page **and** on one other non-session route reached first after
>      sign-in;
>    - is dismissible and doesn't block navigation (no modal or overlay);
>    - does **not** render on any live-session route: `isLiveSessionPath` is unit-tested against
>      every `App.tsx` route (including `/sessions/new` → `false`), and a dedicated test mounts the app shell at a `returnTo` live path,
>      asserts the notice is absent, then navigates to `/` and asserts it renders;
>    - after dismissal, stays hidden in another tab and reappears on the next conflicted sign-in;
>    - is absent for a non-conflicted sign-in;
>    - uses admin-specific copy in the admin case;
>    - lists every stranded draft (team name, created date);
>    - renders the generic contact fallback when no contact is configured, and the configured
>      contact verbatim as plain text when it is;
>    - is skipped, without affecting `/auth/session`, when the notice endpoint fails.
> 8. The room-open 403 response contains the conflict-specific message **only** when the current
>    app session's sign-in recorded a conflict, and the generic 403 copy otherwise. The conflict copy
>    branches on `applied`: with `application_admin` applied it does not say the user is now an
>    Engineering Manager. The draft stays
>    blocked. An integration test runs the documented operator step verbatim: the draft becomes
>    `abandoned` with one audit row, and another facilitator's `POST …/sessions/draft` for that
>    team then succeeds.
> 9. #238 Appendix A.3 (archived path in the header) is applied. The #235 `first-access` and `auth-error-handling` specs and the
>    verbatim docs SHALL are amended consistently, and the docs checklist scenario passes against the
>    new warning text.
> 10. A session already past room-open continues under its facilitator after that facilitator's
>     role resolves to `engineering_manager`.
> 11. The simulator has a persona that sends both roles.
> 12. A draft's creator whose live `global_role` is no longer `facilitator` gets no draft-based
>     team-content access (action items, trends); a draft creator who is still a facilitator
>     keeps it. Sessions past room-open are unaffected. (#238 row 18; added after the scope freeze
>     by the user's decision.)
>
> ### PR review (not a pre-launch step; Facilitator review suggestion 11)
> - [ ] **Notice copy reviewed** by a human facilitator (not the implementer). Record their GitHub
>   handle and date. A persona review does not satisfy this (#238 row 21).
> - [ ] **Walk-through** by a human facilitator (not the implementer), timeboxed to one session, using the both-roles
>   simulator persona with a pending draft: sign in, read the notice, try room-open, "fix" the
>   IdP, sign back in.
>
> ### Pre-launch steps (must be done before the first team goes live; #238 row 10)
> - [ ] **IdP attestation.** The IdP administrator confirms in writing (kept in the internal
>   ticket; this issue records only that it was received, the date and the ticket reference) that,
>   at the time of attestation,
>   no user is assigned both `engineering_manager` and `facilitator` in the IdP.
>   (#238 decision-log row 10. Row 13: no broader line-management attestation.)
> - [ ] **One-time draft check: a read-only query, then one audited write per hit.** After this
>   issue is deployed and after the IdP attestation above, the deploying operator runs one
>   read-only query: sessions with `status = 'draft'` whose `facilitator_id` belongs to a user who
>   (a) has `global_role = 'engineering_manager'`, or (b) has any `<conflict audit operation>` row,
>   or (c) appears on the IdP administrator's list of users who held both roles at any time since
>   #235 was deployed. Clause (a) also catches facilitators legitimately promoted to manager; those
>   are real hits, not false positives (row 11 treats them the same). For each hit: if #240 has
>   shipped, another facilitator takes the draft over in the app; otherwise the operator runs the
>   documented operator step (Scope). Sessions past room-open are out of scope (row 11, #235
>   Decision 12). On this issue, record only: the operator's GitHub handle, the date, the
>   environment label (never a hostname or connection string), the hit count, the action per hit
>   keyed by session id, and the internal ticket reference. The users behind each hit, the IdP
>   administrator's list and the query output go in the internal ticket, never on this issue. This
>   is not shipped code. (#238 decision-log rows 10 and 17.)

---

## Appendix C — Draft body for the draft-takeover issue (#240)

*Filed by the orchestrator alongside #241 (#238 decision-log rows 14–17). Suggested title:*
**Let a facilitator take over another facilitator's draft session**

> **Decided by:** #238 decision-log rows 14–17 (the user). Context:
> `requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`, "Sessions".
> **Gates:** none. This issue does not gate first-team launch (row 17). Until it ships, #241's
> pre-launch draft check covers drafts that exist at launch, and a draft stranded after launch is
> cleared by #241's documented, audited operator step.
> **Related:** #241 (conflict rule) references this issue as the unblock path for stranded drafts.
> **Blocked by:** nothing in #238. It touches the same routes as #241; coordinate merge order.
> **Track:** for the pipeline to classify. It changes who may advance a session, which is an
> authorization boundary.
> **Public repository.** Record nothing on this issue beyond GitHub handles, dates, environment
> labels and session ids; names and query output go in an internal ticket.
>
> ### Why
> A draft session holds its team's single open-session slot (`sessions_team_active_unique`
> includes `draft`), only its creator can advance it, and nothing in the app abandons it (the
> 24-hour expiry is read-time only). If the creator can't or won't open the room (for example,
> #238's conflict rule now resolves them to `engineering_manager`, or a #235 Decision 12
> revocation), the team is wedged until someone edits the database. Another facilitator
> creating a new draft gets `409 session_already_exists`.
>
> ### Decided (do not reopen)
> - **Any draft** can be taken over, not only stranded ones (row 15).
> - **Who:** another facilitator who passes the usual checks: live `users.global_role =
>   'facilitator'` and no active membership on the draft's team (FR-2.2). The draft's own
>   facilitator can't take it over (row 14).
> - **Confirmation prompt** before the takeover is performed (row 14).
> - **Audit event** for every takeover (row 14), with no raw role-claim values.
> - **No reassignment** by the owner or an admin: the taker initiates (row 11 and row 14).
> - **No launch gate** (row 17).
>
> ### Behaviour (proposed; confirm in this issue's design review)
> - Takeover updates `facilitator_id` on the **existing** draft row, in one transaction with its
>   audit row (fail closed: a failed audit insert means no takeover). The session id, team and
>   topics are unchanged.
> - **Atomic compare-and-set (Security M2).** The update is
>   `UPDATE sessions SET facilitator_id = $taker WHERE id = $1 AND status = 'draft' AND
>   facilitator_id = $expectedPreviousOwner`. The expected previous owner is the one the
>   confirmation prompt showed, and the client sends it back with the confirmed request. The
>   taker's live `global_role = 'facilitator'` and no-active-membership checks run inside the same
>   transaction. Zero rows updated means `409` and no takeover audit row. This closes two races:
>   the owner opening the room during the takeover (the owner's room-open UPDATE is already guarded
>   on `facilitator_id` and `status = 'draft'`, so exactly one of the two wins), and a stale
>   confirmation displacing a different owner than the one shown.
> - **Room-open message.** The current creator-only 403 ("Only the facilitator who created the
>   draft may advance it.") is no longer accurate after a takeover; reword it to refer to the
>   draft's current facilitator.
> - **Unique index:** unaffected. The row keeps `status = 'draft'` and stays the team's one
>   non-terminal session, so no abandon step and no new row are needed.
> - **Previous owner:** is no longer the `facilitator_id`, so they can no longer advance the draft
>   and lose draft-based team-content access (Path 3(b)). Their #241 conflict notice no longer
>   lists it.
> - **New owner:** can advance it subject to the existing room-open checks, including the live-role
>   check.
> - **Audit content:** one row, operation e.g. `session.draft_taken_over`; `actor_user_id` = taker,
>   `actor_global_role` = `facilitator`, `team_id` = draft's team, `target_user_id` = previous
>   facilitator; metadata `{ sessionId, previousFacilitatorId, correlationId }`. The structured log
>   carries the same field set. Register it in `AuditEventName` and the docs Logging list.
>
> ### Open questions (for this issue's design review; not decided by #238)
> 1. **Notify the previous owner?** Row 15 lets a peer take over a colleague's active draft, not
>    only a stranded one, so this matters more than it would for stranded drafts alone. Options:
>    no notice, an in-app notice at their next sign-in, or out-of-band. *Recommended (#238
>    Security implementation review):* at minimum an in-app notice to the previous owner, since the
>    confirmation prompt guards against mistakes, not malice, and the audit row is detective only.
> 2. **Entry point.** Where the offer appears: on the `409 session_already_exists` response when
>    creating a draft (the natural point of discovery), a team page, or both. If the 409 is
>    enriched with the draft's owner or session id, enrich it only after the caller passes the same
>    checks as takeover, so the 409 is not an oracle for who is preparing which team.
> 3. **Confirmation copy.** Does the prompt name the current owner? What does it say about their
>    preparation being handed over?
> 4. **24-hour draft window.** Draft access expires 24 hours after `created_at`. Does takeover reset
>    the window for the taker, or does the taker inherit what remains? Either way `created_at` is
>    never rewritten; a reset uses a separate column so the audit trail keeps the true creation
>    time. An expired draft can still be taken over (row 15: any draft) and advanced, but the taker would have no pre-room team-content access.
> 5. **Interim operator step after this ships.** Retire #241's operator step from the docs, or keep
>    it as a fallback (for example when no other facilitator is available)?
> 6. **Denied-attempt auditing.** Audit refused takeovers (wrong role, team member), as
>    `session.advance_denied_role` does for room-open, or log only? *Recommended (#238 Security
>    implementation review):* audit them, since takeover is an authorization boundary that can be
>    probed.
>
> ### Acceptance criteria
> ACs marked *(proposed)* encode the proposed Behaviour above; confirm or amend them in this
> issue's design review. The others follow from the decided points.
> 1. *(proposed)* A facilitator with live `global_role = 'facilitator'` and no active membership
>    on the team can take over a draft whose `facilitator_id` is another user. Afterwards `facilitator_id` is
>    the taker, no new session row exists, and no 409 occurs.
> 2. Takeover is refused, with no change and no takeover audit row, when the caller's live role is
>    not `facilitator` (including a user #241 resolves to `engineering_manager`), when the caller
>    has an active membership on the team, when the caller already owns the draft, when the
>    session is not `draft`, or *(proposed)* when the draft's current `facilitator_id` is not the
>    previous owner the confirmation showed (`409`).
> 3. The UI requires an explicit confirmation before calling the takeover endpoint. The server
>    never takes over implicitly (for example, as a side effect of creating a draft).
> 4. Exactly one audit row is written in the same transaction as the update; if the insert fails,
>    the takeover doesn't happen. Metadata is the fixed field set, contains no raw role-claim
>    values, and the structured log carries the same field set.
> 5. *(proposed)* After a takeover, the previous owner can't advance the draft and has no draft-based
>    team-content access; the taker can advance it subject to the existing room-open checks.
> 6. *(proposed)* Two concurrent takeovers of the same draft, both confirmed against the same
>    previous owner: the compare-and-set lets exactly one succeed, the other gets `409`, and one
>    takeover audit row is written.
> 7. *(proposed)* A takeover racing the owner's room-open leaves the session with exactly one
>    facilitator. If room-open won, the takeover is refused (`409`) and the session stays with the
>    owner; if the takeover won, the owner's room-open is refused and the draft stays `draft` under
>    the taker. The taker's role and membership checks run in the takeover's transaction.
> 8. `docs/deployment.md` describes takeover, and the troubleshooting entry for stranded drafts is
>    updated per open question 5.
