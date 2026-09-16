# Exploration Notes — Implement VOTE-004: Reassign Action Item Owner (#108)

**Explorer:** Devon Calloway (Internal Champion / Principal Engineer, founding advisor)
**Mode:** opsx:explore — thinking only, no code or spec deltas written here.
**Revision note:** This is a full rewrite of the original exploration pass, incorporating
Priya Nair's (Facilitator) and Marcus Delgado's (BA) reviews. Every open question from the
prior draft is resolved below into a stated decision. Where I did not adopt a reviewer's
suggestion, I've said so explicitly and why, rather than dropping it silently. This should
be readable as a finished set of notes going into `opsx:propose`, not a list of things still
to figure out.

---

## 1. What this endpoint actually is, and what it is not

`PATCH /api/v1/action-items/:actionItemId/owner` is a narrow, general-purpose reassignment
primitive. The contract is explicit that "typically used when the current owner has left
the team" is a *typical* case, not the *only* case, and #108 deliberately scopes out the
richer facilitator UX (visual "owner left" indicator, active-engineer picker) — that's #68,
which consumes this endpoint once it exists.

I want to be precise about that boundary going in, because it's exactly the kind of seam
where scope creep happens quietly: someone implementing #108 might be tempted to also bake
in "is the current owner still active" validation, since that's the scenario everyone has
in their head. The contract doesn't ask for that. It only constrains the *new* owner. I
verified this by re-reading the contract's error table line by line — nothing there
inspects the outgoing owner's status at all. That absence is a decision, not an oversight,
and #108's task list matches it ("Validate `newOwnerUserId` is an active participant member"
— no mention of validating the old owner).

**1a. Realistic triggers (Priya's Observation 1) — named here, not designed here.**
Priya is right that there are at least four distinct real-world triggers for this call, and
that they carry very different visibility expectations:

1. Owner genuinely left the team (the "typical" case, usually caught in pre-session review).
2. A quiet correction of a rushed wrap-up misassignment.
3. Load-balancing an overloaded owner's backlog, decided out loud by the team.
4. An in-room volunteer handoff.

I'm naming these explicitly so the distinction isn't lost between here and #68, but I'm not
designing for them here — this endpoint's contract (one item, one new owner, facilitator-
authorized, session-scoped) serves all four triggers equally and indifferently, because it
has no concept of "why." Whether the *product* should treat triggers 1–2 as quiet and 3–4 as
something the room should see happen is entirely a #68 UX question — it would require a
signal (a "reason" field, a broadcast, a confirmation step) that doesn't exist in this
contract and that I am not adding speculatively. **Decision: #108 ships one undifferentiated
reassignment primitive; the trigger taxonomy above is carried forward as a named requirement
for #68's design.md, not addressed here.**

