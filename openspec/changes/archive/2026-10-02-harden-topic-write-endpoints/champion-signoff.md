# Champion Sign-off: harden-topic-write-endpoints (#184)

*Devon Calloway, Internal Champion. 2026-10-02.*

**Verdict: clean pass.**

## Ritual constraints

- **No-manager rule.** Unaffected. Nothing in the diff touches participant join, role checks or session membership. The limiter runs *after* authorization, so it adds no route in for anyone.
- **Simultaneous reveal.** Unaffected. No voting, reveal or WebSocket module is in the diff.
- **Facilitator from another team.** Unaffected. In `facilitator-sessions.ts` the only change is two team-not-found 404 bodies swapped to `teamNotFoundEnvelope()`. The Decision D1 cross-team check below them is untouched and still a hard block.
- **Topic flexibility within guardrails.** Better than before. The template-team guard is now case-insensitive by test, not by luck, and a facilitator can still always restore the defaults. The burst floor (≥ 100) is written into the spec and sized for a two-team baseline restore of 90 requests, and the limits are not something an admin can switch off.

## Can the limiter affect live session, room or voting flows?

No. I checked both halves of Decision 8:
- **Structural.** `topic-write-rate-limit.ts` is imported only by `topics.ts` (plus its own context/audit helpers and tests). `sliding-window-limiter.ts` is imported only by that helper and `teams.ts`. A CI test enforces this.
- **Behavioural.** A real-Redis test fills both windows to 100% and then opens the room, starts the session and begins voting. All of them succeed.
- **Lock.** Room open shares the per-team topic lock, but the limiter runs *before* the lock, so a 429 or 503 never holds it. The fail-closed 503 path is only acceptable because of this, and it holds.

## Topic Management 429/503 UX during pre-session prep

It stays out of a facilitator's way:
- **Limits.** 120 per 10 minutes and 400 per 24 hours per actor, with no global bucket. That is well above the 78-request tailoring-plus-prep fixture and a 190-request three-team day. One facilitator can't lock out another.
- **Messages.** Plain words that say earlier changes are saved, with the wait given as "about N minutes". Raw seconds are never shown, and no team is named.
- **Work in progress.** Drafts, the add form and the archive escalated confirmation all stay open. Nothing retries automatically, and no new UI chrome is added.
- **503 from elsewhere.** A 503 from a proxy is not shown as a "pause". Only the limiter's own code is.

## Minor notes (non-blocking)

1. The daily message says "You can continue tomorrow", but the window rolls over 24 hours. A facilitator who hits it at 4 pm can actually resume at about 4 pm the next day, not at midnight. The copy is close enough, and hitting 400 in a day is very unlikely in real prep. Worth tightening if the copy is touched again.
2. A Redis blip during prep turns every topic write into a 503 until Redis recovers. That is acceptable because sessions themselves don't depend on the limiter and session auth already needs Redis anyway. Topic prep belongs before the session anyway.
