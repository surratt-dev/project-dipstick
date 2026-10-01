# BA Review: Proposal for topic-add-form-and-empty-state (#55)

**Reviewer:** Marcus Delgado (Senior Business Analyst)
**Date:** 2026-10-01
**Reviewed:** `proposal.md`, `specs/topic-management-screen/spec.md`, `specs/topic-customization-lock/spec.md` (with `design.md` and `tasks.md` for cross-reference)
**Checked against:** `requirements/use cases/08 - Topic Management - Use Cases.md` (Add Custom Topic; View Active Topic Configuration), `requirements/BRD.md` FR-8.1–8.7, `openspec/specs/topic-management-screen/spec.md`, `openspec/specs/add-custom-topic/spec.md`, my exploration review (`explore-review-ba.md`)

---

## Overall read

This is close to implementable as written. Almost every item from my exploration review landed as a concrete requirement with exact copy and a scenario: client-side validation (V1), no default vote type (V2), the description label (V3), the gating truth table with "temporary" and "#176" in the requirement itself (V5), the 201-then-refetch-failure case (V6), the duplicate rule (V7), the add-form definition of "dirty" (V8), and the five-row empty-state table (V9). The C3 decision went the "quiet refetch" way rather than "strict". It is scoped to exactly two call sites and comes with its own requirement and scenarios, which is the condition I set, so I accept it.

Nearly all of the language is testable. I found no "should feel", "appropriately", or "e.g." in the delta specs. What remains are **under-specified edges**. Most of them sit in the outcome and interlock requirements, where the spec names a message but not its location, lifetime, or what happens to the form. Several of these are decided in `design.md` but missing from the spec. That matters because the spec is what gets archived and `design.md` is not.

Severity: **High** = an implementer would have to guess, and two reasonable guesses produce different behaviour. **Medium** = a gap or traceability hole a tester would raise. **Low** = wording or hygiene.

---

## 1. Findings by requirement

### R-Outcomes: "Submit outcomes keep typed text on failure and never invite a duplicate after success"

| # | Sev | Issue | Suggested concrete condition |
|---|---|---|---|
| O1 | High | **409 outcome leaves the form's fate unstated.** `design.md` (L87) says the form and its values are lost. The spec only says the add control "follows the gating rule". It doesn't cover a refetch that reports the team as *unlocked* (stale 409, race), or a refetch that *fails*. | Add: "On `409 TOPIC_CUSTOMIZATION_LOCKED` the form SHALL close and its values SHALL be discarded. The message SHALL be shown in a `role="alert"` region at the Active Topics heading. If the refetch fails, the message SHALL additionally read '…Reload the page to see the current state.' and the screen SHALL remain rendered." Add one scenario for refetch failure after 409. |
| O2 | High | **Message placement and role are missing for three strings.** "Topics can't be added to this team right now.", "Added '<name>', but the list couldn't be refreshed…", and the Remove/Restore refetch-failure alerts say "show exactly" but don't say where. The form has closed in two of those cases, so "form-level" can't apply. | For each one, state the region (for example, a screen-level `role="alert"` directly under the Active Topics heading) and its role. 201+refetch-failure is a partial success. Pick `role="alert"`, not `status`, because the user has to act on it (reload). |
| O3 | Medium | **"The message SHALL remain until the next action on the screen" is vague.** The existing spec defines lifetime by naming events ("next move, next save, or departure"). "Next action" invites arguments, for example about whether focusing a field counts. | Enumerate: "until the add form is opened again, a move is made, a Remove/Restore confirmation is opened, a definition editor is opened, or the facilitator leaves the screen." Apply the same list to the 409 and refetch-failure alerts. |
| O4 | Medium | **"`403` (either code)" doesn't name the codes.** | Name them: `NOT_A_FACILITATOR` and `FACILITATOR_IS_TEAM_MEMBER` (per `add-custom-topic` spec L75). |
| O5 | Medium | **Submit re-enabling is only stated for network/5xx.** For 403, 404, and 422 the spec says the form stays open but doesn't say whether Submit and fields come back from "Adding…"/read-only. | One sentence: "On every failure outcome in which the form stays open, Submit SHALL read 'Submit' (or its normal label), be enabled subject to the interlock rule, and every field SHALL be editable." |
| O6 | Medium | **The single-topic variant "Added '<name>'." has no scenario.** It is reachable from the empty state (rows 2 and 4), which is the very flow the empty state promotes. | Add a scenario: empty state, row 4 → Add custom topic → 201 → status reads "Added 'X'." and the empty state is replaced by a one-row list headed "Active Topics (1)". |
| O7 | Low | **Focus target after 201 has no fallback.** If the refetch succeeds but the new id is not in the active list (another facilitator archived it in the gap), "focus the new row's heading" has no target. | "…or, if the new topic is not in the refreshed active list, to the Active Topics heading." |

