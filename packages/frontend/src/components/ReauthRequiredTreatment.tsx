// ---------------------------------------------------------------------------
// ReauthRequiredTreatment — shared reauth-required rendering
//
// websocket-staleness-signal / reauth-required-client-prompt: design.md
// Decision D9 (resolves engineer design-review Finding 1). Consumed by both
// ConnectionStatusBanner.tsx (participant) and FacilitatorReadinessGrid.tsx
// (facilitator), in place of each maintaining its own copy, so the two
// surfaces cannot silently drift apart the way they already had.
//
// Takes no props derived from cause, role, or session-moment state (D6/D7/D8's
// blindness bounds) — if it did, the two call sites could diverge again by
// passing different values, which is exactly the failure mode this decision
// closes.
//
// role="alert" (assertive), not role="status" — this state is a silent
// forced disconnect unless the participant acts, unlike unknown-reconnecting,
// which resolves on its own (design.md Decision D1).
//
// Persistence (design.md Decision D1, tasks.md task 4.2): the simplest
// compliant path is taken — no dismiss affordance is added in this change,
// so there is no code path that hides this treatment before the
// call-to-action is used or the connection closes.
//
// No native <dialog>, no focus trap, no interaction-blocking mechanism
// (tasks.md task 4.3) — this stops short of a full modal by construction,
// it is a plain <div role="alert">.
//
// STYLING IS A PLACEHOLDER (tasks.md task 4.4): the border below is an
// intentionally distinct-but-placeholder visual register, sufficient to
// satisfy "visually distinct register" trivially. The final visual register
// (color, weight, icon) is gated on Priya Nair's mock sign-off (tasks.md
// Group 6) and is not implemented here.
//
// COPY IS NOT FINAL. Pending Priya Nair's sign-off against actual layout
// (design.md Decision D4, tasks.md task 3.1) — see the gate language in
// tasks.md Group 6. Do not treat this wording as implementation-ready.
//
// Vote-loss sentence (design.md Decision D5, tasks.md tasks 1.1/3.6): included
// below because, as of this change's implementation, no vote-compose UI in
// the codebase imports voteDraft.ts's persist/restore hooks yet — verified by
// packages/frontend/src/realtime/__tests__/voteDraft.grep.test.ts. If that
// test ever starts failing, this sentence must be removed as part of the same
// change (see openspec/specs/vote-compose-recovery/spec.md's Build status
// note and this change's tasks.md task 1.2).
//
// No reveal-timing awareness (design.md Decision D6, tasks.md task 5.2): this
// component takes no props and reads no session-moment state, so it renders
// identically whether or not a reveal is concurrently in progress. A stubbed
// "reveal in progress" fixture test is not constructible today because no
// reveal-state test harness exists yet (the live voting UI isn't built) —
// tracked as a follow-up integration test riding the same forward hook as
// tasks.md task 1.3, against the eventual vote-compose UI change.
// ---------------------------------------------------------------------------

const REAUTH_REQUIRED_TEXT =
  "Your session needs to be renewed. Continuing will take you to log in again — you'll leave this page and return to it once you're signed back in. Any vote you haven't submitted yet will be lost.";

const REAUTH_REQUIRED_STYLE = {
  border: "2px solid currentColor",
  padding: "0.75rem 1rem",
};

export function ReauthRequiredTreatment() {
  return (
    <div role="alert" style={REAUTH_REQUIRED_STYLE}>
      <p>{REAUTH_REQUIRED_TEXT}</p>
      <button
        type="button"
        onClick={() => {
          window.location.href = "/auth/login";
        }}
      >
        Log in again
      </button>
    </div>
  );
}
