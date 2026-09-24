# BA Review — Proposal (Issue #166: Join Link Redemption Wiring)

**Reviewed by:** Marcus Delgado, Business Analyst
**Reviewing:** `proposal.md`, `design.md`, `tasks.md`, `specs/join-link/spec.md`, `specs/session-creation/spec.md`
**Verification method:** re-checked the three specific questions I was asked to verify against the actual frontend code (`DraftSessionHost.tsx`, `App.tsx`, `SessionLobbyPage.tsx`, `FacilitatorReadinessGrid.tsx`), not just against the prose, and cross-checked against the ratified "Copy Session Join Link" and "Join Session via Link" use cases in `requirements/use cases/02 - Session Setup - Use Cases.md`.

Overall: this proposal is in noticeably better shape than the exploration phase — the two prior review rounds (mine and Priya's) both landed in `design.md` as stated decisions with named predicates, tie-breaks, and an enumerated migration footprint. That is exactly the "requirements the team can build from without a follow-up question" bar I hold this to. I found one finding that changes a "should be fine" into a "will not build as written" (Decision 5), and one real gap in `tasks.md` section 4's footprint versus `design.md`'s own stated commit-atomicity rule. Neither is cosmetic.

---

## 1. Decision 5 (ship #166 ahead of #164, interim caution) — stated as a decision, not fully operationalized

**Short answer: partially. `tasks.md` has task items for it (3.3, 6.1), but as written, task 3.3 cannot be built as scoped, and neither `tasks.md` nor the spec delta pins down what it should say.**

I checked the actual facilitator-side lobby view — `DraftSessionHost.tsx`'s `currentSessionState !== "draft"` branch (the "live-readiness-view" `facilitator-state` transitions to after "Open the room"):

```tsx
<div data-testid="live-readiness-view" ...>
  <h1>{teamLabel}</h1>
  {newTeamCreated && <p data-testid="new-team-landing-acknowledgment">...</p>}
  <p>The room is open. Session status: {data.currentSessionState}.</p>
</div>
```

**There is no join link, and no copy button, rendered anywhere in this view.** It's a two-line placeholder. Task 3.3 says:

> "Add the one-line interim caution near the copy button, visible during `draft` and `lobby` states..."

There is no copy button to be "near" in `lobby` today — the join link only appears in the `draft`-branch JSX (the block with `data-testid="draft-join-link-not-joinable"`), which this component stops rendering entirely once status leaves `draft`. So task 3.3, taken literally, is not a copy-only change for the `lobby` half of its own scope — it requires first adding a join-link/copy-button element to a view that currently has none, which is new UI surface. That directly contradicts `design.md`'s own framing of Decision 5 as "a copy-only addition, no new plumbing, no new UI surface," and it edges into territory `proposal.md`'s Impact section names as explicitly out of scope: "Join-link revocation UI and the clipboard/copy UI itself (issue #45)... are unaffected by this change."

Worth noting this isn't a hypothetical gap I'm inventing: the ratified "Copy Session Join Link" use case's own AC already requires this and it's currently unmet regardless of #166 — **"The join link is displayed prominently in the session room at all times before the session begins"** (i.e., through `draft` and `lobby`, not just `draft`). That's a pre-existing, out-of-band gap (presumably #164 or #45 territory), but it means Decision 5 leans on a UI surface that doesn't exist yet, and `tasks.md` doesn't say who builds it or where.

**Second, smaller issue in the same task:** 3.3 hedges the copy itself — "same message as 3.2, or a placement-appropriate variant... confirm with facilitator-facing copy review if wording diverges." I'd push back on defaulting to "same message as 3.2" even as a fallback: 3.2's badge text is *"This link works already — anyone who opens it before you open the room won't see a waiting screen yet."* That sentence is specifically conditioned on the room not being open yet. Reusing it verbatim in `lobby` — where the facilitator has, by definition, already clicked "Open the room" — would read as false to the exact audience Decision 5 is trying to protect: a facilitator who did open the room and is now being told, in effect, "before you open it," about a state they've already passed. The actual risk in `lobby` is different (and is the one exploration notes §3b/§3c and `design.md`'s own Decision 5 narrative describe): the link works, membership is granted, but the Engineer doesn't land on a waiting screen because of #164 — a "you may not see a signal that it worked" message, not a "don't open it yet" message. Those need different copy.

**Third:** there is no spec scenario for this at all. `specs/session-creation/spec.md`'s modified requirement has a fully-worded scenario for the Decision-4 badge ("Early-redemption badge describes the operational risk, not the gated noun"), but nothing corresponding for Decision 5's interim caution. It exists only as `design.md` prose and one hedged `tasks.md` checkbox. Given Marcus's usual bar — a requirement a reviewer or QA person can check off without going back to the design doc — this one isn't there yet.

**Recommendation:** before this goes to implementation, `design.md`/`tasks.md` need to say explicitly:
1. Exact copy for the `lobby`-state caution (distinct from 3.2's `draft` badge text — don't let "same message" be the default).
2. Where it renders, given the `lobby` view currently has no join-link/copy-button element to anchor near — either scope in "render the join link + copy button in the live-readiness-view" as an explicit task (small, but real, and arguably not "unaffected by #45" as currently claimed), or change Decision 5's placement to something that already exists in that view (e.g., attached to the "room is open" line itself).
3. A scenario in the spec delta, matching the rigor already given to Decision 4's badge.

This is the one item I'd actually block on — not because the underlying decision is wrong, it's the right call — but because task 3.3 as written will produce either an unbuilt caution in `lobby`, or a facilitator-facing sentence that reads as wrong to the person reading it, and either outcome recreates exactly the "technically complete, functionally invisible" failure pattern this whole issue exists to close.

