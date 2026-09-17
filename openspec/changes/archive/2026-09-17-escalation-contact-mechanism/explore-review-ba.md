# BA Review — Exploration Notes: Escalation Contact Mechanism (GitHub #15)

**Reviewed by:** Marcus Delgado (Business Analyst), 2026-09-16
**Source:** `openspec/changes/escalation-contact-mechanism/exploration-notes.md` (Devon Calloway)

I verified the factual claims against the actual code (`MemberManagement.tsx`, `MemberManagement.test.tsx`, `teams.ts`) and the two specs. Line numbers are close enough to be trustworthy (off by 1-2 in a couple of spots, not materially), the "no existing admin-contact infra" claim checks out (no `ADMIN_EMAIL`/`SUPPORT_EMAIL`-style config anywhere in `packages/`), the task 3.10 placeholder near-miss is real, and the July security precedent quote is accurate verbatim. This is a well-grounded exploration. My job here is to press on where it's still too open to hand to a proposal writer as-is.

---

## Overall verdict

Section 3 (fact-finding) and the code verification are solid — I'm not re-litigating those. Section 4 (candidates) and Section 5 (open questions) are where I'd push back before this goes into a proposal. The core problem: **the exploration correctly identifies that this decision hinges on the multi-admin / zero-admin question, then declines to resolve it** ("a design-phase call, not an exploration-phase one"). I understand the instinct not to lock in UI mechanism at exploration time, but this isn't a UI mechanism question — it's a data-model and product question, and it needs an answer (or at least a documented default) before design can move, or design will just re-ask it.

---

## 1. The multi-admin question needs a working default, not just a flagged tradeoff

Open question #1 asks "show all, show one, or route to a configured alias?" and leaves it open. But this determines which of Option A or Option B gets built, and the two options have almost no implementation overlap (A queries `users` table live per-request; B is a static config value with startup validation). A proposal can't scope tasks against "one of these two, TBD."

**My read on how to resolve this, given what Devon found:** the "internal, small user population" framing from the July security review is doing real work here — it implies few admins, not many. If that's true, "show all admins, comma-separated names and mailto links" is almost certainly buildable in the same pass as Option A and sidesteps the "pick one arbitrarily" problem entirely — you don't have to choose, you just enumerate. I'd want the exploration (or whoever writes the proposal) to state a concrete number: **how many Application Admins does this application currently have, in the reference deployment?** That's a one-query fact, not a hypothetical, and it should settle A-vs-B far more decisively than an abstract tradeoff table does. If the answer is "1-3 typically," Option A with a "show all" rule is clearly right and B is unnecessary complexity. If the answer is "could be a dozen in a large org," B starts looking better. Exploration should have this number; I don't think it's fair to push that lookup into design.

**Suggested rewrite of open question #1:** replace with a concrete acceptance condition once the count is known, e.g.: *"When one or more Application Admins exist, the escalation message enumerates all of them by name with a `mailto:` link per admin. No selection/tie-breaking logic is needed because the set is displayed in full, not chosen from."* That's buildable. "Show all, show one, or route to alias" is not — it's three different features wearing one open question.

## 2. Zero-admin state: this needs to be classified, not just asked about

Open question #2 asks whether zero admins is "a real deployment state we need to design for, or an assumed-impossible bootstrap invariant enforced elsewhere." This is answerable today by reading the schema/seed/bootstrap code — it shouldn't carry forward as an open question into design. If there's a DB constraint, a seed script, or a migration that guarantees at least one `application_admin` row always exists, cite it and close the question. If there isn't, the proposal needs an explicit fallback string for the empty-admin-list render (and Devon is right that this reopens "no mechanism" in miniature if it silently falls back to generic text — that fallback string itself needs to be specific, e.g. pointing at the org's IT/support intake rather than a dead "contact your admin").

**Suggested rewrite:** "Confirm via the schema/migrations whether zero-Application-Admin is a reachable state. If reachable, the escalation message's fallback for an empty admin list must itself be a specific, resolvable path (not `Contact your admin` restated) — proposal must state what that fallback is, not defer it."

