# Exploration Notes — Join Link Display & Copy (Issue #45)

**Explored by:** Devon Calloway (Internal Champion / SME persona)
**Canonical use case:** "Copy Session Join Link," `requirements/use cases/02 - Session Setup - Use Cases.md`
**Related specs read:** `openspec/specs/join-link/spec.md`, `openspec/specs/session-creation/spec.md`

---

## 0. First correction to the brief

The task brief describes `SessionLobbyPage.tsx` as "a 65-line stub with only a static waiting message." That's stale. As of this session it's a 367-line component with real branching logic (loading / error / no-access / left / lobby / pre_session), a WebSocket subscription to `session_state_change`, reauth handling, a Start Session action, a begin-voting flow, and an access-model disclosure statement shared with the team page. None of that logic displays a join link or a copy control today — that gap is real — but whoever implements this needs to know they're integrating into an already-dense component, not filling in a blank page. I'm noting this here so the proposal stage doesn't scope estimate off the stale description.

More importantly, grounding this in the actual codebase surfaced something the brief didn't anticipate at all, and it changes what "add it to SessionLobbyPage" even means. That's the bulk of these notes.

---

## 1. The central finding: which page is "the session room"?

The use case's precondition is "The Facilitator is viewing the session room." I went looking for where a Facilitator actually *is* while a session sits in "waiting for participants" (`lobby`) status, and traced the real navigation graph rather than assuming it matches the component names.

```
Facilitator creates session (existing team)
  SessionCreationPage.confirmCreate()
        │
        ▼
  navigate(`/team/:teamId/session/:sessionId`)  ──────►  DraftSessionHost
                                                           (route: /team/:teamId/session/:sessionId)
                                                                 │
                                                    status=draft │ status=lobby (or later)
                                                        ┌────────┴────────┐
                                                        ▼                 ▼
                                              draft-control-view   live-readiness-view
                                              • join link SHOWN    • join link ABSENT
                                                (plain text,       • no copy button
                                                 "not yet            currently just:
                                                 joinable" badge)    "The room is open.
                                              • no copy button       Session status: X."
                                                        │
                                              "Open the room" (task 7.5:
                                              "update in place, no
                                              navigation" — deliberate,
                                              from session-creation-
                                              existing-team design.md)
```

`SessionLobbyPage` lives at a *different* route: `/session/:sessionId`. I grepped the whole frontend for anything that navigates there:

