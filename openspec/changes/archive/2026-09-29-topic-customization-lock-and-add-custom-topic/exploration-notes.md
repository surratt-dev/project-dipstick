# Exploration Notes: Topic Customization Lock + Add Custom Topic (#49 + #50)

**Mode:** opsx:explore — thinking, not implementing. No code, no proposal.md, no tasks.md.
**Author (persona):** Devon Calloway, Internal Champion / SME, reviewing before this becomes a real proposal.
**Revision:** Updated in response to `explore-review-facilitator.md` (Priya Nair) and `explore-review-ba.md` (Marcus Delgado). Three items I left open are now settled, with citations — I'm adopting them, not re-litigating them. The Facilitator's gaps are folded in below as explicit follow-up items for the proposal. Nothing in either review asked for anything that softens a protective constraint, so there's nothing here to push back on — my job this pass is mostly to close questions I raised myself and make sure the things Priya will actually experience don't get lost between the contract debate and the proposal.
**Bundle rationale (accepted as given):** #49 has nothing to lock standalone; #50 is the first topic-write endpoint that ever needs the lock enforced against it. Landing them together is correct — a lock with nothing to protect is a promise, not a mechanism.

---

## 1. What this bundle is actually protecting

The BRD frames the default topic set as "the shared language of the ritual" (BRD 6.4) — cross-team comparability depends on every team's *first* session running against the same twelve questions, unmodified. The lock isn't a permissions nicety; it's what makes the first session's data usable as a baseline. If a facilitator (or an admin, or a bug) can slip a topic edit in before that first `complete` session lands, the team's baseline is already contaminated the moment it's created, and there's no way to reconstruct what the "clean" first session would have shown.

This is the same category of concern as the no-manager rule and the facilitator-from-another-team rule, even though it's not one of the four named constraints in my persona doc: it's a structural guarantee, not a preference, and it must not degrade into something a caller can route around by hitting the API directly instead of the UI. The use case's own alternate flow says this explicitly — "Facilitator bypasses the UI and submits a topic modification request directly (e.g., via API)" is a *named* alternate flow, not a hypothetical. Issue #48's implementation already committed to this by making the lock a derived state rather than a column (see `openspec/specs/default-topic-provisioning/spec.md`'s closing requirement: "no column or record anywhere in the schema is set to represent 'this team's topics are locked' as a stored value"). #49's whole job is to make that derived check real, server-side, and impossible to bypass by any client behavior.

---

## 2. The good news: most of the shape is already decided

`requirements/design/REST API Contract.md` already has a fully fleshed-out **Group 3: Topic Management** section — `TOPIC-001` through `TOPIC-007` — with request/response shapes, status codes, and authorization rules, and `requirements/design/REST API Contract - Validation Report.md` shows it was reviewed and marked "Covered" against FR-8.1–FR-8.6. This is not a stub. Whoever writes the actual proposal should treat this contract as the starting point, not reinvent the shape from the use case prose alone. Specifically relevant to this bundle:

- **`TOPIC-001` (`GET /teams/:teamId/topics`, already shipped)** — the contract's version of this response includes `isCustomizationLocked: boolean` at the top level, computed as `COUNT(*) FROM sessions WHERE team_id = :teamId AND status = 'complete'` returning 0. **This is no longer an open question — Marcus checked the live handler directly (`content.ts:491`) and confirmed the field is not there.** `return noStore(reply).send({ teamId, topics: result.rows });` returns no lock flag at all. This is now a required line item for the proposal's task list, not something to research further: **the proposal must add `isCustomizationLocked` to the shipped `GET /teams/:teamId/topics` response as part of this bundle.** Without it, the "Enforce Lock" use case's read-side AC (locked view shows a calm, expected explanation) has no field to key off of, and — per Priya's review below — the read side is where a facilitator actually meets this feature almost all of the time, not the write-rejection path.
- **`TOPIC-003` (`POST /teams/:teamId/topics`)** — this is #50's endpoint. Request body: `name` (≤100 chars), `prompt` (≤500 chars), `voteType`, optional `firstSessionDescription`. Response: `201` with the created topic including assigned `displayOrder = max(current) + 1`.
- **`TEAM-003` (`GET /teams/:teamId`)** — also carries `topicCustomizationLocked`, independently computed the same way. Two response shapes computing the same derived fact is exactly the kind of drift risk the "reusable check" instruction in this task is trying to head off — there should be **one** function/query both endpoints call (see Section 6, now stated as a hard requirement rather than a preference).

---

## 3. The `name` field — settled: this is a gap in the use case, and the corrected AC is below

I flagged a real mismatch last pass: the "Add Custom Topic" use case describes a three-field form (prompt, vote type, description), but the schema and the already-reviewed `TOPIC-003` contract both require a fourth, independently-required field: `name`, distinct from `prompt`. I declined to resolve this myself and asked whoever owns the use case document to rule.

**Marcus (BA) ruled on this directly, and I'm adopting the ruling as settled, not reopening it.** His review confirms this is a defect in the use case document itself — not a design choice available to the implementation team — because the schema, the already-validated contract, and the sibling "Assign Default Topic Set" use case (which already treats every default topic's short label as distinct from its full prompt) all assume the field exists. Deriving `name` server-side (my Option B) would silently override a contract clause that was already reviewed and marked "Covered" against FR-8.1–FR-8.6 with no dissent — that's not a lighter-touch alternative, it's reopening a review that already closed. Option A — the use case is incomplete, and the proposal states the corrected AC directly — requires no reopening of anything.

