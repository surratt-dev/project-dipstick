# Facilitator Review: fix-local-oidc-login (Exploration Notes)

**Reviewer:** Priya Nair, Facilitator (SME persona) — GitHub issue #104

## Framing

I want to be upfront about the shape of this review before the specifics: this exploration is about a bug in transport-layer auth plumbing (`request.hostname` vs `request.host` in a callback URL, plus a JWKS key-size question already resolved). None of my core concerns — reveal simultaneity, readiness-without-spoilers, outlier flagging tone, facilitator pacing control, first-session onboarding of the ritual itself — are implicated here. I said in my own persona notes that I don't have opinions about the technology stack and defer to engineering on infrastructure and deployment. This is squarely that category. So don't read the length of what follows as me pushing back on scope — Devon's instinct to keep this a tight, boring, one-line fix is the right one, and I'd say the same thing.

With that said, here's where this *does* touch something I care about, and where I think the exploration under-examines one question.

## Observations

1. **This is correctly invisible to the ritual, and that's the right outcome.** A login fix that a facilitator or participant never notices is exactly what "disappears into the background" should look like. Nothing about this exploration suggests the fix would surface any new UI, prompt, or behavior during a live session. Good — that's not a gap, that's confirmation the scope is being held correctly.

2. **Login is the one piece of infrastructure that gates everything else I care about.** My success criteria start with "facilitate a complete session... without referring to a spreadsheet or external notes" — but none of that is reachable if nobody can authenticate. A broken login isn't a ritual-integrity bug, but it's a precondition-of-everything bug. That's why I'm not going to wave this off as "not my domain" quite as cleanly as I would, say, a database index choice.

3. **The exploration's own words describe exactly the failure pattern I'm most alert to.** Devon writes: "a broken path that everyone routes around quietly... until it becomes normal that 'local login doesn't really work, just work around it.'" That is precisely the erosion pattern I described in my own notes about the simultaneous-reveal rule — the danger isn't the single failure, it's the tribal-knowledge workaround culture it breeds. I'm glad this was named explicitly rather than filed as a routine fix; I'd want that framing to survive into the proposal, not get lost in a terse changelog line.

4. **The proxy/production question is flagged but then talked out of mattering — I'm not sure that's earned.** The exploration's open question #1 asks whether any deployed/staging environment reconstructs this same callback URL behind a proxy where `request.host` could differ from the external port, then answers itself: "very unlikely to matter for this fix's scope" because "the docker-compose local setup has no reverse proxy in front of the backend." But that reasoning only defends the *local* half of the question. The README says production auth runs through Microsoft Entra on a Kubernetes deployment — which is exactly the kind of environment (ingress/load balancer terminating TLS, possibly on a different external port than the pod sees) where `request.host` vs `request.hostname` behavior, or an equivalent header-trust issue, commonly bites. `auth.ts`'s callback handler isn't dev-only code that happens to also run in prod — it's the same file, same code path, different IdP. I'd want more than "I didn't check this" before calling it settled.

## Questions

1. Is `packages/backend/src/routes/auth.ts`'s callback handler used verbatim for the production Entra login path, or does something upstream (ingress config, an explicit `redirect_uri` override, a different code path) already sidestep the `hostname`-vs-`host` distinction there? If production already passes an explicit `redirect_uri` and never relied on request-derived reconstruction, say so plainly in the proposal — that closes the question instead of leaving it open next to "very unlikely."
2. Has anyone actually confirmed a real facilitator or participant login through Entra in the deployed environment recently, independent of this bug? Given the exploration's own point that this exact class of bug "silently invalidated manual QA for an unknown period," I'd want to know whether that same blind spot could exist on the production side, not just the local one.
3. The exploration recommends verifying the fix with "a real browser login end-to-end" against the local dev flow. Should that verification task explicitly note whether the *same* check has ever been done against staging/production Entra, or whether that's considered out of scope for this change? I don't need it in scope — I need it named as a known gap if it isn't.

## Suggested Additions

- Add one line to the proposal (not a redesign, just a statement) confirming whether the production Entra callback path shares the vulnerable code with the local simulator path, and if so, whether it's actually exposed given current deployment topology (e.g., ingress preserves the original `Host:port`, or Entra's registered redirect URI doesn't include a port at all and so the two ends already happen to agree).
- If that check turns up nothing actionable, say so explicitly ("checked, production is not affected because X") rather than leaving it as an unresolved "worth a note" — given how load-bearing login is for every session I run, I'd rather this be closed with evidence than left open with a probability judgment.
- No changes needed to scope, verification approach for the local fix itself, or the Bug 2 (JWKS) disposition — I have nothing to add there and defer entirely to the engineering team's judgment on the ephemeral-vs-hardcoded-key question.

## Bottom line

This doesn't change my assessment of the ritual mechanics at all — it's outside that surface entirely, and I trust the team to hold the tight scope Devon recommends. The one thing I'd want resolved before this closes is the production/staging question, not because I think it's actually broken, but because "didn't check, but the local reasoning doesn't obviously transfer" is a weaker place to leave a login-path bug than the rest of this exploration's otherwise careful evidence-over-assumption standard.
