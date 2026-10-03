# Champion Sign-off: reject-template-team-topic-writes (#188)

*Devon Calloway, Internal Champion. 2026-10-02.*

**Verdict: CLEAN PASS.**

## Ritual intent

This change protects the thing I asked for in the original proposal: a default topic set that
stays visible, stays restorable, and stays the same for every new team. Before this, the template
was only safe because it happened to have no completed session. Now the protection is a rule
(`checkWritableTeam`), it does not depend on session history, and a structural route test enforces
it. That is the right shape. It is structural, not a preference, and nobody can toggle it off.

The FR-8.1 rationale in the BRD is honest. It says the "maintainable by an Application
Administrator" clause is not yet met through the UI and that F5 must be a separate endpoint, never
a relaxation of this guard. I would rather we say that plainly than imply the requirement is met.

## Core constraints

- **No-manager rule:** unaffected. No session-join, participant or role code changed.
- **Simultaneous reveal:** unaffected. No voting, reveal or WebSocket code changed (WebSocket
  routes stay in `app.ts`. The `registerRoutes` extraction is behaviour-neutral).
- **Facilitator from another team:** respected. Step 1 of the check order (standing-facilitator
  authorization, `FACILITATOR_IS_TEAM_MEMBER` / FR-8.2) is untouched and still runs before the new
  guard. The administrator `403` on annotation (FR-8.7) is also preserved.

## Things I am watching (not blockers for this change)

- The template team still appears in every facilitator's session picker, and the security review
  found a membership-creation chain against the sentinel (managers, then join links, then join
  redemption). A "team" with managers and members that is not a real team is exactly where a rule
  like no-manager could get quietly bent. #188 scopes this out on purpose. F1 has to land next, as
  planned, with F2 folded in and a security-review tag.

## Human merge gates (6.1 to 6.3)

These are open as expected and adequately documented. `tasks.md` §6 and `proposal.md` "Pre-merge
human actions" give a named-owner requirement ("human operator" does not count), read-only pass
criteria for each environment, where to record results, the rule that a failed check makes F4
blocking, and the requirement that F1 is filed and linked before merge. The archive note makes the
open state explicit. The Engineering Manager named on the PR owns getting them done.
