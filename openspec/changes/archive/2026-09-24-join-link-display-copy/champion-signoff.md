# Champion Sign-off — join-link-display-copy

**Reviewer:** Devon Calloway (Internal Champion)
**Verdict:** Approved.

## Disappearing into the background

This passes. It's a label, a link, one "Copy link" button, and a banner that clears itself in 8 seconds — no modal, no toast stack, no animation, nothing asking for attention it hasn't earned. Before this change the facilitator's only option was to manually select text out of a paragraph, which is *more* fumbling in front of a waiting room, not less. A working copy button is the tool getting out of the way, not inserting itself. I have no note here.

## Core constraints

Untouched, and correctly so. I read the diff and the proposal's impact section: this only touches join-link rendering in `DraftSessionHost`. No role checks, no facilitator-eligibility logic, no reveal-timing code, nothing in the manager-participation path is anywhere near this change. Confirmed.

## Copy wording / confirmation honesty

No concern — actually the opposite of what I usually worry about. The hook (`useCopyToClipboard.ts`) only ever calls `navigator.clipboard.writeText()` and treats a rejected promise identically to the API being unavailable, explicitly to avoid `document.execCommand`-style false-positive confirmations. The "Link copied" banner only appears when the browser has verifiably confirmed the write. The draft-status badge ("This link works already — anyone who opens it before you open the room won't see a waiting screen yet.") is a plain, accurate warning, not a hedge. This is the standard I'd want other features held to.

## The 5.2 gap

Acceptable, not a blocker. The behavior is covered by unit tests that exercise both success and rejection paths in both render branches; what's left is purely "does this render correctly in a live browser," not a question about ritual-affecting behavior. I'd want it checked before this ships to a real facilitator's session, but it doesn't need to hold up the archive, and it doesn't need me — whoever merges should just click through it once.

No changes requested.
