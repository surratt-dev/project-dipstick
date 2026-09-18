# Champion Sign-Off — `reauth-required-client-prompt` (issue #32)

**Reviewer:** Devon Calloway, Internal Champion
**Scope:** Did this change answer the question issue #32 actually asked, and did it hold the line on the things I don't let get negotiated away.

## Verdict: Sign off, with one open item that is correctly still open

This is the real thing, not a wording pass. `reauth-required` now gets its own considered treatment — `role="alert"`, a working CTA live from first render, a visual register instructed to be distinct from `unknown-reconnecting` — instead of the two states continuing to share a passive `role="status"` div with different words in it. That was the actual ask in #32, and it's answered on the merits, not by asserting it was answered.

### The constraints I care about, checked against the code, not the prose

- **`connectionHealth.ts` not forked.** `git diff main -- packages/frontend/src/realtime/connectionHealth.ts` is empty. The state machine, its cause-blindness, its sticky/terminal guard — untouched. Good.
- **`unknown-reconnecting` left alone.** Its rendering, role, and timing are unmodified in both files. The disclosure-blind pair stays disclosure-blind.
- **No SEC-26 sub-cause disclosed.** The copy names only "your session needs to be renewed" — no revocation, no retry-budget exhaustion, no session-destruction language. Backed by a grep test, not just a reviewer's read of one draft.
- **No grace-period value exposed.** No countdown, no digit-plus-time-unit string, and — because someone on this team was paying attention — the check was widened to catch the value leaking through an attribute or an animation timed to the constant, not just the visible text. That's the right instinct. A countdown doesn't have to be numeric to be a countdown.
- **Role-uniform treatment — actually uniform, not just claimed.** This is the part I want to say more about. The original scope for this change touched `ConnectionStatusBanner.tsx` only and asserted, on the strength of an existing spec line, that the facilitator already got equivalent treatment. That assertion was wrong — `FacilitatorReadinessGrid.tsx` had its own independently-duplicated placeholder, never wired to the shared logic. That's exactly the kind of gap I worry about: two copies of something that's supposed to be one, discovered by citation instead of by reading the code, quietly drifting.

  What I want on the record is that this wasn't caught and then smoothed over — it was caught mid-pipeline, the scope was reopened, and the fix is a real structural one: one shared subcomponent, no props, consumed by both surfaces, with the old duplicate deleted rather than left dead alongside it. The test that would have caught the original gap (`reauthRequiredHostParity.test.tsx`, mounting the real host components instead of two instances of the same banner) exists now. That's the difference between "we said it's uniform" and "it can't quietly stop being uniform without a test going red." I'd rather see a scope correction happen in the open like this than see it not happen at all.

### The one thing still open, and it should be

Copy sign-off is not done. Task 3.1 and 6.2–6.4 are unchecked, and the component's own header comment says so in plain language: "COPY IS NOT FINAL... Do not treat this wording as implementation-ready." Task 3.2 is checked, but the architect's own review flagged that the checkbox overclaims — what shipped is a draft consistent with the content checklist, not signed-off copy, and that distinction matters. I'd rather see an honest partial checkbox than a green checkmark that quietly means less than it says.

This is exactly right, not a shortcoming. Priya owns the literal sentence and the visual register against a real mock — that's her call to make, evaluated in actual layout, not something that should get decided by a design document or by me. The gate in tasks.md Group 6 is explicit that this treatment does not go to a real pilot session until her sign-off and the usability check close. I'm not going to pretend this is fully done when it isn't — the team didn't pretend that either, and I want to note that they didn't.

## Bottom line

The structural bounds held: single state machine, no disclosure leak, no role fork, and — when a fork was found to have already happened by accident on the facilitator surface — it got fixed for real instead of papered over. The mechanism is done and tested (258 passing tests, security review's independent re-verification, architect's independent re-verification). What's left is Priya's copy and mock sign-off, which was never mine or the implementation team's to close. Ship the mechanism to staging as scoped; hold the pilot gate until Group 6 closes.

No exceptions requested, none granted.

— Devon
