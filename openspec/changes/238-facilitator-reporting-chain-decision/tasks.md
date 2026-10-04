# Tasks: 238-facilitator-reporting-chain-decision (#238)

> **Documentation-only change.** TDD doesn't apply. Each task ends with a check you can run from
> the repo root. Paths containing spaces are quoted. `RECORD` below means
> `"requirements/use cases/01c - Facilitator Reporting Chain - Decision.md"`.

## 1. Decision record (`01c`)

- [ ] 1.1 Create `RECORD` with the section order from design D1. The Status block:
  - Decided 2026-10-04 by the user (product owner), decision-log rows 1–4 and 8–11.
  - Follow-on owner: Marcus Delgado (BA).
  - VP of Engineering acknowledgment: *pending*.
  - Implementation: #NNN.

  Include a traceability header citing `Summary.md:12`, BRD §6.2 and §6.3, FR-2.1, FR-2.2, #235
  Decisions 7, 9 and 12, #235 D3, and #235 Security S4.
  **Check:** `test -f "$RECORD"`. Also, `grep -c '^## ' "$RECORD"` is ≥ 10, and `grep -n 'pending' "$RECORD"` hits the VP line.
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
- [ ] 1.5 Write the Sessions section (row 11):
  - drafts stay blocked at room-open and are recreated by another facilitator;
  - the notice names them;
  - there is no reassignment feature;
  - opened sessions stay with `sessions.facilitator_id` per #235 Decision 12.

  State this as a decision.
  **Check:** `grep -n 'facilitator_id' "$RECORD"` and `grep -n 'Decision 12' "$RECORD"` return hits.
  `grep -in 'reassign' "$RECORD"` appears only in a "no reassignment" statement.
- [ ] 1.6 Write Rejected (a) to (d), with the reporting-chain model first, and Residual gaps 1–6, with the
  docs warning as the standing control and the BA-owned peer interpretation.
  **Check:** `grep -n 'reporting-chain model' "$RECORD"` returns a hit. `grep -c '^[1-6]\. \*\*' "$RECORD"` is ≥ 6, or count by section read-through.
- [ ] 1.7 Write the following:
  - the #238 AC disposition paragraph;
  - the dependency on #235;
  - the first-team-launch gate (row 8);
  - the pre-launch items, which live in #NNN (row 10, no checklist doc);
  - the interim statement ("Until #NNN ships, the #235 warning text stands unchanged…");
  - Revisit-if, with three triggers.

  **Check:** `grep -n 'first team' "$RECORD"`, `grep -n 'Revisit' "$RECORD"` and `grep -n 'stands unchanged' "$RECORD"` return hits.
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
- [ ] 3.2 Appendix B contains the launch gate, the 11 minimum ACs and the 3 pre-launch steps.
  **Check:** `grep -n 'Gates:\*\* first-team launch' proposal.md` hits. Under "Minimum acceptance criteria" there are 11
  numbered items. Under "Pre-launch steps" there are 3 `- [ ]` items.

## 4. Scope guard

- [ ] 4.1 Only allowed paths changed: `requirements/` (four files) and this change directory.
  **Check:** `git status --porcelain` lists nothing under `packages/`, `openspec/specs/`, `docs/` or
  other `openspec/changes/`.
- [ ] 4.2 There is no `specs/` directory in this change (design D2).
  **Check:** `test ! -d openspec/changes/238-facilitator-reporting-chain-decision/specs`.

## 5. After the orchestrator files the follow-up issue

- [ ] 5.1 Replace every `#NNN` with the filed issue number in `RECORD` and in `proposal.md`
  (Appendix A.1 to A.3), and record the number in `decision-log.md`.
  **Check:** `grep -rn '#NNN' "$RECORD" openspec/changes/238-facilitator-reporting-chain-decision/proposal.md` returns nothing.
- [ ] 5.2 Note in the #238 PR description: "AC 1: pending amendment on #235 (Appendix A.1)" and
  "VP acknowledgment pending". This is a human or orchestrator action.
  **Check:** the PR body contains both strings.