**Corrected AC for "Add Custom Topic" (to carry into the proposal's spec delta verbatim):**
- `name`: required, non-empty after trim, ≤100 characters — short label, distinct from `prompt`.
- `prompt`: required, non-empty after trim, ≤500 characters — full question text.
- `voteType`: required, one of `finger` / `roman` / `modified_roman`.
- `firstSessionDescription`: optional, ≤500 characters.
- Validation error is `422` and identifies which field(s) failed, not a generic "invalid request."

Marcus is handling the correction to the source use case document himself, separately from this change — that's a `requirements/`-directory correction, not implementation scope. The proposal just needs to state the corrected field list as its own AC and cite the correction, the same pattern `restrict-team-005-em-promotion` used for closing an unaddressed scope rather than reversing a decision.

---

## 4. The authorization model — settled: Philosophy 1, standing facilitator

I raised a tension last pass between two live authorization patterns in this codebase and didn't pick a winner myself, because picking the broader one without saying so out loud looked, to me, like exactly the kind of quiet scope-creep I'm supposed to catch.

**Marcus checked both source documents directly and settled this — I'm adopting his ruling, not re-opening the debate.** The REST API Contract's Group 3 clause (`global_role = 'facilitator'` AND non-member AND `isCustomizationLocked = false` — "Philosophy 1" in my framing) has never been revised since the 2026-03-08 draft, is marked "Covered" against FR-8.2 with no caveat, and — critically — Marcus went and read `action-item-owner-reassignment`'s actual spec text (not just my paraphrase of it) to check whether its narrower, session-scoped pattern ("Philosophy 2") was written as a general successor doctrine or a locally-scoped decision. It's explicitly the latter: that spec frames its choice as reusing `VOTE-002`'s pattern *because it's the same resource family* (action items, tied to a live session's wrap-up flow), not as a rule for all future facilitator-write endpoints. Generalizing it to topics — a resource the use cases explicitly require to be manageable *between* sessions — would have created exactly the conflict I flagged with the "usable between sessions" requirement.

**Adopted for both #49 and #50: Philosophy 1** — `global_role = 'facilitator'` AND the caller is not a member of the team AND `isCustomizationLocked` is `false` (for writes) — applies to the lock check in #49 and the write endpoint in #50. This resolves cleanly against the `session-creation` precedent I already cited (org-wide facilitator latitude, by design, because facilitators rotate across teams specifically to satisfy the facilitator-from-another-team rule) and does not conflict with anything Philosophy 2 was actually meant to solve.

The traceability note Marcus drafted belongs in the proposal's design.md **verbatim**, so this doesn't get rediscovered as an open fork later:

> "Authorization for TOPIC-003 follows the pre-existing, unrevised REST API Contract clause for Group 3 endpoints. The narrower session-scoped model introduced by `action-item-owner-reassignment` was a locally-justified reuse decision for the action-item resource family and was never generalized in that change's spec or design.md; it does not apply here, and adopting it would conflict with the 'usable between sessions' requirement in 'View Active Topic Configuration.'"

One note in my own voice, since this is the item closest to the category of thing I watch for: this doesn't touch the no-performance-comparison constraint or the no-manager rule — it's about which facilitator accounts can configure a team's topic list, not about exposing any participant's session data. The breadth I was wary of is real (any facilitator, anywhere, can touch any unlocked team's config) but it's the *documented, stable, already-reviewed* answer, not a new erosion — and it was never in tension with a rule I actually consider load-bearing. I'm satisfied. What I want preserved is the paper trail, not a different outcome.

Unchanged from before, and still correct regardless of which philosophy applies: authorization must be evaluated **before** the lock precondition. A caller with no relationship to the team gets the same non-authorization response an unauthorized caller would get regardless of whether the team happens to be locked — lock state should never leak through the error shape to a caller who was never going to be allowed to act on this team in the first place.

---

## 5. Status code for the lock rejection — settled: 409, not 403

I flagged two live, disagreeing precedents last pass and declined to pick, since the contract's literal text and the newer codebase convention pointed in different directions.

**Marcus ruled 409 Conflict, and I'm treating this as settled — a correction to the contract's literal text, not a fresh debate.** His reasoning: the lock's status-code framing was never separately reviewed as its own line item in the Validation Report the way the authorization clause was, so unlike Section 4 this genuinely was an open gap, not a stable documented answer — and his ruling closes it. The lock is a derived state fact about the team's session history, not an identity/role fact about the caller, which matches this codebase's established, repeated pattern (`action-item-owner-reassignment`'s resolved-item guard, `session-topic-lifecycle`'s `already_revealed`/`advance_blocked`) for distinguishing "you may not do this" (403) from "this isn't eligible right now" (409).

**Adopted AC:**
- A write request (`TOPIC-003` now; `004`–`007` later, out of scope here but built against the same gate) against a team with `isCustomizationLocked = true`, from an otherwise-authorized facilitator, is rejected with **`409 Conflict`**.
- **`403 Forbidden` is reserved for identity/role failures** (wrong global role, or facilitator is a team member) — evaluated and returned *before* the lock check is ever reached, so lock state never leaks to an unauthorized caller (consistent with Section 4's ordering rule).
- This is a deviation from the contract's literal `403`-for-everything text and should be written up as an explicit Decision in the proposal's design.md, with a corresponding correction to the contract document itself — parallel to how `restrict-team-005-em-promotion` corrected `TEAM-005`'s source text rather than leaving the implementation silently diverge from it.

---

## 6. The rejection response needs to say more than a status code — folding in Priya's review

Priya's review is right that Section 5 (above) resolves the *wrapper* around the rejection without resolving the thing that actually matters for a future frontend: **the response body's shape.** `TOPIC-003`'s current contract folds three unrelated causes — not a facilitator, facilitator is a team member, lock is active — into one generic error with no distinguishing field. A bare status code (403 or 409) can't drive the "clear, plain-language explanation" the use case's AC promises; a frontend can't turn a number into three different sentences.

**Adopted for the proposal:**
- The rejection body must carry a **machine-readable reason** distinct from the HTTP status — e.g. a `code` field such as `NOT_A_FACILITATOR` / `FACILITATOR_IS_TEAM_MEMBER` / `TOPIC_CUSTOMIZATION_LOCKED` — so a future frontend can render the correct one of three explanations without guessing from a bare 403/409 or making a second round-trip.
- Alongside the code, a **plain-language message string**. For the lock case specifically, this string should be treated as a **stable, literal contract value** — not placeholder prose — because issue #55's eventual frontend will consume it verbatim rather than writing its own copy. Marcus's suggested literal string is a reasonable anchor: `"Topics cannot be customized until this team's first session is completed."` The exact wording is a proposal-stage decision, but the *contract* — that it's a fixed string keyed off server-known state, not hardcoded frontend copy that can drift from the actual rule — should be settled now, in this bundle, since #55 will build against whatever precedent this bundle sets.
- What the message should additionally explain (the *why*, not just the *that* — e.g. tying the restriction to baseline integrity rather than reading as an arbitrary permissions wall) is real feedback and worth preserving, but it's copy work that belongs to whoever writes #55, once there's a UI to render it in. This bundle's job is to make sure the field exists and is driven by server state, not to write the final sentence.

This is the one area where I'd push back gently on how the write-up frames priority: Priya is right that the **read side** — the calm "not yet, here's why" view a facilitator gets when navigating to a new team's topic page — is where this feature is actually experienced almost all the time, precisely because a correctly-built frontend hides the write controls when locked. The write-rejection path is defense-in-depth (stale tab, cache lag, a UI bug, direct API access), which matters for integrity but isn't the common case. Section 2's fix (adding `isCustomizationLocked` to `TOPIC-001`'s response) is therefore at least as important as anything in this section, and the proposal shouldn't let the more debatable status-code/error-body questions crowd out that one-line, already-confirmed gap.

---

## 7. Where the code goes

- **Schema:** no migration needed for #50's core write path. `topics` already has every column `TOPIC-003` needs (`name`, `prompt`, `vote_type`, `display_order`, `status`, `is_default`, `first_session_description`). Confirmed against `packages/backend/migrations/2_create_tables.sql` directly. This is a pure insert-and-check change, not a schema change — worth stating plainly in the proposal since "first-ever write endpoint for a resource" might otherwise make someone assume a migration is coming. (See Section 9 for one schema question I'm explicitly *not* resolving now.)
- **Route file:** `content.ts` currently owns only the read side (`GET /teams/:teamId/topics`). `action-items.ts` is this codebase's existing pattern for "one file, both reads and writes, for one resource." I'd lean toward a new `topics.ts` route file rather than growing `content.ts` with a write endpoint whose name implies read-only content delivery, but this is a judgment call for whoever owns file organization, not a ritual-integrity question.
- **Lock-check helper — now a hard requirement, not a preference.** Both reviewers converged on this independently (Marcus: "one function, two callers, no drift," stated as a MUST; Priya: implicitly, by pointing out that the read-side flag and the write-side gate must tell the same truth or a facilitator will see one thing and be told another). **Adopted as a hard requirement for the proposal's spec delta:** there MUST be a single, named, reusable function backing both (a) the `isCustomizationLocked` value returned by `TOPIC-001`/`TEAM-003`, and (b) the precondition check in `TOPIC-003`'s write gate. It MUST NOT be duplicated inline in each handler, and MUST NOT exist as two independent `COUNT(*) FROM sessions WHERE status = 'complete'` queries that can quietly diverge (e.g., one includes `abandoned` incorrectly, one doesn't, six months from now). The specific function name/file location (something like `hasCompletedFirstSession(teamId)`, parallel to `team-content-access-helper.ts`) is an implementation judgment call, not something that needs to be blessed here.
- **No row-locking needed.** Unlike the reveal race in `session-topic-lifecycle` (a genuine concurrent-write correctness problem needing `SELECT ... FOR UPDATE`), the lock check here only gates a read-then-decide, and the thing being raced against — a session's completion — is itself a one-way, already-guarded transition elsewhere. A plain, uncached, live `EXISTS`/`COUNT` read on every call is sufficient, matching the "MUST execute a live database read on every call... MUST NOT be cached at any layer" principle `team-content-access`'s spec already establishes for the analogous authorization helper.

---

## 8. Audit logging — now an explicit AC, with ordering

Every recent comparable write endpoint in this codebase audits both the successful write and the blocked attempt: `session-creation`'s spec requires a synchronous `audit_log` row for every rejection on the cross-team membership constraint. A rejected topic-write due to the customization lock is the same shape of event — a blocked privileged-boundary attempt on the exact thing this feature exists to prevent from ever succeeding silently.

Priya's review adds a good reframe I want to carry forward: this isn't only a security/integrity record, it's part of the same continuity story as session history and trend data. A facilitator returning to a team after months away, or handing off to another facilitator, benefits from being able to see that someone tried (and was correctly blocked) before the lock lifted — same category of value as session history, even if surfacing it in a UI is out of scope for this bundle.

**Adopted AC (stated explicitly, not left as prose):**
- Every request rejected under the customization lock (`409`) SHALL write a synchronous `audit_log` row (`operation = 'topic.write_denied_locked'` or equivalent) **before the response is sent to the caller.** This ordering is not incidental — it matches `TEAM-005`'s promotion-block audit precedent and should be copied verbatim into this proposal's requirement, not re-derived from scratch.

---

## 9. Follow-up items for the proposal — flagged, not resolved here

Priya's review surfaced three things that are real gaps but don't need to be solved in this exploration. I'm listing them explicitly, the same way Section 10 (below) confirms the concurrency wave-off, so none of them get silently dropped or rediscovered later as a surprise.

1. **`TEAM-002` (`GET /teams/facilitatable`) doesn't expose lock state.** Priya rotates across multiple teams and lands on this list view first; today it returns `lastSessionDate: string | null` per team but not `isCustomizationLocked`. `lastSessionDate === null` is a workable inference for "definitely locked," but it's an inference the frontend has to make, not a fact the API states — and it doesn't distinguish "locked" from "no session ever scheduled" as cleanly as an explicit flag would. **The proposal needs to decide, and state on the record, whether `TEAM-002` also gets the flag or whether the null-inference is the intentional shortcut.** I don't have a strong pull either way — it's not a ritual-integrity question, just a completeness one — but it shouldn't be left for someone to notice by accident once a facilitator-team-list UI actually gets built.

2. **Whether a custom topic should carry a "who added this" attribution is an open question, not a decision, and it has schema implications.** The `topics` table has no `created_by`/`added_facilitator_id` column, and `TOPIC-003`'s response doesn't return one. Under Philosophy 1 (Section 4), a facilitator who has never run a session for a team can still add a topic to its configuration — which makes "who added this and when" a real continuity gap for a facilitator returning after an absence or a handoff, since `created_at` only answers "when." I want this named explicitly rather than silently absent, the way Section 10 names the concurrency wave-off — but I'm **not** ruling on it here. It's cheaper to add the column now, at write-endpoint-creation time, than to retrofit it once historical rows already lack it, so the proposal's design.md should carry this forward as an explicit open question with that cost asymmetry noted, for whoever scopes the actual change to weigh against the bundle's size. To be clear about what this is *not*: it's attribution for a facilitator's configuration action, not participant-level session data — it doesn't touch the no-individual-performance-comparison constraint, so there's no ritual-integrity reason to avoid it, only a scope-size judgment call.

3. **The explanation message's content (the "why," not just the "that")** — Priya's point that "you can't do this yet" lands very differently from "you can't do this yet, because the first session needs to run against the untouched defaults" — is good UX guidance but is copy work for #55, once a frontend exists to render it. Section 6 already covers the contract-level requirement (a stable, server-driven string exists at all); the actual sentence is out of scope for this bundle.

---

## 10. Concurrency edge the use case explicitly waves off — fine to leave waved off

"First session completes while the Facilitator is viewing the locked screen" is explicitly marked nice-to-have, not required, in the use case's own Alternate Flows ("real-time unlock is a nice-to-have, not a requirement"). No WebSocket event needs to be added for this bundle. Worth a one-line confirmation in the proposal that this is intentionally out of scope, so nobody re-derives it as a gap later — matching how `action-item-owner-reassignment` explicitly names "no broadcast is published" as a confirmed, deliberate absence rather than leaving it silently unaddressed.

---

## 11. What's settled vs. what the proposal still needs to decide

**Settled, adopted, not to be re-opened:**
1. `name` is a required field on Add Custom Topic (≤100 chars, distinct from `prompt`) — corrects a gap in the use case's own AC (Section 3).
2. Authorization for both #49's lock check and #50's write endpoint is Philosophy 1 — standing facilitator (`global_role='facilitator'` + non-member + lock check) — per the unrevised, still-binding contract clause (Section 4).
3. Lock rejection is `409 Conflict`, not `403` — a stated correction to the contract's literal text, consistent with this codebase's state-precondition-vs-identity-failure precedent (Section 5).
4. `isCustomizationLocked` must be added to the already-shipped `GET /teams/:teamId/topics` response — confirmed missing at `content.ts:491`, required line item, not a research question (Section 2).
5. One reusable lock-check function backs both the read-side flag and the write-side gate — hard requirement (Section 7).
6. Lock-rejection attempts are audited, logged before the response is sent (Section 8).
7. The rejection body carries a machine-readable reason code distinct from the status code, plus a stable, server-driven message string for the lock case (Section 6).
8. The concurrency edge (real-time unlock) is confirmed, intentionally, out of scope (Section 10).

**Still open, explicitly handed to the proposal, not to be resolved in this exploration:**
1. Whether `TEAM-002` should also expose `isCustomizationLocked`, or whether the `lastSessionDate === null` inference is the accepted shortcut (Section 9.1).
2. Whether custom topics should carry an attribution column (who added it) — open question with schema-cost implications, for design.md to weigh, not a ritual-integrity call (Section 9.2).
3. The literal wording of the lock explanation's "why" — copy work for #55, once a frontend exists (Section 9.3).

None of the settled items or the remaining open questions touch the no-manager rule, the simultaneous reveal, the facilitator-from-another-team requirement, or the no-individual-performance-comparison guardrail — the four things I'd actually block a proposal over. This bundle sits in the space between sessions, protecting the integrity of a team's baseline data, and both reviews sharpened that protection without asking for anything that makes it optional. Good reviews, both — the proposal can be written from here.
