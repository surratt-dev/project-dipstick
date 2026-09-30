# BA Review — Propose Stage: `topic-customization-lock-and-add-custom-topic`

**Reviewer:** Marcus Delgado, Business Analyst
**Scope reviewed:** `proposal.md`, `design.md`, `specs/topic-customization-lock/spec.md`, `specs/add-custom-topic/spec.md`, `tasks.md`, cross-checked against `requirements/use cases/08 - Topic Management - Use Cases.md` and `requirements/design/REST API Contract.md`.

## Summary

The two stated corrections in the proposal check out — I traced both back to the source documents and they are accurately represented. The spec deltas themselves are unusually well-formed: concrete field limits, fixed error strings, explicit WHEN/THEN scenarios, and a check-ordering rule (403 before 409) that's stated once and doesn't drift between documents. This is buildable as written for the cases it covers.

What it doesn't cover is where I spent the rest of this review. I found **one drift point the proposal didn't catch** — a real gap between the "Add Custom Topic" use case's own precondition language and the authorization model design.md actually adopts — plus several ordering and edge-case gaps that this codebase's own precedents (`action-item-owner-reassignment` in particular) show should be pinned down explicitly rather than left to tasks.md's implementation sequence to imply.

None of this should block moving forward. All of it is closable with text, not new design work.

---

## Part 1 — Verifying the two stated corrections

### Correction 1: `name` as a required field distinct from `prompt` — CONFIRMED ACCURATE

I read the "Add Custom Topic" use case's Main Flow step 3 directly: *"The Application presents a form with fields for: topic prompt (required), vote type (required — Finger, Roman, or Modified Roman), and topic description (optional)."* `name` is genuinely absent — not implied, not folded into "prompt," just missing. I checked this against three independent sources that all treat `name` as its own thing: the `topics` table schema (`name text NOT NULL` and `prompt text NOT NULL` as separate columns, `packages/backend/migrations/2_create_tables.sql:48-49`), the already-reviewed `TOPIC-003` contract (`AddCustomTopicRequest.name`, max 100 chars, distinct from `prompt`, max 500 chars), and the sibling "Assign Default Topic Set" use case, whose default-topic list gives each topic a short label distinct from its full prompt text. The proposal's characterization is correct: this is a documented gap in the use case, not a design choice being introduced here.

### Correction 2: `403`-for-everything → split into `403`/`409` — CONFIRMED ACCURATE

`TOPIC-003`'s error table in the contract literally reads: `403 Forbidden | Not a facilitator; facilitator is a team member; customization lock is active`. All three causes folded into one status code, confirmed by direct read. The correction's precedent citations also check out: `action-item-owner-reassignment`'s resolved-item guard is genuinely `409` (`openspec/specs/action-item-owner-reassignment/spec.md`), and `session-topic-lifecycle`'s `already_revealed`/`advance_blocked` responses are genuinely `409` (`openspec/changes/archive/2026-09-08-session-lifecycle-transitions/.../spec.md`). The claim that this specific line was never independently reviewed against a Validation Report disposition (unlike the authorization clause) is consistent with what I can see in the contract itself — I have no way to verify the Validation Report's history independently, but nothing here contradicts the claim.

I'll also flag, as a **non-issue worth naming on the record**: design.md notes `TOPIC-004`/`TOPIC-006` have "the analogous text" and are left uncorrected, deferred to their own future changes. I checked — that's true, and it's consistent with proposal.md's Impact section, which names only `TOPIC-003`'s error table as in scope for this change. No drift here; I mention it only because a future reader of the contract will see `TOPIC-003` split into 403/409 while `TOPIC-004`/`TOPIC-006` still read 403-only, with nothing in the contract itself pointing to why. A one-line forward-reference in the contract next to those two tables ("pending the same correction — see `topic-customization-lock`") would save whoever picks up #51+ a moment of "wait, is this inconsistent or intentional?" Cosmetic, not blocking.

---

## Part 2 — A third drift point the proposal didn't catch

**The "Add Custom Topic" use case's own precondition text conflicts with the authorization model design.md adopts, and this isn't named as a correction anywhere.**

The use case's Preconditions section states:
> "The Facilitator is accessing the topic management area for the team **they are facilitating**."

Design.md's Decision 3 (Philosophy 1) adopts the standing, org-wide facilitator model: `global_role = 'facilitator'` AND not an active member of the target team — with no requirement that the facilitator has ever run a session for that team. The spec itself states this explicitly, as its own dedicated scenario:

