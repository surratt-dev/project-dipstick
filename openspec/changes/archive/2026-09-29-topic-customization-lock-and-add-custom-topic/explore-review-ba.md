# Requirements Review: Topic Customization Lock + Add Custom Topic (#49 + #50)

**Reviewer (persona):** Marcus Delgado, Senior Business Analyst
**Reviewing:** `exploration-notes.md` (Devon Calloway)
**Purpose:** Assess whether the exploration is specific enough to carry into a proposal, flag vague areas, supply concrete acceptance conditions, and answer the two open questions the exploration raised.

**Bottom line up front:** This is one of the stronger explorations I've reviewed on this project — it did the traceability work I usually have to ask for (checking the shipped contract, the migration, the validation report's history) before writing anything down as a gap. I have one correction to its own factual claim (in its favor — the gap is worse than it thought), one clarification that's genuinely still open, and one that I can close outright from the documentation trail. Neither open question should block a proposal from being written; both have documented, traceable answers or a documented path to get one.

---

## 1. Verification: the notes' factual claims check out

Before answering the two questions I was asked to weigh in on, I independently verified the claims the exploration rests on, since a proposal built on a misremembered fact is worse than one built on an admitted gap:

- **`topics.name` / `topics.prompt` are both `NOT NULL`** — confirmed directly against `packages/backend/migrations/2_create_tables.sql` (lines 45–59). Both are independently required columns, no default.
- **The "Add Custom Topic" use case names only three fields** — confirmed against `requirements/use cases/08 - Topic Management - Use Cases.md`, lines 116–176. Main Flow step 3: "a form with fields for: topic prompt (required), vote type (required...), and topic description (optional)." No `name` field anywhere in Main Flow, Alternate Flows, Postconditions, or Acceptance Criteria for that use case.
- **`TOPIC-003`'s contract requires `name` as a separate required field** — confirmed against `requirements/design/REST API Contract.md` (`AddCustomTopicRequest`: `name` required ≤100 chars, `prompt` required ≤500 chars, both present, both required).
- **The shipped `GET /api/v1/teams/:teamId/topics` handler does NOT currently return `isCustomizationLocked`** — I checked this directly, since the notes flagged it as an open question rather than a known fact. `packages/backend/src/routes/content.ts` line 491: `return noStore(reply).send({ teamId, topics: result.rows });`. **This is worse than "unconfirmed" — it's confirmed missing.** The exploration's open question #4 should be upgraded from "confirm whether this needs to be added" to "this needs to be added; it is not there today." This is now a concrete, must-include line item for the proposal's task list, not an open question to research further.

