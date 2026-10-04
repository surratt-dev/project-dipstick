# Tasks: 238-facilitator-reporting-chain-decision (#238)

> **Documentation-only change.** TDD doesn't apply. Each task ends with a check you can run from
> the repo root. Paths containing spaces are quoted. `RECORD` below means
> `"requirements/use cases/01c - Facilitator Reporting Chain - Decision.md"`.

## 1. Decision record (`01c`)

- [ ] 1.1 Create `RECORD` with the section order from design D1. The Status block:
  - Decided 2026-10-04 by the user (product owner), decision-log rows 1–4, 8–11 and 13–18.
  - Follow-on owner: the Business Analyst.
  - VP of Engineering acknowledgment: "Persona review (Executive Stakeholder) approved with
    conditions, see #NNN; human VP of Engineering acknowledgment *pending* (owner: the user, as product
    owner)." Do not record the persona review as the VP's acknowledgment.
  - Implementation: #NNN.

  Put a three-sentence summary (rule, why, what it doesn't catch) above the traceability header.

  Include a traceability header citing `Summary.md:12`, BRD §6.2 and §6.3, FR-2.1, FR-2.2, #235
  Decisions 7, 9 and 12, #235 D3, and #235 Security S4.
  **Check:** `test -f "$RECORD"`. Also, `grep -c '^## ' "$RECORD"` is ≥ 10, `grep -n 'pending' "$RECORD"` hits the VP line,
  and `grep -n 'Acknowledged' "$RECORD"` returns nothing.
- [ ] 1.2 Write the Decision and glossary line ("error" means never silent, not a failed sign-in), and
  the resolved-role rule with all 11 table rows from exploration §3.
  **Check:** `grep -c '^| `' "$RECORD"` is ≥ 11. `grep -n 'never silent' "$RECORD"` returns a hit.
- [ ] 1.3 Write "Why `engineering_manager`". Lead with broken EM access, then defence in depth, then failure
  direction.
  **Check:** in `grep -n 'mismatch\|defence in depth' "$RECORD"`, the mismatch hit's line number is
  lower than the defence-in-depth hit's.
- [ ] 1.4 Write "How this shows up for people":
  - the three-audience table;
  - audit content limited to allowlisted role names, no raw claim values;
  - the S4 disposition;
  - the user is told *and* the conflict is audited (row 9).

  Leave the exact copy to #NNN.
  **Check:** `grep -n 'raw claim' "$RECORD"`, `grep -n 'S4' "$RECORD"` and `grep -n 'Nothing' "$RECORD"` each return a hit.
- [ ] 1.5 Write the Sessions section (rows 11, 14–18; design D5):
  - drafts stay blocked at room-open; the notice names them;
  - they can't be recreated in the app (the draft holds the team's single open-session slot), so
    another facilitator takes the draft over (#MMM, separate issue, no launch gate);
  - until #MMM ships, a stranded draft is cleared by a documented, audited operator step (#NNN);
  - draft-based team-content access requires a live `facilitator` role (row 18);
  - there is no reassignment feature in #NNN;
  - opened sessions stay with `sessions.facilitator_id` per #235 Decision 12, and the section lists
    what that covers: control, live events, per-voter attribution, action items and trends, 30
    minutes after completion, no limit while non-terminal (Security S3).

  State these as decisions.
  **Check:** `grep -n 'facilitator_id' "$RECORD"`, `grep -n 'Decision 12' "$RECORD"`,
  `grep -n 'take.* over\|takeover' "$RECORD"`, `grep -n '#MMM' "$RECORD"` and
  `grep -n '30 minutes' "$RECORD"` return hits. `grep -in 'recreat' "$RECORD"` returns only the
  statement that drafts can't be recreated in the app. `grep -in 'reassign' "$RECORD"` appears
  only in a "no reassignment" statement.
- [ ] 1.6 Write Rejected (a) to (d), with the reporting-chain model first, and Residual gaps 1–6, with the
  docs warning as the standing control and the BA-owned peer interpretation. Gap 2's control is the
  docs warning only; do not carry over "plus the launch-checklist attestation" from exploration §6.
  Record gaps 1 and 2 as **accepted risk** (decision-log row 13, the user): no pre-launch control,
  docs warning only.
  Add the line: a failed conflict-row insert fails the sign-in as any transactional audit-write
  failure does (#235 `auth-error-handling`); this is not rejected option (c).
  **Check:** `grep -n 'reporting-chain model' "$RECORD"` and `grep -n 'accepted risk' "$RECORD"` return hits. `grep -c '^[1-6]\. \*\*' "$RECORD"` is ≥ 6, or count by section read-through.
- [ ] 1.7 Write the following:
  - the #238 AC disposition paragraph, naming both AC (2) branches (exploration §5 wording);
  - the dependency on #235;
  - the first-team-launch gate (row 8);
  - the pre-launch items, which live in #NNN (row 10, no checklist doc);
  - the interim statement ("Until #NNN ships, the #235 warning text stands unchanged…");
  - Revisit-if, with three triggers. Trigger 2 names its recipients: "the Business Analyst and the
    VP of Engineering" (roles, not persona names).

  **Check:** `grep -n 'first team' "$RECORD"`, `grep -n 'Revisit' "$RECORD"`, `grep -n 'stands unchanged' "$RECORD"`
  and `grep -n 'Business Analyst and the VP of Engineering' "$RECORD"` return hits.
  `grep -rn 'checklist' "$RECORD"` contains no statement that a checklist doc exists.
- [ ] 1.8 The record contains no exact notice copy, no app setting or toggle for the rule, and no
  wording that makes the no-manager rule or the facilitator-from-another-team rule optional.
  **Check:** `grep -in 'toggle\|configurable\|opt out\|override' "$RECORD"` returns nothing, or
  only the sentence "contact text is display text, not behaviour".

## 2. Pointers and index

- [ ] 2.1 In `requirements/Summary.md`, add a footnote marker to the facilitator line (line 12) and one
  footnote at the end of the file linking `RECORD`. Leave the sentence text unchanged.
  **Check:** `git diff -U0 requirements/Summary.md` shows only the marker on line 12 and the
  appended footnote. `grep -n "not in the team's reporting chain" requirements/Summary.md` still matches.
- [ ] 2.2 In `requirements/use cases/README.md`, add index rows for 01b and 01c after the 01 row, with
  URL-encoded links.
  **Check:** `grep -c '01b\|01c' "requirements/use cases/README.md"` is ≥ 2. Task 2.4 resolves each link.
- [ ] 2.3 In `requirements/use cases/01 - Identity and Access - Use Cases.md`, add one cross-reference
  line next to the "Facilitator designation … (#235)" out-of-scope note (currently around l.226),
  pointing to `RECORD` for the reporting-chain decision.
  **Check:** `grep -n '01c\|Reporting Chain' "requirements/use cases/01 - Identity and Access - Use Cases.md"` returns one hit, and `git diff --stat` shows +1 to +2 lines for this file.
- [ ] 2.4 Link check: every relative link added in 2.1 to 2.3 resolves to an existing file.
  **Check:** a short script decodes `%20` in each added link target and runs `test -f` relative to the
  linking file. All pass.

## 3. Proposal appendices (already drafted, verify only)

- [ ] 3.1 Appendix A "Before" quotes match #235 character for character.
  **Check:** `git show origin/ccr-b594efa3-9zclgu:docs/deployment.md | grep -F "treats them as **facilitator only**"` hits.
  The Follow-up 2 "Before" text is found verbatim with `grep -F` in `git show origin/ccr-b594efa3-9zclgu:openspec/changes/facilitator-role-claim-allowlist/proposal.md`.
- [ ] 3.2 Appendix B contains the launch gate, the "merged and archived" blocker, the schedule and
  scope-freeze lines, the 12 minimum ACs (11 plus AC 12 from row 18), the 2 pre-launch steps
  (row 10) and the PR-review checkboxes.
  **Check:** `grep -n 'Gates:\*\* first-team launch' proposal.md`, `grep -n 'merged and archived' proposal.md`
  and `grep -n 'Scope freeze' proposal.md` hit.
  Under "Minimum acceptance criteria" there are 12 numbered items. Under "Pre-launch steps" there are
  2 `- [ ]` items; under "PR review" there are 2. `grep -c "row 10" proposal.md` is ≥ 2, and
  `grep -n "no user is assigned both" proposal.md` hits the attestation. `line-management` appears
  only in Closed items and the Review disposition table, not as an Appendix B step.
  `grep -n "scheduled date\|state = 'draft'" proposal.md` returns nothing (Engineer F2).
- [ ] 3.3 Appendix C (draft-takeover issue #MMM) states no launch gate, the decided points from
  rows 14–17, open questions, and acceptance criteria.
  **Check:** `grep -n 'Gates:\*\* none' proposal.md` hits. Appendix C has an "Open questions"
  heading with ≥ 1 numbered item and an "Acceptance criteria" heading.

## 4. Scope guard

- [ ] 4.1 Only allowed paths changed: `requirements/` (four files) and this change directory.
  **Check:** `git status --porcelain` lists nothing under `packages/`, `openspec/specs/`, `docs/` or
  other `openspec/changes/`.
- [ ] 4.2 There is no `specs/` directory in this change (design D2).
  **Check:** `test ! -d openspec/changes/238-facilitator-reporting-chain-decision/specs`.
- [ ] 4.3 Archive as a documents-only change (design D2, Engineer M6). `openspec validate --strict`
  will likely flag a change with no deltas; archive with `--skip-specs` or equivalent, as
  `2026-09-29-join-link-use-case-sync` did. This is an archive-time note, not a defect.
  **Check:** the archive command used is recorded in the #238 PR description.

## 5. After the orchestrator files the follow-up issue

- [ ] 5.1 Replace every `#NNN` (conflict-rule issue) and `#MMM` (draft-takeover issue) with the
  filed issue numbers in `RECORD`, `proposal.md` (Appendices A to C) and `design.md`, and record
  both numbers in `decision-log.md`. Cross-link the two issues on GitHub.
  **Check:** `grep -rn '#NNN\|#MMM' "$RECORD" openspec/changes/238-facilitator-reporting-chain-decision/proposal.md openspec/changes/238-facilitator-reporting-chain-decision/design.md` returns nothing.
- [ ] 5.2 Note in the #238 PR description: "AC 1: pending amendment on #235 (Appendix A.1)" and
  "VP acknowledgment pending (persona review approved with conditions; human VP sign-off owned by
  the product owner)". This is a human or orchestrator action.
  **Check:** the PR body contains both strings.
