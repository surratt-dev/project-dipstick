# Exploration Notes — #238 facilitator-reporting-chain-decision

**Explorer:** Devon Calloway (Internal Champion)
**Date:** 2026-10-04
**Mode:** non-interactive. Open questions are written down here, not asked.
**Binding inputs:** `decision-log.md` rows 1–4 (EM+facilitator conflict instead of a reporting-chain model; sign in as `engineering_manager` and flag it; admin still wins but is still flagged; decision record only for now, implementation after #235). These notes do not reopen any of them. They work out what those decisions mean and what the decision record has to say.

**Sources read:** `requirements/Summary.md:12`; BRD §6.2, §6.3, FR-2.1, FR-2.2; `requirements/use cases/01b - Designate a Facilitator - Deferral.md` (the precedent); `02 - Session Setup - Use Cases.md:20-25, 325-368`; backend `routes/facilitator-sessions.ts:316-363, 1290-1300`, `auth/standing-facilitator-access-helper.ts:104-116`, `auth/team-content-access-helper.ts:25-45, 140-180`, `routes/sessions.ts:140-160`, `routes/auth.ts:290-395`. From the #235 branch extract (read-only, scratchpad): `decision-log.md` (rows 6, 7, 9, 13, 16), `proposal.md` (Non-goals, Follow-ups 2 and S4 note), `design.md` (D1–D3, Risks, Sec S4 disposition), `exploration-notes.md` (Findings 2 and 3), `docs/deployment.md:189-202`.

---

## 1. What we are actually deciding

`Summary.md:12` says the facilitator is "a senior engineer from *another* team … not in the team's reporting chain." Today the app checks for the first half only: no active `team_memberships` row on the target team (`facilitator-sessions.ts:341`, `standing-facilitator-access-helper.ts:112`). Reporting lines are not modelled, and the user has decided not to model them.

What the user chose instead is a **proxy**. It detects the misconfiguration that most often puts a manager in the facilitator's chair, and it resolves that misconfiguration toward the role the ritual can live with.

```
  "not in the team's reporting chain"  (Summary.md:12, the intent)
          │
          ├─ "not a member of the team"             ← enforced today (hard block)
          ├─ "a manager is never a facilitator"     ← #238: enforced only when the IdP
          │                                            sends BOTH roles (conflict rule)
          └─ "not above the team in the org chart"  ← NOT modelled (residual gap, §6);
                                                       docs warning is the standing control
```

As the person who wrote the original proposal: the reporting-chain phrase exists to keep **people with authority over the participants** out of the facilitator's chair, in the same way the no-manager rule keeps them out of the votes. The cases that matter most are a manager, or a manager's manager, who runs the session. The conflict rule catches the most likely configuration of the first case. It does not catch the second (§6).

There is no legitimate "manager who also facilitates" profile in the ritual. The facilitator is a *senior engineer*. Resolving the conflict to EM therefore costs the ritual nothing. The person loses an ability they should not have had.

## 2. Why `engineering_manager` is the safer resolution (grounded in code)

Here is what happens to a user sent `["engineering_manager","facilitator"]` under each rule:

| Concern | #235 precedence (→ `facilitator`) | #238 rule (→ `engineering_manager` + flag) |
|---|---|---|
| Can create sessions (FR-2.1, `facilitator-sessions.ts:318`) | **Yes**, for any team they have no membership on: skip-level teams, sibling teams, a team their EM membership was never recorded on | **No**, anywhere. `global_role !== 'facilitator'` → 403 |
| Standing-facilitator topic access (`standing-facilitator-access-helper.ts:108`) | Yes, for non-member teams | No |
| No-manager participation block (`sessions.ts:150`) | Held by **one** check, `membership_role !== 'engineering_manager'`. Fails if the EM membership is missing or stale | Held by **both** checks: `global_role` and `membership_role` |
| Roster exclusion (`facilitator-sessions.ts:1298-1299`) | Only `tm.role` excludes them | Both `u.global_role` and `tm.role` exclude them |
| Their legitimate EM access (`team-content-access-helper.ts:169`, dual check) | **Broken.** `global_role ≠ EM` drops to the `team.access_grant_mismatch` path and degrades to participant-level access, which logs a mismatch event on every content request | Intact. The dual check passes |
| Failure direction | Toward privilege (can run sessions) | Toward restriction (cannot run sessions) |

Two things in that table go beyond the user's stated rationale and are worth putting in the record:

- **Defence in depth for the no-manager rule.** Under #235 precedence, the rule rests on `team_memberships` alone, the "keep memberships accurate" dependency the docs warning admits to. Resolving to EM puts the `global_role` signal back.
- **#235 precedence breaks the manager's real job.** A manager resolved to `facilitator` loses EM content access on their own teams through the dual-check mismatch path. So the #238 rule is also the *correct* resolution, not only the safer one.

## 3. The resolved-role rule, stated precisely

The implementation issue needs this to be unambiguous:

> Among the allowlisted values in the claim: **if both `engineering_manager` and `facilitator` are present, discard `facilitator`**, then apply #235 precedence (`application_admin` > `facilitator` > `engineering_manager` > `senior_engineer` > `engineer`) to what remains. Whenever both were present, record a role conflict, whatever role was finally applied.

| Allowlisted claim elements (order irrelevant) | Applied role | Conflict flagged? |
|---|---|---|
| `facilitator`, `engineering_manager` | `engineering_manager` | yes |
| `facilitator`, `engineering_manager`, `senior_engineer` | `engineering_manager` | yes |
| `application_admin`, `facilitator`, `engineering_manager` | `application_admin` | yes (row 4) |
| `application_admin`, `engineering_manager` | `application_admin` | no (#235 D3 log line only) |
| `application_admin`, `facilitator` | `application_admin` | no |
| `facilitator` only | `facilitator` | no. **Residual gap**, §6 |
| `facilitator`, `superuser` (non-allowlisted) | `facilitator` | no. Allowlist warning only |
| string `"engineering_manager facilitator"` | `engineer` (one non-allowlisted value, #235) | no |

Notes:
- Only an **array** claim can produce the conflict. A single string cannot carry both values (#235: no comma or space splitting).
- Detection happens **after** allowlist filtering and must ignore duplicates. `["facilitator","facilitator","engineering_manager"]` is one conflict.
- Interaction with #235 D3 (the outranked-EM log line): for the plain pair, EM is applied, so EM is not outranked and D3 does not fire. Only the conflict fires. With admin present, EM *is* outranked, so both the D3 warn and the conflict record fire. The implementation should test this explicitly, because #235 D2/D3 cap warnings per sign-in and the conflict adds a third signal.
- First access is covered too. A brand-new user whose first claim conflicts gets `auth.first_access_created` *and* the conflict record.

## 4. What "raise an error" / "flag" means, and to whom

"Error" here does **not** mean a failed sign-in (row 3: the user signs in as EM). It means the conflict is **not silent**. I hold that line for the facilitator-from-another-team constraint in general: hard block preferred, never silent. There are three audiences:

```
        IdP sends [EM, facilitator]
                   │
                   ▼
        resolve → engineering_manager
                   │
     ┌─────────────┼───────────────────────┐
     ▼             ▼                       ▼
 audit_log row   structured warn log   the signed-in user
 (durable,       (ops alerting can     ("why can't I create a
  queryable)      hook on it)            session?")
     │                                     │
     ▼                                     ▼
 IdP admin / Security                  told to ask their IdP admin
 fixes the assignment                  to remove one of the roles
```

**Audit (required by row 3, "audited").**
- A **separate operation**, e.g. `auth.role_claim_conflict` (the name is the implementation issue's call), with metadata limited to **allowlisted role names and identifiers we already audit**: `{ oidcSubject, appliedRole, conflictingRoles: ["engineering_manager","facilitator"], previousRole, correlationId }`. `conflictingRoles` is a fixed pair drawn from the allowlist. **It never contains raw claim values**: no non-allowlisted elements, no counts of them, no claim name beyond what is configuration.
- Write it **in the same `withAuditTransaction`** as the role UPSERT (`auth.ts:310`), so a failed audit write fails the sign-in. That is the existing D7 convention, and a conflict we can't record shouldn't be resolved silently.
- Fire it **on every sign-in while the conflict persists**, not only the first time. The condition is a standing misconfiguration, not an event. Volume is bounded by the 90-minute absolute session lifetime, so a row every sign-in is what keeps it visible until someone fixes the IdP. The existing `role_claim_mapped`-on-every-sign-in pattern for EM and admin is precedent.
- **This settles Security S4 in a narrower form.** #235 declined `outrankedRoles` on `role_claim_mapped` and said to "revisit if the reporting-chain decision needs durable evidence of who was sent both `engineering_manager` and `facilitator`." It now does. The record should say S4 is **answered by the dedicated conflict row**, and that `outrankedRoles` is still *not* added to `role_claim_mapped`. One purpose-built row is clearer to an incident reviewer than a general field.

**Structured log.** Emit after commit, mirroring `emitAuditEvent` usage (`auth.ts:367-395`), so operators can alert on it. #235 Decision 9 says "no alerting" for the outranked-EM log line. Whether the conflict gets an alert is a deployment choice, so the docs should name the event and leave alerting to the operator.

**The user.** "Surfaced" needs a user-facing meaning, or the person sees a confusing absence. They were told they're a facilitator, and the app won't let them create a session. This is the same confusion class as #237. My position: **one plain, non-blocking notice after sign-in**, along the lines of "Your identity provider assigned you both Engineering Manager and Facilitator. A manager can't facilitate, so you're signed in as Engineering Manager. Ask your IdP administrator to remove one of these roles." Never shown inside a live session, with no badge and no persistent chrome. The app should disappear into the background during the ritual. This is an **open item for the implementation issue** (§9). The decision record only needs to say the conflict is visible to the user and recorded for administrators.

## 5. Does the deployment-docs warning stay?

**Yes, as the standing control for the residual gaps (§6), but its text must change when the implementation lands.** The current #235 warning (`docs/deployment.md:200`) says:

> "If a user is sent both `engineering_manager` and `facilitator`, the application treats them as **facilitator only**."

After the #238 implementation that sentence is false. The VP made the warning a verbatim SHALL in #235 ("checked character for character"). So the implementation issue must amend #235's docs requirement and spec delta, not just edit the markdown. The amended warning should keep "Do not assign `facilitator` to anyone who manages people", which is still the core instruction and covers the facilitator-only case. It should replace the "facilitator only" sentence with the EM-plus-conflict behaviour and the event name.

**On #238's acceptance criteria:** they offer two branches, "model chosen → file implementation issue" or "no model → docs warning confirmed as standing control". This decision does **both**. No reporting-chain model is chosen, so the docs warning is confirmed as the standing control for what the rule doesn't catch. A narrow code rule *is* chosen, so a follow-up implementation issue is filed. The record should say this explicitly so a reviewer doesn't read it as failing either branch.

## 6. Residual gaps this rule does not close

These have to be in the record. I'd rather they were stated than discovered.

1. **Manager sent only `facilitator`.** The IdP admin *replaces* EM with facilitator instead of adding it. There's no conflict to detect. The person can facilitate any team where they hold no membership, including skip-level and sibling teams. The no-manager participation block survives only if their EM memberships are still recorded. **Control:** docs warning ("do not assign `facilitator` to anyone who manages people").
2. **Skip-level managers, directors, VPs.** They usually hold no app EM role and no TEAM-006 memberships on the teams below them. If given `facilitator`, nothing distinguishes them from a senior engineer. This is the heart of "reporting chain", and the rule doesn't touch it. **Control:** docs warning, plus IdP group hygiene.
3. **EM memberships not recorded or stale.** A manager whose `team_memberships` rows are missing for a team is invisible to every membership-based check. The conflict rule helps only by removing their facilitator ability while both roles are sent.
4. **Informal authority.** Tech leads and "acting" managers without the EM role. The ritual cares about them, but the app has no signal at all. Out of scope, so note it and move on.
5. **Ambiguity worth one sentence in the record:** is a peer who reports to the *same* manager (a sibling team under the same EM) "in the team's reporting chain"? I read the phrase as **above** the team: people with authority over the participants. A peer is not, so a sibling-team senior engineer is a fine facilitator. Saying so stops a future reader treating peers as a gap.
6. **The interim window.** Between #235 merging and the #238 implementation landing, the pair resolves to `facilitator` per #235 Decision 7. During that window the docs warning and the D3 log line are the **only** controls. This is not a reopening of row 2. But #235 Follow-up 2 says this issue gates first-team launch, and the decision record has to state what that gate now means. My recommendation: **the implementation issue inherits the first-team-launch gate**, the same as #237. Otherwise the gate is met on paper while the behaviour it was meant to fix ships unchanged. This is an open item for the user, BA (Marcus) and VP (Rachel). It is not mine to decide.

## 7. Where the decision record should live

Options:

| Option | Pros | Cons |
|---|---|---|
| **A. New file `requirements/use cases/01c - Facilitator Reporting Chain - Decision.md`** | Follows the 01b precedent (identity and access area, facilitator designation). Easy to link. Self-contained rationale | One more file; the use-cases README index doesn't list 01b either |
| B. New "Decision" section appended to 01b | 01b already owns "facilitator comes from the IdP claim" | 01b is a *deferral* doc with a different subject; mixing them muddies both |
| C. Annotate `Summary.md:12` only | Puts it next to the source sentence | Summary.md is the source concept document. A decision with rationale doesn't belong there |
| D. `docs/decisions/` | A decisions folder exists | It's operator/dev docs (holds `readme-badges.md`). The AC says `requirements/` |

**Recommendation: A**, structured like 01b: Status / Owner (BA, Marcus Delgado, with VP Rachel Okonkwo per #235 Follow-up 2) / Decision / Why / Rejected / Residual gaps / Revisit-if / Consequences. Add a **one-line pointer** under `Summary.md:12`, or a footnote, so a reader of the source sentence finds the decision. Also add 01c (and the missing 01b) to `requirements/use cases/README.md`. Keep `Summary.md` itself otherwise untouched.

The record needs these contents (checklist for the propose stage):
- The decision and the exact resolution rule (§3 table).
- **Rejected:** (a) a reporting-chain model (manager-of relationships beyond TEAM-006, an org-chart sync from the IdP). Reasons: the app has never modelled org structure, it adds a second source of truth that drifts, and it's disproportionate before the first team is live. (b) Keeping #235 precedence for the pair (§2). (c) Failing the sign-in on conflict: it denies a legitimate manager their EM access over an IdP mistake they don't control, when EM is already the restrictive outcome.
- Why EM (§2, including the defence-in-depth and broken-EM-access points).
- What "flag" means (§4) and the audit-content rule: only allowlisted role names, never raw claim values.
- S4 disposition (§4).
- Residual gaps (§6) and the confirmed standing control (§5).
- Dependency on #235, plus a link to the follow-up implementation issue.
- **Revisit if:** an IdP can supply a reliable manager attribute (for example Entra `manager` via Graph); the residual gaps produce a real incident; or the app gains org-structure data for another reason.

## 8. Linking from #235's proposal Follow-up 2 (the cross-branch problem)

#235's proposal lives on an unmerged branch (`ccr-b594efa3-9zclgu`), so this change cannot edit it. The constraint says not to touch files outside this change directory. Ways to meet the AC "linked from #235's proposal Follow-up 2":

1. **Paste-ready amendment text** kept in this change, for whoever next touches #235's branch. For example: *"Decided 2026-10-04: no reporting-chain model. EM+facilitator in one claim is a role conflict, resolved to `engineering_manager` and audited; implementation deferred to #NNN. See `requirements/use cases/01c - …`."* The same edit pass on #235 should also annotate Decision 7 (superseded for this pair) and flag the docs warning sentence as changing later.
2. **A GitHub comment** on #235's PR (or issue #235) and on #238, pointing to the record's path on this branch. GitHub MCP tools are available even though `gh` isn't authenticated. This makes the link discoverable today, but a comment is not the proposal.
3. **The follow-up implementation issue owns it.** That issue already has to amend #235's Decision 7, D3 and the verbatim docs warning (§5), so updating Follow-up 2 can be one of its tasks if #235 has merged by then.

**Recommendation:** do 1 and 2 now, and list the AC item as **"met on #235's branch when the amendment is applied"**. Don't claim it's met until the link actually exists in #235's `proposal.md`. Whichever of #235 and #238 merges second should apply the link. If #238 merges first, its record links forward to #235 by issue number. That works regardless of branch.

## 9. The follow-up implementation issue (scope sketch, not a spec)

Blocked by #235. Recommended gate: first-team launch (§6.6, user to confirm).
- `account-resolver`: conflict detection after allowlist filtering, drop `facilitator` when EM is present, return a conflict flag on `ResolvedUser`.
- `auth.ts`: a new conflict audit operation inside `withAuditTransaction`, plus a post-commit structured log; register the operation in `audit-logger.ts`.
- Tests: every row of the §3 table, duplicate elements, first-access-with-conflict, the admin case firing both D3 and the conflict, and an assertion that no raw claim value appears in either row or log.
- Specs: amend #235's `oidc-auth` precedence requirement (scenario `["facilitator","engineering_manager"]` → EM) and `auth-error-handling` (new operation).
- Docs: amend the #235 verbatim warning (§5) and add the event name to the troubleshooting section.
- User notice (§4): decide the surface and copy. Consult Priya (facilitator SME) on wording.
- Local dev: a simulator persona carrying both roles, so the conflict can be reproduced.

## Still open (for the user, BA or VP; not decided here)

1. **Does the implementation issue inherit the first-team-launch gate?** (§6.6) I recommend yes.
2. **User-facing surface for the flag:** a post-sign-in notice (my recommendation), or audit and log only? (§4)
3. **Alerting:** is the conflict event a deployment-documented alert hook, or log and audit only like #235 D3? (§4)
4. **Record location:** confirm option A (`01c`) plus a pointer from `Summary.md:12`. (§7)
5. **Cross-branch link:** confirm the "paste-ready amendment + GitHub comment now; AC met when applied" approach. (§8)
6. `openspec validate --strict` was not run. The CLI is not confirmed available in this environment, so run it before the propose stage.