---

## 2. Badge text in `specs/session-creation/spec.md` — mostly precise, one loose clause

The badge string itself is given verbatim and is unambiguous: *"This link works already — anyone who opens it before you open the room won't see a waiting screen yet."* Good — that's implementable with no interpretation needed, and it has a matching scenario.

One clause in the surrounding requirement text is vaguer than it needs to be and is worth tightening:

> "...the badge accompanying it during `draft` (and, until the session is advanced, during any state prior to it accepting participants)..."

Every other state boundary in this document is `draft` → `lobby` via "Open the room." There is no state that is both "prior to the session accepting participants" and *not* `draft` — `lobby` is precisely the state where the join link "becomes usable for joining" per this same requirement's own next paragraph. So the parenthetical is either (a) pure redundancy — restating "draft" in different words, which adds re-reading cost for no new information — or (b) a leftover attempt to also gesture at `lobby`, in which case it directly conflicts with the requirement's own scenario, which is scoped explicitly to `draft`: *"WHEN a facilitator views a `draft`-status session's control view before activating 'Open the room'."* Either reading, the clause should be cut or replaced with a plain "and no other status" — as written it's exactly the kind of "accurate but ambiguous" language that invites a second implementer to ask "wait, does this also apply to `lobby`?" (a question this review's Section 1 above shows the answer to is "a related-but-different message is needed there, and it isn't this one").

Everything else in this requirement — the route, the rehydration rule, the confirm-before-advance behavior, the four scenarios — reads as concrete and buildable without a follow-up question.

---

## 3. `tasks.md` section 4 vs. `design.md` Decision 6's footprint — incomplete on the commit-atomicity rule specifically

`design.md`'s Migration Plan, step 6, states this explicitly:

> "In the same commit: migration dropping `sessions.join_token` (Decision 6) plus **all six test-file updates** plus the two INSERT-site removals — landed together so no intermediate commit has the column gone but references remaining, or vice versa."

`tasks.md` section 4 covers five of the six:
- 4.1 migration ✓
- 4.2 both INSERT sites + the stale generation comment ✓ (correctly compressed into one item — the footprint says "two INSERT sites," not "two tasks")
- 4.3 `facilitator-state` SELECT/response — deferred to (and correctly cross-referenced against) task 2.3, so functionally covered, just split across sections
- 4.4–4.8 five of the six test files: `ws-pubsub-integration.test.ts`, `facilitator-error-state-2-restricted-role.test.ts`, `facilitator-error-states-integration.test.ts`, `action-items-integration.test.ts`, `facilitator-sessions.test.ts` ✓

**`DraftSessionHost.test.tsx` — the sixth file — is not in section 4 at all.** It's task 3.4, in the frontend section. That placement is reasonable on its own (it's a frontend test, section 3 is the frontend section), but task **4.9**, which is `tasks.md`'s own commit-boundary instruction, only says: *"Land Tasks 4.1–4.8 in the same commit."* That excludes 3.4. So `design.md`'s explicit "all six test-file updates, same commit as the migration" rule is not, in fact, enforced by `tasks.md`'s own atomicity instruction — an implementer following `tasks.md` section-by-section could land section 3 (including 3.4) as its own commit well before touching section 4, with nothing in the task list flagging that as a problem.

To be precise about severity: this is lower-risk than the other five, because `DraftSessionHost.test.tsx` doesn't contain raw SQL — it won't produce the "invalid SQL, CI breaks outright" failure mode the other five are specifically enumerated to prevent. But it's still a literal deviation from a rule `design.md` states in imperative terms ("SHALL," "landed together"), and the risk it does carry is real: if 3.4's update lands *before* the migration (plausible, since section 3 precedes section 4 in reading order) and doesn't yet reflect the corrected `/api/join/:token` URL and reworded badge from 3.1–3.2 landing in the same commit as 3.4 asserts, or if section 4 lands first and orphans `DraftSessionHost.test.tsx` against a since-changed `joinToken` source, there's a window with a passing-but-stale test. Practically minor; worth a one-line fix either way.

**Recommendation:** add `DraftSessionHost.test.tsx` (or a cross-reference to task 3.4) into task 4.9's "land in the same commit" list, or explicitly state in `design.md`/`tasks.md` why it's exempt from the six-files-one-commit rule. Either resolves the discrepancy; leaving it silent doesn't.

---

## Summary — what I'd block on before implementation starts

**Blocking:**
- Section 1 above (Decision 5 / task 3.3): pin down exact `lobby`-state copy (distinct from the `draft` badge), name where it renders given the `lobby` view currently has no join-link/copy-button surface to attach to, and add a matching spec scenario.

**Non-blocking, recommend fixing before sign-off (both are small, precise edits):**
- Section 2: cut or clarify the "any state prior to it accepting participants" parenthetical in `specs/session-creation/spec.md` — it's redundant at best, contradictory-with-its-own-scenario at worst.
- Section 3: add `DraftSessionHost.test.tsx` / task 3.4 to task 4.9's same-commit instruction, matching `design.md`'s explicit "all six test-file updates, same commit" rule.

**Everything else** — the get-or-create predicate, the tie-break rule, the race-condition decision, the shared-helper requirement, the migration footprint's other five files, the e2e-must-exercise-the-real-URL requirement, and the #164 scope boundary — is stated precisely enough in `design.md` and carried through into `tasks.md` and the spec deltas without a follow-up question needed. That's the majority of this change, and it reflects the two prior review rounds doing their job.
