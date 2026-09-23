# Copy-in-Layout Sign-Off — `reauth-required` treatment (GitHub issue #141)

**Reviewer:** Priya Nair (Facilitator SME) — **persona-simulated**, performed by an agent adopting her persona (see standing disclaimer at the end of this document). Not Priya Nair's own review.

**Date:** 2026-09-23

**What was reviewed:** the shipped copy in `ReauthRequiredTreatment.tsx` (`REAUTH_REQUIRED_TEXT_BASE` + conditional `VOTE_LOSS_SENTENCE`), evaluated **together with** the now-real visual register signed off in `mock-signoff.md` — copy and visuals read as one layout, not independently, per this change's own framing (design.md, exploration-notes.md §7).

---

## 1. Coherence checks (substituting for D1, per tasks.md task 3.1)

| Check | Verdict | Evidence |
|---|---|---|
| Tone match between copy and register | **Coheres** | Copy: "Your session needs to be renewed" — factual, no error/alarm language. `ReauthRequiredTreatment.test.tsx`'s tone-register test (run 2026-09-23, passing) confirms no `!` and no `error` string anywhere in rendered text. Register: amber/warning (`#fff3e0`/`#ffb74d`), not red/error, per `mock-signoff.md` §1/§3. Both land in the same "expected event, not error" register — neither contradicts the other. |
| No contradiction | **None found** | Neither the copy nor the register invokes danger/error/urgency language or iconography (no exclamation, no triangle, no red). Both independently land on "this is expected and requires an action," not "something broke." |
| Nothing now redundant or missing, once icon and copy are seen together | **Nothing missing or redundant** | The lock icon is `aria-hidden="true"` with no accessible name (no `<title>`, `aria-label`, or `title` attribute — confirmed by reading `ReauthRequiredTreatment.tsx:152-168` directly), so it carries no independent textual claim the copy would need to echo or avoid duplicating. The copy doesn't need to say "locked" or reference the icon at all. |
| Copy/button label match | **Matches** | The paragraph text ends "...will take you to log in again..." and the CTA button reads "Log in again" (`ReauthRequiredTreatment.tsx:180`) — the same phrase, verbatim, in both places. Read in actual layout (per `visual-register-capture.md`'s captures), the sentence and the button reinforce each other rather than using two different verbs for the same action. |

## 2. Task 3.2 — "Continuing will take you to log in again" vs. the lead-with-the-verb alternative

**Decision (made here, not deferred): partial adoption — condition attached, not a clean pass.**

Reasoning: exploration-notes.md §4 raised a lead-with-the-verb alternative along the lines of *"Your session needs to be renewed. Log in again to pick up where you left off."* Reviewed against actual layout, I don't think that exact alternative can be adopted wholesale: it drops the explicit statement that continuing means **leaving this page and returning to it** — a literal requirement of D4 checklist item 3 ("a plain-language statement that continuing requires leaving and returning to the page"), and the exact phrase "leave this page and return to it" is what `ReauthRequiredTreatment.test.tsx`'s dedicated test currently asserts against (`/leave this page and return to it/i`). "Pick up where you left off" is evocative but doesn't state the navigation mechanic — a participant reading only that sentence could reasonably expect an in-place action rather than a full page navigation. So I'm not signing off on the alternative as a straight swap.

That said, reading the current sentence cold, next to the button, for the first time: **"Continuing will take you to log in again"** has a real, minor weakness — "Continuing" is an abstract subject with no clear referent (continuing *what*, exactly? there's no ongoing action being continued; the session is already interrupted). It's not incoherent, and it does end on the same words as the button label ("log in again"), but it reads as slightly passive for a treatment whose whole point (per D1) is to be assertive, not merely un-alarming. That's a felt-tone observation, not a mechanical failure — recorded formally in §3 below.

**Condition:** reword the opening clause to lead with the action verb, matching the button label, while preserving the exact literal phrase "leave this page and return to it" so the existing content-checklist item and its automated test both continue to pass unchanged. Suggested replacement text, for whoever implements this condition:

> "Your session needs to be renewed. Log in again to continue — you'll leave this page and return to it once you're signed back in."

This keeps the CTA-matching verb up front, keeps the literal required phrase intact verbatim, and requires no change to the vote-loss sentence, the icon, the register, or any test other than the literal string the digit-pattern/tone/leave-and-return tests already check against (all of which remain satisfied by this replacement — no digits, no "!", no "error", exact phrase preserved).

## 3. Felt judgment — persona-simulated, not equivalent to a real facilitator's read

**Tone-coherence call:** Mostly clears, with the one caveat above. Read together — amber register, lock icon, "Your session needs to be renewed," "Log in again" button — this reads as a real, deliberate moment rather than a passive gray notice, which is the property D1 was written to secure. The one place it falls slightly short of "assertive" and drifts toward "passive-by-abstraction" is the "Continuing will take you to log in again" clause named in §2. I don't think this rises to withholding the whole sign-off — the substance (what happened, what to do, what's lost) is all present and correct — but it's real enough that I don't want to wave it through silently either, which is why this closes conditionally rather than cleanly.

## 4. Standing footnote — vote-loss sentence conditionality

The vote-loss sentence's presence for the `participant` role is conditioned on `PARTICIPANT_VOTE_COMPOSE_UI_WIRES_VOTE_DRAFT` currently being `false` (`ReauthRequiredTreatment.tsx:87`), enforced by `voteDraft.grep.test.ts`. **This is a fact about the codebase's current state, not a permanent property of this copy.** If a future vote-compose UI wires `voteDraft.ts`'s persist/restore hooks, that test starts failing and the participant-role copy must drop this sentence in the same change — this sign-off does not, and cannot, pre-approve that future edit. The facilitator-role omission is unconditional and unaffected by this determination either way.

## 5. Host coverage (design.md Decision D6)

**This verdict covers both real hosts: `SessionConnectionHost.tsx` (participant) and `FacilitatorConnectionHost.tsx` (facilitator).**

Evidence: `visual-register-capture.md`'s two captures show the participant host's copy including the vote-loss sentence ("Any vote you haven't submitted yet will be lost.") and the facilitator host's copy correctly omitting it — matching the role-conditional design and confirmed by `ReauthRequiredTreatment.test.tsx`'s facilitator-role tests (run 2026-09-23: passing). All coherence and felt-judgment findings above apply identically to both hosts — the copy and register are identical between them apart from that one sentence, and the §2 condition applies to the shared base sentence, which appears unchanged in both.

## 6. Closing verdict

**Signed off with conditions — reword the opening clause of `REAUTH_REQUIRED_TEXT_BASE` to lead with the action verb (e.g., "Your session needs to be renewed. Log in again to continue — you'll leave this page and return to it once you're signed back in."), preserving the literal "leave this page and return to it" phrase verbatim so the existing D4 checklist item 3 and its automated test remain satisfied. No other change is required. Once this reword lands and the existing test suite (digit-pattern, no-animation, leave-and-return, tone-register, vote-loss, host-parity tests) is re-run green against the new string, this condition is met and this sign-off may be treated as a clean pass for #141's purposes — a fresh review is not required, since the change is narrow and fully specified here.**

## 6a. Condition-met evidence (tasks.md task 4.0)

**Condition met.** The reword specified in §6's closing verdict has been implemented verbatim.

**Diff** (`packages/frontend/src/components/ReauthRequiredTreatment.tsx`, `REAUTH_REQUIRED_TEXT_BASE`):

```diff
-  "Your session needs to be renewed. Continuing will take you to log in again — you'll leave this page and return to it once you're signed back in.";
+  "Your session needs to be renewed. Log in again to continue — you'll leave this page and return to it once you're signed back in.";
```

This is the exact suggested replacement text from §2/§6 — no deviation. The literal phrase "leave this page and return to it" is preserved verbatim. No other line in the file was touched by this edit.

**Test run** (2026-09-23, after the reword, full frontend suite via `npx vitest run` from `packages/frontend`): **30 files, 283 tests, all passing.** In particular, within `ReauthRequiredTreatment.test.tsx` (9/9 passing): the digit-pattern test, the no-animation test, the leaving-and-returning phrase test (`/leave this page and return to it/i` — matches the new string unchanged), the tone-register test, both vote-loss tests (participant-included, facilitator-omitted), and the returnTo CTA tests. `reauthRequiredHostParity.test.tsx` (2/2 passing) confirms host-parity is unaffected. `npx tsc --noEmit -p tsconfig.typecheck.json` reports zero errors.

This condition is now met. Per §6, this sign-off is treated as a clean pass for #141's purposes — no fresh review is required.

## 7. Standing disclaimer

This sign-off is a persona-simulated review performed by an agent adopting the Priya Nair (Facilitator SME) persona — it is not Priya Nair's own review, and is explicitly identified as such. It is bounded to the checklist, negative-constraint, and felt-judgment items enumerated above; it is not evidence toward, and must not be read as predicting the outcome of, issue #142's live usability test (evaluating whether the `reauth-required` treatment reads as an alarm without failing to be noticed, in a real session with a real facilitator) or issue #143. Per this change's own `exploration-notes.md`, a clean #140/#141 pass does not predict #142's outcome, and neither issue is attempted, simulated, or partially satisfied by this artifact.

## 8. Real human sign-off

**Reviewer:** Brian Surratt.

**Date:** 2026-09-23.

**Method:** reviewed the finalized copy — the reworded `REAUTH_REQUIRED_TEXT_BASE` from §6a — directly, in actual layout against the visual register.

**Verdict: Signed off.** The copy reads correctly in layout; no disagreement with the persona-simulated verdict recorded in §1–§6a above.

This supersedes the §7 standing disclaimer for issue #141's purposes specifically: #141 is now closed on the basis of a real human's own review, not a simulation. The §7 disclaimer's scope regarding issue #142 (live usability test) and #143 is unaffected — this review is still not a live usability test with a real facilitator in a real session, and does not close or predict either of those.
