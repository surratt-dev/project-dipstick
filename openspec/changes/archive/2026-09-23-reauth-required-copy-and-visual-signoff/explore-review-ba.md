# BA Review — exploration-notes.md (reauth-required-copy-and-visual-signoff)

**Reviewer:** Marcus Delgado (BA persona), Stage 1 review
**Verified against:** GitHub issues #136–#141 (`gh issue view`), `tasks.md` Group 3 and Group 6 (archived `reauth-required-client-prompt` change), `websocket-staleness-signal/spec.md`'s Pilot-readiness gate, `ReauthRequiredTreatment.tsx` and its test file, `design.md` Decisions D1/D3/D4/D5/D9 and Open Questions, `vote-compose-recovery/spec.md`.

**Bottom line:** the exploration is unusually well-grounded — nearly every load-bearing claim I checked against source (the code, the issues, the tests) held up exactly as stated. I found one real gap (GitHub's structured blocking links don't match the prose dependency graph the notes rely on), one place where a rigor gap is hiding inside an apparently-rigorous table, and a couple of spots where "honest boundary" needs to be turned into an actual template before the next stage can execute against it without re-deriving the judgment calls itself. None of this changes the exploration's bottom-line conclusion; all of it is buildable into the proposal stage as concrete acceptance conditions.

---

## 1. Does the #137–#141 in / #142–#143 out scoping match the actual sub-issues and blocking relationships?

**Mostly yes — with one concrete gap worth fixing before this becomes a proposal.**

Confirmed by direct issue read:
- Issue #136's sub-issue list is exactly `#137, #138, #139, #140, #141, #142, #143` — matches the exploration's framing precisely.
- The prose dependency chain #136's body states (`#138 blocked on #137`; `#140 blocked on #139`; `#141 blocked on #137 and #139`; `#142 blocked on #141`; `#143 blocked on #140, #141, #142`) matches the exploration's §3 diagram and its "the line sits between #141 and #142" framing exactly.
- "#142/#143 out of scope" is correctly scoped to *this exploration/pipeline run*, not to issue #136 as a whole — #136's own "Scope" section explicitly includes tasks 6.4/6.5 (i.e., #142/#143) in what #136 tracks overall. The exploration line 4 phrasing ("noted as remaining open, not attempted") already gets this right, but it's a one-word ambiguity risk for a future reader skimming only the headline claim. **Suggested rewrite:** change "#142 and #143 are explicitly out of scope" → "#142 and #143 are explicitly out of scope for this pipeline run (not for issue #136 overall, which still tracks them)."

**Gap found, not mentioned in the exploration:** none of issues #137–#143's *structured* `blocked-by`/`blocking` GitHub fields are populated — I checked all six directly and every one shows blank. The entire dependency graph the exploration relies on (and that #136's body states in prose) exists only as free text, not as GitHub's own blocking-relationship mechanism. Practically: anyone using the project board's built-in "show unblocked work" filtering would see #137, #139, #140, and #141 as simultaneously available right now, which directly contradicts the build order this whole exploration is organized around (mock before sign-off; copy-and-mock together before #141). This is exactly the kind of thing Marcus flags — a requirement that's correct in the document but not enforced by the tool the team will actually use to sequence work.

**Suggested acceptance condition for the next stage:** either (a) wire the actual GitHub blocking links to match the prose (cheap, ~5 `gh issue edit --blocked-by` style calls or repo settings), or (b) if that's deliberately not being done, say so explicitly in the proposal so a future reader doesn't assume the board enforces what only the text asserts.

---

## 2. Is the claim that shipped copy already satisfies D4 verifiable enough, or does it need a more rigorous walkthrough?

**The mechanical items are solid and independently verified. Item 4 is where the rigor is weaker than the table's flat checkmark implies — and the exploration document itself already knows how to handle this (it does it elsewhere) but doesn't apply that discipline here.**

