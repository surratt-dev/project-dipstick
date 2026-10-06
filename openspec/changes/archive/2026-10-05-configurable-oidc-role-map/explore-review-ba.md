# BA Review — Exploration Notes, Configurable OIDC role map (#243)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Date:** 2026-10-05
**Reviewed:** `exploration-notes.md` (Devon Calloway), against issue #243 and the current code/spec
**Lens:** Can each idea become a buildable, testable requirement without anyone coming back to ask "what did you mean?"

---

## 0. Scope ruling I'm reviewing against

The user has decided #243 ships **as written**: its own fixed precedence (`application_admin > engineering_manager > facilitator > senior_engineer > engineer`) and a single-value `users.global_role`. So:

- Notes §3's recommendation, **Q1** and **Q2** are **closed**. They should not be carried into the proposal as open questions.
- The useful remainder of §3 is a **traceability record**, not a design input. The proposal should keep one short "Known divergence from #235/#238/#241" paragraph listing precedence, storage, audit metadata and "never silent". That way whoever later reconciles the two resolvers finds it written down. It should not reopen the decision.
- Notes §4 items 1–10 and Q3–Q9 are still live. Most are the right concerns, but only some are specific enough to be requirements yet. The rest of this review covers them.

---

## 1. Clarifications needed (decide before the proposal is written)

