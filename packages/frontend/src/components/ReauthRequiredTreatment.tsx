// ---------------------------------------------------------------------------
// ReauthRequiredTreatment — shared reauth-required rendering
//
// websocket-staleness-signal / reauth-required-client-prompt: design.md
// Decision D9 (resolves engineer design-review Finding 1). Consumed by both
// ConnectionStatusBanner.tsx (participant) and FacilitatorReadinessGrid.tsx
// (facilitator), in place of each maintaining its own copy, so the two
// surfaces cannot silently drift apart the way they already had.
//
// session-timeout-continuity (design.md Decisions 3, 4) adds the first two
// deliberate, narrow exceptions to "no props derived from cause, role, or
// session-moment state": `returnTo` (an internal path — this application's
// own current-page path/query, never a value derived from cause, connection
// state, or another user's identifier) and `role` (which conditions ONLY
// the vote-loss sentence's presence). Neither reopens D9: the component
// still has exactly one state machine, one CTA/navigation mechanism, and one
// ARIA role, all unconditional; `returnTo` only appends a query parameter to
// the same `/auth/login` navigation, and `role` only toggles one sentence.
// Every other content element remains role-blind and cause-blind.
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
// STYLING IS SIGNED OFF. The visual register below (amber/warning color,
// 2px border, closed-lock icon) is the real, committed register — not a
// placeholder. Signed off, clean, by reauth-required-copy-and-visual-
// signoff/mock-signoff.md (#140, "Signed off").
//
// COPY IS SIGNED OFF. The text in REAUTH_REQUIRED_TEXT_BASE is signed off
// by reauth-required-copy-and-visual-signoff/copy-layout-signoff.md (#141,
// "Signed off with conditions" — the stated condition, rewording this
// clause to lead with the action verb, was implemented and verified per
// that artifact's §6a; treat as a clean pass per its own terms).
//
// Vote-loss sentence (design.md Decision D5, tasks.md tasks 1.1/3.6, narrowed
// to the participant role only by session-timeout-continuity's Decision 4):
// included for the participant role because, as of this change's
// implementation, no vote-compose UI in the codebase imports voteDraft.ts's
// persist/restore hooks yet — verified by
// packages/frontend/src/realtime/__tests__/voteDraft.grep.test.ts. If that
// test ever starts failing, the sentence must be removed for the participant
// role as part of the same change (see openspec/specs/vote-compose-recovery/
// spec.md's Build status note and this change's tasks.md task 1.2). Omitted
// for the facilitator role unconditionally, regardless of that determination
// (facilitators never vote).
//
// No reveal-timing awareness (design.md Decision D6, tasks.md task 5.2): this
// component reads no session-moment state (`returnTo`/`role` are the only two
// props, per the exception noted above), so it renders identically whether
// or not a reveal is concurrently in progress. A stubbed "reveal in progress"
// fixture test is not constructible today because no reveal-state test
// harness exists yet (the live voting UI isn't built) — tracked as a
// follow-up integration test riding the same forward hook as tasks.md task
// 1.3, against the eventual vote-compose UI change.
// ---------------------------------------------------------------------------

const REAUTH_REQUIRED_TEXT_BASE =
  "Your session needs to be renewed. Log in again to continue — you'll leave this page and return to it once you're signed back in.";

// facilitators never vote (BRD.md §3's ritual narrative; entities-and-
// relationships.md's Facilitator relationship list has no "casts vote"
// entry) — this sentence is factually inapplicable to that role,
// unconditionally, regardless of the voteDraft.ts import determination that
// governs the participant case below (design.md Decision 4).
const VOTE_LOSS_SENTENCE = " Any vote you haven't submitted yet will be lost.";

