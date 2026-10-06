# Champion sign-off: configurable-oidc-role-map (#243)

**Reviewer:** Devon Calloway, Internal Champion
**Date:** 2026-10-05
**Verdict:** Sign-off, with concerns already tracked. None of them block this PR on ritual grounds. Merge still waits on the human-pending tasks the change already lists (7.1 Security Analyst sign-off; `security-review.md` has no sign-off line yet).

## Did the change keep the ritual's intent?

Yes. The change makes role *recognition* configurable and leaves the *constraints* fixed. Nothing here adds a toggle, flag or admin setting that weakens the no-manager rule, the simultaneous reveal or the facilitator-from-another-team rule. The internal role enum, the precedence order and the eligibility checks are all hard-coded. `OIDC_ROLE_MAP` only tells the application which IdP groups mean "manager", and leaving managers unmapped is a boot failure in production, not a silent default. That is the right shape: someone who wants to configure the rule away has to misconfigure the IdP, and that leaves a trail.

## Core constraints

| Constraint | Status | Notes |
|---|---|---|
| No-manager rule | Strengthened | Before this change a manager known to the IdP by any name other than our internal string was silently an engineer. Now production will not boot without an `engineering_manager` mapping. Admins are refused at registration (E1), vote lock-in (E2), live participant events (E3) and the roster (E4), with tests. A manager in both the manager and admin groups resolves to admin and is still kept out. Closing that hole was the reason for the S1 decision, and I agree with it. |
| Simultaneous reveal | Unaffected | No reveal or vote-visibility logic changed. The only vote-path change is the extra admin check and a role-neutral 403 message. |
| Facilitator from another team | Unaffected | Facilitators can now actually arrive from the IdP (01b), which is what makes cross-team facilitation workable. The same-team guard is not touched. The existing admin bypass of the facilitator `isMember` guard predates this change and is on the 7.1 checklist. |

## (a) Concerns that block this PR

None on ritual grounds. I am not adding any blocker. The existing gate stands: 7.1, the Security Analyst's sign-off, blocks merge, and 7.2, the per-deployment IdP and rollback-safety record, blocks release.

## (b) Known risks, tracked, that I am accepting for now

1. **A demoted facilitator can finish a session that is already open (FU-1, N1).** This predates the change but is now reachable through an ordinary group change. The variant that bothers me most is a facilitator re-mapped to `engineering_manager` mid-session who keeps the facilitator live stream, including `vote_revealed`. That is a manager watching a reveal. The likelihood is low and the window ends at `complete`, so I accept it **only** on the stated condition: FU-1 is resolved before a second team goes live. Until then the docs tell operators not to change the map while sessions are live. I want that condition to stay in FU-1's title or priority when it is filed, not only in its body.
2. **Rolling back a deployment with a translating map turns managers into engineers.** Rolled back that way, managers join live sessions with no error, which re-opens the no-manager rule. The upgrade notes, `docs/deployment.md` and task 7.2 (a per-deployment "rollback safe/unsafe" line) all say so clearly. The release owner has to actually record this in `release-check.md`. A rollback without reading it is the most likely way a manager ends up in a session in the next quarter.
3. **The boot guard proves a manager key exists, not that it matches anyone (FU-8, plus the N4 fix).** A typo or a renamed group still drops managers to `engineer` silently at runtime. FU-8, the count of sign-ins by role, is the real safety net and should be filed with priority next to FU-1. FU-12 (warning noise) matters for the same reason: operators must not learn to filter the line that would reveal a misspelled manager key.
4. **Admins refused at the lobby see generic no-access copy (FU-11).** This is acceptable for one release. The explanation is part of what makes the rule stick socially, not just technically.
5. **Revocation takes up to about 90 minutes (FU-7).** This is operational and does not threaten the ritual.

## Request to whoever files the follow-ups (task 7.4)

File FU-1 and FU-8 first. They are the two items that bear on the no-manager rule. Make "before a second team goes live" visible on FU-1.

Signed: Devon Calloway, 2026-10-05
