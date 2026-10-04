# Tasks Review — Solution Architect

*Ingrid Sollenberger (Principal Solution Architect). Reviewed `tasks.md` against `design.md`,
`proposal.md` and `decision-log.md` rows 1–19. Focus: dependency order, and whether each check can
actually be run here (no `openspec` CLI, no `node_modules`, `gh` not authenticated, per row 7).*

**Verdict: approve with conditions.** The content tasks (§1–§3) are in a sensible order and trace
cleanly to D1–D8 and the decision log. The problems are all at the end of the lifecycle. §4.3
(archive) comes before §5 (placeholder replacement), but §5 edits files that archive moves. Several
checks also assume an uncommitted working tree. Two conditions (C1, C2) must be fixed before
apply; the rest are should-fix.

---

## Conditions (must fix before apply)

### C1. Archive (4.3) is ordered before placeholder replacement (5.1); 5.1 then edits archived files

§5 runs "after the orchestrator files the follow-up issue", and the orchestrator files after
archive. But 5.1 rewrites `proposal.md`, `design.md` and `decision-log.md` *in this change
directory*. By then, 4.3 has moved them to `openspec/changes/archive/2026-10-04-238-…/`, so:
- 5.1's check greps paths that no longer exist. `grep` exits 2 with "No such file" and prints
  nothing on stdout, so it reads as a **false pass**.
- 5.1 edits an archived change. That is the practice design D3 (Engineer F5) rules out for #NNN
  against #235: "#NNN must not edit an archived `proposal.md`". We should hold ourselves to the same
  rule.
- 4.1's scope guard has already run, so the §5 edits are never scope-checked.

**Fix (choose one, and say which in tasks.md):**
- **(preferred)** The orchestrator files #NNN and #MMM **before** archive. Reorder to §1 → §2 → §3
  → file issues → §5 → §4 (scope guard, then archive last). Archive then captures final text and
  needs no later edits.
- If issues must be filed after archive: limit 5.1 to `RECORD` (in `requirements/`, not archived)
  and the GitHub issue bodies. Leave the archived artifacts with placeholders, and add one line to
  `RECORD` mapping placeholder → number. 5.1's check must then name the archive path and fail
  loudly when a file is missing (`test -f` each path first).

### C2. 5.1's check can never pass as written

`proposal.md:246` reads "Replace `#NNN` with the follow-up issue number once it's filed." The
`design.md:20-21` and `:236-237` lines explain that `#NNN`/`#MMM` *are* placeholders. A blanket
replace makes those sentences nonsense; skipping them makes the grep fail. 5.1 should say these
three instruction sentences are **reworded or removed**, not substituted. The check should allow
zero hits only after that rewording.

---

## Ordering and dependency findings (should fix)

| # | Task | Problem | Recommendation |
|---|---|---|---|
| O1 | 1.1 | The check `grep -c '^## ' ≥ 10` needs sections that 1.2–1.7 write. Run at 1.1's completion, it fails unless 1.1 writes every heading. | Say 1.1 creates the **full heading skeleton** (D1 sections 1–11) with Status and summary filled in. Or move the `≥ 10` check to 1.8 as a whole-record check. Section 0 (summary) has no `##` heading, so the count is 11 headings, not 12. State the expected number exactly. |
| O2 | §5 (missing step) | Filing the issues is not a task, but §5 depends on it. The heading says "issue" (singular) when there are two. Appendix B references `#MMM` and Appendix C references `#NNN`, a chicken-and-egg: whichever is filed first carries a placeholder in its GitHub body. | Add task 5.0 (orchestrator): (a) file B as #NNN, (b) file C as #MMM with `#NNN` substituted, (c) **edit #NNN's body** to substitute `#MMM`. "Cross-link on GitHub" in 5.1 is really step (c) plus a comment, so make it explicit. Check: `gh issue view` / GitHub MCP shows no `#NNN`/`#MMM` in either body. |
| O3 | 2.4 vs A.1 link | 2.4 checks only the links added in 2.1–2.3. Appendix A.1 adds a link (`../../../requirements/use%20cases/01c…`) that will live in #235's `proposal.md`. That depth is right only while #235 sits at `openspec/changes/facilitator-role-claim-allowlist/`. Per D3, A.1 is applied "by whoever merges second". If #235 is **archived** by then, the file is one level deeper and the link breaks. | Add to 3.1 (or a new 3.4): a note in A.1 that the applier adjusts `../` depth when #235 is archived, plus a resolver check run against the actual target path at apply time (`realpath -m` relative to the target file, then `test -f`). Not something this change can verify now, so state it as a PR-description item next to 5.2. |
| O4 | 4.1 | Runs before §5 edits (see C1), so it does not cover them. | Make 4.1 the second-to-last task, after §5 and before archive. |
| O5 | §3 | Verify-only, depends on nothing in §1–§2. | No reorder needed. It could run first, since an appendix defect found early may change `RECORD` wording (1.4, 1.5 and 1.7 quote it). Optional. |
| O6 | 5.2 | Needs an open #238 PR; `gh` is unauthenticated (row 7). 4.3's check also writes to the PR description. | Mark 4.3's check and 5.2 as **orchestrator/human** actions, like 5.2 already says. Merge them into one "PR description" task so the PR body is edited once. |

