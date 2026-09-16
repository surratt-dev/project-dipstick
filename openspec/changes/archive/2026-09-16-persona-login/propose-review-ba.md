# BA Review: Persona Login Proposal

**Reviewed by:** Marcus Delgado (Business Analyst)
**Source:** `openspec/changes/persona-login/proposal.md`, `design.md`, `tasks.md`, `specs/*/spec.md`
**Date:** 2026-09-16

---

## Overall read

This is a different document than the one I reviewed at explore stage, in the good sense. Every blocking clarification I raised in `explore-review-ba.md` — the failure contract, the seed-data decision, landing page content, traceability — has a specific, buildable answer in `design.md` and is carried into `tasks.md` as a discrete checklist item and into the spec deltas as a scenario. I verified the four items I was most concerned about against the current code, not just against the prose, and they hold up. I have one concrete buildability gap (not a requirements gap) that should be fixed before implementation starts, plus two smaller precision notes. Nothing here blocks moving forward; the gap is a one-line fix.

---

## 1. My explore-stage concerns — verified as carried through

**Seed-data gap (my §2, the item I called a hard blocker):** Resolved as Option-A-lite. `manager-001` and `admin-001` get a `role` claim mapped through the *existing* `PERMITTED_GLOBAL_ROLES` / `mapRoleClaimToGlobalRole` path in `account-resolver.ts` — I checked that file directly; the allowlist is exactly `engineer` / `engineering_manager` / `application_admin`, confirming `facilitator` genuinely isn't reachable through this mechanism without a separate allowlist change. `session-participation/spec.md` confirms the OR logic (`global_role = 'engineering_manager' OR team_memberships.role = 'engineering_manager'`) that design.md D4 cites, so `global_role` alone is sufficient to make the Manager button actually exercise the no-manager-participation rule — this closes exactly the gap I flagged (a "Manager" button that doesn't produce a manager). Good outcome, and better than what I proposed (Option A as I framed it implied new seed infrastructure; this reuses an existing mechanism instead).

**`/auth/dev-login-options` failure contract (my §1):** Fully specified now — `404`, no body, no Redis/DB access, both in `design.md` D2 and in the spec delta's three scenarios (`specs/persona-login/spec.md` lines 6-16). No more "or."

**Timeout bound (my §1):** 300ms, stated as a client-side timeout in D3, in `tasks.md` 4.1-4.2, and in the spec delta scenario. Matches what I asked for.

**Landing page content (my §3):** Concretely specified — button labels, the Facilitator caveat text verbatim, the manual-login link, no app chrome. `tasks.md` 4.4 quotes the caveat sentence exactly rather than leaving it to implementation discretion. This is exactly the level of specificity I asked for.

**Concurrent multi-persona use (my §3, flagged as my top product concern — simultaneous reveal testing):** Resolved as "no new engineering, but must be stated" (exploration-notes.md Decision 3), and it shows up as `tasks.md` 7.3 and proposal.md's doc-update bullet. I'd have liked this sentence also on the landing page itself, not just in `docs/local-development.md` — see §3 below — but the substance is there.

**Traceability / no UC (my §4):** proposal.md's Impact section states this explicitly ("no new use case... this is internal dev tooling with no corresponding UC"). Closed as asked.

---

## 2. Buildability gap: `isPrivateAddress` is not exported

This is the one item I'd treat as blocking before implementation, and it's a drift between what proposal.md claims and what the code actually supports.

proposal.md's Impact section states: *"`packages/backend/src/config.ts` (no change — `isPrivateAddress` reused as-is)."* design.md and `tasks.md` 1.1 both describe the new `/auth/dev-login-options` endpoint in `auth.ts` calling `isPrivateAddress(config.OIDC_ISSUER)` directly.

I checked `packages/backend/src/config.ts:22` — `isPrivateAddress` is declared as a bare `function isPrivateAddress(...)`, not `export function`. It is currently only called from within `config.ts` itself (by `loadConfig()`). As written, `auth.ts` cannot import a function that isn't exported. This isn't a hypothetical edge case; it will fail at compile/lint time the moment someone writes task 1.1 as specified.

