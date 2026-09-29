# Facilitator Review: Exploration Notes for Issue #117 (Phantom EM Relationship Detection)

**Reviewer:** Priya Nair, Facilitator (Subject Matter Expert)
**Reviewing:** `exploration-notes.md` (Devon Calloway)

A note on why I'm here at all: this change has no live-session surface, no facilitator view, no reveal, no vote. I said in my review of the #109 exploration notes that I wanted a phantom-EM remediation question "recorded rather than falling through the crack between explore and implementation" (my Question 1 there). This is that question finally surfacing as its own change, six days late per Devon's §7. So there's a real continuity thread here — I just want to say plainly that my usual lens (reveal simultaneity, readiness-without-spoilers, outlier social dynamics) doesn't apply to a backend script with no participant-facing anything. Forcing that framing onto this would be worse than useless — it would bury the thing I can actually contribute.

What *does* transfer from my persona, even without a session in sight: I spend every real session worrying about whether the person operating a control (me, at the front of a room) has enough signal to act correctly and safely, without having to remember things or ask someone else. That's the same question for the Production Data Engineer running this script alone against production. That's my lens below.

---

## Observations

1. **The notes are honest that this is "the loaded gun on the table, not the fired shot" (§6) — good, but that framing raises the bar on the gun's safety, not lowers it.** Precisely because nobody in this pipeline will watch the operator run it, the script itself has to carry all the context a live facilitator would normally carry in their head or say out loud. There's no equivalent of me catching a confused face across the room here. Every ambiguity has to be resolved on the page.

2. **§4's idempotency guard is exactly the right instinct, and I want to push on what "safe to re-run" needs to *look like* to the operator, not just *be* true in the SQL.** A `NOT EXISTS` clause makes re-running safe in the sense that the data ends up correct. But if the operator runs the script a second time and `psql` just prints `INSERT 0 0`, does that read as "confirmed already done, nothing new" or as "did this fail"? That's the same distinction I care about in Concern #1 of my own persona: something can be technically correct and still fail as a piece of communication to the person relying on it. I'd want the script to print something unambiguous — an explicit row count with a label, not a bare INSERT tally — so the second run visibly confirms itself rather than looking identical to a silent failure.

3. **§3's two-query structure (detection vs. annotation) is described as "not one query" for good schema reasons — I'd also want it enforced as two separate, deliberate operator actions, not just two logically separate SELECT/INSERT statements in one file.** This is my closest analogue to "no automatic topic advancement, the facilitator calls it." If Query 1 and Query 2 live in the same script and run back-to-back on one invocation, the operator commits an audit-log write before they've had a chance to look at what Query 1 found. I want a look-then-act structure: run the detection query, see the count and the actual rows, and only then take the separate, explicit step that writes the annotations. Collapsing that into one execution is the ops-script version of the reveal happening before the facilitator confirms the room is ready.

4. **§5's actor_user_id / actor_global_role question is correctly flagged as a real open decision, not a detail — I'd add that whatever gets decided needs to be a documented, copy-pasteable instruction in the script header, not something the operator has to figure out or ask about.** This is the same thing as my "first session for a new team" concern: the first time someone runs this script, nothing about it should require a side conversation to unblock. If the decision is "use the on-call engineer's own application user_id," the header should say exactly how to find it. If it's a sentinel UUID, the header should contain the literal value to paste in, not a description of one.

5. **Devon's catch in §2 (the `operation` filter has to be explicit or blocked TEAM-005 attempts get misclassified as phantom promotions) is the kind of error I'd never catch by reading SQL, but I recognize the shape of it — it's a false-positive risk that produces a confident, wrong signal.** From the operator's side, a false positive here is worse than a false negative: it produces an annotated audit-log row asserting something happened that didn't, and nothing about running the script would tell the operator that occurred. I don't have anything to add to Devon's fix — I just want to flag that this is exactly the category of risk that needs to survive into the actual script as a comment explaining *why* the operation filter is there, so a future editor doesn't "simplify" the WHERE clause and reintroduce it.

