# Tasks: 238-facilitator-reporting-chain-decision (#238)

> **Documentation-only change.** TDD doesn't apply. Run every check from the repo root. Paths with
> spaces are quoted. Shorthands:
> `RECORD="requirements/use cases/01c - Facilitator Reporting Chain - Decision.md"`,
> `P=openspec/changes/238-facilitator-reporting-chain-decision`,
> `S235=54c1e9bfd66da29d34f2e062871b4f1ead980d2f` (#235, `origin/ccr-b594efa3-9zclgu`, pinned).
>
> **Environment.** No `openspec` CLI, no `node_modules`, `gh` not authenticated. GitHub issue and
> comment steps are done by the orchestrator through the GitHub connector and are marked
> **(orchestrator)**. This branch commits per stage, so diff checks compare against `origin/main`,
> not the working tree.
>
> **Execution order:** §1 → §2 → §3 → 5.0 → 5.1 → 5.2 → 4.1 → 4.2 → 4.3 (archive, last repo
> action) → 4.4. §5 is listed before §4 for that reason.

## 1. Decision record (`01c`)

- [x] 1.1 Create `RECORD` with the **full heading skeleton** from design D1: the three-sentence
  summary (section 0, no heading) above sections 1–11 as `## ` headings. Fill in the summary
  (rule, why, what it doesn't catch) and the Status block now:
  - Decided 2026-10-04 by the user (product owner), decision-log rows 1–4, 8–11 and 13–18.
    Row 19 cited separately: "pipeline default, accepted; subject to change by the product owner".
  - Follow-on owner: the Business Analyst.
  - VP of Engineering (row 12): "Persona review (Executive Stakeholder) approved with conditions;
    human VP of Engineering acknowledgment *pending* (owner: the user, as product owner)." The
    persona review is not the VP's acknowledgment.
  - Implementation: #NNN. Draft takeover: #MMM.
  - Traceability: `Summary.md:12`, BRD §6.2 and §6.3, FR-2.1, FR-2.2, #235 Decisions 7, 9 and 12,
    #235 D3, #235 Security S4.

  **Check:** `grep -c '^## ' "$RECORD"` is exactly 11. `grep -n 'pending' "$RECORD"` hits the VP
  line. `grep -n 'row 12' "$RECORD"` and `grep -n 'row 19' "$RECORD"` hit the Status block.
  `grep -n 'Acknowledged' "$RECORD"` returns nothing.
- [x] 1.2 Write the Decision with its glossary line ("error" means never silent, not a failed
  sign-in). State that the rule supersedes #235 Decision 7 **for this pair only** and that #235
  precedence is otherwise unchanged (row 3). Write the resolved-role table: the 11 rows, identical
  to proposal Appendix B's table.
  **Check:** `grep -n 'never silent' "$RECORD"` and `grep -n 'for this pair only' "$RECORD"` hit.
  `diff <(grep -E '^\| (`|string)' "$RECORD") <(sed -n '/^## Appendix B/,/^## Appendix C/p' "$P/proposal.md" | grep -E '^> \| (`|string)' | sed 's/^> //')`
  prints nothing, and the first command alone counts 11 lines.
- [x] 1.3 Write "Why `engineering_manager`". Lead with broken EM access, then defence in depth,
  then failure direction.
  **Check:** in `grep -n 'mismatch\|defence in depth' "$RECORD"`, the first mismatch hit comes
  before the first defence-in-depth hit.
- [x] 1.4 Write "How this shows up for people":
  - the three-audience table;
  - the user is told *and* the conflict is audited (row 9);
  - audit content limited to allowlisted role names, no raw claim values; the S4 disposition;
  - the notice's contact text is the existing `APPLICATION_ADMIN_CONTACT_EMAIL`, and "contact text
    is display text, not behaviour" (row 19).

  Leave the exact copy to #NNN.
  **Check:** `grep -n 'raw role-claim' "$RECORD"` (was `'raw claim'`; changed after Security
  implementation review N1 reworded §5), `grep -n 'S4' "$RECORD"`,
  `grep -n 'APPLICATION_ADMIN_CONTACT_EMAIL' "$RECORD"` and `grep -n 'display text, not behaviour' "$RECORD"` hit.
- [x] 1.5 Write the Sessions section (rows 11, 14–19; design D5), stated as decisions:
  - drafts by a user now resolved to `engineering_manager` stay blocked at room-open; the notice
    names them;
  - a stranded draft can't be recreated in the app **while it holds the team's single open-session
    slot**;
  - **takeover** (rows 14–16): another facilitator can take over **any draft**, not only stranded
    ones, after a **confirmation prompt**, with an **audit event**. The taker passes the usual
    checks: live `facilitator` role and not a member of the team. Tracked in #MMM, a separate
    issue with **no launch gate**;
  - until #MMM ships (row 17): the **pre-launch draft check** (row 10) covers drafts that exist at
    launch; a draft stranded later is cleared by a documented, audited operator step (#NNN), after
    which a facilitator creates a new draft. The operator records **their own app user id** as
    `actor_user_id`, so the operator needs an app account (row 19);
  - draft-based team-content access requires a live `facilitator` role (row 18);
  - no reassignment feature in #NNN;
  - opened sessions stay with `sessions.facilitator_id` per #235 Decision 12, covering control,
    live events, per-voter attribution, action items and trends, 30 minutes after completion, no
    limit while non-terminal (Security S3).

  **Check:** each of these hits in `"$RECORD"`: `grep -n 'facilitator_id'`, `grep -n 'Decision 12'`,
  `grep -in 'takeover\|take.* over'`, `grep -in 'confirmation'`, `grep -in 'any draft'`,
  `grep -in 'no launch gate'`, `grep -in 'pre-launch draft check'`, `grep -n 'own app user id'`,
  `grep -n '30 minutes'`, `grep -n '#MMM'`. `grep -in 'recreat' "$RECORD"` hits only the
  "while it holds the slot" sentence. `grep -in 'reassign' "$RECORD"` hits only "no reassignment".
- [x] 1.6 Write Rejected (a)–(d), reporting-chain model first, and Residual gaps 1–6. The docs
  warning is the standing control for **gaps 1–4**; gap 5 (peer interpretation) is BA-owned; gap
  6 (interim) is closed by the launch gate (row 8). Gaps 1 and 2 are **accepted risk** (row 13):
  no pre-launch control, docs warning only; do not carry over "plus the launch-checklist
  attestation" from exploration §6. Add: a failed conflict-row insert fails the sign-in as any
  transactional audit-write failure does (#235 `auth-error-handling`); this is not rejected
  option (c).
  **Check:** `grep -n 'reporting-chain model' "$RECORD"`, `grep -n 'accepted risk' "$RECORD"` and
  `grep -n 'gaps 1–4' "$RECORD"` hit. Six numbered gaps, by read-through.
- [x] 1.7 Write sections 9–11:
  - the #238 AC disposition paragraph naming both AC 2 branches (exploration §5 wording);
  - the dependency on #235; the first-team-launch gate (row 8); the pre-launch items, which live
    in #NNN (row 10, no checklist doc);
  - the interim statement ("Until #NNN ships, the #235 warning text stands unchanged…");
  - Revisit if, three triggers; trigger 2 names "the Business Analyst and the VP of Engineering";
  - Consequences for other documents: Summary.md footnote, README index, 01 cross-reference,
    #235 A.1/A.2, docs warning via #NNN (A.3).

  **Check:** `grep -n 'stands unchanged' "$RECORD"` and
  `grep -n 'Business Analyst and the VP of Engineering' "$RECORD"` hit. Section 11 names all five
  consequences, by read-through.
- [x] 1.8 Whole-record guard: no exact notice copy, no app setting or toggle for the rule, nothing
  that makes the no-manager or other-team rule optional. Use "supersedes", not "overrides".
  **Check:** `grep -in 'toggle\|configurable\|opt out\|override' "$RECORD"` returns nothing.

## 2. Pointers and index

- [x] 2.1 `requirements/Summary.md`: add a footnote marker to line 12 and one footnote at the end
  linking `RECORD`. Sentence text unchanged.
  **Check:** `git diff -U0 origin/main -- requirements/Summary.md` shows only the marker on line 12
  and the appended footnote. `grep -n "not in the team's reporting chain" requirements/Summary.md` matches.
- [x] 2.2 `requirements/use cases/README.md`: add index rows for 01b and 01c, in that order,
  directly after the 01 row, with URL-encoded links.
  **Check:** `grep -n '^| \[01' "requirements/use cases/README.md"` shows exactly three rows, 01,
  01b, 01c, on consecutive lines.
- [x] 2.3 `requirements/use cases/01 - Identity and Access - Use Cases.md`: add one cross-reference
  line after the "Facilitator designation … (#235)" out-of-scope note (l.226) pointing to `RECORD`.
  **Check:** `grep -c '01c%20-%20Facilitator' "requirements/use cases/01 - Identity and Access - Use Cases.md"`
  is 1, and `git diff --numstat origin/main -- "requirements/use cases/01 - Identity and Access - Use Cases.md"` shows 1–2 added, 0 deleted.
- [x] 2.4 Every relative link added in 2.1–2.3 resolves.
  **Check:** a short script URL-decodes each added link target, resolves it relative to the linking
  file, and runs `test -f`. All pass.

## 3. Proposal appendices (already drafted, verify only)

- [x] 3.1 Appendix A "Before" quotes match #235 at `$S235` character for character, and A.2's
  target exists.
  **Check:** `git show "$S235:docs/deployment.md" | grep -cF "treats them as **facilitator only**"`
  ≥ 1. The Follow-up 2 "Before" text is found with `grep -F` in
  `git show "$S235:openspec/changes/facilitator-role-claim-allowlist/proposal.md"`.
  `git show "$S235:openspec/changes/facilitator-role-claim-allowlist/decision-log.md" | grep -c '^| 7 '` is 1.
- [x] 3.2 Appendix B has the launch gate, the "merged and archived" blocker, schedule and scope
  freeze lines, 12 minimum ACs, 2 pre-launch steps and 2 PR-review checkboxes.
  **Check:** `grep -n 'Gates:\*\* first-team launch' "$P/proposal.md"`, `grep -n 'merged and archived' "$P/proposal.md"`,
  `grep -n 'Scope freeze' "$P/proposal.md"` and `grep -n 'no user is assigned both' "$P/proposal.md"` hit.
  `grep -n "scheduled date\|state = 'draft'" "$P/proposal.md"` returns nothing (Engineer F2).
  By read-through: ACs 1–12, 2 pre-launch `- [ ]`, 2 PR-review `- [ ]`; `line-management` is not an
  Appendix B step.
- [x] 3.3 Appendix C states no launch gate, the decided points from rows 14–17, open questions and
  acceptance criteria.
  **Check:** `grep -n 'Gates:\*\* none' "$P/proposal.md"` hits. By read-through: an "Open
  questions" heading with ≥ 1 item and an "Acceptance criteria" heading.

## 5. Issues, placeholders and the #235 link (runs before §4)

- [ ] 5.0 **(orchestrator)** File the two issues and cross-link them:
  1. File Appendix C as the draft-takeover issue → number `M` (its body still says `#NNN`).
  2. File Appendix B as the conflict-rule issue with `#MMM` replaced by `#M` → number `N`.
  3. Edit issue `M`'s body, replacing `#NNN` with `#N`.
  4. Read both bodies back through the connector and confirm: no `#NNN`/`#MMM`; `N` contains the
     launch gate, ACs 1–12, the 2 pre-launch steps and the 2 PR-review checkboxes; `M` contains
     "Gates:** none", the decided points (rows 14–17) and its acceptance criteria (#238 AC 2).

  **Check:** the connector read-back passes for both bodies. Pass `N` and `M` to 5.1.
- [ ] 5.1 Replace `#NNN` → `#N` and `#MMM` → `#M` in `RECORD`, `$P/proposal.md` and `$P/design.md`.
  The sentences that *describe* the placeholders are reworded, not substituted:
  `proposal.md` Appendix A intro ("Replace `#NNN` with…"), `design.md` Context (the "are
  placeholders until the orchestrator files them" paragraph) and the `design.md` Risks bullet on
  placeholders. Add a decision-log row recording both issue numbers.
  **Check:** `grep -n '#NNN\|#MMM\|NNN\|MMM' "$RECORD" "$P/proposal.md" "$P/design.md" "$P/decision-log.md"`
  returns nothing, and `grep` exits 1, not 2 (so no file is missing).
- [ ] 5.2 **(orchestrator)** #238 AC 1. #235's branch can't be pushed from this session, so post a
  comment on #235 with the Appendix A.1 and A.2 paste-ready text (real numbers in), noting the
  applier adjusts the A.1 link's `../` depth if #235 is archived by then. Post a comment on #238
  pointing to `RECORD` and the #235 comment. Both comments say "Decided by the product owner
  (human VP of Engineering acknowledgment pending)", never anything that reads as VP sign-off. Add a decision-log row: "AC 1 pending: #238 stays open
  until A.1 is applied to #235."
  **Check:** both comments are readable through the connector; `grep -n 'stays open' "$P/decision-log.md"` hits.

## 4. Scope guard and archive

- [ ] 4.1 Only allowed paths changed: exactly 4 files under `requirements/` (`RECORD`, `Summary.md`,
  the use-cases README, 01) plus `$P/`.
  **Check:** `git diff --name-only origin/main...HEAD; git status --porcelain` lists nothing else.
- [ ] 4.2 No `specs/` directory in this change (design D2).
  **Check:** `test ! -d "$P/specs"`.
- [ ] 4.3 Archive as a documents-only change, last repository action. `openspec` can't run, so:
  add a decision-log row "Archived by manual `git mv`; openspec validate not run (CLI unavailable;
  no deltas by design, D2)", then
  `git mv "$P" openspec/changes/archive/2026-10-04-238-facilitator-reporting-chain-decision`.
  **Check:** `test -d openspec/changes/archive/2026-10-04-238-facilitator-reporting-chain-decision && test ! -d "$P"`.
  `grep -n 'validate not run' openspec/changes/archive/2026-10-04-238-facilitator-reporting-chain-decision/decision-log.md` hits.
- [ ] 4.4 **(orchestrator)** #238 PR description, edited once: "AC 1: pending amendment on #235
  (Appendix A.1), comment <link>; #238 stays open until applied"; "VP acknowledgment pending
  (persona review approved with conditions; human VP sign-off owned by the product owner)"; #235
  compared at `54c1e9bf`; "openspec validate not run; archived by manual `git mv`".
  **Check:** connector read of the PR body contains all four.

## Task review disposition

| Finding | Disposition | Where |
|---|---|---|
| Arch C1: archive before placeholder replacement | Accepted (preferred fix) | Execution order; 5.0–5.2 before §4; 4.3 last |
| Arch C2: 5.1 check can't pass | Accepted | 5.1 rewords the three self-describing sentences; grep must exit 1 |
| Arch O1: heading count | Accepted | 1.1 writes the skeleton; exactly 11 |
| Arch O2: filing is not a task; chicken-and-egg | Accepted | 5.0, filing C then B then editing C |
| Arch O3: A.1 link depth after #235 archive | Accepted | 5.2 comment note |
| Arch O4/O6: 4.1 order; PR body edits | Accepted | 4.1 after §5; one PR task, 4.4 |
| Arch checks: working tree, relative paths, moving branch, `openspec` CLI | Accepted | `origin/main` diffs, `$P`, `$S235`, manual `git mv` |
| Arch minors: 'Nothing' grep, 'override', 'recreat', 2.2 order, row 19 | Accepted | 'Nothing' dropped; 1.8 uses "supersedes"; 1.5 wording; 2.2 exact rows; 1.4/1.5 |
| BA C1: rows 14, 15, 17 thinned out | Accepted | 1.5 |
| BA C2: row 19 missing | Accepted, modified | 1.1, 1.4, 1.5. Proposal "rows 1–18" not changed: rows 1–18 are the user's decisions; row 19 is a pipeline default and is cited separately |
| BA C3: "for this pair only" | Accepted | 1.2 |
| BA C4: AC 1 has no task | Accepted, modified | #235's branch can't be pushed here, so 5.2 posts A.1/A.2 as a comment and #238 stays open. Conditional in-PR apply dropped (#235 isn't on `main`) |
| BA C5: filed bodies unchecked | Accepted, modified | 5.0 step 4 uses the connector, not `gh api` (unauthenticated) |
| BA S1: "can't be recreated" too absolute | Accepted | 1.5 "while it holds the slot"; operator step then "creates a new draft" |
| BA S2: cite row 12 | Accepted | 1.1 |
| BA S3: section 11 has no task | Accepted | 1.7 |
| BA S4: standing control for gaps 1–4 | Accepted | 1.6 |
| BA S5: table identical to Appendix B | Accepted | 1.2 `diff` check |
| BA S6: 4.1 allow #235 paths | Not needed | No #235 files are edited in this change |
