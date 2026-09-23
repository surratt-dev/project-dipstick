# Internal Champion Sign-Off — `reauth-required-copy-and-visual-signoff`

**Reviewer:** Devon Calloway (Internal Champion) — this review, standing as the persona.

**Date:** 2026-09-23

**What I reviewed:** `proposal.md`, `design.md`, `tasks.md`, `mock-signoff.md`, `copy-layout-signoff.md`, `visual-register-capture.md`, `exploration-notes.md`, plus the shipped code directly (`ReauthRequiredTreatment.tsx`, `ConnectionStatusBanner.tsx`) and the living `openspec/specs/websocket-staleness-signal/spec.md`. I re-ran `ReauthRequiredTreatment.test.tsx` (9/9 passing) and `reauthRequiredHostParity.test.tsx` (2/2 passing) myself rather than taking the artifacts' cited numbers on faith.

---

## Did the visual register genuinely serve its purpose, without overreaching?

Yes. The register (`#fff3e0`/`#ffb74d`, 2px border, closed-lock inline SVG) is a real, committed decision, not a restatement of the `currentColor` placeholder this change replaced — I confirmed that directly in the component source, not just in the sign-off's description of it. It stays on the amber side of the amber/red line I'd have drawn myself: no triangle, no exclamation, no red. It also doesn't undersell — `role="alert"`, a heavier border than the existing warning precedent it borrows from, and a lock icon that reads as "locked," not as ambient chrome. This is the balance I was protecting for in exploration §6, and it landed where I'd hoped: distinct enough to be taken seriously, not dressed up as an error.

## Was the SEC-26 non-disclosure boundary and no-countdown constraint preserved through implementation?

Yes, and this is the part I was most worried would erode between design and code — a checklist can survive a design doc and still get quietly weakened in the diff. It didn't. Three things I checked directly rather than trusting the summary:

- The no-animation constraint isn't a one-time grep note in a markdown file — it's now a standing test (`ReauthRequiredTreatment.test.tsx`, the second `describe` block) that asserts against `animation`, `transition`, `@keyframes`, and `duration` in rendered `innerHTML`. I ran it myself; it passes. Design.md's D3 also names the honest limitation of this check (a future imperative style mutation wouldn't be caught) rather than overselling it as closed — I don't have to take that on faith either, since the component today genuinely has no hooks/effects that could do that.
- The icon carries no accessible name at all (`aria-hidden="true"`, no `title`, no `aria-label`) — so there's no attribute-text surface for a digit-plus-time-unit string to sneak into, which the digit-pattern test's `innerHTML` scan would otherwise be blind to if someone had given the glyph a label like "5 minutes remaining." That's a real, specific closing of a gap the design doc called out (D2's implementation constraints), not a hypothetical one.
- Nothing in the shipped copy or icon discloses which SEC-26 sub-cause fired. "Your session needs to be renewed" stays cause-blind, matching what shipped in the prior change and unchanged here.

## Was the simulated Facilitator sign-off handled with appropriate honesty?

Yes. This is the thing I'd have withheld sign-off over if it weren't true, and I checked it harder than the rest. `mock-signoff.md` came back clean (`Signed off`) — I'd have wanted to see some friction even in a clean pass, and I found it: the 2px-vs-1px border-weight deviation from the `MemberManagement.tsx` precedent is flagged and justified rather than silently matched, which is the kind of small honest note that tells me the reviewer was actually looking, not rubber-stamping a template.

The one real finding is in `copy-layout-signoff.md`: "Continuing will take you to log in again" was flagged as reading passive-by-abstraction against the register's assertive intent, and the sign-off closed `Signed off with conditions` rather than waving it through as a minor stylistic note. I verified the resolution is not glossed over — §6a shows the actual diff (`REAUTH_REQUIRED_TEXT_BASE` now reads "Log in again to continue — you'll leave this page and return to it..."), and I confirmed in the live source that this is exactly the string shipped, not just the string proposed. The condition also preserved the literal, test-asserted phrase "leave this page and return to it" — the reword fixed the flagged weakness without touching the one clause a CI test depends on verbatim, which is the right kind of narrow. This is a legitimate found-and-resolved condition, not manufactured busywork and not glossed over.

## Is the #142/#143 boundary still intact?

Yes, and it's stated more times than strictly necessary, which I read as a feature here, not noise. Every artifact I read — proposal.md, design.md, both sign-off artifacts, exploration-notes.md, and the updated spec.md status text — carries some version of "a clean #140/#141 pass is not evidence toward #142." That line doing work in five separate places is exactly the redundancy I want on a boundary like this one; a single mention is one place for the caveat to get trimmed out in a later edit. The spec.md status update (`Requirement: Pilot-readiness gate on the staleness signal`, "Current status") states plainly that the gate remains partially open — #36's remaining items and #142 both still block a real pilot session — and does not let #137–#141 closing read as more progress than it is.

## Ritual constraints (no-manager rule, simultaneous reveal, facilitator-from-another-team)

Confirmed not touched, as expected — this change is scoped to connection-status copy and visual presentation, not session mechanics, participation rules, or facilitator assignment. Nothing in the diff or the artifacts comes near these.

## Anything else worth naming

Not a blocker, but worth recording since it's exactly the kind of thing I've said I don't want to become someone's help-desk question later: `design.md`'s own Non-blocking Observation notes that #137–#143's GitHub issues still have no `blocked-by`/`blocking` links wired, so the ordering this whole change depends on is enforced only in prose. That was already true going into this change and this change didn't make it worse — it just carried the caveat forward honestly instead of letting it go unmentioned. I'd like to see it wired eventually, but it isn't this change's job to do that, and the team was right not to scope-creep into it here.

---

## Verdict

**Signed off.** This change did what it said it would do, closed the gate items it closed for real reasons with real evidence, and left the boundary it wasn't supposed to cross exactly where it was. No condition to attach — the one condition raised inside this change's own review (`copy-layout-signoff.md`) was already resolved and verified before reaching me. I have no unresolved concern that should block proceeding to PR.
