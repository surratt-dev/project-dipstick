# Exploration Notes — #238 facilitator-reporting-chain-decision

**Explorer:** Devon Calloway (Internal Champion)
**Date:** 2026-10-04 (revised the same day after the Facilitator and BA explore reviews)
**Mode:** non-interactive. Open questions are written down here, not asked.
**Binding inputs:** `decision-log.md` rows 1–4 and 8–9:
- Rows 1–4: an EM+facilitator conflict rule instead of a reporting-chain model. Sign in as `engineering_manager` and flag it. Admin still wins but is still flagged. Decision record only for now, with implementation after #235.
- Row 8: the follow-up implementation issue **inherits the first-team-launch gate**.
- Row 9: the user **is told**, through a post-sign-in conflict notice, and the conflict is also audited. "Audit and log only" is out.

These notes do not reopen any of those rows. They work out what the rows mean and what the decision record has to say.

**Sources read:**
- `requirements/Summary.md:12`
- BRD §6.2 (no EM participation), §6.3 (facilitator from another team), FR-2.1, FR-2.2
- `requirements/use cases/01b - Designate a Facilitator - Deferral.md` (the precedent)
- `02 - Session Setup - Use Cases.md:20-25, 325-368`
- Backend `routes/facilitator-sessions.ts:316-363, 846-887, 1290-1300`, `auth/standing-facilitator-access-helper.ts:104-116`, `auth/team-content-access-helper.ts:25-45, 140-180`, `routes/sessions.ts:140-160`, `routes/auth.ts:290-395`
- From the #235 branch extract (read-only, scratchpad): `decision-log.md` (rows 6, 7, 9, 12, 13, 16), `proposal.md` (Non-goals, Follow-ups 2 and S4 note), `design.md` (D1–D3, Risks, Sec S4 disposition), `exploration-notes.md` (Findings 2 and 3), `docs/deployment.md:189-202`
- Reviews: `explore-review-facilitator.md` (Priya Nair), `explore-review-ba.md` (Marcus Delgado). See the **Review disposition** table at the end.

**Glossary line for the record (BA R3):** in this decision, "error" means *the conflict is never silent*. It does **not** mean a failed sign-in. The user signs in as Engineering Manager, is told why, and the conflict is audited.

---

## 1. What we are actually deciding

`Summary.md:12` says the facilitator is "a senior engineer from *another* team … not in the team's reporting chain." Today the app checks for the first half only: no active `team_memberships` row on the target team (`facilitator-sessions.ts:341`, `standing-facilitator-access-helper.ts:112`). Reporting lines are not modelled, and the user has decided not to model them.

