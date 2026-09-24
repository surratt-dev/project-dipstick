# Tasks Review — Requirements Coverage (Marcus Delgado, BA)

Reviewed `tasks.md` against `proposal.md` and `specs/join-link-copy/spec.md`. Overall coverage is strong — every requirement in spec.md maps to at least one task, and every task traces back to a stated requirement or an explicit design decision. Three items worth resolving before implementation starts, none of which I'd call a blocker.

## Gaps

**1. "Manual selection always works regardless of clipboard state" scenario has no corresponding task.**
Spec.md's third requirement lists three scenarios: API-unavailable (→ tasks 1.10/2.5/4.4), write-rejects (→ 1.4/1.9/4.5), and "Manual selection always works... without interference from the application" (spec.md lines 54–56). That third scenario has no task or test anywhere in tasks.md. It's plausible the intent is "don't add anything that would interfere, so there's nothing to build or test" — but that's an assumption, not a stated one. Given this project's history of catching things that look done but aren't reachable (this whole change exists because of that pattern), I'd rather see it named explicitly: either a one-line task confirming the rendered link text has no `user-select: none` / no `onCopy` interception, or an explicit note in tasks.md mirroring the note already given for the "Control persists" scenario, saying why no task is needed.

**2. Design D4's "banner survives the draft→lobby transition in place" decision has no automated test.**
Design.md is explicit that this is a deliberate decision, not an accident of shared state (D4, and the spec's "Copied URL is identical across draft and lobby status" scenario leans on it). Task 5.2 is manual-only and checks that copy *works* after the transition, not that a banner *already showing* survives the transition without being reset. Given design-review-engineer.md already caught two timer bugs in this exact hook (2a/2b, now tasks 1.6/1.7/1.11/1.12), a transition-survival case seems like the natural fourth timer edge case to lock in with an automated test rather than leave to manual verification.

## Clarification (low priority)

**3. The "no `execCommand('copy')` or unverifiable fallback" negative requirement isn't tested.**
Spec.md states this as a SHALL-NOT. Design D2 addresses it as an implementation decision (feature-detect only), but no task turns it into a checked assertion. Nothing in tasks.md would introduce `execCommand`, so risk is low — just confirming this is meant to be a design-level guarantee rather than something the test suite verifies.

## Non-issues confirmed

- "Control persists for the full waiting window" — correctly and explicitly excluded per tasks.md's own note; agree with the reasoning.
- Proposal's two "Not in scope" items (`SessionLobbyPage`, source use-case doc) are correctly left untouched, with 5.3 verifying the former.
- No orphan tasks — everything in §1–5 maps back to a spec requirement or a named design-review finding.
