# BA Review — Exploration Notes: Session Creation for Existing Team

**Reviewer:** Marcus Delgado (Senior Business Analyst)
**Reviewing:** `exploration-notes.md` (Devon Calloway)
**Source of truth used for cross-check:** `requirements/use cases/02 - Session Setup - Use Cases.md`

---

## Overall verdict

This is stronger than most exploration passes I see — Devon read the actual endpoint code and found a real enforcement gap rather than just restating the use case back at me. §3, §4, and §5 are close to proposal-ready as written; the acceptance conditions implied there are specific enough to build and test against.

The four items flagged for scrutiny are not all at the same level of readiness, though. Two (the authorization gap, and the `AuthSession`/`globalRole` gap) are specific enough to become explicit capabilities today. Two (draft-vs-lobby, concurrent-session policy) are framed as recommendations with a stated direction, but the acceptance conditions are still soft enough that two engineers could implement them differently and both claim to have followed the notes. Before this goes into a proposal, I want those two tightened, and I want one contradiction between these notes and the source use case resolved — see §1 below, which is the one thing I'd block on.

---

## 1. Contradiction with the source use case — needs resolution before anything else

§6.2 asserts: *"A facilitator who is not a member of any team... which the requirements don't rule out."*

That's not accurate as written. `02 - Session Setup - Use Cases.md`, "Create Session for Existing Team," lists as a **precondition**:

> "The Facilitator is recognized by the application as a member of at least one team."

That's not a description of the normal case — it's a stated precondition of the use case this whole feature is built from. Devon's own §6.2 argument leans on the entities doc ("nothing in the schema *requires* a facilitator to have a home-team membership") rather than on this use case's precondition list, and the two sources disagree.

This matters more than a nitpick because it changes the scope of the feature, not just an edge case within it:

- If the precondition is authoritative, a facilitator with zero team memberships is **outside this use case's contract entirely** — the picker/landing behavior for that user is arguably out of scope for this change, or belongs to a different, not-yet-written use case ("Facilitator with no home team").
- If Devon is right that the schema doesn't enforce it and it's a real reachable state, then the precondition in the use case doc is **wrong and needs a correction**, not just a frontend accommodation bolted on here.

**Clarification needed:** Is "facilitator has at least one home-team membership" an enforced invariant somewhere in the system (account provisioning, `global_role` assignment flow, an admin-only path), or is it aspirational language in the use case that was never actually enforced? I don't know the answer from these notes and neither, I think, does Devon — §6.2 hedges with "nothing in the schema *requires* it," which is a claim about the schema, not a claim about whether the state is reachable in practice.

**Suggested resolution path:** Before this becomes a proposal capability, someone needs to check how `global_role = 'facilitator'` actually gets assigned (admin console? self-service? seed data?) and whether that path can produce a facilitator with zero team rows. If yes, fix the use case precondition (it's wrong) and keep Devon's §6.2 recommendation. If no — if every facilitator provisioning path guarantees at least one membership — then §6.2's routing fix is solving for a state that can't occur, and it should be cut from this change's scope rather than carried in as unverified defensive code. Either answer is fine; leaving it unstated is not, because right now the proposal would be built on a claim that contradicts its own source document without anyone having noticed.

---

## 2. Scrutiny of the four flagged open decisions

### 2a. The team-membership authorization gap (§3) — ready, with one addition

This is the best-specified section in the document: exact file/line, exact current behavior, exact proposed check, exact error message intent, and a concrete claim about test coverage (grepped and found nothing). That's the standard I want the rest of the document held to.

One gap: Devon proposes the fix should ship "with its own test" but doesn't enumerate what the test(s) need to cover. For a hard, no-exceptions constraint like this one, "add a test" is too soft to survive into a proposal's task list unchanged. I'd want the proposal to name these scenarios explicitly (each is a distinct AC, not one bullet):

- Facilitator has an active (`removed_at IS NULL`) membership in the target team → 403, specific message.
- Facilitator was previously a member but was removed (`removed_at` set) → allowed (Devon's §4 point that historical membership isn't a permanent bar — this should be a test on the POST endpoint too, not just documented as a GET-endpoint behavior).
- Caller's `global_role !== 'facilitator'` → 403, and the message must be distinguishable from the membership-based 403 (Devon makes this distinction for the GET endpoint in §4; the same distinction should hold on POST for consistency, and the notes don't currently say so).
- Direct API call bypassing the picker UI entirely → same 403 as above (this is the scenario the companion use case exists to name — it should be the literal test, not an implied one).