The fix is trivial (add `export` to the declaration) and doesn't contradict the design's intent — D2's entire point is reusing the same trusted function rather than reimplementing the check, and exporting it is the only way to actually do that. But "no change" in the Impact section is inaccurate as written, and I'd rather this be caught now than have an engineer either (a) get blocked mid-task-1.1 and quietly patch config.ts unreviewed, or (b) reimplement the private-address logic inline in auth.ts to avoid touching config.ts, which would silently violate D2's "one already-trusted judgment, not two" reasoning.

**Suggested fix:** Update proposal.md's Impact line to `packages/backend/src/config.ts` (export `isPrivateAddress`; no behavior change), and add a sub-bullet to `tasks.md` 1.1: "export `isPrivateAddress` from `config.ts` for reuse in `auth.ts`."

---

## 3. Two smaller precision notes (not blocking)

- **Multi-persona sentence placement.** Exploration-notes.md Decision 3 commits to "one explicit sentence, on the landing page **and** in `docs/local-development.md`." `tasks.md` 7.3 covers the docs half; I don't see a corresponding landing-page task (4.4 lists banner, four buttons, Facilitator caveat, and the manual-sign-in link — no multi-persona sentence). If this was intentionally dropped from the page itself in favor of docs-only, that's a reasonable call, but it's a change from what exploration decided and should be a stated decision, not a silent drop. If it wasn't intentional, add it to 4.4.

- **Facilitator label consistency.** design.md D5 and the spec delta both correctly specify the Facilitator button shows account id alone with the caveat. `tasks.md` 1.3 says the backend response includes "account id only, with an 'unseeded' flag, for `facilitator-001`" — but the exact caveat wording lives only in `tasks.md` 4.4 (frontend). Worth confirming whether the backend's "unseeded" flag is a boolean the frontend uses to decide *whether* to show the caveat, or whether the frontend hardcodes the caveat text regardless of a backend flag — as written both could be independently implemented in a way that drifts (e.g., backend flag says unseeded but frontend caveat text is hardcoded per-account-id rather than driven by the flag). Not a blocker, just worth one sentence in design.md tying the two together so there's a single source of truth for "is this persona unseeded" the way D2/D6 insist on a single source of truth elsewhere.

---

## 4. Spec delta vs. proposal/design drift check

I compared each ADDED/MODIFIED requirement against proposal.md and design.md line by line:

- `specs/persona-login/spec.md` — matches design.md D1-D8 and tasks.md sections 1-5 faithfully. The "Persona login preserves the standard authentication flow" requirement and its audit-event scenario match D8 and are verified against the actual event names in `packages/backend/src/auth/audit-logger.ts` (`auth.callback_received`, `auth.session_created`, `auth.success`, `auth.first_access_created`, `auth.role_claim_mapped` all exist as written — no invented event names).
- `specs/oidc-auth/spec.md` — the modified "OIDC authentication redirect" requirement correctly narrows the existing "no interstitial" rule with the exact double-gate condition from D2. No drift.
- `specs/local-dev-environment/spec.md` — the modified "Simulated OIDC provider" requirement and its two new scenarios match D4/D1 exactly, including the explicit "facilitator and participant accounts remain unseeded" scenario. No drift.

No requirement in any spec delta asserts something proposal.md or design.md doesn't also say, and I didn't find a design decision that failed to make it into a spec delta.

---

## Summary of blocking clarifications before implementation

1. **Export `isPrivateAddress` from `config.ts`.** proposal.md's "no change" claim for `config.ts` is inaccurate; the endpoint as designed cannot be built without it. Fix is one word plus one `tasks.md` sub-bullet (§2).

Non-blocking, worth a sentence each before or during implementation:

2. Confirm whether the multi-persona sentence belongs on the landing page itself or docs-only was a deliberate scope-narrowing from exploration (§3).
3. Tie the backend "unseeded" flag and the frontend caveat text to a single source of truth (§3).

Everything else — failure contract, timeout, seed-data decision, landing page content, traceability, spec-delta fidelity — is specific enough to build from as written.