---

## Checks that can't run as written in this environment

| Task | Check | Why it fails or misleads | Replacement |
|---|---|---|---|
| 2.1 | `git diff -U0 requirements/Summary.md` | Empty once the work is committed (this branch commits per stage), so it gives a false "only the marker changed". | `git diff -U0 origin/main -- requirements/Summary.md` |
| 2.3 | `git diff --stat` | Same: working-tree only. | `git diff --stat origin/main -- "requirements/use cases/01 - Identity and Access - Use Cases.md"` |
| 4.1 | `git status --porcelain` | Same: lists nothing after commit, so it passes trivially. | `git diff --name-only origin/main...HEAD` plus `git status --porcelain`. Assert every path is under `requirements/` (exactly 4 files: RECORD, Summary.md, use cases README, 01) or `openspec/changes/238-…/`. |
| 3.2, 3.3 | `grep … proposal.md` | Relative path, but the header says "run from the repo root". | Use the full `openspec/changes/238-facilitator-reporting-chain-decision/proposal.md`, or a `P=` variable like `RECORD`. |
| 3.2 | "12 numbered items", "2 `- [ ]` items", "`line-management` only in Closed items…" | Read-through, not a command. Acceptable, but say so. I counted: ACs 1–12 present, PR review 2, pre-launch 2. It passes today. | Mark these "by read-through", as 1.6 does. |
| 3.1 | `git show origin/ccr-b594efa3-9zclgu:…` | Runs today (1 hit). But it compares against a **moving** branch: #235 can change its warning after this check and A's "Before" text silently goes stale. | Record the #235 commit SHA verified against in the PR description, and check against that SHA. |
| 4.3 | `openspec validate --strict` / archive `--skip-specs` | No `openspec` CLI and no `node_modules`; neither can run. The precedent (`archive/2026-09-29-join-link-use-case-sync`) does **not** record which command it used, so "as the precedent did" can't be verified either. | State the actual method: a manual `git mv` to `openspec/changes/archive/2026-10-04-238-facilitator-reporting-chain-decision/`, with no `specs/` sync (consistent with D2). Check: `test -d` on the archive path and `test ! -d` on the old one. Record "validate not run: CLI unavailable; no deltas by design (D2)" in the PR description. |
| 1.1 | Status line contains `#NNN` | Fine at 1.1, but the record's Status is user-facing. | Covered by C1/C2. Just make sure `RECORD` is in 5.1's grep (it is). |

---

## Smaller points

- **1.4 `grep -n 'Nothing'`** isn't tied to any stated requirement in the task text (presumably a
  cell in the three-audience table). Say which sentence it proves, or drop it. A check nobody
  can explain gets "fixed" by adding the word.
- **1.8 `grep -in '…override'`** will also hit a legitimate "admin precedence overrides" style
  sentence. Row 3 uses "supersedes", so prefer that wording in `RECORD` and keep the grep. Worth one
  line of guidance in 1.8.
- **1.5 `grep -in 'recreat'`.** Row 14 replaced "recreate" and design D5 says "not recreated". The
  check allows exactly that statement. Good, but D5's own "Another facilitator then creates a new
  draft" (after the operator step) is the one legitimate "recreate" flow. Make sure 1.5's wording
  says *creates a new draft after the operator step*, not "recreates", so the check still holds.
- **2.2.** The README currently has no 01b row either (0 hits today), so `≥ 2` is meaningful. Make
  it `= 2`, and check the order: the 01b and 01c rows come directly after the 01 row (`grep -n` line
  numbers consecutive).
- **Row 19** (operator records their own app user id; notice reuses
  `APPLICATION_ADMIN_CONTACT_EMAIL`) has no task tying it to `RECORD`. If 01c's Sessions section
  describes the interim operator step (1.5), it should carry row 19's actor rule, or say it is left
  to #NNN's docs. Add the row-19 reference to 1.5's list, plus a grep for `actor_user_id` or "own
  app user id".
- **1.1 Status** cites decision-log rows "1–4, 8–11 and 13–18". Row 19 is a pipeline default the
  user may override, so excluding it from "decided by the user" is correct. Keep it that way, but
  cite row 19 separately where it is used (above).

---

## Recommended final order

1. §1 (with O1 fix) → §2 → §3 (paths fixed).
2. **5.0** orchestrator files #NNN and #MMM and cross-substitutes their bodies (O2).
3. **5.1** replace placeholders in `RECORD`, `proposal.md`, `design.md`, and record numbers in
   `decision-log.md`. Reword the instruction sentences (C2).
4. **4.1** scope guard against `origin/main`, then **4.2**.
5. **4.3** archive (manual move, documented), last repository action.
6. **5.2 + 4.3's PR note + O3 + 3.1 SHA**: one PR-description task, human/orchestrator owned.

If the orchestrator truly can't file issues before archive, use the C1 fallback, and record in
`decision-log.md` as a new row that the archived artifacts keep placeholders by design.
