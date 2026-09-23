# Exploration Notes — reauth-required-copy-and-visual-signoff

**Explored by:** Devon Calloway (Internal Champion persona), Stage 1
**Use case:** Close #136's sub-issues #137–#141 (Facilitator copy + visual-register sign-off gate for `reauth-required`). #142 and #143 are explicitly out of scope — noted as remaining open, not attempted.

---

## 0. What I'm actually being asked to think through

Not "write the copy" and not "make the mock look nice." I'm being asked whether this gate can be closed *honestly* by an agent team standing in for Priya Nair, and if so, what has to be true first. That's a governance question before it's a design question, and it's squarely in my lane — the thing I'm most protective of across this whole project is constraints quietly becoming formalities. A sign-off gate is exactly that kind of constraint. `specs/websocket-staleness-signal/spec.md`'s pilot-readiness gate says this capability "SHALL NOT be used for a real pilot team's first live session until" a named list of sign-offs close. If we close #140/#141 by generating a plausible-sounding "Priya approves" without the artifact underneath actually earning it, we haven't closed the gate — we've disabled it while leaving the paperwork saying it's still armed. That's worse than leaving it open.

So before touching copy or color, I want to lay out where the honest line sits.

---

## 1. The precedent, and why it's good news, not just a warning

`spec.md`'s current-status note for issue #36 (`unknown-reconnecting`'s sibling gate):

> "A simulated-persona attempt at the visual-register sign-off was made against real screenshots of the shipped placeholder and was withheld, because the placeholder does not yet attempt either candidate register, so no register judgment could be made from it."

Read this two ways:

- **The bad reading:** simulated sign-off failed once already, so this is a fragile approach.
- **The reading I actually hold:** the gate *worked*. A prior run had the exact temptation this run has — sub-issues sitting open, a plausible-looking placeholder already rendered, pressure to say "looks distinct enough, approved" — and it declined to manufacture a verdict the evidence didn't support. That's the constraint behaving structurally, not preferentially. If I do nothing else productive this stage, I want to preserve that property: **the withheld outcome must stay available to this run.** I am not assuming #140/#141 come back positive, and I'm treating "produced an honest 'not yet, here's specifically why'" as a fully successful outcome of this exploration, not a failure to close the issue.

That said — the *reason* #36 was withheld is mechanically specific and diagnosable, not a blanket "simulated review can't work" verdict: the artifact under review hadn't committed to anything yet. `FacilitatorReadinessGrid.tsx`'s marker today literally "introduces no color or icon language at all" (its own comment, line 38-40) — it's a hollow circle with no color. You cannot judge whether an uncommitted thing reads as an alarm. That's not a limitation of simulated review; a real, in-person Priya would say the identical thing looking at that same screenshot. The lesson isn't "don't attempt this," it's "don't attempt it against nothing."

## 2. Checking whether `reauth-required` has the same problem right now

It does. I read `ReauthRequiredTreatment.tsx` directly:

```ts
const REAUTH_REQUIRED_STYLE = {
  border: "2px solid currentColor",
  padding: "0.75rem 1rem",
};
```

And its own header comment is explicit: *"STYLING IS A PLACEHOLDER... an intentionally distinct-but-placeholder visual register, sufficient to satisfy 'visually distinct register' trivially. The final visual register (color, weight, icon) is gated on Priya Nair's mock sign-off... and is not implemented here."*

`currentColor` means this border literally has no color commitment of its own — it inherits ambient text color. No icon. No weight decision beyond "2px, not 1px." This is the *same shape* of artifact that got #36's attempt withheld: present, distinct-from-neutral in a token sense, but not a candidate register a human (real or simulated) can form a felt judgment about. If I hand this, as-is, to a simulated Priya for #140, I'd get the same withheld outcome for the same reason — and I'd have learned nothing #36 didn't already teach.

**This is the load-bearing finding of this exploration stage:** #139 (produce the mock) cannot be a no-op that points at the existing placeholder. It has to be real implementation work — actually choosing and rendering a color, a weight, and an icon (or deciding no icon, as a decision, not an absence) — before #140's sign-off is even attemptable. That work is out of scope for *explore* mode (no code), but it needs to be scoped explicitly into whatever comes after this stage, or the same wall gets hit again.

