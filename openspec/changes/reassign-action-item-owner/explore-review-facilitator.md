# Facilitator Review — Exploration Notes for VOTE-004 (Reassign Action Item Owner, #108)

**Reviewer:** Priya Nair (Facilitator, subject matter expert)
**Reviewing:** `exploration-notes.md` (Devon Calloway)
**Lens:** Does this reflect how reassignment actually comes up in a live session? Will the
error handling and constraints make sense to a facilitator in the moment, or only to the
engineer reading the code? Does this move the tool toward disappearing into the background,
or does it add a new thing I have to think about mid-session?

I want to say up front: the auth and schema reasoning here is careful, and I don't have
opinions about `team_memberships` predicates or history-table columns — that's not my lane.
What I can tell you is where the *shape* of this endpoint will land as friction or confusion
for whoever is standing in front of a team when this gets used. Right now the notes read like
a pure backend contract exercise. I didn't find a single sentence in here about what a
facilitator is doing, thinking, or seeing in the room at the moment they'd reach for this.
That's the gap I'm flagging most strongly.

---

## Observations

1. **The notes never ask "when does this actually happen?"** — and that matters more than any
   of the error-code questions. Section 1 correctly scopes this as a general-purpose primitive,
   not just the "owner left" case, but then the exploration goes straight into auth/schema
   without ever asking me (or anyone playing my role) when in a session's arc a facilitator
   would reach for this. In practice I can think of at least four distinct triggers, and they
   have *very* different flow implications:
   - Owner genuinely left the team (the "typical" case) — usually noticed during the
     pre-session review, before voting starts.
   - An item was misassigned during a rushed wrap-up and needs a quiet correction.
   - Someone is overloaded (three open items, silent every session) and the team decides,
     out loud, to redistribute.
   - Someone explicitly volunteers to take an item from someone else, right there in the room.
   The first two are corrections I'd want to make *without* narrating them to the group. The
   last two are social moments that the room should probably see happen. The exploration
   treats these as one undifferentiated "reassignment," but they have opposite requirements
   for visibility. This should be named explicitly in design.md, even if the answer is "out of
   scope for #108" — right now it's just absent.

2. **This can only be invoked while I have an active session running, but the moment I'd
   actually notice the problem is often *not* while I have a session running.** Section 5
   reuses the `ACTIVELY_FACILITATING_STATUSES` check (`lobby`/`pre_session`/`active`/`wrap_up`).
   That means: if I'm prepping for next week's session and notice — from the trend dashboard,
   from a Slack message, from memory — that an item is sitting with someone who left the team
   two months ago, I cannot fix that until I next have a live session for that team. I either
   sit on a known-wrong assignment, or I spin up a session early just to make one administrative
   correction. That's the opposite of "absorbs cognitive load" — it's a new thing I now have to
   remember to do at a specific, narrow window instead of whenever I notice it. I'd want this
   confirmed as an intentional trust-boundary decision (keeping this inside the same privilege
   window as reveal/topic-advance, per Section 2) rather than an accident of reusing the
   VOTE-002 shape because it was convenient.

3. **No broadcast means a live reassignment is invisible to the room, which cuts against the
   "shared reveal" instinct this whole product is built around.** Section 8 confirms — correctly,
   I assume, on the technical merits — that no WebSocket event exists or is planned for an owner
   change. But nobody asked the follow-up question: if this is meant to be usable *during* a
   session (and the auth model says it is, since it requires an active session), and a
   participant is looking at the wrap-up screen or the pre-session review screen when I make the
   change, do they see it update live, or does it silently go stale until their next page load?
   If the answer is "they don't see it until next load," that's fine for the quiet-correction
   case (#1 above) but actively bad for the social/collaborative case (#1's third and fourth
   triggers) — the room asked for a reassignment out loud and then the screen doesn't reflect it.
   I don't need this fixed in #108. I need it *asked* in design.md so #68 doesn't inherit a silent
   gap nobody flagged on purpose.

