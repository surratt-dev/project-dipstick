# Sync review (Solution Architect): 238-facilitator-reporting-chain-decision

*Ingrid Sollenberger, Principal Solution Architect. 2026-10-04. Scope: drift between the docs and
the code on `main` after `sync-report.md`. Read-only review; nothing was changed.*

## Verdict

**Approve with one must-fix.** The sync no-op is correct, the issue numbers are consistent, the
links resolve, and the filed issues match the appendices. The record does not say what `main` does
today. Its present-tense rule reads as if it were already built. The design's own risk mitigation
("01c states the interim plainly") is only half met.

## What I verified

| Check | Result |
|---|---|
| `git diff --stat origin/main -- openspec/specs` | Empty. The specs are unchanged. |
| `git diff --name-only origin/main...HEAD` | Only the 4 `requirements/` files and the change folder. No code, migration or config. Matches the sync report. |
| Links added in `requirements/` | All 4 resolve: the `Summary.md` footnote goes to `use cases/01c…`; README rows 01b and 01c; the cross-reference in `01 - Identity and Access`. "Designate a Facilitator — Deferral", Decision section exists (`01b`, line 9). |
| #240 / #241 vs decision-log row 22 | Consistent everywhere: 01c §1 and §6, proposal (What Changes, Appendix A header, Appendix B "Related", Appendix C title), design (Context, D3–D7, Risks). #240 is takeover with no gate. #241 is the conflict rule with the launch gate. No leftover placeholders. |
| Row 23 (AC 1 pending) | 01c §9 says AC 1 is met only when A.1 is applied to #235. This matches. |
| Filed issue bodies (GitHub API) | #241 matches Appendix B and #240 matches Appendix C line for line (blank lines ignored). The only addition is a one-line provenance header. Both are open, in milestone "02 - Session Setup", with the expected titles. |
| Code on `main` | `packages/backend/src/auth/account-resolver.ts:52-56`: `PERMITTED_GLOBAL_ROLES = {engineer, engineering_manager, application_admin}`; `mapRoleClaimToGlobalRole` calls `String(rawClaimValue)`. There is no `facilitator` claim value, no array handling and no precedence. #235 is unmerged (branch `ccr-b594efa3-9zclgu`). |

## Must-fix

**M1. 01c does not describe current behaviour on `main`, and it states the future rule in the
present tense.**
- §2 says "Instead it **enforces** a narrow conflict rule". The summary and the 01 cross-reference
  say "is signed in as `engineering_manager`, told and audited". None of this is built. It ships in
  #241, after #235.
- The only "now vs later" text is §8 gap 6 and §9 "Interim". Both describe the window *after
  #235 merges and before #241 ships*: "the pair resolves to `facilitator` per #235 Decision 7". That
  is not `main`. On `main` the IdP cannot grant `facilitator` at all. An array claim
  `["engineering_manager","facilitator"]` is turned into the string `"engineering_manager,facilitator"`,
  fails the allowlist and resolves to `engineer` with a warning. The #235 deployment-docs warning
  that §9 says "stands unchanged" does not exist in `docs/` on `main` either.
- The §3 table is not labelled as the post-#241 rule. Its last row (string claim → `engineer`)
  happens to match today's behaviour, which makes the mix-up easier.
- **Fix:** add an "Implementation status" line to §1, and a matching parenthesis to the line in
  `01 - Identity and Access`. Example: "Not yet implemented. On `main` today the role claim is
  single-valued, `facilitator` is not an accepted claim value, and any multi-valued claim resolves
  to `engineer`. #235 adds `facilitator`, array claims and precedence. #241 then adds this rule.
  #240 adds takeover." Then label §3 "Rule as implemented by #241". Change "enforces" in §2 to
  "will enforce (#241)", or say "decided", not "enforced". No decision changes. This is wording only.

## Suggestions

- **S1. Archive path cited before it exists.** 01c §9 and §11 and both filed issue headers cite
  `openspec/changes/archive/2026-10-04-238-facilitator-reporting-chain-decision/`. That path will
  dangle unless the archive happens with exactly that date prefix. Archive on 2026-10-04, or
  update 01c to match the actual archive folder. The issue headers would then need a comment on
  each issue.
- **S2. Proposal says something 01c does not.** In the proposal, the What Changes Status quote
  (line 58) reads "approved with conditions, **see #241**". 01c §1 has no such pointer. This looks
  like a placeholder replacement that went too wide. The Exec conditions do live in #241's
  Schedule and Scope-freeze lines, so the pointer is defensible. Either add it to 01c or drop it
  from the proposal so that the two say the same thing.
- **S3. Stale headings in Appendix B.** The heading "Draft body for the follow-up implementation
  issue" and the line "Filed by the orchestrator at the end of this pipeline" predate filing.
  Appendix C names its issue: "(#240)", "Filed … alongside #241". Add "(#241)" to the B heading
  and use the past tense, for symmetry.
- **S4. Wording in the sync report.** It says the precedence requirement "exists only in #235's
  unmerged `first-access` delta". That is correct. It is worth repeating in 01c's Relation-to-#235
  paragraph, so readers do not look for Decision 7 in `openspec/specs/`.

## Not drift (checked, fine)

- Decision-log rows cited in 01c (1–4, 8–19) match the row contents.
- The 01c Status cites "rows 1–4, 8–11 and 13–18". It correctly leaves out the pipeline, environment,
  factual and orchestrator rows (5–7, 12, 20–23).
- FR-2.1 / FR-2.2 "what is enforced today" is accurate for `main`.