## 3. Where the honest boundary sits between "sign-off" and "usability test"

The gate names six things for `reauth-required`, and they're not all the same kind of claim:

```
 ┌─────────────────────────────────────────────────────────────────┐
 │ #137/#138  copy drafted, wired                                    │
 │ #139       mock produced — commits to a candidate register       │
 │ #140       mock sign-off — checklist + negative constraint       │
 │ #141       copy-in-layout sign-off — checklist + coherence       │
 │ ─────────────────────────── line ────────────────────────────── │
 │ #142       live usability test — "does it read as alarm, IRL"    │
 └─────────────────────────────────────────────────────────────────┘
```

One thing worth naming plainly, and I only caught it because Marcus's review checked it directly: this diagram — and #136's own body — describe the build order in prose only. None of #137–#143's GitHub issues have their structured `blocked-by`/`blocking` fields populated; they're blank across all six. That means the project board's own "show unblocked work" filtering would currently show #137, #139, #140, and #141 as simultaneously available, which contradicts the order this whole exploration assumes. I'm not wiring those links myself — that's tooling work, not exploration — but I want it on record, explicitly, that this ordering is enforced by this document and by #136's body text, not by GitHub's own mechanism. Whoever runs the next stage should either wire the links to match or carry this same explicit caveat forward; either is fine, letting it go unmentioned is not.

#140 and #141, per `tasks.md`, are bounded, checkable judgments:
- #140: does the mock satisfy D1's stated bounds (assertive, persistent, visually distinct from `unknown-reconnecting`, stops short of modal), **and** does it contain no animated element whose timing approximates the grace period (an explicit negative constraint I can check by reading the code — is there a CSS animation/transition tied to a duration at all, yes or no)?
- #141: evaluated together, does the copy and the mock cohere — does the copy's tone match the register the mock commits to, do they contradict each other, is anything now redundant or missing once seen together (e.g., if the mock uses a warning icon, does the copy *also* need to say "warning")?

Both of these are things I can reason about rigorously against a *committed* artifact — they're closer to a design review than a felt reaction. #142 is explicitly the other kind of claim: "reads as an alarm without failing to be noticed, both failure directions" **during a live session**, per Priya's own persona (*"The application ships without usability testing with a real facilitator... She expects to be taken up on that offer."*). That's not decomposable into checklist items — it's a claim about a room full of people's actual attention and reaction, which only exists once, live. No mock, however good, is evidence of that. I agree completely with the team's decision to leave #142/#143 out of scope, and I'd resist any framing later in this pipeline that tries to satisfy #142 with "we reviewed the mock really carefully" — that's exactly the substitution the spec.md language was written to foreclose.

**Practically important, and reassuring:** closing #140/#141 does *not*, by itself, unlock a real pilot session. #142 still stands between this work and any real facilitator using this in anger — and #142 requires the real Priya, unconditionally, regardless of anything decided here. So a simulated sign-off on #140/#141, even if I'm wrong about something, is not the last checkpoint — it's an earlier one feeding a later human checkpoint that can still catch it. That changes the stakes: I should be rigorous, not paralyzed. Manufacturing a false positive here is bad (wastes Priya's eventual real review time, or worse, lets a genuinely bad register sit unquestioned until the live test), but it is not the single point of failure the pilot-readiness gate already assumed some other item would be.

One more honesty note, smaller: even within #140/#141's "checklist" territory, some of it isn't purely mechanical — "does this read as assertive-but-not-alarming" has a felt-language component that a simulated persona can reason toward but not *originate* with the same authority a real Priya's twelve years of facilitating would carry. I'll flag any judgment in a later stage that leans on that felt component (versus a hard yes/no like "is there a digit" or "is there a CSS animation") so whoever reviews this run's sign-off can weight it accordingly, rather than the notes reading uniformly confident.

