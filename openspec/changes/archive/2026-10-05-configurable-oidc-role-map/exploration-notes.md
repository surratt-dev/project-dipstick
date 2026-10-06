# Exploration Notes — Configurable OIDC role map (#243)

**Explorer:** Devon Calloway, Internal Champion (founding advisor)
**Date:** 2026-10-05 (revised after facilitator and BA review, same day)
**Branch:** `agent-team/243-configurable-oidc-role-map`
**Stance:** explore only. No code here. These notes look for anything in #243 that could quietly weaken a load-bearing constraint of the ritual.

---

## 0. Decided constraint (binding user decision)

#243 ships **as written**:

- **Its own fixed precedence:** `application_admin > engineering_manager > facilitator > senior_engineer > engineer`.
- **Single-value `users.global_role`.** No role-set storage in this change.

This overrules my earlier recommendation to layer #243 onto #235. The overlap with #235/#238/#241 is kept below (§3) as a **traceability and risk note only**. It is not a design input and not an open question. Everything else in these notes works inside that decision: validation, warnings, audit signals, lookup safety, tests and docs.

---

## 1. What #243 is really asking for

The mechanism stays as it is: the IdP is the only writer of `users.global_role`, re-read at every sign-in. #243 adds a translation layer between what the IdP sends and the five fixed internal roles.

```
 signed ID token                OIDC_ROLE_MAP (per deployment)       fixed internal role        enforcement
 ───────────────                ──────────────────────────────       ───────────────────        ───────────
 groups: ["Eng-Managers",  ──▶  "Eng-Managers"   → engineering_manager ─┐
          "Retro-Facil",   ──▶  "Retro-Facil"    → facilitator        ─┼─▶ precedence ─▶ users.global_role ─▶ no-manager checks
          "All-Staff"]     ──▶  (no mapping: ignored)                    │   (#243 order)     (single value)     FR-2.1 facilitator gate
                                                                         │                                       admin gates
                                 missing / nothing mapped ──────────────┴─▶ "engineer" (fixed default)
```

My view: this is a good change. Asking every customer's IdP admin to emit our enum strings is the kind of friction that keeps a team I've never spoken to from adopting the tool (success criterion 1). But the map now decides who counts as a manager and who counts as a facilitator, so it sits right on the no-manager rule and on whether a session can be run at all. A mistake in the config is a mistake in the ritual.

---

## 2. Ritual constraints in play

