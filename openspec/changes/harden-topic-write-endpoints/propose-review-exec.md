# Proposal Review — Executive Stakeholder

**Reviewer:** Rachel Okonkwo, VP Engineering (Executive Sponsor)
**Artifact:** `proposal.md` (harden-topic-write-endpoints, GitHub #184)
**Focus:** Strategic alignment with adoption goals; scope proportional to a Low-severity hardening follow-up
**Verdict:** **Approve with conditions.** The direction is right. The scope is about one notch heavier than a Low-severity issue warrants, and I want the trim points named before implementation starts.

---

## What I like

1. **The framing is right.** Devon ties the work to facilitator trust and puts session runtime off-limits. That matches my main worry: if the tool ever gets in the way of a live session, the ritual dies. Constraint 1 (no limiter or hook near `facilitator-sessions.ts` or room open, enforced in CI) is the most valuable line in the proposal.
2. **Constraint 2 protects adoption directly.** A facilitator restoring all 12 defaults and then editing must never hit a 429. A rate limiter that trips a first-time champion during setup would be worse than having no limiter. I am glad this is a floor in the spec and not just a tuning note.
3. **It starts from `main`, not from the issue.** L1 and L2 have already landed in #175/#176/#188, and the proposal says so. That keeps the team from redoing work.
4. **No new dependencies, and the existing Q6 decision is reused.** That fits my preference for open-source, in-house, low-overhead tooling.
5. **429/503 copy is in plain words, input is preserved, and nothing retries automatically.** That is the right user-facing posture.
6. **Constraint 5 (a 429/503 never reveals whether a team exists)** supports the access-boundary property I care about.

## Concerns

### C1. Scope is broad for a Low-severity follow-up (main concern)
#184 lists four Low findings plus two informational ones. The proposal turns that into **3 new capabilities, 6 modified capabilities, 9 spec deltas, 41 tasks, a governance decision record, and two follow-up issues**, plus about 1,700 lines of planning artifacts. None of the underlying findings is an incident; the proposal says so itself. This is the internal-tools ballooning I warned about. Every week spent here is a week the trend dashboard, outlier detection and action-item loop (my success criteria 1–3) are not getting closer to a third team.

I am not asking to cut the limiter. I am asking the team to confirm that this pass is time-boxed, and to name what gets dropped if the box is exceeded.

### C2. The `teams.ts` envelope and boundary changes go beyond "topic writes"
Moving `GET /teams/:teamId` and `/members` onto `TEAM_NOT_FOUND` with `category: not_found`, and adding UUID checks to them, is reasonable hygiene and does answer architect m5. It is also the only **BREAKING** item, and it touches routes outside the topic surface. Keep it if Task 1.3 confirms that no frontend code depends on the old category, and keep it as its own commit or PR so it can be reverted on its own. If the verification turns up anything, defer it to its own issue rather than growing this change.

### C3. The fail-closed-on-Redis default needs one sentence of operational justification
Topic writes now return 503 when Redis is down. That is defensible, since topic writes are not session runtime. But it is a new way for a facilitator to be blocked during pre-session setup, for a Low-severity risk. I accept it **only because** Constraint 1 keeps it away from sessions. Please make sure the Ops impact line reaches whoever runs our Redis, and that the 503 copy tells the facilitator to try again shortly instead of reading like a failure.

### C4. Section 7 (F7 / I1) should be droppable by default, not just droppable on paper
`no-store` on Fastify framework rejections and a timing floor on thrown paths are informational findings that carry no data. The proposal already marks them separately droppable. I would go further: do them last, and drop them without ceremony if the time box is hit. A "recorded decision" should be one line, not another review cycle.

### C5. Governance overhead on the thresholds
A co-signed BA and security decision record (q7) before the limiter tasks can start is consistent with Q6. For a Low item, I want it to stay a short doc that sets the numbers inside the already-stated floor (burst ≥ 80, daily ≥ 200), and not reopen the design. If it stalls, sections 2–4 can and should ship without waiting for it.

## Strategic alignment summary

| Item | Serves adoption / trust? | Proportional? |
|---|---|---|
| Session-runtime exclusion (C1 constraint) | Strongly | Yes |
| Ritual floor on limiter | Strongly | Yes |
| Per-actor limiter + 429/503 UX | Moderately (defends facilitator trust) | Yes, if time-boxed |
| Malformed id → 404, `teamId` lowercasing, lock test | Indirectly (removes review re-litigation) | Yes, cheap |
| `TEAM_NOT_FOUND` across `teams.ts` / sessions | Weakly | Borderline; isolate (C2) |
| F7 / I1 response hygiene | Negligible | Drop first (C4) |

## Conditions for approval

1. State a time box for the change, along with the drop order if it is exceeded: section 7 first, then the `teams.ts` GET envelope/boundary work (C2), deferred to a follow-up.
2. Land sections 2–4 (envelope, identifier hygiene, extraction) independently of the q7 decision record, so that governance does not block the cheap fixes.
3. The 503 facilitator copy tells the user to retry shortly and does not suggest anything is lost (C3).
4. The bulk "Restore default topics" follow-up is filed as the proposal says. It is the adoption win hiding in this issue: it makes the first-session tailoring experience smoother than any limiter tuning will. Please give it real priority in the milestone.

I do not need to see this again unless the scope grows.

— Rachel
