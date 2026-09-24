# Facilitator review — exploration notes, issue #164

Reviewed by Priya Nair (Facilitator persona). Grounded this in the actual copy/markup
in `DraftSessionHost.tsx` and `SessionLobbyPage.tsx`, not just the exploration notes'
description of them, because the *feel* of a transition lives in the copy and layout,
not the routing logic.

## Overall take

The diagnosis is right and I don't want it litigated again — every session created
today is structurally stuck in `lobby` forever, and that's a "the ritual is fully
broken," not a "nice-to-have page is unreachable." I'd rather see this shipped than
polished. But the exploration notes park the facilitator-experience questions in
section 6 as "design stage, not resolved here," and I think one of them — control
surface fragmentation — is load-bearing enough that it should shape the *direction*
of the fix, not just get answered later. That's my main pushback below.

## 1. The two-page split is a real seam, not a hypothetical one

I pulled the actual rendered copy for both surfaces at the `lobby` state:

- `DraftSessionHost` (`live-readiness-view`): heading is the **team name**. Body text
  is `"The room is open. Session status: lobby."` — no session heading, no mention of
  who's waiting, just a join link.
- `SessionLobbyPage` (`session-lobby-waiting`): heading is **"Session Lobby"**. Body
  text is `"Session {sessionId} — waiting for the facilitator to start."` — different
  voice, different framing, exposes the raw session ID to the reader.

These are not two views of the same moment that happen to have different styling —
they're two different products describing the same state in different language. The
plan (section 5) has me landing on `DraftSessionHost` for the normal path, but treats
`SessionLobbyPage`'s facilitator Start Session button as "defensive/secondary,
reachable if a facilitator ever lands there directly (an old bookmark, a shared link,
a refresh)."

Concretely: I share my own join link in Slack constantly — to remind myself of it, to
paste it into a calendar invite, to send it to someone who missed it the first time.
If I click my own link while the room is open but not started, under the proposed
join-link rule change I land on `SessionLobbyPage`, not `DraftSessionHost` — because
that rule doesn't distinguish "facilitator following their own link" from "engineer
following it." I'd see a page that doesn't look like the one I've been running the
room from, with a second, differently-labeled Start Session button. If I'd forgotten
whether I'd already started the session, I now have two different screens potentially
telling me two different things, and no way to tell from either one whether it's the
"primary" or "secondary" surface — they don't say that to me, they just look like two
different apps.

**This isn't a defensive fallback from where I sit — it's a path I will hit in normal
use**, not just via an old bookmark. I'd ask the design stage to either (a) make the
join-link rule facilitator-aware so my own link always lands me on
`DraftSessionHost`, or (b) make the two lobby-state views visually and textually
consistent enough that landing on either one doesn't feel like a different tool.

## 2. What happens between "Open the room" and "Start Session" needs its own beat

Right now `DraftSessionHost`'s `draft` view says "Review the details below before
opening the room," I click **Open the room**, and I land on a view that says "The
room is open." — full stop. Then, per this change, a **Start Session** button
appears.

Two sequential facilitator-only buttons with similar verbs (Open the room → Start
Session) and no explanation of what each one does or why they're separate steps is
exactly the kind of thing that makes a first session harder than it needs to be — and
first-session friction is the thing I most want this application to absorb, not add
to. A new facilitator seeing "Open the room" then immediately "Start Session" with no
copy differentiating them is going to ask "didn't I just do that?" I'd want at least a
line of copy under Start Session — something like "Everyone with the join link can see
the room. Start Session begins the pre-session review for everyone in it." — so the
two-step gate reads as intentional pacing, not redundant clicks.

## 3. I have zero visibility into who's in the room before I start

This is the lobby-phase analog of my biggest in-session ask (readiness without
spoilers). During voting I want to know who's locked in without seeing votes; during
the lobby I want to know **whether anyone has joined at all** before I commit to
Start Session. Right now `live-readiness-view` shows me a join link and nothing else
— no participant count, no "N people have joined." If I hit Start Session and nobody's
actually in the room yet, I find out only when I get to the topic screen and it's
empty, which is a worse moment to discover that than right now, at the button.

