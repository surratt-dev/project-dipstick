# BA review of exploration notes (#296) - Marcus Delgado

Verdict: the exploration is strong on analysis and weak on pinned-down deliverables. The threat content is specific enough to write from. The edit instructions, the verifiability claims, and several scope decisions are not yet specific enough to carry into a proposal. I spot-checked the repo to ground the points below.

## A. Verified facts (safe to carry forward)

- `requirements/High-Level Architecture.md`: section 8.1 "Threat Model Summary" is at line 522, a 7-row, 3-column table (`Threat Category | Description | Primary Controls`). 8.2 "Controls by Layer" is at line 536, and its **API Authorization** group is at line 548 with 3 bullets. 8.3 Audit Logging and 8.4 Pre-Production Security Review follow. There is no 8.1.1 today.
- BRD.md:629 is SEC-31.
- All three test files exist under `packages/backend/src/routes/__tests__/`: `assign-defaults-lock-gate-source.test.ts`, `assign-defaults-concurrency-integration.test.ts`, `zero-topic-invariant-integration.test.ts`.
- `docs/deployment.md` line 335 has "Zero-topic teams" and already says "the expected count is 0".
- The handler is at `packages/backend/src/routes/topics.ts` line 1166 (the notes' "~1164" is fine, but see C1).

## B. Vague areas that cannot go into a proposal as written

1. **"Add rows... and a short new subsection (about 10 to 14 lines)".** A line budget is not an acceptance condition. The proposal needs a per-item checklist (see D).
2. **Two table rows, "if maintainers prefer one row...".** This is an undecided choice presented as a recommendation. Pick one. My ruling: add the **first** row only. The second row ("single-role compromise") duplicates the existing "Insider access" row in spirit, and its stated controls ("audit trail with before/after for template writes") are unverified in the notes. The notes themselves say "do not invent controls". Cover single-role compromise in the subsection as a residual-risk statement.
3. **"Verify this wording against the actual test names before landing."** (8.2 bullet.) This pushes a known-checkable item to the implementer. I checked it. The source test asserts the assign-defaults route does not call the gate and that the four gated routes do (describe: "the customization lock has exactly one carve-out"). It has 3 `it` blocks (non-vacuous scan, assign-defaults does not call the gate, splitter self-test). The proposed wording "fails if the carve-out set changes" is likely stronger than the test. Note: the notes' own table (section 3) says the test checks the four gated endpoints call the gate, but the three visible `it` titles only mention scan, assign-defaults, and splitter. The implementer must read lines 50-100 and match the claim to what is asserted. Required in the spec: the 8.2 bullet may only say what the assertions say.
4. **"Check `requirements/use cases/08*` and the Security Analyst persona only for contradictory 'no bypass' language."** This is an open-ended search with no done-state. Specify the grep (for example, case-insensitive `no bypass|bypass|cannot be (changed|added)|including admin` across `requirements/`) and the outcome: either "no contradiction found, no edit" recorded in the change's tasks, or a named list of lines to amend. The notes also say the use case was already amended in #200 D2, so the check should be a verification, not a search.
5. **Item 4 (`docs/deployment.md` pointer) "optional... cut if it grows".** An optional item is a scope hole. Decide in or out. Recommendation: **out**. The issue is about the threat model, and the existing sentence already says expected 0. If the maintainers want it, it is a one-sentence pointer with a defined target anchor ("HLA section 8.1.1").
6. **"Land S-B here, others as a follow-up", "I lean yes".** (Section 6 and open question 2.) This is scope left to the author's mood. It also creates a traceability problem: S-B is not part of #296's stated ask. Decide in the proposal. My recommendation is to keep #296 to its stated ask and file one follow-up issue covering S-B, N-A and N-D. S-B (denial-row sampling limits) is already needed by #296 as a residual-risk item (item 5 of section 4), so the subsection will state it for the assign-defaults path regardless. That state-it-for-this-endpoint treatment is enough. Do not generalise it into a "denial audit" threat-model section here.
7. **Open question 1 (accept vs reopen-trigger for template-rewrite-then-assign).** The notes say "none blocking" but the answer changes the text of the subsection (is it an "accepted risk" or a "reopen trigger"?). Resolve it in the proposal: record it as accepted, with the reopen trigger. Name who accepted (the product owner, per #208). If acceptance has not actually been given for the *chained* path, the text must say "accepted under #208's trusted-role decision; the chained path is recorded as a reopen trigger", not "accepted by PO".
8. **Residual risk "low".** The notes agree with Tomás's rating but add a qualification. The proposal must state the rating *and* its basis in one sentence, and say it is not a preventive rating. Otherwise the table row will be read as "controls prevent this".
9. **"Expected population near zero / expected none".** Unverifiable claim. Specify: the text says "expected: none" and cites `docs/deployment.md` "Zero-topic teams", and does not state a number. This part of the notes is fine; just make it a stated requirement, not an open question (open question 3 can be closed).
10. **Framing 3 (nuisance/sabotage)** says "not a supported state; legacy/data-fault only". Section 4 item 8 says the endpoint also accepts on an unlocked zero-topic team. These are inconsistent about whether the lock is even engaged for the realistic case. The subsection must say which states the endpoint accepts (locked and zero-active; unlocked and zero-active) so "carve-out" is not overclaimed. Item 8 should be a stated precondition line, not "mention only if the doc enumerates preconditions".

## C. Verifiability gaps (claims the doc will make that no one has checked)

1. **Route reference.** The notes cite `topics.ts ~line 1164`. A threat-model document must not carry line numbers (they rot). Cite the route path and file only. The handler comment block at line 921 and 1133 confirms the feature name.
2. **Control table (section 3) is "verified against the archived design and security reviews; I did not re-run tests".** The proposal's acceptance must not inherit that hedge. Required: before landing, the implementer confirms each cited identifier exists in the code: `isApplicationAdmin`, `checkCustomizationLockGate`, `enforceTopicWriteRateLimit`, `auth/denial-audit-limiter.ts`, `auth/assign-defaults-audit.ts` (the notes cite only the limiter; `topics.ts` imports `auth/assign-defaults-audit.js`, which the notes never mention), the audit operation names `topic.defaults_assigned`, `topic.defaults_assign_denied`, `topic.defaults_assign_failed`, `topic.write_denied_template`, `topic.denial_audit_suppressed`, and the limits 120/10 min and 400/day. The threat model should cite *mechanisms by name*, and not cite limit numbers unless they are read from config at write time (numbers drift).
3. **`zero-topic-invariant-integration.test.ts`.** Security flagged its per-path coverage as unverified. I read the test titles: two `it` blocks (a locked team with one active topic where every structural write is refused, and an unlocked team where archiving the last topic is `TOPIC_LAST_ACTIVE`). Neither title says "no admin API sequence". The claim "permanent invariant test that no admin API sequence takes a locked team to zero active topics" is therefore **not yet supported**. The proposal must either (a) have the implementer read the bodies and word the claim to match (for example "refuses add, restore, archive and reorder on a locked one-topic team"), or (b) drop the test as a cited control. It cannot ship as drafted.
4. **`assign-defaults-concurrency-integration.test.ts`** is cited for "two racers serialize, second gets 409". Confirm the name and assertion; same rule as C3.
5. **`#131` reference.** Confirm it is still open on the day of landing, and say "open at time of writing" in the text.
6. **"Each hop is audited" (framing 2).** The template-write audit (#216) is cited in the second row ("before/after") but is verified nowhere in the notes. Either confirm the #216 audit op name and metadata, or say only "audited" with the op name.

## D. Suggested acceptance conditions (concrete, testable by reading the diff)

Write these into the proposal's spec/tasks. All are checkable by `git diff --stat` and `grep`.

1. **Diff scope.** `git diff --stat main` shows changes only under `requirements/High-Level Architecture.md` and `openspec/changes/296-*/`. No file under `packages/`, no `docs/`, no BRD, no `requirements/use cases/`, unless the C/B4 check names a contradiction.
2. **8.1 table.** Exactly one new row appended below "Dependency vulnerability" (or after "Insider access"; pick and state), with three cells. Row name contains "topic" and "lock" and "carve-out". Description names the endpoint `POST /api/v1/teams/:teamId/topics/assign-defaults`. The Primary Controls cell lists only mechanisms verified under C2. The existing 7 rows are byte-identical.
3. **New heading** `### 8.1.1 Privileged topic-write paths` placed between the 8.1 table and `### 8.2`. It contains each of these, as separate labelled lines or bullets:
   a. the carve-out and its precondition (zero active topics; states accepted: locked and unlocked);
   b. what it can write (copy of the template's current active rows, nothing caller-supplied) and what it cannot do (not unlock, not alter an existing active set, not touch in-progress `session_topics`);
   c. the trust relationship (any `application_admin`, including a member of the target team; cites #208 / `08b - Member Admin Topic Writes - Decision.md`);
   d. the template dependency (#216 chain), stated as "the bound is whatever the template holds";
   e. the residual risk rating (low) with the one-sentence basis;
   f. the list of residual caveats: detective not preventive; no monitoring consumer (#131); `audit_log` is modifiable by the application DB role and no tamper evidence is claimed; denial rows sampled and absent on Redis outage; `actor_ip` depends on `trustProxy`; the generic 500 has no durable row;
   g. reopen triggers: the five listed in the notes, verbatim as a list.
4. **8.2.** One bullet added under **API Authorization**, no other 8.2 change. Its wording is no stronger than what `assign-defaults-lock-gate-source.test.ts` asserts, and it names that file.
5. **Test-citation rule.** Every test file named in the HLA text exists at the cited path (`ls`), and the sentence describing it matches an `it(...)` title or assertion in that file. List the three files and the verified claim for each in the change's tasks.
6. **No over-claim sweep.** `grep -n -i "prevent\|cannot\|impossible\|guarantee" ` on the added text: each hit is reviewed and either supported by a code reference or removed. In particular, no sentence says the carve-out is "safe" or that admins "cannot" do anything the code does not structurally block.
7. **Unchanged sections.** 8.3 and 8.4 untouched. BRD SEC-31 untouched (HLA 8.4 / SEC-31 revisit language is not edited).
8. **Traceability.** The change names #296 in the proposal, links to #200 / #208 / #216 / #271 / #131 in the subsection (as plain issue references, not URLs), and the proposal states the explicit out-of-scope list from the notes (audit_log revoke, #131 monitoring, step-up auth, code changes, S-B/N-A/N-D follow-up).
9. **Reviewer sign-off.** Security (Tomás) confirms the residual-risk rating and the reopen triggers. The BA confirms that "locked team", "zero active topics" and "first_session" are used consistently with the use-case terminology (see E1).

## E. Clarifications needed (questions with my proposed answer)

1. **Terminology.** The notes use "locked", "first_session", "customization lock", and "zero active topics" interchangeably. Which terms does the HLA use elsewhere? Proposed: use the use-case/BRD wording for the lock, and mention `first_session` once as the design-state name.
2. **Who is the audience of 8.1.1?** The HLA section is authored by the Security Analyst, but readers include engineers at pre-production review (8.4). Proposed: write for the reviewer who has not read #200, so define "carve-out" on first use and do not require the reader to open the archived changes.
3. **Is this an HLA-only change or a spec change?** An OpenSpec change normally implies a delta spec. Proposed: state in the proposal "documentation only; no capability spec delta" so the pipeline does not wait for one.
4. **Does #296's issue text require exactly the #200 sentence?** The notes quote the sentence from #200's review section 4. Proposed: include that sentence (or a close paraphrase) verbatim so the issue's ask is demonstrably met, and list it as acceptance item D3a-b.
5. **Framing 3 (race a legitimate repair).** Is a legitimate repair path documented (the `docs/deployment.md` "one-off repair" needing a PO decision)? If so, say how the legitimate path differs (PO decision, then the same endpoint?). Otherwise the "race" framing has no baseline.
6. **Persona note from my side (edge cases).** Topic history preservation and the "zero sessions" state are mine to guard: confirm in 8.1.1 that assigning defaults to a team with *archived* topics does not resurrect their history (the endpoint counts only active topics, so archived rows presumably remain). This is a scenario the notes do not cover. Ask the implementer to confirm from `assign-defaults-concurrency-integration.test.ts` or the handler, and either state it or drop it.

## F. Suggested rewrites

Table row (replaces the notes' two rows):

> | Privileged topic-lock carve-out | An `application_admin` (or an attacker holding an admin session) writes topics into a team whose topic customization is locked, via the single lock carve-out `POST /api/v1/teams/:teamId/topics/assign-defaults`, which is accepted only for a team with zero active topics | Live role check per request; zero-active precondition checked under the per-team advisory lock; copies the default template only (no caller-supplied source or text); success audit row written in the same transaction; denial and failure audit rows; per-actor topic-write limiter; source and integration tests listed in 8.2 |

Reopen-trigger sentence (tighten the notes' list):

> This assessment must be revisited if any of the following occurs: a second exception to the topic customization lock is introduced; any topic-writing endpoint accepts text from a caller-supplied source (copy from another team, partial top-up, custom text); anyone other than an `application_admin` (for example a facilitator or manager) is allowed to trigger assign-defaults; security or compliance requires a second approver or step-up authentication for admin writes; or the number of zero-active-topic teams is found to be non-trivial.

Residual-risk sentence:

> Residual risk is rated low. That rating rests on the expected affected population being none and on `application_admin` already being an accepted trusted role (#208), not on the controls being preventive: the controls are detective, and the audit trail is the only record.

Acceptance line for the proposal (replaces the notes' last paragraph in section 6):

> The change is accepted when conditions D1 to D9 hold, every control and test cited in the new text has been confirmed against the code on the day of landing, and no sentence claims more than the cited code or test asserts.

## G. Summary of decisions the proposal must make (so none are left "open")

| # | Decision | Recommended |
|---|---|---|
| 1 | One table row or two | One |
| 2 | S-B / N-A / N-D | None in #296; one follow-up issue; S-B limit stated for this endpoint only |
| 3 | `docs/deployment.md` pointer | Out |
| 4 | Chained template path | Accepted under #208, plus reopen trigger |
| 5 | Zero-topic population wording | "Expected: none", cite deployment.md |
| 6 | Cite `zero-topic-invariant-integration.test.ts` | Only with wording matched to its two `it` titles after a body read |
| 7 | Use-case/persona contradiction check | A defined grep, outcome recorded, no edit unless a contradiction is found |