| Constraint | Where it's enforced today | How #243 touches it |
|---|---|---|
| **No-manager participation** | `session-subscriber-access-helper.ts:155-161` and the `sessions.ts` registration and lock-in handlers. They reject if **either** `users.global_role` **or** `team_memberships.role` is `engineering_manager`. The membership role can only be set to EM through TEAM-006, which requires `global_role = 'engineering_manager'` first. | The map now decides whether a manager is *recognised* as one. An unmapped manager group becomes `engineer`. TEAM-006 then returns 409, the manager cannot be recorded as EM on the team, and nothing stops them from joining by join link as a participant. **This failure is silent.** |
| **Facilitator designation through the IdP** (01b Decision, commit 2083753) | `standing-facilitator-access-helper.ts:104-116`; `facilitator-sessions.ts:318, 547, 858, 2463`, `topics.ts:122, 760` and `content.ts:769` all check `global_role === 'facilitator'` exactly. | #243 is what finally makes this decision work for any IdP that doesn't emit our strings. It also creates new ways for a real facilitator to *not* be recognised (§4.11–4.14), and those surface only as a 403 at session time. |
| **Facilitator not in the reporting chain** (Summary.md:12, #238, #241) | Only partly: a facilitator can't act on a team they're an active member of. Reporting lines aren't modelled. | EM + facilitator resolves to EM under #243's order. Same applied role as #238; no user-facing notice in this change (§3). |
| **Constraints are structural, not configurable** (my standing concern) | — | #243 makes role *recognition* configurable, not the constraints themselves. That's acceptable only if the map can't be used to switch a constraint off in practice. See §4 and §6. |

---

## 3. Traceability note: overlap with #235 / #238 / #241 (not a recommendation)

Recorded so whoever later reconciles the two resolvers finds it written down. The proposal should carry this as a short **"Known divergence from #235/#238/#241"** paragraph.

- **#235** (open, milestone 02; artifacts at `openspec/changes/facilitator-role-claim-allowlist/` on `origin/claude/multiple-user-roles-bxlmk8`, not merged) also adds `facilitator`/`senior_engineer`, array handling and a precedence rule, and was rescoped on 2026-10-04 to a `users.roles user_role[]` column.
- **#238** decided, and **#241** implements, that EM + facilitator resolves to EM and is **never silent** (audited and shown to the user).

| Topic | #243 (decided for this change) | #235 / #238 / #241 |
|---|---|---|
| Precedence | `application_admin > engineering_manager > facilitator > senior_engineer > engineer` | `application_admin > facilitator > engineering_manager > …` with an EM+facilitator discard rule |
| Storage | single-value `global_role` | `users.roles[]`, `global_role` derived |
| EM + facilitator | EM, no user-facing notice | EM, audited and shown to the user |
| Audit metadata | `previous_global_role` (+ discard flag, §6 R13) | `roles`, `previousRoles` |
| Docs | new `OIDC_ROLE_MAP` section | "Role claim" section and manager warning on the #235 branch |

**Risk:** whichever of #243 and #235 lands second will have to reconcile its resolver with the other. That reconciliation is owned by #235/#241, not this change.

**Known behaviour, pinned as a scenario:** EM + facilitator → `engineering_manager`, with no user-facing notice in this change. Not a bug; recorded so it isn't filed as one.

---

## 4. What could go wrong

### Manager-side (no-manager rule fails open)

1. **A manager group left out of the map lets a manager in (the worst case).** Every manager becomes `engineer`, TEAM-006 can't record them, and a join link lets them in. Mitigation decided in §6: production hard-fails without an EM target (R5), plus per-target startup counts (R6). This can't catch a renamed group, but it catches the common omission.
2. **A broad group mapped to an elevated role** (`"All-Engineering": "facilitator"`, `"Everyone": "application_admin"`). Validation can't know group size. Docs warning (R16).
3. **Mapping a manager group to `engineer`.** Closed: `engineer` is not a valid target (R2).
4. **Duplicate JSON keys.** `JSON.parse` keeps the last one silently. Closed: duplicates fail startup (R3).
5. **Groups overage and identifier claims.** Entra omits `groups` past ~200 groups and sends GUIDs by default. Senior people (managers) hit overage first and drop silently to `engineer`. Docs steer Entra to app roles (R16).
6. **Leaking raw claim values.** Closed by R4 and R12: errors name the rule and the offending key/target, never the whole map; sign-in logs and audit never carry claim values or map keys.
7. **Case sensitivity.** Exact match, consistent with #241. Docs say "list both spellings if your IdP varies case".
8. **Revocation latency.** Map is applied only at sign-in, after a restart. 90-minute session lifetime is the control. Docs line (R16).
9. **Prototype-pollution-style lookup.** If the map is a plain object, a claim value `"constructor"` or `"__proto__"` resolves to an inherited property. Claim values are attacker-influenced. Closed by R9 (own-key lookup only).
10. **Rollout risk of `facilitator` in the default map.** Only matters outside production (production must set the map, R5). Remaining risk is an operator copying the identity map into production unchecked; release check task covers it.

### Facilitator-side (the room can't run) — added after Priya's review

Every facilitator failure below shows up only as a 403 when a facilitator opens the app before a session, not to the operator at deploy time.

11. **Facilitator group unmapped / renamed / overage.** Every facilitator becomes `engineer` and loses draft creation, eligible-team lookup, launch, topic and annotation editing at once. Mitigation: production startup **warning** when no key targets `facilitator` (R5), counts line (R6), post-deploy "a facilitator can create a draft session" check in upgrade notes (R17).
12. **Admin + facilitator → `application_admin`, and the user cannot run a session.** Session lifecycle and topic writes require `global_role === 'facilitator'` exactly. In small orgs the person who set the tool up is often the facilitator. This is a consequence of the decided precedence, so it is **documented as a deployment rule** ("don't put people who facilitate in the admin group"), pinned by a test, and flagged by the discard signal (R13). I am not reopening precedence for it, and I don't want it reopened: see §7 on O3.
13. **EM + facilitator → EM, silently.** Accepted outcome (matches #238's applied role). The discard is recorded for operators (R13); the user-facing notice stays with #241.
14. **Mid-session re-sign-in demotes the facilitator.** If the map or IdP group changes and the facilitator's 90-minute session expires during a long first session, they come back with a different role and the next facilitator action 403s (`facilitator-sessions.ts:858`). Pre-existing, but #243 makes map edits routine. Docs: don't change the map while sessions are live (R16). What happens to a stranded `live` session is a follow-up (§8).

### Security-review items

- **Admin bypasses the facilitator-membership guard.** `application_admin` returns `authorized: true` before the `isMember` check (`standing-facilitator-access-helper.ts:104-110`). Existing behaviour; #243 makes the admin role more reachable via group mapping. Goes on the security review list (T1). Not changed here.

---

## 5. Things I think #243 gets right

- Internal role values stay fixed: enum, types, API contract and audit rows. The *constraints* still key on fixed role names. Only recognition is configurable.
- The `engineer` default is fixed and not configurable.
- Failing at startup on a bad config beats misrouting roles silently.
- Requiring the map explicitly in production makes the operator look at the roles at least once.
- Team membership roles stay app-assigned. The dual check on the no-manager rule depends on that independence.

---

## 6. Decided positions (input to the proposal's requirements)

Contradictions in the issue, resolved:

- **Missing-claim warning (C1).** A missing claim, empty string, or empty array logs **nothing**. That's the normal case for most engineers; a warning on every sign-in is noise that trains operators to ignore the one that matters. A claim with ≥1 value and **zero** mapped logs one warning. The issue's AC wording ("unmapped **or missing** … logs a warning") is corrected to match.
- **"Existing deployments keep working" vs. "required in production" (C7).** Replace with: *"Dev and test deployments without `OIDC_ROLE_MAP` keep working through the identity default. Production deployments must set it, and upgrading a production deployment without it fails to boot."* This is a breaking change on purpose and the upgrade notes say so.
- **Spec drift on the raw claim value (C3).** The current `first-access` scenario says the warning "identifies the unrecognized claim value"; the code logs only the claim name; #243 says never log raw values. **Normative: claim name only, never any value.** The MODIFIED scenario is rewritten to say so.

Requirements (R) and tasks (T):

**Configuration and startup**
- **R1.** `OIDC_ROLE_MAP`, when set, must be a JSON object with non-empty string keys and string values. A top-level array, non-string value, `null`, empty key or empty target fails startup with an error naming the broken rule.
- **R2.** Permitted targets: `application_admin`, `engineering_manager`, `facilitator`, `senior_engineer`. Unknown values and `engineer` fail startup, naming the offending key.
- **R3.** A key appearing twice fails startup, naming the key (mechanism left to design; `JSON.parse` alone can't detect it).
- **R4.** No startup error prints the full `OIDC_ROLE_MAP` value. A test asserts the full JSON string is absent from output.
- **R5.** With `NODE_ENV=production`: startup **fails** if the map is unset or no key targets `engineering_manager` (deliberate friction protecting the no-manager rule; a deployment with no managers maps a placeholder group and accepts that). Startup **warns** for each of `facilitator` and `application_admin` with no key targeting it. The facilitator warning reads plainly, e.g. "no IdP value maps to facilitator; no user will be able to run a session." The empty map `{}` therefore fails in production and is allowed with a warning elsewhere.
- **R6.** One info-level startup line reports key counts per target role and the source (`configured` or `default`). No key names.
- **R7.** Outside production, an unset map uses the identity default: `application_admin`, `engineering_manager`, `facilitator`, `senior_engineer` each map to themselves. `engineer` is reached through the fixed fallback, not a mapping, so R2 stays consistent. The default is built in code, not parsed.

**Resolution at sign-in**
- **R8.** Normalize: a string is one value; an array keeps only string elements; any other type, empty string or empty array counts as missing.
- **R9.** Lookup is exact and case-sensitive against operator-written keys only (own-key lookup: `Map`, null-prototype object or `Object.hasOwn`). `constructor`, `__proto__`, `toString` etc. are unmapped unless the operator literally wrote them as keys.
- **R10.** With ≥1 mapped value, the role is the highest by #243's precedence.
- **R11.** With no mapped value, the role is `engineer`.
- **R12.** Missing claim: no log. Present claim, zero mapped: one warning, claim name only. Partial match: no warning (ignored values are expected with `groups`); an ignored count may go on a debug line. No log line or audit row contains a claim value or map key.
- **R13.** Precedence-discard signal (single-value compatible, no #235 storage): when the resolved role outranks `facilitator` and a `facilitator` mapping was also present, emit a warn-level log line (no values) and, when `auth.role_claim_mapped` fires, include a boolean such as `facilitatorDiscarded: true` in its metadata. Lets an operator answer "why can't Priya facilitate?" without logging group names.
- **R14.** A returning user whose resolved role differs from their stored role emits `auth.role_claim_mapped` with previous and new **internal** roles only. Scenario: facilitator demoted to engineer emits the event.

**Tests** — unit cases for R1–R14, including `["Eng-Managers", 42]`, `"constructor"`, `"__proto__"`, `[]`, `""`, `{"A": null}`, duplicate key, `engineer` target, partial match, and **explicitly pinned** precedence outcomes: `[admin, facilitator] → application_admin`, `[engineering_manager, facilitator] → engineering_manager`, `[admin, engineering_manager] → application_admin`, `[facilitator, senior_engineer] → facilitator`.

**Docs, local dev and spec**
- **R15.** `docker/oidc/accounts.js` gives `facilitator-001` `role: "facilitator"`; `docs/local-development.md:118` corrected. **Acceptance criterion** (not a "check first" note): under the default map the stub's `facilitator-001` resolves to `facilitator`, and a test confirms it can create a draft session end to end.
- **R16.** `docs/deployment.md`: `OIDC_ROLE_MAP` reference with a `groups` example; exact match (list both spellings if needed); keys must match what the token carries (GUIDs if the IdP sends IDs); Entra overage and app-roles recommendation; broad-group warning; restart plus next-sign-in (90-minute session) note; manager warning; and a short **facilitator checklist**: map a facilitator group; people meant to facilitate must not also be in the admin or manager groups; affected users must sign in again after a map change; don't change the map while sessions are live.
- **R17.** Upgrade / release notes: production without `OIDC_ROLE_MAP` fails to boot after this release; after deploying, verify a facilitator can create a draft session ("the app boots" is not the check).
- **R18.** `openspec/specs/first-access/spec.md` requirement item 4 and scenarios MODIFIED to claim → normalize → map → precedence → default; the "rejected silently" scenario says claim name only (C3). Write the delta against main; if #235 lands first, rebase the delta onto its version.

**Process tasks**
- **T1.** Security review sign-off covering R2, R5, R9, R10, R13 and the admin `isMember` bypass, recorded in the change before merge.
- **T2.** Release check, with a named owner: each known deployment confirms whether its IdP already sends `facilitator` or `senior_engineer` on the configured claim. Done when every deployment has answered.
- **T3.** Proposal contains the §3 "Known divergence" paragraph and the EM+facilitator known-behaviour scenario.

---

## 7. Review disposition

**Accepted** (folded into §4 and §6):
- BA §0 / Priya stance: §3 recommendation and Q1/Q2 closed; §3 kept as traceability only.
- BA C1–C9, V1–V12, and the §3 AC rewrite, essentially as proposed (R1–R18, T1–T3).
- BA §4: EM + facilitator pinned as a known-behaviour scenario.
- Priya O1/suggestion 1: facilitator-side failure modes (§4.11–4.14).
- Priya suggestion 2 / FQ3: precedence-discard signal, as a boolean flag and log line with no values (R13).
- Priya O7 / suggestion 3: production warning for zero `facilitator` targets (R5).
- Priya suggestions 4, 5, 6 / FQ5 / O5: facilitator checklist, stub as an acceptance criterion, pinned precedence tests, post-deploy facilitator check.
- Priya O3: admin `isMember` bypass added to the security review list.

**Rejected or narrowed**, with rationale:
- **Making `facilitator` a hard production requirement** (implied by Priya O7). Rejected: a missing facilitator target stops sessions from happening, which is loud and recoverable. A missing EM target lets managers into the room, which is silent and damages trust in the ritual. Only the second earns a boot failure. Warn for facilitator.
- **Any change that lets an admin also facilitate** (implied by Priya O2/FQ1). Rejected for this change: it contradicts the decided precedence. I'd also resist it on ritual grounds: admins skip the "not a member of the team you facilitate" guard (O3), so an admin-facilitator is precisely the person the facilitator-from-another-team rule can't check. "Don't put facilitators in the admin group" is the right deployment rule, not a workaround.
- **User-facing notice for EM + facilitator, and a "your resolved role" indicator** (Priya FQ2, BA §4). Not in this change: the notice is #241's "never silent" work and a UI indicator is new surface. Logged as follow-ups. R13 gives operators the signal now.
- **Defining what happens to a `live` session whose facilitator is demoted** (Priya FQ4). Out of scope; follow-up with the session-flow work. Docs warn against changing the map during live sessions.
- **Discard flag storing which roles were discarded, or audit rows for every sign-in.** Narrowed to one boolean on the existing role-change event plus a log line. Anything richer drifts into #235's role-set storage, which the user decision excludes.
- **Warning on missing claims** (issue's own AC). Rejected per C1: noise that hides the warning that matters.

---

## 8. Follow-ups to file (not this change)

- "Your resolved role" indicator in profile/header (Priya FQ2), so a facilitator can tell "I'm not mapped" from "the app is broken" before a session.
- Behaviour of a `live` session whose facilitator loses the role on re-sign-in (Priya FQ4): stays controllable until it ends, or stranded.
- Reconciliation of #243's resolver with #235's role-set model (owned by #235/#241).

---

## 9. Bottom line

I support #243 as written. It's what lets the IdP-designation decision (01b) work in the real world. Precedence and single-value storage are decided; my job now is making sure they fail loudly. The no-manager rule must not fail open because one line of config was left out (hard production check), and a facilitator must not discover a mapping mistake in front of a team (startup warning, discard signal, pinned tests, facilitator checklist, post-deploy check). The constraints stay structural; the map only translates names into them.