4. **The 403/404/422/409 question isn't just an internal consistency problem — it's a "what do I
   tell the team" problem.** Sections 5, 6, and 7 are right that the contract's error table is
   sloppy, and I trust the engineering judgment on which HTTP status is "correct." But from where
   I sit, the actual risk isn't that the codes are wrong — it's that whoever builds #68's UI will
   only be as good as the distinctions the API gives them. If "you're not the facilitator" and
   "this item is already resolved" both come back as undifferentiated 403s (current contract, per
   Section 6), the UI I eventually get can only show one generic error, and I will not be able to
   tell — in the middle of a session, with people waiting — whether I clicked the wrong control or
   whether the item is simply done and I misread its status. That's exactly the kind of moment
   where the tool stops disappearing and starts requiring me to debug it in front of my team. I
   want the review to land firmly on: distinct codes for distinct facts (auth failure vs. state
   conflict vs. bad target), specifically *because* a facilitator needs a specific, human-readable
   reason on screen, not because the codes should be semantically pure for their own sake.

5. **"Active participant member, not EM, not the facilitator themselves" mostly matches how teams
   actually work — with one real-world case I want on the record.** People go on leave (parental,
   medical, sabbatical) without their team membership ever being touched — they're still an
   active, non-removed `participant`. If the constraint is purely "not removed, not EM, not the
   caller" (Section 7's mapping), then I could reassign an item *to* someone who's on leave and
   the system would happily accept it, which is a real footgun: nothing here checks "is this
   person actually available to pick this up," only "is this person structurally eligible." I'm
   not asking for the system to model leave status — that's out of scope and probably belongs to
   the same family of concerns as the team-membership-removal stub. I just want it named as a
   known gap: this endpoint validates *eligibility*, not *availability*, and a facilitator using
   it needs to know that so I don't treat "the system let me do it" as "this is definitely a good
   idea."

