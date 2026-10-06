# BA Review: Proposal and spec deltas, Configurable OIDC role map (#243)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-10-05
**Reviewed:** `proposal.md` and `specs/{oidc-role-mapping,first-access,auth-error-handling,local-dev-environment}/spec.md`. Checked against issue #243, `requirements/use cases/01b - Designate a Facilitator - Deferral.md`, my exploration review (`explore-review-ba.md`), and `design.md`/`tasks.md` where they settle something the spec leaves open.
**Lens:** Can an engineer build and test each capability from the spec alone, without asking me what I meant?
**Out of scope (binding user decision):** fixed precedence and single-value `global_role`, as #243 is written. I don't reopen them. The "Known divergence" section records them well enough for later reconciliation.

---

## Verdict

**Approve with changes.** This is a big step up from the exploration notes. Most of the clarifications I raised (C1–C9, V1–V6, V12) are now normative SHALL statements with concrete scenarios. The `oidc-role-mapping` capability is close to build-ready. What's left is small and specific: one internal contradiction, three unspecified inputs that will produce different implementations, and a few places where design.md decides something the spec doesn't say. If the spec doesn't carry those decisions, they aren't requirements.

Must-fix: **B1–B4**. Should-fix: **S1–S8**. Nits: **N1–N4**.

---

## Blocking: fix before this goes to design/tasks sign-off

### B1. Missing-target warnings outside production contradict each other
- The requirement "Production warnings for missing facilitator and admin targets" is scoped to `NODE_ENV=production`.
- The scenario "Empty map outside production is allowed with warnings" says "the warnings for missing targets are logged" outside production.
- design.md D5 is production-only. tasks.md 1.4 says "under `production` and non-`production`" without saying what to expect in each.

**Concrete condition (pick one and write it into both places):**
> When `OIDC_ROLE_MAP` is **configured** (in any `NODE_ENV`), startup SHALL log one warning for each of `engineering_manager`, `facilitator` and `application_admin` that no key targets. In production, a missing `engineering_manager` target fails startup instead of warning. When the built-in default map is in use, no missing-target warnings are logged.

I recommend this option. A developer testing a real IdP map locally should see the same warnings production would show. The default map targets all four roles, so it would never warn anyway. Add a scenario: non-production, configured `{"Retro-Facilitators":"facilitator"}`. Expect startup to succeed with exactly two warnings (manager, admin).

### B2. `OIDC_ROLE_MAP` set to an empty or whitespace string is not specified
Compose files and k8s manifests often produce `OIDC_ROLE_MAP=` (empty) when a variable is declared but not filled. As written, an empty string is either "unset" (identity default outside production, boot failure in production) or "not valid JSON" (boot failure everywhere). Those are different outcomes. Outside production, the "unset" reading silently gives an operator who *meant* to configure a map the identity default.

**Concrete condition:**
> An `OIDC_ROLE_MAP` value that is empty or whitespace-only SHALL be treated as **unset**. *(Alternative: treated as invalid JSON. Either is fine, but state one.)*

Add one scenario for each `NODE_ENV` branch. I lean to "unset", which matches how the other optional variables in `config.ts` behave. Check that before committing to it.

### B3. Normalization rule in the spec differs from design D7
- Spec: "An array SHALL keep only its **string** elements… an empty array SHALL count as missing."
- Design D7: filters to **non-empty** strings, and "an array with no non-empty strings also normalizes to `[]`".

These give different results for `[""]`, `["", 42]` and `[42]`. Under the spec text, `[""]` is a present claim with one unmapped value, so it **warns**. Under the design it is missing, so it is **silent**. The warning is the observable behaviour, so the spec has to decide.