**Decision (Priya's Observation 9): #108 is not "facilitators can now fix misassigned
items."** Landing this endpoint changes nothing about a live session until #68 gives a
facilitator a way to call it. The proposal should say this plainly so nobody internally
treats the backend contract shipping as the user-facing feature shipping.

## 2. Ritual-constraint read (my lens on this)

Two of the core protective constraints I care about most touch this endpoint directly:

- **No manager participation.** BRD FR-9.5 / Constraint 2: EMs are read-only, cannot vote,
  cannot own action items. The contract's 422 condition — "new owner is not an active
  `participant` member... not an EM" — is the enforcement point. If this validation is
  implemented loosely (e.g., "any team member" instead of "role = 'participant'
  specifically"), a facilitator could reassign an item to an EM, which would put a manager
  in the position of holding an accountable task in the ritual's action-item system. That's
  a crack in the no-manager wall, even though it isn't the *voting* wall. This must be
  checked precisely against `team_memberships.role = 'participant'`, not just "membership
  exists."
- **Facilitator-only privilege, session-scoped, not a role check.** The issue already
  corrected the contract's original `global_role = 'facilitator'` draft — confirmed there is
  no such value reachable in this codebase (see Section 3). Good: a global "I am a
  facilitator" flag would have been exactly the kind of structural laxity I'd have flagged
  regardless — it would grant reassignment power to anyone ever designated a facilitator,
  everywhere, forever, rather than scoping it to "actively running a session for *this*
  team right now." The session-scoped `EXISTS` check from VOTE-002 is the right shape and
  is already reviewed/shipped once; reusing it here is correct, not merely convenient.
- **"Not the facilitator themselves."** The use-case doc raises this as an open question and
  the contract resolves it with an explicit 422. Priya's Observation 6 pushed on whether this
  is actually reachable given facilitator-rotation patterns (she facilitates for three teams
  on rotation and is presumably also a participant somewhere in the org). **Decision: keep it
  as its own named, independently-tested validation, and add an explicit test case for it
  rather than treating it as defense-in-depth dead code.** Priya's point is a good reason to
  make sure this path has real test coverage, not a reason to change the check itself — it
  was already correctly scoped as "a second independent gate, not redundant" in the prior
  draft, and her rotation example is exactly the scenario that makes it reachable in practice
  for at least some org shapes. No design change; a stronger test-coverage commitment.

**Known, accepted gap (Priya's Observation 5) — eligibility, not availability.** This
endpoint validates that the new owner is a structurally eligible team member (active,
non-EM, not the calling facilitator). It does not and will not model whether that person is
actually *available* — someone on parental, medical, or sabbatical leave without a
membership change is structurally eligible today. **Decision: out of scope for #108, named
here as a known limitation.** Modeling availability is adjacent to the same family of
concerns as team-membership-removal (a membership-state question, not a reassignment-logic
question) and doesn't belong bolted onto this endpoint. A facilitator using this endpoint
needs to know "the system let me do it" means "eligible," not "definitely a good idea" — that
caveat belongs in #68's UI copy, not in this endpoint's validation.

I don't see a risk here of this being *repurposed* for something outside its intent (e.g.
some kind of bulk-reassignment or manager-initiated reassignment) — the auth model
(facilitator-only, session-scoped) and the 422 boundary (participant-only, non-EM,
non-facilitator) already foreclose the misuse cases I'd worry about. This is a *facilitator*
action performed *during a session*, which keeps it inside the ritual's existing trust
boundary (the same person who can already trigger reveals and advance topics) rather than
opening a new one. See Section 5 for the timing-gap consequence of that choice, which I'm
treating as an accepted limitation, not a defect.

## 3. Team-membership-removal blocker — resolved, not just "leaning"

I read `packages/backend/migrations/2_create_tables.sql` and the auth helpers directly.

- `team_memberships` already has `role membership_role NOT NULL DEFAULT 'participant'` and
  `removed_at timestamptz NULL` (migration 2), plus `removed_by_user_id`. `membership_role`
  enum (migration 1) is `{'participant', 'engineering_manager'}`.
- `evaluateTeamAccess` and `session-subscriber-access-helper.ts` already gate Path 1
  membership on `removed_at IS NULL` live, on every call.
- Migration 7 added a partial unique index `(user_id, team_id) WHERE removed_at IS NULL`
  specifically so a soft-removed member can be re-added — this is TEAM-006 infrastructure,
  already shipped.
- **But nothing in application code ever sets `removed_at`.** The only places it's assigned
  are test fixtures doing a raw `UPDATE team_memberships SET removed_at = NOW() ...`
  (`ws-pubsub-integration.test.ts`). There is no removal route in `packages/backend/src/
  routes/teams.ts`, and the REST contract has no "remove team member" endpoint — `TEAM-004`
  was removed from the contract on 2026-03-15 and never replaced.

So: `team_memberships.removed_at IS NULL AND role = 'participant'` is a fully expressible,
already-proven-live predicate today, requiring zero new schema and zero new runtime helpers.

**Decision, confirmed with Marcus (BA review, Section 1): not blocked for #108's scope.**
VOTE-004's validation logic never removes anyone and never needs to reason about *how* a
membership came to be removed — it only reads a current row state the schema and helpers
already support reading. `team-membership-removal` is a producer of removed memberships (a
write path); VOTE-004 is a consumer of the read predicate, which exists independent of who
sets it. Marcus's independent re-verification of this code trail concurs.

**The honest, load-bearing caveat, stated as an acceptance condition (not just a nuance):**
because nothing sets `removed_at` yet, the *typical* scenario this endpoint is named for —
reassigning away from a departed owner — cannot occur organically through any production
code path today. The endpoint's own validation and history-writing work correctly today
regardless of this gap, because reassignment has other legitimate, already-reachable uses
right now: a facilitator correcting a misassigned item, load-balancing open items, manual
correction. **Acceptance condition for proposal.md:** state both halves plainly — (a)
VOTE-004's server-side validation is fully buildable and correct today against the existing
schema, and (b) the "owner has left the team" scenario will not occur organically until a
member-removal write path exists, so manual/QA verification of the 422 "not an active
participant" path requires a raw `UPDATE team_memberships SET removed_at = ...` fixture
(matching the pattern already used in `ws-pubsub-integration.test.ts`), not an end-to-end
removal flow. This should not surprise a reviewer or QA six weeks from now.

**Two-directional dependency correction needed — a concrete follow-up edit, not just a
note.** `openspec/changes/team-membership-removal/README.md` currently contains two stale
references to this exact constraint:
- Under "Why this is deferred, not built here": *"Its own dependency on GitHub issue #23
  (open action-item reassignment authorization — `VOTE-004`'s 'new owner must be an active
  participant' constraint is not designed)."*
- Under "Scope to design when this change is picked up": *"Resolution of GitHub issue #23
  (open action-item reassignment authorization) as a prerequisite or a bundled decision."*

Both read as if VOTE-004's constraint is still undesigned and blocking. Once #108 ships,
both are false: the constraint will be designed, built, and shipped, and #23 is already
closed. **Decision: proposal.md for this change includes a task to edit
`team-membership-removal/README.md`**, removing or rewriting both bullets to a forward
pointer — e.g., "VOTE-004's active-participant validation is designed and shipped by
`reassign-action-item-owner`; this stub's remaining scope is limited to the admin/EM
removal-authorization model and mid-session removal effects." Leaving stale scope text in a
dependency stub is exactly the kind of gap that creates a false blocker for whoever picks
that change up next and assumes #108 hasn't happened. I'm not editing that file as part of
this exploration — that edit belongs to this change's own task list, tracked here so it
isn't lost between exploration and proposal.

## 4. Schema decision: `action_item_history` gets additive owner columns (Option A, decided)

Confirmed from `2_create_tables.sql:152-161` — `previous_status`/`new_status` are `NOT
NULL`, and the `action-item-status-management` spec (VOTE-002) treats this table as strictly
a status-history table: exactly one row per accepted transition, both status columns always
populated. An owner reassignment doesn't change status, so a literal reuse of the existing
columns would require writing `previous_status = new_status = <the item's current, unchanged
status>` on a reassignment row.

**Decision: Option A** — add nullable `previous_owner_id uuid NULL REFERENCES users(id)` and
`new_owner_id uuid NULL REFERENCES users(id)` to the existing table. Keep
`previous_status`/`new_status` `NOT NULL` as-is, writing both to the item's unchanged current
status on an owner-only row. One history table, one migration, `changed_by_user_id`/
`session_id`/`changed_at` all reused as-is. This is the smaller, additive diff against a
table an already-shipped, reviewed endpoint depends on, and no existing consumer (checked:
no code beyond VOTE-002's own write path and tests assumes "one row = one status
transition") is corrupted by it.

**The convention becomes an enforced invariant, not a comment.** Marcus is right that "readers
must learn a convention documented in a migration comment" is a risk description, not an
acceptance condition. **Decision: add a `CHECK` constraint enforcing symmetric nullability of
the two new columns** — `CHECK ((previous_owner_id IS NULL) = (new_owner_id IS NULL))` — in
the new migration. This is cheap, catches a malformed insert at the database boundary
regardless of which code path writes it in the future, and matches this codebase's existing
appetite for narrative, well-commented migrations (migration 7's comment block is the house
style to match).

I am **not** adding a DB-level check for "reassignment rows have `previous_status =
new_status`." That invariant is true only because VOTE-004 is, today, the single call site
that will ever write a row with non-null owner columns, and it's trivially guaranteed by that
call site's own INSERT statement. A `CHECK` comparing two enum columns for equality only when
a third condition holds is more constraint complexity than the actual corruption risk
justifies right now, since a violation would require a *future* endpoint to intentionally
write mismatched rows — which is exactly the case the next paragraph's application-level rule
covers. **Decision: this is an explicit application-level invariant, stated as a SHALL in
design.md and the new capability's spec**, not a DB constraint: *"A row where
`previous_owner_id` and `new_owner_id` are both non-null is a reassignment-only row and its
`previous_status`/`new_status` values SHALL be equal by construction. VOTE-004 SHALL NOT be
extended to also change status in the same write without a corresponding schema/spec
update."*

**Concrete cross-reference task (not left as "the new capability's own spec should say
it").** `action-item-status-management/spec.md`'s "every real status transition" requirement
currently reads as if it governs the full lifecycle of a row in this table. **Decision: add
one sentence directly to that requirement** (not only to this change's own spec) —
*"This requirement governs status-change rows only (`previous_status ≠ new_status`, or a
same-status no-op); owner-reassignment rows written by `VOTE-004` are a distinct requirement
of the `reassign-action-item-owner` capability and are not a status transition."* This is a
task for tasks.md against an existing, already-archived spec file, not a suggestion left to
whichever spec happens to get written first.

**`ACTION-002`/OQ-8 — decided: leave open, explicitly, as a separate follow-up.** Marcus
surfaced a real adjacent gap I hadn't raised: `ACTION-002` (wrap-up owner edits) already
writes no `action_item_history` row at all, flagged as OQ-8 in the contract ("BA to
confirm"). Once VOTE-004 ships, the table will contain owner-history rows for reassignments
made after wrap-up but not for owner edits made during wrap-up — an inconsistency in what
"the item's owner history" means depending on which endpoint touched it.

**Decision: #108 does not close OQ-8.** Closing it would mean changing `ACTION-002`'s write
path — a different endpoint, a different code path, and a different issue than the one #108
was filed to resolve. Extending this change's scope to also backfill history-writing for
wrap-up edits is exactly the kind of quiet scope creep I flagged as a risk in Section 1: it's
adjacent, it's tempting because the schema will now exist to support it, and it is not what
#108 asks for. **What #108 does do:** design.md gets one sentence stating that `ACTION-002`'s
wrap-up owner edits remain unrecorded per the still-open OQ-8, that this is a pre-existing,
separate decision this change does not resolve, and that OQ-8 should be revisited (by
Marcus) once this change's owner-column shape exists, since the eventual answer can reuse
these same columns instead of inventing new ones. That's a pointer forward, not a fix now.

## 5. Authorization implementation shape (reusing VOTE-002, `action-items.ts`)

The reusable shape for VOTE-004:

```
ACTIVELY_FACILITATING_STATUSES = ["lobby", "pre_session", "active", "wrap_up"]

EXISTS (SELECT 1 FROM sessions
        WHERE facilitator_id = $1 AND team_id = $2 AND status = ANY(ACTIVELY_FACILITATING_STATUSES))
```

This constant is currently private to `action-items.ts`. **Decision: VOTE-004 lands in the
same file** (`action-items.ts` already frames itself as the action-item write-path home, and
VOTE-002's constant/helpers are file-local for a reason — one file, one authorization story,
matching VOTE-002's own structure). No export needed.

Because VOTE-004 has no owner-authorization path at all (only a facilitator may call this
endpoint, full stop), the branching is simpler than VOTE-002's owner-or-facilitator fork.

**Accepted limitation (Priya's Observation 2) — the session-scoped timing gap is real and is
not being fixed here.** Because authorization requires an active session for the team, a
facilitator who notices a stale assignment between sessions — from the trend dashboard, from
memory, from a Slack message — cannot correct it until they next have a live session running
for that team. That is a genuine constraint on when this endpoint is usable, and I'm stating
it plainly rather than letting it be discovered later: **this endpoint's authorization model
inherits VOTE-002's existing trust boundary exactly (D10's `ACTIVELY_FACILITATING_STATUSES`
gate) — it is not a new problem VOTE-004 introduces, it is the same accepted precedent
applied consistently to a sibling endpoint.** I'm deliberately not widening the trust
boundary to admit an out-of-session correction path as part of this change. Doing so would
mean VOTE-004 and VOTE-002 diverge on when a facilitator may act, which is a worse outcome
than the inconvenience Priya describes — and if the product wants an off-session correction
capability, that's a distinct authorization-model proposal that should revisit both
endpoints together, not something bolted onto VOTE-004 alone as a side effect of building a
new route. **This is where I'm pushing back on scope: the fix Priya's observation implies
(an off-session correction path) is out of scope for #108, on purpose.**

## 6. Enumeration safety: 404-vs-403 boundary — decided, adopt D12

VOTE-002's Decision D12 (reviewed, shipped) establishes a deliberately broader "relationship"
check before the narrow authorization check, specifically so a 404-vs-403 boundary doesn't
leak whether an `actionItemId` exists to a caller with zero standing on its team. The URL
carries no `teamId`, exactly like VOTE-004's URL. VOTE-004's own contract error table, by
contrast, states `403` directly for "Not a facilitator" with no relationship-based 404
boundary at all — reading like the contract was drafted before D12's pattern existed in the
codebase (plausible: the contract predates VOTE-002's actual implementation and review).

**Decision: apply D12's pattern directly, not the contract's flatter table.** A caller with
zero relationship to the item's team gets 404; 403 is reserved for someone who has some
relationship (team member, or has ever facilitated a session for it) but isn't a currently-
authorized active facilitator. This isn't a new judgment call — it's applying an
already-litigated precedent to a URL shape structurally identical to VOTE-002's, for the same
enumeration-safety reason D12 was adopted in the first place.

**Concrete task, not a design.md footnote (Marcus's point, agreed):** this needs its own
scenario pair with independent test coverage, mirroring
`action-item-status-management/spec.md`'s existing pair — "A caller with no relationship to
the item's team cannot distinguish it from a nonexistent item" / "A caller with some
relationship... is rejected with 403." A sentence in design.md saying "apply D12" is not the
same as spec'd, testable scenarios; tasks.md gets an explicit task to write both.

## 7. Error-code reconciliation: resolved items — decided, 409, contract needs a correction note

The contract's error table lists **403** for both "Not a facilitator" and "resolved action
items cannot be reassigned" — two semantically different failures (authorization vs. state
precondition) collapsed into one status code. This conflicts with the precedent VOTE-002
explicitly litigated: "Resolved is terminal... a 409, unhedged" (Open Question 3 in
`action-item-status-management/spec.md`, a deliberate, discussed resolution, not an
assumption).

**Decision: 409 for the resolved-item case**, matching the established convention. There's
no stated reason in the contract, the use-case doc, or the original issue for VOTE-004 to
depart from VOTE-002's precedent, and the contract's flat 403 grouping reads as an artifact of
how the table happened to be drafted, not a deliberate design choice.

**The contract itself gets corrected in place, not just this change's design.md.** This
codebase already has a house style for this exact situation — the `global_role =
'facilitator'` correction on this very issue, the `session-lifecycle-transitions` correction
under `SESSION-005` ("Corrected by `session-lifecycle-transitions` (2026-09-08): this entry
previously stated..."), and Appendix D's `websocket-specification` correction are all
one-paragraph "corrected by `<change-name>`" notes added directly under the affected
section, not silent edits and not corrections that live only in a downstream change's
design.md. **Decision: tasks.md includes a task to add a "Corrected by
`reassign-action-item-owner`" note directly under VOTE-004's section in `REST API
Contract.md`**, in that same style, stating the 403→409 correction for the resolved-item
case. This document is what engineers grep for `VOTE-004` against; if the correction only
lives in this change's own design.md, the contract stays wrong at its source indefinitely.

## 8. New-owner and `sessionId` validation — full decided mapping

**8a. `newOwnerUserId` mapping (404 vs 422), four cases, unchanged from the original read:**

1. `newOwnerUserId` doesn't exist in `users` at all → `404`.
2. `newOwnerUserId` exists as a user but has no row at all in `team_memberships` for this
   team → `404` ("membership does not exist").
3. `newOwnerUserId` has a `team_memberships` row for this team, but it's soft-removed
   (`removed_at IS NOT NULL`) or `role = 'engineering_manager'` → `422`.
4. `newOwnerUserId === the calling facilitator's own user id` → `422`, independent of 1–3.

This mirrors the same distinction TEAM-006's partial-unique-index comment draws between
"never a member" and "soft-removed member" — consistent with how membership state is already
reasoned about elsewhere in this codebase. Marcus correctly flagged that calling this
mapping "exhaustive" (as the original draft did) was premature — it only ever considered
`newOwnerUserId`. The following two subsections close that gap.

**8b. `sessionId` validation — decided: reuse VOTE-002's Decision D11 directly, no
divergence.** `sessionId` is optional in the request body. If present, it is validated
independently of the owner/authorization checks: `SELECT status FROM sessions WHERE id =
$1 AND team_id = $2`, and rejected with `422` ("sessionId does not reference a session in an
active state for this team") unless a row is found with `status` in
`ACTIVELY_FACILITATING_STATUSES`. This is the exact D11 pattern, reused, not re-derived. The
contract text should also be corrected to drop the vague "Current session context, for
history attribution" phrasing in favor of VOTE-002's own qualifier style (something like
"Session context. If provided, must reference a session in an active state for this team.").

Priya's Observation 8 asks a fair question: since the endpoint's own authorization already
requires the facilitator to have exactly one qualifying active session for the team, why
should `sessionId` ever need to come from the client instead of being derived from that same
lookup? **Decision: I'm not adopting server-side derivation, and I'm saying why rather than
quietly declining it.** VOTE-002 faced this identical tension and made the same choice —
optional, client-supplied, independently validated — and nothing about VOTE-004's shape gives
me a reason to diverge from it. Deriving it server-side would require VOTE-004 to assume
"exactly one qualifying session per team can exist at a time," which is not a guarantee
either endpoint's authorization query currently enforces or that I've verified holds at the
database level (no uniqueness constraint on `sessions` limits concurrently-active sessions
per team). Re-litigating that assumption, for both endpoints, to enable derivation is a
bigger authorization-model question than #108 was filed to answer, and it would leave VOTE-002
and VOTE-004 with two different session-attribution models if I only fixed it here. **This is
scope I'm declining, on purpose, in favor of consistency with an already-shipped sibling
endpoint** — the mild redundancy of an optional, validated client field is a smaller cost
than that divergence.

**8c. `newOwnerUserId === current owner` — decided: 200, no-op, mirroring VOTE-002's
same-status precedent.** `action-item-status-management/spec.md` already establishes the
house pattern for this exact shape of request: a same-status update is accepted as a no-op
that bumps `action_items.updated_at` and resets the staleness clock, but writes no
`action_item_history` row, no `audit_log` row, and triggers no broadcast, "since no state
observable to another participant has changed." **Decision: reassigning an item to its
current owner follows the identical pattern** — `200 OK`, `updated_at` bumped, no history row,
no audit row. This is a deliberate consistency choice: an owner-reassignment no-op and a
status no-op are the same shape of request (an update to a value that doesn't change
anything observable), and treating them differently for no stated reason would be an
inconsistency a future reader would have to puzzle out.

**8d. Check ordering — decided, full sequence, matching VOTE-002's exact pattern:**

1. Load the action item by ID alone → `404` if it doesn't exist (D12).
2. Relationship check (owner / any `evaluateTeamAccess` grant / ever facilitated) → `404` if
   the caller has zero relationship to the item's team, indistinguishable from case 1 (D12).
3. `sessionId` validation, if provided → `422` if it doesn't resolve to an actively-
   facilitating session for this team (D11, Section 8b).
4. Facilitator authorization (active session for this team, this facilitator) → `403` if the
   caller has some relationship (from step 2) but isn't a currently-authorized facilitator.
5. Resolved-item precondition → `409` if the item's current status is `resolved` (Section 7).
6. `newOwnerUserId` validation cascade, in this order: self-facilitator check (422, cheap
   equality check, no DB round-trip — checked first) → user-exists (404) → membership-exists
   (404) → active-participant-non-EM (422).
7. Same-owner-no-op determination (Section 8c) → `200` no-op if `newOwnerUserId` equals the
   current `owner_id`; otherwise proceed to the full write (owner update, `updated_at` bump,
   `action_item_history` insert, `audit_log` insert, all in one transaction).

**This directly answers the "resolved item + invalid new owner" ordering question: the
resolved-item `409` wins**, because it's a state-precondition check positioned before any
target-value validation — the exact same position VOTE-002's resolved-terminal check occupies
relative to its own body-content validation (`resolutionNote` length). A caller who both
targets a resolved item and supplies a bad new owner gets told the item is resolved, not that
their new owner is invalid; fixing the new owner wouldn't have helped them anyway.

## 9. WebSocket broadcast and staleness clock

**No broadcast — confirmed, unchanged.** `action_item_status_updated`'s payload is scoped
strictly to `previousStatus`/`newStatus`, and even VOTE-002's own non-status fields are
deliberately excluded from it. No event named or shaped for an owner change exists anywhere
in the codebase or the corrected `websocket-specification` catalog, and Appendix D's
broadcast-exclusion table doesn't list VOTE-004 at all. **Decision: no broadcast for VOTE-004,
stated as confirmed, not tentative**, in one sentence in design.md.

**Staleness clock — decided: reassignment updates `action_items.updated_at`.** Priya's
Observation 7 is a real gap in the original draft, and it's squarely #108's to answer, not
#68's — it's a question about what this endpoint writes to the database, not about UI. If a
reassignment does not touch `updated_at`, an item that's been sitting untouched for three
sessions and gets reassigned to a brand-new owner shows up already red on that owner's first
session holding it, for no fault of their own. **Decision: VOTE-004's write updates
`action_items.updated_at` to the current time on every accepted reassignment (both the no-op
case per 8c, and the real-reassignment case)**, for the same reason VOTE-002's same-status
no-op does: the new owner's staleness clock should start clean when the recorded fact of
ownership changes. This is a deliberate, stated behavior, not an incidental side effect of
whatever query happens to run.

**Deferred to #68, explicitly named, not silently dropped:** whether the room *sees* a
reassignment happen live during a session — i.e., whether the confirmed "no broadcast" fact
above is acceptable for the in-room-volunteer or load-balancing triggers (Section 1a's
triggers 3–4) where the team decided together, out loud, and then the screen doesn't reflect
it until next page load. The underlying technical fact is decided (no broadcast, full stop);
whether that's product-acceptable for those trigger cases is a #68 UX judgment against
`websocket-specification`, not something VOTE-004 should half-build now by speculatively
adding an event nobody has designed a consumer for.

## 10. Response shape and naming — no surprises

`ReassignActionItemResponse { actionItemId, ownerUserId, ownerDisplayName, updatedAt }` maps
directly onto the `ownerUserId`/`ownerDisplayName` naming already established in
`StartSessionResponse.actionItems[]` and the `fetchPreSessionActionItems` query in
`facilitator-sessions.ts` (`JOIN users u ON u.id = ai.owner_id`). Straightforward reuse of an
existing join pattern.

## 11. Audit trail

`action_item.status_changed` (VOTE-002's audit event) is the direct precedent —
`emitAuditEvent` structured-log counterpart plus an in-transaction `audit_log` row, same
shape (`actor_user_id`, `actor_global_role`, `actor_ip`, `operation`, `team_id`, `metadata`
JSON). **Decision:** VOTE-004 gets its own operation name, `action_item.owner_reassigned`,
added to `AuditEventName` in `packages/backend/src/auth/audit-logger.ts`, with metadata
carrying at minimum `action_item_id`, `previous_owner_id`, `new_owner_id`, `session_id`. Per
Section 8c, the no-op path (reassigning to the current owner) writes no `audit_log` row,
matching VOTE-002's no-op precedent exactly. Mechanical, not a design question.

## 12. Out of scope for #108, deferred to #68 — named explicitly, not dropped

Priya's review is almost entirely UI/UX territory that #108, as a backend contract change,
correctly does not address. Listing these here so the proposal phase carries them forward
instead of losing them between exploration and #68's eventual kickoff:

- **The trigger taxonomy and live-vs-quiet distinction** (Section 1a) — naming which of the
  four realistic triggers a reassignment UI should treat as visible-to-the-room versus quiet.
- **Batch/multi-item reassignment** (Priya's Observation 10) — when an owner leaves with
  several open items, redoing a one-item picker flow N times live in front of the team is
  real friction. Nothing about this endpoint's single-item contract blocks #68 from calling
  it N times, but #68 should not be designed as "one item, one modal, repeated N times" by
  default without considering a batch flow. Not #108's endpoint to change.
- **"Who sees what" during a live session** (Priya's Observation 3) — the technical fact (no
  broadcast) is decided in Section 9; whether that's acceptable UX for each trigger case is
  #68's call.
- **Generic-vs-specific error presentation in the UI** (Priya's Observation 4) — #108 already
  does the substantive work here by decision: distinct codes for distinct facts (403
  auth-failure, 409 resolved-state-conflict, 404/422 split on the new-owner target, per
  Sections 6–8). What's genuinely #68's job is the copy and presentation shown to a
  facilitator mid-session — that's a UI design question this endpoint's contract already
  gives the data to answer well.

I want to be explicit that none of the above changes #108's shape. They're carried forward as
named, not-forgotten requirements for whoever picks up #68, not silently dropped because they
didn't fit this issue.

## 13. Accepted limitations — named plainly, not fixed here

- **Session-scoped authorization creates a between-sessions timing gap** (Section 5,
  Priya's Observation 2): a facilitator cannot use this endpoint outside an actively-
  facilitating session for the team, even for an administrative correction noticed between
  sessions. This matches VOTE-002's existing D10 precedent exactly — it is not a new trust
  boundary VOTE-004 introduces, and I'm declining to widen it as part of this change (see
  Section 5 for why: doing so would diverge VOTE-002 and VOTE-004's authorization models,
  which is a worse outcome than the timing inconvenience).
- **This endpoint validates eligibility, not availability** (Section 2): a new owner who is
  structurally an active, non-EM participant but is actually on leave will be accepted. Not
  modeled here; adjacent to `team-membership-removal`'s territory if it's ever addressed.

## 14. Decisions carried into proposal — the checklist

| # | Item | Decision |
|---|---|---|
| 1 | team-membership-removal blocker | Not blocked for #108. Task: fix stale README bullets (Section 3). Acceptance condition: test fixture via raw `UPDATE ... SET removed_at`, not e2e removal flow. |
| 2 | `action_item_history` schema | Option A, additive nullable owner columns. `CHECK` constraint for symmetric nullability. Status-pair equality is an application-level invariant, stated as a SHALL. Cross-reference sentence added to `action-item-status-management/spec.md`. |
| 3 | `ACTION-002`/OQ-8 | Left open, explicitly scoped out. One sentence in design.md; revisit by Marcus after this ships. |
| 4 | 404-vs-403 enumeration | Adopt D12 directly. Spec'd scenario pair with independent test coverage, mirrored from `action-item-status-management/spec.md`. |
| 5 | 403-vs-409 resolved items | 409. Contract correction note added under VOTE-004 in `REST API Contract.md`, matching the `session-lifecycle-transitions`/Appendix D precedent. |
| 6 | `sessionId` validation | Reuse D11 exactly: optional, client-supplied, validated against the item's team + `ACTIVELY_FACILITATING_STATUSES`. Server-side derivation declined — would diverge from VOTE-002's model. |
| 7 | `newOwnerUserId === current owner` | 200, no-op, mirrors VOTE-002's same-status no-op: `updated_at` bumped, no history/audit row. |
| 8 | Check ordering | Item load → relationship (404) → sessionId (422) → authorization (403) → resolved-item (409) → new-owner cascade (422/404) → no-op determination (200) → write. Resolved-item 409 beats new-owner validation when both fail. |
| 9 | Staleness clock | Reassignment (both no-op and real) updates `action_items.updated_at`. |
| 10 | WebSocket broadcast | Confirmed: none for VOTE-004. |
| 11 | Facilitator-rotation reachability of "not the facilitator themselves" | No design change; add explicit test coverage per Priya's Observation 6. |
| 12 | Trigger taxonomy, batch reassignment, live-visibility UX, error-copy UI | Out of scope for #108, named forward to #68 (Section 12). |
| 13 | Session-scoped timing gap | Accepted limitation, matches VOTE-002 precedent, not widened here (Section 13). |

## 15. Readiness assessment

This is implementable now, and it's a firmer readiness call than my first pass. The
authorization pattern is proven and reviewed (VOTE-002). The "active participant member"
predicate needs zero new schema. The `action_item_history` schema gap has a decided answer
(Option A, plus a constraint and a cross-reference edit, not just a documented convention).
Both contract/precedent conflicts (Sections 6, 7) have decided resolutions with concrete
follow-up tasks (scenario pairs, a contract correction note) rather than "flag for design.md."
The `sessionId` and same-owner-reassignment gaps Marcus found are closed. The check-ordering
question is answered end to end. The WebSocket question is closed. The staleness-clock gap
Priya found is closed with a stated, deliberate behavior.

What's left for design.md and tasks.md is documentation, not judgment calls: writing the
scenario pairs, adding the migration and its constraint, adding the two-sentence spec/contract
cross-references, and fixing the stale dependency-stub bullets. None of it requires another
round of "what should we do here" — that's exactly the state I want to hand off to
`opsx:propose`.

Nothing here threatens the ritual constraints I care about most — if anything, this endpoint
is a good example of "the tool encoding intent so a team that's never talked to me can use it
correctly": a facilitator reassigning an item can't accidentally hand it to an EM, can't hand
it to themselves, can't touch a resolved item, and won't accidentally flag the new owner as
already behind — all enforced server-side without needing me to explain any of it to them.