// Per the "Conditional vote-loss disclosure" requirement's "Current status"
// note: this determination is made exactly once, at implementation time, by
// a single checkable fact (whether a vote-compose UI imports and calls
// voteDraft.ts's persist/restore hooks) — NOT re-evaluated at runtime via a
// filesystem grep, which is a test/build-time-only mechanism
// (voteComposeWiring.ts uses node:fs and cannot run in the browser).
// packages/frontend/src/realtime/__tests__/voteDraft.grep.test.ts enforces
// that this constant stays correct: if a real vote-compose UI ever starts
// wiring voteDraft.ts, that test starts failing, and this constant must be
// flipped to false in the same change (see that test's own comment, and
// openspec/specs/vote-compose-recovery/spec.md's forward-pointing note).
const PARTICIPANT_VOTE_COMPOSE_UI_WIRES_VOTE_DRAFT = false;

// Visual register (tasks.md task 1.1, design.md Decision D2): amber/warning
// direction, not red/error — reuses the existing amber precedent
// (MemberManagement.tsx's zero-participant warning: #fff3e0 background /
// #ffb74d border) rather than inventing new color values. Border weight is
// 2px (kept from the prior placeholder's weight, and heavier than that
// precedent's 1px) since this state is a forced, non-self-resolving
// disconnect (role="alert"), not a contextual confirmation dialog.
const REAUTH_REQUIRED_STYLE = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.75rem",
  backgroundColor: "#fff3e0",
  border: "2px solid #ffb74d",
  borderRadius: "4px",
  padding: "0.75rem 1rem",
};

// Icon color matches the border accent above, applied via CSS `color` so the
// inline SVG's `currentColor` fill/stroke inherit it (design.md D2: prefer
// inline SVG with fill="currentColor" over a Unicode glyph, which can force
// color-emoji presentation in some fonts and fight the applied color).
const REAUTH_REQUIRED_ICON_STYLE = {
  flexShrink: 0,
  marginTop: "0.125rem",
  color: "#ffb74d",
};

export interface ReauthRequiredTreatmentProps {
  /**
   * The current page's path and query string (never a full origin, never a
   * value derived from connection state, cause, or another user's
   * identifier) — appended as the `returnTo` query parameter on the login
   * navigation (design.md Decision 3). Omitted call sites navigate to bare
   * `/auth/login`, unchanged from before this prop existed.
   */
  returnTo?: string;
  /**
   * Conditions ONLY the vote-loss sentence's presence (design.md Decision
   * 4) — every other content element, the ARIA role, persistence behavior,
   * visual register, and CTA/navigation mechanism remain identical
   * regardless of this value.
   */
  role: "participant" | "facilitator";
}

export function ReauthRequiredTreatment({ returnTo, role }: ReauthRequiredTreatmentProps) {
  const includeVoteLossSentence =
    role === "participant" && !PARTICIPANT_VOTE_COMPOSE_UI_WIRES_VOTE_DRAFT;
  const text = includeVoteLossSentence
    ? REAUTH_REQUIRED_TEXT_BASE + VOTE_LOSS_SENTENCE
    : REAUTH_REQUIRED_TEXT_BASE;

  return (
    <div role="alert" style={REAUTH_REQUIRED_STYLE}>
      {/*
        Closed-lock glyph, from design.md D2's starting allow-list — reads as
        "your session is locked, sign in again," not as a duration or
        countdown. Purely decorative: aria-hidden and no accessible name
        (no <title>, aria-label, or title attribute), which also sidesteps
        the digit-pattern test's innerHTML/attribute scan by construction —
        there is no accessible-name text for a digit+time-unit pattern to
        appear in.
      */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
        style={REAUTH_REQUIRED_ICON_STYLE}
      >
        <path
          d="M7 10V7a5 5 0 0 1 10 0v3"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor" />
      </svg>
      <div>
        <p style={{ margin: 0 }}>{text}</p>
        <button
          type="button"
          style={{ marginTop: "0.5rem" }}
          onClick={() => {
            window.location.href = returnTo
              ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
              : "/auth/login";
          }}
        >
          Log in again
        </button>
      </div>
    </div>
  );
}
