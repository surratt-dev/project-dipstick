# Propose-Stage Review — Business Analyst

**Reviewer:** Marcus Delgado, Senior Business Analyst
**Reviewing:** `proposal.md`, `design.md`, `specs/websocket-staleness-signal/spec.md`, `tasks.md` (issue #32, SEC-26 reauth-required client prompt)
**Scope of this review:** Are capabilities specific enough to implement? Are acceptance criteria explicit? Is vague language flagged with concrete replacements? Does this hold up against `requirements/` and the codebase as it actually stands?

---

## 1. All four items from my explore-stage review were carried forward and hardened

I checked each of my `explore-review-ba.md` findings against what actually landed in Propose, not just whether it was acknowledged in prose:

- **voteDraft.ts/#31/PR#42 build-time-checkable gate:** Fully carried forward and improved on what I asked for. Design D5 states the exact grep-checkable condition; `spec.md`'s new "Conditional vote-loss disclosure" requirement gives it two GIVEN/WHEN/THEN scenarios; `tasks.md` Group 1 makes it a literal, sequenced checklist item ("grep the codebase... record the result... in the commit message or PR description"). I verified independently: `voteDraft.ts` is still imported only by its own test file (`packages/frontend/src/realtime/__tests__/voteDraft.test.ts`); the one other hit, a comment in `packages/backend/src/realtime/websocket-routes.ts:280`, is prose, not an import. No vote-compose UI component exists anywhere in the tree. The proposal's factual claims here are accurate as of today.
- **Issue #36 citation:** Carried forward and correctly used — not just cited, but the pilot-readiness gate requirement is *extended* with new scenarios that name the `reauth-required` mock/usability items as siblings of the still-open #36 items, so the gate can't be marked closed by a paragraph. I confirmed #36 is open and titled exactly as described (`gh issue view 36`).
- **"No countdown" rendered-output test:** Carried forward as D3, a spec requirement with its own scenario, and `tasks.md` 3.3, with the same regex pattern and explicit reference to the `unknown-reconnecting` precedent test. Good.
- **`role="alert"` question:** Resolved, not punted. D1 makes the call explicitly (assertive, persistent, distinct-but-non-modal) and spec.md encodes it as a scenario with a concrete assertion (`role="alert"` vs `role="status"`). This is exactly the kind of "decided, not deferred" outcome I was pushing for in explore.

No open loops from my prior review were dropped.

## 2. A stronger citation is available for D7 that the design doesn't use — worth adding

D7 (role-uniform copy and CTA) argues its case from `websocket-connection-reauthorization`'s D2/D3/D9a and a use-case doc. That's fine, but I checked the base capability's own spec (`openspec/changes/archive/2026-09-10-websocket-staleness-signal/specs/websocket-staleness-signal/spec.md:99`) and there's a more direct, load-bearing sentence sitting right there, in the capability this change is modifying:

> "The marker's signal source SHALL be the facilitator's own `unknown-reconnecting` state specifically; when the facilitator's own connection is in `reauth-required` instead, no grid-marker variant SHALL be shown — the facilitator's client SHALL instead render the same top-level `reauth-required` treatment used elsewhere, in place of the grid."

This isn't just consistent with D7 — it's a pre-existing, shipped requirement that the facilitator's `reauth-required` experience **is** the same top-level treatment, full stop, superseding the grid entirely. D7 should cite this line directly rather than relying only on adjacent-capability reasoning. It closes the door on a reviewer asking "but does the facilitator readiness grid need its own reauth-required marker?" — the answer is already "no" and already shipped, not a new judgment call this change is making.

**Suggested addition to D7:** one sentence citing `websocket-staleness-signal`'s existing grid-marker requirement by name, making clear this change's role-uniformity is compliance with an existing constraint, not a new policy choice.

## 3. Two acceptance criteria are softer than the rest of this document's own standard — flag before Design sign-off closes

This document holds itself to "build-time-checkable, not a judgment call" as its own explicit bar (D5's framing). Two tasks don't clear that bar yet:

- **Task 3.5** (leaving-and-returning statement test): "Manual/code-review check acceptable if not cheaply string-matchable against final copy; document which." This is the one acceptance condition in the whole document phrased as a permission to skip automation rather than a requirement. Given D4's checklist item 3 is a *fixed, known phrase requirement* (not free-form copy), it should be string-matchable in the overwhelming majority of cases — recommend tightening to: "assert the rendered text contains the literal phrase used in the signed-off copy" as the default, with the manual-check escape hatch reserved only for the case where sign-off produces implicit phrasing (e.g., conveyed via layout/iconography rather than a sentence) — and require that escape hatch to be justified in the PR description, not just silently invoked.
- **Task 5.2** (reveal-collision test): appropriately defers to "no reveal-state harness exists yet" but the deferral itself is underspecified — it says to "document this as a follow-up integration test" without naming *where*. Every other deferred-but-tracked item in this document (vote-loss re-check, gate items 6.2–6.4) has a named owner and a tracking location (a GitHub issue, a tasks.md line). This one doesn't. Recommend: file the follow-up against whichever issue tracks the live-voting UI build (or open a new one) and reference it by number here, mirroring the discipline the rest of the document uses everywhere else.

Neither of these blocks Design sign-off — they're implementation-time tightenings — but I'd rather flag them now than have them surface as "what did you mean by this?" during Group 3/5 implementation.

## 4. Requirements-doc check: no conflict with simultaneous-reveal integrity

I checked D6 (reveal-window collision, accepted as rare) against `requirements/voting mechanics - enhanced.md:53-55`, which is where the simultaneous-reveal mechanic — the one property I consider genuinely load-bearing for the ritual — is specified. D6 doesn't touch reveal timing, sequencing, or visibility; it only accepts that a `reauth-required` banner can render in visual proximity to an unrelated reveal moment, and states plainly that no code path coordinates the two. That's a UX-confusion risk, not a reveal-integrity risk — the server-side simultaneity guarantee is untouched, which the design says explicitly and the new spec requirement makes grep-verifiable. No objection from me here; this is the right call and correctly scoped.

## 5. Minor, not blocking: a pre-existing stale comment this change's own task touches

Not something this proposal introduced, but worth a look since Group 3 already edits the same lines: `ConnectionStatusBanner.tsx`'s header comment currently says "Both strings below are placeholders pending Priya Nair's sign-off," covering both `UNKNOWN_RECONNECTING_TEXT` and `REAUTH_REQUIRED_TEXT`. But the archived `websocket-staleness-signal` spec states the `unknown-reconnecting` copy sign-off is *already closed* (`gate6-facilitator-signoff.md`). The comment appears to have gone stale after that sign-off landed. Task 3.2 already plans to update this comment for the `reauth-required` string — recommend expanding that task's scope by one clause to also correct the now-inaccurate "both strings" framing while the comment is being touched anyway, rather than leaving a second stale claim behind for whoever reads it next.

## Summary of recommended changes before this moves to Design sign-off

1. Add the direct grid-marker-requirement citation to D7 (§2).
2. Tighten task 3.5's acceptance condition to default to string-matching, with a justified escape hatch (§3).
3. Give task 5.2's deferred integration test a named tracking location (§3).
4. Fold a one-clause fix for the stale "both strings" comment into task 3.2 (§5).

Everything else — the vote-loss gate, the ARIA/visual decisions, the CTA wiring, the no-special-casing bound, the pilot-readiness gate extension — is specific enough to build against without coming back to me. This is the most buildable version of this proposal I've reviewed at any stage so far.