### R-Duplicate: "A likely duplicate … is flagged before the request, without blocking it"

| # | Sev | Issue | Suggested concrete condition |
|---|---|---|---|
| D1 | High | **Multiple matches are undefined.** Name and prompt may match two *different* topics, or two archived topics may share a name (data fixes, earlier custom topics). The spec says which *message* wins, not which *topic* the message names, nor which row "Show it in Archived topics" focuses. | "When several topics match, the warning SHALL name, and 'Show it in Archived topics' SHALL focus, the first matching archived topic in the archived list's display order (or, for an active-only match, the first matching active topic in display order)." |
| D2 | High | **Override persistence is undefined.** After "Add anyway" → network failure → Submit again, does the warning reappear? Read literally, "The check runs on Submit" means yes, which nags the facilitator on every retry. | "Once the facilitator chooses 'Add anyway' or 'Add as a new topic anyway', the check SHALL NOT run again until Name or Prompt is edited." Add a retry scenario. |
| D3 | Medium | **"Editing the field that matched" is ambiguous when both matched.** | "Editing Name or Prompt SHALL dismiss the warning." This is simpler and testable, and the check re-runs on the next Submit anyway. |
| D4 | Medium | **"Case-folded" is not one operation.** `toLowerCase`, `toLocaleLowerCase`, and Unicode case folding differ (e.g. "ß"). The spec also forbids "other normalisation", so internal whitespace differences don't match. Say so, so nobody "fixes" it. | "Case-folded means `String.prototype.toLowerCase()` with no locale. Internal whitespace is compared as typed." Add a scenario: "Codebase  Health" (two spaces) does not match "Codebase Health". |
| D5 | Low | **The check runs against the screen's loaded list, not the server.** That is correct for a non-blocking hint, but the spec doesn't state it. Without that, a tester will file "missed a duplicate added in another tab" as a bug. | "The comparison uses the topics most recently loaded by the screen. It is not authoritative and the server does not enforce uniqueness." |
| D6 | Low | **"Show it in Archived topics" focus target.** Rows aren't focusable by default. | "…focus the matching archived row's heading (programmatically focusable)", matching the 201 focus target. |

### R-Interlocks: "Adding a topic interlocks … only at submit time"

