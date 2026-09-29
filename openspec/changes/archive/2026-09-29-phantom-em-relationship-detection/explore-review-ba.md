# BA Review — Exploration Notes, Phantom EM Relationship Detection (#117)

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewed:** `exploration-notes.md` (Devon Calloway, 2026-09-29)
**Date:** 2026-09-29

## Overall

This is unusually strong exploration for something I'd normally have to send back. Devon verified every schema claim against code rather than trusting the archived design doc, caught a real correctness bug hiding in a metadata-shape collision (§2), and drew the build-vs-execute boundary with more precision than most proposals I see on the first pass. My job here isn't to find sloppiness — there isn't much — it's to find the places where "well-reasoned" and "buildable as a stated acceptance criterion" aren't yet the same thing. A requirement I have to re-derive from prose under a header is a requirement I'll get a Slack message about later. Four things below need a decision recorded before this can become a proposal; the rest are precision fixes.

---

## 1. Blocking — `actor_user_id` / `actor_global_role` cannot be left to "whoever writes the script"

Devon is right to flag this as a real open question (§5) rather than quietly defaulting it, and right that it shouldn't be Devon's call to make. But naming it as open isn't the same as making it buildable. As written, there is no acceptance criterion I could hold an implementation against — "pick something identifiable" isn't testable.

**What's missing:** a named decision, with an owner, the same way Decisions A through I each got one. This should not ship to propose/design stage as "TBD, use your judgment."

**Suggested rewrite** — carry this into design.md as a new Decision (J?), resolved before task-writing, not during it:

- `actor_user_id`: require the actual operator's own `users.id` (their real application account), captured as a **mandatory script parameter with no default** — not a sentinel/system UUID. Devon's own reasoning supports this ("a real UUID that traces to a real, identifiable operator — the equivalent of a signature, not a placeholder"); the proposal should just say so as policy, not leave it as a design opinion floating in exploration notes. A sentinel UUID answers "was this the app or a script" but not "which human"; for an audit-integrity fix specifically, that distinction is the whole point.
- `actor_global_role`: fix the literal string now, in the design doc, as a named constant — e.g. `'system:production_data_engineer'` — not "something self-describing" left to implementation-time taste. One string, decided once, documented in the script header and the design doc so a future auditor and a future implementer are reading the same source of truth.

**Acceptance condition to add:** the script must fail (or refuse to run / require explicit non-default input) if `actor_user_id` is not supplied — no silent fallback to a hardcoded UUID. That's a testable statement; "use good judgment" is not.

---

## 2. Two-query framing — solid shape, one implicit refinement needs to become explicit

§3's separation of Query 1 (current-state SELECT) and Query 2 (historical INSERT) is exactly the right level of rigor, and the non-overlap subtlety (a phantom-promoted-then-demoted user shows in Query 2 but not Query 1) is a real edge case that would otherwise get "simplified" away by an implementer trying to make the two queries reconcile. That subtlety needs to survive into the proposal as a stated fact, not just live in exploration prose — I'd write it as an explicit non-goal-adjacent note: *"Query 1 and Query 2 findings are not expected to match in count, and a reconciliation mismatch is not a bug."* Without that sentence, I guarantee whoever runs this the first time treats a mismatch as something broken and comes looking for an explanation.