I understand this may be genuinely out of scope for a routing-gap fix — I'm not
asking for a presence system to be built into this change. But I want it named
explicitly as a follow-up rather than silently absorbed into "the control exists now,
good enough," because right now the exploration notes don't mention it at all.

## 4. The pre_session review location is the fragmentation question, sharpened

Section 6's first open question — does `DraftSessionHost` render the `pre_session`
action-item review itself, or does the facilitator get sent to `SessionLobbyPage` for
that phase — is downstream of the same concern as #1 above, and I want to be blunt
about it: if the answer is "facilitator does Start Session on `DraftSessionHost`, then
gets redirected to `SessionLobbyPage` to review action items, then presumably comes
back to `DraftSessionHost` (or somewhere else) for the vote," that is three different
screens for one uninterrupted ritual phase, each with its own visual language. That
is precisely "the facilitator view gets built as a participant view with extra
buttons" risk from the other direction — instead of the facilitator's view being
under-built, the ritual gets scattered across surfaces that were each built for a
different audience and never unified.

My preference, for what it's worth on a question the notes correctly say isn't mine to
resolve: keep the facilitator's path entirely on `DraftSessionHost` end to end —
Start Session, action-item review, into the session — and let `SessionLobbyPage`
be purely the engineer/participant surface plus a defensive fallback for a facilitator
who lands there by accident. Splitting facilitator flow across two components because
the authorization models happen to differ is an implementation-convenience reason, not
a facilitator-experience reason.

## 5. What an engineer sees on a fresh join-link click during `lobby` is thin but not wrong

`"Session {sessionId} — waiting for the facilitator to start."` is honest and doesn't
overclaim, which I'd rather have than something that pretends to be more alive than it
is. Two small asks, not blockers:

- Exposing the raw `sessionId` in the sentence reads as a debug artifact, not
  facilitator-authored copy. I'd drop it or replace it with the team/topic name if
  available.
- No indication of *how long* to expect to wait, or that this is normal. First-time
  engineers hitting a static "waiting" sentence with no context could reasonably
  wonder if the link is broken. Even a passive line like "The facilitator will start
  the session shortly" reassures without adding any facilitator-visible control.

Neither of these blocks the fix; both are copy-only and cheap to pick up whenever
someone's touching this text.

## 6. No ritual-integrity concerns from the reveal/outlier/pacing side

Confirmed independently: this change is entirely pre-vote plumbing. It doesn't touch
reveal simultaneity, outlier flagging, or in-session pacing controls. Nothing here
changes who can advance a topic or when votes become visible. I have no concerns on
that front — flagging it only so it's on record that I checked, not assumed.

## Questions for the design stage (adding to section 6's list)

1. Should the join-link redirect rule be facilitator-aware (send the facilitator's own
   link to `DraftSessionHost`, not `SessionLobbyPage`), or is unifying the two lobby
   views' copy/layout the cheaper way to close that gap?
2. Can Start Session get one line of explanatory copy distinguishing it from Open the
   room, so a first-time facilitator isn't left guessing why there are two buttons?
3. Is a lightweight "N people have joined" (or even just "at least one person has
   joined") signal on `DraftSessionHost` in scope for this change, or logged as a
   named follow-up? I'd take "named follow-up" over silence.
4. Does the facilitator's `pre_session` review stay on `DraftSessionHost`, or move to
   `SessionLobbyPage`? I'm registering a preference for staying on `DraftSessionHost`
   end-to-end (see #4 above) but defer to the team on the engineering cost of that.
5. Minor: can the engineer-facing waiting copy on `SessionLobbyPage` drop the raw
   session ID and add a reassurance line? Not blocking.

## Bottom line

Fix the navigation gap — full agreement with the exploration notes there, this is not
optional and shouldn't wait on the questions above. But I'd treat the two-lobby-view
seam (item 1) as something the design stage actively resolves, not something that
rides along as an accepted side effect of "the facilitator normally won't go there."
I will hit that path in ordinary use, not edge-case use, and I'd like to usability-test
the facilitator side of this once there's something clickable, per my standing offer.