```
grep -rn '"/session/\|`/session/\|navigate(.*session' packages/frontend/src
```

Nothing does — not `SessionCreationPage`, not `DraftSessionHost`, not `TeamPage`. The only things that reference `/session/:sessionId` are the route registration itself and its `/live` / `/facilitator` sub-routes (separate WS-staleness-signal host surfaces, explicitly marked non-feature-complete in `App.tsx`'s own comments).

I then checked the *other* way a user could land there — the join-link's own "session-aware landing" rule (`openspec/specs/join-link/spec.md`, "Session-aware join link landing"):

> If an active session exists for the team (status `active`)... redirected to `/session/:sessionId`. If no active session exists... `/team/:teamId`.

"Active" here means live-voting-or-later, not `lobby`. So an Engineer who follows the join link *while the session is still "waiting for participants"* is sent to `/team/:teamId` — `TeamPage`, which I confirmed (`grep -n session -i TeamPage.tsx`) has zero session-awareness. It shows team membership, nothing about a live or pending session.

**Net effect:** during the entire "waiting for participants" window — the exact window this use case is about — nobody, facilitator or engineer, is routed to `SessionLobbyPage` by any path that exists in the app today. Its `lobby` branch (the one with the Start Session button and the waiting message) is real, tested code that no live navigation currently reaches.

The Facilitator's actual "session room" during this window, in the real app, is `DraftSessionHost`'s `live-readiness-view` branch — and that branch currently has no join link at all, even though the data is already available to it.

I confirmed the data is there: `FacilitatorSessionStateResponse` (`packages/shared/src/types/team-content-access.ts:226`) carries `joinToken` unconditionally, and the backend's `GET .../facilitator-state` handler (`packages/backend/src/routes/facilitator-sessions.ts:1995`) returns it regardless of session status. `DraftSessionHost` already destructures `data.joinToken` for the draft branch (line 184) — the lobby branch just never reads it.

### Why this matters more than it might look like

This is exactly the failure mode Devon has seen before and warns about in his own success criteria: a team completing sessions doesn't mean the ritual is actually working the way it's supposed to. If this change ships a well-built join-link-and-copy-button component inside `SessionLobbyPage` and stops there, it will pass every test written against that component in isolation, and it will still be **functionally invisible** to a Facilitator running a real session today — because they never land on that page. That's worse than an honest gap, because it *looks* done. A team he's never spoken to, trying to self-serve this feature from the UI alone, would never find it.

### Decision — settled during review (BA ruling, verified against spec)

Marcus Delgado (BA review) checked this against `openspec/specs/join-link/spec.md`'s "Session-aware join link landing" requirement directly: the redirect to `/session/:sessionId` fires only when session status is `active`; `lobby` is explicitly excluded from that rule. Combined with the grep evidence above (nothing navigates to `/session/:sessionId` during `lobby`), this confirms a real contradiction between the "Copy Session Join Link" use case's precondition ("the Facilitator is viewing the session room") and the actual app — not just an implementation-scoping question.

**Ruling (Marcus, BA):** "the session room" means the Facilitator's actual live control surface during `lobby` status, which is `DraftSessionHost`'s `live-readiness-view` branch — not `SessionLobbyPage`, which merely shares a name with the concept. This settles the (a)/(b) question below as **(b)**.

**Settled scope:**
- This change targets `DraftSessionHost`'s `live-readiness-view` branch only. `SessionLobbyPage` is explicitly out of scope — not touched by this change.
- The `SessionLobbyPage` routing gap is filed as a separate follow-up: **[#164](https://github.com/surratt-dev/project-dipstick/issues/164)** ("SessionLobbyPage's lobby branch is unreachable dead code (routing gap)"). `design.md` should reference this issue number directly, not "see exploration notes."
- `proposal.md`'s scope section must state plainly: this change modifies `DraftSessionHost`'s `live-readiness-view` branch; it does not modify `SessionLobbyPage`.
- Per Marcus's review (§4 of his notes): the source use case document (`requirements/use cases/02 - Session Setup - Use Cases.md`) itself needs a follow-up edit to state "the session room" concretely rather than let the ambiguity resurface on the next exploration pass. That edit is tracked as separate, explicitly-scoped follow-up work, not actioned here.

---

## 2. What already exists to build on

`DraftSessionHost`'s draft-control-view (lines 181–187) already renders the join link as plain, styled text with a "not yet joinable" badge:

```tsx
<div style={{ marginTop: "1rem" }}>
  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#757575" }}>JOIN LINK</div>
  <p data-testid="draft-join-link-not-joinable" style={{ color: "#9e9e9e" }}>
    {`${window.location.origin}/join/${data.joinToken}`}{" "}
    <span data-testid="draft-join-link-badge">(not yet joinable)</span>
  </p>
</div>
```

This is the only join-link display anywhere in the frontend today, and it has no copy button. It's a reasonable visual/structural precedent to extend (label + link text + optional badge), rather than inventing new chrome. Whatever this change adds to the lobby state should probably look like a sibling of this, minus the "not yet joinable" badge, plus a copy button.

The join link URL shape used here (`${window.location.origin}/join/${data.joinToken}`) matches the join-link spec's `GET /api/join/:token` path. Good — no mismatch to resolve there.

**No clipboard code exists anywhere in the frontend yet.** This is genuinely greenfield — `grep -rl clipboard packages/frontend/src` returns nothing. There's no existing wrapper, hook, or fallback pattern to match; this change is establishing that pattern for the app, which raises the bar on getting the fallback behavior right since whatever's built here is likely to get reused (link revocation UI is explicitly named as deferred in the join-link spec — "MUST be implemented as part of the link management UI change" — and that future UI will very likely want the same copy affordance).

**Confirmation-banner precedent exists** in `MemberManagement.tsx`: a plain inline success message with a `setTimeout`-based auto-clear (5 seconds), not a toast/notification library. This matches Devon's "disappear into the background" concern well — no new UI chrome system, no gamified toast stack. The "Link copied" confirmation should probably follow this exact convention rather than introduce something new.

---

## 3. Working through the acceptance criteria against what's real

| AC | Status | Note |
|---|---|---|
| Join link displayed prominently in the session room at all times before the session begins | Partial | Shown (no copy) in `draft` state via `DraftSessionHost`. Absent in `lobby` state everywhere a real user lands (see §1). "Prominently" resolved below — see visual-prominence decision. |
| Copy button adjacent to the join link | Missing | No clipboard code exists anywhere yet. Now scoped to appear in both `draft` and `lobby`+ (see decision below). |
| Activating it places the full URL on the clipboard | Missing | — |
| Visible confirmation shown after successful copy | Missing | Precedent pattern available (`MemberManagement.tsx`'s auto-clearing banner) — auto-clear duration revisited below per Priya's copy-then-alt-tab observation. |
| Link remains visible/manually copyable regardless of Clipboard API availability | Missing | Alternate flow explicitly says: "No confirmation of successful copy is shown" on fallback — i.e., the fallback is *not* just "show the same UI and hope"; it's a distinct, text-only state with no false-positive confirmation. Confirmed as a hard requirement, not a design suggestion — see §4. |

### "Prominently displayed" — resolved to a concrete visual rule

Marcus (BA) flagged "displayed prominently" as unmeasurable AC language, and Priya (Facilitator) independently flagged the same gap from the usability side: the existing `draft`-state treatment (`color: #9e9e9e`, `0.875rem` label — deliberately de-emphasized, appropriate for a "don't bother copying this yet" state) is the wrong visual weight for `lobby`+, where the link becomes the single most important element on the page and sharing it *is* the Facilitator's task.

**Decision:** the muted/gray styling is retained only as the signal for "not yet joinable" (i.e., it stays attached to the badge, not to the link text itself). Once the link is joinable (`lobby`+), the link renders in full-emphasis body text color, not the muted gray — it should read as the primary actionable element on the page, not a footnote. Exact typography/spacing is a `design.md` detail; the rule that it must NOT simply inherit `draft`'s muted treatment by default is settled now.

### Persistence across the waiting window

Priya asked whether the link/copy control stays live and in the same place for the entire `lobby` window, or only gets attention once — a real pattern for her, since sessions often need a second or third share round (someone's late, someone missed Slack). **Confirmed:** because this lives in `live-readiness-view`'s persistent render (not a one-time toast or reveal-once element), it is part of the standing page layout for the full `lobby` duration. A Facilitator can return to it and re-copy as many times as needed without re-navigating. No design change needed to satisfy this — it falls out of where the control lives — but it's worth stating explicitly so it isn't accidentally implemented as a dismissible one-shot element.

### Confirmation banner text and timing — settled

Marcus noted the use case only offers "Link copied" as an example (`e.g.`), not a specified string, and that every other user-facing message in the join-link spec is a literal quoted string. **Decision:** the confirmation banner text is the literal string `"Link copied"` — no "e.g." qualifier, no variation.

On timing: the `MemberManagement.tsx` precedent's 5-second auto-clear was written for a "stare at the screen and see the result" interaction. Priya's actual interaction pattern is copy → alt-tab to Slack → paste → return, which can easily exceed 5 seconds, so a confirmation that's already vanished on return doesn't reassure her the copy actually worked. **Decision:** extend the auto-clear window to 8 seconds for this control specifically (directionally longer, not a re-litigation of `MemberManagement.tsx`'s own timing) — exact value can still be tuned during implementation, but "don't reuse 5s uncritically" is settled.

### Scope confirmation: no effect on the Engineer/join-link side

Priya asked for explicit confirmation that this change doesn't alter what a late-joining participant experiences. **Confirmed:** this change is additive display/copy UI on the Facilitator-facing `live-readiness-view` only. It does not touch `join-links.ts`, `executeJoinFlow`, or the "Session-aware join link landing" redirect rule in `openspec/specs/join-link/spec.md`. Join-link validation and landing behavior for the Engineer are unchanged.

### `draft`-state copy availability — settled during review (revised per facilitator input)

The Main Flow's precondition is "a session ... in a 'waiting for participants' state" — i.e., `lobby`. But the AC says "at all times **before the session begins**," which is broader and plausibly includes `draft`. Right now `draft` shows the link with a "not yet joinable" badge and no copy button.

My original instinct was to withhold the copy button during `draft` (copying a not-yet-joinable link seemed low-value and mildly confusing). Priya Nair (Facilitator review) pushed back with a concrete workflow: facilitators often stage their Slack share message a few minutes before opening the room — draft the message, queue it, then hit "Open the room" and send in the same motion. Requiring a strict open-then-copy-then-paste sequence breaks that staging workflow, and it's exactly the kind of small friction that makes a first session feel improvised for new facilitators.

**Decision: the copy button is available during `draft` as well as `lobby`+.** The link's underlying URL doesn't change between the two states (same `joinToken`), so there's no correctness risk in copying it early — only a timing consideration the Facilitator already understands from the visible "not yet joinable" badge, which stays on screen during `draft` regardless. Concretely:
- `draft`: link text + "not yet joinable" badge (existing treatment) + copy button (new).
- `lobby`+: link text (no badge) + copy button, same control.
- Copy behavior (success confirmation, fallback-on-unavailable, rejected-promise handling — see below) is identical in both states; only the badge differs.

This **supersedes** the draft-state AC language Marcus's BA review proposed for the source use case's follow-up edit (his §2a: "no copy button present" during `draft`). Whoever picks up that use-case follow-up task should write the AC as "copy button present in both `draft` and `lobby`+; the 'not yet joinable' badge, not copy-button presence, is what signals joinability" — not the earlier draft that withheld the button.

---

## 4. Alternate-flow fidelity — where this could quietly drift

This is the part of the use case I'd protect hardest, because it's exactly the kind of detail that gets "simplified away" during implementation if nobody's watching:

> **Clipboard API unavailable:** falls back to displaying the join link as selectable text... **No confirmation of successful copy is shown.**

This is a precise, deliberate distinction: the fallback path is not "same button, hope it works" — it is a genuinely different UI state where the confirmation affordance is suppressed because the application *cannot know* whether the manual copy succeeded. A naive implementation might reach for `document.execCommand('copy')` as an automatic fallback (still common in older Stack Overflow answers) and claim success either way. That would violate the AC. The correct shape, per the use case, is:

```
Clipboard API available?
  ├── yes → copy button → navigator.clipboard.writeText() → success/failure
  │         success → show "Link copied" (auto-clearing at 8s — see §3)
  │         failure → treated identically to "unavailable" (settled below)
  └── no  → no copy button (or a disabled one) → link rendered as selectable text only,
            no confirmation UI at all
```

**Settled: rejected-promise handling.** What happens when `navigator.clipboard.writeText()` exists (feature-detected as available) but the *call itself* rejects — permission denied, insecure context edge cases, etc.? Both reviewers confirmed the same resolution independently: Marcus (BA) because the use case's "Clipboard API unavailable (browser or OS restriction)" framing reads broadly enough to cover a runtime rejection and this is exactly the kind of behavior-changing detail that needs an owning AC rather than living only in exploration notes; Priya (Facilitator) because it matters concretely to her — she's often on a locked-down corp laptop or presenting via screen-share tooling that can intercept clipboard permissions, and a false "Link copied" confirmation on a silent failure would mean pasting garbage into Slack in front of the team. **Decision: a rejected `writeText()` promise is treated identically to "Clipboard API unavailable"** — same fallback to selectable text, same suppressed confirmation, no third error state. This should be added as its own Alternate Flow in the source use case document (Marcus's suggested language, §2b of his review, is ready to use verbatim: "Clipboard API available but the write call fails... Treated identically to Clipboard API unavailable... No confirmation of successful copy is shown.").

---

## 5. Devon's read on this change specifically

- **Low ritual-fidelity risk on its face** — this isn't touching the no-manager rule, the simultaneous reveal, or the facilitator-from-another-team constraint. It's plumbing for something the ritual already depends on (the Facilitator has always had to share a link by hand). Good.
- **The routing gap in §1 is the real risk**, and it's not a ritual-fidelity risk in the "constraints become configurable" sense — it's the "the application makes it *look* like the ritual is supported when it functionally isn't" sense. That's close enough to his "adoption declared a success too early" concern that I'd want it named explicitly in whatever proposal comes out of this, not quietly patched around. Both reviewers independently reinforced this: Priya's framing (`explore-review-facilitator.md`, "Does this disappear into the background?") is the one I'd carry forward verbatim into `proposal.md` — success is "a facilitator running a real session sees this," not "the AC passes against an isolated component." Filed as follow-up issue **[#164](https://github.com/surratt-dev/project-dipstick/issues/164)** so it doesn't quietly become permanent dead code.
- **No UI-chrome concern here.** A join link plus one copy button, inline, no modal, no animation, matching the existing plain-text precedent — this is squarely within "disappear into the background." Resist any temptation during implementation to add a QR code, a share sheet, or anything gamified — the use case's Out of Scope section already explicitly excludes QR codes, and that's the right call.
- **Nothing here touches individual-performance surfacing** — a join link is per-team/per-session, not per-engineer. No concern on that front.

---

## 6. Decisions settled during review — ready for proposal.md / design.md

All four load-bearing questions this exploration originally left open have been resolved, incorporating BA review (Marcus Delgado) and Facilitator review (Priya Nair):

1. **Scope target:** `DraftSessionHost`'s `live-readiness-view` branch only. `SessionLobbyPage` is explicitly out of scope. (§1 — BA ruling, verified against `openspec/specs/join-link/spec.md`'s "Session-aware join link landing" requirement.)
2. **`SessionLobbyPage` routing gap:** not fixed by this change. Filed as follow-up issue [#164](https://github.com/surratt-dev/project-dipstick/issues/164); `design.md` should cite it directly. (§1)
3. **`draft`-state copy availability:** copy button present in both `draft` and `lobby`+ (revised from the original draft-only-withholds-it instinct, per Priya's staging-the-Slack-message workflow). The "not yet joinable" badge, not copy-button presence, signals joinability. (§3)
4. **Rejected `navigator.clipboard.writeText()` promise:** treated identically to "Clipboard API unavailable" — same fallback to selectable text, same suppressed confirmation. Confirmed independently by both reviewers. (§4)

Additional decisions closed out during review, not originally flagged as open questions but raised by reviewers and resolved here rather than left inferred:

5. **Visual prominence:** the `lobby`+ link uses full-emphasis text, not the muted gray/small-label treatment inherited from `draft`'s "not yet joinable" styling — that treatment stays attached to the badge, not the link itself. (§3)
6. **Persistence:** the link/copy control is part of `live-readiness-view`'s standing layout for the full `lobby` window, re-copyable without re-navigating — confirmed, no design change needed. (§3)
7. **Confirmation banner copy:** literal string `"Link copied"`, no "e.g." qualifier. (§3)
8. **Confirmation banner auto-clear timing:** extended to 8 seconds (from the `MemberManagement.tsx` precedent's 5s) to accommodate the copy-then-alt-tab-to-Slack interaction pattern; exact value tunable in implementation. (§3)
9. **Engineer-side scope confirmation:** this change is additive to the Facilitator-facing display only; join-link validation and session-aware-landing behavior are unchanged. (§3)

**Not resolved here, correctly deferred as separate follow-up work:** the source use case document (`requirements/use cases/02 - Session Setup - Use Cases.md`) itself needs edits to reflect decisions 1 and 3 above (concrete "session room" mapping, corrected `draft`-state AC, new rejected-promise Alternate Flow) so the next exploration pass doesn't rediscover these from scratch. Marcus's BA review (§4) scopes this as its own task; whoever picks it up should use the decisions recorded here, not the earlier draft language in that review that this document supersedes (see §3).
