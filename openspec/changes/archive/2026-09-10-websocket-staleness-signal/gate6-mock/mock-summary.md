# Gate 6 review mock — screenshots + copy strings

Produced for tasks.md 6.1 (copy sign-off) and 6.2 (visual-register mock sign-off). All four
screenshots are real PNG captures of the actual, already-implemented, already-reviewed production
components (`ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx`) — mounted and
force-stated, not redrawn or approximated. Neither component's source was modified to produce
these.

## Screenshots (this directory)

- `01-connection-banner-unknown-reconnecting.png` — `ConnectionStatusBanner` in `unknown-reconnecting`, in the same wrapper markup (`data-testid`, font, padding) `SessionConnectionHost.tsx` uses, with illustrative surrounding session content (clearly labeled as illustrative — the live-session voting UI is out of scope per design.md Non-Goals) and a mock browser-chrome frame so the banner reads "in a page" rather than as a bare snippet.
- `02-connection-banner-reauth-required.png` — same layout, `reauth-required` state.
- `03-facilitator-grid-all-states-with-marker.png` — `FacilitatorReadinessGrid` rendering all four baseline rows (`connected-not-locked-in`, `connected-locked-in`, `disconnected-voted`, `disconnected-no-vote`, from the same `buildFourStateRowFixture()` the unit tests use) with the facilitator's own connection forced into `unknown-reconnecting`, so the marker is composed against every row simultaneously — including the `disconnected-voted` → "Ready" composition task 4.2a covers (visible as "Ready○" in the third row).
- `04-facilitator-tooltip-closeup.png` — close-up (2x scale) on a single row's marker with a genuine `.hover()` performed on it by the capture script (confirmed programmatically: the element's `title`/`aria-label` read exactly `"Last known state may not be current."` at that moment). The dark bubble overlay is a harness-only *simulation* of the native tooltip's position/content, not the tooltip itself — see "Known limitation" below.

## Copy strings (verbatim, as currently shipped)

From `packages/frontend/src/components/ConnectionStatusBanner.tsx`:

- `unknown-reconnecting`: `"Your view may be out of date. Refresh to continue."`
- `reauth-required`: `"Your session needs to be renewed. Please log in again."`

From `packages/frontend/src/components/FacilitatorReadinessGrid.tsx` (`STALE_MARKER_TOOLTIP_TEXT`, the task 4.11 tooltip):

- `"Last known state may not be current."`

All three are marked non-final in code comments pending this sign-off (design.md Decision D11) — this document exists to let Priya Nair review them in situ per task 6.1, not to declare them final.

## Known limitation: the tooltip screenshot is not a capture of the real tooltip

`FacilitatorReadinessGrid`'s marker exposes its tooltip via the standard HTML `title` attribute
(plus `aria-label` for accessibility). A `title`-attribute tooltip is drawn by the browser/OS as
chrome outside the page's own render surface — it is not part of what Chrome DevTools Protocol
`Page.captureScreenshot` (what Playwright and most automated screenshot tools use) captures, even
while genuinely triggered by a real mouse hover. This was confirmed directly: the capture script
performs an actual `locator.hover()` on the marker and reads back its `title`/`aria-label`
attribute value afterward to confirm the hover state and copy are correct, but the resulting
screenshot shows no native tooltip bubble.

The only way to capture the real, browser-rendered tooltip would be a full-desktop screen capture
(e.g. macOS `screencapture`) while the browser window is visibly focused and hovered. That was
deliberately not done here, since it captures the entire screen and risks exposing unrelated
content on it — out of proportion to what a review mock needs.

Instead, `04-facilitator-tooltip-closeup.png` includes a harness-only dark bubble, clearly labeled
"(simulated — see caption above)", positioned near the marker to show the copy and rough
placement. The marker element, its glyph, and the underlying `title`/`aria-label` text are all
real, unmodified production output; only the visible bubble graphic is a stand-in for what the
OS would draw.

## Harness: built and removed

A temporary, throwaway preview harness was added solely to produce these screenshots, then
deleted before this document was written:

- `packages/frontend/gate6-preview.html` (new Vite HTML entry point, isolated from `index.html`/`App.tsx` — no routes or files in the shipped app were touched)
- `packages/frontend/src/gate6-preview/main.tsx` and `Preview.tsx` (mounted the real `ConnectionStatusBanner` / `FacilitatorReadinessGrid` components, forcing state via the same `FakeWebSocket` test double already built for the unit tests — `realtime/__tests__/fake-websocket.ts` — instead of a real backend connection)

Both were removed after capture (`git status` confirms the working tree is clean except for this
`gate6-mock/` directory). Neither `ConnectionStatusBanner.tsx`, `FacilitatorReadinessGrid.tsx`,
`connectionHealth.ts`, `App.tsx`, nor any other shipped file was modified to build or clean up
this harness.

Captured with Playwright driving the system-installed Chrome (`channel: "chrome"`), against
`npm run dev`'s Vite dev server on a scratch port — no CI or build artifacts were affected.

## Test suite

Full frontend test suite re-run after the harness was removed, to confirm nothing shipped was
altered: see the task completion message for the result (all pre-existing tests pass unmodified;
no test files were changed as part of this task).
