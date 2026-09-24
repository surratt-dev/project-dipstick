# Tasks Review — Solution Architect (Ingrid Sollenberger)

Scope of this pass: tasks.md as it stands after the post-design-review revision (helper return type carries parsed body; Decision 2's single page-level `reauthRequired` gate, task 3.0, with 3.1–3.4 rewritten to write into it). This is a dependency/ordering and internal-consistency check, not a re-review of the design decisions themselves — those are Ingrid's, already settled, and out of scope here.

I read tasks.md, design.md, and proposal.md, then verified the ordering claims below against the actual code rather than taking the documents' inventory on faith: `packages/frontend/src/App.tsx` (route table), `packages/frontend/src/pages/DraftSessionHost.tsx`, and `packages/frontend/src/components/MemberManagement.tsx`.

## Bottom line

Task ordering respects every real architectural dependency I checked. Section 1 (shared helper) precedes every section that consumes it. Section 2 (allow-list) precedes the two sections whose routes actually need a new entry, and — I verified this against the route table rather than assuming it — the one section that doesn't need a new entry (SessionLobbyPage.tsx) is correctly not gated on section 2 at all. Task 3.0 (the gate) precedes 3.1–3.4 (the writers into it), which is the one place a genuine build-order dependency exists inside a single page. Section 6 doesn't skip a step the other call-site sections have. One structural observation (not a defect) and one suggestion for making an implicit dependency explicit, below.

---

## Ordering checks performed

**1. Shared helper (§1) before its six consumers (§3–§6).** Confirmed. Every wiring task in §3–§6 (3.1–3.4, 4.1–4.2, 5.1–5.2, 6.1) either names the helper directly or depends on its `{ isSessionExpired, body }` return shape for deriving a non-session-expiry error message. No consumer task appears before §1, and none of §3–§6's task text assumes a helper contract that predates the post-design-review fix (all references match "the helper's returned `body`," not a bare boolean) — the fix was threaded through completely, not just declared once at the top.

**2. Allow-list additions (§2) before the sections whose routes need them — verified against `App.tsx`, not assumed.** `RETURN_TO_ALLOW_LIST` gets two new entries: `/team/:teamId/session/:sessionId` (2.1) and `/sessions/new` (2.2). I checked which page actually mounts at which route:

| Page | Route (`App.tsx`) | Needs a new allow-list entry? |
|---|---|---|
| `DraftSessionHost.tsx` | `/team/:teamId/session/:sessionId` (line 124) | Yes — 2.1 |
| `SessionCreationPage.tsx` | `/sessions/new` (line 104) | Yes — 2.2 |
| `SessionLobbyPage.tsx` | `/session/:sessionId` (line 138) | No — pre-existing `/session/:id` entry already covers it |
| `MemberManagement.tsx` | mounts inside `/team/:teamId` (line 89) | No — pre-existing `/team/:id` entry already covers it, and task 6.2 says so explicitly |

§2 precedes §4 and §5 in document order, which is the correct build order given the design's stated deploy sequence (backend allow-list, then frontend consumers). §3 and §6 correctly have no dependency on §2 — and tasks.md doesn't claim one for them, which is the right call, not an oversight (6.2 states it outright for MemberManagement; §3 doesn't need an equivalent line because none of 3.1–3.4 touches `returnTo`'s allow-list shape at all — the page's own route was already covered before this change existed).

**3. Task 3.0 (the gate) before 3.1–3.4 (the writers).** Confirmed, and this is the one place in this tasks.md where a literal build-order dependency exists within a single section (three of the four signal sources — 3.1, 3.2/3.3, 3.4 — all call `setReauthRequired` on a piece of state that doesn't exist until 3.0 creates it). It's ordered correctly: 3.0 is listed first, and 3.5 (the structural test that the gate is the *only* render site) is correctly sequenced after all four writers exist to test against, not before.

**4. §6 (MemberManagement.tsx) doesn't skip a step present in the other call-site sections.** Checked point by point against §4/§5's shape:
- Body-parsing fix (design's Finding-1-adjacent concern about a second unguarded `.json()` read): present in 6.1, stated explicitly, including the callback to why it matters ("today's version throws on a non-JSON body").
- `returnTo` computation: present, folded into 6.1 rather than broken out as its own subtask the way 4.3/5.3 are. That's a structural difference, not a gap — see note below.
- Allow-list dependency: correctly declared not applicable (6.2), and I confirmed that's true against `App.tsx`.
- Own test tasks, including the named-limitation test that locks in the two-step-confirm-doesn't-survive-reauth behavior as correct-as-is: present (6.3, 6.4), mirroring 4.5/4.6's shape one-for-one.

The one item present in §4 (task 4.7 — mock review of the banner over the confirm-dialog layout) that §6 has no analog for is not a skipped step. I checked why: `DraftSessionHost.tsx`'s `openTheRoom()` sets `advanceState.phase = "submitting"` *before* the fetch fires, which already hides the "Yes, open the room"/"Cancel" pair (gated on `phase === "confirming"`) by the time any response — including a 401 — comes back. `MemberManagement.tsx`'s `submitRoleChange` does the same thing (moves `roleChangeState` off `"awaiting_confirmation"` before awaiting the response), so the per-row "Confirm change"/"Cancel" dialog (gated on `isAwaitingConfirm`) is also already gone by the time the treatment would render. Design.md's Decision 6 concern — the banner's CTA needing to be visually unmistakable from the confirm dialog's own buttons — is about the two rendering into the exact same layout slot in immediate visual succession on a single-purpose page under stated time pressure ("people are already waiting to join"); `MemberManagement.tsx`'s roleChangeState error/treatment renders at a fixed top-level location (line ~237 today), not inside the per-row dialog's slot, and there's no equivalent "someone is waiting on the other end of this click" framing in proposal.md or design.md for a role change. I don't think §6 needs a 4.7-equivalent task. I'd still put one sentence in design.md or tasks.md stating this conclusion outright (Ingrid's own standing concern: implicit decisions — including implicit *non*-decisions — are the ones that cause problems later, and right now "why doesn't §6 need a visual-collision check" is answered only by reading the actual state-transition code, not by anything written down).

---

## Two smaller observations (neither blocking)

**`returnTo` computation is placed inconsistently across sections — stylistic, not a defect.** §3 states `returnTo` inline in each call site's own task (3.1, 3.4: "returnTo = current path and query"). §4 and §5 instead factor it into its own trailing subtask (4.3, 5.3) covering both call sites in that section. §6 folds it back into the single wiring task (6.1), which is the right call for a section with only one call site — no inconsistency there. The §3-vs-§4/§5 difference is cosmetic (nothing in 4.1/4.2 or 5.1/5.2 as literally written contradicts 4.3/5.3 arriving after), but since this document is the thing an implementer works through top-to-bottom, I'd make the placement consistent — either state it per-call-site everywhere, or factor it out everywhere — so a fresh reader doesn't wonder whether 4.3 appearing after 4.1/4.2 means `returnTo` was deliberately left out of the first two tasks' scope.

**The §2→§4/§5 dependency is real but only stated in design.md's Migration Plan, not in tasks.md itself.** Document order happens to get this right (§2 before §4 and §5), so there's no actual build-order risk as tasks.md stands today. But the *reason* §4 and §5 need §2 to land first — the backend-then-frontend deploy sequence design.md's Migration Plan states — isn't referenced anywhere in §4 or §5's own task text; it's only recoverable by cross-referencing design.md. This is exactly the kind of dependency I'd want made explicit rather than working correctly by virtue of document order alone: a one-line note on 4.1 and 5.1 ("requires 2.1"/"requires 2.2" respectively) would make the dependency self-evident from tasks.md alone, without needing design.md open alongside it.

---

## What I didn't re-check

The design decisions themselves (helper contract, the gate's shape, the `role` proxies, the allow-list regex shapes) — those are settled, and BA review (`tasks-review-ba.md`) already did a thorough call-site-coverage and traceability pass I have no reason to duplicate. This review is additive to that one: theirs confirms every capability has a task; this one confirms the tasks are buildable in the order they're written.