| # | Question | Why it blocks a requirement | My suggested answer |
|---|---|---|---|
| C1 | **Does a missing claim log a warning?** The issue's proposal text says only "a claim with values but no match" warns. Its acceptance criterion says "an unmapped **or missing** claim … logs a warning". Today's code and `first-access` requirement item 3 treat a missing claim as normal, with no warning. | Two parts of the issue contradict each other, and the answer changes the tests. | Missing or empty claim: **no warning** (it's the normal case for most engineers, and a warning per sign-in is noise). Claim present with ≥1 value and **zero** mapped: warn. Fix the issue's AC wording to match. |
| C2 | **Partial match.** A claim `["Eng-Managers","All-Staff"]` maps one value and ignores one. Warn or not? | The notes (§4.8b) want counts. The issue says nothing. | No warning when ≥1 value maps. Ignored values are expected with `groups` claims, which carry dozens of unrelated groups. A count may go on a debug-level log line only. |
| C3 | **The existing spec scenario logs the raw value.** `first-access/spec.md` "Claim value not on allowlist is rejected silently" says the warning is "identifying the unrecognized claim value". The code logs only `claimName`. The issue says never log raw values. | The MODIFIED requirement must say which is normative, or the spec and code stay out of step. | The MODIFIED scenario states the warning carries the **claim name only** (plus counts if C2 adds them), never any value. |
| C4 | **What does "valid `user_role` target" mean if `engineer` is a target?** (Notes Q4.) | Either answer is fine, but it must be stated, because it decides a validation test case. | Accept the notes' lean: `engineer` is **not** a valid target. Startup fails with an error naming the offending key. The default map is an exception: it is built in code, not parsed. |
| C5 | **Must the production map name an EM target?** (Notes Q3, §4.1.) | "Validation should make it hard" is a direction, not a requirement. Also some deployments may have **no managers using the tool**, so a hard requirement can force a fake mapping. | Hard rule in production: the map must contain **at least one key whose target is `engineering_manager`**. Missing `facilitator` or `application_admin` targets: one startup **warning** each. Record in the proposal that the hard rule is deliberate friction to protect the no-manager rule. A deployment with no managers maps a placeholder group and accepts that. |
| C6 | **Is the empty map `{}` valid?** | Not covered anywhere. In production it would give every user `engineer`. | Covered by C5 in production (it fails because there's no EM target). Outside production: allowed, with a warning. |
| C7 | **"Existing deployments keep working" vs. "required in production".** (Notes §4.6.) | The issue states both, and they can't both be true for a production install. | Rewrite the issue sentence to: "Dev and test deployments without `OIDC_ROLE_MAP` keep working through the identity default. **Production deployments must set it, and upgrading without it fails to boot.**" Add the matching upgrade-notes AC (see §3). |
| C8 | **What is the identity default exactly?** | "Each value maps to itself for all five values". Is `engineer → engineer` part of it? If C4 forbids `engineer` as a target, the default must not be expressed as a parsed map. | Identity default = `{application_admin, engineering_manager, facilitator, senior_engineer}` each mapping to itself. `engineer` is reached through the fixed fallback, not through a mapping. Behaviour is identical, and C4 stays consistent. |
| C9 | **Who fixes the local stub?** (Notes §6.) `facilitator-001` has no `role` claim today. | "Should get" isn't an action. | In scope for this change: `docker/oidc/accounts.js` gives `facilitator-001` `role: "facilitator"`, and `docs/local-development.md:118` is corrected. Add it to the ACs. |

---

## 2. Vague areas (as written they can't become requirements)

**V1. "Strict parse that rejects duplicate keys, or at least a check for them" (§4.4).** Two options, no decision. `JSON.parse` can't detect duplicates, so this needs a specific mechanism. *Needs:* "Startup fails when `OIDC_ROLE_MAP` contains the same key twice. The error names the duplicated key." Leave the mechanism to design.

**V2. Map value and structure types aren't covered.** The notes and issue cover "doesn't parse" and "unknown target", but not: a top-level array (`["a"]`), a non-string value (`{"A": 1}`, `{"A": null}`), an empty-string key (`{"": "facilitator"}`), or an empty-string target. *Needs:* "The value must be a JSON object. Every key must be a non-empty string. Every value must be a string naming a permitted target. Anything else fails startup."

**V3. Lookup safety is not stated (not in the notes either).** If the map is looked up as a plain JS object, a claim value of `"constructor"`, `"toString"` or `"__proto__"` resolves to an inherited property, not `undefined`. That is attacker-influenced input reaching the lookup. *Needs:* "Only keys the operator wrote in `OIDC_ROLE_MAP` can match. Claim values matching inherited object property names (e.g. `constructor`, `__proto__`) are treated as unmapped." Add it as a unit test case.

**V4. "Normalize it to a list of strings" doesn't say what happens to non-strings.** A claim may be `["Eng-Managers", 42, null, {"x":1}]`, a number, a boolean or an empty array. *Needs:* "Array elements that are not strings are ignored. A scalar claim that is not a string is treated as having no values. An empty array or empty string is treated as missing." (Ties to C1: missing means no warning.)

**V5. "Startup log line listing each target role and how many keys map to it" (§4.1b, Q9).** Good idea, but not specified. *Needs:* "At startup the app logs one info-level line with the count of keys per target role, e.g. `{application_admin: 1, engineering_manager: 2, facilitator: 1, senior_engineer: 0}`. It includes no key names." Also say whether it is logged when the identity default is in use (I suggest yes, with `source: "default"`).

**V6. Error message content (§4.8a).** "Naming the key is fine" sits next to "must not echo the whole map". *Needs:* "A startup validation error names the rule broken and the offending key or target value. It never prints the full `OIDC_ROLE_MAP` value." One test asserts the full JSON string is absent from stderr.

**V7. Entra overage and GUIDs (§4.5, Q7).** Docs-only, which is fine, but "should recommend" isn't checkable. *Needs (docs AC):* `docs/deployment.md` contains (a) a note that map keys must match exactly what the token carries, including object IDs where the IdP sends IDs; (b) a warning that Entra omits `groups` past its overage limit, and a recommendation to use app roles (`roles` claim) for Entra.

**V8. Broad-group mapping (§4.2).** "Worth stating plainly" means a docs requirement with no defined content. *Needs:* a docs AC: "`docs/deployment.md` warns that mapping a broad group to `facilitator` or `application_admin` grants that role to every member, and that the app cannot detect group size."

**V9. Revocation latency (§4.10).** Fine as docs, but needs the line pinned. *Needs:* "`docs/deployment.md` states that after changing `OIDC_ROLE_MAP` the app must be restarted, and affected users get the new role only at their next sign-in (session lifetime: 90 minutes)."

**V10. "Check existing IdP configs before release" (§4.7, issue note).** This is a release task, not a product requirement, and there's no owner or exit condition. *Needs:* a release-checklist task in `tasks.md` with an owner, done when each known deployment has confirmed whether its IdP already sends `facilitator` or `senior_engineer` on the configured claim.

**V11. "Security review needed" (issue note).** No definition of done. *Needs:* a task stating the review covers precedence, startup-failure modes, production-required rule, C5 and V3, with sign-off recorded in the change before merge.

**V12. Audit behaviour when the map changes the result.** The issue AC says "`previous_global_role` audit capture still works", which is a regression check, not a behaviour. `first-access` says `auth.role_claim_mapped` fires for a returning user whose role changes. *Needs:* "When a returning user's resolved role differs from their stored role, `auth.role_claim_mapped` is emitted with the previous and new **internal** role values. It never includes IdP claim values or map keys." Add a scenario: a facilitator demoted to engineer emits the event.

---

## 3. Suggested rewrites of the issue's acceptance criteria

Replace the issue's AC list with the list below. Items marked † are new or changed.

**Configuration and startup**
1. `OIDC_ROLE_MAP`, when set, must be a JSON object with non-empty string keys and string values. Otherwise startup fails with an error naming the broken rule. †(V2)
2. Every map value must be one of `application_admin`, `engineering_manager`, `facilitator`, `senior_engineer`. An unknown value, or `engineer`, fails startup with an error naming the offending key. †(C4)
3. A key that appears twice fails startup with an error naming the key. †(V1)
4. No startup error prints the full `OIDC_ROLE_MAP` value. †(V6)
5. With `NODE_ENV=production`: startup fails if `OIDC_ROLE_MAP` is unset, or if no key targets `engineering_manager`. A startup warning is logged for each of `facilitator` and `application_admin` with no key targeting it. †(C5, C6)
6. At startup, one info log line reports the number of keys per target role, and the map source (`configured` or `default`). It includes no key names. †(V5)
7. Outside production, an unset map uses the identity default for `application_admin`, `engineering_manager`, `facilitator`, `senior_engineer`. †(C8)

**Resolution at sign-in**
8. The claim is normalized: a string becomes one value; an array keeps only its string elements; anything else, an empty string, or an empty array counts as missing. †(V4)
9. Each value is looked up by exact, case-sensitive match against operator-defined keys only. Inherited object property names never match. †(V3)
10. With ≥1 mapped value, the role is the highest by `application_admin > engineering_manager > facilitator > senior_engineer > engineer`. (As written in #243.)
11. With no mapped value, the role is `engineer`.
12. A missing claim logs nothing. A present claim with zero mapped values logs one warning with the claim name only. A partial match logs no warning. No log line or audit row contains a claim value or a map key. †(C1, C2, C3)
13. A returning user whose resolved role differs from their stored role emits `auth.role_claim_mapped` with the previous and new internal roles. †(V12)

**Tests** — unit tests for each case in 1–13, including: `["Eng-Managers", 42]`, `"constructor"`, `[]`, `""`, EM+facilitator → EM, admin+EM → admin, `senior_engineer` alone, and a partial match.

**Docs, local dev and spec**
14. `docs/deployment.md`: `OIDC_ROLE_MAP` reference with a `groups` example; exact-match note (list both spellings if your IdP varies case); keys must match what the token carries (IDs if the IdP sends IDs); Entra overage / app-roles recommendation; broad-group warning; restart plus next-sign-in note. †(V7–V9)
15. Upgrade / release notes state that production deployments without `OIDC_ROLE_MAP` fail to boot after this release. †(C7)
16. `docker/oidc/accounts.js` gives `facilitator-001` `role: "facilitator"`. `docs/local-development.md` is corrected to match. †(C9)
17. `openspec/specs/first-access/spec.md` requirement item 4 and its scenarios are MODIFIED to: claim → normalize → map → precedence → default. The "rejected silently" scenario no longer says the warning identifies the value. †(C3)

**Process (tasks, not ACs)**
- Security review sign-off covering 2, 5, 9, 10. †(V11)
- Release check of known deployments' IdP claims for `facilitator` / `senior_engineer`. †(V10)
- Proposal contains a "Known divergence from #235/#238/#241" paragraph (precedence order beyond EM+facilitator, single-value storage, `previousRoles`/`roles` audit fields, #238's "never silent" notice). Recorded for traceability only. †(§0)

---

## 4. One edge case worth naming, not solving here

With #243's precedence, a user mapped to **both** `engineering_manager` and `facilitator` resolves to EM with no notice to the user. That matches the *applied role* in #238 but not its "never silent" half. Within the decided scope this is acceptable, but it should appear in the proposal as a **known behaviour** with a scenario ("EM + facilitator → EM, no user-facing notice in this change"), so that nobody files it later as a bug. It is not a request to change the decision.
