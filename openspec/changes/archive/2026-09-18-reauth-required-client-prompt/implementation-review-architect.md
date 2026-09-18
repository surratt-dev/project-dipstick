# Implementation Review — Solution Architect (Ingrid Sollenberger)

Change: `reauth-required-client-prompt` (GitHub issue #32)
Scope of this review: does the code match design.md, particularly Decision D9 (shared subcomponent), and do the "28 test files, 258 tests, all passing" / typecheck claims hold up.

## Verdict

Implementation matches the design. D9's shared-subcomponent boundary is real, not asserted — verified by reading the code, not by trusting comments. No fork of `connectionHealth.ts`. No role-specific branching. Test and typecheck claims independently re-run.

## What I checked against the actual code

- **`ReauthRequiredTreatment.tsx`** (new, per D9): single presentational component, no props, no imports from `connectionHealth.ts` beyond what its callers already hold. `role="alert"` (D1). CTA is a plain `<button>` setting `window.location.href = "/auth/login"` — the identical literal used at `AuthContext.tsx:82`/`AuthErrorPage.tsx:29` (D2), confirmed those two files have zero diff from main (task 7.3). No dialog, no focus trap, no dismiss affordance (D1/task 4.2/4.3). No countdown or digit-plus-time-unit string in the rendered copy (D3) — verified both by reading the literal string and by the CI test in `ReauthRequiredTreatment.test.tsx` that checks `container.innerHTML`, not just `textContent`, per Ferreira's widened-attribute concern.
- **`ConnectionStatusBanner.tsx`**: `reauth-required` case now renders `<ReauthRequiredTreatment />` only — the old inline `<div role="status">` and its `REAUTH_REQUIRED_TEXT` constant are gone, not left dead alongside the new component.
- **`FacilitatorReadinessGrid.tsx`**: same — its independently-duplicated `REAUTH_REQUIRED_TEXT` constant and `<div role="status">` (the exact duplication design.md's Context section and Marcus Oyelaran's Finding 1 describe) are deleted, replaced with the same `<ReauthRequiredTreatment />` call. This is the one place a lazier implementation could have quietly left the old placeholder in place next to the new shared component — it didn't.
- **`reauthRequiredHostParity.test.tsx`**: mounts the two *real* host components (`SessionConnectionHost`, `FacilitatorConnectionHost`), not two `ConnectionStatusBanner` instances — this is the version of the test that would actually have caught Finding 1, and the test file's own comment says so. Confirmed passing, asserts `outerHTML` equality.
- **`connectionHealth.ts`**: zero diff from main (`git diff main -- .../connectionHealth.ts` is empty) — D8's no-fork bound holds.
- **No role branching**: `ReauthRequiredTreatment` takes no props; both call sites invoke it identically. Grep-style non-disclosure tests (`connectionHealth.grep.test.ts`) assert the new component references no close-code symbols, no `.code` reads, no exported `*Props` type, and (separately) no `reveal`/`topicStatus`/`SessionTopicStatus` tokens anywhere in the four files D6 governs.
- **Vote-loss disclosure gate (D5)**: `voteDraft.grep.test.ts` + `voteComposeWiring.ts` implement the build-enforced check task 1.1 describes; the current rendered copy includes the vote-loss sentence, consistent with no compose UI importing `voteDraft.ts` yet. `vote-compose-recovery/spec.md` carries the forward-pointing recheck note task 1.4 requires — read it directly, it's there and correctly targeted.

## tasks.md accuracy spot-check

Mostly accurate. One real discrepancy: **task 3.2 is checked `[x]`**, but its own text is "Replace the placeholder ... with the signed-off copy from 3.1" — and **task 3.1 (the actual copy draft/sign-off) is still `[ ]`, unchecked**, as is 6.3 (Priya's sign-off on finalized copy). The component's own header comment is honest about this ("COPY IS NOT FINAL... Do not treat this wording as implementation-ready"), so nothing is being hidden — but the 3.2 checkbox overclaims: what actually happened is the placeholder was replaced with a *draft* consistent with the D4 checklist, not "signed-off copy," since no sign-off has occurred. Recommend either unchecking 3.2 or rewording it to distinguish "mechanically wired the draft in" from "sign-off landed." Everything else I spot-checked (2.1–2.5, 4.1–4.8, 5.1, 7.1–7.4) matches code state.

## Test / typecheck verification

- `npx vitest run`: **28 test files, 258 tests, all passing** — confirmed independently, matches the claim exactly.
- `npx tsc --noEmit`: 70 errors total on this branch. I isolated this change's contribution by stashing all uncommitted/untracked files and re-running: the pre-existing baseline (main plus prior branch commits, before this change's work) already had **64** errors, all `noUncheckedIndexedAccess`-driven (`TS2532`/`TS18048`) in unrelated test files (`connectionHealth.test.ts`, `MemberManagement.test.tsx`, `TeamPage.test.tsx`, etc.) plus a few pre-existing type mismatches — none of it touched by this change. This change adds exactly **6** new errors, all in `ConnectionStatusBanner.test.tsx`'s new tests (lines 135–202), all the same shape (`sockets[0]` accessed without a null check) as **7 pre-existing instances already in that same file**. So this isn't a new category of sloppiness this change introduced — it's continuing an existing, apparently-tolerated file-wide convention (`noUncheckedIndexedAccess` is on but evidently not enforced as a merge gate for test files today). Worth a note for whoever eventually cleans this up repo-wide, but not a defect specific to this implementation, and not something I'd block this change on.

## Assessment against my usual concerns

Not much here touches my normal territory (auth delegation, server-side authority, Redis/Postgres boundary) — this is a client-only rendering change. The one property that is mine to care about: **the `/auth/login` navigation stays provider-agnostic** — confirmed, it's a bare literal string, no provider-specific branching, consistent with the standing OIDC multi-provider requirement, and D2 explicitly calls this out as inherited rather than newly reasoned about.

No blocking findings. The 3.2 checkbox wording is the only thing I'd ask fixed before calling tasks.md fully trustworthy as a status source of truth.