**Suggested rewrite for the proposal's acceptance criteria**, tracing directly to the use case's own AC ("A server-side check prevents session creation for the user's own team regardless of how the request is submitted"):

> Given a caller with `global_role = 'facilitator'` and an active `team_memberships` row for `:teamId`, `POST /api/v1/teams/:teamId/sessions/draft` returns 403 with an error identifying the cross-team constraint by name, and creates no session record. This holds regardless of whether the request originated from the picker UI or was submitted directly.

### 2b. The `AuthSession`/`globalRole` gap (§6.1) — ready as a capability, but §6.2's UI behavior is not

Adding `globalRole` to `AuthSession` is a clean, specific, testable change. No notes needed there.

But §6.2's consequence of that change — what `AuthenticatedLanding` actually *does* with it — is still directional language, not a requirement: "branch a facilitator with zero eligible actions differently from a facilitator with a home team." Differently *how*? The use case doc doesn't define copy or routing for this case at all (it can't — it's not in the use case), so this can't be resolved by re-reading the source document the way §1's contradiction can. This is genuinely new ground, and per my own standing concern about edge cases becoming scope disputes mid-implementation, I don't want this shipped as "the engineer improvises the copy when they get there."

**This is contingent on §1's resolution.** If §1 comes back "zero-home-team facilitators are a real reachable state," then this needs an explicit mini-flow written before the proposal is finalized: what does the landing page show, what does the empty-state picker say (and how does it read differently from "you have a home team but no eligible targets," per §4's own point about not collapsing distinct empty states into identical copy), and where does the user go next. If §1 comes back "not reachable," this whole sub-item drops out of scope and should be removed rather than carried as speculative UI work.

### 2c. Draft vs. lobby status handling (§7) — not yet a proposal capability

Devon reasons through this well but ends on "I'd lean toward X... but this is a real design decision, not a detail to leave implicit" — which is the correct instinct, but the notes then don't actually make the decision. That leaves it exactly where Devon says it shouldn't be left.

I also want to flag a direct tension with the source document that Devon doesn't call out: the use case's postcondition says the session is created and lands the facilitator in the room "in a 'waiting for participants' state" as a **single flow** (steps 5–8 of the main flow are one continuous sequence with no visible seam). If the implementation is draft-then-explicit-advance, the use case's main flow is no longer accurate and needs an update or an addendum — this isn't just an internal design choice, it changes what the use case document says happens. If it's draft-then-auto-advance, the use case as written stays accurate, which is one real point in favor of Devon's leaning.

**Suggested concrete acceptance condition to put in the proposal** (resolving the decision, not just describing it):

> Submitting the confirm screen results in a session visible to the facilitator in `lobby` status, with the join link active and joinable, in the same user-facing action as the submit click (whether that is one backend call or two is an implementation detail). If a system error occurs after the draft is created but before advancing to lobby, the facilitator must not be left staring at a draft-status session with no indication of what happened — the failure path needs its own explicit behavior (retry the advance? roll back the draft? surface an error?), which these notes don't currently address at all.

That last sentence is the part I'd flag hardest: Devon's §7 discusses the happy path in detail but the notes have no failure-mode language for "draft succeeded, advance failed." Given how much weight Devon puts elsewhere (§3, §5) on server-side re-validation and not trusting partial state, I'd expect the same rigor applied here, and it isn't yet.

### 2d. Simultaneous-active-session policy (§8) — direction is right, mechanism has an internal inconsistency

I agree with Devon's judgment call to resolve this now rather than leave it open — this is exactly the kind of thing I don't want discovered during implementation and then treated as out of scope (see my standing concern about edge cases becoming scope disputes).

But the notes propose "block or warn" as if those were interchangeable — they are not, from a requirements standpoint, and the use case doc doesn't help here (its own Notes section explicitly punts on this, so there's no source-of-truth answer to fall back on the way there was in §1). "Block" means the facilitator cannot proceed and must be told why. "Warn" means the facilitator can proceed anyway after an acknowledgment. Those are two different UI flows, two different sets of copy, and — more importantly — two different answers to the actual problem Devon describes (two competing join links polluting trend data). A "warn and proceed anyway" policy doesn't prevent the data-pollution scenario Devon opens the section with; it just adds a click in front of it. If the goal stated in the opening paragraph is the goal, this needs to be "block," full stop, and the notes should say that rather than leaving both options on the table.