What the user chose instead is a **proxy**. It catches **the only reporting-chain violation the application can detect from data it already receives**, and resolves it toward the role the ritual can live with. (I've dropped my earlier "most often" claim, BA V1. We have no frequency data.)

```
  "not in the team's reporting chain"  (Summary.md:12, the intent)
          │
          ├─ "not a member of the team"             ← enforced today (hard block)
          ├─ "a manager is never a facilitator"     ← #238: enforced only when the IdP
          │                                            sends BOTH roles (conflict rule)
          └─ "not above the team in the org chart"  ← NOT modelled (residual gap, §6);
                                                       docs warning is the standing control
```

As the person who wrote the original proposal: the reporting-chain phrase exists to keep **people with authority over the participants** out of the facilitator's chair, in the same way the no-manager rule keeps them out of the votes. The cases that matter most are a manager, or a manager's manager, who runs the session. The conflict rule catches one configuration of the first case. It does not catch the second (§6).

**How people will actually get here (Facilitator O2).** One plausible path is a promotion, not a random misconfiguration. A senior engineer who has been facilitating for other teams becomes an EM, gets added to the EM group, and nobody removes them from the facilitator group. They may be mid-rotation with drafts already set up. This doesn't change the rule, but it shapes the copy ("if you've recently become a manager, this is expected"), the docs, and the drafts handling in §4. I'm naming it as *a* path to design for, not making a frequency claim (see V1).

There is no legitimate "manager who also facilitates" profile in the ritual. The facilitator is a *senior engineer*. Resolving the conflict to EM therefore costs the ritual nothing. The person loses an ability they should not have had.

## 2. Why `engineering_manager` is the right resolution (grounded in code)

Here is what happens to a user sent `["engineering_manager","facilitator"]` under each rule:

| Concern | #235 precedence (→ `facilitator`) | #238 rule (→ `engineering_manager` + flag) |
|---|---|---|
| Their legitimate EM access (`team-content-access-helper.ts:169`, dual check) | **Broken.** `global_role ≠ EM` drops to the `team.access_grant_mismatch` path and degrades to participant-level access, which logs a mismatch event on every content request | Intact. The dual check passes |
| Can create sessions (FR-2.1, `facilitator-sessions.ts:318`) | **Yes**, for any team they have no membership on: skip-level teams, sibling teams, a team their EM membership was never recorded on | **No**, anywhere. `global_role !== 'facilitator'` → 403 |
| Standing-facilitator topic access (`standing-facilitator-access-helper.ts:108`) | Yes, for non-member teams | No |
| No-manager participation block (`sessions.ts:150`) | Held by **one** check, `membership_role !== 'engineering_manager'`. Fails if the EM membership is missing or stale | Held by **both** checks: `global_role` and `membership_role` |
| Roster exclusion (`facilitator-sessions.ts:1298-1299`) | Only `tm.role` excludes them | Both `u.global_role` and `tm.role` exclude them |
| Failure direction | Toward privilege (can run sessions) | Toward restriction (cannot run sessions) |

Two things in that table go beyond the user's stated rationale. The record should **lead with the first** (BA D):

- **#235 precedence breaks the manager's real job.** A manager resolved to `facilitator` loses EM content access on their own teams through the dual-check mismatch path. So the #238 rule is the *correct* resolution, not only the safer one.
- **Defence in depth for the no-manager rule.** Under #235 precedence, the rule rests on `team_memberships` alone, the "keep memberships accurate" dependency the docs warning admits to. Resolving to EM puts the `global_role` signal back.

## 3. The resolved-role rule, stated precisely

This is the normative core of both the record and the implementation spec (BA R2):

> Among the allowlisted values in the claim: **if both `engineering_manager` and `facilitator` are present, discard `facilitator`**, then apply #235 precedence (`application_admin` > `facilitator` > `engineering_manager` > `senior_engineer` > `engineer`) to what remains. Whenever both were present, record a role conflict, whatever role was finally applied.

| Allowlisted claim elements (order irrelevant) | Applied role | Conflict flagged? |
|---|---|---|
| `engineering_manager` only | `engineering_manager` | no (baseline) |
| `facilitator`, `engineering_manager` | `engineering_manager` | yes |
| `facilitator`, `engineering_manager`, `senior_engineer` | `engineering_manager` | yes |
| `facilitator`, `facilitator`, `engineering_manager` | `engineering_manager` | yes, **one** conflict |
| `application_admin`, `facilitator`, `engineering_manager` | `application_admin` | yes (row 4) |
| `application_admin`, `engineering_manager` | `application_admin` | no (#235 D3 log line only) |
| `application_admin`, `facilitator` | `application_admin` | no |
| `facilitator` only | `facilitator` | no. **Residual gap**, §6 |
| `facilitator`, `superuser` (non-allowlisted) | `facilitator` | no. Allowlist warning only |
| `Facilitator`, `engineering_manager` (case mismatch) | `engineering_manager` | **no**. Allowlist warning for `Facilitator` only. Do not case-fold to find conflicts (BA V4) |
| string `"engineering_manager facilitator"` | `engineer` (one non-allowlisted value, #235) | no |

Notes:
- Only an **array** claim can produce the conflict. A single string cannot carry both values (#235: no comma or space splitting).
- Detection happens **after** allowlist filtering and must ignore duplicates.
- Interaction with #235 D3 (the outranked-EM log line): for the plain pair, EM is applied, so EM is not outranked and D3 does not fire. Only the conflict fires. With admin present, EM *is* outranked, so both the D3 warn and the conflict record fire. Test this explicitly, because #235 D2/D3 cap warnings per sign-in and the conflict adds a third signal.
- First access is covered too. A brand-new user whose first claim conflicts gets `auth.first_access_created` *and* the conflict record.

## 4. What "flag" means, and to whom

Row 9 settles it: **both** a user-facing notice **and** an audit record are required scope. Neither is optional polish. The record states them as two separate obligations: "surfaced" means the user is told, and "audited" means administrators can find it (BA C2).

*(Removed from the earlier draft: my personal "hard block preferred, never silent" line about the facilitator-from-another-team constraint in general. It's my principle, not a requirement of this decision, and it shouldn't be cited from the record later. BA V9.)*

How it shows up for people. This becomes a section of the record (Facilitator suggestion 1):

| Audience | What they see |
|---|---|
| The conflicted person | One plain, non-blocking notice outside sessions (below) and, if they try, a conflict-specific room-open refusal |
| IdP / access admin and Security | An audit row and a structured log event, plus a troubleshooting entry in `docs/deployment.md` |
| Everyone else, including the team, participants and other facilitators | Nothing, ever |

### 4.1 Audit (row 3, "audited")

- A **separate operation**, e.g. `auth.role_claim_conflict` (the name is the implementation issue's call). Its metadata is limited to **allowlisted role names and identifiers we already audit**: `{ oidcSubject, appliedRole, conflictingRoles: ["engineering_manager","facilitator"], previousRole, correlationId }`. `conflictingRoles` is a fixed pair drawn from the allowlist. **It never contains raw claim values**: no non-allowlisted elements, no counts of them, no claim name beyond what is configuration.
- Write it **in the same `withAuditTransaction`** as the role UPSERT (`auth.ts:310`). Acceptance condition (BA V3): *a sign-in with claim `["engineering_manager","facilitator"]` writes exactly one `role_claim_mapped` row (globalRole `engineering_manager`) and exactly one conflict row, both in the same transaction. If the conflict-row insert fails, the sign-in fails and neither row persists.*
- Fire it **on every sign-in while the conflict persists**: **one row per sign-in**. The condition is a standing misconfiguration, not an event. (Corrected per BA V3: the 90-minute absolute lifetime bounds how often a user must sign in, not the row count.) The existing `role_claim_mapped`-on-every-sign-in pattern for EM and admin is precedent.
- **Security S4 is answered by the dedicated conflict row.** `outrankedRoles` is still *not* added to `role_claim_mapped`. One purpose-built row is clearer to an incident reviewer than a general field.

### 4.2 Structured log and alerting (closed, BA C7)

Emit after commit, mirroring `emitAuditEvent` usage (`auth.ts:367-395`). Same stance as #235 Decision 9: the docs **name the event and say it is suitable for an operator alert**. The app does not configure an alert. This is settled here and doesn't need the user.

### 4.3 The user notice (row 9: required)

The record says only that the user is told, outside any session. The surface rules below are **requirements** for the implementation issue. The exact copy is for the implementation issue, with Priya's review, and does not go in the record.

- **Where:** on the first non-session page after sign-in (landing or dashboard). Never a modal. Never global chrome that follows route changes.
- **Never during the ritual (Facilitator O5, suggestion 3; this is a MUST, not a preference):** the notice MUST NOT render on any live-session route (lobby, pre-session, active, reveal, wrap-up). That includes the return path after a mid-session re-authentication (`ReauthRequiredTreatment`). It is deferred to the next non-session page.
- **How often:** shown on **every sign-in while the conflict persists**. Dismissible, and once dismissed it stays hidden until the next sign-in (Facilitator Q5 and BA V2 reconciled). A sign-in without a conflict shows no notice.
- **Copy rules (Facilitator O6):**
  - No "IdP", "OIDC" or "claim".
  - Say **which** role goes: if you manage people, Facilitator is removed; if you don't, Engineering Manager was assigned by mistake. The ritual has already made that choice, so the copy shouldn't hand it back to the user.
  - Say what still works (their usual EM access).
  - Say how to clear it: sign out and back in after the fix.
  - Mention the promotion case ("if you've recently become a manager, this is expected").
  - Don't blame the user, and don't use wording that reads badly on a projector.
  - Priya's draft in her review is the starting point.
- **Contact (Facilitator Q6):** "ask {contact}" uses deployment-configured text (a name, channel or URL), with a generic fallback such as "your IT or access administrator". This is display text only, not a behaviour toggle.
- **Stranded drafts (Facilitator Q1, O9):** the notice lists any `draft` sessions the user owns that they can no longer open (team and date), and asks them to arrange another facilitator.
- **Admin + EM + facilitator (Facilitator O8/Q7, now closed):** row 9 means "audit only" is not available for this user either. They get **admin-specific copy**: they're signed in as Application Administrator; their account also carries both EM and Facilitator, which is a conflict to fix. Not the "you're signed in as Engineering Manager" copy.

Acceptance condition (BA V2, amended): *Given a sign-in whose claim produces a role conflict, when the user's first non-session page renders, then a non-blocking notice naming both roles, the role that should be removed, and the contact is shown. It is shown again on every sign-in while the conflict persists. It is never rendered on any live-session route, including after re-authentication. A sign-in without a conflict shows no notice.*

### 4.4 Other touch points for the conflicted person (Facilitator O3, suggestions 7–8)

- **Room-open refusal.** `POST …/advance` re-checks the live `global_role` and returns a generic 403, **"Only a facilitator can open the room."** (`facilitator-sessions.ts:846-887`). That is the worst moment for this rule to bite: session day, possibly on a shared screen. When the user carries the conflict flag, that 403 gets conflict-specific, actionable copy, for example "You can't open this session because your account is now set up as an Engineering Manager. Another facilitator will need to run it." The flag is allowlisted data. No raw claim values. The rule is stated, a way forward is offered, and there is no workaround.
- **Entry points hidden.** Session-creation entry points are hidden for a resolved EM, as for any EM, so the `POST /draft` 403 is unreachable in normal use. The notice explains why the entry point is missing.

### 4.5 Sessions already past room-open (Facilitator O4)

Live control is granted by `sessions.facilitator_id` (Path 3, `session-subscriber-access-helper.ts`), not by `global_role`. So a facilitator whose role flips to EM mid-session (re-auth under SEC-26) keeps control of the running session. #235 Decision 12 also says an existing session stays with its facilitator. I agree with Priya that this is right for the ritual. Pulling the facilitator out between lock-in and reveal does more damage than letting one brief session finish, and the audit row records it either way.

My proposal for the record: *a role change resolved by the conflict rule never interrupts a session already past room-open. It takes effect at the next draft creation or room-open.* This has to be a **decision, not an emergent property**, or a later hardening change will "fix" it. **Still open:** Security (S4 owner) has to confirm it explicitly (Facilitator Q3).

## 5. Does the deployment-docs warning stay?

**Yes, as the standing control for the residual gaps (§6). Its text changes when the implementation lands.** Both halves go in the record (BA V5):

- **Decision record:** *"Until #NNN ships, the #235 warning text stands unchanged and is the only control for this pair, together with the D3 log line. No team goes live in that window (row 8)."*
- **Implementation issue:**
  - In `docs/deployment.md`, replace the sentence "If a user is sent both … facilitator only." verbatim with: *"If a user is sent both `engineering_manager` and `facilitator`, the application signs them in as **engineering manager**, records `<event name>` in the audit log and tells the user. Fix the assignment in your IdP."*
  - Amend #235's verbatim docs SHALL and spec delta to match. Editing the markdown alone isn't enough, because the VP made the warning a character-for-character SHALL.
  - Keep "Do not assign `facilitator` to anyone who manages people." verbatim.
  - Remove the "From then on…" sentence for this pair.
  - Keep "Keep those memberships accurate", because residual gaps 1 and 3 still depend on it.

**Troubleshooting entry for IdP admins (Facilitator O7, suggestion 9):**
- The event name.
- "One row per sign-in, so count distinct users, not rows."
- How to confirm a fix: the user's next sign-in produces `role_claim_mapped` with no conflict row.
- The "remove Facilitator from people who manage people" rule, restated.

That covers "who is conflicted?" and "did my fix take?" with a query against the audit log. I'm **not** proposing an in-app conflict view (see disposition).

**AC disposition paragraph for the record (BA R4):**
> #238 AC 2 offers two branches. This decision meets both. **No reporting-chain model is chosen**, so the #235 deployment-docs warning is confirmed as the standing control for residual gaps 1–4. **A narrow code rule is chosen**, so implementation issue #NNN is filed. It is blocked by #235 and gates first-team launch (decision-log row 8).

## 6. Residual gaps this rule does not close

These have to be in the record. I'd rather they were stated than discovered.

1. **Manager sent only `facilitator`.** The IdP admin *replaces* EM with facilitator instead of adding it. There's no conflict to detect. The person can facilitate any team where they hold no membership, including skip-level and sibling teams. The no-manager participation block survives only if their EM memberships are still recorded. **Control:** the docs warning.
2. **Skip-level managers, directors, VPs.** They usually hold no app EM role and no TEAM-006 memberships on the teams below them. If given `facilitator`, nothing distinguishes them from a senior engineer. This is the heart of "reporting chain", and the rule doesn't touch it. **Control:** the docs warning, plus the launch-checklist attestation (BA V6, below).
3. **EM memberships not recorded or stale.** A manager whose `team_memberships` rows are missing for a team is invisible to every membership-based check. The conflict rule helps only by removing their facilitator ability while both roles are sent.
4. **Informal authority.** Tech leads and "acting" managers without the EM role. The ritual cares about them, but the app has no signal at all. Out of scope, so note it and move on.
5. **Interpretation, owned by the BA (BA V8):** *"'Not in the team's reporting chain' means not holding line authority over any participant, directly or through a skip level. A peer who shares a manager with the team is not in its reporting chain."* So a sibling-team senior engineer is a fine facilitator (Priya O1 agrees and wants this kept). Marcus's caveat that such a peer could carry comments back to a shared manager is facilitation ethics for Priya's guidance, not an access rule.
6. **The interim window (closed by row 8).** Between #235 merging and the #238 implementation landing, the pair resolves to `facilitator` per #235 Decision 7. Row 8 means **no team goes live in that window**. So during the interim, the docs warning and the D3 log line protect a deployment with no live team, not a running ritual.

**Launch-checklist attestation (BA V6), accepted conditionally.** "IdP group hygiene" isn't a verifiable control, so I've dropped the word. If the first-team launch has a checklist, add: *"The IdP administrator confirms in writing that no current holder of `facilitator` has line-management responsibility for anyone in a team using the app."* That is the only thing that touches gaps 1 and 2 at all. It's cheap, and it's a human check, not a setting. I found no launch checklist in `requirements/` or `docs/`. If none exists, the record says "docs warning" only, and whether to create one is open (below).

### 6.1 Sessions created during the interim window (BA C1)

Marcus's worry is that a manager creates sessions while resolved to `facilitator` and keeps them after #238 lands. With row 8 in place, here is what actually happens:

- **No live team is affected.** The launch gate means no team has gone live before the implementation closes. Any interim session belongs to pilot, test or pre-launch setup data, not to a team's real ritual.
- **Drafts can't become a manager-run session after the fix.** Room-open re-checks the live `global_role` (`facilitator-sessions.ts:846-887`). Once the user resolves to EM, their drafts can't be opened. The violation Marcus describes is blocked by existing code. What's left is a **stranded draft**, not a manager in the chair.
- **Active sessions don't span the deploy in practice.** Sessions are brief and bounded by the 90-minute absolute lifetime. And under §4.5, a running session finishing is the behaviour we want anyway.

**My call: do not require a shipped detection query as code.** It would protect against a case the gate and the room-open check already close, and it would be one more thing to maintain for a one-time window. **Do require a one-time pre-launch check as a launch step in the implementation issue:** before the first team goes live, the deploying operator runs one read-only query: `draft` or `active` sessions whose facilitator now has `global_role = 'engineering_manager'` or has a conflict row. Any hits are recreated under a proper facilitator, by a human. This is still worth requiring, for two reasons. The first team's first session is the one most likely to be drafted *before* go-live, which is exactly the interim window. And that session is the most fragile one the ritual will ever run (Priya O10). A stranded draft there means a failed first session day. That's a few minutes of operator time against the worst possible first impression. The record states this disposition, which satisfies BA R5 item 9.

## 7. Where the decision record should live

| Option | Pros | Cons |
|---|---|---|
| **A. New file `requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`** | Follows the 01b precedent (identity and access area, facilitator designation). Easy to link. Self-contained rationale | One more file; the use-cases README index doesn't list 01b either |
| B. New "Decision" section appended to 01b | 01b already owns "facilitator comes from the IdP claim" | 01b is a *deferral* doc with a different subject; mixing them muddies both |
| C. Annotate `Summary.md:12` only | Puts it next to the source sentence | Summary.md is the source concept document. A decision with rationale doesn't belong there |
| D. `docs/decisions/` | A decisions folder exists | It's operator/dev docs (holds `readme-badges.md`). The AC says `requirements/` |

**Recommendation: A** (BA C6 concurs). Structure it like 01b: Status / Decision / Why / Rejected / Residual gaps / Revisit-if / Consequences.
- **Pointer from `Summary.md`:** a footnote marker on line 12 plus one footnote line at the end of the file. The sentence itself is unchanged.
- **Index:** add 01c and the missing 01b to `requirements/use cases/README.md`. That's traceability housekeeping, so it's in scope.

**Status line (BA C4):** *"Decided 2026-10-04 by the user (product owner), decision-log rows 1–4, 8, 9. Follow-on owner: Marcus Delgado (BA). VP of Engineering acknowledgment: _pending_ / _date_."* #238 does not close until the VP field is filled. Row 8 is the user's decision. Marcus notes that Follow-up 2 is jointly owned with Rachel, so her acknowledgment is a sign-off on the record, not a re-decision.

**Traceability header (BA V11):** `Summary.md:12` (intent); BRD §6.2 (no EM participation) and §6.3 (facilitator from another team); FR-2.1 [HARD] and FR-2.2 [HARD] (what's enforced today); #235 Decisions 7, 9 and 12; #235 D3; Security S4.

The record needs these contents (checklist for the propose stage):
- The decision statement (BA R1, adopted as written; it already says "and tells the user", which row 9 confirms).
- The glossary line ("error" = never silent).
- The exact resolution rule (the §3 table, with the added rows).
- **Rejected:**
  - (a) A reporting-chain model (manager-of relationships beyond TEAM-006, or an org-chart sync from the IdP). The app has never modelled org structure, a model adds a second source of truth that drifts, and it's disproportionate before the first team is live.
  - (b) Keeping #235 precedence for the pair (§2).
  - (c) Failing the sign-in on conflict. It denies a legitimate manager their EM access over an IdP mistake they don't control, when EM is already the restrictive outcome.
  - (d) Audit and log only, with no user notice (row 9).
- Why EM (§2, broken EM access first).
- "How this shows up for people" (§4 table), the audit-content rule, the S4 disposition, and the live-session rule (§4.5, subject to Security).
- Residual gaps (§6), including the BA-owned peer interpretation, and the standing control (§5, both halves).
- The interim-session disposition (§6.1).
- Dependency on #235, the launch gate (row 8), and a link to the implementation issue.
- **Revisit if** (BA V7):
  - An IdP can supply a reliable manager attribute, for example Entra `manager` via Graph.
  - A participant, facilitator or EM reports, in a retro, to the BA or to the VP, that a person with line authority over a team's participants facilitated that team's session.
  - The app gains org-structure data for another reason.

## 8. Linking from #235's proposal Follow-up 2 (the cross-branch problem)

#235's proposal lives on an unmerged branch (`ccr-b594efa3-9zclgu`), so this change cannot edit it. Adopting BA R6:

> AC 1 is met when #235's `proposal.md` Follow-up 2 contains a link to `requirements/use cases/01c - …`. **Who applies it:** whoever merges second, #235 or #238. If that's #238, the #238 PR applies the edit to #235's file once #235 is on main. **Until it's applied:** GitHub comments on #235 and #238 point to the record, and the #238 PR description says "AC 1: pending amendment on #235". #238 is not closed.

The before and after text (Follow-up 2 paragraph and the Decision 7 annotation) goes in an **appendix of this change's proposal**, not in a separate `followup-2-amendment.md`. That keeps the change to one place to look, in line with the single-record constraint. Marcus offered this fallback himself.

## 9. The follow-up implementation issue

Blocked by #235. **Gates first-team launch (row 8)**, like #237. Scope:
- `account-resolver`: conflict detection after allowlist filtering, drop `facilitator` when EM is present, return a conflict flag on `ResolvedUser`.
- `auth.ts`: a new conflict audit operation inside `withAuditTransaction`, plus a post-commit structured log. Register the operation in `audit-logger.ts`.
- The user notice (§4.3), the room-open conflict copy and hidden entry points (§4.4), and the deployment-configured contact text.
- Specs: amend #235's `oidc-auth` precedence requirement (scenario `["facilitator","engineering_manager"]` → EM) and `auth-error-handling` (new operation).
- Docs: the verbatim warning amendment and the troubleshooting entry (§5).
- Local dev: a simulator persona carrying both roles.
- Launch step: the one-time interim-session check (§6.1).
- Usability walk-through with Priya before first-team launch (Facilitator suggestion 11): the simulator persona with both roles and drafts pending; sign in, read the notice, attempt room-open, "fix" the IdP, sign back in.

**Minimum acceptance criteria the issue body must contain before #238 AC 2 counts as met (BA R5):**
1. Every row of the §3 table is a passing test against the resolver.
2. Duplicate elements produce one conflict. A string claim never produces a conflict.
3. The §4.1 transaction condition: one `role_claim_mapped` row plus one conflict row in the same transaction, and a failed conflict insert fails the sign-in.
4. Conflict-row metadata is limited to the fixed fields in §4.1. A test asserts that a non-allowlisted element (for example `superuser`) and its count are absent from the audit row and from the structured log.
5. With `application_admin` present, the D3 warn and the conflict row both fire. Without admin, D3 does not fire.
6. First access with a conflicting claim writes `auth.first_access_created` and the conflict row.
7. The §4.3 notice condition, including tests that the notice:
   - renders on the landing page;
   - does **not** render on any session route, including the re-auth return path (extend `reauthRequiredHostParity`);
   - uses admin-specific copy for the admin case.
8. The room-open 403 carries conflict-specific copy when the flag is set.
9. #235's `oidc-auth` precedence spec, the `auth-error-handling` spec and the verbatim docs SHALL are amended per §5.
10. The §6.1 pre-launch check is a documented launch step, with its disposition recorded.
11. The simulator has a persona that sends both roles.

## Still open (needs a human decision)

1. **Live-session rule (§4.5):** Security (S4 owner) needs to confirm that a conflict-resolved role change never interrupts a session already past room-open. I recommend yes.
2. **VP acknowledgment:** Rachel Okonkwo signs off on the record's Status line (row 8 and Follow-up 2 are jointly owned with the BA). #238 doesn't close without it.
3. **Launch checklist:** none exists in `requirements/` or `docs/`. Should one be created to hold the BA V6 attestation and the §6.1 check? If not, both live in the implementation issue's launch steps and the record cites "docs warning" only.
4. **Draft reassignment (Facilitator Q4):** v1 answer is "recreate under another facilitator", with the notice telling the user to arrange cover. I think that's acceptable. Flagging it in case the product owner wants reassignment in scope.
5. `openspec validate --strict` was not run. The CLI is not confirmed available in this environment, so run it before the propose stage.

*Closed since the first draft:* the launch gate (row 8); the user-facing surface (row 9); alerting (§4.2, follows #235 Decision 9); record location (option A, BA concurs); the cross-branch link approach (BA R6 adopted); what the admin case sees (admin-specific copy, from row 9).

## Review disposition

| Point | Disposition | Rationale |
|---|---|---|
| Fac O1: keep the peer/sibling sentence | Accepted | §6.5, now worded as a BA-owned interpretation (V8) |
| Fac O2: promotion as a path into the conflict | Accepted, reworded | It shapes the copy and drafts handling. Named as "a path", with no frequency claim, to stay consistent with BA V1 |
| Fac O3 / Q2 / sugg. 7: room-open 403 copy | Accepted | §4.4. This is the worst moment for the rule to surface. The conflict flag is already allowlisted, so no raw claim values leak |
| Fac O4 / Q3 / sugg. 2: live session continues | Accepted, pending Security | §4.5. Interrupting a running ritual is worse than letting one brief session finish. It has to be a decision, not an accident. Open item 1 |
| Fac O5 / sugg. 3: no notice on session routes, including re-auth | Accepted as a MUST | §4.3. The app has to disappear during the ritual. This isn't negotiable |
| Fac O6 / sugg. 6: copy (no jargon, say which role goes, what still works, how to clear) | Accepted | §4.3 copy rules. Exact copy stays out of the record (BA V2) |
| Fac O7 / sugg. 9: IdP admin workflow | Docs entry accepted. In-app "who is conflicted" view declined | A docs troubleshooting entry plus an audit query answers both questions. An admin dashboard for role hygiene is more app surface and moves the tool toward a management console. The fix belongs in the IdP |
| Fac O8 / Q7: admin+EM+facilitator copy | Accepted: admin-specific copy | Row 9 rules out "audit only", so admin-specific copy is the only remaining option |
| Fac O9: continuity for the teams on the rotation | Partly accepted | The notice lists stranded drafts (Q1). **Declined:** notifying the team, participants or other facilitators. That broadcasts one person's role misconfiguration, adds notifications to the ritual, and breaks the "everyone else sees nothing" line. The person arranges cover |
| Fac O10: support the launch gate | Closed | Decision-log row 8 |
| Fac Q1: list drafts in the notice | Accepted | §4.3 |
| Fac Q4: draft reassignment | Not adopted for v1 | No reassignment exists today. "Recreate" is adequate when the notice prompts the user to arrange cover. Flagged as open item 4 |
| Fac Q5: notice frequency | Accepted (reconciled with BA V2) | Every sign-in while the conflict persists, dismissible until the next sign-in |
| Fac Q6: configurable contact | Accepted | Display text only, with a generic fallback. It doesn't make any constraint configurable |
| Fac sugg. 1, 4, 5: "how this shows up" section, name promotion, stranded drafts as a consequence | Accepted | §4 table, §1, §6.1 and §4.3 |
| Fac sugg. 8: hide creation entry points | Accepted | §4.4 |
| Fac sugg. 10–11: tests and usability walk-through | Accepted | §9 ACs 7–8 and the walk-through launch step |
| BA C1: interim-session detection query | Modified: a one-time pre-launch operator check, not shipped code | §6.1. The launch gate means no live team is affected, and room-open already blocks a now-EM user's drafts. The check still guards the first team's pre-launch drafts, which are the most fragile session the ritual will run |
| BA C2: does "surfaced" mean the user is told | Closed | Row 9: yes, notice plus audit |
| BA C3: launch gate | Closed | Row 8. VP acknowledgment tracked under C4 |
| BA C4: Status line and decider | Accepted | §7. Records the user as decider and keeps the VP field pending |
| BA C5 / R6: AC 1 cross-branch link | Accepted, with the appendix variant | §8. Before/after text goes in the proposal appendix, not a second file |
| BA C6: footnote pointer, README index | Accepted | §7 |
| BA C7: alerting | Accepted, closed | §4.2. Same as #235 Decision 9 |
| BA V1: drop the "most often" claim | Accepted | §1 |
| BA V2: notice acceptance condition | Accepted, amended | Uses Priya's plain-language wording instead of "IdP administrator", and covers all session routes, not just voting and reveal |
| BA V3: audit row count and transaction | Accepted | §4.1. "One row per sign-in" wording fixed |
| BA V4: case-mismatch and baseline rows | Accepted | §3 table |
| BA V5: both halves of the docs warning | Accepted | §5 |
| BA V6: launch-checklist attestation | Accepted conditionally | §6. It's a human check, not a toggle. Depends on open item 3 |
| BA V7: concrete revisit trigger | Accepted | §7 |
| BA V8: peer interpretation owned by the BA | Accepted | §6.5 |
| BA V9: drop the personal principle line | Accepted | §4. My principle doesn't belong in the record |
| BA V10 / R5: minimum AC set | Accepted, extended | §9. Added the room-open copy and the admin-copy items |
| BA V11: traceability | Accepted | §7. BRD §6.2 is the no-manager rule's ID |
| BA R1–R4 | Accepted | Glossary, §3, §5 and §7 |
| BA D: lead "Why" with broken EM access | Accepted | §2 reordered |
