# Explore Review — Facilitator (Priya Nair)

**Reviewing:** `exploration-notes.md` (Devon Calloway) for #243
**Date:** 2026-10-05
**Stance:** The user has decided to implement #243 as written: its own fixed precedence (`application_admin > engineering_manager > facilitator > senior_engineer > engineer`) and a single-value `users.global_role`. I'm not reopening that decision. Devon's §3 / Q1 / Q2 recommendation to layer onto #235 has been overruled. My review takes #243 as written and asks what it means for the person running the room.

My main concern: when this change goes wrong, the first person to find out is a facilitator. She opens the app ten minutes before a session and gets "Only a facilitator can create a draft session." Every ritual constraint Devon lists depends on role recognition. So does whether I can do my job at all.

---

## Observations

### O1. The notes are written from the operator and constraint side. Nobody looks at it from the facilitator's side.
Devon's analysis of the no-manager rule fails in a way that lets a manager in. That's correct, and it's the most important ritual risk. The notes don't cover the opposite failure: a real facilitator who doesn't get recognised as one. Today that's every facilitator (they're reset to `engineer` at each sign-in). After #243 it will be any facilitator whose group is unmapped, renamed, hit by Entra overage (§4.5), or outranked by precedence (O2). For me that's no small degradation. Every facilitator route (`facilitator-sessions.ts:318, 547, 858, 2463`, `topics.ts:122, 760`) is an exact `=== "facilitator"` check. I lose draft creation, eligible-team lookup, launch, topic editing and annotation editing (`content.ts:769`) all at once, and the failure shows up only as a 403.

### O2. #243's precedence silently takes facilitating away from anyone who also holds a higher role. That includes `application_admin`, not only EM.
- **EM + facilitator → `engineering_manager`.** This matches the #238 *outcome*. Without #241's "never silent" notice, though, a manager who's also in the facilitator group (for example, they facilitate for a sister team) signs in and finds the facilitator view gone, with no explanation. I accept the outcome. The silence is a problem.
- **Admin + facilitator → `application_admin`.** Devon's notes don't mention this, and I think it's the bigger surprise. `standing-facilitator-access-helper.ts:104` lets an admin through to some content paths. Session lifecycle routes in `facilitator-sessions.ts` and topic writes in `topics.ts` require `global_role === "facilitator"` exactly, and annotation editing is facilitator-only (`content.ts:769`). In small orgs, the person who sets the tool up (admin) is often also the person who runs the sessions. Under #243's order that person **can't run a session**. The usual workaround is a second IdP account, which is exactly the "spreadsheet beside the tool" friction I want gone.
- **Facilitator + senior_engineer → `facilitator`.** That's fine for me. Senior engineers are the most likely facilitators, so this is the common case, and it resolves well.

### O3. The admin + facilitator collapse also sidesteps "facilitator must not be a member of the team".
`application_admin` returns `authorized: true` *before* the `isMember` check (`standing-facilitator-access-helper.ts:104-110`). So where admin reaches facilitator-adjacent content paths, the "not on the team you facilitate" guard doesn't apply to them. That's existing behaviour, but #243 makes it *more reachable*: anyone in an admin group and a facilitator group is now resolved as admin. It's worth a line in the security review list in the issue.

### O4. Role changes take effect at sign-in, and sessions can outlast a sign-in.
The absolute session lifetime is 90 minutes (`auth/middleware.ts:34`). First sessions for a new team are meant to run long (FR first-session support). If a facilitator's session times out mid-ceremony and the map or IdP group has changed since their last sign-in, they come back with a different role and get a 403 on the next facilitator action (`facilitator-sessions.ts:858` is a "live role" check). This was possible before. #243 makes map edits a routine operator activity, which makes it likelier. I want to know that **an operator changing `OIDC_ROLE_MAP` can't demote a facilitator in the middle of a live session without anyone noticing**, and that if it does happen, the room doesn't lose the reveal.

### O5. Devon's §6 local-dev point matters more to me than it seems to.
`facilitator-001` in the OIDC stub has no role claim today, so the local "Facilitator persona" isn't a facilitator. Before first-team launch I'm doing usability testing of the facilitator view, and I need to sign in as a facilitator in local and staging without anyone hand-editing the DB. With the identity default this gets fixed. Please make it an acceptance criterion and don't leave it as a "check before duplicating" note.

### O6. Does it disappear into the background? Mostly yes, and that's the right goal.
When it works, the map is invisible to me: I sign in and I'm a facilitator. That's how it should be. The risk is that **every** failure mode in §4 is also invisible until I'm in front of a team. The only signals the notes propose are for operators (startup log counts, warnings). Nothing is aimed at the facilitator or the participant.

### O7. Devon's Q3 (require an EM target in production) is good. It's one-sided, though.
A hard check for an `engineering_manager` target protects the no-manager rule. There's no equivalent for `facilitator`. Devon leans "warn only", and I understand why: a deployment might use only admins as facilitators. But because of O2, an admin can't facilitate. A production deployment with **zero keys → `facilitator`** therefore can't run a single health check. That should be at least a loud startup warning, not a quiet one.

---

## Questions

- **FQ1.** With #243's precedence, is the admin + facilitator collapse to `application_admin` intended, given that admins can't create, launch or run sessions? If it's intended, operators need to be told that "don't put your facilitators in the admin group" is a deployment rule.
- **FQ2.** What does a demoted or unrecognised facilitator actually see? Today it's a 403 message string. Is there a single place (profile or header) where a signed-in user can see the role the app resolved for them? Then a facilitator could tell "I'm not mapped" apart from "the app is broken" before a session, not during one.
- **FQ3.** Should the existing unmapped-claim warning also fire when the user's claim *contained* a value mapped to `facilitator` but precedence discarded it? That's the #238 "never silent" property, scoped to an audit or log line. It doesn't need #235's storage. I'm not asking for multi-role storage. I'm asking that the discard be recorded.
- **FQ4.** If a facilitator is demoted at re-sign-in while their session is `live`, what happens to that session? Does it stay controllable until it ends, or is it stranded with no one able to advance or close it?
- **FQ5.** Are the upgrade notes (Devon §4.6) going to tell operators to **verify a facilitator can create a draft session** after deploying? "The app boots" isn't the same as "a facilitator can run a session".

---

## Suggested additions to the exploration / proposal

1. **Add facilitator-side failure modes to §4:** (a) facilitator group unmapped, so every facilitator becomes `engineer`; (b) admin + facilitator collapses to admin and the user can't run sessions (O2); (c) EM + facilitator is resolved silently (O2); (d) a mid-session re-sign-in demotes the facilitator (O4).
2. **Precedence-discard visibility (cheap, compatible with single-value storage):** when the resolved role is higher than `facilitator` and a `facilitator` mapping was present, write a count or flag to the `auth.role_claim_mapped` audit metadata (no raw values). It costs little, and an operator can then answer "why can't Priya facilitate?"
3. **Startup warning when no key maps to `facilitator` in production.** Make it a warning, not a hard failure, and word it clearly: "no IdP value maps to facilitator; no user will be able to run a session."
4. **Docs, `docs/deployment.md`:** a short "facilitator checklist" next to Devon's manager warning: map a facilitator group; don't also put facilitators in the admin or manager groups if they're meant to facilitate; after a map change, affected users must sign in again; and don't change the map while sessions are live.
5. **Acceptance criteria:** the OIDC stub's `facilitator-001` resolves to `facilitator` under the default map, and a test confirms that the stub persona can create a draft session end to end.
6. **Unit tests for `mapRoleClaimToGlobalRole`:** add explicit cases for `[admin, facilitator]` and `[engineering_manager, facilitator]` asserting the precedence result, so the facilitator-losing outcomes are *pinned and visible in review*, not emergent.
7. **Follow-up to file (not in this change):** a "your resolved role" indicator in the UI (FQ2) and a decision on what happens to a live session when its facilitator loses the role (FQ4). These belong with #241 and the session-flow work, but #243 makes them likelier to happen.

---

## Bottom line

I support #243 as written. It's the change that finally lets the 01b decision put me in the room as a facilitator. My concern isn't the mechanism. It's that its precedence and single-value design lose facilitating capability in two situations (admin + facilitator, EM + facilitator) without telling anyone. And all of its failure modes surface to the facilitator at session time, not to the operator at deploy time. A startup warning, an audit flag on discards, two pinned tests and a facilitator checklist in the docs cover most of this. None of them needs reopening the user's decision.