I re-derived the D4 checklist table against the actual source (`ReauthRequiredTreatment.tsx`) and the actual test (`ReauthRequiredTreatment.test.tsx`) independently, not just re-reading the exploration's claims:

| D4 item | Exploration's claim | My independent check |
|---|---|---|
| 1. No countdown/digit | ✅ CI-enforced | Confirmed — no digit anywhere in either string constant |
| 2. No SEC-26 sub-cause | ✅ | Confirmed — "needs to be renewed" names nothing |
| 3. Leave-and-return statement | ✅, exact phrase the grep test checks | Confirmed — `ReauthRequiredTreatment.test.tsx:25` literally asserts `/leave this page and return to it/i` against this exact copy. The exploration's claim that this is "the exact literal phrase the grep test checks against" is not an overclaim — I verified the test file directly. |
| 4. Tone (not an error) | ✅ "no error, no !" | **Verified the proxy, but the proxy under-covers the requirement.** |
| 5. Conditional vote-loss | ✅ correctly role-gated | Confirmed against the component logic (`includeVoteLossSentence = role === "participant" && !PARTICIPANT_VOTE_COMPOSE_UI_WIRES_VOTE_DRAFT`) |

Item 4 is the one I'd push back on. D4's actual text (design.md) is: *"an expected token-lifetime event, not an error — no 'error,' no exclamation, no alarm-toned phrasing... it should still read as assertive-but-not-alarming rather than blank."* That's two different kinds of claim bundled into one checklist line:

- a **mechanical negative check** — no literal "error" string, no "!" — which is what the exploration actually verified, and which is genuinely ✅.
- a **felt-tone judgment** — does it read as *assertive*, not merely *absent of alarm words*? "Your session needs to be renewed" is calm to the point of possibly reading as passive/administrative rather than assertive, which is the *opposite* failure mode from "alarming" but still a failure of the same requirement line. A string can pass the mechanical negative check and still not clear the felt bar in either direction.

The exploration document already knows how to handle exactly this distinction — §3 explicitly separates "hard yes/no, checkable" judgments from "felt-language component a simulated persona can reason toward but not originate with the same authority a real Priya... would carry," and commits to flagging which is which in later sign-off notes. It just doesn't apply that same split to its own D4 table in §4, where item 4 sits next to items 1/2/3/5 with an undifferentiated ✅ that reads as equally mechanical.

**Suggested rewrite:** split item 4's table row into two: "4a. No 'error'/'!' literal (mechanical, CI-checkable)" — ✅ — and "4b. Reads as assertive-but-not-alarming (felt, Priya's/simulated-Priya's call, not resolvable by string inspection)" — open, explicitly deferred to #141's sign-off. This costs one line and removes the only place in the document where a felt judgment is dressed as a settled fact.

This doesn't change the exploration's bottom line (copy is close to done, mostly a sign-off exercise) — it sharpens exactly what "close to done" is still waiting on, which is the kind of specificity Marcus needs to hand this to implementation without a round-trip.

---

## 3. Is the "honest boundary" framing for simulated sign-off specific enough to act on?

**The boundary itself — where #140/#141 end and #142 begins — is specific and I have no notes on it; it's exactly right and matches the gate's own text in spec.md and tasks.md verbatim.** What's still underspecified is the *artifact* that boundary produces. "Produce an honest verdict, whatever it is" is a good instruction for a mindset; it is not yet a buildable acceptance condition, because it doesn't say what shape the sign-off note takes, and a BA's job is to make sure the next stage doesn't have to invent that shape mid-task.