---

## Questions

1. **How does the operator know they're pointed at production and not staging before either query runs?** Nothing in the notes mentions a sanity check. For a script whose entire second half writes to an append-only audit table, I'd want the script to print the current database name (or something equally unmistakable) as its first action, so the operator can eyeball-confirm before either query executes — not rely on remembering which `DATABASE_URL` they exported. This is a small ask with a large asymmetry: cheap to add, expensive to skip if it's ever run against the wrong environment.

2. **What does the operator actually see when Query 1 finds phantom relationships — raw UUIDs, or something a human can act on?** §6 says the deliverable includes "who was notified" as part of the written record. But notifying someone requires knowing who they are. If Query 1's output is bare `user_id`/`team_id` UUIDs, the operator has to go run follow-up lookups just to know whose manager relationship this is, before they can tell anyone anything. I'd want the detection query to join through to something human-legible (user email or name, team name) so the "N found" result is immediately actionable, not a UUID scavenger hunt.

3. **Where does the "checked, nothing found / N found" record actually get written down?** §6 calls it "a short written record, not a dashboard," which I agree with, but doesn't say where it lives — the GitHub issue itself, a Slack channel, an internal doc. This is my continuity concern again: if the on-call rotates between "script exists" and "script runs," or between "script runs" and "someone needs to know it ran," that record's location is the only thing that carries context forward. I'd want it named explicitly rather than left to whoever runs it to decide in the moment.

4. **If Query 2's INSERT fails partway through (say, after annotating 3 of 5 matching rows), is the whole script transaction-wrapped, or could the operator be left with a half-annotated batch?** The idempotency guard means a second run would safely finish the job either way, but I'd still want the operator to know, from the script itself, whether a mid-run failure requires them to just re-run it (fine) or investigate further (not fine, if a partial write could ever violate the "checked, N found" count being reported becoming stale).

---

## Suggested Additions

- Structure the deliverable as two operator-facing steps, not one file that runs both queries in sequence: a detection step whose output the operator reads before deciding anything, and a separate, explicitly invoked annotation step. Make the "pause and look" boundary a structural property of the script, not a hoped-for discipline of whoever runs it.
- Add an environment sanity check (print current DB name/host) as the first thing either script does, before touching any table.
- Join the detection query's output to `users`/`teams` (or whatever gives a human-readable identifier) so "N found" comes with enough information to notify someone without a follow-up query.
- Name, in the script header or the change's proposal, exactly where the "checked, nothing found / N found" record is meant to be written, so it survives a handoff between whoever runs the script and whoever needs to know the result.
- Make the second run's confirmation visibly different from the first run's — an explicit "X new annotations inserted" / "0 new annotations, already up to date" message, not a bare row-count the operator has to interpret.
- Whatever gets decided for `actor_user_id`/`actor_global_role` (§5, rightly still open) needs to land in the header as a literal, copy-pasteable instruction, not a description — the same "no side conversation needed" bar I'd apply to a first-session facilitator guide.

---

## Bottom Line

This is entirely outside my usual territory in the literal sense — no session, no vote, no reveal — and I want to say that plainly rather than stretch my checklist to fit where it doesn't belong. But the underlying thing I actually care about — can the one person responsible for operating this correctly do so without tribal knowledge, and does the tool make the safe path the only path rather than the disciplined path — applies just as much to a lone engineer at a `psql` prompt as it does to me at the front of a room. Right now the exploration gets the data correctness exactly right (Devon's §2 catch especially) but is thinner on what the operator's screen actually shows them at each step. I'd want the look-then-act structure (Observation 3 / Suggested Addition 1) and the environment sanity check (Question 1) treated as close to non-negotiable before this ships — both are cheap, and both are the difference between a script that's safe in theory and one that's safe in someone's hands at 6pm on a Friday.
