# Drafted copy — pre-session action item review (tasks.md 1.1)

Status: **drafted, implementation-ready. Rachel Okonkwo's (VP of Engineering) personal
sign-off on the staleness-tier and empty-state copy has NOT yet been recorded** — see
"Outstanding sign-off" below. Per proposal.md this copy gate blocks frontend rendering
work; it does not block backend work. Frontend rendering (tasks 5.2/5.4/5.5) proceeds
using this draft, on the basis that it is written to the reviewed-quality bar the gate
calls for, not placeholder text — but the gate itself is not fully closed until Rachel's
sign-off is recorded against this exact wording.

Tone constraints this copy was written against (per proposal.md / design.md's framing
of Rachel's no-performance-tool concern): descriptive, not evaluative. No blame or
urgency language directed at any individual or owner. Time-elapsed framing ("carried
over N sessions"), never a judgment framing ("overdue", "neglected", "stale item").

## Empty state

Shown identically to every participant (engineers and facilitator) when the team has
zero open or in-progress action items — whether because this is the team's first
session or because everything from prior sessions has been resolved.

> **No open action items.**
> Nothing carried over from a previous session.

## Staleness legend (always visible, explains the color scale)

> **What the colors mean**
> Yellow — carried over 1 session. Orange — carried over 2 sessions. Red — carried
> over 3 or more sessions. No color — updated in the most recently completed session.

## Per-item staleness badge/label text

Shown next to an item's staleness color. No badge is rendered when the level is
`none` (0 sessions elapsed).

| Level  | Badge/label text            |
|--------|------------------------------|
| yellow | Carried over 1 session       |
| orange | Carried over 2 sessions      |
| red    | Carried over 3+ sessions     |

## Summary line (always shown at the top of the list whenever open/in-progress items exist)

Count = plain union of yellow + orange + red items (not red-only, not severity-weighted).

- **One or more items at a non-`none` staleness level** (`count` = that union):
  > "{count} item{s} need attention" — e.g. **"3 items need attention"**, singular:
  > **"1 item needs attention"**
- **Open/in-progress items exist, but none are stale** (neutral variant — the line
  stays visible, it does not disappear):
  > "{count} open item{s} — none need attention" — e.g. **"5 open items — none need attention"**

## Outstanding sign-off

This draft was written by the implementing engineer (Marcus Oyelaran) to the bar the
scope gate calls for — real, reviewed-quality copy, not a placeholder — because no live
stakeholder session was available during this implementation pass. Per proposal.md /
tasks.md 1.1, **Rachel Okonkwo must personally review and sign off on the staleness-tier
and empty-state copy above before this screen ships to a pilot team.** That sign-off has
not happened yet and must be obtained — and this file updated with the outcome (approved
as-is, or revised) — before pilot rollout. This is a documented gap, not a silent
assumption of approval.
