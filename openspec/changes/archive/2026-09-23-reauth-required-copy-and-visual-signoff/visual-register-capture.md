# Visual register — real host capture (tasks.md task 1.4)

Produced by Group 1 (implementation) as the review surface for Group 2's
mock sign-off and Group 3's copy-in-layout sign-off. This is a DOM-snapshot
equivalent of a screenshot, not a sign-off judgment — no verdict is rendered
here.

**How it was produced:** both real host components (`SessionConnectionHost.tsx`,
`FacilitatorConnectionHost.tsx`) mounted under `MemoryRouter`, each driven
through a real (faked) `WebSocket` via `FakeWebSocket`, transitioned into
`reauth-required` by emitting a close event with
`REAUTH_GRACE_EXPIRED_CLOSE_CODE` — the same mechanism
`reauthRequiredHostParity.test.tsx` already uses. Not a bare/isolated
instance of `ReauthRequiredTreatment` (design.md Decision D1).

## Visual register summary

- Color: `#fff3e0` background / `#ffb74d` border and icon accent — reused
  verbatim from `MemberManagement.tsx`'s existing amber/warning precedent
  (design.md Decision D2), not a new value.
- Weight: `2px solid` border (kept from the prior placeholder's border
  weight; heavier than the `MemberManagement.tsx` precedent's `1px`, since
  this is a forced, non-self-resolving disconnect rather than a contextual
  confirmation dialog), `4px` border radius.
- Icon: closed-lock glyph, inline SVG, `stroke`/`fill="currentColor"`
  (colored via the wrapping `color: #ffb74d`), `aria-hidden="true"`, no
  accessible name of any kind (no `<title>`, `aria-label`, or `title`
  attribute) — chosen from design.md D2's starting allow-list.

## SessionConnectionHost (participant), `role="participant"`

Transitioned via `REAUTH_GRACE_EXPIRED_CLOSE_CODE` on `session-42/live`:

```html
<div data-testid="session-connection-host" style="font-family: system-ui, sans-serif; padding: 2rem;"><div role="alert" style="display: flex; align-items: flex-start; gap: 0.75rem; background-color: rgb(255, 243, 224); border: 2px solid rgb(255, 183, 77); border-radius: 4px; padding: 0.75rem 1rem;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" style="flex-shrink: 0; margin-top: 0.125rem; color: rgb(255, 183, 77);"><path d="M7 10V7a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor"></rect></svg><div><p style="margin: 0px;">Your session needs to be renewed. Continuing will take you to log in again — you'll leave this page and return to it once you're signed back in. Any vote you haven't submitted yet will be lost.</p><button type="button" style="margin-top: 0.5rem;">Log in again</button></div></div></div>
```

## FacilitatorConnectionHost (facilitator), `role="facilitator"`

Transitioned via `REAUTH_GRACE_EXPIRED_CLOSE_CODE` on `session-42/facilitator`:

```html
<div data-testid="facilitator-connection-host" style="font-family: system-ui, sans-serif; padding: 2rem;"><div role="alert" style="display: flex; align-items: flex-start; gap: 0.75rem; background-color: rgb(255, 243, 224); border: 2px solid rgb(255, 183, 77); border-radius: 4px; padding: 0.75rem 1rem;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false" style="flex-shrink: 0; margin-top: 0.125rem; color: rgb(255, 183, 77);"><path d="M7 10V7a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor"></rect></svg><div><p style="margin: 0px;">Your session needs to be renewed. Continuing will take you to log in again — you'll leave this page and return to it once you're signed back in.</p><button type="button" style="margin-top: 0.5rem;">Log in again</button></div></div></div>
```

## Notes for Group 2/3 review

- The two hosts render the identical register (same color, weight, icon) —
  only the vote-loss sentence differs, per D9's existing role-blind
  invariant, which `reauthRequiredHostParity.test.tsx` continues to enforce.
- This capture is evidence for review, not a verdict. Group 2's mock
  sign-off and Group 3's copy-in-layout sign-off must each state explicitly
  which of these two host contexts their verdict covers (design.md Decision
  D6).