6. **The "not the facilitator themselves" rule is described as almost unreachable in practice
   (Section 2, "a facilitator is normally from a different team… and so wouldn't usually be a
   valid team member at all"), and I want that assumption checked against how rotation actually
   works, not just asserted.** I facilitate for three teams on a rotating basis. I am also,
   presumably, a regular contributor on my own team somewhere in this org's model. If facilitator
   assignment is ever looser than "always a different team, no exceptions" — e.g., a smaller org
   where someone occasionally facilitates their own team's session, or a rotation where today's
   facilitator swaps in from a team they're also nominally a participant on — this 422 becomes the
   one thing standing between "an accidental self-assignment" and "a manager-style conflict of
   interest inside the ritual." I'd rather this be confirmed as a real, independently-necessary
   gate (which is how the notes ultimately land — "second independent gate, not redundant" —
   good) than have it slip back to "we don't need to check this, it can't happen" in a future
   simplification pass.

7. **Missing: does reassignment reset the staleness clock, and is that fair to the new owner?**
   The pre-session review screen (already shipped) computes staleness purely from sessions
   elapsed since `action_items.updated_at`. Nothing in the exploration notes says whether a
   reassignment touches `updated_at`. If it doesn't, an item that's been sitting untouched for
   three sessions and gets reassigned to a brand-new owner will show up **already red** on that
   new owner's very first session holding it. That is exactly the kind of thing that undermines
   trust in the tool — the new owner did nothing wrong and gets flagged immediately, and I have to
   explain to the room, live, "no, ignore the red, they just got this." If it *does* reset
   `updated_at`, that should be stated as a deliberate behavior, not an incidental side effect of
   whatever query happens to run. Either way, this needs an explicit answer in design.md — right
   now it's simply not addressed.

8. **`sessionId` being optional in the request body is a continuity risk, not just a schema
   detail.** One of the things I rely on most is being able to pick up a team I haven't
   facilitated in months and reconstruct what happened and why, from history alone, without a
   handoff conversation. If `sessionId` can be omitted on a reassignment call, some fraction of
   reassignment history rows will have no session context — which, months later, looks like "the
   owner changed, for no stated reason, at some unknown point." Given that the endpoint's own auth
   already requires me to have a live, identifiable active session to call it at all (Section 5's
   `EXISTS` check knows exactly which session), I don't understand why the session ID would ever
   need to come from the client instead of being derived from the same lookup that already proved
   I'm allowed to be here. I'd like this asked explicitly rather than left as "optional, for
   history attribution" — optional fields on an audit-relevant record are exactly where continuity
   quietly breaks.

9. **This ships as a backend contract with nowhere for a facilitator to use it — that's fine for
   #108, but I want it said out loud that it isn't done from my perspective until #68 exists.**
   The scoping is clean and I don't object to splitting it this way. But I want the proposal to
   say plainly that VOTE-004 landing does not change anything about a real session yet, so nobody
   internally treats "#108 shipped" as "facilitators can now fix misassigned items" — they can't,
   until there's a UI. This is a documentation-hygiene point, not a design objection.

10. **One-at-a-time reassignment will be a real friction point the day someone actually leaves a
    team with multiple open items.** Not a blocker for this endpoint's contract, but worth
    flagging now so #68 doesn't get designed as "one item, one modal, repeated N times" by
    default. If someone leaves with four open items, redoing the same picker flow four times in a
    row, live, in front of the team, is exactly the kind of "spreadsheet-like" busywork I'm hoping
    this tool spares me from. I'd rather this be named as a known future UX requirement than
    discovered after #68 ships single-item-only.

## Questions

- When, concretely, is a facilitator expected to use this — mid-session, in front of the team, or
  as a between-session administrative correction? The auth model assumes the former is at least
  possible (session must be active); the "typical" framing in the contract description suggests
  the latter. Which is it, or is it genuinely both, and if so, shouldn't they behave differently
  (visible vs. quiet)?
- If I notice a misassignment with no session currently running for that team, what am I supposed
  to do — wait, or start a session early? Has anyone actually asked a facilitator this?
- Does a reassignment update `action_items.updated_at`, and therefore reset the staleness clock
  the new owner is judged by?
- Why is `sessionId` optional on the request body when the endpoint's authorization already
  requires the caller to have exactly one qualifying active session for the team? What legitimate
  case calls this endpoint with a valid facilitator session and *no* determinable session context?
- Is "not the facilitator themselves" ever actually reachable given how facilitator assignment
  works today, or is it purely defense-in-depth? I'd like a real answer, not an assumption, before
  it's treated as a corner nobody needs to test.
- Will other session participants — specifically the outgoing and incoming owner — see the
  reassignment happen live if it occurs during an active session, or only on next page load? If
  the latter, is that acceptable for the "team decided together, out loud" trigger case?

## Suggested additions to design.md

- A short section naming the realistic triggers for this endpoint (owner departed, misassignment
  correction, load-balancing, in-room volunteer handoff) and stating explicitly which of these
  #108 is meant to serve well versus merely permit.
- An explicit statement of whether reassignment is expected to happen "live and visible" or "quiet
  and asynchronous," even if the answer for #108 is "either, no distinction is made" — that should
  be a stated decision, not a silent omission.
- An explicit answer on `updated_at`/staleness-clock behavior on reassignment, so the new owner
  doesn't inherit someone else's stale flag on day one.
- A one-line justification (or removal) of `sessionId` as an optional, client-supplied field given
  that the authorization check already resolves the active session server-side.
- A note, for #68's future scope, that batch/multi-item reassignment (departed-owner-with-several-
  open-items) is a known follow-on need, so it isn't designed away by a single-item-only
  first pass.
- Confirmation (from Marcus or whoever owns facilitator-assignment rules) of whether "new owner is
  the facilitator themselves" is a reachable case today, recorded either way so the test suite and
  future readers know if it's defense-in-depth or a real path.