**Concrete condition (adopt the design's rule in the spec):**
> An array SHALL keep only its non-empty string elements. If no element survives, the claim SHALL count as missing.

Add a scenario: claim `["", 42, null]`. Expect it to be treated as missing, `global_role = engineer`, and no warning.

### B4. Facilitator discard on a user's *first* sign-in is not audited, and the spec doesn't say so
`facilitatorDiscarded` rides on `auth.role_claim_mapped`, which fires only for **returning** users. A brand-new user whose groups map to admin + facilitator gets `auth.first_access_created`, which has no flag. Their first facilitator discard is therefore a log line only. That may be acceptable. But the spec's "If `auth.role_claim_mapped` fires for that sign-in" leaves an implementer guessing whether to add the flag to `first_access_created` too.

**Concrete condition (choose one):**
- (a) `auth.first_access_created` metadata SHALL also carry `facilitatorDiscarded: true` when applicable. Add it to the `auth-error-handling` delta and its first-access scenario. **Or**
- (b) State explicitly: "On First Access the discard is recorded by the warn log line only. `auth.first_access_created` metadata is unchanged." Add a scenario that pins it.

I recommend (a). The question the signal exists to answer ("why can't this person facilitate?") comes up most in the first week, which is exactly when users are new.

---

## Should-fix: ambiguity that will show up as reviewer back-and-forth

### S1. The non-production default applies to every `NODE_ENV` that isn't exactly `production`
A `staging` or `uat` deployment pointed at a **real** IdP with no map gets the identity default. If that IdP already emits `facilitator` or `application_admin` on the claim, those become grants with no manager mapping and no boot failure. That is the same fail-open the production rule exists to prevent. I'm not asking to change the rule, but it must be visible.
**Condition:** add a sentence to "Identity default outside production": "Any `NODE_ENV` other than `production` (including `staging`) uses the default when the map is unset." Then add a docs AC: `docs/deployment.md` tells operators to set `OIDC_ROLE_MAP` on every deployment that uses a real IdP, whatever the `NODE_ENV`. Also make the startup summary line (S2) show `source=default`, so the state shows up in logs.

### S2. Startup summary line: the default-map case and the field shape are unspecified
The only scenario covers a configured map. **Conditions:**
- Add a scenario: map unset outside production. Expect one info line with `source: default` and counts `application_admin: 1, engineering_manager: 1, facilitator: 1, senior_engineer: 1`.
- State that the line always lists all four permitted targets, including zeros. (The existing scenario implies this but doesn't say it as a rule.)
- State that it is logged exactly once per process start, and only after validation succeeds. On a failed boot it is not logged.

### S3. The discard log line's content is described only by what it excludes
The spec says "with no claim values or keys". Design D7 says it carries `{ claimName, resolvedRole }`. Testers need positive content, the same way the unmapped warning has it.
**Condition:** "The discard line SHALL include the configured claim name and the resolved internal role, and nothing else derived from the token."
Also say whether the line is emitted **on every sign-in** while the condition holds. I assume yes, since it's per authentication. If so, say it, so nobody adds de-duplication later and calls it a fix.

### S4. Add the manager + facilitator discard scenario
"Manager and facilitator resolve to manager (known behaviour)" is the case the proposal calls out as pinned, but the discard requirement only has an admin scenario. **Condition:** under "Facilitator precedence-discard signal", add: claim values map to `engineering_manager` and `facilitator`. Expect `global_role = engineering_manager`, one discard warn line, and `facilitatorDiscarded: true` on the audit row. That pins the operator-facing signal for the case most likely to cause the "why can't I facilitate?" support question.

### S5. "Exactly one warning" needs a unit
"A claim with at least one value but zero mapped values SHALL log exactly one warning." Is that per sign-in, or per process? Per sign-in is clearly meant. **Condition:** change it to "exactly one warning per sign-in attempt". Also say whether the line carries the request `correlationId`. Without some identifier, an operator can't tell which user's groups failed to map. The user id (internal, not a claim value) or the correlationId keeps the no-values rule intact and makes the warning actionable.

### S6. Divergences from the literal text of #243 should be listed, not implied
The user decision is "implement #243 as written". The proposal deliberately goes further than or differs from the issue in four places. Each one is defensible and traces back to my exploration review, but someone checking the issue's acceptance criteria will read them as non-compliance:

| #243 says | Proposal says | Why (trace) |
|---|---|---|
| Unset map: "each value maps to itself for **all five** values" | Four self-mappings. `engineer` comes from the fallback | Same observable result. Keeps the rule that `engineer` is not a valid target (explore C4/C8) |
| "Every target must be a valid `user_role` value" | `engineer` is rejected as a target | Prevents hiding a manager (C4) |
| AC: "unmapped **or missing** claim … logs a warning" | A missing claim logs nothing | Issue contradicts itself; existing first-access item 3 says MUST NOT warn (C1) |
| Production: "require the map to be set" | Also requires at least one `engineering_manager` target | Stops no-manager fail-open (C5) |

**Condition:** add a short "Deviations from #243 text" section to proposal.md with this table. Better still, update the issue's ACs so the issue and the spec agree. Neither choice reopens the precedence/storage decision.

### S7. Release check and security sign-off still have no exit condition in the proposal
- "A release check confirms whether each known deployment's IdP already sends `facilitator` or `senior_engineer`." Who does it, where is the result recorded, and what blocks the release? Design says "T2 with a named owner". The proposal should name the owner and the artifact, for example a checklist in the release notes with one line per deployment marked confirmed or not affected.
- "A recorded security review sign-off is required before merge." Recorded where? **Condition:** a `security-review.md` in this change directory (or a PR approval from the Security Analyst persona) that covers the six listed points, each marked accepted or with a follow-up.

### S8. Demoted facilitator with a `live` session is listed as a follow-up with no tracking issue
This is exactly the kind of edge case (session state recovery) that I worry turns into a scope dispute later. Before this change existed, it couldn't happen: nobody could *be* a facilitator, so nobody could be demoted. This change makes it reachable on day one. **Condition:** open a GitHub issue now and link it from the proposal's follow-ups line. Also state the interim behaviour in one sentence, e.g. "Until resolved, a `live` session continues and its authority checks use the facilitator's role as of their current sign-in." If the honest answer is "unknown", say so and give the issue a priority.

---

## Nits

- **N1. Retained scenario titles that contradict their bodies.** D10 explains that the validator won't drop scenarios from a MODIFIED block, so I accept the workaround. But the participant scenario's THEN clause now contains a non-testable instruction ("`facilitator-001` is no longer covered… rename this scenario after archive"). Move that note to tasks.md and keep the THEN testable. The same applies to "Claim value not on allowlist is rejected **silently**", which now logs a warning, and "Reversion… is **not** represented". Confirm the post-archive rename task lists all three titles.
- **N2. Map keys with leading or trailing whitespace** (`" Eng-Managers"`). Exact match means they will never match a real group. Either reject them at startup (my preference: a typo that silently drops managers is the failure mode we're guarding against) or state that they are accepted as written. One sentence plus one test either way.
- **N3. "Role map changes take effect at next sign-in": the restart half has no scenario.** Add one: change the map without restarting, a user signs in, and the old map still applies. Optional, but it documents the operator expectation.
- **N4. `first-access` constraint bullet** still reads "every assignment of `global_role = 'engineering_manager'`… produces an audit log entry". Under the new firing rule, every non-`engineer` role and every change is audited. Widen the wording so the constraint doesn't read as EM-only.

---

## Traceability check

| Source | Requirement | Covered by | Status |
|---|---|---|---|
| #243 AC1 | Parse/validate; invalid JSON or unknown target stops process | Role map configuration format; Permitted map targets; Duplicate keys | Covered (stricter, see S6) |
| #243 AC2 | Production fails when unset | Production deployments must map managers | Covered (stricter, see S6). Empty string: B2 |
| #243 AC3 | No map gives today's behaviour, plus facilitator/senior_engineer | Identity default outside production | Covered. `senior_engineer` has no explicit default-map scenario; add it to "Default map resolves internal role strings" |
| #243 AC4 | Arrays work; highest role wins | Normalization; Fixed precedence | Covered; B3 for edge inputs |
| #243 AC5 | Unmapped/missing gives `engineer`, warning has no raw value | Fixed fallback; Logging | Covered (missing is silent, see S6) |
| #243 AC6 | Group change applies at next sign-in; previous-role audit works | Changes take effect at next sign-in; auth-error-handling delta | Covered, and improved: demotion is now audited |
| #243 AC7 | Unit tests | tasks.md | Out of spec scope; tasks 1.2–1.4 enumerate cases |
| #243 AC8 | Docs: deployment.md with groups example; local-development.md note | Proposal "Docs" bullet | Not in any spec (acceptable). Make sure tasks carry my explore V7–V9 docs ACs (Entra overage, broad-group warning, restart + 90-minute latency) and S1 |
| #243 AC9 | first-access spec updated | first-access delta | Covered |
| 01b decision | Facilitator reachable via IdP; demotion audited | first-access "Facilitator role arrives…"; local-dev facilitator scenario; auth-error-handling reversion | Covered. Draft-session creation is pinned in local-dev, which satisfies FR-2.1 end to end |
| No-manager rule (BRD/TEAM-006) | Map gap must not fail open silently | Production EM-target rule; Permitted targets (`engineer` excluded) | Covered in production; S1 for non-production deployments on a real IdP |

---

## What I'd tell the team

The ritual depends on two things this change touches: managers stay out of the room, and someone can actually run the session. The proposal protects the first with a boot failure and the second with a warning, and the asymmetry is argued well. Fix B1–B4 so the spec, not design.md, is the source of truth for the edge inputs. Then this is buildable without anyone coming back to me.