| # | Sev | Issue | Suggested concrete condition |
|---|---|---|---|
| I1 | High | **An already-open, clean definition editor during an in-flight add is not covered.** The in-flight rule disables "Add team definition" and "Edit" *controls*. A clean editor that is already open still has a textarea and a Save button, so the facilitator can type into it and save while the add is in flight. The existing spec closes clean editors when a move begins or a Remove/Restore confirmation opens. The add submit should do the same. | "When an add request is sent, any open definition editor with no unsaved changes SHALL close." Add a scenario. Without this rule, two reasons ("Wait for the new topic…" and "Save or cancel your definition changes first.") can apply at once with no precedence. |
| I2 | Medium | **Precedence of the new reason against existing ones is unstated.** By construction the in-flight state is mostly exclusive (Submit is blocked by the other three), but I1 shows one way it isn't. | After I1: "While an add request is in flight, 'Wait for the new topic to finish saving.' SHALL take precedence over every other disabled reason." |
| I3 | Low | **Stale rationale in the living spec.** Existing requirements (L211, L446) justify their interlocks by "the post-Remove/Restore refetch could replace the screen". After this change that refetch is quiet. The rules stay correct, since they still protect drafts from being overwritten, but the rationale text now describes behaviour that no longer exists. | Optional: a MODIFIED block correcting the rationale sentences, or a note in design.md that the interlocks stay deliberately even though the screen-replacement hazard is gone. |

### R-Refetch: "Refetches after a successful Remove or Restore never replace the screen"

| # | Sev | Issue | Suggested concrete condition |
|---|---|---|---|
| F1 | Medium | **What the lists show after a failed refetch is unspecified.** After an archive succeeds and the refetch fails, the archived row presumably stays in the active list with an enabled Remove. A second Remove will hit `422 TOPIC_ALREADY_ARCHIVED`. | State the choice: either "the lists SHALL be left as last loaded" (then add a scenario showing a second Remove surfaces the server message inline), or "the screen SHALL remove the archived row locally". I'd take the first. It's honest, and the alert already says reload. |
| F2 | Low | **Is this a MODIFIED requirement?** The existing spec has no requirement that says the Remove/Restore refetch uses the full-screen path. It was only implied by the code (`loadTopics()` at L627/L678), so ADDED is acceptable. Just confirm nothing in `restore-topic` or `remove-topic` specs states the full-screen behaviour. | Grep check before approval. No spec change expected. |

### R-Form and R-Trigger

| # | Sev | Issue | Suggested concrete condition |
|---|---|---|---|
| T1 | Medium | **Focus return from the empty-state trigger.** "Closing the form … SHALL return focus to the trigger", but in the empty state the heading trigger is hidden and the empty-state button opened the form. The form's position in the empty state ("directly under the heading"? above or below the empty-state text?) and whether the empty-state message stays visible while the form is open are also unstated. | "Focus SHALL return to the control that opened the form." "When opened from the empty state, the form SHALL replace the empty-state actions, and the empty-state message SHALL remain above it." (Or the reverse. Pick one.) |
| T2 | Low | **Counter format and announcement.** "Shows a character counter" has no format and no live-region rule. A screen reader announcing every keystroke is a real annoyance. | "Counter format 'n / limit', not a live region; the field's `aria-describedby` includes it." |
| T3 | Low | **Heading count in the empty state.** Implied "Active Topics (0)" but no scenario. | Add an AND line to one empty-state scenario. |

### R-Gating (`topic-customization-lock` delta)

| # | Sev | Issue | Suggested concrete condition |
|---|---|---|---|
| G1 | Low | "`true` when the caller is a standing facilitator (… not an active member of the team)": TOPIC-002 already rejects team members, so the parenthetical describes a branch that can't be reached. It's harmless, but a reader may think the endpoint computes membership for this flag. | "…`true` for every facilitator TOPIC-002 admits." |
| G2 | — | The temporary/#176 wording, the "not derived from `canEditAnnotations`" clause, and the lock-independence scenario are exactly what I asked for. No change. | — |

---

## 2. Traceability against requirements