Priya's review adds a point I want folded in here rather than left for #142 to rediscover on its own: "reads as an alarm without failing to be noticed" is bigger than the color-register question §6 works through. Two things belong explicitly in #142's eventual live test plan, not assumed covered by the visual-register work: timing and context — specifically, the case where the disconnection fires during or immediately before a reveal, which is the highest-friction moment for this to land and is exactly the moment D6 keeps this mechanism blind to on purpose; and modality — a screen-reader participant, for whom "reads as an alarm" isn't a color question at all, it's the announced `role="alert"` text landing on top of whatever they were already listening to, with no visual register to soften it. Neither of these is decomposable into a #140/#141 checklist item; both are live-only claims in the same sense already argued above for #142 generally. So: **a clean #140/#141 pass should not be read, by anyone downstream, as a soft signal that #142 will also pass.** I want that stated as plainly as the withheld-outcome point in §1, because it's the same discipline applied to a subtler failure mode — not "did we skip #142" but "did we let #140/#141 quietly stand in for part of it."

## 3a. What the #140/#141 sign-off artifacts should actually contain

§3 above establishes the boundary line and the discipline (flag felt vs. mechanical). That's a mindset, not yet a shape a future stage can produce without re-deriving it. Marcus's review is right that "produce an honest verdict, whatever it is" is a good instruction for a mindset but not yet a buildable acceptance condition — it doesn't say what shape the sign-off note takes. I'm adopting a fixed template here rather than leaving it for the next stage to invent, so #140/#141 are executable, not just directionally correct.

