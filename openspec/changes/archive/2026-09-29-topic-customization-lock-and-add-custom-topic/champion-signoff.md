# Champion Sign-Off — Enforce Topic Customization Lock for First Session / Add Custom Topic (#49/#50)

**Reviewer:** Devon Calloway, Principal Software Engineer (Internal Champion)
**Scope of this note:** does the shipped change preserve the ritual's intent — specifically, that a team's first session always runs against the untouched default topic set, whether the front-running would have happened through the UI or around it.

---

## Verdict: signed off. This is exactly the kind of fix I want to see happen without me in the room.

The concern this use case exists for was never abstract to me. "Locked" was a word in a spec, not a thing the server actually checked. That's a worse state than having no lock at all, because it *reads* as protected right up until the day someone — a facilitator in a hurry, a script, a direct API call — proves it wasn't. This change closes exactly that gap: `hasCompletedFirstSession(teamId)` is a real, live, uncached database read (Decision 1), it's the *only* place that fact gets computed, and both the read-side flag and the write-side gate call it. No handler gets to run its own inline count and quietly drift from the other. That single-function requirement is the part I'd have fought hardest for if I'd been in the room, and it's there.

More importantly: the bypass path named explicitly in the use case's own alternate flow — "Facilitator bypasses the UI and submits a topic modification request directly, e.g., via API" — is the actual thing tested. `topics-integration.test.ts` fires real requests against a real Postgres instance and confirms a locked team rejects the write with `409` and an unlocked one accepts it, no UI involved anywhere in the test. That's the difference between "we assume the lock holds" and "we watched it hold." Good.

## The four constraints I always check first

- **No-manager rule:** untouched. Nothing in this change touches session participation, EM exclusion, or vote eligibility. Confirmed by reading the diff scope — `topics.ts`, the lock helper, and the `content.ts`/`facilitator-sessions.ts` touch points are all topic-configuration and authorization-plumbing changes, nowhere near the participant/session-role code.
- **Simultaneous reveal:** untouched. This change has no live-session code at all (explicitly a stated non-goal), so there's nothing here that could touch reveal timing.
- **Facilitator-from-another-team:** preserved and actively enforced, twice over. The standing, org-wide facilitator model (Decision 3) still requires `global_role = 'facilitator'` AND not-an-active-member of the target team, and that check runs *before* the lock check on every write. I'd have wanted to see this be a hard block, not a warning — it is: `403 Forbidden`, no override, no path around it in this endpoint.
- **No-individual-performance-comparison:** unaffected. This change adds one write endpoint for topic labels/prompts, nothing that touches vote content, session results, or any cross-team/cross-time aggregation. I don't see a new surface here that a determined person could turn into an individual-comparison view.

## No configurability, and that matters to me specifically

There's no feature flag on the lock. It's unconditional from the day this ships. That's the property I care about most across this entire project — the moment a protective constraint becomes a boolean someone can flip in an environment config, it stops being a constraint and becomes a suggestion with a deadline. This one isn't. Good.

## Two things surfaced late that are worth saying out loud, not burying

**1. The 401-vs-403 inconsistency in `standing-facilitator-access-helper.ts` — real, confirmed, correctly left unfixed for now.**

I checked this against the actual shipped code rather than taking the reviewers' word for it. It's real: `facilitator-sessions.ts`'s `POST /draft` treats a `grant === null` result (no user row at all) as `401`; `topics.ts` treats the identical condition as `403 NOT_A_FACILITATOR`. Both reviewers (Ingrid, Tomás) independently flagged it and both concluded it's unreachable through any normal authenticated flow — the session middleware guarantees a user row exists — so there's no exploitable path today. I agree with that read. I also don't think this is a ritual-integrity question: it's not a hole in the no-manager rule, the facilitator-from-another-team requirement, or any other structural guarantee — it's a cosmetic disagreement between two callers of one shared helper about a state that shouldn't occur. I'd rather see it fixed than not, because "shouldn't be reachable" is exactly the kind of assumption that ages badly once a third caller of this helper gets written by someone who didn't read either of these review documents. Small ask: whoever picks up `TOPIC-004`–`007` should reconcile this to one status code before adding a third caller, not because it's dangerous today but because it's cheap to fix now and only gets more annoying to reconcile the more callers accumulate.

**2. The sequencing note on #55 — I want to underline this, not soften it.**

Rachel's review is right that this ships nothing a facilitator will ever see or feel. That's fine as a scoping decision — I don't want a backend team inventing UI to make a code review feel more satisfying — but I want to be explicit about why I care: the whole reason I pushed for this tool to exist was so a team I've never spoken to could adopt the ritual correctly without me walking them through it. A lock that only a `curl` command can observe doesn't do that job. It protects the baseline, which matters, but it doesn't yet make the ritual legible to anyone. Decision 4's stable, server-driven message string — "Topics cannot be customized until this team's first session is completed." — was clearly written with a future frontend's calm "not yet" screen in mind, and that's the right instinct. It just isn't real yet. I'm signing off on this change on the assumption that #55 is next, not eventually. If #55 slips by more than a sprint or two, this becomes exactly the kind of "shipped but invisible" work that makes a rollout look further along than it is — which is the adoption-timing mistake I'm most allergic to on this project.

## One thing I'll note for my own future reference, not a concern

Decision 3's scope note is honest about something that could have been glossed over: any facilitator, anywhere, with zero prior relationship to a team, can add a topic to that team's unlocked configuration. That's wider than I'd have designed off the top of my head, but the reasoning holds — it's the same shape of access `POST /draft` already grants for the identical reason (facilitators rotate across teams by design, in service of the facilitator-from-another-team rule), and it's not a new erosion of anything ritual-related. The audit trail on successful writes (Decision 8's amendment) means "who did this" is answerable even without the `created_by` column that's still an open question. I'd like that column eventually, for the same reason Rachel names — it should be closed before #51–#54 widen the set of things a facilitator can silently change — but it's correctly not a blocker on a one-endpoint change.

## Bottom line

The lock is now a mechanism, not a description. The bypass named in the use case's own text is the one that's tested. The four load-bearing constraints are untouched, and nothing here made any of them configurable. That's the bar. Ship it, and get #55 in front of it soon — the mechanism is real now; make it visible next.

— Devon