## 3. The security re-confirmation should happen now, not get carried as a question

Open question #3 — is the "internal, small user population" assumption still true — is framed as something to ask the security analyst later. Given that this same assumption is the load-bearing fact for open question #1 (see above), I'd escalate this from "carry into proposal" to "resolve before writing the proposal." It's a five-minute question for whoever owns that context, and the proposal's central design axis depends on the answer. Don't let two sequential "carry this forward" items both point at the same underlying fact and get resolved on two different, later occasions.

## 4. TEAM-005 "EM already associated" case — one gap in the acceptance condition

Section 3/4 correctly identify that when a TEAM-005-restricted facilitator's team already has an associated EM, that EM's `displayName`/`email` are already on-page (`MemberManagement.tsx:465-469`) and can be referenced for free (Option C). Good find. But the notes don't say what happens when the team has **no associated EM AND the actor lacks TEAM-005 permission** — i.e., the two gaps stacked. In that state, TEAM-005's authorized-actor set (Admin or EM) has no EM half to fall back to, so it collapses to "Admin only," same as TEAM-006. The notes' lean ("A for TEAM-005 when no EM is associated yet") implies this, but it's stated once in the prose and never turned into an explicit scenario. I'd want this as its own acceptance scenario in the proposal, worded roughly: *"WHEN a facilitator lacks TEAM-005 permission AND no EM is associated with the team, THEN the escalation shows the Application Admin contact mechanism (Option A) — there is no EM to fall back to."* Otherwise whoever writes tasks.md may build Option C as "look for an EM, done" and miss that it needs an explicit empty-EM branch, not just an absent one.

## 5. Vague area: "an equivalent mechanism"

Both specs' minimum-acceptable language says "an email address, an in-application message path, or an equivalent mechanism." The exploration correctly rules out D (in-app messaging) as out of scope for this fix, but doesn't explicitly close the "equivalent mechanism" door for whatever gets proposed. I don't think this needs new investigation — I just want the proposal to say in so many words that a `mailto:` link satisfies "email address" literally, so nobody reopens "is this specific enough" as a review question later. Small thing, cheap to preempt.

## 6. Test rewrite — agree, and one addition

Section 3's point that the task-4.3 test only asserts the *old* text is correct and important — I confirmed it myself (`MemberManagement.test.tsx:511-521`: the test is literally titled "shows specific contact path... not just a grayed-out control" but its assertion is `toHaveTextContent(/Contact your admin/i)`, which is the exact insufficient string). That's not a coincidental gap, that's a test whose name overclaims what it verifies — worth calling out explicitly in the proposal's task list as "rewrite, and the replacement assertion must check for a `mailto:` href or admin identity string, not the literal phrase 'Contact your admin.'" Otherwise a future implementer could satisfy the new test by leaving the old sentence in place and appending an admin name after it in a way that still doesn't resolve to anything actionable.

---

## Summary of requested changes before this moves to proposal

1. Get the actual current Application Admin count from the reference deployment (or state it's unknown and must be gathered) — this should decide A vs. B, not remain a tradeoff table.
2. Resolve the zero-admin question against the schema/bootstrap code now; if reachable, specify the fallback string.
3. Get the security re-confirmation on "internal, small user population" now, since #1 depends on it — don't carry it as a parallel open question.
4. Add an explicit acceptance scenario for the TEAM-005 stacked case (no permission AND no EM associated).
5. State plainly that a `mailto:` link satisfies "email address" under the spec's "equivalent mechanism" language.
6. Task list should specify what the rewritten task-4.3 test must assert (an actual mechanism — href or identity string — not the literal legacy phrase).

None of this contradicts Devon's lean (A for TEAM-006/TEAM-005-no-EM, C for TEAM-005-with-EM, skip B) — I think that lean is right. I'm asking for the two facts it depends on to be nailed down before proposal, and for the open questions to be rewritten as acceptance conditions rather than left as questions for whoever picks this up next.