For #140 (mock sign-off), the artifact should contain, in this order:
1. Per-bound verdict against D1 (assertive / persistent / distinct-from-`unknown-reconnecting` / non-modal) — one line each, yes/no, with the specific evidence (a screenshot description, a CSS property, a DOM check) cited per line.
2. The no-animation negative constraint — yes/no, with the specific grep/inspection evidence cited, not asserted.
3. A clearly separated section, explicitly labeled "felt judgment — persona-simulated, not equivalent to a real facilitator's read," covering the assertive-vs-alarming call.
4. One closing line stating the overall verdict using exactly one of: `Signed off`, `Withheld — <reason>`, `Signed off with conditions — <conditions>`.
5. The standing disclaimer (persona-simulated, bounded to checklist/negative-constraint items, not evidence toward #142) — same paragraph, every time, not paraphrased per run.

For #141 (copy-in-layout sign-off), same shape, substituting the coherence checks named above (tone-match, no contradiction, no now-redundant/now-missing content once copy and mock are seen together) for D1, and explicitly carrying forward the §5 caveat (vote-loss sentence correctness is conditioned on `PARTICIPANT_VOTE_COMPOSE_UI_WIRES_VOTE_DRAFT`'s current value, not a permanent fact) as a standing footnote, not a one-time mention.

One more thing this template needs to carry, per Priya's review: **a register is signed off per real host surface it was actually rendered and reviewed in, not generically.** If #139's mock is only rendered through `SessionConnectionHost.tsx` and not `FacilitatorConnectionHost.tsx` (or vice versa), the verdict lines above apply only to the surface actually reviewed — a sign-off note that says "signed off" without naming which host(s) it covers is incomplete, not conservative. See §7 for why the two hosts are different enough visual contexts that this isn't pedantry.

## 4. Copy (#137/#138) — probably less open than the issue numbers suggest

I read the currently-shipped text in full, including the parts the team-lead's brief specifically warned me not to treat as a flat string:

```
REAUTH_REQUIRED_TEXT_BASE =
  "Your session needs to be renewed. Continuing will take you to log in
   again — you'll leave this page and return to it once you're signed
   back in."

VOTE_LOSS_SENTENCE (appended, participant role only, only while
  PARTICIPANT_VOTE_COMPOSE_UI_WIRES_VOTE_DRAFT === false) =
  " Any vote you haven't submitted yet will be lost."
```

Checked line-by-line against D4's checklist:

| Checklist item | Status |
|---|---|
| 1. No countdown/numeric grace-period value | ✅ none present; CI-enforced by the digit-pattern test |
| 2. No SEC-26 sub-cause disclosed | ✅ "needs to be renewed" names nothing about revocation/retry-exhaustion/concurrent-session |
| 3. Plain-language leaving-and-returning statement | ✅ "you'll leave this page and return to it" — this is the exact literal phrase the grep test (task 3.5) checks against |
| 4a. Tone (mechanical): no "error" string, no "!" | ✅ neither present — CI-enforced |
| 4b. Tone (felt): reads as *assertive*, not merely absent-of-alarm-words | Open — not resolvable by string inspection, deferred to #141's sign-off (see §3a) |
| 5. Conditional vote-loss statement | ✅ present, and correctly role-gated (facilitators never vote, so it's *unconditionally* absent for `role="facilitator"`, and conditionally present for `role="participant"` on the `voteDraft.ts` wiring check) |

I'm splitting item 4 here rather than leaving it as one flat checkmark, because Marcus's review caught something real: D4's actual text bundles two different kinds of claim — a mechanical negative check (no "error," no "!") and a felt-tone judgment (does it read as *assertive*, not just as *un-alarming*). "Your session needs to be renewed" clears the mechanical check cleanly, but calm-to-the-point-of-passive is a different failure mode than alarming, and a string can clear 4a while still not clearing 4b. I already apply this same mechanical-vs-felt discipline in §3 for #140/#141; it should have applied to my own table here too, and now it does.

Items 1, 2, 3, 4a, and 5 already pass, and `tasks.md` task 3.2 itself says so directly ("the text itself is still draft/placeholder... but... satisfies the D4 required-content checklist") — read as covering the mechanical items, which is all task 3.2 could have meant before a mock existed to judge tone against. Item 4b stays open, same as everything in §3a. So what's actually open here isn't a blank-page copywriting exercise — it's:

1. **Formal sign-off** that this specific sentence construction, not just its checklist compliance, is the wording Priya wants — read in actual layout, which per §3 above can't happen in isolation from #139's mock.
2. **The stale header comment** (task 3.2's remaining half): `ReauthRequiredTreatment.tsx`'s "COPY IS NOT FINAL" note and `ConnectionStatusBanner.tsx`'s matching comment both need updating once sign-off actually lands — not before. If I ship an "approved" verdict in this run, that comment-cleanup becomes real implementation work for the next stage; if I don't, I should say so plainly rather than leaving it ambiguous.

One phrasing thing worth surfacing for Priya's (simulated) review rather than deciding myself: the base sentence currently reads "Continuing will take you to log in again" — "continuing" is a slightly abstract subject for a sentence whose actual trigger is pressing the one button on the screen ("Log in again"). It's not wrong against the checklist, but whether it reads naturally *once seen next to the actual button label* is exactly the kind of thing D4's "reviewed against actual layout, not in isolation" instruction exists to catch, and exactly the kind of small thing that's cheap to fix now and expensive to notice for the first time during #142's live test.

Priya's review picks this up and gives a concrete direction, which I'm recording here as a suggestion for whoever drafts next, not as a decision made on her behalf: lead with the action verb rather than "continuing" as an abstract subject — something closer to *"Your session needs to be renewed. Log in again to pick up where you left off."* — so the sentence's verb matches the button's own label. She's explicit that she isn't signing off on that wording here, and neither am I; finalizing it against the real mock is #140/#141's job, not this exploration's.

## 5. The vote-loss sentence's honesty is more fragile than it looks

`PARTICIPANT_VOTE_COMPOSE_UI_WIRES_VOTE_DRAFT = false` is a hand-set constant, checked against reality by `voteDraft.grep.test.ts` calling `voteComposeUiWiresVoteDraft()`. I confirmed that test currently passes (no vote-compose UI exists yet), so the constant is correct *today*. But this is a fact about a sibling capability's ship status, not about anything under this change's control — `vote-compose-recovery`'s own forward-pointing note (tasks.md task 1.4) is the only thing standing between this staying correct and silently going stale. That's not a defect in this change; it's a dependency I want to name so a future reader of #138 doesn't mistake "the sentence is currently correct" for "the sentence is now permanently settled." If I sign off on #141's copy-in-layout, I'd want the sign-off note to say explicitly that it's conditioned on this constant's current value, not on the sentence's literal text being eternal.

## 6. What a committed visual register would need to satisfy (for the next stage, not decided here)

Since #139 can't be produced in explore mode (no code), I want to leave the next stage a concrete, bounded starting point rather than a blank page — same spirit as D4 did for copy. Constraints already settled and not up for relitigating:

- **Distinct from `unknown-reconnecting`.** That banner today is fully neutral — no color, no icon, `role="status"`, plain text in a bare `<div>`. Almost anything with actual color commitment clears this bar; the risk is doing too little (another gray box), not too much.
- **Stops short of modal (D1).** No `<dialog>`, no focus trap, no overlay/backdrop, no scroll-lock. Already true of the component (`4.3` confirms this) and shouldn't change.
- **No countdown surrogate (D3, and #140's explicit negative check).** No progress bar, no spinner, no CSS animation/transition with a duration at all tied to elapsed time. This is the one item I'd check almost mechanically — grep the component and its styles for `animation`, `transition`, `@keyframes`, any duration value — a "no" here is a hard, confident yes/no, not a felt judgment.
- **Assertive, not alarming — the one genuinely felt property.** Devon's own standing concern (the ritual shouldn't feel like software running on engineers) and D1's own text both land here: color choice matters more than any other single decision. A saturated red with an exclamation-triangle icon risks reading as an *error*, which checklist item 4 already rules out for the copy — the visual register shouldn't contradict that by putting error-register color language next to non-error-register text. An amber/warning-toned register (not red, not neutral gray) with a plain, non-triangle icon — or no icon at all — is the direction I'd point the next stage toward, but the actual color values, icon, and weight are a design decision I'm naming as unmade, not making by fiat here — same discipline D1 itself used when it separated "the bound is decided" from "the mock realizing it is not."

Marcus's review is right that "no icon that echoes a countdown even indirectly" is fuzzy enough to become a scope dispute at sign-off time — does a circular icon count, given a clock face, a stop sign, and a warning-triangle-in-circle are all circular? I want to sharpen this without overstepping into deciding it for the next stage. So: rather than a mandatory closed list, here's a starting allow-list the next stage can use or extend — a closed-lock glyph, a sign-in-arrow glyph, or no icon — none of which reads as a duration or a countdown under any reasonable interpretation. What I'm not doing is declaring this the final, exhaustive set; that would quietly convert "I'm flagging a concern" into "I decided the icon," which is the overreach I've been careful to avoid everywhere else in this document. If the next stage wants to propose something outside this starting list, that's fine — the bar is "does a careful person, real or simulated, agree it doesn't echo a countdown," not "is it on Devon's list."

I'd also flag, for whoever builds #139: task 4.4's gate text says final styling isn't implemented "until Group 6 closes" — but Group 6 (#140 specifically) can't close without something to look at. The resolution isn't a contradiction, it's sequencing: the *candidate* register gets implemented and rendered through the real hosts as this change's own working state, reviewed, and only becomes "final" (i.e., the placeholder comment gets deleted) once sign-off actually lands. That's a normal build-a-thing-then-approve-it loop, not a chicken-and-egg problem — I just want it named so the next stage doesn't read 4.4 as "don't touch the styling at all."

## 7. The "actual layout" question — what exists to review against

Design.md's own Open Questions line is oddly self-contradictory on a literal read: "against real session-screen mocks rather than `SessionConnectionHost.tsx`'s and `FacilitatorConnectionHost.tsx`'s current bare placeholders — one mock realized through the D9 shared subcomponent, **reviewed in both host contexts**." Read literally, this says both "not the bare host placeholders" and "reviewed in the host contexts" in the same sentence.

I read both hosts directly. They are genuinely minimal — `SessionConnectionHost.tsx` is a `data-testid` div, `system-ui` font, `2rem` padding, the banner, and one sibling indicator; `FacilitatorConnectionHost.tsx` is the same shell around a stub 4-row grid. Neither is close to a real session screen (no topic display, no vote UI, no reveal state) — and per both files' own comments, that's deliberate and out of scope for this whole effort ("not a feature-complete live-session page... explicitly out of scope"). There is, today, no fuller session screen anywhere in the codebase to mock against. So "real session-screen mocks" in the literal, aspirational sense design.md's Open Questions describes doesn't exist to be produced without scope creep into building session UI that multiple other changes explicitly defer.

Issue #139's own filed text resolves this the way I'd resolve it too: "actual session-screen contexts — `SessionConnectionHost.tsx` and `FacilitatorConnectionHost.tsx`, **not bare placeholders**." Read this way, "bare placeholder" refers to reviewing the subcomponent *in total isolation* (e.g., a snippet with no surrounding host, no live state-machine transition driving it) — not to the hosts' own minimal styling. The two existing host components, driven by a real (faked-socket) state transition into `reauth-required`, *are* "actual layout" in the only sense currently buildable: real DOM structure, real sibling elements, real ARIA tree, real CSS cascade context — just not a visually rich one. That's a legitimate, if modest, bar, and it's the one `reauthRequiredHostParity.test.tsx` already exercises mechanically (mounting the real hosts, not bare `ConnectionStatusBanner` instances, specifically because that's what caught the original Finding 1 duplication bug). I'd carry that same discipline into the mock: render candidate styling through the actual hosts, capture that, and treat *that* as "actual layout" — while being honest in the sign-off note that it's layout-minimal, not session-screen-rich, because nothing richer exists yet to be honest against.

Priya's review adds a requirement I want folded in here, not just left implicit at sign-off time: **a register is signed off per real host surface it was actually rendered and reviewed in, not generically.** `SessionConnectionHost.tsx`'s participant banner and `FacilitatorConnectionHost.tsx`'s facilitator grid are different visual contexts — different surrounding chrome, different sibling elements, different reading context (a lone banner vs. one cell in a 4-row grid) — and a register that reads correctly in one doesn't automatically carry to the other. `reauthRequiredHostParity.test.tsx` already treats the two hosts as separately worth testing, for exactly this reason. So: #139's mock needs to be rendered through *both* real hosts, and #140/#141's sign-off needs to say, explicitly, which host(s) the verdict covers — a mock reviewed only in the participant banner doesn't clear #140/#141 for the facilitator grid, and vice versa. I've folded this into the sign-off template in §3a.

## 8. Devon's-eye risk list for this specific run

- **Risk: closing four issue numbers reads as more progress than it is if the underlying artifact still isn't committed.** Mitigation: don't let #139/#140 close on anything short of a real color/weight/icon decision rendered through the real hosts; if the next stage can't produce that, say so and leave #139/#140 open rather than writing an approval against a border-only placeholder.
- **Risk: a simulated sign-off, once written down, gets cited later as equivalent to Priya's real review.** Mitigation: any sign-off artifact this pipeline produces should say plainly, in its own text, that it's a persona-simulated review bounded to the checklist/negative-constraint items in §3, not a substitute for #142, and not evidence offered toward pilot readiness by itself.
- **Risk: the visual register drifts toward "error" register to maximize noticeability, undermining D4 checklist item 4's tone bound and Devon's standing "doesn't feel like alarm software" concern.** Mitigation: named directly in §6 — amber/warning register, not red/error register; icon choice checked against the §6 starting allow-list (closed-lock, sign-in-arrow, or none) rather than an open-ended "even indirectly" judgment call.
- **Risk: the vote-loss sentence's correctness silently depends on a sibling capability's ship status, and a future reader treats it as permanently settled text.** Mitigation: named in §5; carry the caveat into any sign-off note.
- **Risk: "actual layout" gets satisfied by rendering the subcomponent in a test file's `render()` call and calling that "reviewed in host context," which is exactly the kind of trivial-pass Marcus Oyelaran's Finding 1 already caught once for a structurally similar claim.** Mitigation: named in §7 — review against the real `SessionConnectionHost`/`FacilitatorConnectionHost`, driven through a real state transition, same pattern `reauthRequiredHostParity.test.tsx` already established.
- **Risk: issue #33 (facilitator-disconnect blast radius — a facilitator losing connection mid-session leaves the whole room stuck, with no facilitator-specific signal under today's shared D9 treatment) quietly falls off the backlog once this gate's four issues close, because closing #136's visible sub-issues reads as "the reconnection-signal problem is handled."** Mitigation: this exploration isn't resolving #33 and isn't claiming to. Priya's review is explicit that #33 isn't a nice-to-have — a room where the facilitator silently vanishes with no signal to participants is a worse failure than anything this gate is scoped to prevent. I don't own the backlog and can't force this, but the honest thing to do is name it plainly, here, so it isn't an implicit casualty of a different issue closing.

## 9. What I think the next stage actually needs to do

Not deciding this — flagging it for whoever runs propose/design next:

1. Implement a real candidate visual register (color, weight, icon — or a stated no-icon decision) in `ReauthRequiredTreatment.tsx`, rendered through both real hosts, replacing the `currentColor`-border placeholder. This is code; out of scope for this stage.
2. Only then attempt #140 (mock sign-off, including the mechanical no-animation check) and #141 (copy-in-layout coherence sign-off) — both as a persona-simulated review, explicitly labeled as such, explicitly scoped to the bounded/checklist judgments in §3, not extended to claim anything about live-session alarm-reading (#142's exclusive territory), following the artifact template in §3a and naming which real host(s) the verdict covers (§7).
3. Update the stale "COPY IS NOT FINAL" header comments (both files) only once a sign-off actually lands — and correct the `ConnectionStatusBanner.tsx` comment's already-noted second staleness (the "both strings below are placeholders" framing, which task 3.2 already flagged as wrong since `unknown-reconnecting`'s copy sign-off closed independently).
4. Leave #142/#143 filed and open, with no simulated substitute attempted — consistent with spec.md's own recorded limitation and with Priya's persona's explicit expectation of a real usability pass before go-live. When #142 is eventually scoped, its test plan should explicitly cover the near-reveal timing case and a screen-reader participant (§3), not assume the visual-register work already covers either.
5. Separately, and not blocking on 1–4: either wire #137–#143's GitHub `blocked-by` links to match the prose order this document (and #136's body) relies on, or carry forward this document's explicit callout that the order is enforced only in prose (§3) — don't let it go unmentioned. And leave issue #33 visibly tracked (§8); this change's gate closing is not a resolution to it.

---

**Bottom line for this exploration stage:** the copy side (#137/#138) is close to done in substance — mostly a sign-off-and-comment-cleanup exercise once reviewed alongside a real mock. The visual side (#139/#140) is not close to done in substance — the shipped styling is the same kind of uncommitted placeholder that got the sibling gate's prior attempt withheld, and producing a real candidate register is necessary implementation work before any sign-off attempt is honest. #141 depends on both landing together. I'm not treating a positive sign-off as the default outcome of the next stage; I'm treating "produced a real, judgeable artifact and got an honest verdict — whatever that verdict is" as the actual bar.

---

## Incorporated reviewer feedback

Priya Nair (facilitator) and Marcus Delgado (BA) reviewed this document at Stage 1. I folded in:

- **Priya:** #142's live test plan must explicitly cover timing-near-a-reveal and screen-reader/modality, not just color register, and a clean #140/#141 pass isn't predictive of #142's outcome (§3). Host-pairing — a register is signed off per real host surface it was actually rendered and reviewed in (§7, §3a). The copy's lead-with-the-verb rewrite, recorded as a suggestion for whoever drafts next, not a decision made on her behalf (§4). Issue #33's blast radius stays visibly tracked, not a casualty of this gate closing (§8).
- **Marcus:** the #137–#143 dependency order is enforced only in prose, not GitHub's structured blocking links — called out explicitly rather than assumed (§3). D4 item 4 split into a mechanical check (4a, ✅) and a felt judgment (4b, open) so the checklist table stops implying a felt call was already made (§4). A concrete sign-off artifact template for #140/#141 — verdict vocabulary, mechanical/felt separation, standing disclaimer — adopted as the shape the next stage should produce against (§3a).

One place I only partially adopted a suggestion: Marcus proposed tightening §6's icon prohibition into a closed allow-list. I gave a starting allow-list (closed-lock glyph, sign-in-arrow glyph, or no icon) so the next stage has something concrete rather than an open-ended "even indirectly" test, but I stopped short of declaring it exhaustive — deciding the final icon isn't mine to make in explore mode, and a closed list would quietly convert a flagged concern into a made decision, which is the overreach I've avoided everywhere else in this document. See §6 for the reasoning.

I didn't find anything in either review that compromises the constraints I came into this stage protecting — the honest-withheld-outcome discipline from §1, the checklist/felt-judgment split staying visible rather than uniformly confident, and no simulated substitute for #142. Both reviews reinforce those rather than push against them, which is consistent with what I'd expect from a review that's doing its job.
