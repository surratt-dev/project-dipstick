# Executive Review: fix-local-oidc-login Proposal

**Reviewed by:** Rachel Okonkwo (VP of Engineering, Executive Stakeholder)
**Source:** `openspec/changes/fix-local-oidc-login/proposal.md`, `design.md`, `tasks.md`
**Date:** 2026-09-16

---

## Bottom line

Approved, no changes requested. This is the kind of proposal I want to see more of, not less: a real productivity blocker, fixed at the root cause, with a blast radius the team went out of its way to keep small. I don't need to be consulted on this one — it doesn't touch data access, team boundaries, or anything that shows up in my success criteria — but since I've been asked to look, here's my read.

## Strategic alignment

Local OIDC sign-in being broken isn't a cosmetic bug — it's every engineer on every team hitting a wall the moment they try to run the app per the README. That's the kind of quiet friction that doesn't show up in a status report but shows up in velocity, and eventually in "local dev is janky here" becoming part of how people talk about working on this codebase. Fixing it is table stakes for the same reason I care about onboarding friction on the Health Check itself: a broken first-run experience quietly taxes everyone who hits it, indefinitely, until someone stops and fixes the root cause instead of routing around it. The proposal's own framing — that the workarounds in circulation are "quiet erosion" that normalizes broken infrastructure — is exactly the argument I'd make to justify the time spent. This is a defensible five minutes of engineering time, not scope I'd question.

## Scope proportionality

This is close to a model of what "ship the fix, not the redesign" looks like. A few things I specifically want to reinforce as good judgment, because I want to see it repeated:

- The fix is one property swap (`request.hostname` → `request.host`) plus a comment. No refactor, no new abstraction, no configurability added for a problem that doesn't need it.
- The team explicitly declined to re-open the JWKS key question, closed it as a "not this change's job" decision, and said so in three places (proposal, design, tasks) so it can't get re-litigated by a future reader. That's the discipline I want — closing decisions instead of leaving them open for the next person to second-guess.
- Verification stayed manual against the existing docker-compose stack rather than standing up new e2e tooling for a one-line change. Right call — the cost of new test infrastructure here would exceed the cost of the bug it's guarding against.
- No production behavior changes, and the proposal shows its work for why (`trustProxy: 1`, standard-port HTTPS behind an ingress never carries a port in `Host`). I don't need to take that on faith; it's reasoned through, not asserted.

None of the concerns I usually flag — over-engineering, scope bleeding into unrelated systems, a fix that quietly becomes a platform — are present here.

## On the spec delta specifically

I was asked to weigh in on whether adding a new scenario to `specs/oidc-auth/spec.md` — "Callback URL reconstruction preserves a non-default port" — is proportionate rigor for a one-line fix, or overhead.

My read: proportionate, and I'd have been more concerned by its absence than its presence. The reasoning that sold me is in the proposal itself — this exact class of gap ("the spec never said the callback URL had to preserve the port, so nobody caught that the code didn't") is what let the bug exist undetected in the first place. A one-sentence scenario that makes the requirement explicit is cheap insurance against the same bug coming back the same way, which is precisely the kind of investment I'd call defensible: it costs almost nothing today and it's aimed at a failure mode that already happened once. It also isn't a one-off inflation of process for this change — it mirrors the precedent already set by `persona-login`'s JWKS scenario, so a future engineer sees a consistent pattern ("small dev-infra fixes get a scenario documenting what they closed") rather than an arbitrary exception. Consistency in how the team documents this class of fix matters more to me than trimming one file out of a four-document change.

I'll register the one caveat honestly, because it's the legitimate version of "is this overhead": if every one-line fix in this codebase starts requiring a proposal, a design doc, a spec delta, and a task list, that's a process cost that adds up, and at some volume I'd want the team to have a lighter-weight path for genuinely trivial fixes. But that's a question about the openspec workflow's tiering, not about this change — and it's not this proposal's job to solve. Judged on its own, the spec delta here is one sentence closing a real gap, not scope creep dressed up as rigor.

## Relative to my success criteria and concerns

Not directly load-bearing for any of the four success criteria — this doesn't touch the Health Check's data model, access controls, or team boundaries at all. But it's exactly the kind of "ship the fix, not the feature" discipline that keeps me from worrying about the second of my standing concerns (over-engineering the application delays value). Nothing here delays anything; it removes a delay.
