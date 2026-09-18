# Engineer Design Review — reauth-required-client-prompt

Reviewer: Marcus Oyelaran (Full Stack Engineer)

## Finding 1 (Blocking): The design's scope omits a second, already-duplicated copy of `reauth-required`'s rendering — `FacilitatorReadinessGrid.tsx`

The design's Impact section states affected code is `ConnectionStatusBanner.tsx` only, and Decision D7 asserts: "the facilitator's client SHALL instead render the same top-level `reauth-required` treatment used elsewhere, in place of the grid" — treating this as one shared implementation the facilitator happens to also see.

That is not what the code does today. `packages/frontend/src/components/FacilitatorReadinessGrid.tsx:62,78` has its own independently-declared `REAUTH_REQUIRED_TEXT` constant and its own `<div role="status">{REAUTH_REQUIRED_TEXT}</div>` JSX for the `reauth-required` case — a second, copy-pasted implementation, not a call into `ConnectionStatusBanner`. `FacilitatorConnectionHost.tsx` (the facilitator's actual mount point, analogous to `SessionConnectionHost.tsx`) renders `FacilitatorReadinessGrid`, never `ConnectionStatusBanner`. Confirmed by grep: `ConnectionStatusBanner` is imported only by `SessionConnectionHost.tsx` and its own test file.

Consequence if this change ships as scoped (touching only `ConnectionStatusBanner.tsx`, per tasks.md Groups 1–7): facilitators get none of it. No button, no `role="alert"`, no new copy — they keep seeing the old passive placeholder text with no way to act, forever, in the exact component whose own comment (line 29) says a facilitator "cannot usefully view a live grid regardless of markers" once here. This is the higher-blast-radius case design.md's own Risks section for the sibling change flags, and it would ship unfixed while the design's Impact section and Decision D7 both assert it's already handled.

This won't surface as a test failure either: `FacilitatorReadinessGrid.test.tsx:236` ("renders no grid-marker variant when...reauth-required") only asserts the grid disappears — it doesn't assert a button or `role="alert"`, so it stays green untouched. CI would report full coverage while the facilitator path silently regresses relative to the design's own stated intent.

**This needs to be resolved before implementation, not discovered during it.** Two honest paths, either is implementable:
- Add `FacilitatorReadinessGrid.tsx`'s `reauth-required` branch to this change's scope explicitly, ideally by extracting the `reauth-required` rendering into one shared subcomponent both files import (satisfies D8's "no fork" spirit better than two hand-synced copies) — or, minimally, apply every edit in tasks.md Groups 2–4 to both files and add task 4.7-equivalent coverage that actually mounts `FacilitatorConnectionHost`, not just two instances of `ConnectionStatusBanner`.
- Or, if facilitators are deliberately deferred, say so explicitly in Non-Goals/Impact and correct Decision D7's wording — but that contradicts the Risks section's own facilitator-blast-radius argument, so I don't think this is the intended answer.

Either way, task 4.7's "participant-facing context versus facilitator-facing context" test needs to be pinned to the two real host components (`SessionConnectionHost` vs `FacilitatorConnectionHost`), not two renders of the same component — as currently scoped it would pass trivially without ever exercising the file where the actual divergence lives.

## Finding 2 (Minor, non-blocking): task 3.4's three-cause simulation may not be constructible

Task 3.4 asks for byte-identical rendering across "retry-budget exhaustion, definitive revocation, and concurrent session destruction," each "however currently simulated in `connectionHealth.ts`'s existing test suite." But `connectionHealth.ts` is cause-blind by design — the frontend only ever sees `REAUTH_GRACE_EXPIRED_CLOSE_CODE` or a `{ eventType: "reauth_required" }` message with no cause field (confirmed reading `connectionHealth.ts:208-247` and the message type in `realtime.ts`). There's no frontend-visible fixture that distinguishes these three backend causes from each other — both existing triggers already collapse to the same two test setups the current test file uses (`ConnectionStatusBanner.test.tsx:52-81`). As written this task is either vacuous (nothing to differentiate) or needs to fall back to code-review confirmation that no such distinguishing path exists, similar to task 5.1's grep check. Worth tightening the task wording so whoever implements it doesn't go looking for a fixture that can't exist by the state machine's own design.

## Everything else

D2 (CTA reuse), D3 (CI-enforced no-countdown regex), D5 (grep-checkable vote-loss gate), D6 (reveal-collision accepted-as-rare), D8 (no fork of `connectionHealth.ts`) all check out against the actual code — `AuthErrorPage.tsx:27-38` and `AuthContext.tsx:82` are exactly the cited precedent, `voteDraft.ts` is confirmed unwired (only its own test imports it), and `connectionHealth.ts`'s cause-blindness and sticky-terminal guard are exactly as described. The existing rendered-output-identity test suite is structured to tolerate the `role="alert"` and new-button changes without rewrites. No objection to any of these on implementability grounds.