> "Add Custom Topic is available regardless of which facilitator has run sessions for the team... a standing facilitator who has never run any session for the target team submits a valid request against that team, and the team is unlocked → the topic is created successfully; prior session history with this specific facilitator is not required." (`specs/add-custom-topic/spec.md`)

That's a direct contradiction of the plain reading of "the team they are facilitating" — which implies some existing facilitation relationship — and it's not a subtle one. I checked whether this phrasing is just loose language repeated across the topic-management use cases (in which case it'd be less of a concern), but it isn't: "Remove a Topic," "Reorder Topics," "Annotate Topic," and "Re-Add a Previously Removed Topic" all use the neutral "The Facilitator is authenticated" / "the topic ... exists" phrasing with no facilitation-relationship claim. "View Active Topic Configuration" goes the other way and uses the *broader* phrasing consistent with design.md's model: "accessible to the Facilitator for any team **they are eligible to facilitate**." "Add Custom Topic" is the one use case in this document whose precondition text reads narrower than the model actually being built.

Design.md's Decision 3 traceability note is a thorough defense of Philosophy 1 against `action-item-owner-reassignment`'s narrower session-scoped precedent — but it never engages with the fact that the use case it's implementing has its own narrower-sounding precondition sitting right there. I don't think this changes the decision (the REST API Contract's Group 3 clause is the already-reviewed, "Covered" answer, and Philosophy 1 is well-argued against it) — but it should be named as a correction, the same way the `name` gap and the `403`-blanket text were, rather than left for someone to notice later and wonder whether it was missed or dismissed.

**Suggested concrete fix:** Add a third bullet to proposal.md's "corrections" list and a corresponding line item in tasks.md §6.1:
> The "Add Custom Topic" use case's precondition "the team they are facilitating" is corrected to reflect the standing, org-wide facilitator model already established for this endpoint family in the REST API Contract's Group 3 authorization clause — no prior facilitation relationship with the team is required, only that the caller is not an active member of it.

### Related, lower-priority: the lock-bypass rejection's use-case language

"Enforce Topic Customization Lock for First Session"'s Alternate Flow describes the server-side rejection as: *"The Application validates the lock server-side and rejects the request with **an authorization error**."* Design.md Decision 2 is explicit that the lock rejection is **not** an authorization failure — "the lock is a derived fact about the team's session history — a state precondition — not a fact about who the caller is" — which is the entire justification for `409` over `403`. Calling it "an authorization error" in the source use case is now technically inconsistent with the model being built, in the same category as the `403`-blanket contract text, just one document over. I'd suggest folding this into the same correction pass on `08 - Topic Management - Use Cases.md` rather than treating it as a separate open question — it's the same underlying fact (this is a state precondition, not an authz failure) documented twice, with only one of the two documents corrected.

---

## Part 3 — Buildability gaps: implicit where they should be explicit

The spec deltas are strong on the scenarios they cover. Three places left implicit what this codebase's own precedent (`action-item-owner-reassignment`) treats as requiring an explicit, ordered statement:

### 1. `404` (team does not exist) has no home

The REST API Contract's `TOPIC-003` error table lists `404 Not Found | Team does not exist` as a defined response. I checked `proposal.md`, `design.md`, both spec deltas, and `tasks.md` — **none of them mention `404` or team-existence validation at all.** Nothing says where this check sits relative to the `403` (identity/role) → `409` (lock) ordering that *is* carefully specified. Without an explicit team-existence check, a `POST` against a nonexistent `teamId` would fall through to the insert and hit the `topics.team_id` foreign-key constraint — surfacing as an unhandled `500`, not the contract's documented `404`.

This also isn't just a missing test — it's a missing **ordering decision**. Does a non-facilitator get `403` or `404` against a team that doesn't exist? This codebase already has a rigorous precedent for exactly this kind of question: `action-item-owner-reassignment`'s spec states its full validation cascade as an explicit ordered list ("evaluated in this order: 1... 2... 3... 4...") specifically so a caller with zero relationship to a resource gets `404` before anyone reasons about `403`, closing an enumeration oracle. `TOPIC-003` deserves the same treatment: state where team-existence sits in the check order, add a scenario, add a task line.

### 2. `422` (body validation) vs. `403`/`409` (authorization/lock) ordering is only implied, not stated

`add-custom-topic/spec.md`'s two requirements ("validates required fields... 422" and "enforces the customization lock and standing-facilitator authorization") never state their relative order. `tasks.md` implies an order by listing them sequentially — Task 5.2 (body validation) before Task 5.3 (authorization check) — but a task list's sequencing is not a spec commitment, and I don't think it's the order I'd actually want: validating a request body before confirming the caller is even allowed to write to this team means a `NOT_A_FACILITATOR` caller who sends a malformed body gets told what's wrong with their `name` field before being told they're not authorized at all. Compare `action-item-owner-reassignment`'s explicit design choice to check identity/relationship first, specifically to avoid leaking information to callers who were never going to be authorized regardless — the same principle design.md's Decision 2 already applies to the 403-before-409 ordering. That same principle should extend one step further to cover 422.

**Suggested fix:** state the full check order as one sentence in `add-custom-topic/spec.md`, e.g.: *"Checks are evaluated in this order: team existence (404) → identity/role authorization (403) → customization lock (409) → request body validation (422)."* Add a scenario or two locking in the boundary cases (e.g., "a non-facilitator submitting an invalid body still receives 403, not 422").

### 3. Concurrent `displayOrder` assignment has no stated behavior

`design.md` Decision 6 reasons carefully through the *lock check's* race condition and explicitly accepts a false-negative-only outcome as harmless. No equivalent reasoning exists for the `displayOrder = max(current active) + 1` computation on the write path itself. Two concurrent `Add Custom Topic` requests against the same unlocked team could both read the same max and attempt to insert the same `display_order`, which the schema's own constraint (`topics_team_order UNIQUE (team_id, display_order, status)`) would then reject as a database error — not a handled `409`/`422`, just an unhandled failure on one of the two requests. This is a materially different question from the lock-check race design.md already dismissed, and it isn't addressed anywhere.

This may well be an acceptable, low-probability edge case to leave unhandled for a first cut (two facilitators independently adding a topic to the same team in the same instant is rare) — but "acceptable and unhandled" should be a stated decision, not silence, given how much rigor the rest of this document applies to exactly this class of question. A one-line addition to design.md ("Decision 9 — no explicit handling for concurrent displayOrder assignment; accepted as low-probability, revisit if observed") or a `SELECT ... FOR UPDATE`/serializable-transaction mitigation in Task 5.4 would close this cleanly either way.

---

## Minor notes (not blocking)

- **"Active member" is used but not defined in either spec delta.** It's an established codebase convention (`team_memberships.removed_at IS NULL`, per `team-content-access-helper.ts`), so this isn't ambiguous to the implementation team — but a reader coming from the use cases alone wouldn't know that. A one-line cross-reference in `add-custom-topic/spec.md` would help future traceability.
- **Audit scope is 409-only, not 403.** `topic-customization-lock/spec.md`'s audit requirement is scoped explicitly to `409`/`TOPIC_CUSTOMIZATION_LOCKED` rejections; `403` identity/role rejections are not audited. This reads as intentional (design.md's Decision 8 framing is specifically about lock-bypass attempts, not all rejected writes generally), and I'm not asking for a change — just confirming out loud that I read it as deliberate scoping, not an oversight, so it isn't rediscovered as a question later.
- **`displayOrder` on a zero-active-topics team is unaddressed but currently unreachable.** Since `TOPIC-004` (remove) doesn't exist yet, no team can reach zero active topics before this change ships, so `max(active display_order) + 1` never sees a `NULL`. This becomes reachable the moment `TOPIC-004` ships against the same shared assignment logic — worth a one-line note in design.md or the eventual `TOPIC-004` design so it isn't rediscovered as a live bug once removal exists.

---

## Bottom line

Buildable as written for everything the spec deltas explicitly cover, and the two corrections the proposal claims are both real and accurately traced to source. The gap I'd most want closed before implementation starts is the "team they are facilitating" precondition language — it's a genuine, uncaught drift between the use case and the authorization model being shipped, in the same category as the two corrections already made, and it should get the same on-the-record treatment rather than being left for someone to notice mid-build. The `404` ordering and `422`-vs-`403`/`409` ordering gaps are the next priority — this codebase has a strong existing precedent (`action-item-owner-reassignment`'s explicit ordered cascade) for exactly this kind of statement, and `TOPIC-003` should match that level of explicitness before tasks.md is treated as ready to execute against.
