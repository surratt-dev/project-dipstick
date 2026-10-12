# Champion Sign-off: 263-topic-002-error-codes

**SIGN-OFF**

*Devon Calloway, Internal Champion. Reviewed the archived artifacts and `git diff`.*

## Did the change preserve the ritual's intent?

Yes. The only production change is in `routes/content.ts`. The TOPIC-002 403 body is now built with `buildErrorEnvelope("forbidden", message, decision.reason)` instead of an inline object. The authorization decision, the denial audit step, the timing floor and the message strings are untouched. Everything else in the diff is spec text, the REST contract, and tests.

## Core constraints

- **No-manager rule: unaffected, and the tests reinforce it.** The decision logic is not edited. The parametrised tests include a global engineering manager who is also a team member, and that caller still gets `NOT_A_FACILITATOR`. Managers get no new path in, no new reason, and no softer refusal.
- **Simultaneous reveal: unaffected.** This is a topic-management endpoint. No session, voting or reveal code is touched.
- **Facilitator from another team: unaffected, and now more legible.** A facilitator who belongs to the team is still refused, and the refusal is now machine-distinguishable as `FACILITATOR_IS_TEAM_MEMBER`. That is the same code TOPIC-003..006 already use. The rule stays structural. Nothing is configurable, and the code is output only.
- **Not a performance tool: unaffected.** No new data is exposed. The code repeats the audit `metadata.reason`, which is a bit about the caller's own standing.

## Things I checked and am comfortable with

- The design says clients MUST NOT use `error.code` to grant or unlock anything, and the server stays the sole authority. This keeps the code from becoming a toggle.
- The audit remains fail-open on denials, as in #264. This change pins that behaviour in tests and does not change it. I accept the rationale: grants fail closed and denials fail open.
- The proposal says plainly that this is consistency and testability, with no user-visible change. I appreciate that. It does not oversell.

## Non-blocking notes

- The member-facilitator message still states the rule without saying what to do next. That is deferred to the copy follow-up. Please make sure that follow-up is actually filed. The person who hits this wall is a facilitator who has been told "no" with no way forward, and the way forward should be to ask a facilitator from another team.
- The #264 fixture is no longer a pure pre-change baseline. It was hand-edited, and its comments were updated to say so. That is acceptable, but it is a precedent. The fixture should not be quietly regenerated in future.
