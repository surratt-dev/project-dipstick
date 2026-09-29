# Architecture Review: tasks.md — Task Ordering & Dependencies

**Reviewer:** Ingrid Sollenberger, Principal Solution Architect
**Scope of this review:** Whether task ordering respects architectural dependencies — does any task assume something not yet built? Should any task be split or reordered? I am not reviewing UX, domain modeling, or ritual fidelity; those are out of scope for me.

**Overall assessment:** The dependency chain across Sections 2→3→4/5→6 is sound — each section only consumes infrastructure the prior section actually built (backend endpoint before hook, hook before page-wiring, page-wiring before cross-cutting e2e). I have two findings worth resolving before implementation starts, both in Section 1.

---

## Finding 1 (should fix before implementation) — D2's "mechanism 2" branch has no corresponding frontend task

Task 1.2 leaves the registration mechanism genuinely open, per design.md D2:

1. Auto-create/upsert a `session_participants` row at WS-connect or join-link-redemption time.
2. Relax `POST .../participants`'s status gate to accept `lobby`/`pre_session`, **plus a frontend caller** (design.md: "at join-link redemption, or on `SessionLobbyPage`/`DraftSessionHost` mount for a participant").

Task 1.3 onward is written in language that fits option 1 cleanly — "the new registration point," "Fix `sessions.ts`... to the same corrected condition set" — but option 2 requires a piece of work that does not appear anywhere in tasks.md: a frontend call site that actually invokes the (now-relaxed) endpoint. This is not the Facilitator-side roster work in Sections 3–5 — it's participant-side code, and it's currently unaccounted for.

If option 2 is chosen at 1.2, an implementer following tasks.md as written would correctly fix the backend gate (1.3) and would have no task telling them to wire a caller — the gap D7 was meant to close would remain functionally open (endpoint accepts the request now, but nothing ever sends it) while every checkbox in Section 1 gets marked done. That's exactly the kind of implicit, undocumented decision I look for.

**Recommendation:** Make 1.3 (or a new 1.3b) explicitly conditional: "If option 2 is chosen at 1.2, add the frontend caller at [join-link redemption / relevant page mount] in this same pass." This keeps the branch honest instead of letting it fall out of scope by omission if option 2 turns out to be the cheaper or safer implementation choice.

---

## Finding 2 (should fix before implementation) — security review (1.4) is sequenced ahead of the tests it needs to evaluate (1.5)

Current order: 1.3 (implement) → 1.3a (audit logging) → **1.4 (security review, "before merging")** → **1.5 (tests)**.

This is an authorization-boundary change — exactly the category design.md and my own review criteria treat with the most scrutiny. The negative-case tests in 1.5 are not incidental coverage; they're the concrete evidence that the boundary holds: no-team-membership rejection (security review Finding 1's fix), EM rejection via both `global_role` and `membership_role` paths, rejection still holding for `draft` status, and the audit row landing on rejection. A review that runs before these tests exist is a code-reading exercise, not a verified-behavior review — and the review criteria in design.md ("must confirm `membership_exists` is checked... and that the audit event is present") is exactly the kind of claim tests are better positioned to substantiate than a diff read.

**Recommendation:** Reorder so 1.5 precedes 1.4, or at minimum make explicit that the "before merging" gate in 1.4 requires 1.5's suite to already be green — the review should be evaluating tested behavior, not implementation intent.

---

## Observation (not a defect) — Section 1 is labeled "blocking, do first" but is not a hard technical dependency for Sections 2–5

Section 1 (registration write-path) and Section 2 (roster read-path) touch different code: `sessions.ts`'s `POST .../participants`/`lock-in` gate versus a new GET route modeled on `facilitator-sessions.ts`. Section 2's endpoint already calls the *correct* `evaluateSessionSubscriberAccess` Path 1 logic regardless of whether Section 1's fix to `sessions.ts`'s separate (buggy) query has landed — the read side was never coupled to the write side's bug. Section 2/3's unit- and component-level tests can be built against fixture-seeded `session_participants` rows without Section 1 being merged.

The only place a real dependency exists is Section 6's end-to-end tests (6.2, 6.3), which need real join-link registration working, and thus genuinely need Section 1 complete first.

This isn't a flaw — sequencing the security-sensitive change first is a defensible risk-based call, and I'd rather see it reviewed early than late. I'm noting it only so that if implementation bandwidth allows parallel work, the team knows Sections 2–5 aren't actually gated on Section 1's merge — only Section 6 is.

---

## What I checked and found correctly ordered

- **Section 4.1's structural extraction** (child component owning `useConnectionHealth` + the roster hook, mounted only when `currentSessionState !== 'draft'`) correctly precedes 4.2's render step, and correctly follows Section 3 (the hook must exist before it can be rendered). This directly implements the D1 correction (self-DoS prevention via mount/unmount gating, not a conditional hook call) rather than leaving it as an implicit one-line addition — good.
- **Section 3 before Sections 4/5**: the shared hook is built once and consumed by both page integrations, consistent with design.md's "one shared component/hook, not two independently-drifting implementations." No forking risk introduced by the ordering.
- **Section 2 before Section 3**: the hook's initial fetch and re-fetch-on-unrecognized-`userId` (D3a) both depend on the REST endpoint's contract existing first. Correctly sequenced.
- **Section 6 last**: cross-cutting/e2e tests correctly assume all prior sections are complete, including the EM-exclusion check across both the REST path and the live WS path (6.4), and the conformance-spec update contingent on Task 1's outcome (6.5).
- **Task 1.1 as the literal first task**: confirming the failure mode reproduces against the real stack before any change is a sound regression baseline and correctly placed.

---

## Summary

Two findings, both in Section 1, both should be resolved before implementation begins:

1. Add the missing frontend-caller task for D2 option 2, conditioned on 1.2's outcome — otherwise the mechanism-2 branch can ship incomplete while every task checkbox reads done.
2. Reorder 1.5 (tests) ahead of 1.4 (security review), or make the review gate explicitly conditional on the test suite being green — the review should evaluate verified behavior, not just the diff.

Everything downstream of Section 1 (Sections 2 through 6) respects the dependency chain it should: no task assumes infrastructure that hasn't been built by an earlier task in the sequence.