**One thing that needs to move from implicit to explicit:** Query 1's sketch in §3 filters on `removed_at IS NULL`; design.md's Decision H/G text (the actual resolved decision) says only "flag any `team_memberships` row with `role = 'engineering_manager'` and no corresponding audit entry" — it doesn't mention `removed_at` at all. Devon's version is almost certainly the correct one (a removed membership row isn't a live phantom grant), but right now that's an unstated refinement layered on top of the decision record by the person exploring it, not a decision itself. If this ships as an assumption baked into SQL with no accompanying sentence, and someone later diffs the script against Decision H's literal wording, it looks like scope drift.

**Suggested rewrite:** state explicitly in the proposal's acceptance criteria: *"Query 1 considers only active memberships (`removed_at IS NULL`); a removed membership row with no backing audit entry is not flagged, since it grants no current access."* One sentence, and it stops being an inference someone has to make from reading SQL.

---

## 3. Idempotency guard — the mechanism is right; the acceptance test is missing

§4's `NOT EXISTS` guard is a sound design and I don't want it re-litigated at proposal time — Devon's reasoning about why re-runs matter (a human at a `psql` prompt, more than one pass, no cron) is exactly the kind of "but what happens when..." case I'd have pushed for if it weren't already here. What's missing is the acceptance criterion that lets someone other than the person who wrote the query confirm it's actually idempotent, rather than trusting the SQL by inspection.

**Suggested rewrite** — add as a stated, testable acceptance condition (not just a design note):

- *"Running the full script twice in sequence against the same data produces zero additional rows on the second run. This must be verified against a non-production copy of the schema (or fixture data reproducing the phantom-relationship shape) before the script is handed to the Production Data Engineer, not asserted by code review alone."*

That last clause matters to me specifically: this table's entire value proposition is that it can be trusted, and "I read the WHERE NOT EXISTS clause and it looks right" is a weaker bar than "someone ran it twice and watched the second run insert nothing." Given nobody in this pipeline has production access, that verification has to happen against a substitute — the proposal should say so rather than leaving verification method unstated (the same way Decision C explicitly named "code review at sign-off, not a runtime test" as its verification method — this needs an equivalent sentence).

Also worth stating plainly, since it's easy to lose in the same breath as the INSERT guard: Query 1 is a SELECT and re-run safety for it is trivially true. Say so explicitly so nobody spends effort building unneeded guard logic around it by analogy with Query 2.

---

## 4. Deliverable boundary — the build-vs-execute line is the best-specified part of this; two gaps remain in what "the script" concretely is

§6's Is/Is-not list is the clearest boundary statement I've seen come out of exploration on this project, and I want that framing carried into the proposal close to verbatim — it already does what Decision C's "does this exist" acceptance-criterion pattern does for a different question. I'd suggest the proposal reuse that exact pattern here: *"Acceptance criterion (verification method: code review, not a runtime test): the script contains no UPDATE or DELETE statement against `team_memberships`, and no code path that revokes, modifies, or notifies automatically. This is a 'does this exist' check."* That converts Devon's prose boundary into something a reviewer can actually check off.

Two smaller things aren't nailed down yet and should be before task-writing:

- **File structure.** "Two query shapes in that script" (§6) implies one file, but doesn't say so, and doesn't name it. Given the `migrations-manual/` convention Devon already confirmed (via `8_rollback.sql`'s header pattern), the proposal should state the exact filename and confirm it's a single `.sql` file with both queries clearly delineated by section header comments (Query 1 / Decision H, Query 2 / Decision I) — not two files, not one query with the other implied. This is a five-minute decision that saves a "wait, is this one file or two?" conversation later.
- **Where the result gets recorded.** Decision H says "a short written result... record the result against this change." Exploration §6 repeats "a short written record, not a dashboard" without saying where. I'd want a named location and a minimal field list decided now: e.g., a template file in this change's directory (`query-result.md` or similar) with fields for run date, environment, operator, Query 1 row count, Query 2 row count, and — see next point — notification recipient if any. Leaving this as "a short written record" with no template means the Production Data Engineer either invents a format under time pressure or comes back to this pipeline to ask, which is exactly the outcome my requirements are supposed to prevent.

---

## 5. New finding — "who was notified" is undefined, and it's adjacent to the remediation boundary this change is careful to draw everywhere else

Decision H's deliverable shape is quoted directly from the Executive Stakeholder: *"checked, nothing found"* or *"checked, N found, here's who was notified."* Exploration notes correctly inherit this phrasing but don't examine it, and I think it's the one place this exploration is hand-wavy in a way that matters.

The problem: "notified" implies an action — informing some person or team about a finding — but nothing in Decision H, Decision I, or the exploration names who that is, by what channel, or whether that notification is itself in scope for this pipeline versus something the Production Data Engineer improvises. Given how carefully §6 draws the line against remediation ("the loaded gun on the table, not the fired shot"), an unscoped notification step is a plausible crack for scope creep to enter through — "I found phantom EMs, so I also removed their access" is one bad afternoon away from "I found phantom EMs, so I told their manager, who asked me to also fix it."

**Suggested rewrite:** add one clarifying sentence to Decision H's carry-forward into the proposal: *"If Query 1 finds phantom relationships, 'notified' means the Production Data Engineer escalates the finding to [named role/channel — e.g., Security or the Executive Stakeholder directly] and records who, in the written result. This notification is an escalation, not a remediation step, and does not itself authorize the operator to revoke or modify the flagged `team_memberships` row."* The bracketed recipient needs an actual name before this goes to proposal — I'd default to whoever holds the Executive Stakeholder role for this change, since they're the one who asked for the shape of this deliverable in the first place, but that's a decision for the Solution Architect or Executive Stakeholder to confirm, not mine to assign unilaterally.

---

## Summary — what needs to happen before this is proposal-ready

| Area | Status | Action needed |
|---|---|---|
| Two-query framing | Solid, one gap | State the non-reconciliation fact and the `removed_at IS NULL` refinement explicitly as acceptance conditions |
| Idempotency guard | Mechanism sound | Add a stated, verifiable acceptance test (two-run comparison against non-prod data), name the verification method explicitly |
| `actor_user_id` / `actor_global_role` | Genuinely open | Needs a named Decision (owner: Solution Architect, matching Decisions A-I's pattern) before task-writing — not resolvable by the script's implementer |
| Deliverable boundary (build vs. execute) | Best-specified part | Convert to a stated, checkable acceptance criterion (Decision-C-style); name the exact file and the result-record location/template |
| "Who was notified" | Previously unexamined | Name a recipient/channel and state explicitly that notification is escalation, not remediation |

None of these are reasons to send this back to exploration — the underlying thinking is sound throughout. They're the difference between a proposal I'd sign off on without a follow-up question and one where I already know what the follow-up questions will be.
