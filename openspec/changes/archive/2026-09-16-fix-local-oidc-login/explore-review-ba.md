# BA Review: fix-local-oidc-login Exploration Notes

**Reviewed by:** Marcus Delgado (Business Analyst)
**Source:** `openspec/changes/fix-local-oidc-login/exploration-notes.md` (Devon Calloway, 2026-09-16)
**Date:** 2026-09-16

---

## Overall read

This is a much easier review than persona-login's was, and for a good reason: it's a two-file, effectively one-line fix, and Devon did the thing I most want to see before anything reaches me — he didn't trust the issue body, he re-derived both bugs against HEAD. I independently re-checked both claims before writing this (read `auth.ts:117-119`, decoded the current JWKS `n` value myself — 256 bytes, confirmed 2048 bits — and checked `docker-compose.yml` for a reverse proxy). Both hold up. Good instinct, and it means I'm not sending this back for fact-checking.

That said, "small fix" is exactly the kind of change that's tempting to wave into a proposal without acceptance conditions, on the theory that a one-line diff is self-evidently correct. It isn't — this exact bug is the poster child for "passed review, silently didn't work." So my read is: the *scope* is right and doesn't need to grow, but a few things in here are decisions dressed up as open questions, and one thing is a verification requirement that isn't specific enough to build from yet. Three items need to be resolved before this becomes a proposal; nothing here is a hard blocker on the scale of persona-login's seed-data question.

---

## 1. Bug 1 fix — specific enough to build, as-is

`request.hostname` → `request.host` in `auth.ts`'s callback URL reconstruction is a real, complete requirement. Nothing to add here; I'd take this straight into a proposal's spec delta unchanged.

**Suggested acceptance condition (for tasks.md), matching the level of specificity the team used on the persona-login change:**
- Given `OIDC_REDIRECT_URI=http://localhost:3000/auth/callback` and a real browser completing the docker-compose local OIDC flow, the token request's derived `redirect_uri` is `http://localhost:3000/auth/callback` (port present), matching the value registered at the authorization step — verified either by a targeted unit test on the URL construction, or by inspecting the outgoing token request during the manual end-to-end check in §3 below (don't require both; pick one and say which in tasks.md).

## 2. Bug 2 — "note it's fixed" needs a form, not just an instruction

The notes are right that there's nothing left to *do* for Bug 2, and right that this needs to be stated with evidence so nobody re-litigates it. But "note (not fix) Bug 2 as already resolved... with a pointer to where/why" doesn't yet say *where that note lives*, and that's not a cosmetic gap — it determines whether the fact is actually discoverable by the next person who opens issue #104 or greps this codebase for JWKS.

This is buildable once it picks a location. I'd want the proposal to state, concretely, at least one of:
- A line in `proposal.md` or `design.md` for this change, citing commit `4cd06e3` and the existing `docker/oidc/server.js` comment, stating Bug 2 was already fixed as a side effect of persona-login and is out of scope here.
- (Separately, and this one's already flagged correctly as not-this-change's-job) a comment or closing note on issue #104 itself — the notes' open question #2 already identifies this as a tracker-hygiene action for whoever triages, not a task in this change. I agree with that framing; I'd just make sure the proposal doesn't accidentally promise to do it.

**Suggested acceptance condition:** `proposal.md` (or `design.md`) for this change contains a dated statement that Bug 2 is already fixed, naming the fixing commit, with no corresponding task in `tasks.md` to re-fix it.

## 3. The verification task — this is the one place the notes are genuinely hand-wavy

Devon is right that this bug's entire story is "looked fine, silently didn't work for anyone doing real QA," and right that a unit test on URL construction alone would repeat that mistake. But "a verification task that actually completes a real browser login end-to-end" doesn't yet say two things an implementer needs:

