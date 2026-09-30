# Executive Review — topic-customization-lock-and-add-custom-topic

**Reviewer:** Rachel Okonkwo, VP of Engineering
**Lens:** Strategic alignment — adoption impact, proportionality of scope, priority sequencing

---

## Bottom line

Approve. This is a well-scoped, defensible change. It fixes a real integrity hole (a "lock" that was a comment, not a mechanism) and does it with the smallest write surface that makes the lock testable at all. The two deferrals are correctly deferred, not corners cut. I have one adoption-facing note below, not a blocker.

---

## On the bundling decision (#49 + #50)

This is the question I care most about, because "we bundled two issues" is exactly the pattern I ask my teams to justify rather than assume. Here, I buy it.

The tell that this isn't scope creep dressed up with a good argument: #49 was filed with an explicit admission in its own text that there's "nothing to lock standalone." That's not the implementation team discovering scope creep is convenient — that's the backlog itself saying the ticket as filed is untestable and unshippable in isolation. A lock enforcement layer with no write endpoint to gate means the acceptance criteria for #49 would have to be either (a) trivially true because nothing can violate it, or (b) tested against a hypothetical endpoint that doesn't exist yet — neither is real verification. And #50 conversely has no reason to exist on its own either: shipping "Add Custom Topic" without the lock gate would mean shipping the exact bypass the use case's own alternate flow calls out by name — a facilitator hitting the API directly to write topics before the first session completes. Shipping #50 without #49 is shipping the bug the whole feature exists to prevent.

So this isn't "let's combine two tickets for efficiency" — it's "these two tickets don't have independent acceptance criteria," which is a different and much better justification. My test for whether a bundle is scope creep is: could either half ship alone and be considered *done*? Here, no. That's the right call, not a rationalization for it.

What keeps this from tipping into a bigger bundle than it needed to be: the proposal explicitly stops at exactly one write endpoint. It doesn't also fold in remove/reorder/annotate/re-add (#51–#54) just because "we're already in here." Those are named, filed separately, and left alone. That's the discipline I want to see — bundle what has to be bundled to be testable, and nothing else.

## On scope-to-value proportionality

Small, well-defined, no schema migration, no new infra, no frontend work. The write endpoint has one job (add a topic to an unlocked team), and the design explicitly declines to add anything speculative to it — no uniqueness check on duplicate prompts, no row locking beyond what correctness requires, no real-time unlock push (the use case itself calls that a nice-to-have, and the design defers to that framing rather than gold-plating it). Decision 6's reasoning on why a plain read is sufficient instead of `SELECT ... FOR UPDATE` is exactly the kind of "resist the urge to over-engineer" judgment I want engineers making by default, not something I have to catch in review.

This is proportional. It's also fast to ship, which matters more to me than most other properties of a change this size — every week this kind of internal-tool change sits in review is a week a team's baseline data is still contaminable by a stray API call.

## On the two deferred items

**Deferral 1 — exposing lock state on `TEAM-002` (team-list endpoint).** Correctly deferred. There is no facilitator-team-list UI consuming it yet, and the frontend can already infer "definitely locked" from `lastSessionDate === null` in the meantime. Building an explicit flag for a consumer that doesn't exist yet is exactly the kind of "build every feature before anyone uses it" mistake I've asked this team to avoid. This is a completeness gap, not a correctness gap — nothing about it can produce a wrong answer today, only a slightly less clean one for a UI that hasn't been built. Fine to leave open.

**Deferral 2 — topic attribution ("added by").** This is the one I'd flag as worth a second look, but I still land on "correctly deferred, with the risk stated honestly rather than buried." Here's my reasoning: the standing, org-wide facilitator model means any facilitator anywhere — including one who has never run a session for a given team — can add a topic to that team's configuration, and there will be no record of *who* beyond a timestamp. That's a real gap for the "returning facilitator" or "handoff" scenario I explicitly care about (see my own concerns about continuity and trust in this ritual). It's also the kind of gap where the design.md is right that it's cheaper to add now, at table-creation time, than to retrofit onto rows that already lack it.

But — and this is the proportionality call — the actual blast radius of *not* having attribution right now is small: this ships with exactly one write endpoint, adding one topic type, and the audit log (Decision 8) already captures every *denied* write with actor identity. What's missing is attribution on *successful* writes, which is a "nice forensic detail" gap today, not a "someone can act without any trace" gap — audit logging still exists at the boundary that actually matters most (blocked bypass attempts). I'd want this closed before topic management scales to more write endpoints (#51–#54) where the population of things multiple facilitators can silently modify grows, but for a single, narrow "add one topic" endpoint, deferring it doesn't bite adoption in the short term. The design.md's own flag — "cheaper to add now than retrofit later" — is correct, and I'd like whoever picks up #51–#54 to treat closing this as a precondition for that work, not an afterthought. Worth a note to the team, not a blocker on this change.

## What I like structurally, beyond the two items I was asked to assess

- Single lock-check function backing both read and write paths (Decision 1) is the right call precisely because it prevents the two sides from silently drifting — I've seen that exact bug class cause a "why does the UI say unlocked but the write still 403s" support ticket before, and it's not worth a single engineer-hour of debugging later to save the refactor now.
- `409` vs `403` separation, with `403` evaluated first so lock state never leaks to an unauthorized caller — that's a small but real security-posture decision, not just an HTTP-semantics nitpick.
- No feature flag, no configurability on the lock. I want to underline this — it matches what I've told this team before about protective constraints: they don't become optional the moment someone finds it inconvenient. A lock you can flag off during a deploy isn't a lock.

## One adoption note, not a blocker

Everything here is backend contract work — no frontend consumes `isCustomizationLocked` or the new endpoint yet. That's fine and correctly scoped (#55 is separate), but it means this change, by itself, changes nothing a facilitator will see or feel. I don't want "ship #49/#50" to be treated as done-done until #55 actually renders the calm "not yet" state this design goes out of its way to make possible (Decision 4's stable message string exists specifically so a frontend doesn't have to invent copy). Sequence #55 soon after this lands — the value here is real but invisible until the UI catches up.

---

**Disposition: Approved.** Proceed to implementation. Flag topic attribution as a pre-condition to scope into #51–#54, not into this change.