Concretely missing:
- No specified **verdict vocabulary**. "Signed off," "withheld," "signed off with conditions" are all discussed as live possibilities across the document, but nothing enumerates the closed set of allowed outcomes, so two different future runs could produce differently-shaped verdicts for the same evidence.
- No specified **structure separating mechanical checks from felt judgment** in the sign-off artifact itself — this is the same issue as §2 above, one level up: §3 promises to flag felt-vs-mechanical items "so whoever reviews this run's sign-off can weight it accordingly," but doesn't say *where* that flag goes (inline per item? a summary footer? a confidence field?).
- No specified **disclaimer placement** for "this is a persona-simulated review, not equivalent to Priya's real review, not evidence toward #142" — §8's risk list says this disclaimer must exist "in its own text," but not where in the artifact, which matters if the sign-off doc is ever excerpted or quoted elsewhere (the exact failure mode the risk is naming).

**Suggested acceptance conditions for whoever writes #140/#141's sign-off artifact (concrete enough to build against):**

For #140 (mock sign-off), the artifact should contain, in this order:
1. Per-bound verdict against D1 (assertive / persistent / distinct-from-`unknown-reconnecting` / non-modal) — one line each, yes/no, with the specific evidence (a screenshot description, a CSS property, a DOM check) cited per line.
2. The no-animation negative constraint — yes/no, with the specific grep/inspection evidence cited (not asserted).
3. A clearly separated section, explicitly labeled "felt judgment — persona-simulated, not equivalent to a real facilitator's read," covering the assertive-vs-alarming call.
4. One closing line stating the overall verdict using exactly one of: `Signed off`, `Withheld — <reason>`, `Signed off with conditions — <conditions>`.
5. The standing disclaimer (persona-simulated, bounded to checklist/negative-constraint items, not evidence toward #142) — same paragraph, every time, not paraphrased per run.

For #141 (copy-in-layout sign-off), same shape, substituting the coherence checks named in exploration §3 (tone-match, no contradiction, no now-redundant/now-missing content once copy and mock are seen together) for D1, and explicitly carrying forward the §5 caveat (vote-loss sentence correctness is conditioned on `PARTICIPANT_VOTE_COMPOSE_UI_WIRES_VOTE_DRAFT`'s *current* value, not a permanent fact) as a standing footnote, not a one-time mention.

This isn't a criticism of the exploration's judgment — every substantive call it makes here (bounded vs. unbounded claims, what's mechanical vs. felt, why #142 can't be simulated) is one I'd sign off on as-is. It's a gap between "the reasoning is sound" and "the next agent can execute without re-deriving the reasoning," which is the specific bar I hold requirements to.

---

## 4. Other clarifications / vague areas (not asked directly, but load-bearing)

- **§6's "no icon that echoes a countdown even indirectly" is good instinct, underspecified as an acceptance condition.** "Not anything clock-shaped" is clear; "even indirectly" is not — does a circular icon count (a clock face is circular; so is a stop sign, a warning triangle-in-circle, a lock icon's shackle)? I'd rather the next stage commit to an *allow-list* (e.g., "a closed-lock glyph, a sign-in-arrow glyph, or no icon") than a prohibition on an open-ended "indirect echo" category, which is exactly the kind of vague bound that turns into a scope dispute at sign-off time — the risk Marcus is most protective of.
- **§7's resolution of design.md's self-contradictory Open Questions line is correct and I verified it independently** (read both host files directly) — no notes, this is good work and should be carried into the proposal verbatim rather than re-litigated.
- **§9's numbered next-steps list is good and I'd promote it directly into the proposal's task list** — it's already at the right level of granularity (implement register → attempt #140/#141 → update stale comments → leave #142/#143 alone), and matches everything I traced independently above.

## Summary for the proposal stage

Nothing here blocks moving forward. Three concrete additions I'd want folded into the proposal/design artifacts before implementation starts:
1. A note (or actual `gh issue edit`) reconciling GitHub's blank blocking links with the prose dependency order everyone is actually relying on.
2. D4 item 4 split into its mechanical and felt halves, so "copy already satisfies D4" doesn't quietly imply a felt judgment was already made.
3. A fixed template for the #140/#141 sign-off artifacts (verdict vocabulary + mechanical/felt separation + standing disclaimer), so "produce an honest verdict" has one obvious shape to produce.
