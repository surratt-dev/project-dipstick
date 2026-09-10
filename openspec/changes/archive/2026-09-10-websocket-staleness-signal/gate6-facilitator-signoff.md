# Gate 6 Facilitator Sign-Off — Priya Nair

Reviewed: proposal.md, design.md (Decisions D10, D11, Open Design Questions), tasks.md (6.1–6.4), gate6-mock/mock-summary.md, and all four screenshots directly.

## Task 6.1 — Copy sign-off: **SIGN OFF, with non-blocking notes**

All three strings, as filed:

- `unknown-reconnecting`: "Your view may be out of date. Refresh to continue."
- `reauth-required`: "Your session needs to be renewed. Please log in again."
- Facilitator tooltip: "Last known state may not be current."

I'm signing off on these. They hold the line I asked for: no exclamation points, no "error," no urgency language, no implied blame on the participant or the network. Reading them cold, none of the three trips my "does this read as an alarm" test — they read as administrative, not emergency. The two banner strings are also appropriately interchangeable in tone with each other despite being different states, which is correct — a participant shouldn't be able to infer which of two "bad" things happened from word choice alone, and here they can't, because both are calm.

Two things I want on record, neither of which blocks sign-off:

1. **The tooltip's actual rendering is unverified.** Screenshot 4 is honest about this — the dark bubble is a labeled simulation, not a capture of the real OS-drawn `title` tooltip, because a `title` attribute renders outside the page's paint surface and can't be screenshotted by the tooling used here. I accept the explanation and the workaround (programmatic confirmation that the real `title`/`aria-label` text matches). But I want it said plainly: I have not seen what this tooltip actually looks like — its delay before appearing, its font, its contrast, how it wraps or clips near a screen edge. A native browser tooltip's appear-delay (often 500ms–1.5s depending on browser/OS) is a real variable for "self-explanatory without a tutorial," and I can't evaluate it from a mock. This is exactly the kind of thing 6.3 needs to cover live — see below.
2. **Consider whether `title`-attribute delivery is the right mechanism at all**, separate from the copy itself. A facilitator scanning a grid quickly during a live session may not hover long enough to trigger a native tooltip on the row they care about. This is an implementation/interaction question, not a copy objection — I'm not withholding sign-off over it — but I'd like engineering to at least consider a lighter-weight, no-delay affordance (even something as simple as a shorter native delay isn't controllable, so maybe a custom-rendered tooltip) before this locks in. Flag it, don't block on it.

## Task 6.2 — Visual-register mock sign-off: **WITHHOLD SIGN-OFF**

I want to be straightforward about this rather than soften it: **screenshot 3 does not let me make the call this gate exists for.**

Design's Open Design Question 1 asked me to resolve a real tension — is the marker a dimmed/hollow variant of "still connected, just uncertain," or is it closer to the existing `disconnected` treatment? Looking closely at screenshot 3, the marker renders as a bare glyph (reads as a circle/letter-O character) appended **directly adjacent to the row label with no space, no opacity change, no size difference, no color difference** from the surrounding text: `ConnectedO`, `ReadyO`, `ReadyO`, `DisconnectedO`. It is rendered in the exact same weight and color as the label it's glued to.

That is not "closer to dimmed/hollow." It is also not "closer to disconnected-adjacent." It is neither register — it's an unstyled placeholder that happens to satisfy the letter of "introduces no new color/icon language" only because it introduces no visual language at all. I can't sign off on a visual-register decision when the artifact in front of me hasn't actually attempted either register. If I signed off on this, I'd effectively be pre-approving whatever gets built later under the assumption it will look like "the dimmed one" — but nothing here shows me that, and task 4.7's own bar is "an intentionally neutral placeholder style," not "no style." This reads as the latter.

Concretely, to close this gate I need a revised mock that:

1. **Actually applies some minimal visual differentiation** — reduced opacity, a distinct hollow/outline glyph at a readable size with proper spacing from the label text, or some other unstyled-but-legible treatment — enough that I can tell whether it's trending toward "uncertain, still basically fine" or toward "this row is in trouble."
2. **Uses visible spacing/positioning** so the marker doesn't read as a typo or a rendering bug at a glance. Right now, if I saw this in a real facilitator session cold, my first reaction would be "something's broken," which is the opposite of what a calm uncertainty signal should produce.
3. Separately — not a blocker for this gate, but I noticed it and want it on record: rows 2 (`connected+locked-in`) and 3 (`disconnected_voted`) render as visually identical text ("Ready" + marker) in this fixture, with nothing distinguishing a still-connected locked-in participant from a disconnected-but-counted-ready one. If that's a simplification specific to this test fixture and the real grid has other visual distinctions (color, icon) I'm not seeing here, fine — but I'd like that confirmed, because it affects whether I can trust this mock's rendering of the *baseline* grid enough to judge a marker layered on top of it.

To be clear about what I'm not objecting to: I have no objection to the copy, to the marker being cause-blind, to its lockstep lifecycle, or to it composing with `disconnected_voted` rather than being suppressed by it — the mechanism described in design.md D7 and exercised by the tasks in Group 4 sounds right, and I'm not reopening any of that. My objection is narrowly that **the placeholder as captured is not yet a placeholder of anything** — it doesn't embody a register I can react to. Get me a version with even minimal, rough styling and I expect this will move quickly.

## Task 6.3 — Live usability test: cannot be performed here, and here's what it needs to cover

I want to say this plainly rather than let a thorough document review stand in for it: **this gate requires an actual live session with a real human in the room, and nothing in this review substitutes for that.** A static mock, however well captured, cannot tell you what a facilitator actually notices, feels, or does while running a real session under real cognitive load. Specifically, 6.3 needs to cover, and this review cannot:

- **Peripheral-attention legibility.** Whether I actually notice the marker appear while I'm focused on the room, not on the grid — a calm review of a screenshot is the opposite condition from facilitating live.
- **The real native tooltip** — actual appear-delay, font, contrast, and positioning, none of which the simulated bubble in screenshot 4 can stand in for.
- **The 2000ms timing floor's felt experience** against real, ordinary conference-room wifi flakiness — whether it feels responsive or laggy, and whether it successfully avoids the "flickers on every hiccup" failure mode it's meant to prevent.
- **Scale.** Four rows in a fixture is not fifteen or twenty real participants — whether the marker firing on every row simultaneously reads as calm or as a wall of simultaneous change at real team size.
- **Silent recovery, felt live.** Design deliberately gives no "reconnected" signal (D4). Whether that absence feels reassuring or feels like uncertainty about whether anything actually came back needs a real person's reaction, not a design rationale.
- **The core question I keep returning to: does this read as an alarm, in the moment, to me, while I'm actually running a session** — not in the calm, analytical frame of a document review like this one.

I remain available and expect to be taken up on this before any pilot team's first live session, per my own standing commitment carried into tasks.md 6.3/6.4.

## Summary

| Gate | Verdict |
|---|---|
| 6.1 — Copy sign-off | **Sign off**, with non-blocking notes on tooltip-delivery mechanism |
| 6.2 — Visual-register mock sign-off | **Withheld** — placeholder does not yet embody either candidate register; needs minimal real styling before I can judge |
| 6.3 — Usability test | Not performed; requires a live session, cannot be satisfied by this or any static review |

— Priya Nair