Nothing else in the notes' factual substrate needs correction. The rest of my review takes the notes' other claims as given (they've earned that trust) and focuses on the two questions I was specifically asked to weigh in on, plus a few clarity gaps in the source use cases themselves.

---

## 2. Open Question 1 — the `name` vs. `prompt` field mismatch: **genuinely unresolved, and it's mine to resolve, not the implementer's**

The notes correctly identify this as a real mismatch and correctly decline to resolve it unilaterally. I'll go further: **this is a defect in the use case document I'm responsible for, not an ambiguity the implementation team can absorb.** The use case ("Add Custom Topic") is simply silent on a field the schema, the already-reviewed contract, and the sibling "Assign Default Topic Set" use case's AC (which distinguishes short label from full prompt for every default topic) all require. That's not a case where reasonable people could read the use case two ways — it's a case where the use case under-specifies the form relative to what every other artifact already assumes.

**Traceability check on the two options the notes propose:**

- **Option B (auto-derive `name` server-side for custom topics)** would require either a new BRD/use-case decision or a contract change, and neither exists. `TOPIC-003`'s request shape (`name` required, independent length limit, independent validation) was reviewed and marked "Covered" against FR-8.1–FR-8.6 in the Validation Report with no dissent on this field. Option B isn't "pick the lighter-touch option" — it's silently overriding an already-validated contract. I would not sign off on Option B without reopening the contract review, which is a heavier process than just fixing the use case.
- **Option A (the use case is incomplete; add the `name` field to the corrected AC)** requires no reopening of anything already reviewed — it just brings the use case into alignment with artifacts that were already reviewed and correct. This is also consistent with how the "Assign Default Topic Set" use case already treats `name` as a first-class, distinct-from-prompt field for every topic in the system; there's no principled reason a custom topic should be exempt from having one.

**My ruling: Option A.** I'll treat this as a correction to the "Add Custom Topic" use case, not a proposal-level design decision — the proposal's spec delta should state the corrected AC directly (add a required `name` field, ≤100 characters, distinct from `prompt`, matching `TOPIC-003`) and note that this corrects an omission in the BA-authored use case, the same way `restrict-team-005-em-promotion` documented its correction as closing an unaddressed scope, not reversing a decision. I will personally update the source use case doc separately from this proposal (that's a `requirements/`-directory correction, not implementation scope) — the proposal should not have to carry that edit, just declare the corrected field list as its own AC and cite the correction.

**Concrete AC to add to the proposal's spec delta** (replacing the vague "form has three fields" framing):
- `name`: required, non-empty after trim, ≤100 characters — short label, distinct from `prompt`.
- `prompt`: required, non-empty after trim, ≤500 characters — full question text.
- `voteType`: required, one of `finger` / `roman` / `modified_roman`.
- `firstSessionDescription`: optional, ≤500 characters.
- Validation error is `422` and identifies which field(s) failed, not a generic "invalid request."

---

## 3. Open Question 2 — which authorization model applies: **already resolved, in the binding contract, for this endpoint group specifically**

I checked both documents I was asked to check.

**`requirements/design/REST API Contract.md`** specifies, for every write endpoint in Group 3 (`TOPIC-003`, `004`, `005`, `006`, `007`): *"`global_role = 'facilitator'` AND the facilitator must not be a member of this team AND `isCustomizationLocked` must be `false`."* This is the standing, org-wide facilitator model — Philosophy 1 in the notes' framing.

**`REST API Contract - Validation Report.md`** (my own prior work, dated 2026-03-15, with one addendum dated 2026-09-16) is the authoritative change log for every authorization decision made against this contract since it was drafted. I read it end to end looking for any entry that touches `TOPIC-003` through `TOPIC-007`'s authorization model. There isn't one. Compare this to how the Validation Report handles every other authorization question that *did* get revisited:
- `TEAM-005`/`TEAM-006` — two rounds of correction (2026-03-15, then the 2026-09-16 issue #109 addendum), both explicitly logged against those endpoint numbers.
- `TOPIC-002` — its authorization was explicitly revisited and narrowed (Discrepancy 5).
- `SESSION-009` — its phase guard was added (Discrepancy 6).

`TOPIC-003` through `TOPIC-007`'s authorization clause has never been touched since the 2026-03-08 draft. FR-8.2 is marked "Covered" against exactly this authorization model in Section 1's coverage matrix, with no caveat. **From a requirements-traceability standpoint, this is not an open question — it is the documented, binding answer**, and it has been stable and unrevisited for longer than almost any other authorization clause in the contract.

**Why the tension the notes raise doesn't override this, and why I'm not just picking the older doc by default:**

I went and read `action-item-owner-reassignment`'s actual spec (not just the notes' quotation of it) to check whether it was written as a general new authorization doctrine or a locally-scoped reuse decision. It's the latter, explicitly:

> "...deliberately reusing `action-item-status-management`'s (`VOTE-002`) session-scoped facilitator-authorization pattern... rather than re-deriving equivalent-but-different versions of each."

That's a decision about *that endpoint's lineage* — `VOTE-004` inherits its authorization shape from `VOTE-002` because they're the same resource family (action items) with the same use-case-level justification (the governing use case has no out-of-session path). It is not framed anywhere in that spec, or in its design.md, as "and therefore all future facilitator-write endpoints should adopt this model." Generalizing a locally-justified pattern from one resource family to a structurally different one (action items, which are tied to a live session's wrap-up flow, vs. topics, which the notes correctly observe must be manageable *between* sessions) is exactly the kind of inference I'd flag as unsupported if I found it in an implementation without a stated rationale — and the notes are right that adopting it here without justification would create the conflict they describe with the "usable between sessions" requirement.

One more data point that should settle this rather than leave it feeling like a coin flip: my own Validation Report (Section 4, item 6, still open as of 2026-03-15) shows that even `VOTE-004`'s own session-scoped model wasn't something I had blessed at contract-review time — I flagged it as "requires explicit BA confirmation," and it was only resolved later, within `action-item-owner-reassignment`'s own change, specifically for that endpoint. That confirms the session-scoped model has only ever been ratified endpoint-by-endpoint, never as a blanket successor to the standing-facilitator model the topic-management contract uses.

**My ruling:** Philosophy 1 (standing facilitator: `global_role = 'facilitator'` + non-member + lock check) is the correct authorization model for `TOPIC-003`, and it does not need a new Decision entry weighing the two philosophies from scratch — it needs a short **traceability note**, not a fresh design deliberation: *"Authorization for TOPIC-003 follows the pre-existing, unrevised REST API Contract clause for Group 3 endpoints. The narrower session-scoped model introduced by `action-item-owner-reassignment` was a locally-justified reuse decision for the action-item resource family and was never generalized in that change's spec or design.md; it does not apply here, and adopting it would conflict with the 'usable between sessions' requirement in 'View Active Topic Configuration.'"* That sentence belongs in the proposal's design.md so a future reader doesn't rediscover this exact tension and re-litigate it. I'd rather it read as "checked and confirmed" than as a silent, uncommented choice — the notes are right that an *unstated* choice here would look like an oversight later, even though I'm now stating there was never really a fork in the road once you trace both source documents fully.

---

## 4. Vague areas and clarifications needed before this becomes a proposal

These are gaps in the *use case documents themselves* — not things the exploration missed, but things it correctly surfaced as unresolved and that I should now either rule on or explicitly hand to the proposal as decisions still needed.

### 4.1 Lock-rejection status code (Section 5 of the notes) — needs a ruling, not just a flag

The notes correctly identify the conflict: the reviewed contract folds the lock into `403`, but the more recent codebase convention (`already_revealed`, `action-item-owner-reassignment`'s resolved-item guard) treats "authorized but the resource is in a non-permitting state" as `409`.

Unlike the authorization-model question, I don't think traceability alone settles this one — the contract's `403` framing here predates the `409`-for-state-preconditions convention becoming established codebase practice, and (unlike Group 3's authorization clause) the lock-rejection status code was never separately called out and reviewed as its own line item in either the Validation Report or a later addendum. This is a genuine gap, not a documented-and-stable answer.

**My ruling, so the proposal doesn't have to re-litigate this either:** `409 Conflict`, not `403`, for the lock-rejection case specifically — distinct from the `403` used for "not a facilitator" / "facilitator is a team member." The notes' own reasoning is correct: the lock is a derived state fact about the team's session history, not an identity/role fact about the caller, and this codebase has an established, repeated precedent (`action-item-owner-reassignment`'s resolved-item 409, `session-topic-lifecycle`'s `already_revealed`/`advance_blocked`) for exactly this distinction. This is a deviation from the literal contract text and should be written up as an explicit Decision in the proposal's design.md — with the contract corrected to match, the way `TEAM-005`'s promotion-block correction updated the contract's source-of-truth text rather than leaving the implementation silently diverge from it.

**Concrete AC:**
- A write request (`TOPIC-003`/`004`/`005`/`006`/`007`) against a team with `isCustomizationLocked = true`, from an otherwise-authorized facilitator (correct global role, non-member), is rejected with `409 Conflict`, error code e.g. `TOPIC_CUSTOMIZATION_LOCKED`, with a plain-language message stating that the team's first session must complete before customization is available.
- `403 Forbidden` is reserved for identity/role failures (wrong global role, or facilitator is a team member) — evaluated and returned *before* the lock check, per the notes' auth-before-precondition ordering, so lock state never leaks to an unauthorized caller.

### 4.2 The "Enforce Topic Customization Lock" use case's own AC is under-specified for what "read-only view" means operationally

I went back to the source use case (lines 61–114 of `08 - Topic Management - Use Cases.md`) rather than relying only on the notes' paraphrase. The AC says the locked view must show "a clear, plain-language explanation" but doesn't specify:
- Whether the locked-state message is a static string or needs to reference *why* — e.g., does it need to name the team's completed-session count (0) or just state the rule generically?
- Whether attempting a write while locked (the "bypasses the UI" alternate flow) needs a *different* message than the read-side explanation, or the same one surfaced as an error.

This is small, but "clear, plain-language explanation" is exactly the kind of AC phrase that produces a "what did you mean by this" round-trip during implementation, which is precisely what I try to avoid. Since no frontend ships in this bundle, the concrete requirement for *this* proposal is only the API contract's error message content — but it should be a literal string or template specified in the spec delta, not left as "plain language," so `#55`'s eventual frontend has a stable string to render rather than inventing its own.

**Suggested rewrite for the AC:** "When `isCustomizationLocked` is `true`, `GET /teams/:teamId/topics` and `GET /teams/:teamId` both include `isCustomizationLocked: true`. Any write endpoint under lock returns `409` with `message: \"Topics cannot be customized until this team's first session is completed.\"` (exact string, to be treated as a stable contract value the frontend can render directly)."

### 4.3 "Reusable check" — the notes' proposed helper name/location is a good suggestion but not a requirement yet

Section 6 of the notes proposes `hasCompletedFirstSession(teamId)` / `isTopicCustomizationLocked(teamId)` as a shared helper, parallel to `team-content-access-helper.ts`. I agree with the *principle* (one query, called from both read-serialization and write-gate) and think it should be stated as a hard requirement in the proposal's spec delta — "MUST be a single, named, reusable function; MUST NOT be duplicated inline in each handler or between read/write paths" — but the specific function name/file location is an implementation judgment call, not something I need to bless as a BA. I'd keep the requirement worded at the "one function, two callers, no drift" level and let whoever writes the design.md pick the concrete name.

### 4.4 Audit logging (Section 7) — agree, and it should be a stated AC, not just a stylistic nod

The notes' precedent-matching (auditing blocked attempts, per `session-creation`'s cross-team-denial precedent) is correct and should become an explicit AC in the proposal, not left as prose: *"Every request rejected under the customization lock (`409`) SHALL write a synchronous `audit_log` row, `operation = 'topic.write_denied_locked'` or similar, before the response is sent."* Note the parallel to `TEAM-005`'s promotion-block audit row, which is written "before the response is sent" — that ordering detail matters and should be copied verbatim into this proposal's requirement, not re-derived.

---

## 5. What does NOT need further clarification

- **Section 1 (what's being protected)** — clear, well-grounded in BRD 6.4, no changes needed.
- **Section 6 (schema/route location)** — no migration needed is correctly confirmed against the schema; route file organization is a legitimate implementation judgment call, not a requirements gap.
- **Section 8 (concurrency edge waved off)** — the use case itself explicitly marks this out of scope ("real-time unlock is a nice-to-have, not a requirement"). Confirmed by directly reading the use case's Alternate Flows. No further BA input needed; the proposal just needs the one-line confirmation the notes already suggest.

---

## 6. Summary — what the proposal must carry forward

1. **Corrected AC for "Add Custom Topic":** add `name` (required, ≤100 chars, distinct from `prompt`) to the request shape and AC. This is a correction to my own use case document, not a new design decision — cite it as such.
2. **Authorization for `TOPIC-003`:** standing facilitator model (global `facilitator` role + non-member + lock check), per the unrevised, still-binding `TOPIC-003` contract clause. Include the one-paragraph traceability note in design.md so this doesn't get re-litigated as if it were still open.
3. **Lock-rejection status code:** `409 Conflict`, distinct from `403` (reserved for identity/role failures). This deviates from the contract's literal `403`-for-everything text and should be logged as an explicit Decision, with a corresponding correction to the contract document (parallel to how `restrict-team-005-em-promotion` corrected `TEAM-005`'s text).
4. **`isCustomizationLocked` on `GET /teams/:teamId/topics`:** confirmed missing from the shipped handler (`content.ts:491`) — not an open question, a required line item for this bundle's task list.
5. **One reusable lock-check function**, called from both read-serialization and write-gate — stated as a hard requirement, exact naming left to design.md.
6. **Audit the blocked attempt**, not just the successful write, with the same "before the response is sent" ordering used by `TEAM-005`'s promotion-block precedent.
7. **Stable, literal error-message string** for the lock rejection (both read-side flag and write-side `409` body) so the frontend that eventually consumes this (issue #55) has something concrete to render.

None of this blocks the proposal from being written. Both open questions I was asked about have answers I'm comfortable standing behind — one by direct contract lookup, one by a scoped correction to my own use case document — and the remaining gaps (status code, message string, audit ordering) are normal-sized clarifications a proposal's design.md is supposed to close, not blockers to starting one.