| Source item | Covered by | Status |
|---|---|---|
| UC Add Custom Topic AC1: required name, prompt, vote type before submission | R-Validation + scenarios | Covered |
| AC2: all three vote types selectable | R-Form (exact labels/explanations) | Covered |
| AC3: appears in list immediately | R-Outcomes 201 scenario | Covered |
| AC4: appended at end | 201 scenario ("last active row"); server rule in `add-custom-topic` | Covered |
| AC5: marked custom in UI | R-Custom tag | Covered |
| AC6: only after first session | R-Gating, no disabled variant | Covered |
| AC7: Facilitator only, not Engineers | Prose in R-Gating citing existing access-denied state | **Partially.** No scenario. Cite the existing scenario by name ("An ineligible caller sees an access-denied state") so the trace is explicit. |
| Alt flow: values preserved on validation error | R-Validation | Covered |
| Alt flow: duplicate prompt allowed, warning optional | R-Duplicate | Covered (name **and** prompt; exceeds my C4 recommendation, accepted) |
| Alt flow: system error → retry | Network/5xx outcome | Covered |
| Main flow step 3: prompt "distinct from the name" | Negative requirement + scenario | Covered |
| Postcondition: appears in next session run | Known deviation (#175) | Deviation stated |
| UC View Active Topics: empty state "re-add or add custom" | R-Empty state table | Covered, with trigger-wording handoff |
| UC Live Session step 5: description shown in session | Known deviation + handoff | **Gate open.** See §3 |
| **BRD FR-8.2** [HARD]: facilitator **or Application Administrator** can add | `canAddTopics=false` for admin, #176 | Deviation stated against #176. The proposal should cite **FR-8.2** by number in the Known deviations list, not only in the lock spec. |
| **BRD FR-8.6** [HARD]: defaults "visible and restorable for any team at any time" | Not addressed | **Missing deviation.** A team in empty-state row 4 or 5 (zero active, zero archived: the provisioning gap) has no way to see or restore defaults, and this change deliberately doesn't read `defaultTopicsNotActive`. That is the right call, but it's a HARD requirement this team can't meet, and it should be listed under Known deviations with the `zero-topic-team-recovery-path` and `default-topics-not-active-name-join` handoffs as the tracking items. |

---

## 3. Approval gates (not spec defects, but they block approval)

1. **C1 handoff must be filed before approval.** The proposal correctly restates my condition: `custom-topic-description-never-shown-in-session.md` must be filed and its number referenced. It is still a draft with "issue numbers TBD". The human owner must file it and replace "TBD" with the number in the proposal's Known deviations bullet before this proposal is approved.
2. **Description-field wording (C1, mine).** The shipped helper text ("Engineers won't see this during sessions. Use it as a note for whoever facilitates this team. A team definition is the place to explain what this topic means for your team.") is better than my draft, because it avoids promising a definition is shown in session. **Approved as written.**
3. **Priya's copy review** of form, duplicate, outcome, and empty-state strings is listed as pre-approval. It's still outstanding.

---

## 4. Proposal-text consistency (Low)

- The proposal says admins "see no add control **and no explanation**". Empty-state row 5 ("Topics can't be added from this account yet.") *is* an explanation, shown only in the empty state. The spec's admin scenario gets this right ("outside the empty state"). Align the proposal sentence.
- Row 5's "yet" and row 3 are only reachable while #176 is open. Add a line to the #176 note in the spec: "When #176 is fixed, rows 3 and 5 become unreachable for every caller TOPIC-002 admits and SHALL be removed in the same change." That keeps a dead row from outliving its defect.

---

## Summary

Implementable with targeted fixes. Every exploration-review item (V1–V12, C1–C8) landed as exact, testable copy. **High:** 409 form fate and refetch-failure handling (O1); placement and role of three screen-level messages (O2); multi-match target and override persistence in the duplicate check (D1, D2); an already-open clean definition editor during an in-flight add (I1). **Medium:** message lifetime wording, unnamed 403 codes, Submit re-enable on failure, the missing "Added 'X'." scenario, stale lists after a failed Remove/Restore refetch, and empty-state focus return. **Traceability:** add **FR-8.6** (defaults restorable) as a stated deviation for zero-archive teams, cite FR-8.2 by number, and point AC7 at the existing access-denied scenario. **Gates:** file the C1 in-session-description handoff and put its number in the proposal, and finish Priya's copy review.
