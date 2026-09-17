# Tasks Review — Business Analyst (Marcus Delgado)

**Change:** escalation-contact-mechanism
**Reviewing:** tasks.md against proposal.md, design.md, and the two spec deltas
**Prior context:** I reviewed exploration and proposal for this change already (see `explore-review-ba.md`, `propose-review-ba.md`). This pass is specifically to check that the tasks — and the design decisions that evolved since propose — actually land in buildable, testable work items, not just in prose.

## Bottom line

Close. This is a well-decomposed task list and section 6.2 (self-check against delta spec scenarios) shows the author was already thinking about traceability, which I appreciate. I found two gaps worth closing before implementation starts — one a missing test-task enumeration, one a regression risk in how an existing test block gets rewritten — plus confirmation that the newer design decisions (viewer-state gating, `AdminContact` type, expanded-scope security reconfirmation) all made it into tasks correctly. Neither gap is a blocker on its own, but I'd rather they get an explicit line item than rely on "probably covered by the general rewrite."

## Scenario-by-scenario trace

### `specs/role-assignment/spec.md` (TEAM-005) — 5 scenarios

| Scenario | Task coverage |
|---|---|
| Single EM → EM is the contact | 4.1 (impl), 5.2 (test) ✓ |
| Multiple EMs → all EMs, comma-separated | 4.1 (impl), 5.2a (test) ✓ |
| No EM → falls back to Application Admin | 4.2 (impl), 5.3 (test) ✓ |
| No EM + zero real Admin → zero-admin fallback | 4.3 (impl), 5.5 (test, TEAM-005 half) — see Gap 1 below |
| Sees explanation, not grayed-out control | No dedicated task — see Gap 2 below |

### `specs/manager-team-association/spec.md` (TEAM-006) — 3 scenarios

| Scenario | Task coverage |
|---|---|
| At least one real Admin → name(s) + mailto shown | 3.1 (impl) — no dedicated *test* task — see Gap 2 |
| Zero real Admin → zero-admin fallback | 3.2 (impl), 5.5 (test, TEAM-006 half) ✓ |
| Never resolves to an EM | 3.3 (impl), 5.6 (test) ✓ |

The multi-EM case (Context bullet 6 / Decision 2), the TEAM-005/TEAM-006 stacked case (proposal.md, "Not in scope" paragraph and design.md §Decision 2), and the "never resolves to an EM" guard (Q2 protection) are each named individually in tasks with their own test case (5.2a, 5.4, 5.6 respectively) — good, these were exactly the scenarios flagged as easy to lose in translation and they're intact.

## Gaps

**Gap 1 — task 5.5's TEAM-005 zero-admin case doesn't restate its own precondition.** The spec scenario "TEAM-005 escalation shows the zero-admin fallback" requires *both* "no EM associated" *and* "only System admin exists." Task 5.5 only names the second half ("zero-Application-Admin fallback"). It's logically implied — if an EM were associated, the EM branch would fire first and the admin query would never matter — but task 5.4 (the stacked case) shows the author was willing to spell out compound preconditions explicitly elsewhere. I'd add "(with no EM associated)" to 5.5's TEAM-005 half so a test-writer doesn't build the fixture with an EM present by accident and get a passing test for the wrong reason.

**Gap 2 — TEAM-006's baseline "admin contact resolves and renders" case has no enumerated test task.** Every other permutation in this change — single EM, multi-EM, no-EM, stacked, zero-admin ×2, never-EM, multi-admin-single-line — got its own numbered task (5.2 through 5.7). The one that didn't is arguably the most load-bearing: "at least one real Application Admin exists → TEAM-006 shows name + mailto." Task 5.1 (rewrite the describe block generally) probably exercises this as a side effect, but it's the only scenario in either spec delta resting entirely on "probably covered by the general rewrite" rather than a named task. I'd add one line, something like: "5.1a Add a TEAM-006 baseline test: one or more real Application Admins → contact renders as name(s) + mailto link(s)." Same concern extends to the role-assignment spec's "sees explanation, not grayed-out control" scenario — that one's arguably pre-existing coverage that predates this change, so lower priority, but worth a sentence in 5.1's scope confirming those assertions (plain-language explanation shown, no role selector rendered) survive the rewrite rather than getting dropped when the "Contact your admin" string match is removed. A wholesale describe-block rewrite is exactly the kind of change where a real, still-required assertion quietly disappears along with the assertion being intentionally removed.

## Design decisions that evolved since propose — confirmed translated correctly

- **`applicationAdmins` gated by the caller's own `canAssociateManagers`, not team state (Decision 5).** Task 2.2 states this precisely, including the negative instruction ("do not condition this on whether the team has an associated EM"). Good — this is exactly the kind of decision that gets silently reverted to "seems more intuitive" during implementation if it isn't spelled out, and it is.
- **`AdminContact` as its own type, not a reuse of `TeamMember`.** Task 2.1 names the three fields directly, matching design.md's block. The type-level guardrail against a TEAM-006→EM copy-paste regression (design.md Risks, security review Finding 3) is real and I'm glad it's in the task, not just the design doc.
- **Two distinct causes of `applicationAdmins: []`.** Task 2.4 explicitly requires separate fixtures for "genuinely zero admins" vs. "caller doesn't need the field" — matching Decision 5's caveat paragraph. This is a case where an implementer easily conflates the two and ships a test that can't actually distinguish them; good that it's called out.
- **Expanded-scope security reconfirmation.** Task 1.2's framing (full roster / ambient exposure vs. the July precedent's one-admin/on-demand scope) matches design.md's Open Question #2 and Decision 5 closely, including that the conditional reconfirmation itself doesn't close the task — headcount still has to be evaluated against the expanded framing by whoever picks this up. This was the item I was most likely to find drift on given how much it moved since propose, and it didn't drift.
- **Pre-implementation gate ordering.** Section 1 correctly blocks section 2+ work behind headcount (1.1), the security reconfirmation (1.2), and locked copy (1.3) — matching design.md's "should not proceed to implementation copy-lock until #1 and #2 are answered."

## Verdict

Recommend closing Gap 1 and Gap 2 with two small task additions before implementation starts. Neither changes scope or design — they're test-enumeration completeness, the exact kind of thing that's cheap to add now and expensive to notice missing during a later code review. Everything else — the multi-admin/multi-EM formats, both zero-admin fallbacks, the stacked case, the never-resolves-to-EM guard, and all five of the newer backend design decisions — is present and correctly stated in tasks.md, not just described in design.md.