- **Manual, or automated?** These aren't interchangeable and the notes don't pick one. The persona-login change's own tasks.md (task 3.6, task 4.2, task 7.4) leaned on precise manual verification — "verified directly against the running docker compose service," with the exact number of round-trips stated — rather than standing up new automated browser tooling, for a comparably small, local-dev-only surface. I'd default to the same pattern here for scope-discipline reasons (matches Devon's own "boring, tightly-scoped fix" framing), but the proposal needs to say so explicitly rather than leave "verification task" open to whoever writes tasks.md deciding to reach for a new e2e framework.
- **What "end-to-end" ends at.** Landing on a redirected error page and landing on an authenticated `/team/:id` are both technically "completing" a login attempt. Say which one counts as pass.

**Suggested rewrite of this line for the proposal:**
> Manually verify, against the running `docker compose up` + `npm run dev` stack (the exact path documented in the README's "Local development" section): a browser navigating to `/auth/login` and completing the mock IdP flow lands on an authenticated `/team/:id`, with no manual patching, no port override, and no second OIDC instance — the workarounds the issue's own "Not fixed here" section describes teams currently using.

## 4. The JWKS ephemeral-vs-hardcoded question — resolve it, don't carry it forward as open

Devon lays out a genuine, reasoned recommendation (keep the fixed key — stable across restarts, avoids a confusing forced-logout on every container restart) and then calls it "a coin flip, not a hill" and leaves it as something "the team" can swap if they want. For most decisions that's fine humility. For a proposal, this is exactly the kind of ambiguity I'd flag on persona-login too: an unresolved "either is fine" reads to an implementer as permission to relitigate it mid-build, which is how a one-line-scoped fix grows a second unplanned diff.

This isn't a blocking issue — the reasoning is sound and I have no independent opinion to add — but I want the proposal to convert Devon's recommendation into a stated decision, not carry the open question forward. One sentence closes it: *"This change retains the current fixed 2048-bit key rather than switching to `oidc-provider`'s auto-generated ephemeral key, because a stable key avoids invalidating a developer's session on container restart; this is a local-dev-only stub, so idiomatic key generation isn't a competing goal here."* Done — no task, no follow-up.

## 5. Reverse-proxy open question — fine as a note, but say who resolves it and when

Open question #1 ("confirm whether any deployed/staging environment reconstructs this callback URL behind a proxy...") is appropriately scoped as a "confirm and note," not a redesign, and I agree with Devon's own read that the docker-compose local setup has no proxy in front of the backend, so this is very unlikely to matter for *this* fix. But "I didn't check this" shouldn't survive unchanged into a proposal as a line item with no owner — either:
- Someone checks before the proposal is written (quick grep of any staging/deploy configs for a reverse proxy in front of this backend), and the proposal states the answer, or
- It's carried as a single explicit tasks.md line with a named check ("confirm no staging/prod deployment fronts this backend with a port-remapping proxy; if one exists, file a separate follow-up — this change does not need to handle it").

Either is fine by me; what I don't want is this surviving into `tasks.md` as prose inside the exploration notes rather than as one of the two forms above.

## 6. Code comment question — this is a decision to make now, not later

Open question #3 (add a comment on the `request.host` line explaining why it's not `request.hostname`) is filed as "non-blocking... not mine to decide." Fair, it's not a BA call. But it's also not a real open question — it's a two-second style decision, and the file's own commenting density (the JWKS block above it has a four-line comment explaining exactly this kind of "here's the mistake and why we didn't repeat it") argues for yes. I'd rather the proposal just states "add a one-line comment, consistent with the JWKS comment already in this file" than leave a style nit as an unresolved question for whoever's doing the PR review to have an opinion about after the fact.

## 7. What's already solid — no changes requested

- The re-verification against HEAD before trusting the issue body — this is exactly the diligence I want and I independently confirmed both findings.
- The scope-discipline argument (one bug, one line, no callback-handler refactor, no new configurability) — matches how persona-login stayed disciplined about not touching the callback handler, and I'd hold the same line here.
- The "no new external dependencies" note — fine as-is, nothing to add.
- Traceability to commit `4cd06e3` and the specific comment in `docker/oidc/server.js` — this is the kind of evidence trail that stops Bug 2 from being re-litigated later, and it's exactly what I'd want cited in the proposal (§2 above).

---

## Summary of clarifications needed before proposal

1. State where the "Bug 2 already fixed" note lives (proposal.md/design.md line with commit citation) — §2.
2. Pick manual-vs-automated for the end-to-end verification task and state what "success" lands on — §3.
3. Convert the JWKS ephemeral-vs-hardcoded discussion into a one-sentence stated decision, not an open option — §4.
4. Resolve or explicitly own the reverse-proxy check (§5) and the comment-or-not question (§6) — neither is a blocker, but both should be closed decisions in the proposal, not questions carried forward for someone else to answer during implementation.

None of these change the size or shape of the fix. This is still the one-line change Devon describes; I just don't want any of the four items above turning into a "what did you mean by this?" conversation once tasks.md gets written.