There's also a consistency problem worth naming directly: Devon insists elsewhere (§3, §5) that authorization checks must be re-validated server-side at submission time because anything else is a race condition someone will eventually hit — and then in §8 proposes a bare `SELECT` before `INSERT` with no transaction or lock, calling it "sufficient," for a check whose entire stated purpose is to prevent two facilitators acting "in the same week" (i.e., concurrently, which is precisely when a race matters). I'm not the person to judge whether that gap is acceptable at this traffic volume — that's an engineering call — but the notes shouldn't apply "always re-validate, races matter" as a principle in one section and "a SELECT-then-INSERT is sufficient" in another about the same class of problem without at least acknowledging the tension.

**Suggested concrete acceptance condition:**

> If a non-terminal session (`draft`, `lobby`, `pre_session`, `active`, `wrap_up`) already exists for the target team at the time a new session-creation request is submitted, the request is rejected with an error naming the existing session as the reason. This is enforced at the same point as the team-membership check (§3), not only as a picker-side filter. [Open: whether the concurrency window between check and insert is acceptable as a bare SELECT/INSERT, or needs a stronger guarantee, should be answered by whoever owns the data-integrity call on this table — not decided implicitly by whichever pattern gets copy-pasted first.]

---

## 3. Other vague areas worth tightening before proposal

- **§4, deactivated teams.** Devon correctly flags this as needing "a one-line decision in design.md" rather than silent inference — I'd elevate this to an actual acceptance criterion rather than trusting it survives as a design.md footnote. One line: "Teams with `deactivated_at` set are excluded from the eligible-teams list." Say it once, in the proposal, not just in exploration notes.
- **§4, the 403-vs-empty-200 distinction.** The principle is right (don't collapse "not a facilitator" and "zero eligible teams" into identical UI), but the notes don't specify the actual response shapes or copy for either case. I'd want the proposal to state the exact HTTP status/body for both, since "the frontend should be careful" (Devon's own phrasing in §4) is not something I can hold an engineer accountable to at review time.
- **§5, the race-condition UI behavior.** Devon correctly identifies that the POST must re-validate even though the GET already filtered (good — this matches the use case's own "Facilitator Team Membership Constraint Violation" alternate flow on the race condition). What's missing is what the *user* sees when this happens: does the confirm screen show an inline error and let them pick again, does it bounce them back to the picker, does the picker refresh automatically? The backend behavior is well specified; the corresponding frontend behavior for this specific failure mode isn't described at all, and it's exactly the kind of edge case that gets improvised inconsistently across screens if it isn't written down once.
- **§6.1, "the picker page needs to attempt the GET and branch on 403 vs 200."** This is presented as a viable fallback if `AuthSession` isn't extended, but given §4's point about needing to distinguish "not a facilitator" from "zero eligible teams" for the *same* endpoint, and now also needing to distinguish "not a facilitator" for *navigation* purposes, I don't think this fallback is actually viable — it would require the frontend to correctly interpret three-way meaning out of a two-way (403/200) response. I'd cut this alternative from the proposal rather than leave it as an implied fallback option; the `AuthSession` change is not optional if §1 resolves toward "this matters."

---

## Summary of clarifications needed (in priority order)

1. **Blocking:** Resolve whether a facilitator can have zero team memberships in practice (§1) — this determines whether §6.2 and part of §6.1 are in scope at all.
2. Turn §7 (draft vs. lobby) into an explicit decision with a failure-mode path, not a leaning — and flag the use-case-document conflict this creates if auto-advance is chosen.
3. Turn §8's "block or warn" into "block," or get an explicit business reason for "warn," and reconcile the race-condition standard applied here with the one applied in §3/§5.
4. Add the enumerated test scenarios to §3 rather than "add a test."
5. Specify exact response shapes/copy for the two empty-vs-unauthorized distinctions in §4 (GET eligible-teams) and confirm the same status-differentiation applies to the POST 403s in §3.
6. Specify the frontend behavior for the race-condition rejection path (§5) — currently backend-only.

None of this requires re-exploring the codebase — it's requirements precision work, and most of it can be resolved by decision rather than further investigation. I'd rather spend a day tightening these six items now than have the implementation team come back mid-build asking what "block or warn" means.
